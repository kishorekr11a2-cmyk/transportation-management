import dotenv from 'dotenv';
dotenv.config();
import connectDB from '../config/db.js';
import { getAIData, resolveStopCoordinates } from '../services/aiAgentService.js';
import {
    buildGlobalOptimizationMatrix,
    generateGlobalCandidateRoutes,
    insertStopNearestCost
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

    let candidateRoutes = generateGlobalCandidateRoutes({
        stops: resolvedStops,
        matrix,
        maxBusCapacity: 62,
        fleetCapacities: sortedFleetDesc.map(v => v.capacity),
        tripMode: 'FROM_SOURCE',
        options: {}
    });

    const melurRoute = candidateRoutes.find(r => r.stops.some(s => s.name === 'Melur'));
    const othakadaiRoute = candidateRoutes.find(r => r.stops.some(s => s.name === 'Othakadai'));

    console.log('Melur route:', melurRoute.routeId, melurRoute.assignedUsers, melurRoute.stops.map(s => s.name));
    console.log('Othakadai route:', othakadaiRoute.routeId, othakadaiRoute.assignedUsers, othakadaiRoute.stops.map(s => s.name));

    // Why didn't Melur merge into Othakadai?
    // Because othakadaiRoute already has 55 passengers!
    // If Melur (1 pax) merged into othakadaiRoute, 55 + 1 = 56!
    // But maxBusCapacity was passed as 62!
    // Did it check costDelta?
    const melurStop = melurRoute.stops[0];
    const insRes = insertStopNearestCost({
        tour: othakadaiRoute.stops,
        stop: melurStop,
        stopMatrixIndex: melurStop.matrixIndex,
        matrix,
        tripMode: 'FROM_SOURCE'
    });
    console.log('Insert Melur into Othakadai route costDelta:', insRes.costDelta);

    process.exit(0);
}

main().catch(console.error);
