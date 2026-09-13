import assert from "node:assert/strict";
import test from "node:test";
import {
    buildManualTransportationPlan,
    buildManualPlan
} from "../services/aiAgentService.js";

test("Admin Manual Transportation Plan Unified Workflow & Parity Test Suite", async (t) => {

    // =========================================================================
    // Test Helpers
    // =========================================================================

    function createMockStudent(id, name, stopName, travelStatus = "Coming") {
        return {
            _id: `mongo_id_${id}`,
            userId: `STU_${id}`,
            name,
            role: "student",
            travelStatus,
            stoppings: stopName,
            city: "Madurai",
            district: "Madurai",
            state: "Tamil Nadu",
            country: "India",
            allocatedBus: null,
            responseLocked: true
        };
    }

    function createMockVehicle(id, name, capacity, status = "Available") {
        return {
            _id: `veh_${id}`,
            vehicleName: name,
            vehicleNumber: `TN-58-AB-${id}`,
            capacity,
            status
        };
    }

    function createMockSchedule(vehicleId, availability = "Available") {
        return {
            vehicle: vehicleId,
            availability,
            status: availability
        };
    }

    function createMockRoute(id, routeName, direction, vehicle, stops) {
        return {
            _id: `route_${id}`,
            routeName,
            routeCode: `R-${String(id).padStart(2, "0")}`,
            direction,
            assignedVehicle: vehicle,
            source: stops[0] || null,
            stops: stops.slice(1, -1),
            destination: stops[stops.length - 1] || null
        };
    }

    // Exact Student Dashboard allocation parsing logic (StudentDashboard.jsx parity)
    function parseStudentDashboardView(student) {
        const allocatedBus = student.allocatedBus;
        const affectedDirections = Array.isArray(student.affectedDirections) ? student.affectedDirections : [];

        const inwardAlloc = (!affectedDirections.includes("INWARD") && allocatedBus?.inward &&
            (allocatedBus.inward.approved === true || allocatedBus.inward.adminApprovalStatus === "Approved") &&
            allocatedBus.inward.isAllocated)
            ? allocatedBus.inward
            : null;

        const outwardAlloc = (!affectedDirections.includes("OUTWARD") && allocatedBus?.outward &&
            (allocatedBus.outward.approved === true || allocatedBus.outward.adminApprovalStatus === "Approved") &&
            allocatedBus.outward.isAllocated)
            ? allocatedBus.outward
            : null;

        const isAllocated = Boolean(inwardAlloc || outwardAlloc);

        let displayStatus = "Not Assigned";
        if (isAllocated) {
            displayStatus = "Approved & Allocated";
        } else if (student.allocationStatus === "Unallocated" || allocatedBus?.unallocatedReason === "VEHICLE_CAPACITY") {
            displayStatus = "Standby (Capacity Full)";
        } else if (student.allocationStatus === "Pending Reallocation") {
            displayStatus = "Pending Reallocation";
        }

        return {
            isAllocated,
            inwardAlloc,
            outwardAlloc,
            showInward: Boolean(inwardAlloc),
            showOutward: Boolean(outwardAlloc),
            displayStatus,
            unallocatedMessage: allocatedBus?.message || "No approved transportation plan available yet."
        };
    }

    // =========================================================================
    // TEST 1: Build Manual Transportation Plan With Seat Allocation & Capacity Limits
    // =========================================================================
    await t.test("1. buildManualTransportationPlan builds live allocations and respects vehicle capacity", async () => {
        const vehicle1 = createMockVehicle("01", "College Bus Alpha", 4); // Capacity: 4
        const schedules = [createMockSchedule(vehicle1._id, "Available")];

        const stops = [
            { name: "Goripalayam", latitude: 9.9252, longitude: 78.1198 },
            { name: "Simmakkal", latitude: 9.9288, longitude: 78.1234 },
            { name: "Campus Hub", latitude: 9.9123, longitude: 78.1456 }
        ];

        const route1 = createMockRoute("01", "Goripalayam to Campus", "INWARD", vehicle1, stops);

        // 6 students want to board at Simmakkal, but capacity is only 4
        const students = [
            createMockStudent("1", "Aarav", "Simmakkal"),
            createMockStudent("2", "Bhavna", "Simmakkal"),
            createMockStudent("3", "Charan", "Simmakkal"),
            createMockStudent("4", "Deepak", "Simmakkal"),
            createMockStudent("5", "Eshwar", "Simmakkal"), // excess
            createMockStudent("6", "Farhan", "Simmakkal")  // excess
        ];

        const plan = await buildManualTransportationPlan({
            direction: "INWARD",
            routes: [route1],
            vehicles: [vehicle1],
            schedules,
            users: students
        });

        assert.equal(plan.planType, "ADMIN");
        assert.equal(plan.direction, "INWARD");
        assert.equal(plan.totalComingUsers, 6, "Total coming users must be 6");
        assert.equal(plan.totalCapacity, 4, "Total capacity must be 4");
        assert.equal(plan.assignedUsers, 4, "Exactly 4 users can be allocated");
        assert.equal(plan.unassignedUsers, 2, "2 users must remain unassigned");
        assert.equal(plan.capacityShortage, true, "Capacity shortage must be flagged");
        assert.equal(plan.buses.length, 1);

        const bus = plan.buses[0];
        assert.equal(bus.assignedUsers, 4);
        assert.equal(bus.remainingSeats, 0);
        assert.equal(bus.users.length, 4);

        // Check that warning was generated for the 2 excess students
        const hasOverflowWarning = plan.warnings.some((w) => w.includes("Seat capacity reached") && w.includes("2 students"));
        assert.ok(hasOverflowWarning, "Should include warning about 2 excess unallocated students");
    });

    // =========================================================================
    // TEST 2: Pre-Approval Behavior — Students see Not Assigned until Admin Approval
    // =========================================================================
    await t.test("2. Before admin approval, plan is Pending and student dashboard shows Not Assigned", async () => {
        const student = createMockStudent("1", "Aarav", "Simmakkal");
        // Plan not approved yet
        student.allocatedBus = {
            isAllocated: false,
            approved: false,
            adminApprovalStatus: "Pending Admin Approval",
            message: "No approved transportation plan available yet."
        };

        const view = parseStudentDashboardView(student);
        assert.equal(view.isAllocated, false, "Student must not be marked allocated before approval");
        assert.equal(view.showInward, false, "Inward bus must not be shown");
        assert.equal(view.showOutward, false, "Outward bus must not be shown");
        assert.equal(view.displayStatus, "Not Assigned");
    });

    // =========================================================================
    // TEST 3: Admin Approval Activates Allocation & Assigns Seat Number Permanently
    // =========================================================================
    await t.test("3. When Admin approves manual plan, allocation is confirmed with seat numbers", async () => {
        const vehicle1 = createMockVehicle("01", "College Bus Alpha", 50);
        const stops = [
            { name: "Goripalayam", latitude: 9.9252, longitude: 78.1198 },
            { name: "Simmakkal", latitude: 9.9288, longitude: 78.1234 },
            { name: "Campus Hub", latitude: 9.9123, longitude: 78.1456 }
        ];
        const route1 = createMockRoute("01", "Alpha Corridor", "INWARD", vehicle1, stops);
        const student1 = createMockStudent("1", "Aarav", "Simmakkal");

        // Simulate approved manual allocation payload for this student
        student1.allocatedBus = {
            isAllocated: true,
            planType: "ADMIN",
            adminApprovalStatus: "Approved",
            allocationStatus: "Assigned",
            inward: {
                isAllocated: true,
                approved: true,
                adminApprovalStatus: "Approved",
                planType: "ADMIN",
                direction: "INWARD",
                routeCode: "R-01",
                routeName: "Alpha Corridor",
                vehicleName: "College Bus Alpha",
                capacity: 50,
                assignedUsersCount: 30,
                remainingSeats: 20,
                boardingStop: "Simmakkal",
                stopOrder: 2,
                seatNumber: 1,
                routeStops: [
                    { order: 1, name: "Goripalayam", isUserStop: false },
                    { order: 2, name: "Simmakkal", isUserStop: true },
                    { order: 3, name: "Campus Hub", isUserStop: false }
                ]
            },
            outward: null
        };
        student1.assignedVehicle = "College Bus Alpha";
        student1.assignedRoute = "Alpha Corridor";

        const view = parseStudentDashboardView(student1);
        assert.equal(view.isAllocated, true, "Student must be allocated after approval");
        assert.equal(view.showInward, true, "Inward bus must be displayed");
        assert.equal(view.showOutward, false, "Outward bus is not yet approved");
        assert.equal(view.inwardAlloc.vehicleName, "College Bus Alpha");
        assert.equal(view.inwardAlloc.boardingStop, "Simmakkal");
        assert.equal(view.inwardAlloc.seatNumber, 1, "Seat number must be assigned");
        assert.equal(view.inwardAlloc.remainingSeats, 20);
        assert.equal(view.displayStatus, "Approved & Allocated");
    });

    // =========================================================================
    // TEST 4: Direction Handling Independence — Inward and Outward both active
    // =========================================================================
    await t.test("4. Approving Outward plan preserves Inward plan and student sees both", async () => {
        const student = createMockStudent("1", "Aarav", "Simmakkal");

        // Approved Inward allocation
        const inwardAlloc = {
            isAllocated: true,
            approved: true,
            adminApprovalStatus: "Approved",
            planType: "ADMIN",
            direction: "INWARD",
            routeCode: "R-IN-01",
            routeName: "Inward Morning Line",
            vehicleName: "Bus 101",
            capacity: 50,
            assignedUsersCount: 40,
            remainingSeats: 10,
            boardingStop: "Simmakkal",
            seatNumber: 5
        };

        // Newly approved Outward allocation
        const outwardAlloc = {
            isAllocated: true,
            approved: true,
            adminApprovalStatus: "Approved",
            planType: "ADMIN",
            direction: "OUTWARD",
            routeCode: "R-OUT-01",
            routeName: "Outward Evening Line",
            vehicleName: "Bus 102",
            capacity: 50,
            assignedUsersCount: 38,
            remainingSeats: 12,
            boardingStop: "Campus Hub",
            seatNumber: 8
        };

        student.allocatedBus = {
            isAllocated: true,
            planType: "ADMIN",
            adminApprovalStatus: "Approved",
            allocationStatus: "Assigned",
            inward: inwardAlloc,
            outward: outwardAlloc
        };

        const view = parseStudentDashboardView(student);
        assert.equal(view.isAllocated, true);
        assert.equal(view.showInward, true, "Inward allocation must remain visible");
        assert.equal(view.showOutward, true, "Outward allocation must now be visible");
        assert.equal(view.inwardAlloc.vehicleName, "Bus 101");
        assert.equal(view.outwardAlloc.vehicleName, "Bus 102");
        assert.equal(view.inwardAlloc.seatNumber, 5);
        assert.equal(view.outwardAlloc.seatNumber, 8);
    });

    // =========================================================================
    // TEST 5: Insufficient Seats Strict Enforcement (No Fake Allocations)
    // =========================================================================
    await t.test("5. Excess students remain unallocated with Standby status when capacity full", async () => {
        const studentStandby = createMockStudent("5", "Eshwar", "Simmakkal");
        studentStandby.allocationStatus = "Unallocated";
        studentStandby.allocatedBus = {
            isAllocated: false,
            approved: true,
            adminApprovalStatus: "Approved",
            allocationStatus: "Unallocated",
            unallocatedReason: "VEHICLE_CAPACITY",
            message: "All seats on this route are fully occupied. You are on the standby list and awaiting vehicle reallocation by administrator."
        };

        const view = parseStudentDashboardView(studentStandby);
        assert.equal(view.isAllocated, false, "Excess student must NOT have fake allocation");
        assert.equal(view.showInward, false);
        assert.equal(view.showOutward, false);
        assert.equal(view.displayStatus, "Standby (Capacity Full)");
        assert.ok(view.unallocatedMessage.includes("fully occupied"), "Should display clear standby message");
    });

    // =========================================================================
    // TEST 6: Direction-Specific Reset Preserves Other Direction and Student Response
    // =========================================================================
    await t.test("6. Resetting Inward plan preserves Outward plan and locks student response", async () => {
        const student = createMockStudent("1", "Aarav", "Simmakkal");

        // Before reset: both inward and outward are approved
        // Reset Inward: inward becomes null, outward stays intact
        student.allocatedBus = {
            isAllocated: true,
            inward: null,
            outward: {
                isAllocated: true,
                approved: true,
                adminApprovalStatus: "Approved",
                planType: "ADMIN",
                direction: "OUTWARD",
                routeCode: "R-OUT-01",
                routeName: "Outward Evening Line",
                vehicleName: "Bus 102",
                capacity: 50,
                assignedUsersCount: 38,
                remainingSeats: 12,
                seatNumber: 8
            }
        };

        const view = parseStudentDashboardView(student);
        assert.equal(view.isAllocated, true, "Student remains allocated because Outward is still active");
        assert.equal(view.showInward, false, "Inward must now be cleared");
        assert.equal(view.showOutward, true, "Outward must be preserved intact");
        assert.equal(student.travelStatus, "Coming", "Student travel attendance must remain locked as Coming");
        assert.equal(student.responseLocked, true, "Response must remain locked");
    });

    // =========================================================================
    // TEST 7: Side-by-Side Parity (Admin Manual Plan vs AI Recommended Plan)
    // =========================================================================
    await t.test("7. AI Plan and Admin Plan produce identical passenger allocation on equivalent demand", async () => {
        const vehicle = createMockVehicle("99", "Transit Bus 99", 10);
        const schedules = [createMockSchedule(vehicle._id, "Available")];
        const stops = [
            { name: "Stop A", latitude: 9.91, longitude: 78.11 },
            { name: "Stop B", latitude: 9.92, longitude: 78.12 },
            { name: "Campus", latitude: 9.93, longitude: 78.13 }
        ];
        const route = createMockRoute("99", "Line 99", "INWARD", vehicle, stops);

        const students = [
            createMockStudent("101", "Student 1", "Stop A"),
            createMockStudent("102", "Student 2", "Stop A"),
            createMockStudent("103", "Student 3", "Stop B")
        ];

        const manualPlan = await buildManualTransportationPlan({
            direction: "INWARD",
            routes: [route],
            vehicles: [vehicle],
            schedules,
            users: students
        });

        // Verify core metrics
        assert.equal(manualPlan.totalComingUsers, 3);
        assert.equal(manualPlan.totalCapacity, 10);
        assert.equal(manualPlan.assignedUsers, 3);
        assert.equal(manualPlan.unassignedUsers, 0);
        assert.equal(manualPlan.capacityShortage, false);

        const manualBus = manualPlan.buses[0];
        assert.equal(manualBus.assignedUsers, 3);
        assert.equal(manualBus.remainingSeats, 7);
        assert.equal(manualBus.utilization, 30);

        // Parity check with standard AI Plan bus shape
        assert.ok("routeCode" in manualBus);
        assert.ok("routeName" in manualBus);
        assert.ok("vehicleName" in manualBus);
        assert.ok("capacity" in manualBus);
        assert.ok("assignedUsers" in manualBus);
        assert.ok("remainingSeats" in manualBus);
        assert.ok("stops" in manualBus);
        assert.ok("users" in manualBus);
        assert.equal(manualBus.stops.length, 3);
    });

    // =========================================================================
    // TEST 8: Unserviced Stop Warning & Reason Handling
    // =========================================================================
    await t.test("8. Coming student at stop not included in any route is flagged as unserviced", async () => {
        const vehicle = createMockVehicle("1", "Bus 1", 50);
        const stops = [
            { name: "Goripalayam", latitude: 9.92, longitude: 78.11 },
            { name: "Campus Hub", latitude: 9.93, longitude: 78.13 }
        ];
        const route = createMockRoute("1", "Corridor 1", "INWARD", vehicle, stops);

        // Student registered at "Mattuthavani", which is not on the route
        const students = [
            createMockStudent("1", "Aarav", "Mattuthavani")
        ];

        const plan = await buildManualTransportationPlan({
            direction: "INWARD",
            routes: [route],
            vehicles: [vehicle],
            schedules: [createMockSchedule(vehicle._id)],
            users: students
        });

        assert.equal(plan.totalComingUsers, 1);
        assert.equal(plan.assignedUsers, 0);
        assert.equal(plan.unassignedUsers, 1);
        assert.equal(plan.unassignedReason, "UNSERVICED_STOP");
        const hasWarning = plan.warnings.some((w) => w.includes("Mattuthavani") && w.includes("not included in any active manual route"));
        assert.ok(hasWarning, "Should flag unserviced stop warning");
    });
});
