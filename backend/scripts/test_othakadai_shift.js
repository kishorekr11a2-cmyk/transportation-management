import dotenv from 'dotenv';
dotenv.config();
import connectDB from '../config/db.js';
import { getAIData, resolveStopCoordinates } from '../services/aiAgentService.js';
import {
    buildGlobalOptimizationMatrix,
    generateGlobalCandidateRoutes,
    consolidateCandidateRoutes,
    assignVehiclesToOptimizedRoutes,
    sequenceOutwardRouteStops,
    optimizeTour2OptRoad
} from '../services/routeOptimizationService.js';

async function main() {
    await connectDB();
    const aiData = await getAIData({ forceRefresh: true });
    const resolvedStops = await resolveStopCoordinates(aiData.stops);
    const anchorHub = { name: "K.L.N. College of Engineering", latitude: 9.8324, longitude: 78.1884 };
    const matrix = await buildGlobalOptimizationMatrix({ depot: anchorHub, stops: resolvedStops, options: {} });

    const sortedFleetDesc = [...aiData.availableVehicles]
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

    const consolidated = consolidateCandidateRoutes({
        routes: candidateRoutes,
        targetRouteCount: 9,
        maxBusCapacity: 62,
        matrix,
        tripMode: 'FROM_SOURCE',
        auditTrail: []
    });

    // Check Othakadai shift from 56-pax route to 12-pax route:
    const r56 = consolidated.find(r => r.assignedUsers === 56);
    const r12 = consolidated.find(r => r.assignedUsers === 12);

    if (r56 && r12) {
        const oIdx = r56.stops.findIndex(s => s.name === 'Othakadai');
        const oStop = r56.stops[oIdx];
        r56.stops.splice(oIdx, 1);
        r56.assignedUsers -= (oStop.userCount || oStop.passengerCount);
        r56.users = r56.users.filter(u => !(oStop.userIds || []).includes(u));

        r12.stops.push(oStop);
        r12.assignedUsers += (oStop.userCount || oStop.passengerCount);
        r12.users.push(...(oStop.userIds || []));

        // Re-sequence both
        const opt56 = optimizeTour2OptRoad({ tour: r56.stops, matrix, tripMode: 'FROM_SOURCE' });
        const seq56 = sequenceOutwardRouteStops({ departureHub: anchorHub, stops: opt56.tour, matrix, tripMode: 'FROM_SOURCE' });
        r56.stops = seq56.stops;
        r56.routeDistanceKm = seq56.routeDistanceKm;
        r56.qualityValidation = seq56.qualityValidation;

        const opt12 = optimizeTour2OptRoad({ tour: r12.stops, matrix, tripMode: 'FROM_SOURCE' });
        const seq12 = sequenceOutwardRouteStops({ departureHub: anchorHub, stops: opt12.tour, matrix, tripMode: 'FROM_SOURCE' });
        r12.stops = seq12.stops;
        r12.routeDistanceKm = seq12.routeDistanceKm;
        r12.qualityValidation = seq12.qualityValidation;
    }

    console.log('Demands before assignment:', consolidated.map(r => r.assignedUsers).sort((a,b) => b-a));

    const assignRes = assignVehiclesToOptimizedRoutes({
        routes: consolidated,
        availableVehicles: candidateFleetForK,
        tripMode: 'FROM_SOURCE'
    });

    console.log(`\nassignVehiclesToOptimizedRoutes result:`);
    console.log(`Assigned count: ${assignRes.assignedRoutes.length}, Unassigned count: ${assignRes.unassignedRoutes.length}`);
    assignRes.assignedRoutes.forEach(r => {
        console.log(`  ${r.vehicleName} (cap ${r.capacity}): ${r.assignedUsers} pax, stops: ${r.stops.map(s => s.name).join(' -> ')} (detour: ${r.qualityValidation?.detourRatio})`);
    });

    const totalAssignedPax = assignRes.assignedRoutes.reduce((s, r) => s + r.assignedUsers, 0);
    console.log(`\nTotal assigned pax: ${totalAssignedPax} / 422`);
    console.log(`Unassigned count: ${assignRes.unassignedRoutes.length}`);

    process.exit(0);
}

main().catch(console.error);
