import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import AiPlan from "../models/AiPlan.js";
import Vehicle from "../models/Vehicle.js";
import User from "../models/User.js";

async function main() {
    await connectDB();
    const comingUsers = await User.countDocuments({ travelStatus: "Coming" });
    const activeVehicles = await Vehicle.find({ isActive: { $ne: false } }).lean();
    console.log("DB Coming Users:", comingUsers);
    console.log("DB Active Vehicles Count:", activeVehicles.length);
    console.log("DB Active Vehicles:", activeVehicles.map(v => `${v.vehicleName || v.name} (${v.capacity || v.seatCapacity} seats)`).join(", "));

    const latestPlan = await AiPlan.findOne({
        $or: [{ direction: "OUTWARD" }, { tripMode: "OUTWARD" }, { tripMode: "FROM_SOURCE" }]
    }).sort({ createdAt: -1 }).lean();

    if (!latestPlan) {
        console.log("No outward AiPlan found in DB");
    } else {
        console.log("\n--- LATEST OUTWARD AIPLAN IN DB ---");
        console.log("Created At:", latestPlan.createdAt);
        console.log("Total Coming:", latestPlan.confirmedUsersCount || latestPlan.totalComingUsers);
        console.log("Allocated Users:", latestPlan.assignedUsers || latestPlan.allocatedUsers);
        console.log("Buses Count:", latestPlan.buses?.length);
        console.log("Summary:", latestPlan.summary);
        console.log("Fleet Balancing:", latestPlan.fleetBalancing);
        (latestPlan.buses || []).forEach((b, idx) => {
            console.log(`Route ${idx+1} [${b.routeCode || b.vehicleName}]: ${b.assignedUsers}/${b.capacity} seats | Stops (${b.stops?.length}): ${b.stops?.map(s => `${s.name}(${s.userCount||(s.userIds||[]).length}p)`).join(" -> ")}`);
        });
    }
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
