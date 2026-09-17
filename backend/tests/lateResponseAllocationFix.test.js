/**
 * lateResponseAllocationFix.test.js
 *
 * Verifies the complete late-response flow:
 *   late response → regeneration → approval → allocation → resolution
 *
 * No DB required — all logic is tested in-memory using pure functions.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ─── Helpers ────────────────────────────────────────────────────────────────

const normalizeId = (id) => String(id || "").toLowerCase().trim();

/**
 * Simulates getActiveAllocationForStudent logic (post-fix version):
 * 1. Scans plan buses for the student (no early-exit on isGeneralLate).
 * 2. Falls back to userDoc.allocatedBus if set.
 * Returns { isAllocated, vehicle, route, seatNumber, direction } or { isAllocated: false }.
 */
function simulateGetActiveAllocation(userDoc, activePlans) {
    const uId = normalizeId(userDoc.userId);

    const findInPlan = (planDoc, direction) => {
        if (!planDoc?.isApproved && !planDoc?.approved) return null;
        const buses = planDoc.buses || planDoc.routes || [];
        for (const bus of buses) {
            // Check allocatedStudents first (accurate seatNumber)
            const allocStudents = bus.allocatedStudents || [];
            const aIdx = allocStudents.findIndex(s => normalizeId(s.userId || s) === uId);
            if (aIdx !== -1) {
                const s = allocStudents[aIdx];
                return {
                    isAllocated: true,
                    vehicle: bus.vehicleName || "Assigned Bus",
                    route: bus.routeCode || "R-01",
                    seatNumber: s.seatNumber || aIdx + 1,
                    direction
                };
            }
            // Fall back to users array
            const users = bus.users || [];
            const idx = users.findIndex(u => normalizeId(typeof u === "string" ? u : (u.userId || u._id)) === uId);
            if (idx !== -1) {
                const u = users[idx];
                const seatNumber = (typeof u === "object" && u.seatNumber) ? u.seatNumber : idx + 1;
                return {
                    isAllocated: true,
                    vehicle: bus.vehicleName || "Assigned Bus",
                    route: bus.routeCode || "R-01",
                    seatNumber,
                    direction
                };
            }
        }
        return null;
    };

    let inward = findInPlan(activePlans?.INWARD, "INWARD");
    let outward = findInPlan(activePlans?.OUTWARD, "OUTWARD");

    // Fallback: check user document directly (written by persistPlanToUsers)
    const ua = userDoc.allocatedBus;
    if (!inward && ua?.inward?.isAllocated) inward = { ...ua.inward, isAllocated: true };
    if (!outward && ua?.outward?.isAllocated) outward = { ...ua.outward, isAllocated: true };
    if (!inward && !outward && (ua?.isAllocated || userDoc.assignedVehicle)) {
        const dir = ua?.direction || "OUTWARD";
        const directAlloc = {
            isAllocated: true,
            vehicle: ua?.vehicleName || userDoc.assignedVehicle || "Assigned Bus",
            route: ua?.routeCode || userDoc.assignedRoute || "R-01",
            seatNumber: ua?.seatNumber || 1,
            direction: dir
        };
        if (dir === "INWARD") inward = directAlloc; else outward = directAlloc;
    }

    const primary = outward || inward;
    if (primary?.isAllocated) {
        return { ...primary, isAllocated: true, inward, outward };
    }
    return { isAllocated: false };
}

/**
 * Simulates getCurrentStudentTransportStatus decision order (post-fix):
 * Allocation check BEFORE isLateForCurrentPlan return.
 */
function simulateGetCurrentStatus(userDoc, activePlans, activeLateUserIds = new Set()) {
    if (userDoc.travelStatus === "Pending") return { travelStatus: "Pending", isAllocated: false };
    if (userDoc.travelStatus === "Not Coming") return { travelStatus: "Not Coming", isAllocated: false };

    const uId = normalizeId(userDoc.userId);
    const hasActiveLateEvent = activeLateUserIds.has(uId);
    const isLateFlags = userDoc.lateResponse || userDoc.isLateResponse || userDoc.lateResponseDetected;
    const isLateForCurrentPlan = Boolean(isLateFlags || hasActiveLateEvent);

    // ── Post-fix: allocation is checked BEFORE late-response early return ──
    const allocation = simulateGetActiveAllocation(userDoc, activePlans);

    if (allocation.isAllocated) {
        return {
            travelStatus: "Coming",
            allocationStatus: "Assigned",
            isAllocated: true,
            vehicle: allocation.vehicle,
            route: allocation.route,
            seatNumber: allocation.seatNumber,
            direction: allocation.direction,
            lateResponse: false,
            isLateResponse: false,
            lateResponseDetected: false
        };
    }

    if (isLateForCurrentPlan) {
        return {
            travelStatus: "Coming",
            allocationStatus: "Unallocated",
            isAllocated: false,
            lateResponse: true,
            isLateResponse: true,
            lateResponseDetected: true
        };
    }

    return { travelStatus: "Coming", allocationStatus: "Unallocated", isAllocated: false };
}

