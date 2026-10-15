import dotenv from 'dotenv';
dotenv.config();
import connectDB from '../config/db.js';
import { getAIData, resolveStopCoordinates } from '../services/aiAgentService.js';
import {
    buildGlobalOptimizationMatrix,
    generateGlobalCandidateRoutes,
    consolidateCandidateRoutes
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

    console.log('Candidate routes count:', candidateRoutes.length);
    const auditTrail = [];
    const consolidated = consolidateCandidateRoutes({
        routes: candidateRoutes,
        targetRouteCount: 9,
        maxBusCapacity: 62,
        matrix,
        tripMode: 'FROM_SOURCE',
        auditTrail
    });

    console.log(`After consolidateCandidateRoutes to 9 (${consolidated.length} routes):`);
    consolidated.forEach((r, idx) => {
        console.log(`Route ${idx+1} (${r.assignedUsers} pax):`, r.stops.map(s => s.name).join(', '));
    });
    console.log('Audit trail:', auditTrail);

    process.exit(0);
}

main().catch(console.error);
