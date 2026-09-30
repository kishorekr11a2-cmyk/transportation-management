import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import AiPlan from "../models/AiPlan.js";
import User from "../models/User.js";
import Route from "../models/Route.js";
import {
    getActiveAIPlan,
    getPlanStatus,
    resetGeneratedAIRoute,
    saveSelectedPlan,
    sanitizeTransportationPlan
} from "../services/aiAgentService.js";

describe("Persistent Route Plan & Approval State: Comprehensive Verification Suite (Tests A - E)", () => {
    let testStudent1;
    let testStudent2;

    const setStudentAllocation = async (studentId, direction, allocData, planType = "AI") => {
        const u = await User.findById(studentId).lean();
        const currentAlloc = (u?.allocatedBus && typeof u.allocatedBus === "object") ? u.allocatedBus : {};
        const dirKey = direction.toLowerCase();
        const updatedAlloc = {
            ...currentAlloc,
            [dirKey]: {
                ...allocData,
                direction,
                planType,
                isAllocated: true,
                approved: true,
                allocatedAt: new Date()
            },
            direction,
            isAllocated: true
        };
        await User.findByIdAndUpdate(studentId, {
            $set: {
                allocatedBus: updatedAlloc,
                approvedPlanType: planType
            }
        });
    };

    before(async () => {
        const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/test_ai_transportation";
        if (mongoose.connection.readyState === 0) {
            await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
        }

        // Clean slate for test artifacts and students
        await Promise.allSettled([
            AiPlan.deleteMany({ source: "TEST_SUITE_PERSISTENCE" }),
            mongoose.connection.db.collection("ai_selected_plans").deleteMany({ "plan.source": "TEST_SUITE_PERSISTENCE" }),
            mongoose.connection.db.collection("manual_plan_submissions").deleteMany({ source: "TEST_SUITE_PERSISTENCE" }),
            User.deleteMany({ $or: [{ userId: { $in: ["PTEST_USER_1", "PTEST_USER_2"] } }, { email: { $in: ["ptest1@example.com", "ptest2@example.com"] } }] })
        ]);

        // Create fresh test students
        testStudent1 = await User.create({
            userId: "PTEST_USER_1",
            name: "Persistence Test Student 1",
            email: "ptest1@example.com",
            role: "student",
            travelStatus: "Coming",
            stoppings: "Test Stop A",
            allocatedBus: {}
        });

        testStudent2 = await User.create({
            userId: "PTEST_USER_2",
            name: "Persistence Test Student 2",
            email: "ptest2@example.com",
            role: "student",
            travelStatus: "Coming",
            stoppings: "Test Stop B",
            allocatedBus: {}
        });
    });

    after(async () => {
        if (mongoose.connection.readyState !== 0) {
            await Promise.allSettled([
                AiPlan.deleteMany({ source: "TEST_SUITE_PERSISTENCE" }),
                mongoose.connection.db.collection("ai_selected_plans").deleteMany({ "plan.source": "TEST_SUITE_PERSISTENCE" }),
                mongoose.connection.db.collection("manual_plan_submissions").deleteMany({ source: "TEST_SUITE_PERSISTENCE" }),
                User.deleteMany({ email: { $in: ["ptest1@example.com", "ptest2@example.com"] } })
            ]);
            await mongoose.disconnect();
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST A: AI OUTWARD
    // ─────────────────────────────────────────────────────────────────────────
    test("Test A — AI OUTWARD: Generate -> Persist -> Reload -> Approve -> Reload -> Single Reset", async () => {
        // 1. Reset OUTWARD to clean initial state
        await resetGeneratedAIRoute({ direction: "OUTWARD" });

        // 2. Generate OUTWARD AI Plan matching live demand and store in MongoDB
        const liveDemand = await User.countDocuments({ role: "student", travelStatus: "Coming" });
        const outwardAiPlanData = sanitizeTransportationPlan({
            totalCapacity: 50,
            allocatedSeats: liveDemand,
            assignedUsers: liveDemand,
            unassignedUsers: 0,
            source: "TEST_SUITE_PERSISTENCE",
            certification: { isCertified: true, status: "OPTIMIZATION ENGINE SUCCESS" },
            buses: [
                {
                    busId: "TEST-OUT-BUS-1",
                    busNumber: "TN-58-OUT-01",
                    vehicleNumber: "TN-58-OUT-01",
                    capacity: 50,
                    allocatedSeats: liveDemand,
                    users: [String(testStudent1._id)],
                    stops: [{ stopName: "Test Stop A", userIds: [String(testStudent1._id)] }]
                }
            ]
        });

        const createdAiPlan = await AiPlan.create({
            active: true,
            status: "generated",
            planType: "AI",
            direction: "OUTWARD",
            tripMode: "FROM_SOURCE",
            source: "TEST_SUITE_PERSISTENCE",
            destination: { name: "Campus Hub", latitude: 9.9, longitude: 78.1 },
            summary: { totalUsers: liveDemand, confirmedUsers: liveDemand, allocatedSeats: liveDemand },
            aiPlan: outwardAiPlanData,
            generatedAt: new Date()
        });

        // 3. Verify plan appears in getActiveAIPlan
        const fetched1 = await getActiveAIPlan({ direction: "OUTWARD", forceRefresh: true });
        assert.equal(fetched1.success, true);
        assert.ok(fetched1.outwardPlan, "OUTWARD AI plan must be returned");
        assert.equal(fetched1.outwardPlan.status, "generated");

        // 4. Simulate browser close / multiple re-fetches (MongoDB persistence)
        for (let i = 0; i < 3; i++) {
            const reloaded = await getActiveAIPlan({ direction: "OUTWARD", forceRefresh: true });
            assert.ok(reloaded.outwardPlan, `Reload ${i + 1}: OUTWARD AI plan must still exist`);
            assert.equal(reloaded.outwardPlan._id.toString(), createdAiPlan._id.toString());
        }

        // 5. Verify getPlanStatus reports OUTWARD GENERATED
        const statusBeforeApproval = await getPlanStatus();
        assert.equal(statusBeforeApproval.success, true);
        assert.equal(statusBeforeApproval.outward.exists, true);
        assert.equal(statusBeforeApproval.outward.planType, "AI");
        assert.equal(statusBeforeApproval.outward.status, "GENERATED");
        assert.equal(statusBeforeApproval.outward.assigned, false);

        // 6. Approve / Assign the plan
        const saveRes = await saveSelectedPlan({
            planType: "AI",
            direction: "OUTWARD",
            tripMode: "FROM_SOURCE",
            approved: true,
            plan: { ...outwardAiPlanData, source: "TEST_SUITE_PERSISTENCE" },
            approvalEventId: `evt_${Date.now()}`
        });
        assert.equal(saveRes.success, true, "saveSelectedPlan must succeed");

        // Allocate student in User collection
        await setStudentAllocation(testStudent1._id, "OUTWARD", { busNumber: "TN-58-OUT-01" }, "AI");

        // 7. Simulate browser reopen -> verify APPROVED / ASSIGNED state remains
        const afterApproval = await getActiveAIPlan({ direction: "OUTWARD", forceRefresh: true });
        assert.equal(afterApproval.success, true);
        assert.ok(afterApproval.outwardPlan);
        assert.equal(afterApproval.outwardPlan.isApproved, true);

        const statusAfterApproval = await getPlanStatus();
        assert.equal(statusAfterApproval.outward.exists, true);
        assert.equal(statusAfterApproval.outward.planType, "AI");
        assert.equal(statusAfterApproval.outward.status, "APPROVED");
        assert.equal(statusAfterApproval.outward.assigned, true);

        // 8. Single Reset OUTWARD
        const resetRes = await resetGeneratedAIRoute({ direction: "OUTWARD" });
        assert.equal(resetRes.success, true);

        // 9. Re-fetch -> verify OUTWARD plan is completely cleared
        const postReset = await getActiveAIPlan({ direction: "OUTWARD", forceRefresh: true });
        assert.equal(postReset.success, true);
        assert.equal(postReset.outwardPlan, null, "OUTWARD plan must be null after single reset");

        const statusPostReset = await getPlanStatus();
        assert.equal(statusPostReset.outward.exists, false, "status.outward.exists must be false");
        assert.equal(statusPostReset.outward.status, "NO_PLAN");

        // Student travelStatus must remain intact
        const studentCheck = await User.findById(testStudent1._id);
        assert.equal(studentCheck.travelStatus, "Coming", "travelStatus must NOT be changed by reset");
        assert.equal(studentCheck.allocatedBus?.outward, undefined, "outward allocation must be cleared");
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST B: AI INWARD
    // ─────────────────────────────────────────────────────────────────────────
    test("Test B — AI INWARD: Generate -> Persist -> Reload -> Approve -> Reload -> Single Reset", async () => {
        await resetGeneratedAIRoute({ direction: "INWARD" });

        const liveDemandIn = await User.countDocuments({ role: "student", travelStatus: "Coming" });
        const inwardAiPlanData = sanitizeTransportationPlan({
            totalCapacity: 50,
            allocatedSeats: liveDemandIn,
            assignedUsers: liveDemandIn,
            unassignedUsers: 0,
            source: "TEST_SUITE_PERSISTENCE",
            certification: { isCertified: true, status: "OPTIMIZATION ENGINE SUCCESS" },
            buses: [
                {
                    busId: "TEST-IN-BUS-1",
                    busNumber: "TN-58-IN-01",
                    vehicleNumber: "TN-58-IN-01",
                    capacity: 50,
                    allocatedSeats: liveDemandIn,
                    users: [String(testStudent2._id)],
                    stops: [{ stopName: "Test Stop B", userIds: [String(testStudent2._id)] }]
                }
            ]
        });

        await AiPlan.create({
            active: true,
            status: "generated",
            planType: "AI",
            direction: "INWARD",
            tripMode: "TO_DESTINATION",
            source: "TEST_SUITE_PERSISTENCE",
            destination: { name: "College Main Gate", latitude: 9.92, longitude: 78.12 },
            summary: { totalUsers: liveDemandIn, confirmedUsers: liveDemandIn, allocatedSeats: liveDemandIn },
            aiPlan: inwardAiPlanData,
            generatedAt: new Date()
        });

        // Verify retrieval across reloads
        const fetched = await getActiveAIPlan({ direction: "INWARD", forceRefresh: true });
        assert.equal(fetched.success, true);
        assert.ok(fetched.inwardPlan, "INWARD AI plan must be returned");

        const statusGen = await getPlanStatus();
        assert.equal(statusGen.inward.exists, true);
        assert.equal(statusGen.inward.planType, "AI");
        assert.equal(statusGen.inward.status, "GENERATED");

        // Approve INWARD AI plan
        const saveRes = await saveSelectedPlan({
            planType: "AI",
            direction: "INWARD",
            tripMode: "TO_DESTINATION",
            approved: true,
            plan: { ...inwardAiPlanData, source: "TEST_SUITE_PERSISTENCE" },
            approvalEventId: `evt_${Date.now()}`
        });
        assert.equal(saveRes.success, true, "saveSelectedPlan must succeed for INWARD");

        await setStudentAllocation(testStudent2._id, "INWARD", { busNumber: "TN-58-IN-01" }, "AI");

        // Reopen / re-fetch -> verify APPROVED & ASSIGNED
        const afterApprovalIn = await getActiveAIPlan({ direction: "INWARD", forceRefresh: true });
        assert.equal(afterApprovalIn.success, true);
        assert.ok(afterApprovalIn.inwardPlan);
        assert.equal(afterApprovalIn.inwardPlan.isApproved, true);

        const statusApp = await getPlanStatus();
        assert.equal(statusApp.inward.exists, true);
        assert.equal(statusApp.inward.status, "APPROVED");
        assert.equal(statusApp.inward.assigned, true);

        // Reset INWARD
        const resetRes = await resetGeneratedAIRoute({ direction: "INWARD" });
        assert.equal(resetRes.success, true);

        const afterReset = await getActiveAIPlan({ direction: "INWARD", forceRefresh: true });
        assert.equal(afterReset.inwardPlan, null, "INWARD plan must be null after reset");

        const statusReset = await getPlanStatus();
        assert.equal(statusReset.inward.exists, false);
        assert.equal(statusReset.inward.status, "NO_PLAN");
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST C: MANUAL OUTWARD
    // ─────────────────────────────────────────────────────────────────────────
    test("Test C — Manual OUTWARD: Create & Submit -> Persist -> Approve -> Reload -> Reset", async () => {
        await resetGeneratedAIRoute({ direction: "OUTWARD" });

        // 1. Submit manual OUTWARD plan
        await mongoose.connection.db.collection("manual_plan_submissions").insertOne({
            direction: "OUTWARD",
            isSubmitted: true,
            submittedAt: new Date(),
            source: "TEST_SUITE_PERSISTENCE"
        });

        // 2. Verify getPlanStatus sees MANUAL PENDING_APPROVAL
        const statusSub = await getPlanStatus();
        assert.equal(statusSub.outward.exists, true);
        assert.equal(statusSub.outward.planType, "MANUAL");
        assert.equal(statusSub.outward.status, "PENDING_APPROVAL");
        assert.equal(statusSub.outward.assigned, false);

        // 3. Approve manual plan
        await mongoose.connection.db.collection("ai_selected_plans").insertOne({
            planType: "MANUAL",
            direction: "OUTWARD",
            tripMode: "FROM_SOURCE",
            approved: true,
            isApproved: true,
            active: true,
            status: "active",
            selectedAt: new Date(),
            plan: {
                direction: "OUTWARD",
                source: "TEST_SUITE_PERSISTENCE",
                buses: [{ busNumber: "MAN-OUT-01", assignedVehicle: { vehicleName: "Manual Bus 1", capacity: 40 } }]
            }
        });

        await setStudentAllocation(testStudent1._id, "OUTWARD", { busNumber: "MAN-OUT-01" }, "MANUAL");

        // 4. Verify getPlanStatus sees MANUAL APPROVED & ASSIGNED
        const statusApp = await getPlanStatus();
        assert.equal(statusApp.outward.exists, true);
        assert.equal(statusApp.outward.planType, "MANUAL");
        assert.equal(statusApp.outward.status, "APPROVED");
        assert.equal(statusApp.outward.assigned, true);

        // 5. Single Reset OUTWARD
        const resetRes = await resetGeneratedAIRoute({ direction: "OUTWARD" });
        assert.equal(resetRes.success, true);

        const statusReset = await getPlanStatus();
        assert.equal(statusReset.outward.exists, false);
        assert.equal(statusReset.outward.status, "NO_PLAN");

        // Verify manual_plan_submissions was deleted
        const remainingSub = await mongoose.connection.db.collection("manual_plan_submissions").findOne({ direction: "OUTWARD" });
        assert.equal(remainingSub, null, "manual_plan_submissions must be cleared after direction reset");
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST D: MANUAL INWARD
    // ─────────────────────────────────────────────────────────────────────────
    test("Test D — Manual INWARD: Create & Submit -> Persist -> Approve -> Reload -> Reset", async () => {
        await resetGeneratedAIRoute({ direction: "INWARD" });

        await mongoose.connection.db.collection("manual_plan_submissions").insertOne({
            direction: "INWARD",
            isSubmitted: true,
            submittedAt: new Date(),
            source: "TEST_SUITE_PERSISTENCE"
        });

        const statusSub = await getPlanStatus();
        assert.equal(statusSub.inward.exists, true);
        assert.equal(statusSub.inward.planType, "MANUAL");
        assert.equal(statusSub.inward.status, "PENDING_APPROVAL");

        await mongoose.connection.db.collection("ai_selected_plans").insertOne({
            planType: "MANUAL",
            direction: "INWARD",
            tripMode: "TO_DESTINATION",
            approved: true,
            isApproved: true,
            active: true,
            status: "active",
            selectedAt: new Date(),
            plan: {
                direction: "INWARD",
                source: "TEST_SUITE_PERSISTENCE",
                buses: [{ busNumber: "MAN-IN-01", assignedVehicle: { vehicleName: "Manual Bus Inward", capacity: 45 } }]
            }
        });

        await setStudentAllocation(testStudent2._id, "INWARD", { busNumber: "MAN-IN-01" }, "MANUAL");

        const statusApp = await getPlanStatus();
        assert.equal(statusApp.inward.exists, true);
        assert.equal(statusApp.inward.planType, "MANUAL");
        assert.equal(statusApp.inward.status, "APPROVED");
        assert.equal(statusApp.inward.assigned, true);

        // Reset INWARD
        const resetRes = await resetGeneratedAIRoute({ direction: "INWARD" });
        assert.equal(resetRes.success, true);

        const statusReset = await getPlanStatus();
        assert.equal(statusReset.inward.exists, false);
        assert.equal(statusReset.inward.status, "NO_PLAN");
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST E: DIRECTION ISOLATION
    // OUTWARD -> AI -> APPROVED
    // INWARD  -> MANUAL -> PENDING_APPROVAL
    // Reset OUTWARD -> OUTWARD becomes RESET, INWARD remains MANUAL PENDING!
    // ─────────────────────────────────────────────────────────────────────────
    test("Test E — Direction Isolation: OUTWARD (AI Approved) + INWARD (Manual Pending) -> Reset OUTWARD -> INWARD Untouched", async () => {
        // Clean both directions first
        await resetGeneratedAIRoute({ resetAll: true });

        // 1. Setup OUTWARD -> AI -> APPROVED
        const liveDemandIso = await User.countDocuments({ role: "student", travelStatus: "Coming" });
        const outwardAiPlanData = sanitizeTransportationPlan({
            totalCapacity: 50,
            allocatedSeats: liveDemandIso,
            assignedUsers: liveDemandIso,
            source: "TEST_SUITE_PERSISTENCE",
            certification: { isCertified: true, status: "OPTIMIZATION ENGINE SUCCESS" },
            buses: [
                {
                    busId: "TEST-ISO-OUT",
                    busNumber: "TN-58-ISO-OUT",
                    capacity: 50,
                    allocatedSeats: liveDemandIso,
                    users: [String(testStudent1._id)],
                    stops: [{ stopName: "Stop 1", userIds: [String(testStudent1._id)] }]
                }
            ]
        });

        await AiPlan.create({
            active: true,
            status: "active",
            isApproved: true,
            approvedAt: new Date(),
            planType: "AI",
            direction: "OUTWARD",
            tripMode: "FROM_SOURCE",
            source: "TEST_SUITE_PERSISTENCE",
            summary: { totalUsers: liveDemandIso, confirmedUsers: liveDemandIso, allocatedSeats: liveDemandIso },
            aiPlan: outwardAiPlanData
        });

        await saveSelectedPlan({
            planType: "AI",
            direction: "OUTWARD",
            tripMode: "FROM_SOURCE",
            approved: true,
            plan: { ...outwardAiPlanData, source: "TEST_SUITE_PERSISTENCE" },
            approvalEventId: `evt_iso_out_${Date.now()}`
        });

        await setStudentAllocation(testStudent1._id, "OUTWARD", { busNumber: "TN-58-ISO-OUT" }, "AI");

        // 2. Setup INWARD -> MANUAL -> PENDING_APPROVAL
        await mongoose.connection.db.collection("manual_plan_submissions").insertOne({
            direction: "INWARD",
            isSubmitted: true,
            submittedAt: new Date(),
            source: "TEST_SUITE_PERSISTENCE"
        });

        // 3. Verify BOTH states exist concurrently and independently
        const statusBoth = await getPlanStatus();
        assert.equal(statusBoth.success, true);
        assert.equal(statusBoth.outward.exists, true, "OUTWARD must exist");
        assert.equal(statusBoth.outward.planType, "AI", "OUTWARD must be AI");
        assert.equal(statusBoth.outward.status, "APPROVED", "OUTWARD must be APPROVED");
        assert.equal(statusBoth.outward.assigned, true, "OUTWARD must be assigned");

        assert.equal(statusBoth.inward.exists, true, "INWARD must exist");
        assert.equal(statusBoth.inward.planType, "MANUAL", "INWARD must be MANUAL");
        assert.equal(statusBoth.inward.status, "PENDING_APPROVAL", "INWARD must be PENDING_APPROVAL");
        assert.equal(statusBoth.inward.assigned, false, "INWARD must not be assigned yet");

        // 4. Reset OUTWARD ONLY
        console.log("Resetting OUTWARD only...");
        const resetOutwardRes = await resetGeneratedAIRoute({ direction: "OUTWARD" });
        assert.equal(resetOutwardRes.success, true);

        // 5. Verify OUTWARD is cleared, BUT INWARD is completely untouched!
        const statusAfterOutwardReset = await getPlanStatus();
        assert.equal(statusAfterOutwardReset.outward.exists, false, "OUTWARD must be cleared");
        assert.equal(statusAfterOutwardReset.outward.status, "NO_PLAN");

        assert.equal(statusAfterOutwardReset.inward.exists, true, "INWARD must still exist!");
        assert.equal(statusAfterOutwardReset.inward.planType, "MANUAL", "INWARD must remain MANUAL!");
        assert.equal(statusAfterOutwardReset.inward.status, "PENDING_APPROVAL", "INWARD must remain PENDING_APPROVAL!");

        // Verify INWARD manual submission document still exists in MongoDB
        const inwardSubDoc = await mongoose.connection.db.collection("manual_plan_submissions").findOne({ direction: "INWARD" });
        assert.ok(inwardSubDoc, "INWARD manual submission document must remain in MongoDB!");

        // Clean up remaining INWARD test artifacts
        await resetGeneratedAIRoute({ direction: "INWARD" });
    });
});
