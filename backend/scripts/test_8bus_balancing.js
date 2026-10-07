import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";
import { generateAgentRecommendations } from "../services/aiAgentService.js";
import { DEFAULT_SOURCE_HUB } from "../services/mapGeocodingService.js";

async function test() {
    await connectDB();
    console.log("=== Testing with 8 buses constraint / balancing ===");
    const resIn = await generateAgentRecommendations({
        direction: "INWARD",
        tripMode: "TO_DESTINATION",
        destination: DEFAULT_SOURCE_HUB
    });
    console.log("Inward result:", resIn.success, "buses:", resIn.aiPlan?.buses?.length);
    (resIn.aiPlan?.buses || []).forEach((b, i) => {
        console.log(`  Bus ${b.vehicleName}: ${b.assignedUsers}/${b.capacity} (${b.standingPassengers || 0} standing) - ${b.whySeparateRouteNeeded}`);
    });

    const resOut = await generateAgentRecommendations({
        direction: "OUTWARD",
        tripMode: "FROM_SOURCE",
        source: DEFAULT_SOURCE_HUB,
        oppositePlan: resIn.aiPlan
    });
    console.log("\nOutward result:", resOut.success, "buses:", resOut.aiPlan?.buses?.length);
    (resOut.aiPlan?.buses || []).forEach((b, i) => {
        console.log(`  Bus ${b.vehicleName}: ${b.assignedUsers}/${b.capacity} (${b.standingPassengers || 0} standing) - ${b.whySeparateRouteNeeded}`);
    });
    process.exit(0);
}
test().catch(e => { console.error(e); process.exit(1); });
