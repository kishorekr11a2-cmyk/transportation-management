import User from "../models/User.js";
import {
    getActiveApprovedPlans,
    batchCalculateStudentTransportStatuses
} from "./studentTransportStatusService.js";

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
    const displayName = (name || userId || "Student").toUpperCase();

    return `Hello ${displayName},\n\nPlease submit your travel status for today's college transportation:
    \nNote: You can submit your travel response is locked.
    \n intu vanthu oru automation message so leave and do your work 😊
    \n if u wish u can give any response by clicking below.`;
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

        if (response.ok) {
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
        } else {
            // n8n returned non-OK (e.g. 404 = workflow not active). Fall back to direct Baileys.
            const responseText = await response.text().catch(() => "");
            console.warn(
                `[WHATSAPP AUTOMATION] Webhook returned HTTP ${response.status}. Falling back to direct Baileys... (${responseText.slice(0, 120)})`
            );
            throw new Error(`Webhook HTTP ${response.status}: ${responseText.slice(0, 80)}`);
        }
    } catch (error) {
        console.warn(
            `[WHATSAPP AUTOMATION] n8n not available (${error.message}). Attempting direct WhatsApp dispatch via Baileys...`
        );

        try {
            const { sendWhatsAppMessage } = await import("../whatsapp/whatsappService.js");
            for (const { user, cleanPhone } of eligibleUsers) {
                try {
                    const msg = generateTravelStatusMessage(user);
                    await sendWhatsAppMessage(cleanPhone, msg, { isTravelStatus: true });
                    sentCount++;
                    console.log(`[WHATSAPP AUTOMATION] Direct send OK → ${user.name || user.userId} (${cleanPhone})`);
                    results.push({
                        userId: user.userId,
                        name: user.name,
                        status: "sent_direct_baileys"
                    });
                } catch (sendErr) {
                    failedCount++;
                    console.error(`[WHATSAPP AUTOMATION] Direct send FAILED for ${user.name || user.userId}: ${sendErr.message}`);
                    results.push({
                        userId: user.userId,
                        name: user.name,
                        status: "failed",
                        error: sendErr.message
                    });
                }
            }
        } catch (fallbackErr) {
            failedCount = eligibleUsers.length;
            console.error(`[WHATSAPP AUTOMATION] Baileys fallback import failed: ${fallbackErr.message}`);
            for (const { user } of eligibleUsers) {
                results.push({
                    userId: user.userId,
                    name: user.name,
                    status: "failed",
                    error: error.message || "Failed to reach n8n webhook and fallback dispatch failed"
                });
            }
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

/**
 * Formats WhatsApp allocation confirmation details from real database allocation.
 *
 * Requirements:
 * - OUTWARD (College / University → Student Residential Area):
 *   Direction: College → Residential Area
 *   Bus: BUS-05
 *   Route: Route 3
 *   Drop-off Stop: Thirunagar
 *
 * - INWARD (Student Residential Area → College / University):
 *   Direction: Residential Area → College
 *   Bus: BUS-05
 *   Route: Route 3
 *   Pickup Stop: Thirunagar
 *
 * - MUST NOT INCLUDE "Trip: Morning" or "Trip: Evening".
 * - MUST NOT hardcode bus, route, or stop.
 */
export function formatAllocationMessage(student) {
    const parts = ["Transportation Allocation Confirmed"];

    const inward =
        student?.inward ||
        (student?.allocatedBus?.direction === "INWARD"
            ? student?.allocatedBus
            : null);

    const outward =
        student?.outward ||
        (student?.allocatedBus?.direction === "OUTWARD"
            ? student?.allocatedBus
            : null);

    const isInwardAllocated = Boolean(
        inward?.isAllocated ||
        (student?.allocatedBus?.direction === "INWARD" &&
            (student?.isAllocated ||
                student?.allocationStatus === "Assigned"))
    );

    const isOutwardAllocated = Boolean(
        outward?.isAllocated ||
        (student?.allocatedBus?.direction === "OUTWARD" &&
            (student?.isAllocated ||
                student?.allocationStatus === "Assigned"))
    );

    if (isInwardAllocated) {
        const bus =
            inward?.vehicleName ||
            inward?.vehicle ||
            student?.assignedVehicle ||
            student?.allocatedVehicle ||
            "N/A";

        const route =
            inward?.routeCode ||
            inward?.routeName ||
            inward?.route ||
            student?.assignedRoute ||
            student?.allocatedRoute ||
            "N/A";

        const stop =
            inward?.pickupStop ||
            inward?.boardingStop ||
            inward?.stopName ||
            student?.stoppings ||
            "N/A";

        parts.push(
            `Direction: Residential Area → College\nBus: ${bus}\nRoute: ${route}\nPickup Stop: ${stop}`
        );
    }

    if (isOutwardAllocated) {
        const bus =
            outward?.vehicleName ||
            outward?.vehicle ||
            student?.assignedVehicle ||
            student?.allocatedVehicle ||
            "N/A";

        const route =
            outward?.routeCode ||
            outward?.routeName ||
            outward?.route ||
            student?.assignedRoute ||
            student?.allocatedRoute ||
            "N/A";

        const stop =
            outward?.dropoffStop ||
            outward?.boardingStop ||
            outward?.stopName ||
            student?.stoppings ||
            "N/A";

        parts.push(
            `Direction: College → Residential Area\nBus: ${bus}\nRoute: ${route}\nDrop-off Stop: ${stop}`
        );
    }

    // Fallback if neither directional flag is explicitly separate but top-level allocation exists
    if (
        !isInwardAllocated &&
        !isOutwardAllocated &&
        (student?.isAllocated ||
            student?.allocationStatus === "Assigned")
    ) {
        const dir = String(
            student.direction ||
            student.allocatedBus?.direction ||
            "INWARD"
        ).toUpperCase();

        const bus =
            student.assignedVehicle ||
            student.allocatedVehicle ||
            student.allocatedBus?.vehicleName ||
            "N/A";

        const route =
            student.assignedRoute ||
            student.allocatedRoute ||
            student.allocatedBus?.routeCode ||
            "N/A";

        const stop =
            student.stoppings ||
            student.allocatedBus?.boardingStop ||
            "N/A";

        if (dir === "OUTWARD") {
            parts.push(
                `Direction: College → Residential Area\nBus: ${bus}\nRoute: ${route}\nDrop-off Stop: ${stop}`
            );
        } else {
            parts.push(
                `Direction: Residential Area → College\nBus: ${bus}\nRoute: ${route}\nPickup Stop: ${stop}`
            );
        }
    }

    return parts.join("\n\n");
}

/**
 * Checks readiness for sending allocation details:
 * Valid ONLY when:
 * 1. An approved transportation plan exists.
 * 2. Students have actually been assigned/allocated transportation.
 */
export async function checkAllocationReadiness() {
    const activePlans = await getActiveApprovedPlans({
        forceRefresh: true
    });

    const hasApprovedPlan = Boolean(
        (activePlans?.INWARD &&
            activePlans.INWARD.isApproved) ||
        (activePlans?.OUTWARD &&
            activePlans.OUTWARD.isApproved) ||
        (activePlans?.primaryPlan &&
            activePlans.primaryPlan.isApproved)
    );

    if (!hasApprovedPlan) {
        return {
            canSendAllocation: false,
            hasApprovedPlan: false,
            allocatedCount: 0,
            eligibleCount: 0,
            reason:
                "No approved transportation plan exists. An approved plan is required."
        };
    }

    const students = await User.find({
        role: { $ne: "admin" }
    }).lean();

    const allocatedStatuses =
        await batchCalculateStudentTransportStatuses(students);

    const allocatedStudents = allocatedStatuses.filter(
        (s) =>
            s.isAllocated &&
            !s.isLateResponse &&
            (s.inward?.isAllocated ||
                s.outward?.isAllocated ||
                s.allocatedBus?.isAllocated)
    );

    const eligibleAllocatedStudents = allocatedStudents.filter(
        (s) => isValidPhoneNumber(s.phoneNumber)
    );

    const canSendAllocation =
        hasApprovedPlan && allocatedStudents.length > 0;

    return {
        canSendAllocation,
        hasApprovedPlan,
        allocatedCount: allocatedStudents.length,
        eligibleCount: eligibleAllocatedStudents.length,
        reason: !canSendAllocation
            ? "Approved plan exists, but no students are currently allocated transportation."
            : `Approved plan with ${allocatedStudents.length} allocated student(s) ready.`
    };
}

/**
 * Sends approved transportation allocation details
 * to allocated students.
 *
 * Enforces requirement:
 * APPROVED + ALLOCATED only.
 */
export async function sendAllocationDetailsNotifications(
    options = {}
) {
    const readiness = await checkAllocationReadiness();

    if (!readiness.hasApprovedPlan) {
        const error = new Error(
            "No approved transportation plan exists. An approved plan is required before sending allocation details."
        );

        error.statusCode = 400;
        error.code = "NO_APPROVED_PLAN";

        throw error;
    }

    if (readiness.allocatedCount === 0) {
        const error = new Error(
            "No students are allocated transportation in the approved plan. Allocation details can only be sent when students have actually been assigned transportation."
        );

        error.statusCode = 400;
        error.code = "NO_ALLOCATED_STUDENTS";

        throw error;
    }

    const students = await User.find({
        role: { $ne: "admin" }
    }).lean();

    const studentStatuses =
        await batchCalculateStudentTransportStatuses(students);

    const allocatedStudents = studentStatuses.filter(
        (s) =>
            s.isAllocated &&
            !s.isLateResponse &&
            (s.inward?.isAllocated ||
                s.outward?.isAllocated ||
                s.allocatedBus?.isAllocated)
    );

    const eligibleUsers = [];
    const skippedUsers = [];
    const seenPhones = new Set();

    for (const st of allocatedStudents) {
        if (!isValidPhoneNumber(st.phoneNumber)) {
            skippedUsers.push({
                userId: st.userId,
                name: st.name,
                status: "skipped",
                reason: "Missing or invalid phone number"
            });

            continue;
        }

        const cleanPhone = String(st.phoneNumber).trim();
        const phoneKey = cleanPhone.replace(/\D/g, "");

        if (seenPhones.has(phoneKey)) {
            skippedUsers.push({
                userId: st.userId,
                name: st.name,
                status: "skipped",
                reason: "Duplicate phone number in this run"
            });

            continue;
        }

        seenPhones.add(phoneKey);

        const message = formatAllocationMessage(st);

        eligibleUsers.push({
            user: st,
            cleanPhone,
            message
        });
    }

    let sentCount = 0;
    let failedCount = 0;

    const results = [...skippedUsers];

    if (eligibleUsers.length === 0) {
        return {
            totalUsers: students.length,
            totalAllocated: allocatedStudents.length,
            eligibleUsers: 0,
            sentCount: 0,
            skippedCount: skippedUsers.length,
            failedCount: 0,
            results
        };
    }

    const usersPayload = eligibleUsers.map(
        ({ user, cleanPhone, message }) => ({
            userId: user.userId,
            name: user.name,
            phoneNumber: cleanPhone,
            message
        })
    );

    const configuredUrl =
        options.webhookUrl ||
        process.env.N8N_TRAVEL_STATUS_WEBHOOK_URL ||
        DEFAULT_WEBHOOK_URL;

    const webhookUrl = configuredUrl.replace(
        "/webhook-test/",
        "/webhook/"
    );

    const webhookPayload = {
        totalEligible: eligibleUsers.length,
        users: usersPayload,
        phoneNumber: eligibleUsers[0]?.cleanPhone,
        message: eligibleUsers[0]?.message
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

            const responseText =
                await response.text().catch(() => "");

            const errorMessage =
                `Webhook HTTP ${response.status}` +
                (responseText
                    ? `: ${responseText}`
                    : "");

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
                error:
                    error.message ||
                    "Failed to reach n8n webhook"
            });
        }
    }

    return {
        totalUsers: students.length,
        totalAllocated: allocatedStudents.length,
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
    sendTravelStatusNotifications,
    formatAllocationMessage,
    checkAllocationReadiness,
    sendAllocationDetailsNotifications
};