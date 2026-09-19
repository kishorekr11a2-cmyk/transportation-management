import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import User from "../models/User.js";
import Vehicle from "../models/Vehicle.js";
import Schedule from "../models/Schedule.js";
import AiPlan from "../models/AiPlan.js";
import { generateAgentRecommendations, getAvailableVehicles } from "../services/aiAgentService.js";

async function runRealDataSmokeTest() {
    console.log("==================================================================");
    console.log("  REAL-DATA SMOKE TEST: Map-Aware Route Optimization Engine Dry-Run");
    console.log("==================================================================");

    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
        throw new Error("MONGO_URI environment variable not configured in .env");
    }

    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB successfully.\n");

    try {
        // 1. Gather Real Database Metrics
        const totalUsers = await User.countDocuments();
        const comingUsers = await User.countDocuments({ travelStatus: "Coming" });
        const notComingUsers = await User.countDocuments({ travelStatus: "Not Coming" });
        const pendingUsers = await User.countDocuments({
            travelStatus: { $nin: ["Coming", "Not Coming"] }
        });

        const allVehicles = await Vehicle.find().lean();
        const allSchedules = await Schedule.find().lean();
        const availableVehicles = getAvailableVehicles(allVehicles, allSchedules);
        const unavailableVehicles = allVehicles.filter(
            v => !availableVehicles.some(av => av._id?.toString() === v._id?.toString())
        );

        // Distinct stopping areas from students
        const distinctStoppingAreas = (await User.distinct("stoppings")).filter(Boolean);

        console.log("--- Real Database Counts ---");
        console.log(`Total Users in DB:          ${totalUsers}`);
        console.log(`  - Coming Users:           ${comingUsers}`);
        console.log(`  - Not Coming Users:       ${notComingUsers}`);
        console.log(`  - Pending Users:          ${pendingUsers}`);
        console.log(`Total Vehicles in DB:       ${allVehicles.length}`);
        console.log(`  - Available Vehicles:     ${availableVehicles.length}`);
        console.log(`  - Unavailable Vehicles:   ${unavailableVehicles.length}`);
        console.log(`Distinct Stopping Areas:    ${distinctStoppingAreas.length}\n`);

        // Check active plan count before dry-run to ensure NO mutation
        const activePlansBefore = await AiPlan.countDocuments({ isActive: true });
        const approvedPlansBefore = await AiPlan.countDocuments({ approvalStatus: "APPROVED" });

        // 2. Call generateAgentRecommendations in dry-run mode
        console.log("--- Executing generateAgentRecommendations (DRY RUN / PREVIEW) ---");
        const startTime = Date.now();
        const recommendationResult = await generateAgentRecommendations({
            tripMode: "FROM_SOURCE",
            direction: "OUTWARD",
            source: {
                name: "K. L. N. College of Engineering",
                address: "Pottapalayam, Sivagangai / Madurai - 630612",
                latitude: 9.8515,
                longitude: 78.1882
            }
        });
        const durationMs = Date.now() - startTime;

        console.log(`Execution completed in ${durationMs} ms.\n`);

        // Verify that NO plans were saved or activated during preview
        const activePlansAfter = await AiPlan.countDocuments({ isActive: true });
        const approvedPlansAfter = await AiPlan.countDocuments({ approvalStatus: "APPROVED" });

        if (activePlansAfter !== activePlansBefore || approvedPlansAfter !== approvedPlansBefore) {
            console.error("CRITICAL SAFETY BREACH: generateAgentRecommendations altered active/approved plan records!");
            process.exit(1);
        } else {
            console.log("SAFETY VERIFIED: Zero plans saved, activated, or approved during dry-run.\n");
        }

        // 3. Inspect Recommendation Result
        const plan = recommendationResult?.aiPlan || recommendationResult?.plan || recommendationResult?.data?.plan;
        const buses = plan?.buses || [];
        const allocatedPassengers = buses.reduce((sum, b) => sum + (b.passengers?.length || b.allocatedSeats || b.assignedUsers || 0), 0);
        const totalBusCapacity = buses.reduce((sum, b) => sum + (b.capacity || 0), 0);
        const capacityUtilization = totalBusCapacity > 0 ? ((allocatedPassengers / totalBusCapacity) * 100).toFixed(1) + "%" : "N/A";

        // Check assigned user uniqueness
        const assignedUserIds = new Set();
        let duplicateCount = 0;
        buses.forEach(b => {
            (b.passengers || []).forEach(p => {
                const id = p.id || p.userId || p._id?.toString();
                if (id) {
                    if (assignedUserIds.has(id)) {
                        duplicateCount++;
                    }
                    assignedUserIds.add(id);
                }
            });
        });

        // Stops covered
        const coveredStops = new Set();
        buses.forEach(b => {
            (b.stops || []).forEach(s => {
                const name = typeof s === "string" ? s : (s.stopName || s.name);
                if (name) coveredStops.add(name);
            });
        });

        console.log("--- Recommendation Outcome Metrics ---");
        console.log(`Generated Routes:           ${buses.length}`);
        console.log(`Allocated Users:            ${allocatedPassengers}`);
        console.log(`Unique Allocated Users:     ${assignedUserIds.size}`);
        console.log(`Duplicate User Assignments: ${duplicateCount}`);
        console.log(`Unallocated Users:          ${recommendationResult.unallocatedUsers?.length ?? plan?.unassignedUsers ?? 0}`);
        console.log(`Total Capacity of Routes:   ${totalBusCapacity}`);
        console.log(`Capacity Utilization:       ${capacityUtilization}`);
        console.log(`Stopping Areas Covered:     ${coveredStops.size} / ${distinctStoppingAreas.length}`);
        console.log(`Uncovered Stopping Areas:   ${recommendationResult.uncoveredStoppingAreas?.length ?? 0}`);
        console.log(`Routing Source:             ${recommendationResult.routingSource || "N/A"}`);
        console.log(`Geometry Verified:          ${recommendationResult.geometryVerified}`);
        console.log(`Continuity Status:          ${recommendationResult.continuityStatus}`);
        console.log(`Requires Revalidation:      ${recommendationResult.requiresRevalidation}`);
        console.log(`Deadheading Km:             ${recommendationResult.deadheadingKm || 0} km`);
        console.log(`Backtracking Km:            ${recommendationResult.backtrackingKm || 0} km`);
        console.log(`Route Overlap Score:        ${recommendationResult.routeOverlapScore || 0}`);
        console.log(`Certification State:        ${plan?.certification?.isCertified ? "CERTIFIED" : "REQUIRES_REVIEW"}`);
        console.log(`Certification Reason:       ${plan?.certification?.reason}`);

        if (recommendationResult.warnings?.length > 0) {
            console.log("\nWarnings Reported:");
            recommendationResult.warnings.forEach((w, i) => console.log(`  ${i + 1}. ${w}`));
        }

        console.log("\n--- Per-Route Breakdown ---");
        buses.forEach((b, idx) => {
            const geomPoints = b.roadGeometry?.coordinates?.length || (Array.isArray(b.roadGeometry) ? b.roadGeometry.length : 0);
            console.log(`  Route ${idx + 1} (${b.routeNumber || b.busNumber || b.vehicleNumber}):`);
            console.log(`    - Assigned Vehicle: ${b.vehicleNumber || b.assignedVehicle || b.vehicleName} (Cap: ${b.capacity})`);
            console.log(`    - Assigned Passengers: ${b.passengers?.length || b.allocatedSeats || b.assignedUsers} / ${b.capacity}`);
            console.log(`    - Stop Count: ${(b.stops || []).length} stops`);
            console.log(`    - Road Geometry Points: ${geomPoints}`);
            console.log(`    - Distance / Duration: ${b.distanceKm || b.totalDistance || 0} km / ${b.durationMinutes || b.totalDuration || 0} mins`);
        });

        console.log("\n==================================================================");
        console.log("  REAL-DATA SMOKE TEST COMPLETED SUCCESSFULLY");
        console.log("==================================================================");
    } finally {
        await mongoose.disconnect();
    }
}

runRealDataSmokeTest().catch(err => {
    console.error("SMOKE TEST FAILED:", err);
    process.exit(1);
});
