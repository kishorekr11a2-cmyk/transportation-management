import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";
import mongoose from "mongoose";
import {
    getManagedUsers,
    getConfirmedUsers,
    deduplicateUsers,
    getAvailableVehicles,
    calculateStoppingGroups,
    resolveStopCoordinates,
    calculateDistanceKm
} from "../services/aiAgentService.js";
import {
    buildGlobalOptimizationMatrix,
    generateGlobalCandidateRoutes,
    assignVehiclesToOptimizedRoutes,
    sequenceInwardRouteStops,
    isRouteCorridorCoherent,
    expandCandidateRoutesToTarget
} from "../services/routeOptimizationService.js";
import { DEFAULT_SOURCE_HUB } from "../services/mapGeocodingService.js";
import InwardStartingPlace from "../models/InwardStartingPlace.js";

function balanceRoutesToGuaranteedSeating({
    routes = [],
    availableVehicles = [],
    matrix = null,
    hub = DEFAULT_SOURCE_HUB,
    tripMode = "TO_DESTINATION",
    activeInwardStartingPlaces = []
}) {
    const isOutward = tripMode === "FROM_SOURCE" || tripMode === "OUTWARD";

    // Clone routes deeply
    const balanced = routes.map((r) => ({
        ...r,
        stops: (r.stops || []).map((s) => ({
            ...s,
            userIds: Array.isArray(s.userIds) ? [...s.userIds] : [],
            userCount: Array.isArray(s.userIds) ? s.userIds.length : Number(s.userCount || 0)
        })),
        users: Array.isArray(r.users) ? [...r.users] : [],
        assignedUsers: Number(r.assignedUsers || 0),
        capacity: Number(r.capacity || r.vehicle?.capacity || 50)
    }));

    console.log("--- Initial State before Seating Balancing ---");
    balanced.forEach((r, idx) => {
        const excess = Math.max(0, r.assignedUsers - r.capacity);
        console.log(`  Route ${idx + 1} (${r.vehicleName || r.routeCode || 'R' + (idx+1)}): ${r.assignedUsers}/${r.capacity} seats (excess: ${excess})`);
    });

    // Pass 1: Vehicle Swap Optimization
    // If Route A has high demand and small bus, but Route B has low demand and large bus, swap!
    for (let i = 0; i < balanced.length; i++) {
        for (let j = i + 1; j < balanced.length; j++) {
            const rA = balanced[i];
            const rB = balanced[j];
            const excessA = Math.max(0, rA.assignedUsers - rA.capacity);
            const excessB = Math.max(0, rB.assignedUsers - rB.capacity);
            if (excessA === 0 && excessB === 0) continue;

            // Check if swapping vehicles reduces total excess
            const newExcessA = Math.max(0, rA.assignedUsers - rB.capacity);
            const newExcessB = Math.max(0, rB.assignedUsers - rA.capacity);
            if (newExcessA + newExcessB < excessA + excessB) {
                // If inward, check if vehicle starting places are acceptable
                console.log(`  [Swap] Swapping vehicles between Route ${i+1} (${rA.capacity}) and Route ${j+1} (${rB.capacity})`);
                const tempVeh = rA.vehicle;
                const tempVehId = rA.vehicleId;
                const tempVehName = rA.vehicleName;
                const tempCap = rA.capacity;

                rA.vehicle = rB.vehicle;
                rA.vehicleId = rB.vehicleId;
                rA.vehicleName = rB.vehicleName;
                rA.capacity = rB.capacity;

                rB.vehicle = tempVeh;
                rB.vehicleId = tempVehId;
                rB.vehicleName = tempVehName;
                rB.capacity = tempCap;
            }
        }
    }

    // Pass 2: Intra-Fleet Passenger Transfer
    let iterations = 0;
    while (iterations < 30) {
        iterations++;
        const overRoute = balanced.find((r) => r.assignedUsers > r.capacity);
        if (!overRoute) break;

        const excess = overRoute.assignedUsers - overRoute.capacity;
        let transferred = false;

        // Try stops from overRoute
        for (let sIdx = overRoute.stops.length - 1; sIdx >= 0; sIdx--) {
            const st = overRoute.stops[sIdx];
            if (!st || st.userCount === 0) continue;

            // Find compatible recipient routes with spare capacity
            const candidates = [];
            for (let tIdx = 0; tIdx < balanced.length; tIdx++) {
                const target = balanced[tIdx];
                if (target === overRoute) continue;
                const spare = target.capacity - target.assignedUsers;
                if (spare <= 0) continue;

                // Check distance to target stops
                let minD = Infinity;
                let isShared = false;
                for (const ts of target.stops) {
                    if (ts.name.trim().toLowerCase() === st.name.trim().toLowerCase()) {
                        isShared = true;
                        minD = 0;
                        break;
                    }
                    const d = calculateDistanceKm(st.latitude, st.longitude, ts.latitude, ts.longitude);
                    if (d < minD) minD = d;
                }

                // If not shared and > 6 km away, skip
                if (!isShared && minD > 6.0) continue;

                // Check corridor coherence
                const testStops = [...target.stops, st];
                if (!isShared && !isRouteCorridorCoherent(hub, testStops, 55.0, 6.0)) continue;

                candidates.push({ target, minD, spare, isShared });
            }

            if (candidates.length === 0) continue;

            // Sort: shared stops first, then lowest distance, then highest spare
            candidates.sort((a, b) => {
                if (a.isShared !== b.isShared) return b.isShared ? 1 : -1;
                return a.minD - b.minD || b.spare - a.spare;
            });

            const bestCandidate = candidates[0];
            const bestTarget = bestCandidate.target;
            const transferCount = Math.min(st.userCount, excess, bestTarget.capacity - bestTarget.assignedUsers);

            if (transferCount > 0) {
                // Execute transfer
                const transferredIds = st.userIds.splice(st.userIds.length - transferCount, transferCount);
                st.userCount -= transferCount;
                if (st.passengerCount !== undefined) st.passengerCount = st.userCount;

                overRoute.assignedUsers -= transferCount;
                overRoute.users = overRoute.users.filter((uid) => !transferredIds.includes(uid));

                bestTarget.assignedUsers += transferCount;
                bestTarget.users.push(...transferredIds);

                const existingTargetStop = bestTarget.stops.find(
                    (s) => s.name.trim().toLowerCase() === st.name.trim().toLowerCase()
                );
                if (existingTargetStop) {
                    existingTargetStop.userCount += transferCount;
                    if (existingTargetStop.passengerCount !== undefined) existingTargetStop.passengerCount = existingTargetStop.userCount;
                    if (!Array.isArray(existingTargetStop.userIds)) existingTargetStop.userIds = [];
                    existingTargetStop.userIds.push(...transferredIds);
                } else {
                    bestTarget.stops.push({
                        ...st,
                        userCount: transferCount,
                        passengerCount: transferCount,
                        userIds: transferredIds
                    });
                }

                if (st.userCount === 0) {
                    overRoute.stops.splice(sIdx, 1);
                }

                console.log(`  [Transfer round ${iterations}] Shifted ${transferCount}p of '${st.name}' from ${overRoute.vehicleName || 'OverRoute'} to ${bestTarget.vehicleName || 'TargetRoute'}`);
                transferred = true;
                break;
            }
        }

        if (!transferred) {
            console.log(`  Could not shift remaining excess from route!`);
            break;
        }
    }

    console.log("\n--- After Guaranteed Seating Balancing ---");
    let totalStanding = 0;
    balanced.forEach((r, idx) => {
        r.standingPassengers = Math.max(0, r.assignedUsers - r.capacity);
        r.seatedPassengers = Math.min(r.assignedUsers, r.capacity);
        r.overCapacityCount = r.standingPassengers;
        r.isOverCapacity = r.standingPassengers > 0;
        r.remainingSeats = Math.max(0, r.capacity - r.assignedUsers);
        totalStanding += r.standingPassengers;
        console.log(`  Route ${idx + 1} (${r.vehicleName}): ${r.assignedUsers}/${r.capacity} (standing: ${r.standingPassengers}) [${r.stops.map(s => `${s.name}(${s.userCount}p)`).join(" -> ")}]`);
    });
    console.log(`Total standing passengers across plan: ${totalStanding}`);

    return { balanced, totalStanding };
}

