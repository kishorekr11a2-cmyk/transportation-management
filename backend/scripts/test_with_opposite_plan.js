import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";
import { generateAgentRecommendations } from "../services/aiAgentService.js";
import AiPlan from "../models/AiPlan.js";

async function testWithOppositePlan() {
    await connectDB();

    // Check if there is an existing active Inward plan in the database
    const inwardPlanDoc = await AiPlan.findOne({
        direction: "INWARD",
        status: { $in: ["generated", "saved", "active"] }
    }).sort({ createdAt: -1 }).lean();

    console.log("Found Inward Plan Doc:", inwardPlanDoc ? `Yes, ID: ${inwardPlanDoc._id}, buses: ${inwardPlanDoc.plan?.buses?.length || inwardPlanDoc.buses?.length}` : "No");

    let oppositePlan = null;
    if (inwardPlanDoc) {
        oppositePlan = inwardPlanDoc.plan || inwardPlanDoc;
    } else {
        // Construct mock 7-bus inward plan matching user's description
        oppositePlan = {
            direction: "INWARD",
            buses: [
                { vehicleName: "k1", assignedUsers: 50, vehicleId: "6a71cc95cd7450a1e48f90e7" },
                { vehicleName: "D1", assignedUsers: 64, vehicleId: "6a773d66aa680f7e1029ffb8" },
                { vehicleName: "V1", assignedUsers: 70, vehicleId: "6a76fa36222e10aab56da2c3" },
                { vehicleName: "A2", assignedUsers: 70, vehicleId: "6a80695f75ca36c1ebb3cbc4" },
                { vehicleName: "I1", assignedUsers: 61, vehicleId: "6a7757cdc65c4a12719699bb" },
                { vehicleName: "J1", assignedUsers: 63, vehicleId: "6a8e98b7fd6bdcb166f71654" },
                { vehicleName: "w1", assignedUsers: 35, vehicleId: "6a77579ec65c4a12719699aa" }
            ]
        };
    }

    console.log("\n--- Testing Outward Recommendation with Opposite Inward Plan ---");
    const result = await generateAgentRecommendations({
        direction: "OUTWARD",
        source: {
            name: "KLN College of Engineering",
            address: "Pottapalayam, Sivagangai / Madurai - 630612",
            latitude: 9.8515,
            longitude: 78.1882
        },
        oppositePlan,
        persistPreview: false
    });

    const aiPlan = result.aiPlan;
    console.log(`\nGenerated Outward Buses Count: ${aiPlan?.buses?.length || 0}`);
    (aiPlan?.buses || []).forEach(b => {
        console.log(`  - Bus ${b.vehicleName}: ${b.assignedUsers}/${b.capacity} (${(b.stops || []).map(s => `${s.name}(${s.userCount})`).join(", ")})`);
    });

    process.exit(0);
}

testWithOppositePlan().catch(e => {
    console.error(e);
    process.exit(1);
});
