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
    balanceCandidateRoutesToFleetCapacities,
    assignVehiclesToOptimizedRoutes,
    balanceRoutesToGuaranteedSeating
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

    let candidateRoutes = generateGlobalCandidateRoutes({
        stops: resolvedStops,
        matrix,
        maxBusCapacity: fleetCaps[0],
        fleetCapacities: fleetCaps,
        tripMode: "TO_DESTINATION"
    });
    console.log("Initial inward candidates:", candidateRoutes.length);

    candidateRoutes = consolidateSmallPassengerRoutes({
        routes: candidateRoutes,
        matrix,
        maxBusCapacity: fleetCaps[0],
        fleetCapacities: fleetCaps,
        tripMode: "TO_DESTINATION",
        smallRouteThreshold: 15,
        activeInwardStartingPlaces,
        anchorHub
    });
    console.log("After consolidateSmallPassengerRoutes:", candidateRoutes.length);

    const consolRes = evaluateInwardCorridorConsolidation({
        routes: candidateRoutes,
        availableVehicles: data.availableVehicles,
        configuredInwardStartingPlaces: activeInwardStartingPlaces,
        destinationHub: anchorHub,
        maxBusCapacity: fleetCaps[0],
        targetRouteCount: 9,
        matrix,
        tripMode: "TO_DESTINATION"
    });
    candidateRoutes = consolRes.routes;
    console.log("After evaluateInwardCorridorConsolidation:", candidateRoutes.length);
    candidateRoutes.forEach((r, i) => console.log(`  Cand ${i + 1}: pax=${r.assignedUsers}, stops=${r.stops.map(s => s.name).join(", ")}`));

    const candidateFleetForK = data.availableVehicles.slice(0, 9);
    console.log("Fleet caps:", candidateFleetForK.map(v => v.capacity));

    let trialRoutes = candidateRoutes.map(r => ({ ...r, stops: [...r.stops], users: [...r.users] }));
    if (trialRoutes.length > 9) {
        trialRoutes = consolidateCandidateRoutes({
            routes: trialRoutes,
            targetRouteCount: 9,
            maxBusCapacity: fleetCaps[0],
            fleetCapacities: candidateFleetForK.map(v => Number(v.capacity || v.seatCapacity || 0)).filter(c => c > 0).sort((a, b) => b - a),
            matrix,
            tripMode: "TO_DESTINATION"
        });
    }
    console.log("After consolidateCandidateRoutes:", trialRoutes.length);
    trialRoutes.forEach((r, i) => console.log(`  Trial ${i + 1}: pax=${r.assignedUsers}, stops=${r.stops.map(s => s.name).join(", ")}`));

    const assignment = assignVehiclesToOptimizedRoutes({
        routes: trialRoutes,
        availableVehicles: candidateFleetForK,
        tripMode: "TO_DESTINATION",
        activeInwardStartingPlaces
    });
    console.log("After assignVehiclesToOptimizedRoutes assigned:", assignment.assignedRoutes.length, "unassigned:", assignment.unassignedRoutes.length);
    assignment.assignedRoutes.forEach((r, i) => console.log(`  Assigned ${i + 1} (${r.vehicleName}): cap=${r.capacity}, pax=${r.assignedUsers}`));
    assignment.unassignedRoutes.forEach((r, i) => console.log(`  Unassigned ${i + 1}: pax=${r.assignedUsers}`));

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
