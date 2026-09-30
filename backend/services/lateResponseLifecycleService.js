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
                const stops = bus.stops || [];
                for (const st of stops) {
                    const stUsers = st.userIds || st.users || st.students || [];
                    for (const su of stUsers) {
                        const suId = typeof su === "string" ? su : (su.userId || su._id || su.id);
                        if (suId) allocatedUserIds.add(String(suId).toLowerCase().trim());
                    }
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
                const stops = bus.stops || [];
                for (const st of stops) {
                    const stUsers = st.userIds || st.users || st.students || [];
                    for (const su of stUsers) {
                        const suId = typeof su === "string" ? su : (su.userId || su._id || su.id);
                        if (suId) allocatedUserIds.add(String(suId).toLowerCase().trim());
                    }
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
        const manualQuery = {
            isSubmitted: true,
            status: { $ne: "reset" },
            resetAt: { $exists: false },
            active: { $ne: false },
            $or: [
                { isApproved: true },
                { approved: true },
                { confirmedAt: { $exists: true } },
                { approvedAt: { $exists: true } }
            ]
        };
        if (canonicalDirection) {
            manualQuery.direction = { $in: [canonicalDirection, canonicalDirection.toLowerCase()] };
        }
        const manualDoc = await mongoose.connection.db.collection("manual_plan_submissions").findOne(
            manualQuery,
            { sort: { submittedAt: -1, confirmedAt: -1, createdAt: -1 } }
        );

        if (manualDoc && (manualDoc.submittedAt || manualDoc.confirmedAt || manualDoc.createdAt)) {
            const approvalTime = manualDoc.confirmedAt || manualDoc.submittedAt || manualDoc.createdAt;
            const approvalEventId = manualDoc.approvalEventId || (manualDoc._id ? String(manualDoc._id) : null);
            const planVersion = Number(manualDoc.planVersion) || 1;

            const allocatedUserIds = new Set();
            const buses = manualDoc.plan?.buses || manualDoc.plan?.routes || manualDoc.buses || manualDoc.routes || [];
            for (const bus of buses) {
                const users = bus.users || bus.allocatedStudents || bus.passengers || [];
                for (const u of users) {
                    const uId = typeof u === "string" ? u : (u.userId || u._id || u.id);
                    if (uId) allocatedUserIds.add(String(uId).toLowerCase().trim());
                }
                const stops = bus.stops || [];
                for (const st of stops) {
                    const stUsers = st.userIds || st.users || st.students || [];
                    for (const su of stUsers) {
                        const suId = typeof su === "string" ? su : (su.userId || su._id || su.id);
                        if (suId) allocatedUserIds.add(String(suId).toLowerCase().trim());
                    }
                }
            }

            return {
                isApproved: true,
                planType: "MANUAL",
                planId: manualDoc._id ? String(manualDoc._id) : null,
                planVersion,
                approvalEventId,
                approvedAt: new Date(approvalTime),
                allocatedUserIds,
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

    const rawPlanTypeUpper = planType ? String(planType).toUpperCase().trim() : "";
    const canonicalPlanType = (rawPlanTypeUpper === "MANUAL" || rawPlanTypeUpper === "ADMIN") ? "MANUAL" : "AI";

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
        lookupQuery.$or.push({ direction: canonicalDirection, status: { $in: ["OPEN", "ACTIVE", "Pending", "DETECTED", "NOTIFIED", "PENDING_REALLOCATION"] } });
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
    resolutionReason = "Admin approved plan including student",
    allocationsMap = null
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
        const validObjectIds = normalizedIds.filter((id) => mongoose.Types.ObjectId.isValid(id)).map((id) => new mongoose.Types.ObjectId(id));

        // Lookup matching students to map both MongoDB _id <-> student human userId
        const studentDocs = await User.find({
            role: "student",
            $or: [
                { userId: { $in: normalizedIds } },
                { userId: { $in: userIdsList } },
                ...(validObjectIds.length > 0 ? [{ _id: { $in: validObjectIds } }] : [])
            ]
        }).select("userId _id").lean();

        const allCandidateUserIds = new Set();
        for (const s of studentDocs) {
            if (s.userId) {
                allCandidateUserIds.add(String(s.userId).trim());
                allCandidateUserIds.add(String(s.userId).toLowerCase().trim());
            }
            if (s._id) {
                allCandidateUserIds.add(String(s._id).trim());
                allCandidateUserIds.add(String(s._id).toLowerCase().trim());
            }
        }
        for (const id of userIdsList) {
            allCandidateUserIds.add(String(id).trim());
            allCandidateUserIds.add(String(id).toLowerCase().trim());
        }
        const expandedIds = Array.from(allCandidateUserIds);

        const canonicalDirection = (direction && String(direction).toUpperCase().trim() === "OUTWARD")
            ? "OUTWARD"
            : ((direction && String(direction).toUpperCase().trim() === "INWARD") ? "INWARD" : null);

        const openStatuses = ["OPEN", "ACTIVE", "Pending", "DETECTED", "NOTIFIED", "PENDING_REALLOCATION", "REGENERATION_DRAFT", "AWAITING_APPROVAL"];

        // Query OPEN events for allocated users
        const eventFilter = {
            status: { $in: openStatuses },
            userId: { $in: expandedIds }
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

        for (const ev of (eventsToResolve || [])) {
            const evUid = String(ev.userId || "").toLowerCase().trim();
            const allocInfo = (allocationsMap && (allocationsMap.get(evUid) || allocationsMap.get(ev.userId))) || null;
            const updateDoc = {
                status: "RESOLVED",
                resolvedAt: now,
                resolvedPlanId: planIdentifier,
                resolutionReason,
                updatedAt: now
            };
            if (allocInfo) {
                if (allocInfo.vehicleName) updateDoc.allocatedBus = allocInfo.vehicleName;
                if (allocInfo.routeCode) updateDoc.allocatedRoute = allocInfo.routeCode;
                if (allocInfo.seatNumber) updateDoc.allocatedSeat = allocInfo.seatNumber;
            }
            await LateResponseEvent.updateOne({ _id: ev._id }, { $set: updateDoc });
            console.log(`[LATE-RESPONSE] user=${ev.userId} direction=${ev.direction || canonicalDirection || "GLOBAL"} responseEvent=${ev.responseEventId} status=RESOLVED resolvedPlan=${planIdentifier}`);
        }

        // Clear late flags on the allocated users in the User collection with strict direction isolation
        let updatedCount = 0;
        if (studentDocs && studentDocs.length > 0) {
            for (const s of studentDocs) {
                const existingAffected = Array.isArray(s.affectedDirections)
                    ? s.affectedDirections.map(d => String(d).toUpperCase().trim())
                    : [];
                const nextAffected = canonicalDirection
                    ? existingAffected.filter(d => d !== canonicalDirection)
                    : [];
                const isFullyResolved = nextAffected.length === 0;

                const uSet = {
                    affectedDirections: nextAffected,
                    requiresReallocation: !isFullyResolved,
                    lateResponseDetected: !isFullyResolved,
                    lateResponse: !isFullyResolved,
                    isLateResponse: !isFullyResolved,
                    lateResponseResolvedAt: now
                };
                if (isFullyResolved) {
                    uSet.lateResponseAt = null;
                }
                await User.updateOne({ _id: s._id }, { $set: uSet });
                updatedCount++;
            }
        }

        console.log(`[LIFECYCLE] Resolved ${eventsToResolve.length} LateResponseEvent(s) and cleared late flags for ${updatedCount} user(s) (Plan: ${planIdentifier})`);

        return {
            success: true,
            resolvedEventsCount: eventsToResolve.length,
            updatedUsersCount: updatedCount
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
 * UNIFIED COMMON LATE RESPONSE RESOLUTION SERVICE
 * 
 * Completely plan-type- and direction-independent.
 * Supports:
 *   1. AI + OUTWARD
 *   2. AI + INWARD
 *   3. MANUAL + OUTWARD
 *   4. MANUAL + INWARD
 *
 * Reuses existing allocation rules:
 * - Identifies the active approved plan for the direction
 * - Allocates late user to an existing compatible route/bus with available capacity
 * - Respects route continuity, stop compatibility, and inward starting hubs
 * - Updates User.allocatedBus preserving both inward and outward structures
 * - Marks LateResponseEvent as RESOLVED
 * - Student dashboard immediately reflects allocation
 */
export const resolveLateResponse = async ({
    userId = null,
    user = null,
    direction = null,
    activePlan = null,
    planType = null
} = {}) => {
    if (!isDbConnected() || !mongoose.connection?.db) {
        return { success: false, code: "DATABASE_UNAVAILABLE", message: "Database is currently unavailable." };
    }

    const canonicalDirection = (direction && String(direction).toUpperCase().trim() === "OUTWARD")
        ? "OUTWARD"
        : ((direction && String(direction).toUpperCase().trim() === "INWARD") ? "INWARD" : null);

    if (!canonicalDirection) {
        return { success: false, code: "MISSING_DIRECTION", message: "Direction (INWARD or OUTWARD) is required." };
    }

    // 1. Identify Active Plan (direction + active plan, independent of AI or Manual)
    const activeRecord = activePlan || await getCurrentApprovedPlan(canonicalDirection);
    if (!activeRecord || !activeRecord.isApproved || !activeRecord.plan) {
        return {
            success: false,
            code: "NO_ACTIVE_APPROVED_PLAN",
            message: `No active approved transportation plan found for ${canonicalDirection}.`
        };
    }

    const rawPlan = activeRecord.plan;
    const planVersion = activeRecord.planVersion || 1;
    const approvalEventId = activeRecord.approvalEventId || (activeRecord.planId ? String(activeRecord.planId) : `plan_v${planVersion}`);
    const rawType = (planType || activeRecord.planType || "AI").toUpperCase().trim();
    const effectivePlanType = (rawType === "MANUAL" || rawType === "ADMIN") ? "MANUAL" : "AI";

    // 2. Fetch the target student(s) to resolve
    const targetUserId = userId || user?.userId || user?._id;
    let studentsToResolve = [];
    if (targetUserId) {
        const sDoc = await User.findOne({
            $or: [
                { userId: String(targetUserId) },
                { userId: String(targetUserId).toLowerCase() },
                { userId: String(targetUserId).toUpperCase() },
                ...(mongoose.Types.ObjectId.isValid(targetUserId) ? [{ _id: targetUserId }] : [])
            ]
        });
        if (sDoc) studentsToResolve = [sDoc];
    } else {
        // Resolve all students with open late response events for this direction
        const openEvents = await LateResponseEvent.find({
            direction: canonicalDirection,
            status: { $in: ["OPEN", "ACTIVE", "Pending", "DETECTED", "NOTIFIED", "PENDING_REALLOCATION"] }
        }).select("userId").lean();
        const openUids = Array.from(new Set(openEvents.map(e => String(e.userId || "").trim()).filter(Boolean)));
        if (openUids.length > 0) {
            studentsToResolve = await User.find({
                $or: [
                    { userId: { $in: openUids } },
                    { userId: { $in: openUids.map(u => u.toLowerCase()) } },
                    { userId: { $in: openUids.map(u => u.toUpperCase()) } }
                ]
            });
        }
    }

    if (studentsToResolve.length === 0) {
        return {
            success: true,
            resolvedCount: 0,
            message: `No open late responses found to resolve for ${canonicalDirection}.`
        };
    }

    const buses = Array.isArray(rawPlan.buses) ? rawPlan.buses : (Array.isArray(rawPlan.routes) ? rawPlan.routes : []);
    const resolvedResults = [];
    const now = new Date();

    for (const student of studentsToResolve) {
        const uId = String(student.userId || "").toLowerCase().trim();
        const dirKey = canonicalDirection.toLowerCase();

        // Check if student is already allocated in this direction
        const existingAlloc = (student.allocatedBus && typeof student.allocatedBus === "object") ? student.allocatedBus : {};
        const dirSubAlloc = existingAlloc[dirKey];
        if (dirSubAlloc && dirSubAlloc.isAllocated && (dirSubAlloc.approved === true || dirSubAlloc.adminApprovalStatus === "Approved")) {
            // Already allocated: idempotently mark LateResponseEvent as resolved
            await LateResponseEvent.updateMany(
                {
                    userId: { $in: [student.userId, String(student._id), uId, uId.toUpperCase()] },
                    direction: canonicalDirection,
                    status: { $ne: "RESOLVED" }
                },
                {
                    $set: {
                        status: "RESOLVED",
                        resolvedAt: now,
                        resolvedPlanId: approvalEventId,
                        resolutionReason: "Already allocated in active plan",
                        allocatedBus: dirSubAlloc.vehicleName,
                        allocatedRoute: dirSubAlloc.routeCode,
                        allocatedSeat: dirSubAlloc.seatNumber,
                        updatedAt: now
                    }
                }
            );
            resolvedResults.push({
                userId: student.userId,
                allocated: true,
                vehicleName: dirSubAlloc.vehicleName,
                routeCode: dirSubAlloc.routeCode,
                seatNumber: dirSubAlloc.seatNumber,
                alreadyAllocated: true
            });
            continue;
        }

        // Apply route/bus allocation logic: find compatible bus with capacity
        const studentStop = String(student.stoppings || "").trim();
        let matchedBus = null;
        let matchedStop = null;

        for (const bus of buses) {
            const capacity = Number(bus.capacity) || 70;
            const assignedCount = (bus.users?.length || bus.allocatedStudents?.length || bus.assignedUsers || 0);
            const remainingSeats = Math.max(0, capacity - assignedCount);
            if (remainingSeats <= 0) continue;

            const stops = Array.isArray(bus.stops) ? bus.stops : [];
            for (let sIdx = 0; sIdx < stops.length; sIdx++) {
                const s = stops[sIdx];
                const sName = String(s.name || "").trim().toLowerCase();
                const uStopName = studentStop.toLowerCase();
                if (sName === uStopName || sName.includes(uStopName) || uStopName.includes(sName)) {
                    matchedBus = bus;
                    matchedStop = s;
                    break;
                }
            }
            if (matchedBus) break;
        }

        // Fallback: choose first available bus with remaining seats in this plan
        if (!matchedBus && buses.length > 0) {
            matchedBus = buses.find(b => {
                const cap = Number(b.capacity) || 70;
                const cnt = (b.users?.length || b.allocatedStudents?.length || b.assignedUsers || 0);
                return (cap - cnt) > 0;
            });
            if (matchedBus && Array.isArray(matchedBus.stops) && matchedBus.stops.length > 0) {
                matchedStop = matchedBus.stops[0];
            }
        }

        if (matchedBus) {
            const currentBusUsers = matchedBus.users || [];
            const seatNumber = currentBusUsers.length + 1;
            const vehicleName = matchedBus.vehicleName || matchedBus.vehicleNumber || "Assigned Bus";
            const routeCode = matchedBus.routeCode || matchedBus.routeName || "R-01";
            const routeName = matchedBus.routeName || `${routeCode}: ${vehicleName}`;
            const stopName = matchedStop?.name || studentStop || "Assigned Stop";

            // Add student to the bus users list
            if (!matchedBus.users) matchedBus.users = [];
            matchedBus.users.push(student.userId);
            if (Array.isArray(matchedBus.allocatedStudents)) {
                matchedBus.allocatedStudents.push({ userId: student.userId, name: student.name || "", seatNumber });
            }

            // Build direction allocation object
            const dirAllocObj = {
                isAllocated: true,
                approved: true,
                allocationStatus: "Assigned",
                adminApprovalStatus: "Approved",
                vehicleName,
                vehicleNumber: vehicleName,
                routeCode,
                routeName,
                boardingStop: stopName,
                stopName,
                seatNumber,
                direction: canonicalDirection,
                tripMode: canonicalDirection === "OUTWARD" ? "FROM_SOURCE" : "TO_DESTINATION",
                planVersion,
                planType: effectivePlanType,
                approvedAt: now
            };

            const currentAffected = (Array.isArray(student.affectedDirections) ? student.affectedDirections : [])
                .map(d => String(d).toUpperCase().trim());
            const nextAffected = currentAffected.filter(d => d !== canonicalDirection);
            const isFullyAllocated = nextAffected.length === 0;

            const existingOpposite = canonicalDirection === "OUTWARD" ? existingAlloc.inward : existingAlloc.outward;
            const updatedAllocatedBus = {
                ...dirAllocObj,
                isAllocated: true,
                inward: canonicalDirection === "INWARD" ? dirAllocObj : (existingOpposite || null),
                outward: canonicalDirection === "OUTWARD" ? dirAllocObj : (existingOpposite || null)
            };

            student.allocatedBus = updatedAllocatedBus;
            student.assignedVehicle = vehicleName;
            student.assignedRoute = routeCode;
            student.allocationStatus = "Assigned";
            student.isAllocated = true;
            student.isUnallocated = false;
            student.travelStatus = "Coming";
            student.affectedDirections = nextAffected;
            student.requiresReallocation = !isFullyAllocated;
            student.lateResponseDetected = !isFullyAllocated;
            student.lateResponse = !isFullyAllocated;
            student.isLateResponse = !isFullyAllocated;
            student.lateResponseResolvedAt = now;
            if (isFullyAllocated) {
                student.lateResponseAt = null;
            }
            if (effectivePlanType === "MANUAL") {
                student.manualBusId = vehicleName;
                student.manualRouteId = routeCode;
                student.approvedPlanType = "MANUAL";
            }

            await student.save();

            // Mark LateResponseEvent as RESOLVED
            await LateResponseEvent.updateMany(
                {
                    userId: { $in: [student.userId, String(student._id), uId, uId.toUpperCase()] },
                    direction: canonicalDirection,
                    status: { $ne: "RESOLVED" }
                },
                {
                    $set: {
                        status: "RESOLVED",
                        resolvedAt: now,
                        resolvedPlanId: approvalEventId,
                        resolutionReason: `Allocated to ${vehicleName} (${routeCode}) for ${canonicalDirection}`,
                        allocatedBus: vehicleName,
                        allocatedRoute: routeCode,
                        allocatedSeat: seatNumber,
                        updatedAt: now
                    }
                }
            );

            resolvedResults.push({
                userId: student.userId,
                allocated: true,
                vehicleName,
                routeCode,
                seatNumber
            });
        } else {
            // No bus capacity available -> remains standby/unallocated, event stays ACTIVE
            resolvedResults.push({
                userId: student.userId,
                allocated: false,
                reason: "CAPACITY_EXCEEDED"
            });
        }
    }

    // Persist updated plan buses to active database records
    if (activeRecord.sourceCollection === "ai_selected_plans" && mongoose.connection.db) {
        try {
            await mongoose.connection.db.collection("ai_selected_plans").updateOne(
                { _id: new mongoose.Types.ObjectId(activeRecord.planId) },
                { $set: { "plan.buses": buses, updatedAt: now } }
            );
        } catch {}
    }

    clearActiveApprovedPlansCache();
    return {
        success: true,
        direction: canonicalDirection,
        planType: effectivePlanType,
        planVersion,
        resolvedCount: resolvedResults.filter(r => r.allocated).length,
        results: resolvedResults
    };
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

        let outwardCount = 0;
        let inwardCount = 0;
        const affectedDirectionsSet = new Set();

        for (const item of formattedList) {
            const dir = item.direction ? String(item.direction).toUpperCase().trim() : null;
            if (!dir || dir === "BOTH" || dir === "ALL") {
                outwardCount++;
                inwardCount++;
                affectedDirectionsSet.add("INWARD");
                affectedDirectionsSet.add("OUTWARD");
            } else if (dir === "OUTWARD" || dir === "FROM_SOURCE") {
                outwardCount++;
                affectedDirectionsSet.add("OUTWARD");
            } else if (dir === "INWARD" || dir === "TO_DESTINATION") {
                inwardCount++;
                affectedDirectionsSet.add("INWARD");
            } else {
                outwardCount++;
                inwardCount++;
                affectedDirectionsSet.add("INWARD");
                affectedDirectionsSet.add("OUTWARD");
            }
        }

        const affectedDirections = Array.from(affectedDirectionsSet);

        return {
            success: true,
            count,
            lateComingResponsesCount: count,
            pendingReallocationUsersCount: count,
            outwardCount,
            inwardCount,
            affectedDirections,
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


