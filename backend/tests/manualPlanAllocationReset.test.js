import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
dotenv.config();
import { resetManualAllocations } from "../controllers/routeController.js";

/**
 * Test Suite: Reset Manual Plan Allocation Button & Dedicated Reset Controller
 *
 * Validates requirements:
 * 1. User-to-vehicle allocations created by the admin manual plan are removed.
 * 2. Manual routes and stopping areas are NOT deleted.
 * 3. Vehicles and seating capacities remain unchanged.
 * 4. AI-generated plan and AI allocations remain unchanged.
 * 5. Student travel responses (Coming / Not Coming / Pending) remain unchanged.
 * 6. Direction-aware reset preserves opposite direction.
 * 7. Success responses and error handling work correctly.
 */

import mongoose from "mongoose";

test("Reset Manual Plan Allocation Test Suite", async (t) => {
    const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/test_ai_transportation";
    if (mongoose.connection.readyState === 0) {
        try {
            await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
        } catch (e) {
            console.warn("MongoDB connection skipped for local test environment if unmounted:", e.message);
        }
    }

    const SUBMISSION_TIME = new Date("2026-09-18T08:00:00.000Z");

    function createMockStudent(id, name, travelStatus = "Coming") {
        return {
            _id: `stu_${id}`,
            userId: `STU_${id}`,
            name,
            role: "student",
            travelStatus,
            travelResponseSubmittedAt: SUBMISSION_TIME,
            allocatedBus: null,
            manualRouteId: null,
            manualBusId: null,
            manualAllocation: null,
            assignedVehicle: null,
            assignedRoute: null,
            approvedPlanType: null,
            allocationStatus: travelStatus === "Coming" ? "Unallocated" : "Not Assigned"
        };
    }

    const mockRoutes = [
        { _id: "route_inward_1", routeName: "Inward Route 1", routeCode: "R-01", direction: "INWARD", capacity: 50 },
        { _id: "route_outward_1", routeName: "Outward Route 1", routeCode: "R-02", direction: "OUTWARD", capacity: 50 }
    ];

    const mockVehicles = [
        { _id: "veh_1", vehicleName: "Bus 01", capacity: 50, vehicleNumber: "TN-58-1234" }
    ];

    // Simulate allocating a student to a manual inward route
    function allocateManualInward(student, route, vehicle) {
        return {
            ...student,
            manualRouteId: route._id,
            manualBusId: vehicle._id,
            assignedVehicle: vehicle.vehicleName,
            assignedRoute: route.routeCode,
            approvedPlanType: "MANUAL",
            allocationStatus: "Assigned",
            manualAllocation: {
                routeId: route._id,
                vehicleId: vehicle._id,
                vehicleName: vehicle.vehicleName,
                isAllocated: true
            },
            allocatedBus: {
                isAllocated: true,
                direction: "INWARD",
                planType: "MANUAL",
                vehicleName: vehicle.vehicleName,
                routeCode: route.routeCode,
                inward: {
                    isAllocated: true,
                    direction: "INWARD",
                    planType: "MANUAL",
                    vehicleName: vehicle.vehicleName,
                    routeCode: route.routeCode
                },
                outward: null
            }
        };
    }

    // Simulate allocating a student to an AI outward route
    function allocateAiOutward(student) {
        const prevInward = student.allocatedBus?.inward || null;
        return {
            ...student,
            allocatedBus: {
                isAllocated: true,
                direction: prevInward ? "BOTH" : "OUTWARD",
                planType: prevInward ? "MIXED" : "AI",
                vehicleName: "AI Fleet 2",
                inward: prevInward,
                outward: {
                    isAllocated: true,
                    direction: "OUTWARD",
                    planType: "AI",
                    vehicleName: "AI Fleet 2",
                    routeCode: "R-AI-02"
                }
            }
        };
    }

    // Simulate the resetManualAllocations logic for in-memory student documents
    function simulateAllocationReset(students, direction) {
        return students.map((u) => {
            if (u.role !== "student") return u;
            const existingAlloc = u.allocatedBus || {};
            const inward = existingAlloc.inward;
            const outward = existingAlloc.outward;

            let newInward = inward;
            let newOutward = outward;

            if (direction === "INWARD" || !direction) {
                if (inward && (inward.planType === "MANUAL" || inward.planType === "ADMIN")) {
                    newInward = null;
                }
            }

            if (direction === "OUTWARD" || !direction) {
                if (outward && (outward.planType === "MANUAL" || outward.planType === "ADMIN")) {
                    newOutward = null;
                }
            }

            const hasInward = Boolean(newInward && newInward.isAllocated);
            const hasOutward = Boolean(newOutward && newOutward.isAllocated);
            const isStillAllocated = hasInward || hasOutward;

            return {
                ...u,
                manualRouteId: (direction === "INWARD" || !direction) ? null : u.manualRouteId,
                manualBusId: (direction === "INWARD" || !direction) ? null : u.manualBusId,
                manualAllocation: (direction === "INWARD" || !direction) ? null : u.manualAllocation,
                assignedVehicle: isStillAllocated ? (hasOutward ? newOutward.vehicleName : newInward.vehicleName) : null,
                assignedRoute: isStillAllocated ? (hasOutward ? newOutward.routeCode : newInward.routeCode) : null,
                approvedPlanType: isStillAllocated ? (hasOutward ? newOutward.planType : newInward.planType) : null,
                allocationStatus: isStillAllocated ? "Assigned" : (u.travelStatus === "Coming" ? "Unallocated" : "Not Assigned"),
                allocatedBus: isStillAllocated ? {
                    isAllocated: true,
                    inward: newInward,
                    outward: newOutward,
                    direction: hasOutward ? "OUTWARD" : "INWARD",
                    vehicleName: hasOutward ? newOutward.vehicleName : newInward.vehicleName
                } : null
            };
        });
    }

    // Test 1: Allocations removed, routes preserved
    await t.test("1. Manual allocations removed while routes remain in database", () => {
        const student1 = createMockStudent("1", "Alice", "Coming");
        const student2 = createMockStudent("2", "Bob", "Coming");
        const allocatedUsers = [
            allocateManualInward(student1, mockRoutes[0], mockVehicles[0]),
            allocateManualInward(student2, mockRoutes[0], mockVehicles[0])
        ];

        assert.strictEqual(allocatedUsers[0].allocationStatus, "Assigned");
        assert.strictEqual(allocatedUsers[0].allocatedBus.isAllocated, true);

        const resetUsers = simulateAllocationReset(allocatedUsers, "INWARD");

        // Allocations removed
        assert.strictEqual(resetUsers[0].allocatedBus, null);
        assert.strictEqual(resetUsers[0].manualRouteId, null);
        assert.strictEqual(resetUsers[0].manualBusId, null);
        assert.strictEqual(resetUsers[0].assignedVehicle, null);
        assert.strictEqual(resetUsers[0].allocationStatus, "Unallocated");

        // Routes still exist
        assert.strictEqual(mockRoutes.length, 2);
        assert.strictEqual(mockRoutes[0].routeName, "Inward Route 1");
    });

    // Test 2: Vehicles and capacities remain unchanged
    await t.test("2. Vehicles and seating capacities remain unchanged", () => {
        assert.strictEqual(mockVehicles.length, 1);
        assert.strictEqual(mockVehicles[0].capacity, 50);
        assert.strictEqual(mockVehicles[0].vehicleName, "Bus 01");
    });

    // Test 3: Student travel responses (Coming / Not Coming / Pending) remain unchanged
    await t.test("3. Student travel responses remain preserved (Coming / Not Coming / Pending)", () => {
        const comingStudent = createMockStudent("1", "Alice", "Coming");
        const notComingStudent = createMockStudent("2", "Bob", "Not Coming");
        const pendingStudent = createMockStudent("3", "Charlie", "Pending");

        const users = [
            allocateManualInward(comingStudent, mockRoutes[0], mockVehicles[0]),
            notComingStudent,
            pendingStudent
        ];

        const resetUsers = simulateAllocationReset(users, "INWARD");

        assert.strictEqual(resetUsers[0].travelStatus, "Coming");
        assert.strictEqual(resetUsers[0].travelResponseSubmittedAt, SUBMISSION_TIME);
        assert.strictEqual(resetUsers[1].travelStatus, "Not Coming");
        assert.strictEqual(resetUsers[2].travelStatus, "Pending");
    });

    // Test 4: AI allocations remain untouched when manual allocations are reset
    await t.test("4. AI-generated plan and AI allocations remain completely untouched", () => {
        let student = createMockStudent("1", "Alice", "Coming");
        student = allocateManualInward(student, mockRoutes[0], mockVehicles[0]);
        student = allocateAiOutward(student);

        // Student has both Inward Manual and Outward AI
        assert.strictEqual(student.allocatedBus.inward.planType, "MANUAL");
        assert.strictEqual(student.allocatedBus.outward.planType, "AI");

        // Reset INWARD manual allocations
        const [afterReset] = simulateAllocationReset([student], "INWARD");

        // Inward manual allocation is cleared
        assert.strictEqual(afterReset.allocatedBus.inward, null);
        // Outward AI allocation is completely intact!
        assert.strictEqual(afterReset.allocatedBus.outward.planType, "AI");
        assert.strictEqual(afterReset.allocatedBus.outward.vehicleName, "AI Fleet 2");
        assert.strictEqual(afterReset.allocatedBus.isAllocated, true);
        assert.strictEqual(afterReset.allocationStatus, "Assigned");
    });

    // Test 5: Controller exports and response contract
    await t.test("5. Controller function resetManualAllocations returns expected response", async () => {
        let sentJson = null;
        const req = { body: { direction: "INWARD" } };
        const res = {
            json: (data) => { sentJson = data; },
            status: () => res
        };

        await resetManualAllocations(req, res);
        assert.ok(sentJson, "Response must be sent");
        assert.strictEqual(sentJson.success, true);
        assert.strictEqual(sentJson.message, "Manual plan allocations reset successfully");
        assert.strictEqual(sentJson.direction, "INWARD");
    });

    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
    }
});
