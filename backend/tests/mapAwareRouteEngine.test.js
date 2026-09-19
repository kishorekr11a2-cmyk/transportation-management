import { test, describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    planMapAwareTransportationRoutes,
    groupStopsIntoRoadCorridors,
    optimizeCorridorStopOrder,
    assignVehiclesToCorridors,
    validateTransportationPlanLogistics
} from "../services/mapAwareRouteEngine.js";
import { clearRoutingCaches } from "../services/roadMatrixService.js";
import { clearGeocodingCache, DEFAULT_SOURCE_HUB } from "../services/mapGeocodingService.js";

describe("Stage 3: Map-Aware Route Optimization Engine Suite", () => {
    beforeEach(() => {
        clearRoutingCaches();
        clearGeocodingCache();
    });

    const sourceHub = {
        name: "K. L. N. College of Engineering",
        address: "Pottapalayam, Sivagangai / Madurai, Tamil Nadu, India",
        latitude: 9.8324,
        longitude: 78.1884
    };

    // Sample stopping areas representing Madurai corridors
    const sampleStops = [
        { name: "Avaniyapuram", latitude: 9.8780, longitude: 78.1240 },
        { name: "Villapuram", latitude: 9.8950, longitude: 78.1320 },
        { name: "Palanganatham", latitude: 9.9050, longitude: 78.0980 },
        { name: "Thiruparankundram", latitude: 9.8820, longitude: 78.0720 },
        { name: "Anna Nagar", latitude: 9.9180, longitude: 78.1467 },
        { name: "KK Nagar", latitude: 9.9270, longitude: 78.1510 },
        { name: "Mattuthavani", latitude: 9.9450, longitude: 78.1580 },
        { name: "Goripalayam", latitude: 9.9315, longitude: 78.1275 },
        { name: "Tallakulam", latitude: 9.9360, longitude: 78.1350 }
    ];

    it("1. Filters users strictly by travelStatus: Coming only, excludes Not Coming and Pending", async () => {
        const users = [
            { userId: "u1", name: "Alice", stoppings: "Anna Nagar", travelStatus: "Coming" },
            { userId: "u2", name: "Bob", stoppings: "Anna Nagar", travelStatus: "Not Coming" },
            { userId: "u3", name: "Charlie", stoppings: "KK Nagar", travelStatus: "Pending" },
            { userId: "u4", name: "David", stoppings: "KK Nagar", travelStatus: "Coming" }
        ];

        const vehicles = [
            { _id: "v1", vehicleName: "Bus 1", capacity: 50, status: "Available" }
        ];

        const result = await planMapAwareTransportationRoutes({
            users,
            vehicles,
            source: sourceHub
        });

        assert.equal(result.planSummary.comingUsers, 2, "Only 2 Coming users should be considered");
        assert.equal(result.planSummary.allocatedUsers, 2, "All 2 Coming users must be allocated");

        const allocatedIds = result.routes.flatMap((r) => r.userIds);
        assert.ok(allocatedIds.includes("u1"), "Coming user u1 must be allocated");
        assert.ok(allocatedIds.includes("u4"), "Coming user u4 must be allocated");
        assert.ok(!allocatedIds.includes("u2"), "Not Coming user u2 must NOT be allocated");
        assert.ok(!allocatedIds.includes("u3"), "Pending user u3 must NOT be allocated");
    });

    it("2. Filters vehicles strictly by availability: excludes unavailable vehicles from schedule", async () => {
        const users = [
            { userId: "u1", name: "Alice", stoppings: "Anna Nagar", travelStatus: "Coming" }
        ];

        const vehicles = [
            { _id: "v_avail", vehicleName: "Active Bus", capacity: 40, status: "Available" },
            { _id: "v_maint", vehicleName: "Maintenance Bus", capacity: 40, status: "Maintenance" },
            { _id: "v_sched_unavail", vehicleName: "Scheduled Off Bus", capacity: 40, status: "Available" }
        ];

        const schedules = [
            { vehicle: "v_sched_unavail", availability: "Not Available" }
        ];

        const result = await planMapAwareTransportationRoutes({
            users,
            vehicles,
            schedules,
            source: sourceHub
        });

        assert.equal(result.routes.length, 1);
        assert.equal(result.routes[0].vehicleId, "v_avail", "Only Available vehicle should be assigned");
    });

    it("3. Capacity is never exceeded on any route", async () => {
        // 50 passengers at Anna Nagar, vehicle has 40 seats
        const users = Array.from({ length: 50 }, (_, i) => ({
            userId: `usr_${i + 1}`,
            name: `Student ${i + 1}`,
            stoppings: "Anna Nagar",
            travelStatus: "Coming"
        }));

        const vehicles = [
            { _id: "bus_small1", vehicleName: "Bus A", capacity: 30, status: "Available" },
            { _id: "bus_small2", vehicleName: "Bus B", capacity: 30, status: "Available" }
        ];

        const result = await planMapAwareTransportationRoutes({
            users,
            vehicles,
            source: sourceHub
        });

        assert.equal(result.status, "validated");
        assert.equal(result.planSummary.allocatedUsers, 50);

        result.routes.forEach((r) => {
            assert.ok(r.assignedUsers <= r.capacity, `Route ${r.vehicleName} assigned ${r.assignedUsers} must not exceed capacity ${r.capacity}`);
        });
    });

    it("4. Infeasible plan returns explicit reason when Coming demand exceeds total available capacity", async () => {
        const users = Array.from({ length: 100 }, (_, i) => ({
            userId: `u_${i}`,
            name: `User ${i}`,
            stoppings: "Anna Nagar",
            travelStatus: "Coming"
        }));

        const vehicles = [
            { _id: "bus_tiny", vehicleName: "Van 1", capacity: 30, status: "Available" }
        ];

        const result = await planMapAwareTransportationRoutes({
            users,
            vehicles,
            source: sourceHub
        });

        assert.equal(result.status, "infeasible");
        assert.equal(result.reason, "INSUFFICIENT_CAPACITY");
        assert.equal(result.unallocatedUsers.length, 100);
        assert.equal(result.routes.length, 0);
    });

    it("5. Zero duplicate passenger assignments across any routes (every user allocated exactly once)", async () => {
        const users = Array.from({ length: 60 }, (_, i) => ({
            userId: `unique_${i + 1}`,
            name: `Student ${i + 1}`,
            stoppings: i < 30 ? "Anna Nagar" : "KK Nagar",
            travelStatus: "Coming"
        }));

        const vehicles = [
            { _id: "v1", vehicleName: "Bus 1", capacity: 40, status: "Available" },
            { _id: "v2", vehicleName: "Bus 2", capacity: 40, status: "Available" }
        ];

        const result = await planMapAwareTransportationRoutes({
            users,
            vehicles,
            source: sourceHub
        });

        const allAllocatedIds = result.routes.flatMap((r) => r.userIds);
        const uniqueIds = new Set(allAllocatedIds);

        assert.equal(allAllocatedIds.length, 60, "All 60 users must be allocated");
        assert.equal(uniqueIds.size, 60, "Must contain exactly 60 distinct user IDs with zero duplicates");
    });

    it("6. Phase 1: Corridors group stops by geographic radial coherence from source depot", async () => {
        const resolvedStops = [
            { name: "Avaniyapuram", latitude: 9.8780, longitude: 78.1240, userCount: 15 },
            { name: "Villapuram", latitude: 9.8950, longitude: 78.1320, userCount: 10 },
            { name: "Anna Nagar", latitude: 9.9180, longitude: 78.1467, userCount: 20 },
            { name: "KK Nagar", latitude: 9.9270, longitude: 78.1510, userCount: 15 }
        ];

        const corridors = await groupStopsIntoRoadCorridors(resolvedStops, sourceHub);

        assert.ok(corridors.length >= 1);
        corridors.forEach((corr) => {
            assert.ok(corr.corridorId);
            assert.ok(corr.totalDemand > 0);
            assert.ok(corr.stops.length > 0);
            assert.ok(corr.estimatedRoadDistanceKm > 0);
            assert.ok(corr.estimatedRoadDurationMin > 0);
        });
    });

    it("7. Phase 2: Stop ordering starts from source depot and avoids unnecessary backtracking", async () => {
        const corridorStops = [
            { name: "Far Stop Mattuthavani", latitude: 9.9450, longitude: 78.1580, userCount: 10 },
            { name: "Close Stop Teppakulam", latitude: 9.9140, longitude: 78.1470, userCount: 10 },
            { name: "Mid Stop Anna Nagar", latitude: 9.9180, longitude: 78.1467, userCount: 10 }
        ];

        const optOrder = await optimizeCorridorStopOrder(corridorStops, sourceHub);

        assert.equal(optOrder.orderedStops.length, 3);
        // Outward progression: first stop should be closest to depot (Teppakulam), then Anna Nagar, then Mattuthavani
        assert.equal(optOrder.orderedStops[0].name, "Close Stop Teppakulam");
        assert.equal(optOrder.orderedStops[1].name, "Mid Stop Anna Nagar");
        assert.equal(optOrder.orderedStops[2].name, "Far Stop Mattuthavani");
        assert.ok(optOrder.totalDistanceKm > 0);
        assert.ok(optOrder.totalDurationMin > 0);
        assert.equal(optOrder.continuityStatus, "passed");
    });

    it("8. Route geometry and per-leg metadata truthfully reflect routing source and verification", async () => {
        const users = [
            { userId: "u1", name: "Alice", stoppings: "Anna Nagar", travelStatus: "Coming" },
            { userId: "u2", name: "Bob", stoppings: "KK Nagar", travelStatus: "Coming" }
        ];

        const vehicles = [
            { _id: "bus1", vehicleName: "Bus 1", capacity: 50, status: "Available" }
        ];

        const result = await planMapAwareTransportationRoutes({
            users,
            vehicles,
            source: sourceHub
        });

        assert.equal(result.routes.length, 1);
        const route = result.routes[0];

        assert.ok(Array.isArray(route.geometry));
        assert.ok(["osrm_route", "estimated_straight_line"].includes(route.geometrySource));
        assert.equal(typeof route.geometryVerified, "boolean");
        assert.equal(typeof route.osrmVerified, "boolean");
        assert.equal(typeof route.requiresRevalidation, "boolean");

        // Operational calculations present
        assert.ok(route.distanceKm > 0);
        assert.ok(route.durationMin > 0);
        assert.ok(route.fuelLiters > 0);
        assert.ok(route.emissionsKg > 0);
        assert.ok(route.operationalLogistics);
    });

    it("9. Plan execution is deterministic with identical inputs", async () => {
        const users = [
            { userId: "u1", name: "Alice", stoppings: "Anna Nagar", travelStatus: "Coming" },
            { userId: "u2", name: "Bob", stoppings: "KK Nagar", travelStatus: "Coming" }
        ];

        const vehicles = [
            { _id: "bus1", vehicleName: "Bus 1", capacity: 50, status: "Available" }
        ];

        const res1 = await planMapAwareTransportationRoutes({ users, vehicles, source: sourceHub });
        const res2 = await planMapAwareTransportationRoutes({ users, vehicles, source: sourceHub });

        assert.equal(res1.planSummary.allocatedUsers, res2.planSummary.allocatedUsers);
        assert.equal(res1.routes[0].stopSequence.length, res2.routes[0].stopSequence.length);
        assert.equal(res1.routes[0].stopSequence[0].name, res2.routes[0].stopSequence[0].name);
    });

    it("10. 10-point Logistics Validation accurately catches capacity overruns and flags them", () => {
        const overcapacityRoutes = [
            {
                routeId: "r1",
                vehicleName: "Overload Bus",
                capacity: 30,
                assignedUsers: 45, // Exceeds capacity
                stops: [{ name: "Stop 1", userCount: 45 }],
                userIds: Array.from({ length: 45 }, (_, i) => `p_${i}`)
            }
        ];

        const val = validateTransportationPlanLogistics({
            routes: overcapacityRoutes,
            totalComingUsers: 45,
            sourceStoppingAreasCount: 1,
            availableVehicles: [{ _id: "v1", capacity: 30 }]
        });

        assert.equal(val.continuityStatus, "failed");
        assert.ok(val.failedChecks.some((c) => c.includes("CAPACITY_EXCEEDED")));
        assert.equal(val.checks.capacity, false);
    });
});
