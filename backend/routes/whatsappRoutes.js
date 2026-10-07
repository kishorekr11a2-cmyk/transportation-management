import express from "express";
import { sendWhatsAppMessage, getWhatsAppStatus } from "../whatsapp/whatsappService.js";
import {
  sendTravelStatusNotifications,
  checkAllocationReadiness,
  sendAllocationDetailsNotifications
} from "../services/travelStatusAutomationService.js";

const router = express.Router();

router.get("/status", (req, res) => {
  const status = getWhatsAppStatus();
  return res.status(200).json({
    success: true,
    ...status
  });
});

// Endpoint to send WhatsApp messages (used by n8n HTTP Request node)
router.post("/send", async (req, res) => {
  const { phoneNumber, message } = req.body;
  try {

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

    const isTravelStatus = Boolean(
      req.body?.isTravelStatus ||
      req.body?.type === "travel_status" ||
      (typeof message === "string" && message.includes("submit your travel status"))
    );

    await sendWhatsAppMessage(phoneNumber, message, { isTravelStatus });

    return res.status(200).json({
      success: true,
      message: "WhatsApp message dispatched successfully"
    });
  } catch (error) {
    console.error("❌ Send WhatsApp message error:", error);
    return res.status(500).json({
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

// Check if Approved + Allocated conditions are met for sending allocation details
router.get("/allocation-status", async (req, res) => {
  try {
    const readiness = await checkAllocationReadiness();
    return res.status(200).json({
      success: true,
      data: readiness
    });
  } catch (error) {
    console.error("❌ Allocation readiness check error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to check allocation readiness"
    });
  }
});

// Send approved transportation allocation details to allocated students
// Strict constraint: Works ONLY when approved plan exists AND students are allocated
router.post("/send-allocation-details", async (req, res) => {
  try {
    const summary = await sendAllocationDetailsNotifications();

    return res.status(200).json({
      success: summary.sentCount > 0 || summary.failedCount === 0,
      message: summary.sentCount > 0
        ? `Allocation details sent successfully to ${summary.sentCount} allocated student(s).`
        : (summary.failedCount > 0
          ? "Failed to dispatch messages via n8n automation."
          : "No eligible allocated students with valid phone numbers found."),
      data: summary
    });
  } catch (error) {
    console.error("❌ Send allocation details error:", error.message);
    const statusCode = error.statusCode && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500;
    return res.status(statusCode).json({
      success: false,
      code: error.code || "ALLOCATION_SEND_FAILED",
      message: error.message || "Failed to send allocation details"
    });
  }
});

export default router;