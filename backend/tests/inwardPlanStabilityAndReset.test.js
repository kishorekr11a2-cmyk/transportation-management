import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import User from "../models/User.js";
import AiPlan from "../models/AiPlan.js";
import { resetGeneratedAIRoute, getActiveAIPlan } from "../services/aiAgentService.js";

test("Inward Plan Stability & Strict Direction-Specific Reset Suite", async (t) => {
    const mongoUri = process.env.MONGO_URI;
    if (mongoose.connection.readyState === 0 && mongoUri) {
        try {
            await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 8000 });
        } catch (e) {
            console.warn("MongoDB connection warning:", e.message);
        }
    }

    const isConnected = mongoose.connection.readyState === 1;
    if (!isConnected) {
        console.log("Database not available for integration test, skipping DB parts");
        return;
    }

    const testId = `STAB_TEST_${Date.now()}`;
    const inwardPlanId = new mongoose.Types.ObjectId();
    const outwardPlanId = new mongoose.Types.ObjectId();
    const student1Id = new mongoose.Types.ObjectId();
    const student2Id = new mongoose.Types.ObjectId();

    await t.test("Setup isolated test plans and student allocations for Inward and Outward", async () => {
        // 1. Create active Inward plan
        await AiPlan.create({
            _id: inwardPlanId,
            planType: "AI",
            direction: "INWARD",
            tripMode: "TO_DESTINATION",
            active: true,
            status: "active",
            isApproved: true,
            destination: { name: "Engineering College", latitude: 9.9252, longitude: 78.1198 },
            aiPlan: {
                direction: "INWARD",
                tripMode: "TO_DESTINATION",
                buses: [
                    {
                        busId: "BUS_K1",
                        vehicleNumber: "TN-58-K1",
                        vehicleName: "Bus K1",
                        assignedUsers: 1,
                        stops: [
                            { stopName: "Mattuthavani Bus Stand", latitude: 9.9325, longitude: 78.1528, userCount: 1, pickupCount: 1 }
                        ]
                    }
                ]
            }
        });

        // 2. Create active Outward plan
        await AiPlan.create({
            _id: outwardPlanId,
            planType: "AI",
            direction: "OUTWARD",
            tripMode: "FROM_SOURCE",
            active: true,
            status: "active",
            isApproved: true,
            source: { name: "Engineering College", latitude: 9.9252, longitude: 78.1198 },
            aiPlan: {
                direction: "OUTWARD",
                tripMode: "FROM_SOURCE",
                buses: [
                    {
                        busId: "BUS_K2",
                        vehicleNumber: "TN-58-K2",
                        vehicleName: "Bus K2",
                        assignedUsers: 1,
                        stops: [
                            { stopName: "Anna Nagar Dropoff", latitude: 9.918, longitude: 78.145, userCount: 1, dropCount: 1 }
                        ]
                    }
                ]
            }
        });

        // 3. Create student with both Inward and Outward allocations
        await User.create({
            _id: student1Id,
            userId: `${testId}_STU_1`,
            name: "Test Inward & Outward Student",
            email: `${testId}_stu1@test.com`,
            role: "student",
            travelStatus: "Coming",
            allocatedBus: {
                isAllocated: true,
                direction: "INWARD",
                inward: {
                    isAllocated: true,
                    vehicleName: "Bus K1",
                    routeCode: "IN-K1-MATTU",
                    planType: "AI"
                },
                outward: {
                    isAllocated: true,
                    vehicleName: "Bus K2",
                    routeCode: "OUT-K2-ANNA",
                    planType: "AI"
                }
            }
        });
    });

    await t.test("Rule: Generated Inward plan remains locked/stable when student demand changes", async () => {
        // Fetch inward plan before demand change
        const planBefore = await AiPlan.findById(inwardPlanId).lean();
        assert.ok(planBefore, "Inward plan must exist");
        assert.equal(planBefore.active, true, "Inward plan must be active");
        assert.equal(planBefore.aiPlan.buses.length, 1);
        assert.equal(planBefore.aiPlan.buses[0].stops[0].stopName, "Mattuthavani Bus Stand");

        // Simulate student demand changes: another student becomes 'Coming' or changes response
        await User.create({
            _id: student2Id,
            userId: `${testId}_STU_2`,
            name: "Late Demand Change Student",
            email: `${testId}_stu2@test.com`,
            role: "student",
            travelStatus: "Coming"
        });

        // Verify that the generated Inward plan remains completely unchanged/locked
        const planAfter = await AiPlan.findById(inwardPlanId).lean();
        assert.equal(planAfter.active, true, "Inward plan must still be active");
        assert.equal(planAfter.status, "active", "Inward plan status must not have changed");
        assert.equal(planAfter.aiPlan.buses.length, 1);
        assert.equal(planAfter.aiPlan.buses[0].busId, "BUS_K1", "Bus assignment must remain locked");
        assert.equal(planAfter.aiPlan.buses[0].stops[0].stopName, "Mattuthavani Bus Stand", "Stops must remain locked");
    });

    await t.test("Rule: INWARD RESET resets ONLY inward plan and allocations, preserving OUTWARD completely", async () => {
        // Perform Inward Reset
        const resetResult = await resetGeneratedAIRoute({ direction: "INWARD" });

        // Check confirmation message
        assert.equal(resetResult.success, true);
        assert.equal(
            resetResult.message,
            "Inward transportation plan has been reset successfully. Student travel responses remain preserved."
        );
        assert.notEqual(resetResult.message, "Outward plan has been reset.");

        // Verify Inward plan in DB is deactivated / reset
        const inwardAfterReset = await AiPlan.findById(inwardPlanId).lean();
        assert.equal(inwardAfterReset.active, false, "Inward plan active flag must be false");
        assert.equal(inwardAfterReset.status, "reset", "Inward plan status must be 'reset'");
        assert.equal(inwardAfterReset.isApproved, false, "Inward plan isApproved must be false");

        // VERY IMPORTANT: Verify OUTWARD plan is completely UNTOUCHED
        const outwardAfterReset = await AiPlan.findById(outwardPlanId).lean();
        assert.ok(outwardAfterReset, "Outward plan must still exist");
        assert.equal(outwardAfterReset.active, true, "Outward plan active flag MUST still be true");
        assert.equal(outwardAfterReset.status, "active", "Outward plan status MUST still be 'active'");
        assert.equal(outwardAfterReset.isApproved, true, "Outward plan isApproved MUST still be true");
        assert.equal(outwardAfterReset.aiPlan.buses[0].busId, "BUS_K2", "Outward route data must be unchanged");

        // Verify Student allocations: Inward allocation cleared, Outward allocation preserved
        const studentAfterReset = await User.findById(student1Id).lean();
        assert.equal(studentAfterReset.allocatedBus?.inward, null, "Student inward allocation must be cleared");
        assert.ok(studentAfterReset.allocatedBus?.outward, "Student outward allocation MUST be preserved");
        assert.equal(studentAfterReset.allocatedBus?.outward?.vehicleName, "Bus K2");
        assert.equal(studentAfterReset.allocatedBus?.isAllocated, true, "Student remains allocated for outward");
        assert.equal(studentAfterReset.travelStatus, "Coming", "Student travel responses must remain preserved");
    });

    await t.test("Rule: OUTWARD RESET returns proper direction-specific message", async () => {
        // Perform Outward Reset
        const resetResult = await resetGeneratedAIRoute({ direction: "OUTWARD" });

        assert.equal(resetResult.success, true);
        assert.equal(
            resetResult.message,
            "Outward transportation plan has been reset successfully. Student travel responses remain preserved."
        );

        // Verify Outward plan is now reset
        const outwardAfterReset = await AiPlan.findById(outwardPlanId).lean();
        assert.equal(outwardAfterReset.active, false);
        assert.equal(outwardAfterReset.status, "reset");
    });

    // Cleanup test records
    await AiPlan.deleteMany({ _id: { $in: [inwardPlanId, outwardPlanId] } });
    await User.deleteMany({ _id: { $in: [student1Id, student2Id] } });

    // Close DB connection so process exits cleanly
    if (mongoose.connection.readyState === 1) {
        await mongoose.connection.close();
    }
});
