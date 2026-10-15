import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import connectDB from "./config/db.js";
import { getActiveAIPlan } from "./services/aiAgentService.js";

async function main() {
    await connectDB();
    const res = await getActiveAIPlan({ direction: "OUTWARD", forceRefresh: true });
    console.log("res:", {
        success: res.success,
        wasReset: res.wasReset,
        plan: res.plan ? {
            id: res.plan._id,
            planType: res.plan.planType,
            active: res.plan.active,
            isApproved: res.plan.isApproved,
            isSubmitted: res.plan.isSubmitted,
            assignedUsers: res.plan.assignedUsers,
            buses: res.plan.buses?.length
        } : null,
        outwardPlan: res.outwardPlan ? {
            id: res.outwardPlan._id,
            planType: res.outwardPlan.planType,
            active: res.outwardPlan.active,
            isApproved: res.outwardPlan.isApproved,
            buses: res.outwardPlan.buses?.length
        } : null
    });
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
