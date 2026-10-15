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
    assignVehiclesToOptimizedRoutes,
    isCandidateDemandCompatibleWithFleetProfile
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
        stops: resolvedStops,
        options: { destinationHub: anchorHub }
    });

    const fleetCaps = data.availableVehicles
        .map((v) => Number(v.capacity || v.seatCapacity || 0))
        .filter((c) => c > 0)
        .sort((a, b) => b - a);

    let candidateRoutes = generateGlobalCandidateRoutes({
        stops: resolvedStops,
        matrix,
        maxBusCapacity: fleetCaps[0],
        fleetCapacities: fleetCaps,
        tripMode: "TO_DESTINATION",
        options: {
            destinationHub: anchorHub,
            activeInwardStartingPlaces,
            availableVehicles: data.availableVehicles
        }
    });

    console.log("Candidate routes count before consolidation:", candidateRoutes.length);

    // Test consolidation with targetRouteCount = 9 and fleet profile compatibility
    let currentRoutes = candidateRoutes.map(r => ({ ...r, stops: [...r.stops], users: [...r.users] }));
    const targetRouteCount = 9;

    let mergedAny = true;
    let rounds = 0;
    while (mergedAny && currentRoutes.length > targetRouteCount && rounds < 10) {
        mergedAny = false;
        rounds++;

        for (let i = 0; i < currentRoutes.length; i++) {
            for (let j = i + 1; j < currentRoutes.length; j++) {
                const rA = currentRoutes[i];
                const rB = currentRoutes[j];
                const combinedPax = rA.assignedUsers + rB.assignedUsers;

                if (combinedPax > fleetCaps[0]) continue;

                const prospectiveDemands = currentRoutes.map(r => {
                    if (r.routeId === rA.routeId) return combinedPax;
                    if (r.routeId === rB.routeId) return 0;
                    return r.assignedUsers;
                });

                if (!isCandidateDemandCompatibleWithFleetProfile(prospectiveDemands, fleetCaps)) {
                    continue;
                }

                console.log(`Inward merge: ${rA.stops.map(s=>s.name).join("+")} (${rA.assignedUsers}) + ${rB.stops.map(s=>s.name).join("+")} (${rB.assignedUsers}) => ${combinedPax}`);
                currentRoutes[i] = {
                    ...rA,
                    stops: [...rA.stops, ...rB.stops],
                    assignedUsers: combinedPax,
                    users: [...rA.users, ...rB.users]
                };
                currentRoutes.splice(j, 1);
                mergedAny = true;
                break;
            }
            if (mergedAny) break;
        }
    }

    console.log("\nAfter consolidation down to 9 routes: count =", currentRoutes.length);
    currentRoutes.forEach((r, idx) => {
        console.log(`Route ${idx + 1}: pax=${r.assignedUsers}, stops=${r.stops.map(s=>s.name).join(", ")}`);
    });

    const { assignedRoutes, unassignedRoutes } = assignVehiclesToOptimizedRoutes({
        routes: currentRoutes,
        availableVehicles: data.availableVehicles,
        tripMode: "TO_DESTINATION",
        activeInwardStartingPlaces
    });

    console.log("\nAssigned routes:", assignedRoutes.length);
    console.log("Unassigned routes:", unassignedRoutes.length);
    let totalAssigned = 0;
    assignedRoutes.forEach(r => {
        console.log(` - Bus ${r.vehicleName} (cap ${r.capacity}): assignedUsers=${r.assignedUsers}, stops=${r.stops.map(s=>s.name).join(", ")}`);
        totalAssigned += r.assignedUsers;
    });
    console.log("Total assigned users:", totalAssigned);

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
