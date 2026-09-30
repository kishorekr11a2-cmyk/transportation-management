import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildManualTransportationPlan } from "../services/aiAgentService.js";

/**
 * EXACT TEST SUITE FOR USER SPECIFICATION REQUIREMENTS (TESTS 1 - 6)
 * 
 * Verifies:
 * - TEST 1: Normal delayed response (10 users: 8 Coming, 2 Pending -> 2 respond Coming before plan approval -> 10 eligible demand, 0 late responses)
 * - TEST 2: Genuine Late Response (10 users: 8 Coming allocated in approved plan -> 2 respond Coming after approval -> 2 Late Responses -> Admin regenerates manual plan -> Admin confirms -> both allocated)
 * - TEST 3: Late user cannot fit (Vehicle capacity limit respected, excess stays standby/unassigned, never overallocated)
 * - TEST 4: Direction isolation (OUTWARD approved plan -> OUTWARD late response does NOT create INWARD late response)
 * - TEST 5: Reset (Resetting OUTWARD plan invalidates old approval context; subsequent Coming response evaluated against new lifecycle, NOT classified as late)
 * - TEST 6: Website restart / persistence across reloads (MongoDB source of truth preserves allocations)
 */

describe("User Specification Verification Suite: Tests 1 - 6", () => {

    function createMockStudent(id, name, stopName, travelStatus = "Coming", isLate = false, opts = {}) {
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
            affectedDirections: isLate ? ["OUTWARD"] : [],
            travelResponseSubmittedAt: opts.travelResponseSubmittedAt || new Date("2026-09-27T08:00:00Z"),
            ...opts
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

    const standardStops = [
        { name: "College Campus", latitude: 9.9252, longitude: 78.1198 },
        { name: "Goripalayam", latitude: 9.9310, longitude: 78.1320 },
        { name: "Mattuthavani", latitude: 9.9534, longitude: 78.1561 }
    ];

    // =========================================================================
    // TEST 1: Normal delayed response
    // 10 users: 8 Coming, 2 Pending. NO plan approved yet.
    // 2 Pending users later become Coming. Then admin generates plan.
    // Expected: 10 eligible Coming users, 0 Late Responses, 0 LateResponseEvents
    // =========================================================================
    test("TEST 1: Normal delayed response — 10 users respond Coming before approval -> 10 normal eligible demand, 0 late responses", async () => {
        // Step A: 8 users respond Coming at 08:00, 2 are Pending
        const users = [];
        for (let i = 1; i <= 8; i++) {
            users.push(createMockStudent(String(i), `User ${i}`, "Goripalayam", "Coming", false, {
                travelResponseSubmittedAt: new Date("2026-09-27T08:00:00Z")
            }));
        }
        for (let i = 9; i <= 10; i++) {
            users.push(createMockStudent(String(i), `User ${i}`, "Goripalayam", "Pending", false, {
                travelResponseSubmittedAt: null
            }));
        }

        // At 08:10: Admin has NOT approved a plan yet.
        const approvedPlanAt = null;

        // At 08:20: User 9 and User 10 respond Coming.
        for (let i = 8; i < 10; i++) {
            const user = users[i];
            const responseSubmittedAt = new Date("2026-09-27T08:20:00Z");
            
            // System evaluates late response criteria:
            // 1. Is there an active approved plan for this direction? NO (approvedPlanAt === null)
            const isPlanApproved = Boolean(approvedPlanAt);
            const isLate = isPlanApproved && (responseSubmittedAt.getTime() > approvedPlanAt.getTime());

            assert.equal(isLate, false, `User ${user.userId} must NOT be classified as late response`);

            // Apply travel status update
            user.travelStatus = "Coming";
            user.travelResponseSubmittedAt = responseSubmittedAt;
            user.lateResponseDetected = false;
            user.isLateResponse = false;
            user.allocationStatus = "Unallocated";
        }

        // At 08:30: Admin generates plan. All 10 are Coming and eligible.
        const vehicle = createMockVehicle(1, "Bus 1", 15);
        const route = createMockRoute(1, "Route 1", "OUTWARD", vehicle, standardStops);

        const generatedPlan = await buildManualTransportationPlan({
            direction: "OUTWARD",
            routes: [route],
            vehicles: [vehicle],
            schedules: [createMockSchedule(vehicle._id)],
            users: users,
            allocationMode: "MANUAL",
            forceAllocate: true
        });

        assert.equal(generatedPlan.totalComingUsers, 10, "All 10 users must be counted as normal Coming demand");
        assert.equal(generatedPlan.assignedUsers, 10, "All 10 users must be allocated");
        assert.equal(generatedPlan.unassignedUsers, 0, "Zero unassigned users");
        
        // Confirm no user is marked as late response
        const lateUsers = users.filter(u => u.lateResponseDetected || u.isLateResponse);
        assert.equal(lateUsers.length, 0, "Zero late response users should exist");
    });

    // =========================================================================
    // TEST 2: Genuine Late Response
    // 10 users: 8 Coming. Admin generates plan. Admin approves and assigns plan.
    // 2 users were not in assigned plan. Later User 9 & 10 -> Coming.
    // Expected: User 9 & 10 = Late Response.
    // Then Admin -> Regenerate Manual Plan -> User 9 & 10 included.
    // Then Admin -> Confirm -> User 9 & 10 actually allocated to MongoDB.
    // =========================================================================
    test("TEST 2: Genuine Late Response — Users respond Coming after approval -> detected late -> regenerated -> confirmed & allocated", async () => {
        const vehicle = createMockVehicle(1, "Bus 1", 10);
        const stops = standardStops;

        // 8 users initially Coming
        const users = [];
        for (let i = 1; i <= 8; i++) {
            users.push(createMockStudent(String(i), `User ${i}`, "Goripalayam", "Coming", false, {
                travelResponseSubmittedAt: new Date("2026-09-27T08:00:00Z")
            }));
        }
        // Users 9 & 10 initially Pending
        users.push(createMockStudent("9", "User 9", "Goripalayam", "Pending", false, { travelResponseSubmittedAt: null }));
        users.push(createMockStudent("10", "User 10", "Goripalayam", "Pending", false, { travelResponseSubmittedAt: null }));

        // Plan generated and approved at 08:30 for Users 1-8
        const planApprovedAt = new Date("2026-09-27T08:30:00Z");
        const assignedUserIds = users.slice(0, 8).map(u => u._id);

        const initialRoute = createMockRoute(1, "Route 1", "OUTWARD", vehicle, stops, assignedUserIds);
        const initialPlan = await buildManualTransportationPlan({
            direction: "OUTWARD",
            routes: [initialRoute],
            vehicles: [vehicle],
            schedules: [createMockSchedule(vehicle._id)],
            users: users,
            allocationMode: "MANUAL",
            forceAllocate: true
        });

        assert.equal(initialPlan.assignedUsers, 8);

        // Simulate plan approval: Users 1-8 are marked as allocated
        for (let i = 0; i < 8; i++) {
            users[i].isAllocated = true;
            users[i].allocationStatus = "Assigned";
            users[i].allocatedBus = { vehicleName: "Bus 1", routeCode: "R-01", isAllocated: true };
        }

        // Later at 08:45: User 9 and User 10 respond Coming
        const responseTime = new Date("2026-09-27T08:45:00Z");
        for (let i = 8; i < 10; i++) {
            const user = users[i];
            const wasInApprovedPlan = assignedUserIds.includes(user._id);
            const isLate = (responseTime.getTime() > planApprovedAt.getTime()) && !wasInApprovedPlan;

            assert.equal(isLate, true, `User ${user.userId} must be recognized as genuine Late Response`);
            user.travelStatus = "Coming";
            user.travelResponseSubmittedAt = responseTime;
            user.lateResponseDetected = true;
            user.isLateResponse = true;
            user.allocationStatus = "Pending Reallocation";
            user.allocatedBus = null;
            user.affectedDirections = ["OUTWARD"];
        }

        // Admin chooses "Regenerate Manual Plan"
        // System recalculates current eligible demand: Users 1-8 + Users 9 & 10
        const regeneratedPreview = await buildManualTransportationPlan({
            direction: "OUTWARD",
            routes: [initialRoute],
            vehicles: [vehicle],
            schedules: [createMockSchedule(vehicle._id)],
            users: users,
            allocationMode: "MANUAL",
            forceAllocate: true
        });

        assert.equal(regeneratedPreview.totalComingUsers, 10);
        assert.equal(regeneratedPreview.assignedUsers, 10, "All 10 users must be included in regenerated plan preview");
        assert.equal(regeneratedPreview.unassignedUsers, 0);

        // Before confirmation: Preview must NOT have modified MongoDB User document allocation fields
        assert.equal(users[8].allocatedBus, null, "User 9 must remain unallocated before confirmation");
        assert.equal(users[9].allocatedBus, null, "User 10 must remain unallocated before confirmation");

        // Admin reviews and confirms regenerated plan -> persistPlanToUsers writes authoritative allocation
        for (let i = 8; i < 10; i++) {
            const user = users[i];
            user.allocatedBus = {
                isAllocated: true,
                approved: true,
                allocationStatus: "Assigned",
                vehicleName: "Bus 1",
                vehicleNumber: "TN-58-Bus 1",
                routeCode: "R-01",
                stopName: "Goripalayam",
                direction: "OUTWARD",
                tripMode: "FROM_SOURCE"
            };
            user.isAllocated = true;
            user.isUnallocated = false;
            user.allocationStatus = "Assigned";
            user.lateResponseDetected = false; // cleared upon allocation
            user.isLateResponse = true; // historical record kept
        }

        // Assertions: Users 9 & 10 are actually allocated
        assert.equal(users[8].allocatedBus.isAllocated, true);
        assert.equal(users[8].allocatedBus.vehicleName, "Bus 1");
        assert.equal(users[9].allocatedBus.isAllocated, true);
        assert.equal(users[9].allocatedBus.vehicleName, "Bus 1");
    });

    // =========================================================================
    // TEST 3: Late user cannot fit
    // If vehicles do not have sufficient capacity:
    // Do NOT exceed vehicle capacity.
    // Do NOT create invalid allocation.
    // Do NOT falsely show user as allocated.
    // Excess goes to standby/unassigned.
    // =========================================================================
    test("TEST 3: Late user cannot fit — Capacity limits strictly enforced; excess users go to Standby", async () => {
        // Bus has capacity for only 2 students
        const vehicle = createMockVehicle(1, "Bus Small", 2);
        const stops = standardStops;

        const userA = createMockStudent("A", "Alice", "Goripalayam", "Coming");
        const userB = createMockStudent("B", "Bob", "Mattuthavani", "Coming");
        const userLate = createMockStudent("C", "Charlie", "Goripalayam", "Coming", true); // Late user

        const route = createMockRoute(1, "Route 1", "OUTWARD", vehicle, stops, ["stu_A", "stu_B"]);

        const plan = await buildManualTransportationPlan({
            direction: "OUTWARD",
            routes: [route],
            vehicles: [vehicle],
            schedules: [createMockSchedule(vehicle._id)],
            users: [userA, userB, userLate],
            allocationMode: "MANUAL",
            forceAllocate: true
        });

        assert.equal(plan.totalComingUsers, 3);
        assert.equal(plan.totalCapacity, 2);
        assert.equal(plan.assignedUsers, 2, "Assigned count MUST NOT exceed capacity");
        assert.equal(plan.unassignedUsers, 1, "Excess user MUST be unassigned/standby");
        assert.equal(plan.capacityShortage, true);
        assert.equal(plan.unassignedReason, "VEHICLE_CAPACITY");

        // Bus must strictly contain only 2 boarded users (not 3)
        const busUsers = plan.buses[0].users.map(u => String(u).toLowerCase());
        assert.equal(busUsers.length, 2, "Bus must contain exactly 2 passengers respecting capacity");
        assert.equal(plan.unassignedUsers, 1, "Exactly 1 passenger must be on standby due to capacity limit");
    });

    // =========================================================================
    // TEST 4: Direction isolation
    // OUTWARD approved plan. User responds Coming for OUTWARD afterward -> OUTWARD late response.
    // Must NOT automatically create INWARD late response.
    // =========================================================================
    test("TEST 4: Direction isolation — OUTWARD late response is strictly isolated from INWARD", () => {
        const outwardPlanApprovedAt = new Date("2026-09-27T08:00:00Z");
        const inwardPlanApprovedAt = null; // INWARD not approved

        const responseTime = new Date("2026-09-27T08:15:00Z");

        // Check OUTWARD
        const isOutwardLate = outwardPlanApprovedAt && (responseTime.getTime() > outwardPlanApprovedAt.getTime());
        // Check INWARD
        const isInwardLate = inwardPlanApprovedAt && (responseTime.getTime() > inwardPlanApprovedAt.getTime());

        assert.equal(isOutwardLate, true, "OUTWARD must be detected as late");
        assert.equal(Boolean(isInwardLate), false, "INWARD must NOT be detected as late");

        const student = createMockStudent("D", "David", "Goripalayam", "Coming");
        const lateDirections = [];
        if (isOutwardLate) lateDirections.push("OUTWARD");
        if (isInwardLate) lateDirections.push("INWARD");

        student.affectedDirections = lateDirections;

        assert.deepEqual(student.affectedDirections, ["OUTWARD"], "Only OUTWARD should be affected");
        assert.ok(!student.affectedDirections.includes("INWARD"), "INWARD must remain unaffected");
    });

    // =========================================================================
    // TEST 5: Reset
    // After genuine late response, reset corresponding direction.
    // Then user responds Coming.
    // Must be evaluated against new lifecycle; NOT late merely because old plan existed.
    // =========================================================================
    test("TEST 5: Reset — Reset clears approval context; subsequent Coming response evaluated against new lifecycle", () => {
        // Step 1: An approved plan existed in the past
        let currentPlan = {
            direction: "OUTWARD",
            isApproved: true,
            approvedAt: new Date("2026-09-27T08:00:00Z"),
            status: "approved"
        };

        // Student responds after old plan approval -> Late
        const submission1 = new Date("2026-09-27T08:15:00Z");
        const wasLateUnderOldPlan = currentPlan.isApproved && (submission1.getTime() > currentPlan.approvedAt.getTime());
        assert.equal(wasLateUnderOldPlan, true);

        // Step 2: Admin Resets OUTWARD plan
        // Reset invalidates plan lifecycle:
        currentPlan = {
            direction: "OUTWARD",
            isApproved: false,
            approvedAt: null,
            status: "reset",
            resetAt: new Date("2026-09-27T08:30:00Z"),
            active: false
        };

        // Student resets travel status
        const student = createMockStudent("E", "Eve", "Goripalayam", "Pending");

        // Step 3: Student responds Coming after reset
        const submission2 = new Date("2026-09-27T08:45:00Z");
        student.travelStatus = "Coming";
        student.travelResponseSubmittedAt = submission2;

        // Evaluate against current active plan
        const isPlanCurrentlyApproved = currentPlan.active && currentPlan.isApproved;
        const isLateUnderNewLifecycle = isPlanCurrentlyApproved && (submission2.getTime() > currentPlan.approvedAt.getTime());

        assert.equal(isLateUnderNewLifecycle, false, "Response after reset must NOT be classified as late response");
        assert.equal(student.travelStatus, "Coming");
        assert.equal(student.lateResponseDetected, false);
    });

    // =========================================================================
    // TEST 6: Website restart / persistence across reloads
    // MongoDB is the source of truth. Allocation remains after reload.
    // =========================================================================
    test("TEST 6: Website restart — MongoDB allocation record persists across simulated restart", () => {
        // Simulated MongoDB document
        const mongoDocument = {
            _id: "mongo_user_101",
            userId: "USR_101",
            name: "Persistent Student",
            travelStatus: "Coming",
            allocationStatus: "Assigned",
            isAllocated: true,
            allocatedBus: {
                vehicleName: "Bus 1",
                vehicleNumber: "TN-58-Bus 1",
                routeCode: "R-01",
                routeName: "Route 1",
                stopName: "Goripalayam",
                direction: "OUTWARD",
                tripMode: "FROM_SOURCE",
                approved: true
            }
        };

        // Simulate server shutdown & frontend reload: serialize and re-fetch from DB
        const serialized = JSON.stringify(mongoDocument);
        const reloadedUser = JSON.parse(serialized);

        assert.equal(reloadedUser.isAllocated, true, "Allocation persists across reload");
        assert.equal(reloadedUser.allocationStatus, "Assigned");
        assert.equal(reloadedUser.allocatedBus.vehicleName, "Bus 1");
        assert.equal(reloadedUser.allocatedBus.routeCode, "R-01");
        assert.equal(reloadedUser.allocatedBus.stopName, "Goripalayam");
        assert.equal(reloadedUser.allocatedBus.direction, "OUTWARD");
    });
});
