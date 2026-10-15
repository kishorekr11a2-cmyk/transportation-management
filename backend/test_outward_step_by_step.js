import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import connectDB from "./config/db.js";
import User from "./models/User.js";
import {
    getAIData,
    calculateStoppingGroups,
    resolveStopCoordinates,
    getAvailableVehicles,
    canonicalizeCollegeHub
} from "./services/aiAgentService.js";
import { executeGlobalRouteOptimization } from "./services/routeOptimizationService.js";

const klnce = {
    name: "K. L. N. College of Engineering",
    address: "Pottapalayam, Sivagangai / Madurai - 630612",
    latitude: 9.8515,
    longitude: 78.1882
};

async function main() {
    await connectDB();
    const data = await getAIData({ forceRefresh: true });
    console.log("data.comingUsers:", data.comingUsers);
    console.log("data.availableVehicles:", data.availableVehicles.length);

    const anchorHub = canonicalizeCollegeHub(klnce);
    const confirmedUsers = data.users.filter(u => u.travelStatus === "Coming");
    console.log("Confirmed coming users:", confirmedUsers.length);

    const rawStoppingGroups = calculateStoppingGroups(confirmedUsers);
    const stoppingGroups = await resolveStopCoordinates(rawStoppingGroups, anchorHub);
    const resolvedStops = stoppingGroups.filter(s => typeof s.latitude === "number" && typeof s.longitude === "number");
    console.log("Resolved stops:", resolvedStops.length);
    const totalPaxInStops = resolvedStops.reduce((s, st) => s + (st.userIds?.length || st.userCount || 0), 0);
    console.log("Total pax in resolved stops:", totalPaxInStops);

    const result = await executeGlobalRouteOptimization({
        resolvedStops,
        anchorHub,
        availableVehicles: data.availableVehicles,
        tripMode: "FROM_SOURCE",
        options: {
            sourceHub: anchorHub
        }
    });

    console.log("\n=== OPTIMIZATION RESULT ===");
    console.log("Routes count:", result.routes?.length);
    let totalAssigned = 0;
    const allocatedUserIds = new Set();
    result.routes.forEach((r, idx) => {
        console.log(`Route ${idx + 1} (${r.vehicleName}): capacity=${r.capacity}, assignedUsers=${r.assignedUsers}, usersArr=${r.users?.length}, stops=${r.stops?.length}`);
        totalAssigned += r.assignedUsers;
        (r.stops || []).forEach(st => {
            console.log(`   Stop "${st.name}": userCount=${st.userCount}, userIds=${st.userIds?.length}`);
        });
        (r.users || []).forEach(u => allocatedUserIds.add(String(u._id || u.id || u.userId || u)));
    });
    console.log("Total assigned across all routes:", totalAssigned);
    console.log("Unique user IDs allocated:", allocatedUserIds.size);

    if (totalAssigned < totalPaxInStops) {
        console.log(`\n!!! MISMATCH: ${totalPaxInStops - totalAssigned} passengers missing!`);
        const missingUsers = confirmedUsers.filter(u => !allocatedUserIds.has(String(u._id)) && !allocatedUserIds.has(String(u.userId)));
        console.log(`Identified ${missingUsers.length} missing users:`);
        missingUsers.forEach(u => {
            console.log(` - ${u.name} (userId: ${u.userId}), stopping: "${u.stoppings}"`);
        });
    }

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
