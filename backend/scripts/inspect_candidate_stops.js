import dotenv from 'dotenv';
dotenv.config();
import connectDB from '../config/db.js';
import { getAIData, resolveStopCoordinates } from '../services/aiAgentService.js';
import {
    buildGlobalOptimizationMatrix,
    generateGlobalCandidateRoutes,
    consolidateSmallPassengerRoutes
} from '../services/routeOptimizationService.js';

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

    let candidateRoutes = generateGlobalCandidateRoutes({
        stops: resolvedStops,
        matrix,
        maxBusCapacity: 62,
        fleetCapacities: sortedFleetDesc.map(v => v.capacity),
        tripMode: 'FROM_SOURCE',
        options: {}
    });

    candidateRoutes = consolidateSmallPassengerRoutes({
        routes: candidateRoutes,
        matrix,
        maxBusCapacity: 62,
        tripMode: 'FROM_SOURCE',
        smallRouteThreshold: 15,
        activeInwardStartingPlaces: [],
        anchorHub,
        sourceHub: anchorHub,
        destinationHub: anchorHub,
        auditTrail: []
    });

    console.log(`Candidate routes after consolidateSmallPassengerRoutes (${candidateRoutes.length} routes):`);
    candidateRoutes.forEach((r, idx) => {
        console.log(`\nRoute ${idx + 1}: assignedUsers=${r.assignedUsers}`);
        r.stops.forEach(s => {
            const count = Array.isArray(s.userIds) ? s.userIds.length : s.userCount;
            console.log(`  - Stop: ${s.name} (${count} pax) coords=(${s.latitude}, ${s.longitude})`);
        });
    });

    process.exit(0);
}

main().catch(console.error);
