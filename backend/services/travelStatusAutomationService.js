
import User from "../models/User.js";

const DEFAULT_WEBHOOK_URL =
    "http://localhost:5678/webhook/transport/send-travel-status";

/**
 * Validates the basic structure of a phone number.
 * This does not guarantee that the number is registered on WhatsApp.
 */
export function isValidPhoneNumber(phoneNumber) {
    if (phoneNumber === null || phoneNumber === undefined) return false;

    const digitsOnly = String(phoneNumber).replace(/\D/g, "");
    return digitsOnly.length >= 10 && digitsOnly.length <= 15;
}

/**
 * Generates the travel-status notification for a user.
 */
export function generateTravelStatusMessage(user) {
    const name = String(user?.name || "").trim();
    const userId = String(user?.userId || "").trim();
    const displayName =
        name.length > 2 ? name : userId || name || "User";

    return `Hello ${displayName},
     Please update your travel status in the AI-Based Transportation Management system for admin review and approval. If you have already updated your status, please check your approved bus details.
     This is an automated message sent as part of my AI-Based Transportation Management project automation testing.`;
}

/**
 * Sends travel-status notifications through the n8n production webhook.
 *
 * A successful response means n8n accepted the request; it does not
 * independently confirm delivery to the recipient's WhatsApp account.
 */
export async function sendTravelStatusNotifications(options = {}) {
    const configuredUrl =
        options.webhookUrl ||
        process.env.N8N_TRAVEL_STATUS_WEBHOOK_URL ||
        DEFAULT_WEBHOOK_URL;

    // Use the published production webhook, not the test webhook.
    const webhookUrl = configuredUrl.replace(
        "/webhook-test/",
        "/webhook/"
    );

    console.log("[WHATSAPP AUTOMATION] Starting notification run.");
    console.log(`[WHATSAPP AUTOMATION] Webhook: ${webhookUrl}`);

    const users = await User.find({ role: { $ne: "admin" } })
        .select({
            userId: 1,
            name: 1,
            phoneNumber: 1,
            travelStatus: 1,
            role: 1
        })
        .lean();

    const totalUsers = users.length;
    const eligibleUsers = [];
    const skippedUsers = [];
    const seenPhones = new Set();

    for (const user of users) {
        if (!isValidPhoneNumber(user.phoneNumber)) {
            skippedUsers.push({
                userId: user.userId,
                name: user.name,
                status: "skipped",
                reason: "Missing or invalid phone number"
            });
            continue;
        }

        // Normalize only for duplicate detection; preserve the stored
        // phone number when sending it to avoid changing country codes.
        const cleanPhone = String(user.phoneNumber).trim();
        const phoneKey = cleanPhone.replace(/\D/g, "");

        if (seenPhones.has(phoneKey)) {
            skippedUsers.push({
                userId: user.userId,
                name: user.name,
                status: "skipped",
                reason: "Duplicate phone number in this run"
            });
            continue;
        }

        seenPhones.add(phoneKey);
        eligibleUsers.push({ user, cleanPhone });
    }

    console.log(`[WHATSAPP AUTOMATION] Total users: ${totalUsers}`);
    console.log(
        `[WHATSAPP AUTOMATION] Eligible unique numbers: ${eligibleUsers.length}`
    );
    console.log(
        `[WHATSAPP AUTOMATION] Skipped: ${skippedUsers.length}`
    );

    let sentCount = 0;
    let failedCount = 0;
    const results = [...skippedUsers];

    if (eligibleUsers.length === 0) {
        console.log("[WHATSAPP AUTOMATION] No eligible users with valid phone numbers.");
        return {
            totalUsers,
            eligibleUsers: 0,
            sentCount: 0,
            skippedCount: skippedUsers.length,
            failedCount: 0,
            results
        };
    }

    const usersPayload = eligibleUsers.map(({ user, cleanPhone }) => ({
        userId: user.userId,
        name: user.name,
        phoneNumber: cleanPhone,
        message: generateTravelStatusMessage(user)
    }));

    const webhookPayload = {
        totalEligible: eligibleUsers.length,
        users: usersPayload,
        phoneNumber: eligibleUsers[0]?.cleanPhone,
        message: generateTravelStatusMessage(eligibleUsers[0]?.user)
    };

    try {
        const response = await fetch(webhookUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(webhookPayload),
            signal: AbortSignal.timeout(30000)
        });

        if (!response.ok) {
            failedCount = eligibleUsers.length;
            const responseText = await response.text().catch(() => "");
            const errorMessage =
                `Webhook HTTP ${response.status}` +
                (responseText ? `: ${responseText}` : "");

            console.error(
                `[WHATSAPP AUTOMATION] Webhook dispatch failed: HTTP ${response.status} ${errorMessage}`
            );

            for (const { user } of eligibleUsers) {
                results.push({
                    userId: user.userId,
                    name: user.name,
                    status: "failed",
                    error: errorMessage
                });
            }
        } else {
            sentCount = eligibleUsers.length;
            console.log(
                `[WHATSAPP AUTOMATION] Webhook accepted bulk request for ${sentCount} eligible students.`
            );

            for (const { user } of eligibleUsers) {
                results.push({
                    userId: user.userId,
                    name: user.name,
                    status: "accepted_by_webhook"
                });
            }
        }
    } catch (error) {
        failedCount = eligibleUsers.length;
        console.error(
            `[WHATSAPP AUTOMATION] Request failed to reach n8n webhook: ${error.message}`
        );

        for (const { user } of eligibleUsers) {
            results.push({
                userId: user.userId,
                name: user.name,
                status: "failed",
                error: error.message || "Failed to reach n8n webhook"
            });
        }
    }

    console.log("[WHATSAPP AUTOMATION] Notification run completed.");
    console.log(`[WHATSAPP AUTOMATION] Accepted by webhook: ${sentCount}`);
    console.log(`[WHATSAPP AUTOMATION] Skipped: ${skippedUsers.length}`);
    console.log(`[WHATSAPP AUTOMATION] Failed: ${failedCount}`);

    return {
        totalUsers,
        eligibleUsers: eligibleUsers.length,
        sentCount,
        skippedCount: skippedUsers.length,
        failedCount,
        results
    };
}

export default {
    isValidPhoneNumber,
    generateTravelStatusMessage,
    sendTravelStatusNotifications
};
