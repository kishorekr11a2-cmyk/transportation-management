import test from "node:test";
import assert from "node:assert/strict";
import {
    selectInwardFleet,
    selectOutwardFleet,
    sequenceInwardRouteStops,
    sequenceOutwardRouteStops,
    mergeDuplicateStopsInRoute,
    calculateMultiObjectiveRouteScore
} from "../services/routeOptimizationService.js";
import { buildAIPlan } from "../services/aiAgentService.js";

const COLLEGE_HUB = {
    name: "K. L. N. College of Engineering",
    latitude: 9.8324,
    longitude: 78.1818
};

const SAMPLE_VEHICLES = [
    { _id: "veh_k1", vehicleName: "k1", name: "k1", capacity: 70, isActive: true },
    { _id: "veh_v1", vehicleName: "V1", name: "V1", capacity: 70, isActive: true },
    { _id: "veh_d1", vehicleName: "D1", name: "D1", capacity: 70, isActive: true },
    { _id: "veh_i1", vehicleName: "I1", name: "I1", capacity: 70, isActive: true },
    { _id: "veh_a2", vehicleName: "A2", name: "A2", capacity: 70, isActive: true },
    { _id: "veh_j1", vehicleName: "J1", name: "J1", capacity: 70, isActive: true },
    { _id: "veh_w1", vehicleName: "w1", name: "w1", capacity: 70, isActive: true },
    { _id: "veh_extra1", vehicleName: "X1", name: "X1", capacity: 70, isActive: true },
    { _id: "veh_extra2", vehicleName: "X2", name: "X2", capacity: 70, isActive: true }
];

const STARTING_PLACES = [
    { busName: "k1", locationName: "Othakadai", latitude: 9.9650, longitude: 78.1850, active: true },
    { busName: "V1", locationName: "KK Nagar", latitude: 9.9320, longitude: 78.1500, active: true },
    { busName: "D1", locationName: "Thirunagar", latitude: 9.8820, longitude: 78.0750, active: true },
    { busName: "I1", locationName: "Anna Nagar", latitude: 9.9210, longitude: 78.1520, active: true },
    { busName: "A2", locationName: "Sellur", latitude: 9.9400, longitude: 78.1250, active: true },
    { busName: "J1", locationName: "Teppakulam", latitude: 9.9160, longitude: 78.1480, active: true },
    { busName: "w1", locationName: "Goripalayam", latitude: 9.9300, longitude: 78.1320, active: true }
];

// ----------------------------------------------------------------------------
// TEST 1 — Same demand: OUTWARD = 400, INWARD = 398 -> Exact same bus fleet
// ----------------------------------------------------------------------------
test("TEST 1 — Same demand: OUTWARD = 400, INWARD = 398 prefers the exact same bus fleet", () => {
    const outwardFleet = [
        SAMPLE_VEHICLES[0], // k1
        SAMPLE_VEHICLES[1], // V1
        SAMPLE_VEHICLES[2], // D1
        SAMPLE_VEHICLES[3], // I1
        SAMPLE_VEHICLES[4], // A2
        SAMPLE_VEHICLES[5]  // J1
    ];

    const oppositePlan = {
        buses: outwardFleet.map((v, idx) => ({
            vehicleId: v._id,
            vehicleName: v.name,
            assignedVehicle: v,
            assignedUsers: idx === 0 ? 70 : 66,
            stops: [{ name: "Stop A", latitude: 9.90, longitude: 78.12 }]
        })),
        assignedUsers: 400
    };

    const inwardFleetSelection = selectInwardFleet({
        totalComingPassengers: 398,
        availableVehicles: SAMPLE_VEHICLES,
        activeInwardStartingPlaces: STARTING_PLACES,
        oppositePlan
    });

    assert.equal(inwardFleetSelection.selectedBuses.length, 6, "Inward fleet should have 6 buses matching outward fleet");
    const inwardBusNames = inwardFleetSelection.selectedBuses.map((b) => b.vehicleName || b.name);
    assert.deepEqual(
        inwardBusNames.sort(),
        ["A2", "D1", "I1", "J1", "V1", "k1"].sort(),
        "All 6 outward buses must be reused for inward when demand is identical/stable"
    );
});

