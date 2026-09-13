import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import AiPlan from "../models/AiPlan.js";
import LateResponseEvent from "../models/LateResponseEvent.js";
import { isDbConnected } from "../config/db.js";
import { getUserAllocatedBus } from "../services/aiAgentService.js";

/**
 * Generate stable unique event key for late response event deduplication
 * Identity: studentId + direction + responseTime + planApprovalTime
 */
export const generateLateResponseEventKey = (userId, direction, responseTime, planApprovalTime) => {
    const uId = String(userId || "").toLowerCase().trim();
    const dir = String(direction || "").toUpperCase().trim();
    const rTime = responseTime instanceof Date ? responseTime.getTime() : (responseTime ? new Date(responseTime).getTime() : 0);
    const pTime = planApprovalTime instanceof Date ? planApprovalTime.getTime() : (planApprovalTime ? new Date(planApprovalTime).getTime() : "initial");
    return `lr_${uId}_${dir}_${rTime}_${pTime}`;
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
                lateResponseDetected: 1,
                isLateResponse: 1,
                lateResponseAt: 1,
                responseDeadline: 1,
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
                aiAllocation: 1,
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

        // Strip heavy nested route/geometry data from allocatedBus to ensure ultra-fast JSON transmission
        const sanitizedUsers = users.map((u) => {
            const isAllocated = Boolean(
                u.travelStatus === "Coming" &&
                (u.allocationStatus === "Assigned" || u.allocationStatus === "Re-assigned" || u.allocatedBus?.isAllocated || u.assignedVehicle || u.manualBusId)
            );
            const isUnallocated = Boolean(
                u.travelStatus === "Coming" && !isAllocated
            );
            // CRITICAL FIX: Decouple isLateResponse from isUnallocated so late-responders retain their late-response badge even when allocated!
            const isLateResponse = Boolean(
                u.travelStatus === "Coming" &&
                (Boolean(u.isLateResponse) || Boolean(u.lateResponseDetected) || u.allocationStatus === "Pending Reallocation" || Boolean(u.requiresReallocation))
            );
            const unallocatedCategory = (isLateResponse && isUnallocated)
                ? "LATE_RESPONSE_UNALLOCATED" // TYPE 1: Late Coming, unallocated, requires admin review
                : (isUnallocated ? "NORMAL_UNALLOCATED" : null); // TYPE 2: Normal Coming, unallocated due to capacity/vehicle availability

            let cleanBus = null;
            if (u.allocatedBus && typeof u.allocatedBus === "object") {
                const b = u.allocatedBus;
                cleanBus = {
                    isAllocated: b.isAllocated ?? isAllocated,
                    vehicleName: b.vehicleName || u.assignedVehicle || u.manualBusId,
                    vehicleNumber: b.vehicleNumber || u.assignedVehicle || u.manualBusId,
                    routeCode: b.routeCode || u.assignedRoute || u.manualRouteId,
                    routeName: b.routeName || u.assignedRoute || u.manualRouteId,
                    seatNumber: b.seatNumber,
                    direction: b.direction,
                    allocationStatus: b.allocationStatus || u.allocationStatus,
                    requiresReallocation: b.requiresReallocation ?? u.requiresReallocation,
                    affectedDirections: b.affectedDirections || u.affectedDirections,
                    adminApprovalStatus: b.adminApprovalStatus || u.approvalStatus,
                    message: b.message
                };
                if (b.inward && typeof b.inward === "object") {
                    cleanBus.inward = {
                        isAllocated: b.inward.isAllocated,
                        vehicleName: b.inward.vehicleName,
                        vehicleNumber: b.inward.vehicleNumber,
                        routeCode: b.inward.routeCode,
                        routeName: b.inward.routeName,
                        allocationStatus: b.inward.allocationStatus
                    };
                }
                if (b.outward && typeof b.outward === "object") {
                    cleanBus.outward = {
                        isAllocated: b.outward.isAllocated,
                        vehicleName: b.outward.vehicleName,
                        vehicleNumber: b.outward.vehicleNumber,
                        routeCode: b.outward.routeCode,
                        routeName: b.outward.routeName,
                        allocationStatus: b.outward.allocationStatus
                    };
                }
            } else if (u.manualBusId || u.manualRouteId) {
                cleanBus = {
                    isAllocated: true,
                    vehicleName: u.manualBusId || u.assignedVehicle,
                    vehicleNumber: u.manualBusId || u.assignedVehicle,
                    routeCode: u.manualRouteId || u.assignedRoute,
                    routeName: u.manualRouteId || u.assignedRoute,
                    direction: "INWARD",
                    allocationStatus: u.allocationStatus || "Assigned",
                    adminApprovalStatus: u.approvalStatus || "Approved"
                };
            }
            return {
                ...u,
                isAllocated,
                isUnallocated,
                isLateResponse,
                unallocatedCategory,
                allocatedBus: cleanBus,
                assignedVehicle: u.assignedVehicle || cleanBus?.vehicleName || u.manualBusId || null,
                assignedRoute: u.assignedRoute || cleanBus?.routeCode || u.manualRouteId || null,
                allocationStatus: u.allocationStatus || (isAllocated ? "Assigned" : (u.travelStatus === "Coming" ? (isLateResponse ? "Pending Reallocation" : "Unallocated") : "Not Assigned"))
            };
        });

        console.log(`[PERFORMANCE] users API query: ${Date.now() - tStart} ms`);
        res.status(200).json(sanitizedUsers);
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
            approvedAt: null,
            allocatedUserIds: new Set()
        },
        OUTWARD: {
            isApproved: false,
            planType: null,
            planId: null,
            approvedAt: null,
            allocatedUserIds: new Set()
        }
    };

    if (!isDbConnected() || !mongoose.connection?.db) {
        return plans;
    }

    try {
        // 1. Check ai_selected_plans collection (Authoritative source for approved AI & Admin Manual plans)
        const selectedDocs = await mongoose.connection.db.collection("ai_selected_plans").find(
            {
                active: true,
                $or: [
                    { status: "active" },
                    { approved: true }
                ]
            },
            {
                projection: {
                    approvedAt: 1,
                    selectedAt: 1,
                    createdAt: 1,
                    direction: 1,
                    tripMode: 1,
                    planType: 1,
                    active: 1,
                    status: 1,
                    approved: 1,
                    "plan.direction": 1,
                    "plan.tripMode": 1,
                    "plan.buses.users": 1,
                    "plan.buses.allocatedStudents": 1,
                    "plan.buses.passengers": 1,
                    "plan.routes.users": 1,
                    "plan.routes.allocatedStudents": 1,
                    "plan.routes.passengers": 1,
                    "buses.users": 1,
                    "buses.allocatedStudents": 1,
                    "buses.passengers": 1,
                    "routes.users": 1,
                    "routes.allocatedStudents": 1,
                    "routes.passengers": 1
                }
            }
        ).sort({ selectedAt: -1, approvedAt: -1, createdAt: -1 }).limit(10).toArray();

        for (const doc of selectedDocs) {
            const rawDir = doc.direction || doc.tripMode || doc.plan?.direction || doc.plan?.tripMode;
            const dir = String(rawDir).toUpperCase().includes("OUTWARD") || String(rawDir).toUpperCase().includes("SOURCE") ? "OUTWARD" : "INWARD";

            if (!plans[dir].isApproved) {
                const approvalTime = doc.approvedAt || doc.selectedAt || doc.createdAt;
                if (approvalTime) {
                    plans[dir].isApproved = true;
                    plans[dir].planType = doc.planType || "AI";
                    plans[dir].planId = doc._id ? String(doc._id) : null;
                    plans[dir].approvedAt = new Date(approvalTime);

                    // Extract allocated students from plan buses/routes
                    const buses = doc.plan?.buses || doc.plan?.routes || doc.buses || doc.routes || [];
                    for (const bus of buses) {
                        const users = bus.users || bus.allocatedStudents || bus.passengers || [];
                        for (const u of users) {
                            const uId = typeof u === "string" ? u : (u.userId || u._id || u.id);
                            if (uId) plans[dir].allocatedUserIds.add(String(uId).toLowerCase().trim());
                        }
                    }
                }
            }
        }

        // 2. Check AiPlan collection as fallback for approved directions
        for (const dir of ["INWARD", "OUTWARD"]) {
            if (!plans[dir].isApproved) {
                const aiPlanDoc = await AiPlan.findOne({
                    active: true,
                    status: "active",
                    isApproved: true,
                    $or: [
                        { direction: dir },
                        { tripMode: dir },
                        { tripMode: dir === "OUTWARD" ? "FROM_SOURCE" : "TO_DESTINATION" }
                    ]
                })
                    .select({
                        approvedAt: 1,
                        createdAt: 1,
                        direction: 1,
                        tripMode: 1,
                        "buses.users": 1,
                        "buses.allocatedStudents": 1,
                        "routes.users": 1,
                        "routes.allocatedStudents": 1
                    })
                    .lean();

                if (aiPlanDoc && (aiPlanDoc.approvedAt || aiPlanDoc.createdAt)) {
                    plans[dir].isApproved = true;
                    plans[dir].planType = "AI";
                    plans[dir].planId = aiPlanDoc._id ? String(aiPlanDoc._id) : null;
                    plans[dir].approvedAt = new Date(aiPlanDoc.approvedAt || aiPlanDoc.createdAt);

                    const buses = aiPlanDoc.buses || aiPlanDoc.routes || [];
                    for (const bus of buses) {
                        const users = bus.users || bus.allocatedStudents || [];
                        for (const u of users) {
                            const uId = typeof u === "string" ? u : (u.userId || u._id || u.id);
                            if (uId) plans[dir].allocatedUserIds.add(String(uId).toLowerCase().trim());
                        }
                    }
                }
            }
        }

        // 3. Check manual_plan_submissions for manual plans confirmed via Route Management
        for (const dir of ["INWARD", "OUTWARD"]) {
            if (!plans[dir].isApproved) {
                const subDoc = await mongoose.connection.db.collection("manual_plan_submissions").findOne(
                    {
                        $or: [
                            { direction: dir },
                            { direction: dir.toLowerCase() }
                        ],
                        isSubmitted: true
                    },
                    {
                        projection: {
                            submittedAt: 1,
                            confirmedAt: 1,
                            createdAt: 1,
                            direction: 1
                        }
                    }
                );

                if (subDoc && (subDoc.submittedAt || subDoc.confirmedAt || subDoc.createdAt)) {
                    plans[dir].isApproved = true;
                    plans[dir].planType = "MANUAL";
                    plans[dir].planId = subDoc._id ? String(subDoc._id) : null;
                    plans[dir].approvedAt = new Date(subDoc.submittedAt || subDoc.confirmedAt || subDoc.createdAt);
                }
            }
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
        const approvedPlans = await resolveActiveApprovedPlans();
        const inwardPlanApprovalTime = approvedPlans.INWARD.isApproved ? approvedPlans.INWARD.approvedAt : null;
        const outwardPlanApprovalTime = approvedPlans.OUTWARD.isApproved ? approvedPlans.OUTWARD.approvedAt : null;

        // Query all students who have travelStatus === 'Coming'
        const students = await User.find({
            role: "student",
            travelStatus: "Coming"
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
                lateResponseDetected: 1,
                lateResponseAt: 1,
                lateResponseNotifiedEventKeys: 1,
                lateResponseNotifiedAt: 1,
                travelResponseSubmittedAt: 1,
                lastTravelResponseAt: 1,
                requiresReallocation: 1,
                affectedDirections: 1,
                assignedVehicle: 1,
                assignedRoute: 1,
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
                "allocatedBus.adminApprovalStatus": 1,
                "allocatedBus.inward.isAllocated": 1,
                "allocatedBus.inward.approved": 1,
                "allocatedBus.inward.adminApprovalStatus": 1,
                "allocatedBus.outward.isAllocated": 1,
                "allocatedBus.outward.approved": 1,
                "allocatedBus.outward.adminApprovalStatus": 1,
                createdAt: 1,
                updatedAt: 1
            })
            .lean()
            .sort({ lateResponseAt: -1, travelResponseSubmittedAt: -1, createdAt: -1 });

        const qualifyingLateStudents = [];
        const bulkSyncOps = [];
        const unnotifiedEventKeys = [];

        for (const student of students) {
            // CRITICAL SEPARATION OF CONDITIONS:
            // TYPE 1 (Late Response + Unallocated): Explicit response submitted strictly AFTER plan approval without a seat.
            // TYPE 2 (Normal Unallocated Only): Response submitted BEFORE plan approval (or initial demand), left unassigned due to capacity.
            // NEVER fall back to updatedAt or createdAt to classify a student as late!
            const rawResponseTime = student.travelResponseSubmittedAt ||
                                    student.lastTravelResponseAt ||
                                    (student.lateResponseDetected ? student.lateResponseAt : null);
            const responseTime = rawResponseTime ? new Date(rawResponseTime) : null;

            const affectedDirs = [];

            // Direction-specific evaluation: Must submit AFTER plan approval AND not be in approved allocation
            if (responseTime) {
                for (const dir of ["INWARD", "OUTWARD"]) {
                    const planState = approvedPlans[dir];
                    if (planState.isApproved && planState.approvedAt) {
                        const isAfterApproval = responseTime.getTime() > planState.approvedAt.getTime();

                        const sId = String(student.userId || "").toLowerCase().trim();
                        const sMongoId = String(student._id || "").toLowerCase().trim();
                        const isAllocatedInPlan = planState.allocatedUserIds.has(sId) ||
                                                  planState.allocatedUserIds.has(sMongoId) ||
                                                  Boolean(
                                                      student.allocatedBus?.[dir.toLowerCase()]?.isAllocated &&
                                                      (student.allocatedBus[dir.toLowerCase()].approved === true ||
                                                       student.allocatedBus[dir.toLowerCase()].adminApprovalStatus === "Approved")
                                                  );

                        if (isAfterApproval && !isAllocatedInPlan) {
                            affectedDirs.push(dir);
                        }
                    }
                }
            }

            // Student is ONLY late if they have affected directions from a post-approval submission!
            const isLate = affectedDirs.length > 0;

            // Self-healing: If a normal unallocated student (TYPE 2) was previously mistakenly flagged with lateResponseDetected,
            // reset their flags back to normal unallocated state in MongoDB!
            if (!isLate && (student.lateResponseDetected || student.allocationStatus === "Pending Reallocation" || student.requiresReallocation)) {
                bulkSyncOps.push({
                    updateOne: {
                        filter: { _id: student._id },
                        update: {
                            $set: {
                                lateResponseDetected: false,
                                requiresReallocation: false,
                                allocationStatus: student.allocationStatus === "Pending Reallocation" ? "Unallocated" : (student.allocationStatus || "Not Assigned")
                            }
                        }
                    }
                });
            }

            if (isLate) {
                const finalAffectedDirs = affectedDirs.length > 0
                    ? affectedDirs
                    : (Array.isArray(student.affectedDirections) && student.affectedDirections.length > 0 ? student.affectedDirections : ["OUTWARD"]);

                // Sync DB record if flags were not yet persisted
                if (!student.lateResponseDetected || student.allocationStatus !== "Pending Reallocation" || !student.requiresReallocation) {
                    bulkSyncOps.push({
                        updateOne: {
                            filter: { _id: student._id },
                            update: {
                                $set: {
                                    lateResponseDetected: true,
                                    allocationStatus: "Pending Reallocation",
                                    requiresReallocation: true,
                                    lateResponseAt: responseTime,
                                    affectedDirections: finalAffectedDirs
                                }
                            }
                        }
                    });
                }

                // Determine relevant plan approval timestamp
                let planApprovalTime = null;
                if (finalAffectedDirs.includes("INWARD") && inwardPlanApprovalTime) {
                    planApprovalTime = inwardPlanApprovalTime;
                } else if (finalAffectedDirs.includes("OUTWARD") && outwardPlanApprovalTime) {
                    planApprovalTime = outwardPlanApprovalTime;
                } else {
                    planApprovalTime = inwardPlanApprovalTime || outwardPlanApprovalTime || null;
                }

                // Stable Event Key Generation & Deduplication Check
                const studentEventKeys = [];
                let hasUnnotifiedEvent = false;

                for (const dir of finalAffectedDirs) {
                    const dirPlanTime = (dir === "INWARD" ? inwardPlanApprovalTime : outwardPlanApprovalTime) || planApprovalTime;
                    const eventKey = generateLateResponseEventKey(student.userId || student._id, dir, responseTime, dirPlanTime);
                    studentEventKeys.push(eventKey);

                    const alreadyNotified = Array.isArray(student.lateResponseNotifiedEventKeys) &&
                                            student.lateResponseNotifiedEventKeys.includes(eventKey);

                    if (!alreadyNotified) {
                        hasUnnotifiedEvent = true;
                        unnotifiedEventKeys.push(eventKey);
                    }
                }

                const busName = student.assignedVehicle || student.allocatedBus?.vehicleName || student.allocatedBus?.vehicleNumber || null;
                const routeName = student.assignedRoute || student.allocatedBus?.routeCode || student.allocatedBus?.routeName || null;
                const seatNumber = student.allocatedBus?.seatNumber || null;

                qualifyingLateStudents.push({
                    ...student,
                    lateResponseDetected: true,
                    allocationStatus: "Pending Reallocation",
                    requiresReallocation: true,
                    affectedDirections: finalAffectedDirs,
                    direction: finalAffectedDirs.join(", "),
                    responseSubmittedAt: responseTime,
                    responseSubmittedTime: responseTime,
                    planApprovalTime,
                    planApprovedAt: planApprovalTime,
                    eventKeys: studentEventKeys,
                    eventKey: studentEventKeys[0] || null,
                    isNotified: !hasUnnotifiedEvent,
                    isUnnotified: hasUnnotifiedEvent,
                    busName: busName || "Not Assigned",
                    routeName: routeName || "—",
                    seatNumber: seatNumber ? `#${seatNumber}` : "—",
                    currentActionStatus: "Awaiting Route Regeneration"
                });
            }
        }

        // Background update for database consistency
        if (bulkSyncOps.length > 0) {
            User.bulkWrite(bulkSyncOps).catch((err) => console.warn("Background late response sync warning:", err.message));
        }

        const inwardCount = qualifyingLateStudents.filter((u) => u.affectedDirections?.includes("INWARD")).length;
        const outwardCount = qualifyingLateStudents.filter((u) => u.affectedDirections?.includes("OUTWARD")).length;
        const affectedDirections = Array.from(new Set(qualifyingLateStudents.flatMap((u) => u.affectedDirections || [])));

        const unnotifiedStudents = qualifyingLateStudents.filter((u) => u.isUnnotified);
        const unnotifiedCount = unnotifiedStudents.length;
        const uniqueUnnotifiedKeys = Array.from(new Set(unnotifiedEventKeys));

        const lateResponsesFormatted = qualifyingLateStudents.map((u) => ({
            userId: u.userId,
            name: u.name,
            travelStatus: u.travelStatus || "Coming",
            currentTravelStatus: u.travelStatus || "Coming",
            previousTravelStatus: u.previousTravelStatus || "Pending",
            direction: u.direction,
            affectedDirections: u.affectedDirections,
            eventKeys: u.eventKeys,
            eventKey: u.eventKey,
            isNotified: u.isNotified,
            responseSubmittedAt: u.responseSubmittedAt,
            planApprovedAt: u.planApprovedAt,
            planId: u.affectedDirections?.includes("OUTWARD") ? approvedPlans.OUTWARD?.planId : approvedPlans.INWARD?.planId,
            allocationStatus: u.allocationStatus || "Pending Reallocation",
            processingStatus: u.isNotified ? "NOTIFIED" : "DETECTED",
            isLateResponse: true
        }));

        res.status(200).json({
            success: true,
            count: qualifyingLateStudents.length,
            lateComingResponsesCount: qualifyingLateStudents.length,
            pendingReallocationUsersCount: qualifyingLateStudents.length,
            affectedDirections,
            inwardCount,
            outwardCount,
            unnotifiedCount,
            unnotifiedEventKeys: uniqueUnnotifiedKeys,
            unnotifiedLateResponses: unnotifiedStudents.map((u) => ({
                userId: u.userId,
                name: u.name,
                direction: u.direction,
                eventKeys: u.eventKeys,
                responseSubmittedAt: u.responseSubmittedAt
            })),
            lateResponses: lateResponsesFormatted,
            summary: {
                lateComingResponsesCount: qualifyingLateStudents.length,
                pendingReallocationUsersCount: qualifyingLateStudents.length,
                unnotifiedCount,
                notifiedCount: qualifyingLateStudents.length - unnotifiedCount,
                affectedDirections,
                inwardCount,
                outwardCount,
                planApprovalTimes: {
                    INWARD: inwardPlanApprovalTime,
                    OUTWARD: outwardPlanApprovalTime
                }
            },
            users: qualifyingLateStudents
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
                                status: "NOTIFIED",
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

        const allocatedBus = await getUserAllocatedBus(user);
        const userObj = { ...user, allocatedBus };

        res.status(200).json({
            success: true,
            user: userObj
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

        const allocatedBus = await getUserAllocatedBus(user);

        res.status(200).json({
            success: true,
            allocatedBus,
            user: {
                userId: user.userId,
                name: user.name,
                stoppings: user.stoppings,
                travelStatus: user.travelStatus
            }
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

        // If user already submitted the exact same travel status, return idempotent success
        if (user.travelStatus === travelStatus) {
            return res.status(200).json({
                success: true,
                message: `Travel status is already recorded as '${travelStatus}'.`,
                travelStatus: user.travelStatus,
                allocationStatus: user.allocationStatus,
                lateResponse: Boolean(user.lateResponseDetected),
                isLateResponse: Boolean(user.lateResponseDetected),
                requiresReallocation: Boolean(user.requiresReallocation),
                affectedDirections: user.affectedDirections || [],
                user: buildSanitizedUser(user)
            });
        }

        const previousTravelStatus = user.travelStatus || "Pending";
        const responseSubmittedAt = new Date();

        // Helper to format clean user payload for instant frontend hydration
        const buildSanitizedUser = (u) => {
            const isAllocated = Boolean(
                u.travelStatus === "Coming" &&
                (u.allocationStatus === "Assigned" || u.allocationStatus === "Re-assigned" || u.allocatedBus?.isAllocated || u.assignedVehicle || u.manualBusId)
            );
            const isUnallocated = Boolean(
                u.travelStatus === "Coming" && !isAllocated
            );
            const isLateResponse = Boolean(
                u.travelStatus === "Coming" &&
                (Boolean(u.isLateResponse) || Boolean(u.lateResponseDetected) || u.allocationStatus === "Pending Reallocation" || Boolean(u.requiresReallocation))
            );
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
                allocationStatus: u.allocationStatus,
                assignedVehicle: u.assignedVehicle,
                assignedRoute: u.assignedRoute,
                allocatedBus: u.allocatedBus,
                lateResponseDetected: u.lateResponseDetected,
                isLateResponse,
                responseDeadline: u.responseDeadline,
                approvedPlanType: u.approvedPlanType,
                manualRouteId: u.manualRouteId,
                manualBusId: u.manualBusId,
                routeId: u.routeId,
                busId: u.busId,
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

        // =====================================================
        // CASE 1: Student selects "Not Coming"
        // =====================================================
        if (travelStatus === "Not Coming") {
            user.previousTravelStatus = previousTravelStatus;
            user.travelStatus = "Not Coming";
            user.travelResponseSubmittedAt = responseSubmittedAt;
            user.lastTravelResponseAt = responseSubmittedAt;
            user.allocationStatus = "Not Assigned";
            user.assignedVehicle = null;
            user.assignedRoute = null;
            user.allocatedBus = null;
            user.lateResponseDetected = false;
            user.isLateResponse = false;
            user.lateResponseAt = null;
            user.responseDeadline = null;
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
        // Check for active approved AI plans (direction-specific)
        // =====================================================
        user.travelResponseSubmittedAt = responseSubmittedAt;
        user.lastTravelResponseAt = responseSubmittedAt;

        const approvedPlans = await resolveActiveApprovedPlans();
        const isInwardApproved = approvedPlans.INWARD.isApproved;
        const isOutwardApproved = approvedPlans.OUTWARD.isApproved;

        const inwardApprovalTime = approvedPlans.INWARD.approvedAt;
        const outwardApprovalTime = approvedPlans.OUTWARD.approvedAt;

        // Sub-case A: Neither direction is approved (pre-approval workflow)
        if (!isInwardApproved && !isOutwardApproved) {
            user.travelStatus = "Coming";
            user.allocationStatus = "Not Assigned";
            user.assignedVehicle = null;
            user.assignedRoute = null;
            user.allocatedBus = null;
            user.lateResponseDetected = false;
            user.isLateResponse = false;
            user.lateResponseAt = null;
            user.responseDeadline = null;
            user.requiresReallocation = false;
            user.affectedDirections = [];
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

        // Sub-case B: One or both directions are approved!
        // Determine whether this student submitted after approval AND was not in the approved allocation
        const affectedDirections = [];
        const sId = String(user.userId || "").toLowerCase().trim();
        const sMongoId = String(user._id || "").toLowerCase().trim();

        if (isInwardApproved) {
            const hasInwardAlloc = Boolean(
                user.allocatedBus?.inward?.isAllocated &&
                (user.allocatedBus.inward.approved === true || user.allocatedBus.inward.adminApprovalStatus === "Approved")
            ) || approvedPlans.INWARD.allocatedUserIds.has(sId) || approvedPlans.INWARD.allocatedUserIds.has(sMongoId);

            const isSubmittedAfterInward = inwardApprovalTime ? (responseSubmittedAt.getTime() > inwardApprovalTime.getTime()) : false;
            if (!hasInwardAlloc && isSubmittedAfterInward) {
                affectedDirections.push("INWARD");
            }
        }

        if (isOutwardApproved) {
            const hasOutwardAlloc = Boolean(
                user.allocatedBus?.outward?.isAllocated &&
                (user.allocatedBus.outward.approved === true || user.allocatedBus.outward.adminApprovalStatus === "Approved")
            ) || approvedPlans.OUTWARD.allocatedUserIds.has(sId) || approvedPlans.OUTWARD.allocatedUserIds.has(sMongoId);

            const isSubmittedAfterOutward = outwardApprovalTime ? (responseSubmittedAt.getTime() > outwardApprovalTime.getTime()) : false;
            if (!hasOutwardAlloc && isSubmittedAfterOutward) {
                affectedDirections.push("OUTWARD");
            }
        }

        // If student was already allocated in all active approved plans (or submitted before approval), not a late unallocated response
        if (affectedDirections.length === 0) {
            user.travelStatus = "Coming";
            user.lateResponseDetected = false;
            user.isLateResponse = false;
            user.lateResponseAt = null;
            user.responseDeadline = null;
            user.requiresReallocation = false;
            user.affectedDirections = [];
            const isAllocated = Boolean(
                user.allocatedBus?.isAllocated ||
                user.assignedVehicle ||
                (user.allocatedBus?.inward?.isAllocated && (user.allocatedBus.inward.approved || user.allocatedBus.inward.adminApprovalStatus === "Approved")) ||
                (user.allocatedBus?.outward?.isAllocated && (user.allocatedBus.outward.approved || user.allocatedBus.outward.adminApprovalStatus === "Approved"))
            );
            user.allocationStatus = isAllocated ? "Assigned" : "Unallocated";
            await user.save();

            return res.status(200).json({
                success: true,
                message: "Travel status updated successfully.",
                travelStatus: user.travelStatus,
                allocationStatus: user.allocationStatus,
                lateResponse: false,
                isLateResponse: false,
                isAllocated,
                isUnallocated: !isAllocated,
                user: buildSanitizedUser(user)
            });
        }

        // =====================================================
        // CRITICAL: LATE COMING RESPONSE DETECTED!
        // Rule: DO NOT automatically assign a bus, seat, or route!
        // The student must wait until admin reviews and regenerates.
        // =====================================================

        // [LATE RESPONSE CHECK] — Log all detection details for debugging
        console.log("[LATE RESPONSE CHECK]", {
            userId: user.userId,
            travelStatus,
            responseTimestamp: responseSubmittedAt.toISOString(),
            affectedDirections,
            inwardApprovalTime: inwardApprovalTime ? inwardApprovalTime.toISOString() : null,
            outwardApprovalTime: outwardApprovalTime ? outwardApprovalTime.toISOString() : null
        });

        user.travelStatus = "Coming";
        user.allocationStatus = "Pending Reallocation";
        user.lateResponseDetected = true;
        user.isLateResponse = true;
        user.lateResponseAt = responseSubmittedAt;
        user.responseDeadline = (affectedDirections.includes("INWARD") ? inwardApprovalTime : outwardApprovalTime) || inwardApprovalTime || outwardApprovalTime || new Date();
        user.previousTravelStatus = previousTravelStatus;
        user.requiresReallocation = true;
        user.affectedDirections = affectedDirections;

        // Preserve any existing valid allocation for an unaffected direction
        const existingAlloc = (user.allocatedBus && typeof user.allocatedBus === "object") ? user.allocatedBus : {};
        const validInward = (!affectedDirections.includes("INWARD") && existingAlloc.inward?.isAllocated) ? existingAlloc.inward : null;
        const validOutward = (!affectedDirections.includes("OUTWARD") && existingAlloc.outward?.isAllocated) ? existingAlloc.outward : null;

        const hasAnyValidDirection = Boolean(validInward || validOutward);
        const topValid = validInward || validOutward;

        user.allocatedBus = {
            isAllocated: hasAnyValidDirection,
            allocationStatus: "Pending Reallocation",
            adminApprovalStatus: "Pending Reallocation",
            requiresReallocation: true,
            affectedDirections,
            message: "Your travel response was received after the transportation plan was approved. Your bus and seat will be assigned after the administrator reviews and regenerates the transportation allocation.",
            inward: validInward,
            outward: validOutward,
            updatedAt: new Date()
        };

        user.assignedVehicle = topValid ? (topValid.vehicleName || topValid.vehicleNumber || null) : null;
        user.assignedRoute = topValid ? (topValid.routeCode || topValid.routeName || null) : null;

        await user.save();

        // =====================================================
        // PERSIST LATE RESPONSE EVENT TO MONGODB (idempotent upsert per direction)
        // Uses stable eventKey so duplicate submissions are safely ignored.
        // =====================================================
        const lateEventUpsertResults = [];
        for (const dir of affectedDirections) {
            const dirPlanApprovalTime = (dir === "INWARD" ? inwardApprovalTime : outwardApprovalTime) || null;
            const dirPlanId = approvedPlans[dir]?.planId || null;
            const eventKey = generateLateResponseEventKey(
                user.userId,
                dir,
                responseSubmittedAt,
                dirPlanApprovalTime
            );

            try {
                const upsertResult = await LateResponseEvent.updateOne(
                    { eventKey },
                    {
                        $set: {
                            status: "DETECTED",
                            isLateResponse: true,
                            responseSubmittedAt: responseSubmittedAt,
                            updatedAt: new Date()
                        },
                        $setOnInsert: {
                            eventKey,
                            userId: String(user.userId || ""),
                            planId: dirPlanId,
                            direction: dir,
                            previousTravelStatus: previousTravelStatus || "Pending",
                            currentTravelStatus: "Coming",
                            responseTimestamp: responseSubmittedAt,
                            responseSubmittedAt: responseSubmittedAt,
                            planApprovedAt: dirPlanApprovalTime || null,
                            planType: approvedPlans[dir]?.planType || "AI",
                            isLateResponse: true,
                            createdAt: new Date()
                        }
                    },
                    { upsert: true }
                );

                if (upsertResult.upsertedCount > 0) {
                    console.log("[LATE RESPONSE CREATED]", {
                        eventKey,
                        userId: user.userId,
                        direction: dir,
                        responseTimestamp: responseSubmittedAt.toISOString(),
                        planApprovedAt: dirPlanApprovalTime ? dirPlanApprovalTime.toISOString() : null
                    });
                    lateEventUpsertResults.push({ dir, created: true, eventKey });
                } else {
                    console.log("[LATE RESPONSE DUPLICATE IGNORED]", {
                        eventKey,
                        userId: user.userId,
                        direction: dir
                    });
                    lateEventUpsertResults.push({ dir, created: false, eventKey });
                }
            } catch (lreErr) {
                // Log but do not fail the student response — LateResponseEvent is audit/secondary
                console.error("[LATE RESPONSE ERROR] Failed to upsert LateResponseEvent:", lreErr.message, { eventKey, userId: user.userId, direction: dir });
                lateEventUpsertResults.push({ dir, created: false, error: lreErr.message, eventKey });
            }
        }

        // =====================================================
        // MARK APPROVED PLAN AS REQUIRING REVIEW
        // Updates both AiPlan documents and ai_selected_plans collection.
        // Does NOT auto-approve or change routing — admin must review.
        // =====================================================
        const planReviewUpdate = {
            $set: {
                requiresReview: true,
                hasLateResponses: true,
                pendingReallocation: true,
                lastLateResponseAt: responseSubmittedAt
            },
            $addToSet: {
                affectedDirections: { $each: affectedDirections }
            }
        };

        // Update AiPlan collection documents for affected directions
        for (const dir of affectedDirections) {
            try {
                await AiPlan.updateMany(
                    {
                        active: true,
                        isApproved: true,
                        $or: [
                            { direction: dir },
                            { tripMode: dir },
                            { tripMode: dir === "OUTWARD" ? "FROM_SOURCE" : "TO_DESTINATION" }
                        ]
                    },
                    planReviewUpdate
                );
            } catch (planErr) {
                console.error("[PLAN MARKED FOR REVIEW] AiPlan update error:", planErr.message);
            }
        }

        // Update ai_selected_plans collection for affected directions
        if (mongoose.connection?.db) {
            for (const dir of affectedDirections) {
                try {
                    await mongoose.connection.db.collection("ai_selected_plans").updateMany(
                        {
                            active: true,
                            $or: [
                                { direction: dir },
                                { tripMode: dir },
                                { tripMode: dir === "OUTWARD" ? "FROM_SOURCE" : "TO_DESTINATION" }
                            ]
                        },
                        {
                            $set: {
                                requiresReview: true,
                                hasLateResponses: true,
                                pendingReallocation: true,
                                lastLateResponseAt: responseSubmittedAt
                            }
                        }
                    );
                    console.log("[PLAN MARKED FOR REVIEW]", {
                        direction: dir,
                        userId: user.userId,
                        responseTimestamp: responseSubmittedAt.toISOString()
                    });
                } catch (spErr) {
                    console.error("[PLAN MARKED FOR REVIEW] ai_selected_plans update error:", spErr.message);
                }
            }
        }

        res.status(200).json({
            success: true,
            message: "Travel response recorded as Coming. Transportation allocation is pending administrator plan regeneration.",
            travelStatus: user.travelStatus,
            allocationStatus: user.allocationStatus,
            lateResponse: true,
            isLateResponse: true,
            affectedDirections,
            planApprovalTime: (affectedDirections.includes("OUTWARD") ? outwardApprovalTime : inwardApprovalTime) || null,
            responseSubmittedAt,
            lateResponseEventKeys: lateEventUpsertResults.map((r) => r.eventKey),
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
// GLOBAL RESET ALL USERS TRAVEL STATUS (ADMIN ONLY)
// =====================================================

export const resetAllUsersTravelStatus = async (req, res) => {
    if (!isDbConnected()) {
        return dbUnavailableResponse(res);
    }

    try {
        // Count affected students
        const usersToReset = await User.countDocuments({
            role: "student",
            travelStatus: { $in: ["Coming", "Not Coming"] }
        });

        const allocationsToRemove = await User.countDocuments({
            role: "student",
            $or: [
                { "allocatedBus.isAllocated": true },
                { allocatedBus: { $ne: null } }
            ]
        });

        // Reset travel status to Pending and remove all transportation allocations & late response flags
        await User.updateMany(
            { role: "student" },
            {
                $set: {
                    travelStatus: "Pending",
                    assignedVehicle: null,
                    assignedRoute: null,
                    allocationStatus: "Not Assigned",
                    allocatedBus: null,
                    lateResponseDetected: false,
                    isLateResponse: false,
                    responseDeadline: null,
                    approvedPlanType: null,
                    manualRouteId: null,
                    manualBusId: null,
                    routeId: null,
                    busId: null,
                    approvalStatus: null,
                    manualAllocation: null,
                    aiAllocation: null,
                    lateResponseAt: null,
                    travelResponseSubmittedAt: null,
                    lastTravelResponseAt: null,
                    previousTravelStatus: null,
                    requiresReallocation: false,
                    affectedDirections: [],
                    lateResponseNotifiedEventKeys: [],
                    lateResponseNotifiedAt: null,
                    lateResponseResolvedAt: null
                }
            }
        );

        // Deactivate active generated AI plan recommendation in AiPlan
        await AiPlan.updateMany(
            { active: true },
            {
                $set: {
                    active: false,
                    status: "reset",
                    resetAt: new Date(),
                    requiresReview: false,
                    hasLateResponses: false,
                    pendingReallocation: false,
                    affectedDirections: []
                }
            }
        );

        // Deactivate active approved plan in ai_selected_plans
        if (mongoose.connection.db) {
            await mongoose.connection.db.collection("ai_selected_plans").updateMany(
                { active: true },
                {
                    $set: {
                        active: false,
                        status: "reset",
                        resetAt: new Date(),
                        requiresReview: false,
                        hasLateResponses: false,
                        pendingReallocation: false
                    }
                }
            );
        }

        // Resolve all pending LateResponseEvent records so stale notifications don't reappear
        const now = new Date();
        try {
            const resolveResult = await LateResponseEvent.updateMany(
                { status: { $nin: ["RESOLVED", "ALLOCATED"] } },
                { $set: { status: "RESOLVED", resolvedAt: now } }
            );
            console.log("[LATE RESPONSE RESOLVED] Global reset — resolved LateResponseEvents:", resolveResult.modifiedCount);
        } catch (lreErr) {
            console.error("[LATE RESPONSE RESOLVED] LateResponseEvent bulk resolve error:", lreErr.message);
        }

        res.status(200).json({
            success: true,
            message: "Travel status cycle reset successfully. Generated AI routes and bus allocations cleared.",
            usersReset: usersToReset,
            allocationsRemoved: allocationsToRemove
        });
    } catch (error) {
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

    try {
        const { userId } = req.params;

        if (!userId) {
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
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        // If user is already in Pending state and has no allocation or pending reallocation, notify administrator
        if (user.travelStatus === "Pending" && (!user.allocatedBus || !user.allocatedBus.isAllocated) && !user.requiresReallocation) {
            return res.status(400).json({
                success: false,
                message: "User travel status is already Pending."
            });
        }

        // Reset travel status to initial Pending state and clear allocation & late response flags
        user.travelStatus = "Pending";
        user.assignedVehicle = null;
        user.assignedRoute = null;
        user.allocationStatus = "Not Assigned";
        user.allocatedBus = null;
        user.lateResponseDetected = false;
        user.isLateResponse = false;
        user.responseDeadline = null;
        user.approvedPlanType = null;
        user.manualRouteId = null;
        user.manualBusId = null;
        user.routeId = null;
        user.busId = null;
        user.approvalStatus = null;
        user.manualAllocation = null;
        user.aiAllocation = null;
        user.lateResponseAt = null;
        user.travelResponseSubmittedAt = null;
        user.lastTravelResponseAt = null;
        user.previousTravelStatus = null;
        user.requiresReallocation = false;
        user.affectedDirections = [];
        user.lateResponseNotifiedEventKeys = [];
        user.lateResponseNotifiedAt = null;
        user.lateResponseResolvedAt = null;
        await user.save();

        // Resolve LateResponseEvent records for this specific user
        try {
            const resolveResult = await LateResponseEvent.updateMany(
                { userId: String(user.userId || ""), status: { $nin: ["RESOLVED", "ALLOCATED"] } },
                { $set: { status: "RESOLVED", resolvedAt: new Date() } }
            );
            if (resolveResult.modifiedCount > 0) {
                console.log("[LATE RESPONSE RESOLVED] Individual reset — resolved LateResponseEvents:", resolveResult.modifiedCount, "for userId:", user.userId);
            }
        } catch (lreErr) {
            console.error("[LATE RESPONSE RESOLVED] LateResponseEvent resolve error for user:", user.userId, lreErr.message);
        }

        res.status(200).json({
            success: true,
            message: "Travel status reset successfully. The user can now submit a new response.",
            user: {
                userId: user.userId,
                name: user.name,
                stoppings: user.stoppings,
                city: user.city,
                state: user.state,
                country: user.country,
                travelStatus: user.travelStatus,
                assignedVehicle: null,
                assignedRoute: null,
                allocationStatus: "Not Assigned",
                allocatedBus: null,
                lateResponseDetected: false,
                requiresReallocation: false,
                role: user.role
            }
        });
    } catch (error) {
        console.error("Reset User Travel Status Error:", error.message);
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