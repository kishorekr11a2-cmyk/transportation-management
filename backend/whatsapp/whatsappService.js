import fs from "fs";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  generateWAMessageFromContent
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import path from "path";
import { fileURLToPath } from "url";
import User from "../models/User.js";
import { handleStudentTravelStatusSubmission } from "../controllers/userController.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUTH_DIR = path.resolve(__dirname, "auth");

let sock = null;
let isConnected = false;
let isConnecting = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
let reconnectTimeout = null;
const lidToPhoneMap = new Map();

/**
 * Normalizes phone numbers for WhatsApp.
 * - Converts 10-digit Indian numbers to E.164 (prepends 91)
 * - Preserves existing country code (does not double append 91)
 * - Handles leading zeros, + signs, dashes, spaces, and JID suffixes
 */
export function normalizePhoneNumber(phoneNumber) {
  if (!phoneNumber) return null;

  if (typeof phoneNumber === "string") {
    // Strip JID domain suffix (@s.whatsapp.net, @lid, etc.)
    phoneNumber = phoneNumber.split("@")[0];
    // Strip Baileys device index suffix (e.g. :59)
    phoneNumber = phoneNumber.split(":")[0];
  }

  let cleaned = String(phoneNumber).replace(/\D/g, "");
  if (!cleaned) return null;

  // 11 digits starting with 0 (e.g. 08903368790) -> replace 0 with 91
  if (cleaned.length === 11 && cleaned.startsWith("0")) {
    cleaned = "91" + cleaned.slice(1);
  }
  // 10 digits standard Indian mobile number -> prepend 91
  else if (cleaned.length === 10) {
    cleaned = "91" + cleaned;
  }

  // Minimum valid phone number length
  if (cleaned.length < 10) {
    return null;
  }

  return cleaned;
}

export function formatWhatsAppJid(phoneNumber) {
  const normalized = normalizePhoneNumber(phoneNumber);
  if (!normalized) return null;
  return `${normalized}@s.whatsapp.net`;
}

/**
 * Resolves a WhatsApp Linked Device Identifier (LID) to a standard phone number
 * by checking Baileys persistent multi-file auth files on disk.
 */