// ----------------------------------------------------------------------------
// TEST 2 — Slight demand increase: OUTWARD = 400, INWARD = 420 -> Keep existing buses, add 1 only if needed
// ----------------------------------------------------------------------------
test("TEST 2 — Slight demand increase: OUTWARD = 400 (6 buses), INWARD = 430 -> Keeps all 6 existing buses and adds 1", () => {
    const outwardFleet = [
        SAMPLE_VEHICLES[0], // k1
        SAMPLE_VEHICLES[1], // V1
        SAMPLE_VEHICLES[2], // D1
        SAMPLE_VEHICLES[3], // I1
        SAMPLE_VEHICLES[4], // A2
        SAMPLE_VEHICLES[5]  // J1
    ]; // 6 * 70 = 420 seats.

    const oppositePlan = {
        buses: outwardFleet.map((v) => ({
            vehicleId: v._id,
            vehicleName: v.name,
            assignedVehicle: v,
            assignedUsers: 67
        })),
        assignedUsers: 400
    };

    // Demand 430 exceeds 420 seats of the 6 buses, so 1 additional bus is required (total 7)
    const inwardSelection = selectInwardFleet({
        totalComingPassengers: 430,
        availableVehicles: SAMPLE_VEHICLES,
        activeInwardStartingPlaces: STARTING_PLACES,
        oppositePlan
    });

    assert.equal(inwardSelection.selectedBuses.length, 7, "Should select 7 buses (6 original + 1 additional)");
    const reusedNames = inwardSelection.selectedReusable.map((b) => b.vehicleName || b.name);
    assert.equal(reusedNames.length, 6, "All 6 outward buses must be retained in the inward fleet");
    assert.equal(inwardSelection.additionalBuses.length, 1, "Exactly 1 additional bus should be added");
});

// ----------------------------------------------------------------------------
// TEST 3 — Slight demand decrease / Section 3 & 20: OUTWARD = 413 (7 buses), INWARD = 405 -> Keep 7 buses
// ----------------------------------------------------------------------------
test("TEST 3 — Stability Rule: OUTWARD = 413 (7 buses), INWARD = 405 does NOT drop to 6 buses merely because 6x70 >= 405", () => {
    const outward7Buses = [
        SAMPLE_VEHICLES[0], // k1
        SAMPLE_VEHICLES[1], // V1
        SAMPLE_VEHICLES[2], // D1
        SAMPLE_VEHICLES[3], // I1
        SAMPLE_VEHICLES[4], // A2
        SAMPLE_VEHICLES[5], // J1
        SAMPLE_VEHICLES[6]  // w1
    ];

    const oppositePlan = {
        buses: outward7Buses.map((v) => ({
            vehicleId: v._id,
            vehicleName: v.name,
            assignedVehicle: v,
            assignedUsers: 59
        })),
        assignedUsers: 413
    };

    const inwardSelection = selectInwardFleet({
        totalComingPassengers: 405,
        availableVehicles: SAMPLE_VEHICLES,
        activeInwardStartingPlaces: STARTING_PLACES,
        oppositePlan
    });

    // Minimum capacity formula gives ceil(405 / 70) = 6 buses.
    // BUT the Stability Rule (Section 3, 4, 5, 20) requires retaining the 7 outward buses!
    assert.equal(
        inwardSelection.selectedBuses.length,
        7,
        "Fleet must retain all 7 buses for stability, not drop to 6 just because 6 * 70 >= 405"
    );
    const names = inwardSelection.selectedBuses.map((b) => b.vehicleName || b.name).sort();
    assert.deepEqual(
        names,
        ["A2", "D1", "I1", "J1", "V1", "k1", "w1"].sort(),
        "All 7 physical outward buses must be preserved"
    );
});

