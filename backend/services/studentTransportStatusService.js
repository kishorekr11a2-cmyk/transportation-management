import mongoose from "mongoose";
import User from "../models/User.js";
import AiPlan from "../models/AiPlan.js";
import LateResponseEvent from "../models/LateResponseEvent.js";
import { getCurrentApprovedPlan, generateLateResponseEventKey } from "./lateResponseLifecycleService.js";

const isDbConnected = () => mongoose.connection?.readyState === 1;

/**
 * Normalizes string identifiers for robust case-insensitive comparison
 */
const normalizeId = (id) => {
    if (id === null || id === undefined) return "";
    return String(id).toLowerCase().trim();
};

let cachedPlans = null;
let cacheExpiresAt = 0;

export const clearActiveApprovedPlansCache = () => {
    cachedPlans = null;
    cacheExpiresAt = 0;
};

/**
 * 1. GET ALL ACTIVE APPROVED PLANS
 * Fetches current approved plans for both INWARD and OUTWARD directions.
 * Caches in memory for 3 seconds to avoid duplicate roundtrips during concurrent requests.
 */
export const getActiveApprovedPlans = async ({ forceRefresh = false, direction = null } = {}) => {
    const now = Date.now();
    if (!forceRefresh && cachedPlans && now < cacheExpiresAt) {
        return cachedPlans;
    }

    try {
        const [inwardPlan, outwardPlan] = await Promise.all([
            getCurrentApprovedPlan("INWARD"),
            getCurrentApprovedPlan("OUTWARD")
        ]);

        const requestedDir = direction ? String(direction).toUpperCase().trim() : null;
        let primaryPlan;
        if (requestedDir === "INWARD") {
            primaryPlan = inwardPlan.isApproved ? inwardPlan : (outwardPlan.isApproved ? outwardPlan : null);
        } else if (requestedDir === "OUTWARD") {
            primaryPlan = outwardPlan.isApproved ? outwardPlan : (inwardPlan.isApproved ? inwardPlan : null);
        } else {
            primaryPlan = inwardPlan.isApproved ? inwardPlan : (outwardPlan.isApproved ? outwardPlan : null);
        }

        const result = {
            INWARD: inwardPlan,
            OUTWARD: outwardPlan,
            hasApprovedPlan: Boolean(inwardPlan.isApproved || outwardPlan.isApproved),
            primaryPlan
        };
        cachedPlans = result;
        cacheExpiresAt = now + 3000;
        return result;
    } catch (err) {
        console.error("[TRANSPORT_STATUS] Error fetching approved plans:", err.message);
        return {
            INWARD: { isApproved: false, allocatedUserIds: new Set() },
            OUTWARD: { isApproved: false, allocatedUserIds: new Set() },
            hasApprovedPlan: false,
            primaryPlan: null
        };
    }
};

/**
 * 2. GET ACTIVE ALLOCATION FOR STUDENT
 * Searches the actual allocation sources used by the project:
 * - ai_selected_plans (primary authoritative source)
 * - AiPlan collection (fallback)
 * - manual_plan_submissions / Route assignments
 * - user.allocatedBus (cached embedded allocation)
 *
 * Dynamically returns student's vehicle, route, boardingStop, seatStatus, etc.
 * Never hardcodes any student ID, vehicle name, route code, or plan version.
 */
/**
 * Helper to normalize activePlans input into a consistent { INWARD, OUTWARD, primaryPlan, hasApprovedPlan } structure.
 * Supports arrays of plans, single plan objects, or direction-keyed maps.
 */
export const normalizeActivePlans = (plans, options = {}) => {
    if (!plans) return { INWARD: { isApproved: false }, OUTWARD: { isApproved: false }, hasApprovedPlan: false, primaryPlan: null };

    const requestedDir = options?.direction ? String(options.direction).toUpperCase().trim() : null;

    if (plans.INWARD || plans.OUTWARD) {
        const inwardApproved = Boolean(
            plans.INWARD?.isApproved ||
            plans.INWARD?.adminApprovalStatus === "Approved" ||
            plans.INWARD?.approved === true ||
            plans.INWARD?.plan?.adminApprovalStatus === "Approved" ||
            plans.INWARD?.approvalEventId
        );
        const outwardApproved = Boolean(
            plans.OUTWARD?.isApproved ||
            plans.OUTWARD?.adminApprovalStatus === "Approved" ||
            plans.OUTWARD?.approved === true ||
            plans.OUTWARD?.plan?.adminApprovalStatus === "Approved" ||
            plans.OUTWARD?.approvalEventId
        );
        const inward = plans.INWARD ? { ...plans.INWARD, isApproved: inwardApproved, planVersion: plans.INWARD.planVersion || plans.INWARD.version || 1 } : { isApproved: false };
        const outward = plans.OUTWARD ? { ...plans.OUTWARD, isApproved: outwardApproved, planVersion: plans.OUTWARD.planVersion || plans.OUTWARD.version || 1 } : { isApproved: false };

        let primary;
        if (requestedDir === "INWARD") {
            primary = inwardApproved ? inward : (outwardApproved ? outward : null);
        } else if (requestedDir === "OUTWARD") {
            primary = outwardApproved ? outward : (inwardApproved ? inward : null);
        } else {
            primary = plans.primaryPlan || (inwardApproved ? inward : (outwardApproved ? outward : null));
        }

        return {
            INWARD: inward,
            OUTWARD: outward,
            primaryPlan: primary,
            hasApprovedPlan: Boolean(inwardApproved || outwardApproved || plans.hasApprovedPlan)
        };
    }

    const planList = Array.isArray(plans) ? plans : [plans];
    const normalized = {
        INWARD: { isApproved: false },
        OUTWARD: { isApproved: false },
        primaryPlan: null,
        hasApprovedPlan: false
    };

    for (const p of planList) {
        if (!p) continue;
        const isApproved = Boolean(
            p.isApproved === true ||
            p.adminApprovalStatus === "Approved" ||
            p.approved === true ||
            p.plan?.adminApprovalStatus === "Approved" ||
            (p.approvalEventId && p.isApproved !== false && p.adminApprovalStatus !== "Draft")
        );
        const dir = String(p.direction || "INWARD").toUpperCase().trim();
        const planObj = {
            ...p,
            isApproved,
            planVersion: p.planVersion || p.version || p.plan?.version || 1,
            planType: p.planType || p.type || "AI",
            buses: p.buses || p.plan?.buses || p.routes || [],
            allocatedUserIds: p.allocatedUserIds || p.plan?.allocatedUserIds || null
        };
        if (dir === "OUTWARD") {
            if (isApproved || !normalized.OUTWARD.isApproved) {
                normalized.OUTWARD = planObj;
            }
        } else {
            if (isApproved || !normalized.INWARD.isApproved) {
                normalized.INWARD = planObj;
            }
        }
        if (isApproved) {
            normalized.hasApprovedPlan = true;
            if (!normalized.primaryPlan || !normalized.primaryPlan.isApproved) {
                normalized.primaryPlan = planObj;
            }
        }
    }
    return normalized;
};

