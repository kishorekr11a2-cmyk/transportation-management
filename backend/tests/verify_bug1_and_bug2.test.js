import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import User from "../models/User.js";
import AiPlan from "../models/AiPlan.js";
import Route from "../models/Route.js";
import LateResponseEvent from "../models/LateResponseEvent.js";
import {
    generateAgentRecommendations,
    getActiveAIPlan,
    getPlanStatus,
    resetGeneratedAIRoute
} from "../services/aiAgentService.js";
import {
    handleStudentTravelStatusSubmission,
    resetAllUsersTravelStatus
} from "../controllers/userController.js";
import {
    findStudentByWhatsAppJid,
    parseIncomingTravelResponse,
    getWhatsAppStatus
} from "../whatsapp/whatsappService.js";

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/Transport";

test.before(async () => {
    if (mongoose.connection.readyState === 0) {
        await mongoose.connect(MONGO_URI);
    }
});

test.after(async () => {
    // Clean up any test users
    await User.deleteMany({ userId: { $regex: /^TEST_BUG_/ } });
    await AiPlan.deleteMany({ "summary.testTag": "BUG_VERIFICATION_TEST" });
    if (mongoose.connection.db) {
        await mongoose.connection.db.collection("ai_selected_plans").deleteMany({ "plan.summary.testTag": "BUG_VERIFICATION_TEST" });
    }
    await LateResponseEvent.deleteMany({ userId: { $regex: /^TEST_BUG_/ } });
    await mongoose.disconnect();
});

test("BUG 1 — Test A: Approved Outward Plan -> Late Coming -> Reset Required -> Regeneration Clears Stale Flag", async () => {
    // 1. Create test student
    const testUserId = "TEST_BUG_STUDENT_01";
    await User.deleteOne({ userId: testUserId });
    await LateResponseEvent.deleteMany({ userId: testUserId });

    const student = await User.create({
        userId: testUserId,
        name: "Test Bug Student 1",
        phoneNumber: "919876543210",
        role: "student",
        stoppings: "Test Stop A",
        travelStatus: "Coming"
    });

    // 2. Simulate an approved, active Outward AI plan
    const initialApprovalTime = new Date(Date.now() - 3600000); // 1 hour ago
    const oldPlanDoc = await AiPlan.create({
        active: true,
        status: "active",
        planType: "AI",
        direction: "OUTWARD",
        tripMode: "FROM_SOURCE",
        isSubmitted: true,
        isApproved: true,
        approvedAt: initialApprovalTime,
        generatedAt: initialApprovalTime,
        summary: {
            testTag: "BUG_VERIFICATION_TEST",
            confirmedUsers: 1,
            allocatedUsers: 1,
            busesAllocated: 1
        },
        aiPlan: {
            direction: "OUTWARD",
            tripMode: "FROM_SOURCE",
            buses: [{
                vehicleName: "Bus 101",
                capacity: 40,
                assignedUsers: 1,
                users: [{ userId: testUserId, name: student.name }]
            }]
        }
    });

    // Save into ai_selected_plans
    await mongoose.connection.db.collection("ai_selected_plans").insertOne({
        planId: oldPlanDoc._id,
        direction: "OUTWARD",
        tripMode: "FROM_SOURCE",
        active: true,
        status: "active",
        approved: true,
        isApproved: true,
        selectedAt: initialApprovalTime,
        approvedAt: initialApprovalTime,
        plan: {
            direction: "OUTWARD",
            summary: { testTag: "BUG_VERIFICATION_TEST", confirmedUsers: 1 },
            buses: [{
                vehicleName: "Bus 101",
                capacity: 40,
                assignedUsers: 1,
                users: [{ userId: testUserId, name: student.name }]
            }]
        }
    });

    // Mark student as allocated in outward plan
    student.allocatedBus = {
        outward: {
            isAllocated: true,
            vehicleName: "Bus 101",
            approved: true
        }
    };
    student.isAllocated = true;
    student.allocationStatus = "Assigned";
    await student.save();

    // 3. Create a second student who submits a LATE Coming response after approval
    const lateUserId = "TEST_BUG_STUDENT_02";
    await User.deleteOne({ userId: lateUserId });
    await LateResponseEvent.deleteMany({ userId: lateUserId });

    const lateStudent = await User.create({
        userId: lateUserId,
        name: "Test Late Student",
        phoneNumber: "919876543211",
        role: "student",
        stoppings: "Test Stop B",
        travelStatus: "Pending"
    });

    const lateSubmitRes = await handleStudentTravelStatusSubmission({
        user: lateStudent,
        travelStatus: "Coming",
        source: "web"
    });

    assert.equal(lateSubmitRes.success, true);
    assert.equal(lateSubmitRes.lateResponse, true);

    // 4. Verify system correctly detects Reset Required
    const statusBefore = await getPlanStatus();
    assert.equal(statusBefore.outward.requiresReset, true, "Outward plan must require reset after late response");
    assert.equal(statusBefore.outward.requiresReview, true, "Outward plan must require review after late response");

    // 5. Admin regenerates Outward plan with updated demand
    // (Simulate generation by calling generateAgentRecommendations or resetGeneratedAIRoute + generate)
    await resetGeneratedAIRoute({ direction: "OUTWARD" });

    // Verify after reset, late response event is resolved
    const postResetStatus = await getPlanStatus();
    assert.equal(postResetStatus.outward.status, "NO_PLAN");

    // Now generate new Outward plan
    // We create a fresh generated plan document representing the new AI run
    const newGenPlanDoc = await AiPlan.create({
        active: true,
        status: "generated",
        planType: "AI",
        direction: "OUTWARD",
        tripMode: "FROM_SOURCE",
        isSubmitted: false,
        isApproved: false,
        generatedAt: new Date(),
        summary: {
            testTag: "BUG_VERIFICATION_TEST",
            confirmedUsers: 2,
            allocatedUsers: 2,
            busesAllocated: 1
        },
        aiPlan: {
            direction: "OUTWARD",
            tripMode: "FROM_SOURCE",
            buses: [{
                vehicleName: "Bus 101",
                capacity: 40,
                assignedUsers: 2,
                users: [
                    { userId: testUserId, name: student.name },
                    { userId: lateUserId, name: lateStudent.name }
                ]
            }]
        }
    });

    // 6. Check getActiveAIPlan and getPlanStatus for the new generated plan
    const activePlan = await getActiveAIPlan({ direction: "OUTWARD", forceRefresh: true });
    assert.equal(activePlan.outwardPlan?.requiresReset, false, "Freshly generated Outward plan must NOT show requiresReset");
    assert.equal(activePlan.outwardPlan?.requiresReview, false, "Freshly generated Outward plan must NOT show requiresReview");
    assert.equal(activePlan.outwardPlan?.status, "generated", "Fresh plan status must be generated");

    const statusAfter = await getPlanStatus();
    assert.equal(statusAfter.outward.requiresReset, false, "Outward status must NOT show requiresReset after regeneration");
    assert.equal(statusAfter.outward.requiresReview, false, "Outward status must NOT show requiresReview after regeneration");
    assert.equal(statusAfter.outward.status, "GENERATED", "Outward status must be GENERATED");
});

