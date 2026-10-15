import dotenv from "dotenv";
dotenv.config({ path: "./backend/.env" });
import connectDB from "./backend/config/db.js";
import User from "./backend/models/User.js";
import AiPlan from "./backend/models/AiPlan.js";
import Route from "./backend/models/Route.js";

async function main() {
    await connectDB();
    const totalUsers = await User.countDocuments();
    const roles = await User.aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }]);
    console.log("Total users:", totalUsers);
    console.log("Roles breakdown:", roles);

    const plans = await AiPlan.find().select("planType direction status confirmedUsers totalComingUsers assignedUsers summary buses.assignedUsers buses.capacity").lean();
    console.log("\nPlans in DB:", JSON.stringify(plans.map(p => ({
        id: p._id,
        planType: p.planType,
        direction: p.direction,
        status: p.status,
        confirmedUsers: p.confirmedUsers,
        totalComingUsers: p.totalComingUsers,
        assignedUsers: p.assignedUsers,
        summary: p.summary,
        busCount: p.buses?.length,
        busAssignedTotal: p.buses?.reduce((s, b) => s + (b.assignedUsers || 0), 0)
    })), null, 2));

    const manualRoutes = await Route.find().lean();
    console.log("\nManual Routes count:", manualRoutes.length);
    const manualAssignedUsers = manualRoutes.reduce((s, r) => s + (r.assignedUsers?.length || r.students?.length || 0), 0);
    console.log("Manual routes assigned users:", manualAssignedUsers);
    const manualSeats = manualRoutes.reduce((s, r) => s + (r.capacity || 0), 0);
    console.log("Manual routes total seats:", manualSeats);

    // Let's inspect attendance fields on users
    const sample = await User.findOne().lean();
    console.log("\nUser keys:", Object.keys(sample));
    console.log("Sample isComing:", sample.isComing);
    console.log("Sample attendance:", sample.attendance);

    const comingTotal = await User.countDocuments({ isComing: true });
    console.log("isComing: true count:", comingTotal);

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