export const getActiveAllocationForStudent = (userOrDoc, rawActivePlans, options = {}) => {
    if (!userOrDoc || !userOrDoc.travelStatus || userOrDoc.travelStatus === "Pending") {
        return {
            isAllocated: false,
            travelStatus: "Pending",
            allocationStatus: "Unallocated",
            isUnallocated: true,
            submissionLocked: false,
            vehicle: null,
            route: null,
            planVersion: null,
            planType: null,
            direction: null,
            boardingStop: null,
            seatStatus: null,
            approvalStatus: null,
            allocatedBus: null
        };
    }

    if (userOrDoc.travelStatus === "Not Coming") {
        return {
            isAllocated: false,
            travelStatus: "Not Coming",
            allocationStatus: "Unallocated",
            isUnallocated: true,
            submissionLocked: false,
            vehicle: null,
            route: null,
            planVersion: null,
            planType: null,
            direction: null,
            boardingStop: null,
            seatStatus: null,
            approvalStatus: null,
            allocatedBus: null
        };
    }

    const targetDir = options?.direction ? String(options.direction).toUpperCase().trim() : null;
    const activePlans = normalizeActivePlans(rawActivePlans, { direction: targetDir });
    const uId = normalizeId(userOrDoc.userId);
    const mongoId = normalizeId(userOrDoc._id || userOrDoc.id);
    const uStop = String(userOrDoc.stoppings || "").trim();

    const currentPlanEventId = activePlans?.primaryPlan?.approvalEventId ||
        (activePlans?.primaryPlan?.planVersion ? `v${activePlans.primaryPlan.planVersion}` : null);
    const inwardPlanTime = activePlans.INWARD?.approvedAt ? new Date(activePlans.INWARD.approvedAt) : null;
    const outwardPlanTime = activePlans.OUTWARD?.approvedAt ? new Date(activePlans.OUTWARD.approvedAt) : null;
    const responseTime = userOrDoc.travelResponseSubmittedAt || userOrDoc.lastTravelResponseAt || (userOrDoc.lateResponseDetected ? userOrDoc.lateResponseAt : null);

    const activeLateUserIds = options.activeLateUserIds;
    const hasActiveLateEvent = Boolean(activeLateUserIds && activeLateUserIds.has(uId));
    const existingAffectedDirs = Array.isArray(userOrDoc.affectedDirections)
        ? userOrDoc.affectedDirections.map((d) => String(d).toUpperCase().trim())
        : [];

    const isSubmittedAfterInward = Boolean(
        activePlans.INWARD?.isApproved &&
        inwardPlanTime &&
        responseTime &&
        new Date(responseTime).getTime() > inwardPlanTime.getTime()
    );
    const isSubmittedAfterOutward = Boolean(
        activePlans.OUTWARD?.isApproved &&
        outwardPlanTime &&
        responseTime &&
        new Date(responseTime).getTime() > outwardPlanTime.getTime()
    );

    const isLateInward = Boolean(
        isSubmittedAfterInward ||
        (hasActiveLateEvent && existingAffectedDirs.includes("INWARD")) ||
        (userOrDoc.lateResponseDetected === true && existingAffectedDirs.includes("INWARD"))
    );
    const isLateOutward = Boolean(
        isSubmittedAfterOutward ||
        (hasActiveLateEvent && existingAffectedDirs.includes("OUTWARD")) ||
        (userOrDoc.lateResponseDetected === true && existingAffectedDirs.includes("OUTWARD"))
    );

    // Helper to find student in an active plan's bus list (ONLY by userId or mongoId — NEVER by name)
    const findStudentInPlanBuses = (planDoc, direction) => {
        const isApproved = Boolean(
            planDoc?.isApproved ||
            planDoc?.adminApprovalStatus === "Approved" ||
            planDoc?.approved === true ||
            planDoc?.plan?.adminApprovalStatus === "Approved" ||
            (planDoc?.approvalEventId && planDoc?.isApproved !== false && planDoc?.adminApprovalStatus !== "Draft")
        );
        if (!planDoc || !isApproved) return null;

        const planData = planDoc.plan || planDoc;
        const planApprovedAt = planDoc.approvedAt || planDoc.selectedAt || planData?.approvedAt;
        if (planApprovedAt && responseTime && new Date(responseTime).getTime() > new Date(planApprovedAt).getTime()) {
            return null;
        }

        const planAllocatedIds = planData?.allocatedUserIds || planDoc?.allocatedUserIds;
        if (planAllocatedIds) {
            const hasUser = planAllocatedIds instanceof Set
                ? (planAllocatedIds.has(uId) || (userOrDoc.userId && planAllocatedIds.has(userOrDoc.userId)))
                : (Array.isArray(planAllocatedIds) && planAllocatedIds.some(id => normalizeId(id) === uId || (userOrDoc.userId && id === userOrDoc.userId)));
            if (hasUser) {
                const vehicleName = userOrDoc.allocatedBus?.vehicleName || userOrDoc.assignedVehicle || "Assigned Bus";
                const routeCode = userOrDoc.allocatedBus?.routeCode || userOrDoc.assignedRoute || "Assigned Route";
                return {
                    isAllocated: true,
                    approved: true,
                    vehicle: vehicleName,
                    vehicleName,
                    vehicleNumber: vehicleName,
                    route: routeCode,
                    routeCode,
                    routeName: userOrDoc.allocatedBus?.routeName || routeCode,
                    direction,
                    planVersion: planDoc.planVersion || planDoc.version || 1,
                    planType: planDoc.planType || "AI",
                    approvalEventId: planDoc.approvalEventId,
                    boardingStop: uStop || "Assigned Stop",
                    seatNumber: userOrDoc.allocatedBus?.seatNumber || null,
                    seatStatus: "Assigned",
                    allocationStatus: "Assigned",
                    adminApprovalStatus: "Approved",
                    source: "active_plan"
                };
            }
        }

        const buses = Array.isArray(planData?.buses) ? planData.buses : (Array.isArray(planData?.routes) ? planData.routes : []);

        for (const bus of buses) {
            const users = bus.users || bus.allocatedStudents || bus.passengers || bus.assignedUsers || [];
            let isUserInBus = false;
            let seatNumber = bus.seatNumber || null;

            for (const u of users) {
                const candId = typeof u === "string" ? normalizeId(u) : normalizeId(u.userId || u._id || u.id);
                // ONLY match by userId or mongoId — NEVER by student name!
                if ((uId && candId === uId) || (mongoId && candId === mongoId)) {
                    isUserInBus = true;
                    if (typeof u === "object" && u.seatNumber) seatNumber = u.seatNumber;
                    break;
                }
            }

            // Check individual stops within bus (ONLY userIds, never student names)
            let matchedStop = null;
            const stops = Array.isArray(bus.stops) ? bus.stops : [];
            for (const st of stops) {
                const stopUserIds = (st.userIds || []).map(normalizeId);
                if ((uId && stopUserIds.includes(uId)) || (mongoId && stopUserIds.includes(mongoId))) {
                    isUserInBus = true;
                    matchedStop = st;
                    break;
                }
            }

            if (isUserInBus) {
                const vehicleName = bus.vehicleName || bus.vehicleNumber || "Assigned Bus";
                const routeCode = bus.routeCode || bus.routeName || `R-${String(bus.routeNumber || 1).padStart(2, "0")}`;
                const routeName = bus.routeName || `${routeCode}: ${vehicleName}`;
                const stopName = matchedStop?.name || matchedStop?.stopName || uStop || "Assigned Stop";
                const seatStatus = seatNumber ? `#${seatNumber}` : "Assigned";

                return {
                    isAllocated: true,
                    approved: true,
                    vehicle: vehicleName,
                    vehicleName,
                    vehicleNumber: vehicleName,
                    route: routeCode,
                    routeCode,
                    routeName,
                    direction,
                    planVersion: planDoc.planVersion || planDoc.version || 1,
                    planType: planDoc.planType || "AI",
                    approvalEventId: planDoc.approvalEventId,
                    boardingStop: stopName,
                    seatNumber,
                    seatStatus,
                    allocationStatus: "Assigned",
                    adminApprovalStatus: "Approved",
                    source: "active_plan"
                };
            }
        }

        return null;
    };

    let inwardAllocation = null;
    let outwardAllocation = null;

    if (activePlans?.INWARD?.isApproved) {
        inwardAllocation = findStudentInPlanBuses(activePlans.INWARD, "INWARD");
    }

    if (activePlans?.OUTWARD?.isApproved) {
        outwardAllocation = findStudentInPlanBuses(activePlans.OUTWARD, "OUTWARD");
    }

    const hasLateNotice = Boolean(
        isLateInward ||
        isLateOutward ||
        hasActiveLateEvent ||
        userOrDoc.lateResponseDetected === true ||
        userOrDoc.isLateResponse === true ||
        userOrDoc.lateResponse === true ||
        userOrDoc.requiresReallocation === true
    );

    // Direct check from user document (saved by persistPlanToUsers or admin allocation)
    // ONLY if student does NOT have a late notice and is not explicitly unallocated!
    if (!hasLateNotice && userOrDoc.allocationStatus !== "Unallocated" && !userOrDoc.isUnallocated) {
        const userAlloc = userOrDoc.allocatedBus;
        if (!inwardAllocation && userAlloc?.inward?.isAllocated && (userAlloc.inward.approved === true || userAlloc.inward.adminApprovalStatus === "Approved")) {
            inwardAllocation = { ...userAlloc.inward, isAllocated: true, approved: true };
        }
        if (!outwardAllocation && userAlloc?.outward?.isAllocated && (userAlloc.outward.approved === true || userAlloc.outward.adminApprovalStatus === "Approved")) {
            outwardAllocation = { ...userAlloc.outward, isAllocated: true, approved: true };
        }
        if (!inwardAllocation && !outwardAllocation && (userAlloc?.isAllocated || userOrDoc.isAllocated || userOrDoc.assignedVehicle)) {
            const allocDir = userAlloc?.direction || userOrDoc.direction || targetDir || "OUTWARD";
            const vName = userAlloc?.vehicleName || userOrDoc.assignedVehicle || "Assigned Bus";
            const rCode = userAlloc?.routeCode || userOrDoc.assignedRoute || "Assigned Route";
            const sNum = userAlloc?.seatNumber || (userOrDoc.seatNumber ? Number(userOrDoc.seatNumber) : 1);
            const directAlloc = {
                isAllocated: true,
                approved: true,
                vehicle: vName,
                vehicleName: vName,
                vehicleNumber: vName,
                route: rCode,
                routeCode: rCode,
                routeName: userAlloc?.routeName || rCode,
                direction: allocDir,
                seatNumber: sNum,
                seatStatus: sNum ? `#${sNum}` : "Assigned",
                boardingStop: userAlloc?.boardingStop || uStop || "Assigned Stop",
                allocationStatus: "Assigned",
                adminApprovalStatus: "Approved"
            };
            if (allocDir === "INWARD") inwardAllocation = directAlloc;
            else outwardAllocation = directAlloc;
        }
    }

    let primaryAlloc;
    if (targetDir === "INWARD") {
        primaryAlloc = inwardAllocation || outwardAllocation;
    } else if (targetDir === "OUTWARD") {
        primaryAlloc = outwardAllocation || inwardAllocation;
    } else {
        primaryAlloc = inwardAllocation || outwardAllocation;
    }

    if (primaryAlloc && primaryAlloc.isAllocated) {
        console.log("[LateResponse] userId:", userOrDoc.userId || uId);
        console.log("[LateResponse] lateResponseDetected:", false);
        console.log("[LateResponse] currentPlanEventId:", currentPlanEventId);
        console.log("[LateResponse] allocation decision:", "ALLOCATED");

        return {
            isAllocated: true,
            allocationStatus: "Assigned",
            isUnallocated: false,
            vehicle: primaryAlloc.vehicle,
            vehicleName: primaryAlloc.vehicle,
            vehicleNumber: primaryAlloc.vehicle,
            route: primaryAlloc.route,
            routeCode: primaryAlloc.route,
            routeName: primaryAlloc.routeName,
            planVersion: primaryAlloc.planVersion,
            planType: primaryAlloc.planType,
            direction: primaryAlloc.direction,
            boardingStop: primaryAlloc.boardingStop,
            seatStatus: primaryAlloc.seatStatus,
            approvalStatus: "Approved",
            inward: inwardAllocation,
            outward: outwardAllocation,
            allocatedBus: {
                ...primaryAlloc,
                isAllocated: true,
                inward: inwardAllocation,
                outward: outwardAllocation
            }
        };
    }

    console.log("[LateResponse] userId:", userOrDoc.userId || uId);
    console.log("[LateResponse] lateResponseDetected:", hasLateNotice);
    console.log("[LateResponse] currentPlanEventId:", currentPlanEventId);
    console.log("[LateResponse] allocation decision:", hasLateNotice ? "REJECT_LATE_RESPONSE" : "UNALLOCATED");

    return {
        isAllocated: false,
        travelStatus: "Coming",
        allocationStatus: "Unallocated",
        isUnallocated: true,
        lateResponseDetected: hasLateNotice,
        isLateResponse: hasLateNotice,
        vehicle: null,
        route: null,
        planVersion: activePlans?.primaryPlan?.planVersion || 1,
        planType: activePlans?.primaryPlan?.planType || null,
        direction: targetDir || null,
        boardingStop: uStop || null,
        seatStatus: null,
        approvalStatus: null,
        allocatedBus: null
    };
};