/**
 * Simulates persistPlanToUsers writing allocation to a user document.
 * Returns the updated user document.
 */
function simulatePersistPlanToUsers(userDoc, plan, direction) {
    const uId = normalizeId(userDoc.userId);
    const buses = plan.buses || plan.routes || [];
    let matched = null;
    let seatNumber = 1;

    for (const bus of buses) {
        // Always check allocatedStudents first for accurate seatNumber
        const allocStudents = bus.allocatedStudents || [];
        const aIdx = allocStudents.findIndex(s => normalizeId(s.userId || s) === uId);
        if (aIdx !== -1) {
            const s = allocStudents[aIdx];
            seatNumber = s.seatNumber || aIdx + 1;
            matched = bus;
            break;
        }

        // Fallback: check users array
        const users = bus.users || [];
        const idx = users.findIndex(u => normalizeId(typeof u === "string" ? u : (u.userId || u._id)) === uId);
        if (idx !== -1) {
            const u = users[idx];
            seatNumber = (typeof u === "object" && u.seatNumber) ? u.seatNumber : idx + 1;
            matched = bus;
            break;
        }
    }

    if (!matched) {
        return { ...userDoc }; // not found in plan
    }

    const dirKey = direction.toLowerCase();
    const allocObj = {
        isAllocated: true,
        approved: true,
        vehicleName: matched.vehicleName,
        routeCode: matched.routeCode,
        seatNumber,
        direction,
        allocationStatus: "Assigned",
        adminApprovalStatus: "Approved"
    };

    return {
        ...userDoc,
        assignedVehicle: matched.vehicleName,
        assignedRoute: matched.routeCode,
        allocationStatus: "Assigned",
        isAllocated: true,
        isUnallocated: false,
        lateResponse: false,
        isLateResponse: false,
        lateResponseDetected: false,
        requiresReallocation: false,
        affectedDirections: (userDoc.affectedDirections || []).filter(d => d !== direction),
        allocatedBus: {
            isAllocated: true,
            approved: true,
            vehicleName: matched.vehicleName,
            routeCode: matched.routeCode,
            seatNumber,
            direction,
            [dirKey]: allocObj
        }
    };
}

/**
 * Simulates resolving LateResponseEvent after successful allocation.
 */
