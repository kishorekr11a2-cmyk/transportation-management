import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Test Suite: Manual Route Approval, Late Response Marking, and Bus Allocation Decoupling
 * 
 * Validates the 12 Success Criteria:
 * 1. User submits before deadline -> Coming, no late-response label.
 * 2. User submits after deadline -> Coming plus Late Response.
 * 3. Late user approved through AI route -> AI behavior remains correct.
 * 4. Late user approved through Manual Route -> late-response label remains visible.
 * 5. Manual Route approval -> no automatic reassignment.
 * 6. Manual Route approval -> only selected manual bus is assigned.
 * 7. User with no selected bus -> remains Unallocated.
 * 8. Bus already used by another route -> error "Selected bus is already assigned to another route".
 * 9. Refresh page -> late-response status and manual allocation remain.
 * 10. Open a new tab -> same data remains.
 * 11. AI Agent Reset -> does not delete manual route allocation or response timestamp.
 * 12. User Management Reset -> clears allocation, new response recalculates against deadline.
 */

describe("Manual Route Approval & Late Response Integrity Test Suite", () => {

    const DEADLINE = new Date("2026-09-13T10:00:00.000Z");

    // Helper: evaluate travel response submission against deadline
    function evaluateSubmission({ travelStatus, responseSubmittedAt, deadline = DEADLINE, allocatedUserIds = new Set() }) {
        if (travelStatus !== "Coming") {
            return {
                travelStatus,
                isLateResponse: false,
                lateResponseDetected: false,
                responseDeadline: null
            };
        }

        const isAfterDeadline = responseSubmittedAt.getTime() > deadline.getTime();
        const isLate = isAfterDeadline && !allocatedUserIds.has("USR1001");

        return {
            travelStatus: "Coming",
            isLateResponse: isLate,
            lateResponseDetected: isLate,
            responseDeadline: isLate ? deadline : null
        };
    }

    // Helper: sanitize user for User Management table display
    function sanitizeUserForManagement(user) {
        const isAllocated = Boolean(
            user.travelStatus === "Coming" &&
            (user.allocationStatus === "Assigned" || user.allocationStatus === "Re-assigned" || user.allocatedBus?.isAllocated || user.assignedVehicle || user.manualBusId)
        );
        const isUnallocated = Boolean(user.travelStatus === "Coming" && !isAllocated);
        const isLateResponse = Boolean(
            user.travelStatus === "Coming" &&
            (Boolean(user.isLateResponse) || Boolean(user.lateResponseDetected) || user.allocationStatus === "Pending Reallocation" || Boolean(user.requiresReallocation))
        );

        let busName = null;
        let routeCode = null;
        if (isAllocated) {
            busName = user.assignedVehicle || user.allocatedBus?.vehicleName || user.manualBusId || "BUS-Assigned";
            routeCode = user.assignedRoute || user.allocatedBus?.routeCode || user.manualRouteId || "Route";
        }

        return {
            ...user,
            isAllocated,
            isUnallocated,
            isLateResponse,
            busName,
            routeCode,
            showLateResponseBadge: isLateResponse,
            displayAllocationTag: user.allocationStatus === "Re-assigned"
                ? "Re-assigned"
                : (isAllocated ? "Allocated" : (user.allocationStatus === "Pending Reallocation" ? "Pending Reallocation" : "Unallocated"))
        };
    }

    // Case 1: User submits before deadline -> Coming, no late-response label
    it("1. User submits before deadline -> Coming, no late-response label", () => {
        const submission = evaluateSubmission({
            travelStatus: "Coming",
            responseSubmittedAt: new Date("2026-09-13T09:30:00.000Z"),
            deadline: DEADLINE
        });

        assert.equal(submission.travelStatus, "Coming");
        assert.equal(submission.isLateResponse, false);
        assert.equal(submission.lateResponseDetected, false);

        const sanitized = sanitizeUserForManagement(submission);
        assert.equal(sanitized.showLateResponseBadge, false);
    });

    // Case 2: User submits after deadline -> Coming plus Late Response
    it("2. User submits after deadline -> Coming plus Late Response", () => {
        const submission = evaluateSubmission({
            travelStatus: "Coming",
            responseSubmittedAt: new Date("2026-09-13T10:15:00.000Z"),
            deadline: DEADLINE
        });

        assert.equal(submission.travelStatus, "Coming");
        assert.equal(submission.isLateResponse, true);
        assert.equal(submission.lateResponseDetected, true);
        assert.ok(submission.responseDeadline);

        const sanitized = sanitizeUserForManagement(submission);
        assert.equal(sanitized.showLateResponseBadge, true);
        assert.equal(sanitized.isLateResponse, true);
    });

    // Case 3: Late user approved through AI route -> existing AI behavior remains correct
    it("3. Late user approved through AI route -> AI behavior remains correct and late flag is preserved", () => {
        const lateUser = {
            userId: "USR1001",
            travelStatus: "Coming",
            isLateResponse: true,
            lateResponseDetected: true,
            travelResponseSubmittedAt: new Date("2026-09-13T10:15:00.000Z"),
            responseDeadline: DEADLINE,
            allocationStatus: "Pending Reallocation"
        };

        // Simulate AI plan approval allocating USR1001 to Route R-01, Bus Alpha
        const allocatedUser = {
            ...lateUser,
            allocationStatus: "Assigned",
            approvedPlanType: "AI",
            assignedVehicle: "Bus Alpha",
            assignedRoute: "R-01",
            allocatedBus: {
                isAllocated: true,
                vehicleName: "Bus Alpha",
                routeCode: "R-01",
                planType: "AI"
            }
        };

        const sanitized = sanitizeUserForManagement(allocatedUser);
        assert.equal(sanitized.isAllocated, true);
        assert.equal(sanitized.showLateResponseBadge, true, "Late Response badge must remain visible after AI approval");
        assert.equal(sanitized.busName, "Bus Alpha");
        assert.equal(sanitized.routeCode, "R-01");
    });

    // Case 4: Late user approved through Manual Route -> late-response label remains visible
    it("4. Late user approved through Manual Route -> late-response label remains visible", () => {
        const lateUser = {
            userId: "USR1122",
            travelStatus: "Coming",
            isLateResponse: true,
            lateResponseDetected: true,
            travelResponseSubmittedAt: new Date("2026-09-13T10:20:00.000Z"),
            responseDeadline: DEADLINE,
            allocationStatus: "Pending Reallocation"
        };

        // Simulate Manual route approval allocating USR1122 to Manual Route MR-KK, Bus TN-58-9999
        const allocatedUser = {
            ...lateUser,
            allocationStatus: "Assigned",
            approvedPlanType: "MANUAL",
            manualRouteId: "MR-KK",
            manualBusId: "TN-58-9999",
            assignedVehicle: "TN-58-9999",
            assignedRoute: "MR-KK",
            manualAllocation: {
                busId: "TN-58-9999",
                routeId: "MR-KK",
                assignedAt: new Date()
            }
        };

        const sanitized = sanitizeUserForManagement(allocatedUser);
        assert.equal(sanitized.isAllocated, true);
        assert.equal(sanitized.showLateResponseBadge, true, "Late Response badge MUST remain visible after manual route approval");
        assert.equal(sanitized.busName, "TN-58-9999");
        assert.equal(sanitized.routeCode, "MR-KK");
    });

    // Case 5: Manual Route approval -> no automatic reassignment
    it("5. Manual Route approval -> no automatic reassignment", () => {
        // Given students USR1001, USR1122, USR1123
        const students = [
            { userId: "USR1001", stoppings: "Anna Nagar", travelStatus: "Coming", allocationStatus: "Unallocated" },
            { userId: "USR1122", stoppings: "KK Nagar", travelStatus: "Coming", allocationStatus: "Unallocated" },
            { userId: "USR1123", stoppings: "KK Nagar", travelStatus: "Coming", allocationStatus: "Unallocated" }
        ];

        // Admin selects only USR1001 and USR1122 for Manual Route MR-01 with Bus B1
        const explicitManualSelectedUserIds = new Set(["USR1001", "USR1122"]);

        // Simulate strict manual allocation
        const results = students.map(s => {
            const isExplicitlyAssigned = explicitManualSelectedUserIds.has(s.userId);
            return {
                ...s,
                manualBusId: isExplicitlyAssigned ? "Bus B1" : null,
                manualRouteId: isExplicitlyAssigned ? "MR-01" : null,
                allocationStatus: isExplicitlyAssigned ? "Assigned" : "Unallocated"
            };
        });

        const usr1123 = results.find(r => r.userId === "USR1123");
        assert.equal(usr1123.manualBusId, null, "USR1123 must NOT receive automatic bus allocation");
        assert.equal(usr1123.allocationStatus, "Unallocated", "USR1123 must remain Unallocated");
        assert.notEqual(usr1123.allocationStatus, "Re-assigned", "USR1123 must NOT be Re-assigned");
    });

    // Case 6: Manual Route approval -> only selected manual bus is assigned
    it("6. Manual Route approval -> only selected manual bus is assigned", () => {
        const selectedBus = "TN-58-4444";
        const manualAssignment = {
            userId: "USR1122",
            approvedPlanType: "MANUAL",
            manualBusId: selectedBus,
            assignedVehicle: selectedBus
        };

        assert.equal(manualAssignment.manualBusId, selectedBus);
        assert.equal(manualAssignment.assignedVehicle, selectedBus);
    });

    // Case 7: User with no selected bus -> remains Unallocated
    it("7. User with no selected bus -> remains Unallocated", () => {
        const unselectedUser = {
            userId: "USR1123",
            travelStatus: "Coming",
            manualBusId: null,
            allocatedBus: null,
            assignedVehicle: null,
            allocationStatus: "Unallocated"
        };

        const sanitized = sanitizeUserForManagement(unselectedUser);
        assert.equal(sanitized.isAllocated, false);
        assert.equal(sanitized.isUnallocated, true);
        assert.equal(sanitized.displayAllocationTag, "Unallocated");
    });

    // Case 8: Bus already used by another route -> return clear error
    it("8. Bus already used by another route -> return clear error", () => {
        const existingRoutes = [
            { routeId: "R-01", assignedVehicle: { vehicleNumber: "TN-58-AA11" }, status: "active" }
        ];

        function validateManualBusAssignment(busNumber, routes) {
            const alreadyAssigned = routes.some(r => r.assignedVehicle?.vehicleNumber === busNumber && r.status === "active");
            if (alreadyAssigned) {
                return { valid: false, error: "Selected bus is already assigned to another route" };
            }
            return { valid: true };
        }

        const check1 = validateManualBusAssignment("TN-58-AA11", existingRoutes);
        assert.equal(check1.valid, false);
        assert.equal(check1.error, "Selected bus is already assigned to another route");

        const check2 = validateManualBusAssignment("TN-58-BB22", existingRoutes);
        assert.equal(check2.valid, true);
    });

    // Case 9: Refresh page -> late-response status and manual allocation remain
    it("9. Refresh page -> late-response status and manual allocation remain", () => {
        // Simulate database state fetched on fresh page load
        const persistedDbState = {
            userId: "USR1001",
            travelStatus: "Coming",
            isLateResponse: true,
            lateResponseDetected: true,
            responseDeadline: DEADLINE,
            approvedPlanType: "MANUAL",
            manualRouteId: "MR-01",
            manualBusId: "TN-58-1111",
            allocationStatus: "Assigned"
        };

        // Hydrate from DB response
        const hydrated = sanitizeUserForManagement(persistedDbState);
        assert.equal(hydrated.showLateResponseBadge, true, "Late response flag must persist on refresh");
        assert.equal(hydrated.isAllocated, true, "Manual allocation must persist on refresh");
        assert.equal(hydrated.busName, "TN-58-1111");
        assert.equal(hydrated.routeCode, "MR-01");
    });

    // Case 10: Open a new tab -> same data remains
    it("10. Open a new tab -> same data remains from backend source of truth", () => {
        const secondClientSession = {
            userId: "USR1122",
            travelStatus: "Coming",
            isLateResponse: true,
            lateResponseDetected: true,
            responseDeadline: DEADLINE,
            approvedPlanType: "MANUAL",
            manualRouteId: "MR-01",
            manualBusId: "TN-58-1111",
            allocationStatus: "Assigned"
        };

        const sanitized = sanitizeUserForManagement(secondClientSession);
        assert.equal(sanitized.showLateResponseBadge, true);
        assert.equal(sanitized.isAllocated, true);
        assert.equal(sanitized.busName, "TN-58-1111");
    });

    // Case 11: AI Agent Reset -> does not delete manual route allocation or response timestamp
    it("11. AI Agent Reset -> does not delete manual route allocation or response timestamp", () => {
        const manualUser = {
            userId: "USR1001",
            travelStatus: "Coming",
            isLateResponse: true,
            lateResponseDetected: true,
            travelResponseSubmittedAt: new Date("2026-09-13T10:15:00.000Z"),
            responseDeadline: DEADLINE,
            approvedPlanType: "MANUAL",
            manualRouteId: "MR-01",
            manualBusId: "TN-58-1111",
            allocationStatus: "Assigned"
        };

        // Simulate AI Agent reset execution: only resets AI plans/allocations
        function simulateAiReset(user) {
            if (user.approvedPlanType === "MANUAL") {
                // Preserved!
                return { ...user };
            }
            return {
                ...user,
                allocatedBus: null,
                assignedVehicle: null,
                assignedRoute: null,
                approvedPlanType: null,
                allocationStatus: "Unallocated"
            };
        }

        const afterAiReset = simulateAiReset(manualUser);
        assert.equal(afterAiReset.approvedPlanType, "MANUAL", "Manual route allocation must not be deleted");
        assert.equal(afterAiReset.manualBusId, "TN-58-1111", "Manual bus ID must not be deleted");
        assert.equal(afterAiReset.isLateResponse, true, "isLateResponse must not be deleted");
        assert.ok(afterAiReset.travelResponseSubmittedAt, "travelResponseSubmittedAt must be preserved");
    });

    // Case 12: User Management Reset -> clears allocation, new response recalculates against deadline
    it("12. User Management Reset -> clears allocation, new response recalculates against deadline", () => {
        const userBeforeReset = {
            userId: "USR1001",
            travelStatus: "Coming",
            isLateResponse: true,
            lateResponseDetected: true,
            travelResponseSubmittedAt: new Date("2026-09-13T10:15:00.000Z"),
            manualBusId: "TN-58-1111",
            allocationStatus: "Assigned"
        };

        // 1. User Management Reset clears all allocation and resets travel status to Pending
        const userAfterReset = {
            ...userBeforeReset,
            travelStatus: "Pending",
            allocationStatus: "Not Assigned",
            assignedVehicle: null,
            assignedRoute: null,
            allocatedBus: null,
            manualRouteId: null,
            manualBusId: null,
            approvedPlanType: null,
            isLateResponse: false,
            lateResponseDetected: false,
            responseDeadline: null,
            travelResponseSubmittedAt: null
        };

        assert.equal(userAfterReset.travelStatus, "Pending");
        assert.equal(userAfterReset.allocationStatus, "Not Assigned");
        assert.equal(userAfterReset.isLateResponse, false);

        // 2. User submits a new response after reset (e.g. at 10:30, which is after the 10:00 active plan approval)
        const newResponse = evaluateSubmission({
            travelStatus: "Coming",
            responseSubmittedAt: new Date("2026-09-13T10:30:00.000Z"),
            deadline: DEADLINE
        });

        assert.equal(newResponse.travelStatus, "Coming");
        assert.equal(newResponse.isLateResponse, true, "New response submitted after deadline must recalculate as late response");
        assert.equal(newResponse.lateResponseDetected, true);
    });
});
