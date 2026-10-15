import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import connectDB from "./config/db.js";
import AiPlan from "./models/AiPlan.js";

async function main() {
    await connectDB();
    const plans = await AiPlan.find({
        status: { $in: ["active", "pending_approval", "generated"] }
    }, {
        _id: 1,
        planType: 1,
        direction: 1,
        tripMode: 1,
        status: 1,
        active: 1,
        isApproved: 1,
        isSubmitted: 1,
        assignedUsers: 1,
        totalComingUsers: 1,
        totalCapacity: 1,
        createdAt: 1,
        buses: 1
    }).sort({ createdAt: -1 }).lean();

    console.log(`Active/Pending AiPlan documents (${plans.length}):`);
    plans.forEach(p => {
        console.log(`ID: ${p._id} | Type: ${p.planType} | Dir: ${p.direction} | Status: ${p.status} | Active: ${p.active} | Approved: ${p.isApproved} | Submitted: ${p.isSubmitted} | Assigned: ${p.assignedUsers} | Cap: ${p.totalCapacity} | Created: ${p.createdAt}`);
        console.log(`  Buses (${p.buses?.length}):`, p.buses?.map(b => `${b.routeName || b.busName || ''} (${b.vehicleName}: ${b.assignedUsers || 0}/${b.capacity})`).join(', '));
    });

    // Check ai_selected_plans where active is true or status is active/pending_approval
    const selected = await mongoose.connection.db.collection("ai_selected_plans").find({
        $or: [
            { active: true },
            { status: { $in: ["active", "pending_approval"] } }
        ]
    }, {
        projection: {
            _id: 1,
            direction: 1,
            tripMode: 1,
            status: 1,
            active: 1,
            approved: 1,
            isSubmitted: 1,
            planType: 1,
            "plan.planType": 1,
            "plan.direction": 1,
            "plan.status": 1,
            "plan.isApproved": 1,
            "plan.isSubmitted": 1,
            "plan.assignedUsers": 1,
            "plan.totalCapacity": 1,
            "plan.buses": 1,
            buses: 1,
            createdAt: 1,
            selectedAt: 1
        }
    }).sort({ selectedAt: -1, createdAt: -1 }).toArray();

    console.log(`\nActive/Pending ai_selected_plans documents (${selected.length}):`);
    selected.forEach(s => {
        const buses = s.plan?.buses || s.buses || [];
        console.log(`ID: ${s._id} | Dir: ${s.direction} | Status: ${s.status} | Active: ${s.active} | Approved: ${s.approved} | PlanType: ${s.planType || s.plan?.planType} | Assigned: ${s.plan?.assignedUsers} | Created: ${s.selectedAt || s.createdAt}`);
        console.log(`  Buses (${buses.length}):`, buses.map(b => `${b.routeName || b.busName || ''} (${b.vehicleName}: ${b.assignedUsers || 0}/${b.capacity})`).join(', '));
    });

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