/**
 * 3. GET CURRENT STUDENT TRANSPORT STATUS (ONE SOURCE OF TRUTH)
 *
 * Implements the mandatory Decision Order:
 * 1. user.travelStatus === "Pending" -> Unallocated Pending State
 * 2. user.travelStatus === "Not Coming" -> Unallocated Not Coming State
 * 3. hasActiveLateResponseForCurrentApprovedPlan -> Late Response Unallocated State
 * 4. studentIsIncludedInTheNewlyApprovedPlan -> Allocated State
 * 5. Default -> Unallocated State
 */
export const getCurrentStudentTransportStatus = async (userOrUserId, options = {}) => {
    let userDoc = null;

    if (typeof userOrUserId === "string") {
        if (!isDbConnected()) return null;
        userDoc = await User.findOne({
            $or: [
                { userId: userOrUserId },
                { userId: userOrUserId.toUpperCase() },
                { userId: userOrUserId.toLowerCase() },
                ...(mongoose.Types.ObjectId.isValid(userOrUserId) ? [{ _id: userOrUserId }] : [])
            ]
        }).lean();
    } else if (userOrUserId && typeof userOrUserId === "object") {
        userDoc = userOrUserId;
    }

    if (!userDoc) {
        return null;
    }

    // Resolve active plans (or use provided pre-fetched plans)
    const activePlans = options.activePlans || await getActiveApprovedPlans();
    const activePlanVersion = activePlans?.primaryPlan?.planVersion || 1;
    const activePlanType = activePlans?.primaryPlan?.planType || "AI";
    const currentPlanEventId = activePlans?.primaryPlan?.approvalEventId || (activePlanVersion ? `v${activePlanVersion}` : null);
    const planApprovalTime = activePlans?.primaryPlan?.approvedAt ? new Date(activePlans.primaryPlan.approvedAt) : null;
    const currentTravelStatus = userDoc.travelStatus || "Pending";
    const uId = normalizeId(userDoc.userId);

    // ── 1. Pending State ──
    if (currentTravelStatus === "Pending") {
        return {
            ...userDoc,
            userId: userDoc.userId,
            name: userDoc.name,
            travelStatus: "Pending",
            allocationStatus: "Unallocated",
            isAllocated: false,
            isUnallocated: true,
            submissionLocked: false,
            isSubmissionLocked: false,
            allocatedVehicle: null,
            allocatedRoute: null,
            assignedVehicle: null,
            assignedRoute: null,
            vehicle: null,
            activePlanVersion,
            activePlanType,
            lateResponseStatus: "NONE",
            lateResponse: false,
            isLateResponse: false,
            lateResponseDetected: false,
            requiresReallocation: false,
            affectedDirections: [],
            allocatedBus: null,
            route: null,
            planVersion: activePlanVersion,
            planId: activePlans?.primaryPlan?.planId || null,
            activePlan: activePlans?.primaryPlan || null
        };
    }

    // ── 2. Not Coming State ──
    if (currentTravelStatus === "Not Coming") {
        return {
            ...userDoc,
            userId: userDoc.userId,
            name: userDoc.name,
            travelStatus: "Not Coming",
            allocationStatus: "Unallocated",
            isAllocated: false,
            isUnallocated: true,
            submissionLocked: false,
            isSubmissionLocked: false,
            allocatedVehicle: null,
            allocatedRoute: null,
            assignedVehicle: null,
            assignedRoute: null,
            vehicle: null,
            activePlanVersion,
            activePlanType,
            lateResponseStatus: "NONE",
            lateResponse: false,
            isLateResponse: false,
            lateResponseDetected: false,
            requiresReallocation: false,
            affectedDirections: [],
            allocatedBus: null,
            route: null,
            planVersion: activePlanVersion,
            planId: activePlans?.primaryPlan?.planId || null,
            activePlan: activePlans?.primaryPlan || null
        };
    }

    // ── 3. Check Active Late Response for Current Approved Plan ──
    let activeLateUserIds = options.activeLateUserIds;
    if (!activeLateUserIds && isDbConnected()) {
        try {
            const activeEvents = await LateResponseEvent.find({ status: "ACTIVE" }).select("userId").lean();
            activeLateUserIds = new Set((activeEvents || []).map((e) => normalizeId(e.userId)));
        } catch {
            activeLateUserIds = new Set();
        }
    } else if (!activeLateUserIds) {
        activeLateUserIds = new Set();
    }

    const inwardPlanTime = activePlans.INWARD?.approvedAt ? new Date(activePlans.INWARD.approvedAt) : null;
    const outwardPlanTime = activePlans.OUTWARD?.approvedAt ? new Date(activePlans.OUTWARD.approvedAt) : null;
    const responseTime = userDoc.travelResponseSubmittedAt || userDoc.lastTravelResponseAt || (userDoc.lateResponseDetected ? userDoc.lateResponseAt : null);

    const isSubmittedAfterInward = Boolean(
        activePlans.INWARD?.isApproved &&
        inwardPlanTime &&
        responseTime &&
        new Date(responseTime).getTime() > inwardPlanTime.getTime()
    );
    const isSubmittedAfterOutward = Boolean(
        activePlans.OUTWARD?.isApproved &&
        outwardPlanTime &&
        responseTime &&
        new Date(responseTime).getTime() > outwardPlanTime.getTime()
    );

    const detectedAffectedDirs = [];
    if (isSubmittedAfterInward) detectedAffectedDirs.push("INWARD");
    if (isSubmittedAfterOutward) detectedAffectedDirs.push("OUTWARD");

    const dynamicAffectedDirs = (Array.isArray(userDoc.affectedDirections) && userDoc.affectedDirections.length > 0)
        ? userDoc.affectedDirections
        : (detectedAffectedDirs.length > 0
            ? detectedAffectedDirs
            : (activePlans.INWARD?.isApproved && !activePlans.OUTWARD?.isApproved ? ["INWARD"] : (activePlans.OUTWARD?.isApproved && !activePlans.INWARD?.isApproved ? ["OUTWARD"] : ["INWARD", "OUTWARD"])));

    // ── 3. Check Active Late Response for Current Approved Plan ──
    const hasActiveLateEvent = activeLateUserIds ? activeLateUserIds.has(uId) : false;
    const isSubmittedAfterCurrentApproval = Boolean(
        activePlans.hasApprovedPlan &&
        planApprovalTime &&
        responseTime &&
        new Date(responseTime).getTime() > planApprovalTime.getTime()
    );

    const isLateForCurrentPlan = Boolean(
        userDoc.lateResponse === true ||
        userDoc.isLateResponse === true ||
        isSubmittedAfterCurrentApproval ||
        hasActiveLateEvent ||
        (userDoc.lateResponseDetected === true && (
            (userDoc.submittedApprovalEventId && currentPlanEventId && String(userDoc.submittedApprovalEventId).toLowerCase().trim() === String(currentPlanEventId).toLowerCase().trim()) ||
            (userDoc.submittedPlanVersion && userDoc.submittedPlanVersion === activePlanVersion) ||
            isSubmittedAfterCurrentApproval
        ))
    );

    // ── 4. Check If Student Is Included In The Newly Approved Plan ──
    // IMPORTANT: Must check allocation BEFORE the isLateForCurrentPlan early return.
    // A student who was late but has since been allocated via regenerated plan must
    // be returned as ALLOCATED, not LATE. The late flags on the user document may not
    // yet be cleared if persistPlanToUsers ran but the user document was not fully updated.
    const allocation = getActiveAllocationForStudent(userDoc, activePlans, { activeLateUserIds, direction: options.direction });

    if (allocation.isAllocated) {
        const remainingAffectedDirs = dynamicAffectedDirs.filter((d) => (d === "INWARD" ? !allocation.inward : !allocation.outward));
        const hasPendingOtherDir = remainingAffectedDirs.length > 0;

        return {
            ...userDoc,
            userId: userDoc.userId,
            name: userDoc.name,
            travelStatus: "Coming",
            allocationStatus: userDoc.allocationStatus === "Re-assigned" ? "Re-assigned" : "Assigned",
            isAllocated: true,
            isUnallocated: false,
            allocatedVehicle: allocation.vehicle,
            allocatedRoute: allocation.route,
            assignedVehicle: allocation.vehicle,
            assignedRoute: allocation.route,
            vehicle: allocation.vehicle,
            activePlanVersion: allocation.planVersion || activePlanVersion,
            activePlanType: allocation.planType || activePlanType,
            submissionLocked: true,
            isSubmissionLocked: true,
            lateResponseStatus: hasPendingOtherDir ? "ACTIVE" : "NONE",
            lateResponse: hasPendingOtherDir,
            isLateResponse: hasPendingOtherDir,
            lateResponseDetected: hasPendingOtherDir,
            requiresReallocation: hasPendingOtherDir,
            affectedDirections: remainingAffectedDirs,
            allocatedBus: allocation.allocatedBus || allocation,
            route: allocation.route,
            planVersion: allocation.planVersion || activePlanVersion,
            planId: activePlans?.primaryPlan?.planId || null,
            activePlan: activePlans?.primaryPlan || null
        };
    }

    if (isLateForCurrentPlan) {
        const targetPlanId = (dynamicAffectedDirs.includes("OUTWARD") && !dynamicAffectedDirs.includes("INWARD"))
            ? (activePlans?.OUTWARD?.planId || activePlans?.primaryPlan?.planId || null)
            : (activePlans?.INWARD?.planId || activePlans?.primaryPlan?.planId || null);

        return {
            ...userDoc,
            userId: userDoc.userId,
            name: userDoc.name,
            travelStatus: "Coming",
            allocationStatus: "Unallocated",
            isAllocated: false,
            isUnallocated: true,
            allocatedVehicle: null,
            allocatedRoute: null,
            assignedVehicle: null,
            assignedRoute: null,
            vehicle: null,
            activePlanVersion,
            activePlanType,
            submissionLocked: false,
            isSubmissionLocked: false,
            lateResponseStatus: "ACTIVE",
            lateResponse: true,
            isLateResponse: true,
            lateResponseDetected: true,
            requiresReallocation: true,
            affectedDirections: dynamicAffectedDirs,
            allocatedBus: null,
            route: null,
            planVersion: activePlanVersion,
            planId: targetPlanId,
            activePlan: activePlans?.primaryPlan || null,
            reason: "Late response requires admin reallocation",
            message: "Your Coming response was submitted after the plan was approved. Please wait until the administrator regenerates and approves the plan."
        };
    }




    // ── 5. Default: Unallocated State (Normal Coming student awaiting or without seat) ──
    return {
        ...userDoc,
        userId: userDoc.userId,
        name: userDoc.name,
        travelStatus: "Coming",
        allocationStatus: "Unallocated",
        isAllocated: false,
        isUnallocated: true,
        allocatedVehicle: null,
        allocatedRoute: null,
        assignedVehicle: null,
        assignedRoute: null,
        vehicle: null,
        activePlanVersion,
        activePlanType,
        submissionLocked: false,
        isSubmissionLocked: false,
        lateResponseStatus: "NONE",
        lateResponse: false,
        isLateResponse: false,
        lateResponseDetected: false,
        requiresReallocation: false,
        affectedDirections: [],
        allocatedBus: null,
        route: null,
        planVersion: activePlanVersion,
        planId: activePlans?.primaryPlan?.planId || null,
        activePlan: activePlans?.primaryPlan || null
    };
};

