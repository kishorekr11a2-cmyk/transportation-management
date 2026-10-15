import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config({ path: "./backend/.env" });
import { buildManualTransportationPlan } from "./backend/services/aiAgentService.js";

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    const plan = await buildManualTransportationPlan({ direction: "OUTWARD" });
    console.log("\n=== OUTWARD MANUAL PLAN RESULTS ===");
    console.log("Total Coming Users:", plan.totalUsers || plan.confirmedUsers || plan.totalComingUsers);
    console.log("Total Assigned Users:", plan.assignedUsers);
    console.log("Total Unassigned Users:", plan.unassignedUsers);
    console.log("Total Capacity:", plan.totalCapacity);
    console.log("Buses count:", plan.buses?.length);
    console.log("Warnings:", plan.warnings);

    console.log("\n--- BUSES BREAKDOWN ---");
    let totalAssignedFromBuses = 0;
    (plan.buses || []).forEach((b) => {
        totalAssignedFromBuses += (b.assignedUsers || 0);
        console.log(`Route [${b.routeCode || b.routeId}] ${b.routeName} (Vehicle: ${b.vehicleName}, Cap: ${b.capacity}): Assigned: ${b.assignedUsers}, Rem: ${b.remainingSeats}`);
        const activeStops = (b.stops || []).filter(s => s.userCount > 0);
        console.log(`  Stops with users: ${activeStops.map(s => `${s.name}: ${s.userCount}`).join(", ")}`);
    });
    console.log("Sum of bus assignedUsers:", totalAssignedFromBuses);

    console.log("\n--- UNALLOCATED STUDENTS SAMPLE (First 20) ---");
    const unallocated = plan.unallocatedStudents || [];
    console.log(`Total unallocated array length: ${unallocated.length}`);
    unallocated.slice(0, 20).forEach(u => {
        console.log(`- ${u.name} (Stop: "${u.stoppings}", travelStatus: "${u.travelStatus}", manualRouteId: ${u.manualRouteId})`);
    });

    // Check stop names of unallocated vs stops in routes
    const allRouteStopNames = new Set();
    (plan.buses || []).forEach(b => (b.stops || []).forEach(s => allRouteStopNames.add(s.name.toLowerCase().trim())));
    console.log("\nUnique stop names across all 9 routes:", Array.from(allRouteStopNames));

    const unallocatedStopCounts = {};
    unallocated.forEach(u => {
        const stop = u.stoppings || "NO_STOP";
        unallocatedStopCounts[stop] = (unallocatedStopCounts[stop] || 0) + 1;
    });
    console.log("\nUnallocated student counts by stop:", unallocatedStopCounts);

    await mongoose.disconnect();
}

main().catch(console.error);
