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
    const rawStoppingGroups = calculateStoppingGroups(confirmedUsers);
    const stoppingGroups = await resolveStopCoordinates(rawStoppingGroups, anchorHub);
    const resolvedStops = stoppingGroups.filter(s => typeof s.latitude === "number" && typeof s.longitude === "number");

    console.log("Testing OUTWARD executeGlobalRouteOptimization...");
    const resultOutward = await executeGlobalRouteOptimization({
        resolvedStops,
        anchorHub,
        availableVehicles: data.availableVehicles,
        tripMode: "FROM_SOURCE",
        options: {
            sourceHub: anchorHub
        }
    });

    console.log("\n=== OUTWARD RESULT ===");
    console.log("Routes count:", resultOutward.routes?.length);
    let totalAssignedOut = 0;
    const allocatedUserIdsOut = new Set();
    resultOutward.routes.forEach((r, idx) => {
        console.log(`Route ${idx + 1} (${r.vehicleName}): capacity=${r.capacity}, assignedUsers=${r.assignedUsers}, usersArr=${r.users?.length}, stops=${r.stops?.length}`);
        totalAssignedOut += r.assignedUsers;
        (r.users || []).forEach(u => allocatedUserIdsOut.add(String(u._id || u.id || u.userId || u)));
    });
    console.log("Total assigned users:", totalAssignedOut);
    console.log("Unique user IDs allocated:", allocatedUserIdsOut.size);

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
