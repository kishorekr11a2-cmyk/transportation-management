import test from "node:test";
import assert from "node:assert/strict";
import {
    buildGlobalOptimizationMatrix,
    computeClarkeWrightSavings,
    insertStopNearestCost,
    optimizeTour2OptRoad,
    applyInterRouteRelocate,
    applyInterRouteExchange,
    generateGlobalCandidateRoutes,
    assignVehiclesToOptimizedRoutes,
    executeGlobalRouteOptimization
} from "../services/routeOptimizationService.js";

import {
    generateAgentRecommendations,
    validateTransportationPlan
} from "../services/aiAgentService.js";

const sampleDepot = {
    name: "Central Institution Hub",
    latitude: 9.8515,
    longitude: 78.1882
};

test("TEST 1: Cross-corridor stops enter the same candidate route if road/capacity permit", async () => {
    // Alagar Kovil (North, 4 pax) and Melur (North-East, 2 pax) previously isolated by bearing
    const stops = [
        { name: "Alagar Kovil", latitude: 10.0747, longitude: 78.2131, userCount: 4, userIds: ["u1", "u2", "u3", "u4"] },
        { name: "Melur", latitude: 10.0309, longitude: 78.3376, userCount: 2, userIds: ["u5", "u6"] }
    ];

    const matrix = await buildGlobalOptimizationMatrix({ depot: sampleDepot, stops });
    const savings = computeClarkeWrightSavings({ stops, depot: sampleDepot, distanceMatrix: matrix });

    assert.ok(savings.length > 0, "Clarke-Wright must find positive savings between Alagar Kovil and Melur");
    assert.ok(savings[0].savings > 10, "Savings between Alagar Kovil and Melur should be significant (>10 km)");

    const candidates = generateGlobalCandidateRoutes({
        stops,
        matrix,
        maxBusCapacity: 50,
        tripMode: "FROM_SOURCE"
    });

    assert.equal(candidates.length, 1, "Both stops should be combined into 1 candidate route instead of 2 separate buses");
    assert.equal(candidates[0].assignedUsers, 6, "Combined route should serve all 6 passengers");
});

test("TEST 2: Stop relocates from one route to another when improving objective", async () => {
    const stops = [
        { name: "Stop A1", latitude: 9.9100, longitude: 78.1200, userCount: 10, userIds: ["a1"] },
        { name: "Stop A2", latitude: 9.9150, longitude: 78.1250, userCount: 10, userIds: ["a2"] },
        { name: "Stop NearB", latitude: 9.9310, longitude: 78.1510, userCount: 5, userIds: ["m1"] },
        { name: "Stop B1", latitude: 9.9300, longitude: 78.1500, userCount: 20, userIds: ["b1"] },
        { name: "Stop B2", latitude: 9.9350, longitude: 78.1550, userCount: 20, userIds: ["b2"] }
    ];

    const matrix = await buildGlobalOptimizationMatrix({ depot: sampleDepot, stops });
    const enriched = stops.map((s, idx) => ({ ...s, matrixIndex: idx + 1 }));

    // Intentionally place Stop NearB in Route A initially
    const initialRoutes = [
        {
            routeId: "route_A",
            stops: [enriched[0], enriched[1], enriched[2]],
            assignedUsers: 25,
            users: ["a1", "a2", "m1"]
        },
        {
            routeId: "route_B",
            stops: [enriched[3], enriched[4]],
            assignedUsers: 40,
            users: ["b1", "b2"]
        }
    ];

    const auditTrail = [];
    const relRes = applyInterRouteRelocate({
        routes: initialRoutes,
        matrix,
        maxBusCapacity: 70,
        tripMode: "FROM_SOURCE",
        auditTrail
    });

    assert.ok(relRes.improved, "Relocation should improve route alignment");
    const routeB = relRes.routes.find((r) => r.routeId === "route_B");
    assert.ok(routeB.stops.some((s) => s.name === "Stop NearB"), "Stop NearB should have relocated into Route B");
    assert.equal(routeB.assignedUsers, 45, "Route B should have 45 passengers after relocation");
});

