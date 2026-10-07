import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";
import { generateAgentRecommendations } from "../services/aiAgentService.js";

async function run() {
    await connectDB();
    const sourceHub = {
        name: "KLN College of Engineering",
        address: "Pottapalayam, Sivagangai / Madurai - 630612",
        latitude: 9.8515,
        longitude: 78.1882
    };
    console.log("Connected to DB, running generateAgentRecommendations({ tripMode: 'OUTWARD', source: sourceHub })...");
    const result = await generateAgentRecommendations({ tripMode: "OUTWARD", source: sourceHub });
    if (result?.error) console.log("Result error:", result.error, result.message);
    const plan = result?.plan || result?.aiPlan || result?.data || result;
    console.log("Plan keys:", Object.keys(plan || {}));
    const buses = plan.buses || plan.routes || [];
    console.log(`\nResult Plan buses count: ${buses.length}, total allocated: ${buses.reduce((s, b) => s + (b.assignedUsers || 0), 0)}`);
    buses.forEach((b, idx) => {
        const stopNames = (b.stops || []).map(s => `${s.name} (${s.userCount || s.passengerCount || 0}p)`).join(" -> ");
        console.log(`\nBus ${idx + 1}: ${b.vehicleName} [${b.assignedUsers}/${b.capacity} seats]`);
        console.log(`  Stops (${b.stops?.length}): ${stopNames}`);
        console.log(`  Shared corridor: ${b.hasSharedCorridor ? b.sharedRouteSegment : "None"}`);
        console.log(`  Route quality: Reversals=${b.routeQuality?.directionalReversals}, Backtracking=${b.routeQuality?.backtrackingDistanceKm}km, Detour=${b.routeQuality?.detourRatio}x`);
    });

    console.log("\n=== AUDIT TRAIL ===");
    (plan.consolidationAudit || []).forEach(a => {
        console.log(`[${a.action}] ${a.reason || JSON.stringify(a)}`);
    });
    process.exit(0);
}

run().catch(err => {
    console.error("Error running test:", err);
    process.exit(1);
});
