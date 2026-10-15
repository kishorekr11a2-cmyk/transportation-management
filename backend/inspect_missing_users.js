import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import connectDB from "./config/db.js";
import User from "./models/User.js";
import Stop from "./models/Stop.js";
import Vehicle from "./models/Vehicle.js";
import Schedule from "./models/Schedule.js";
import Route from "./models/Route.js";
import AiPlan from "./models/AiPlan.js";

async function main() {
    await connectDB();

    const comingUsers = await User.find({ travelStatus: "Coming" }).sort({ userId: 1 }).lean();
    console.log(`Total Coming users: ${comingUsers.length}`);

    // Check last 15 users
    console.log("\nLast 15 coming users:");
    comingUsers.slice(-15).forEach(u => {
        console.log(`- ${u.name} (userId: ${u.userId}): stoppings="${u.stoppings}", city="${u.city}", dist="${u.district}"`);
    });

    // Breakdown of stoppings across ALL coming users
    const stoppingsCount = {};
    for (const u of comingUsers) {
        const s = (u.stoppings || "NO_STOPPING").trim();
        stoppingsCount[s] = (stoppingsCount[s] || 0) + 1;
    }
    console.log("\nStoppings breakdown for all 427 Coming users:", stoppingsCount);

    // Check all Stops in Stop collection
    const stopsInDb = await Stop.find().lean();
    console.log(`\nStops in Stop collection (${stopsInDb.length}):`);
    stopsInDb.forEach(s => {
        console.log(`- "${s.name}" (lat: ${s.latitude}, lng: ${s.longitude})`);
    });

    // Check recent AiPlan buses and which users they have
    const plan = await mongoose.connection.db.collection("ai_selected_plans").findOne({ "plan.assignedUsers": 422 });
    if (plan) {
        console.log("\nFound plan with 422 assigned users!");
        const assignedSet = new Set();
        (plan.plan?.buses || []).forEach(b => {
            (b.users || []).forEach(u => {
                assignedSet.add(String(u._id || u.id || u.userId || u.name));
            });
        });
        console.log(`Assigned set size: ${assignedSet.size}`);
        const missing = comingUsers.filter(u => !assignedSet.has(String(u._id)) && !assignedSet.has(String(u.userId)) && !assignedSet.has(u.name));
        console.log(`Missing ${missing.length} users:`, missing.map(m => ({
            name: m.name,
            userId: m.userId,
            stoppings: m.stoppings,
            city: m.city,
            district: m.district
        })));
    } else {
        console.log("\nNo plan with assignedUsers: 422 found in ai_selected_plans. Checking AiPlan collection...");
        const aiPlan422 = await AiPlan.findOne({ assignedUsers: 422 }).lean();
        if (aiPlan422) {
            console.log("Found AiPlan with 422 assigned users!");
            const assignedSet = new Set();
            (aiPlan422.buses || []).forEach(b => {
                (b.users || []).forEach(u => {
                    assignedSet.add(String(u._id || u.id || u.userId || u.name));
                });
            });
            const missing = comingUsers.filter(u => !assignedSet.has(String(u._id)) && !assignedSet.has(String(u.userId)) && !assignedSet.has(u.name));
            console.log(`Missing ${missing.length} users:`, missing.map(m => ({
                name: m.name,
                userId: m.userId,
                stoppings: m.stoppings,
                city: m.city
            })));
        }
    }

    // Now check vehicles in DB
    const vehicles = await Vehicle.find().lean();
    console.log(`\nVehicles in Vehicle collection: ${vehicles.length}`);
    vehicles.forEach(v => {
        console.log(` - ${v.vehicleName || v.vehicleNumber}: cap=${v.capacity || v.seatCapacity}, status=${v.status}`);
    });

    // Check Schedules in DB
    const schedules = await Schedule.find().lean();
    console.log(`\nSchedules in Schedule collection: ${schedules.length}`);
    schedules.forEach(s => {
        console.log(` - ${s.routeCode || s.routeName}: assignedVehicle=${s.assignedVehicle}, status=${s.status}, dir=${s.direction}`);
    });

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
