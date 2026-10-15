import dotenv from 'dotenv';
dotenv.config();
import connectDB from '../config/db.js';
import { getAIData, resolveStopCoordinates } from '../services/aiAgentService.js';
import {
    buildGlobalOptimizationMatrix,
    generateGlobalCandidateRoutes,
    consolidateSmallPassengerRoutes,
    assignVehiclesToOptimizedRoutes,
    sequenceOutwardRouteStops
} from '../services/routeOptimizationService.js';
import { calculateDistanceKm } from '../services/aiAgentService.js';

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

    console.log('Routes before custom balancing:');
    candidateRoutes.forEach((r, idx) => {
        console.log(`Route ${idx + 1} (${r.assignedUsers} pax):`, r.stops.map(s => `${s.name} (${Array.isArray(s.userIds) ? s.userIds.length : s.userCount})`).join(', '));
    });

    // Check Othakadai and Melur:
    // Route 6 has: K.Pudur (13), Iyer Bungalow (13), Thiruppalai (14), Othakadai (15) = 55 pax
    // Route 9 has: Melur (1) = 1 pax
    // If we move Othakadai from Route 6 to Route 9:
    const r6 = candidateRoutes.find(r => r.stops.some(s => s.name === 'Othakadai'));
    const r9 = candidateRoutes.find(r => r.stops.some(s => s.name === 'Melur'));

    if (r6 && r9) {
        console.log('\nTesting moving Othakadai to Melur route:');
        const oStopIdx = r6.stops.findIndex(s => s.name === 'Othakadai');
        const oStop = r6.stops[oStopIdx];
        r6.stops.splice(oStopIdx, 1);
        r6.assignedUsers -= oStop.passengerCount || oStop.userCount;
        r6.users = r6.users.filter(uid => !(oStop.userIds || []).includes(uid));

        r9.stops.unshift(oStop);
        r9.assignedUsers += oStop.passengerCount || oStop.userCount;
        r9.users.push(...(oStop.userIds || []));

        console.log(`r6 new pax: ${r6.assignedUsers}, r9 new pax: ${r9.assignedUsers}`);
    }

    const assignRes = assignVehiclesToOptimizedRoutes({
        routes: candidateRoutes,
        availableVehicles: candidateFleetForK,
        tripMode: 'FROM_SOURCE'
    });

    console.log('\nassignVehiclesToOptimizedRoutes result:');
    console.log('Assigned:', assignRes.assignedRoutes.length, 'Unassigned:', assignRes.unassignedRoutes.length);
    assignRes.assignedRoutes.forEach(r => {
        console.log(`  ${r.vehicleName} (cap ${r.capacity}): ${r.assignedUsers} pax, stops: ${r.stops.map(s => s.name).join(' -> ')}`);
    });

    process.exit(0);
}

main().catch(console.error);
