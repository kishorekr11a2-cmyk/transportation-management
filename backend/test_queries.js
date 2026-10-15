import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import connectDB from "./config/db.js";
import AiPlan from "./models/AiPlan.js";

async function main() {
    await connectDB();
    
    // Test the exact queries in getActiveAIPlan
    const activeOutward = await AiPlan.findOne({
        active: true,
        direction: "OUTWARD",
        status: { $in: ["active", "pending_approval", "generated"] },
        planType: { $in: ["AI", "ADMIN", "MANUAL"] }
    }).select("-stoppingGroups -recommendations -manualPlan -aiPlan.routes -aiPlan.stoppingGroups -aiPlan.passengerAssignments -aiPlan.authoritativeAssignments -aiPlan.vehicles -aiPlan.finalAllocationResult").sort({ createdAt: -1 }).lean();
    console.log("activeOutward:", activeOutward?._id);

    const selectedOutward = await mongoose.connection.db.collection("ai_selected_plans").findOne({
        status: "active",
        active: true,
        approved: true,
        $or: [
            { direction: "OUTWARD" },
            { tripMode: "OUTWARD" },
            { tripMode: "FROM_SOURCE" },
            { "plan.direction": "OUTWARD" },
            { "plan.tripMode": "OUTWARD" },
            { "plan.tripMode": "FROM_SOURCE" }
        ]
    }, {
        projection: {
            "plan.routes": 0,
            "plan.stoppingGroups": 0,
            "plan.passengerAssignments": 0,
            "plan.vehicles": 0,
            "plan.recommendationsList": 0,
            "plan.sharedStoppingAreas": 0
        },
        sort: { active: -1, approved: -1, createdAt: -1 }
    });
    console.log("selectedOutward:", selectedOutward?._id, "planType:", selectedOutward?.planType, "hasBuses:", selectedOutward?.plan?.buses?.length);

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
