import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    calculateStudentTransportStatusSync,
    getActiveAllocationForStudent
} from '../services/studentTransportStatusService.js';

// Exact replica of frontend/src/pages/StudentDashboard.jsx allocation state extraction
function parseDashboardPortalView(student) {
    const allocatedBus = student.allocatedBus;
    const affectedDirections = Array.isArray(student.affectedDirections) ? student.affectedDirections : [];

    // Direction allocations derived authoritatively from student.outward / student.inward or allocatedBus
    const outwardAlloc = (student.outward?.isAllocated)
        ? (student.outward.allocatedBus || student.outward)
        : ((!affectedDirections.includes("OUTWARD") && allocatedBus?.outward && (allocatedBus.outward.approved === true || allocatedBus.outward.adminApprovalStatus === "Approved") && allocatedBus.outward.isAllocated)
            ? allocatedBus.outward
            : null);

    const inwardAlloc = (student.inward?.isAllocated)
        ? (student.inward.allocatedBus || student.inward)
        : ((!affectedDirections.includes("INWARD") && allocatedBus?.inward && (allocatedBus.inward.approved === true || allocatedBus.inward.adminApprovalStatus === "Approved") && allocatedBus.inward.isAllocated)
            ? allocatedBus.inward
            : null);

    const isOutwardPendingRealloc = Boolean(
        !outwardAlloc && (student.outward?.isPendingReallocation || affectedDirections.includes("OUTWARD"))
    );

    const isInwardPendingRealloc = Boolean(
        !inwardAlloc && (student.inward?.isPendingReallocation || affectedDirections.includes("INWARD"))
    );

    const effectiveTravelStatus = student.travelStatus || (student.lateResponse || student.isLateResponse ? "Coming" : "Pending");
    const isComing = effectiveTravelStatus === "Coming";

    const hasDirectionalAlloc = Boolean(inwardAlloc || outwardAlloc);

    const isAllocated = isComing && Boolean(
        hasDirectionalAlloc ||
        (student.isAllocated === true && (student.allocationStatus === "Assigned" || student.allocationStatus === "Re-assigned")) ||
        Boolean(allocatedBus?.isAllocated && (allocatedBus.approved === true || allocatedBus.adminApprovalStatus === "Approved")) ||
        Boolean(student.allocatedVehicle && (student.allocationStatus === "Assigned" || student.allocationStatus === "Re-assigned"))
    );

    // isLate applies ONLY when user is not allocated and has a pending late response
    const isLate = Boolean(
        isComing &&
        !isAllocated &&
        (isOutwardPendingRealloc ||
         isInwardPendingRealloc ||
         student.lateResponse === true ||
         student.lateResponseDetected === true ||
         student.isLateResponse === true ||
         student.lateResponseStatus === "ACTIVE" ||
         student.allocationStatus === "Pending Reallocation" ||
         student.allocationStatus === "Waiting for admin reallocation" ||
         (typeof student.reason === "string" && student.reason.toLowerCase().includes("late response")))
    );

    const isPendingReallocation = isLate && !hasDirectionalAlloc;

    const displayPlanVersion = outwardAlloc?.planVersion || inwardAlloc?.planVersion || student.outward?.planVersion || student.inward?.planVersion || student.activePlanVersion || student.planVersion || 1;
    const activeVehicleName = outwardAlloc?.vehicleName || inwardAlloc?.vehicleName || student.allocatedVehicle || "Assigned Bus";
    const activeRouteCode = outwardAlloc?.routeCode || inwardAlloc?.routeCode || student.allocatedRoute || "Assigned Route";

    // Header badge state
    let headerDailyTravelBadge;
    if (isAllocated) {
        headerDailyTravelBadge = effectiveTravelStatus;
    } else if (isLate) {
        headerDailyTravelBadge = "Waiting for admin reallocation";
    } else {
        headerDailyTravelBadge = effectiveTravelStatus;
    }

    // Notices rendered
    const showAllocationConfirmedBanner = Boolean(isAllocated);
    const showWaitingReallocationBanner = Boolean(!isAllocated && isLate);

    return {
        effectiveTravelStatus,
        isAllocated,
        isLate,
        isPendingReallocation,
        inwardAlloc,
        outwardAlloc,
        isInwardPendingRealloc,
        isOutwardPendingRealloc,
        displayPlanVersion,
        activeVehicleName,
        activeRouteCode,
        headerDailyTravelBadge,
        showAllocationConfirmedBanner,
        showWaitingReallocationBanner,
        outwardPlanVersion: outwardAlloc?.planVersion || null,
        inwardPlanVersion: inwardAlloc?.planVersion || null
    };
}

