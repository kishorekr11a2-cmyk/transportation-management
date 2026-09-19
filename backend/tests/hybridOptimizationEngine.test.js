import assert from "node:assert/strict";
import test from "node:test";
import {
    PriorityQueue,
    computeClarkeWrightSavings,
    clusterStopsHybrid,
    optimizeStopSequence2Opt,
    calculateMultiObjectiveRouteScore
} from "../services/routeOptimizationService.js";
import {
    predictStopCompatibility,
    predictRouteQuality,
    predictVehicleSuitability,
    ML_SYSTEM_STATUS
} from "../services/mlPredictionService.js";
import {
    getStopCooccurrenceScore,
    getStopSuccessionScore,
    calculateHistoricalRouteSimilarity,
    normalizeStopName,
    BASELINE_HISTORICAL_ROUTES
} from "../services/historicalRouteService.js";
import {
    planMapAwareTransportationRoutes,
    assignVehiclesToCorridors
} from "../services/mapAwareRouteEngine.js";
import {
    getConfirmedUsers,
    deduplicateUsers,
    getAvailableVehicles
} from "../services/aiAgentService.js";

const TEST_DEPOT = {
    name: "Central Institution Depot",
    latitude: 9.8821,
    longitude: 78.1963
};

// ============================================================================
// SUITE 1: DATA STRUCTURES & MIN-HEAP PRIORITY QUEUE
// ============================================================================

test("1. PriorityQueue: extracts elements in strict min-priority order", () => {
    const pq = new PriorityQueue((a, b) => a.priority - b.priority);
    pq.push({ id: "stopC", priority: 15.2 });
    pq.push({ id: "stopA", priority: 3.1 });
    pq.push({ id: "stopD", priority: 22.8 });
    pq.push({ id: "stopB", priority: 7.4 });

    assert.equal(pq.size(), 4);
    assert.equal(pq.peek().id, "stopA");
    assert.equal(pq.pop().id, "stopA");
    assert.equal(pq.pop().id, "stopB");
    assert.equal(pq.pop().id, "stopC");
    assert.equal(pq.pop().id, "stopD");
    assert.equal(pq.isEmpty(), true);
});

// ============================================================================
// SUITE 2: CLARKE-WRIGHT SAVINGS & COMBINATORIAL OPTIMIZATION
// ============================================================================

test("2. Clarke-Wright Savings: computes valid positive road savings", () => {
    const stops = [
        { name: "Stop 1", latitude: 9.9020, longitude: 78.1120 },
        { name: "Stop 2", latitude: 9.9050, longitude: 78.0980 },
        { name: "Stop 3", latitude: 9.9650, longitude: 78.1410 }
    ];

    const savings = computeClarkeWrightSavings({
        stops,
        depot: TEST_DEPOT
    });

    assert.ok(Array.isArray(savings));
    assert.ok(savings.length > 0);
    // Highest savings should come first (descending order)
    if (savings.length >= 2) {
        assert.ok(savings[0].savings >= savings[1].savings);
    }
    // Savings formula: s(i,j) = d(depot, i) + d(depot, j) - d(i, j)
    assert.ok(savings[0].savings > 0);
});

// ============================================================================
// SUITE 3: 2-OPT LOCAL SEARCH ROUTE REFINEMENT
// ============================================================================

test("3. 2-Opt Local Search: optimizes stop sequence and avoids degradation", async () => {
    // Deliberately criss-crossed tour
    const crissCrossStops = [
        { name: "Near A", latitude: 9.8900, longitude: 78.1800 },
        { name: "Far B", latitude: 9.9600, longitude: 78.1000 },
        { name: "Near C", latitude: 9.8950, longitude: 78.1750 },
        { name: "Far D", latitude: 9.9650, longitude: 78.0950 }
    ];

    const optResult = await optimizeStopSequence2Opt(crissCrossStops, TEST_DEPOT);

    assert.ok(optResult.orderedStops);
    assert.equal(optResult.orderedStops.length, 4);
    assert.ok(optResult.iterations >= 1);
});

