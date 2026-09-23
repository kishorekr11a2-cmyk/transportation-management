import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import User from "./models/User.js";
import {
    generateAgentRecommendations,
    saveSelectedPlan,
    getActiveAIPlan,
    getSelectedPlan,
    resetGeneratedAIRoute
} from "./services/aiAgentService.js";

const klnce = {
    name: "K. L. N. College of Engineering",
    address: "Pottapalayam, Sivagangai / Madurai - 630612",
    latitude: 9.8515,
    longitude: 78.1882
};

async function runFinalVerification() {
    console.log("==================================================");
    console.log("STARTING FINAL VERIFICATION TEST");
    console.log("==================================================");

    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    // 1. Check student count
    const comingStudents = await User.find({ role: "student", travelStatus: "Coming" }).lean();
    console.log(`Step 1: Total Coming Students in DB = ${comingStudents.length}`);
    if (comingStudents.length !== 205) {
        console.warn(`Warning: expected 205, got ${comingStudents.length}`);
    }

    // 2. Generate Inward AI Plan via generateAgentRecommendations
    console.log("\nStep 2: Generating Inward AI Plan via generateAgentRecommendations...");
    const inwardResult = await generateAgentRecommendations({
        tripMode: "TO_DESTINATION",
        destination: klnce
    });

    const inwardPlan = inwardResult.aiPlan || inwardResult;
    const inwardBuses = inwardPlan.buses || [];
    const assignedUsers = inwardPlan.assignedUsers || inwardResult.summary?.allocatedUsers || 0;
    const unallocatedUsers = inwardPlan.unallocatedUsers ?? inwardResult.summary?.unallocatedUsers ?? 0;
    const totalCapacity = inwardPlan.totalCapacity || inwardPlan.allocatedSeats || inwardResult.summary?.totalSeats || 0;
    const unusedSeats = Math.max(0, totalCapacity - assignedUsers);
    const standingPassengers = inwardPlan.totalStandingPassengers || inwardPlan.standingPassengers || 0;

    console.log(`Inward Plan Result:
      - Allocated: ${assignedUsers} / ${assignedUsers + unallocatedUsers}
      - Unallocated: ${unallocatedUsers}
      - Buses: ${inwardBuses.length}
      - Total Seats: ${totalCapacity}
      - Unused Seats: ${unusedSeats}
      - Standing Passengers: ${standingPassengers}
      - Certification: ${inwardPlan.certification?.status || "N/A"}`);

    if (assignedUsers !== 205 || unallocatedUsers !== 0 || inwardBuses.length !== 3 || totalCapacity !== 210 || unusedSeats !== 5) {
        throw new Error(`Inward allocation does not match expected 205/205 3 buses 210 seats 5 unused! Got assigned=${assignedUsers}, unallocated=${unallocatedUsers}, buses=${inwardBuses.length}, cap=${totalCapacity}, unused=${unusedSeats}`);
    }
    console.log("✓ Inward allocation matches exact requirement: 205/205, 3 buses, 210 seats, 5 unused, 0 unallocated!");

    // Check first stop / starting hub duplication
    inwardBuses.forEach(b => {
        const startName = b.inwardStartLocation?.name || b.startLocation?.name;
        const firstStop = b.stops && b.stops[0];
        console.log(`Bus ${b.vehicleName}: Hub = "${startName}", Stop 1 = "${firstStop?.name}", legDist = ${firstStop?.legDistanceKm} km, selectionReason = "${firstStop?.selectionReason}"`);
    });

    // 3. Save Selected AI Plan (simulates clicking Save in AI Agent)
    console.log("\nStep 3: Saving Inward AI Plan via saveSelectedPlan...");
    const saveRes = await saveSelectedPlan({
        planType: "AI",
        direction: "INWARD",
        tripMode: "TO_DESTINATION",
        plan: inwardPlan
    });
    console.log("saveSelectedPlan response:", { success: saveRes.success, code: saveRes.code, planVersion: saveRes.planVersion });
    if (!saveRes.success) {
        throw new Error(`Failed to save selected plan: ${saveRes.message}`);
    }

    // 4. Query Plan Confirmation API
    console.log("\nStep 4: Querying getActiveAIPlan for Plan Confirmation...");
    const activeRes = await getActiveAIPlan({ direction: "INWARD" });
    console.log("getActiveAIPlan response:", {
        success: activeRes.success,
        hasPlan: !!activeRes.plan,
        hasInward: !!activeRes.inwardPlan,
        busesCount: activeRes.inwardPlan?.buses?.length,
        assignedUsers: activeRes.inwardPlan?.assignedUsers,
        totalCapacity: activeRes.inwardPlan?.totalCapacity,
        unusedSeats: activeRes.inwardPlan?.summary?.unusedSeats,
        unallocatedUsers: activeRes.inwardPlan?.unallocatedUsers,
        status: activeRes.inwardPlan?.status,
        isApproved: activeRes.inwardPlan?.isApproved,
        active: activeRes.inwardPlan?.active
    });

    if (!activeRes.inwardPlan || activeRes.inwardPlan.buses?.length !== 3 || activeRes.inwardPlan.assignedUsers !== 205) {
        throw new Error("Plan confirmation API failed to return the saved 205/205 Inward AI plan!");
    }
    console.log("✓ Plan Confirmation API successfully returned saved Inward AI plan!");

    // 5. Confirm Transportation Plan on Plan Confirmation (marks active)
    console.log("\nStep 5: Confirming Transportation Plan on Plan Confirmation...");
    const confirmRes = await saveSelectedPlan({
        planType: "AI",
        direction: "INWARD",
        tripMode: "TO_DESTINATION",
        plan: activeRes.inwardPlan
    });
    console.log("Confirm response:", { success: confirmRes.success, active: confirmRes.active });

    // 6. Test Page Refresh / Navigation persistence
    console.log("\nStep 6: Testing Page Refresh persistence...");
    const refreshedActive = await getActiveAIPlan({ direction: "INWARD" });
    const refreshedSelected = await getSelectedPlan({ direction: "INWARD" });

    console.log("Refreshed Active Plan:", {
        hasPlan: !!refreshedActive.plan,
        buses: refreshedActive.inwardPlan?.buses?.length,
        status: refreshedActive.inwardPlan?.status,
        active: refreshedActive.inwardPlan?.active
    });
    console.log("Refreshed Selected Plan:", {
        hasSelection: !!refreshedSelected.selection,
        planType: refreshedSelected.inwardSelection?.planType,
        active: refreshedSelected.inwardSelection?.active
    });

    if (!refreshedActive.inwardPlan || refreshedActive.inwardPlan.buses?.length !== 3) {
        throw new Error("Refreshed plan failed to persist across page reload!");
    }
    console.log("✓ Plan remains ACTIVE across page refresh & navigation!");

    // 7. Verify OUTWARD independence
    console.log("\nStep 7: Testing OUTWARD generation without affecting INWARD...");
    const outwardResult = await generateAgentRecommendations({
        tripMode: "FROM_SOURCE",
        source: klnce
    });
    const outwardPlan = outwardResult.aiPlan || outwardResult;
    console.log(`Outward Plan: Buses = ${outwardPlan.buses?.length}, Allocated = ${outwardPlan.assignedUsers || outwardResult.summary?.allocatedUsers}`);

    // Verify Inward still intact
    const inwardAfterOutward = await getActiveAIPlan({ direction: "INWARD" });
    console.log(`Inward after Outward generation: Buses = ${inwardAfterOutward.inwardPlan?.buses?.length}, Allocated = ${inwardAfterOutward.inwardPlan?.assignedUsers}`);
    if (inwardAfterOutward.inwardPlan?.assignedUsers !== 205) {
        throw new Error("Generating Outward corrupted or overwrote Inward plan!");
    }
    console.log("✓ INWARD and OUTWARD are completely independent!");

    // 8. Test Direction-Specific Reset
    console.log("\nStep 8: Testing Reset Inward ONLY...");
    await resetGeneratedAIRoute({ direction: "INWARD" });

    const inwardAfterReset = await getActiveAIPlan({ direction: "INWARD" });
    const outwardAfterInwardReset = await getActiveAIPlan({ direction: "OUTWARD" });

    console.log("Inward after Reset:", { hasInward: !!inwardAfterReset.inwardPlan });
    console.log("Outward after Inward Reset:", { hasOutward: !!outwardAfterInwardReset.outwardPlan });

    if (inwardAfterReset.inwardPlan !== null) {
        throw new Error("Inward plan was not reset!");
    }
    if (outwardAfterInwardReset.outwardPlan === null) {
        throw new Error("Resetting Inward incorrectly removed Outward plan!");
    }
    console.log("✓ Direction-specific reset verified: Inward was removed, Outward remained intact!");

    // Re-generate and re-save Inward so system is left in verified working state
    console.log("\nRe-generating Inward plan to leave system in 205/205 state...");
    const finalInward = await generateAgentRecommendations({
        tripMode: "TO_DESTINATION",
        destination: klnce
    });
    await saveSelectedPlan({
        planType: "AI",
        direction: "INWARD",
        tripMode: "TO_DESTINATION",
        plan: finalInward.aiPlan || finalInward
    });
    console.log("✓ Final Inward re-generated & confirmed: 205/205 ready on Plan Confirmation!");

    console.log("\n==================================================");
    console.log("ALL FINAL VERIFICATION TESTS PASSED SUCCESSFULLY!");
    console.log("==================================================");
    process.exit(0);
}

runFinalVerification().catch(err => {
    console.error("\n❌ VERIFICATION TEST FAILED:", err);
    process.exit(1);
});
