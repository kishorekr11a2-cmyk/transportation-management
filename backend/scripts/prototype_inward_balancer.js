import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import InwardStartingPlace from "../models/InwardStartingPlace.js";
import {
    getManagedUsers,
    getConfirmedUsers,
    deduplicateUsers,
    calculateStoppingGroups,
    resolveStopCoordinates,
    buildAIPlan,
    validateTransportationPlan,
    calculateDistanceKm,
    findStartingPlaceForBus,
    validateRouteCorridorContinuity
} from "../services/aiAgentService.js";
import {
    isRouteCorridorCoherent,
    sequenceInwardRouteStops
} from "../services/routeOptimizationService.js";
import { DEFAULT_SOURCE_HUB } from "../services/mapGeocodingService.js";

function evalInwardTourContinuity(stops, bus, destinationHub, activeInwardStartingPlaces) {
    const sp = findStartingPlaceForBus(bus.vehicle || bus, activeInwardStartingPlaces) ||
               bus.startLocation || bus.inwardStartLocation || stops[0];
    const seq = sequenceInwardRouteStops({
        startingHub: sp,
        destinationHub,
        stops,
        tripMode: "TO_DESTINATION"
    });
    const qv = seq.qualityValidation || {};
    const isCont = Boolean(
        (qv.directionalReversals || 0) === 0 &&
        (qv.backtrackingDistanceKm || 0) < 2.0 &&
        (qv.detourRatio || 1.0) <= 2.25 &&
        !qv.startingHubRepeatedAfterDeparture
    );
    return {
        isContinuous: isCont,
        orderedStops: seq.stops,
        detourRatio: qv.detourRatio || 1.25
    };
}

