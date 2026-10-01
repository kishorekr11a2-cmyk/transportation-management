import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";
import { generateAgentRecommendations } from "../services/aiAgentService.js";

async function runLiveOutwardTest() {
    await connectDB();
    console.log("Running generateAgentRecommendations for OUTWARD...");
    const result = await generateAgentRecommendations({
        direction: "OUTWARD",
        source: {
            name: "KLN College of Engineering",
            address: "Pottapalayam, Sivagangai / Madurai - 630612",
            latitude: 9.8515,
            longitude: 78.1882
        },
        persistPreview: false
    });

    console.log("\nSuccess:", result.success);
    console.log("Code:", result.code);
    console.log("Message:", result.message);
    const plan = result.data?.plan || result.plan;
    console.log("Summary:", result.data?.summary || result.summary);
    console.log(`Plan Buses (${plan?.buses?.length || 0}):`);
    (plan?.buses || []).forEach(b => {
        console.log(`  - ${b.vehicleName || b.routeCode}: ${b.assignedUsers}/${b.capacity} (${(b.stops || []).map(s => `${s.name}(${s.userCount})`).join(", ")})`);
    });

    process.exit(0);
}

runLiveOutwardTest().catch(e => {
    console.error("Error running test:", e);
    process.exit(1);
});
