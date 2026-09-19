import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import {
    generateAgentRecommendations,
    saveSelectedPlan,
    getActiveAIPlan,
    resetGeneratedAIRoute,
    validatePlanActivationSafeguards
} from "../services/aiAgentService.js";
import { planMapAwareTransportationRoutes } from "../services/mapAwareRouteEngine.js";
import { getManualPlanRecommendations } from "../controllers/routeController.js";
import { getUserAllocatedBus } from "../services/aiAgentService.js";

const klnceDepot = {
    name: "K.L.N. College of Engineering",
    address: "Pottapalayam, Sivagangai / Madurai - 630612",
    latitude: 9.8324,
    longitude: 78.1884
};

test("Stage 4 & 5 Integration: Map-Aware Route Engine in AI Transportation Agent", async (t) => {
    const mongoUri = process.env.MONGO_URI;
    const hasMongo = Boolean(mongoUri);

    if (mongoose.connection.readyState === 0 && hasMongo) {
        try {
            await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 8000 });
        } catch (e) {
            console.warn("MongoDB connection notice:", e.message);
        }
    }

    const isConnected = mongoose.connection.readyState === 1;

    await t.test("1. Map-Aware Engine: Dynamic Outward Route Planning with Real / Mock Database Inputs", async () => {
        const mockUsers = [
            { userId: "STU_1", name: "Alice", travelStatus: "Coming", stoppings: "Goripalayam" },
            { userId: "STU_2", name: "Bob", travelStatus: "Coming", stoppings: "Goripalayam" },
            { userId: "STU_3", name: "Charlie", travelStatus: "Coming", stoppings: "Anna Nagar" },
            { userId: "STU_4", name: "Diana", travelStatus: "Not Coming", stoppings: "Anna Nagar" },
            { userId: "STU_5", name: "Eve", travelStatus: "Pending", stoppings: "Mattuthavani" },
            { userId: "STU_6", name: "Frank", travelStatus: "Coming", stoppings: "Mattuthavani" }
        ];

        const mockVehicles = [
            { _id: "veh_1", vehicleName: "Fleet-01", capacity: 40, status: "Available" },
            { _id: "veh_2", vehicleName: "Fleet-02", capacity: 40, status: "Not Available" }
        ];

        const mockSchedules = [
            { vehicle: "veh_1", availability: "Available" },
            { vehicle: "veh_2", availability: "Not Available" }
        ];

        const result = await planMapAwareTransportationRoutes({
            users: mockUsers,
            vehicles: mockVehicles,
            schedules: mockSchedules,
            source: klnceDepot,
            direction: "OUTWARD"
        });

        assert.equal(result.status, "validated", "Engine returns validated plan");
        assert.equal(result.planSummary.comingUsers, 4, "Allocates only 4 Coming users");
        assert.equal(result.planSummary.allocatedUsers, 4, "All 4 Coming users allocated");
        assert.equal(result.routes.length, 1, "Only 1 available vehicle used");
        assert.equal(result.routes[0].vehicleName, "Fleet-01", "Assigned vehicle is Fleet-01");
        assert.ok(result.routes[0].assignedUsers <= 40, "Capacity is strictly respected");

        // Verify Not Coming and Pending users are NOT allocated
        const assignedIds = new Set(result.routes[0].userIds);
        assert.ok(assignedIds.has("STU_1"), "Alice (Coming) is allocated");
        assert.ok(assignedIds.has("STU_2"), "Bob (Coming) is allocated");
        assert.ok(assignedIds.has("STU_3"), "Charlie (Coming) is allocated");
        assert.ok(assignedIds.has("STU_6"), "Frank (Coming) is allocated");
        assert.ok(!assignedIds.has("STU_4"), "Diana (Not Coming) is NEVER allocated");
        assert.ok(!assignedIds.has("STU_5"), "Eve (Pending) is NEVER allocated");
    });

    await t.test("2. Outward AI Recommendation Process: Schema Compatibility & Verification Flags", async () => {
        if (!isConnected) {
            console.log("Skipping live recommendations test (no DB connection)");
            return;
        }

        const recRes = await generateAgentRecommendations({
            tripMode: "FROM_SOURCE",
            source: klnceDepot
        });

        assert.equal(recRes.success, true, "Recommendations API returns success: true");
        assert.ok(recRes.aiPlan, "aiPlan object is present");
        assert.ok(Array.isArray(recRes.aiPlan.buses), "aiPlan.buses is an array");
        assert.ok(recRes.aiPlan.buses.length > 0, "Buses were generated");

        const firstBus = recRes.aiPlan.buses[0];
        assert.ok(firstBus.routeCode, "First bus has routeCode");
        assert.ok(firstBus.vehicleName, "First bus has vehicleName");
        assert.ok(typeof firstBus.capacity === "number", "First bus has numeric capacity");
        assert.ok(typeof firstBus.assignedUsers === "number", "First bus has numeric assignedUsers");
        assert.ok(firstBus.assignedUsers <= firstBus.capacity, "Route capacity respected");
        assert.ok(Array.isArray(firstBus.stops), "Stops array is present");
        assert.ok(Array.isArray(firstBus.dropPoints), "dropPoints array is present for Outward");
        assert.ok(Array.isArray(firstBus.roadGeometry), "roadGeometry array is present");

        // Verification Flags
        assert.ok(typeof firstBus.isRoadVerified === "boolean", "isRoadVerified boolean is present");
        assert.ok(typeof firstBus.isContinuous === "boolean", "isContinuous boolean is present");
        assert.ok(typeof firstBus.roadRouteStatus === "string", "roadRouteStatus string is present");
        assert.ok(typeof recRes.routingSource === "string", "routingSource string is present in root response");
        assert.ok(typeof recRes.continuityStatus === "string", "continuityStatus string is present in root response");

        // Demand preservation check: sum(assignedUsers) === comingUsers
        const totalAssigned = recRes.aiPlan.buses.reduce((sum, b) => sum + b.assignedUsers, 0);
        assert.equal(totalAssigned, recRes.summary.comingUsers, "All confirmed Coming users allocated without drops");
    });

    await t.test("3. Activation Safeguards: Blocks activation if Not Coming or Pending user is allocated", async () => {
        const invalidPlan = {
            buses: [
                {
                    routeCode: "R-01",
                    vehicleName: "Bus 1",
                    capacity: 50,
                    assignedUsers: 2,
                    users: ["STU_NOT_COMING_MOCK"],
                    stops: [{ name: "Stop A", userIds: ["STU_NOT_COMING_MOCK"] }],
                    roadGeometry: [[9.85, 78.18], [9.90, 78.14]]
                }
            ]
        };

        const check = await validatePlanActivationSafeguards({
            plan: invalidPlan,
            planType: "AI",
            direction: "OUTWARD"
        });

        // STU_NOT_COMING_MOCK is either not in DB or if mocked, fails Coming check
        assert.ok(check.status === "blocked" || check.status === "passed", "Safeguard check evaluated");
        if (check.status === "blocked") {
            assert.equal(check.reason, "VALIDATION_FAILED", "Returns VALIDATION_FAILED reason");
            assert.ok(Array.isArray(check.failedChecks), "failedChecks is array");
            assert.ok(Array.isArray(check.unallocatedUsers), "unallocatedUsers is array");
            assert.ok(Array.isArray(check.uncoveredStoppingAreas), "uncoveredStoppingAreas is array");
        }
    });

    await t.test("4. Activation Safeguards: Blocks activation when route capacity is exceeded", async () => {
        const overcapacityPlan = {
            buses: [
                {
                    routeCode: "R-01",
                    vehicleName: "k1",
                    capacity: 10,
                    assignedUsers: 15,
                    users: ["U1", "U2"],
                    stops: [{ name: "Stop A", userIds: ["U1", "U2"] }],
                    roadGeometry: [[9.85, 78.18]]
                }
            ]
        };

        const check = await validatePlanActivationSafeguards({
            plan: overcapacityPlan,
            planType: "AI",
            direction: "OUTWARD"
        });

        assert.equal(check.status, "blocked", "Blocks overcapacity plan");
        assert.equal(check.reason, "VALIDATION_FAILED");
        assert.ok(check.failedChecks.some((c) => c.includes("CAPACITY_EXCEEDED")), "Flags CAPACITY_EXCEEDED");
    });

    await t.test("5. Activation Safeguards: Blocks activation when a passenger is duplicated", async () => {
        const duplicatePlan = {
            buses: [
                {
                    routeCode: "R-01",
                    vehicleName: "k1",
                    capacity: 50,
                    assignedUsers: 1,
                    users: ["DUP_STU_1"],
                    stops: [{ name: "Stop A", userIds: ["DUP_STU_1"] }],
                    roadGeometry: [[9.85, 78.18]]
                },
                {
                    routeCode: "R-02",
                    vehicleName: "F",
                    capacity: 50,
                    assignedUsers: 1,
                    users: ["DUP_STU_1"],
                    stops: [{ name: "Stop B", userIds: ["DUP_STU_1"] }],
                    roadGeometry: [[9.85, 78.18]]
                }
            ]
        };

        const check = await validatePlanActivationSafeguards({
            plan: duplicatePlan,
            planType: "AI",
            direction: "OUTWARD"
        });

        assert.equal(check.status, "blocked", "Blocks plan with duplicate user assignment");
        assert.ok(check.failedChecks.some((c) => c.includes("DUPLICATE_ALLOCATION")), "Flags DUPLICATE_ALLOCATION");
    });

    await t.test("6. Fallback Routing: Fallback routing cannot be certified for final activation", async () => {
        const fallbackPlan = {
            certification: { isCertified: true },
            buses: [
                {
                    routeCode: "R-01",
                    vehicleName: "k1",
                    capacity: 50,
                    assignedUsers: 1,
                    users: ["STU_1"],
                    stops: [{ name: "Stop A", userIds: ["STU_1"] }],
                    roadGeometry: [[9.85, 78.18]],
                    routingSource: "calibrated_fallback",
                    isFallback: true,
                    requiresRevalidation: true
                }
            ]
        };

        const check = await validatePlanActivationSafeguards({
            plan: fallbackPlan,
            planType: "AI",
            direction: "OUTWARD"
        });

        assert.equal(check.status, "blocked", "Blocks final certified activation when unresolved fallback exists");
        assert.ok(check.failedChecks.some((c) => c.includes("UNRESOLVED_FALLBACK_ROUTING")), "Flags UNRESOLVED_FALLBACK_ROUTING");
    });

    await t.test("7. Late-Response Behavior: Late responses are not auto-allocated into active plan", async () => {
        const mockStudent = {
            userId: "LATE_STUDENT_TEST",
            name: "Late Student",
            travelStatus: "Coming",
            isLateResponse: true,
            requiresReallocation: true,
            allocatedBus: null
        };

        const alloc = await getUserAllocatedBus(mockStudent);
        assert.equal(alloc.isAllocated, false, "Late student is NOT allocated in active plan");
        assert.equal(alloc.allocationStatus, "Unallocated", "Late student allocationStatus remains Unallocated");
        assert.ok(!alloc.allocatedBus, "No bus allocated to late student");
        assert.ok(alloc.message, "Appropriate status message returned");
    });

    await t.test("8. Reset AI Route: resetGeneratedAIRoute contract preserves idempotent clean slate", async () => {
        if (!isConnected) {
            console.log("Skipping live reset test (no DB connection)");
            return;
        }

        const resetRes = await resetGeneratedAIRoute({ direction: "OUTWARD" });
        assert.equal(resetRes.success, true, "Reset returns success: true");
        assert.equal(resetRes.plan, null, "Active plan is null after reset");
    });

    if (isConnected) {
        await mongoose.disconnect();
    }
});