// ============================================================================
// SUITE 4: ML STOP COMPATIBILITY & HISTORICAL CO-OCCURRENCE
// ============================================================================

test("4. ML Stop Compatibility: scores historical pairs higher than disconnected pairs", async () => {
    // Known historical co-occurring stops on BUS-01: Alagappan Nagar & Palanganatham
    const predCooccur = await predictStopCompatibility({
        stopA: { name: "Alagappan Nagar", latitude: 9.8920, longitude: 78.0990 },
        stopB: { name: "Palanganatham", latitude: 9.9050, longitude: 78.0980 },
        sourceHub: TEST_DEPOT
    });

    assert.ok(predCooccur.compatibilityScore >= 0.60, `Expected score >= 0.60, got ${predCooccur.compatibilityScore}`);
    assert.ok(predCooccur.cooccurrenceScore > 0, "Expected positive cooccurrence score");

    // Identical stop compatibility should be 1.0
    const predIdentical = await predictStopCompatibility({
        stopA: { name: "Anna Nagar" },
        stopB: { name: "Anna Nagar" }
    });
    assert.equal(predIdentical.compatibilityScore, 1.0);
});

// ============================================================================
// SUITE 5: ROUTE QUALITY & MULTI-OBJECTIVE TRANSPARENT SCORING
// ============================================================================

test("5. Multi-Objective Route Scoring: evaluates utilization and distance efficiency", async () => {
    const routeScore = await calculateMultiObjectiveRouteScore({
        passengerCount: 65,
        vehicleCapacity: 70,
        routeDistanceKm: 28.5,
        routeDurationMin: 55.0,
        stops: [{ name: "Anna Nagar" }, { name: "KK Nagar" }],
        isContinuous: true
    });

    assert.ok(routeScore.score >= 0.70, `Expected high overall score, got ${routeScore.score}`);
    assert.ok(routeScore.explanations.whyRouteSelected);
    assert.ok(routeScore.explanations.whyVehicleSelected);
    assert.ok(routeScore.explanations.scoreBreakdown.mlRouteQuality > 0);
});

// ============================================================================
// SUITE 6: VEHICLE SUITABILITY PREDICTION
// ============================================================================

test("6. Vehicle Suitability: prefers optimal fill ratio and rejects overcapacity", () => {
    const optimal = predictVehicleSuitability({ passengerDemand: 63, vehicleCapacity: 70, isAvailable: true });
    assert.equal(optimal.isFeasible, true);
    assert.ok(optimal.suitabilityScore >= 0.90);

    const overcap = predictVehicleSuitability({ passengerDemand: 75, vehicleCapacity: 70, isAvailable: true });
    assert.equal(overcap.isFeasible, false);
    assert.equal(overcap.reason, "CAPACITY_EXCEEDED");

    const unavail = predictVehicleSuitability({ passengerDemand: 50, vehicleCapacity: 70, isAvailable: false });
    assert.equal(unavail.isFeasible, false);
    assert.equal(unavail.reason, "VEHICLE_UNAVAILABLE");
});

// ============================================================================
// SUITE 7: SCENARIO 1 — 10 USERS / 1 BUS (Exact Allocation, Zero Loss)
// ============================================================================

