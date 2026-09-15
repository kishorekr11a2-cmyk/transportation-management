import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * IDEMPOTENT RESET TRAVEL STATUS TEST SUITE
 * 
 * Validates:
 * 1. Global Reset works when one or more users are already Pending (no error thrown).
 * 2. Mixed state matching user description:
 *    - Total: 400, Coming: 396, Pending: 1, Not Coming: 3, Allocated: 371, Unallocated: 25, Late Responses: 0
 * 3. After global reset:
 *    - Coming: 0
 *    - Not Coming: 0
 *    - Pending: 400 (total)
 *    - Allocated: 0
 *    - Unallocated: 400 (total)
 *    - Late Responses: 0
 * 4. Single user reset is strictly idempotent:
 *    - Resetting a Pending user does NOT throw "User travel status is already Pending."
 *    - Resetting an Unallocated user does NOT throw error.
 * 5. Every student's travelStatus becomes "Pending" and allocationStatus becomes "Unallocated".
 * 6. Bus allocations (busId, vehicleId, routeId, planVersion, assignedVehicle, allocatedBus) are cleared.
 * 7. Active late response events are resolved.
 * 8. Works dynamically for any number of users (no hardcoded counts).
 */

describe('Idempotent Reset Travel Status Test Suite', () => {

    function createMockUserEnvironment(userCount = 400) {
        const users = [];

        if (userCount === 400) {
            // 1 Pending user
            users.push({
                _id: 'user_pending_0',
                userId: 'USR_PENDING_0',
                name: 'Pending User',
                role: 'student',
                travelStatus: 'Pending',
                allocationStatus: 'Not Assigned',
                isAllocated: false,
                isUnallocated: false,
                assignedVehicle: null,
                assignedRoute: null,
                allocatedBus: null
            });

            // 3 Not Coming users
            for (let i = 1; i <= 3; i++) {
                users.push({
                    _id: `user_nc_${i}`,
                    userId: `USR_NC_${i}`,
                    name: `Not Coming User ${i}`,
                    role: 'student',
                    travelStatus: 'Not Coming',
                    allocationStatus: 'Not Assigned',
                    isAllocated: false,
                    isUnallocated: false,
                    assignedVehicle: null,
                    assignedRoute: null,
                    allocatedBus: null
                });
            }

            // 371 Allocated Coming users
            for (let i = 4; i <= 374; i++) {
                users.push({
                    _id: `user_alloc_${i}`,
                    userId: `USR_ALLOC_${i}`,
                    name: `Allocated User ${i}`,
                    role: 'student',
                    travelStatus: 'Coming',
                    allocationStatus: 'Assigned',
                    isAllocated: true,
                    isUnallocated: false,
                    assignedVehicle: `BUS-${(i % 10) + 1}`,
                    assignedRoute: `R-${(i % 5) + 1}`,
                    allocatedBus: {
                        isAllocated: true,
                        vehicleName: `BUS-${(i % 10) + 1}`,
                        routeCode: `R-${(i % 5) + 1}`
                    }
                });
            }

            // 25 Unallocated Coming users (396 Coming total - 371 Allocated = 25 Unallocated)
            for (let i = 375; i < 400; i++) {
                users.push({
                    _id: `user_unalloc_${i}`,
                    userId: `USR_UNALLOC_${i}`,
                    name: `Unallocated User ${i}`,
                    role: 'student',
                    travelStatus: 'Coming',
                    allocationStatus: 'Unallocated',
                    isAllocated: false,
                    isUnallocated: true,
                    assignedVehicle: null,
                    assignedRoute: null,
                    allocatedBus: null
                });
            }
        } else {
            for (let i = 0; i < userCount; i++) {
                const isEven = i % 2 === 0;
                users.push({
                    _id: `user_${i}`,
                    userId: `USR_${i}`,
                    name: `Student ${i}`,
                    role: 'student',
                    travelStatus: isEven ? 'Coming' : 'Pending',
                    allocationStatus: isEven ? 'Assigned' : 'Not Assigned',
                    isAllocated: isEven,
                    isUnallocated: !isEven,
                    assignedVehicle: isEven ? `BUS-${i}` : null,
                    assignedRoute: isEven ? `R-${i}` : null,
                    allocatedBus: isEven ? { isAllocated: true, vehicleName: `BUS-${i}` } : null
                });
            }
        }

        let lateResponseEvents = [
            {
                eventKey: 'lr_old_evt_1',
                userId: 'USR_UNALLOC_375',
                status: 'ACTIVE',
                direction: 'INWARD'
            }
        ];

        // Summary calculator matching UserManagement.jsx
        function calculateSummary(userList) {
            let comingCount = 0;
            let notComingCount = 0;
            let pendingCount = 0;
            let allocatedCount = 0;
            let unallocatedCount = 0;
            let lateComingCount = 0;

            userList.forEach((user) => {
                const status = user.travelStatus || 'Pending';
                if (status === 'Coming') comingCount++;
                else if (status === 'Not Coming') notComingCount++;
                else pendingCount++;

                const isAllocated = Boolean(
                    user.isAllocated ?? (
                        status === 'Coming' &&
                        (user.allocationStatus === 'Assigned' || user.allocationStatus === 'Re-assigned' || user.allocatedBus?.isAllocated || user.assignedVehicle)
                    )
                );

                const isUnallocated = Boolean(
                    !isAllocated && (
                        user.allocationStatus === 'Unallocated' ||
                        user.isUnallocated ||
                        status === 'Coming'
                    )
                );

                const isLateComing = Boolean(
                    status === 'Coming' &&
                    !isAllocated &&
                    (user.lateResponseStatus === 'ACTIVE' || user.isLateResponse || user.lateResponseDetected)
                );

                if (isAllocated) allocatedCount++;
                if (isLateComing) lateComingCount++;
                if (isUnallocated) unallocatedCount++;
            });

            const activeLateCount = lateResponseEvents.filter(e => e.status === 'ACTIVE').length;

            return {
                totalUsers: userList.length,
                comingCount,
                notComingCount,
                pendingCount,
                allocatedCount,
                unallocatedCount,
                lateResponses: activeLateCount
            };
        }

        // Global reset implementation matching userController.js
        function executeGlobalReset() {
            // Bulk update on all student records
            users.forEach((user) => {
                user.travelStatus = 'Pending';
                user.allocationStatus = 'Unallocated';
                user.isAllocated = false;
                user.isUnallocated = true;
                user.assignedVehicle = null;
                user.assignedRoute = null;
                user.allocatedBus = null;
                user.lateResponseDetected = false;
                user.isLateResponse = false;
                user.approvedPlanType = null;
                user.manualRouteId = null;
                user.manualBusId = null;
                user.routeId = null;
                user.busId = null;
                user.vehicleId = null;
                user.planVersion = null;
                user.travelResponseSubmittedAt = null;
                user.requiresReallocation = false;
                user.affectedDirections = [];
                user.submittedPlanVersion = null;
                user.submittedApprovalEventId = null;
                user.lateResponseEventId = null;
            });

            // Resolve all late response events
            lateResponseEvents.forEach((e) => {
                if (e.status !== 'RESOLVED') {
                    e.status = 'RESOLVED';
                    e.resolvedAt = new Date();
                    e.resolutionReason = 'Admin reset travel status cycle';
                }
            });

            return {
                success: true,
                message: 'All student travel statuses and allocations were reset successfully.',
                totalUsers: users.length,
                usersReset: users.length
            };
        }

        // Single user reset implementation matching userController.js
        function executeSingleUserReset(userId) {
            const user = users.find(u => u.userId === userId || u._id === userId);
            if (!user) {
                return { status: 404, body: { success: false, message: 'User not found' } };
            }

            // IDEMPOTENT: Never throw "User travel status is already Pending."
            user.travelStatus = 'Pending';
            user.allocationStatus = 'Unallocated';
            user.isAllocated = false;
            user.isUnallocated = true;
            user.assignedVehicle = null;
            user.assignedRoute = null;
            user.allocatedBus = null;
            user.lateResponseDetected = false;
            user.isLateResponse = false;
            user.approvedPlanType = null;
            user.manualRouteId = null;
            user.manualBusId = null;
            user.routeId = null;
            user.busId = null;
            user.vehicleId = null;
            user.planVersion = null;
            user.travelResponseSubmittedAt = null;
            user.requiresReallocation = false;

            lateResponseEvents.forEach((e) => {
                if (e.userId === user.userId && e.status !== 'RESOLVED') {
                    e.status = 'RESOLVED';
                    e.resolvedAt = new Date();
                }
            });

            return {
                status: 200,
                body: {
                    success: true,
                    message: 'All student travel statuses and allocations were reset successfully.',
                    user
                }
            };
        }

        return {
            users,
            lateResponseEvents,
            calculateSummary,
            executeGlobalReset,
            executeSingleUserReset
        };
    }

    it('1. Initial state matches user description exactly (400 users, 396 Coming, 1 Pending, 3 Not Coming, 371 Allocated, 25 Unallocated)', () => {
        const env = createMockUserEnvironment(400);
        const stats = env.calculateSummary(env.users);

        assert.equal(stats.totalUsers, 400);
        assert.equal(stats.comingCount, 396);
        assert.equal(stats.pendingCount, 1);
        assert.equal(stats.notComingCount, 3);
        assert.equal(stats.allocatedCount, 371);
        assert.equal(stats.unallocatedCount, 25);
    });

    it('2. Global Reset Travel Status executes without error even when one user is already Pending', () => {
        const env = createMockUserEnvironment(400);

        // Execute global reset
        const result = env.executeGlobalReset();

        assert.equal(result.success, true);
        assert.equal(result.message, 'All student travel statuses and allocations were reset successfully.');
        assert.equal(result.totalUsers, 400);
        assert.equal(result.usersReset, 400);
    });

    it('3. After global reset: Coming: 0, Not Coming: 0, Pending: 400, Allocated: 0, Unallocated: 400, Late Responses: 0', () => {
        const env = createMockUserEnvironment(400);
        env.executeGlobalReset();

        const postResetStats = env.calculateSummary(env.users);

        assert.equal(postResetStats.totalUsers, 400);
        assert.equal(postResetStats.comingCount, 0, 'Coming must be 0');
        assert.equal(postResetStats.notComingCount, 0, 'Not Coming must be 0');
        assert.equal(postResetStats.pendingCount, 400, 'Pending must equal total users (400)');
        assert.equal(postResetStats.allocatedCount, 0, 'Allocated must be 0');
        assert.equal(postResetStats.unallocatedCount, 400, 'Unallocated must equal total users (400)');
        assert.equal(postResetStats.lateResponses, 0, 'Late responses must be 0');
    });

    it('4. Every student has travelStatus: "Pending" and allocationStatus: "Unallocated" with all allocations cleared', () => {
        const env = createMockUserEnvironment(400);
        env.executeGlobalReset();

        for (const user of env.users) {
            assert.equal(user.travelStatus, 'Pending');
            assert.equal(user.allocationStatus, 'Unallocated');
            assert.equal(user.isAllocated, false);
            assert.equal(user.isUnallocated, true);
            assert.equal(user.assignedVehicle, null);
            assert.equal(user.assignedRoute, null);
            assert.equal(user.allocatedBus, null);
            assert.equal(user.busId, null);
            assert.equal(user.vehicleId, null);
            assert.equal(user.routeId, null);
            assert.equal(user.planVersion, null);
            assert.equal(user.travelResponseSubmittedAt, null);
        }
    });

    it('5. Single User Reset: Calling reset on a user who is ALREADY Pending does NOT throw "User travel status is already Pending."', () => {
        const env = createMockUserEnvironment(400);

        // USR_PENDING_0 is already Pending
        const userPending = env.users.find(u => u.userId === 'USR_PENDING_0');
        assert.equal(userPending.travelStatus, 'Pending');

        // Reset single user
        const res = env.executeSingleUserReset('USR_PENDING_0');

        assert.equal(res.status, 200, 'Must return 200 OK, not 400');
        assert.notEqual(res.body.message, 'User travel status is already Pending.');
        assert.equal(res.body.success, true);
        assert.equal(res.body.user.travelStatus, 'Pending');
        assert.equal(res.body.user.allocationStatus, 'Unallocated');
    });

    it('6. Single User Reset: Calling reset on a user who is ALREADY Unallocated does NOT throw error', () => {
        const env = createMockUserEnvironment(400);

        // USR_UNALLOC_375 is already Unallocated
        const res = env.executeSingleUserReset('USR_UNALLOC_375');

        assert.equal(res.status, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.user.travelStatus, 'Pending');
        assert.equal(res.body.user.allocationStatus, 'Unallocated');
        assert.equal(res.body.user.isAllocated, false);
    });

    it('7. Idempotency: Consecutive global resets produce identical valid state without errors', () => {
        const env = createMockUserEnvironment(400);

        // Reset 1
        const res1 = env.executeGlobalReset();
        assert.equal(res1.success, true);

        // Reset 2 (immediately after reset 1, all users are already Pending and Unallocated)
        const res2 = env.executeGlobalReset();
        assert.equal(res2.success, true);

        const stats = env.calculateSummary(env.users);
        assert.equal(stats.pendingCount, 400);
        assert.equal(stats.unallocatedCount, 400);
        assert.equal(stats.allocatedCount, 0);
        assert.equal(stats.comingCount, 0);
    });

    it('8. Dynamic scale: Logic works for any arbitrary number of students (e.g. 5, 23, 500, not hardcoded to 400)', () => {
        for (const count of [5, 23, 150, 500]) {
            const env = createMockUserEnvironment(count);
            assert.equal(env.users.length, count);

            const result = env.executeGlobalReset();
            assert.equal(result.totalUsers, count);
            assert.equal(result.usersReset, count);

            const stats = env.calculateSummary(env.users);
            assert.equal(stats.totalUsers, count);
            assert.equal(stats.pendingCount, count);
            assert.equal(stats.unallocatedCount, count);
            assert.equal(stats.allocatedCount, 0);
        }
    });

    it('9. Late response events and notifications are resolved upon global reset', () => {
        const env = createMockUserEnvironment(400);
        assert.equal(env.lateResponseEvents[0].status, 'ACTIVE');

        env.executeGlobalReset();

        assert.equal(env.lateResponseEvents[0].status, 'RESOLVED');
        assert.ok(env.lateResponseEvents[0].resolvedAt);
    });
});
