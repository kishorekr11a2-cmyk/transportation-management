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
    let idPart = approvalEventIdOrResponseTime;
    let timePart = planApprovalTimeOrVersion;

    if (directionOrApproval === "INWARD" || directionOrApproval === "OUTWARD") {
        // Direction is ignored for key generation to keep late responses unified
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
    return `lr_${uId}_${eventIdentifier.toLowerCase()}`;
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
    // If no approved plan exists, normal pre-approval submission is allowed
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

    // 2. Database check in LateResponseEvent for any submission against this approvalEventId
    if (currentApprovalEventId) {
        const planDir = activePlan.direction ? String(activePlan.direction).toUpperCase().trim() : null;
        const query = {
            userId: { $in: [user.userId, studentUserId] },
            $or: [
                { approvalEventId: currentApprovalEventId },
                { planVersion: currentPlanVersion, status: "ACTIVE" }
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
 * 3. CREATE LATE RESPONSE EVENT
 * Creates a single ACTIVE late-response event bound to studentId + planVersion/approvalEventId.
 * No direction required. Idempotent: duplicate calls for same plan version will not create duplicate records.
 */
export const createLateResponseEvent = async ({
    user,
    direction = null,
    approvedPlan = null,
    responseSubmittedAt = new Date(),
    previousTravelStatus = "Pending"
}) => {
    let plan = approvedPlan;
    if (!plan || !plan.isApproved) {
        plan = await getCurrentApprovedPlan(null);
    }

    const planVersion = plan?.planVersion || 1;
    const approvalEventId = plan?.approvalEventId || plan?.planId || `plan_v${planVersion}`;
    const planApprovedAt = plan?.approvedAt || new Date();

    // Stable, deterministic event key based on studentId + plan approval identifier
    const eventKey = generateLateResponseEventKey(
        user.userId,
        approvalEventId,
        planApprovedAt
    );

    const eventPayload = {
        eventKey,
        userId: String(user.userId || ""),
        planId: plan?.planId || null,
        planVersion,
        approvalEventId,
        direction: null,
        previousTravelStatus: previousTravelStatus || user.previousTravelStatus || "Pending",
        currentTravelStatus: "Coming",
        responseTimestamp: responseSubmittedAt,
        responseSubmittedAt: responseSubmittedAt,
        planApprovedAt,
        planType: plan?.planType || "AI",
        isLateResponse: true,
        status: "ACTIVE",
        isNotified: false,
        notifiedAt: null,
        resolvedAt: null,
        resolutionReason: null
    };

    // Upsert using eventKey to guarantee single record at database level
    const upsertRes = await LateResponseEvent.updateOne(
        {
            $or: [
                { eventKey },
                { userId: String(user.userId || ""), approvalEventId, status: "ACTIVE" }
            ]
        },
        {
            $set: {
                status: "ACTIVE",
                isLateResponse: true,
                planVersion,
                approvalEventId,
                responseSubmittedAt,
                updatedAt: new Date()
            },
            $setOnInsert: {
                ...eventPayload,
                createdAt: new Date()
            }
        },
        { upsert: true }
    );

    // Update student document in MongoDB:
    // Rule 3:
    // Mark student as:
    // * travelStatus: Coming
    // * allocationStatus: Unallocated
    // * lateResponse: true
    await User.updateOne(
        { _id: user._id },
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
                lateResponseAt: responseSubmittedAt,
                travelResponseSubmittedAt: responseSubmittedAt,
                lastTravelResponseAt: responseSubmittedAt,
                requiresReallocation: true,
                submittedPlanVersion: planVersion,
                submittedApprovalEventId: approvalEventId,
                lateResponseEventId: eventKey,
                affectedDirections: []
            }
        }
    );

    console.log(`[LIFECYCLE] Active LateResponseEvent created/updated: ${eventKey} (Student: ${user.userId}, Plan Version: ${planVersion})`);

    return {
        eventKey,
        eventPayload,
        upserted: upsertRes.upsertedCount > 0
    };
};

/**
 * 4. RESOLVE LATE RESPONSES FOR PREVIOUS PLAN
 * Rule 9: Generating a plan alone must not resolve the late response.
 * Rule 10: The late response should be resolved only when the admin manually assigns/approves the student's route.
 */
export const resolveLateResponsesForPreviousPlan = async ({
    allocatedUserIds = null,
    direction = null,
    newPlanVersion = null,
    newApprovalEventId = null
} = {}) => {
    if (!isDbConnected() || !mongoose.connection?.db) {
        return { success: false, resolvedCount: 0 };
    }

    // Rule 9 & 10: Generating a plan alone must NOT resolve the late response.
    // Late responses must only be resolved for students who are actually allocated to a route/bus.
    const userIdsList = allocatedUserIds ? (allocatedUserIds instanceof Set ? Array.from(allocatedUserIds) : (Array.isArray(allocatedUserIds) ? allocatedUserIds : [allocatedUserIds])) : null;
    if (!userIdsList || userIdsList.length === 0) {
        console.log("[LIFECYCLE] Generating a plan alone does not resolve late response students without allocation.");
        return { success: true, resolvedEventsCount: 0, updatedUsersCount: 0 };
    }

    try {
        const normalizedIds = userIdsList.map((id) => String(id).toLowerCase().trim()).filter(Boolean);
        const eventFilter = {
            status: { $in: ["ACTIVE", "Pending", "DETECTED", "NOTIFIED", "PENDING_REALLOCATION"] },
            userId: { $in: normalizedIds }
        };

        const now = new Date();
        const reason = "Admin manually assigned and approved student route";

        const lreResult = await LateResponseEvent.updateMany(
            eventFilter,
            {
                $set: {
                    status: "RESOLVED",
                    resolvedAt: now,
                    resolutionReason: reason,
                    updatedAt: now
                }
            }
        );

        const userResult = await User.updateMany(
            {
                role: "student",
                $or: [
                    { userId: { $in: normalizedIds } },
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

        console.log(`[LIFECYCLE] Resolved late response for ${userResult.modifiedCount} allocated student(s)`);

        return {
            success: true,
            resolvedEventsCount: lreResult.modifiedCount,
            updatedUsersCount: userResult.modifiedCount
        };
    } catch (err) {
        console.error("[LIFECYCLE] Error resolving previous late responses:", err.message);
        return { success: false, error: err.message, resolvedCount: 0 };
    }
};

/**
 * 5. GET ACTIVE LATE RESPONSES (AUTHORITATIVE)
 * Sourced directly from LateResponseEvent where status === 'ACTIVE'.
 * Used by GET /users/late-travel-responses, Admin Dashboard, and User Management.
 * Rule 4 & 5: One common list, no OUTWARD/INWARD late responses or direction-wise totals!
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
        // 1. Fetch active events from LateResponseEvent collection
        const activeEvents = await LateResponseEvent.find({
            status: "ACTIVE"
        }).sort({ responseSubmittedAt: -1, createdAt: -1 }).lean();

        // 2. Fetch all student candidates from User collection who have travelStatus === 'Coming'
        // and any late response flags, OR whose userId is in activeEvents
        const activeEventUserIds = (activeEvents || []).map((e) => String(e.userId || "").trim()).filter(Boolean);

        const studentCandidates = await User.find({
            role: "student",
            $or: [
                {
                    travelStatus: "Coming",
                    $or: [
                        { lateResponse: true },
                        { isLateResponse: true },
                        { lateResponseDetected: true }
                    ]
                },
                {
                    userId: { $in: activeEventUserIds }
                }
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
                requiresReallocation: 1,
                submittedPlanVersion: 1,
                submittedApprovalEventId: 1,
                assignedVehicle: 1,
                assignedRoute: 1,
                allocatedBus: 1
            })
            .lean();

        const studentMap = new Map();
        for (const s of studentCandidates) {
            studentMap.set(String(s.userId).toLowerCase().trim(), s);
        }

        const eventsByUserId = new Map();
        const staleEventIdsToResolve = [];

        for (const ev of activeEvents) {
            const uId = String(ev.userId || "").toLowerCase().trim();
            const student = studentMap.get(uId);

            // Rule: Ignore acknowledged, resolved, old, or stale late-response events.
            // If student travel status is no longer "Coming" or student is already allocated, resolve stale event.
            const isAlreadyAllocated = Boolean(
                student && (
                    student.assignedVehicle ||
                    student.allocatedBus?.isAllocated ||
                    student.allocatedBus?.vehicleName ||
                    student.allocatedBus?.inward?.isAllocated ||
                    student.allocatedBus?.outward?.isAllocated ||
                    student.allocationStatus === "Assigned" ||
                    student.allocationStatus === "Re-assigned"
                )
            );

            if (!student || student.travelStatus !== "Coming" || isAlreadyAllocated) {
                staleEventIdsToResolve.push(ev._id);
            } else if (!eventsByUserId.has(uId)) {
                eventsByUserId.set(uId, ev);
            }
        }

        // Asynchronously resolve stale events in the background
        if (staleEventIdsToResolve.length > 0) {
            LateResponseEvent.updateMany(
                { _id: { $in: staleEventIdsToResolve } },
                { $set: { status: "RESOLVED", resolvedAt: new Date(), resolutionReason: "Student status reset or allocated" } }
            ).catch((err) => console.warn("[LIFECYCLE] Error resolving stale events:", err.message));
        }

        // 3. Collect unique qualifying students:
        // Must have travelStatus === 'Coming', be unallocated, and have late response flag or active event
        const seenUserIds = new Set();
        const formattedList = [];
        const unnotifiedEventKeys = [];

        for (const student of studentCandidates) {
            const uId = String(student.userId).toLowerCase().trim();
            if (seenUserIds.has(uId)) continue;

            // Must have travelStatus === 'Coming'
            if (student.travelStatus !== "Coming") continue;

            // Must not be already allocated
            const isAlreadyAllocated = Boolean(
                student.assignedVehicle ||
                student.allocatedBus?.isAllocated ||
                student.allocatedBus?.vehicleName ||
                student.allocatedBus?.inward?.isAllocated ||
                student.allocatedBus?.outward?.isAllocated ||
                student.allocationStatus === "Assigned" ||
                student.allocationStatus === "Re-assigned"
            );
            if (isAlreadyAllocated) continue;

            // Must be flagged as late response or have an active event
            const isLate = Boolean(
                student.lateResponse ||
                student.isLateResponse ||
                student.lateResponseDetected ||
                eventsByUserId.has(uId)
            );
            if (!isLate) continue;

            seenUserIds.add(uId);

            const ev = eventsByUserId.get(uId);
            const responseTime = student.lateResponseAt || student.travelResponseSubmittedAt || student.lastTravelResponseAt || ev?.responseSubmittedAt || ev?.responseTimestamp || new Date();
            const approvalEventId = ev?.approvalEventId || student.submittedApprovalEventId || "approved_plan";
            const planApprovedAt = ev?.planApprovedAt || null;
            const planVersion = ev?.planVersion || student.submittedPlanVersion || 1;

            const eventKey = ev?.eventKey || generateLateResponseEventKey(student.userId, approvalEventId, planApprovedAt || responseTime);

            // Determine if acknowledged / notified:
            // A notification is considered acknowledged if:
            // 1. student.lateResponseNotifiedAt is present
            // 2. student.lateResponseNotifiedEventKeys contains the eventKey
            // 3. LateResponseEvent has isNotified: true or notifiedAt
            const isNotified = Boolean(
                student.lateResponseNotifiedAt ||
                (Array.isArray(student.lateResponseNotifiedEventKeys) && student.lateResponseNotifiedEventKeys.includes(eventKey)) ||
                ev?.isNotified ||
                ev?.notifiedAt
            );

            if (!isNotified) {
                unnotifiedEventKeys.push(eventKey);
            }

            formattedList.push({
                _id: student._id || ev?._id,
                userId: student.userId,
                name: student.name || student.userId,
                travelStatus: "Coming",
                currentTravelStatus: "Coming",
                previousTravelStatus: student.previousTravelStatus || ev?.previousTravelStatus || "Pending",
                allocationStatus: "Unallocated",
                lateResponse: true,
                isLateResponse: true,
                lateResponseDetected: true,
                requiresReallocation: true,
                responseSubmittedAt: responseTime,
                responseSubmittedTime: responseTime,
                planApprovedAt,
                planApprovalTime: planApprovedAt,
                planVersion,
                approvalEventId,
                planId: ev?.planId || null,
                eventKey,
                eventKeys: [eventKey],
                isNotified,
                isUnnotified: !isNotified,
                processingStatus: isNotified ? "NOTIFIED" : "DETECTED",
                stoppings: student.stoppings || "—",
                city: student.city || "—",
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