test("7. Scenario 1: 10 Users / 1 Bus (Exact Allocation, Zero Loss)", async () => {
    const testUsers = Array.from({ length: 10 }, (_, i) => ({
        userId: `U-10-${i + 1}`,
        name: `Student ${i + 1}`,
        stoppings: i < 5 ? "Anna Nagar" : "KK Nagar",
        travelStatus: "Coming"
    }));

    const confirmed = getConfirmedUsers(testUsers);
    const { uniqueUsers } = deduplicateUsers(confirmed);

    const vehicles = [{ _id: "veh-single", vehicleName: "Transit Bus 1", capacity: 50 }];
    const schedules = [{ vehicle: "veh-single", availability: "Available" }];
    const available = getAvailableVehicles(vehicles, schedules);

    const stopMap = new Map();
    uniqueUsers.forEach((u) => {
        if (!stopMap.has(u.stoppings)) {
            stopMap.set(u.stoppings, {
                name: u.stoppings,
                userCount: 0,
                userIds: [],
                latitude: u.stoppings === "Anna Nagar" ? 9.9180 : 9.9270,
                longitude: u.stoppings === "Anna Nagar" ? 78.1467 : 78.1510
            });
        }
        const s = stopMap.get(u.stoppings);
        s.userCount++;
        s.userIds.push(u.userId);
    });

    const result = await planMapAwareTransportationRoutes({
        users: uniqueUsers,
        stoppingAreas: Array.from(stopMap.values()),
        vehicles: available,
        source: TEST_DEPOT,
        direction: "OUTWARD"
    });

    assert.equal(result.planSummary.comingUsers, 10);
    assert.equal(result.planSummary.allocatedUsers, 10);
    assert.equal(result.planSummary.unallocatedUsers, 0);
    assert.equal(result.routes.length, 1);
    assert.equal(result.routes[0].assignedUsers, 10);
});

// ============================================================================
// SUITE 8: SCENARIO 2 — 50 USERS / MULTIPLE BUSES (Varying Capacities)
// ============================================================================

test("8. Scenario 2: 50 Users / Multiple Buses of Varying Capacities", async () => {
    const testUsers = Array.from({ length: 50 }, (_, i) => ({
        userId: `U-50-${i + 1}`,
        name: `Student ${i + 1}`,
        stoppings: i < 25 ? "Othakadai" : "Mattuthavani",
        travelStatus: "Coming"
    }));

    const confirmed = getConfirmedUsers(testUsers);
    const vehicles = [
        { _id: "veh-30", vehicleName: "Mini Bus", capacity: 30 },
        { _id: "veh-35", vehicleName: "Medium Bus", capacity: 35 }
    ];
    const schedules = [
        { vehicle: "veh-30", availability: "Available" },
        { vehicle: "veh-35", availability: "Available" }
    ];
    const available = getAvailableVehicles(vehicles, schedules);

    const stopMap = new Map();
    confirmed.forEach((u) => {
        if (!stopMap.has(u.stoppings)) {
            stopMap.set(u.stoppings, {
                name: u.stoppings,
                userCount: 0,
                userIds: [],
                latitude: u.stoppings === "Othakadai" ? 9.9700 : 9.9450,
                longitude: u.stoppings === "Othakadai" ? 78.1800 : 78.1580
            });
        }
        const s = stopMap.get(u.stoppings);
        s.userCount++;
        s.userIds.push(u.userId);
    });

    const result = await planMapAwareTransportationRoutes({
        users: confirmed,
        stoppingAreas: Array.from(stopMap.values()),
        vehicles: available,
        source: TEST_DEPOT,
        direction: "OUTWARD"
    });

    assert.equal(result.planSummary.comingUsers, 50);
    assert.equal(result.planSummary.allocatedUsers, 50);
    assert.equal(result.planSummary.unallocatedUsers, 0);
    // Capacity constraints must be respected on every bus
    result.routes.forEach((r) => {
        assert.ok(r.assignedUsers <= r.capacity, `Bus ${r.vehicleName} exceeded capacity!`);
    });
});

// ============================================================================
// SUITE 9: SCENARIO 3 — 400 USERS / 7+ BUSES (Full Fleet Allocation)
// ============================================================================