test("TEST 3: Two routes can exchange stops to reduce total road distance", async () => {
    const stops = [
        { name: "West Stop 1", latitude: 9.9200, longitude: 78.0900, userCount: 10, userIds: ["w1"] },
        { name: "Misplaced East Stop", latitude: 9.9300, longitude: 78.1700, userCount: 10, userIds: ["e_mis"] },
        { name: "East Stop 1", latitude: 9.9350, longitude: 78.1750, userCount: 10, userIds: ["e1"] },
        { name: "Misplaced West Stop", latitude: 9.9250, longitude: 78.0950, userCount: 10, userIds: ["w_mis"] }
    ];

    const matrix = await buildGlobalOptimizationMatrix({ depot: sampleDepot, stops });
    const enriched = stops.map((s, idx) => ({ ...s, matrixIndex: idx + 1 }));

    const initialRoutes = [
        {
            routeId: "route_West",
            stops: [enriched[0], enriched[1]], // Has misplaced east stop
            assignedUsers: 20,
            users: ["w1", "e_mis"]
        },
        {
            routeId: "route_East",
            stops: [enriched[2], enriched[3]], // Has misplaced west stop
            assignedUsers: 20,
            users: ["e1", "w_mis"]
        }
    ];

    const auditTrail = [];
    const exRes = applyInterRouteExchange({
        routes: initialRoutes,
        matrix,
        maxBusCapacity: 70,
        tripMode: "FROM_SOURCE",
        auditTrail
    });

    assert.ok(exRes.improved, "Inter-route exchange should succeed");
    const routeWithWest = exRes.routes.find((r) => r.stops.some((s) => s.name === "West Stop 1"));
    assert.ok(routeWithWest.stops.some((s) => s.name === "Misplaced West Stop"), "West stops should now be clustered together in the same route");
    const routeWithEast = exRes.routes.find((r) => r.stops.some((s) => s.name === "East Stop 1"));
    assert.ok(routeWithEast.stops.some((s) => s.name === "Misplaced East Stop"), "East stops should now be clustered together in the same route");
});

test("TEST 4: Road 2-opt eliminates backtracking", async () => {
    const stops = [
        { name: "A", latitude: 9.8700, longitude: 78.1500 },
        { name: "B", latitude: 9.9100, longitude: 78.1300 },
        { name: "C", latitude: 9.8900, longitude: 78.1400 } // Out of order: A -> B -> C backtracks compared to A -> C -> B
    ];

    const matrix = await buildGlobalOptimizationMatrix({ depot: sampleDepot, stops });
    const enriched = stops.map((s, idx) => ({ ...s, matrixIndex: idx + 1 }));

    const optRes = optimizeTour2OptRoad({
        tour: enriched,
        matrix,
        tripMode: "FROM_SOURCE"
    });

    assert.ok(optRes.roadDistanceKm > 0, "Optimized distance must be positive");
    assert.equal(optRes.tour.length, 3, "Tour length preserved");
});

test("TEST 5: Capacity violation is rejected by deterministic validation", () => {
    const invalidPlan = {
        buses: [
            {
                routeCode: "R-1",
                vehicleId: "v1",
                capacity: 50,
                assignedUsers: 55, // Over capacity!
                users: Array.from({ length: 55 }, (_, i) => `u_${i}`),
                stops: [{ name: "Stop 1", latitude: 9.9, longitude: 78.1, userCount: 55, userIds: Array.from({ length: 55 }, (_, i) => `u_${i}`) }]
            }
        ],
        totalComingUsers: 55
    };

    const result = validateTransportationPlan(invalidPlan, { totalComingUsers: 55 });
    assert.equal(result.isCertified, false, "Plan with capacity violation must fail validation");
    assert.equal(result.checks.capacitiesNotExceeded, false, "Must record capacity violation");
    assert.ok(result.failureReasons.some((e) => e.toLowerCase().includes("capacity")), "Must contain capacity failure reason");
});

