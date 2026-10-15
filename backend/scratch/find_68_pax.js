import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";
import InwardStartingPlace from "../models/InwardStartingPlace.js";
import {
    getAIData,
    calculateStoppingGroups,
    resolveStopCoordinates,
    canonicalizeCollegeHub
} from "../services/aiAgentService.js";
import {
    buildGlobalOptimizationMatrix,
    generateGlobalCandidateRoutes,
    applyInterRouteRelocate,
    applyInterRouteExchange,
    consolidateSmallPassengerRoutes,
    evaluateInwardCorridorConsolidation,
    consolidateCandidateRoutes,
    expandCandidateRoutesToTarget,
    balanceCandidateRoutesToFleetCapacities
} from "../services/routeOptimizationService.js";

const klnce = {
    name: "K. L. N. College of Engineering",
    address: "Pottapalayam, Sivagangai / Madurai - 630612",
    latitude: 9.8515,
    longitude: 78.1882
};

async function main() {
    await connectDB();
    const data = await getAIData({ forceRefresh: true });
    const anchorHub = canonicalizeCollegeHub(klnce);
    const confirmedUsers = data.users.filter(u => u.travelStatus === "Coming");
    const rawStoppingGroups = calculateStoppingGroups(confirmedUsers);
    const stoppingGroups = await resolveStopCoordinates(rawStoppingGroups, anchorHub);
    const resolvedStops = stoppingGroups.filter(s => typeof s.latitude === "number" && typeof s.longitude === "number");
    const activeInwardStartingPlaces = await InwardStartingPlace.find({ active: true }).lean();

    const matrix = await buildGlobalOptimizationMatrix({
        depot: anchorHub,
        stops: resolvedStops
    });

    const fleetCaps = data.availableVehicles
        .map(v => Number(v.capacity || v.seatCapacity || 0))
        .filter(c => c > 0)
        .sort((a, b) => b - a);

    console.log("Fleet caps:", fleetCaps);

    let candidates = generateGlobalCandidateRoutes({
        stops: resolvedStops,
        matrix,
        maxBusCapacity: fleetCaps[0],
        fleetCapacities: fleetCaps,
        tripMode: "TO_DESTINATION"
    });
    console.log("1. generateGlobalCandidateRoutes:", candidates.length, candidates.map(r => r.assignedUsers));

    // Relocate & Exchange
    let localSearchActive = true;
    let rounds = 0;
    while (localSearchActive && rounds < 8) {
        localSearchActive = false;
        rounds++;
        const relRes = applyInterRouteRelocate({
            routes: candidates,
            matrix,
            maxBusCapacity: fleetCaps[0],
            fleetCapacities: fleetCaps,
            tripMode: "TO_DESTINATION"
        });
        if (relRes.improved) {
            candidates = relRes.routes;
            localSearchActive = true;
            continue;
        }
        const exRes = applyInterRouteExchange({
            routes: candidates,
            matrix,
            maxBusCapacity: fleetCaps[0],
            fleetCapacities: fleetCaps,
            tripMode: "TO_DESTINATION"
        });
        if (exRes.improved) {
            candidates = exRes.routes;
            localSearchActive = true;
            continue;
        }
    }
    console.log("2. After local search:", candidates.length, candidates.map(r => r.assignedUsers));

    candidates = consolidateSmallPassengerRoutes({
        routes: candidates,
        matrix,
        maxBusCapacity: fleetCaps[0],
        fleetCapacities: fleetCaps,
        tripMode: "TO_DESTINATION",
        smallRouteThreshold: 15,
        activeInwardStartingPlaces,
        anchorHub
    });
    console.log("3. After consolidateSmallPassengerRoutes:", candidates.length, candidates.map(r => r.assignedUsers));

    const consolRes = evaluateInwardCorridorConsolidation({
        routes: candidates,
        availableVehicles: data.availableVehicles,
        configuredInwardStartingPlaces: activeInwardStartingPlaces,
        destinationHub: anchorHub,
        maxBusCapacity: fleetCaps[0],
        targetRouteCount: 9,
        matrix,
        tripMode: "TO_DESTINATION"
    });
    candidates = consolRes.routes;
    console.log("4. After evaluateInwardCorridorConsolidation:", candidates.length, candidates.map(r => r.assignedUsers));
    candidates.forEach((r, i) => console.log(`   Route ${i+1}: pax=${r.assignedUsers}, stops=${r.stops.map(s => s.name).join(", ")}`));

    const sortedFleetDesc = [...data.availableVehicles]
        .filter((v) => v.isActive !== false && Number(v.capacity || v.seatCapacity || 0) > 0)
        .sort((a, b) => Number(b.capacity || b.seatCapacity || 0) - Number(a.capacity || a.seatCapacity || 0));
    const candidateFleetForK = sortedFleetDesc.slice(0, 9);

    let trialRoutes = candidates.map(r => ({ ...r, stops: [...r.stops], users: [...r.users] }));
    if (trialRoutes.length > 9) {
        trialRoutes = consolidateCandidateRoutes({
            routes: trialRoutes,
            targetRouteCount: 9,
            maxBusCapacity: fleetCaps[0],
            fleetCapacities: candidateFleetForK.map(v => Number(v.capacity || v.seatCapacity || 0)).filter(c => c > 0).sort((a, b) => b - a),
            matrix,
            tripMode: "TO_DESTINATION"
        });
        console.log("5. After consolidateCandidateRoutes:", trialRoutes.length, trialRoutes.map(r => r.assignedUsers));
    } else if (trialRoutes.length < 9) {
        trialRoutes = expandCandidateRoutesToTarget({
            routes: trialRoutes,
            targetRouteCount: 9,
            matrix,
            tripMode: "TO_DESTINATION"
        });
        console.log("5. After expandCandidateRoutesToTarget:", trialRoutes.length, trialRoutes.map(r => r.assignedUsers));
    }

    trialRoutes = balanceCandidateRoutesToFleetCapacities({
        routes: trialRoutes,
        fleet: candidateFleetForK,
        activeInwardStartingPlaces,
        matrix,
        tripMode: "TO_DESTINATION",
        sourceHub: anchorHub,
        destinationHub: anchorHub
    });
    console.log("6. After balanceCandidateRoutesToFleetCapacities:", trialRoutes.length, trialRoutes.map(r => r.assignedUsers));
    trialRoutes.forEach((r, i) => console.log(`   Route ${i+1}: pax=${r.assignedUsers}, stops=${r.stops.map(s => s.name).join(", ")}`));

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
