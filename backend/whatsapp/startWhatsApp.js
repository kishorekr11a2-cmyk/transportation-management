import http from "http";
import { startWhatsApp } from "./whatsappService.js";

// Check if the backend server is already running on port 5000 to prevent conflicting sockets
const checkReq = http.get("http://localhost:5000/api/health", (res) => {
  console.warn(
    "\n⚠️ Backend server is already running on port 5000 and owns the WhatsApp connection.\n" +
    "⚠️ Running startWhatsApp.js separately will spawn a duplicate connection and cause:\n" +
    '   "Stream Errored (conflict) type: replaced".\n' +
    "ℹ️ Please do not run startWhatsApp.js separately when server is running.\n"
  );
  process.exit(0);
});

checkReq.on("error", () => {
  console.log("Starting standalone WhatsApp service...");
  startWhatsApp().catch((error) => {
    console.error("❌ WhatsApp startup failed:", error);
  });
});