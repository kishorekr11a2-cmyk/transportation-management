import dotenv from 'dotenv';
dotenv.config();
import connectDB from '../config/db.js';
import { getAIData, resolveStopCoordinates } from '../services/aiAgentService.js';
import {
    buildGlobalOptimizationMatrix,
    generateGlobalCandidateRoutes,
    consolidateSmallPassengerRoutes,
    expandCandidateRoutesToTarget,
    consolidateCandidateRoutes,
    balanceCandidateRoutesToFleetCapacities,
    assignVehiclesToOptimizedRoutes,
    rebalanceUnallocatedPassengersToSelectedBuses,
    consolidateAndRebalanceLowOccupancyOutwardRoutes,
    balanceRoutesToGuaranteedSeating
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

    const K = 9;
    const candidateFleetForK = sortedFleetDesc.slice(0, K);
    console.log('Candidate fleet for K=9:', candidateFleetForK.map(v => `${v.vehicleName}:${v.capacity}`));

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
        tripMode: 'FROM_SOURCE',
        smallRouteThreshold: 15,
        activeInwardStartingPlaces: [],
        anchorHub,
        sourceHub: anchorHub,
        destinationHub: anchorHub,
        auditTrail: []
    });

    console.log(`Initial candidate routes count: ${candidateRoutes.length}, demands:`, candidateRoutes.map(r => r.assignedUsers));

    let trialRoutes = candidateRoutes.map(r => ({
        ...r,
        stops: [...r.stops],
        users: [...r.users]
    }));

    if (trialRoutes.length > K) {
        trialRoutes = consolidateCandidateRoutes({
            routes: trialRoutes,
            targetRouteCount: K,
            maxBusCapacity: 62,
            matrix,
            tripMode: 'FROM_SOURCE',
            auditTrail: []
        });
    } else if (trialRoutes.length < K) {
        trialRoutes = expandCandidateRoutesToTarget({
            routes: trialRoutes,
            targetRouteCount: K,
            matrix,
            tripMode: 'FROM_SOURCE',
            auditTrail: []
        });
    }

    console.log(`Before balanceCandidateRoutesToFleetCapacities: ${trialRoutes.length} routes, demands:`, trialRoutes.map(r => r.assignedUsers));

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

    console.log('1. assignVehiclesToOptimizedRoutes:');
    console.log('   Assigned count:', assignRes.assignedRoutes.length, 'pax:', assignRes.assignedRoutes.reduce((s, r) => s + r.assignedUsers, 0));
    console.log('   Unassigned count:', assignRes.unassignedRoutes.length, 'pax:', assignRes.unassignedRoutes.reduce((s, r) => s + r.assignedUsers, 0));
    console.log('   Assigned routes:', assignRes.assignedRoutes.map(r => `${r.vehicleName}(cap ${r.capacity}): pax ${r.assignedUsers}`));
    console.log('   Unassigned routes:', assignRes.unassignedRoutes.map(r => `pax ${r.assignedUsers}`));

    let trialAssignedRoutes = assignRes.assignedRoutes;
    let trialUnassigned = assignRes.unassignedRoutes;

    if (trialUnassigned.length > 0 && trialAssignedRoutes.length > 0) {
        rebalanceUnallocatedPassengersToSelectedBuses({
            assignedRoutes: trialAssignedRoutes,
            unassignedRoutes: trialUnassigned,
            matrix,
            tripMode: 'FROM_SOURCE',
            maxBusCapacity: 62,
            configuredInwardStartingPlaces: [],
            anchorHub,
            auditTrail: []
        });
        console.log('2. After rebalanceUnallocatedPassengersToSelectedBuses:');
        console.log('   Assigned count:', trialAssignedRoutes.length, 'pax:', trialAssignedRoutes.reduce((s, r) => s + r.assignedUsers, 0));
        console.log('   Unassigned count:', trialUnassigned.length, 'pax:', trialUnassigned.reduce((s, r) => s + (r.userCount || r.passengerCount || r.assignedUsers || 0), 0));
        console.log('   Assigned routes:', trialAssignedRoutes.map(r => `${r.vehicleName}(cap ${r.capacity}): pax ${r.assignedUsers}`));
        console.log('   Unassigned routes:', trialUnassigned.map(r => `pax ${r.userCount || r.passengerCount || r.assignedUsers || 0}`));
    }

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
        console.log('3. After consolidateAndRebalanceLowOccupancyOutwardRoutes:');
        console.log('   Assigned count:', trialAssignedRoutes.length, 'pax:', trialAssignedRoutes.reduce((s, r) => s + r.assignedUsers, 0));
    }

    const seatingRes = balanceRoutesToGuaranteedSeating({
        routes: trialAssignedRoutes,
        availableVehicles: candidateFleetForK,
        matrix,
        hub: anchorHub,
        tripMode: 'FROM_SOURCE',
        activeInwardStartingPlaces: [],
        auditTrail: []
    });
    console.log('4. After balanceRoutesToGuaranteedSeating:');
    console.log('   Assigned count:', trialAssignedRoutes.length, 'pax:', trialAssignedRoutes.reduce((s, r) => s + r.assignedUsers, 0));
    console.log('   Total standing:', seatingRes.totalStanding);

    process.exit(0);
}

main().catch(console.error);