// Plan Factory Helper
function makePlan({ direction, version, approvalEventId, approvedAt, students = [] }) {
    const isOut = direction === "OUTWARD";
    return {
        _id: `plan_${direction.toLowerCase()}_v${version}`,
        direction,
        version,
        planVersion: version,
        planType: "AI",
        isApproved: true,
        adminApprovalStatus: "Approved",
        approvalEventId: approvalEventId || `evt_${direction.toLowerCase()}_v${version}`,
        approvedAt: approvedAt || new Date("2026-09-18T08:00:00Z"),
        buses: [
            {
                vehicleName: isOut ? "Bus-Out-44" : "Bus-In-12",
                vehicleNumber: isOut ? "TN-58-OUT-44" : "TN-58-IN-12",
                routeCode: isOut ? "R-OUT-44" : "R-IN-12",
                routeName: isOut ? "Outward Line 44" : "Inward Line 12",
                sectorName: isOut ? "South Sector" : "North Sector",
                capacity: 60,
                assignedUsers: students.map(s => s.userId.toLowerCase()),
                allocatedStudents: students.map((s, idx) => ({
                    userId: s.userId.toLowerCase(),
                    name: s.name,
                    stopName: s.stoppings || "Keelavasal",
                    seatNumber: idx + 1
                })),
                stops: [
                    { name: "Keelavasal", order: 1, legDistanceKm: 2.5 }
                ]
            }
        ]
    };
}

