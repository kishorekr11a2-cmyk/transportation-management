import mongoose from "mongoose";
import User from "../models/User.js";
import AiPlan from "../models/AiPlan.js";
import LateResponseEvent from "../models/LateResponseEvent.js";

const isDbConnected = () => mongoose.connection?.readyState === 1;

/**
 * Generate stable unique event key for late response event deduplication.
 * Links the late response directly to studentId + planEventId + direction.
 */
export const generateLateResponseEventKey = (userId, directionOrApproval, approvalEventIdOrResponseTime, planApprovalTimeOrVersion) => {
    const uId = String(userId || "").toLowerCase().trim();
    let dir = null;
    let idPart = approvalEventIdOrResponseTime;
    let timePart = planApprovalTimeOrVersion;

    const dirUpper = typeof directionOrApproval === "string" ? directionOrApproval.toUpperCase().trim() : null;
    if (dirUpper === "INWARD" || dirUpper === "OUTWARD") {
        dir = dirUpper;
        idPart = approvalEventIdOrResponseTime;
        timePart = planApprovalTimeOrVersion;
    } else if (directionOrApproval !== undefined && directionOrApproval !== null) {
        idPart = directionOrApproval;
        timePart = approvalEventIdOrResponseTime;
    }

    let eventIdentifier = "active";
    if (timePart !== undefined && timePart !== null) {
        eventIdentifier = timePart instanceof Date
            ? `t${timePart.getTime()}`
            : String(timePart);
    } else if (idPart) {
        eventIdentifier = idPart instanceof Date
            ? `t${idPart.getTime()}`
            : String(idPart);
    }
    const dirPart = dir ? `_${dir}` : "";
    return `lr_${uId}${dirPart}_${eventIdentifier}`;
};

/**
 * 1. GET CURRENT APPROVED PLAN
 * Queries ai_selected_plans (primary authoritative source) and fallback models.
 * If direction is null/omitted, returns the latest approved plan regardless of direction.
 */
