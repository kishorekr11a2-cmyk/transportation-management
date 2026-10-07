import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import User from "../models/User.js";
import {
  handleIncomingWhatsAppMessage,
  parseIncomingTravelResponse,
  findStudentByWhatsAppJid,
  formatWhatsAppJid
} from "../whatsapp/whatsappService.js";
import {
  generateTravelStatusMessage,
  isValidPhoneNumber
} from "../services/travelStatusAutomationService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const MONGO_URI = process.env.MONGO_URI;

test("WhatsApp Confirmation Rules & Protections Test Suite", async (t) => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_URI);
  }

  // Find a registered test student in the database
  const student = await User.findOne({ role: "student", phoneNumber: { $exists: true, $ne: "" } });
  assert.ok(student, "A registered test student must exist in database");

  const studentJid = `${student.phoneNumber.replace(/\D/g, "").slice(-10)}@s.whatsapp.net`;
  const unknownJid = "9999999999@s.whatsapp.net";
  const groupJid = "120363388791767840@g.us";

  // Helper to create mock socket that tracks all calls to sendMessage
  const createMockSock = () => {
    const sentMessages = [];
    return {
      sentMessages,
      user: { id: "919000000000:0@s.whatsapp.net", lid: "1000000000@lid" },
      sendMessage: async (jid, content) => {
        sentMessages.push({ jid, content });
        return { key: { id: "mock_msg_id_" + Date.now() } };
      }
    };
  };

  await t.test("TEST 1: Registered student clicks COMING -> travelStatus = Coming & confirmation sent", async () => {
    await User.findByIdAndUpdate(student._id, { $set: { travelStatus: "Pending" } });

    const mockSock = createMockSock();
    const msg = {
      key: { remoteJid: studentJid },
      message: {
        interactiveResponseMessage: {
          nativeFlowResponseMessage: {
            paramsJson: JSON.stringify({ id: "COMING" })
          }
        }
      }
    };

    const res = await handleIncomingWhatsAppMessage(msg, mockSock);
    assert.equal(res.success, true);
    assert.equal(res.confirmationSent, true);
    assert.equal(res.travelStatus, "Coming");
    assert.ok(res.confirmationText.includes(`Hello ${student.name}`));
    assert.ok(res.confirmationText.includes('✅ Your travel response "Coming" has been recorded successfully.'));
    assert.ok(res.confirmationText.includes("Your response is now locked until administrator reset."));

    // Verify exactly one message was sent to that student
    assert.equal(mockSock.sentMessages.length, 1);
    assert.equal(mockSock.sentMessages[0].jid, studentJid);
    assert.equal(mockSock.sentMessages[0].content.text, res.confirmationText);

    // Verify DB updated
    const updated = await User.findById(student._id);
    assert.equal(updated.travelStatus, "Coming");
  });

  await t.test("TEST 2: Registered student clicks NOT COMING -> travelStatus = Not Coming & confirmation sent", async () => {
    // Reset to Pending
    await User.findByIdAndUpdate(student._id, { $set: { travelStatus: "Pending" } });

    const mockSock = createMockSock();
    const msg = {
      key: { remoteJid: studentJid },
      message: {
        interactiveResponseMessage: {
          nativeFlowResponseMessage: {
            paramsJson: JSON.stringify({ id: "NOT_COMING" })
          }
        }
      }
    };

    const res = await handleIncomingWhatsAppMessage(msg, mockSock);
    assert.equal(res.success, true);
    assert.equal(res.confirmationSent, true);
    assert.equal(res.travelStatus, "Not Coming");
    assert.ok(res.confirmationText.includes(`Hello ${student.name}`));
    assert.ok(res.confirmationText.includes('✅ Your travel response "Not Coming" has been recorded successfully.'));
    assert.ok(res.confirmationText.includes("Your response is now locked until administrator reset."));

    // Verify outgoing message
    assert.equal(mockSock.sentMessages.length, 1);
    assert.equal(mockSock.sentMessages[0].jid, studentJid);

    // Verify DB updated
    const updated = await User.findById(student._id);
    assert.equal(updated.travelStatus, "Not Coming");
  });

  await t.test("TEST 2b: Student tries to respond again after already selecting Not Coming -> locked-response message", async () => {
    const mockSock = createMockSock();
    const msg = {
      key: { remoteJid: studentJid },
      message: {
        conversation: "Coming"
      }
    };

    const res = await handleIncomingWhatsAppMessage(msg, mockSock);
    assert.equal(res.success, false);
    assert.equal(res.alreadySubmitted, true);
    assert.equal(res.responseLocked, true);
    assert.equal(mockSock.sentMessages.length, 1);
    assert.equal(
      mockSock.sentMessages[0].content.text,
      `Hello ${student.name},\n\nYour travel response has already been recorded as "Not Coming". Your response is locked and cannot be changed until administrator reset.`
    );
  });

  await t.test("TEST 2c: Student tries to respond again after already selecting Coming -> locked-response message", async () => {
    await User.findByIdAndUpdate(student._id, { $set: { travelStatus: "Coming" } });
    const mockSock = createMockSock();
    const msg = {
      key: { remoteJid: studentJid },
      message: {
        conversation: "Not Coming"
      }
    };

    const res = await handleIncomingWhatsAppMessage(msg, mockSock);
    assert.equal(res.success, false);
    assert.equal(res.alreadySubmitted, true);
    assert.equal(res.responseLocked, true);
    assert.equal(mockSock.sentMessages.length, 1);
    assert.equal(
      mockSock.sentMessages[0].content.text,
      `Hello ${student.name},\n\nYour travel response has already been recorded as "Coming". Your response is locked and cannot be changed until administrator reset.`
    );
  });

  await t.test("TEST 3: Unknown number sends Coming -> NO message sent", async () => {
    const mockSock = createMockSock();
    const msg = {
      key: { remoteJid: unknownJid },
      message: {
        conversation: "Coming"
      }
    };

    const res = await handleIncomingWhatsAppMessage(msg, mockSock);
    assert.equal(res.ignored, true);
    assert.equal(res.reason, "unregistered_student");
    assert.equal(mockSock.sentMessages.length, 0, "No outgoing messages should be sent to unknown number");
  });

  await t.test("TEST 4: Unknown number sends Not Coming -> NO message sent", async () => {
    const mockSock = createMockSock();
    const msg = {
      key: { remoteJid: unknownJid },
      message: {
        conversation: "Not Coming"
      }
    };

    const res = await handleIncomingWhatsAppMessage(msg, mockSock);
    assert.equal(res.ignored, true);
    assert.equal(res.reason, "unregistered_student");
    assert.equal(mockSock.sentMessages.length, 0, "No outgoing messages should be sent to unknown number");
  });

  await t.test("TEST 5: Group member sends Coming -> NO message sent", async () => {
    const mockSock = createMockSock();
    const msg = {
      key: {
        remoteJid: groupJid,
        participant: studentJid
      },
      message: {
        conversation: "Coming"
      }
    };

    const res = await handleIncomingWhatsAppMessage(msg, mockSock);
    assert.equal(res.ignored, true);
    assert.equal(res.reason, "group_broadcast_newsletter");
    assert.equal(mockSock.sentMessages.length, 0, "No outgoing messages should be sent to groups");
  });

  await t.test("TEST 6: Group member sends Not Coming -> NO message sent", async () => {
    const mockSock = createMockSock();
    const msg = {
      key: {
        remoteJid: groupJid,
        participant: studentJid
      },
      message: {
        conversation: "Not Coming"
      }
    };

    const res = await handleIncomingWhatsAppMessage(msg, mockSock);
    assert.equal(res.ignored, true);
    assert.equal(res.reason, "group_broadcast_newsletter");
    assert.equal(mockSock.sentMessages.length, 0, "No outgoing messages should be sent to groups");
  });

  await t.test("TEST 7: Registered student sends random text -> NO confirmation sent", async () => {
    const mockSock = createMockSock();
    const randomTexts = ["Hello", "Hi", "Test", "Where is the bus?", "Random message"];

    for (const text of randomTexts) {
      const msg = {
        key: { remoteJid: studentJid },
        message: {
          conversation: text
        }
      };

      const res = await handleIncomingWhatsAppMessage(msg, mockSock);
      assert.equal(res.ignored, true);
      assert.equal(res.reason, "invalid_or_random_response");
    }

    assert.equal(mockSock.sentMessages.length, 0, "Random messages must never trigger any outgoing WhatsApp message");
  });

  await t.test("TEST 8: Admin clicks Automation -> Send Travel Status: initial message goes ONLY to eligible DB students", async () => {
    const users = await User.find({ role: { $ne: "admin" } });
    assert.ok(Array.isArray(users));
    assert.ok(users.length > 0);

    const eligibleUsers = users.filter((u) => isValidPhoneNumber(u.phoneNumber));
    assert.ok(eligibleUsers.length > 0, "Must have eligible students in database");

    for (const studentUser of eligibleUsers) {
      assert.equal(studentUser.role, "student");
      const cleanPhone = String(studentUser.phoneNumber).replace(/\D/g, "");
      assert.ok(cleanPhone.length >= 10);
      assert.ok(!cleanPhone.includes("@g.us"));
      assert.ok(!cleanPhone.includes("@broadcast"));

      const template = generateTravelStatusMessage(studentUser);
      assert.ok(template.includes(`Hello ${(studentUser.name || studentUser.userId || "Student").toUpperCase()}`));
      assert.ok(template.includes("submit your travel status"));
    }
  });

  await t.test("TEST 9: Student submits response after Admin leaves the Automation page -> DB updated and confirmation sent", async () => {
    // Reset student to Pending
    await User.findByIdAndUpdate(student._id, { $set: { travelStatus: "Pending" } });

    const mockSock = createMockSock();
    // Simulate incoming response arriving in backend while no Admin is looking at UI
    const msg = {
      key: { remoteJid: studentJid },
      message: {
        conversation: "Coming"
      }
    };

    const res = await handleIncomingWhatsAppMessage(msg, mockSock);
    assert.equal(res.success, true);
    assert.equal(res.confirmationSent, true);

    const fresh = await User.findById(student._id);
    assert.equal(fresh.travelStatus, "Coming");
    assert.equal(mockSock.sentMessages.length, 1);
    assert.ok(mockSock.sentMessages[0].content.text.includes('✅ Your travel response "Coming" has been recorded successfully.'));
  });

  await t.test("TEST 10: The old message '⚠️ Your phone number (...) is not linked to an active student account...' MUST NEVER BE SENT", async () => {
    const mockSock = createMockSock();
    const unknownNumbers = ["9876543210@s.whatsapp.net", "919988776655@s.whatsapp.net", "1234567890@s.whatsapp.net"];

    for (const num of unknownNumbers) {
      const msg = {
        key: { remoteJid: num },
        message: { conversation: "Coming" }
      };
      await handleIncomingWhatsAppMessage(msg, mockSock);
    }

    // Check all sent messages across the entire test
    for (const sent of mockSock.sentMessages) {
      assert.ok(
        !sent.content.text.includes("is not linked to an active student account"),
        "The old unlinked-number warning message must never be sent under any circumstances!"
      );
    }
    assert.equal(mockSock.sentMessages.length, 0);
  });

  t.after(async () => {
    // Reset test student back to Pending
    await User.findByIdAndUpdate(student._id, { $set: { travelStatus: "Pending" } });
    await mongoose.disconnect();
  });
});
