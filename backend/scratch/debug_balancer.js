import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";
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
        tripMode: "FROM_SOURCE"
    });

    applyInterRouteRelocate({ routes: candidateRoutes, matrix, maxBusCapacity: fleetCaps[0], tripMode: "FROM_SOURCE" });
    applyInterRouteExchange({ routes: candidateRoutes, matrix, maxBusCapacity: fleetCaps[0], tripMode: "FROM_SOURCE" });

    candidateRoutes = consolidateSmallPassengerRoutes({
        routes: candidateRoutes,
        matrix,
        maxBusCapacity: fleetCaps[0],
        tripMode: "FROM_SOURCE",
        smallRouteThreshold: 15,
        activeInwardStartingPlaces: [],
        anchorHub
    });

    console.log("Before balanceCandidateRoutesToFleetCapacities:");
    candidateRoutes.forEach((r, i) => console.log(`  Cand ${i + 1}: pax=${r.assignedUsers}, stops=${r.stops.map(s => `${s.name}(${s.userCount})`).join(", ")}`));

    const candidateFleetForK = data.availableVehicles.slice(0, 9);
    console.log("\nFleet caps:", candidateFleetForK.map(v => v.capacity).sort((a, b) => b - a));

    const balanced = balanceCandidateRoutesToFleetCapacities({
        routes: candidateRoutes,
        fleet: candidateFleetForK,
        activeInwardStartingPlaces: [],
        matrix,
        tripMode: "FROM_SOURCE",
        sourceHub: anchorHub,
        destinationHub: anchorHub
    });

    console.log("\nAfter balanceCandidateRoutesToFleetCapacities:");
    balanced.forEach((r, i) => console.log(`  Route ${i + 1}: pax=${r.assignedUsers}, stops=${r.stops.map(s => `${s.name}(${s.userCount})`).join(", ")}`));

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
