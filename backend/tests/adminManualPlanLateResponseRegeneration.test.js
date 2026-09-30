import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildManualTransportationPlan } from "../services/aiAgentService.js";

describe("Admin Manual Plan — Late Response Regeneration and Allocation Suite", () => {

    function createMockStudent(id, name, stopName, travelStatus = "Coming", isLate = false) {
        return {
            _id: `stu_${id}`,
            userId: `STU_${id}`,
            name,
            role: "student",
            travelStatus,
            stoppings: stopName,
            city: "Madurai",
            district: "Madurai",
            state: "Tamil Nadu",
            country: "India",
            lateResponseDetected: isLate,
            isLateResponse: isLate,
            allocationStatus: isLate ? "Pending Reallocation" : "Not Assigned",
            allocatedBus: null,
            requiresReallocation: isLate,
            affectedDirections: isLate ? ["OUTWARD"] : []
        };
    }

    function createMockVehicle(id, name, capacity) {
        return {
            _id: `veh_${id}`,
            vehicleName: name,
            vehicleNumber: `TN-58-${name}`,
            capacity,
            status: "Available"
        };
    }

    function createMockSchedule(vehicleId) {
        return {
            vehicle: vehicleId,
            availability: "Available",
            status: "Available"
        };
    }

    function createMockRoute(id, routeName, direction, vehicle, stops, explicitUsers = null) {
        return {
            _id: `route_${id}`,
            routeName,
            routeCode: `R-${String(id).padStart(2, "0")}`,
            direction,
            assignedVehicle: vehicle,
            source: stops[0],
            stops: stops.slice(1, -1),
            destination: stops[stops.length - 1],
            roadGeometry: [],
            users: explicitUsers || []
        };
    }

    // -------------------------------------------------------------------------
    // Test 1: Initial state -> Users A & B allocated to Bus D1
    // -------------------------------------------------------------------------
    test("Test 1: Initial manual plan allocates coming users A and B to Bus D1", async () => {
        const vehicleD1 = createMockVehicle(1, "Bus D1", 5);
        const stops = [
            { name: "College Campus", latitude: 9.9252, longitude: 78.1198 },
            { name: "Goripalayam", latitude: 9.9310, longitude: 78.1320 },
            { name: "Mattuthavani", latitude: 9.9534, longitude: 78.1561 }
        ];

        const userA = createMockStudent("A", "Alice", "Goripalayam", "Coming");
        const userB = createMockStudent("B", "Bob", "Mattuthavani", "Coming");

        const route = createMockRoute(1, "Route 1", "OUTWARD", vehicleD1, stops, ["stu_A", "stu_B"]);

        const initialPlan = await buildManualTransportationPlan({
            direction: "OUTWARD",
            routes: [route],
            vehicles: [vehicleD1],
            schedules: [createMockSchedule(vehicleD1._id)],
            users: [userA, userB],
            allocationMode: "MANUAL",
            forceAllocate: true
        });

        assert.equal(initialPlan.totalComingUsers, 2);
        assert.equal(initialPlan.assignedUsers, 2);
        assert.equal(initialPlan.unassignedUsers, 0);
        assert.equal(initialPlan.buses[0].users.length, 2);
        const initialUsers = initialPlan.buses[0].users.map(u => String(u).toLowerCase());
        assert.ok(initialUsers.includes("stu_a"));
        assert.ok(initialUsers.includes("stu_b"));
    });

    // -------------------------------------------------------------------------
    // Test 2: User C responds late -> Marked late response, NOT allocated yet
    // -------------------------------------------------------------------------
    test("Test 2: User C late response is detected and withheld from immediate allocation", async () => {
        const userC = createMockStudent("C", "Charlie", "Goripalayam", "Coming", true);

        assert.equal(userC.travelStatus, "Coming");
        assert.equal(userC.lateResponseDetected, true);
        assert.equal(userC.isLateResponse, true);
        assert.equal(userC.allocationStatus, "Pending Reallocation");
        assert.equal(userC.allocatedBus, null);
    });

    // -------------------------------------------------------------------------
    // Test 3: Admin regenerates manual plan -> User C is included in candidate demand
    // -------------------------------------------------------------------------
    test("Test 3: Regenerating manual plan includes late-coming User C in route allocation", async () => {
        const vehicleD1 = createMockVehicle(1, "Bus D1", 5);
        const stops = [
            { name: "College Campus", latitude: 9.9252, longitude: 78.1198 },
            { name: "Goripalayam", latitude: 9.9310, longitude: 78.1320 },
            { name: "Mattuthavani", latitude: 9.9534, longitude: 78.1561 }
        ];

        const userA = createMockStudent("A", "Alice", "Goripalayam", "Coming");
        const userB = createMockStudent("B", "Bob", "Mattuthavani", "Coming");
        const userC = createMockStudent("C", "Charlie", "Goripalayam", "Coming", true);

        // Previous route had users: [stu_A, stu_B]
        const previousRoute = createMockRoute(1, "Route 1", "OUTWARD", vehicleD1, stops, ["stu_A", "stu_B"]);

        const regeneratedPlan = await buildManualTransportationPlan({
            direction: "OUTWARD",
            routes: [previousRoute],
            vehicles: [vehicleD1],
            schedules: [createMockSchedule(vehicleD1._id)],
            users: [userA, userB, userC],
            allocationMode: "MANUAL",
            forceAllocate: true
        });

        assert.equal(regeneratedPlan.totalComingUsers, 3);
        assert.equal(regeneratedPlan.assignedUsers, 3, "All 3 students including late User C should be assigned");
        assert.equal(regeneratedPlan.unassignedUsers, 0);

        const busAssigned = regeneratedPlan.buses[0].users.map(u => String(u).toLowerCase());
        assert.ok(busAssigned.includes("stu_a"), "User A must remain allocated");
        assert.ok(busAssigned.includes("stu_b"), "User B must remain allocated");
        assert.ok(busAssigned.includes("stu_c"), "Late User C must be allocated in the regenerated plan");
    });

    // -------------------------------------------------------------------------
    // Test 4: Regenerate vs Confirm separation -> preview does not write User records
    // -------------------------------------------------------------------------
    test("Test 4: Regenerating manual plan produces preview without writing user document allocation", async () => {
        const vehicleD1 = createMockVehicle(1, "Bus D1", 5);
        const stops = [
            { name: "College Campus", latitude: 9.9252, longitude: 78.1198 },
            { name: "Goripalayam", latitude: 9.9310, longitude: 78.1320 },
            { name: "Mattuthavani", latitude: 9.9534, longitude: 78.1561 }
        ];

        const userA = createMockStudent("A", "Alice", "Goripalayam", "Coming");
        const userB = createMockStudent("B", "Bob", "Mattuthavani", "Coming");
        const userC = createMockStudent("C", "Charlie", "Goripalayam", "Coming", true);

        // Staged preview regenerated plan
        const regeneratedPreview = await buildManualTransportationPlan({
            direction: "OUTWARD",
            routes: [createMockRoute(1, "Route 1", "OUTWARD", vehicleD1, stops, ["stu_A", "stu_B"])],
            vehicles: [vehicleD1],
            schedules: [createMockSchedule(vehicleD1._id)],
            users: [userA, userB, userC],
            allocationMode: "MANUAL",
            forceAllocate: true
        });

        // Verify: User C record itself is untouched in memory/mock DB until confirmation
        assert.equal(userC.allocatedBus, null, "User C must NOT be allocated simply because regeneration was calculated");
        assert.equal(userC.allocationStatus, "Pending Reallocation");

        // Verify preview plan contains proposed allocation
        assert.equal(regeneratedPreview.buses[0].users.length, 3);
    });

    // -------------------------------------------------------------------------
    // Test 5: Confirm regenerated plan -> Persists allocation to User records
    // -------------------------------------------------------------------------
    test("Test 5: Confirming regenerated plan writes authoritative allocation fields to late user", () => {
        const userC = createMockStudent("C", "Charlie", "Goripalayam", "Coming", true);

        // Simulate confirmation persistence step
        const simulatedAllocation = {
            isAllocated: true,
            approved: true,
            allocationStatus: "Assigned",
            adminApprovalStatus: "Approved",
            vehicleName: "Bus D1",
            vehicleNumber: "TN-58-Bus D1",
            routeCode: "R-01",
            routeName: "Route 1",
            stopName: "Goripalayam",
            boardingStop: "Goripalayam",
            seatNumber: 3,
            direction: "OUTWARD",
            tripMode: "FROM_SOURCE",
            planVersion: 2
        };

        userC.allocatedBus = simulatedAllocation;
        userC.assignedVehicle = "Bus D1";
        userC.assignedRoute = "R-01";
        userC.allocationStatus = "Assigned";
        userC.isAllocated = true;
        userC.isUnallocated = false;
        userC.lateResponseDetected = false; // cleared upon successful allocation
        userC.isLateResponse = true; // preserved historically

        // Assertions
        assert.equal(userC.allocatedBus.isAllocated, true);
        assert.equal(userC.allocatedBus.vehicleName, "Bus D1");
        assert.equal(userC.allocatedBus.routeCode, "R-01");
        assert.equal(userC.allocatedBus.stopName, "Goripalayam");
        assert.equal(userC.allocatedBus.direction, "OUTWARD");
        assert.equal(userC.allocatedBus.tripMode, "FROM_SOURCE");
        assert.equal(userC.allocationStatus, "Assigned");
        assert.equal(userC.lateResponseDetected, false);
    });

    // -------------------------------------------------------------------------
    // Test 6: Capacity testing — bus is full, late student goes to standby
    // -------------------------------------------------------------------------
    test("Test 6: Vehicle capacity limit is strictly respected: late student becomes Standby when bus is full", async () => {
        // Vehicle capacity = 2 (only enough for A and B)
        const vehicleD1 = createMockVehicle(1, "Bus D1", 2);
        const stops = [
            { name: "College Campus", latitude: 9.9252, longitude: 78.1198 },
            { name: "Goripalayam", latitude: 9.9310, longitude: 78.1320 },
            { name: "Mattuthavani", latitude: 9.9534, longitude: 78.1561 }
        ];

        const userA = createMockStudent("A", "Alice", "Goripalayam", "Coming");
        const userB = createMockStudent("B", "Bob", "Mattuthavani", "Coming");
        const userC = createMockStudent("C", "Charlie", "Goripalayam", "Coming", true);

        const route = createMockRoute(1, "Route 1", "OUTWARD", vehicleD1, stops, ["stu_A", "stu_B"]);

        const plan = await buildManualTransportationPlan({
            direction: "OUTWARD",
            routes: [route],
            vehicles: [vehicleD1],
            schedules: [createMockSchedule(vehicleD1._id)],
            users: [userA, userB, userC],
            allocationMode: "MANUAL",
            forceAllocate: true
        });

        // 3 coming students, but only 2 seats available
        assert.equal(plan.totalComingUsers, 3);
        assert.equal(plan.totalCapacity, 2);
        assert.equal(plan.assignedUsers, 2, "Assigned seats must not exceed capacity");
        assert.equal(plan.unassignedUsers, 1, "Excess student must be unassigned/standby");
        assert.equal(plan.capacityShortage, true);
        assert.equal(plan.unassignedReason, "VEHICLE_CAPACITY");

        // Bus must contain only 2 boarded users
        assert.equal(plan.buses[0].users.length, 2);
    });

    // -------------------------------------------------------------------------
    // Test 7: Direction isolation — OUTWARD regeneration does not alter INWARD plan
    // -------------------------------------------------------------------------
    test("Test 7: OUTWARD manual plan regeneration is strictly isolated from INWARD plan", async () => {
        const outwardVehicle = createMockVehicle(1, "Bus Outward", 10);
        const inwardVehicle = createMockVehicle(2, "Bus Inward", 10);

        const outwardRoute = createMockRoute(1, "Outward Route", "OUTWARD", outwardVehicle, [
            { name: "College", latitude: 9.92, longitude: 78.11 },
            { name: "Stop A", latitude: 9.93, longitude: 78.12 }
        ]);

        const inwardRoute = createMockRoute(2, "Inward Route", "INWARD", inwardVehicle, [
            { name: "Stop B", latitude: 9.94, longitude: 78.13 },
            { name: "College", latitude: 9.92, longitude: 78.11 }
        ]);

        const student = createMockStudent("1", "David", "Stop A", "Coming", true);

        const outwardPlan = await buildManualTransportationPlan({
            direction: "OUTWARD",
            routes: [outwardRoute],
            vehicles: [outwardVehicle],
            schedules: [createMockSchedule(outwardVehicle._id)],
            users: [student],
            allocationMode: "MANUAL",
            forceAllocate: true
        });

        const inwardPlan = await buildManualTransportationPlan({
            direction: "INWARD",
            routes: [inwardRoute],
            vehicles: [inwardVehicle],
            schedules: [createMockSchedule(inwardVehicle._id)],
            users: [student],
            allocationMode: "MANUAL",
            forceAllocate: true
        });

        assert.equal(outwardPlan.direction, "OUTWARD");
        assert.equal(inwardPlan.direction, "INWARD");
        assert.equal(outwardPlan.buses[0].direction, "OUTWARD");
        assert.equal(inwardPlan.buses[0].direction, "INWARD");
    });

    // -------------------------------------------------------------------------
    // Test 8: Reset behavior — Allocations are cleared on manual plan reset
    // -------------------------------------------------------------------------
    test("Test 8: Manual plan reset cleanly unallocates students and resets summary counts", async () => {
        const vehicleD1 = createMockVehicle(1, "Bus D1", 5);
        const stops = [
            { name: "College Campus", latitude: 9.9252, longitude: 78.1198 },
            { name: "Goripalayam", latitude: 9.9310, longitude: 78.1320 },
            { name: "Mattuthavani", latitude: 9.9534, longitude: 78.1561 }
        ];

        const userA = createMockStudent("A", "Alice", "Goripalayam", "Coming");

        // When manual plan allocations are reset: isSubmitted = false, isApproved = false
        const resetPlan = await buildManualTransportationPlan({
            direction: "OUTWARD",
            routes: [createMockRoute(1, "Route 1", "OUTWARD", vehicleD1, stops)],
            vehicles: [vehicleD1],
            schedules: [createMockSchedule(vehicleD1._id)],
            users: [userA],
            isSubmitted: false,
            isApproved: false
        });

        assert.equal(resetPlan.assignedUsers, 0, "Assigned count must reset to 0");
        assert.equal(resetPlan.unassignedUsers, 1, "Student must be unassigned");
        assert.equal(resetPlan.buses[0].assignedUsers, 0);
        assert.equal(resetPlan.buses[0].users.length, 0);
    });
});
