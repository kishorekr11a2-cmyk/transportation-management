import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import AiPlan from "../models/AiPlan.js";
import LateResponseEvent from "../models/LateResponseEvent.js";
import Route from "../models/Route.js";
import { isDbConnected } from "../config/db.js";
import { getUserAllocatedBus } from "../services/aiAgentService.js";
import {
    generateLateResponseEventKey as lifecycleGenerateEventKey,
    getCurrentApprovedPlan,
    createLateResponseEvent as lifecycleCreateLateResponseEvent,
    resolveLateResponsesForPreviousPlan,
    getActiveLateResponses as lifecycleGetActiveLateResponses
} from "../services/lateResponseLifecycleService.js";
import {
    getCurrentStudentTransportStatus,
    batchCalculateStudentTransportStatuses,
    validateStudentResponse,
    getActiveAllocationForStudent,
    getActiveApprovedPlans,
    clearActiveApprovedPlansCache
} from "../services/studentTransportStatusService.js";

/**
 * Generate stable unique event key for late response event deduplication
 * Identity: studentId + direction + responseTime + planApprovalTime (or eventId)
 */
export const generateLateResponseEventKey = (userId, direction, responseTimeOrEventId, planApprovalTimeOrVersion) => {
    return lifecycleGenerateEventKey(userId, direction, responseTimeOrEventId, planApprovalTimeOrVersion);
};

const dbUnavailableResponse = (res) => {
    return res.status(503).json({
        success: false,
        code: "DATABASE_UNAVAILABLE",
        message: "Database is currently unavailable."
    });
};

// =====================================================
// ADMIN LOGIN
// =====================================================