test("BUG 1 — Test B: Future late response after regeneration triggers Reset Required again", async () => {
    // 1. Approve the newly generated plan
    const newApprovalTime = new Date();
    await AiPlan.updateMany(
        { "summary.testTag": "BUG_VERIFICATION_TEST", status: "generated" },
        { $set: { isApproved: true, status: "active", approvedAt: newApprovalTime } }
    );
    await mongoose.connection.db.collection("ai_selected_plans").insertOne({
        direction: "OUTWARD",
        tripMode: "FROM_SOURCE",
        active: true,
        status: "active",
        approved: true,
        isApproved: true,
        approvedAt: newApprovalTime,
        plan: {
            direction: "OUTWARD",
            summary: { testTag: "BUG_VERIFICATION_TEST" },
            buses: [{ vehicleName: "Bus 101", capacity: 40, assignedUsers: 2 }]
        }
    });

    // 2. A 3rd student now submits a genuinely NEW late Coming response
    const late3UserId = "TEST_BUG_STUDENT_03";
    await User.deleteOne({ userId: late3UserId });
    await LateResponseEvent.deleteMany({ userId: late3UserId });

    const late3Student = await User.create({
        userId: late3UserId,
        name: "Test Late Student 3",
        phoneNumber: "919876543212",
        role: "student",
        stoppings: "Test Stop C",
        travelStatus: "Pending"
    });

    const late3Res = await handleStudentTravelStatusSubmission({
        user: late3Student,
        travelStatus: "Coming",
        source: "web"
    });

    assert.equal(late3Res.success, true);
    assert.equal(late3Res.lateResponse, true);

    // 3. Reset Required must re-appear!
    const statusNewLate = await getPlanStatus();
    assert.equal(statusNewLate.outward.requiresReset, true, "Genuinely new late response must trigger requiresReset");
    assert.equal(statusNewLate.outward.requiresReview, true, "Genuinely new late response must trigger requiresReview");
});

