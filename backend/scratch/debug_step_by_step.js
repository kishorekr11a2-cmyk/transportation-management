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

    const candidateFleetForK = data.availableVehicles.slice(0, 9);
    console.log("candidateFleetForK capacities:", candidateFleetForK.map(v => v.capacity));

    let trialRoutes = consolidateCandidateRoutes({
        routes: candidates,
        targetRouteCount: 9,
        maxBusCapacity: fleetCaps[0],
        fleetCapacities: candidateFleetForK.map(v => Number(v.capacity || v.seatCapacity || 0)).filter(c => c > 0).sort((a, b) => b - a),
        matrix,
        tripMode: "FROM_SOURCE"
    });
    console.log("After consolidateCandidateRoutes:", trialRoutes.length, "total pax:", trialRoutes.reduce((s, r) => s + r.assignedUsers, 0));

    trialRoutes = balanceCandidateRoutesToFleetCapacities({
        routes: trialRoutes,
        fleet: candidateFleetForK,
        activeInwardStartingPlaces: [],
        matrix,
        tripMode: "FROM_SOURCE",
        sourceHub: anchorHub,
        destinationHub: anchorHub
    });
    console.log("After balanceCandidateRoutesToFleetCapacities:", trialRoutes.length, "total pax:", trialRoutes.reduce((s, r) => s + r.assignedUsers, 0));
    trialRoutes.forEach((r, i) => console.log(`  Route ${i + 1}: pax=${r.assignedUsers}, stops=${r.stops.map(s => s.name).join(", ")}`));

    const assignment = assignVehiclesToOptimizedRoutes({
        routes: trialRoutes,
        availableVehicles: candidateFleetForK,
        tripMode: "FROM_SOURCE"
    });
    console.log("After assignVehiclesToOptimizedRoutes assigned:", assignment.assignedRoutes.length, "unassigned:", assignment.unassignedRoutes.length);
    assignment.assignedRoutes.forEach((r, i) => console.log(`  Assigned ${i + 1} (${r.vehicleName}): cap=${r.capacity}, pax=${r.assignedUsers}`));
    assignment.unassignedRoutes.forEach((r, i) => console.log(`  Unassigned ${i + 1}: pax=${r.assignedUsers}, stops=${r.stops.map(s => s.name).join(", ")}`));

    const seatingRes = balanceRoutesToGuaranteedSeating({
        routes: assignment.assignedRoutes,
        availableVehicles: candidateFleetForK,
        matrix,
        hub: anchorHub,
        tripMode: "FROM_SOURCE",
        activeInwardStartingPlaces: []
    });
    console.log("After balanceRoutesToGuaranteedSeating:", seatingRes.balanced.length, "total pax:", seatingRes.balanced.reduce((s, r) => s + r.assignedUsers, 0));

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
