import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";
import AiPlan from "../models/AiPlan.js";

async function main() {
    await connectDB();
    const latestPlan = await AiPlan.findOne({
        $or: [{ direction: "OUTWARD" }, { tripMode: "OUTWARD" }, { tripMode: "FROM_SOURCE" }]
    }).sort({ createdAt: -1 }).lean();

    const buses = latestPlan?.aiPlan?.buses || latestPlan?.buses || [];
    console.log(`\n=== 12 ROUTES IN LATEST PLAN (Total: ${buses.length}) ===`);
    buses.forEach((b, idx) => {
        const stopsStr = (b.stops || []).map(s => `${s.name} (${s.userCount || (s.userIds || []).length}p)`).join(" -> ");
        console.log(`[R-${idx+1}] ${b.routeCode || b.vehicleName} (${b.vehicleName}): ${b.assignedUsers}/${b.capacity} pax | ${b.stops?.length} stops | ${b.routeDistanceKm?.toFixed(1) || '?'}km | Detour: ${b.detourRatio || '?'} | MaxPaxTime: ${b.longestPassengerTravelTime || '?'}m | Stops: ${stopsStr}`);
    });

    console.log("\n=== CANDIDATE FLEET EVALUATIONS ===");
    const evals = latestPlan?.aiPlan?.fleetBalancing?.candidateFleetEvaluations || latestPlan?.summary?.fleetBalancing?.candidateFleetEvaluations || [];
    evals.forEach(e => {
        console.log(`  ${e.busCount} buses: Capacity ${e.capacityStatus} (${e.fleetCapacity} seats), Routing ${e.routingStatus}, Travel Time ${e.travelTimeStatus} -> ${e.verdict} (reason: ${e.reason || 'N/A'})`);
    });

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