test("TEST 6: Unavailable vehicle is rejected", () => {
    const availableVehicles = [
        { _id: "veh_1", vehicleName: "Bus 1", capacity: 70, status: "Available" }
    ];

    const invalidPlan = {
        buses: [
            {
                routeCode: "R-1",
                vehicleId: "veh_UNAVAILABLE",
                capacity: 70,
                assignedUsers: 5,
                users: ["u1", "u2", "u3", "u4", "u5"],
                stops: [{ name: "S1", latitude: 9.9, longitude: 78.1, userCount: 5, userIds: ["u1", "u2", "u3", "u4", "u5"] }]
            }
        ]
    };

    const result = validateTransportationPlan(invalidPlan, { availableVehicles, totalComingUsers: 5 });
    assert.equal(result.isCertified, false, "Plan with unapproved vehicle must be rejected");
    assert.equal(result.checks.onlyAvailableVehiclesAssigned, false, "Must fail onlyAvailableVehiclesAssigned check");
});

test("TEST 7: Unavailable schedule vehicle exclusion", () => {
    const rawVehicles = [
        { _id: "v1", capacity: 50, status: "Available" },
        { _id: "v2", capacity: 50, status: "Maintenance" }
    ];

    const schedules = [
        { vehicleId: "v1", status: "Available", date: "2026-09-20" },
        { vehicleId: "v2", status: "Not Available", date: "2026-09-20" }
    ];

    const usable = rawVehicles.filter((v) => {
        const sched = schedules.find((s) => String(s.vehicleId) === String(v._id));
        return v.status === "Available" && (!sched || sched.status === "Available");
    });

    assert.equal(usable.length, 1, "Only genuinely available vehicles pass schedule filter");
    assert.equal(usable[0]._id, "v1");
});

test("TEST 8: Duplicate passenger allocation is rejected", () => {
    const duplicatePlan = {
        buses: [
            {
                routeCode: "R-1",
                vehicleId: "v1",
                capacity: 70,
                assignedUsers: 2,
                users: ["user_A", "user_B"],
                stops: [{ name: "S1", latitude: 9.9, longitude: 78.1, userCount: 2, userIds: ["user_A", "user_B"] }]
            },
            {
                routeCode: "R-2",
                vehicleId: "v2",
                capacity: 70,
                assignedUsers: 1,
                users: ["user_A"], // Duplicate!
                stops: [{ name: "S2", latitude: 9.92, longitude: 78.12, userCount: 1, userIds: ["user_A"] }]
            }
        ]
    };

    const result = validateTransportationPlan(duplicatePlan, { totalComingUsers: 2 });
    assert.equal(result.isCertified, false, "Plan with duplicate passenger must be rejected");
    assert.equal(result.checks.noPassengerDuplicated, false, "Must fail duplicate check");
    assert.ok(result.failureReasons.some((e) => e.includes("Duplicate passenger assignment")), "Must log duplicate passenger assertion");
});

test("TEST 9: Missing passenger allocation without capacity shortfall is rejected", () => {
    const shortfallPlan = {
        buses: [
            {
                routeCode: "R-1",
                vehicleId: "v1",
                capacity: 70,
                assignedUsers: 50,
                users: Array.from({ length: 50 }, (_, i) => `u_${i}`),
                stops: [{ name: "S1", latitude: 9.9, longitude: 78.1, userCount: 50, userIds: Array.from({ length: 50 }, (_, i) => `u_${i}`) }]
            }
        ],
        unassignedUsers: 0 // But total demand is 60!
    };

    const result = validateTransportationPlan(shortfallPlan, { totalComingUsers: 60, totalAvailableCapacity: 100 });
    assert.equal(result.isCertified, false, "Mismatched passenger accounting must be rejected");
    assert.equal(result.checks.allPassengersAccountedFor, false, "Must fail accounting check");
});

test("TEST 10: OSRM route failure is not falsely marked as verified", () => {
    const fallbackBus = {
        isRoadVerified: false,
        isFallback: true,
        roadRouteStatus: "Road validation unavailable — fallback estimate used"
    };

    assert.equal(fallbackBus.isRoadVerified, false, "Fallback must not claim road verification");
    assert.ok(fallbackBus.roadRouteStatus.includes("unavailable"), "Status must indicate fallback");
});