/**
 * 4. BATCH CALCULATE STUDENT TRANSPORT STATUSES
 * High-performance resolver for User Management table & metrics.
 * Pre-fetches active plans and active late response events ONCE,
 * then maps across all students in memory (<20ms for 1000 users).
 */
export const batchCalculateStudentTransportStatuses = async (students) => {
    if (!Array.isArray(students) || students.length === 0) {
        return [];
    }

    const activePlans = await getActiveApprovedPlans();

    let activeLateUserIds = new Set();
    if (isDbConnected()) {
        try {
            const activeEvents = await LateResponseEvent.find({ status: "ACTIVE" }).select("userId").lean();
            activeLateUserIds = new Set((activeEvents || []).map((e) => normalizeId(e.userId)));
        } catch (e) {
            console.warn("[TRANSPORT_STATUS] Error loading late events:", e.message);
        }
    }

    return students.map((student) => {
        return calculateStudentTransportStatusSync(student, activePlans, activeLateUserIds);
    });
};

/**
 * Synchronous in-memory status calculator when activePlans and activeLateUserIds are already available.
 * Follows the EXACT same Decision Order:
 * 1. user.travelStatus === "Pending" -> Unallocated Pending State
 * 2. user.travelStatus === "Not Coming" -> Unallocated Not Coming State
 * 3. hasActiveLateResponseForCurrentApprovedPlan -> Late Response Unallocated State
 * 4. studentIsIncludedInTheNewlyApprovedPlan -> Allocated State
 * 5. Default -> Unallocated State
 */
