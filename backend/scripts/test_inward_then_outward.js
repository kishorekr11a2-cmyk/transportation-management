import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";
import { generateAgentRecommendations } from "../services/aiAgentService.js";

async function run() {
    await connectDB();
    const klnce = {
        name: "K. L. N. College of Engineering",
        address: "Pottapalayam, Sivagangai / Madurai - 630612",
        latitude: 9.8515,
        longitude: 78.1882
    };

    console.log("=== RUNNING INWARD ===");
    const inRes = await generateAgentRecommendations({
        tripMode: "TO_DESTINATION",
        direction: "INWARD",
        destination: klnce
    });

    console.log("Inward Success:", inRes.success);
    console.log("Inward Buses:", inRes.aiPlan?.buses?.length);
    (inRes.aiPlan?.buses || []).forEach(b => {
        console.log(`  - ${b.vehicleName}: ${b.assignedUsers}/${b.capacity} (${b.stops?.length} stops)`);
    });

    console.log("\n=== RUNNING OUTWARD (WITHOUT ACTIVE OPPOSITE PLAN) ===");
    const outRes1 = await generateAgentRecommendations({
        tripMode: "FROM_SOURCE",
        direction: "OUTWARD",
        source: klnce
    });
    console.log("Outward 1 Success:", outRes1.success);
    console.log("Outward 1 Buses:", outRes1.aiPlan?.buses?.length);
    (outRes1.aiPlan?.buses || []).forEach(b => {
        console.log(`  - ${b.vehicleName}: ${b.assignedUsers}/${b.capacity} (${b.stops?.length} stops)`);
    });

    console.log("\n=== RUNNING OUTWARD (WITH INWARD OPPOSITE PLAN PASSED) ===");
    const outRes2 = await generateAgentRecommendations({
        tripMode: "FROM_SOURCE",
        direction: "OUTWARD",
        source: klnce,
        oppositePlan: inRes.aiPlan
    });
    console.log("Outward 2 Success:", outRes2.success);
    console.log("Outward 2 Buses:", outRes2.aiPlan?.buses?.length);
    (outRes2.aiPlan?.buses || []).forEach(b => {
        console.log(`  - ${b.vehicleName}: ${b.assignedUsers}/${b.capacity} (${b.stops?.length} stops)`);
    });

    process.exit(0);
}

run().catch(e => {
    console.error(e);
    process.exit(1);
});
