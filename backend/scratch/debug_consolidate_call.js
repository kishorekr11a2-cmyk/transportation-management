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
    consolidateCandidateRoutes,
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

    const matrix = await buildGlobalOptimizationMatrix({
        depot: anchorHub,
        stops: resolvedStops
    });

    const fleetCaps = data.availableVehicles
        .map(v => Number(v.capacity || v.seatCapacity || 0))
        .filter(c => c > 0)
        .sort((a, b) => b - a);

    let candidates = generateGlobalCandidateRoutes({
        stops: resolvedStops,
        matrix,
        maxBusCapacity: fleetCaps[0],
        fleetCapacities: fleetCaps,
        tripMode: "FROM_SOURCE"
    });

    console.log("Candidate count before consolidateCandidateRoutes:", candidates.length);
    const candidateFleetForK = data.availableVehicles.slice(0, 9);
    console.log("candidateFleetForK capacities:", candidateFleetForK.map(v => v.capacity));

    const consolidated = consolidateCandidateRoutes({
        routes: candidates,
        targetRouteCount: 9,
        maxBusCapacity: fleetCaps[0],
        fleetCapacities: candidateFleetForK.map(v => Number(v.capacity || v.seatCapacity || 0)).filter(c => c > 0).sort((a, b) => b - a),
        matrix,
        tripMode: "FROM_SOURCE"
    });

    console.log("\nAfter consolidateCandidateRoutes count:", consolidated.length);
    consolidated.forEach((r, i) => console.log(`Consol ${i + 1}: pax=${r.assignedUsers}, stops=${r.stops.map(s => s.name).join(", ")}`));

    const assignment = assignVehiclesToOptimizedRoutes({
        routes: consolidated,
        availableVehicles: candidateFleetForK,
        tripMode: "FROM_SOURCE"
    });

    console.log("\nAssigned routes:", assignment.assignedRoutes.length);
    assignment.assignedRoutes.forEach((r, i) => console.log(`Assigned ${i + 1} (${r.vehicleName}): cap=${r.capacity}, pax=${r.assignedUsers}`));
    console.log("Unassigned routes:", assignment.unassignedRoutes.length);
    assignment.unassignedRoutes.forEach((r, i) => console.log(`Unassigned ${i + 1}: pax=${r.assignedUsers}, stops=${r.stops.map(s => s.name).join(", ")}`));

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