export const calculateStudentTransportStatusSync = (userDoc, rawActivePlans, activeLateUserIds) => {
    if (!userDoc) return null;

    const activePlans = normalizeActivePlans(rawActivePlans);
    const activePlanVersion = activePlans?.primaryPlan?.planVersion || 1;
    const activePlanType = activePlans?.primaryPlan?.planType || "AI";
    const currentPlanEventId = activePlans?.primaryPlan?.approvalEventId || (activePlanVersion ? `v${activePlanVersion}` : null);
    const planApprovalTime = activePlans?.primaryPlan?.approvedAt ? new Date(activePlans.primaryPlan.approvedAt) : null;
    const currentTravelStatus = userDoc.travelStatus || "Pending";
    const uId = normalizeId(userDoc.userId);

    // ── 1. Pending State ──
    if (currentTravelStatus === "Pending") {
        return {
            ...userDoc,
            userId: userDoc.userId,
            name: userDoc.name,
            travelStatus: "Pending",
            allocationStatus: "Unallocated",
            isAllocated: false,
            isUnallocated: true,
            allocatedVehicle: null,
            allocatedRoute: null,
            assignedVehicle: null,
            assignedRoute: null,
            vehicle: null,
            activePlanVersion,
            activePlanType,
            submissionLocked: false,
            isSubmissionLocked: false,
            lateResponseStatus: "NONE",
            lateResponse: false,
            isLateResponse: false,
            lateResponseDetected: false,
            requiresReallocation: false,
            affectedDirections: [],
            allocatedBus: null,
            route: null,
            planVersion: activePlanVersion,
            planId: activePlans?.primaryPlan?.planId || null,
            activePlan: activePlans?.primaryPlan || null
        };
    }

    // ── 2. Not Coming State ──
    if (currentTravelStatus === "Not Coming") {
        return {
            ...userDoc,
            userId: userDoc.userId,
            name: userDoc.name,
            travelStatus: "Not Coming",
            allocationStatus: "Unallocated",
            isAllocated: false,
            isUnallocated: true,
            allocatedVehicle: null,
            allocatedRoute: null,
            assignedVehicle: null,
            assignedRoute: null,
            vehicle: null,
            activePlanVersion,
            activePlanType,
            submissionLocked: false,
            isSubmissionLocked: false,
            lateResponseStatus: "NONE",
            lateResponse: false,
            isLateResponse: false,
            lateResponseDetected: false,
            requiresReallocation: false,
            affectedDirections: [],
            allocatedBus: null,
            route: null,
            planVersion: activePlanVersion,
            planId: activePlans?.primaryPlan?.planId || null,
            activePlan: activePlans?.primaryPlan || null
        };
    }

    // ── 3. Check Active Late Response for Current Approved Plan ──
    const hasActiveLateEvent = activeLateUserIds ? activeLateUserIds.has(uId) : false;
    const responseTime = userDoc.travelResponseSubmittedAt || userDoc.lastTravelResponseAt || (userDoc.lateResponseDetected ? userDoc.lateResponseAt : null);
    const isSubmittedAfterCurrentApproval = Boolean(
        activePlans.hasApprovedPlan &&
        planApprovalTime &&
        responseTime &&
        new Date(responseTime).getTime() > planApprovalTime.getTime()
    );

    const isLateForCurrentPlan = Boolean(
        userDoc.lateResponse === true ||
        userDoc.isLateResponse === true ||
        isSubmittedAfterCurrentApproval ||
        hasActiveLateEvent ||
        (userDoc.lateResponseDetected === true && (
            (userDoc.submittedApprovalEventId && currentPlanEventId && String(userDoc.submittedApprovalEventId).toLowerCase().trim() === String(currentPlanEventId).toLowerCase().trim()) ||
            (userDoc.submittedPlanVersion && userDoc.submittedPlanVersion === activePlanVersion) ||
            isSubmittedAfterCurrentApproval
        ))
    );

    // ── 4. Student Is Included In The Newly Approved Plan ──
    // IMPORTANT: Check allocation BEFORE late response return (same fix as getCurrentStudentTransportStatus).
    const allocation = getActiveAllocationForStudent(userDoc, activePlans, { activeLateUserIds });

    if (allocation.isAllocated) {
        console.log("[LateResponse] userId:", userDoc.userId || uId);
        console.log("[LateResponse] lateResponseDetected:", false);
        console.log("[LateResponse] currentPlanEventId:", currentPlanEventId);
        console.log("[LateResponse] allocation decision:", "ALLOCATED");

        return {
            ...userDoc,
            userId: userDoc.userId,
            name: userDoc.name,
            travelStatus: "Coming",
            allocationStatus: userDoc.allocationStatus === "Re-assigned" ? "Re-assigned" : "Assigned",
            isAllocated: true,
            isUnallocated: false,
            allocatedVehicle: allocation.vehicle,
            allocatedRoute: allocation.route,
            assignedVehicle: allocation.vehicle,
            assignedRoute: allocation.route,
            vehicle: allocation.vehicle,
            activePlanVersion: allocation.planVersion || activePlanVersion,
            activePlanType: allocation.planType || activePlanType,
            submissionLocked: true,
            isSubmissionLocked: true,
            lateResponseStatus: "NONE",
            lateResponse: false,
            isLateResponse: false,
            lateResponseDetected: false,
            requiresReallocation: false,
            affectedDirections: [],
            allocatedBus: allocation.allocatedBus || allocation,
            route: allocation.route,
            planVersion: allocation.planVersion || activePlanVersion,
            planId: activePlans?.primaryPlan?.planId || null,
            activePlan: activePlans?.primaryPlan || null
        };
    }

    if (isLateForCurrentPlan) {
        console.log("[LateResponse] userId:", userDoc.userId || uId);
        console.log("[LateResponse] lateResponseDetected:", true);
        console.log("[LateResponse] currentPlanEventId:", currentPlanEventId);
        console.log("[LateResponse] allocation decision:", "REJECT_LATE_RESPONSE");

        return {
            ...userDoc,
            userId: userDoc.userId,
            name: userDoc.name,
            travelStatus: "Coming",
            allocationStatus: "Unallocated",
            isAllocated: false,
            isUnallocated: true,
            allocatedVehicle: null,
            allocatedRoute: null,
            assignedVehicle: null,
            assignedRoute: null,
            vehicle: null,
            activePlanVersion,
            activePlanType,
            submissionLocked: false,
            isSubmissionLocked: false,
            lateResponseStatus: "ACTIVE",
            lateResponse: true,
            isLateResponse: true,
            lateResponseDetected: true,
            requiresReallocation: true,
            affectedDirections: userDoc.affectedDirections?.length > 0 ? userDoc.affectedDirections : ["INWARD"],
            allocatedBus: null,
            route: null,
            planVersion: activePlanVersion,
            planId: activePlans?.primaryPlan?.planId || null,
            activePlan: activePlans?.primaryPlan || null,
            reason: "Late response requires admin reallocation",
            message: "Your Coming response was submitted after the plan was approved. Please wait until the administrator regenerates and approves the plan."
        };
    }

    // ── 5. Default: Unallocated State (Normal Coming student awaiting or without seat) ──
    console.log("[LateResponse] userId:", userDoc.userId || uId);
    console.log("[LateResponse] lateResponseDetected:", false);
    console.log("[LateResponse] currentPlanEventId:", currentPlanEventId);
    console.log("[LateResponse] allocation decision:", "UNALLOCATED");

    return {
        ...userDoc,
        userId: userDoc.userId,
        name: userDoc.name,
        travelStatus: "Coming",
        allocationStatus: "Unallocated",
        isAllocated: false,
        isUnallocated: true,
        allocatedVehicle: null,
        allocatedRoute: null,
        assignedVehicle: null,
        assignedRoute: null,
        vehicle: null,
        activePlanVersion,
        activePlanType,
        submissionLocked: false,
        isSubmissionLocked: false,
        lateResponseStatus: "NONE",
        lateResponse: false,
        isLateResponse: false,
        lateResponseDetected: false,
        requiresReallocation: false,
        affectedDirections: [],
        allocatedBus: null,
        route: null,
        planVersion: activePlanVersion,
        planId: activePlans?.primaryPlan?.planId || null,
        activePlan: activePlans?.primaryPlan || null
    };
};

