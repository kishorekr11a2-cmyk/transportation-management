import dotenv from 'dotenv';
dotenv.config();
import connectDB from '../config/db.js';
import { getAIData, resolveStopCoordinates } from '../services/aiAgentService.js';
import {
    buildGlobalOptimizationMatrix,
    generateGlobalCandidateRoutes,
    consolidateSmallPassengerRoutes,
    assignVehiclesToOptimizedRoutes,
    sequenceOutwardRouteStops,
    optimizeTour2OptRoad,
    isCandidateDemandCompatibleWithFleetProfile,
    insertStopNearestCost
} from '../services/routeOptimizationService.js';

function consolidateCandidateRoutesWithFleet({
    routes = [],
    targetRouteCount = 9,
    maxBusCapacity = 62,
    fleetCapacities = null,
    matrix,
    tripMode = "FROM_SOURCE"
}) {
    if (!Array.isArray(routes) || routes.length <= targetRouteCount) return routes;

    const effectiveFleetCaps = Array.isArray(fleetCapacities) && fleetCapacities.length > 0
        ? fleetCapacities.sort((a,b) => b-a)
        : null;

    let currentRoutes = routes.map((r) => ({
        ...r,
        stops: (r.stops || []).map((s) => ({
            ...s,
            userIds: Array.isArray(s.userIds) ? [...s.userIds] : []
        })),
        users: Array.isArray(r.users) ? [...r.users] : []
    }));

    let rounds = 0;
    while (currentRoutes.length > targetRouteCount && rounds < 20) {
        rounds++;
        currentRoutes.sort((a, b) => a.assignedUsers - b.assignedUsers);
        const smallestRoute = currentRoutes[0];
        let allStopsAbsorbed = true;

        for (const stop of smallestRoute.stops) {
            const stopPax = stop.passengerCount || stop.userCount || stop.userIds?.length || 0;
            const otherRoutes = currentRoutes.filter((r) => r.routeId !== smallestRoute.routeId);

            // Viable routes respecting maxBusCapacity AND fleet profile
            let viableRoutes = otherRoutes.filter((r) => {
                if (r.assignedUsers + stopPax > maxBusCapacity) return false;
                if (effectiveFleetCaps) {
                    const prospectiveDemands = currentRoutes.map((cr) => {
                        if (cr.routeId === r.routeId) return cr.assignedUsers + stopPax;
                        if (cr.routeId === smallestRoute.routeId) return Math.max(0, cr.assignedUsers - stopPax);
                        return cr.assignedUsers;
                    });
                    if (!isCandidateDemandCompatibleWithFleetProfile(prospectiveDemands, effectiveFleetCaps)) {
                        return false;
                    }
                }
                return true;
            });

            // If no viable route strictly satisfies fleet profile, relax to maxBusCapacity
            if (viableRoutes.length === 0) {
                viableRoutes = otherRoutes.filter((r) => r.assignedUsers + stopPax <= maxBusCapacity);
            }

            if (viableRoutes.length > 0) {
                let bestTarget = null;
                let minDelta = Infinity;
                let bestInsert = null;

                for (const target of viableRoutes) {
                    const insRes = insertStopNearestCost({
                        tour: target.stops,
                        stop,
                        stopMatrixIndex: stop.matrixIndex,
                        matrix,
                        tripMode
                    });
                    if (insRes.costDelta < minDelta) {
                        minDelta = insRes.costDelta;
                        bestTarget = target;
                        bestInsert = insRes;
                    }
                }

                if (bestTarget && bestInsert) {
                    bestTarget.stops = bestInsert.updatedTour;
                    bestTarget.assignedUsers += stopPax;
                    bestTarget.users.push(...(stop.userIds || []));
                    continue;
                }
            }
            allStopsAbsorbed = false;
            break;
        }

        if (allStopsAbsorbed) {
            currentRoutes = currentRoutes.filter((r) => r.routeId !== smallestRoute.routeId);
        } else {
            break;
        }
    }

    return currentRoutes;
}

async function main() {
    await connectDB();
    const aiData = await getAIData({ forceRefresh: true });
    const resolvedStops = await resolveStopCoordinates(aiData.stops);
    const availableVehicles = aiData.availableVehicles;
    const anchorHub = { name: "K.L.N. College of Engineering", latitude: 9.8324, longitude: 78.1884 };
    const matrix = await buildGlobalOptimizationMatrix({ depot: anchorHub, stops: resolvedStops, options: {} });

    const sortedFleetDesc = [...availableVehicles]
        .filter((v) => v.isActive !== false && Number(v.capacity || v.seatCapacity || 0) > 0)
        .sort((a, b) => Number(b.capacity || b.seatCapacity || 0) - Number(a.capacity || a.seatCapacity || 0));

    const K = 9;
    const candidateFleetForK = sortedFleetDesc.slice(0, K);

    let candidateRoutes = generateGlobalCandidateRoutes({
        stops: resolvedStops,
        matrix,
        maxBusCapacity: 62,
        fleetCapacities: candidateFleetForK.map(v => v.capacity),
        tripMode: 'FROM_SOURCE',
        options: {}
    });

    candidateRoutes = consolidateSmallPassengerRoutes({
        routes: candidateRoutes,
        matrix,
        maxBusCapacity: 62,
        fleetCapacities: candidateFleetForK.map(v => v.capacity),
        tripMode: 'FROM_SOURCE',
        smallRouteThreshold: 15,
        activeInwardStartingPlaces: [],
        anchorHub,
        sourceHub: anchorHub,
        destinationHub: anchorHub,
        auditTrail: []
    });

    console.log(`Routes before consolidateCandidateRoutesWithFleet (${candidateRoutes.length}):`, candidateRoutes.map(r => r.assignedUsers));

    const consolidated = consolidateCandidateRoutesWithFleet({
        routes: candidateRoutes,
        targetRouteCount: 9,
        maxBusCapacity: 62,
        fleetCapacities: candidateFleetForK.map(v => v.capacity),
        matrix,
        tripMode: 'FROM_SOURCE'
    });

    console.log(`Routes after consolidateCandidateRoutesWithFleet (${consolidated.length}):`, consolidated.map(r => r.assignedUsers).sort((a,b) => b-a));
    console.log(`Fleet capacities (${candidateFleetForK.length}):`, candidateFleetForK.map(v => v.capacity));

    const assignRes = assignVehiclesToOptimizedRoutes({
        routes: consolidated,
        availableVehicles: candidateFleetForK,
        tripMode: 'FROM_SOURCE'
    });

    console.log(`\nassignVehiclesToOptimizedRoutes result: assigned=${assignRes.assignedRoutes.length}, unassigned=${assignRes.unassignedRoutes.length}`);
    assignRes.assignedRoutes.forEach(r => {
        console.log(`  ${r.vehicleName} (cap ${r.capacity}): ${r.assignedUsers} pax, stops: ${r.stops.map(s => s.name).join(' -> ')}`);
    });
    console.log('Total assigned:', assignRes.assignedRoutes.reduce((s, r) => s + r.assignedUsers, 0));

    process.exit(0);
}

main().catch(console.error);
