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
    consolidateSmallPassengerRoutes,
    evaluateInwardCorridorConsolidation,
    consolidateCandidateRoutes,
    balanceCandidateRoutesToFleetCapacities,
    assignVehiclesToOptimizedRoutes
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

    const sortedFleetDesc = [...data.availableVehicles]
        .filter((v) => v.isActive !== false && Number(v.capacity || v.seatCapacity || 0) > 0)
        .sort((a, b) => Number(b.capacity || b.seatCapacity || 0) - Number(a.capacity || a.seatCapacity || 0));

    const candidateFleetForK = sortedFleetDesc.slice(0, 9);

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

    trialRoutes = balanceCandidateRoutesToFleetCapacities({
        routes: trialRoutes,
        fleet: candidateFleetForK,
        activeInwardStartingPlaces,
        matrix,
        tripMode: "TO_DESTINATION",
        sourceHub: anchorHub,
        destinationHub: anchorHub
    });

    const res = assignVehiclesToOptimizedRoutes({
        routes: trialRoutes,
        availableVehicles: candidateFleetForK,
        tripMode: "TO_DESTINATION",
        activeInwardStartingPlaces
    });
    console.log("Assigned count:", res.assignedRoutes.length, "Unassigned count:", res.unassignedRoutes.length);
    console.log(res.vehicleUsageLogs);

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
