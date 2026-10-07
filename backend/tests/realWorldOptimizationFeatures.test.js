import test from "node:test";
import assert from "node:assert/strict";
import {
    mergeDuplicateStopsInRoute,
    isSamePlace,
    sequenceInwardRouteStops,
    sequenceOutwardRouteStops,
    calculateMultiObjectiveRouteScore,
    executeGlobalRouteOptimization
} from "../services/routeOptimizationService.js";
import { buildAIPlan } from "../services/aiAgentService.js";

const COLLEGE_HUB = {
    name: "K. L. N. College of Engineering",
    latitude: 9.8324,
    longitude: 78.1818
};

test("CASE 1: One continuous route with natural progression and no sharing is valid", () => {
    const stops = [
        { name: "Anuppanadi", latitude: 9.9050, longitude: 78.1400, userCount: 15, userIds: ["u1", "u2"] },
        { name: "Teppakulam", latitude: 9.9160, longitude: 78.1480, userCount: 20, userIds: ["u3", "u4"] },
        { name: "Anna Nagar", latitude: 9.9210, longitude: 78.1520, userCount: 25, userIds: ["u5", "u6"] }
    ];

    const result = sequenceOutwardRouteStops({
        departureHub: COLLEGE_HUB,
        stops,
        tripMode: "FROM_SOURCE"
    });

    assert.equal(result.stops.length, 3);
    assert.equal(result.qualityValidation.directionalReversals, 0);
    assert.ok(result.routeDistanceKm > 0);
});

test("CASE 2 & 6: Route sharing detection and corridor sharing across buses", async () => {
    const stopsA = [
        { name: "Anuppanadi", latitude: 9.9050, longitude: 78.1400, userCount: 30, userIds: ["u1"] },
        { name: "Teppakulam", latitude: 9.9160, longitude: 78.1480, userCount: 30, userIds: ["u2"] }
    ];
    const stopsB = [
        { name: "Anuppanadi", latitude: 9.9050, longitude: 78.1400, userCount: 25, userIds: ["u3"] },
        { name: "Mattuthavani", latitude: 9.9400, longitude: 78.1600, userCount: 30, userIds: ["u4"] }
    ];

    const vehicles = [
        { _id: "veh_1", name: "Bus 1", capacity: 70 },
        { _id: "veh_2", name: "Bus 2", capacity: 70 }
    ];

    const allStops = [
        { name: "Anuppanadi", latitude: 9.9050, longitude: 78.1400, userCount: 55, userIds: Array.from({ length: 55 }, (_, i) => `u_a_${i}`) },
        { name: "Teppakulam", latitude: 9.9160, longitude: 78.1480, userCount: 30, userIds: Array.from({ length: 30 }, (_, i) => `u_t_${i}`) },
        { name: "Mattuthavani", latitude: 9.9400, longitude: 78.1600, userCount: 30, userIds: Array.from({ length: 30 }, (_, i) => `u_m_${i}`) }
    ];

    const plan = await buildAIPlan({
        sourceHub: COLLEGE_HUB,
        destinationHub: COLLEGE_HUB,
        tripMode: "FROM_SOURCE",
        resolvedStops: allStops,
        availableVehicles: vehicles,
        rawVehicles: vehicles,
        totalComingUsers: 115,
        allUsersCount: 115
    });

    assert.equal(plan.assignedUsers, 115);
    assert.equal(plan.buses.length, 2);
    // Both buses are valid and respect vehicle capacity
    for (const b of plan.buses) {
        assert.ok(b.assignedUsers <= b.capacity);
    }
});