describe("User/Student Transport Member Portal Allocation State Logic Audit (Section 15)", () => {

    // =========================================================================
    // SCENARIO 1: Normal allocated user (coming submitted before plan approval)
    // =========================================================================
    it("Scenario 1: Normal allocated user shows Coming, Allocated, No Waiting Reallocation, and both directions assigned", () => {
        const studentDoc = {
            userId: "STU_NORM_1",
            name: "Arun Normal",
            stoppings: "Keelavasal",
            travelStatus: "Coming",
            travelResponseSubmittedAt: new Date("2026-09-18T07:00:00Z") // before plan approval
        };

        const inwardPlan = makePlan({
            direction: "INWARD",
            version: 22,
            approvedAt: new Date("2026-09-18T08:00:00Z"),
            students: [studentDoc]
        });

        const outwardPlan = makePlan({
            direction: "OUTWARD",
            version: 22,
            approvedAt: new Date("2026-09-18T08:00:00Z"),
            students: [studentDoc]
        });

        const status = calculateStudentTransportStatusSync(studentDoc, [inwardPlan, outwardPlan]);
        const view = parseDashboardPortalView(status);

        assert.equal(view.isAllocated, true, "User must be allocated");
        assert.equal(view.isLate, false, "Normal user must not be late");
        assert.equal(view.isPendingReallocation, false, "Normal user must not be pending reallocation");
        assert.equal(view.headerDailyTravelBadge, "Coming", "Header badge must show Coming (not waiting reallocation)");
        assert.equal(view.showAllocationConfirmedBanner, true, "Allocation Confirmed banner must be shown");
        assert.equal(view.showWaitingReallocationBanner, false, "Waiting reallocation alert banner must NOT be shown");
        assert.ok(view.inwardAlloc, "Inward allocation must exist");
        assert.ok(view.outwardAlloc, "Outward allocation must exist");
        assert.equal(view.isInwardPendingRealloc, false, "Inward must not be pending realloc");
        assert.equal(view.isOutwardPendingRealloc, false, "Outward must not be pending realloc");
        assert.equal(view.displayPlanVersion, 22, "Must display Plan Version 22");
    });

    // =========================================================================
    // SCENARIO 2: Late Outward user (INWARD unaffected)
    // =========================================================================
    it("Scenario 2: Late outward response has Outward pending, but Inward remains Allocated with NO artificial pending banner", () => {
        const studentDoc = {
            userId: "STU_LATE_OUT",
            name: "Bala Late Outward",
            stoppings: "Keelavasal",
            travelStatus: "Coming",
            travelResponseSubmittedAt: new Date("2026-09-18T09:30:00Z"), // after Outward plan approval
            affectedDirections: ["OUTWARD"],
            lateResponse: true,
            lateResponseDetected: true
        };

        const inwardPlan = makePlan({
            direction: "INWARD",
            version: 22,
            approvedAt: new Date("2026-09-18T08:00:00Z"),
            students: [studentDoc] // student was part of inward plan
        });

        // Outward plan approved earlier, student was NOT part of it (submitting late for outward)
        const outwardPlan = makePlan({
            direction: "OUTWARD",
            version: 22,
            approvedAt: new Date("2026-09-18T08:00:00Z"),
            students: [] // empty
        });

        const status = calculateStudentTransportStatusSync(studentDoc, [inwardPlan, outwardPlan], {
            activeLateUserIdsByDir: {
                OUTWARD: new Set(["stu_late_out"]),
                INWARD: new Set()
            }
        });
        const view = parseDashboardPortalView(status);

        // Direction-specific checks:
        assert.ok(view.inwardAlloc, "Inward MUST be allocated and active");
        assert.equal(view.isInwardPendingRealloc, false, "CRITICAL: Inward must NEVER show pending reallocation when only outward was late");
        assert.equal(view.outwardAlloc, null, "Outward allocation must be null");
        assert.equal(view.isOutwardPendingRealloc, true, "Outward must show pending reallocation");

        // Top-level checks:
        assert.equal(view.isAllocated, true, "User has an active inward allocation, so isAllocated is true");
        assert.equal(view.isLate, false, "User with an active allocation must not have top-level isLate true");
        assert.equal(view.headerDailyTravelBadge, "Coming", "Header badge must show Coming (or Allocated), not Waiting");
        assert.equal(view.showAllocationConfirmedBanner, true, "Allocation Confirmed banner is displayed");
        assert.equal(view.showWaitingReallocationBanner, false, "No yellow contradictory reallocation banner in travel response card");
    });

    // =========================================================================
    // SCENARIO 3: Late Outward user resolved (Regenerate -> Approve -> Activate)
    // =========================================================================
    it("Scenario 3: Late outward user resolved to Plan Version 23: Outward is Allocated, Waiting completely gone, shows Version 23", () => {
        // Admin regenerates and approves Plan Version 23 for Outward containing the student
        const studentDoc = {
            userId: "STU_LATE_OUT",
            name: "Bala Late Outward",
            stoppings: "Keelavasal",
            travelStatus: "Coming",
            travelResponseSubmittedAt: new Date("2026-09-18T09:30:00Z"),
            affectedDirections: [], // Cleared on resolution
            lateResponse: false,
            lateResponseDetected: false,
            lateResponseResolvedAt: new Date("2026-09-18T10:05:00Z"),
            planVersion: 23,
            activePlanVersion: 23
        };

        const inwardPlan = makePlan({
            direction: "INWARD",
            version: 22,
            approvedAt: new Date("2026-09-18T08:00:00Z"),
            students: [studentDoc]
        });

        const outwardPlanV23 = makePlan({
            direction: "OUTWARD",
            version: 23,
            approvedAt: new Date("2026-09-18T10:00:00Z"),
            students: [studentDoc] // Now included in Plan Version 23!
        });

        const status = calculateStudentTransportStatusSync(studentDoc, [inwardPlan, outwardPlanV23], {
            activeLateUserIdsByDir: {
                OUTWARD: new Set(),
                INWARD: new Set()
            }
        });
        const view = parseDashboardPortalView(status);

        assert.equal(view.isAllocated, true, "Student must be allocated");
        assert.equal(view.isLate, false, "Student must NOT be late");
        assert.equal(view.isPendingReallocation, false, "Student must NOT be pending reallocation");
        assert.equal(view.headerDailyTravelBadge, "Coming");
        assert.equal(view.showAllocationConfirmedBanner, true);
        assert.equal(view.showWaitingReallocationBanner, false, "Waiting alert banner must be completely gone");

        // Both directions allocated:
        assert.ok(view.inwardAlloc, "Inward must be allocated");
        assert.ok(view.outwardAlloc, "Outward must be allocated");
        assert.equal(view.isInwardPendingRealloc, false, "Inward not pending");
        assert.equal(view.isOutwardPendingRealloc, false, "Outward not pending");

        // Verify latest plan version details
        assert.equal(view.outwardPlanVersion, 23, "Outward plan must display Version 23");
        assert.equal(view.outwardAlloc.vehicleName, "Bus-Out-44");
        assert.equal(view.outwardAlloc.routeCode, "R-OUT-44");
        assert.equal(view.outwardAlloc.boardingStop, "Keelavasal");
        assert.equal(view.outwardAlloc.seatNumber, 1);
    });

    // =========================================================================
    // SCENARIO 4: Inward pending only (Outward on-time and allocated)
    // =========================================================================
    it("Scenario 4: Inward pending only: Inward shows Pending, Outward shows Allocated details", () => {
        const studentDoc = {
            userId: "STU_IN_LATE",
            name: "Chitra Late Inward",
            stoppings: "Keelavasal",
            travelStatus: "Coming",
            travelResponseSubmittedAt: new Date("2026-09-18T09:15:00Z"),
            affectedDirections: ["INWARD"]
        };

        const inwardPlan = makePlan({
            direction: "INWARD",
            version: 22,
            approvedAt: new Date("2026-09-18T08:00:00Z"),
            students: [] // empty, student submitted late
        });

        const outwardPlan = makePlan({
            direction: "OUTWARD",
            version: 22,
            approvedAt: new Date("2026-09-18T08:00:00Z"),
            students: [studentDoc] // on-time for outward
        });

        const status = calculateStudentTransportStatusSync(studentDoc, [inwardPlan, outwardPlan], {
            activeLateUserIdsByDir: {
                INWARD: new Set(["stu_in_late"]),
                OUTWARD: new Set()
            }
        });
        const view = parseDashboardPortalView(status);

        assert.ok(view.outwardAlloc, "Outward must be allocated");
        assert.equal(view.isOutwardPendingRealloc, false, "Outward must NOT be pending");
        assert.equal(view.inwardAlloc, null, "Inward must NOT be allocated");
        assert.equal(view.isInwardPendingRealloc, true, "Inward MUST show pending notice");
        assert.equal(view.showWaitingReallocationBanner, false, "No yellow banner in daily travel card");
    });

    // =========================================================================
    // SCENARIO 5: Both directions independently resolved
    // =========================================================================
    it("Scenario 5: Both directions independently resolved to their respective plans", () => {
        const studentDoc = {
            userId: "STU_BOTH_RES",
            name: "Deepa Both Resolved",
            stoppings: "Keelavasal",
            travelStatus: "Coming"
        };

        const inwardPlanV24 = makePlan({
            direction: "INWARD",
            version: 24,
            approvedAt: new Date("2026-09-18T11:00:00Z"),
            students: [studentDoc]
        });

        const outwardPlanV25 = makePlan({
            direction: "OUTWARD",
            version: 25,
            approvedAt: new Date("2026-09-18T12:00:00Z"),
            students: [studentDoc]
        });

        const status = calculateStudentTransportStatusSync(studentDoc, [inwardPlanV24, outwardPlanV25]);
        const view = parseDashboardPortalView(status);

        assert.equal(view.isAllocated, true);
        assert.equal(view.inwardPlanVersion, 24);
        assert.equal(view.outwardPlanVersion, 25);
        assert.equal(view.isInwardPendingRealloc, false);
        assert.equal(view.isOutwardPendingRealloc, false);
    });

    // =========================================================================
    // SCENARIO 6: Stale Plan Version 22 never shown after Plan Version 23 approval
    // =========================================================================
    it("Scenario 6: Stale user document planVersion 22 is superseded by active planVersion 23", () => {
        const studentWithStaleDoc = {
            userId: "STU_STALE_VER",
            name: "Elango Stale",
            stoppings: "Keelavasal",
            travelStatus: "Coming",
            planVersion: 22, // Stale version on User record in DB
            activePlanVersion: 22,
            allocatedBus: {
                vehicleName: "Old-Bus-99",
                routeCode: "R-OLD-99",
                planVersion: 22
            }
        };

        const activeOutwardPlanV23 = makePlan({
            direction: "OUTWARD",
            version: 23,
            approvedAt: new Date("2026-09-18T14:00:00Z"),
            students: [studentWithStaleDoc]
        });

        const status = calculateStudentTransportStatusSync(studentWithStaleDoc, [activeOutwardPlanV23]);
        const view = parseDashboardPortalView(status);

        assert.equal(view.outwardPlanVersion, 23, "Outward must show 23, NEVER stale 22");
        assert.equal(view.outwardAlloc.vehicleName, "Bus-Out-44", "Vehicle must be from active plan, not old document");
    });

    // =========================================================================
    // SCENARIO 7: Submission lock enforcement for allocated users
    // =========================================================================
    it("Scenario 7: Submission is locked when student is allocated", () => {
        const studentDoc = {
            userId: "STU_LOCKED",
            name: "Faris Locked",
            stoppings: "Keelavasal",
            travelStatus: "Coming"
        };

        const plan = makePlan({
            direction: "OUTWARD",
            version: 23,
            students: [studentDoc]
        });

        const status = calculateStudentTransportStatusSync(studentDoc, [plan]);
        assert.equal(status.submissionLocked, true, "submissionLocked must be true for allocated student");
        assert.equal(status.isSubmissionLocked, true, "isSubmissionLocked must be true");
    });

    // =========================================================================
    // SCENARIO 8: Page refresh / re-fetch parity between sync & getActiveAllocation
    // =========================================================================
    it("Scenario 8: Parity between calculateStudentTransportStatusSync and getActiveAllocationForStudent", () => {
        const studentDoc = {
            userId: "STU_PARITY",
            name: "Ganesh Parity",
            stoppings: "Keelavasal",
            travelStatus: "Coming"
        };

        const inwardPlan = makePlan({ direction: "INWARD", version: 10, students: [studentDoc] });
        const outwardPlan = makePlan({ direction: "OUTWARD", version: 11, students: [studentDoc] });

        const syncStatus = calculateStudentTransportStatusSync(studentDoc, [inwardPlan, outwardPlan]);
        const activeAlloc = getActiveAllocationForStudent(studentDoc, [inwardPlan, outwardPlan]);

        assert.equal(syncStatus.isAllocated, true);
        assert.equal(activeAlloc.isAllocated, true);
        assert.equal(syncStatus.outward.planVersion, 11);
        assert.equal(syncStatus.inward.planVersion, 10);
        assert.equal(activeAlloc.outward.planVersion, 11);
        assert.equal(activeAlloc.inward.planVersion, 10);
    });
});