export const getCurrentApprovedPlan = async (direction = null) => {
    const canonicalDirection = (direction && String(direction).toUpperCase().trim() === "OUTWARD")
        ? "OUTWARD"
        : ((direction && String(direction).toUpperCase().trim() === "INWARD") ? "INWARD" : null);

    const defaultResult = {
        isApproved: false,
        planType: null,
        planId: null,
        planVersion: 1,
        approvalEventId: null,
        approvedAt: null,
        allocatedUserIds: new Set(),
        sourceCollection: null,
        plan: null
    };

    if (!isDbConnected() || !mongoose.connection?.db) {
        return defaultResult;
    }

    try {
        const query = {
            active: true,
            status: "active",
            approved: true
        };

        if (canonicalDirection) {
            query.$or = [
                { direction: canonicalDirection },
                { tripMode: canonicalDirection },
                { tripMode: canonicalDirection === "OUTWARD" ? "FROM_SOURCE" : "TO_DESTINATION" },
                { "plan.direction": canonicalDirection },
                { "plan.tripMode": canonicalDirection }
            ];
        }

        // 1. Check ai_selected_plans (Primary authoritative source)
        const selectedDoc = await mongoose.connection.db.collection("ai_selected_plans").findOne(
            query,
            {
                projection: {
                    approvedAt: 1,
                    selectedAt: 1,
                    createdAt: 1,
                    direction: 1,
                    tripMode: 1,
                    planType: 1,
                    planVersion: 1,
                    approvalEventId: 1,
                    active: 1,
                    status: 1,
                    approved: 1,
                    "plan.direction": 1,
                    "plan.tripMode": 1,
                    "plan.buses.vehicleName": 1,
                    "plan.buses.vehicleNumber": 1,
                    "plan.buses.routeCode": 1,
                    "plan.buses.routeName": 1,
                    "plan.buses.seatNumber": 1,
                    "plan.buses.users": 1,
                    "plan.buses.allocatedStudents": 1,
                    "plan.buses.passengers": 1,
                    "plan.buses.stops": 1,
                    "plan.routes.vehicleName": 1,
                    "plan.routes.routeCode": 1,
                    "plan.routes.users": 1,
                    "plan.routes.allocatedStudents": 1,
                    "plan.routes.passengers": 1,
                    "buses.vehicleName": 1,
                    "buses.vehicleNumber": 1,
                    "buses.routeCode": 1,
                    "buses.routeName": 1,
                    "buses.seatNumber": 1,
                    "buses.users": 1,
                    "buses.allocatedStudents": 1,
                    "buses.passengers": 1,
                    "routes.vehicleName": 1,
                    "routes.routeCode": 1,
                    "routes.users": 1,
                    "routes.allocatedStudents": 1,
                    "routes.passengers": 1
                },
                sort: { approvedAt: -1, selectedAt: -1, createdAt: -1 }
            }
        );

        if (selectedDoc) {
            const approvalTime = selectedDoc.approvedAt || selectedDoc.selectedAt || selectedDoc.createdAt || new Date();
            const approvalEventId = selectedDoc.approvalEventId || (selectedDoc._id ? String(selectedDoc._id) : null);
            const planVersion = Number(selectedDoc.planVersion) || 1;

            const allocatedUserIds = new Set();
            const buses = selectedDoc.plan?.buses || selectedDoc.plan?.routes || selectedDoc.buses || selectedDoc.routes || [];
            for (const bus of buses) {
                const users = bus.users || bus.allocatedStudents || bus.passengers || [];
                for (const u of users) {
                    const uId = typeof u === "string" ? u : (u.userId || u._id || u.id);
                    if (uId) allocatedUserIds.add(String(uId).toLowerCase().trim());
                }
            }

            return {
                isApproved: true,
                planType: selectedDoc.planType || "AI",
                planId: selectedDoc._id ? String(selectedDoc._id) : null,
                planVersion,
                approvalEventId,
                approvedAt: new Date(approvalTime),
                allocatedUserIds,
                sourceCollection: "ai_selected_plans",
                plan: selectedDoc.plan || selectedDoc
            };
        }

        // 2. Check AiPlan collection
        const aiPlanQuery = {
            active: true,
            status: "active",
            isApproved: true
        };
        if (canonicalDirection) {
            aiPlanQuery.$or = [
                { direction: canonicalDirection },
                { tripMode: canonicalDirection },
                { tripMode: canonicalDirection === "OUTWARD" ? "FROM_SOURCE" : "TO_DESTINATION" }
            ];
        }

        const aiPlanDoc = await AiPlan.findOne(aiPlanQuery).sort({ approvedAt: -1, createdAt: -1 }).lean();

        if (aiPlanDoc && (aiPlanDoc.approvedAt || aiPlanDoc.createdAt)) {
            const approvalTime = aiPlanDoc.approvedAt || aiPlanDoc.createdAt;
            const approvalEventId = aiPlanDoc.approvalEventId || (aiPlanDoc._id ? String(aiPlanDoc._id) : null);
            const planVersion = Number(aiPlanDoc.planVersion) || 1;

            const allocatedUserIds = new Set();
            const buses = aiPlanDoc.buses || aiPlanDoc.routes || [];
            for (const bus of buses) {
                const users = bus.users || bus.allocatedStudents || [];
                for (const u of users) {
                    const uId = typeof u === "string" ? u : (u.userId || u._id || u.id);
                    if (uId) allocatedUserIds.add(String(uId).toLowerCase().trim());
                }
            }

            return {
                isApproved: true,
                planType: "AI",
                planId: aiPlanDoc._id ? String(aiPlanDoc._id) : null,
                planVersion,
                approvalEventId,
                approvedAt: new Date(approvalTime),
                allocatedUserIds,
                sourceCollection: "aiplans",
                plan: aiPlanDoc
            };
        }

        // 3. Check manual_plan_submissions
        const manualQuery = { isSubmitted: true };
        if (canonicalDirection) {
            manualQuery.$or = [
                { direction: canonicalDirection },
                { direction: canonicalDirection.toLowerCase() }
            ];
        }
        const manualDoc = await mongoose.connection.db.collection("manual_plan_submissions").findOne(
            manualQuery,
            { sort: { submittedAt: -1, confirmedAt: -1, createdAt: -1 } }
        );

        if (manualDoc && (manualDoc.submittedAt || manualDoc.confirmedAt || manualDoc.createdAt)) {
            const approvalTime = manualDoc.submittedAt || manualDoc.confirmedAt || manualDoc.createdAt;
            const approvalEventId = manualDoc.approvalEventId || (manualDoc._id ? String(manualDoc._id) : null);
            const planVersion = Number(manualDoc.planVersion) || 1;

            return {
                isApproved: true,
                planType: "MANUAL",
                planId: manualDoc._id ? String(manualDoc._id) : null,
                planVersion,
                approvalEventId,
                approvedAt: new Date(approvalTime),
                allocatedUserIds: new Set(),
                sourceCollection: "manual_plan_submissions",
                plan: manualDoc.plan || manualDoc
            };
        }
    } catch (err) {
        console.error(`[LIFECYCLE] Error getting current approved plan:`, err.message);
    }

    return defaultResult;
};