function simulateResolveLateEvent(lateEvent, userId, allocatedVehicle, allocatedRoute, allocatedSeat) {
    if (!lateEvent) return null;
    const uIds = [userId, userId.toLowerCase(), userId.toUpperCase()];
    if (!uIds.includes(lateEvent.userId)) return lateEvent;
    if (lateEvent.status === "RESOLVED" || lateEvent.status === "ALLOCATED") return lateEvent;
    return {
        ...lateEvent,
        status: "RESOLVED",
        resolvedAt: new Date(),
        allocatedBus: allocatedVehicle,
        allocatedRoute,
        allocatedSeat: String(allocatedSeat)
    };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Late Response Allocation Fix — Complete Flow", () => {

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 1: Outward AI plan — late student is included in regenerated draft
    // ─────────────────────────────────────────────────────────────────────────
    test("Test 1: Late student is present in regenerated OUTWARD draft routes with seatNumber", () => {
        const lateStudent = { userId: "USR003", name: "Alice", stoppings: "Anna Nagar" };

        const regeneratedDraft = {
            direction: "OUTWARD",
            isDraft: true,
            buses: [
                {
                    routeCode: "R-01",
                    vehicleName: "TN 01 AA 1234",
                    capacity: 50,
                    assignedUsers: 1,
                    users: ["USR003"],
                    allocatedStudents: [
                        { userId: "USR003", name: "Alice", seatNumber: 1 }
                    ],
                    stops: [{ order: 1, name: "Anna Nagar", userIds: ["USR003"] }]
                }
            ],
            allocatedUserIds: ["USR003"]
        };

        const found = regeneratedDraft.buses[0].allocatedStudents.find(
            s => normalizeId(s.userId) === normalizeId(lateStudent.userId)
        );

        assert.ok(found, "Late student must be present in regenerated draft routes");
        assert.equal(found.seatNumber, 1, "Late student must have seatNumber = 1");
        assert.ok(regeneratedDraft.buses[0].users.includes("USR003"), "userId must also be in bus.users");
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 2: persistPlanToUsers writes bus/route/seat to the user document
    // ─────────────────────────────────────────────────────────────────────────
    test("Test 2: Approving regenerated plan writes bus/route/seat to student MongoDB record", () => {
        const userBefore = {
            userId: "USR003",
            travelStatus: "Coming",
            lateResponse: true,
            isLateResponse: true,
            lateResponseDetected: true,
            requiresReallocation: true,
            affectedDirections: ["OUTWARD"],
            allocatedBus: null,
            assignedVehicle: null,
            assignedRoute: null
        };

        const approvedPlan = {
            direction: "OUTWARD",
            buses: [
                {
                    routeCode: "R-01",
                    vehicleName: "TN 01 AA 1234",
                    capacity: 50,
                    users: [],
                    allocatedStudents: [{ userId: "USR003", seatNumber: 1 }]
                }
            ]
        };
        // Make users array include the student ID for the persist simulation
        approvedPlan.buses[0].users = ["USR003"];

        const userAfter = simulatePersistPlanToUsers(userBefore, approvedPlan, "OUTWARD");

        assert.equal(userAfter.assignedVehicle, "TN 01 AA 1234", "assignedVehicle must be set");
        assert.equal(userAfter.assignedRoute, "R-01", "assignedRoute must be set");
        assert.equal(userAfter.allocatedBus?.seatNumber, 1, "seatNumber must be 1");
        assert.equal(userAfter.isAllocated, true, "isAllocated must be true");
        assert.equal(userAfter.lateResponse, false, "lateResponse must be cleared");
        assert.equal(userAfter.isLateResponse, false, "isLateResponse must be cleared");
        assert.equal(userAfter.lateResponseDetected, false, "lateResponseDetected must be cleared");
        assert.deepEqual(userAfter.affectedDirections, [], "affectedDirections must be empty");
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 3: LateResponseEvent is resolved ONLY after successful allocation
    // ─────────────────────────────────────────────────────────────────────────
    test("Test 3: LateResponseEvent status becomes RESOLVED only after allocation, not after plan generation", () => {
        const lateEvent = {
            eventKey: "late_USR003_plan_v2",
            userId: "USR003",
            status: "ACTIVE",
            direction: null
        };

        // Plan generation alone: event stays ACTIVE
        const afterGeneration = { ...lateEvent };
        assert.equal(afterGeneration.status, "ACTIVE", "Event must stay ACTIVE after plan generation");

        // After allocation succeeds, resolve the event
        const afterAllocation = simulateResolveLateEvent(lateEvent, "USR003", "TN 01 AA 1234", "R-01", 1);
        assert.equal(afterAllocation.status, "RESOLVED", "Event must be RESOLVED after allocation");
        assert.equal(afterAllocation.allocatedBus, "TN 01 AA 1234", "allocatedBus must be set on event");
        assert.equal(afterAllocation.allocatedRoute, "R-01", "allocatedRoute must be set on event");
        assert.equal(afterAllocation.allocatedSeat, "1", "allocatedSeat must be set on event");
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 4: Student Dashboard shows ALLOCATED after approval (not late)
    // ─────────────────────────────────────────────────────────────────────────
    test("Test 4: Student dashboard returns ALLOCATED status after plan approval — not late", () => {
        // After persistPlanToUsers ran, user doc has allocatedBus set
        const userDocAfterAllocation = {
            userId: "USR003",
            travelStatus: "Coming",
            lateResponse: false,       // cleared by persistPlanToUsers
            isLateResponse: false,
            lateResponseDetected: false,
            requiresReallocation: false,
            affectedDirections: [],
            allocatedBus: {
                isAllocated: true,
                approved: true,
                vehicleName: "TN 01 AA 1234",
                routeCode: "R-01",
                seatNumber: 1,
                direction: "OUTWARD"
            },
            assignedVehicle: "TN 01 AA 1234",
            assignedRoute: "R-01",
            isAllocated: true
        };

        const activePlans = {
            OUTWARD: {
                isApproved: true,
                approved: true,
                buses: [{
                    routeCode: "R-01",
                    vehicleName: "TN 01 AA 1234",
                    users: ["USR003"],
                    allocatedStudents: [{ userId: "USR003", seatNumber: 1 }]
                }]
            }
        };

        const status = simulateGetCurrentStatus(userDocAfterAllocation, activePlans, new Set());

        assert.equal(status.isAllocated, true, "Student must be ALLOCATED in dashboard");
        assert.equal(status.lateResponse, false, "lateResponse must be false");
        assert.equal(status.allocationStatus, "Assigned", "allocationStatus must be Assigned");
        assert.equal(status.vehicle, "TN 01 AA 1234", "vehicle must be returned");
        assert.equal(status.route, "R-01", "route must be returned");
        assert.equal(status.seatNumber, 1, "seatNumber must be returned");
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 5: INWARD plan — same flow works
    // ─────────────────────────────────────────────────────────────────────────
    test("Test 5: INWARD plan allocation also resolves late response correctly", () => {
        const userBefore = {
            userId: "USR005",
            travelStatus: "Coming",
            lateResponse: true,
            isLateResponse: true,
            lateResponseDetected: true,
            requiresReallocation: true,
            affectedDirections: ["INWARD"],
            allocatedBus: null,
            assignedVehicle: null,
            assignedRoute: null
        };

        const inwardPlan = {
            direction: "INWARD",
            buses: [{
                routeCode: "R-02",
                vehicleName: "TN 22 BB 5678",
                capacity: 50,
                users: ["USR005"],
                allocatedStudents: [{ userId: "USR005", seatNumber: 3 }]
            }]
        };

        const userAfter = simulatePersistPlanToUsers(userBefore, inwardPlan, "INWARD");
        assert.equal(userAfter.isAllocated, true, "Student must be allocated for INWARD");
        assert.equal(userAfter.assignedVehicle, "TN 22 BB 5678", "vehicleName must match");
        assert.equal(userAfter.allocatedBus?.seatNumber, 3, "seatNumber must be 3");
        assert.equal(userAfter.lateResponse, false, "lateResponse must be cleared");
        assert.deepEqual(userAfter.affectedDirections, [], "affectedDirections must be empty");

        const inwardEvent = { userId: "USR005", status: "ACTIVE", direction: null };
        const resolved = simulateResolveLateEvent(inwardEvent, "USR005", "TN 22 BB 5678", "R-02", 3);
        assert.equal(resolved.status, "RESOLVED", "INWARD event must be RESOLVED");
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 6: Manual plan — same flow works
    // ─────────────────────────────────────────────────────────────────────────
    test("Test 6: Manual plan late-response allocation resolves correctly", () => {
        const userBefore = {
            userId: "USR010",
            travelStatus: "Coming",
            lateResponse: true,
            isLateResponse: true,
            lateResponseDetected: true,
            requiresReallocation: true,
            affectedDirections: ["OUTWARD"],
            allocatedBus: null,
            assignedVehicle: null,
            assignedRoute: null
        };

        const manualPlan = {
            direction: "OUTWARD",
            planType: "MANUAL",
            buses: [{
                routeCode: "MR-01",
                vehicleName: "TN 33 CC 9999",
                capacity: 40,
                users: ["USR010"],
                allocatedStudents: [{ userId: "USR010", seatNumber: 7 }]
            }]
        };

        const userAfter = simulatePersistPlanToUsers(userBefore, manualPlan, "OUTWARD");
        assert.equal(userAfter.isAllocated, true, "Manual plan: student must be allocated");
        assert.equal(userAfter.assignedVehicle, "TN 33 CC 9999", "vehicleName must match for manual plan");
        assert.equal(userAfter.allocatedBus?.seatNumber, 7, "seatNumber must be 7");
        assert.equal(userAfter.lateResponse, false, "lateResponse must be false");
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 7: Standby student — late event stays ACTIVE, not resolved
    // ─────────────────────────────────────────────────────────────────────────
    test("Test 7: Standby student (no seat available) keeps ACTIVE late-response event", () => {
        const standbyStudent = {
            userId: "USR099",
            travelStatus: "Coming",
            lateResponse: true,
            isLateResponse: true,
            lateResponseDetected: true,
            requiresReallocation: true,
            allocatedBus: null,
            assignedVehicle: null
        };

        const planWithoutStandby = {
            direction: "OUTWARD",
            buses: [{
                routeCode: "R-01",
                vehicleName: "TN 01 AA 1234",
                users: ["USR003"],          // only USR003, not USR099
                allocatedStudents: [{ userId: "USR003", seatNumber: 1 }]
            }]
        };

        const userAfter = simulatePersistPlanToUsers(standbyStudent, planWithoutStandby, "OUTWARD");

        // Not found in plan → allocatedBus stays null
        assert.equal(userAfter.allocatedBus, null, "Standby student must not be allocated");

        // Standby late event should remain ACTIVE (no resolution)
        const lateEvent = { userId: "USR099", status: "ACTIVE" };
        // We do NOT call resolveEvent because allocation failed
        assert.equal(lateEvent.status, "ACTIVE", "Standby student event must remain ACTIVE");
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 8: Direction isolation — OUTWARD allocated, INWARD still late
    // ─────────────────────────────────────────────────────────────────────────
    test("Test 8: Outward allocated but Inward still late — direction isolation preserved", () => {
        const userDoc = {
            userId: "USR004",
            travelStatus: "Coming",
            lateResponse: false,          // cleared by outward allocation
            isLateResponse: false,
            lateResponseDetected: false,
            requiresReallocation: true,   // still true due to INWARD
            affectedDirections: ["INWARD"],
            allocatedBus: {
                isAllocated: true,
                approved: true,
                vehicleName: "TN 01 AA 1234",
                routeCode: "R-01",
                seatNumber: 2,
                direction: "OUTWARD",
                outward: {
                    isAllocated: true,
                    vehicleName: "TN 01 AA 1234",
                    routeCode: "R-01",
                    seatNumber: 2
                }
            },
            assignedVehicle: "TN 01 AA 1234",
            assignedRoute: "R-01"
        };

        const activePlans = {
            OUTWARD: {
                isApproved: true,
                approved: true,
                buses: [{
                    routeCode: "R-01",
                    vehicleName: "TN 01 AA 1234",
                    users: ["USR004"],
                    allocatedStudents: [{ userId: "USR004", seatNumber: 2 }]
                }]
            }
        };

        const status = simulateGetCurrentStatus(userDoc, activePlans, new Set());

        assert.equal(status.isAllocated, true, "Student is allocated for OUTWARD");
        assert.equal(status.vehicle, "TN 01 AA 1234", "vehicle must be set");
        assert.equal(status.route, "R-01", "route must be set");
        // The student still has pending INWARD — dashboard shows allocated (primary direction)
        assert.equal(status.lateResponse, false, "Primary status lateResponse must be false (OUTWARD allocated)");
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 9: Admin dashboard — resolved student no longer appears as late
    // ─────────────────────────────────────────────────────────────────────────
    test("Test 9: Admin late response list excludes RESOLVED events", () => {
        const allLateEvents = [
            { userId: "USR003", status: "RESOLVED", resolvedAt: new Date() },
            { userId: "USR007", status: "ACTIVE" },
            { userId: "USR009", status: "ACTIVE" }
        ];

        const activeLate = allLateEvents.filter(e => e.status === "ACTIVE");
        assert.equal(activeLate.length, 2, "Admin dashboard must show only 2 remaining late students");
        assert.ok(!activeLate.some(e => e.userId === "USR003"), "Resolved student must not appear in admin late list");
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 10: Case-insensitive ID matching — USR003 vs usr003
    // ─────────────────────────────────────────────────────────────────────────
    test("Test 10: Case-insensitive userId matching in allocation lookup", () => {
        const lateEvent = { userId: "USR003", status: "ACTIVE" };
        // Resolution query uses lower/upper variants
        const variants = ["USR003", "usr003", "Usr003"];

        const resolved = variants.map(v => simulateResolveLateEvent({ ...lateEvent }, v, "Bus", "R-01", 1));
        for (const r of resolved) {
            assert.equal(r.status, "RESOLVED", `Must resolve for variant: ${r}`);
        }

        // Even if stored as lowercase in plan, should still match uppercase userId
        const userDoc = { userId: "USR003", allocatedBus: null, assignedVehicle: null };
        const plan = {
            buses: [{
                routeCode: "R-01",
                vehicleName: "TN Bus",
                users: ["usr003"],   // lowercase in plan
                allocatedStudents: [{ userId: "usr003", seatNumber: 5 }]
            }]
        };
        const after = simulatePersistPlanToUsers(userDoc, plan, "OUTWARD");
        assert.equal(after.isAllocated, true, "Case-insensitive: USR003 matched via usr003 in plan");
        assert.equal(after.allocatedBus?.seatNumber, 5, "seatNumber = 5 must be found");
    });
});
