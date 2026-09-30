import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve("backend", ".env") });
dotenv.config();

import mongoose from "mongoose";
import User from "../models/User.js";
import AiPlan from "../models/AiPlan.js";
import Vehicle from "../models/Vehicle.js";
import LateResponseEvent from "../models/LateResponseEvent.js";
import {
    submitSelectedPlan,
    saveSelectedPlan,
    getActiveAIPlan,
    resetAIPlan
} from "../services/aiAgentService.js";

describe("AI Agent Lifecycle: Generate → Confirm → Pending Approval → Approve → Allocate Flow", () => {
    let mongoConnected = false;
    const testTimestamp = Date.now();
    const testUserId = `TEST_STU_${testTimestamp}`;
    let createdTestUser = null;
    let createdTestVehicle = null;

    before(async () => {
        const mongoUri = process.env.MONGO_URI;
        if (mongoUri && mongoose.connection.readyState === 0) {
            try {
                await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 8000 });
                mongoConnected = mongoose.connection.readyState === 1;
            } catch (err) {
                console.warn("[TEST_SETUP] Mongo connection warning:", err.message);
            }
        } else if (mongoose.connection.readyState === 1) {
            mongoConnected = true;
        }

        if (mongoConnected) {
            // Create a test student with Coming status and unallocated
            createdTestUser = await User.create({
                name: `Test Student ${testTimestamp}`,
                userId: testUserId,
                email: `test_${testTimestamp}@example.com`,
                role: "student",
                travelStatus: "Coming",
                stoppings: "Test Junction",
                location: {
                    name: "Test Junction",
                    coordinates: [78.1198, 9.9252]
                },
                allocatedBus: null
            });

            // Ensure test vehicle exists
            createdTestVehicle = await Vehicle.create({
                vehicleName: `Test Fleet ${testTimestamp}`,
                capacity: 50
            });
        }
    });

    after(async () => {
        if (mongoConnected) {
            if (createdTestUser) {
                await User.deleteOne({ _id: createdTestUser._id }).catch(() => {});
            }
            if (createdTestVehicle) {
                await Vehicle.deleteOne({ _id: createdTestVehicle._id }).catch(() => {});
            }
            await AiPlan.deleteMany({ "buses.vehicleName": createdTestVehicle?.vehicleName }).catch(() => {});
            await mongoose.connection.collection("ai_selected_plans").deleteMany({
                "plan.buses.vehicleName": createdTestVehicle?.vehicleName
            }).catch(() => {});
            await LateResponseEvent.deleteMany({ userId: testUserId }).catch(() => {});
            await mongoose.disconnect();
        }
    });

    it("1. Lifecycle Step 1 (Preview): Plan is generated, user allocatedBus remains null", async (t) => {
        if (!mongoConnected) {
            t.skip("MongoDB required for this test");
            return;
        }

        // Fresh check on test student: allocatedBus must be null
        const student = await User.findById(createdTestUser._id);
        assert.equal(student.allocatedBus, null, "Before confirmation, student.allocatedBus must be null");
    });

    it("2. Lifecycle Step 2 & 3 (Confirm / Submit): Plan transitions to Pending Approval, Users are NOT allocated", async (t) => {
        if (!mongoConnected) {
            t.skip("MongoDB required for this test");
            return;
        }

        // Dynamically get live coming demand to pass live demand consistency validation
        const liveComing = await User.countDocuments({ role: "student", travelStatus: "Coming" });

        // Mock generated AI route plan for OUTWARD direction containing our test student
        const mockGeneratedPlan = {
            direction: "OUTWARD",
            tripMode: "FROM_SOURCE",
            comingUsers: liveComing,
            allocatedUsers: liveComing,
            summary: {
                confirmedUsers: liveComing,
                assignedUsers: liveComing
            },
            totalCapacity: Math.max(50, liveComing),
            buses: [{
                busNumber: createdTestVehicle.vehicleName,
                vehicleName: createdTestVehicle.vehicleName,
                routeCode: "R-OUT-TEST-1",
                routeName: "Outward Test Express",
                direction: "OUTWARD",
                tripMode: "FROM_SOURCE",
                capacity: Math.max(50, liveComing),
                assignedStudents: 1,
                remainingCapacity: Math.max(49, liveComing - 1),
                stops: [{
                    name: "Test Junction",
                    userCount: 1,
                    users: [{
                        _id: createdTestUser._id.toString(),
                        userId: createdTestUser.userId,
                        name: createdTestUser.name,
                        stoppings: "Test Junction",
                        location: { coordinates: [78.1198, 9.9252] }
                    }]
                }]
            }]
        };

        // Admin clicks CONFIRM (calls submitSelectedPlan)
        const submitResult = await submitSelectedPlan({
            planType: "AI",
            direction: "OUTWARD",
            tripMode: "FROM_SOURCE",
            plan: mockGeneratedPlan
        });

        assert.equal(submitResult.success, true, "submitSelectedPlan should succeed");
        assert.equal(submitResult.status, "pending_approval", "Status must be pending_approval");
        assert.equal(submitResult.isSubmitted, true, "isSubmitted must be true");
        assert.equal(submitResult.isApproved, false, "isApproved must be false after confirm");

        // CRITICAL CHECK: Verify student document in MongoDB is STILL NOT ALLOCATED!
        const studentAfterConfirm = await User.findById(createdTestUser._id);
        const outwardAlloc = studentAfterConfirm?.allocatedBus?.outward;
        const isAllocated = studentAfterConfirm?.allocatedBus?.isAllocated || outwardAlloc?.isAllocated;
        assert.equal(isAllocated || false, false, "Confirm must NOT allocate users in MongoDB!");
        assert.equal(outwardAlloc || null, null, "outward allocation must remain null after confirm");
    });

    it("3. Page Re-entry Check: getActiveAIPlan returns pending_approval state without allocating", async (t) => {
        if (!mongoConnected) {
            t.skip("MongoDB required for this test");
            return;
        }

        // Admin leaves page and returns: getActiveAIPlan is called
        const activePlanResult = await getActiveAIPlan({ direction: "OUTWARD", forceRefresh: true });
        assert.equal(activePlanResult.success, true, "getActiveAIPlan should succeed");
        assert.ok(activePlanResult.outwardPlan, "Should return the pending outward plan");
        assert.equal(activePlanResult.outwardPlan.status, "pending_approval", "Status must remain pending_approval upon page re-entry");
        assert.equal(activePlanResult.outwardPlan.isSubmitted, true, "isSubmitted must remain true");
        assert.equal(activePlanResult.outwardPlan.isApproved, false, "isApproved must remain false");

        // Ensure user is STILL unallocated
        const student = await User.findById(createdTestUser._id);
        assert.equal(student.allocatedBus, null, "Student must remain unallocated upon page re-entry");
    });

    it("4. Lifecycle Step 4 & 5 (Approve / Activate): Admin approves, Plan becomes active, and users get allocated", async (t) => {
        if (!mongoConnected) {
            t.skip("MongoDB required for this test");
            return;
        }

        // Admin clicks APPROVE (calls saveSelectedPlan / approveAIPlan)
        const approveResult = await saveSelectedPlan({
            planType: "AI",
            direction: "OUTWARD",
            tripMode: "FROM_SOURCE"
            // Notice: plan can be omitted because the pending plan is already in DB!
        });

        assert.equal(approveResult.success, true, "saveSelectedPlan / approveAIPlan should succeed");
        assert.equal(approveResult.status, "active", "Status must now be active");
        assert.equal(approveResult.isApproved, true, "isApproved must now be true");
        assert.equal(approveResult.isSubmitted, true, "isSubmitted must be true");

        // CRITICAL CHECK: Verify student document in MongoDB is NOW ALLOCATED!
        const studentAfterApprove = await User.findById(createdTestUser._id);
        assert.ok(studentAfterApprove.allocatedBus, "student.allocatedBus must not be null after approve");

        const outwardAlloc = studentAfterApprove.allocatedBus.outward;
        assert.ok(outwardAlloc, "student.allocatedBus.outward must exist after outward approval");
        assert.equal(outwardAlloc.isAllocated, true, "isAllocated must be true");
        assert.equal(outwardAlloc.approved, true, "approved must be true");
        assert.equal(outwardAlloc.direction, "OUTWARD", "direction must be OUTWARD");
        assert.equal(outwardAlloc.vehicleName, createdTestVehicle.vehicleName, "vehicleName must match allocated bus");
        assert.equal(outwardAlloc.routeCode, "R-OUT-TEST-1", "routeCode must match");
        assert.equal(outwardAlloc.dropoffStop || outwardAlloc.stopName, "Test Junction", "stopName must match");

        // Directional isolation: INWARD must remain unallocated!
        const inwardAlloc = studentAfterApprove.allocatedBus.inward;
        assert.equal(inwardAlloc || null, null, "INWARD allocation must remain null when only OUTWARD was approved");
    });

    it("5. Directional Isolation: OUTWARD approval does not affect INWARD lifecycle", async (t) => {
        if (!mongoConnected) {
            t.skip("MongoDB required for this test");
            return;
        }

        // Query active INWARD plan: should not be active or approved
        const inwardActive = await getActiveAIPlan({ direction: "INWARD", planType: "AI", forceRefresh: true });
        if (inwardActive.inwardPlan) {
            assert.notEqual(inwardActive.inwardPlan.status, "active", "INWARD plan should not become active when only OUTWARD was approved");
        }
    });

    it("6. Reset Compatibility: Resetting OUTWARD clears OUTWARD plan and allocations without touching INWARD", async (t) => {
        if (!mongoConnected) {
            t.skip("MongoDB required for this test");
            return;
        }

        // Trigger Reset for OUTWARD
        const resetResult = await resetAIPlan({ direction: "OUTWARD" });
        assert.equal(resetResult.success, true, "resetAIPlan for OUTWARD should succeed");

        // Check student: OUTWARD allocation must be cleared
        const studentAfterReset = await User.findById(createdTestUser._id);
        const outwardAlloc = studentAfterReset?.allocatedBus?.outward;
        assert.equal(outwardAlloc || null, null, "OUTWARD allocation must be cleared after reset");

        // getActiveAIPlan should report wasReset: true for OUTWARD
        const postResetActive = await getActiveAIPlan({ direction: "OUTWARD", planType: "AI", forceRefresh: true });
        assert.equal(postResetActive.wasReset, true, "getActiveAIPlan must report wasReset: true");
    });
});
