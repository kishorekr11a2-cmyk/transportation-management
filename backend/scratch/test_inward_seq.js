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
    assignVehiclesToOptimizedRoutes,
    balanceRoutesToGuaranteedSeating,
    sequenceInwardRouteStops,
    findStartingPlaceForBus,
    isValidCoordinate
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

    const candidateFleetForK = data.availableVehicles.slice(0, 9);

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

    const { assignedRoutes: initialAssigned } = assignVehiclesToOptimizedRoutes({
        routes: trialRoutes,
        availableVehicles: candidateFleetForK,
        tripMode: "TO_DESTINATION",
        activeInwardStartingPlaces
    });
    let trialAssignedRoutes = initialAssigned;

    const seatingRes = balanceRoutesToGuaranteedSeating({
        routes: trialAssignedRoutes,
        availableVehicles: candidateFleetForK,
        matrix,
        hub: anchorHub,
        tripMode: "TO_DESTINATION",
        activeInwardStartingPlaces
    });
    trialAssignedRoutes = seatingRes.balanced;

    console.log("Before sequencing assigned routes:", trialAssignedRoutes.length, "total pax:", trialAssignedRoutes.reduce((s, r) => s + r.assignedUsers, 0));

    for (const route of trialAssignedRoutes) {
        const startPlace = route.startingHub || findStartingPlaceForBus(route.vehicle, activeInwardStartingPlaces || []);
        const startingHub = (startPlace && isValidCoordinate(startPlace.latitude, startPlace.longitude))
            ? startPlace
            : (route.stops && route.stops[0]) || anchorHub;

        const seq = sequenceInwardRouteStops({
            startingHub,
            destinationHub: anchorHub,
            stops: route.stops,
            matrix,
            tripMode: "TO_DESTINATION"
        });
        console.log(`Route ${route.vehicleName}: stops before=${route.stops.length}, after=${seq.stops.length}, assignedUsers=${route.assignedUsers}`);
        seq.stops.forEach(s => console.log(`   Stop: ${s.name}, pax=${s.userCount}`));
    }

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