export const getLatestApprovedPlan = async () => getCurrentApprovedPlan(null);

/**
 * 2. VALIDATE STUDENT RESPONSE FOR CURRENT PLAN VERSION
 * Ensures student does not submit duplicate responses for the same plan version/event.
 */
export const validateStudentResponseForPlanVersion = async ({
    user,
    activePlan,
    travelStatus,
    responseSubmittedAt = new Date()
}) => {
    if (!activePlan || !activePlan.isApproved) {
        return {
            allowed: true,
            isLate: false,
            isAllocated: false,
            activePlan: null
        };
    }

    const currentApprovalEventId = activePlan.approvalEventId;
    const currentPlanVersion = activePlan.planVersion || 1;
    const studentUserId = String(user.userId || "").toLowerCase().trim();
    const studentMongoId = String(user._id || "").toLowerCase().trim();

    // 1. Check if student already submitted for this exact plan version / eventId
    const alreadySubmittedViaUser = Boolean(
        (user.submittedApprovalEventId && user.submittedApprovalEventId === currentApprovalEventId) ||
        (user.submittedPlanVersion === currentPlanVersion && (
            user.travelStatus === travelStatus ||
            (user.travelResponseSubmittedAt && new Date(user.travelResponseSubmittedAt).getTime() >= new Date(activePlan.approvedAt).getTime())
        ))
    );

    if (alreadySubmittedViaUser) {
        return {
            allowed: false,
            reason: "DUPLICATE_SUBMISSION",
            message: `Travel response has already been submitted for the current approved transportation plan (Plan Version ${currentPlanVersion}).`
        };
    }

    // 2. Database check in LateResponseEvent for any active submission against this approvalEventId
    if (currentApprovalEventId) {
        const planDir = activePlan.direction ? String(activePlan.direction).toUpperCase().trim() : null;
        const query = {
            userId: { $in: [user.userId, studentUserId] },
            status: { $in: ["OPEN", "ACTIVE"] },
            $or: [
                { approvalEventId: currentApprovalEventId },
                { planVersion: currentPlanVersion }
            ]
        };
        if (planDir) {
            query.direction = planDir;
        }
        const existingEvent = await LateResponseEvent.findOne(query).lean();

        if (existingEvent) {
            return {
                allowed: false,
                reason: "DUPLICATE_SUBMISSION",
                message: `Travel response has already been submitted for the current approved transportation plan (Plan Version ${currentPlanVersion}).`
            };
        }
    }

    // 3. Check if student is already allocated in the approved plan
    const planDirLower = activePlan.direction ? String(activePlan.direction).toLowerCase().trim() : null;
    const directionalAlloc = planDirLower ? user.allocatedBus?.[planDirLower] : null;
    const isDirectionAllocated = Boolean(
        directionalAlloc?.isAllocated &&
        (directionalAlloc.approved === true || directionalAlloc.adminApprovalStatus === "Approved")
    );
    const isTopLevelAllocated = Boolean(
        user.allocatedBus?.isAllocated &&
        (user.allocatedBus.approved === true || user.allocatedBus.adminApprovalStatus === "Approved") &&
        (!activePlan.direction || !user.allocatedBus.direction || String(user.allocatedBus.direction).toUpperCase() === String(activePlan.direction).toUpperCase())
    );

    const isAllocated = activePlan.allocatedUserIds.has(studentUserId) ||
        activePlan.allocatedUserIds.has(studentMongoId) ||
        isDirectionAllocated ||
        isTopLevelAllocated;

    // 4. Check if student submitted Coming AFTER current plan was generated and approved
    const responseTime = responseSubmittedAt instanceof Date ? responseSubmittedAt.getTime() : new Date(responseSubmittedAt).getTime();
    const planApprovalTime = activePlan.approvedAt ? new Date(activePlan.approvedAt).getTime() : 0;
    const isSubmittedAfterPlanApproval = planApprovalTime > 0 && responseTime > planApprovalTime;

    const isLate = travelStatus === "Coming" && isSubmittedAfterPlanApproval && !isAllocated;

    return {
        allowed: true,
        isLate,
        isAllocated,
        activePlan
    };
};

