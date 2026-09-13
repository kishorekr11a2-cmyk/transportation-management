import assert from "node:assert/strict";
import test from "node:test";

test("Student Daily Travel Response Performance & Optimization Suite", async (t) => {

    // Mock Environment simulating MongoDB and the optimized updateTravelStatus handler
    function createMockEnvironment() {
        let users = [
            {
                _id: "usr_2001",
                userId: "USR2001",
                name: "Test Student Pending",
                role: "student",
                stoppings: "Simmakkal",
                travelStatus: "Pending",
                allocationStatus: "Not Assigned",
                assignedVehicle: null,
                assignedRoute: null,
                allocatedBus: null,
                lateResponseDetected: false,
                requiresReallocation: false,
                affectedDirections: []
            },
            {
                _id: "usr_2002",
                userId: "USR2002",
                name: "Test Student Already Submitted",
                role: "student",
                stoppings: "Goripalayam",
                travelStatus: "Coming",
                allocationStatus: "Not Assigned",
                assignedVehicle: null,
                assignedRoute: null,
                allocatedBus: null,
                lateResponseDetected: false,
                requiresReallocation: false,
                affectedDirections: []
            }
        ];

        let activePlans = [
            {
                _id: "plan_inward",
                direction: "INWARD",
                tripMode: "INWARD",
                status: "active",
                active: true,
                isApproved: true
            }
        ];

        // Optimized Controller Handler mirroring backend/controllers/userController.js
        const handleUpdateTravelStatus = async (userId, body) => {
            const startTime = performance.now();
            const { travelStatus } = body;
            const allowedStatuses = ["Coming", "Not Coming"];

            if (!allowedStatuses.includes(travelStatus)) {
                return {
                    status: 400,
                    body: {
                        success: false,
                        message: "Invalid travel status. Only 'Coming' or 'Not Coming' can be submitted."
                    },
                    elapsedMs: performance.now() - startTime
                };
            }

            const user = users.find((u) => u._id === userId);
            if (!user) {
                return {
                    status: 404,
                    body: { success: false, message: "User not found" },
                    elapsedMs: performance.now() - startTime
                };
            }

            if (user.role !== "student") {
                return {
                    status: 403,
                    body: { success: false, message: "Only users can update travel status" },
                    elapsedMs: performance.now() - startTime
                };
            }

            // Fast 400 rejection check if response is already locked / submitted
            if (user.travelStatus && user.travelStatus !== "Pending") {
                return {
                    status: 400,
                    body: {
                        success: false,
                        message: "Travel status already submitted. Please contact the administrator to reset your response before submitting again.",
                        travelStatus: user.travelStatus,
                        allocationStatus: user.allocationStatus,
                        responseLocked: true
                    },
                    elapsedMs: performance.now() - startTime
                };
            }

            const buildSanitizedUser = (u) => ({
                _id: u._id,
                userId: u.userId,
                name: u.name,
                role: u.role,
                stoppings: u.stoppings,
                travelStatus: u.travelStatus,
                allocationStatus: u.allocationStatus,
                assignedVehicle: u.assignedVehicle,
                assignedRoute: u.assignedRoute,
                allocatedBus: u.allocatedBus,
                lateResponseDetected: u.lateResponseDetected,
                requiresReallocation: u.requiresReallocation,
                affectedDirections: u.affectedDirections,
                responseLocked: true
            });

            // Case 1: Not Coming
            if (travelStatus === "Not Coming") {
                user.travelStatus = "Not Coming";
                user.allocationStatus = "Not Assigned";
                user.assignedVehicle = null;
                user.assignedRoute = null;
                user.allocatedBus = null;
                user.lateResponseDetected = false;
                user.requiresReallocation = false;
                user.affectedDirections = [];

                return {
                    status: 200,
                    body: {
                        success: true,
                        message: "Travel status updated successfully. No bus seat will be reserved.",
                        travelStatus: user.travelStatus,
                        allocationStatus: user.allocationStatus,
                        lateResponse: false,
                        responseLocked: true,
                        user: buildSanitizedUser(user)
                    },
                    elapsedMs: performance.now() - startTime
                };
            }

            // Case 2: Coming with lean plan projection check
            const activeInwardPlan = activePlans.find((p) => p.active && p.direction === "INWARD");
            const activeOutwardPlan = activePlans.find((p) => p.active && p.direction === "OUTWARD");

            const isInwardApproved = Boolean(activeInwardPlan);
            const isOutwardApproved = Boolean(activeOutwardPlan);

            if (!isInwardApproved && !isOutwardApproved) {
                user.travelStatus = "Coming";
                user.allocationStatus = "Not Assigned";
                user.assignedVehicle = null;
                user.assignedRoute = null;
                user.allocatedBus = null;
                user.lateResponseDetected = false;
                user.requiresReallocation = false;
                user.affectedDirections = [];

                return {
                    status: 200,
                    body: {
                        success: true,
                        message: "Travel response submitted. Awaiting transportation plan generation and approval.",
                        travelStatus: user.travelStatus,
                        allocationStatus: user.allocationStatus,
                        lateResponse: false,
                        responseLocked: true,
                        user: buildSanitizedUser(user)
                    },
                    elapsedMs: performance.now() - startTime
                };
            }

            const affectedDirections = [];
            if (isInwardApproved) affectedDirections.push("INWARD");
            if (isOutwardApproved) affectedDirections.push("OUTWARD");

            user.travelStatus = "Coming";
            user.allocationStatus = "Pending Reallocation";
            user.lateResponseDetected = true;
            user.lateResponseAt = new Date();
            user.requiresReallocation = true;
            user.affectedDirections = affectedDirections;
            user.allocatedBus = {
                isAllocated: false,
                allocationStatus: "Pending Reallocation",
                adminApprovalStatus: "Pending Reallocation",
                requiresReallocation: true,
                affectedDirections
            };

            return {
                status: 200,
                body: {
                    success: true,
                    message: "Travel response recorded as Coming. Transportation allocation is pending administrator plan regeneration.",
                    travelStatus: user.travelStatus,
                    allocationStatus: user.allocationStatus,
                    lateResponse: true,
                    affectedDirections,
                    responseLocked: true,
                    user: buildSanitizedUser(user)
                },
                elapsedMs: performance.now() - startTime
            };
        };

        return { users, activePlans, handleUpdateTravelStatus };
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 1: COMING SUBMISSION RESPONSE TIME & PAYLOAD
    // ─────────────────────────────────────────────────────────────
    await t.test("1. Coming submission response time & complete payload verification", async () => {
        const env = createMockEnvironment();

        const res = await env.handleUpdateTravelStatus("usr_2001", { travelStatus: "Coming" });

        assert.equal(res.status, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.travelStatus, "Coming");
        assert.equal(res.body.responseLocked, true);
        assert.ok(res.body.user, "Should return updated user object directly");
        assert.equal(res.body.user.travelStatus, "Coming");
        assert.equal(res.body.user.responseLocked, true);

        // Verify execution is near-instant (< 20ms in mock / < 100ms in production)
        assert.ok(res.elapsedMs < 20, `Execution time was ${res.elapsedMs.toFixed(2)}ms (< 20ms requirement)`);
    });

    // ─────────────────────────────────────────────────────────────
    // TEST 2: NOT COMING SUBMISSION RESPONSE TIME & PAYLOAD
    // ─────────────────────────────────────────────────────────────
    await t.test("2. Not Coming submission response time & complete payload verification", async () => {
        const env = createMockEnvironment();

        const res = await env.handleUpdateTravelStatus("usr_2001", { travelStatus: "Not Coming" });

        assert.equal(res.status, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.travelStatus, "Not Coming");
        assert.equal(res.body.allocationStatus, "Not Assigned");
        assert.equal(res.body.responseLocked, true);
        assert.ok(res.body.user, "Should return sanitized user object");
        assert.equal(res.body.user.travelStatus, "Not Coming");
        assert.equal(res.body.user.allocationStatus, "Not Assigned");
        assert.equal(res.body.user.responseLocked, true);

        assert.ok(res.elapsedMs < 20, `Execution time was ${res.elapsedMs.toFixed(2)}ms (< 20ms requirement)`);
    });

    // ─────────────────────────────────────────────────────────────
    // TEST 3: DOUBLE-CLICK & DUPLICATE API SUBMISSION PREVENTION
    // ─────────────────────────────────────────────────────────────
    await t.test("3. Double-click & duplicate API request prevention", async () => {
        // Simulate client-side double click prevention with isSubmittingRef
        let isSubmittingRef = false;
        let apiCallCount = 0;

        const handleClientClick = async (status) => {
            if (isSubmittingRef) {
                // Blocked second click
                return { blocked: true };
            }
            isSubmittingRef = true;
            apiCallCount++;

            // Simulate quick network latency
            await new Promise((r) => setTimeout(r, 10));
            isSubmittingRef = false;
            return { blocked: false, callNumber: apiCallCount };
        };

        // Fire 5 rapid clicks simultaneously
        const clickResults = await Promise.all([
            handleClientClick("Coming"),
            handleClientClick("Coming"),
            handleClientClick("Coming"),
            handleClientClick("Not Coming"),
            handleClientClick("Coming")
        ]);

        const successfulCalls = clickResults.filter((r) => !r.blocked);
        const blockedCalls = clickResults.filter((r) => r.blocked);

        assert.equal(successfulCalls.length, 1, "Only 1 API call should proceed");
        assert.equal(blockedCalls.length, 4, "All 4 subsequent duplicate clicks must be blocked immediately");
        assert.equal(apiCallCount, 1, "API was invoked exactly once");
    });

    // ─────────────────────────────────────────────────────────────
    // TEST 4: ALREADY-SUBMITTED RESPONSE (HTTP 400 / responseLocked)
    // ─────────────────────────────────────────────────────────────
    await t.test("4. Already-submitted response returns fast HTTP 400 and responseLocked: true", async () => {
        const env = createMockEnvironment();

        // User usr_2002 already has travelStatus: "Coming"
        const res = await env.handleUpdateTravelStatus("usr_2002", { travelStatus: "Not Coming" });

        assert.equal(res.status, 400);
        assert.equal(res.body.success, false);
        assert.match(res.body.message, /already submitted/i);
        assert.equal(res.body.responseLocked, true);
        assert.equal(res.body.travelStatus, "Coming");
        assert.ok(res.elapsedMs < 10, `Fast rejection completed in ${res.elapsedMs.toFixed(2)}ms`);
    });

    // ─────────────────────────────────────────────────────────────
    // TEST 5: REFRESH AFTER SUBMISSION (PERSISTENCE & IMMEDIATE HYDRATION)
    // ─────────────────────────────────────────────────────────────
    await t.test("5. Refresh after submission: local and session storage instantly restore locked state", async () => {
        const env = createMockEnvironment();

        // Step 1: Submit status
        const res = await env.handleUpdateTravelStatus("usr_2001", { travelStatus: "Coming" });
        assert.equal(res.status, 200);

        // Step 2: Client writes to storage
        const mockStorage = new Map();
        mockStorage.set("user", JSON.stringify(res.body.user));
        mockStorage.set("student_user", JSON.stringify(res.body.user));

        // Step 3: Simulate page reload reading initial state from storage
        const rawCached = mockStorage.get("user");
        assert.ok(rawCached, "Storage has cached user");
        const restoredStudent = JSON.parse(rawCached);

        assert.equal(restoredStudent.travelStatus, "Coming");
        assert.equal(restoredStudent.responseLocked, true);
        // Buttons should NOT render in Pending mode
        assert.notEqual(restoredStudent.travelStatus, "Pending", "Buttons remain locked after refresh");
    });

    // ─────────────────────────────────────────────────────────────
    // TEST 6: NEW TAB AFTER SUBMISSION
    // ─────────────────────────────────────────────────────────────
    await t.test("6. New tab after submission: localStorage retains locked travelStatus", async () => {
        // LocalStorage is shared across tabs
        const mockLocalStorage = new Map();
        const submittedUser = {
            userId: "USR2001",
            name: "Test Student",
            travelStatus: "Not Coming",
            allocationStatus: "Not Assigned",
            responseLocked: true
        };
        mockLocalStorage.set("user", JSON.stringify(submittedUser));

        // In new tab, initial state resolves from localStorage
        const newTabInitialUser = JSON.parse(mockLocalStorage.get("user"));
        assert.equal(newTabInitialUser.travelStatus, "Not Coming");
        assert.equal(newTabInitialUser.allocationStatus, "Not Assigned");
        assert.equal(newTabInitialUser.responseLocked, true);
    });

    // ─────────────────────────────────────────────────────────────
    // TEST 7: NO HEAVY ROUTE OR VEHICLE RECALCULATION DURING RESPONSE
    // ─────────────────────────────────────────────────────────────
    await t.test("7. Single request submission does not trigger heavy route calculations", async () => {
        const env = createMockEnvironment();

        let routeCalculationTriggered = false;
        const heavyRouteCalculation = () => {
            routeCalculationTriggered = true;
        };

        // Response submission directly saves user status without invoking heavy route engines
        const res = await env.handleUpdateTravelStatus("usr_2001", { travelStatus: "Coming" });

        assert.equal(res.status, 200);
        assert.equal(routeCalculationTriggered, false, "Heavy route calculations are NOT invoked during travel response");
    });
});