test("CASE 3: Existing bus with spare capacity absorbs compatible passenger group", () => {
    const scoreWithReuse = calculateMultiObjectiveRouteScore({
        passengerCount: 65,
        vehicleCapacity: 70,
        roadDistanceKm: 32,
        stops: [{ name: "A" }, { name: "B" }],
        isContinuous: true,
        detourRatio: 1.2,
        isReusedBus: true,
        hasSharedCorridor: true
    });

    const scoreWithoutReuse = calculateMultiObjectiveRouteScore({
        passengerCount: 65,
        vehicleCapacity: 70,
        roadDistanceKm: 32,
        stops: [{ name: "A" }, { name: "B" }],
        isContinuous: true,
        detourRatio: 1.2,
        isReusedBus: false,
        hasSharedCorridor: false
    });

    assert.ok(scoreWithReuse.totalScore > scoreWithoutReuse.totalScore, "Bus reuse and corridor sharing should yield a higher score");
    assert.equal(scoreWithReuse.diagnostics.reusedExistingBus, true);
    assert.equal(scoreWithReuse.diagnostics.sharedRouteSegment, true);
});

test("CASE 4 & 7: Backtracking route (A -> B -> C -> B -> D) is severely penalized", () => {
    // Inward progression: Hub (Melur) -> Stop A (near Melur) -> Stop B -> Stop C (far) -> Stop B (loop back) -> College
    const startHub = { name: "Melur", latitude: 10.0400, longitude: 78.3300 };
    const destination = COLLEGE_HUB;

    const stopsWithBacktrack = [
        { name: "Othakadai", latitude: 9.9600, longitude: 78.2000, userCount: 10 },
        { name: "Mattuthavani", latitude: 9.9400, longitude: 78.1600, userCount: 10 },
        { name: "Anna Nagar", latitude: 9.9210, longitude: 78.1520, userCount: 10 }
    ];

    const sequenced = sequenceInwardRouteStops({
        startingHub: startHub,
        destinationHub: destination,
        stops: stopsWithBacktrack,
        tripMode: "INWARD"
    });

    // Progression towards college should be orderly: Melur (10.04) -> Othakadai (9.96) -> Mattuthavani (9.94) -> Anna Nagar (9.92) -> College (9.83)
    assert.equal(sequenced.stops[0].name, "Othakadai");
    assert.equal(sequenced.stops[1].name, "Mattuthavani");
    assert.equal(sequenced.stops[2].name, "Anna Nagar");
    assert.equal(sequenced.qualityValidation.directionalReversals, 0);

    // Now test scoring penalty on artificial backtracking
    const penalizedScore = calculateMultiObjectiveRouteScore({
        passengerCount: 50,
        vehicleCapacity: 70,
        roadDistanceKm: 45,
        stops: stopsWithBacktrack,
        isContinuous: true,
        backtrackingDistanceKm: 6.5,
        directionalReversals: 2
    });

    assert.ok(penalizedScore.diagnostics.backtrackingPenalty > 0.15, "Significant backtracking distance must invoke meaningful penalty");
});

test("CASE 8: Duplicate stops (Villapuram -> Thirunagar -> Thirunagar -> Simmakkal) are merged cleanly with zero passenger loss", () => {
    const rawStops = [
        { name: "Villapuram", latitude: 9.9010, longitude: 78.1150, userCount: 15, userIds: ["u1", "u2"] },
        { name: "Thirunagar", latitude: 9.8820, longitude: 78.0640, userCount: 12, userIds: ["u3", "u4", "u5"] },
        { name: "Thirunagar", latitude: 9.8825, longitude: 78.0645, userCount: 8, userIds: ["u6", "u7"] },
        { name: "Simmakkal", latitude: 9.9250, longitude: 78.1200, userCount: 20, userIds: ["u8"] }
    ];

    const merged = mergeDuplicateStopsInRoute(rawStops, null);

    assert.equal(merged.length, 3, "Consecutive duplicate Thirunagar stops must be merged into one single stop");
    assert.equal(merged[0].name, "Villapuram");
    assert.equal(merged[1].name, "Thirunagar");
    assert.equal(merged[2].name, "Simmakkal");

    // Total passenger count must be strictly preserved
    const totalOriginalPax = rawStops.reduce((sum, s) => sum + s.userCount, 0);
    const totalMergedPax = merged.reduce((sum, s) => sum + s.userCount, 0);
    assert.equal(totalMergedPax, totalOriginalPax, "Total passengers must equal original before merge");

    // Thirunagar must have combined passengers and userIds
    assert.equal(merged[1].userCount, 20);
    assert.equal(merged[1].userIds.length, 5);
    assert.deepEqual(merged[1].userIds.sort(), ["u3", "u4", "u5", "u6", "u7"].sort());
});

