import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";
import { generateAgentRecommendations } from "../services/aiAgentService.js";

async function runReport() {
    await connectDB();
    console.log("Generating fresh OUTWARD plan for live 421 users...");
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
    const summary = result.data?.summary || result.summary || plan?.summary;
    const buses = plan?.buses || [];

    const totalComing = summary?.confirmedUsers ?? summary?.comingUsers ?? 421;
    const allocatedPax = summary?.allocatedPassengers ?? summary?.allocatedUsers ?? 0;
    const busesUsed = buses.length;
    const allocatedCap = summary?.allocatedSeats ?? buses.reduce((s, b) => s + (b.capacity || 0), 0);
    const seatUtil = summary?.seatUtilization ?? ((allocatedPax / allocatedCap) * 100).toFixed(1);

    const longestPaxTime = summary?.longestPassengerTravelTime ?? Math.max(...buses.map(b => b.longestPassengerTravelTime || 0));
    const avgPaxTime = summary?.averagePassengerTravelTime ?? (buses.reduce((s, b) => s + (b.averagePassengerTravelTime || 0) * (b.assignedUsers || 0), 0) / (allocatedPax || 1)).toFixed(1);
    const paxWithin60 = summary?.passengersWithin60 ?? buses.reduce((s, b) => s + (b.passengersWithin60 || b.assignedUsers || 0), 0);
    const paxAbove60 = summary?.passengersAbove60 ?? buses.reduce((s, b) => s + (b.passengersAbove60 || 0), 0);

    const osrmContinuity = buses.every(b => b.isContinuous && b.isRoadVerified) ? "PASS" : "FAIL";
    const capValidation = buses.every(b => (b.assignedUsers || 0) <= b.capacity) ? "PASS" : "FAIL";
    const detourValidation = buses.every(b => (b.detourRatio || 1.0) <= 2.5) ? "PASS" : "FAIL";
    const ttValidation = (paxAbove60 === 0 && longestPaxTime <= 60.0) ? "PASS" : "FAIL";

    console.log("\n=================== FINAL TEST REPORT ===================");
    console.log(`Coming Users: ${totalComing}`);
    console.log(`Allocated: ${allocatedPax} / ${totalComing}`);
    console.log(`Buses: ${busesUsed}`);
    console.log(`Allocated Capacity: ${allocatedCap}`);
    console.log(`Seat Utilization: ${seatUtil}%`);
    console.log(``);
    console.log(`Routes: ${busesUsed}`);
    console.log(``);
    console.log(`Average Passenger Travel Time: ${avgPaxTime} min`);
    console.log(`Longest Passenger Travel Time: ${longestPaxTime} min`);
    console.log(`Passengers <= 60 min: ${paxWithin60} / ${totalComing}`);
    console.log(`Passengers > 60 min: ${paxAbove60} / ${totalComing}`);
    console.log(``);
    console.log(`OSRM Continuity: ${osrmContinuity}`);
    console.log(`Capacity Validation: ${capValidation}`);
    console.log(`Detour Validation: ${detourValidation}`);
    console.log(`Travel Time Validation: ${ttValidation}`);
    console.log("=========================================================\n");

    console.log("Per-route details:");
    buses.forEach((b, idx) => {
        console.log(`Route ${idx + 1} [${b.routeCode || b.vehicleName}]: ${b.assignedUsers}/${b.capacity} pax | Duration: ${b.totalRouteDuration || b.routeDurationMin}m | LongestPax: ${b.longestPassengerTravelTime}m | AvgPax: ${b.averagePassengerTravelTime}m | <=60m: ${b.passengersWithin60}/${b.assignedUsers} | >60m: ${b.passengersAbove60} | Detour: ${b.detourRatio}`);
    });

    console.log("\nFleet Candidate Feasibility Evaluation:");
    const evals = plan?.fleetBalancing?.candidateFleetEvaluations || [];
    evals.forEach(e => {
        console.log(`  ${e.busCount} buses: Capacity ${e.capacityStatus} (${e.fleetCapacity} seats), Routing ${e.routingStatus}, Travel Time ${e.travelTimeStatus} -> ${e.verdict}`);
    });

    process.exit(0);
}

runReport().catch(err => {
    console.error("Report run failed:", err);
    process.exit(1);
});
