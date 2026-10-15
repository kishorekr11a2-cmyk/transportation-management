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
    assignVehiclesToOptimizedRoutes,
    balanceRoutesToGuaranteedSeating,
    isCandidateDemandCompatibleWithFleetProfile,
    optimizeTour2OptRoad
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
        tripMode: "TO_DESTINATION",
        options: { destinationHub: anchorHub, activeInwardStartingPlaces }
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

    console.log("Candidate routes count:", candidateRoutes.length);
    console.log("Candidate route demands:", candidateRoutes.map(r => r.assignedUsers));
    console.log("Fleet capacities:", candidateFleetForK.map(v => v.capacity));

    const compatible = isCandidateDemandCompatibleWithFleetProfile(
        candidateRoutes.map(r => r.assignedUsers),
        candidateFleetForK.map(v => Number(v.capacity || v.seatCapacity || 0))
    );
    console.log("Are candidate route demands compatible with fleet profile?", compatible);

    // Run assignVehiclesToOptimizedRoutes directly with candidateRoutes:
    const { assignedRoutes, unassignedRoutes, vehicleUsageLogs } = assignVehiclesToOptimizedRoutes({
        routes: candidateRoutes,
        availableVehicles: candidateFleetForK,
        tripMode: "TO_DESTINATION",
        activeInwardStartingPlaces
    });

    console.log("\nAssigned routes:", assignedRoutes.length, "Unassigned:", unassignedRoutes.length);
    let totalAssigned = 0;
    assignedRoutes.forEach((r, idx) => {
        console.log(`  Route ${idx + 1} (${r.vehicleName}): capacity=${r.capacity}, assignedUsers=${r.assignedUsers}, stops=${r.stops.length}`);
        totalAssigned += r.assignedUsers;
    });
    console.log("Total assigned users:", totalAssigned);

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
