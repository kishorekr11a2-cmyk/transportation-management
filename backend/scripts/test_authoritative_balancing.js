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
    calculateDistanceKm,
    calculateBearing,
    getBearingDifference
} from "../services/aiAgentService.js";
import {
    buildGlobalOptimizationMatrix,
    generateGlobalCandidateRoutes,
    assignVehiclesToOptimizedRoutes,
    sequenceOutwardRouteStops,
    sequenceInwardRouteStops,
    optimizeTour2OptRoad,
    isRouteCorridorCoherent
} from "../services/routeOptimizationService.js";
import { DEFAULT_SOURCE_HUB } from "../services/mapGeocodingService.js";
import InwardStartingPlace from "../models/InwardStartingPlace.js";

function balanceRoutesToCapacities({ routes, targetCapacities, matrix, hub, tripMode = "FROM_SOURCE" }) {
    // Clone routes
    const balanced = routes.map(r => ({
        ...r,
        stops: r.stops.map(s => ({ ...s, userIds: [...(s.userIds || [])] })),
        users: [...(r.users || [])],
        assignedUsers: r.assignedUsers
    }));

    // Assign target capacities to routes
    // Sort routes by demand desc, pair with target capacities desc
    balanced.sort((a, b) => b.assignedUsers - a.assignedUsers);
    balanced.forEach((r, i) => {
        r.capacity = targetCapacities[i];
    });

    console.log("Before balancing:");
    balanced.forEach((r, i) => {
        console.log(`  Route ${i+1}: ${r.assignedUsers}/${r.capacity} (excess: ${Math.max(0, r.assignedUsers - r.capacity)})`);
    });

    let iterations = 0;
    while (iterations < 20) {
        iterations++;
        // Find route with highest excess
        const overRoute = balanced.find(r => r.assignedUsers > r.capacity);
        if (!overRoute) break;

        const excess = overRoute.assignedUsers - overRoute.capacity;
        let shifted = false;

        // Try to shift excess passengers from a stop on overRoute to a recipient route with spare seats
        for (let sIdx = overRoute.stops.length - 1; sIdx >= 0; sIdx--) {
            const st = overRoute.stops[sIdx];
            if (!st || st.userCount === 0) continue;

            // Find best recipient route with spare capacity that is geographically compatible
            const candidates = [];
            for (let tIdx = 0; tIdx < balanced.length; tIdx++) {
                const target = balanced[tIdx];
                if (target === overRoute) continue;
                const spare = target.capacity - target.assignedUsers;
                if (spare <= 0) continue;

                // Check distance to target route's stops
                const minD = Math.min(...target.stops.map(ts => calculateDistanceKm(st.latitude, st.longitude, ts.latitude, ts.longitude)));
                if (minD > 5.5) continue;

                // Check corridor coherence from hub
                const targetStopsWithCandidate = [...target.stops, st];
                if (!isRouteCorridorCoherent(hub, targetStopsWithCandidate, 45.0, 5.5)) continue;

                candidates.push({ target, minD, spare });
            }

            if (candidates.length === 0) continue;
            candidates.sort((a, b) => a.minD - b.minD);
            const bestTarget = candidates[0].target;
            const transferCount = Math.min(st.userCount, excess, bestTarget.capacity - bestTarget.assignedUsers);

            if (transferCount > 0) {
                // Transfer userIds
                const transferredIds = st.userIds.splice(st.userIds.length - transferCount, transferCount);
                st.userCount -= transferCount;
                overRoute.assignedUsers -= transferCount;
                overRoute.users = overRoute.users.filter(uid => !transferredIds.includes(uid));

                // Add to bestTarget
                bestTarget.assignedUsers += transferCount;
                bestTarget.users.push(...transferredIds);

                const existingTargetStop = bestTarget.stops.find(s => s.name.toLowerCase().trim() === st.name.toLowerCase().trim());
                if (existingTargetStop) {
                    existingTargetStop.userCount += transferCount;
                    existingTargetStop.userIds.push(...transferredIds);
                } else {
                    bestTarget.stops.push({
                        ...st,
                        userCount: transferCount,
                        userIds: transferredIds
                    });
                }

                // If stop on overRoute has 0 users left, remove it
                if (st.userCount === 0) {
                    overRoute.stops.splice(sIdx, 1);
                }

                console.log(`  [Pass ${iterations}] Transferred ${transferCount}p of '${st.name}' from ${overRoute.routeId || 'overRoute'} to ${bestTarget.routeId || 'targetRoute'}`);
                shifted = true;
                break;
            }
        }

        if (!shifted) {
            console.log(`  Could not shift remaining excess ${excess} from route!`);
            break;
        }
    }

    console.log("\nAfter balancing:");
    let totalStanding = 0;
    balanced.forEach((r, i) => {
        const standing = Math.max(0, r.assignedUsers - r.capacity);
        totalStanding += standing;
        console.log(`  Route ${i+1}: ${r.assignedUsers}/${r.capacity} (${standing} standing) [${r.stops.map(s => `${s.name}(${s.userCount}p)`).join(" -> ")}]`);
    });
    console.log("Total standing passengers:", totalStanding);
    return { balanced, totalStanding };
}

async function run() {
    await connectDB();
    const [allUsers, rawVehicles, schedules] = await Promise.all([
        mongoose.connection.db.collection("users").find({}).toArray(),
        mongoose.connection.db.collection("vehicles").find({}).toArray(),
        mongoose.connection.db.collection("schedules").find({}).toArray()
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

    const candRoutes = generateGlobalCandidateRoutes({
        stops: resolvedStops,
        matrix,
        maxBusCapacity: 65,
        tripMode: "FROM_SOURCE"
    });

    const targetCapacities = [65, 60, 55, 55, 50, 50, 50, 50];
    balanceRoutesToCapacities({
        routes: candRoutes,
        targetCapacities,
        matrix,
        hub: DEFAULT_SOURCE_HUB,
        tripMode: "FROM_SOURCE"
    });

    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