export function resolvePhoneFromAuthDir(lidDigits) {
  if (!lidDigits) return null;
  const targetLid = String(lidDigits).replace(/\D/g, "").trim();
  if (!targetLid) return null;

  try {
    // 1. Check reverse mapping file: lid-mapping-<lid>_reverse.json
    const reverseFile = path.join(AUTH_DIR, `lid-mapping-${targetLid}_reverse.json`);
    if (fs.existsSync(reverseFile)) {
      const content = JSON.parse(fs.readFileSync(reverseFile, "utf8"));
      if (content) return String(content);
    }

    // 2. Search through forward mapping files: lid-mapping-<phone>.json
    if (fs.existsSync(AUTH_DIR)) {
      const files = fs.readdirSync(AUTH_DIR);
      for (const file of files) {
        if (file.startsWith("lid-mapping-") && !file.includes("_reverse") && file.endsWith(".json")) {
          const content = fs.readFileSync(path.join(AUTH_DIR, file), "utf8").trim().replace(/"/g, "");
          if (content === targetLid) {
            return file.replace("lid-mapping-", "").replace(".json", "");
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[WHATSAPP LID RESOLUTION] Auth dir check warning:`, err.message);
  }

  return null;
}

/**
 * Resolves a sender JID (which may be a modern WhatsApp LID like 126800403398817@lid)
 * to the student's real phone number E.164 string.
 */
export async function resolveLidToPhoneNumber(phoneOrJid, sockInstance = null) {
  if (!phoneOrJid) return null;

  const rawStr = String(phoneOrJid).trim();
  const isLid = rawStr.endsWith("@lid") || rawStr.includes("@lid");
  const lidDigits = rawStr.split("@")[0].split(":")[0].replace(/\D/g, "");

  // If not a LID (i.e. normal phone number JID), return null
  if (!isLid && lidDigits.length < 14) {
    return null;
  }

  // 1. Check if it matches connected bot owner's LID (e.g. self-chat testing)
  const myLid = sockInstance?.user?.lid ? sockInstance.user.lid.split("@")[0].split(":")[0] : null;
  if (myLid && (rawStr.includes(myLid) || lidDigits === myLid)) {
    return normalizePhoneNumber(sockInstance?.user?.id);
  }

  // 2. Check in-memory lidToPhoneMap
  if (lidToPhoneMap.has(lidDigits)) {
    return lidToPhoneMap.get(lidDigits);
  }

  // 3. Check Baileys internal signalRepository lidMapping
  try {
    const signalRepo = sockInstance?.signalRepository;
    if (signalRepo?.lidMapping?.getPNForLID) {
      const lidJid = rawStr.includes("@lid") ? rawStr.split(":")[0] + "@lid" : `${lidDigits}@lid`;
      const pnResult = await signalRepo.lidMapping.getPNForLID(lidJid);
      if (pnResult) {
        const normalized = normalizePhoneNumber(pnResult);
        if (normalized) {
          lidToPhoneMap.set(lidDigits, normalized);
          return normalized;
        }
      }
    }
  } catch (_) {}

  // 4. Check Baileys persisted multi-file auth mapping on disk
  const authPhone = resolvePhoneFromAuthDir(lidDigits);
  if (authPhone) {
    const normalized = normalizePhoneNumber(authPhone);
    if (normalized) {
      lidToPhoneMap.set(lidDigits, normalized);
      return normalized;
    }
  }

  return null;
}

/**
 * Robustly matches an incoming WhatsApp sender JID to an active student document in MongoDB.
 * - Resolves privacy LIDs (e.g. 126800403398817@lid) to underlying phone numbers
 * - Handles phone numbers with or without spaces/dashes (e.g. "97903 80815" vs "919790380815")
 * - Handles self-chat or owner device interactions via LID
 * - Strips device indexes (e.g. :59)
 */
export async function findStudentByWhatsAppJid(phoneOrJid, sockInstance = null) {
  if (!phoneOrJid) return null;

  let phoneStr = String(phoneOrJid);

  // If JID is a privacy LID, resolve to the underlying real phone number first
  const resolvedFromLid = await resolveLidToPhoneNumber(phoneStr, sockInstance);
  if (resolvedFromLid) {
    phoneStr = resolvedFromLid;
  }

  const normalized = normalizePhoneNumber(phoneStr);
  if (!normalized) return null;
  const digits = normalized.slice(-10);

  // Flexible pattern to match digits separated by optional non-digit characters in MongoDB
  const flexiblePattern = digits.split("").join("\\D*") + "\\D*$";

  return await User.findOne({
    role: { $ne: "admin" },
    $or: [
      { phoneNumber: { $regex: new RegExp(flexiblePattern) } },
      { userId: { $regex: new RegExp(`^${digits}$`, "i") } }
    ]
  });
}

/**
 * Extracts and normalizes student's travel response from Baileys message structure.
 * Handles:
 * - Native flow quick-reply button clicks (interactiveResponseMessage)
 * - Legacy Baileys button clicks (buttonsResponseMessage)
 * - Template button replies (templateButtonReplyMessage)
 * - Direct text replies ("Coming", "Not Coming")
 */
export function parseIncomingTravelResponse(msg) {
  if (!msg || !msg.message) return null;

  let m = msg.message;
  if (m.viewOnceMessage?.message) m = m.viewOnceMessage.message;
  if (m.viewOnceMessageV2?.message) m = m.viewOnceMessageV2.message;
  if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;

  // 1. Native flow quick reply interactive response
  if (m.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson) {
    try {
      const parsed = JSON.parse(m.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
      const id = String(parsed?.id || "").toUpperCase().trim();
      if (id === "COMING") return "Coming";
      if (id === "NOT_COMING" || id === "NOT COMING" || id === "NOTCOMING") return "Not Coming";
    } catch (_) {}
  }
  if (m.interactiveResponseMessage?.body?.text) {
    const text = String(m.interactiveResponseMessage.body.text).toUpperCase().trim();
    if (text === "COMING") return "Coming";
    if (text === "NOT COMING" || text === "NOT_COMING") return "Not Coming";
  }

  // 2. Buttons response message
  if (m.buttonsResponseMessage?.selectedButtonId) {
    const id = String(m.buttonsResponseMessage.selectedButtonId).toUpperCase().trim();
    if (id === "COMING") return "Coming";
    if (id === "NOT_COMING" || id === "NOT COMING" || id === "NOTCOMING") return "Not Coming";
  }
  if (m.buttonsResponseMessage?.selectedDisplayText) {
    const text = String(m.buttonsResponseMessage.selectedDisplayText).toUpperCase().trim();
    if (text === "COMING") return "Coming";
    if (text === "NOT COMING" || text === "NOT_COMING") return "Not Coming";
  }

  // 3. Template button reply message
  if (m.templateButtonReplyMessage?.selectedId) {
    const id = String(m.templateButtonReplyMessage.selectedId).toUpperCase().trim();
    if (id === "COMING") return "Coming";
    if (id === "NOT_COMING" || id === "NOT COMING" || id === "NOTCOMING") return "Not Coming";
  }
  if (m.templateButtonReplyMessage?.selectedDisplayText) {
    const text = String(m.templateButtonReplyMessage.selectedDisplayText).toUpperCase().trim();
    if (text === "COMING") return "Coming";
    if (text === "NOT COMING" || text === "NOT_COMING") return "Not Coming";
  }

  // 4. Fallback text response
  const rawText = m.conversation || m.extendedTextMessage?.text || "";
  if (rawText) {
    const cleaned = rawText.trim().toLowerCase();
    if (cleaned === "coming" || cleaned === "1" || cleaned === "yes") {
      return "Coming";
    }
    if (cleaned === "not coming" || cleaned === "not_coming" || cleaned === "2" || cleaned === "no") {
      return "Not Coming";
    }
  }

  return null;
}

export function getWhatsAppStatus() {
  return {
    connected: isConnected,
    connecting: isConnecting,
    hasSocket: !!sock,
    user: sock?.user || null
  };
}

/**
 * Helper to wait for the WhatsApp socket to become active.
 * Prevents requests from failing immediately if the socket is currently opening.
 */
export async function waitForConnection(timeoutMs = 15000) {
  if (sock && isConnected) return true;

  if (!sock && !isConnecting) {
    console.log("ℹ️ WhatsApp connection not active, initiating startWhatsApp()...");
    startWhatsApp().catch((err) => {
      console.error("❌ WhatsApp startup error in waitForConnection:", err.message);
    });
  }

  const startTime = Date.now();
  return new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      if (sock && isConnected) {
        clearInterval(checkInterval);
        resolve(true);
      } else if (Date.now() - startTime >= timeoutMs) {
        clearInterval(checkInterval);
        resolve(isConnected);
      }
    }, 300);
  });
}

/**
 * Processes an incoming WhatsApp message:
 * - Strictly ignores groups, broadcasts, newsletters
 * - Strictly ignores unknown/unregistered numbers
 * - Strictly ignores random messages (only accepts valid COMING / NOT COMING)
 * - Updates student travelStatus and locks response
 * - Sends confirmation message ONLY to that registered student
 */
export async function handleIncomingWhatsAppMessage(msg, sockInstance = sock) {
  try {
    // 1. Group, Broadcast, Newsletter filtering:
    // Strictly ignore any non-private messages
    const rawRemoteJid = String(msg?.key?.remoteJid || "");
    const rawParticipant = String(msg?.key?.participant || "");

    const isGroup = rawRemoteJid.endsWith("@g.us") || rawRemoteJid.includes("@g.us") || Boolean(rawParticipant && rawRemoteJid.includes("@g.us"));
    const isBroadcast = rawRemoteJid.endsWith("@broadcast") || rawRemoteJid.includes("@broadcast");
    const isNewsletter = rawRemoteJid.endsWith("@newsletter") || rawRemoteJid.includes("@newsletter");

    if (isGroup || isBroadcast || isNewsletter || rawParticipant) {
      // WhatsApp groups, broadcasts, and newsletters must remain completely ignored
      return { ignored: true, reason: "group_broadcast_newsletter" };
    }

    const isPrivateSender = rawRemoteJid.endsWith("@s.whatsapp.net") || rawRemoteJid.endsWith("@lid");
    if (!isPrivateSender) {
      return { ignored: true, reason: "non_private_jid" };
    }

    // 2. Parse response: only valid "Coming" or "Not Coming" is processed.
    // Random text (Hello, Hi, Test, etc.) yields null and is silently skipped.
    const response = parseIncomingTravelResponse(msg);
    if (!response || (response !== "Coming" && response !== "Not Coming")) {
      return { ignored: true, reason: "invalid_or_random_response" };
    }

    let senderJid = rawRemoteJid;
    if (msg.key?.remoteJidPn) {
      senderJid = msg.key.remoteJidPn;
    }

    // If the message is marked fromMe, allow owner interaction (self-chat or device testing)
    if (msg.key?.fromMe) {
      const myLid = sockInstance?.user?.lid ? sockInstance.user.lid.split("@")[0].split(":")[0] : null;
      const myPhone = normalizePhoneNumber(sockInstance?.user?.id);
      const isOwnerSelf = (myLid && senderJid.includes(myLid)) ||
                          (myPhone && senderJid.includes(myPhone.slice(-10)));
      if (!isOwnerSelf) {
        return { ignored: true, reason: "from_me_unauthorized" };
      }
      if (myPhone) {
        senderJid = `${myPhone}@s.whatsapp.net`;
      }
    }

    // 3. Robustly match student in MongoDB (resolves privacy LIDs, spaced numbers like "97903 80815")
    const student = await findStudentByWhatsAppJid(senderJid, sockInstance);
    const resolvedPhone = await resolveLidToPhoneNumber(senderJid, sockInstance);
    const normalizedPhone = resolvedPhone || normalizePhoneNumber(senderJid) || senderJid;

    // Diagnostic logging
    console.log(`[WHATSAPP INBOUND] Student Identification:
  - raw sender JID: ${senderJid}
  - normalized phone used for lookup: ${normalizedPhone}
  - matching user found: ${Boolean(student)}
  - matched User ID: ${student ? `${student.userId} (${student.name})` : "N/A"}
  - current travelStatus: ${student ? student.travelStatus : "N/A"}`);

    // 4. Unknown or unregistered number: SILENTLY IGNORE.
    // NEVER send "Your phone number is not linked..." or any confirmation.
    if (!student || student.role !== "student") {
      console.log(`[WHATSAPP INBOUND] Sender "${senderJid}" (${normalizedPhone}) is not an active registered student. Silently ignored.`);
      return { ignored: true, reason: "unregistered_student" };
    }

    console.log(`[WHATSAPP INBOUND] Processing travel response "${response}" for registered student ${student.name} (${student.userId})...`);

    // 5. Update database & lock response for this cycle
    const result = await handleStudentTravelStatusSubmission({
      user: student,
      travelStatus: response,
      source: "whatsapp"
    });

    // 6. Only when database update succeeds, send confirmation message back to THAT SAME REGISTERED STUDENT
    if (result.success) {
      console.log(`[WHATSAPP INBOUND] Successfully updated student ${student.name} travelStatus to "${response}". Sending confirmation message...`);
      const studentName = student.name || "Student";
      const confirmationText = `Hello ${studentName},\n\n✅ Your travel response "${response}" has been recorded successfully.\n\nYour response is now locked until administrator reset.`;

      let sentRecipient = senderJid;
      if (sockInstance?.sendMessage) {
        try {
          await sockInstance.sendMessage(senderJid, { text: confirmationText });
          console.log(`[WHATSAPP INBOUND] Confirmation message sent to ${senderJid} for student ${student.name}.`);
        } catch (sendErr) {
          const studentPhoneJid = formatWhatsAppJid(student.phoneNumber);
          if (studentPhoneJid && studentPhoneJid !== senderJid) {
            console.warn(`[WHATSAPP INBOUND] Retrying confirmation send to registered phone JID ${studentPhoneJid}...`);
            await sockInstance.sendMessage(studentPhoneJid, { text: confirmationText });
            sentRecipient = studentPhoneJid;
          } else {
            throw sendErr;
          }
        }
      }

      return {
        success: true,
        confirmationSent: true,
        student,
        travelStatus: response,
        recipient: sentRecipient,
        confirmationText
      };
    } else {
      console.log(`[WHATSAPP INBOUND] Submission not applied for ${student.name}: ${result.message}`);

      if (result.alreadySubmitted || result.responseLocked || result.code === "RESPONSE_ALREADY_SUBMITTED") {
        const recordedStatus = result.travelStatus || student.travelStatus || "Coming";
        const studentName = student.name || "Student";
        const lockedMessage = `Hello ${studentName},\n\nYour travel response has already been recorded as "${recordedStatus}". Your response is locked and cannot be changed until administrator reset.`;

        let sentRecipient = senderJid;
        if (sockInstance?.sendMessage) {
          try {
            await sockInstance.sendMessage(senderJid, { text: lockedMessage });
            console.log(`[WHATSAPP INBOUND] Locked response message sent to ${senderJid} for student ${student.name}.`);
          } catch (sendErr) {
            const studentPhoneJid = formatWhatsAppJid(student.phoneNumber);
            if (studentPhoneJid && studentPhoneJid !== senderJid) {
              await sockInstance.sendMessage(studentPhoneJid, { text: lockedMessage });
              sentRecipient = studentPhoneJid;
            }
          }
        }

        return {
          success: false,
          alreadySubmitted: true,
          responseLocked: true,
          travelStatus: recordedStatus,
          recipient: sentRecipient,
          lockedMessage,
          reason: result.message || "already_submitted",
          result
        };
      }

      return {
        success: false,
        confirmationSent: false,
        reason: result.message || "already_submitted",
        result
      };
    }
  } catch (inboundErr) {
    console.error("[WHATSAPP INBOUND] Error handling incoming student response:", inboundErr);
    return { success: false, confirmationSent: false, error: inboundErr.message };
  }
}

/**
 * Initializes the single WhatsApp Baileys socket instance.
 * Safe against multiple simultaneous connections and infinite conflict loops.
 */
export async function startWhatsApp() {
  if (sock && isConnected) {
    console.log("ℹ️ WhatsApp is already connected");
    return sock;
  }

  if (isConnecting) {
    console.log("⚠️ WhatsApp connection already in progress");
    return sock;
  }

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  isConnecting = true;

  try {
    // Clean up any stale socket listeners before instantiating a new one
    if (sock) {
      try {
        sock.ev.removeAllListeners();
        sock.end?.();
      } catch (_) {}
      sock = null;
    }

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    sock = makeWASocket({
      auth: state
    });

    sock.ev.on("creds.update", saveCreds);

    // Listen for Baileys LID mapping updates
    sock.ev.on("lid-mapping.update", ({ lid, pn }) => {
      if (lid && pn) {
        const lidDigits = String(lid).split("@")[0].split(":")[0].replace(/\D/g, "");
        const pnNormalized = normalizePhoneNumber(pn);
        if (lidDigits && pnNormalized) {
          lidToPhoneMap.set(lidDigits, pnNormalized);
        }
      }
    });

    // Listen for incoming messages & interactive button responses from students
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify" && type !== "append") return;

      for (const msg of messages) {
        await handleIncomingWhatsAppMessage(msg, sock);
      }
    });

    sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        console.log("\n📱 Scan this QR code with WhatsApp:\n");
        qrcode.generate(qr, { small: true });
      }

      if (connection === "open") {
        console.log("✅ WhatsApp connected");
        isConnected = true;
        isConnecting = false;
        reconnectAttempts = 0;
      }

      if (connection === "close") {
        isConnected = false;
        isConnecting = false;

        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const errorMessage = lastDisconnect?.error?.message || "Unknown error";
        console.log(
          `❌ WhatsApp disconnected. Status: ${statusCode || "unknown"} (${errorMessage})`
        );

        if (statusCode === DisconnectReason.loggedOut) {
          console.log("🚪 WhatsApp logged out. Login/QR scan required again.");
          sock = null;
          return;
        }

        if (statusCode === DisconnectReason.connectionReplaced) {
          console.warn(
            "⚠️ WhatsApp connection replaced by another session/process.\n" +
            "   Please make sure only ONE backend process owns the WhatsApp session.\n" +
            "   Scheduling recovery attempt in 10s..."
          );
          sock = null;
          if (reconnectTimeout) clearTimeout(reconnectTimeout);
          reconnectTimeout = setTimeout(() => {
            console.log("🔄 Attempting WhatsApp reconnection after session replacement pause...");
            startWhatsApp().catch((err) => {
              console.warn("⚠️ Reconnect attempt warning:", err?.message || err);
            });
          }, 10000);
          return;
        }

        // Reconnect with backoff, continuing indefinitely in background so listener never dies
        reconnectAttempts++;
        const delayMs = reconnectAttempts <= MAX_RECONNECT_ATTEMPTS
          ? Math.min(reconnectAttempts * 2000, 10000)
          : 30000;
        console.log(
          `🔄 Reconnecting WhatsApp in ${delayMs / 1000}s (attempt ${reconnectAttempts})...`
        );
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(() => {
          startWhatsApp().catch((err) => {
            console.error("❌ WhatsApp reconnection error:", err?.message || err);
          });
        }, delayMs);
      }
    });

    return sock;
  } catch (error) {
    sock = null;
    isConnecting = false;
    isConnected = false;
    console.error("❌ Error initializing WhatsApp socket:", error);
    throw error;
  }
}

/**
 * Sends a WhatsApp text message to the specified phone number.
 * Ensures JID is properly normalized with country code and validates recipient existence.
 */
export async function sendWhatsAppMessage(phoneNumber, message, options = {}) {
  if (!phoneNumber) {
    throw new Error("Phone number is required");
  }

  if (!message) {
    throw new Error("Message is required");
  }

  // 1. Ensure connection is active, waiting if currently connecting
  if (!sock || !isConnected) {
    console.log("⏳ WhatsApp not ready yet, waiting for connection...");
    const connected = await waitForConnection(12000);
    if (!connected || !sock) {
      throw new Error("WhatsApp is not connected. Please check terminal for QR code or connection status.");
    }
  }

  // 2. Normalize destination phone number
  const normalizedNumber = normalizePhoneNumber(phoneNumber);
  if (!normalizedNumber) {
    throw new Error(`Invalid phone number provided: ${phoneNumber}`);
  }

  const jid = `${normalizedNumber}@s.whatsapp.net`;

  // 3. Verify destination number exists on WhatsApp if supported
  let targetJid = jid;
  try {
    if (typeof sock.onWhatsApp === "function") {
      const results = await sock.onWhatsApp(jid);
      if (Array.isArray(results) && results.length > 0) {
        const status = results[0];
        if (!status.exists) {
          throw new Error(`Phone number ${phoneNumber} (${normalizedNumber}) is not registered on WhatsApp`);
        }
        if (status.jid) {
          targetJid = status.jid;
        }
      }
    }
  } catch (verifyErr) {
    if (verifyErr.message && verifyErr.message.includes("not registered on WhatsApp")) {
      throw verifyErr;
    }
    console.warn(`⚠️ Warning during onWhatsApp check for ${jid}: ${verifyErr.message}. Proceeding with direct send.`);
  }

  // 4. Send message with interactive buttons if travel status
  const isTravelStatus = Boolean(
    options?.isTravelStatus ||
    (typeof message === "string" && message.includes("submit your travel status"))
  );

  if (isTravelStatus) {
    try {
      console.log(`📤 Sending WhatsApp interactive button message to ${targetJid}...`);
      const waMsg = generateWAMessageFromContent(
        targetJid,
        {
          interactiveMessage: {
            header: {
              hasMediaAttachment: false
            },
            body: {
              text: message
            },
            nativeFlowMessage: {
              buttons: [
                {
                  name: "quick_reply",
                  buttonParamsJson: JSON.stringify({
                    display_text: "COMING",
                    id: "COMING"
                  })
                },
                {
                  name: "quick_reply",
                  buttonParamsJson: JSON.stringify({
                    display_text: "NOT COMING",
                    id: "NOT_COMING"
                  })
                }
              ],
              messageParamsJson: ""
            }
          }
        },
        { userJid: sock.user?.id }
      );

      await sock.relayMessage(
        targetJid,
        waMsg.message,
        {
          messageId: waMsg.key.id,
          additionalNodes: [
            {
              tag: "biz",
              attrs: {},
              content: [
                {
                  tag: "interactive",
                  attrs: {
                    type: "native_flow",
                    v: "1"
                  },
                  content: [
                    {
                      tag: "native_flow",
                      attrs: {
                        v: "9",
                        name: "mixed"
                      }
                    }
                  ]
                }
              ]
            },
            {
              tag: "bot",
              attrs: {
                biz_bot: "1"
              }
            }
          ]
        }
      );
      const messageId = waMsg.key?.id || "N/A";
      console.log(`✅ WhatsApp interactive travel status message sent to ${targetJid} [Message ID: ${messageId}]`);
      return {
        success: true,
        messageId,
        recipient: targetJid
      };
    } catch (interactiveErr) {
      console.warn(`⚠️ Failed to relay interactive buttons to ${targetJid}: ${interactiveErr.message}. Falling back to standard text message.`);
    }
  }

  // 5. Standard text message fallback
  try {
    console.log(`📤 Sending WhatsApp message to ${targetJid} (normalized from ${phoneNumber})...`);
    const result = await sock.sendMessage(targetJid, {
      text: message
    });

    const messageId = result?.key?.id || "N/A";
    console.log(`✅ WhatsApp message sent to ${targetJid} [Message ID: ${messageId}]`);

    return {
      success: true,
      messageId,
      recipient: targetJid
    };
  } catch (error) {
    console.error(`❌ Baileys sendMessage failed for recipient ${targetJid}:`);
    console.error("  Error Message:", error?.message);
    if (error?.output) {
      console.error("  Boom Output:", JSON.stringify(error.output, null, 2));
    }
    if (error?.data) {
      console.error("  Error Data:", JSON.stringify(error.data, null, 2));
    }
    console.error("  Error Stack:", error?.stack);

    const descriptiveError = new Error(error?.message || "Failed to send WhatsApp message via Baileys");
    if (error?.output?.statusCode) {
      descriptiveError.statusCode = error.output.statusCode;
    }
    throw descriptiveError;
  }
}

export function closeWhatsApp() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  if (sock) {
    try {
      sock.ev.removeAllListeners();
      sock.end?.();
    } catch (_) {}
    sock = null;
  }
  isConnected = false;
  isConnecting = false;
}