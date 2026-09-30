import express from "express";
import { sendWhatsAppMessage, getWhatsAppStatus } from "../whatsapp/whatsappService.js";
import { sendTravelStatusNotifications } from "../services/travelStatusAutomationService.js";

const router = express.Router();

// Status endpoint to check WhatsApp connection
router.get("/status", (req, res) => {
  const status = getWhatsAppStatus();
  return res.json({
    success: true,
    data: status
  });
});

// Endpoint to send WhatsApp messages (used by n8n HTTP Request node)
router.post("/send", async (req, res) => {
  try {
    const { phoneNumber, message } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required"
      });
    }

    if (!message) {
      return res.status(400).json({
        success: false,
        message: "Message is required"
      });
    }

    await sendWhatsAppMessage(phoneNumber, message);

    return res.status(200).json({
      success: true,
      message: "WhatsApp message sent successfully"
    });
  } catch (error) {
    console.error("❌ WhatsApp send route error:", {
      message: error?.message,
      statusCode: error?.statusCode,
      stack: error?.stack
    });

    const statusCode =
      error?.statusCode && error.statusCode >= 400 && error.statusCode < 600
        ? error.statusCode
        : 500;

    return res.status(statusCode).json({
      success: false,
      message: error?.message || "Failed to send WhatsApp message"
    });
  }
});

// Endpoint to trigger automated travel status notifications to all eligible users via n8n
router.post("/send-travel-status", async (req, res) => {
  try {
    const summary = await sendTravelStatusNotifications();

    return res.status(200).json({
      success: summary.failedCount === 0 || summary.sentCount > 0,
      message: summary.sentCount > 0
        ? "Travel status notifications sent successfully."
        : (summary.failedCount > 0
          ? "Failed to dispatch messages. Please ensure n8n automation is running."
          : "No eligible registered users with valid phone numbers."),
      data: summary
    });
  } catch (error) {
    console.error("❌ Send travel status automation error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to trigger travel status automation"
    });
  }
});

export default router;