/**
 * 3. AUTHORITATIVE LATE RESPONSE LIFECYCLE: CREATE OR GET
 * Receives:
 * - userId
 * - direction (OUTWARD | INWARD | null)
 * - planType (AI | MANUAL)
 * - approvedPlan (optional plan context)
 * - responseEventId (stable response event identity)
 * - responseSubmittedAt (Date)
 * - previousTravelStatus
 *
 * Enforces:
 * 1. Idempotency: same user + direction + responseEventId returns existing event.
 * 2. Immutable RESOLVED: if the existing event is RESOLVED, it MUST NEVER become OPEN again.
 * 3. Only a genuinely NEW response event creates a NEW LateResponseEvent with status: OPEN.
 */
export const createOrGetLateResponseEvent = async ({
    userId,
    user = null,
    direction = null,
    planType = "AI",
    approvedPlan = null,
    responseEventId = null,
    responseSubmittedAt = new Date(),
    previousTravelStatus = "Pending"
}) => {
    const rawUserId = userId || user?.userId || "";
    const uId = String(rawUserId).trim();
    if (!uId) {
        return { isLate: false, event: null, reason: "MISSING_USER_ID" };
    }

    const canonicalDirection = (direction && String(direction).toUpperCase().trim() === "OUTWARD")
        ? "OUTWARD"
        : ((direction && String(direction).toUpperCase().trim() === "INWARD") ? "INWARD" : null);

    const canonicalPlanType = (planType && String(planType).toUpperCase().trim() === "MANUAL") ? "MANUAL" : "AI";

    const respTime = responseSubmittedAt instanceof Date ? responseSubmittedAt : new Date(responseSubmittedAt);
    const respTimestamp = respTime.getTime();

    // Stable response event identity
    const effectiveResponseEventId = responseEventId
        ? String(responseEventId).trim()
        : (user?.responseEventId || `resp_${uId.toLowerCase()}_${respTimestamp}`);

    // Deterministic event key
    const eventKey = generateLateResponseEventKey(
        uId,
        canonicalDirection,
        effectiveResponseEventId
    );

    // 1. IDEMPOTENCY CHECK: Search by userId + direction + responseEventId OR eventKey
    const lookupQuery = {
        userId: { $regex: new RegExp(`^${uId}$`, "i") },
        $or: [
            { eventKey },
            { responseEventId: effectiveResponseEventId }
        ]
    };
    if (canonicalDirection) {
        lookupQuery.$or.push({ direction: canonicalDirection, responseEventId: effectiveResponseEventId });
    }

    const existingEvent = await LateResponseEvent.findOne(lookupQuery).lean();

    if (existingEvent) {
        if (existingEvent.status === "RESOLVED") {
            console.log(`[LATE-RESPONSE] user=${uId} direction=${canonicalDirection || "GLOBAL"} responseEvent=${effectiveResponseEventId} status=RESOLVED action=NO_REOPEN`);
            return {
                isLate: true,
                event: existingEvent,
                isNew: false,
                alreadyResolved: true,
                status: "RESOLVED"
            };
        }

        console.log(`[LATE-RESPONSE] user=${uId} direction=${canonicalDirection || "GLOBAL"} responseEvent=${effectiveResponseEventId} status=${existingEvent.status} action=EXISTING_EVENT`);
        return {
            isLate: true,
            event: existingEvent,
            isNew: false,
            alreadyResolved: false,
            status: existingEvent.status
        };
    }

    // 2. Check if a plan is currently approved
    let plan = approvedPlan;
    if (!plan || !plan.isApproved) {
        plan = await getCurrentApprovedPlan(canonicalDirection);
    }

    if (!plan || !plan.isApproved) {
        // No approved plan exists — student response is normal pre-plan response, NOT late
        return {
            isLate: false,
            event: null,
            reason: "NO_APPROVED_PLAN"
        };
    }

    // 3. Check if response qualifies as LATE:
    // Submitted Coming AFTER plan was approved AND student was not allocated
    const planApprovedAt = plan.approvedAt ? new Date(plan.approvedAt) : null;
    const planApprovalTime = planApprovedAt ? planApprovedAt.getTime() : 0;
    const isSubmittedAfterPlanApproval = planApprovalTime > 0 && respTimestamp > planApprovalTime;

    const uIdLower = uId.toLowerCase();
    const isAllocated = plan.allocatedUserIds ? plan.allocatedUserIds.has(uIdLower) : false;

    if (!isSubmittedAfterPlanApproval || isAllocated) {
        return {
            isLate: false,
            event: null,
            reason: isAllocated ? "ALREADY_ALLOCATED" : "SUBMITTED_BEFORE_APPROVAL"
        };
    }

    // 4. Genuinely NEW qualifying response event -> create LateResponseEvent with status: OPEN
    const planVersion = plan.planVersion || 1;
    const approvalEventId = plan.approvalEventId || plan.planId || `plan_v${planVersion}`;

    const eventPayload = {
        eventKey,
        userId: uId,
        direction: canonicalDirection,
        planType: canonicalPlanType,
        planId: plan.planId || null,
        planVersion,
        approvalEventId,
        responseEventId: effectiveResponseEventId,
        responseAt: respTime,
        detectedAt: new Date(),
        responseSubmittedAt: respTime,
        responseTimestamp: respTime,
        planApprovedAt,
        previousTravelStatus: previousTravelStatus || user?.previousTravelStatus || "Pending",
        currentTravelStatus: "Coming",
        status: "OPEN",
        isLateResponse: true,
        isNotified: false,
        notifiedAt: null,
        resolvedAt: null,
        resolvedPlanId: null,
        resolutionReason: null
    };

    const upsertRes = await LateResponseEvent.updateOne(
        { eventKey },
        {
            $set: {
                status: "OPEN",
                isLateResponse: true,
                direction: canonicalDirection,
                planType: canonicalPlanType,
                planVersion,
                approvalEventId,
                responseEventId: effectiveResponseEventId,
                responseAt: respTime,
                responseSubmittedAt: respTime,
                updatedAt: new Date()
            },
            $setOnInsert: {
                eventKey,
                userId: uId,
                planId: plan.planId || null,
                responseTimestamp: respTime,
                planApprovedAt,
                previousTravelStatus: previousTravelStatus || user?.previousTravelStatus || "Pending",
                currentTravelStatus: "Coming",
                isNotified: false,
                notifiedAt: null,
                resolvedAt: null,
                resolvedPlanId: null,
                resolutionReason: null,
                createdAt: new Date()
            }
        },
        { upsert: true }
    );

    // Update student document in MongoDB:
    // Set responseEventId, lastResponseEventId, lateResponse: true, allocationStatus: "Unallocated"
    await User.updateOne(
        { $or: [{ userId: uId }, { userId: uIdLower }] },
        {
            $set: {
                travelStatus: "Coming",
                allocationStatus: "Unallocated",
                lateResponse: true,
                isLateResponse: true,
                lateResponseDetected: true,
                isAllocated: false,
                isUnallocated: true,
                assignedVehicle: null,
                assignedRoute: null,
                allocatedBus: null,
                lateResponseAt: respTime,
                travelResponseSubmittedAt: respTime,
                lastTravelResponseAt: respTime,
                responseEventId: effectiveResponseEventId,
                lastResponseEventId: effectiveResponseEventId,
                requiresReallocation: true,
                submittedPlanVersion: planVersion,
                submittedApprovalEventId: approvalEventId,
                lateResponseEventId: eventKey,
                affectedDirections: canonicalDirection ? [canonicalDirection] : []
            }
        }
    );

    console.log(`[LATE-RESPONSE] user=${uId} direction=${canonicalDirection || "GLOBAL"} responseEvent=${effectiveResponseEventId} status=OPEN action=NEW_EVENT`);

    return {
        isLate: true,
        event: eventPayload,
        eventKey,
        responseEventId: effectiveResponseEventId,
        isNew: true,
        alreadyResolved: false,
        status: "OPEN"
    };
};