test("BUG 2 — Test C: Persistent WhatsApp Inbound Processing Independent of Frontend UI", async () => {
    // 1. Verify WhatsApp service status
    const status = getWhatsAppStatus();
    assert.equal(typeof status.connected, "boolean");

    // 2. Test phone/student lookup in findStudentByWhatsAppJid
    const waUserId = "TEST_BUG_WA_STUDENT";
    await User.deleteOne({ userId: waUserId });

    const waStudent = await User.create({
        userId: waUserId,
        name: "WhatsApp Test Commuter",
        phoneNumber: "919988776655",
        role: "student",
        travelStatus: "Pending"
    });

    // Lookup with plain phone number
    const matchedByPhone = await findStudentByWhatsAppJid("919988776655");
    assert.ok(matchedByPhone, "Student must be matched by 12-digit Indian number");
    assert.equal(matchedByPhone.userId, waUserId);

    // Lookup with WhatsApp JID suffix (@s.whatsapp.net)
    const matchedByJid = await findStudentByWhatsAppJid("919988776655@s.whatsapp.net");
    assert.ok(matchedByJid, "Student must be matched by WhatsApp JID");
    assert.equal(matchedByJid.userId, waUserId);

    // Lookup with 10-digit number
    const matchedBy10 = await findStudentByWhatsAppJid("9988776655");
    assert.ok(matchedBy10, "Student must be matched by 10-digit number");
    assert.equal(matchedBy10.userId, waUserId);

    // 3. Test parseIncomingTravelResponse with various WhatsApp message formats
    // Native flow quick reply
    const nativeFlowMsg = {
        message: {
            interactiveResponseMessage: {
                nativeFlowResponseMessage: {
                    paramsJson: JSON.stringify({ id: "COMING" })
                }
            }
        }
    };
    assert.equal(parseIncomingTravelResponse(nativeFlowMsg), "Coming");

    // Legacy button response
    const legacyButtonMsg = {
        message: {
            buttonsResponseMessage: {
                selectedButtonId: "NOT_COMING"
            }
        }
    };
    assert.equal(parseIncomingTravelResponse(legacyButtonMsg), "Not Coming");

    // Plain text reply
    const textComingMsg = {
        message: {
            conversation: "Coming"
        }
    };
    assert.equal(parseIncomingTravelResponse(textComingMsg), "Coming");

    const textNotComingMsg = {
        message: {
            conversation: "Not Coming"
        }
    };
    assert.equal(parseIncomingTravelResponse(textNotComingMsg), "Not Coming");

    // 4. Test Inbound Response Processing without any frontend / browser session
    const responseResult = await handleStudentTravelStatusSubmission({
        user: matchedByJid,
        travelStatus: "Coming",
        source: "whatsapp"
    });

    assert.equal(responseResult.success, true);
    assert.equal(responseResult.travelStatus, "Coming");

    // Verify MongoDB User record was updated
    const updatedUser = await User.findOne({ userId: waUserId });
    assert.equal(updatedUser.travelStatus, "Coming");

    // 5. Test 1-response-per-cycle lock: second response must be rejected
    const secondAttempt = await handleStudentTravelStatusSubmission({
        user: updatedUser,
        travelStatus: "Not Coming",
        source: "whatsapp"
    });

    assert.equal(secondAttempt.success, false);
    assert.equal(secondAttempt.alreadySubmitted, true);
    assert.equal(secondAttempt.code, "RESPONSE_ALREADY_SUBMITTED");

    // 6. Test Admin reset of travel-status cycle allows student to respond again
    const mockRes = { status: () => ({ json: () => {} }) };
    await resetAllUsersTravelStatus({}, mockRes);

    const resetUser = await User.findOne({ userId: waUserId });
    assert.equal(resetUser.travelStatus, "Pending");

    const postResetAttempt = await handleStudentTravelStatusSubmission({
        user: resetUser,
        travelStatus: "Not Coming",
        source: "whatsapp"
    });

    assert.equal(postResetAttempt.success, true);
    assert.equal(postResetAttempt.travelStatus, "Not Coming");

    const finalUser = await User.findOne({ userId: waUserId });
    assert.equal(finalUser.travelStatus, "Not Coming");
});