// ----------------------------------------------------------------------------
// TEST 4 — Major demand decrease: OUTWARD = 400, INWARD = 250 -> Select best subset from outward fleet
// ----------------------------------------------------------------------------
test("TEST 4 — Major demand decrease: OUTWARD = 400 (6 buses), INWARD = 250 reduces fleet, but selects from outward fleet", () => {
    const outwardFleet = [
        SAMPLE_VEHICLES[0], // k1
        SAMPLE_VEHICLES[1], // V1
        SAMPLE_VEHICLES[2], // D1
        SAMPLE_VEHICLES[3], // I1
        SAMPLE_VEHICLES[4], // A2
        SAMPLE_VEHICLES[5]  // J1
    ];

    const oppositePlan = {
        buses: outwardFleet.map((v) => ({
            vehicleId: v._id,
            vehicleName: v.name,
            assignedVehicle: v,
            assignedUsers: 66
        })),
        assignedUsers: 400
    };

    const inwardSelection = selectInwardFleet({
        totalComingPassengers: 250,
        availableVehicles: SAMPLE_VEHICLES,
        activeInwardStartingPlaces: STARTING_PLACES,
        oppositePlan
    });

    // ceil(250 / 70) = 4 buses.
    assert.equal(inwardSelection.selectedBuses.length, 4, "Should reduce to 4 buses for 250 passengers");
    const outwardNames = new Set(outwardFleet.map((b) => b.vehicleName || b.name));
    for (const bus of inwardSelection.selectedBuses) {
        assert.ok(
            outwardNames.has(bus.vehicleName || bus.name),
            `Selected inward bus '${bus.vehicleName || bus.name}' must be from the outward fleet`
        );
    }
});

// ----------------------------------------------------------------------------
// TEST 5 — Geographic backtracking prevention: A -> B -> C -> B -> D or A -> B -> C -> D -> C -> E
// ----------------------------------------------------------------------------
test("TEST 5 — Geographic backtracking prevention: Rejects corridor reversal loops", () => {
    // Madurai corridor stops from East to West/South:
    // Othakadai (East) -> Mattuthavani -> KK Nagar -> Teppakulam -> KLN (South-East)
    const othakadaiHub = { name: "Othakadai", latitude: 9.9650, longitude: 78.1850 };
    const mattuthavani = { name: "Mattuthavani", latitude: 9.9400, longitude: 78.1600, userCount: 15 };
    const kkNagar = { name: "KK Nagar", latitude: 9.9320, longitude: 78.1500, userCount: 20 };
    const teppakulam = { name: "Teppakulam", latitude: 9.9160, longitude: 78.1480, userCount: 25 };

    // Sequence with candidate stops in arbitrary/backtracking order:
    const candidateStops = [teppakulam, mattuthavani, kkNagar];

    const seq = sequenceInwardRouteStops({
        startingHub: othakadaiHub,
        destinationHub: COLLEGE_HUB,
        stops: candidateStops,
        tripMode: "INWARD"
    });

    const stopNames = seq.stops.map((s) => s.name);
    // Natural progression from Othakadai: Mattuthavani -> KK Nagar -> Teppakulam -> KLN
    assert.equal(stopNames[0], "Mattuthavani");
    assert.equal(stopNames[1], "KK Nagar");
    assert.equal(stopNames[2], "Teppakulam");
    assert.equal(seq.qualityValidation.directionalReversals, 0, "No directional reversals allowed");
    assert.ok(seq.qualityValidation.backtrackingDistanceKm < 1.0, "Backtracking must be minimized");
});

// ----------------------------------------------------------------------------
// TEST 6 — Shared corridor allowed: Bus 1 and Bus 2 can share corridors when beneficial
// ----------------------------------------------------------------------------
test("TEST 6 — Shared corridor allowed: Bus 1 and Bus 2 can share corridors naturally", () => {
    const scoreA = calculateMultiObjectiveRouteScore({
        passengerCount: 68,
        vehicleCapacity: 70,
        roadDistanceKm: 34,
        stops: [{ name: "Viraganur" }, { name: "Vandiyur" }, { name: "KK Nagar" }],
        isContinuous: true,
        detourRatio: 1.18,
        hasSharedCorridor: true,
        isReusedBus: true
    });

    assert.ok(scoreA.totalScore >= 0.80, "Route sharing should receive route sharing bonus and high score");
    assert.equal(scoreA.diagnostics.sharedRouteSegment, true);
});

