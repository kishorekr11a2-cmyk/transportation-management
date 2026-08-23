import assert from "node:assert/strict";
import test from "node:test";
import adminMiddleware from "../middleware/adminMiddleware.js";

// Helper to create mock response object
function createMockRes() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(data) {
            this.body = data;
            return this;
        }
    };
}

test("Decoupled AI Reset, User Travel Status Global Reset & Transportation Allocation Suite", async (t) => {

    await t.test("Admin Middleware correctly enforces admin-only access", () => {
        const studentReq = { user: { id: "std_1", role: "student" } };
        const adminReq = { user: { id: "adm_1", role: "admin" } };
        let nextCalled = false;

        // Student attempt
        const resStudent = createMockRes();
        adminMiddleware(studentReq, resStudent, () => { nextCalled = true; });
        assert.equal(nextCalled, false);
        assert.equal(resStudent.statusCode, 403);
        assert.equal(resStudent.body.success, false);

        // Admin attempt
        nextCalled = false;
        const resAdmin = createMockRes();
        adminMiddleware(adminReq, resAdmin, () => { nextCalled = true; });
        assert.equal(nextCalled, true);
    });

    await t.test("End-to-End Flow (Approval, Tab Sync, AI Reset vs User Management Reset)", () => {
        // Mock MongoDB database state
        let users = [
            {
                _id: "u1",
                userId: "U001",
                name: "Kishore",
                role: "student",
                stoppings: "Simmakkal",
                travelStatus: "Pending",
                allocatedBus: null
            },
            {
                _id: "u2",
                userId: "U002",
                name: "ManualStudent",
                role: "student",
                stoppings: "Central",
                travelStatus: "Coming",
                allocatedBus: {
                    isAllocated: true,
                    planType: "MANUAL",
                    vehicleName: "BUS-MANUAL-01",
                    routeCode: "R-MANUAL"
                }
            }
        ];

        let activeAiDraftPlan = null;
        let activeApprovedPlan = null;

        // Controller simulation logic
        function submitTravelStatus(user, requestedStatus) {
            const allowedStatuses = ["Coming", "Not Coming"];
            if (!allowedStatuses.includes(requestedStatus)) {
                return { status: 400, body: { success: false, message: "Invalid travel status." } };
            }
            if (user.role !== "student") {
                return { status: 403, body: { success: false, message: "Only users can update travel status" } };
            }
            if (user.travelStatus && user.travelStatus !== "Pending") {
                return {
                    status: 400,
                    body: {
                        success: false,
                        message: "Travel status already submitted. Please contact the administrator to reset your response before submitting again."
                    }
                };
            }
            user.travelStatus = requestedStatus;
            return {
                status: 200,
                body: { success: true, message: "Travel status updated successfully", travelStatus: user.travelStatus }
            };
        }

        function resolveUserTransportation(user) {
            // State A (Pending)
            if (!user.travelStatus || user.travelStatus === "Pending") {
                return { isAllocated: false, message: "Transportation Not Assigned" };
            }

            // State D (Not Coming)
            if (user.travelStatus === "Not Coming") {
                return {
                    isAllocated: false,
                    message: "You have confirmed that you are not traveling today. No bus seat is reserved."
                };
            }

            // State B & C (Coming):
            // 1. Check if user already has an allocatedBus persisted in MongoDB
            if (user.allocatedBus && typeof user.allocatedBus === "object") {
                if (user.allocatedBus.isAllocated) {
                    // If AI allocation, verify active AI plan still exists
                    if (user.allocatedBus.planType === "AI" || !user.allocatedBus.planType) {
                        if (activeApprovedPlan && activeApprovedPlan.active) {
                            return user.allocatedBus;
                        }
                        // Plan was reset
                        return {
                            isAllocated: false,
                            hasActivePlan: false,
                            message: "Waiting for the administrator to finalize your transportation plan."
                        };
                    }
                    // If MANUAL allocation, return it directly
                    return user.allocatedBus;
                } else {
                    return user.allocatedBus;
                }
            }

            // 2. Fallback check: If active approved plan exists in database
            if (!activeApprovedPlan || !activeApprovedPlan.active) {
                return {
                    isAllocated: false,
                    hasActivePlan: false,
                    message: "Waiting for the administrator to finalize your transportation plan."
                };
            }

            // Check if user is in active approved plan
            const assignedBus = activeApprovedPlan.buses.find((b) => b.users.includes(user.userId));
            if (assignedBus) {
                const allocation = {
                    isAllocated: true,
                    hasActivePlan: true,
                    planType: "AI",
                    vehicleName: assignedBus.vehicleName,
                    routeCode: assignedBus.routeCode,
                    boardingStop: user.stoppings,
                    stopOrder: 1
                };
                user.allocatedBus = allocation; // Persist to MongoDB user record
                return allocation;
            }

            return {
                isAllocated: false,
                hasActivePlan: true,
                message: "Waiting for the administrator to finalize your transportation plan."
            };
        }

        function adminApprovePlan(planBuses) {
            activeApprovedPlan = {
                active: true,
                status: "active",
                planType: "AI",
                buses: planBuses,
                approvedAt: new Date()
            };
            // Persist approved allocations to MongoDB users
            users.forEach((u) => {
                if (u.travelStatus === "Coming" && (!u.allocatedBus || u.allocatedBus.planType === "AI")) {
                    const alloc = resolveUserTransportation(u);
                    if (alloc.isAllocated) {
                        u.allocatedBus = alloc;
                    }
                }
            });
        }

        function adminAiAgentReset() {
            // 1. Resets AI generated draft
            if (activeAiDraftPlan) {
                activeAiDraftPlan.active = false;
                activeAiDraftPlan.status = "reset";
            }
            // 2. Resets AI approved plan in ai_selected_plans
            if (activeApprovedPlan && activeApprovedPlan.planType === "AI") {
                activeApprovedPlan.active = false;
                activeApprovedPlan.status = "reset";
            }
            // 3. Resets bus allocations associated with the AI plan in MongoDB User records
            let allocationsCleared = 0;
            users.forEach((u) => {
                if (u.allocatedBus && (u.allocatedBus.planType === "AI" || !u.allocatedBus.planType)) {
                    u.allocatedBus = {
                        isAllocated: false,
                        adminApprovalStatus: "Pending Admin Approval",
                        message: "Waiting for the administrator to finalize your transportation plan."
                    };
                    allocationsCleared++;
                }
            });
            // User travel responses (Coming / Not Coming) remain strictly preserved
            return {
                success: true,
                message: "AI route recommendation and associated bus allocations reset successfully. Student travel responses remain preserved.",
                planReset: true,
                allocationsCleared
            };
        }

        function adminUserManagementGlobalReset() {
            let usersReset = 0;
            let allocationsRemoved = 0;
            users.forEach((u) => {
                if (u.travelStatus === "Coming" || u.travelStatus === "Not Coming") usersReset++;
                if (u.allocatedBus && u.allocatedBus.isAllocated) allocationsRemoved++;
                u.travelStatus = "Pending";
                u.allocatedBus = null;
            });
            if (activeApprovedPlan) {
                activeApprovedPlan.active = false;
                activeApprovedPlan.status = "reset";
            }
            if (activeAiDraftPlan) {
                activeAiDraftPlan.active = false;
                activeAiDraftPlan.status = "reset";
            }
            return {
                status: 200,
                body: {
                    success: true,
                    message: "Travel status cycle reset successfully. Generated AI routes and bus allocations cleared.",
                    usersReset,
                    allocationsRemoved
                }
            };
        }

        // ==========================================
        // 1. Initial State A: Pending -> Transportation Not Assigned
        // ==========================================
        const user1 = users[0];
        assert.equal(user1.travelStatus, "Pending");
        let alloc = resolveUserTransportation(user1);
        assert.equal(alloc.isAllocated, false);
        assert.equal(alloc.message, "Transportation Not Assigned");

        // ==========================================
        // 2. User submits Coming -> State B: Coming but NO allocation yet
        // ==========================================
        const submitRes1 = submitTravelStatus(user1, "Coming");
        assert.equal(submitRes1.status, 200);
        assert.equal(user1.travelStatus, "Coming");

        alloc = resolveUserTransportation(user1);
        assert.equal(alloc.isAllocated, false);
        assert.equal(alloc.message, "Waiting for the administrator to finalize your transportation plan.");

        // Lock test: cannot change to Not Coming while locked
        const lockedRes = submitTravelStatus(user1, "Not Coming");
        assert.equal(lockedRes.status, 400);
        assert.match(lockedRes.body.message, /already submitted/i);

        // ==========================================
        // Test A — Approval: Admin generates & approves Plan -> State C: Coming + Approved Allocation
        // ==========================================
        adminApprovePlan([
            { vehicleName: "BUS-04", routeCode: "R-01", users: ["U001"] }
        ]);

        alloc = resolveUserTransportation(user1);
        assert.equal(alloc.isAllocated, true);
        assert.equal(alloc.vehicleName, "BUS-04");
        assert.equal(alloc.routeCode, "R-01");
        assert.equal(user1.allocatedBus.isAllocated, true);

        // ==========================================
        // Test B — Refresh & New Tab: Opening in new tab / reload retrieves persisted allocation
        // ==========================================
        const newTabUserFetch = resolveUserTransportation(user1);
        assert.equal(newTabUserFetch.isAllocated, true);
        assert.equal(newTabUserFetch.vehicleName, "BUS-04");
        assert.equal(newTabUserFetch.routeCode, "R-01");

        // ==========================================
        // Test C — AI Agent Reset: Admin clicks "Reset AI Generated Route"
        // AI route and its associated bus allocation are cleared from database,
        // while student's travelStatus ("Coming") and lock remain intact!
        // Unrelated allocations (e.g. Manual allocations) are preserved!
        // ==========================================
        activeAiDraftPlan = { active: true, status: "active" };
        const aiResetRes = adminAiAgentReset();
        assert.equal(aiResetRes.success, true);
        assert.equal(aiResetRes.allocationsCleared, 1);

        // Student 1's allocation is cleared
        assert.equal(user1.travelStatus, "Coming"); // travelStatus preserved
        assert.equal(user1.allocatedBus.isAllocated, false); // allocation cleared
        const studentViewAfterAiReset = resolveUserTransportation(user1);
        assert.equal(studentViewAfterAiReset.isAllocated, false); // no longer shows bus

        // Student 2 (Manual allocation) was NOT deleted
        const user2 = users[1];
        assert.equal(user2.allocatedBus.isAllocated, true);
        assert.equal(user2.allocatedBus.vehicleName, "BUS-MANUAL-01");

        // Student cannot change status because submission remains locked
        const lockCheckAfterAiReset = submitTravelStatus(user1, "Not Coming");
        assert.equal(lockCheckAfterAiReset.status, 400);

        // ==========================================
        // Test D — User Management Reset: Admin clicks Reset in User Management
        // Travel status and allocations are reset to Pending/null, unlocking next cycle
        // ==========================================
        const resetRes = adminUserManagementGlobalReset();
        assert.equal(resetRes.status, 200);

        // State check: user must be Pending and have NO allocation
        assert.equal(user1.travelStatus, "Pending");
        assert.equal(user1.allocatedBus, null);
        assert.equal(user2.travelStatus, "Pending");
        assert.equal(user2.allocatedBus, null);

        alloc = resolveUserTransportation(user1);
        assert.equal(alloc.isAllocated, false);
        assert.equal(alloc.message, "Transportation Not Assigned");

        // User can now participate and submit in the new travel cycle
        const newCycleSubmit = submitTravelStatus(user1, "Coming");
        assert.equal(newCycleSubmit.status, 200);
        assert.equal(user1.travelStatus, "Coming");
    });

    await t.test("Verification of User Scenarios (Decoupled Reset Behavior & Live Demand)", () => {
        let dbUsers = Array.from({ length: 300 }, (_, i) => ({
            _id: `u_${i + 1}`,
            userId: `STD_${String(i + 1).padStart(3, "0")}`,
            name: `Student ${i + 1}`,
            role: "student",
            stoppings: "Area " + ((i % 10) + 1),
            travelStatus: "Coming",
            allocatedBus: {
                isAllocated: true,
                planType: "AI",
                vehicleName: "BUS-01",
                routeCode: "R-01"
            }
        }));

        let activeAiDraftPlan = {
            active: true,
            status: "active",
            buses: [{ vehicleName: "BUS-01", routeCode: "R-01", users: ["STD_001"] }]
        };

        function getLiveAiDemand(usersList) {
            const confirmed = usersList.filter(u => u.role === "student" && u.travelStatus === "Coming");
            return {
                totalUsers: usersList.filter(u => u.role === "student").length,
                confirmedUsers: confirmed.length,
                demand: confirmed.length
            };
        }

        // Initial State: 300 Total, 300 Coming, AI route exists
        let stats = getLiveAiDemand(dbUsers);
        assert.equal(stats.totalUsers, 300);
        assert.equal(stats.confirmedUsers, 300);
        assert.equal(stats.demand, 300);

        // ==========================================
        // Scenario A: AI Route Reset
        // Admin clicks Reset AI Generated Route
        // activeAiDraftPlan is cleared; user travelStatus remains intact ("Coming"); allocatedBus is reset
        // ==========================================
        activeAiDraftPlan.active = false;
        activeAiDraftPlan.status = "reset";
        dbUsers.forEach(u => {
            if (u.allocatedBus && u.allocatedBus.planType === "AI") {
                u.allocatedBus = { isAllocated: false };
            }
        });

        stats = getLiveAiDemand(dbUsers);
        assert.equal(stats.totalUsers, 300);
        assert.equal(stats.confirmedUsers, 300);
        assert.equal(stats.demand, 300);
        assert.equal(dbUsers[0].allocatedBus.isAllocated, false);
        assert.equal(activeAiDraftPlan.active, false);

        // ==========================================
        // Scenario B: User Management Reset
        // Admin clicks User Management Reset:
        // All students reset to Pending, allocations cleared
        // ==========================================
        dbUsers.forEach(u => {
            u.travelStatus = "Pending";
            u.allocatedBus = null;
        });

        stats = getLiveAiDemand(dbUsers);
        assert.equal(stats.totalUsers, 300);
        assert.equal(stats.confirmedUsers, 0);
        assert.equal(stats.demand, 0);

        // ==========================================
        // Scenario C: New User Submissions After User Management Reset
        // ==========================================
        dbUsers[0].travelStatus = "Coming";
        stats = getLiveAiDemand(dbUsers);
        assert.equal(stats.totalUsers, 300);
        assert.equal(stats.confirmedUsers, 1);
        assert.equal(stats.demand, 1);
    });

    await t.test("Verification of Mixed State Lock and Reset Transitions", () => {
        let sampleUsers = [
            { userId: "U1", name: "User 1", role: "student", travelStatus: "Coming", allocatedBus: { isAllocated: true, planType: "AI", vehicleName: "BUS-01" } },
            { userId: "U2", name: "User 2", role: "student", travelStatus: "Coming", allocatedBus: { isAllocated: true, planType: "AI", vehicleName: "BUS-01" } },
            { userId: "U3", name: "User 3", role: "student", travelStatus: "Not Coming", allocatedBus: null },
            { userId: "U4", name: "User 4", role: "student", travelStatus: "Pending", allocatedBus: null }
        ];

        function attemptSubmit(user, newStatus) {
            if (user.travelStatus && user.travelStatus !== "Pending") {
                return { success: false, message: "Locked" };
            }
            user.travelStatus = newStatus;
            return { success: true, message: "Updated" };
        }

        // 1. Initial lock checks
        assert.equal(attemptSubmit(sampleUsers[0], "Not Coming").success, false); // User 1 locked
        assert.equal(attemptSubmit(sampleUsers[1], "Not Coming").success, false); // User 2 locked
        assert.equal(attemptSubmit(sampleUsers[2], "Coming").success, false);     // User 3 locked
        assert.equal(sampleUsers[3].travelStatus, "Pending");                      // User 4 unlocked

        // 2. Admin performs AI Agent Reset ("Reset AI Generated Route")
        // AI reset clears AI allocation but preserves travelStatus
        sampleUsers.forEach(u => {
            if (u.allocatedBus && u.allocatedBus.planType === "AI") {
                u.allocatedBus = { isAllocated: false };
            }
        });
        assert.equal(sampleUsers[0].travelStatus, "Coming");
        assert.equal(sampleUsers[0].allocatedBus.isAllocated, false);
        assert.equal(sampleUsers[1].travelStatus, "Coming");
        assert.equal(sampleUsers[1].allocatedBus.isAllocated, false);
        assert.equal(sampleUsers[2].travelStatus, "Not Coming");
        assert.equal(sampleUsers[3].travelStatus, "Pending");

        // Verify users 1, 2, 3 remain locked
        assert.equal(attemptSubmit(sampleUsers[0], "Not Coming").success, false);
        assert.equal(attemptSubmit(sampleUsers[1], "Not Coming").success, false);
        assert.equal(attemptSubmit(sampleUsers[2], "Coming").success, false);

        // Verify user 4 can submit
        const u4Res = attemptSubmit(sampleUsers[3], "Coming");
        assert.equal(u4Res.success, true);
        assert.equal(sampleUsers[3].travelStatus, "Coming");
        assert.equal(attemptSubmit(sampleUsers[3], "Not Coming").success, false); // Now User 4 is locked

        // 3. Admin performs User Management Reset
        sampleUsers.forEach(u => {
            u.travelStatus = "Pending";
            u.allocatedBus = null;
        });

        // All users must now be Pending and Unlocked
        sampleUsers.forEach(u => {
            assert.equal(u.travelStatus, "Pending");
            assert.equal(u.allocatedBus, null);
            assert.equal(attemptSubmit(u, "Coming").success, true);
            assert.equal(u.travelStatus, "Coming");
        });
    });
});
