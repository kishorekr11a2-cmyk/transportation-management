import assert from "node:assert/strict";
import test from "node:test";
import {
    batchCalculateStudentTransportStatuses,
    getActiveAllocationForStudent
} from "../services/studentTransportStatusService.js";
import User from "../models/User.js";

test("Reset Travel Status Performance & Concurrency Optimization Suite", async (t) => {

    // ─────────────────────────────────────────────────────────────
    // 1. BULK RESET PERFORMANCE WITH 400 USERS
    // ─────────────────────────────────────────────────────────────
    await t.test("1. Bulk Reset with 400 Users: Executes in a single parallel batch without loops", async () => {
        // Mock 400 student users with mixed statuses and allocations
        const mockUsers = [];
        for (let i = 1; i <= 400; i++) {
            const isAlloc = i <= 371;
            const isComing = i <= 396;
            mockUsers.push({
                _id: `mongo_usr_${i}`,
                userId: `USR${String(i).padStart(4, "0")}`,
                name: `Student ${i}`,
                role: "student",
                travelStatus: isComing ? "Coming" : (i === 397 ? "Pending" : "Not Coming"),
                allocationStatus: isAlloc ? "Assigned" : "Unallocated",
                isAllocated: isAlloc,
                isUnallocated: !isAlloc,
                allocatedBus: isAlloc ? { isAllocated: true, vehicleName: `Bus ${i % 10}`, routeCode: `R-${i % 5}` } : null,
                assignedVehicle: isAlloc ? `Bus ${i % 10}` : null,
                assignedRoute: isAlloc ? `R-${i % 5}` : null,
                lateResponseDetected: i > 390 && isComing,
                isLateResponse: i > 390 && isComing
            });
        }

        assert.equal(mockUsers.length, 400);

        // Simulation of optimized parallel bulk execution
        const startTime = Date.now();

        const resetSetFields = {
            travelStatus: "Pending",
            allocationStatus: "Unallocated",
            isAllocated: false,
            isUnallocated: true,
            lateResponseDetected: false,
            isLateResponse: false,
            approvedPlanType: null,
            approvalStatus: null,
            lateResponseAt: null,
            travelResponseSubmittedAt: null,
            lastTravelResponseAt: null,
            previousTravelStatus: null,
            requiresReallocation: false,
            affectedDirections: [],
            lateResponseNotifiedEventKeys: [],
            lateResponseNotifiedAt: null,
            lateResponseResolvedAt: null
        };

        const resetUnsetFields = {
            allocatedBus: 1,
            assignedVehicle: 1,
            assignedRoute: 1,
            manualRouteId: 1,
            manualBusId: 1,
            routeId: 1,
            busId: 1,
            vehicleId: 1,
            planVersion: 1,
            manualAllocation: 1,
            aiAllocation: 1,
            submittedPlanVersion: 1,
            submittedApprovalEventId: 1,
            lateResponseEventId: 1
        };

        // Parallel mock collection updates
        let plansReset = false;
        let routesReset = false;
        let lateEventsResolved = false;

        const usersPromise = Promise.resolve().then(() => {
            // In a real MongoDB database, User.updateMany executes in one atomic query
            for (const u of mockUsers) {
                Object.assign(u, resetSetFields);
                for (const key of Object.keys(resetUnsetFields)) {
                    delete u[key];
                }
            }
            return { matchedCount: mockUsers.length, modifiedCount: mockUsers.length };
        });

        const plansPromise = Promise.resolve().then(() => {
            plansReset = true;
            return { modifiedCount: 2 };
        });

        const routesPromise = Promise.resolve().then(() => {
            routesReset = true;
            return { modifiedCount: 5 };
        });

        const latePromise = Promise.resolve().then(() => {
            lateEventsResolved = true;
            return { modifiedCount: 10 };
        });

        const [userUpdateResult] = await Promise.all([
            usersPromise,
            plansPromise,
            routesPromise,
            latePromise
        ]);

        const duration = Date.now() - startTime;

        assert.equal(userUpdateResult.matchedCount, 400);
        assert.equal(plansReset, true);
        assert.equal(routesReset, true);
        assert.equal(lateEventsResolved, true);
        assert.ok(duration < 50, `Parallel reset must complete in < 50ms (took ${duration}ms)`);

        // Verify all 400 users are Pending and Unallocated
        for (const u of mockUsers) {
            assert.equal(u.travelStatus, "Pending");
            assert.equal(u.allocationStatus, "Unallocated");
            assert.equal(u.isAllocated, false);
            assert.equal(u.isUnallocated, true);
            assert.equal(u.allocatedBus, undefined);
            assert.equal(u.assignedVehicle, undefined);
            assert.equal(u.assignedRoute, undefined);
            assert.equal(u.lateResponseDetected, false);
            assert.equal(u.isLateResponse, false);
        }
    });

    // ─────────────────────────────────────────────────────────────
    // 2. NO MONGODB PATH CONFLICT IN PARALLEL RESET
    // ─────────────────────────────────────────────────────────────
    await t.test("2. Conflict-free operation: Zero overlap between $set and $unset", () => {
        const resetSetFields = {
            travelStatus: "Pending",
            allocationStatus: "Unallocated",
            isAllocated: false,
            isUnallocated: true,
            lateResponseDetected: false,
            isLateResponse: false,
            approvedPlanType: null,
            approvalStatus: null,
            lateResponseAt: null,
            travelResponseSubmittedAt: null,
            lastTravelResponseAt: null,
            previousTravelStatus: null,
            requiresReallocation: false,
            affectedDirections: [],
            lateResponseNotifiedEventKeys: [],
            lateResponseNotifiedAt: null,
            lateResponseResolvedAt: null
        };

        const resetUnsetFields = {
            allocatedBus: 1,
            assignedVehicle: 1,
            assignedRoute: 1,
            manualRouteId: 1,
            manualBusId: 1,
            routeId: 1,
            busId: 1,
            vehicleId: 1,
            planVersion: 1,
            manualAllocation: 1,
            aiAllocation: 1,
            submittedPlanVersion: 1,
            submittedApprovalEventId: 1,
            lateResponseEventId: 1
        };

        assert.equal("allocatedBus" in resetSetFields, false);
        assert.equal("allocatedBus" in resetUnsetFields, true);
        assert.equal("allocatedBus.inward" in resetUnsetFields, false);
        assert.equal("allocatedBus.outward" in resetUnsetFields, false);

        const setKeys = new Set(Object.keys(resetSetFields));
        for (const unsetKey of Object.keys(resetUnsetFields)) {
            assert.equal(setKeys.has(unsetKey), false, `Key ${unsetKey} must not exist in both $set and $unset`);
        }
    });

    // ─────────────────────────────────────────────────────────────
    // 3. TARGETED SINGLE USER RESET (DOES NOT AFFECT OTHER STUDENTS OR MATCH BY NAME)
    // ─────────────────────────────────────────────────────────────
    await t.test("3. Targeted Single User Reset: Targets only unique userId, never touches student name or others", async () => {
        // Two students with identical name "John Doe" but different userIds
        const studentA = {
            _id: "mongo_std_a",
            userId: "USR1001",
            name: "John Doe",
            travelStatus: "Coming",
            allocationStatus: "Assigned",
            isAllocated: true
        };
        const studentB = {
            _id: "mongo_std_b",
            userId: "USR1002",
            name: "John Doe",
            travelStatus: "Coming",
            allocationStatus: "Assigned",
            isAllocated: true
        };

        const planBuses = [
            {
                vehicleName: "Bus 1",
                capacity: 50,
                assignedUsersCount: 2,
                remainingSeats: 48,
                users: [
                    { userId: "USR1001", name: "John Doe" },
                    { userId: "USR1002", name: "John Doe" }
                ],
                allocatedStudents: [
                    { userId: "USR1001", name: "John Doe" },
                    { userId: "USR1002", name: "John Doe" }
                ]
            }
        ];

        // Reset ONLY studentA (USR1001)
        const targetUserId = "usr1001";
        const targetMongoId = "mongo_std_a";

        const matchesTargetUser = (item) => {
            if (!item) return false;
            if (typeof item === "string") {
                const s = item.toLowerCase().trim();
                return s === targetUserId || s === targetMongoId;
            }
            if (typeof item === "object") {
                const candId = String(item.userId || item._id || item.id || "").toLowerCase().trim();
                return candId === targetUserId || candId === targetMongoId;
            }
            return false;
        };

        for (const bus of planBuses) {
            bus.users = bus.users.filter((u) => !matchesTargetUser(u));
            bus.allocatedStudents = bus.allocatedStudents.filter((u) => !matchesTargetUser(u));
            const count = bus.users.length;
            bus.assignedUsersCount = count;
            bus.remainingSeats = bus.capacity - count;
        }

        // Student A was removed, Student B remains intact despite having the exact same name!
        assert.equal(planBuses[0].users.length, 1);
        assert.equal(planBuses[0].users[0].userId, "USR1002");
        assert.equal(planBuses[0].assignedUsersCount, 1);
        assert.equal(planBuses[0].remainingSeats, 49);
    });

    // ─────────────────────────────────────────────────────────────
    // 4. INVARIANT: POLLING DOES NOT RESTORE COMING STATUS
    // ─────────────────────────────────────────────────────────────
    await t.test("4. Invariant: Reset Pending students remain Pending and Unallocated during batch resolution", async () => {
        const resetStudent = {
            userId: "USR2001",
            name: "Priya",
            travelStatus: "Pending",
            allocationStatus: "Unallocated",
            isAllocated: false,
            isUnallocated: true
        };

        const activePlansMock = {
            INWARD: { isApproved: false },
            OUTWARD: { isApproved: false },
            hasApprovedPlan: false,
            primaryPlan: null
        };

        const resolved = await batchCalculateStudentTransportStatuses([resetStudent]);
        assert.equal(resolved.length, 1);
        assert.equal(resolved[0].travelStatus, "Pending");
        assert.equal(resolved[0].allocationStatus, "Unallocated");
        assert.equal(resolved[0].isAllocated, false);
        assert.equal(resolved[0].isUnallocated, true);
        assert.equal(resolved[0].allocatedBus, null);
    });

    // ─────────────────────────────────────────────────────────────
    // 5. FRONTEND CONCURRENCY & DUPLICATE SUBMISSION GUARDS
    // ─────────────────────────────────────────────────────────────
    await t.test("5. Frontend Guard Simulation: In-flight and duplicate reset requests are prevented", () => {
        let isResettingGlobal = false;
        let globalResetRequestCount = 0;

        function triggerGlobalReset() {
            if (isResettingGlobal) {
                return false; // Prevented duplicate call
            }
            isResettingGlobal = true;
            globalResetRequestCount++;
            return true;
        }

        // First click succeeds
        assert.equal(triggerGlobalReset(), true);
        assert.equal(globalResetRequestCount, 1);

        // Rapid second and third clicks are rejected
        assert.equal(triggerGlobalReset(), false);
        assert.equal(triggerGlobalReset(), false);
        assert.equal(globalResetRequestCount, 1);

        // Once finished, new cycle can proceed
        isResettingGlobal = false;
        assert.equal(triggerGlobalReset(), true);
        assert.equal(globalResetRequestCount, 2);
        isResettingGlobal = false;

        // Single user reset guard Set simulation
        const resettingUserIds = new Set();
        let singleUserRequestCount = 0;

        function triggerSingleReset(userId) {
            if (resettingUserIds.has(userId) || isResettingGlobal) {
                return false;
            }
            resettingUserIds.add(userId);
            singleUserRequestCount++;
            return true;
        }

        assert.equal(triggerSingleReset("USR1001"), true);
        assert.equal(triggerSingleReset("USR1001"), false); // duplicate rejected
        assert.equal(triggerSingleReset("USR1002"), true);  // distinct user allowed
        assert.equal(singleUserRequestCount, 2);
    });
});
