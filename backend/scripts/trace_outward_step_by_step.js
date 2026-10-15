import dotenv from 'dotenv';
dotenv.config();
import connectDB from '../config/db.js';
import { getAIData, resolveStopCoordinates } from '../services/aiAgentService.js';
import {
    buildGlobalOptimizationMatrix,
    generateGlobalCandidateRoutes,
    consolidateSmallPassengerRoutes,
    consolidateCandidateRoutes,
    expandCandidateRoutesToTarget,
    balanceCandidateRoutesToFleetCapacities,
    assignVehiclesToOptimizedRoutes,
    consolidateAndRebalanceLowOccupancyOutwardRoutes
} from '../services/routeOptimizationService.js';

async function main() {
    await connectDB();
    const aiData = await getAIData({ forceRefresh: true });
    const resolvedStops = await resolveStopCoordinates(aiData.stops);
    const availableVehicles = aiData.availableVehicles;
    const totalComingDemand = resolvedStops.reduce((sum, s) => sum + (Array.isArray(s.userIds) ? s.userIds.length : Number(s.userCount || 0)), 0);

    const anchorHub = { name: "K.L.N. College of Engineering", latitude: 9.8324, longitude: 78.1884 };
    const matrix = await buildGlobalOptimizationMatrix({
        depot: anchorHub,
        stops: resolvedStops,
        options: {}
    });

    const sortedFleetDesc = [...availableVehicles]
        .filter((v) => v.isActive !== false && Number(v.capacity || v.seatCapacity || 0) > 0)
        .sort((a, b) => Number(b.capacity || b.seatCapacity || 0) - Number(a.capacity || a.seatCapacity || 0));

    console.log('Available fleet sorted:', sortedFleetDesc.map(v => `${v.vehicleName} (${v.capacity})`));

    const fleetCaps = sortedFleetDesc.map(v => Number(v.capacity || 0));
    const maxBusCapacity = fleetCaps[0] || 70;

    let candidateRoutes = generateGlobalCandidateRoutes({
        stops: resolvedStops,
        matrix,
        maxBusCapacity,
        fleetCapacities: fleetCaps,
        tripMode: 'FROM_SOURCE',
        options: {}
    });

    console.log(`Initial candidate routes count: ${candidateRoutes.length}`);
    console.log('Initial candidate demands:', candidateRoutes.map(r => r.assignedUsers));
    console.log('Total pax in initial candidates:', candidateRoutes.reduce((s, r) => s + r.assignedUsers, 0));

    candidateRoutes = consolidateSmallPassengerRoutes({
        routes: candidateRoutes,
        matrix,
        maxBusCapacity,
        tripMode: 'FROM_SOURCE',
        smallRouteThreshold: 15,
        activeInwardStartingPlaces: [],
        anchorHub,
        sourceHub: anchorHub,
        destinationHub: anchorHub,
        auditTrail: []
    });

    console.log(`After consolidateSmallPassengerRoutes: ${candidateRoutes.length} routes`);
    console.log('Demands:', candidateRoutes.map(r => r.assignedUsers));

    for (let K of [8, 9]) {
        console.log(`\n=================== K = ${K} ===================`);
        const candidateFleetForK = sortedFleetDesc.slice(0, K);
        console.log(`candidateFleetForK:`, candidateFleetForK.map(v => `${v.vehicleName}:${v.capacity}`));

        let trialRoutes = candidateRoutes.map(r => ({
            ...r,
            stops: [...r.stops],
            users: [...r.users]
        }));

        if (trialRoutes.length > K) {
            trialRoutes = consolidateCandidateRoutes({
                routes: trialRoutes,
                targetRouteCount: K,
                maxBusCapacity,
                matrix,
                tripMode: 'FROM_SOURCE',
                auditTrail: []
            });
            console.log(`After consolidateCandidateRoutes to ${K}: ${trialRoutes.length} routes, demands:`, trialRoutes.map(r => r.assignedUsers));
        } else if (trialRoutes.length < K) {
            trialRoutes = expandCandidateRoutesToTarget({
                routes: trialRoutes,
                targetRouteCount: K,
                matrix,
                tripMode: 'FROM_SOURCE',
                auditTrail: []
            });
            console.log(`After expandCandidateRoutesToTarget to ${K}: ${trialRoutes.length} routes, demands:`, trialRoutes.map(r => r.assignedUsers));
        }

        trialRoutes = balanceCandidateRoutesToFleetCapacities({
            routes: trialRoutes,
            fleet: candidateFleetForK,
            matrix,
            tripMode: 'FROM_SOURCE',
            sourceHub: anchorHub
        });
        console.log(`After balanceCandidateRoutesToFleetCapacities: ${trialRoutes.length} routes, demands:`, trialRoutes.map(r => r.assignedUsers));

        const assignRes = assignVehiclesToOptimizedRoutes({
            routes: trialRoutes,
            availableVehicles: candidateFleetForK,
            tripMode: 'FROM_SOURCE'
        });

        console.log(`assignVehiclesToOptimizedRoutes result: assigned=${assignRes.assignedRoutes.length}, unassigned=${assignRes.unassignedRoutes.length}`);
        assignRes.assignedRoutes.forEach(r => console.log(`  Assigned: bus=${r.vehicleName}(cap=${r.capacity}) routePax=${r.assignedUsers}`));
        assignRes.unassignedRoutes.forEach(r => console.log(`  Unassigned: routePax=${r.assignedUsers}`));

        let trialAssignedRoutes = assignRes.assignedRoutes;
        if (trialAssignedRoutes.length > K) {
            trialAssignedRoutes = consolidateAndRebalanceLowOccupancyOutwardRoutes({
                routes: trialAssignedRoutes,
                availableVehicles: candidateFleetForK,
                sourceHub: anchorHub,
                matrix,
                tripMode: 'FROM_SOURCE',
                auditTrail: [],
                lowOccupancyThreshold: 20
            });
            console.log(`After consolidateAndRebalanceLowOccupancyOutwardRoutes: ${trialAssignedRoutes.length} routes`);
        }
    }

    process.exit(0);
}

main().catch(console.error);
