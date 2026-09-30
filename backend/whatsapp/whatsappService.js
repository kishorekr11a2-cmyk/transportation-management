import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUTH_DIR = path.resolve(__dirname, "auth");

let sock = null;
let isConnected = false;
let isConnecting = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
let reconnectTimeout = null;

/**
 * Normalizes phone numbers for WhatsApp.
 * - Converts 10-digit Indian numbers to E.164 (prepends 91)
 * - Preserves existing country code (does not double append 91)
 * - Handles leading zeros, + signs, dashes, spaces, and JID suffixes
 */
export function normalizePhoneNumber(phoneNumber) {
  if (!phoneNumber) return null;

  if (typeof phoneNumber === "string" && phoneNumber.endsWith("@s.whatsapp.net")) {
    phoneNumber = phoneNumber.replace("@s.whatsapp.net", "");
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
            "   Reconnection paused to avoid conflict loop."
          );
          sock = null;
          return;
        }

        // Reconnect with exponential backoff up to MAX_RECONNECT_ATTEMPTS
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          const delayMs = Math.min(reconnectAttempts * 2000, 10000);
          console.log(
            `🔄 Reconnecting WhatsApp in ${delayMs / 1000}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`
          );
          reconnectTimeout = setTimeout(() => {
            startWhatsApp().catch((err) => {
              console.error("❌ WhatsApp reconnection error:", err?.message || err);
            });
          }, delayMs);
        } else {
          console.error(
            "❌ WhatsApp maximum reconnection attempts reached. Check network or restart server."
          );
          sock = null;
        }
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
export async function sendWhatsAppMessage(phoneNumber, message) {
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

  // 4. Send message with full error details logged
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