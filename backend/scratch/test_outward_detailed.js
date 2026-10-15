import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";
import {
    getAIData,
    calculateStoppingGroups,
    resolveStopCoordinates,
    canonicalizeCollegeHub
} from "../services/aiAgentService.js";
import { executeGlobalRouteOptimization } from "../services/routeOptimizationService.js";

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
    console.log("Confirmed coming users count:", confirmedUsers.length);

    const rawStoppingGroups = calculateStoppingGroups(confirmedUsers);
    const stoppingGroups = await resolveStopCoordinates(rawStoppingGroups, anchorHub);
    const resolvedStops = stoppingGroups.filter(s => typeof s.latitude === "number" && typeof s.longitude === "number");
    const totalPaxInStops = resolvedStops.reduce((sum, s) => sum + (Array.isArray(s.userIds) ? s.userIds.length : (s.userCount || 0)), 0);
    console.log("Total pax in resolved stops:", totalPaxInStops);

    console.log("Available vehicles:", data.availableVehicles.map(v => `${v.vehicleName || v.name}(${v.capacity})`));

    const result = await executeGlobalRouteOptimization({
        resolvedStops,
        anchorHub,
        availableVehicles: data.availableVehicles,
        tripMode: "FROM_SOURCE",
        options: {
            sourceHub: anchorHub
        }
    });

    console.log("\nFleet balancing:", result.fleetBalancing);
    console.log("Route count:", result.routes.length);
    let totalAssigned = 0;
    result.routes.forEach((r, idx) => {
        console.log(`Route ${idx + 1} (${r.vehicleName}): capacity=${r.capacity}, assignedUsers=${r.assignedUsers}, usersArr=${r.users?.length}`);
        totalAssigned += r.assignedUsers;
    });
    console.log("Total assigned:", totalAssigned);
    if (result.unassignedRoutes && result.unassignedRoutes.length > 0) {
        console.log("Unassigned routes:", result.unassignedRoutes.map(u => ({ name: u.routeName, pax: u.assignedUsers })));
    }

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
