import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve("backend", ".env") });
dotenv.config();

import mongoose from "mongoose";
import { saveSelectedPlan, getSelectedPlan, getActiveAIPlan } from "../services/aiAgentService.js";
import AiPlan from "../models/AiPlan.js";

describe("Save & Confirm Plan - approvalEventId & Lifecycle Integrity Suite", () => {
    let mongoConnected = false;

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
    });

    after(async () => {
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }
    });

    it("1. Verifies saveSelectedPlan generates a valid approvalEventId without ReferenceError", async (t) => {
        if (!mongoConnected) {
            t.skip("Live MongoDB required for full persistence test");
            return;
        }

        const mockPlan = {
            direction: "OUTWARD",
            tripMode: "FROM_SOURCE",
            totalUsers: 10,
            comingUsers: 10,
            assignedUsers: 10,
            totalCapacity: 50,
            allocatedSeats: 10,
            buses: [
                {
                    busId: "TEST-BUS-01",
                    routeId: "TEST-ROUTE-01",
                    vehicleName: "Test Bus 1",
                    capacity: 50,
                    assignedUsers: 10,
                    stops: [
                        { name: "Simmakkal", userCount: 10, stopName: "Simmakkal" }
                    ],
                    users: []
                }
            ],
            certification: {
                isCertified: true,
                status: "OPTIMIZATION ENGINE SUCCESS"
            }
        };

        const result = await saveSelectedPlan({
            planType: "AI",
            direction: "OUTWARD",
            tripMode: "FROM_SOURCE",
            plan: mockPlan,
            startingPoint: { name: "Test Campus Depot", latitude: 9.8324, longitude: 78.1884 }
        });

        assert.strictEqual(result.success, true, "Save operation must succeed");
        assert.ok(result.approvalEventId, "approvalEventId must be defined and present in result");
        assert.ok(typeof result.approvalEventId === "string", "approvalEventId must be a string");
        assert.ok(result.approvalEventId.length > 10, "approvalEventId must be a valid ID string");
        assert.strictEqual(result.direction, "OUTWARD", "Direction must match");
        assert.strictEqual(result.selection.approvalEventId, result.approvalEventId, "selection must include matching approvalEventId");
        assert.ok(result.selection.planVersion >= 1, "planVersion must be positive number");

        // Verify database persistence in ai_selected_plans
        const persisted = await mongoose.connection.db.collection("ai_selected_plans").findOne({
            approvalEventId: result.approvalEventId
        });
        assert.ok(persisted, "Plan record must be persisted in ai_selected_plans");
        assert.strictEqual(persisted.active, true, "Saved plan must be active");
        assert.strictEqual(persisted.status, "active", "Saved plan status must be active");
        assert.strictEqual(persisted.approvalEventId, result.approvalEventId, "approvalEventId in DB must match returned ID");
    });

    it("2. Verifies INWARD direction save operates independently with distinct approvalEventId", async (t) => {
        if (!mongoConnected) {
            t.skip("Live MongoDB required for full persistence test");
            return;
        }

        const mockInwardPlan = {
            direction: "INWARD",
            tripMode: "TO_DESTINATION",
            totalUsers: 15,
            comingUsers: 15,
            assignedUsers: 15,
            totalCapacity: 50,
            allocatedSeats: 15,
            buses: [
                {
                    busId: "TEST-BUS-02",
                    routeId: "TEST-ROUTE-02",
                    vehicleName: "Test Bus 2",
                    capacity: 50,
                    assignedUsers: 15,
                    stops: [
                        { name: "Goripalayam", userCount: 15, stopName: "Goripalayam" }
                    ],
                    users: []
                }
            ],
            certification: {
                isCertified: true,
                status: "OPTIMIZATION ENGINE SUCCESS"
            }
        };

        const resultInward = await saveSelectedPlan({
            planType: "AI",
            direction: "INWARD",
            tripMode: "TO_DESTINATION",
            plan: mockInwardPlan,
            startingPoint: { name: "Test Campus Depot", latitude: 9.8324, longitude: 78.1884 }
        });

        assert.strictEqual(resultInward.success, true);
        assert.ok(resultInward.approvalEventId);
        assert.strictEqual(resultInward.direction, "INWARD");

        // Verify both Outward and Inward active plans co-exist in ai_selected_plans
        const activeOutward = await mongoose.connection.db.collection("ai_selected_plans").findOne({
            active: true,
            direction: "OUTWARD"
        });
        const activeInward = await mongoose.connection.db.collection("ai_selected_plans").findOne({
            active: true,
            direction: "INWARD"
        });

        assert.ok(activeOutward, "Active Outward plan must exist");
        assert.ok(activeInward, "Active Inward plan must exist");
        assert.notStrictEqual(activeOutward.approvalEventId, activeInward.approvalEventId, "Outward and Inward must have distinct approvalEventIds");
    });

    it("3. Verifies concurrent save calls are guarded against duplicates", async (t) => {
        if (!mongoConnected) {
            t.skip("Live MongoDB required for full persistence test");
            return;
        }

        const mockPlan = {
            direction: "OUTWARD",
            tripMode: "FROM_SOURCE",
            totalUsers: 5,
            comingUsers: 5,
            assignedUsers: 5,
            totalCapacity: 50,
            allocatedSeats: 5,
            buses: [
                {
                    busId: "TEST-BUS-03",
                    routeId: "TEST-ROUTE-03",
                    vehicleName: "Test Bus 3",
                    capacity: 50,
                    assignedUsers: 5,
                    stops: [{ name: "Mattuthavani", userCount: 5, stopName: "Mattuthavani" }],
                    users: []
                }
            ]
        };

        // Fire two saves simultaneously for the exact same direction
        const [res1, res2] = await Promise.all([
            saveSelectedPlan({ planType: "AI", direction: "OUTWARD", plan: mockPlan }),
            saveSelectedPlan({ planType: "AI", direction: "OUTWARD", plan: mockPlan })
        ]);

        // Exactly one should succeed, while the concurrent duplicate receives SAVE_IN_PROGRESS
        const successes = [res1, res2].filter((r) => r.success === true);
        const inProgress = [res1, res2].filter((r) => r.code === "SAVE_IN_PROGRESS");

        assert.strictEqual(successes.length, 1, "Exactly one concurrent save must succeed");
        assert.strictEqual(inProgress.length, 1, "The concurrent duplicate save must be rejected with SAVE_IN_PROGRESS");
    });

    it("4. Verifies safety invariant: uncertified / failing plan does NOT mutate active confirmed plan", async (t) => {
        if (!mongoConnected) {
            t.skip("Live MongoDB required for full persistence test");
            return;
        }

        // 1. Get current active plan for OUTWARD
        const initialActive = await mongoose.connection.db.collection("ai_selected_plans").findOne({
            active: true,
            direction: "OUTWARD"
        });
        assert.ok(initialActive, "There should be an active OUTWARD plan before test");

        // 2. Attempt to save an invalid/uncertified plan with critical safety violation
        const failingPlan = {
            direction: "OUTWARD",
            certification: {
                isCertified: false,
                checks: {
                    capacitiesNotExceeded: false,
                    demandConservation: false
                },
                failureReasons: ["Capacities exceeded test violation"]
            }
        };

        const failedResult = await saveSelectedPlan({
            planType: "AI",
            direction: "OUTWARD",
            plan: failingPlan
        });

        assert.strictEqual(failedResult.success, false, "Save must be rejected for uncertified plan");
        assert.strictEqual(failedResult.code, "UNCERTIFIED_PLAN");

        // 3. Confirm that initial active plan is still active and unchanged!
        const currentActive = await mongoose.connection.db.collection("ai_selected_plans").findOne({
            active: true,
            direction: "OUTWARD"
        });

        assert.ok(currentActive, "Active OUTWARD plan must still exist");
        assert.strictEqual(String(currentActive._id), String(initialActive._id), "Active plan _id must remain identical");
        assert.strictEqual(currentActive.approvalEventId, initialActive.approvalEventId, "Active plan approvalEventId must remain identical");
        assert.strictEqual(currentActive.planVersion, initialActive.planVersion, "Active plan version must remain identical");
    });
});