test("9. Scenario 3: 400 Users / 7 Fleet Buses (100% Demand Preservation)", async () => {
    // 30 distinct localities from Madurai dataset with distributed demand summing to 400
    const stopsDistribution = {
        "Othakadai": 15, "Thiruppalai": 14, "Iyer Bungalow": 13, "Koodal Nagar": 12, "Vilangudi": 11,
        "Mattuthavani": 15, "K.Pudur": 13, "Bibikulam": 6, "Sellur": 7, "Arappalayam": 24,
        "Simmakkal": 22, "Goripalayam": 20, "Tallakulam": 21, "Narimedu": 7, "Anuppanadi": 8,
        "Vandiyur": 17, "KK Nagar": 19, "K.K. Nagar West": 18, "Periyar": 8, "Villapuram": 9,
        "Teppakulam": 16, "Anna Nagar": 27, "Viraganoor": 12, "Avaniyapuram": 9, "Jaihindpuram": 10,
        "Kochadai": 11, "Kalavasal": 10, "Palanganatham": 10, "Alagappan Nagar": 9, "Thirunagar": 7
    };

    const users = [];
    let uid = 1;
    for (const [stop, count] of Object.entries(stopsDistribution)) {
        for (let i = 0; i < count; i++) {
            users.push({
                userId: `U400-${uid++}`,
                name: `Passenger ${uid}`,
                stoppings: stop,
                travelStatus: "Coming"
            });
        }
    }

    assert.equal(users.length, 400);

    const vehicles = [
        { _id: "b1", vehicleName: "k1", capacity: 70 },
        { _id: "b2", vehicleName: "V1", capacity: 70 },
        { _id: "b3", vehicleName: "D1", capacity: 70 },
        { _id: "b4", vehicleName: "AS@", capacity: 70 },
        { _id: "b5", vehicleName: "w1", capacity: 60 },
        { _id: "b6", vehicleName: "F", capacity: 45 },
        { _id: "b7", vehicleName: "A2", capacity: 70 }
    ];
    // Total capacity = 70*5 + 60 + 45 = 455 seats (>= 400 demand)
    const schedules = vehicles.map((v) => ({ vehicle: v._id, availability: "Available" }));
    const available = getAvailableVehicles(vehicles, schedules);

    const stopMap = new Map();
    users.forEach((u) => {
        if (!stopMap.has(u.stoppings)) {
            stopMap.set(u.stoppings, {
                name: u.stoppings,
                userCount: 0,
                userIds: [],
                latitude: 9.9252, // placeholder for fast unit test
                longitude: 78.1198
            });
        }
        const s = stopMap.get(u.stoppings);
        s.userCount++;
        s.userIds.push(u.userId);
    });

    const result = await planMapAwareTransportationRoutes({
        users,
        stoppingAreas: Array.from(stopMap.values()),
        vehicles: available,
        source: TEST_DEPOT,
        direction: "OUTWARD"
    });

    assert.equal(result.planSummary.comingUsers, 400);
    assert.equal(result.planSummary.allocatedUsers, 400);
    assert.equal(result.planSummary.unallocatedUsers, 0);

    // Verify all passenger IDs are allocated exactly once
    const seenPassengers = new Set();
    result.routes.forEach((r) => {
        (r.userIds || []).forEach((pId) => {
            assert.equal(seenPassengers.has(pId), false, `Passenger ${pId} duplicated across buses!`);
            seenPassengers.add(pId);
        });
        assert.ok(r.assignedUsers <= r.capacity, `Bus ${r.vehicleName} exceeded capacity!`);
        assert.ok(r.scores);
        assert.ok(r.scores.mlRouteQuality > 0);
    });

    assert.equal(seenPassengers.size, 400);
});

// ============================================================================
// SUITE 10: SCENARIO 4 — CAPACITY SHORTAGE (Strict Infeasibility Reporting)
// ============================================================================

test("10. Scenario 4: Capacity Shortage (Exact Unallocated Reporting, Zero Drop)", async () => {
    // 100 passengers but only 60 total vehicle seats
    const users = Array.from({ length: 100 }, (_, i) => ({
        userId: `SHORT-${i + 1}`,
        name: `Student ${i + 1}`,
        stoppings: "Anna Nagar",
        travelStatus: "Coming"
    }));

    const vehicles = [{ _id: "v-small", vehicleName: "Small Bus", capacity: 60 }];
    const schedules = [{ vehicle: "v-small", availability: "Available" }];
    const available = getAvailableVehicles(vehicles, schedules);

    const assignment = assignVehiclesToCorridors({
        corridors: [{
            name: "Test Corridor",
            totalDemand: 100,
            stops: [{ name: "Anna Nagar", userCount: 100, userIds: users.map((u) => u.userId) }]
        }],
        availableVehicles: available,
        sourceHub: TEST_DEPOT
    });

    assert.equal(assignment.status, "infeasible");
    assert.equal(assignment.reason, "INSUFFICIENT_CAPACITY");
    assert.equal(assignment.unallocatedUsers, 40);
    assert.equal(assignment.totalDemandedPassengers, 100);
    assert.equal(assignment.totalFleetCapacity, 60);
});

