import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import User from "../models/User.js";
import { handleStudentTravelStatusSubmission } from "../controllers/userController.js";
import { parseIncomingTravelResponse, findStudentByWhatsAppJid } from "../whatsapp/whatsappService.js";
import { generateTravelStatusMessage, isValidPhoneNumber } from "../services/travelStatusAutomationService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const MONGO_URI = process.env.MONGO_URI;

test("WhatsApp Travel Status End-to-End Test Suite", async (t) => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_URI);
  }

  // Ensure test student KISHORE exists in database
  let kishoreStudent = await User.findOne({ name: "KISHORE", role: "student" });
  if (!kishoreStudent) {
    kishoreStudent = await User.findOneAndUpdate(
      { userId: "K R" },
      { $set: { name: "KISHORE", role: "student", phoneNumber: "8903368790", travelStatus: "Pending", responseLocked: false } },
      { upsert: true, new: true }
    );
  }

  await t.test("1. Phone validation: valid numbers pass, missing/invalid fail", () => {
    assert.equal(isValidPhoneNumber("8903368790"), true);
    assert.equal(isValidPhoneNumber("97903 80815"), true);
    assert.equal(isValidPhoneNumber(null), false);
    assert.equal(isValidPhoneNumber(""), false);
    assert.equal(isValidPhoneNumber("123"), false);
  });

  await t.test("2. Message template matches user format and includes student name", () => {
    const kishore = { name: "KISHORE", userId: "K R" };
    const msg = generateTravelStatusMessage(kishore);
    assert.ok(msg.includes("Hello KISHORE"));
    assert.ok(msg.includes("submit your travel status"));

    const aadil = { name: "AADIL", userId: "1" };
    const msgAadil = generateTravelStatusMessage(aadil);
    assert.ok(msgAadil.includes("Hello AADIL"));
    assert.ok(msgAadil.includes("submit your travel status"));
  });

  await t.test("3. parseIncomingTravelResponse parses interactive button clicks and text replies", () => {
    // Native flow quick reply: COMING
    const nativeFlowComing = {
      message: {
        interactiveResponseMessage: {
          nativeFlowResponseMessage: {
            paramsJson: JSON.stringify({ id: "COMING" })
          }
        }
      }
    };
    assert.equal(parseIncomingTravelResponse(nativeFlowComing), "Coming");

    // Native flow quick reply: NOT COMING
    const nativeFlowNotComing = {
      message: {
        interactiveResponseMessage: {
          nativeFlowResponseMessage: {
            paramsJson: JSON.stringify({ id: "NOT_COMING" })
          }
        }
      }
    };
    assert.equal(parseIncomingTravelResponse(nativeFlowNotComing), "Not Coming");

    // Interactive response message with body text
    const bodyComing = {
      message: {
        interactiveResponseMessage: {
          body: { text: "COMING" }
        }
      }
    };
    assert.equal(parseIncomingTravelResponse(bodyComing), "Coming");

    // ViewOnce wrapped interactive response
    const viewOnceComing = {
      message: {
        viewOnceMessage: {
          message: {
            interactiveResponseMessage: {
              nativeFlowResponseMessage: {
                paramsJson: JSON.stringify({ id: "COMING" })
              }
            }
          }
        }
      }
    };
    assert.equal(parseIncomingTravelResponse(viewOnceComing), "Coming");

    // Direct text fallback: coming / not coming
    assert.equal(parseIncomingTravelResponse({ message: { conversation: "Coming" } }), "Coming");
    assert.equal(parseIncomingTravelResponse({ message: { conversation: "Not Coming" } }), "Not Coming");
    assert.equal(parseIncomingTravelResponse({ message: { extendedTextMessage: { text: "coming" } } }), "Coming");
  });

  await t.test("4. Full lifecycle: Reset -> Submit COMING -> Lock -> Re-submit blocked -> Reset -> Submit NOT COMING", async () => {
    // Find KISHORE in DB
    const student = await User.findOne({ name: "KISHORE", role: "student" });
    assert.ok(student, "Student KISHORE must exist");

    // Step A: Admin Reset to Pending
    student.travelStatus = "Pending";
    await student.save();

    // Step B: Submit COMING
    const res1 = await handleStudentTravelStatusSubmission({
      user: student,
      travelStatus: "Coming",
      source: "whatsapp"
    });
    assert.equal(res1.success, true);
    assert.equal(res1.user.travelStatus, "Coming");

    // Reload from DB to confirm persistence
    const saved1 = await User.findById(student._id);
    assert.equal(saved1.travelStatus, "Coming");

    // Step C: Attempt duplicate submission (locked)
    const res2 = await handleStudentTravelStatusSubmission({
      user: saved1,
      travelStatus: "Coming",
      source: "whatsapp"
    });
    assert.equal(res2.success, false);
    assert.equal(res2.alreadySubmitted, true);
    assert.equal(res2.code, "RESPONSE_ALREADY_SUBMITTED");

    // Step D: Attempt to switch to "Not Coming" while locked
    const res3 = await handleStudentTravelStatusSubmission({
      user: saved1,
      travelStatus: "Not Coming",
      source: "whatsapp"
    });
    assert.equal(res3.success, false);
    assert.equal(res3.alreadySubmitted, true);

    // Step E: Admin resets travel status back to Pending
    saved1.travelStatus = "Pending";
    await saved1.save();

    const afterReset = await User.findById(student._id);
    assert.equal(afterReset.travelStatus, "Pending");

    // Step F: Now student can submit "Not Coming"
    const res4 = await handleStudentTravelStatusSubmission({
      user: afterReset,
      travelStatus: "Not Coming",
      source: "whatsapp"
    });
    assert.equal(res4.success, true);
    assert.equal(res4.user.travelStatus, "Not Coming");

    const saved2 = await User.findById(student._id);
    assert.equal(saved2.travelStatus, "Not Coming");

    // Clean up: reset back to Pending
    saved2.travelStatus = "Pending";
    await saved2.save();
  });

  await t.test("5. Cross-Channel Lock: Dashboard submission locks WhatsApp & WhatsApp submission locks Dashboard", async () => {
    const student = await User.findOne({ name: "KISHORE", role: "student" });
    assert.ok(student);

    // Initial state: Pending
    student.travelStatus = "Pending";
    await student.save();

    // SCENARIO A: Student submits "Coming" on Dashboard (source: "web")
    const dashRes = await handleStudentTravelStatusSubmission({
      user: student,
      travelStatus: "Coming",
      source: "web"
    });
    assert.equal(dashRes.success, true);
    assert.equal(dashRes.user.travelStatus, "Coming");

    // Fetch fresh user from DB
    const lockedUser1 = await User.findById(student._id);
    assert.equal(lockedUser1.travelStatus, "Coming");

    // Attempt second response via WhatsApp (source: "whatsapp") -> MUST BE REJECTED
    const waAttempt1 = await handleStudentTravelStatusSubmission({
      user: lockedUser1,
      travelStatus: "Coming",
      source: "whatsapp"
    });
    assert.equal(waAttempt1.success, false);
    assert.equal(waAttempt1.alreadySubmitted, true);
    assert.equal(waAttempt1.responseLocked, true);
    assert.equal(waAttempt1.code, "RESPONSE_ALREADY_SUBMITTED");

    // Attempt "Not Coming" via WhatsApp -> MUST ALSO BE REJECTED
    const waAttempt2 = await handleStudentTravelStatusSubmission({
      user: lockedUser1,
      travelStatus: "Not Coming",
      source: "whatsapp"
    });
    assert.equal(waAttempt2.success, false);
    assert.equal(waAttempt2.alreadySubmitted, true);

    // SCENARIO B: Admin Reset unlocks both channels
    lockedUser1.travelStatus = "Pending";
    await lockedUser1.save();

    const unlockedUser1 = await User.findById(student._id);
    assert.equal(unlockedUser1.travelStatus, "Pending");

    // SCENARIO C: Student submits "Not Coming" on WhatsApp (source: "whatsapp")
    const waRes = await handleStudentTravelStatusSubmission({
      user: unlockedUser1,
      travelStatus: "Not Coming",
      source: "whatsapp"
    });
    assert.equal(waRes.success, true);
    assert.equal(waRes.user.travelStatus, "Not Coming");

    const lockedUser2 = await User.findById(student._id);
    assert.equal(lockedUser2.travelStatus, "Not Coming");

    // Attempt second response via Dashboard (source: "web") -> MUST BE REJECTED
    const dashAttempt1 = await handleStudentTravelStatusSubmission({
      user: lockedUser2,
      travelStatus: "Coming",
      source: "web"
    });
    assert.equal(dashAttempt1.success, false);
    assert.equal(dashAttempt1.alreadySubmitted, true);
    assert.equal(dashAttempt1.responseLocked, true);
    assert.equal(dashAttempt1.code, "RESPONSE_ALREADY_SUBMITTED");

    // Clean up: reset back to Pending
    lockedUser2.travelStatus = "Pending";
    await lockedUser2.save();
  });

  await t.test("6. End-to-End WhatsApp JID Lookup -> DB Update -> Second Response Rejection -> Admin Reset", async () => {
    // 1. Look up student AADIL whose stored DB phone has spaces ("97903 80815")
    const student = await findStudentByWhatsAppJid("919790380815@s.whatsapp.net");
    assert.ok(student, "Student AADIL must be found despite spaces in stored phone number");
    assert.equal(student.name, "AADIL");

    // Initial state: Pending
    student.travelStatus = "Pending";
    await student.save();

    // Student responds COMING via WhatsApp
    const res1 = await handleStudentTravelStatusSubmission({
      user: student,
      travelStatus: "Coming",
      source: "whatsapp"
    });
    assert.equal(res1.success, true);

    // Verify MongoDB document itself was updated (not just in-memory)
    const freshFromDb = await User.findById(student._id);
    assert.equal(freshFromDb.travelStatus, "Coming");

    // Second response: student now clicks NOT COMING via WhatsApp
    const studentAgain = await findStudentByWhatsAppJid("919790380815@s.whatsapp.net");
    assert.equal(studentAgain.travelStatus, "Coming");

    const res2 = await handleStudentTravelStatusSubmission({
      user: studentAgain,
      travelStatus: "Not Coming",
      source: "whatsapp"
    });

    // Second response MUST BE REJECTED
    assert.equal(res2.success, false);
    assert.equal(res2.alreadySubmitted, true);
    assert.equal(res2.responseLocked, true);
    assert.equal(res2.code, "RESPONSE_ALREADY_SUBMITTED");

    // Verify MongoDB document remained "Coming"
    const freshAfterSecondClick = await User.findById(student._id);
    assert.equal(freshAfterSecondClick.travelStatus, "Coming");

    // Admin resets travel status
    freshAfterSecondClick.travelStatus = "Pending";
    await freshAfterSecondClick.save();

    const afterReset = await User.findById(student._id);
    assert.equal(afterReset.travelStatus, "Pending");

    // Student responds again after reset -> now succeeds
    const res3 = await handleStudentTravelStatusSubmission({
      user: afterReset,
      travelStatus: "Not Coming",
      source: "whatsapp"
    });
    assert.equal(res3.success, true);
    assert.equal(res3.travelStatus, "Not Coming");

    const freshAfterResetSubmit = await User.findById(student._id);
    assert.equal(freshAfterResetSubmit.travelStatus, "Not Coming");

    // Clean up
    freshAfterResetSubmit.travelStatus = "Pending";
    await freshAfterResetSubmit.save();
  });

  await t.test("7. WhatsApp Privacy LID resolution: 126800403398817@lid maps to MAHADEER", async () => {
    const student = await findStudentByWhatsAppJid("126800403398817@lid");
    assert.ok(student, "Must resolve LID 126800403398817@lid to student MAHADEER");
    assert.equal(student.name, "MAHADEER");
    assert.equal(student.userId, "M");
  });

  t.after(async () => {
    await mongoose.disconnect();
  });
});