/**
 * Backwards-compatible wrapper for createLateResponseEvent
 */
export const createLateResponseEvent = async (params) => {
    return createOrGetLateResponseEvent(params);
};

/**
 * 4. RESOLVE LATE RESPONSES FOR PLAN
 * Invoked during plan approval / activation when a newly approved plan handles late-response users.
 * Transitions matching OPEN/ACTIVE late-response events to RESOLVED forever.
 * Storing resolvedAt and resolvedPlanId.
 */
export const resolveLateResponsesForPlan = async ({
    allocatedUserIds = null,
    direction = null,
    resolvedPlanId = null,
    newPlanVersion = null,
    newApprovalEventId = null,
    resolutionReason = "Admin approved plan including student"
} = {}) => {
    if (!isDbConnected() || !mongoose.connection?.db) {
        return { success: false, resolvedCount: 0 };
    }

    const userIdsList = allocatedUserIds
        ? (allocatedUserIds instanceof Set ? Array.from(allocatedUserIds) : (Array.isArray(allocatedUserIds) ? allocatedUserIds : [allocatedUserIds]))
        : null;

    if (!userIdsList || userIdsList.length === 0) {
        console.log("[LIFECYCLE] Generating a plan alone does not resolve late response students without allocation.");
        return { success: true, resolvedEventsCount: 0, updatedUsersCount: 0 };
    }

    try {
        const normalizedIds = userIdsList.map((id) => String(id).toLowerCase().trim()).filter(Boolean);
        const canonicalDirection = (direction && String(direction).toUpperCase().trim() === "OUTWARD")
            ? "OUTWARD"
            : ((direction && String(direction).toUpperCase().trim() === "INWARD") ? "INWARD" : null);

        const openStatuses = ["OPEN", "ACTIVE", "Pending", "DETECTED", "NOTIFIED", "PENDING_REALLOCATION", "REGENERATION_DRAFT", "AWAITING_APPROVAL"];

        // Query OPEN events for allocated users
        const eventFilter = {
            status: { $in: openStatuses },
            $or: [
                { userId: { $in: normalizedIds } },
                { userId: { $in: userIdsList } }
            ]
        };

        // Direction isolation: an outward plan resolves outward or unassigned events, not inward
        if (canonicalDirection) {
            eventFilter.$and = [
                {
                    $or: [
                        { direction: canonicalDirection },
                        { direction: null },
                        { direction: "" }
                    ]
                }
            ];
        }

        const now = new Date();
        const planIdentifier = resolvedPlanId || newApprovalEventId || (newPlanVersion ? `v${newPlanVersion}` : "plan_approved");

        // Find matching events before updating to log each resolved transition
        const eventsToResolve = await LateResponseEvent.find(eventFilter).select("userId direction responseEventId").lean();

        const lreResult = await LateResponseEvent.updateMany(
            eventFilter,
            {
                $set: {
                    status: "RESOLVED",
                    resolvedAt: now,
                    resolvedPlanId: planIdentifier,
                    resolutionReason,
                    updatedAt: now
                }
            }
        );

        for (const ev of (eventsToResolve || [])) {
            console.log(`[LATE-RESPONSE] user=${ev.userId} direction=${ev.direction || canonicalDirection || "GLOBAL"} responseEvent=${ev.responseEventId} status=RESOLVED resolvedPlan=${planIdentifier}`);
        }

        // Clear late flags on the allocated users in the User collection
        const userResult = await User.updateMany(
            {
                role: "student",
                $or: [
                    { userId: { $in: normalizedIds } },
                    { userId: { $in: userIdsList } },
                    { _id: { $in: normalizedIds.filter((id) => mongoose.Types.ObjectId.isValid(id)) } }
                ]
            },
            {
                $set: {
                    lateResponse: false,
                    isLateResponse: false,
                    lateResponseDetected: false,
                    requiresReallocation: false,
                    lateResponseAt: null,
                    lateResponseResolvedAt: now,
                    affectedDirections: []
                }
            }
        );

        console.log(`[LIFECYCLE] Resolved ${lreResult.modifiedCount} LateResponseEvent(s) and cleared late flags for ${userResult.modifiedCount} user(s) (Plan: ${planIdentifier})`);

        return {
            success: true,
            resolvedEventsCount: lreResult.modifiedCount,
            updatedUsersCount: userResult.modifiedCount
        };
    } catch (err) {
        console.error("[LIFECYCLE] Error resolving late responses for plan:", err.message);
        return { success: false, error: err.message, resolvedCount: 0 };
    }
};