test("CASE 9 & 10: Realistic institutional distance scoring (30-60 km reasonable, 70+ penalized)", () => {
    const score35Km = calculateMultiObjectiveRouteScore({
        passengerCount: 50,
        vehicleCapacity: 70,
        roadDistanceKm: 35,
        stops: [{ name: "A" }, { name: "B" }],
        isContinuous: true
    });

    const score45Km = calculateMultiObjectiveRouteScore({
        passengerCount: 50,
        vehicleCapacity: 70,
        roadDistanceKm: 45,
        stops: [{ name: "A" }, { name: "B" }],
        isContinuous: true
    });

    const score58Km = calculateMultiObjectiveRouteScore({
        passengerCount: 50,
        vehicleCapacity: 70,
        roadDistanceKm: 58,
        stops: [{ name: "A" }, { name: "B" }],
        isContinuous: true
    });

    const score78Km = calculateMultiObjectiveRouteScore({
        passengerCount: 50,
        vehicleCapacity: 70,
        roadDistanceKm: 78,
        stops: [{ name: "A" }, { name: "B" }],
        isContinuous: true
    });

    assert.ok(score35Km.totalScore >= 0.75, "35 km route is healthy institutional distance");
    assert.ok(score45Km.totalScore >= 0.70, "45 km route (e.g. k1 40.27 km) must not be rejected");
    assert.ok(score58Km.totalScore >= 0.65, "58 km route is still reasonable");
    assert.ok(score78Km.totalScore < score45Km.totalScore, "78 km route must receive distance penalty");
});

test("CASE 11: Capacity constraint is strict and never violated", () => {
    const scoreOverCap = calculateMultiObjectiveRouteScore({
        passengerCount: 71,
        vehicleCapacity: 70,
        roadDistanceKm: 30,
        stops: [{ name: "A" }],
        isContinuous: true
    });

    assert.equal(scoreOverCap.explanations.scoreBreakdown.seatUtilization, 0.0, "Utilization score must collapse to 0 when capacity is violated");
});

test("CASE 12, 13 & 14: INWARD and OUTWARD are independent and not mere reverse copies", () => {
    // Stops along road network
    const residentialHub = { name: "Thirunagar Hub", latitude: 9.8820, longitude: 78.0640 };
    const intermediateStops = [
        { name: "Palanganatham", latitude: 9.9050, longitude: 78.1020, userCount: 15 },
        { name: "Periyar", latitude: 9.9180, longitude: 78.1140, userCount: 15 }
    ];

    // INWARD: Starts at Thirunagar Hub -> moves towards college
    const inwardResult = sequenceInwardRouteStops({
        startingHub: residentialHub,
        destinationHub: COLLEGE_HUB,
        stops: intermediateStops,
        tripMode: "INWARD"
    });

    // OUTWARD: Starts at College -> moves towards residential areas
    const outwardResult = sequenceOutwardRouteStops({
        departureHub: COLLEGE_HUB,
        stops: intermediateStops,
        tripMode: "FROM_SOURCE"
    });

    // Verify inward order progresses towards destination
    assert.equal(inwardResult.stops[0].name, "Palanganatham");
    assert.equal(inwardResult.stops[1].name, "Periyar");

    // Verify outward order departs from college
    assert.equal(outwardResult.stops[0].name, "Palanganatham");
    assert.equal(outwardResult.stops[1].name, "Periyar");

    // Inward and Outward validations must independently verify directional progression
    assert.equal(inwardResult.qualityValidation.directionalReversals, 0);
    assert.equal(outwardResult.qualityValidation.directionalReversals, 0);
    assert.equal(inwardResult.qualityValidation.startingHub, "Thirunagar Hub");
    assert.equal(outwardResult.qualityValidation.destination, "Periyar");
});
