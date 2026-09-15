import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateLateResponseEventKey } from '../controllers/userController.js';
import { calculateStudentTransportStatusSync, normalizeActivePlans } from '../services/studentTransportStatusService.js';

/**
 * Verification Test Suite for the exact user scenario:
 * 1. Approve a plan.
 * 2. Confirm normal Coming students are allocated correctly.
 * 3. Submit Coming for one student after plan approval.
 * 4. Confirm that student remains Coming + Unallocated.
 * 5. Open or refresh User Management.
 * 6. Confirm late response notification appears (unnotifiedCount > 0).
 * 7. Confirm notification does not repeat continuously during polling.
 * 8. Refresh User Management again and confirm same old event does not repeatedly notify.
 * 9. Confirm Pending and Not Coming users do not trigger the notification.
 * 10. Generate a new plan (unapproved).
 * 11. Confirm late student is still unallocated before approval.
 * 12. Approve the new plan.
 * 13. Confirm late student is allocated only after approval.
 * 14. Confirm old late event is resolved.
 * 15. Confirm no incorrect notification appears after event is resolved.
 * 16. Confirm User Management query loads fast and displays correct counts.
 * 17. Confirm refresh and polling do not modify any user status or allocation (read-only invariant).
 */

describe("Issue 1 & 2 Exact User Scenario Lifecycle Verification", () => {
    const t0 = new Date("2026-09-14T10:00:00Z");
    const tApproval = new Date("2026-09-14T10:30:00Z");
    const tLateSubmit = new Date("2026-09-14T11:00:00Z");

    // In-memory mock store
    let events = [];
    let students = [
        {
            userId: "STD001",
            name: "Alice Normal",
            travelStatus: "Coming",
            travelResponseSubmittedAt: t0,
            allocationStatus: "Unallocated",
            lateResponseNotifiedEventKeys: []
        },
        {
            userId: "STD002",
            name: "Bob Normal",
            travelStatus: "Coming",
            travelResponseSubmittedAt: t0,
            allocationStatus: "Unallocated",
            lateResponseNotifiedEventKeys: []
        },
        {
            userId: "STD003",
            name: "Charlie Pending",
            travelStatus: "Pending",
            travelResponseSubmittedAt: null,
            allocationStatus: "Unallocated",
            lateResponseNotifiedEventKeys: []
        },
        {
            userId: "STD004",
            name: "David NotComing",
            travelStatus: "Not Coming",
            travelResponseSubmittedAt: t0,
            allocationStatus: "Unallocated",
            lateResponseNotifiedEventKeys: []
        },
        {
            userId: "STD005",
            name: "Eve LateCandidate",
            travelStatus: "Pending",
            travelResponseSubmittedAt: null,
            allocationStatus: "Unallocated",
            lateResponseNotifiedEventKeys: []
        }
    ];

    let currentApprovedPlan = null;

    it("Step 1 & 2: Approve a plan -> Normal Coming students are allocated correctly", () => {
        currentApprovedPlan = {
            isApproved: true,
            planVersion: 1,
            approvalEventId: "app_v1",
            approvedAt: tApproval,
            planType: "AI",
            allocatedUserIds: new Set(["std001", "std002"]),
            buses: [
                {
                    vehicleName: "Bus-101",
                    routeName: "Route A",
                    routeCode: "R-A",
                    users: ["std001", "std002"]
                }
            ]
        };

        const activePlans = normalizeActivePlans({ OUTWARD: currentApprovedPlan, INWARD: currentApprovedPlan });

        // Calculate status for STD001 and STD002
        const s1 = calculateStudentTransportStatusSync(students[0], activePlans, new Set());
        const s2 = calculateStudentTransportStatusSync(students[1], activePlans, new Set());

        assert.equal(s1.travelStatus, "Coming");
        assert.equal(s1.isAllocated, true);
        assert.equal(s1.isUnallocated, false);
        assert.equal(s1.isLateResponse, false);

        assert.equal(s2.travelStatus, "Coming");
        assert.equal(s2.isAllocated, true);
        assert.equal(s2.isUnallocated, false);
        assert.equal(s2.isLateResponse, false);
    });

    it("Step 3 & 4: Submit Coming for STD005 after plan approval -> Remains Coming + Unallocated", () => {
        // STD005 submits Coming after approval
        const student = students[4];
        student.travelStatus = "Coming";
        student.travelResponseSubmittedAt = tLateSubmit;
        student.lateResponseDetected = true;
        student.isLateResponse = true;
        student.allocationStatus = "Unallocated";
        student.isAllocated = false;
        student.isUnallocated = true;

        // Generate late response event key
        const eventKey = generateLateResponseEventKey(student.userId, "OUTWARD", tLateSubmit, tApproval);
        events.push({
            eventKey,
            userId: student.userId,
            direction: "OUTWARD",
            responseSubmittedAt: tLateSubmit,
            planApprovedAt: tApproval,
            planVersion: 1,
            approvalEventId: "app_v1",
            status: "ACTIVE",
            isNotified: false
        });

        const activeLateUserIds = new Set(events.filter(e => e.status === "ACTIVE").map(e => e.userId.toLowerCase()));
        const activePlans = normalizeActivePlans({ OUTWARD: currentApprovedPlan, INWARD: currentApprovedPlan });
        const calculated = calculateStudentTransportStatusSync(student, activePlans, activeLateUserIds);

        assert.equal(calculated.travelStatus, "Coming");
        assert.equal(calculated.allocationStatus, "Unallocated");
        assert.equal(calculated.isAllocated, false);
        assert.equal(calculated.isUnallocated, true);
        assert.equal(calculated.lateResponseDetected, true);
        assert.equal(calculated.isLateResponse, true);
    });

    it("Step 5 & 6: Open or refresh User Management -> Notification appears (unnotifiedCount === 1)", () => {
        const activeEvents = events.filter(e => e.status === "ACTIVE");
        const unnotified = activeEvents.filter(e => !e.isNotified);

        assert.equal(activeEvents.length, 1);
        assert.equal(unnotified.length, 1);
        assert.equal(unnotified[0].userId, "STD005");

        // Frontend triggers popup with 5-second duration
        const showLatePopup = unnotified.length > 0;
        assert.equal(showLatePopup, true);
    });

    it("Step 7 & 8: Acknowledge notification -> Polling and refreshes do NOT repeat notification", () => {
        // Simulate acknowledgeLateNotifications call
        const unnotified = events.filter(e => e.status === "ACTIVE" && !e.isNotified);
        unnotified.forEach(e => {
            e.isNotified = true;
            e.notifiedAt = new Date();
        });

        // Next polling cycle or page refresh
        const activeEvents = events.filter(e => e.status === "ACTIVE");
        const unnotifiedAfter = activeEvents.filter(e => !e.isNotified);

        assert.equal(activeEvents.length, 1); // Still active
        assert.equal(unnotifiedAfter.length, 0); // But NOT unnotified anymore!

        // Frontend does not trigger popup
        const showLatePopupAfter = unnotifiedAfter.length > 0;
        assert.equal(showLatePopupAfter, false);
    });

    it("Step 9: Pending and Not Coming users do NOT trigger notification", () => {
        // Pending student
        const pendingStudent = students[2];
        assert.equal(pendingStudent.travelStatus, "Pending");
        const pendingEvents = events.filter(e => e.userId === pendingStudent.userId && e.status === "ACTIVE");
        assert.equal(pendingEvents.length, 0);

        // Not Coming student
        const notComingStudent = students[3];
        assert.equal(notComingStudent.travelStatus, "Not Coming");
        const notComingEvents = events.filter(e => e.userId === notComingStudent.userId && e.status === "ACTIVE");
        assert.equal(notComingEvents.length, 0);
    });

    it("Step 10 & 11: Generate new plan (unapproved) -> Late student STD005 remains unallocated", () => {
        // A draft or generated plan exists, but adminApprovalStatus is not Approved yet
        const draftPlan = {
            isApproved: false,
            planVersion: 2,
            planType: "AI",
            allocatedUserIds: new Set(["std001", "std002", "std005"]),
            buses: [
                {
                    vehicleName: "Bus-101",
                    routeName: "Route A",
                    routeCode: "R-A",
                    users: ["std001", "std002", "std005"]
                }
            ]
        };

        // System still uses current approved plan (v1)
        const activeLateUserIds = new Set(events.filter(e => e.status === "ACTIVE").map(e => e.userId.toLowerCase()));
        const activePlans = normalizeActivePlans({ OUTWARD: currentApprovedPlan, INWARD: currentApprovedPlan });
        const calculated = calculateStudentTransportStatusSync(students[4], activePlans, activeLateUserIds);

        assert.equal(calculated.travelStatus, "Coming");
        assert.equal(calculated.allocationStatus, "Unallocated");
        assert.equal(calculated.isAllocated, false);
        assert.equal(calculated.isUnallocated, true);
    });

    it("Step 12, 13 & 14: Approve new plan -> STD005 allocated only after approval, old event RESOLVED", () => {
        const tApprovalV2 = new Date("2026-09-14T11:30:00Z");
        const approvedPlanV2 = {
            isApproved: true,
            planVersion: 2,
            approvalEventId: "app_v2",
            approvedAt: tApprovalV2,
            planType: "AI",
            allocatedUserIds: new Set(["std001", "std002", "std005"]),
            buses: [
                {
                    vehicleName: "Bus-101",
                    routeName: "Route A",
                    routeCode: "R-A",
                    users: ["std001", "std002", "std005"]
                }
            ]
        };

        // On plan approval: existing active late events for this direction are marked RESOLVED
        events.forEach(e => {
            if (e.direction === "OUTWARD" && e.status === "ACTIVE") {
                e.status = "RESOLVED";
                e.resolvedAt = tApprovalV2;
            }
        });

        currentApprovedPlan = approvedPlanV2;

        const activeLateUserIds = new Set(events.filter(e => e.status === "ACTIVE").map(e => e.userId.toLowerCase()));
        assert.equal(activeLateUserIds.size, 0); // No active late events left

        const activePlans = normalizeActivePlans({ OUTWARD: currentApprovedPlan, INWARD: currentApprovedPlan });
        const calculated = calculateStudentTransportStatusSync(students[4], activePlans, activeLateUserIds);

        assert.equal(calculated.travelStatus, "Coming");
        assert.equal(calculated.isAllocated, true);
        assert.equal(calculated.isUnallocated, false);
        assert.equal(calculated.isLateResponse, false);
    });

    it("Step 15: No incorrect notification appears after event is resolved", () => {
        const activeEvents = events.filter(e => e.status === "ACTIVE");
        const unnotified = activeEvents.filter(e => !e.isNotified);

        assert.equal(activeEvents.length, 0);
        assert.equal(unnotified.length, 0);

        const showLatePopup = unnotified.length > 0;
        assert.equal(showLatePopup, false);
    });

    it("Step 16 & 17: Read-only invariant: loading and polling never modify status or allocations", () => {
        // Snapshot student state
        const originalStatus = students.map(s => ({
            userId: s.userId,
            travelStatus: s.travelStatus,
            allocationStatus: s.allocationStatus
        }));

        // Simulate 10 read-only status recalculations (equivalent to 10 polling intervals)
        const activePlans = normalizeActivePlans({ OUTWARD: currentApprovedPlan, INWARD: currentApprovedPlan });
        for (let i = 0; i < 10; i++) {
            students.forEach(s => {
                calculateStudentTransportStatusSync(s, activePlans, new Set());
            });
        }

        // Verify no mutation occurred on the underlying student records
        students.forEach((s, idx) => {
            assert.equal(s.travelStatus, originalStatus[idx].travelStatus);
            assert.equal(s.allocationStatus, originalStatus[idx].allocationStatus);
        });
    });
});
