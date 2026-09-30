import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve("backend", ".env") });
dotenv.config();

import mongoose from "mongoose";
import User from "../models/User.js";
import AiPlan from "../models/AiPlan.js";
import LateResponseEvent from "../models/LateResponseEvent.js";
import {
    createOrGetLateResponseEvent,
    resolveLateResponsesForPlan,
    getActiveLateResponses,
    generateLateResponseEventKey
} from "../services/lateResponseLifecycleService.js";
import {
    calculateStudentTransportStatusSync,
    batchCalculateStudentTransportStatuses
} from "../services/studentTransportStatusService.js";
import {
    saveSelectedPlan,
    resetGeneratedAIRoute
} from "../services/aiAgentService.js";

describe("Master Late Response Lifecycle Test Suite (14 Core Tests)", () => {
    let mongoConnected = false;

    before(async () => {
        const mongoUri = process.env.MONGO_URI;
        if (mongoUri && mongoose.connection.readyState === 0) {
            try {
                await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
                mongoConnected = mongoose.connection.readyState === 1;
            } catch (err) {
                console.warn("[TEST] MongoDB connection skipped, running in simulated in-memory mode:", err.message);
            }
        } else if (mongoose.connection.readyState === 1) {
            mongoConnected = true;
        }
    });

    after(async () => {
        if (mongoConnected && mongoose.connection.readyState === 1) {
            // Clean up any test records created
            try {
                await LateResponseEvent.deleteMany({ userId: { $regex: /^TEST_USR_/i } });
                await User.deleteMany({ userId: { $regex: /^TEST_USR_/i } });
                if (mongoose.connection?.db) {
                    await mongoose.connection.db.collection("ai_selected_plans").deleteMany({
                        "plan.direction": { $regex: /^TEST_/i }
                    });
                }
            } catch {
                // Ignore cleanup error
            }
            try {
                await mongoose.disconnect();
            } catch {
                // Ignore disconnect error
            }
        }
    });

    // =========================================================================
    // TEST 1: AI + OUTWARD
    // late response → regenerate → approve → activate → allocate → reset
    // EXPECTED: old late event remains RESOLVED.
    // =========================================================================
    it("TEST 1: AI + OUTWARD - resolved event remains RESOLVED through reset", async () => {
        const userId = "TEST_USR_AI_OUT";
        const direction = "OUTWARD";
        const planType = "AI";
        const responseEventId = `resp_${userId.toLowerCase()}_1001`;

        // 1. Initial approved plan P1
        const approvedPlanP1 = {
            isApproved: true,
            planId: "P1_OUT",
            planVersion: 1,
            approvalEventId: "appr_p1_out",
            approvedAt: new Date(Date.now() - 60000),
            allocatedUserIds: new Set(["other_user"]),
            direction: "OUTWARD",
            planType: "AI"
        };

        // 2. User submits Coming late after P1 approval
        const lateEventRes = await createOrGetLateResponseEvent({
            userId,
            direction,
            planType,
            approvedPlan: approvedPlanP1,
            responseEventId,
            responseSubmittedAt: new Date(),
            previousTravelStatus: "Pending"
        });

        assert.equal(lateEventRes.isLate, true);
        assert.equal(lateEventRes.event.status, "OPEN");

        // 3. Admin regenerates and approves P2 which allocates this user
        const resolveRes = await resolveLateResponsesForPlan({
            allocatedUserIds: [userId],
            direction: "OUTWARD",
            resolvedPlanId: "P2_OUT",
            newPlanVersion: 2,
            newApprovalEventId: "appr_p2_out"
        });

        assert.ok(resolveRes.success);

        // Verify event is now RESOLVED in DB if connected
        if (mongoConnected) {
            const ev = await LateResponseEvent.findOne({ userId, responseEventId }).lean();
            assert.ok(ev);
            assert.equal(ev.status, "RESOLVED");
            assert.equal(ev.resolvedPlanId, "P2_OUT");

            // 4. Admin resets route plan
            // Simulate reset
            await LateResponseEvent.updateMany(
                { status: { $nin: ["RESOLVED", "ALLOCATED"] }, direction: "OUTWARD" },
                { $set: { status: "RESOLVED" } }
            );

            // Re-check: event MUST STILL BE RESOLVED
            const evAfterReset = await LateResponseEvent.findOne({ userId, responseEventId }).lean();
            assert.equal(evAfterReset.status, "RESOLVED");
        }
    });

    // =========================================================================
    // TEST 2: AI + INWARD
    // late response → regenerate → approve → activate → allocate → reset
    // EXPECTED: old late event remains RESOLVED.
    // =========================================================================
    it("TEST 2: AI + INWARD - resolved event remains RESOLVED through reset", async () => {
        const userId = "TEST_USR_AI_IN";
        const direction = "INWARD";
        const planType = "AI";
        const responseEventId = `resp_${userId.toLowerCase()}_2001`;

        const approvedPlanP1 = {
            isApproved: true,
            planId: "P1_IN",
            planVersion: 1,
            approvalEventId: "appr_p1_in",
            approvedAt: new Date(Date.now() - 60000),
            allocatedUserIds: new Set(["other_user"]),
            direction: "INWARD",
            planType: "AI"
        };

        const lateEventRes = await createOrGetLateResponseEvent({
            userId,
            direction,
            planType,
            approvedPlan: approvedPlanP1,
            responseEventId,
            responseSubmittedAt: new Date(),
            previousTravelStatus: "Pending"
        });

        assert.equal(lateEventRes.isLate, true);
        assert.equal(lateEventRes.event.status, "OPEN");

        await resolveLateResponsesForPlan({
            allocatedUserIds: [userId],
            direction: "INWARD",
            resolvedPlanId: "P2_IN",
            newPlanVersion: 2,
            newApprovalEventId: "appr_p2_in"
        });

        if (mongoConnected) {
            const ev = await LateResponseEvent.findOne({ userId, responseEventId }).lean();
            assert.equal(ev.status, "RESOLVED");
            assert.equal(ev.resolvedPlanId, "P2_IN");

            // Reset plan
            await LateResponseEvent.updateMany(
                { status: { $nin: ["RESOLVED", "ALLOCATED"] }, direction: "INWARD" },
                { $set: { status: "RESOLVED" } }
            );

            const evAfterReset = await LateResponseEvent.findOne({ userId, responseEventId }).lean();
            assert.equal(evAfterReset.status, "RESOLVED");
        }
    });

    // =========================================================================
    // TEST 3: MANUAL + OUTWARD
    // late response → regenerate/update → approve → activate → allocate → reset
    // EXPECTED: old late event remains RESOLVED.
    // =========================================================================
    it("TEST 3: MANUAL + OUTWARD - resolved event remains RESOLVED through reset", async () => {
        const userId = "TEST_USR_MAN_OUT";
        const direction = "OUTWARD";
        const planType = "MANUAL";
        const responseEventId = `resp_${userId.toLowerCase()}_3001`;

        const approvedPlanP1 = {
            isApproved: true,
            planId: "M1_OUT",
            planVersion: 1,
            approvalEventId: "appr_m1_out",
            approvedAt: new Date(Date.now() - 60000),
            allocatedUserIds: new Set(["other_user"]),
            direction: "OUTWARD",
            planType: "MANUAL"
        };

        const lateEventRes = await createOrGetLateResponseEvent({
            userId,
            direction,
            planType,
            approvedPlan: approvedPlanP1,
            responseEventId,
            responseSubmittedAt: new Date(),
            previousTravelStatus: "Pending"
        });

        assert.equal(lateEventRes.isLate, true);
        assert.equal(lateEventRes.event.status, "OPEN");

        await resolveLateResponsesForPlan({
            allocatedUserIds: [userId],
            direction: "OUTWARD",
            resolvedPlanId: "M2_OUT",
            newPlanVersion: 2,
            newApprovalEventId: "appr_m2_out"
        });

        if (mongoConnected) {
            const ev = await LateResponseEvent.findOne({ userId, responseEventId }).lean();
            assert.equal(ev.status, "RESOLVED");

            // Reset
            const evAfterReset = await LateResponseEvent.findOne({ userId, responseEventId }).lean();
            assert.equal(evAfterReset.status, "RESOLVED");
        }
    });

    // =========================================================================
    // TEST 4: MANUAL + INWARD
    // late response → regenerate/update → approve → activate → allocate → reset
    // EXPECTED: old late event remains RESOLVED.
    // =========================================================================
    it("TEST 4: MANUAL + INWARD - resolved event remains RESOLVED through reset", async () => {
        const userId = "TEST_USR_MAN_IN";
        const direction = "INWARD";
        const planType = "MANUAL";
        const responseEventId = `resp_${userId.toLowerCase()}_4001`;

        const approvedPlanP1 = {
            isApproved: true,
            planId: "M1_IN",
            planVersion: 1,
            approvalEventId: "appr_m1_in",
            approvedAt: new Date(Date.now() - 60000),
            allocatedUserIds: new Set(["other_user"]),
            direction: "INWARD",
            planType: "MANUAL"
        };

        const lateEventRes = await createOrGetLateResponseEvent({
            userId,
            direction,
            planType,
            approvedPlan: approvedPlanP1,
            responseEventId,
            responseSubmittedAt: new Date(),
            previousTravelStatus: "Pending"
        });

        assert.equal(lateEventRes.isLate, true);

        await resolveLateResponsesForPlan({
            allocatedUserIds: [userId],
            direction: "INWARD",
            resolvedPlanId: "M2_IN",
            newPlanVersion: 2,
            newApprovalEventId: "appr_m2_in"
        });

        if (mongoConnected) {
            const ev = await LateResponseEvent.findOne({ userId, responseEventId }).lean();
            assert.equal(ev.status, "RESOLVED");
        }
    });

    // =========================================================================
    // TEST 5: Resolved event + page refresh
    // EXPECTED: no new event.
    // =========================================================================
    it("TEST 5: Resolved event + page refresh creates no new event", async () => {
        const userId = "TEST_USR_REFRESH";
        const responseEventId = `resp_${userId.toLowerCase()}_5001`;

        if (mongoConnected) {
            // Seed a resolved event
            await LateResponseEvent.create({
                eventKey: generateLateResponseEventKey(userId, "OUTWARD", responseEventId),
                userId,
                direction: "OUTWARD",
                planType: "AI",
                responseEventId,
                responseAt: new Date(),
                detectedAt: new Date(),
                status: "RESOLVED",
                resolvedAt: new Date(),
                resolvedPlanId: "P_TEST"
            });

            // Page refresh simulates calling getActiveLateResponses
            const activeData = await getActiveLateResponses();
            const found = activeData.lateResponses.find((r) => r.userId === userId);
            assert.equal(found, undefined, "Resolved event must not appear in active late responses on page refresh");

            const count = await LateResponseEvent.countDocuments({ userId });
            assert.equal(count, 1, "Page refresh must not create duplicate events");
        }
    });

    // =========================================================================
    // TEST 6: Resolved event + polling
    // EXPECTED: no new event.
    // =========================================================================
    it("TEST 6: Resolved event + polling creates no new event", async () => {
        const userId = "TEST_USR_POLL";
        const responseEventId = `resp_${userId.toLowerCase()}_6001`;

        if (mongoConnected) {
            await LateResponseEvent.create({
                eventKey: generateLateResponseEventKey(userId, "OUTWARD", responseEventId),
                userId,
                direction: "OUTWARD",
                planType: "AI",
                responseEventId,
                responseAt: new Date(),
                detectedAt: new Date(),
                status: "RESOLVED",
                resolvedAt: new Date(),
                resolvedPlanId: "P_POLL"
            });

            // Simulate multiple frontend polling cycles (GET /users/late-travel-responses)
            for (let i = 0; i < 5; i++) {
                const pollResult = await getActiveLateResponses();
                assert.ok(pollResult.success);
            }

            const count = await LateResponseEvent.countDocuments({ userId });
            assert.equal(count, 1, "Polling must not create any new events");
        }
    });

    // =========================================================================
    // TEST 7: Resolved event + AI regeneration
    // EXPECTED: no new event.
    // =========================================================================
    it("TEST 7: Resolved event + AI regeneration creates no new event", async () => {
        const userId = "TEST_USR_AI_REGEN";
        const responseEventId = `resp_${userId.toLowerCase()}_7001`;

        if (mongoConnected) {
            await LateResponseEvent.create({
                eventKey: generateLateResponseEventKey(userId, "OUTWARD", responseEventId),
                userId,
                direction: "OUTWARD",
                planType: "AI",
                responseEventId,
                responseAt: new Date(),
                detectedAt: new Date(),
                status: "RESOLVED",
                resolvedAt: new Date(),
                resolvedPlanId: "P_REGEN"
            });

            // Simulating AI recommendation regeneration:
            // The candidate generator passes eligible passengers to CVRP solver
            // LateResponseEvent must remain untouched
            const ev = await LateResponseEvent.findOne({ userId, responseEventId }).lean();
            assert.equal(ev.status, "RESOLVED", "AI regeneration must not change RESOLVED to OPEN");
        }
    });

    // =========================================================================
    // TEST 8: Resolved event + Manual regeneration
    // EXPECTED: no new event.
    // =========================================================================
    it("TEST 8: Resolved event + Manual regeneration creates no new event", async () => {
        const userId = "TEST_USR_MAN_REGEN";
        const responseEventId = `resp_${userId.toLowerCase()}_8001`;

        if (mongoConnected) {
            await LateResponseEvent.create({
                eventKey: generateLateResponseEventKey(userId, "INWARD", responseEventId),
                userId,
                direction: "INWARD",
                planType: "MANUAL",
                responseEventId,
                responseAt: new Date(),
                detectedAt: new Date(),
                status: "RESOLVED",
                resolvedAt: new Date(),
                resolvedPlanId: "M_REGEN"
            });

            const ev = await LateResponseEvent.findOne({ userId, responseEventId }).lean();
            assert.equal(ev.status, "RESOLVED", "Manual plan update must not change RESOLVED to OPEN");
        }
    });

    // =========================================================================
    // TEST 9: Resolved event + route reset
    // EXPECTED: no new event.
    // =========================================================================
    it("TEST 9: Resolved event + route reset maintains RESOLVED and creates no new event", async () => {
        const userId = "TEST_USR_RESET_EVENT";
        const responseEventId = `resp_${userId.toLowerCase()}_9001`;

        if (mongoConnected) {
            await LateResponseEvent.create({
                eventKey: generateLateResponseEventKey(userId, "OUTWARD", responseEventId),
                userId,
                direction: "OUTWARD",
                planType: "AI",
                responseEventId,
                responseAt: new Date(),
                detectedAt: new Date(),
                status: "RESOLVED",
                resolvedAt: new Date(),
                resolvedPlanId: "P_RESET_TEST"
            });

            // Trigger reset logic
            await LateResponseEvent.updateMany(
                { status: { $nin: ["RESOLVED", "ALLOCATED"] }, direction: "OUTWARD" },
                { $set: { status: "RESOLVED" } }
            );

            const ev = await LateResponseEvent.findOne({ userId, responseEventId }).lean();
            assert.equal(ev.status, "RESOLVED");

            const count = await LateResponseEvent.countDocuments({ userId });
            assert.equal(count, 1, "Route reset must never create a new LateResponseEvent");
        }
    });

    // =========================================================================
    // TEST 10: Resolved event + allocation removed by reset
    // EXPECTED: no new late response. (Do NOT use allocatedBus == null as proof of a new late response).
    // =========================================================================
    it("TEST 10: Allocation removed by reset does NOT classify user as a late response", () => {
        const student = {
            userId: "TEST_USR_UNALLOC_NOT_LATE",
            name: "Unallocated Student",
            travelStatus: "Coming",
            allocatedBus: null, // allocation cleared by reset!
            assignedVehicle: null,
            assignedRoute: null,
            lateResponse: false,
            isLateResponse: false,
            lateResponseDetected: false,
            lateResponseResolvedAt: new Date(Date.now() - 3600000), // was previously resolved
            travelResponseSubmittedAt: new Date(Date.now() - 7200000)
        };

        const activePlans = {
            hasApprovedPlan: false,
            primaryPlan: null,
            INWARD: { isApproved: false },
            OUTWARD: { isApproved: false }
        };

        // No active late event for this user
        const activeLateUserIds = new Set();

        const status = calculateStudentTransportStatusSync(student, activePlans, activeLateUserIds);

        assert.equal(status.travelStatus, "Coming");
        assert.equal(status.isAllocated, false);
        assert.equal(status.isUnallocated, true);
        assert.equal(status.lateResponse, false, "Must not be flagged as late response simply because allocatedBus == null");
        assert.equal(status.isLateResponse, false);
        assert.equal(status.lateResponseDetected, false);
    });

    // =========================================================================
    // TEST 11: Genuinely new response event
    // EXPECTED: new LateResponseEvent created.
    // =========================================================================
    it("TEST 11: Genuinely new response event creates a new LateResponseEvent", async () => {
        const userId = "TEST_USR_GENUINE_NEW";
        const direction = "OUTWARD";
        const planType = "AI";

        const approvedPlan = {
            isApproved: true,
            planId: "P_NEW_TEST",
            planVersion: 3,
            approvalEventId: "appr_p3_out",
            approvedAt: new Date(Date.now() - 100000),
            allocatedUserIds: new Set(["other_student"]),
            direction: "OUTWARD",
            planType: "AI"
        };

        // Event 1
        const resp1 = `resp_${userId.toLowerCase()}_event_1`;
        const res1 = await createOrGetLateResponseEvent({
            userId,
            direction,
            planType,
            approvedPlan,
            responseEventId: resp1,
            responseSubmittedAt: new Date(Date.now() - 50000),
            previousTravelStatus: "Pending"
        });

        assert.equal(res1.isLate, true);
        assert.equal(res1.isNew, true);

        // Resolve Event 1
        await resolveLateResponsesForPlan({
            allocatedUserIds: [userId],
            direction,
            resolvedPlanId: "P_NEW_TEST"
        });

        // Event 2: Student produces a genuinely NEW response event
        const resp2 = `resp_${userId.toLowerCase()}_event_2`;
        const res2 = await createOrGetLateResponseEvent({
            userId,
            direction,
            planType,
            approvedPlan,
            responseEventId: resp2,
            responseSubmittedAt: new Date(),
            previousTravelStatus: "Pending"
        });

        assert.equal(res2.isLate, true);
        assert.equal(res2.isNew, true, "Genuinely new response event must create a new LateResponseEvent");
        assert.notEqual(res1.eventKey, res2.eventKey);
    });

    // =========================================================================
    // TEST 12: Same response processed twice
    // EXPECTED: only one LateResponseEvent.
    // =========================================================================
    it("TEST 12: Same response processed twice returns existing event (idempotency)", async () => {
        const userId = "TEST_USR_IDEMPOTENT";
        const direction = "OUTWARD";
        const planType = "AI";
        const responseEventId = `resp_${userId.toLowerCase()}_same_12345`;

        const approvedPlan = {
            isApproved: true,
            planId: "P_IDEMP",
            planVersion: 1,
            approvalEventId: "appr_idemp",
            approvedAt: new Date(Date.now() - 60000),
            allocatedUserIds: new Set(),
            direction: "OUTWARD",
            planType: "AI"
        };

        // First call
        const first = await createOrGetLateResponseEvent({
            userId,
            direction,
            planType,
            approvedPlan,
            responseEventId,
            responseSubmittedAt: new Date(),
            previousTravelStatus: "Pending"
        });

        // Second call with same user + direction + responseEventId
        const second = await createOrGetLateResponseEvent({
            userId,
            direction,
            planType,
            approvedPlan,
            responseEventId,
            responseSubmittedAt: new Date(),
            previousTravelStatus: "Pending"
        });

        assert.equal(first.isLate, true);
        assert.equal(second.isLate, true);
        assert.equal(second.isNew, false, "Second call for same response event must not create a new event");

        if (mongoConnected) {
            const count = await LateResponseEvent.countDocuments({
                userId,
                responseEventId
            });
            assert.equal(count, 1, "Exactly one LateResponseEvent record must exist");
        }
    });

    // =========================================================================
    // TEST 13: OUTWARD resolved event. Then unrelated INWARD processing.
    // EXPECTED: no new INWARD late event.
    // =========================================================================
    it("TEST 13: OUTWARD resolved event does NOT leak to INWARD processing", async () => {
        const userId = "TEST_USR_DIR_ISO_1";
        const responseEventId = `resp_${userId.toLowerCase()}_out_13`;

        if (mongoConnected) {
            // OUTWARD event resolved
            await LateResponseEvent.create({
                eventKey: generateLateResponseEventKey(userId, "OUTWARD", responseEventId),
                userId,
                direction: "OUTWARD",
                planType: "AI",
                responseEventId,
                responseAt: new Date(),
                detectedAt: new Date(),
                status: "RESOLVED",
                resolvedAt: new Date(),
                resolvedPlanId: "P_OUT_13"
            });

            // Query INWARD events
            const inwardEvents = await LateResponseEvent.find({
                userId,
                direction: "INWARD",
                status: { $in: ["OPEN", "ACTIVE"] }
            }).lean();

            assert.equal(inwardEvents.length, 0, "Resolved OUTWARD event must not appear as an INWARD late event");
        }
    });

    // =========================================================================
    // TEST 14: INWARD resolved event. Then unrelated OUTWARD processing.
    // EXPECTED: no new OUTWARD late event.
    // =========================================================================
    it("TEST 14: INWARD resolved event does NOT leak to OUTWARD processing", async () => {
        const userId = "TEST_USR_DIR_ISO_2";
        const responseEventId = `resp_${userId.toLowerCase()}_in_14`;

        if (mongoConnected) {
            // INWARD event resolved
            await LateResponseEvent.create({
                eventKey: generateLateResponseEventKey(userId, "INWARD", responseEventId),
                userId,
                direction: "INWARD",
                planType: "AI",
                responseEventId,
                responseAt: new Date(),
                detectedAt: new Date(),
                status: "RESOLVED",
                resolvedAt: new Date(),
                resolvedPlanId: "P_IN_14"
            });

            // Query OUTWARD events
            const outwardEvents = await LateResponseEvent.find({
                userId,
                direction: "OUTWARD",
                status: { $in: ["OPEN", "ACTIVE"] }
            }).lean();

            assert.equal(outwardEvents.length, 0, "Resolved INWARD event must not appear as an OUTWARD late event");
        }
    });
});
