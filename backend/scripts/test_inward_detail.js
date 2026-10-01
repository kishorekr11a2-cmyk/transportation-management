import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";
import { generateAgentRecommendations } from "../services/aiAgentService.js";

async function testInward() {
    await connectDB();
    const dest = {
        name: "KLN College of Engineering",
        address: "Pottapalayam, Sivagangai / Madurai - 630612",
        latitude: 9.8515,
        longitude: 78.1882
    };

    console.log("Generating Inward plan...");
    const res = await generateAgentRecommendations({
        tripMode: "TO_DESTINATION",
        direction: "INWARD",
        destination: dest
    });

    console.log("Success:", res.success);
    if (!res.success) {
        console.log("Message:", res.message);
        console.log("Assertions:", res.assertions || res.diagnostic);
    } else {
        console.log("Buses:", res.aiPlan?.buses?.length);
        res.aiPlan?.buses?.forEach(b => {
            console.log(`Bus ${b.vehicleName}: ${b.assignedUsers}/${b.capacity} (${b.stops?.map(s => s.name).join(", ")})`);
        });
    }

    process.exit(0);
}

testInward().catch(e => {
    console.error(e);
    process.exit(1);
});
