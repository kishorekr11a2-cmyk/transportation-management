import dotenv from 'dotenv';
dotenv.config();
import connectDB from '../config/db.js';
import { getAIData, resolveStopCoordinates } from '../services/aiAgentService.js';
import {
    buildOsrmDirectionalRoadDistanceMatrix,
    formInitialCandidateRoutes,
    consolidateCandidateRoutes,
    expandCandidateRoutesToTarget,
    balanceCandidateRoutesToFleetCapacities,
    assignVehiclesToOptimizedRoutes
} from '../services/routeOptimizationService.js';

async function main() {
    await connectDB();
    const aiData = await getAIData({ forceRefresh: true });
    const resolvedStops = await resolveStopCoordinates(aiData.stops);
    const availableVehicles = aiData.availableVehicles;
    const totalComingDemand = resolvedStops.reduce((sum, s) => sum + (Array.isArray(s.userIds) ? s.userIds.length : Number(s.userCount || 0)), 0);

    const anchorHub = { name: "K.L.N. College of Engineering", latitude: 9.8324, longitude: 78.1884 };
    const matrix = await buildOsrmDirectionalRoadDistanceMatrix([anchorHub, ...resolvedStops]);

    const sortedFleetDesc = [...availableVehicles]
        .filter((v) => v.isActive !== false && Number(v.capacity || v.seatCapacity || 0) > 0)
        .sort((a, b) => Number(b.capacity || b.seatCapacity || 0) - Number(a.capacity || a.seatCapacity || 0));

    console.log('Available fleet sorted:', sortedFleetDesc.map(v => `${v.vehicleName} (${v.capacity})`));

    // Form initial candidates
    let candidateRoutes = formInitialCandidateRoutes({
        resolvedStops,
        matrix,
        maxBusCapacity: 70,
        tripMode: 'FROM_SOURCE'
    });
    console.log(`Initial candidate routes count: ${candidateRoutes.length}`);
    console.log('Initial candidate demands:', candidateRoutes.map(r => r.assignedUsers));

    for (let K of [8, 9]) {
        console.log(`\n=================== Testing K = ${K} ===================`);
        const candidateFleetForK = sortedFleetDesc.slice(0, K);
        console.log(`candidateFleetForK capacities:`, candidateFleetForK.map(v => `${v.vehicleName}:${v.capacity}`));

        let trialRoutes = candidateRoutes.map(r => ({
            ...r,
            stops: [...r.stops],
            users: [...r.users]
        }));

        if (trialRoutes.length > K) {
            trialRoutes = consolidateCandidateRoutes({
                routes: trialRoutes,
                targetRouteCount: K,
                maxBusCapacity: 70,
                matrix,
                tripMode: 'FROM_SOURCE'
            });
        } else if (trialRoutes.length < K) {
            trialRoutes = expandCandidateRoutesToTarget({
                routes: trialRoutes,
                targetRouteCount: K,
                matrix,
                tripMode: 'FROM_SOURCE'
            });
        }

        console.log(`After consolidate/expand to K=${K}, trialRoutes count: ${trialRoutes.length}`);
        console.log(`trialRoutes demands:`, trialRoutes.map(r => r.assignedUsers));
        console.log(`trialRoutes total pax:`, trialRoutes.reduce((s, r) => s + r.assignedUsers, 0));

        // balanceCandidateRoutesToFleetCapacities
        trialRoutes = balanceCandidateRoutesToFleetCapacities({
            routes: trialRoutes,
            fleet: candidateFleetForK,
            matrix,
            tripMode: 'FROM_SOURCE',
            sourceHub: anchorHub
        });

        console.log(`After balanceCandidateRoutesToFleetCapacities:`);
        console.log(`trialRoutes demands:`, trialRoutes.map(r => r.assignedUsers));
        console.log(`trialRoutes total pax:`, trialRoutes.reduce((s, r) => s + r.assignedUsers, 0));

        const assignRes = assignVehiclesToOptimizedRoutes({
            routes: trialRoutes,
            availableVehicles: candidateFleetForK,
            tripMode: 'FROM_SOURCE'
        });

        console.log(`Assigned routes count: ${assignRes.assignedRoutes.length}`);
        assignRes.assignedRoutes.forEach(r => {
            console.log(`  Assigned: route pax=${r.assignedUsers} -> bus ${r.vehicleName} (cap ${r.capacity})`);
        });

        console.log(`Unassigned routes count: ${assignRes.unassignedRoutes.length}`);
        assignRes.unassignedRoutes.forEach(r => {
            console.log(`  Unassigned: route pax=${r.assignedUsers}`);
        });
    }

    process.exit(0);
}

main().catch(console.error);
