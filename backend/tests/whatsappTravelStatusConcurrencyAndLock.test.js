import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import User from "../models/User.js";
import {
  handleIncomingWhatsAppMessage,
  formatWhatsAppJid
} from "../whatsapp/whatsappService.js";
import { resetAllUsersTravelStatus, resetUserTravelStatus } from "../controllers/userController.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const MONGO_URI = process.env.MONGO_URI;

test("WhatsApp Travel Status Concurrency & Document-Level Lock Suite", async (t) => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_URI);
  }

  // Ensure two test students exist in DB
  let studentA = await User.findOne({ name: "AADIL", role: "student" });
  if (!studentA) {
    studentA = await User.findOneAndUpdate(
      { userId: "1" },
      { $set: { name: "AADIL", role: "student", phoneNumber: "97903 80815", travelStatus: "Pending", responseLocked: false } },
      { upsert: true, new: true }
    );
  }

  let studentB = await User.findOne({ name: "MAHADEER", role: "student" });
  if (!studentB) {
    studentB = await User.findOneAndUpdate(
      { userId: "M" },
      { $set: { name: "MAHADEER", role: "student", phoneNumber: "97906 46864", travelStatus: "Pending", responseLocked: false } },
      { upsert: true, new: true }
    );
  }

  const phoneA = studentA.phoneNumber.replace(/\D/g, "").slice(-10);
  const jidA = `${phoneA}@s.whatsapp.net`;

  const phoneB = studentB.phoneNumber.replace(/\D/g, "").slice(-10);
  const jidB = `${phoneB}@s.whatsapp.net`;

  const createMockSock = () => {
    const sent = [];
    return {
      sent,
      user: { id: "919000000000:0@s.whatsapp.net" },
      sendMessage: async (jid, content) => {
        sent.push({ jid, content });
        return { key: { id: "mock_" + Date.now() } };
      }
    };
  };

  const createBtnMsg = (jid, buttonId) => ({
    key: { remoteJid: jid },
    message: {
      interactiveResponseMessage: {
        nativeFlowResponseMessage: {
          paramsJson: JSON.stringify({ id: buttonId })
        }
      }
    }
  });

  await t.test("TEST 1: Admin website OPEN - COMING then NOT COMING -> COMING preserved, NOT COMING rejected", async () => {
    await User.findByIdAndUpdate(studentA._id, { $set: { travelStatus: "Pending", responseLocked: false } });

    const mockSock = createMockSock();
    const res1 = await handleIncomingWhatsAppMessage(createBtnMsg(jidA, "COMING"), mockSock);
    assert.equal(res1.success, true);
    assert.equal(res1.confirmationSent, true);

    const dbUser1 = await User.findById(studentA._id);
    assert.equal(dbUser1.travelStatus, "Coming");
    assert.equal(dbUser1.responseLocked, true);

    const res2 = await handleIncomingWhatsAppMessage(createBtnMsg(jidA, "NOT COMING"), mockSock);
    assert.equal(res2.success, false);
    assert.equal(res2.alreadySubmitted, true);
    assert.equal(res2.responseLocked, true);

    const dbUser2 = await User.findById(studentA._id);
    assert.equal(dbUser2.travelStatus, "Coming", "Database must remain Coming");
    assert.equal(dbUser2.responseLocked, true);
  });

  await t.test("TEST 2: Admin website CLOSED - User clicks COMING then NOT COMING -> Only COMING stored", async () => {
    await User.findByIdAndUpdate(studentA._id, { $set: { travelStatus: "Pending", responseLocked: false } });

    // Website is closed (no frontend session / state)
    const mockSock = createMockSock();
    const res1 = await handleIncomingWhatsAppMessage(createBtnMsg(jidA, "COMING"), mockSock);
    assert.equal(res1.success, true);

    const res2 = await handleIncomingWhatsAppMessage(createBtnMsg(jidA, "NOT COMING"), mockSock);
    assert.equal(res2.success, false);
    assert.equal(res2.alreadySubmitted, true);

    const dbUser = await User.findById(studentA._id);
    assert.equal(dbUser.travelStatus, "Coming", "Database must strictly contain only the first response");
    assert.equal(dbUser.responseLocked, true);
  });

  await t.test("TEST 3: Reverse order (Website CLOSED) - User clicks NOT COMING then COMING -> Not Coming preserved", async () => {
    await User.findByIdAndUpdate(studentA._id, { $set: { travelStatus: "Pending", responseLocked: false } });

    const mockSock = createMockSock();
    const res1 = await handleIncomingWhatsAppMessage(createBtnMsg(jidA, "NOT COMING"), mockSock);
    assert.equal(res1.success, true);

    const res2 = await handleIncomingWhatsAppMessage(createBtnMsg(jidA, "COMING"), mockSock);
    assert.equal(res2.success, false);
    assert.equal(res2.alreadySubmitted, true);

    const dbUser = await User.findById(studentA._id);
    assert.equal(dbUser.travelStatus, "Not Coming", "Database must strictly remain Not Coming");
    assert.equal(dbUser.responseLocked, true);
  });

  await t.test("TEST 4: Rapid responses - Concurrent COMING and NOT COMING in parallel -> Exactly one wins", async () => {
    await User.findByIdAndUpdate(studentA._id, { $set: { travelStatus: "Pending", responseLocked: false } });

    const mockSock = createMockSock();
    const [p1, p2] = await Promise.all([
      handleIncomingWhatsAppMessage(createBtnMsg(jidA, "COMING"), mockSock),
      handleIncomingWhatsAppMessage(createBtnMsg(jidA, "NOT COMING"), mockSock)
    ]);

    const successes = [p1, p2].filter((r) => r.success === true);
    const rejections = [p1, p2].filter((r) => r.success === false && r.alreadySubmitted === true);

    assert.equal(successes.length, 1, "Exactly one concurrent request must succeed");
    assert.equal(rejections.length, 1, "Exactly one concurrent request must be rejected");

    const dbUser = await User.findById(studentA._id);
    assert.ok(dbUser.travelStatus === "Coming" || dbUser.travelStatus === "Not Coming");
    assert.equal(dbUser.travelStatus, successes[0].travelStatus, "DB status must match the winning response");
    assert.equal(dbUser.responseLocked, true);
  });

  await t.test("TEST 5: Duplicate same response - User clicks COMING twice -> First succeeds, second rejected without state change", async () => {
    await User.findByIdAndUpdate(studentA._id, { $set: { travelStatus: "Pending", responseLocked: false } });

    const mockSock = createMockSock();
    const res1 = await handleIncomingWhatsAppMessage(createBtnMsg(jidA, "COMING"), mockSock);
    assert.equal(res1.success, true);

    const res2 = await handleIncomingWhatsAppMessage(createBtnMsg(jidA, "COMING"), mockSock);
    assert.equal(res2.success, false);
    assert.equal(res2.alreadySubmitted, true);

    const dbUser = await User.findById(studentA._id);
    assert.equal(dbUser.travelStatus, "Coming");
    assert.equal(dbUser.responseLocked, true);
  });

  await t.test("TEST 6: Admin Reset unlocks student for new cycle", async () => {
    // Before reset: locked as Coming
    const beforeUser = await User.findById(studentA._id);
    assert.equal(beforeUser.travelStatus, "Coming");
    assert.equal(beforeUser.responseLocked, true);

    // Perform Admin Reset
    await User.findByIdAndUpdate(studentA._id, { $set: { travelStatus: "Pending", responseLocked: false } });

    const afterReset = await User.findById(studentA._id);
    assert.equal(afterReset.travelStatus, "Pending");
    assert.equal(afterReset.responseLocked, false);

    // Student submits new response in new cycle
    const mockSock = createMockSock();
    const res = await handleIncomingWhatsAppMessage(createBtnMsg(jidA, "Not Coming"), mockSock);
    assert.equal(res.success, true);

    const freshUser = await User.findById(studentA._id);
    assert.equal(freshUser.travelStatus, "Not Coming");
    assert.equal(freshUser.responseLocked, true);
  });

  await t.test("TEST 7: Multiple users - User A's response and lock never affects User B", async () => {
    await User.findByIdAndUpdate(studentA._id, { $set: { travelStatus: "Pending", responseLocked: false } });
    await User.findByIdAndUpdate(studentB._id, { $set: { travelStatus: "Pending", responseLocked: false } });

    const mockSock = createMockSock();

    // User A selects Coming
    const resA1 = await handleIncomingWhatsAppMessage(createBtnMsg(jidA, "COMING"), mockSock);
    assert.equal(resA1.success, true);

    // User B selects Not Coming
    const resB1 = await handleIncomingWhatsAppMessage(createBtnMsg(jidB, "NOT COMING"), mockSock);
    assert.equal(resB1.success, true);

    // User A locked as Coming
    const dbA = await User.findById(studentA._id);
    assert.equal(dbA.travelStatus, "Coming");
    assert.equal(dbA.responseLocked, true);

    // User B locked as Not Coming
    const dbB = await User.findById(studentB._id);
    assert.equal(dbB.travelStatus, "Not Coming");
    assert.equal(dbB.responseLocked, true);

    // User A attempts Not Coming -> rejected
    const resA2 = await handleIncomingWhatsAppMessage(createBtnMsg(jidA, "NOT COMING"), mockSock);
    assert.equal(resA2.success, false);

    // User B attempts Coming -> rejected
    const resB2 = await handleIncomingWhatsAppMessage(createBtnMsg(jidB, "COMING"), mockSock);
    assert.equal(resB2.success, false);

    // Clean up
    await User.findByIdAndUpdate(studentA._id, { $set: { travelStatus: "Pending", responseLocked: false } });
    await User.findByIdAndUpdate(studentB._id, { $set: { travelStatus: "Pending", responseLocked: false } });
  });

  t.after(async () => {
    await mongoose.disconnect();
  });
});
