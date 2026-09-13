import assert from "node:assert/strict";
import test from "node:test";
import {
    buildManualTransportationPlan,
    calculateStopMatchScore,
    persistPlanToUsers
} from "../services/aiAgentService.js";

test("Admin Manual Passenger Allocation Workflow Test Suite", async (t) => {

    function createMockVehicle(id, name, capacity) {
        return {
            _id: `veh_${id}`,
            vehicleName: name,
            vehicleNumber: `TN-58-${id}`,
            capacity,
            status: "Available"
        };
    }

    function createMockRoute(id, routeName, direction, vehicle, source, stops, destination) {
        return {
            _id: `route_${id}`,
            routeName,
            routeCode: `R-${String(id).padStart(2, "0")}`,
            direction,
            assignedVehicle: vehicle,
            source: { name: source, latitude: 9.92, longitude: 78.11 },
            stops: stops.map((s, idx) => ({ name: s, latitude: 9.92 + idx * 0.01, longitude: 78.11 + idx * 0.01 })),
            destination: { name: destination, latitude: 9.95, longitude: 78.15 }
        };
    }

    function createMockStudent(id, name, stopName, travelStatus = "Coming") {
        return {
            _id: `mongo_${id}`,
            userId: `USR_${id}`,
            name,
            role: "student",
            travelStatus,
            stoppings: stopName,
            city: "Madurai",
            district: "Madurai",
            state: "Tamil Nadu",
            country: "India",
            allocatedBus: null
        };
    }

    // =========================================================================
    // TEST 1: Fuzzy Stop Matching Accuracy
    // =========================================================================
    await t.test("1. calculateStopMatchScore matches stops with punctuation, aliases, and suffixes", () => {
        // Exact
        assert.equal(calculateStopMatchScore("Anna Nagar", "Anna Nagar"), 100);
        // Normalized
        assert.ok(calculateStopMatchScore("K.Pudur", "K-Pudur") >= 90);
        assert.ok(calculateStopMatchScore("Bibikulam", "B B Kulam") >= 90);
        assert.ok(calculateStopMatchScore("KK Nagar", "K.K. Nagar West") >= 80);
        assert.ok(calculateStopMatchScore("Periyar", "Periyar Nagar Road") >= 75);
        assert.ok(calculateStopMatchScore("Goripalayam", "Goripalayam Mosque") >= 75);
        assert.ok(calculateStopMatchScore("Sellur", "Sellur (Madurai)") >= 75);
        assert.ok(calculateStopMatchScore("Kochadai Junction", "Kochadai") >= 75);
        assert.ok(calculateStopMatchScore("Avaniyapuram", "Avaniyapuram Canal") >= 75);

        // Unrelated stops must NOT match
        assert.equal(calculateStopMatchScore("Anna Nagar", "Simmakkal"), 0);
        assert.equal(calculateStopMatchScore("Villapuram", "Thiruppalai"), 0);
    });

    // =========================================================================
    // TEST 2: 400 Coming Users Allocated to Manually Created Routes
    // =========================================================================
    await t.test("2. Large fleet of 400 coming users correctly allocates to routes and buses", async () => {
        // Create 8 buses totaling 515 capacity
        const v1 = createMockVehicle("1", "J1", 70);
        const v2 = createMockVehicle("2", "A2", 70);
        const v3 = createMockVehicle("3", "AS@", 70);
        const v4 = createMockVehicle("4", "gurus", 70);
        const v5 = createMockVehicle("5", "guru", 70);
        const v6 = createMockVehicle("6", "k1", 70);
        const v7 = createMockVehicle("7", "F", 45);
        const v8 = createMockVehicle("8", "Q1", 50);

        const vehicles = [v1, v2, v3, v4, v5, v6, v7, v8];
        const schedules = vehicles.map(v => ({ vehicle: v._id, availability: "Available" }));

        // 8 routes matching the actual database configuration
        const routes = [
            createMockRoute("1", "East route", "OUTWARD", v1, "Anna Nagar", ["KK Nagar"], "Walk-King Shoe Company - KK Nagar"),
            createMockRoute("2", "East route 2", "OUTWARD", v2, "Mattuthavani", ["Othakadai", "Vandiyur"], "Teppakulam"),
            createMockRoute("3", "central route", "OUTWARD", v3, "Periyar Nagar Road", ["Simmakkal"], "Arappalayam"),
            createMockRoute("4", "central route 2", "OUTWARD", v4, "Goripalayam Mosque", ["Narimedu", "Tallakulam"], "B B Kulam"),
            createMockRoute("5", "North route", "OUTWARD", v5, "Pudur", ["K-Pudur", "Iyer Bungalow"], "Thiruppalai"),
            createMockRoute("6", "north-west route", "OUTWARD", v6, "Sellur (Madurai)", ["Koodal Nagar", "Vilangudi"], "Kochadai"),
            createMockRoute("7", "south route", "OUTWARD", v7, "Palanganatham", ["Jaihindpuram"], "Alagappan Nagar"),
            createMockRoute("8", "south route 2", "OUTWARD", v8, "Villapuram", ["Avaniyapuram Canal", "Anuppanadi"], "Thirunagar")
        ];

        // 346 students distributed across all stops
        const stopDistribution = [
            { stop: "Arappalayam", count: 24 },
            { stop: "Anna Nagar", count: 22 },
            { stop: "Simmakkal", count: 19 },
            { stop: "Goripalayam", count: 18 },
            { stop: "Tallakulam", count: 18 },
            { stop: "K.K. Nagar West", count: 16 },
            { stop: "Othakadai", count: 15 },
            { stop: "KK Nagar", count: 15 },
            { stop: "Vandiyur", count: 14 },
            { stop: "Mattuthavani", count: 13 },
            { stop: "Teppakulam", count: 13 },
            { stop: "Koodal Nagar", count: 12 },
            { stop: "K.Pudur", count: 11 },
            { stop: "Iyer Bungalow", count: 11 },
            { stop: "Kochadai", count: 10 },
            { stop: "Thiruppalai", count: 10 },
            { stop: "Vilangudi", count: 10 },
            { stop: "Villapuram", count: 9 },
            { stop: "Kochadai Junction", count: 9 },
            { stop: "Alagappan Nagar", count: 8 },
            { stop: "Pudur", count: 8 },
            { stop: "Jaihindpuram", count: 8 },
            { stop: "Avaniyapuram", count: 8 },
            { stop: "Periyar", count: 8 },
            { stop: "Anuppanadi", count: 7 },
            { stop: "Narimedu", count: 7 },
            { stop: "Thirunagar", count: 7 },
            { stop: "Palanganatham", count: 6 },
            { stop: "Sellur", count: 6 },
            { stop: "Bibikulam", count: 4 }
        ];

        const students = [];
        let sIdx = 1;
        for (const dist of stopDistribution) {
            for (let i = 0; i < dist.count; i++) {
                students.push(createMockStudent(String(sIdx), `Student_${sIdx}`, dist.stop, "Coming"));
                sIdx++;
            }
        }

        assert.equal(students.length, 346, "Must have 346 coming students");

        const plan = await buildManualTransportationPlan({
            direction: "OUTWARD",
            routes,
            vehicles,
            schedules,
            users: students
        });

        assert.equal(plan.planType, "ADMIN");
        assert.equal(plan.direction, "OUTWARD");
        assert.equal(plan.totalComingUsers, 346);
        assert.equal(plan.assignedUsers, 346, "All 346 students must be assigned");
        assert.equal(plan.unassignedUsers, 0, "Zero unassigned students");
        assert.equal(plan.totalCapacity, 515);
        assert.equal(plan.buses.length, 8);

        // Verify capacity is never exceeded on any bus
        for (const bus of plan.buses) {
            assert.ok(bus.assignedUsers <= bus.capacity, `Bus ${bus.vehicleName} assigned users cannot exceed capacity`);
            assert.equal(bus.assignedUsers, bus.users.length, `Bus ${bus.vehicleName} assignedUsers must equal users length`);
            assert.equal(bus.remainingSeats, bus.capacity - bus.assignedUsers);
            assert.ok(bus.assignedUsers > 0, `Bus ${bus.vehicleName} must have passengers allocated`);

            // Verify unique seat numbers (no duplicates)
            const uniqueUserIds = new Set(bus.users);
            assert.equal(uniqueUserIds.size, bus.users.length, `Bus ${bus.vehicleName} must have unique student assignments`);
        }
    });

    // =========================================================================
    // TEST 3: Vehicle Capacity Strict Enforcement & Standby Users
    // =========================================================================
    await t.test("3. When demand exceeds bus capacity, excess users remain unallocated as Standby", async () => {
        const v = createMockVehicle("1", "Small Van", 5);
        const schedules = [{ vehicle: v._id, availability: "Available" }];
        const route = createMockRoute("1", "Van Route", "INWARD", v, "Anna Nagar", [], "Campus");

        // 8 students at Anna Nagar, capacity only 5
        const students = [
            createMockStudent("1", "A1", "Anna Nagar"),
            createMockStudent("2", "A2", "Anna Nagar"),
            createMockStudent("3", "A3", "Anna Nagar"),
            createMockStudent("4", "A4", "Anna Nagar"),
            createMockStudent("5", "A5", "Anna Nagar"),
            createMockStudent("6", "A6", "Anna Nagar"), // Excess
            createMockStudent("7", "A7", "Anna Nagar"), // Excess
            createMockStudent("8", "A8", "Anna Nagar")  // Excess
        ];

        const plan = await buildManualTransportationPlan({
            direction: "INWARD",
            routes: [route],
            vehicles: [v],
            schedules,
            users: students
        });

        assert.equal(plan.totalComingUsers, 8);
        assert.equal(plan.totalCapacity, 5);
        assert.equal(plan.assignedUsers, 5, "Must allocate strictly up to capacity 5");
        assert.equal(plan.unassignedUsers, 3, "Exactly 3 users must remain unallocated as Standby");
        assert.equal(plan.capacityShortage, true);
        assert.equal(plan.unassignedReason, "VEHICLE_CAPACITY");

        const bus = plan.buses[0];
        assert.equal(bus.assignedUsers, 5);
        assert.equal(bus.remainingSeats, 0);
        assert.equal(bus.users.length, 5);
    });

    // =========================================================================
    // TEST 4: No Duplicate Allocation across Multiple Routes
    // =========================================================================
    await t.test("4. A student cannot be allocated to two routes in the same direction", async () => {
        const v1 = createMockVehicle("1", "Bus 1", 50);
        const v2 = createMockVehicle("2", "Bus 2", 50);
        const schedules = [
            { vehicle: v1._id, availability: "Available" },
            { vehicle: v2._id, availability: "Available" }
        ];

        // Both routes stop at Simmakkal
        const r1 = createMockRoute("1", "Route 1", "OUTWARD", v1, "Simmakkal", [], "Periyar");
        const r2 = createMockRoute("2", "Route 2", "OUTWARD", v2, "Simmakkal", [], "Goripalayam");

        const students = [
            createMockStudent("1", "Aarav", "Simmakkal"),
            createMockStudent("2", "Bhavna", "Simmakkal")
        ];

        const plan = await buildManualTransportationPlan({
            direction: "OUTWARD",
            routes: [r1, r2],
            vehicles: [v1, v2],
            schedules,
            users: students
        });

        assert.equal(plan.totalComingUsers, 2);
        assert.equal(plan.assignedUsers, 2);

        // Verify that neither student is present on both buses
        const bus1Users = new Set(plan.buses[0].users);
        const bus2Users = new Set(plan.buses[1].users);

        for (const u of bus1Users) {
            assert.ok(!bus2Users.has(u), `Student ${u} must not be allocated to Bus 2 if allocated to Bus 1`);
        }
    });

    // =========================================================================
    // TEST 5: Non-Coming Students Ignored
    // =========================================================================
    await t.test("5. Students with travelStatus 'Not Coming' or 'Pending' are not allocated", async () => {
        const v = createMockVehicle("1", "Bus Alpha", 50);
        const schedules = [{ vehicle: v._id, availability: "Available" }];
        const route = createMockRoute("1", "Route Alpha", "INWARD", v, "Anna Nagar", [], "Campus");

        const students = [
            createMockStudent("1", "Coming Student", "Anna Nagar", "Coming"),
            createMockStudent("2", "Not Coming Student", "Anna Nagar", "Not Coming"),
            createMockStudent("3", "Pending Student", "Anna Nagar", "Pending")
        ];

        const plan = await buildManualTransportationPlan({
            direction: "INWARD",
            routes: [route],
            vehicles: [v],
            schedules,
            users: students
        });

        assert.equal(plan.totalComingUsers, 1, "Only 1 student has travelStatus Coming");
        assert.equal(plan.assignedUsers, 1);
        assert.equal(plan.unassignedUsers, 0);
        assert.equal(plan.buses[0].users.length, 1);
        assert.equal(plan.buses[0].users[0], "mongo_1");
    });
});