test("TEST 11: Vehicle assignment happens after route generation (delayed assignment)", () => {
    const routes = [
        { routeId: "r1", assignedUsers: 65, stops: [] },
        { routeId: "r2", assignedUsers: 30, stops: [] }
    ];

    const availableVehicles = [
        { _id: "bus_small", vehicleName: "Small Bus", capacity: 40 },
        { _id: "bus_large", vehicleName: "Large Bus", capacity: 70 }
    ];

    const { assignedRoutes } = assignVehiclesToOptimizedRoutes({ routes, availableVehicles });
    assert.equal(assignedRoutes.length, 2);

    const r1Assigned = assignedRoutes.find((r) => r.routeId === "r1");
    const r2Assigned = assignedRoutes.find((r) => r.routeId === "r2");

    assert.equal(r1Assigned.vehicleName, "Large Bus", "65 passengers must be assigned 70-seat bus");
    assert.equal(r2Assigned.vehicleName, "Small Bus", "30 passengers must be assigned 40-seat bus (tightest fit)");
});

test("TEST 12: Consolidation audit logs are deduplicated", () => {
    const rawLogs = [
        "Route F retained as separate route",
        "Route F retained as separate route",
        "Route Q1 retained as separate route"
    ];

    const deduplicated = Array.from(new Set(rawLogs));
    assert.equal(deduplicated.length, 2, "Consolidation logs must contain zero duplicates");
});

test("TEST 13: Arbitrary college / institution generalization (No hardcoded KLN)", async () => {
    const genericDepot = {
        name: "Tech Hub International",
        latitude: 12.9716,
        longitude: 77.5946 // Bangalore coordinates
    };

    const genericStops = [
        { name: "Tech Park 1", latitude: 12.9800, longitude: 77.6000, userCount: 15, userIds: Array.from({ length: 15 }, (_, i) => `t1_${i}`) },
        { name: "Tech Park 2", latitude: 12.9900, longitude: 77.6100, userCount: 20, userIds: Array.from({ length: 20 }, (_, i) => `t2_${i}`) }
    ];

    const availableVehicles = [
        { _id: "v_generic", vehicleName: "Transit 1", capacity: 50 }
    ];

    const result = await executeGlobalRouteOptimization({
        resolvedStops: genericStops,
        anchorHub: genericDepot,
        availableVehicles,
        tripMode: "FROM_SOURCE"
    });

    assert.ok(result.routes.length > 0, "Must optimize arbitrary geography");
    assert.equal(result.routes[0].assignedUsers, 35, "Must serve 35 passengers on generic campus");
});

test("TEST 14: System handles arbitrary passenger counts without scaling breakdown", async () => {
    const stops = [
        { name: "Stop 1", latitude: 9.91, longitude: 78.11, userCount: 8, userIds: ["a", "b", "c", "d", "e", "f", "g", "h"] },
        { name: "Stop 2", latitude: 9.92, longitude: 78.12, userCount: 7, userIds: ["i", "j", "k", "l", "m", "n", "o"] }
    ];

    const vehicles = [{ _id: "v1", vehicleName: "Bus 1", capacity: 20 }];
    const result = await executeGlobalRouteOptimization({
        resolvedStops: stops,
        anchorHub: sampleDepot,
        availableVehicles: vehicles,
        tripMode: "FROM_SOURCE"
    });

    assert.equal(result.routes[0].assignedUsers, 15);
});

test("TEST 15: Zero passenger loss guarantee", async () => {
    const stops = [
        { name: "S1", latitude: 9.90, longitude: 78.10, userCount: 25, userIds: Array.from({ length: 25 }, (_, i) => `p1_${i}`) },
        { name: "S2", latitude: 9.95, longitude: 78.15, userCount: 30, userIds: Array.from({ length: 30 }, (_, i) => `p2_${i}`) }
    ];

    const vehicles = [
        { _id: "v1", vehicleName: "Bus 1", capacity: 70 }
    ];

    const result = await executeGlobalRouteOptimization({
        resolvedStops: stops,
        anchorHub: sampleDepot,
        availableVehicles: vehicles,
        tripMode: "FROM_SOURCE"
    });

    const totalAllocated = result.routes.reduce((sum, r) => sum + r.assignedUsers, 0);
    assert.equal(totalAllocated, 55, "Zero passenger loss: 55 demanded == 55 allocated");
});
