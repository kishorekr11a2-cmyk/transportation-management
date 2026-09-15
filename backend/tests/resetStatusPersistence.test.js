import assert from "node:assert/strict";
import test from "node:test";
import {
    getActiveAllocationForStudent,
    calculateStudentTransportStatusSync
} from "../services/studentTransportStatusService.js";
import { getUserAllocatedBus } from "../services/aiAgentService.js";

test("Reset Status Persistence Test Suite: Single Student & Global Reset Flow", async (t) => {
    // Simulated active approved AI transportation plan
    const mockApprovedPlan = {
        hasApprovedPlan: true,
        primaryPlan: {
            planId: "plan_v1_001",
            planVersion: 1,
            planType: "AI",
            isApproved: true,
            approvedAt: new Date(Date.now() - 3600000),
            buses: [
                {
                    busId: "BUS-01",
                    vehicleName: "Bus 1",
                    routeCode: "R-01",
                    capacity: 50,
                    users: ["USR1001", "USR1002", "USR1003"],
                    allocatedStudents: ["USR1001", "USR1002", "USR1003"],
                    passengers: ["USR1001", "USR1002", "USR1003"],
                    stops: [
                        {
                            name: "Central Station",
                            userIds: ["USR1001", "USR1002", "USR1003"]
                        }
                    ]
                }
            ]
        },
        INWARD: {
            isApproved: true,
            planVersion: 1,
            planType: "AI",
            approvedAt: new Date(Date.now() - 3600000),
            buses: [
                {
                    busId: "BUS-01",
                    vehicleName: "Bus 1",
                    routeCode: "R-01",
                    capacity: 50,
                    users: ["USR1001", "USR1002", "USR1003"],
                    allocatedStudents: ["USR1001", "USR1002", "USR1003"]
                }
            ]
        },
        OUTWARD: {
            isApproved: false
        }
    };

    await t.test("Step 1: Student USR1001 is initially Coming and Allocated in approved plan", () => {
        const studentBefore = {
            userId: "USR1001",
            name: "Alice",
            travelStatus: "Coming",
            allocationStatus: "Assigned",
            isAllocated: true,
            isUnallocated: false
        };

        const initialStatus = calculateStudentTransportStatusSync(studentBefore, mockApprovedPlan, new Set());
        assert.equal(initialStatus.travelStatus, "Coming");
        assert.equal(initialStatus.isAllocated, true);
        assert.equal(initialStatus.allocationStatus, "Assigned");
    });

    await t.test("Step 2 & 3: Reset student USR1001 -> Status becomes Pending and Unallocated", () => {
        // Simulated student state after resetUserTravelStatus controller executes
        const studentAfterReset = {
            userId: "USR1001",
            name: "Alice",
            travelStatus: "Pending",
            allocationStatus: "Unallocated",
            isAllocated: false,
            isUnallocated: true,
            assignedVehicle: null,
            assignedRoute: null,
            allocatedBus: null
        };

        const postResetStatus = calculateStudentTransportStatusSync(studentAfterReset, mockApprovedPlan, new Set());
        assert.equal(postResetStatus.travelStatus, "Pending", "Status must become Pending after reset");
        assert.equal(postResetStatus.allocationStatus, "Unallocated", "Allocation status must become Unallocated");
        assert.equal(postResetStatus.isAllocated, false, "Must not be allocated");
        assert.equal(postResetStatus.isUnallocated, true, "Must be unallocated");
        assert.equal(postResetStatus.allocatedVehicle, null, "Vehicle must be cleared");
        assert.equal(postResetStatus.allocatedRoute, null, "Route must be cleared");
    });

    await t.test("Step 4 & 5: Wait / background polling (15s, 30s, 60s) -> Status MUST REMAIN Pending", () => {
        const studentAfterReset = {
            userId: "USR1001",
            name: "Alice",
            travelStatus: "Pending",
            allocationStatus: "Unallocated",
            isAllocated: false,
            isUnallocated: true
        };

        // Simulate 5 consecutive background polling ticks from getUsers / batchCalculateStudentTransportStatuses
        for (let tick = 1; tick <= 5; tick++) {
            const polledStatus = calculateStudentTransportStatusSync(studentAfterReset, mockApprovedPlan, new Set());
            assert.equal(
                polledStatus.travelStatus,
                "Pending",
                `Poll cycle ${tick}: Travel status must NOT revert back to Coming; must remain Pending!`
            );
            assert.equal(polledStatus.isAllocated, false, `Poll cycle ${tick}: Must remain unallocated`);
            assert.equal(polledStatus.allocationStatus, "Unallocated");
        }
    });

    await t.test("Step 6 & 7: Browser refresh -> Status is still Pending", () => {
        const studentAfterReset = {
            userId: "USR1001",
            name: "Alice",
            travelStatus: "Pending",
            allocationStatus: "Unallocated",
            isAllocated: false,
            isUnallocated: true
        };

        // Simulated full reload fetching through transport status service
        const refreshedStatus = calculateStudentTransportStatusSync(studentAfterReset, mockApprovedPlan, new Set());
        assert.equal(refreshedStatus.travelStatus, "Pending", "After browser refresh, status must remain Pending");
        assert.equal(refreshedStatus.isAllocated, false);
    });

    await t.test("Step 8 & 9: Open Student Dashboard -> Student sees Pending and is NOT locked or allocated", async () => {
        const studentAfterReset = {
            userId: "USR1001",
            name: "Alice",
            travelStatus: "Pending",
            allocationStatus: "Unallocated",
            isAllocated: false,
            isUnallocated: true
        };

        // Verify getUserAllocatedBus for Pending student returns unallocated without modifying status
        const busAlloc = await getUserAllocatedBus(studentAfterReset);
        assert.equal(busAlloc.isAllocated, false, "Pending student must receive isAllocated: false");
        assert.ok(
            busAlloc.adminApprovalStatus === "Pending Travel Confirmation" || busAlloc.adminApprovalStatus === "Pending Admin Approval",
            "Must indicate pending approval or travel confirmation"
        );

        // Verify transport status resolver for Student Dashboard
        const dashboardStatus = calculateStudentTransportStatusSync(studentAfterReset, mockApprovedPlan, new Set());
        assert.equal(dashboardStatus.travelStatus, "Pending");
        assert.equal(dashboardStatus.isSubmissionLocked, false, "Pending student must NOT have submission locked");
        assert.equal(dashboardStatus.submissionLocked, false);
    });

    await t.test("Step 10 & 11: Manually submit Coming -> Status becomes Coming ONLY after manual submission", () => {
        // Before submission: status is Pending
        const studentPending = {
            userId: "USR1001",
            name: "Alice",
            travelStatus: "Pending",
            allocationStatus: "Unallocated",
            isAllocated: false,
            isUnallocated: true
        };
        assert.equal(calculateStudentTransportStatusSync(studentPending, mockApprovedPlan, new Set()).travelStatus, "Pending");

        // Student manually submits Coming:
        const studentAfterManualSubmit = {
            ...studentPending,
            travelStatus: "Coming",
            travelResponseSubmittedAt: new Date(),
            allocationStatus: "Unallocated"
        };

        const postSubmitStatus = calculateStudentTransportStatusSync(studentAfterManualSubmit, mockApprovedPlan, new Set());
        assert.equal(postSubmitStatus.travelStatus, "Coming", "Status must become Coming ONLY after explicit manual submission");
    });

    await t.test("Global Reset Flow: All students remain Pending across polling, and only reset users become Pending", () => {
        const allStudents = [
            { userId: "USR1001", name: "Alice", travelStatus: "Coming", allocationStatus: "Assigned" },
            { userId: "USR1002", name: "Bob", travelStatus: "Coming", allocationStatus: "Assigned" },
            { userId: "USR1003", name: "Charlie", travelStatus: "Pending", allocationStatus: "Unallocated" }
        ];

        // 1. Reset Single User USR1001: Only USR1001 becomes Pending; USR1002 remains Coming
        const singleResetUsers = allStudents.map((u) => {
            if (u.userId === "USR1001") {
                return { ...u, travelStatus: "Pending", allocationStatus: "Unallocated", isAllocated: false, isUnallocated: true };
            }
            return u;
        });

        const status1001 = calculateStudentTransportStatusSync(singleResetUsers[0], mockApprovedPlan, new Set());
        const status1002 = calculateStudentTransportStatusSync(singleResetUsers[1], mockApprovedPlan, new Set());

        assert.equal(status1001.travelStatus, "Pending", "USR1001 must be Pending");
        assert.equal(status1002.travelStatus, "Coming", "USR1002 must remain Coming (untouched)");

        // 2. Reset All: Every student becomes Pending and remains Pending
        const globalResetUsers = allStudents.map((u) => ({
            ...u,
            travelStatus: "Pending",
            allocationStatus: "Unallocated",
            isAllocated: false,
            isUnallocated: true
        }));

        globalResetUsers.forEach((student) => {
            const status = calculateStudentTransportStatusSync(student, mockApprovedPlan, new Set());
            assert.equal(status.travelStatus, "Pending", `Student ${student.userId} must have travelStatus: Pending`);
            assert.equal(status.allocationStatus, "Unallocated", `Student ${student.userId} must have allocationStatus: Unallocated`);
            assert.equal(status.isAllocated, false);
            assert.equal(status.isUnallocated, true);
        });
    });

    await t.test("getActiveAllocationForStudent strictly ignores Pending and Not Coming students", () => {
        const pendingUser = { userId: "USR1001", travelStatus: "Pending" };
        const notComingUser = { userId: "USR1001", travelStatus: "Not Coming" };

        const pendingAlloc = getActiveAllocationForStudent(pendingUser, mockApprovedPlan);
        assert.equal(pendingAlloc.isAllocated, false);
        assert.equal(pendingAlloc.allocationStatus, "Unallocated");

        const notComingAlloc = getActiveAllocationForStudent(notComingUser, mockApprovedPlan);
        assert.equal(notComingAlloc.isAllocated, false);
        assert.equal(notComingAlloc.allocationStatus, "Unallocated");
    });
});
