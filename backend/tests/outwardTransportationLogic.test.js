import test from "node:test";
import assert from "node:assert/strict";
import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";

import {
    buildGlobalOptimizationMatrix,
    optimizeOutwardRouteAllocation,
    executeGlobalRouteOptimization
} from "../services/routeOptimizationService.js";

import {
    isStopNearOrAlongRoute,
    validateTransportationPlan,
    resetGeneratedAIRoute
} from "../services/aiAgentService.js";

import User from "../models/User.js";
import AiPlan from "../models/AiPlan.js";

const collegeDepot = {
    name: "Engineering College Main Campus",
    latitude: 9.8515,
    longitude: 78.1882
};

test("OUTWARD TRANSPORTATION LOGIC - COMPREHENSIVE SUITE", async (suite) => {

    await suite.test("Scenario 1: Normal demand - zero standing, zero unallocated, valid College -> Stop progression", async () => {
        const stops = [
            {
                name: "Residential Colony A",
                latitude: 9.9100,
                longitude: 78.1400,
                userCount: 15,
                userIds: Array.from({ length: 15 }, (_, i) => `s1_a_${i}`)
            },
            {
                name: "Residential Colony B",
                latitude: 9.9250,
                longitude: 78.1550,
                userCount: 20,
                userIds: Array.from({ length: 20 }, (_, i) => `s1_b_${i}`)
            },
            {
                name: "Residential Colony C",
                latitude: 9.9400,
                longitude: 78.1700,
                userCount: 15,
                userIds: Array.from({ length: 15 }, (_, i) => `s1_c_${i}`)
            }
        ];

        const matrix = await buildGlobalOptimizationMatrix({ depot: collegeDepot, stops });
        const availableVehicles = [
            { _id: "veh_1", vehicleId: "veh_1", vehicleName: "Bus Outward 1", capacity: 60 }
        ];

        const result = await optimizeOutwardRouteAllocation({
            depot: collegeDepot,
            stops,
            availableVehicles,
            matrix,
            tripMode: "FROM_SOURCE"
        });

        const routes = result.routes || result.optimizedRoutes || [];
        assert.ok(routes.length >= 1, "Should generate outward routes");
        const busRoute = routes[0];

        // Total demand = 50 <= 60 capacity
        assert.equal(busRoute.assignedUsers, 50, "All 50 students should be assigned");
        assert.equal(busRoute.standingPassengers, 0, "No standing passengers under normal demand");
        assert.equal(busRoute.isOverCapacity, false, "Should not be marked over capacity");
        assert.equal(result.unallocatedCount, 0, "Zero unallocated students");

        // Progressive drop-off check: starts at college, drops off at each stop
        assert.ok(busRoute.stops.length === 3, "All 3 stops included");
        let remaining = busRoute.assignedUsers;
        for (const stop of busRoute.stops) {
            remaining -= (stop.userCount || 0);
            assert.ok(remaining >= 0, "Remaining passengers cannot be negative during drop-offs");
        }
        assert.equal(remaining, 0, "At the final stop, 0 passengers should remain on the bus");
    });

    await suite.test("Scenario 2: Multi-bus route sharing - shared corridor stops across buses", async () => {
        // High demand along common spine: Colony A (35 pax), Colony B (30 pax), Branch C (15 pax), Branch D (15 pax)
        // Total demand = 95 pax. Vehicles: 2 buses of capacity 50 each (total 100).
        const stops = [
            {
                name: "Common Corridor Stop A",
                latitude: 9.9100,
                longitude: 78.1400,
                userCount: 35,
                userIds: Array.from({ length: 35 }, (_, i) => `s2_a_${i}`)
            },
            {
                name: "Common Corridor Stop B",
                latitude: 9.9200,
                longitude: 78.1450,
                userCount: 30,
                userIds: Array.from({ length: 30 }, (_, i) => `s2_b_${i}`)
            },
            {
                name: "Spur Dropoff C",
                latitude: 9.9350,
                longitude: 78.1500,
                userCount: 15,
                userIds: Array.from({ length: 15 }, (_, i) => `s2_c_${i}`)
            },
            {
                name: "Spur Dropoff D",
                latitude: 9.9360,
                longitude: 78.1520,
                userCount: 15,
                userIds: Array.from({ length: 15 }, (_, i) => `s2_d_${i}`)
            }
        ];

        const matrix = await buildGlobalOptimizationMatrix({ depot: collegeDepot, stops });
        const availableVehicles = [
            { _id: "veh_share_1", vehicleId: "veh_share_1", vehicleName: "Bus K1", capacity: 50 },
            { _id: "veh_share_2", vehicleId: "veh_share_2", vehicleName: "Bus K2", capacity: 50 }
        ];

        const result = await optimizeOutwardRouteAllocation({
            depot: collegeDepot,
            stops,
            availableVehicles,
            matrix,
            tripMode: "FROM_SOURCE"
        });

        const routes = result.routes || result.optimizedRoutes || [];
        assert.equal(routes.length, 2, "Both buses should be utilized for 95 passengers");
        const totalAssigned = routes.reduce((sum, r) => sum + r.assignedUsers, 0);
        assert.equal(totalAssigned, 95, "All 95 passengers served across the 2 shared corridor buses");
        assert.equal(result.unallocatedCount, 0, "No unallocated passengers");

        // Both buses originate from College
        for (const route of routes) {
            assert.ok(route.assignedUsers <= route.capacity, "Each bus should respect its capacity limit");
        }
    });

    await suite.test("Scenario 3: Full bus + suitable alternative - stop reassigned to compatible bus along route", async () => {
        // Corridor: Stop 1 (40 pax), Stop 2 (10 pax), Stop 3 (10 pax).
        // Bus 1 (cap 45) can take Stop 1 (40 pax), but adding Stop 2 (10 pax) exceeds capacity (50 > 45).
        // Bus 2 (cap 45) is heading to nearby Stop 3 and can naturally accommodate Stop 2.
        const stop1 = { name: "Corridor Stop 1", latitude: 9.9100, longitude: 78.1400, userCount: 40, userIds: Array.from({ length: 40 }, (_, i) => `s3_1_${i}`) };
        const stop2 = { name: "Corridor Stop 2", latitude: 9.9180, longitude: 78.1450, userCount: 10, userIds: Array.from({ length: 10 }, (_, i) => `s3_2_${i}`) };
        const stop3 = { name: "Corridor Stop 3", latitude: 9.9250, longitude: 78.1500, userCount: 10, userIds: Array.from({ length: 10 }, (_, i) => `s3_3_${i}`) };

        const stops = [stop1, stop2, stop3];
        const matrix = await buildGlobalOptimizationMatrix({ depot: collegeDepot, stops });

        const availableVehicles = [
            { _id: "veh_s3_1", vehicleId: "veh_s3_1", vehicleName: "Bus Alpha", capacity: 45 },
            { _id: "veh_s3_2", vehicleId: "veh_s3_2", vehicleName: "Bus Beta", capacity: 45 }
        ];

        const result = await optimizeOutwardRouteAllocation({
            depot: collegeDepot,
            stops,
            availableVehicles,
            matrix,
            tripMode: "FROM_SOURCE"
        });

        const routes = result.routes || result.optimizedRoutes || [];
        // Verify that Stop 2 was served by compatible Bus Beta rather than standing or leaving unallocated
        const totalAssigned = routes.reduce((sum, r) => sum + r.assignedUsers, 0);
        assert.equal(totalAssigned, 60, "All 60 passengers allocated");
        const totalStanding = routes.reduce((sum, r) => sum + (r.standingPassengers || 0), 0);
        assert.equal(totalStanding, 0, "No standing passengers since Bus Beta had spare capacity along compatible route");
    });

    await suite.test("Scenario 4: Full bus + unsuitable alternative - distant bus with spare capacity rejected", async () => {
        // Bus East route is along latitude 9.91, longitude 78.25 (Far East, ~15km away)
        const eastRoute = [
            { name: "East Stop 1", latitude: 9.9100, longitude: 78.2500 },
            { name: "East Stop 2", latitude: 9.9200, longitude: 78.2600 }
        ];

        // North Stop is at latitude 10.05, longitude 78.10 (Far North-West)
        const northStop = { name: "Distant North Stop", latitude: 10.0500, longitude: 78.1000 };

        const suitability = isStopNearOrAlongRoute(northStop, eastRoute);
        assert.equal(suitability.suitable, false, "Distant stop must NOT be suitable for East bus despite spare capacity");
        assert.ok(suitability.detourKm > 5.0 || suitability.reason?.includes("detour"), "Rejection must cite detour limit or corridor mismatch");
    });

    await suite.test("Scenario 5: No suitable alternative - standing passengers fallback (e.g. 75/70 with 5 standing)", async () => {
        // Single isolated corridor stop with 55 students. Bus capacity is 50.
        // Second bus exists, but its route is 25 km away in a different sector.
        const isolatedCorridorStop = {
            name: "Isolated Sector Stop",
            latitude: 9.9800,
            longitude: 78.0500,
            userCount: 55,
            userIds: Array.from({ length: 55 }, (_, i) => `s5_iso_${i}`)
        };

        const distantStop = {
            name: "Far East Sector Stop",
            latitude: 9.9100,
            longitude: 78.3000,
            userCount: 5,
            userIds: Array.from({ length: 5 }, (_, i) => `s5_east_${i}`)
        };

        const stops = [isolatedCorridorStop, distantStop];
        const matrix = await buildGlobalOptimizationMatrix({ depot: collegeDepot, stops });

        const availableVehicles = [
            { _id: "veh_s5_1", vehicleId: "veh_s5_1", vehicleName: "Bus Isolated Sector", capacity: 50 },
            { _id: "veh_s5_2", vehicleId: "veh_s5_2", vehicleName: "Bus Far East", capacity: 50 }
        ];

        const result = await optimizeOutwardRouteAllocation({
            depot: collegeDepot,
            stops,
            availableVehicles,
            matrix,
            tripMode: "FROM_SOURCE"
        });

        const routes = result.routes || result.optimizedRoutes || [];
        // The isolated bus must retain the 5 extra passengers as standing rather than assigning them to the far bus
        const isoRoute = routes.find(r =>
            r.stops.some(s => s.name === "Isolated Sector Stop")
        );

        assert.ok(isoRoute, "Isolated sector route must exist");
        assert.equal(isoRoute.assignedUsers, 55, "All 55 students must be assigned to the isolated route");
        assert.equal(isoRoute.seatedPassengers, 50, "50 seated passengers");
        assert.equal(isoRoute.standingPassengers, 5, "5 standing passengers");
        assert.equal(isoRoute.isOverCapacity, true, "Marked as over capacity");
        assert.equal(isoRoute.overCapacityCount, 5, "Over-capacity count matches 5");
        assert.equal(result.unallocatedCount, 0, "No students left unallocated");

        // The distant bus must NOT serve the isolated sector stop
        const eastRoute = routes.find(r =>
            r.stops.some(s => s.name === "Far East Sector Stop")
        );
        assert.ok(eastRoute, "East route must exist");
        assert.equal(eastRoute.assignedUsers, 5, "East bus only serves its own 5 passengers");
        assert.ok(!eastRoute.stops.some(s => s.name === "Isolated Sector Stop"), "East bus did NOT pick up distant stop");
    });

    await suite.test("Scenario 6: validateTransportationPlan permits authorized standing passengers", async () => {
        const planWithStanding = {
            buses: [
                {
                    busId: "BUS_1",
                    vehicleName: "Bus 1",
                    capacity: 50,
                    assignedUsers: 55,
                    seatedPassengers: 50,
                    standingPassengers: 5,
                    isOverCapacity: true,
                    stops: [{ stopName: "Stop 1", userCount: 55 }]
                }
            ]
        };

        const validation = validateTransportationPlan(planWithStanding);
        assert.equal(validation.checks.capacitiesNotExceeded, true, "Plan with authorized standing passengers should pass capacity check");

        const planExceedingStanding = {
            buses: [
                {
                    busId: "BUS_2",
                    vehicleName: "Bus 2",
                    capacity: 50,
                    assignedUsers: 60,
                    seatedPassengers: 50,
                    standingPassengers: 5, // Capacity 50 + standing 5 = 55 < 60 assigned!
                    isOverCapacity: true,
                    stops: [{ stopName: "Stop 2", userCount: 60 }]
                }
            ]
        };

        const failedValidation = validateTransportationPlan(planExceedingStanding);
        assert.equal(failedValidation.checks.capacitiesNotExceeded, false, "Plan exceeding standing allowance must fail capacity check");
    });

    await suite.test("Scenario 7: Reset Outward resets Outward allocations without affecting Inward", async () => {
        const mongoUri = process.env.MONGO_URI;
        if (mongoose.connection.readyState === 0 && mongoUri) {
            try {
                await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
            } catch (e) {
                console.warn("MongoDB connection warning:", e.message);
            }
        }

        if (mongoose.connection.readyState !== 1) {
            console.log("Database not available, skipping DB reset test");
            return;
        }

        const runId = `OUT_RST_${Date.now()}`;
        const inwardPlan = await AiPlan.create({
            planType: "AI",
            direction: "INWARD",
            tripMode: "TO_DESTINATION",
            active: true,
            status: "active",
            isApproved: true,
            destination: collegeDepot,
            aiPlan: {
                direction: "INWARD",
                tripMode: "TO_DESTINATION",
                buses: [{ busId: "BUS_IN_1", vehicleName: "Inward Bus 1", assignedUsers: 10, stops: [] }]
            }
        });

        const outwardPlan = await AiPlan.create({
            planType: "AI",
            direction: "OUTWARD",
            tripMode: "FROM_SOURCE",
            active: true,
            status: "active",
            isApproved: true,
            source: collegeDepot,
            aiPlan: {
                direction: "OUTWARD",
                tripMode: "FROM_SOURCE",
                buses: [{ busId: "BUS_OUT_1", vehicleName: "Outward Bus 1", assignedUsers: 10, stops: [] }]
            }
        });

        const student = await User.create({
            userId: `${runId}_STU`,
            name: "Dual Direction Student",
            email: `${runId}@test.com`,
            role: "student",
            travelStatus: "Coming",
            allocatedBus: {
                isAllocated: true,
                direction: "BOTH",
                inward: { isAllocated: true, vehicleName: "Inward Bus 1", busId: "BUS_IN_1" },
                outward: { isAllocated: true, vehicleName: "Outward Bus 1", busId: "BUS_OUT_1" }
            }
        });

        // Reset OUTWARD route
        const resetResult = await resetGeneratedAIRoute({
            direction: "OUTWARD",
            tripMode: "FROM_SOURCE"
        });

        assert.equal(resetResult.success, true, "Outward reset should succeed");

        // Verify outward plan is inactive
        const checkOutwardPlan = await AiPlan.findById(outwardPlan._id);
        assert.equal(checkOutwardPlan.active, false, "Outward plan should be deactivated");

        // Verify inward plan is STILL ACTIVE
        const checkInwardPlan = await AiPlan.findById(inwardPlan._id);
        assert.equal(checkInwardPlan.active, true, "Inward plan MUST remain active");

        // Verify student outward allocation is cleared, inward allocation preserved
        const checkStudent = await User.findById(student._id);
        const outwardAllocated = checkStudent.allocatedBus?.outward?.isAllocated;
        assert.ok(!outwardAllocated, "Student outward allocation cleared");
        assert.equal(checkStudent.allocatedBus.inward?.isAllocated, true, "Student inward allocation strictly preserved");

        // Cleanup
        await AiPlan.deleteMany({ _id: { $in: [inwardPlan._id, outwardPlan._id] } });
        await User.deleteOne({ _id: student._id });

        // Close DB connection so process exits cleanly
        if (mongoose.connection.readyState === 1) {
            await mongoose.connection.close();
        }
    });

    await suite.test("Scenario 8: Inward regression check - executeGlobalRouteOptimization preserves Inward pipeline", async () => {
        const inwardStops = [
            {
                name: "Inward Pickup Stop 1",
                latitude: 9.9100,
                longitude: 78.1400,
                userCount: 15,
                userIds: Array.from({ length: 15 }, (_, i) => `u_in1_${i}`)
            },
            {
                name: "Inward Pickup Stop 2",
                latitude: 9.9200,
                longitude: 78.1500,
                userCount: 20,
                userIds: Array.from({ length: 20 }, (_, i) => `u_in2_${i}`)
            }
        ];

        const matrix = await buildGlobalOptimizationMatrix({ depot: collegeDepot, stops: inwardStops });
        const availableVehicles = [
            { _id: "veh_in_1", vehicleId: "veh_in_1", vehicleName: "Inward Bus 1", capacity: 50 }
        ];

        // Execute Inward optimization
        const inwardResult = await executeGlobalRouteOptimization({
            depot: collegeDepot,
            stops: inwardStops,
            availableVehicles,
            matrix,
            tripMode: "TO_DESTINATION" // Inward
        });

        const routes = inwardResult.routes || inwardResult.optimizedRoutes || [];
        assert.ok(routes.length > 0, "Inward routes generated successfully");
        assert.equal(routes[0].assignedUsers, 35, "Inward assigned passengers preserved");
        assert.equal(inwardResult.unallocatedCount, 0, "Inward stops fully allocated");
    });
});