function balanceInwardUnallocatedPassengers({
    routes = [],
    unallocatedPassengers = [],
    destinationHub = DEFAULT_SOURCE_HUB,
    activeInwardStartingPlaces = [],
    matrix = null,
    auditTrail = []
}) {
    if (!Array.isArray(routes) || routes.length === 0 || !Array.isArray(unallocatedPassengers) || unallocatedPassengers.length === 0) {
        return { routes, unallocatedPassengers };
    }

    const currentRoutes = routes.map(r => ({
        ...r,
        stops: (r.stops || []).map(s => ({
            ...s,
            userIds: Array.isArray(s.userIds) ? [...s.userIds] : [],
            userCount: Array.isArray(s.userIds) ? s.userIds.length : Number(s.userCount || 0)
        })),
        users: Array.isArray(r.users) ? [...r.users] : [],
        assignedUsers: Number(r.assignedUsers || 0),
        capacity: Number(r.capacity || r.vehicle?.capacity || 50)
    }));

    let remainingUnallocated = [...unallocatedPassengers];

    // Group unallocated by stop
    const unallocByStop = new Map();
    remainingUnallocated.forEach(u => {
        const sName = u.stoppingArea;
        if (!unallocByStop.has(sName)) unallocByStop.set(sName, []);
        unallocByStop.get(sName).push(u);
    });

    for (const [stopName, uGroup] of unallocByStop.entries()) {
        let remainingPax = uGroup.length;
        let remainingIds = uGroup.map(u => String(u.userId));
        const firstU = uGroup[0];
        const stopLat = firstU.latitude;
        const stopLon = firstU.longitude;

        console.log(`\nAttempting to balance unallocated stop: '${stopName}' (${remainingPax} passengers)...`);

        // Check if there is a primary host bus whose configured starting hub is stopName
        const matchingHubRoute = currentRoutes.find(r => {
            const sp = findStartingPlaceForBus(r.vehicle || r, activeInwardStartingPlaces);
            return sp && (
                sp.name?.toLowerCase().includes(stopName.toLowerCase()) ||
                stopName.toLowerCase().includes(sp.name?.toLowerCase()) ||
                calculateDistanceKm(sp.latitude, sp.longitude, stopLat, stopLon) <= 3.5
            );
        });

        // If a bus starts at this stop, prioritize freeing capacity on THAT bus!
        if (matchingHubRoute) {
            console.log(`  Found matching starting hub bus for '${stopName}': ${matchingHubRoute.vehicleName} (capacity: ${matchingHubRoute.capacity}, assigned: ${matchingHubRoute.assignedUsers})`);
            const host = matchingHubRoute;
            let hostSpare = host.capacity - host.assignedUsers;
            let needed = remainingPax - hostSpare;

            if (needed > 0) {
                console.log(`  Host '${host.vehicleName}' needs ${needed} seats freed. Searching donor transfers...`);

                // Find stops on host that can be shifted to other routes with spare capacity
                for (let sIdx = host.stops.length - 1; sIdx >= 0 && needed > 0; sIdx--) {
                    const hostStop = host.stops[sIdx];
                    if (!hostStop) continue;

                    // Sort recipient routes: routes already containing hostStop first, then closest corridor
                    const eligibleRecipients = currentRoutes
                        .filter(r => r !== host && (r.capacity - r.assignedUsers) > 0)
                        .sort((a, b) => {
                            const aHasStop = a.stops.some(s => s.name?.toLowerCase() === hostStop.name?.toLowerCase()) ? 1 : 0;
                            const bHasStop = b.stops.some(s => s.name?.toLowerCase() === hostStop.name?.toLowerCase()) ? 1 : 0;
                            if (aHasStop !== bHasStop) return bHasStop - aHasStop;

                            // Distance to nearest stop in recipient
                            const aDist = Math.min(...(a.stops || []).map(s => calculateDistanceKm(hostStop.latitude, hostStop.longitude, s.latitude, s.longitude)));
                            const bDist = Math.min(...(b.stops || []).map(s => calculateDistanceKm(hostStop.latitude, hostStop.longitude, s.latitude, s.longitude)));
                            return aDist - bDist;
                        });

                    for (const recipient of eligibleRecipients) {
                        const currentHostStopPax = (hostStop.userIds || []).length;
                        if (currentHostStopPax <= 0) break;

                        const recipSpare = recipient.capacity - recipient.assignedUsers;
                        if (recipSpare <= 0) continue;

                        const shiftCount = Math.min(recipSpare, needed, currentHostStopPax);
                        const shiftIds = (hostStop.userIds || []).slice(hostStop.userIds.length - shiftCount);

                        const shiftedStopPart = {
                            ...hostStop,
                            userCount: shiftCount,
                            passengerCount: shiftCount,
                            userIds: shiftIds
                        };

                        const recipientHasStop = recipient.stops.some(s => s.name?.toLowerCase() === hostStop.name?.toLowerCase());
                        let recipientCanAbsorb = false;
                        let bestRecipTour = null;

                        if (recipientHasStop) {
                            const mergedTour = recipient.stops.map(s => {
                                if (s.name?.toLowerCase() === hostStop.name?.toLowerCase()) {
                                    return {
                                        ...s,
                                        userCount: (s.userCount || 0) + shiftCount,
                                        passengerCount: (s.passengerCount || 0) + shiftCount,
                                        userIds: [...(s.userIds || []), ...shiftIds]
                                    };
                                }
                                return s;
                            });
                            const rEval = evalInwardTourContinuity(mergedTour, recipient, destinationHub, activeInwardStartingPlaces);
                            if (rEval.isContinuous) {
                                recipientCanAbsorb = true;
                                bestRecipTour = rEval.orderedStops;
                            }
                        } else {
                            // Test insertion at all positions
                            for (let p = 0; p <= recipient.stops.length; p++) {
                                const testTour = [
                                    ...recipient.stops.slice(0, p),
                                    shiftedStopPart,
                                    ...recipient.stops.slice(p)
                                ];
                                const rEval = evalInwardTourContinuity(testTour, recipient, destinationHub, activeInwardStartingPlaces);
                                if (rEval.isContinuous) {
                                    recipientCanAbsorb = true;
                                    bestRecipTour = rEval.orderedStops;
                                    break;
                                }
                            }
                        }

                        if (recipientCanAbsorb && bestRecipTour) {
                            recipient.stops = bestRecipTour;
                            recipient.assignedUsers = recipient.stops.reduce((sum, s) => sum + (s.userCount || 0), 0);
                            recipient.users = recipient.stops.flatMap(s => s.userIds || []);

                            hostStop.userIds.splice(hostStop.userIds.length - shiftCount, shiftCount);
                            hostStop.userCount = hostStop.userIds.length;
                            hostStop.passengerCount = hostStop.userCount;

                            const shiftSet = new Set(shiftIds);
                            host.users = host.users.filter(uid => !shiftSet.has(String(uid)));
                            host.assignedUsers = host.stops.reduce((sum, s) => sum + (s.userCount || 0), 0);

                            needed -= shiftCount;
                            hostSpare += shiftCount;
                            console.log(`    Transferred ${shiftCount} pax of '${hostStop.name}' from host '${host.vehicleName}' to recipient '${recipient.vehicleName}' (freed ${shiftCount} seats, host now ${host.assignedUsers}/${host.capacity})`);

                            if (hostStop.userCount === 0) {
                                host.stops = host.stops.filter((_, idx) => idx !== sIdx);
                            }

                            if (needed <= 0) break;
                        }
                    }
                }
            }

            // Now insert stopName at position 0 of host (as it is its starting hub)
            const availableOnHost = Math.min(host.capacity - host.assignedUsers, remainingPax);
            if (availableOnHost > 0) {
                const allocIds = remainingIds.slice(0, availableOnHost);
                const testStopForHost = {
                    name: stopName,
                    latitude: stopLat,
                    longitude: stopLon,
                    userCount: availableOnHost,
                    passengerCount: availableOnHost,
                    userIds: allocIds
                };

                const testTour = [testStopForHost, ...host.stops];
                const hEval = evalInwardTourContinuity(testTour, host, destinationHub, activeInwardStartingPlaces);
                if (hEval.isContinuous) {
                    host.stops = hEval.orderedStops;
                    host.assignedUsers += availableOnHost;
                    host.users.push(...allocIds);

                    const allocatedSet = new Set(allocIds);
                    remainingUnallocated = remainingUnallocated.filter(u => !allocatedSet.has(String(u.userId)));

                    remainingPax -= availableOnHost;
                    remainingIds.splice(0, availableOnHost);
                    console.log(`  Successfully inserted ${availableOnHost} pax of '${stopName}' into host '${host.vehicleName}'!`);
                } else {
                    console.log(`  Warning: Insertion of '${stopName}' into host '${host.vehicleName}' failed continuity evaluation.`);
                }
            }
        }

        // Phase 1: Try direct continuous insertion into any route with spare capacity and corridor coherence
        if (remainingPax > 0) {
            for (const r of currentRoutes) {
                const spare = r.capacity - r.assignedUsers;
                if (spare <= 0) continue;

                // Stop must be reasonably close to route stops or route starting hub
                const refPoints = [...(r.stops || [])];
                const rStart = findStartingPlaceForBus(r.vehicle || r, activeInwardStartingPlaces) || r.startLocation;
                if (rStart && isValidCoordinate(rStart.latitude, rStart.longitude)) {
                    refPoints.push(rStart);
                }
                const minRefDist = Math.min(...refPoints.map(p => calculateDistanceKm(stopLat, stopLon, p.latitude, p.longitude)));
                if (minRefDist > 4.75) continue;

                const allocCount = Math.min(spare, remainingPax);
                const testIds = remainingIds.slice(0, allocCount);
                const candStop = {
                    name: stopName,
                    latitude: stopLat,
                    longitude: stopLon,
                    userCount: allocCount,
                    passengerCount: allocCount,
                    userIds: testIds
                };

                const candTours = [];
                for (let p = 0; p <= r.stops.length; p++) {
                    candTours.push([
                        ...r.stops.slice(0, p),
                        candStop,
                        ...r.stops.slice(p)
                    ]);
                }

                for (const cTour of candTours) {
                    const cEval = evalInwardTourContinuity(cTour, r, destinationHub, activeInwardStartingPlaces);
                    if (cEval.isContinuous) {
                        r.stops = cEval.orderedStops;
                        r.assignedUsers += allocCount;
                        r.users.push(...testIds);

                        const allocatedSet = new Set(testIds);
                        remainingUnallocated = remainingUnallocated.filter(u => !allocatedSet.has(String(u.userId)));

                        remainingPax -= allocCount;
                        remainingIds.splice(0, allocCount);
                        console.log(`  Phase 1 Direct: absorbed ${allocCount} pax into ${r.vehicleName}`);
                        break;
                    }
                }
                if (remainingPax <= 0) break;
            }
        }
    }

    // Standardize all modified routes
    for (const route of currentRoutes) {
        const sp = findStartingPlaceForBus(route.vehicle || route, activeInwardStartingPlaces) ||
                   route.startLocation || route.inwardStartLocation || route.stops[0];

        (route.stops || []).forEach((st, sIdx) => {
            st.order = sIdx + 1;
            st.sequence = sIdx + 1;
            if (sIdx === 0) {
                st.previousStopName = sp?.name || "Pickup Origin";
            } else {
                st.previousStopName = route.stops[sIdx - 1].name;
            }
            const count = Array.isArray(st.userIds) ? st.userIds.length : Number(st.userCount || 0);
            st.userCount = count;
            st.passengerCount = count;
            st.passengerUserIds = st.userIds;
        });

        route.assignedUsers = (route.stops || []).reduce((s, st) => s + (st.userCount || 0), 0);
        route.passengerCount = route.assignedUsers;
        route.users = (route.stops || []).flatMap(st => st.userIds || []);
        route.passengerUserIds = route.users;
        route.remainingSeats = Math.max(0, route.capacity - route.assignedUsers);
        route.unusedSeats = route.remainingSeats;
        route.seatedPassengers = route.assignedUsers;
        route.standingPassengers = 0;
        route.isOverCapacity = false;
        route.overCapacityCount = 0;
    }

    return {
        routes: currentRoutes,
        unallocatedPassengers: remainingUnallocated
    };
}

