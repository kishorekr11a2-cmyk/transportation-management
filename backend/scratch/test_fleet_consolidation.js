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
    consolidateInwardCandidateRoutes,
    isCandidateDemandCompatibleWithFleetProfile,
    assignVehiclesToOptimizedRoutes,
    insertStopNearestCost
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

    console.log("Fleet capacities:", fleetCaps);

    let candidateRoutes = generateGlobalCandidateRoutes({
        stops: resolvedStops,
        matrix,
        maxBusCapacity: fleetCaps[0],
        fleetCapacities: fleetCaps,
        tripMode: "FROM_SOURCE",
        options: { sourceHub: anchorHub }
    });

    console.log("Initial candidate routes count:", candidateRoutes.length);

    // Let's test custom consolidation with fleet profile check:
    function customConsolidate(routes, targetCount, fleetCaps) {
        let currentRoutes = routes.map(r => ({
            ...r,
            stops: [...r.stops],
            users: [...r.users]
        }));

        while (currentRoutes.length > targetCount) {
            currentRoutes.sort((a, b) => a.assignedUsers - b.assignedUsers);
            let merged = false;

            for (let i = 0; i < currentRoutes.length && !merged; i++) {
                const sourceRoute = currentRoutes[i];
                // Try to merge all stops of sourceRoute into another route
                // or each stop into viable routes
                const otherRoutes = currentRoutes.filter(r => r.routeId !== sourceRoute.routeId);

                // Check whole route absorption or stop-by-stop
                for (const target of otherRoutes) {
                    const combinedPax = target.assignedUsers + sourceRoute.assignedUsers;
                    const prospectiveDemands = currentRoutes.map(r => {
                        if (r.routeId === target.routeId) return combinedPax;
                        if (r.routeId === sourceRoute.routeId) return 0;
                        return r.assignedUsers;
                    });

                    if (isCandidateDemandCompatibleWithFleetProfile(prospectiveDemands, fleetCaps)) {
                        console.log(`Compatible merge found: ${sourceRoute.stops.map(s=>s.name).join("+")} (${sourceRoute.assignedUsers} pax) -> ${target.stops.map(s=>s.name).join("+")} (${target.assignedUsers} pax) => combined ${combinedPax}`);
                        target.stops.push(...sourceRoute.stops);
                        target.assignedUsers = combinedPax;
                        target.users.push(...sourceRoute.users);
                        currentRoutes = currentRoutes.filter(r => r.routeId !== sourceRoute.routeId);
                        merged = true;
                        break;
                    }
                }
            }

            if (!merged) {
                console.log("Could not find whole route merge, testing stop-by-stop absorption...");
                // Test stop-by-stop absorption
                break;
            }
        }
        return currentRoutes;
    }

    const res = customConsolidate(candidateRoutes, 9, fleetCaps);
    console.log("\nAfter customConsolidate: count =", res.length);
    res.forEach((r, idx) => {
        console.log(`Route ${idx+1}: pax=${r.assignedUsers}, stops=${r.stops.map(s=>s.name).join(", ")}`);
    });

    const { assignedRoutes, unassignedRoutes } = assignVehiclesToOptimizedRoutes({
        routes: res,
        availableVehicles: effectiveVehicles,
        tripMode: "FROM_SOURCE"
    });

    console.log("\nAssigned routes:", assignedRoutes.length);
    console.log("Unassigned routes:", unassignedRoutes.length);
    assignedRoutes.forEach(r => {
        console.log(` - Bus ${r.vehicleName} (cap ${r.capacity}): assignedUsers=${r.assignedUsers}, stops=${r.stops.map(s=>s.name).join(", ")}`);
    });

    const totalAssigned = assignedRoutes.reduce((s, r) => s + r.assignedUsers, 0);
    console.log("Total assigned users:", totalAssigned);

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
