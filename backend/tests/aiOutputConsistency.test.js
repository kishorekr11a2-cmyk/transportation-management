import test from "node:test";
import assert from "node:assert/strict";
import {
    buildAIPlan,
    generateAgentRecommendations,
    getActiveAIPlan,
    resetGeneratedAIRoute
} from "../services/aiAgentService.js";
import AiPlan from "../models/AiPlan.js";
import User from "../models/User.js";
import LateResponseEvent from "../models/LateResponseEvent.js";
import mongoose from "mongoose";

test("AI Transportation Engine Output Consistency & Persistence Suite", async (t) => {

    // =========================================================================
    // 1. Fleet Capacity & Math Invariants
    // =========================================================================
    await t.test("1. Fleet Capacity never shows 0 when vehicles have capacity", async () => {
        const vehicles = [
            { _id: "bus_1", vehicleName: "Fleet Bus 1", capacity: 40 },
            { _id: "bus_2", vehicleName: "Fleet Bus 2", capacity: 30 },
            { _id: "bus_3", vehicleName: "Fleet Bus 3", capacity: 50 }
        ];

        const stops = [
            { name: "Alpha Stop", userCount: 25, latitude: 12.9716, longitude: 77.5946 },
            { name: "Beta Stop", userCount: 20, latitude: 12.9750, longitude: 77.6000 }
        ];

        const plan = await buildAIPlan({
            sourceHub: { name: "Central Terminal", latitude: 12.9600, longitude: 77.5800 },
            tripMode: "FROM_SOURCE", // OUTWARD
            resolvedStops: stops,
            availableVehicles: vehicles,
            rawVehicles: vehicles,
            totalComingUsers: 45,
            allUsersCount: 45
        });

        // Assert fleet capacity is 120 (40+30+50), never 0
        assert.ok(plan.totalFleetCapacity > 0, "totalFleetCapacity must be > 0");
        assert.equal(plan.totalFleetCapacity, 120, "Total fleet capacity matches sum of all vehicles");
        assert.equal(plan.availableTotalCapacity, 120, "availableTotalCapacity matches total fleet capacity");

        // Assert passenger assignment invariants
        assert.equal(plan.assignedUsers + plan.unassignedUsers, 45, "assigned + unassigned must equal totalComingUsers");
        assert.equal(plan.assignedUsers, 45, "All 45 users allocated");
        assert.equal(plan.unassignedUsers, 0, "0 unassigned users");

        // Assert vehicle allocation and seat capacity math
        const allocatedBusesCount = plan.allocatedBusesCount || plan.routes.length;
        assert.ok(allocatedBusesCount > 0, "At least one bus allocated");
        assert.ok(plan.allocatedSeatCapacity >= plan.assignedUsers, "Allocated seat capacity >= assigned users");
        assert.equal(
            plan.assignedUsers + plan.unusedSeats,
            plan.allocatedSeatCapacity,
            "Occupied seats + unused seats must equal allocated seat capacity"
        );
    });

    // =========================================================================
    // 2. Direction Consistency: OUTWARD vs INWARD terminology & stop arrays
    // =========================================================================
    await t.test("2. Direction Consistency: OUTWARD (dropPoints) vs INWARD (pickupPoints)", async () => {
        const vehicles = [
            { _id: "bus_out", vehicleName: "Outward Coach", capacity: 50 },
            { _id: "bus_in", vehicleName: "Inward Coach", capacity: 50 }
        ];

        const stops = [
            { name: "Residential North", userCount: 15, latitude: 13.0827, longitude: 80.2707 },
            { name: "Residential South", userCount: 10, latitude: 13.0500, longitude: 80.2500 }
        ];

        // OUTWARD Plan
        const outwardPlan = await buildAIPlan({
            sourceHub: { name: "Main Campus Hub", latitude: 13.0000, longitude: 80.2000 },
            tripMode: "FROM_SOURCE", // OUTWARD
            resolvedStops: stops,
            availableVehicles: [vehicles[0]],
            rawVehicles: [vehicles[0]],
            totalComingUsers: 25,
            allUsersCount: 25
        });

        assert.equal(outwardPlan.routes.length, 1);
        const outRoute = outwardPlan.routes[0];
        assert.ok(Array.isArray(outRoute.dropPoints), "OUTWARD route must have dropPoints array");
        assert.ok(outRoute.dropPoints.length > 0, "OUTWARD route dropPoints must not be empty");
        assert.equal(outRoute.direction, "OUTWARD", "Route direction is OUTWARD");

        // INWARD Plan
        const inwardPlan = await buildAIPlan({
            destinationHub: { name: "Main Campus Hub", latitude: 13.0000, longitude: 80.2000 },
            tripMode: "TO_DESTINATION", // INWARD
            resolvedStops: stops,
            availableVehicles: [vehicles[1]],
            rawVehicles: [vehicles[1]],
            totalComingUsers: 25,
            allUsersCount: 25
        });

        assert.equal(inwardPlan.routes.length, 1);
        const inRoute = inwardPlan.routes[0];
        assert.ok(Array.isArray(inRoute.pickupPoints), "INWARD route must have pickupPoints array");
        assert.ok(inRoute.pickupPoints.length > 0, "INWARD route pickupPoints must not be empty");
        assert.equal(inRoute.direction, "INWARD", "Route direction is INWARD");
    });

    // =========================================================================
    // 3. Zero-Passenger Stop Removal & Count Recalculation
    // =========================================================================
    await t.test("3. Zero-Passenger Stops are filtered out and uniqueStoppingAreas is recomputed", async () => {
        const vehicles = [
            { _id: "bus_filter", vehicleName: "Filter Bus", capacity: 50 }
        ];

        const stopsWithZeroDemand = [
            { name: "Active Stop A", userCount: 20, latitude: 12.9716, longitude: 77.5946 },
            { name: "Empty Ghost Stop", userCount: 0, latitude: 12.9730, longitude: 77.5960 },
            { name: "Active Stop B", userCount: 15, latitude: 12.9750, longitude: 77.6000 }
        ];

        const plan = await buildAIPlan({
            destinationHub: { name: "Tech Park", latitude: 12.9352, longitude: 77.6245 },
            tripMode: "TO_DESTINATION",
            resolvedStops: stopsWithZeroDemand,
            availableVehicles: vehicles,
            rawVehicles: vehicles,
            totalComingUsers: 35,
            allUsersCount: 35
        });

        const route = plan.routes[0];
        const stopNames = route.stops.map(s => s.name);
        assert.ok(!stopNames.includes("Empty Ghost Stop"), "Empty Ghost Stop with 0 users must be removed");
        assert.equal(route.stops.length, 2, "Only the 2 active stops should be in route.stops");

        // uniqueStoppingAreas must match active stops served
        assert.equal(plan.uniqueStoppingAreas, 2, "uniqueStoppingAreas must be 2, ignoring 0-passenger stops");
        assert.equal(plan.routeStopVisitCount, 2, "routeStopVisitCount must be 2");
    });

    // =========================================================================
    // 4. OSRM Road Validation Wording Contract
    // =========================================================================
    await t.test("4. OSRM Road Validation Wording: Verified vs Fallback", async () => {
        // High detour / invalid corridor should trigger fallback wording
        const disconnectedStops = [
            { name: "City West", userCount: 10, latitude: 9.9500, longitude: 78.0870 },
            { name: "Far East Stop", userCount: 10, latitude: 10.0300, longitude: 78.3300 }
        ];
        const vehicles = [{ _id: "bus_val", vehicleName: "Test Bus", capacity: 40 }];

        const plan = await buildAIPlan({
            sourceHub: { name: "Central", latitude: 9.8365, longitude: 78.1619 },
            tripMode: "FROM_SOURCE",
            resolvedStops: disconnectedStops,
            availableVehicles: vehicles,
            rawVehicles: vehicles,
            totalComingUsers: 20,
            allUsersCount: 20
        });

        const route = plan.routes[0];
        assert.ok(route.roadValidationStatus, "Route must have roadValidationStatus string");

        // If continuous road progression could not be validated or fallback was used,
        // it must NEVER claim "Continuous OSRM road progression verified"
        if (route.roadValidationStatus.includes("fallback") || route.roadValidationStatus.includes("unavailable")) {
            assert.equal(
                route.roadValidationStatus,
                "Road validation unavailable — fallback estimate used",
                "Fallback status wording must strictly match specification"
            );
            assert.notEqual(
                route.roadValidationStatus,
                "Continuous OSRM road progression verified",
                "Must never claim verified when fallback is used"
            );
        } else {
            assert.equal(
                route.roadValidationStatus,
                "Continuous OSRM road progression verified",
                "Verified status wording must strictly match specification"
            );
        }
    });

    // =========================================================================
    // 5. Plan Separation: manualPlan must be null in AI recommendations
    // =========================================================================
    await t.test("5. Plan Separation: manualPlan is strictly null in AI recommendations", async () => {
        const vehicles = [{ _id: "bus_sep", vehicleName: "Sep Bus", capacity: 40 }];
        const stops = [{ name: "Stop 1", userCount: 15, latitude: 12.9716, longitude: 77.5946 }];

        const plan = await buildAIPlan({
            sourceHub: { name: "Hub", latitude: 12.9600, longitude: 77.5800 },
            tripMode: "FROM_SOURCE",
            resolvedStops: stops,
            availableVehicles: vehicles,
            rawVehicles: vehicles,
            totalComingUsers: 15,
            allUsersCount: 15
        });

        assert.equal(plan.manualPlan, null, "manualPlan must be null inside buildAIPlan result");
    });

    // =========================================================================
    // 6. Reset Persistence Contract: Reset wipes AI plan and returns plan: null
    // =========================================================================
    await t.test("6. Reset Contract: resetGeneratedAIRoute wipes AI plans and returns plan: null", async () => {
        // Save original connection & model methods
        const originalReadyState = mongoose.connection.readyState;
        const originalDb = mongoose.connection.db;
        const originalAiPlanUpdateMany = AiPlan.updateMany;
        const originalAiPlanFindOne = AiPlan.findOne;
        const originalUserUpdateMany = User.updateMany;
        const originalUserCountDocuments = User.countDocuments;
        const originalLreUpdateMany = LateResponseEvent.updateMany;

        try {
            // Mock connection state
            Object.defineProperty(mongoose.connection, "readyState", { value: 1, configurable: true });
            mongoose.connection.db = {
                collection: (colName) => ({
                    updateMany: async () => ({ modifiedCount: 1 }),
                    findOne: async () => null,
                    find: () => ({
                        sort: () => ({
                            limit: () => ({
                                toArray: async () => []
                            })
                        })
                    })
                })
            };
            AiPlan.updateMany = async () => ({ modifiedCount: 1 });
            AiPlan.findOne = () => ({
                select: () => ({
                    sort: () => ({
                        lean: async () => null
                    })
                }),
                sort: () => ({
                    lean: async () => null
                })
            });
            User.updateMany = async () => ({ modifiedCount: 0 });
            User.countDocuments = async () => 10;
            LateResponseEvent.updateMany = async () => ({ modifiedCount: 0 });

            const resetResult = await resetGeneratedAIRoute({ resetAll: true });
            assert.equal(resetResult.success, true, "Reset should succeed");
            assert.equal(resetResult.plan, null, "resetResult.plan must be null");
            assert.equal(resetResult.inwardPlan, null, "resetResult.inwardPlan must be null");
            assert.equal(resetResult.outwardPlan, null, "resetResult.outwardPlan must be null");

            // getActiveAIPlan with planType: 'AI' must return plan: null
            const activePlanResult = await getActiveAIPlan("INWARD");
            assert.equal(activePlanResult.success, true, "getActiveAIPlan should succeed");
            assert.equal(activePlanResult.plan, null, "getActiveAIPlan plan must be null after reset");
            assert.equal(activePlanResult.inwardPlan, null, "getActiveAIPlan inwardPlan must be null after reset");
            assert.equal(activePlanResult.outwardPlan, null, "getActiveAIPlan outwardPlan must be null after reset");
        } finally {
            // Restore original state
            Object.defineProperty(mongoose.connection, "readyState", { value: originalReadyState, configurable: true });
            mongoose.connection.db = originalDb;
            AiPlan.updateMany = originalAiPlanUpdateMany;
            AiPlan.findOne = originalAiPlanFindOne;
            User.updateMany = originalUserUpdateMany;
            User.countDocuments = originalUserCountDocuments;
            LateResponseEvent.updateMany = originalLreUpdateMany;
        }
    });
});