/**
 * 5. VALIDATE STUDENT RESPONSE
 *
 * Enforces: One student + one approved plan version/event = one response only.
 * - Rejects submissions if student is already allocated in active plan (ALREADY_ALLOCATED).
 * - Rejects duplicate submissions for the same plan version/event (DUPLICATE_SUBMISSION).
 * - Rejects duplicate submission before plan generation if student already submitted (ALREADY_SUBMITTED).
 * - Flags whether Coming submission is a late response (after current plan approval).
 */
export const validateStudentResponse = async ({
    user,
    activePlan,
    travelStatus,
    responseSubmittedAt = new Date()
}) => {
    // Normalize active plan object
    const normalizedPlans = normalizeActivePlans(activePlan);
    const resolvedPlan = normalizedPlans.primaryPlan || activePlan;
    const allocation = getActiveAllocationForStudent(user, normalizedPlans);

    const currentPlanVersion = Number(resolvedPlan?.planVersion || resolvedPlan?.version || allocation.planVersion) || 1;
    const currentApprovalEventId = resolvedPlan?.approvalEventId ? String(resolvedPlan.approvalEventId) : null;

    // Reject if current status is "Not Coming" and user attempts to change to "Coming"
    if (user?.travelStatus === "Not Coming" && travelStatus === "Coming") {
        return {
            allowed: false,
            code: "STATUS_CHANGE_NOT_ALLOWED",
            message: "You cannot change from Not Coming to Coming. Please contact the administrator.",
            travelStatus: "Not Coming",
            planVersion: currentPlanVersion
        };
    }

    // 1. Check if user is genuinely allocated in the active approved plan
    const isUserAllocated = Boolean(
        allocation.isAllocated &&
        !allocation.lateResponseDetected &&
        !user.lateResponseDetected &&
        !user.isLateResponse
    );

    if (isUserAllocated) {
        return {
            allowed: false,
            code: "ALREADY_ALLOCATED",
            message: `You are already allocated to an active bus in Plan Version ${currentPlanVersion}. Submission is locked.`,
            planVersion: currentPlanVersion
        };
    }

    const isApprovedPlan = Boolean(
        normalizedPlans.hasApprovedPlan ||
        resolvedPlan?.isApproved ||
        resolvedPlan?.adminApprovalStatus === "Approved" ||
        resolvedPlan?.approved === true ||
        (resolvedPlan?.approvalEventId && resolvedPlan?.isApproved !== false && resolvedPlan?.adminApprovalStatus !== "Draft")
    );

    // If no approved plan exists:
    if (!isApprovedPlan) {
        if (user.travelStatus && user.travelStatus !== "Pending") {
            return {
                allowed: false,
                code: "ALREADY_SUBMITTED",
                message: "Travel status already submitted. Please contact the administrator to reset your response before submitting again."
            };
        }

        return {
            allowed: true,
            isLate: false,
            isAllocated: false,
            activePlan: null
        };
    }

    const uId = normalizeId(user.userId);
    const mongoId = normalizeId(user._id || user.id);

    // 2. Check duplicate submission for this current plan version / eventId
    const submittedVersionMatches = user.submittedPlanVersion === currentPlanVersion;
    const submittedEventMatches = currentApprovalEventId && user.submittedApprovalEventId === currentApprovalEventId;

    let hasActiveLateEvent = false;
    if (isDbConnected()) {
        try {
            hasActiveLateEvent = Boolean(
                await LateResponseEvent.exists({
                    userId: { $in: [user.userId, uId] },
                    status: { $nin: ["RESOLVED", "ALLOCATED"] },
                    $or: [
                        ...(currentApprovalEventId ? [{ approvalEventId: currentApprovalEventId }] : []),
                        { planVersion: currentPlanVersion }
                    ]
                })
            );
        } catch (e) {
            console.warn("[TRANSPORT_STATUS] LateResponseEvent check warning:", e.message);
        }
    }

    if (submittedVersionMatches || submittedEventMatches || hasActiveLateEvent) {
        return {
            allowed: false,
            code: "DUPLICATE_SUBMISSION",
            message: `Travel response has already been submitted for the current approved transportation plan (Plan Version ${currentPlanVersion}). Please contact administrator to reset your response.`,
            planVersion: currentPlanVersion
        };
    }

    // 3. Check whether student submitted Coming after current plan was generated and approved
    const responseTime = responseSubmittedAt instanceof Date ? responseSubmittedAt.getTime() : new Date(responseSubmittedAt).getTime();
    const planApprovalTime = resolvedPlan?.approvedAt ? new Date(resolvedPlan.approvedAt).getTime() : 0;
    const isSubmittedAfterPlanApproval = planApprovalTime > 0 && responseTime > planApprovalTime;
    const isLate = travelStatus === "Coming" && isSubmittedAfterPlanApproval;

    return {
        allowed: true,
        isLate,
        isAllocated: false,
        activePlan: resolvedPlan,
        planVersion: currentPlanVersion,
        approvalEventId: currentApprovalEventId
    };
};
