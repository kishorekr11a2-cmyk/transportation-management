import assert from "node:assert/strict";
import test from "node:test";
import {
    buildManualTransportationPlan
} from "../services/aiAgentService.js";

test("Manual Route to AI Route Management Integration Workflow Test Suite", async (t) => {

    function createMockStudent(id, name, stopName, travelStatus = "Coming") {
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
            allocatedBus: null,
            responseLocked: true
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

    function createMockRoute(id, routeName, direction, vehicle, stops) {
        return {
            _id: `route_${id}`,
            routeName,
            routeCode: `R-${String(id).padStart(2, "0")}`,
            direction,
            assignedVehicle: vehicle,
            source: stops[0],
            stops: stops.slice(1, -1),
            destination: stops[stops.length - 1],
            roadGeometry: []
        };
    }

    // Exact Student Dashboard allocation parsing logic (parity with StudentDashboard.jsx)
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

        return {
            isAllocated: Boolean(inwardAlloc || outwardAlloc),
            inwardAlloc,
            outwardAlloc,
            showInward: Boolean(inwardAlloc),
            showOutward: Boolean(outwardAlloc),
            displayStatus: Boolean(inwardAlloc || outwardAlloc) ? "Approved & Allocated" : "Not Assigned"
        };
    }

    await t.test("1. Route Management: Saved routes exist but plan is not yet approved", async () => {
        const vehicles = [createMockVehicle(1, "Q1", 50), createMockVehicle(2, "F", 45)];
        const schedules = vehicles.map(v => createMockSchedule(v._id));

        const outwardRoutes = [
            createMockRoute(1, "South Route 2", "OUTWARD", vehicles[0], [
                { name: "College Campus", latitude: 9.9252, longitude: 78.1198 },
                { name: "Villapuram", latitude: 9.9012, longitude: 78.1250 },
                { name: "Avaniyapuram", latitude: 9.8820, longitude: 78.1180 }
            ]),
            createMockRoute(2, "South Route", "OUTWARD", vehicles[1], [
                { name: "College Campus", latitude: 9.9252, longitude: 78.1198 },
                { name: "Periyar Bus Stand", latitude: 9.9160, longitude: 78.1120 },
                { name: "Simmakkal", latitude: 9.9260, longitude: 78.1210 }
            ])
        ];

        const students = [
            createMockStudent(1, "Alice", "Villapuram", "Coming"),
            createMockStudent(2, "Bob", "Periyar Bus Stand", "Coming"),
            createMockStudent(3, "Charlie", "Simmakkal", "Coming")
        ];

        const outwardPlan = await buildManualTransportationPlan({
            direction: "OUTWARD",
            routes: outwardRoutes,
            vehicles,
            schedules,
            users: students
        });

        // Verify routes preserved
        assert.equal(outwardPlan.direction, "OUTWARD");
        assert.equal(outwardPlan.totalRoutes, 2);
        assert.equal(outwardPlan.totalCapacity, 95);
        assert.equal(outwardPlan.totalComingUsers, 3);
        assert.equal(outwardPlan.assignedUsers, 3);

        // Before approval, isApproved is false
        assert.equal(outwardPlan.isApproved, false);

        // Student Dashboard check: not yet approved -> students see "Not Assigned"
        for (const stu of students) {
            const dashboard = parseStudentDashboardView(stu);
            assert.equal(dashboard.isAllocated, false);
            assert.equal(dashboard.displayStatus, "Not Assigned");
        }
    });

    await t.test("2. Direction Isolation: OUTWARD manual routes do not appear under INWARD plan", async () => {
        const vehicles = [createMockVehicle(1, "Q1", 50)];
        const schedules = [createMockSchedule(vehicles[0]._id)];

        const outwardRoutes = [
            createMockRoute(1, "South Route 2", "OUTWARD", vehicles[0], [
                { name: "College Campus", latitude: 9.9252, longitude: 78.1198 },
                { name: "Villapuram", latitude: 9.9012, longitude: 78.1250 }
            ])
        ];

        // Querying INWARD plan when only OUTWARD routes exist
        const inwardPlan = await buildManualTransportationPlan({
            direction: "INWARD",
            routes: outwardRoutes, // pass the outward routes
            vehicles,
            schedules,
            users: []
        });

        // Must show 0 routes in INWARD
        assert.equal(inwardPlan.direction, "INWARD");
        assert.equal(inwardPlan.totalRoutes, 0);
        assert.equal(inwardPlan.buses.length, 0);
        assert.equal(inwardPlan.totalCapacity, 0);
    });

    await t.test("3. AI Route Management Approval: Allocates seats, sets approved status, makes visible to students", async () => {
        const vehicles = [createMockVehicle(1, "Q1", 50), createMockVehicle(2, "F", 45)];
        const schedules = vehicles.map(v => createMockSchedule(v._id));

        const outwardRoutes = [
            createMockRoute(1, "South Route 2", "OUTWARD", vehicles[0], [
                { name: "College Campus", latitude: 9.9252, longitude: 78.1198 },
                { name: "Villapuram", latitude: 9.9012, longitude: 78.1250 }
            ]),
            createMockRoute(2, "South Route", "OUTWARD", vehicles[1], [
                { name: "College Campus", latitude: 9.9252, longitude: 78.1198 },
                { name: "Periyar Bus Stand", latitude: 9.9160, longitude: 78.1120 }
            ])
        ];

        const students = [
            createMockStudent(1, "Alice", "Villapuram", "Coming"),
            createMockStudent(2, "Bob", "Periyar Bus Stand", "Coming")
        ];

        const manualPlan = await buildManualTransportationPlan({
            direction: "OUTWARD",
            routes: outwardRoutes,
            vehicles,
            schedules,
            users: students
        });

        // Simulate student allocations when admin approves plan in AI Route Management
        manualPlan.buses.forEach(bus => {
            (bus.stops || []).forEach(stop => {
                (stop.userIds || []).forEach((uId, idx) => {
                    const student = students.find(s => s._id === uId);
                    if (student) {
                        student.allocatedBus = student.allocatedBus || {};
                        student.allocatedBus.outward = {
                            isAllocated: true,
                            approved: true,
                            adminApprovalStatus: "Approved",
                            planType: "ADMIN",
                            direction: "OUTWARD",
                            vehicleName: bus.vehicleName,
                            routeName: bus.routeName,
                            seatNumber: idx + 1,
                            stoppingName: stop.name
                        };
                    }
                });
            });
        });

        // Verify students now see outward bus details
        const aliceView = parseStudentDashboardView(students[0]);
        assert.equal(aliceView.isAllocated, true);
        assert.equal(aliceView.showOutward, true);
        assert.equal(aliceView.showInward, false);
        assert.equal(aliceView.outwardAlloc.vehicleName, "Q1");
        assert.equal(aliceView.outwardAlloc.seatNumber, 1);
        assert.equal(aliceView.outwardAlloc.stoppingName, "Villapuram");

        const bobView = parseStudentDashboardView(students[1]);
        assert.equal(bobView.isAllocated, true);
        assert.equal(bobView.showOutward, true);
        assert.equal(bobView.showInward, false);
        assert.equal(bobView.outwardAlloc.vehicleName, "F");
        assert.equal(bobView.outwardAlloc.seatNumber, 1);
        assert.equal(bobView.outwardAlloc.stoppingName, "Periyar Bus Stand");
    });

    await t.test("4. Student with Not Coming status is never allocated to manual route", async () => {
        const vehicles = [createMockVehicle(1, "Q1", 50)];
        const schedules = [createMockSchedule(vehicles[0]._id)];

        const routes = [
            createMockRoute(1, "South Route 2", "OUTWARD", vehicles[0], [
                { name: "College Campus", latitude: 9.9252, longitude: 78.1198 },
                { name: "Villapuram", latitude: 9.9012, longitude: 78.1250 }
            ])
        ];

        const students = [
            createMockStudent(1, "Dave", "Villapuram", "Not Coming")
        ];

        const plan = await buildManualTransportationPlan({
            direction: "OUTWARD",
            routes,
            vehicles,
            schedules,
            users: students
        });

        assert.equal(plan.totalComingUsers, 0);
        assert.equal(plan.assignedUsers, 0);
        assert.equal(plan.buses[0].assignedUsers, 0);
    });
});
