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
    optimizeTour2OptRoad
} from '../services/routeOptimizationService.js';

function balanceRoutesToFleetCaps({ routes, fleet, matrix, anchorHub, tripMode = 'FROM_SOURCE' }) {
    const isOutward = tripMode === 'FROM_SOURCE' || tripMode === 'OUTWARD';
    const sortedFleetCaps = [...fleet]
        .map(v => Number(v.capacity || v.seatCapacity || 70))
        .sort((a, b) => b - a);

    const K = sortedFleetCaps.length;
    let currentRoutes = routes.map(r => ({
        ...r,
        stops: [...r.stops],
        users: [...r.users]
    }));

    const checkFeasible = (rList) => {
        const sorted = [...rList].sort((a, b) => b.assignedUsers - a.assignedUsers);
        for (let i = 0; i < sorted.length; i++) {
            const cap = i < sortedFleetCaps.length ? sortedFleetCaps[i] : sortedFleetCaps[sortedFleetCaps.length - 1];
            if (sorted[i].assignedUsers > cap) return false;
        }
        return true;
    };

    if (checkFeasible(currentRoutes)) {
        return currentRoutes;
    }

    let iterations = 0;
    const maxIterations = 25;

    while (!checkFeasible(currentRoutes) && iterations < maxIterations) {
        iterations++;
        // Sort routes descending by demand
        currentRoutes.sort((a, b) => b.assignedUsers - a.assignedUsers);

        // Find first route that exceeds its fleet capacity slot
        let violIdx = -1;
        for (let i = 0; i < currentRoutes.length; i++) {
            const cap = i < sortedFleetCaps.length ? sortedFleetCaps[i] : sortedFleetCaps[sortedFleetCaps.length - 1];
            if (currentRoutes[i].assignedUsers > cap) {
                violIdx = i;
                break;
            }
        }

        if (violIdx === -1) break;

        const violRoute = currentRoutes[violIdx];
        const violCap = violIdx < sortedFleetCaps.length ? sortedFleetCaps[violIdx] : sortedFleetCaps[sortedFleetCaps.length - 1];
        const excess = violRoute.assignedUsers - violCap;

        let bestMove = null;
        let bestScore = -Infinity;

        // Try moving stops from violRoute to other routes
        for (let sIdx = 0; sIdx < violRoute.stops.length; sIdx++) {
            const stop = violRoute.stops[sIdx];
            const stopPax = Array.isArray(stop.userIds) ? stop.userIds.length : Number(stop.userCount || 0);
            if (stopPax <= 0) continue;

            for (let tIdx = 0; tIdx < currentRoutes.length; tIdx++) {
                if (tIdx === violIdx) continue;
                const targetRoute = currentRoutes[tIdx];

                // What is target's allowed cap?
                // Target must not exceed its slot when routes are resorted
                // Generous test: target + stopPax <= maxFleetCap (62) AND prospective set is more feasible
                const prospectiveDemands = currentRoutes.map((r, idx) => {
                    if (idx === violIdx) return r.assignedUsers - stopPax;
                    if (idx === tIdx) return r.assignedUsers + stopPax;
                    return r.assignedUsers;
                }).sort((a, b) => b - a);

                // Compute prospective violation count and total excess
                let violCount = 0;
                let totalExcess = 0;
                for (let k = 0; k < prospectiveDemands.length; k++) {
                    const c = k < sortedFleetCaps.length ? sortedFleetCaps[k] : sortedFleetCaps[sortedFleetCaps.length - 1];
                    if (prospectiveDemands[k] > c) {
                        violCount++;
                        totalExcess += (prospectiveDemands[k] - c);
                    }
                }

                // Current total excess:
                let curExcess = 0;
                const curDemands = currentRoutes.map(r => r.assignedUsers).sort((a, b) => b - a);
                for (let k = 0; k < curDemands.length; k++) {
                    const c = k < sortedFleetCaps.length ? sortedFleetCaps[k] : sortedFleetCaps[sortedFleetCaps.length - 1];
                    if (curDemands[k] > c) curExcess += (curDemands[k] - c);
                }

                if (totalExcess >= curExcess) {
                    continue; // Must strictly reduce overall fleet excess
                }

                // Check road progression
                const testTour = [...targetRoute.stops, stop];
                const optRes = optimizeTour2OptRoad({ tour: testTour, matrix, tripMode });
                const seqRes = sequenceOutwardRouteStops({ departureHub: anchorHub, stops: optRes.tour, matrix, tripMode });

                const qv = seqRes.qualityValidation || {};
                if (qv.directionalReversals > 0) continue;
                if ((qv.detourRatio || 1.0) > 2.25) continue;
                if (qv.operationalContinuityVerified === false) continue;

                const score = (curExcess - totalExcess) * 1000 - (seqRes.routeDistanceKm || 0);
                if (score > bestScore) {
                    bestScore = score;
                    bestMove = {
                        sIdx,
                        stop,
                        stopPax,
                        targetRoute,
                        newTour: seqRes.stops,
                        newDist: seqRes.routeDistanceKm,
                        qv
                    };
                }
            }
        }

        if (bestMove) {
            const stop = violRoute.stops[bestMove.sIdx];
            const stopPax = bestMove.stopPax;
            const userIdsToMove = Array.isArray(stop.userIds) ? [...stop.userIds] : [];

            violRoute.stops.splice(bestMove.sIdx, 1);
            violRoute.assignedUsers -= stopPax;
            violRoute.users = violRoute.users.filter(uid => !userIdsToMove.includes(uid));

            bestMove.targetRoute.stops = bestMove.newTour;
            bestMove.targetRoute.assignedUsers += stopPax;
            bestMove.targetRoute.users.push(...userIdsToMove);
            bestMove.targetRoute.routeDistanceKm = bestMove.newDist;
            bestMove.targetRoute.qualityValidation = bestMove.qv;

            // Re-optimize violRoute tour
            const optV = optimizeTour2OptRoad({ tour: violRoute.stops, matrix, tripMode });
            const seqV = sequenceOutwardRouteStops({ departureHub: anchorHub, stops: optV.tour, matrix, tripMode });
            violRoute.stops = seqV.stops;
            violRoute.routeDistanceKm = seqV.routeDistanceKm;
            violRoute.qualityValidation = seqV.qualityValidation;

            console.log(`[BALANCER] Iter ${iterations}: Moved '${stop.name}' (${stopPax} pax) from violRoute to target. New demands:`, currentRoutes.map(r => r.assignedUsers).sort((a,b) => b-a));
        } else {
            console.log(`[BALANCER] Iter ${iterations}: No valid move found for violRoute ${violIdx} (excess=${excess})`);
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

    console.log('Demands before robust balancer:', candidateRoutes.map(r => r.assignedUsers).sort((a, b) => b - a));

    const balanced = balanceRoutesToFleetCaps({
        routes: candidateRoutes,
        fleet: candidateFleetForK,
        matrix,
        anchorHub,
        tripMode: 'FROM_SOURCE'
    });

    console.log('Demands after robust balancer:', balanced.map(r => r.assignedUsers).sort((a, b) => b - a));

    const assignRes = assignVehiclesToOptimizedRoutes({
        routes: balanced,
        availableVehicles: candidateFleetForK,
        tripMode: 'FROM_SOURCE'
    });

    console.log(`\nassignVehiclesToOptimizedRoutes result:`);
    console.log(`Assigned count: ${assignRes.assignedRoutes.length}, Unassigned count: ${assignRes.unassignedRoutes.length}`);
    assignRes.assignedRoutes.forEach(r => {
        console.log(`  ${r.vehicleName} (cap ${r.capacity}): ${r.assignedUsers} pax, stops: ${r.stops.map(s => s.name).join(' -> ')}`);
    });

    const totalAssignedPax = assignRes.assignedRoutes.reduce((s, r) => s + r.assignedUsers, 0);
    console.log(`\nTotal assigned pax: ${totalAssignedPax} / 422`);

    process.exit(0);
}

main().catch(console.error);