/**
 * Backwards-compatible alias for resolveLateResponsesForPlan
 */
export const resolveLateResponsesForPreviousPlan = async (params) => {
    return resolveLateResponsesForPlan(params);
};

/**
 * 5. GET ACTIVE LATE RESPONSES (AUTHORITATIVE)
 * Sourced STRICTLY from LateResponseEvent where status is OPEN or ACTIVE.
 * Does NOT synthesize fake events from User collection flags.
 * Does NOT perform state-changing side-effects (read-only idempotency).
 */
export const getActiveLateResponses = async () => {
    const defaultResponse = {
        success: true,
        count: 0,
        lateComingResponsesCount: 0,
        pendingReallocationUsersCount: 0,
        unnotifiedCount: 0,
        unnotifiedEventKeys: [],
        lateResponses: [],
        users: [],
        summary: {
            lateComingResponsesCount: 0,
            pendingReallocationUsersCount: 0,
            totalLateResponses: 0
        }
    };

    if (!isDbConnected() || !mongoose.connection?.db) {
        return defaultResponse;
    }

    try {
        // Fetch authoritative OPEN / ACTIVE events from LateResponseEvent collection
        const activeEvents = await LateResponseEvent.find({
            status: { $in: ["OPEN", "ACTIVE"] }
        }).sort({ responseSubmittedAt: -1, createdAt: -1 }).lean();

        if (!activeEvents || activeEvents.length === 0) {
            return defaultResponse;
        }

        const activeEventUserIds = activeEvents.map((e) => String(e.userId || "").trim()).filter(Boolean);
        const activeUserIdsLower = activeEventUserIds.map((id) => id.toLowerCase());

        // Fetch student details for these active events
        const students = await User.find({
            role: "student",
            $or: [
                { userId: { $in: activeEventUserIds } },
                { userId: { $in: activeUserIdsLower } }
            ]
        })
            .select({
                userId: 1,
                name: 1,
                stoppings: 1,
                city: 1,
                district: 1,
                state: 1,
                country: 1,
                travelStatus: 1,
                previousTravelStatus: 1,
                allocationStatus: 1,
                isAllocated: 1,
                isUnallocated: 1,
                lateResponse: 1,
                isLateResponse: 1,
                lateResponseDetected: 1,
                lateResponseAt: 1,
                lateResponseNotifiedEventKeys: 1,
                lateResponseNotifiedAt: 1,
                travelResponseSubmittedAt: 1,
                lastTravelResponseAt: 1,
                responseEventId: 1,
                requiresReallocation: 1,
                submittedPlanVersion: 1,
                submittedApprovalEventId: 1,
                assignedVehicle: 1,
                assignedRoute: 1,
                allocatedBus: 1
            })
            .lean();

        const studentMap = new Map();
        for (const s of students) {
            studentMap.set(String(s.userId).toLowerCase().trim(), s);
        }

        const formattedList = [];
        const unnotifiedEventKeys = [];
        const seenKeys = new Set();

        for (const ev of activeEvents) {
            const uId = String(ev.userId || "").toLowerCase().trim();
            const student = studentMap.get(uId);

            // If the student travelStatus is no longer Coming (e.g. changed to Not Coming), skip
            if (student && student.travelStatus && student.travelStatus !== "Coming") {
                continue;
            }

            const eventKey = ev.eventKey || generateLateResponseEventKey(ev.userId, ev.direction, ev.responseEventId || ev.approvalEventId);
            if (seenKeys.has(eventKey)) continue;
            seenKeys.add(eventKey);

            const isNotified = Boolean(
                ev.isNotified ||
                ev.notifiedAt ||
                student?.lateResponseNotifiedAt ||
                (Array.isArray(student?.lateResponseNotifiedEventKeys) && student.lateResponseNotifiedEventKeys.includes(eventKey))
            );

            if (!isNotified) {
                unnotifiedEventKeys.push(eventKey);
            }

            const responseTime = ev.responseSubmittedAt || ev.responseTimestamp || student?.travelResponseSubmittedAt || new Date();

            formattedList.push({
                _id: ev._id,
                userId: ev.userId,
                name: student?.name || ev.userId,
                direction: ev.direction || null,
                travelStatus: "Coming",
                currentTravelStatus: "Coming",
                previousTravelStatus: ev.previousTravelStatus || student?.previousTravelStatus || "Pending",
                allocationStatus: "Unallocated",
                lateResponse: true,
                isLateResponse: true,
                lateResponseDetected: true,
                requiresReallocation: true,
                responseEventId: ev.responseEventId || student?.responseEventId || null,
                responseSubmittedAt: responseTime,
                responseSubmittedTime: responseTime,
                planApprovedAt: ev.planApprovedAt || null,
                planApprovalTime: ev.planApprovedAt || null,
                planVersion: ev.planVersion || 1,
                approvalEventId: ev.approvalEventId || null,
                planId: ev.planId || null,
                eventKey,
                eventKeys: [eventKey],
                isNotified,
                isUnnotified: !isNotified,
                status: ev.status || "OPEN",
                processingStatus: isNotified ? "NOTIFIED" : "DETECTED",
                stoppings: student?.stoppings || "—",
                city: student?.city || "—",
                busName: "Not Assigned",
                routeName: "—",
                seatNumber: "—",
                currentActionStatus: "Late response awaiting admin reallocation"
            });
        }

        const count = formattedList.length;
        const uniqueUnnotifiedKeys = Array.from(new Set(unnotifiedEventKeys));

        return {
            success: true,
            count,
            lateComingResponsesCount: count,
            pendingReallocationUsersCount: count,
            unnotifiedCount: uniqueUnnotifiedKeys.length,
            unnotifiedEventKeys: uniqueUnnotifiedKeys,
            lateResponses: formattedList,
            users: formattedList,
            summary: {
                lateComingResponsesCount: count,
                pendingReallocationUsersCount: count,
                totalLateResponses: count
            }
        };
    } catch (err) {
        console.error("[LIFECYCLE] Error fetching active late responses:", err.message);
        return defaultResponse;
    }
};


