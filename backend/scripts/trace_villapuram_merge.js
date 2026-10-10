import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });
import connectDB from "../config/db.js";
import { generateAgentRecommendations } from "../services/aiAgentService.js";

async function run() {
    await connectDB();
    console.log("Tracing OUTWARD generation and route consolidation...");
    const result = await generateAgentRecommendations({
        direction: "OUTWARD",
        source: {
            name: "K. L. N. College of Engineering",
            address: "Pottapalayam, Sivagangai / Madurai - 630612",
            latitude: 9.8515,
            longitude: 78.1882
        },
        persistPreview: false
    });

    const plan = result.data?.plan || result.plan || result.aiPlan;
    const buses = plan?.buses || [];
    console.log(`\nGenerated ${buses.length} buses:`);
    buses.forEach((b, i) => {
        console.log(`\nBus ${i + 1}: ${b.routeCode} (${b.vehicleName}, cap: ${b.capacity}, assigned: ${b.assignedUsers})`);
        console.log(`  Stops: ${(b.stops || []).map(s => `${s.name} (${s.userCount || s.passengerCount || s.userIds?.length || 0} pax)`).join(" -> ")}`);
        console.log(`  Duration: ${b.totalRouteDuration || b.routeDurationMin} min | Distance: ${b.routeDistanceKm} km`);
        console.log(`  Longest pax: ${b.longestPassengerTravelTime} min | All <= 60: ${b.allPassengersWithin60}`);
    });

    process.exit(0);
}

run().catch(e => {
    console.error(e);
    process.exit(1);
});
