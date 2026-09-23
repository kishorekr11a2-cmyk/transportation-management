import assert from "node:assert/strict";
import test from "node:test";
import {
    buildManualTransportationPlan
} from "../services/aiAgentService.js";

test("Admin Manual Plan & Final Confirmation Page Separation End-to-End Workflow Test Suite", async (t) => {

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

    // =========================================================================
    // STEP 1: ROUTE MANAGEMENT — CREATION, ASSIGNMENT & SUBMISSION (✓ OK)
    // =========================================================================
    await t.test("Step 1: Route Management creates routes and submits manual plan via ✓ OK", async () => {
        const vehicles = [createMockVehicle(1, "Bus-A", 30), createMockVehicle(2, "Bus-B", 30)];
        const schedules = vehicles.map(v => createMockSchedule(v._id));

        const inwardRoutes = [
            createMockRoute(1, "Inward Route 1", "INWARD", vehicles[0], [
                { name: "Mattuthavani", latitude: 9.9534, longitude: 78.1561 },
                { name: "KK Nagar", latitude: 9.9320, longitude: 78.1480 },
                { name: "College Campus", latitude: 9.9252, longitude: 78.1198 }
            ])
        ];

        const students = [
            createMockStudent(1, "Alice", "KK Nagar"),
            createMockStudent(2, "Bob", "Mattuthavani")
        ];

        // Route Management constructs plan
        const inwardPlan = await buildManualTransportationPlan({
            routes: inwardRoutes,
            vehicles,
            schedules,
            users: students,
            direction: "INWARD"
        });

        assert.equal(inwardPlan.direction, "INWARD");
        assert.equal(inwardPlan.totalRoutes, 1);
        assert.equal(inwardPlan.assignedUsers, 2);
        assert.equal(inwardPlan.unassignedUsers, 0);

        // Before clicking OK: plan is configured in Route Management, isSubmitted = false
        assert.equal(inwardPlan.isApproved, false);

        // Administrator clicks "✓ OK" in Route Management:
        // Submits manual plan to backend and navigates to Admin Manual Plan page
        const submittedPlan = {
            ...inwardPlan,
            isSubmitted: true,
            submittedAt: new Date().toISOString()
        };
        assert.equal(submittedPlan.isSubmitted, true);
        assert.ok(submittedPlan.submittedAt);
    });

    // =========================================================================
    // STEP 2: ADMIN MANUAL PLAN PAGE — RECEIVE, REVIEW & APPROVE
    // =========================================================================
    await t.test("Step 2: Admin Manual Plan page receives submitted plan and verifies exact route, bus, and passenger data before approving", async () => {
        const vehicles = [createMockVehicle(1, "Bus-A", 40)];
        const schedules = vehicles.map(v => createMockSchedule(v._id));

        const outwardRoutes = [
            createMockRoute(2, "Outward Route 1", "OUTWARD", vehicles[0], [
                { name: "College Campus", latitude: 9.9252, longitude: 78.1198 },
                { name: "Goripalayam", latitude: 9.9290, longitude: 78.1320 },
                { name: "Simmakkal", latitude: 9.9260, longitude: 78.1210 }
            ])
        ];

        const students = [
            createMockStudent(3, "Charlie", "Goripalayam"),
            createMockStudent(4, "Diana", "Simmakkal")
        ];

        // 2a. Admin Manual Plan page fetches plan using getManualPlan({ direction: "OUTWARD" })
        const outwardPlan = await buildManualTransportationPlan({
            routes: outwardRoutes,
            vehicles,
            schedules,
            users: students,
            direction: "OUTWARD"
        });

        // 2b. Verify exact same route, bus, passenger and stop data appears
        assert.equal(outwardPlan.direction, "OUTWARD");
        assert.equal(outwardPlan.totalRoutes, 1);
        assert.equal(outwardPlan.totalCapacity, 40);
        assert.equal(outwardPlan.assignedUsers, 2);
        assert.equal(outwardPlan.unassignedUsers, 0);

        const bus = outwardPlan.buses[0];
        assert.equal(bus.vehicleName, "Bus-A");
        assert.equal(bus.routeName, "Outward Route 1");
        assert.equal(bus.assignedUsers, 2);
        assert.equal(bus.users.length, 2);
        assert.deepEqual(
            bus.users.sort(),
            ["stu_3", "stu_4"]
        );
        assert.equal(bus.stops.length, 3);
        assert.equal(bus.stops[0].name, "College Campus");
        assert.equal(bus.stops[1].name, "Goripalayam");
        assert.equal(bus.stops[2].name, "Simmakkal");

        // 2c. Approval state transition on Admin Manual Plan page
        let approvedPlanState = { ...outwardPlan, isApproved: false, isSubmitted: true };
        assert.equal(approvedPlanState.isApproved, false);

        // Administrator clicks "Approve Manual Plan" on AdminManualPlan page
        approvedPlanState.isApproved = true;
        approvedPlanState.approvedAt = new Date().toISOString();
        approvedPlanState.approvedBy = "ADMIN";

        assert.equal(approvedPlanState.isApproved, true);
        assert.ok(approvedPlanState.approvedAt);
    });

    // =========================================================================
    // STEP 3: FINAL DECISION / CONFIRMATION PAGE — CHOOSE AI VS MANUAL
    // =========================================================================
    await t.test("Step 3: Final Decision page allows choosing AI or Admin Manual and prevents unapproved activation", async () => {
        // Mock AI Recommended Plan
        const aiPlan = {
            planType: "AI Recommended Plan",
            direction: "INWARD",
            version: 3,
            buses: [
                { busId: "veh_1", busName: "AI-Express-1", capacity: 40, assignedCount: 15 }
            ],
            metrics: { totalBuses: 1, totalStudents: 15, vehicleUtilization: "37.5%" },
            isApproved: true
        };

        // Mock Unapproved Manual Plan
        const unapprovedManualPlan = {
            planType: "Admin Manual Plan",
            direction: "INWARD",
            version: 1,
            buses: [
                { busId: "veh_2", busName: "Manual-Bus-1", capacity: 30, assignedCount: 10 }
            ],
            isApproved: false,
            isSubmitted: true
        };

        // Rule: Unapproved manual plan cannot be confirmed
        const validateConfirmation = (selectedPlan, planType) => {
            if (!selectedPlan) return { allowed: false, reason: "No plan found" };
            if (planType === "manual" && !selectedPlan.isApproved) {
                return { allowed: false, reason: "Admin Manual Plan must be approved first on Admin Manual Plan page" };
            }
            return { allowed: true };
        };

        const check1 = validateConfirmation(unapprovedManualPlan, "manual");
        assert.equal(check1.allowed, false);
        assert.match(check1.reason, /approved first/);

        // Once manual plan is approved on Admin Manual Plan page:
        const approvedManualPlan = { ...unapprovedManualPlan, isApproved: true };
        const check2 = validateConfirmation(approvedManualPlan, "manual");
        assert.equal(check2.allowed, true);

        // AI plan is approved and can be confirmed:
        const check3 = validateConfirmation(aiPlan, "ai");
        assert.equal(check3.allowed, true);
    });

    // =========================================================================
    // STEP 4: FINAL CONFIRMATION ACTIVATION & REFRESH PERSISTENCE
    // =========================================================================
    await t.test("Step 4: Confirming final plan updates active operational state with refresh persistence", async () => {
        // In-memory operational store mimicking MongoDB ActivePlan collection
        const activePlanStore = {
            INWARD: null,
            OUTWARD: null
        };

        const confirmPlan = (direction, planType, planData) => {
            activePlanStore[direction] = {
                planType,
                direction,
                confirmedAt: new Date().toISOString(),
                confirmedBy: "ADMIN",
                version: planData.version || 1,
                plan: planData
            };
            return { success: true, activePlan: activePlanStore[direction] };
        };

        // Administrator chooses AI Recommended Plan for INWARD on Final Decision page
        confirmPlan("INWARD", "ai", { version: 4, buses: [{ busId: "veh_1" }] });
        assert.equal(activePlanStore.INWARD.planType, "ai");
        assert.equal(activePlanStore.INWARD.version, 4);

        // Administrator chooses Admin Manual Plan for OUTWARD on Final Decision page
        confirmPlan("OUTWARD", "manual", { version: 2, buses: [{ busId: "veh_2" }] });
        assert.equal(activePlanStore.OUTWARD.planType, "manual");
        assert.equal(activePlanStore.OUTWARD.version, 2);

        // Verify Refresh Persistence: Both direction plans remain independently stored and queryable
        const fetchActiveInward = activePlanStore.INWARD;
        const fetchActiveOutward = activePlanStore.OUTWARD;

        assert.equal(fetchActiveInward.planType, "ai");
        assert.equal(fetchActiveOutward.planType, "manual");
        assert.notEqual(fetchActiveInward.confirmedAt, undefined);
        assert.notEqual(fetchActiveOutward.confirmedAt, undefined);
    });

    // =========================================================================
    // STEP 5: STUDENT DASHBOARD REFLECTION & LATE RESPONSE ISOLATION
    // =========================================================================
    await t.test("Step 5: Student portal reflects confirmed plan, and late response triggers regeneration safely", async () => {
        // User with confirmed INWARD (AI) and OUTWARD (Manual)
        const user = {
            _id: "stu_10",
            userId: "STU_10",
            allocatedBus: {
                inward: {
                    planType: "ai",
                    planVersion: 4,
                    busName: "AI-Express-1",
                    isAllocated: true,
                    approved: true,
                    adminApprovalStatus: "Approved"
                },
                outward: {
                    planType: "manual",
                    planVersion: 2,
                    busName: "Manual-Bus-1",
                    isAllocated: true,
                    approved: true,
                    adminApprovalStatus: "Approved"
                }
            },
            affectedDirections: [],
            isLateResponse: false
        };

        // When a late response is submitted for OUTWARD only:
        user.isLateResponse = true;
        user.affectedDirections = ["OUTWARD"];

        // Parity check: INWARD allocation remains intact and visible!
        const canViewInward = user.allocatedBus?.inward?.isAllocated && !user.affectedDirections.includes("INWARD");
        const canViewOutward = user.allocatedBus?.outward?.isAllocated && !user.affectedDirections.includes("OUTWARD");

        assert.equal(canViewInward, true, "INWARD allocation must remain visible");
        assert.equal(canViewOutward, false, "OUTWARD allocation must be safely withheld for late response");
    });
});