export const adminLogin = async (req, res) => {
    if (!isDbConnected()) {
        return dbUnavailableResponse(res);
    }

    try {
        const { userId, password } = req.body;

        if (!userId || !password) {
            return res.status(400).json({
                success: false,
                message: "All fields are required"
            });
        }

        const admin = await User.findOne({
            userId,
            role: "admin"
        }).select("userId name password role").lean();

        if (!admin) {
            return res.status(404).json({
                success: false,
                message: "Admin not found"
            });
        }

        // Check password (bcrypt compare or plain text fallback)
        let isMatch = password === admin.password;
        if (!isMatch && admin.password) {
            try {
                isMatch = await bcrypt.compare(password, admin.password);
            } catch {
                isMatch = false;
            }
        }

        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: "Invalid password"
            });
        }

        const token = jwt.sign(
            {
                id: admin._id,
                role: admin.role
            },
            process.env.JWT_SECRET || "default_jwt_secret",
            {
                expiresIn: "1d"
            }
        );

        res.json({
            success: true,
            message: "Admin Login Successful",
            token,
            user: {
                userId: admin.userId,
                name: admin.name,
                role: admin.role
            }
        });
    } catch (error) {
        console.error("Admin Login Error:", error.message);
        if (error.name === "MongooseError" || error.message?.includes("buffering") || !isDbConnected()) {
            return dbUnavailableResponse(res);
        }
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// =====================================================
// STUDENT / USER LOGIN
// =====================================================

export const studentLogin = async (req, res) => {
    if (!isDbConnected()) {
        return dbUnavailableResponse(res);
    }

    try {
        const { userId, password } = req.body;

        if (!userId || !password) {
            return res.status(400).json({
                success: false,
                message: "All fields are required"
            });
        }

        const student = await User.findOne({
            userId,
            role: "student"
        }).select("userId name password stoppings travelStatus role allocatedBus").lean();

        if (!student) {
            return res.status(404).json({
                success: false,
                message: "Student not found"
            });
        }

        // Student password can be student.password or student.name (from Excel import)
        let isMatch = password === student.password || password === student.name;
        if (!isMatch && student.password) {
            try {
                isMatch = await bcrypt.compare(password, student.password);
            } catch {
                isMatch = false;
            }
        }

        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: "Invalid password"
            });
        }

        const token = jwt.sign(
            {
                id: student._id,
                role: student.role
            },
            process.env.JWT_SECRET || "default_jwt_secret",
            {
                expiresIn: "1d"
            }
        );

        const allocatedBus = await getUserAllocatedBus(student);

        res.json({
            success: true,
            message: "Student Login Successful",
            token,
            user: {
                userId: student.userId,
                name: student.name,
                stoppings: student.stoppings,
                travelStatus: student.travelStatus,
                role: student.role,
                allocatedBus
            }
        });
    } catch (error) {
        console.error("Student Login Error:", error.message);
        if (error.name === "MongooseError" || error.message?.includes("buffering") || !isDbConnected()) {
            return dbUnavailableResponse(res);
        }
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// =====================================================
// GET ALL STUDENTS
// =====================================================

export const getUsers = async (req, res) => {
    if (!isDbConnected()) {
        return dbUnavailableResponse(res);
    }

    const tStart = Date.now();
    try {
        const users = await User.find({
            role: "student"
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
                assignedVehicle: 1,
                assignedRoute: 1,
                allocationStatus: 1,
                lateResponse: 1,
                lateResponseDetected: 1,
                isLateResponse: 1,
                lateResponseAt: 1,
                travelResponseSubmittedAt: 1,
                lastTravelResponseAt: 1,
                previousTravelStatus: 1,
                requiresReallocation: 1,
                affectedDirections: 1,
                approvedPlanType: 1,
                manualRouteId: 1,
                manualBusId: 1,
                routeId: 1,
                busId: 1,
                approvalStatus: 1,
                manualAllocation: 1,
                createdAt: 1,
                "allocatedBus.isAllocated": 1,
                "allocatedBus.vehicleName": 1,
                "allocatedBus.vehicleNumber": 1,
                "allocatedBus.routeCode": 1,
                "allocatedBus.routeName": 1,
                "allocatedBus.seatNumber": 1,
                "allocatedBus.direction": 1,
                "allocatedBus.allocationStatus": 1,
                "allocatedBus.requiresReallocation": 1,
                "allocatedBus.affectedDirections": 1,
                "allocatedBus.message": 1,
                "allocatedBus.adminApprovalStatus": 1,
                "allocatedBus.inward.isAllocated": 1,
                "allocatedBus.inward.vehicleName": 1,
                "allocatedBus.inward.vehicleNumber": 1,
                "allocatedBus.inward.routeCode": 1,
                "allocatedBus.inward.routeName": 1,
                "allocatedBus.inward.allocationStatus": 1,
                "allocatedBus.outward.isAllocated": 1,
                "allocatedBus.outward.vehicleName": 1,
                "allocatedBus.outward.vehicleNumber": 1,
                "allocatedBus.outward.routeCode": 1,
                "allocatedBus.outward.routeName": 1,
                "allocatedBus.outward.allocationStatus": 1
            })
            .lean()
            .sort({ createdAt: -1 });

        // Compute common authoritative transport status for every student
        const calculatedUsers = await batchCalculateStudentTransportStatuses(users);

        console.log(`[PERFORMANCE] users API query: ${Date.now() - tStart} ms`);
        res.status(200).json(calculatedUsers);
    } catch (error) {
        console.error("Get Users Error:", error.message);
        if (!isDbConnected()) return dbUnavailableResponse(res);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// =====================================================
// HELPER: RESOLVE ACTIVE APPROVED PLANS & ALLOCATIONS
// =====================================================

export const resolveActiveApprovedPlans = async () => {
    const plans = {
        INWARD: {
            isApproved: false,
            planType: null,
            planId: null,
            planVersion: 1,
            approvalEventId: null,
            approvedAt: null,
            allocatedUserIds: new Set()
        },
        OUTWARD: {
            isApproved: false,
            planType: null,
            planId: null,
            planVersion: 1,
            approvalEventId: null,
            approvedAt: null,
            allocatedUserIds: new Set()
        }
    };

    if (!isDbConnected() || !mongoose.connection?.db) {
        return plans;
    }

    try {
        const active = await getActiveApprovedPlans();
        if (active?.INWARD) {
            plans.INWARD = {
                ...active.INWARD,
                allocatedUserIds: active.INWARD.allocatedUserIds || new Set()
            };
        }
        if (active?.OUTWARD) {
            plans.OUTWARD = {
                ...active.OUTWARD,
                allocatedUserIds: active.OUTWARD.allocatedUserIds || new Set()
            };
        }
    } catch (err) {
        console.error("Error resolving active approved plans:", err);
    }

    return plans;
};

// =====================================================
// GET LATE TRAVEL RESPONSES (ADMIN ONLY)
// =====================================================

export const getLateResponses = async (req, res) => {
    if (!isDbConnected()) {
        return dbUnavailableResponse(res);
    }

    try {
        // 1. Authoritative check: Fetch active late response events from LateResponseEvent collection
        const activeLifecycle = await lifecycleGetActiveLateResponses();
        if (activeLifecycle && activeLifecycle.count > 0) {
            return res.status(200).json(activeLifecycle);
        }

        // 2. Fallback check for unseeded environments / tests where LateResponseEvent collection is empty:
        // Query students who have travelStatus === 'Coming' and late response flags set
        const students = await User.find({
            role: "student",
            travelStatus: "Coming",
            $or: [
                { lateResponse: true },
                { isLateResponse: true },
                { lateResponseDetected: true }
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
                lateResponse: 1,
                isLateResponse: 1,
                lateResponseDetected: 1,
                lateResponseAt: 1,
                lateResponseNotifiedEventKeys: 1,
                lateResponseNotifiedAt: 1,
                travelResponseSubmittedAt: 1,
                lastTravelResponseAt: 1,
                requiresReallocation: 1,
                assignedVehicle: 1,
                assignedRoute: 1,
                allocatedBus: 1
            })
            .lean()
            .sort({ lateResponseAt: -1, travelResponseSubmittedAt: -1, createdAt: -1 });

        const qualifyingLateStudents = students
            .filter((student) => {
                // Rule 15 & User Directive: An already assigned / allocated student is NOT a late response
                const isAlreadyAllocated = Boolean(
                    student.assignedVehicle ||
                    student.allocatedBus?.isAllocated ||
                    student.allocatedBus?.vehicleName ||
                    student.allocatedBus?.inward?.isAllocated ||
                    student.allocatedBus?.outward?.isAllocated ||
                    student.allocationStatus === "Assigned" ||
                    student.allocationStatus === "Re-assigned"
                );
                return !isAlreadyAllocated;
            })
            .map((student) => {
                const responseTime = student.lateResponseAt || student.travelResponseSubmittedAt || student.lastTravelResponseAt || new Date();
                const eventKey = generateLateResponseEventKey(student.userId, responseTime);
                return {
                    ...student,
                    travelStatus: "Coming",
                    currentTravelStatus: "Coming",
                    previousTravelStatus: student.previousTravelStatus || "Pending",
                    allocationStatus: "Unallocated",
                    lateResponse: true,
                    isLateResponse: true,
                    lateResponseDetected: true,
                    requiresReallocation: true,
                    responseSubmittedAt: responseTime,
                    responseSubmittedTime: responseTime,
                    eventKey,
                    eventKeys: [eventKey],
                    isNotified: false,
                    isUnnotified: true,
                    busName: "Not Assigned",
                    routeName: "—",
                    seatNumber: "—",
                    currentActionStatus: "Awaiting Manual Route Assignment"
                };
            });

        // NOTE: Strictly READ-ONLY! User Rule 13:
        // "Do not let dashboard polling, page loading, refresh, or background API calls modify the student’s travel status or allocation."

        const count = qualifyingLateStudents.length;
        const unnotifiedCount = qualifyingLateStudents.filter((u) => u.isUnnotified).length;
        const uniqueUnnotifiedKeys = qualifyingLateStudents.map((u) => u.eventKey).filter(Boolean);

        return res.status(200).json({
            success: true,
            count,
            lateComingResponsesCount: count,
            pendingReallocationUsersCount: count,
            unnotifiedCount,
            unnotifiedEventKeys: uniqueUnnotifiedKeys,
            lateResponses: qualifyingLateStudents,
            users: qualifyingLateStudents,
            summary: {
                lateComingResponsesCount: count,
                pendingReallocationUsersCount: count,
                totalLateResponses: count
            }
        });
    } catch (error) {
        console.error("Get Late Responses Error:", error.message);
        if (!isDbConnected()) return dbUnavailableResponse(res);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// =====================================================
// ACKNOWLEDGE LATE RESPONSE NOTIFICATIONS (ADMIN ONLY)
// Persists notification state to MongoDB so notification appears only once
// =====================================================

export const acknowledgeLateNotifications = async (req, res) => {
    if (!isDbConnected()) {
        return dbUnavailableResponse(res);
    }

    try {
        const { eventKeys, direction, userIds } = req.body || {};
        const now = new Date();

        let keysToAcknowledge = Array.isArray(eventKeys) ? eventKeys.filter(Boolean) : [];

        // If no explicit eventKeys provided, dynamically resolve unnotified keys
        if (keysToAcknowledge.length === 0) {
            const approvedPlans = await resolveActiveApprovedPlans();
            const filter = { role: "student", travelStatus: "Coming" };
            if (Array.isArray(userIds) && userIds.length > 0) {
                filter.$or = [
                    { userId: { $in: userIds } },
                    { _id: { $in: userIds.filter((id) => mongoose.Types.ObjectId.isValid(id)) } }
                ];
            }
            const students = await User.find(filter)
                .select("userId travelResponseSubmittedAt lastTravelResponseAt lateResponseAt affectedDirections lateResponseNotifiedEventKeys")
                .lean();

            for (const student of students) {
                const responseTime = new Date(
                    student.travelResponseSubmittedAt ||
                    student.lastTravelResponseAt ||
                    student.lateResponseAt ||
                    student.createdAt
                );
                const dirs = (student.affectedDirections && student.affectedDirections.length > 0)
                    ? student.affectedDirections
                    : ["OUTWARD", "INWARD"];

                for (const dir of dirs) {
                    if (direction && String(direction).toUpperCase().trim() !== dir) continue;
                    const planTime = approvedPlans[dir]?.approvedAt || null;
                    const key = generateLateResponseEventKey(student.userId || student._id, dir, responseTime, planTime);
                    if (!student.lateResponseNotifiedEventKeys?.includes(key)) {
                        keysToAcknowledge.push(key);
                    }
                }
            }
        }

        if (keysToAcknowledge.length === 0) {
            return res.status(200).json({
                success: true,
                message: "No unnotified late response events found to acknowledge.",
                acknowledgedCount: 0
            });
        }

        // Extract student identifiers from event keys (format: lr_${userId}_${dir}_${rTime}_${pTime})
        const targetUserIds = [];
        for (const k of keysToAcknowledge) {
            const parts = k.split("_");
            if (parts.length >= 2 && parts[1]) {
                targetUserIds.push(parts[1]);
            }
        }

        // 1. Atomically update User records to append acknowledged event keys (case-insensitive for userId)
        const regexUserIds = targetUserIds.map((id) => new RegExp(`^${id}$`, "i"));
        const userUpdateFilter = targetUserIds.length > 0
            ? {
                role: "student",
                $or: [
                    { userId: { $in: targetUserIds } },
                    { userId: { $in: regexUserIds } },
                    { _id: { $in: targetUserIds.filter((id) => mongoose.Types.ObjectId.isValid(id)) } }
                ]
            }
            : { role: "student" };

        await User.updateMany(userUpdateFilter, {
            $addToSet: { lateResponseNotifiedEventKeys: { $each: keysToAcknowledge } },
            $set: { lateResponseNotifiedAt: now }
        });

        // 2. Update or insert into LateResponseEvent collection for auditing
        try {
            const bulkOps = keysToAcknowledge.map((key) => {
                const parts = key.split("_");
                const uId = parts[1] || "unknown";
                const dir = parts[2] || "OUTWARD";
                const rTime = parts[3] && !isNaN(Number(parts[3])) ? new Date(Number(parts[3])) : now;
                const pTime = parts[4] && !isNaN(Number(parts[4])) ? new Date(Number(parts[4])) : null;

                return {
                    updateOne: {
                        filter: { eventKey: key },
                        update: {
                            $set: {
                                isNotified: true,
                                isLateResponse: true,
                                notifiedAt: now,
                                updatedAt: now
                            },
                            $setOnInsert: {
                                eventKey: key,
                                userId: uId,
                                direction: dir,
                                responseTimestamp: rTime,
                                responseSubmittedAt: rTime,
                                planApprovedAt: pTime,
                                isLateResponse: true,
                                status: "ACTIVE",
                                isNotified: true,
                                notifiedAt: now,
                                createdAt: now
                            }
                        },
                        upsert: true
                    }
                };
            });

            if (bulkOps.length > 0) {
                await LateResponseEvent.bulkWrite(bulkOps, { ordered: false });
            }
        } catch (eventErr) {
            console.warn("LateResponseEvent update warning:", eventErr.message);
        }

        return res.status(200).json({
            success: true,
            message: `Successfully acknowledged ${keysToAcknowledge.length} late travel response notification(s).`,
            acknowledgedCount: keysToAcknowledge.length,
            acknowledgedKeys: keysToAcknowledge
        });
    } catch (error) {
        console.error("Acknowledge Late Notifications Error:", error);
        return res.status(500).json({
            success: false,
            message: error.message || "Failed to acknowledge late notifications."
        });
    }
};

// =====================================================
// GET LOGGED-IN USER
// =====================================================

export const getCurrentUser = async (req, res) => {
    if (!isDbConnected()) {
        return dbUnavailableResponse(res);
    }

    try {
        const user = await User.findById(req.user.id).select("-password").lean();

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        const calculated = await getCurrentStudentTransportStatus(user);

        res.status(200).json({
            success: true,
            user: calculated,
            travelStatus: calculated.travelStatus,
            allocationStatus: calculated.allocationStatus,
            allocatedBus: calculated.allocatedBus,
            route: calculated.allocatedRoute,
            planVersion: calculated.activePlanVersion || 1,
            planId: calculated.planId,
            isAllocated: calculated.isAllocated,
            isSubmissionLocked: calculated.submissionLocked,
            activePlan: calculated.activePlan
        });
    } catch (error) {
        console.error("Get Current User Error:", error.message);
        if (!isDbConnected()) return dbUnavailableResponse(res);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// =====================================================
// GET USER ALLOCATED BUS DIRECTLY
// =====================================================

export const getUserAllocation = async (req, res) => {
    if (!isDbConnected()) {
        return dbUnavailableResponse(res);
    }

    try {
        const user = await User.findById(req.user.id).select("-password").lean();

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        const calculated = await getCurrentStudentTransportStatus(user);

        res.status(200).json({
            success: true,
            allocatedBus: calculated.allocatedBus,
            travelStatus: calculated.travelStatus,
            allocationStatus: calculated.allocationStatus,
            route: calculated.allocatedRoute,
            planVersion: calculated.activePlanVersion || 1,
            planId: calculated.planId,
            isAllocated: calculated.isAllocated,
            isSubmissionLocked: calculated.submissionLocked,
            activePlan: calculated.activePlan,
            user: calculated
        });
    } catch (error) {
        console.error("Get User Allocation Error:", error.message);
        if (!isDbConnected()) return dbUnavailableResponse(res);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// =====================================================
// UPDATE TRAVEL STATUS (STUDENT / USER ONLY)
// =====================================================

export const updateTravelStatus = async (req, res) => {
    if (!isDbConnected()) {
        return dbUnavailableResponse(res);
    }

    try {
        const { travelStatus } = req.body;
        const allowedStatuses = ["Coming", "Not Coming"];

        if (!allowedStatuses.includes(travelStatus)) {
            return res.status(400).json({
                success: false,
                message: "Invalid travel status. Only 'Coming' or 'Not Coming' can be submitted."
            });
        }

        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        if (user.role !== "student") {
            return res.status(403).json({
                success: false,
                message: "Only users can update travel status"
            });
        }

        const previousTravelStatus = user.travelStatus || "Pending";
        const responseSubmittedAt = new Date();

        // Helper to format clean user payload for instant frontend hydration
        const buildSanitizedUser = (u) => {
            const isLateResponse = Boolean(
                u.travelStatus === "Coming" &&
                (Boolean(u.isLateResponse) || Boolean(u.lateResponseDetected) || u.allocationStatus === "Pending Reallocation" || Boolean(u.requiresReallocation))
            );
            const isAllocated = !isLateResponse && Boolean(
                u.travelStatus === "Coming" &&
                (u.isAllocated === true || u.allocationStatus === "Assigned" || u.allocationStatus === "Re-assigned") &&
                (u.allocatedBus?.isAllocated || u.assignedVehicle || u.manualBusId)
            );
            const isUnallocated = !isAllocated;
            const effectiveAllocationStatus = isLateResponse
                ? "Unallocated"
                : (isAllocated ? (u.allocationStatus || "Assigned") : "Unallocated");
            const unallocatedCategory = (isLateResponse && isUnallocated)
                ? "LATE_RESPONSE_UNALLOCATED" // TYPE 1: Late Coming, unallocated, requires admin review
                : (isUnallocated ? "NORMAL_UNALLOCATED" : null); // TYPE 2: Normal Coming, unallocated due to capacity/vehicle availability

            return {
                _id: u._id,
                userId: u.userId,
                name: u.name,
                email: u.email,
                role: u.role,
                stoppings: u.stoppings,
                city: u.city,
                district: u.district,
                state: u.state,
                country: u.country,
                travelStatus: u.travelStatus,
                allocationStatus: effectiveAllocationStatus,
                assignedVehicle: isAllocated ? u.assignedVehicle : null,
                assignedRoute: isAllocated ? u.assignedRoute : null,
                allocatedBus: isAllocated ? u.allocatedBus : null,
                lateResponse: isLateResponse,
                isLateResponse,
                lateResponseDetected: isLateResponse,
                approvedPlanType: u.approvedPlanType,
                manualRouteId: isAllocated ? u.manualRouteId : null,
                manualBusId: isAllocated ? u.manualBusId : null,
                routeId: isAllocated ? u.routeId : null,
                busId: isAllocated ? u.busId : null,
                approvalStatus: u.approvalStatus,
                lateResponseAt: u.lateResponseAt,
                travelResponseSubmittedAt: u.travelResponseSubmittedAt,
                lastTravelResponseAt: u.lastTravelResponseAt,
                previousTravelStatus: u.previousTravelStatus,
                requiresReallocation: u.requiresReallocation,
                affectedDirections: u.affectedDirections,
                isAllocated,
                isUnallocated,
                unallocatedCategory
            };
        };

        const approvedPlans = await resolveActiveApprovedPlans();
        const activeApprovedPlan = approvedPlans.OUTWARD.isApproved ? approvedPlans.OUTWARD : (approvedPlans.INWARD.isApproved ? approvedPlans.INWARD : null);
        const currentPlanVersion = (activeApprovedPlan && typeof activeApprovedPlan.planVersion === "number") ? activeApprovedPlan.planVersion : (activeApprovedPlan ? 1 : null);
        const currentApprovalEventId = activeApprovedPlan ? activeApprovedPlan.approvalEventId : null;

        const sId = String(user.userId || "").toLowerCase().trim();
        const sMongoId = String(user._id || "").toLowerCase().trim();

        // 1. Check if student is already allocated in an active approved plan (e.g. Step 8 after Plan Version 2 approval)
        // Common response validation: enforces 1 student + 1 plan version = 1 response only
        const validation = await validateStudentResponse({
            user,
            activePlan: activeApprovedPlan,
            travelStatus,
            responseSubmittedAt
        });

        if (!validation.allowed) {
            return res.status(400).json({
                success: false,
                code: validation.code,
                message: validation.message,
                travelStatus: user.travelStatus,
                allocationStatus: user.allocationStatus,
                responseLocked: true,
                planVersion: currentPlanVersion || 1
            });
        }

        // =====================================================
        // CASE 1: Student selects "Not Coming"
        // =====================================================
        if (travelStatus === "Not Coming") {
            user.previousTravelStatus = previousTravelStatus;
            user.travelStatus = "Not Coming";
            user.travelResponseSubmittedAt = responseSubmittedAt;
            user.lastTravelResponseAt = responseSubmittedAt;
            user.submittedPlanVersion = currentPlanVersion;
            user.submittedApprovalEventId = currentApprovalEventId;
            user.allocationStatus = "Not Assigned";
            user.assignedVehicle = null;
            user.assignedRoute = null;
            user.allocatedBus = null;
            user.lateResponseDetected = false;
            user.isLateResponse = false;
            user.lateResponseAt = null;
            user.requiresReallocation = false;
            user.affectedDirections = [];
            await user.save();

            // Resolve any existing un-resolved late response events for this user
            try {
                await LateResponseEvent.updateMany(
                    { userId: String(user.userId || ""), status: { $nin: ["RESOLVED", "ALLOCATED"] } },
                    { $set: { status: "RESOLVED", resolvedAt: new Date(), updatedAt: new Date(), resolutionReason: "Changed status to Not Coming" } }
                );
            } catch (lreErr) {
                console.warn("LateResponseEvent resolve on Not Coming warning:", lreErr.message);
            }

            return res.status(200).json({
                success: true,
                message: "Travel status updated successfully. No bus seat will be reserved.",
                travelStatus: user.travelStatus,
                allocationStatus: user.allocationStatus,
                lateResponse: false,
                isLateResponse: false,
                user: buildSanitizedUser(user)
            });
        }

        // =====================================================
        // CASE 2: Student selects "Coming"
        // =====================================================
        user.travelResponseSubmittedAt = responseSubmittedAt;
        user.lastTravelResponseAt = responseSubmittedAt;

        const hasApprovedPlan = Boolean(approvedPlans.INWARD.isApproved || approvedPlans.OUTWARD.isApproved);
        const latestApprovalTime = Math.max(
            approvedPlans.INWARD?.approvedAt ? new Date(approvedPlans.INWARD.approvedAt).getTime() : 0,
            approvedPlans.OUTWARD?.approvedAt ? new Date(approvedPlans.OUTWARD.approvedAt).getTime() : 0
        );

        // Sub-case A: No plan has been approved yet (normal student, not late)
        if (!hasApprovedPlan) {
            user.travelStatus = "Coming";
            user.allocationStatus = "Unallocated";
            user.assignedVehicle = null;
            user.assignedRoute = null;
            user.allocatedBus = null;
            user.lateResponse = false;
            user.isLateResponse = false;
            user.lateResponseDetected = false;
            user.lateResponseAt = null;
            user.requiresReallocation = false;
            user.affectedDirections = [];
            user.submittedPlanVersion = 0;
            user.submittedApprovalEventId = null;
            await user.save();

            return res.status(200).json({
                success: true,
                message: "Travel response submitted. Awaiting transportation plan generation and approval.",
                travelStatus: user.travelStatus,
                allocationStatus: user.allocationStatus,
                lateResponse: false,
                isLateResponse: false,
                user: buildSanitizedUser(user)
            });
        }

        // Sub-case B: A transportation plan is approved!
        // Check if student was included in the approved plan by matching unique userId or MongoDB _id
        const isAllocatedInApprovedPlan = Boolean(
            approvedPlans.INWARD?.allocatedUserIds?.has(sId) ||
            approvedPlans.INWARD?.allocatedUserIds?.has(sMongoId) ||
            approvedPlans.OUTWARD?.allocatedUserIds?.has(sId) ||
            approvedPlans.OUTWARD?.allocatedUserIds?.has(sMongoId) ||
            (user.allocatedBus?.isAllocated && (user.allocatedBus.approved === true || user.allocatedBus.adminApprovalStatus === "Approved")) ||
            (user.allocatedBus?.inward?.isAllocated && (user.allocatedBus.inward.approved === true || user.allocatedBus.inward.adminApprovalStatus === "Approved")) ||
            (user.allocatedBus?.outward?.isAllocated && (user.allocatedBus.outward.approved === true || user.allocatedBus.outward.adminApprovalStatus === "Approved"))
        );

        const isSubmittedAfterPlanApproval = latestApprovalTime > 0 && (responseSubmittedAt.getTime() > latestApprovalTime);

        // Rule 3: If student submits Coming after approved plan, and that student was not included in the approved plan:
        // Mark student as:
        // * travelStatus: Coming
        // * allocationStatus: Unallocated
        // * lateResponse: true
        if (isSubmittedAfterPlanApproval && !isAllocatedInApprovedPlan) {
            console.log("[LATE RESPONSE DETECTED]", {
                userId: user.userId,
                responseSubmittedAt: responseSubmittedAt.toISOString(),
                planApprovedAt: new Date(latestApprovalTime).toISOString()
            });

            user.travelStatus = "Coming";
            user.allocationStatus = "Unallocated";
            user.lateResponse = true;
            user.isLateResponse = true;
            user.lateResponseDetected = true;
            user.lateResponseAt = responseSubmittedAt;
            user.previousTravelStatus = previousTravelStatus;
            user.requiresReallocation = true;
            user.affectedDirections = [];
            user.submittedPlanVersion = currentPlanVersion;
            user.submittedApprovalEventId = currentApprovalEventId;
            user.isAllocated = false;
            user.isUnallocated = true;
            user.allocatedBus = null;
            user.assignedVehicle = null;
            user.assignedRoute = null;
            user.allocatedVehicle = null;
            user.allocatedRoute = null;
            user.manualRouteId = null;
            user.manualBusId = null;
            user.routeId = null;
            user.busId = null;

            const eventKey = generateLateResponseEventKey(user.userId, currentApprovalEventId, latestApprovalTime);
            user.lateResponseEventId = eventKey;
            await user.save();

            // Create or update single LateResponseEvent
            try {
                await LateResponseEvent.updateOne(
                    {
                        $or: [
                            { eventKey },
                            { userId: String(user.userId || ""), approvalEventId: currentApprovalEventId, status: "ACTIVE" }
                        ]
                    },
                    {
                        $set: {
                            status: "ACTIVE",
                            isLateResponse: true,
                            planVersion: currentPlanVersion || 1,
                            approvalEventId: currentApprovalEventId,
                            responseSubmittedAt,
                            updatedAt: new Date()
                        },
                        $setOnInsert: {
                            eventKey,
                            userId: String(user.userId || ""),
                            planId: activeApprovedPlan?.planId || null,
                            planVersion: currentPlanVersion || 1,
                            approvalEventId: currentApprovalEventId,
                            direction: null,
                            previousTravelStatus: previousTravelStatus || "Pending",
                            currentTravelStatus: "Coming",
                            responseTimestamp: responseSubmittedAt,
                            responseSubmittedAt,
                            planApprovedAt: latestApprovalTime ? new Date(latestApprovalTime) : null,
                            planType: activeApprovedPlan?.planType || "AI",
                            isLateResponse: true,
                            status: "ACTIVE",
                            isNotified: false,
                            createdAt: new Date()
                        }
                    },
                    { upsert: true }
                );
            } catch (lreErr) {
                console.error("[LATE RESPONSE ERROR] Failed to upsert LateResponseEvent:", lreErr.message);
            }

            // Mark plan as requiring review
            const planReviewUpdate = {
                $set: {
                    requiresReview: true,
                    hasLateResponses: true,
                    pendingReallocation: true,
                    lastLateResponseAt: responseSubmittedAt
                }
            };
            try {
                await AiPlan.updateMany({ active: true, isApproved: true }, planReviewUpdate);
                if (mongoose.connection?.db) {
                    await mongoose.connection.db.collection("ai_selected_plans").updateMany({ active: true, approved: true }, planReviewUpdate);
                }
            } catch (planErr) {
                console.warn("Plan review update warning:", planErr.message);
            }

            return res.status(200).json({
                success: true,
                message: "Travel response recorded as Coming. Transportation allocation is pending administrator manual route assignment.",
                travelStatus: user.travelStatus,
                allocationStatus: user.allocationStatus,
                isAllocated: false,
                isUnallocated: true,
                lateResponse: true,
                isLateResponse: true,
                lateResponseDetected: true,
                planVersion: currentPlanVersion,
                approvalEventId: currentApprovalEventId,
                responseSubmittedAt,
                lateResponseEventKey: eventKey,
                user: buildSanitizedUser(user)
            });
        }

        // Student was already included in the approved plan or submitted before approval
        user.travelStatus = "Coming";
        user.lateResponse = false;
        user.lateResponseDetected = false;
        user.isLateResponse = false;
        user.lateResponseAt = null;
        user.requiresReallocation = false;
        user.affectedDirections = [];
        user.submittedPlanVersion = currentPlanVersion;
        user.submittedApprovalEventId = currentApprovalEventId;
        user.allocationStatus = isAllocatedInApprovedPlan ? "Assigned" : "Unallocated";
        user.isAllocated = isAllocatedInApprovedPlan;
        user.isUnallocated = !isAllocatedInApprovedPlan;
        await user.save();

        return res.status(200).json({
            success: true,
            message: "Travel status updated successfully.",
            travelStatus: user.travelStatus,
            allocationStatus: user.allocationStatus,
            lateResponse: false,
            isLateResponse: false,
            isAllocated: user.isAllocated,
            isUnallocated: user.isUnallocated,
            user: buildSanitizedUser(user)
        });
    } catch (error) {
        console.error("Update Travel Status Error:", error.message);
        if (!isDbConnected()) return dbUnavailableResponse(res);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// =====================================================
// =====================================================
// HELPER: REMOVE SINGLE STUDENT FROM ACTIVE PLANS
// =====================================================
export const removeStudentFromActivePlans = async ({ userId, mongoId }) => {
    if (!mongoose.connection?.db) return;

    const uId = userId ? String(userId).toLowerCase().trim() : "";
    const mId = mongoId ? String(mongoId).toLowerCase().trim() : "";
    if (!uId && !mId) return;

    // Use unique userId or mongoId only — never student name
    const matchesUser = (item) => {
        if (!item) return false;
        if (typeof item === "string") {
            const s = item.toLowerCase().trim();
            return (uId && s === uId) || (mId && s === mId);
        }
        if (typeof item === "object") {
            const candId = String(item.userId || item._id || item.id || "").toLowerCase().trim();
            return (uId && candId === uId) || (mId && candId === mId);
        }
        return false;
    };

    const cleanBusList = (buses) => {
        if (!Array.isArray(buses)) return { buses, changed: false };
        let anyBusChanged = false;
        for (const bus of buses) {
            let busModified = false;
            if (Array.isArray(bus.users)) {
                const prevLen = bus.users.length;
                bus.users = bus.users.filter((u) => !matchesUser(u));
                if (bus.users.length !== prevLen) busModified = true;
            }
            if (Array.isArray(bus.allocatedStudents)) {
                const prevLen = bus.allocatedStudents.length;
                bus.allocatedStudents = bus.allocatedStudents.filter((u) => !matchesUser(u));
                if (bus.allocatedStudents.length !== prevLen) busModified = true;
            }
            if (Array.isArray(bus.passengers)) {
                const prevLen = bus.passengers.length;
                bus.passengers = bus.passengers.filter((u) => !matchesUser(u));
                if (bus.passengers.length !== prevLen) busModified = true;
            }
            if (Array.isArray(bus.assignedUsers)) {
                const prevLen = bus.assignedUsers.length;
                bus.assignedUsers = bus.assignedUsers.filter((u) => !matchesUser(u));
                if (bus.assignedUsers.length !== prevLen) busModified = true;
            }
            if (Array.isArray(bus.stops)) {
                for (const st of bus.stops) {
                    if (Array.isArray(st.userIds)) {
                        const prevLen = st.userIds.length;
                        st.userIds = st.userIds.filter((id) => !matchesUser(id));
                        if (st.userIds.length !== prevLen) busModified = true;
                    }
                    if (Array.isArray(st.users)) {
                        const prevLen = st.users.length;
                        st.users = st.users.filter((u) => !matchesUser(u));
                        if (st.users.length !== prevLen) busModified = true;
                    }
                    if (Array.isArray(st.students)) {
                        const prevLen = st.students.length;
                        st.students = st.students.filter((u) => !matchesUser(u));
                        if (st.students.length !== prevLen) busModified = true;
                    }
                }
            }
            if (busModified) {
                anyBusChanged = true;
                const count = (bus.users || bus.allocatedStudents || bus.passengers || []).length;
                bus.assignedUsersCount = count;
                if (bus.capacity) {
                    bus.remainingSeats = Math.max(0, bus.capacity - count);
                }
            }
        }
        return { buses, changed: anyBusChanged };
    };

    try {
        const p1 = (async () => {
            const selectedDocs = await mongoose.connection.db.collection("ai_selected_plans").find({
                $or: [{ active: true }, { status: "active" }, { approved: true }]
            }).toArray();

            const updates = [];
            for (const doc of selectedDocs) {
                let modified = false;
                if (doc.plan?.buses) {
                    const res = cleanBusList(doc.plan.buses);
                    if (res.changed) {
                        doc.plan.buses = res.buses;
                        modified = true;
                    }
                }
                if (doc.plan?.routes) {
                    const res = cleanBusList(doc.plan.routes);
                    if (res.changed) {
                        doc.plan.routes = res.buses;
                        modified = true;
                    }
                }
                if (doc.buses) {
                    const res = cleanBusList(doc.buses);
                    if (res.changed) {
                        doc.buses = res.buses;
                        modified = true;
                    }
                }
                if (doc.routes) {
                    const res = cleanBusList(doc.routes);
                    if (res.changed) {
                        doc.routes = res.buses;
                        modified = true;
                    }
                }
                if (modified) {
                    updates.push(
                        mongoose.connection.db.collection("ai_selected_plans").updateOne(
                            { _id: doc._id },
                            { $set: { plan: doc.plan, buses: doc.buses, routes: doc.routes } }
                        )
                    );
                }
            }
            if (updates.length > 0) {
                await Promise.all(updates);
            }
        })();

        const p2 = (async () => {
            const aiPlanDocs = await AiPlan.find({ active: true }).lean();
            const updates = [];
            for (const doc of aiPlanDocs) {
                let buses = doc.buses || doc.routes;
                if (Array.isArray(buses)) {
                    const res = cleanBusList(buses);
                    if (res.changed) {
                        updates.push(AiPlan.updateOne({ _id: doc._id }, { $set: { buses: res.buses } }));
                    }
                }
            }
            if (updates.length > 0) {
                await Promise.all(updates);
            }
        })();

        await Promise.all([p1, p2]);
    } catch (err) {
        console.error("removeStudentFromActivePlans error:", err.message);
    }
};

// =====================================================
// GLOBAL RESET ALL USERS TRAVEL STATUS (ADMIN ONLY)
// =====================================================

export const resetAllUsersTravelStatus = async (req, res) => {
    if (!isDbConnected()) {
        return dbUnavailableResponse(res);
    }

    console.time("reset-total");
    try {
        const now = new Date();

        // Invariant: allocatedBus and allocation fields are completely removed via $unset without path conflict
        const resetSetFields = {
            travelStatus: "Pending",
            allocationStatus: "Unallocated",
            isAllocated: false,
            isUnallocated: true,
            lateResponse: false,
            lateResponseDetected: false,
            isLateResponse: false,
            approvedPlanType: null,
            approvalStatus: null,
            lateResponseAt: null,
            travelResponseSubmittedAt: null,
            lastTravelResponseAt: null,
            previousTravelStatus: null,
            requiresReallocation: false,
            affectedDirections: [],
            lateResponseNotifiedEventKeys: [],
            lateResponseNotifiedAt: null,
            lateResponseResolvedAt: null
        };

        const resetUnsetFields = {
            allocatedBus: 1,
            assignedVehicle: 1,
            assignedRoute: 1,
            manualRouteId: 1,
            manualBusId: 1,
            routeId: 1,
            busId: 1,
            vehicleId: 1,
            planVersion: 1,
            manualAllocation: 1,
            aiAllocation: 1,
            submittedPlanVersion: 1,
            submittedApprovalEventId: 1,
            lateResponseEventId: 1
        };

        // Stage 1: reset-all-users (Single bulk operation for all 400+ users)
        console.time("reset-all-users");
        const usersPromise = User.updateMany(
            { role: { $ne: "admin" } },
            {
                $set: resetSetFields,
                $unset: resetUnsetFields
            }
        ).then((res) => {
            console.timeEnd("reset-all-users");
            return res;
        });

        // Stage 2: reset-plans (Parallel bulk updates across all plan collections)
        console.time("reset-plans");
        const plansPromise = Promise.all([
            AiPlan.updateMany(
                {},
                {
                    $set: {
                        active: false,
                        status: "reset",
                        isApproved: false,
                        resetAt: now,
                        requiresReview: false,
                        hasLateResponses: false,
                        pendingReallocation: false,
                        affectedDirections: []
                    }
                }
            ),
            mongoose.connection.db ? mongoose.connection.db.collection("ai_selected_plans").updateMany(
                {},
                {
                    $set: {
                        active: false,
                        status: "reset",
                        approved: false,
                        resetAt: now,
                        requiresReview: false,
                        hasLateResponses: false,
                        pendingReallocation: false
                    }
                }
            ) : Promise.resolve(),
            mongoose.connection.db ? mongoose.connection.db.collection("manual_plan_submissions").updateMany(
                {},
                {
                    $set: {
                        isSubmitted: false,
                        status: "reset",
                        resetAt: now
                    }
                }
            ) : Promise.resolve(),
            mongoose.connection.db ? mongoose.connection.db.collection("late_response_drafts").deleteMany({}) : Promise.resolve()
        ]).then((res) => {
            console.timeEnd("reset-plans");
            return res;
        });

        // Stage 3: reset-routes (Deactivate routes)
        console.time("reset-routes");
        const routesPromise = Route.updateMany({}, { $set: { isSubmitted: false } })
            .then((res) => {
                console.timeEnd("reset-routes");
                return res;
            })
            .catch(() => {
                console.timeEnd("reset-routes");
                return null;
            });

        // Stage 4: reset-late-responses (Resolve late response events)
        console.time("reset-late-responses");
        const latePromise = LateResponseEvent.updateMany(
            { status: { $ne: "RESOLVED" } },
            {
                $set: {
                    status: "RESOLVED",
                    resolvedAt: now,
                    resolutionReason: "Admin reset travel status cycle"
                }
            }
        ).then((res) => {
            console.timeEnd("reset-late-responses");
            return res;
        }).catch(() => {
            console.timeEnd("reset-late-responses");
            return null;
        });

        // Execute all 4 stages concurrently in parallel
        const [userUpdateResult] = await Promise.all([
            usersPromise,
            plansPromise,
            routesPromise,
            latePromise
        ]);
        clearActiveApprovedPlansCache();

        console.timeEnd("reset-total");

        const totalStudents = userUpdateResult?.matchedCount || 0;
        const usersReset = userUpdateResult?.modifiedCount || totalStudents;

        res.status(200).json({
            success: true,
            message: "All student travel statuses and allocations were reset successfully.",
            totalUsers: totalStudents,
            usersReset: usersReset,
            allocationsRemoved: usersReset
        });
    } catch (error) {
        console.timeEnd("reset-total");
        console.error("Global Reset Users Travel Status Error:", error.message);
        if (!isDbConnected()) return dbUnavailableResponse(res);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// =====================================================
// RESET INDIVIDUAL USER TRAVEL STATUS (ADMIN ONLY)
// =====================================================

export const resetUserTravelStatus = async (req, res) => {
    if (!isDbConnected()) {
        return dbUnavailableResponse(res);
    }

    console.time("reset-one-total");
    try {
        const { userId } = req.params;

        if (!userId) {
            console.timeEnd("reset-one-total");
            return res.status(400).json({
                success: false,
                message: "User ID is required"
            });
        }

        // Find user by userId string or MongoDB _id
        const user = await User.findOne({
            $or: [
                { userId: userId },
                { _id: mongoose.Types.ObjectId.isValid(userId) ? userId : null }
            ].filter(Boolean)
        });

        if (!user) {
            console.timeEnd("reset-one-total");
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        // IDEMPOTENT ATOMIC RESET:
        // Reset travel status to initial Pending state and clear allocation & late response flags
        const resetSetFields = {
            travelStatus: "Pending",
            allocationStatus: "Unallocated",
            isAllocated: false,
            isUnallocated: true,
            lateResponse: false,
            lateResponseDetected: false,
            isLateResponse: false,
            approvedPlanType: null,
            approvalStatus: null,
            lateResponseAt: null,
            travelResponseSubmittedAt: null,
            lastTravelResponseAt: null,
            previousTravelStatus: null,
            requiresReallocation: false,
            affectedDirections: [],
            lateResponseNotifiedEventKeys: [],
            lateResponseNotifiedAt: null,
            lateResponseResolvedAt: null
        };

        const resetUnsetFields = {
            allocatedBus: 1,
            assignedVehicle: 1,
            assignedRoute: 1,
            manualRouteId: 1,
            manualBusId: 1,
            routeId: 1,
            busId: 1,
            vehicleId: 1,
            planVersion: 1,
            manualAllocation: 1,
            aiAllocation: 1,
            submittedPlanVersion: 1,
            submittedApprovalEventId: 1,
            lateResponseEventId: 1
        };

        // Execute user update, targeted plan passenger removal, and late event resolution concurrently in parallel
        await Promise.all([
            User.findByIdAndUpdate(user._id, {
                $set: resetSetFields,
                $unset: resetUnsetFields
            }),
            removeStudentFromActivePlans({
                userId: user.userId,
                mongoId: user._id
            }),
            LateResponseEvent.updateMany(
                { userId: { $in: [user.userId, String(user._id)] }, status: { $ne: "RESOLVED" } },
                {
                    $set: {
                        status: "RESOLVED",
                        resolvedAt: new Date(),
                        resolutionReason: "Admin reset individual travel status"
                    }
                }
            ).catch(() => {})
        ]);

        clearActiveApprovedPlansCache();

        console.timeEnd("reset-one-total");

        res.status(200).json({
            success: true,
            message: "Student travel status and allocations were reset successfully.",
            user: {
                userId: user.userId,
                name: user.name,
                stoppings: user.stoppings,
                city: user.city,
                state: user.state,
                country: user.country,
                travelStatus: "Pending",
                assignedVehicle: null,
                assignedRoute: null,
                allocationStatus: "Unallocated",
                allocatedBus: null,
                isAllocated: false,
                isUnallocated: true,
                lateResponseDetected: false,
                requiresReallocation: false,
                role: user.role
            }
        });
    } catch (error) {
        console.timeEnd("reset-one-total");
        console.error("Single Reset User Travel Status Error:", error.message);
        if (!isDbConnected()) return dbUnavailableResponse(res);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};


// =====================================================
// ADD USER
// =====================================================

export const addUser = async (req, res) => {
    if (!isDbConnected()) {
        return dbUnavailableResponse(res);
    }

    try {
        const user = new User(req.body);
        await user.save();

        res.status(201).json({
            success: true,
            message: "User added successfully",
            user
        });
    } catch (error) {
        console.error("Add User Error:", error.message);
        if (!isDbConnected()) return dbUnavailableResponse(res);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// =====================================================
// DELETE USER
// =====================================================

export const deleteUser = async (req, res) => {
    if (!isDbConnected()) {
        return dbUnavailableResponse(res);
    }

    try {
        const user = await User.findByIdAndDelete(req.params.id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        res.status(200).json({
            success: true,
            message: "User deleted successfully"
        });
    } catch (error) {
        console.error("Delete User Error:", error.message);
        if (!isDbConnected()) return dbUnavailableResponse(res);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};