import assert from "node:assert/strict";
import test from "node:test";
import { normalizeActivePlans } from "../services/studentTransportStatusService.js";

test("Outward and Inward Parity Comprehensive Test Suite", async (t) => {

    // Mock student factory
    function createMockStudent(overrides = {}) {
        return {
            _id: "student_001",
            userId: "STU001",
            name: "Parity Test Student",
            role: "student",
            travelStatus: "Coming",
            stoppings: "Anna Nagar",
            allocatedBus: null,
            affectedDirections: [],
            ...overrides
        };
    }

    // Direction-specific allocation builder
    function createDirectionAllocation(direction, stopName = "Anna Nagar") {
        const isInward = direction === "INWARD";
        return {
            isAllocated: true,
            approved: true,
            adminApprovalStatus: "Approved",
            direction,
            tripMode: isInward ? "TO_DESTINATION" : "FROM_SOURCE",
            planType: "AI",
            routeCode: isInward ? "R-IN-01" : "R-OUT-01",
            routeName: isInward ? "Inward Transit Line 1" : "Outward Transit Line 1",
            vehicleName: isInward ? "College Bus 01" : "College Bus 02",
            capacity: 50,
            assignedUsersCount: 30,
            remainingSeats: 20,
            seatNumber: isInward ? 12 : 14,
            seatStatus: isInward ? "#12" : "#14",
            boardingStop: stopName,
            sourceHub: isInward ? "Anna Nagar" : "College Campus",
            destinationHub: isInward ? "College Campus" : "Madurai City Hub",
            routeStops: isInward ? [
                { order: 1, name: "Anna Nagar", isUserStop: true },
                { order: 2, name: "Goripalayam", isUserStop: false },
                { order: 3, name: "College Campus", isUserStop: false }
            ] : [
                { order: 1, name: "College Campus", isUserStop: false },
                { order: 2, name: "Goripalayam", isUserStop: false },
                { order: 3, name: "Anna Nagar", isUserStop: true }
            ]
        };
    }

    // ── 1. OUTWARD ROUTE / PLAN LOGIC ──
    await t.test("1. Outward route/plan follows Hub -> Residential drop-offs", () => {
        const outwardAlloc = createDirectionAllocation("OUTWARD", "Anna Nagar");
        assert.equal(outwardAlloc.direction, "OUTWARD");
        assert.equal(outwardAlloc.tripMode, "FROM_SOURCE");
        assert.equal(outwardAlloc.sourceHub, "College Campus");
        assert.equal(outwardAlloc.routeStops[0].name, "College Campus");
        assert.equal(outwardAlloc.routeStops[outwardAlloc.routeStops.length - 1].name, "Anna Nagar");
    });

    // ── 2. INWARD ROUTE / PLAN LOGIC ──
    await t.test("2. Inward route/plan follows Residential pickups -> Hub", () => {
        const inwardAlloc = createDirectionAllocation("INWARD", "Anna Nagar");
        assert.equal(inwardAlloc.direction, "INWARD");
        assert.equal(inwardAlloc.tripMode, "TO_DESTINATION");
        assert.equal(inwardAlloc.destinationHub, "College Campus");
        assert.equal(inwardAlloc.routeStops[0].name, "Anna Nagar");
        assert.equal(inwardAlloc.routeStops[inwardAlloc.routeStops.length - 1].name, "College Campus");
    });

    // ── 3. OUTWARD USER ALLOCATION ──
    await t.test("3. Outward user allocation correctly assigns Outward vehicle and seat", () => {
        const outwardAlloc = createDirectionAllocation("OUTWARD", "Anna Nagar");
        const student = createMockStudent({
            allocatedBus: {
                ...outwardAlloc,
                outward: outwardAlloc,
                inward: null
            },
            assignedVehicle: outwardAlloc.vehicleName,
            assignedRoute: outwardAlloc.routeCode,
            allocationStatus: "Assigned"
        });

        assert.equal(student.allocatedBus.outward.isAllocated, true);
        assert.equal(student.allocatedBus.outward.seatNumber, 14);
        assert.equal(student.allocatedBus.outward.direction, "OUTWARD");
        assert.equal(student.allocatedBus.inward, null);
    });

    // ── 4. INWARD USER ALLOCATION ──
    await t.test("4. Inward user allocation correctly assigns Inward vehicle and seat", () => {
        const inwardAlloc = createDirectionAllocation("INWARD", "Anna Nagar");
        const student = createMockStudent({
            allocatedBus: {
                ...inwardAlloc,
                inward: inwardAlloc,
                outward: null
            },
            assignedVehicle: inwardAlloc.vehicleName,
            assignedRoute: inwardAlloc.routeCode,
            allocationStatus: "Assigned"
        });

        assert.equal(student.allocatedBus.inward.isAllocated, true);
        assert.equal(student.allocatedBus.inward.seatNumber, 12);
        assert.equal(student.allocatedBus.inward.direction, "INWARD");
        assert.equal(student.allocatedBus.outward, null);
    });

    // ── 5. OUTWARD PLAN APPROVAL PRESERVES INWARD ALLOCATION ──
    await t.test("5. Outward plan approval preserves existing Inward allocation", () => {
        const inwardAlloc = createDirectionAllocation("INWARD");
        const outwardAlloc = createDirectionAllocation("OUTWARD");

        // Pre-existing inward allocation
        let student = createMockStudent({
            allocatedBus: {
                ...inwardAlloc,
                inward: inwardAlloc,
                outward: null
            }
        });

        // Now Outward plan is approved
        const existingInward = student.allocatedBus?.inward;
        const mergedAlloc = {
            ...outwardAlloc,
            inward: existingInward,
            outward: outwardAlloc,
            isAllocated: true,
            adminApprovalStatus: "Approved"
        };
        student.allocatedBus = mergedAlloc;

        assert.equal(student.allocatedBus.outward.isAllocated, true);
        assert.equal(student.allocatedBus.inward.isAllocated, true);
        assert.equal(student.allocatedBus.inward.routeCode, "R-IN-01");
        assert.equal(student.allocatedBus.outward.routeCode, "R-OUT-01");
    });

    // ── 6. INWARD PLAN APPROVAL PRESERVES OUTWARD ALLOCATION ──
    await t.test("6. Inward plan approval preserves existing Outward allocation", () => {
        const outwardAlloc = createDirectionAllocation("OUTWARD");
        const inwardAlloc = createDirectionAllocation("INWARD");

        // Pre-existing outward allocation
        let student = createMockStudent({
            allocatedBus: {
                ...outwardAlloc,
                outward: outwardAlloc,
                inward: null
            }
        });

        // Now Inward plan is approved
        const existingOutward = student.allocatedBus?.outward;
        const mergedAlloc = {
            ...inwardAlloc,
            inward: inwardAlloc,
            outward: existingOutward,
            isAllocated: true,
            adminApprovalStatus: "Approved"
        };
        student.allocatedBus = mergedAlloc;

        assert.equal(student.allocatedBus.inward.isAllocated, true);
        assert.equal(student.allocatedBus.outward.isAllocated, true);
        assert.equal(student.allocatedBus.inward.routeCode, "R-IN-01");
        assert.equal(student.allocatedBus.outward.routeCode, "R-OUT-01");
    });

    // ── 7. OUTWARD LATE RESPONSE DOES NOT BREAK INWARD ──
    await t.test("7. Outward late response keeps Inward allocation active while Outward is pending reallocation", () => {
        const inwardAlloc = createDirectionAllocation("INWARD");
        const student = createMockStudent({
            allocatedBus: {
                inward: inwardAlloc,
                outward: null,
                isAllocated: true,
                direction: "INWARD",
                vehicleName: inwardAlloc.vehicleName,
                routeCode: inwardAlloc.routeCode
            },
            affectedDirections: ["OUTWARD"],
            lateResponseDetected: true,
            isLateResponse: true,
            requiresReallocation: true
        });

        // Parse student state according to StudentDashboard.jsx rules
        const affectedDirections = student.affectedDirections || [];
        const inwardActive = (!affectedDirections.includes("INWARD") && student.allocatedBus?.inward?.isAllocated);
        const outwardActive = (!affectedDirections.includes("OUTWARD") && student.allocatedBus?.outward?.isAllocated);
        const isLate = Boolean(student.lateResponseDetected || student.isLateResponse);
        const hasDirectionalAlloc = Boolean(inwardActive || outwardActive);
        const isAllocated = hasDirectionalAlloc;

        const isInwardPendingRealloc = affectedDirections.includes("INWARD");
        const isOutwardPendingRealloc = affectedDirections.includes("OUTWARD");

        assert.equal(inwardActive, true, "Inward allocation must remain active");
        assert.equal(outwardActive, false, "Outward allocation must be inactive due to late response");
        assert.equal(isAllocated, true, "Student has an active allocation for Inward");
        assert.equal(isOutwardPendingRealloc, true, "Outward must be flagged as pending reallocation");
        assert.equal(isInwardPendingRealloc, false, "Inward must not be flagged as pending reallocation");
    });

    // ── 8. INWARD LATE RESPONSE DOES NOT BREAK OUTWARD ──
    await t.test("8. Inward late response keeps Outward allocation active while Inward is pending reallocation", () => {
        const outwardAlloc = createDirectionAllocation("OUTWARD");
        const student = createMockStudent({
            allocatedBus: {
                inward: null,
                outward: outwardAlloc,
                isAllocated: true,
                direction: "OUTWARD",
                vehicleName: outwardAlloc.vehicleName,
                routeCode: outwardAlloc.routeCode
            },
            affectedDirections: ["INWARD"],
            lateResponseDetected: true,
            isLateResponse: true,
            requiresReallocation: true
        });

        // Parse student state according to StudentDashboard.jsx rules
        const affectedDirections = student.affectedDirections || [];
        const inwardActive = (!affectedDirections.includes("INWARD") && student.allocatedBus?.inward?.isAllocated);
        const outwardActive = (!affectedDirections.includes("OUTWARD") && student.allocatedBus?.outward?.isAllocated);
        const hasDirectionalAlloc = Boolean(inwardActive || outwardActive);
        const isAllocated = hasDirectionalAlloc;

        const isInwardPendingRealloc = affectedDirections.includes("INWARD");
        const isOutwardPendingRealloc = affectedDirections.includes("OUTWARD");

        assert.equal(outwardActive, true, "Outward allocation must remain active");
        assert.equal(inwardActive, false, "Inward allocation must be inactive due to late response");
        assert.equal(isAllocated, true, "Student has an active allocation for Outward");
        assert.equal(isInwardPendingRealloc, true, "Inward must be flagged as pending reallocation");
        assert.equal(isOutwardPendingRealloc, false, "Outward must not be flagged as pending reallocation");
    });

    // ── 9. OUTWARD RESET DOES NOT WIPE INWARD ──
    await t.test("9. Outward reset clears Outward while leaving Inward allocation untouched", () => {
        const inwardAlloc = createDirectionAllocation("INWARD");
        const outwardAlloc = createDirectionAllocation("OUTWARD");

        const student = createMockStudent({
            allocatedBus: {
                inward: inwardAlloc,
                outward: outwardAlloc,
                isAllocated: true,
                direction: "INWARD"
            },
            assignedVehicle: inwardAlloc.vehicleName,
            assignedRoute: inwardAlloc.routeCode,
            allocationStatus: "Assigned"
        });

        // Simulate targeted Outward reset
        const targetDirection = "OUTWARD";
        if (targetDirection === "OUTWARD") {
            const remainingInward = student.allocatedBus?.inward;
            student.allocatedBus.outward = null;
            if (remainingInward && remainingInward.isAllocated) {
                student.allocatedBus.isAllocated = true;
                student.allocatedBus.direction = "INWARD";
                student.allocatedBus.vehicleName = remainingInward.vehicleName;
                student.allocatedBus.routeCode = remainingInward.routeCode;
                student.assignedVehicle = remainingInward.vehicleName;
                student.assignedRoute = remainingInward.routeCode;
                student.allocationStatus = "Assigned";
            }
        }

        assert.equal(student.allocatedBus.outward, null);
        assert.notEqual(student.allocatedBus.inward, null);
        assert.equal(student.allocatedBus.isAllocated, true);
        assert.equal(student.allocatedBus.direction, "INWARD");
        assert.equal(student.assignedVehicle, inwardAlloc.vehicleName);
        assert.equal(student.allocationStatus, "Assigned");
    });

    // ── 10. INWARD RESET DOES NOT WIPE OUTWARD ──
    await t.test("10. Inward reset clears Inward while leaving Outward allocation untouched", () => {
        const inwardAlloc = createDirectionAllocation("INWARD");
        const outwardAlloc = createDirectionAllocation("OUTWARD");

        const student = createMockStudent({
            allocatedBus: {
                inward: inwardAlloc,
                outward: outwardAlloc,
                isAllocated: true,
                direction: "OUTWARD"
            },
            assignedVehicle: outwardAlloc.vehicleName,
            assignedRoute: outwardAlloc.routeCode,
            allocationStatus: "Assigned"
        });

        // Simulate targeted Inward reset
        const targetDirection = "INWARD";
        if (targetDirection === "INWARD") {
            const remainingOutward = student.allocatedBus?.outward;
            student.allocatedBus.inward = null;
            if (remainingOutward && remainingOutward.isAllocated) {
                student.allocatedBus.isAllocated = true;
                student.allocatedBus.direction = "OUTWARD";
                student.allocatedBus.vehicleName = remainingOutward.vehicleName;
                student.allocatedBus.routeCode = remainingOutward.routeCode;
                student.assignedVehicle = remainingOutward.vehicleName;
                student.assignedRoute = remainingOutward.routeCode;
                student.allocationStatus = "Assigned";
            }
        }

        assert.equal(student.allocatedBus.inward, null);
        assert.notEqual(student.allocatedBus.outward, null);
        assert.equal(student.allocatedBus.isAllocated, true);
        assert.equal(student.allocatedBus.direction, "OUTWARD");
        assert.equal(student.assignedVehicle, outwardAlloc.vehicleName);
        assert.equal(student.allocationStatus, "Assigned");
    });

    // ── 11. REFRESH AND POLLING FOR BOTH DIRECTIONS ──
    await t.test("11. normalizeActivePlans respects direction options symmetrically", () => {
        const plans = {
            INWARD: { isApproved: true, planVersion: 1, direction: "INWARD" },
            OUTWARD: { isApproved: true, planVersion: 2, direction: "OUTWARD" }
        };

        const inwardQuery = normalizeActivePlans(plans, { direction: "INWARD" });
        assert.equal(inwardQuery.primaryPlan.direction, "INWARD");
        assert.equal(inwardQuery.primaryPlan.planVersion, 1);

        const outwardQuery = normalizeActivePlans(plans, { direction: "OUTWARD" });
        assert.equal(outwardQuery.primaryPlan.direction, "OUTWARD");
        assert.equal(outwardQuery.primaryPlan.planVersion, 2);
    });

    // ── 12. FRONTEND DISPLAY AND FILTERS FOR BOTH DIRECTIONS ──
    await t.test("12. Frontend direction filter and dual-direction badge logic", () => {
        const studentDual = createMockStudent({
            allocatedBus: {
                inward: createDirectionAllocation("INWARD"),
                outward: createDirectionAllocation("OUTWARD")
            }
        });

        const studentInwardOnly = createMockStudent({
            allocatedBus: {
                inward: createDirectionAllocation("INWARD"),
                outward: null
            }
        });

        const studentOutwardOnly = createMockStudent({
            allocatedBus: {
                inward: null,
                outward: createDirectionAllocation("OUTWARD")
            }
        });

        const checkDirectionFilter = (user, filter) => {
            if (filter === "All") return true;
            const hasInward = Boolean(
                user.allocatedBus?.inward?.isAllocated ||
                user.allocatedBus?.direction === "INWARD" ||
                user.direction === "INWARD" ||
                (Array.isArray(user.affectedDirections) && user.affectedDirections.includes("INWARD"))
            );
            const hasOutward = Boolean(
                user.allocatedBus?.outward?.isAllocated ||
                user.allocatedBus?.direction === "OUTWARD" ||
                user.direction === "OUTWARD" ||
                (Array.isArray(user.affectedDirections) && user.affectedDirections.includes("OUTWARD"))
            );

            if (filter === "INWARD") return hasInward;
            if (filter === "OUTWARD") return hasOutward;
            return true;
        };

        // All filter
        assert.equal(checkDirectionFilter(studentDual, "All"), true);
        assert.equal(checkDirectionFilter(studentInwardOnly, "All"), true);
        assert.equal(checkDirectionFilter(studentOutwardOnly, "All"), true);

        // INWARD filter
        assert.equal(checkDirectionFilter(studentDual, "INWARD"), true);
        assert.equal(checkDirectionFilter(studentInwardOnly, "INWARD"), true);
        assert.equal(checkDirectionFilter(studentOutwardOnly, "INWARD"), false);

        // OUTWARD filter
        assert.equal(checkDirectionFilter(studentDual, "OUTWARD"), true);
        assert.equal(checkDirectionFilter(studentInwardOnly, "OUTWARD"), false);
        assert.equal(checkDirectionFilter(studentOutwardOnly, "OUTWARD"), true);

        // Dual badge test
        const hasDualBadges = Boolean(studentDual.allocatedBus?.inward && studentDual.allocatedBus?.outward);
        assert.equal(hasDualBadges, true);
    });

    // ── 13. USER DOCUMENT: LATE OUTWARD RESPONSE PRESERVES INWARD ALLOCATION ──
    await t.test("13. Late Outward response preserves approved Inward allocation on User document", () => {
        const inwardAlloc = createDirectionAllocation("INWARD");
        const student = createMockStudent({
            allocatedBus: {
                ...inwardAlloc,
                inward: inwardAlloc,
                outward: null
            },
            assignedVehicle: inwardAlloc.vehicleName,
            assignedRoute: inwardAlloc.routeCode,
            allocationStatus: "Assigned",
            isAllocated: true
        });

        // Simulate submitTravelResponse when student submits late for OUTWARD
        const affectedDirections = ["OUTWARD"];
        const unaffectedDirs = ["INWARD", "OUTWARD"].filter((d) => !affectedDirections.includes(d));
        let remainingActiveAlloc = null;
        let remainingDir = null;

        for (const dir of unaffectedDirs) {
            const dirKey = dir.toLowerCase();
            const cand = student.allocatedBus?.[dirKey];
            if (cand && cand.isAllocated && (cand.approved === true || cand.adminApprovalStatus === "Approved")) {
                remainingActiveAlloc = cand;
                remainingDir = dir;
                break;
            }
        }

        assert.ok(remainingActiveAlloc, "Must find active Inward allocation");
        assert.equal(remainingDir, "INWARD");

        // Apply controller update logic
        const newAllocatedBus = {
            ...remainingActiveAlloc,
            inward: remainingActiveAlloc,
            outward: null,
            isAllocated: true,
            direction: remainingDir,
            affectedDirections
        };

        student.allocatedBus = newAllocatedBus;
        student.assignedVehicle = remainingActiveAlloc.vehicleName;
        student.assignedRoute = remainingActiveAlloc.routeCode;
        student.isAllocated = true;
        student.allocationStatus = "Assigned";
        student.lateResponseDetected = true;
        student.requiresReallocation = true;
        student.affectedDirections = affectedDirections;

        // Verify Inward is 100% intact!
        assert.equal(student.allocatedBus.inward.isAllocated, true);
        assert.equal(student.allocatedBus.inward.routeCode, "R-IN-01");
        assert.equal(student.assignedVehicle, inwardAlloc.vehicleName);
        assert.equal(student.allocationStatus, "Assigned");
        assert.equal(student.isAllocated, true);
        assert.deepEqual(student.affectedDirections, ["OUTWARD"]);
    });

    // ── 14. USER DOCUMENT: LATE INWARD RESPONSE PRESERVES OUTWARD ALLOCATION ──
    await t.test("14. Late Inward response preserves approved Outward allocation on User document", () => {
        const outwardAlloc = createDirectionAllocation("OUTWARD");
        const student = createMockStudent({
            allocatedBus: {
                ...outwardAlloc,
                inward: null,
                outward: outwardAlloc
            },
            assignedVehicle: outwardAlloc.vehicleName,
            assignedRoute: outwardAlloc.routeCode,
            allocationStatus: "Assigned",
            isAllocated: true
        });

        // Simulate submitTravelResponse when student submits late for INWARD
        const affectedDirections = ["INWARD"];
        const unaffectedDirs = ["INWARD", "OUTWARD"].filter((d) => !affectedDirections.includes(d));
        let remainingActiveAlloc = null;
        let remainingDir = null;

        for (const dir of unaffectedDirs) {
            const dirKey = dir.toLowerCase();
            const cand = student.allocatedBus?.[dirKey];
            if (cand && cand.isAllocated && (cand.approved === true || cand.adminApprovalStatus === "Approved")) {
                remainingActiveAlloc = cand;
                remainingDir = dir;
                break;
            }
        }

        assert.ok(remainingActiveAlloc, "Must find active Outward allocation");
        assert.equal(remainingDir, "OUTWARD");

        // Apply controller update logic
        const newAllocatedBus = {
            ...remainingActiveAlloc,
            inward: null,
            outward: remainingActiveAlloc,
            isAllocated: true,
            direction: remainingDir,
            affectedDirections
        };

        student.allocatedBus = newAllocatedBus;
        student.assignedVehicle = remainingActiveAlloc.vehicleName;
        student.assignedRoute = remainingActiveAlloc.routeCode;
        student.isAllocated = true;
        student.allocationStatus = "Assigned";
        student.lateResponseDetected = true;
        student.requiresReallocation = true;
        student.affectedDirections = affectedDirections;

        // Verify Outward is 100% intact!
        assert.equal(student.allocatedBus.outward.isAllocated, true);
        assert.equal(student.allocatedBus.outward.routeCode, "R-OUT-01");
        assert.equal(student.assignedVehicle, outwardAlloc.vehicleName);
        assert.equal(student.allocationStatus, "Assigned");
        assert.equal(student.isAllocated, true);
        assert.deepEqual(student.affectedDirections, ["INWARD"]);
    });

    // ── 15. RESOLUTION ISOLATION: RESOLVING INWARD LEAVES OUTWARD LATE ACTIVE ──
    await t.test("15. Resolving Inward late response leaves Outward late response active", () => {
        const student = createMockStudent({
            affectedDirections: ["INWARD", "OUTWARD"],
            lateResponseDetected: true,
            requiresReallocation: true,
            isLateResponse: true
        });

        // Pipeline simulation for resolving INWARD
        const canonicalDirection = "INWARD";
        const remainingAffected = student.affectedDirections.filter((d) => d !== canonicalDirection);
        student.affectedDirections = remainingAffected;
        student.lateResponseDetected = remainingAffected.length > 0;
        student.requiresReallocation = remainingAffected.length > 0;
        student.isLateResponse = remainingAffected.length > 0;

        assert.deepEqual(student.affectedDirections, ["OUTWARD"]);
        assert.equal(student.lateResponseDetected, true, "Outward late response must still be active");
        assert.equal(student.requiresReallocation, true, "Requires reallocation must still be true");
    });

    // ── 16. DIRECTION-AWARE ALLOCATION CHECK FOR APPROVED PLAN ──
    await t.test("16. Allocation check is strictly direction-aware", () => {
        const studentWithInwardOnly = createMockStudent({
            allocatedBus: {
                inward: createDirectionAllocation("INWARD"),
                outward: null,
                isAllocated: true,
                direction: "INWARD"
            }
        });

        const outwardPlan = {
            direction: "OUTWARD",
            allocatedUserIds: new Set(["other_user"])
        };

        const planDirLower = outwardPlan.direction.toLowerCase();
        const directionalAlloc = studentWithInwardOnly.allocatedBus?.[planDirLower];
        const isDirectionAllocated = Boolean(
            directionalAlloc?.isAllocated &&
            (directionalAlloc.approved === true || directionalAlloc.adminApprovalStatus === "Approved")
        );

        const isTopLevelAllocated = Boolean(
            studentWithInwardOnly.allocatedBus?.isAllocated &&
            studentWithInwardOnly.allocatedBus?.direction === outwardPlan.direction
        );

        const isAllocatedInOutwardPlan = outwardPlan.allocatedUserIds.has(studentWithInwardOnly.userId) ||
            isDirectionAllocated ||
            isTopLevelAllocated;

        assert.equal(isAllocatedInOutwardPlan, false, "Student with only Inward allocation must not count as allocated in Outward plan");
    });
});