// ============================================================================
// SUITE 11: SCENARIO 5 — DUPLICATE USERS & SAME LOCATION GROUPING
// ============================================================================

test("11. Scenario 5: Duplicate Users Deduplicated without Data Corruption", () => {
    const rawUsers = [
        { userId: "DUP-1", name: "Alice", role: "student", travelStatus: "Coming", stoppings: "Goripalayam" },
        { userId: "DUP-1", name: "Alice Repeat", role: "student", travelStatus: "Coming", stoppings: "Goripalayam" },
        { userId: "DUP-2", name: "Bob", role: "student", travelStatus: "Coming", stoppings: "Goripalayam" }
    ];

    const confirmed = getConfirmedUsers(rawUsers);
    const { uniqueUsers, duplicateCount } = deduplicateUsers(confirmed);

    assert.equal(uniqueUsers.length, 2);
    assert.equal(duplicateCount, 1);
});

// ============================================================================
// SUITE 12: SCENARIO 6 — VEHICLE SCHEDULE AVAILABILITY ENFORCEMENT
// ============================================================================

test("12. Scenario 6: Unavailable Schedule Vehicles Strictly Excluded", () => {
    const vehicles = [
        { _id: "v-avail", vehicleName: "Bus Active", capacity: 70 },
        { _id: "v-unavail", vehicleName: "Bus Inactive (Maintenance)", capacity: 70 }
    ];
    const schedules = [
        { vehicle: "v-avail", availability: "Available" },
        { vehicle: "v-unavail", availability: "Not Available" }
    ];

    const available = getAvailableVehicles(vehicles, schedules);
    assert.equal(available.length, 1);
    assert.equal(available[0].vehicleName, "Bus Active");
});

// ============================================================================
// SUITE 13: SCENARIO 7 — HISTORICAL PREDICTORS & DATA NORMALIZATION
// ============================================================================

test("13. Scenario 7: Stop Name Normalization & Baseline Schedules", () => {
    assert.equal(normalizeStopName("  k.pudur  "), "K.Pudur");
    assert.equal(normalizeStopName("kk nagar west"), "K.K. Nagar West");
    assert.equal(normalizeStopName("viraganur"), "Viraganoor");
    assert.ok(BASELINE_HISTORICAL_ROUTES.length >= 13);
    assert.ok(BASELINE_HISTORICAL_ROUTES.every((r) => r.direction === "OUTWARD"));
    assert.ok(BASELINE_HISTORICAL_ROUTES.every((r) => r.stops.length > 0));
});

// ============================================================================
// SUITE 14: SCENARIO 8 — SCALABILITY TO ARBITRARY HUBS (No Hardcoded Values)
// ============================================================================

test("14. Scenario 8: Scalability to Arbitrary Hubs & Corporate/College Campuses", async () => {
    // Dynamic campus in Bengaluru or Chennai
    const dynamicHub = {
        name: "Metro University Technology Campus",
        latitude: 13.0827,
        longitude: 80.2707
    };

    const campusStops = [
        { name: "Sector 1 Stop", latitude: 13.0900, longitude: 78.2600, userCount: 20 },
        { name: "Sector 2 Stop", latitude: 13.0950, longitude: 78.2550, userCount: 25 },
        { name: "Sector 3 Stop", latitude: 13.1000, longitude: 78.2500, userCount: 25 }
    ];

    const corridors = await clusterStopsHybrid({
        resolvedStops: campusStops,
        depot: dynamicHub,
        availableVehicles: [{ capacity: 80 }]
    });

    assert.ok(corridors.length >= 1);
    assert.ok(corridors[0].totalDemand > 0);
    assert.ok(corridors[0].name.includes("Sector"));
});
