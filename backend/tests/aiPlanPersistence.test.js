import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import AiPlan from "../models/AiPlan.js";
import {
    getActiveAIPlan,
    resetGeneratedAIRoute,
    sanitizeTransportationPlan
} from "../services/aiAgentService.js";

describe("AI Generated Route Persistence Verification Suite", () => {
    before(async () => {
        const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/test_ai_transportation";
        if (mongoose.connection.readyState === 0) {
            try {
                await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
            } catch (e) {
                console.warn("MongoDB connection skipped for local test environment if unmounted:", e.message);
            }
        }
    });

    after(async () => {
        if (mongoose.connection.readyState !== 0) {
            await AiPlan.deleteMany({ planType: "AI", source: "TEST_PERSISTENCE_HUB" });
            await mongoose.disconnect();
        }
    });

    test("Test 1 — OPTIMIZATION REQUIRES REVIEW plan (isCertified: false) is persisted to MongoDB", async (t) => {
        if (mongoose.connection.readyState === 0) {
            t.skip("MongoDB not connected, skipping live DB test");
            return;
        }

        // Clean up any existing test plan
        await AiPlan.deleteMany({ direction: "OUTWARD", source: "TEST_PERSISTENCE_HUB" });

        const reviewRequiredPlan = {
            totalCapacity: 50,
            allocatedSeats: 40,
            assignedUsers: 40,
            unassignedUsers: 5,
            capacityShortage: 5,
            uniqueStopCount: 6,
            routeStopVisitCount: 6,
            certification: {
                isCertified: false,
                status: "OPTIMIZATION REQUIRES REVIEW",
                statusTitle: "Review Required",
                warnings: ["Capacity shortage detected: 5 passengers unallocated"]
            },
            buses: [
                {
                    busId: "BUS-TEST-1",
                    busNumber: "TN-58-AA-1001",
                    capacity: 50,
                    allocatedSeats: 40,
                    isContinuous: true,
                    users: ["user_1", "user_2"],
                    stops: [
                        { stopName: "Hub A", userIds: ["user_1"] },
                        { stopName: "Stop B", userIds: ["user_2"] }
                    ]
                }
            ]
        };

        // Check the save condition: (aiPlan && Array.isArray(aiPlan.buses) && aiPlan.buses.length > 0)
        assert.equal(reviewRequiredPlan.certification.isCertified, false);
        assert.equal(Array.isArray(reviewRequiredPlan.buses), true);
        assert.equal(reviewRequiredPlan.buses.length > 0, true);

        // Sanitize and save to MongoDB
        const sanitized = sanitizeTransportationPlan(reviewRequiredPlan);
        const savedDoc = await AiPlan.create({
            active: true,
            status: "active",
            planType: "AI",
            direction: "OUTWARD",
            tripMode: "FROM_SOURCE",
            source: "TEST_PERSISTENCE_HUB",
            destination: { name: "Destination Hub", latitude: 9.9, longitude: 78.1 },
            summary: {
                totalUsers: 45,
                confirmedUsers: 45,
                allocatedSeats: 40
            },
            aiPlan: sanitized,
            generatedAt: new Date()
        });

        assert.ok(savedDoc._id, "Plan document must have an _id in MongoDB");

        // Verify retrieval via getActiveAIPlan
        const fetched = await getActiveAIPlan({ direction: "OUTWARD" });
        assert.equal(fetched.success, true, "getActiveAIPlan must return success: true");
        assert.ok(fetched.outwardPlan, "Outward plan must be returned");
        assert.equal(fetched.outwardPlan.aiPlan.certification.isCertified, false);
        assert.equal(fetched.outwardPlan.aiPlan.certification.status, "OPTIMIZATION REQUIRES REVIEW");
        assert.equal(fetched.outwardPlan.aiPlan.buses.length, 1);
        assert.equal(fetched.outwardPlan.aiPlan.buses[0].busId, "BUS-TEST-1");
    });

    test("Test 2 — OPTIMIZATION ENGINE SUCCESS plan (isCertified: true) is persisted to MongoDB", async (t) => {
        if (mongoose.connection.readyState === 0) {
            t.skip("MongoDB not connected, skipping live DB test");
            return;
        }

        const certifiedPlan = {
            totalCapacity: 60,
            allocatedSeats: 45,
            assignedUsers: 45,
            unassignedUsers: 0,
            capacityShortage: 0,
            uniqueStopCount: 7,
            routeStopVisitCount: 7,
            certification: {
                isCertified: true,
                status: "OPTIMIZATION ENGINE SUCCESS",
                statusTitle: "Certified",
                warnings: []
            },
            buses: [
                {
                    busId: "BUS-TEST-2",
                    busNumber: "TN-58-BB-2002",
                    capacity: 60,
                    allocatedSeats: 45,
                    isContinuous: true,
                    users: ["user_3"],
                    stops: [{ stopName: "Stop C", userIds: ["user_3"] }]
                }
            ]
        };

        const sanitized = sanitizeTransportationPlan(certifiedPlan);
        const savedDoc = await AiPlan.create({
            active: true,
            status: "active",
            planType: "AI",
            direction: "INWARD",
            tripMode: "TO_DESTINATION",
            source: "TEST_PERSISTENCE_HUB",
            destination: { name: "Destination Hub", latitude: 9.9, longitude: 78.1 },
            summary: {
                totalUsers: 45,
                confirmedUsers: 45,
                allocatedSeats: 45
            },
            aiPlan: sanitized,
            generatedAt: new Date()
        });

        assert.ok(savedDoc._id, "Certified plan document must have an _id in MongoDB");

        const fetched = await getActiveAIPlan({ direction: "INWARD" });
        assert.equal(fetched.success, true);
        assert.ok(fetched.inwardPlan);
        assert.equal(fetched.inwardPlan.aiPlan.certification.isCertified, true);
        assert.equal(fetched.inwardPlan.aiPlan.certification.status, "OPTIMIZATION ENGINE SUCCESS");
        assert.equal(fetched.inwardPlan.aiPlan.buses[0].busId, "BUS-TEST-2");
    });

    test("Test 3 — getActiveAIPlan returns saved plan regardless of comingCount variations", async (t) => {
        if (mongoose.connection.readyState === 0) {
            t.skip("MongoDB not connected, skipping live DB test");
            return;
        }

        // Fetching outward plan again confirms it persists across multiple calls / polling
        const fetched1 = await getActiveAIPlan({ direction: "OUTWARD" });
        const fetched2 = await getActiveAIPlan({ direction: "OUTWARD" });
        assert.equal(fetched1.success, true);
        assert.equal(fetched2.success, true);
        assert.equal(fetched1.outwardPlan?._id.toString(), fetched2.outwardPlan?._id.toString());
    });

    test("Test 4 — Explicit Reset AI Generated Route deactivates saved plans", async (t) => {
        if (mongoose.connection.readyState === 0) {
            t.skip("MongoDB not connected, skipping live DB test");
            return;
        }

        const resetResult = await resetGeneratedAIRoute({ direction: "OUTWARD" });
        assert.equal(resetResult.success, true);

        // After reset, outwardPlan should be null
        const afterReset = await getActiveAIPlan({ direction: "OUTWARD" });
        assert.equal(afterReset.success, true);
        assert.equal(afterReset.outwardPlan, null, "Outward plan must be deactivated after explicit reset");
    });
});
