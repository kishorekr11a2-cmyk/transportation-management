import mongoose from "mongoose";
import dotenv from "dotenv";
import { generateAgentRecommendations, getAIData } from "./services/aiAgentService.js";
import connectDB from "./config/db.js";

dotenv.config();

async function testOptimization() {
    try {
        await connectDB();
        console.log("Connected to DB successfully.\n");

        // 1. Test getAIData
        console.log("=== STEP 1: Testing getAIData() ===");
        const aiData = await getAIData();
        console.log("Total Users:", aiData.userCount);
        console.log("Coming Users:", aiData.confirmedUserCount);
        console.log("Total Vehicles:", aiData.vehicleCount);
        console.log("Available Vehicles:", aiData.availableVehicleCount);
        console.log("Total Physical Capacity:", aiData.totalPhysicalCapacity);
        console.log("Total Available Capacity:", aiData.totalAvailableCapacity);
        console.log("Stopping Groups Count:", aiData.stops?.length);

        // 2. Test generateAgentRecommendations (Outward: College -> Residential)
        console.log("\n=== STEP 2: Testing Outward AI Optimization (College -> Residential) ===");
        const payloadOutward = {
            tripMode: "FROM_SOURCE",
            source: {
                name: "K. L. N. College of Engineering",
                address: "Pottapalayam, Madurai - 630612",
                latitude: 9.8515,
                longitude: 78.1882
            }
        };

        const resultOutward = await generateAgentRecommendations(payloadOutward);
        console.log("Outward Success:", resultOutward.success);
        if (!resultOutward.success) {
            console.error("Outward Generation Error:", resultOutward);
            return;
        }

        const summary = resultOutward.summary;
        console.log("Summary:");
        console.log("  - Confirmed Coming Demand:", summary.confirmedUsers);
        console.log("  - Allocated Users:", summary.allocatedUsers);
        console.log("  - Unallocated Users:", summary.unallocatedUsers);
        console.log("  - Unique Stopping Areas:", summary.uniqueStoppingAreas);
        console.log("  - Total Route Stop Visits:", summary.totalRouteStopVisits);
        console.log("  - Shared Stops:", summary.sharedStopCount);
        console.log("  - Allocated Seats:", summary.allocatedSeats);
        console.log("  - Available Seats:", summary.totalAvailableCapacity);
        console.log("  - Vehicles Assigned:", resultOutward.aiPlan.buses.length);
        console.log("  - Certification Status:", resultOutward.aiPlan.certification?.status);
        console.log("  - Certification Checks:", resultOutward.aiPlan.certification?.checks);

        console.log("\nRoute Breakdown:");
        resultOutward.aiPlan.buses.forEach((b, idx) => {
            console.log(`\n--- Route ${b.routeCode} (${b.vehicleName}) ---`);
            console.log(`  Sector: ${b.sectorName}`);
            console.log(`  Assigned Passengers: ${b.assignedUsers} / ${b.capacity} (Seats Left: ${b.remainingSeats})`);
            console.log(`  Distance: ${b.routeDistanceKm} km (Baseline: ${b.straightLineBaselineKm} km)`);
            console.log(`  Stop Visits Count: ${b.stops?.length}`);
            console.log(`  Sample Stops:`, b.stops.slice(0, 3).map(s => `${s.name} (${s.passengersDropped || s.userCount} dropped, ${s.passengersRemaining} left)`));
        });

        // 3. Test duplicate check
        console.log("\n=== STEP 3: Verifying Zero Passenger Duplication ===");
        const allAssignedIds = [];
        resultOutward.aiPlan.buses.forEach(b => {
            (b.users || []).forEach(uid => allAssignedIds.push(String(uid)));
        });
        const uniqueIds = new Set(allAssignedIds);
        console.log("Total Passenger Assignments:", allAssignedIds.length);
        console.log("Unique Passenger IDs:", uniqueIds.size);
        console.log("Duplicate Count:", allAssignedIds.length - uniqueIds.size);

        if (allAssignedIds.length === uniqueIds.size && allAssignedIds.length === summary.confirmedUsers) {
            console.log("✅ 100% PERFECT: Every confirmed passenger is assigned exactly once with ZERO duplicates!");
        } else {
            console.log("⚠️ Discrepancy in passenger assignment accounting.");
        }

        await mongoose.disconnect();
        console.log("\nDB disconnected. Test complete.");
    } catch (err) {
        console.error("Test Error:", err);
    }
}

testOptimization();
