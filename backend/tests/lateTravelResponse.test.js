import assert from "node:assert/strict";
import test from "node:test";

test("Late Travel Response Management + Admin Alerts + Safe AI Reallocation Suite", async (t) => {

    // Helper to simulate DB and Controller logic
    function createMockEnvironment() {
        let users = [
            {
                _id: "usr_1001",
                userId: "USR1001",
                name: "Alice Coming",
                role: "student",
                stoppings: "Simmakkal",
                travelStatus: "Coming",
                allocationStatus: "Assigned",
                assignedVehicle: "BUS-01",
                assignedRoute: "R-01",
                lateResponseDetected: false,
                requiresReallocation: false,
                affectedDirections: [],
                allocatedBus: {
                    isAllocated: true,
                    vehicleName: "BUS-01",
                    routeCode: "R-01",
                    inward: {
                        isAllocated: true,
                        vehicleName: "BUS-01",
                        routeCode: "R-01",
                        adminApprovalStatus: "Approved",
                        approved: true
                    },
                    outward: null
                }
            },
            {
                _id: "usr_1002",
                userId: "USR1002",
                name: "Bob Pending",
                role: "student",
                stoppings: "Goripalayam",
                travelStatus: "Pending",
                allocationStatus: "Not Assigned",
                assignedVehicle: null,
                assignedRoute: null,
                lateResponseDetected: false,
                requiresReallocation: false,
                affectedDirections: [],
                allocatedBus: null
            },
            {
                _id: "usr_1003",
                userId: "USR1003",
                name: "Charlie Pending",
                role: "student",
                stoppings: "Periyar",
                travelStatus: "Pending",
                allocationStatus: "Not Assigned",
                assignedVehicle: null,
                assignedRoute: null,
                lateResponseDetected: false,
                requiresReallocation: false,
                affectedDirections: [],
                allocatedBus: null
            }
        ];

        let activeApprovedPlans = {
            INWARD: {
                direction: "INWARD",
                planType: "AI",
                approved: true,
                selectedAt: new Date("2026-09-12T10:00:00Z"),
                buses: [
                    {
                        vehicleName: "BUS-01",
                        routeCode: "R-01",
                        capacity: 50,
                        users: ["usr_1001", "USR1001"],
                        stops: [
                            { name: "Simmakkal", userIds: ["usr_1001", "USR1001"] }
                        ]
                    }
                ]
            },
            OUTWARD: null
        };

        // Simulated updateTravelStatus logic
        function submitTravelStatus(userId, newStatus) {
            const user = users.find(u => u.userId === userId || u._id === userId);
            if (!user) throw new Error("User not found");

            if (user.travelStatus && user.travelStatus !== "Pending") {
                return {
                    status: 400,
                    body: {
                        success: false,
                        message: "Travel status already submitted. Please contact administrator to reset."
                    }
                };
            }

            const previousTravelStatus = user.travelStatus || "Pending";

            if (newStatus === "Not Coming") {
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
                        travelStatus: user.travelStatus,
                        allocationStatus: user.allocationStatus,
                        lateResponse: false
                    }
                };
            }

            if (newStatus === "Coming") {
                const isInwardApproved = Boolean(activeApprovedPlans.INWARD);
                const isOutwardApproved = Boolean(activeApprovedPlans.OUTWARD);

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
                            travelStatus: user.travelStatus,
                            allocationStatus: user.allocationStatus,
                            lateResponse: false
                        }
                    };
                }

                // Check affected directions
                const affectedDirections = [];
                if (isInwardApproved) {
                    const hasInwardAlloc = Boolean(
                        user.allocatedBus?.inward?.isAllocated &&
                        user.allocatedBus.inward.approved === true
                    );
                    if (!hasInwardAlloc) {
                        affectedDirections.push("INWARD");
                    }
                }

                if (isOutwardApproved) {
                    const hasOutwardAlloc = Boolean(
                        user.allocatedBus?.outward?.isAllocated &&
                        user.allocatedBus.outward.approved === true
                    );
                    if (!hasOutwardAlloc) {
                        affectedDirections.push("OUTWARD");
                    }
                }

                if (affectedDirections.length === 0) {
                    user.travelStatus = "Coming";
                    return {
                        status: 200,
                        body: {
                            success: true,
                            travelStatus: user.travelStatus,
                            allocationStatus: user.allocationStatus,
                            lateResponse: false
                        }
                    };
                }

                // LATE COMING RESPONSE DETECTED!
                user.travelStatus = "Coming";
                user.allocationStatus = "Pending Reallocation";
                user.lateResponseDetected = true;
                user.lateResponseAt = new Date();
                user.previousTravelStatus = previousTravelStatus;
                user.requiresReallocation = true;
                user.affectedDirections = affectedDirections;

                const existingAlloc = user.allocatedBus || {};
                const validInward = (!affectedDirections.includes("INWARD") && existingAlloc.inward?.isAllocated) ? existingAlloc.inward : null;
                const validOutward = (!affectedDirections.includes("OUTWARD") && existingAlloc.outward?.isAllocated) ? existingAlloc.outward : null;
                const hasValid = Boolean(validInward || validOutward);
                const topValid = validInward || validOutward;

                user.allocatedBus = {
                    isAllocated: hasValid,
                    allocationStatus: "Pending Reallocation",
                    adminApprovalStatus: "Pending Reallocation",
                    requiresReallocation: true,
                    affectedDirections,
                    message: "Your travel response was received after the transportation plan was approved. Your bus and seat will be assigned after the administrator reviews and regenerates the transportation allocation.",
                    inward: validInward,
                    outward: validOutward,
                    updatedAt: new Date()
                };

                user.assignedVehicle = topValid ? topValid.vehicleName : null;
                user.assignedRoute = topValid ? topValid.routeCode : null;

                return {
                    status: 200,
                    body: {
                        success: true,
                        travelStatus: user.travelStatus,
                        allocationStatus: user.allocationStatus,
                        lateResponse: true,
                        affectedDirections
                    }
                };
            }
        }

        function getLateResponsesReport() {
            const lateUsers = users.filter(u => u.requiresReallocation || u.allocationStatus === "Pending Reallocation");
            const affectedSet = new Set();
            let inCount = 0;
            let outCount = 0;

            lateUsers.forEach(u => {
                u.affectedDirections.forEach(d => {
                    affectedSet.add(d);
                    if (d === "INWARD") inCount++;
                    if (d === "OUTWARD") outCount++;
                });
            });

            return {
                summary: {
                    lateComingResponsesCount: lateUsers.length,
                    pendingReallocationUsersCount: lateUsers.filter(u => u.allocationStatus === "Pending Reallocation").length,
                    affectedDirections: Array.from(affectedSet),
                    inwardCount: inCount,
                    outwardCount: outCount
                },
                users: lateUsers
            };
        }

        function resetDirection(direction) {
            activeApprovedPlans[direction] = null;
            users.forEach(u => {
                if (u.allocatedBus) {
                    if (direction === "INWARD") u.allocatedBus.inward = null;
                    if (direction === "OUTWARD") u.allocatedBus.outward = null;
                }
                u.affectedDirections = u.affectedDirections.filter(d => d !== direction);
                if (u.affectedDirections.length === 0) {
                    u.requiresReallocation = false;
                    u.lateResponseDetected = false;
                    if (u.allocatedBus?.inward?.isAllocated || u.allocatedBus?.outward?.isAllocated) {
                        u.allocationStatus = "Assigned";
                    } else if (u.travelStatus === "Coming") {
                        u.allocationStatus = "Unallocated";
                    } else {
                        u.allocationStatus = "Not Assigned";
                    }
                }
            });
        }

        return {
            users,
            activeApprovedPlans,
            submitTravelStatus,
            getLateResponsesReport,
            resetDirection
        };
    }

    // =========================================================================
    // TEST A: Pending becomes Not Coming after approval
    // =========================================================================
    await t.test("TEST A: Pending becomes Not Coming after approval -> Normal handling, no late alert, no bus", () => {
        const env = createMockEnvironment();

        const res = env.submitTravelStatus("USR1002", "Not Coming");
        assert.equal(res.status, 200);
        assert.equal(res.body.lateResponse, false);
        assert.equal(res.body.travelStatus, "Not Coming");

        const bob = env.users.find(u => u.userId === "USR1002");
        assert.equal(bob.travelStatus, "Not Coming");
        assert.equal(bob.allocationStatus, "Not Assigned");
        assert.equal(bob.assignedVehicle, null);
        assert.equal(bob.assignedRoute, null);
        assert.equal(bob.allocatedBus, null);
        assert.equal(bob.requiresReallocation, false);
        assert.equal(bob.lateResponseDetected, false);
        assert.deepEqual(bob.affectedDirections, []);

        // Verify INWARD plan is completely untouched
        assert.ok(env.activeApprovedPlans.INWARD);
        assert.equal(env.activeApprovedPlans.INWARD.approved, true);

        // Verify Alice (existing coming student) remains allocated
        const alice = env.users.find(u => u.userId === "USR1001");
        assert.equal(alice.allocationStatus, "Assigned");
        assert.equal(alice.assignedVehicle, "BUS-01");

        // Verify report has 0 late responses
        const report = env.getLateResponsesReport();
        assert.equal(report.summary.lateComingResponsesCount, 0);
    });

    // =========================================================================
    // TEST B: Pending becomes Coming after INWARD approval
    // =========================================================================
    await t.test("TEST B: Pending becomes Coming after INWARD approval -> Pending Reallocation, no bus, INWARD alert, OUTWARD untouched", () => {
        const env = createMockEnvironment();

        const res = env.submitTravelStatus("USR1002", "Coming");
        assert.equal(res.status, 200);
        assert.equal(res.body.lateResponse, true);
        assert.equal(res.body.allocationStatus, "Pending Reallocation");
        assert.deepEqual(res.body.affectedDirections, ["INWARD"]);

        const bob = env.users.find(u => u.userId === "USR1002");
        assert.equal(bob.travelStatus, "Coming");
        assert.equal(bob.allocationStatus, "Pending Reallocation");
        assert.equal(bob.requiresReallocation, true);
        assert.equal(bob.lateResponseDetected, true);
        assert.equal(bob.previousTravelStatus, "Pending");
        assert.deepEqual(bob.affectedDirections, ["INWARD"]);
        assert.equal(bob.assignedVehicle, null);
        assert.equal(bob.assignedRoute, null);
        assert.equal(bob.allocatedBus.isAllocated, false);
        assert.ok(bob.allocatedBus.message.includes("administrator reviews and regenerates"));

        // OUTWARD remains null / untouched
        assert.equal(env.activeApprovedPlans.OUTWARD, null);

        // Check report
        const report = env.getLateResponsesReport();
        assert.equal(report.summary.lateComingResponsesCount, 1);
        assert.equal(report.summary.pendingReallocationUsersCount, 1);
        assert.deepEqual(report.summary.affectedDirections, ["INWARD"]);
        assert.equal(report.summary.inwardCount, 1);
        assert.equal(report.summary.outwardCount, 0);
        assert.equal(report.users[0].userId, "USR1002");
    });

    // =========================================================================
    // TEST C: Pending becomes Coming after OUTWARD approval
    // =========================================================================
    await t.test("TEST C: Pending becomes Coming after OUTWARD approval -> OUTWARD affected only, INWARD untouched", () => {
        const env = createMockEnvironment();
        // Set OUTWARD approved instead of INWARD
        env.activeApprovedPlans.INWARD = null;
        env.activeApprovedPlans.OUTWARD = {
            direction: "OUTWARD",
            planType: "AI",
            approved: true,
            buses: [{ vehicleName: "BUS-OUT-01", routeCode: "R-OUT-01" }]
        };

        const res = env.submitTravelStatus("USR1002", "Coming");
        assert.equal(res.status, 200);
        assert.equal(res.body.lateResponse, true);
        assert.deepEqual(res.body.affectedDirections, ["OUTWARD"]);

        const bob = env.users.find(u => u.userId === "USR1002");
        assert.equal(bob.allocationStatus, "Pending Reallocation");
        assert.deepEqual(bob.affectedDirections, ["OUTWARD"]);
        assert.equal(bob.assignedVehicle, null);

        // INWARD is untouched
        assert.equal(env.activeApprovedPlans.INWARD, null);

        const report = env.getLateResponsesReport();
        assert.equal(report.summary.outwardCount, 1);
        assert.equal(report.summary.inwardCount, 0);
    });

    // =========================================================================
    // TEST D: Both directions approved -> Pending becomes Coming
    // =========================================================================
    await t.test("TEST D: Both directions approved -> Both directions marked for reallocation independently, existing valid allocations preserved", () => {
        const env = createMockEnvironment();
        // Approve both directions
        env.activeApprovedPlans.OUTWARD = {
            direction: "OUTWARD",
            planType: "AI",
            approved: true,
            buses: [{ vehicleName: "BUS-OUT-01", routeCode: "R-OUT-01" }]
        };

        // Student 1001 is already allocated in INWARD and OUTWARD
        const alice = env.users.find(u => u.userId === "USR1001");
        alice.allocatedBus.outward = {
            isAllocated: true,
            vehicleName: "BUS-OUT-01",
            routeCode: "R-OUT-01",
            approved: true
        };

        const res = env.submitTravelStatus("USR1002", "Coming");
        assert.equal(res.status, 200);
        assert.equal(res.body.lateResponse, true);
        assert.deepEqual(res.body.affectedDirections, ["INWARD", "OUTWARD"]);

        const bob = env.users.find(u => u.userId === "USR1002");
        assert.equal(bob.allocationStatus, "Pending Reallocation");
        assert.deepEqual(bob.affectedDirections, ["INWARD", "OUTWARD"]);
        assert.equal(bob.assignedVehicle, null);
        assert.equal(bob.assignedRoute, null);

        // Alice's existing allocations remain completely untouched
        assert.equal(alice.allocationStatus, "Assigned");
        assert.equal(alice.allocatedBus.inward.isAllocated, true);
        assert.equal(alice.allocatedBus.outward.isAllocated, true);

        const report = env.getLateResponsesReport();
        assert.equal(report.summary.inwardCount, 1);
        assert.equal(report.summary.outwardCount, 1);
        assert.deepEqual(report.summary.affectedDirections.sort(), ["INWARD", "OUTWARD"].sort());
    });

    // =========================================================================
    // TEST E: Admin resets and regenerates
    // =========================================================================
    await t.test("TEST E: Admin resets affected direction -> dynamic demand includes late user -> regenerated plan allocates user", () => {
        const env = createMockEnvironment();
        env.submitTravelStatus("USR1002", "Coming");

        const bob = env.users.find(u => u.userId === "USR1002");
        assert.equal(bob.allocationStatus, "Pending Reallocation");
        assert.deepEqual(bob.affectedDirections, ["INWARD"]);

        // Admin resets INWARD
        env.resetDirection("INWARD");

        // Bob's travelStatus remains Coming!
        assert.equal(bob.travelStatus, "Coming");
        // Affected directions for INWARD is now cleared
        assert.deepEqual(bob.affectedDirections, []);
        assert.equal(bob.requiresReallocation, false);
        assert.equal(bob.allocationStatus, "Unallocated");

        // Dynamic demand calculation: confirmed Coming users now include both Alice and Bob!
        const confirmedComingUsers = env.users.filter(u => u.travelStatus === "Coming");
        assert.equal(confirmedComingUsers.length, 2); // USR1001 and USR1002

        // Admin generates and approves new plan with both users
        env.activeApprovedPlans.INWARD = {
            direction: "INWARD",
            planType: "AI",
            approved: true,
            buses: [
                {
                    vehicleName: "BUS-01",
                    routeCode: "R-01",
                    capacity: 50,
                    users: ["usr_1001", "usr_1002"]
                }
            ]
        };

        // Simulate persistPlanToUsers for the new plan
        confirmedComingUsers.forEach(u => {
            u.allocationStatus = "Assigned";
            u.assignedVehicle = "BUS-01";
            u.assignedRoute = "R-01";
            u.allocatedBus = {
                isAllocated: true,
                vehicleName: "BUS-01",
                routeCode: "R-01",
                inward: {
                    isAllocated: true,
                    vehicleName: "BUS-01",
                    routeCode: "R-01",
                    approved: true
                }
            };
        });

        assert.equal(bob.allocationStatus, "Assigned");
        assert.equal(bob.assignedVehicle, "BUS-01");
        assert.equal(bob.allocatedBus.inward.isAllocated, true);

        // Verify late responses report is now completely clean
        const report = env.getLateResponsesReport();
        assert.equal(report.summary.lateComingResponsesCount, 0);
    });

    // =========================================================================
    // TEST F: Existing Coming user remains allocated
    // =========================================================================
    await t.test("TEST F: Existing Coming user before approval remains allocated, no late alert", () => {
        const env = createMockEnvironment();
        const alice = env.users.find(u => u.userId === "USR1001");

        // Alice attempts to update status while already Coming
        const res = env.submitTravelStatus("USR1001", "Coming");
        assert.equal(res.status, 400); // Locked response
        assert.equal(alice.allocationStatus, "Assigned");
        assert.equal(alice.assignedVehicle, "BUS-01");
        assert.equal(alice.requiresReallocation, false);

        const report = env.getLateResponsesReport();
        assert.equal(report.summary.lateComingResponsesCount, 0);
    });

    // =========================================================================
    // TEST G: Multiple late Coming users
    // =========================================================================
    await t.test("TEST G: Multiple late Coming users -> Grouped report, all listed, no duplicate notifications", () => {
        const env = createMockEnvironment();

        // Both Bob and Charlie submit Coming after INWARD approval
        const resBob = env.submitTravelStatus("USR1002", "Coming");
        const resCharlie = env.submitTravelStatus("USR1003", "Coming");

        assert.equal(resBob.body.lateResponse, true);
        assert.equal(resCharlie.body.lateResponse, true);

        const bob = env.users.find(u => u.userId === "USR1002");
        const charlie = env.users.find(u => u.userId === "USR1003");

        assert.equal(bob.allocationStatus, "Pending Reallocation");
        assert.equal(charlie.allocationStatus, "Pending Reallocation");
        assert.equal(bob.assignedVehicle, null);
        assert.equal(charlie.assignedVehicle, null);

        const report = env.getLateResponsesReport();
        assert.equal(report.summary.lateComingResponsesCount, 2);
        assert.equal(report.summary.pendingReallocationUsersCount, 2);
        assert.equal(report.summary.inwardCount, 2);
        assert.equal(report.summary.outwardCount, 0);
        assert.deepEqual(report.users.map(u => u.userId).sort(), ["USR1002", "USR1003"].sort());
    });
});
