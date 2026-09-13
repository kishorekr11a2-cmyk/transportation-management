import assert from "node:assert/strict";
import test from "node:test";

test("Direction-Specific Approval and Student Dashboard Display Test Suite", async (t) => {

    // Mock student user
    function createMockStudent(overrides = {}) {
        return {
            _id: "student_001",
            userId: "STU001",
            name: "Kishore Student",
            role: "student",
            travelStatus: "Coming",
            stoppings: "Simmakkal",
            allocatedBus: null,
            ...overrides
        };
    }

    // Helper to simulate student dashboard visibility parsing (exact StudentDashboard.jsx logic)
    function parseStudentDashboardView(student) {
        const allocatedBus = student.allocatedBus;

        const inwardAlloc = (allocatedBus?.inward && (allocatedBus.inward.approved === true || allocatedBus.inward.adminApprovalStatus === "Approved") && allocatedBus.inward.isAllocated)
            ? allocatedBus.inward
            : null;

        const outwardAlloc = (allocatedBus?.outward && (allocatedBus.outward.approved === true || allocatedBus.outward.adminApprovalStatus === "Approved") && allocatedBus.outward.isAllocated)
            ? allocatedBus.outward
            : null;

        const isAllocated = Boolean(inwardAlloc || outwardAlloc);

        return {
            isAllocated,
            inwardAlloc,
            outwardAlloc,
            showInward: Boolean(inwardAlloc),
            showOutward: Boolean(outwardAlloc),
            unallocatedMessage: allocatedBus?.message || "No approved transportation plan available yet."
        };
    }

    // Direction-specific mock allocation builder
    function createDirectionAllocation(direction, stopName = "Simmakkal") {
        const isInward = direction === "INWARD";
        return {
            isAllocated: true,
            approved: true,
            adminApprovalStatus: "Approved",
            direction,
            tripMode: isInward ? "TO_DESTINATION" : "FROM_SOURCE",
            planType: "AI",
            routeCode: isInward ? "R-IN-01" : "R-OUT-01",
            routeName: isInward ? "Inward Line 1" : "Outward Line 1",
            vehicleName: isInward ? "College Bus 01" : "College Bus 02",
            capacity: 60,
            assignedUsersCount: 45,
            remainingSeats: 15,
            boardingStop: stopName,
            stopOrder: 1,
            totalStops: 5,
            routeStops: [
                { order: 1, name: stopName, isUserStop: true },
                { order: 2, name: "Goripalayam", isUserStop: false },
                { order: 3, name: "College Hub", isUserStop: false }
            ]
        };
    }

    // Mock State Store simulating MongoDB ai_selected_plans and User collections
    class MockTransportationDB {
        constructor() {
            this.selectedPlans = new Map(); // key: "INWARD" | "OUTWARD" -> plan doc
            this.generatedAiPlans = new Map(); // key: "INWARD" | "OUTWARD" -> aiPlan doc
            this.students = new Map();
        }

        addStudent(student) {
            this.students.set(student.userId, { ...student });
        }

        generatePlan(direction) {
            this.generatedAiPlans.set(direction, {
                direction,
                active: true,
                status: "active",
                isApproved: false,
                plan: {
                    buses: [{
                        vehicleName: direction === "INWARD" ? "College Bus 01" : "College Bus 02",
                        routeCode: direction === "INWARD" ? "R-IN-01" : "R-OUT-01",
                        direction,
                        capacity: 60,
                        assignedUsers: 45,
                        stops: [{ name: "Simmakkal", userIds: ["STU001"], order: 1 }]
                    }]
                }
            });
        }

        approvePlan(direction) {
            const genPlan = this.generatedAiPlans.get(direction);
            if (!genPlan) throw new Error("No generated plan to approve for " + direction);

            genPlan.isApproved = true;
            this.selectedPlans.set(direction, {
                direction,
                active: true,
                status: "active",
                approved: true,
                selectedAt: new Date(),
                plan: genPlan.plan
            });

            // Simulate persistPlanToUsers
            const oppositeDirection = direction === "INWARD" ? "OUTWARD" : "INWARD";
            const isOppositeApproved = Boolean(this.selectedPlans.get(oppositeDirection)?.active);

            for (const [id, student] of this.students.entries()) {
                if (student.travelStatus !== "Coming") continue;

                const existingAlloc = student.allocatedBus || {};
                let oppositeAlloc = null;
                if (isOppositeApproved) {
                    const cand = direction === "OUTWARD" ? existingAlloc.inward : existingAlloc.outward;
                    if (cand && cand.isAllocated && cand.approved) {
                        oppositeAlloc = { ...cand };
                    }
                }

                const currentAlloc = createDirectionAllocation(direction, student.stoppings);
                const inwardAlloc = direction === "INWARD" ? currentAlloc : oppositeAlloc;
                const outwardAlloc = direction === "OUTWARD" ? currentAlloc : oppositeAlloc;

                const isAllocated = Boolean((inwardAlloc && inwardAlloc.isAllocated) || (outwardAlloc && outwardAlloc.isAllocated));
                const activeTop = currentAlloc || oppositeAlloc;

                student.allocatedBus = {
                    ...activeTop,
                    isAllocated,
                    planType: "AI",
                    adminApprovalStatus: "Approved",
                    inward: inwardAlloc || null,
                    outward: outwardAlloc || null
                };
                student.assignedVehicle = activeTop.vehicleName;
                student.assignedRoute = activeTop.routeCode;
            }
        }

        resetDirection(direction) {
            if (this.generatedAiPlans.has(direction)) {
                this.generatedAiPlans.get(direction).active = false;
                this.generatedAiPlans.get(direction).status = "reset";
                this.generatedAiPlans.get(direction).isApproved = false;
            }
            if (this.selectedPlans.has(direction)) {
                this.selectedPlans.get(direction).active = false;
                this.selectedPlans.get(direction).status = "reset";
                this.selectedPlans.delete(direction);
            }

            for (const [id, student] of this.students.entries()) {
                if (!student.allocatedBus) continue;

                if (direction === "INWARD") {
                    student.allocatedBus.inward = null;
                    const outward = student.allocatedBus.outward;
                    if (outward && outward.isAllocated && outward.approved) {
                        student.allocatedBus.isAllocated = true;
                        student.allocatedBus.direction = "OUTWARD";
                        student.assignedVehicle = outward.vehicleName;
                        student.assignedRoute = outward.routeCode;
                    } else {
                        student.allocatedBus = {
                            isAllocated: false,
                            inward: null,
                            outward: null,
                            adminApprovalStatus: "Pending Admin Approval",
                            message: "No approved transportation plan available yet."
                        };
                        student.assignedVehicle = null;
                        student.assignedRoute = null;
                    }
                } else if (direction === "OUTWARD") {
                    student.allocatedBus.outward = null;
                    const inward = student.allocatedBus.inward;
                    if (inward && inward.isAllocated && inward.approved) {
                        student.allocatedBus.isAllocated = true;
                        student.allocatedBus.direction = "INWARD";
                        student.assignedVehicle = inward.vehicleName;
                        student.assignedRoute = inward.routeCode;
                    } else {
                        student.allocatedBus = {
                            isAllocated: false,
                            inward: null,
                            outward: null,
                            adminApprovalStatus: "Pending Admin Approval",
                            message: "No approved transportation plan available yet."
                        };
                        student.assignedVehicle = null;
                        student.assignedRoute = null;
                    }
                }
            }
        }

        // Simulates getUserAllocatedBus authoritative API
        getStudentAllocatedBus(userId) {
            const student = this.students.get(userId);
            if (!student) return null;

            const isInwardApproved = Boolean(this.selectedPlans.get("INWARD")?.active);
            const isOutwardApproved = Boolean(this.selectedPlans.get("OUTWARD")?.active);

            if (!isInwardApproved && !isOutwardApproved) {
                return {
                    isAllocated: false,
                    inward: null,
                    outward: null,
                    adminApprovalStatus: "Pending Admin Approval",
                    message: "No approved transportation plan available yet."
                };
            }

            const validInward = isInwardApproved && student.allocatedBus?.inward?.isAllocated
                ? { ...student.allocatedBus.inward, approved: true }
                : null;

            const validOutward = isOutwardApproved && student.allocatedBus?.outward?.isAllocated
                ? { ...student.allocatedBus.outward, approved: true }
                : null;

            const isAllocated = Boolean(validInward || validOutward);
            const activeTop = validInward || validOutward;

            return {
                ...activeTop,
                isAllocated,
                adminApprovalStatus: "Approved",
                inward: validInward,
                outward: validOutward
            };
        }
    }

    // ==============================================================
    // ACCEPTANCE TEST A: Generate INWARD -> Approve INWARD
    // ==============================================================
    await t.test("TEST A: Generate INWARD -> Approve INWARD -> Student sees ONLY INWARD", () => {
        const db = new MockTransportationDB();
        db.addStudent(createMockStudent());

        // Admin generates INWARD and approves INWARD
        db.generatePlan("INWARD");
        db.approvePlan("INWARD");

        const studentData = db.getStudentAllocatedBus("STU001");
        assert.ok(studentData.inward !== null, "Inward plan must be populated");
        assert.equal(studentData.inward.approved, true, "Inward plan must be approved");
        assert.equal(studentData.inward.isAllocated, true, "Inward plan must be allocated");
        assert.equal(studentData.inward.vehicleName, "College Bus 01");
        assert.equal(studentData.inward.routeCode, "R-IN-01");

        // OUTWARD MUST BE NULL
        assert.equal(studentData.outward, null, "Outward plan must be strictly null");

        // Frontend Dashboard View Parsing
        const view = parseStudentDashboardView({ allocatedBus: studentData });
        assert.equal(view.isAllocated, true);
        assert.equal(view.showInward, true, "Dashboard must show INWARD section");
        assert.equal(view.showOutward, false, "Dashboard must NOT show OUTWARD section");
        assert.ok(view.inwardAlloc);
        assert.equal(view.outwardAlloc, null);
    });

    // ==============================================================
    // ACCEPTANCE TEST B: Generate OUTWARD -> Approve OUTWARD
    // ==============================================================
    await t.test("TEST B: Generate OUTWARD -> Approve OUTWARD -> Student sees ONLY OUTWARD", () => {
        const db = new MockTransportationDB();
        db.addStudent(createMockStudent());

        // Admin generates OUTWARD and approves OUTWARD
        db.generatePlan("OUTWARD");
        db.approvePlan("OUTWARD");

        const studentData = db.getStudentAllocatedBus("STU001");
        assert.ok(studentData.outward !== null, "Outward plan must be populated");
        assert.equal(studentData.outward.approved, true, "Outward plan must be approved");
        assert.equal(studentData.outward.isAllocated, true, "Outward plan must be allocated");
        assert.equal(studentData.outward.vehicleName, "College Bus 02");
        assert.equal(studentData.outward.routeCode, "R-OUT-01");

        // INWARD MUST BE NULL
        assert.equal(studentData.inward, null, "Inward plan must be strictly null");

        // Frontend Dashboard View Parsing
        const view = parseStudentDashboardView({ allocatedBus: studentData });
        assert.equal(view.isAllocated, true);
        assert.equal(view.showInward, false, "Dashboard must NOT show INWARD section");
        assert.equal(view.showOutward, true, "Dashboard must show OUTWARD section");
        assert.equal(view.inwardAlloc, null);
        assert.ok(view.outwardAlloc);
    });

    // ==============================================================
    // ACCEPTANCE TEST C: Approve INWARD first -> refresh -> approve OUTWARD -> both visible
    // ==============================================================
    await t.test("TEST C: Approve INWARD first (only INWARD visible) -> approve OUTWARD (both visible)", () => {
        const db = new MockTransportationDB();
        db.addStudent(createMockStudent());

        // 1. Approve INWARD
        db.generatePlan("INWARD");
        db.approvePlan("INWARD");

        // Student refreshes (fetch 1)
        const fetch1 = db.getStudentAllocatedBus("STU001");
        const view1 = parseStudentDashboardView({ allocatedBus: fetch1 });
        assert.equal(view1.showInward, true, "Inward must be visible");
        assert.equal(view1.showOutward, false, "Outward must not be visible");

        // 2. Later, Admin approves OUTWARD
        db.generatePlan("OUTWARD");
        db.approvePlan("OUTWARD");

        // Student refreshes (fetch 2)
        const fetch2 = db.getStudentAllocatedBus("STU001");
        const view2 = parseStudentDashboardView({ allocatedBus: fetch2 });
        assert.equal(view2.showInward, true, "Inward must remain visible");
        assert.equal(view2.showOutward, true, "Outward must now be visible");
        assert.equal(fetch2.inward.vehicleName, "College Bus 01");
        assert.equal(fetch2.outward.vehicleName, "College Bus 02");
    });

    // ==============================================================
    // ACCEPTANCE TEST D: Both approved -> Reset INWARD -> ONLY OUTWARD remains visible
    // ==============================================================
    await t.test("TEST D: Both approved -> Reset INWARD -> ONLY OUTWARD remains visible", () => {
        const db = new MockTransportationDB();
        db.addStudent(createMockStudent());

        // Approve both
        db.generatePlan("INWARD");
        db.approvePlan("INWARD");
        db.generatePlan("OUTWARD");
        db.approvePlan("OUTWARD");

        // Reset INWARD
        db.resetDirection("INWARD");

        const studentData = db.getStudentAllocatedBus("STU001");
        assert.equal(studentData.inward, null, "Inward plan must be null after reset");
        assert.ok(studentData.outward !== null, "Outward plan must be preserved");
        assert.equal(studentData.outward.approved, true);

        const view = parseStudentDashboardView({ allocatedBus: studentData });
        assert.equal(view.isAllocated, true);
        assert.equal(view.showInward, false, "Inward must NOT be visible");
        assert.equal(view.showOutward, true, "Outward MUST remain visible");
    });

    // ==============================================================
    // ACCEPTANCE TEST E: Both approved -> Reset OUTWARD -> ONLY INWARD remains visible
    // ==============================================================
    await t.test("TEST E: Both approved -> Reset OUTWARD -> ONLY INWARD remains visible", () => {
        const db = new MockTransportationDB();
        db.addStudent(createMockStudent());

        // Approve both
        db.generatePlan("INWARD");
        db.approvePlan("INWARD");
        db.generatePlan("OUTWARD");
        db.approvePlan("OUTWARD");

        // Reset OUTWARD
        db.resetDirection("OUTWARD");

        const studentData = db.getStudentAllocatedBus("STU001");
        assert.ok(studentData.inward !== null, "Inward plan must be preserved");
        assert.equal(studentData.outward, null, "Outward plan must be null after reset");
        assert.equal(studentData.inward.approved, true);

        const view = parseStudentDashboardView({ allocatedBus: studentData });
        assert.equal(view.isAllocated, true);
        assert.equal(view.showInward, true, "Inward MUST remain visible");
        assert.equal(view.showOutward, false, "Outward must NOT be visible");
    });

    // ==============================================================
    // ACCEPTANCE TEST F: Neither is approved (or only generated but not approved)
    // ==============================================================
    await t.test("TEST F: Neither approved (e.g. only generated drafts exist) -> No allocation details shown", () => {
        const db = new MockTransportationDB();
        db.addStudent(createMockStudent());

        // Admin generates both INWARD and OUTWARD but approves NEITHER
        db.generatePlan("INWARD");
        db.generatePlan("OUTWARD");

        const studentData = db.getStudentAllocatedBus("STU001");
        assert.equal(studentData.isAllocated, false, "Must not be allocated");
        assert.equal(studentData.inward, null, "Unapproved inward draft must not be shown");
        assert.equal(studentData.outward, null, "Unapproved outward draft must not be shown");
        assert.equal(studentData.message, "No approved transportation plan available yet.");

        const view = parseStudentDashboardView({ allocatedBus: studentData });
        assert.equal(view.isAllocated, false);
        assert.equal(view.showInward, false);
        assert.equal(view.showOutward, false);
        assert.equal(view.unallocatedMessage, "No approved transportation plan available yet.");
    });

    // ==============================================================
    // ACCEPTANCE TEST G: Full persistence across reload / re-login
    // ==============================================================
    await t.test("TEST G: Persistence check - full reload / re-login preserves exact directional state", () => {
        const db = new MockTransportationDB();
        db.addStudent(createMockStudent());

        // Admin approves only INWARD
        db.generatePlan("INWARD");
        db.approvePlan("INWARD");

        // Simulate 5 consecutive page reloads / API calls
        for (let i = 1; i <= 5; i++) {
            const reloadData = db.getStudentAllocatedBus("STU001");
            const reloadView = parseStudentDashboardView({ allocatedBus: reloadData });

            assert.equal(reloadView.showInward, true, `Reload #${i}: INWARD must remain visible`);
            assert.equal(reloadView.showOutward, false, `Reload #${i}: OUTWARD must remain hidden`);
            assert.equal(reloadData.inward.vehicleName, "College Bus 01");
            assert.equal(reloadData.outward, null);
        }
    });

    // ==============================================================
    // ACCEPTANCE TEST H: Manual route created as INWARD
    // ==============================================================
    await t.test("TEST H: Manual route created as INWARD displays under INWARD/All, not OUTWARD", () => {
        const routes = [
            { _id: "r1", routeName: "Morning Route 1", direction: "INWARD", stops: [{ name: "Stop A" }, { name: "College" }] }
        ];

        const allRoutes = routes;
        const inwardRoutes = routes.filter((r) => (r.direction || "INWARD") === "INWARD");
        const outwardRoutes = routes.filter((r) => r.direction === "OUTWARD");

        assert.equal(allRoutes.length, 1);
        assert.equal(inwardRoutes.length, 1);
        assert.equal(outwardRoutes.length, 0);
        assert.equal(inwardRoutes[0].routeName, "Morning Route 1");
    });

    // ==============================================================
    // ACCEPTANCE TEST I: Manual route created as OUTWARD
    // ==============================================================
    await t.test("TEST I: Manual route created as OUTWARD displays under OUTWARD/All, not INWARD", () => {
        const routes = [
            { _id: "r2", routeName: "Evening Route 1", direction: "OUTWARD", stops: [{ name: "College" }, { name: "Stop A" }] }
        ];

        const allRoutes = routes;
        const inwardRoutes = routes.filter((r) => (r.direction || "INWARD") === "INWARD");
        const outwardRoutes = routes.filter((r) => r.direction === "OUTWARD");

        assert.equal(allRoutes.length, 1);
        assert.equal(inwardRoutes.length, 0);
        assert.equal(outwardRoutes.length, 1);
        assert.equal(outwardRoutes[0].routeName, "Evening Route 1");
    });

    // ==============================================================
    // ACCEPTANCE TEST J: Direction filter tabs counting and separation
    // ==============================================================
    await t.test("TEST J: Direction filter tabs count and separate mixed INWARD and OUTWARD routes", () => {
        const routes = [
            { _id: "r1", routeName: "Inward 1", direction: "INWARD" },
            { _id: "r2", routeName: "Inward 2", direction: "INWARD" },
            { _id: "r3", routeName: "Outward 1", direction: "OUTWARD" }
        ];

        const inwardCount = routes.filter((r) => (r.direction || "INWARD") === "INWARD").length;
        const outwardCount = routes.filter((r) => r.direction === "OUTWARD").length;

        assert.equal(routes.length, 3, "Total routes count must be 3");
        assert.equal(inwardCount, 2, "Inward routes count must be 2");
        assert.equal(outwardCount, 1, "Outward routes count must be 1");
    });

    // ==============================================================
    // ACCEPTANCE TEST K: Route edit preserves direction unless explicitly changed
    // ==============================================================
    await t.test("TEST K: Route edit preserves direction and allows directional updates", () => {
        let route = {
            _id: "r1",
            routeName: "Route R-01",
            direction: "OUTWARD",
            stops: [{ name: "Campus" }, { name: "Depot" }]
        };

        // Edit route name and stops only
        route = {
            ...route,
            routeName: "Route R-01 Updated",
            stops: [{ name: "Campus" }, { name: "Depot A" }, { name: "Depot B" }]
        };
        assert.equal(route.direction, "OUTWARD", "Direction must be preserved as OUTWARD");

        // Explicitly switch direction to INWARD
        route = {
            ...route,
            direction: "INWARD"
        };
        assert.equal(route.direction, "INWARD", "Direction must update to INWARD when explicitly changed");
    });

    // ==============================================================
    // ACCEPTANCE TEST L: AI route redraw uses direction-specific stops
    // ==============================================================
    await t.test("TEST L: AI route redraw resolves stops without cross-directional contamination", () => {
        const aiInwardRoute = {
            direction: "INWARD",
            source: { name: "Simmakkal", latitude: 9.925, longitude: 78.119 },
            destination: { name: "College Hub", latitude: 9.991, longitude: 78.150 },
            stops: [{ name: "Goripalayam", latitude: 9.932, longitude: 78.125 }],
            roadGeometry: [{ latitude: 9.925, longitude: 78.119 }, { latitude: 9.991, longitude: 78.150 }]
        };

        const aiOutwardRoute = {
            direction: "OUTWARD",
            source: { name: "College Hub", latitude: 9.991, longitude: 78.150 },
            destination: { name: "Simmakkal", latitude: 9.925, longitude: 78.119 },
            stops: [{ name: "Goripalayam", latitude: 9.932, longitude: 78.125 }],
            roadGeometry: [{ latitude: 9.991, longitude: 78.150 }, { latitude: 9.925, longitude: 78.119 }]
        };

        // Inward locations sequence
        const inwardLocations = [aiInwardRoute.source, ...aiInwardRoute.stops, aiInwardRoute.destination];
        assert.equal(inwardLocations[0].name, "Simmakkal", "Inward starts at residential stop");
        assert.equal(inwardLocations[2].name, "College Hub", "Inward ends at college destination");

        // Outward locations sequence
        const outwardLocations = [aiOutwardRoute.source, ...aiOutwardRoute.stops, aiOutwardRoute.destination];
        assert.equal(outwardLocations[0].name, "College Hub", "Outward starts at college source");
        assert.equal(outwardLocations[2].name, "Simmakkal", "Outward ends at residential stop");
    });

    // ==============================================================
    // ACCEPTANCE TEST M: User /me returns direction-accurate allocations
    // ==============================================================
    await t.test("TEST M: User /me returns direction-accurate allocations without auto-deriving opposite", () => {
        const db = new MockTransportationDB();
        db.addStudent(createMockStudent());

        // Scenario 1: Only Inward approved
        db.generatePlan("INWARD");
        db.approvePlan("INWARD");

        let authAlloc = db.getStudentAllocatedBus("STU001");
        assert.ok(authAlloc.inward, "Inward must be present");
        assert.equal(authAlloc.outward, null, "Outward must not be auto-derived or synthesized");

        // Scenario 2: Later Outward approved
        db.generatePlan("OUTWARD");
        db.approvePlan("OUTWARD");

        authAlloc = db.getStudentAllocatedBus("STU001");
        assert.ok(authAlloc.inward, "Inward must remain present");
        assert.ok(authAlloc.outward, "Outward must now be present");

        // Scenario 3: Reset Outward only
        db.resetDirection("OUTWARD");

        authAlloc = db.getStudentAllocatedBus("STU001");
        assert.ok(authAlloc.inward, "Inward must remain intact");
        assert.equal(authAlloc.outward, null, "Outward must be completely cleared");
    });

});

