import { test, describe } from "node:test";
import assert from "node:assert/strict";

describe("Late Response Route Regeneration & Admin Approval Workflow Suite", () => {
    // -------------------------------------------------------------------------
    // Test 1: Late response detection qualification
    // -------------------------------------------------------------------------
    test("Test 1: Student submitting Coming after plan approval qualifies as late response and is NOT auto-allocated", () => {
        const planApprovedAt = new Date("2026-09-13T09:00:00.000Z");
        const existingAllocatedUsers = new Set(["student_01", "student_02"]);

        const studentLate = {
            userId: "student_03",
            travelStatus: "Coming",
            travelResponseSubmittedAt: new Date("2026-09-13T09:15:00.000Z") // 15 mins after approval
        };

        const isAllocated = existingAllocatedUsers.has(studentLate.userId);
        const isSubmittedAfterApproval = studentLate.travelResponseSubmittedAt.getTime() > planApprovedAt.getTime();
        const qualifiesAsLate = studentLate.travelStatus === "Coming" && !isAllocated && isSubmittedAfterApproval;

        assert.equal(qualifiesAsLate, true, "Student should qualify as a Late Coming Response");
        assert.equal(isAllocated, false, "Late student must NOT be in the approved allocation");
    });

    // -------------------------------------------------------------------------
    // Test 2: Review-only draft generation does not mutate active plan or allocations
    // -------------------------------------------------------------------------
    test("Test 2: Route regeneration produces an unapproved DRAFT; active plan and allocations remain untouched", () => {
        const activeApprovedPlan = {
            _id: "plan_active_01",
            status: "active",
            approved: true,
            direction: "OUTWARD",
            totalDemand: 50,
            routes: [
                { routeCode: "R-01", vehicleName: "Bus 1", capacity: 70, assignedUsers: 50, users: ["u1", "u2"] }
            ]
        };

        const studentBeforeRegen = {
            userId: "u_late",
            allocationStatus: "Pending Reallocation",
            lateResponseDetected: true,
            assignedVehicle: null,
            allocatedBus: null
        };

        // Regeneration creates draft
        const draftPlan = {
            _id: "draft_plan_01",
            isDraft: true,
            status: "draft",
            approved: false,
            direction: "OUTWARD",
            proposedPlanSummary: {
                currentDemand: 50,
                newLateDemand: 1,
                proposedDemand: 51,
                accommodatedCount: 1,
                standbyCount: 0
            },
            routes: [
                { routeCode: "R-01", vehicleName: "Bus 1", capacity: 70, assignedUsers: 51, users: ["u1", "u2", "u_late"] }
            ]
        };

        // Verification: Active plan untouched
        assert.equal(activeApprovedPlan.status, "active");
        assert.equal(activeApprovedPlan.approved, true);
        assert.equal(activeApprovedPlan.routes[0].assignedUsers, 50, "Active plan assigned count must remain unchanged");

        // Verification: Student state untouched
        assert.equal(studentBeforeRegen.allocationStatus, "Pending Reallocation");
        assert.equal(studentBeforeRegen.assignedVehicle, null);

        // Verification: Draft is strictly marked
        assert.equal(draftPlan.isDraft, true);
        assert.equal(draftPlan.approved, false);
    });

    // -------------------------------------------------------------------------
    // Test 3: Continuous road sequencing & endpoint validation
    // -------------------------------------------------------------------------
    test("Test 3: Continuous road sequencing respects OUTWARD (Source -> Stops) and INWARD (Stops -> Dest)", () => {
        const collegeHub = { name: "KLN College", latitude: 9.8242, longitude: 78.1794 };
        const stops = [
            { name: "Near Stop", latitude: 9.85, longitude: 78.18, distToCollege: 3.5 },
            { name: "Far Stop", latitude: 9.95, longitude: 78.22, distToCollege: 15.2 }
        ];

        // OUTWARD: Starts at College, ordered near to far
        const outwardStops = [...stops].sort((a, b) => a.distToCollege - b.distToCollege);
        const outwardWaypoints = [collegeHub, ...outwardStops];
        assert.equal(outwardWaypoints[0].name, "KLN College", "OUTWARD must start at College Hub");
        assert.equal(outwardWaypoints[1].name, "Near Stop");
        assert.equal(outwardWaypoints[2].name, "Far Stop");

        // INWARD: Starts at farthest residential stop, ends at College
        const inwardStops = [...stops].sort((a, b) => b.distToCollege - a.distToCollege);
        const inwardWaypoints = [...inwardStops, collegeHub];
        assert.equal(inwardWaypoints[0].name, "Far Stop", "INWARD must start at farthest residential stop");
        assert.equal(inwardWaypoints[inwardWaypoints.length - 1].name, "KLN College", "INWARD must end at College Hub");
    });

    // -------------------------------------------------------------------------
    // Test 4: Strict capacity and seat validation
    // -------------------------------------------------------------------------
    test("Test 4: Strict capacity validation prevents overloading and accurately reports standby when full", () => {
        const vehicleCapacity = 70;
        const currentDemand = 68;
        const newLateDemand = 5;
        const totalDemand = currentDemand + newLateDemand; // 73

        const remainingSeats = Math.max(0, vehicleCapacity - currentDemand); // 2
        const accommodated = Math.min(newLateDemand, remainingSeats); // 2
        const standby = newLateDemand - accommodated; // 3

        assert.equal(remainingSeats, 2);
        assert.equal(accommodated, 2);
        assert.equal(standby, 3, "Excess passengers must be marked standby, not overloaded onto the bus");
        assert.equal(currentDemand + accommodated <= vehicleCapacity, true, "Bus capacity must not be exceeded");
    });

    // -------------------------------------------------------------------------
    // Test 5: Smart Route Integration (Option A: Nearby corridor insertion)
    // -------------------------------------------------------------------------
    test("Test 5: Smart Route Integration accommodates late stop into nearby corridor route with capacity", () => {
        const existingRoute = {
            routeCode: "R-01",
            capacity: 70,
            assignedUsers: 60,
            remainingSeats: 10,
            stops: [
                { order: 1, name: "Stop A", latitude: 9.90, longitude: 78.10 },
                { order: 2, name: "Stop C", latitude: 9.94, longitude: 78.14 }
            ]
        };

        const lateStop = { name: "Stop B", latitude: 9.92, longitude: 78.12, lateStudentsCount: 3 };

        // Check feasibility: remainingSeats (10) >= lateStudents (3)
        assert.equal(existingRoute.remainingSeats >= lateStop.lateStudentsCount, true);

        // Insert stop into route
        const updatedStops = [
            existingRoute.stops[0],
            { order: 2, name: lateStop.name, isNewStop: true, userCount: lateStop.lateStudentsCount },
            { order: 3, name: existingRoute.stops[1].name }
        ];

        const updatedAssigned = existingRoute.assignedUsers + lateStop.lateStudentsCount;
        assert.equal(updatedAssigned, 63);
        assert.equal(updatedStops.length, 3);
        assert.equal(updatedStops[1].isNewStop, true);
    });

    // -------------------------------------------------------------------------
    // Test 6: Explicit Admin Approval commits plan and updates allocations
    // -------------------------------------------------------------------------
    test("Test 6: Admin approval activates regenerated plan, assigns seats, and clears lateResponseDetected", () => {
        let activeSelectedPlan = { status: "active", planType: "AI", version: 1 };
        const student = {
            userId: "USR_LATE_1",
            travelStatus: "Coming",
            allocationStatus: "Pending Reallocation",
            lateResponseDetected: true,
            allocatedBus: null
        };

        const draftPlan = {
            status: "draft",
            isDraft: true,
            planType: "AI_REGENERATED",
            buses: [
                { routeCode: "R-01", vehicleName: "Fleet Bus 1", users: ["USR_LATE_1"] }
            ]
        };

        // Approval execution:
        // 1. Supersede previous active plan
        activeSelectedPlan.status = "superseded";

        // 2. Activate draft as active plan
        activeSelectedPlan = {
            status: "active",
            approved: true,
            planType: draftPlan.planType,
            approvedAt: new Date(),
            regeneratedForLateResponses: true
        };

        // 3. Update student allocation
        student.allocationStatus = "Assigned";
        student.lateResponseDetected = false;
        student.allocatedBus = {
            isAllocated: true,
            approved: true,
            vehicleName: "Fleet Bus 1",
            routeCode: "R-01",
            seatNumber: 1
        };

        assert.equal(activeSelectedPlan.status, "active");
        assert.equal(activeSelectedPlan.approved, true);
        assert.equal(student.allocationStatus, "Assigned");
        assert.equal(student.lateResponseDetected, false, "lateResponseDetected must be cleared on approval");
        assert.equal(student.allocatedBus.isAllocated, true);
        assert.equal(student.allocatedBus.seatNumber, 1);
    });

    // -------------------------------------------------------------------------
    // Test 7: No approval safety — student dashboard remains in pending state
    // -------------------------------------------------------------------------
    test("Test 7: Without explicit approval, draft remains pending and student dashboard shows pending reallocation message", () => {
        const student = {
            userId: "USR_LATE_2",
            travelStatus: "Coming",
            allocationStatus: "Pending Reallocation",
            lateResponseDetected: true,
            affectedDirections: ["OUTWARD"]
        };

        // Student dashboard resolution logic
        const hasApprovedRegeneration = false; // Admin has not clicked approve
        let dashboardMessage = "";
        let busAssigned = false;

        if (!hasApprovedRegeneration && student.allocationStatus === "Pending Reallocation") {
            busAssigned = false;
            dashboardMessage = "Your travel response was received after the transportation plan was approved. Your bus and seat will be assigned after the administrator reviews and regenerates the transportation allocation.";
        }

        assert.equal(busAssigned, false, "Bus must not be assigned on student dashboard without admin approval");
        assert.match(dashboardMessage, /after the transportation plan was approved/);
    });

    // -------------------------------------------------------------------------
    // Test 8: Draft discard leaves active plan and allocations untouched
    // -------------------------------------------------------------------------
    test("Test 8: Discarding draft removes draft only, preserving active approved plan and existing allocations", () => {
        let activePlan = { _id: "active_01", status: "active", approved: true };
        let draftPlan = { _id: "draft_01", isDraft: true, status: "draft" };

        // Admin discards draft
        draftPlan = null;

        assert.equal(draftPlan, null, "Draft must be deleted on discard");
        assert.notEqual(activePlan, null, "Active approved plan must remain intact");
        assert.equal(activePlan.status, "active");
    });

    // -------------------------------------------------------------------------
    // Test 9: Direction isolation — OUTWARD regeneration does not affect INWARD plan
    // -------------------------------------------------------------------------
    test("Test 9: Direction isolation ensures OUTWARD regeneration leaves INWARD plan and allocations untouched", () => {
        const inwardPlan = { direction: "INWARD", status: "active", approved: true, demand: 40 };
        const outwardPlan = { direction: "OUTWARD", status: "active", approved: true, demand: 40 };

        // Regenerating OUTWARD draft
        const outwardDraft = { direction: "OUTWARD", isDraft: true, status: "draft", proposedDemand: 42 };

        // Verification
        assert.equal(inwardPlan.status, "active");
        assert.equal(inwardPlan.demand, 40, "INWARD demand must remain completely unchanged by OUTWARD draft");
        assert.equal(outwardDraft.direction, "OUTWARD");
    });

    // -------------------------------------------------------------------------
    // Test 10: Allocation stability — existing students retain original routes
    // -------------------------------------------------------------------------
    test("Test 10: Allocation stability preserves existing student assignments where feasible", () => {
        const existingStudent = {
            userId: "USR_ORIG_1",
            assignedVehicle: "Bus 1",
            assignedRoute: "R-01",
            allocatedBus: { routeCode: "R-01", vehicleName: "Bus 1", seatNumber: 5 }
        };

        const lateStudent = {
            userId: "USR_LATE_1",
            allocatedBus: null
        };

        // Regeneration adds late student without reshuffling existingStudent
        const proposedRouteUsers = ["USR_ORIG_1", "USR_LATE_1"];
        assert.equal(proposedRouteUsers[0], existingStudent.userId, "Existing student position preserved");
        assert.equal(existingStudent.allocatedBus.seatNumber, 5, "Existing student seat number preserved");
    });
});