async function run() {
    await connectDB();
    const [allUsers, rawVehicles, schedules, startingPlaces] = await Promise.all([
        mongoose.connection.db.collection("users").find({}).toArray(),
        mongoose.connection.db.collection("vehicles").find({}).toArray(),
        mongoose.connection.db.collection("schedules").find({}).toArray(),
        InwardStartingPlace.find({ active: true }).lean()
    ]);
    const users = getManagedUsers(allUsers);
    const { uniqueUsers: confirmedUsers } = deduplicateUsers(getConfirmedUsers(users));
    const rawGroups = calculateStoppingGroups(confirmedUsers);
    const groups = await resolveStopCoordinates(rawGroups, DEFAULT_SOURCE_HUB);
    const resolvedStops = groups.filter(s => s.latitude && s.longitude);

    const matrix = await buildGlobalOptimizationMatrix({
        depot: DEFAULT_SOURCE_HUB,
        stops: resolvedStops
    });

    let candRoutes = generateGlobalCandidateRoutes({
        stops: resolvedStops,
        matrix,
        maxBusCapacity: 65,
        tripMode: "TO_DESTINATION"
    });

    if (candRoutes.length < 8) {
        candRoutes = expandCandidateRoutesToTarget({
            routes: candRoutes,
            targetRouteCount: 8,
            matrix,
            tripMode: "TO_DESTINATION",
            auditTrail: []
        });
    }

    const availableVehicles = (rawVehicles || []).filter(v => v.isActive !== false && v.capacity > 0);
    // Assign vehicles
    const { assignedRoutes } = assignVehiclesToOptimizedRoutes({
        routes: candRoutes,
        availableVehicles,
        tripMode: "TO_DESTINATION",
        activeInwardStartingPlaces: startingPlaces
    });

    balanceRoutesToGuaranteedSeating({
        routes: assignedRoutes,
        availableVehicles,
        matrix,
        hub: DEFAULT_SOURCE_HUB,
        tripMode: "TO_DESTINATION",
        activeInwardStartingPlaces: startingPlaces
    });

    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