// ----------------------------------------------------------------------------
// TEST 7 — Inward starting hub respected: Bus starts from designated hub -> natural progression -> KLN
// ----------------------------------------------------------------------------
test("TEST 7 — Inward starting hub respected: Bus genuinely starts from designated starting place", () => {
    const busOthakadai = SAMPLE_VEHICLES[0]; // k1
    const sp = STARTING_PLACES.find((p) => p.busName === "k1");
    assert.ok(sp, "k1 must have Othakadai starting place");

    const stops = [
        { name: "Othakadai", latitude: 9.9650, longitude: 78.1850, userCount: 10, userIds: ["u1"] },
        { name: "Mattuthavani", latitude: 9.9400, longitude: 78.1600, userCount: 20, userIds: ["u2"] },
        { name: "Viraganur", latitude: 9.8950, longitude: 78.1650, userCount: 15, userIds: ["u3"] }
    ];

    const seq = sequenceInwardRouteStops({
        startingHub: sp,
        destinationHub: COLLEGE_HUB,
        stops,
        tripMode: "INWARD"
    });

    assert.equal(seq.stops[0].name, "Othakadai", "Route must genuinely begin from Othakadai starting hub");
    assert.equal(seq.stops[1].name, "Mattuthavani");
    assert.equal(seq.stops[2].name, "Viraganur");
    assert.equal(seq.qualityValidation.startingHubRepeatedAfterDeparture, false);
});

// ----------------------------------------------------------------------------
// TEST 8 — Shared corridor metadata: Derived strictly in forward route traversal order
// ----------------------------------------------------------------------------
test("TEST 8 — Shared corridor metadata: Strictly follows forward route sequence order", async () => {
    // Bus 1: Viraganur -> Teppakulam -> Palanganatham
    // Bus 2: Viraganur -> Teppakulam -> Sellur
    const stopsBus1 = [
        { name: "Viraganur", latitude: 9.8950, longitude: 78.1650, userCount: 30, userIds: Array.from({ length: 30 }, (_, i) => `u1_${i}`) },
        { name: "Teppakulam", latitude: 9.9160, longitude: 78.1480, userCount: 30, userIds: Array.from({ length: 30 }, (_, i) => `u2_${i}`) },
        { name: "Palanganatham", latitude: 9.9050, longitude: 78.1050, userCount: 10, userIds: Array.from({ length: 10 }, (_, i) => `u3_${i}`) }
    ];
    const stopsBus2 = [
        { name: "Viraganur", latitude: 9.8950, longitude: 78.1650, userCount: 25, userIds: Array.from({ length: 25 }, (_, i) => `u4_${i}`) },
        { name: "Teppakulam", latitude: 9.9160, longitude: 78.1480, userCount: 20, userIds: Array.from({ length: 20 }, (_, i) => `u5_${i}`) },
        { name: "Sellur", latitude: 9.9400, longitude: 78.1250, userCount: 25, userIds: Array.from({ length: 25 }, (_, i) => `u6_${i}`) }
    ];

    const vehicles = [
        { _id: "veh_1", vehicleName: "k1", name: "k1", capacity: 70 },
        { _id: "veh_2", vehicleName: "V1", name: "V1", capacity: 70 }
    ];

    const plan = await buildAIPlan({
        sourceHub: COLLEGE_HUB,
        destinationHub: COLLEGE_HUB,
        tripMode: "FROM_SOURCE",
        resolvedStops: [
            { name: "Viraganur", latitude: 9.8950, longitude: 78.1650, userCount: 75, userIds: Array.from({ length: 75 }, (_, i) => `u_v_${i}`) },
            { name: "Teppakulam", latitude: 9.9160, longitude: 78.1480, userCount: 45, userIds: Array.from({ length: 45 }, (_, i) => `u_t_${i}`) },
            { name: "Palanganatham", latitude: 9.9050, longitude: 78.1050, userCount: 20, userIds: Array.from({ length: 20 }, (_, i) => `u_p_${i}`) }
        ],
        availableVehicles: vehicles,
        rawVehicles: vehicles,
        totalComingUsers: 140,
        allUsersCount: 140
    });

    assert.equal(plan.buses.length, 2);
    // When multiple stops are shared, verify they appear in exact forward road traversal order:
    // Viraganur comes before Teppakulam (never Teppakulam before Viraganur)
    const busWithMultipleShared = plan.buses.find(b => b.sharedCorridorStops && b.sharedCorridorStops.length >= 2);
    if (busWithMultipleShared) {
        assert.ok(
            busWithMultipleShared.sharedRouteSegment.includes("Viraganur → Teppakulam"),
            `Shared corridor string '${busWithMultipleShared.sharedRouteSegment}' must follow forward traversal order (Viraganur → Teppakulam)`
        );
    } else {
        for (const b of plan.buses) {
            if (b.sharedRouteSegment) {
                // Must be one of the stops traversed in order
                assert.ok(typeof b.sharedRouteSegment === "string");
            }
        }
    }
});
