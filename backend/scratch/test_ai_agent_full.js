import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";
import { generateAgentRecommendations, getAIData } from "../services/aiAgentService.js";

const klnce = {
    name: "K. L. N. College of Engineering",
    address: "Pottapalayam, Sivagangai / Madurai - 630612",
    latitude: 9.8515,
    longitude: 78.1882
};

async function main() {
    await connectDB();
    const data = await getAIData({ forceRefresh: true });
    const confirmedCount = data.users.filter(u => u.travelStatus === "Coming").length;
    console.log(`Authoritative confirmed 'Coming' users in DB: ${confirmedCount}`);

    console.log("\n==================== 1. TESTING OUTWARD AI GENERATION ====================");
    const outwardRes = await generateAgentRecommendations({
        source: klnce,
        direction: "OUTWARD"
    });

    if (!outwardRes.success) {
        throw new Error(`Outward generation failed: ${outwardRes.message}`);
    }

    console.log(`Outward Direction: ${outwardRes.direction}`);
    console.log(`Summary Confirmed Users: ${outwardRes.summary?.confirmedUsers}`);
    console.log(`Summary Allocated Users: ${outwardRes.summary?.allocatedUsers}`);
    console.log(`Summary Unallocated Users: ${outwardRes.summary?.unallocatedUsers}`);
    console.log(`Summary Allocated Buses: ${outwardRes.summary?.allocatedBusCount}`);
    console.log(`Summary Allocated Seats / Total Capacity: ${outwardRes.summary?.allocatedSeats}`);
    console.log(`Summary Seat Utilization: ${outwardRes.summary?.seatUtilization}%`);
    console.log(`Summary Over Capacity Count: ${outwardRes.finalAllocationResult?.overCapacityCount || 0}`);
    console.log(`Summary Standing Passengers: ${outwardRes.finalAllocationResult?.totalStanding || 0}`);

    const outwardBuses = outwardRes.aiPlan?.buses || [];
    let outwardAssignedUsers = 0;
    outwardBuses.forEach((b, idx) => {
        console.log(`  Route ${idx + 1} (${b.busName || b.vehicleName}): capacity=${b.capacity}, assignedUsers=${b.assignedUsers}, usersArr=${b.users?.length}`);
        outwardAssignedUsers += b.assignedUsers;
    });
    console.log(`Total assigned across outward buses: ${outwardAssignedUsers}`);

    if (outwardAssignedUsers !== confirmedCount) {
        throw new Error(`Mismatch! Outward assigned (${outwardAssignedUsers}) !== confirmed (${confirmedCount})`);
    }

    console.log("\n==================== 2. TESTING INWARD AI GENERATION ====================");
    const inwardRes = await generateAgentRecommendations({
        destination: klnce,
        direction: "INWARD"
    });

    if (!inwardRes.success) {
        throw new Error(`Inward generation failed: ${inwardRes.message}`);
    }

    console.log(`Inward Direction: ${inwardRes.direction}`);
    console.log(`Summary Confirmed Users: ${inwardRes.summary?.confirmedUsers}`);
    console.log(`Summary Allocated Users: ${inwardRes.summary?.allocatedUsers}`);
    console.log(`Summary Unallocated Users: ${inwardRes.summary?.unallocatedUsers}`);
    console.log(`Summary Allocated Buses: ${inwardRes.summary?.allocatedBusCount}`);
    console.log(`Summary Allocated Seats / Total Capacity: ${inwardRes.summary?.allocatedSeats}`);
    console.log(`Summary Seat Utilization: ${inwardRes.summary?.seatUtilization}%`);
    console.log(`Summary Over Capacity Count: ${inwardRes.finalAllocationResult?.overCapacityCount || 0}`);
    console.log(`Summary Standing Passengers: ${inwardRes.finalAllocationResult?.totalStanding || 0}`);

    const inwardBuses = inwardRes.aiPlan?.buses || [];
    let inwardAssignedUsers = 0;
    inwardBuses.forEach((b, idx) => {
        console.log(`  Route ${idx + 1} (${b.busName || b.vehicleName}): capacity=${b.capacity}, assignedUsers=${b.assignedUsers}, usersArr=${b.users?.length}`);
        inwardAssignedUsers += b.assignedUsers;
    });
    console.log(`Total assigned across inward buses: ${inwardAssignedUsers}`);

    if (inwardAssignedUsers !== confirmedCount) {
        throw new Error(`Mismatch! Inward assigned (${inwardAssignedUsers}) !== confirmed (${confirmedCount})`);
    }

    console.log("\n==================== ALL CHECKS PASSED PERFECTLY ====================");
    process.exit(0);
}

main().catch(err => {
    console.error("TEST FAILED:", err);
    process.exit(1);
});
