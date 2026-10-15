import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import connectDB from "./config/db.js";
import AiPlan from "./models/AiPlan.js";

async function main() {
    await connectDB();
    console.log("Connected to DB");

    // Check AiPlan collections
    const plans = await AiPlan.find({}, {
        planType: 1,
        direction: 1,
        status: 1,
        isSubmitted: 1,
        isApproved: 1,
        assignedUsers: 1,
        totalComingUsers: 1,
        totalCapacity: 1,
        "buses.routeId": 1,
        "buses.routeName": 1,
        "buses.busName": 1,
        "buses.vehicleName": 1,
        "buses.vehicleId": 1,
        "buses.capacity": 1,
        "buses.assignedUsers": 1,
        "buses.remainingSeats": 1,
        "buses.users.length": 1,
        createdAt: 1,
        updatedAt: 1
    }).lean();

    console.log(`\n=== AIPLAN SUMMARY (${plans.length}) ===`);
    plans.forEach(p => {
        console.log(`Plan ID: ${p._id}`);
        console.log(`  type: ${p.planType}, dir: ${p.direction}, status: ${p.status}, submitted: ${p.isSubmitted}, approved: ${p.isApproved}`);
        console.log(`  assignedUsers: ${p.assignedUsers}, totalComing: ${p.totalComingUsers}, totalCap: ${p.totalCapacity}`);
        console.log(`  buses count: ${p.buses?.length}`);
        if (p.buses) {
            p.buses.forEach(b => {
                console.log(`    Bus: routeName="${b.routeName}", busName="${b.busName}", veh="${b.vehicleName}", cap=${b.capacity}, assigned=${b.assignedUsers}, remaining=${b.remainingSeats}`);
            });
        }
    });

    const selected = await mongoose.connection.db.collection("ai_selected_plans").find({}, {
        projection: {
            direction: 1,
            tripMode: 1,
            active: 1,
            status: 1,
            approved: 1,
            "plan.direction": 1,
            "plan.status": 1,
            "plan.isSubmitted": 1,
            "plan.isApproved": 1,
            "plan.totalCapacity": 1,
            "plan.assignedUsers": 1,
            "plan.buses.routeName": 1,
            "plan.buses.busName": 1,
            "plan.buses.vehicleName": 1,
            "plan.buses.capacity": 1,
            "plan.buses.assignedUsers": 1,
            "plan.buses.remainingSeats": 1
        }
    }).toArray();

    console.log(`\n=== AI_SELECTED_PLANS SUMMARY (${selected.length}) ===`);
    selected.forEach(s => {
        console.log(`Selected Plan ID: ${s._id}`);
        console.log(`  dir: ${s.direction}, tripMode: ${s.tripMode}, active: ${s.active}, status: ${s.status}, approved: ${s.approved}`);
        console.log(`  plan: dir=${s.plan?.direction}, status=${s.plan?.status}, sub=${s.plan?.isSubmitted}, app=${s.plan?.isApproved}, assigned=${s.plan?.assignedUsers}, cap=${s.plan?.totalCapacity}`);
        if (s.plan?.buses) {
            s.plan.buses.forEach(b => {
                console.log(`    Bus: route="${b.routeName}", busName="${b.busName}", veh="${b.vehicleName}", cap=${b.capacity}, assigned=${b.assignedUsers}, rem=${b.remainingSeats}`);
            });
        }
    });

    const manualSubs = await mongoose.connection.db.collection("manual_plan_submissions").find({}, {
        projection: {
            direction: 1,
            isSubmitted: 1,
            status: 1,
            busesCount: { $size: { $ifNull: ["$buses", []] } }
        }
    }).toArray();
    console.log(`\n=== MANUAL_PLAN_SUBMISSIONS (${manualSubs.length}) ===`);
    console.log(manualSubs);

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
