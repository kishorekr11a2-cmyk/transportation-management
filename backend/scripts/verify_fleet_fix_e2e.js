import mongoose from "mongoose";
import dotenv from "dotenv";
import connectDB from "../config/db.js";
import { generateAgentRecommendations, saveSelectedPlan } from "../services/aiAgentService.js";
import { executeGlobalRouteOptimization } from "../services/routeOptimizationService.js";
import User from "../models/User.js";
import Vehicle from "../models/Vehicle.js";
import Schedule from "../models/Schedule.js";
import InwardStartingPlace from "../models/InwardStartingPlace.js";

dotenv.config();

async function runVerification() {
    await connectDB();
    console.log("Connected to MongoDB.");

    const klnce = {
        name: "K. L. N. College of Engineering",
        address: "Pottapalayam, Sivagangai / Madurai - 630612",
        latitude: 9.8515,
        longitude: 78.1882
    };

    console.log("\n=======================================================");
    console.log("TEST 1: Run OUTWARD Optimization via generateAgentRecommendations");
    console.log("=======================================================");

    const outRes = await generateAgentRecommendations({
        source: klnce,
        direction: "OUTWARD",
        activeEndpoint: "source"
    });

    console.log("OUTWARD Result Success:", outRes.success);
    if (!outRes.success) {
        console.error("OUTWARD Error:", outRes.message, outRes.diagnostic);
        process.exit(1);
    }

    const outPlan = outRes.aiPlan;
    const outSummary = outRes.summary;

    console.log("\n--- OUTWARD METRICS AUDIT ---");
    console.log("Confirmed Students:", outSummary.confirmedUsers);
    console.log("Available Vehicles:", outSummary.availableVehicles);
    console.log("Buses Allocated:", outPlan.buses.length);
    console.log("Theoretical Min Buses:", outSummary.minimumCapacityBuses);
    console.log("Feasible/Allocated Bus Count:", outSummary.allocatedBusCount);
    console.log("Allocated Seats:", outSummary.allocatedSeats);
    console.log("Allocated Students:", outSummary.allocatedUsers);
    console.log("Unallocated Students:", outSummary.unallocatedUsers);
    console.log("Standing Passengers:", outPlan.totalStandingPassengers);
    console.log("Actual Seat Utilization:", outSummary.seatUtilization + "%");
    console.log("Calculated Seat Utilization (422/472):", ((outSummary.allocatedUsers / outSummary.allocatedSeats) * 100).toFixed(2) + "%");
    console.log("Plan Certification Status:", outPlan.certification?.status);
    console.log("Plan isCertified:", outPlan.certification?.isCertified);

    console.log("\nBus details:");
    outPlan.buses.forEach(b => {
        console.log(`  [${b.routeCode}] ${b.vehicleName} (Cap: ${b.capacity}) => Pax: ${b.assignedUsers}, Stops: ${b.stops.length}, Dist: ${b.routeDistanceKm}km, Continuous: ${b.isContinuous}`);
    });

    if (outSummary.unallocatedUsers > 0) {
        console.error(`FAIL: ${outSummary.unallocatedUsers} students remain unallocated in OUTWARD plan!`);
        process.exit(1);
    }
    if (outSummary.allocatedUsers !== 422) {
        console.error(`FAIL: Expected 422 allocated students, got ${outSummary.allocatedUsers}`);
        process.exit(1);
    }
    if (outPlan.buses.length !== 9) {
        console.error(`FAIL: Expected 9 buses allocated, got ${outPlan.buses.length}`);
        process.exit(1);
    }
    console.log(">>> PASS: OUTWARD 100% Demand Allocated (422/422 students on 9 buses, 89.41% utilization, 0 unallocated)!");

    console.log("\n=======================================================");
    console.log("TEST 2: Run INWARD Optimization via generateAgentRecommendations");
    console.log("=======================================================");

    const inRes = await generateAgentRecommendations({
        destination: klnce,
        direction: "INWARD",
        activeEndpoint: "destination",
        oppositePlan: outPlan
    });

    console.log("INWARD Result Success:", inRes.success);
    if (!inRes.success) {
        console.error("INWARD Error:", inRes.message, inRes.diagnostic);
        process.exit(1);
    }

    const inPlan = inRes.aiPlan;
    const inSummary = inRes.summary;

    console.log("\n--- INWARD METRICS AUDIT ---");
    console.log("Confirmed Students:", inSummary.confirmedUsers);
    console.log("Available Vehicles:", inSummary.availableVehicles);
    console.log("Buses Allocated:", inPlan.buses.length);
    console.log("Theoretical Min Buses:", inSummary.minimumCapacityBuses);
    console.log("Feasible/Allocated Bus Count:", inSummary.allocatedBusCount);
    console.log("Allocated Seats:", inSummary.allocatedSeats);
    console.log("Allocated Students:", inSummary.allocatedUsers);
    console.log("Unallocated Students:", inSummary.unallocatedUsers);
    console.log("Standing Passengers:", inPlan.totalStandingPassengers);
    console.log("Actual Seat Utilization:", inSummary.seatUtilization + "%");
    console.log("Calculated Seat Utilization (422/472):", ((inSummary.allocatedUsers / inSummary.allocatedSeats) * 100).toFixed(2) + "%");
    console.log("Vehicle Reuse Count:", inSummary.reusedBusCount);

    console.log("\nBus details:");
    inPlan.buses.forEach(b => {
        console.log(`  [${b.routeCode}] ${b.vehicleName} (Cap: ${b.capacity}) => Pax: ${b.assignedUsers}, Stops: ${b.stops.length}, Start: ${b.startLocation?.name || b.stops[0]?.name}, Dist: ${b.routeDistanceKm}km`);
    });

    if (inSummary.unallocatedUsers > 0) {
        console.error(`FAIL: ${inSummary.unallocatedUsers} students remain unallocated in INWARD plan!`);
        process.exit(1);
    }
    if (inSummary.allocatedUsers !== 422) {
        console.error(`FAIL: Expected 422 allocated students, got ${inSummary.allocatedUsers}`);
        process.exit(1);
    }
    console.log(">>> PASS: INWARD 100% Demand Allocated (422/422 students, 0 unallocated)!");

    console.log("\n=======================================================");
    console.log("TEST 3: Approval Gate Validation (Zero-Unallocated Gate)");
    console.log("=======================================================");

    // 3A: Attempt to save an uncertified partial plan (e.g. 150 unallocated) - MUST BE REJECTED
    const fakePartialPlan = {
        ...outPlan,
        unassignedUsers: 150,
        allocatedUsers: 272,
        certification: {
            isCertified: false,
            checks: {
                noPassengerUnallocated: false,
                capacitiesNotExceeded: true
            },
            failureReasons: ["150 passengers unallocated"]
        }
    };

    const rejectRes = await saveSelectedPlan({
        planType: "AI",
        direction: "OUTWARD",
        plan: fakePartialPlan
    });

    console.log("Partial plan rejection response:", { success: rejectRes.success, code: rejectRes.code, message: rejectRes.message });
    if (rejectRes.success !== false || (rejectRes.code !== "UNCERTIFIED_PLAN")) {
        console.error("FAIL: Partial plan with unallocated passengers was not rejected by approval gate!");
        process.exit(1);
    }
    console.log(">>> PASS: Approval Gate correctly blocked uncertified partial plan!");

    console.log("\n=======================================================");
    console.log("ALL VERIFICATIONS COMPLETED SUCCESSFULLY!");
    console.log("=======================================================");
    process.exit(0);
}

runVerification().catch(err => {
    console.error("Verification failed with exception:", err);
    process.exit(1);
});
