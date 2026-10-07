import api from "./api";

export const N8N_TRAVEL_STATUS_WEBHOOK_URL =
    import.meta.env?.VITE_N8N_TRAVEL_STATUS_WEBHOOK_URL ||
    "http://localhost:5678/webhook/transport/send-travel-status";

/**
 * Trigger the WhatsApp Travel Status Notification automation.
 *
 * Flow:
 * Frontend -> Backend (/api/whatsapp/send-travel-status)
 *   -> Backend queries eligible users with valid phone numbers
 *   -> Backend dispatches individual notifications to n8n webhook
 *   -> n8n HTTP Request node calls POST /api/whatsapp/send
 *   -> Baileys sends WhatsApp message
 */
export const triggerTravelStatusAutomation = async () => {
    const response = await api.post("/whatsapp/send-travel-status", {}, {
        timeout: 60000
    });
    return response.data;
};

/**
 * Check if Approved + Allocated conditions are met for sending allocation details.
 */
export const getAllocationStatus = async () => {
    const response = await api.get("/whatsapp/allocation-status");
    return response.data;
};

/**
 * Trigger sending approved transportation allocation details to allocated students.
 */
export const triggerAllocationDetailsAutomation = async () => {
    const response = await api.post("/whatsapp/send-allocation-details", {}, {
        timeout: 60000
    });
    return response.data;
};

export default {
    triggerTravelStatusAutomation,
    getAllocationStatus,
    triggerAllocationDetailsAutomation,
    N8N_TRAVEL_STATUS_WEBHOOK_URL
};