async function main() {
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

    console.log("Generating initial inward plan...");
    const plan = await buildAIPlan({
        sourceHub: DEFAULT_SOURCE_HUB,
        destinationHub: DEFAULT_SOURCE_HUB,
        tripMode: "TO_DESTINATION",
        resolvedStops,
        availableVehicles: rawVehicles,
        rawVehicles,
        totalComingUsers: confirmedUsers.length,
        allUsersCount: confirmedUsers.length,
        totalAvailableCapacity: 435,
        physicalFleetCapacity: 435,
        confirmedUsers,
        activeInwardStartingPlaces: startingPlaces
    });

    console.log(`Initial plan: assigned=${plan.assignedUsers}/${confirmedUsers.length}, unassigned=${plan.unassignedUsers || 0}`);
    console.log("Unallocated list:", (plan.unallocatedPassengers || []).map(u => u.stoppingArea));

    if (plan.unallocatedPassengers && plan.unallocatedPassengers.length > 0) {
        console.log("\n>>> RUNNING INWARD POST-CONTINUITY BALANCER <<<");
        const balanceResult = balanceInwardUnallocatedPassengers({
            routes: plan.buses,
            unallocatedPassengers: plan.unallocatedPassengers,
            destinationHub: DEFAULT_SOURCE_HUB,
            activeInwardStartingPlaces: startingPlaces
        });

        console.log(`\nPost-balancer unallocated count: ${balanceResult.unallocatedPassengers.length}`);
        const totalAssigned = balanceResult.routes.reduce((s, b) => s + b.assignedUsers, 0);
        console.log(`Post-balancer total assigned: ${totalAssigned}/${confirmedUsers.length}`);

        balanceResult.routes.forEach((b, idx) => {
            const spare = b.capacity - b.assignedUsers;
            console.log(`  [R-${String(idx+1).padStart(2,'0')}] ${b.vehicleName} (${b.capacity} seats, ${b.assignedUsers} pax, ${spare} spare):`);
            console.log(`      Stops: ${b.stops.map(s => `${s.name}(${s.userCount}p)`).join(" -> ")}`);
        });

        console.log("\n>>> VALIDATING POST-BALANCED PLAN <<<");
        const cert = validateTransportationPlan({
            buses: balanceResult.routes,
            unassignedUsers: balanceResult.unallocatedPassengers.length
        }, {
            destinationHub: DEFAULT_SOURCE_HUB,
            sourceHub: DEFAULT_SOURCE_HUB,
            tripMode: "TO_DESTINATION",
            totalComingUsers: confirmedUsers.length,
            totalAvailableCapacity: 435,
            availableVehicles: rawVehicles,
            activeInwardStartingPlaces: startingPlaces
        });

        console.log(`Validation result: isCertified=${cert.isCertified}, status=${cert.status}, failures:`, cert.failureReasons);
    }

    process.exit(0);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
