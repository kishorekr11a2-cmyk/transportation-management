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
    consolidateSmallPassengerRoutes,
    assignVehiclesToOptimizedRoutes,
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
        stops: resolvedStops,
        options: { sourceHub: anchorHub }
    });

    const effectiveVehicles = data.availableVehicles;
    const fleetCaps = effectiveVehicles
        .map((v) => Number(v.capacity || v.seatCapacity || 0))
        .filter((c) => c > 0)
        .sort((a, b) => b - a);
    const maxBusCapacity = fleetCaps.length > 0 ? fleetCaps[0] : 70;

    console.log("Fleet capacities:", fleetCaps);
    console.log("Max bus capacity:", maxBusCapacity);

    let candidateRoutes = generateGlobalCandidateRoutes({
        stops: resolvedStops,
        matrix,
        maxBusCapacity,
        fleetCapacities: fleetCaps,
        tripMode: "FROM_SOURCE",
        options: { sourceHub: anchorHub }
    });

    console.log("\nAfter generateGlobalCandidateRoutes: count =", candidateRoutes.length);
    candidateRoutes.forEach((r, idx) => {
        console.log(` Cand ${idx + 1}: assignedUsers=${r.assignedUsers}, stops=${r.stops.map(s => `${s.name}(${s.passengerCount||s.userCount})`).join(", ")}`);
    });

    candidateRoutes = consolidateSmallPassengerRoutes({
        routes: candidateRoutes,
        matrix,
        maxBusCapacity,
        tripMode: "FROM_SOURCE",
        smallRouteThreshold: 15,
        anchorHub,
        sourceHub: anchorHub,
        auditTrail: []
    });

    console.log("\nAfter consolidateSmallPassengerRoutes: count =", candidateRoutes.length);
    candidateRoutes.forEach((r, idx) => {
        console.log(` Cand ${idx + 1}: assignedUsers=${r.assignedUsers}, stops=${r.stops.map(s => `${s.name}(${s.passengerCount||s.userCount})`).join(", ")}`);
    });

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
