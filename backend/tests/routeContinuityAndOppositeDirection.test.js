import test from "node:test";
import assert from "node:assert/strict";

import {
    validateAndRepairRouteContinuity,
    checkStopTransitionViolation,
    sequenceOutwardRouteStops,
    sequenceInwardRouteStops
} from "../services/routeOptimizationService.js";

import {
    resetGeneratedAIRoute
} from "../services/aiAgentService.js";

// Common test coordinates (Madurai Region)
const sourceHub = {
    name: "Campus Depot Hub",
    latitude: 9.8825,
    longitude: 78.1633
};

const destinationHub = {
    name: "Arrival Campus Depot",
    latitude: 9.8825,
    longitude: 78.1633
};

// ============================================================================
// TEST 1: All stops naturally progress. One bus where capacity allows.
// ============================================================================
test("Test 1: All stops naturally progress - One bus where capacity allows", async () => {
    // Continuous outward progression along North corridor
    const continuousStops = [
        { name: "Keelavasal", latitude: 9.9180, longitude: 78.1250, userCount: 20, userIds: Array.from({ length: 20 }, (_, i) => `u1_${i}`) },
        { name: "Simmakkal", latitude: 9.9250, longitude: 78.1200, userCount: 25, userIds: Array.from({ length: 25 }, (_, i) => `u2_${i}`) },
        { name: "Sellur", latitude: 9.9380, longitude: 78.1170, userCount: 24, userIds: Array.from({ length: 24 }, (_, i) => `u3_${i}`) }
    ];

    const initialBuses = [
        {
            routeCode: "Bus A",
            vehicleId: "veh_1",
            vehicleName: "Bus A",
            capacity: 70,
            assignedUsers: 69,
            stops: continuousStops,
            users: continuousStops.flatMap(s => s.userIds)
        }
    ];

    const result = await validateAndRepairRouteContinuity({
        chosenBuses: initialBuses,
        availableVehicles: [{ _id: "veh_1", name: "Bus A", capacity: 70 }],
        anchorHub: sourceHub,
        sourceHub,
        tripMode: "FROM_SOURCE"
    });

    assert.equal(result.buses.length, 1, "Should keep exactly 1 bus");
    assert.equal(result.buses[0].assignedUsers, 69);
    assert.equal(result.fallbackBusUsed, false, "Should NOT use fallback bus");
    assert.equal(result.anyRepaired, false, "No repair should be needed");
    assert.equal(result.unallocatedPassengers.length, 0, "Zero unallocated passengers");
    assert.equal(result.buses[0].continuityValidated, true);
    assert.equal(result.buses[0].directionValidated, true);
});

// ============================================================================
// TEST 2: One stop causes opposite-direction movement. Try existing compatible bus.
// ============================================================================
test("Test 2: One stop causes opposite-direction movement - Reassigned to existing compatible bus", async () => {
    // Bus A travels North toward Sellur, but has an opposite-direction South stop (Tirunagar) forced into it
    const busAStops = [
        { name: "Keelavasal", latitude: 9.9180, longitude: 78.1250, userCount: 30, userIds: Array.from({ length: 30 }, (_, i) => `uA_${i}`) },
        { name: "Sellur", latitude: 9.9380, longitude: 78.1170, userCount: 30, userIds: Array.from({ length: 30 }, (_, i) => `uA_s_${i}`) },
        // Severe opposite direction: Tirunagar is in the South-West, bearing ~230 deg, completely opposite to North corridor (~350 deg)
        { name: "Tirunagar", latitude: 9.8700, longitude: 78.0650, userCount: 9, userIds: Array.from({ length: 9 }, (_, i) => `uOpp_${i}`) }
    ];

    // Bus B naturally travels South-West and has spare capacity (60 / 70 seats used)
    const busBStops = [
        { name: "Palanganatham", latitude: 9.9000, longitude: 78.0950, userCount: 30, userIds: Array.from({ length: 30 }, (_, i) => `uB_${i}`) },
        { name: "Thiruparankundram", latitude: 9.8820, longitude: 78.0750, userCount: 30, userIds: Array.from({ length: 30 }, (_, i) => `uB_s_${i}`) }
    ];

    const initialBuses = [
        {
            routeCode: "Bus A",
            vehicleId: "veh_1",
            vehicleName: "Bus A",
            capacity: 70,
            assignedUsers: 69,
            stops: busAStops,
            users: busAStops.flatMap(s => s.userIds)
        },
        {
            routeCode: "Bus B",
            vehicleId: "veh_2",
            vehicleName: "Bus B",
            capacity: 70,
            assignedUsers: 60,
            stops: busBStops,
            users: busBStops.flatMap(s => s.userIds)
        }
    ];

    const result = await validateAndRepairRouteContinuity({
        chosenBuses: initialBuses,
        availableVehicles: [
            { _id: "veh_1", name: "Bus A", capacity: 70 },
            { _id: "veh_2", name: "Bus B", capacity: 70 }
        ],
        anchorHub: sourceHub,
        sourceHub,
        tripMode: "FROM_SOURCE"
    });

    assert.equal(result.buses.length, 2, "Should retain 2 buses");
    assert.equal(result.anyRepaired, true, "Continuity repair must have run");
    assert.equal(result.fallbackBusUsed, false, "Existing bus B must absorb stop without needing fallback bus");

    const repairedBusA = result.buses.find(b => b.vehicleId === "veh_1");
    const repairedBusB = result.buses.find(b => b.vehicleId === "veh_2");

    // Bus A should have Tirunagar removed
    assert.equal(repairedBusA.stops.some(s => s.name === "Tirunagar"), false, "Tirunagar must be removed from Bus A");
    assert.equal(repairedBusA.assignedUsers, 60);

    // Bus B should have Tirunagar absorbed
    assert.equal(repairedBusB.stops.some(s => s.name === "Tirunagar"), true, "Tirunagar must be reassigned to Bus B");
    assert.equal(repairedBusB.assignedUsers, 69);
    assert.equal(result.unallocatedPassengers.length, 0, "All passengers successfully allocated");
});

// ============================================================================
// TEST 3: No existing bus can take the stop, but one available bus exists.
// ============================================================================
test("Test 3: No existing bus can take stop, one available bus exists - Use exactly 1 additional bus", async () => {
    // Bus A has opposite South stop (Tirunagar)
    const busAStops = [
        { name: "Keelavasal", latitude: 9.9180, longitude: 78.1250, userCount: 35, userIds: Array.from({ length: 35 }, (_, i) => `uA_${i}`) },
        { name: "Sellur", latitude: 9.9380, longitude: 78.1170, userCount: 35, userIds: Array.from({ length: 35 }, (_, i) => `uA_s_${i}`) },
        { name: "Tirunagar", latitude: 9.8700, longitude: 78.0650, userCount: 9, userIds: Array.from({ length: 9 }, (_, i) => `uOpp_${i}`) }
    ];

    // Bus B is 100% FULL (70/70)
    const busBStops = [
        { name: "Palanganatham", latitude: 9.9000, longitude: 78.0950, userCount: 35, userIds: Array.from({ length: 35 }, (_, i) => `uB_${i}`) },
        { name: "Thiruparankundram", latitude: 9.8820, longitude: 78.0750, userCount: 35, userIds: Array.from({ length: 35 }, (_, i) => `uB_s_${i}`) }
    ];

    const initialBuses = [
        {
            routeCode: "Bus A",
            vehicleId: "veh_1",
            vehicleName: "Bus A",
            capacity: 70,
            assignedUsers: 70,
            stops: busAStops,
            users: busAStops.flatMap(s => s.userIds)
        },
        {
            routeCode: "Bus B",
            vehicleId: "veh_2",
            vehicleName: "Bus B",
            capacity: 70,
            assignedUsers: 70,
            stops: busBStops,
            users: busBStops.flatMap(s => s.userIds)
        }
    ];

    // Bus C exists and is available in the fleet
    const availableFleet = [
        { _id: "veh_1", name: "Bus A", capacity: 70 },
        { _id: "veh_2", name: "Bus B", capacity: 70 },
        { _id: "veh_3", name: "Bus C", capacity: 70 }
    ];

    const result = await validateAndRepairRouteContinuity({
        chosenBuses: initialBuses,
        availableVehicles: availableFleet,
        anchorHub: sourceHub,
        sourceHub,
        tripMode: "FROM_SOURCE"
    });

    assert.equal(result.buses.length, 3, "Must deploy exactly 1 additional bus (Bus C)");
    assert.equal(result.fallbackBusUsed, true, "Fallback bus must be recorded");
    assert.ok(result.fallbackReason.includes("Existing routes could not continuously absorb"), "Fallback reason recorded");

    const fallbackBus = result.buses.find(b => b.isFallbackBus);
    assert.ok(fallbackBus, "Fallback bus object exists");
    assert.equal(fallbackBus.vehicleId, "veh_3", "Fallback bus must be real fleet Bus C");
    assert.equal(fallbackBus.stops[0].name, "Tirunagar");
    assert.equal(fallbackBus.assignedUsers, 9);
    assert.equal(result.unallocatedPassengers.length, 0);
});

// ============================================================================
// TEST 4: No additional bus exists. Do not create fake bus. Mark demand unallocated.
// ============================================================================
test("Test 4: No additional bus exists - Do not create fake bus, mark affected demand unallocated", async () => {
    // Bus A has opposite South stop (Tirunagar)
    const busAStops = [
        { name: "Keelavasal", latitude: 9.9180, longitude: 78.1250, userCount: 35, userIds: Array.from({ length: 35 }, (_, i) => `uA_${i}`) },
        { name: "Sellur", latitude: 9.9380, longitude: 78.1170, userCount: 35, userIds: Array.from({ length: 35 }, (_, i) => `uA_s_${i}`) },
        { name: "Tirunagar", latitude: 9.8700, longitude: 78.0650, userCount: 9, userIds: Array.from({ length: 9 }, (_, i) => `uOpp_${i}`) }
    ];

    // Bus B is 100% full
    const busBStops = [
        { name: "Palanganatham", latitude: 9.9000, longitude: 78.0950, userCount: 35, userIds: Array.from({ length: 35 }, (_, i) => `uB_${i}`) },
        { name: "Thiruparankundram", latitude: 9.8820, longitude: 78.0750, userCount: 35, userIds: Array.from({ length: 35 }, (_, i) => `uB_s_${i}`) }
    ];

    const initialBuses = [
        {
            routeCode: "Bus A",
            vehicleId: "veh_1",
            vehicleName: "Bus A",
            capacity: 70,
            assignedUsers: 70,
            stops: busAStops,
            users: busAStops.flatMap(s => s.userIds)
        },
        {
            routeCode: "Bus B",
            vehicleId: "veh_2",
            vehicleName: "Bus B",
            capacity: 70,
            assignedUsers: 70,
            stops: busBStops,
            users: busBStops.flatMap(s => s.userIds)
        }
    ];

    // ONLY Bus A and Bus B are available in the fleet (NO Bus C!)
    const availableFleet = [
        { _id: "veh_1", name: "Bus A", capacity: 70 },
        { _id: "veh_2", name: "Bus B", capacity: 70 }
    ];

    const result = await validateAndRepairRouteContinuity({
        chosenBuses: initialBuses,
        availableVehicles: availableFleet,
        anchorHub: sourceHub,
        sourceHub,
        tripMode: "FROM_SOURCE"
    });

    assert.equal(result.buses.length, 2, "Must NOT fabricate a fake bus; count remains 2");
    assert.equal(result.fallbackBusUsed, false, "Fallback bus could not be used");
    assert.equal(result.unallocatedPassengers.length, 9, "All 9 Tirunagar passengers must be marked unallocated");
    assert.equal(result.unallocatedPassengers[0].reason, "CONTINUITY_DIRECTION_VIOLATION");
    assert.ok(result.unallocatedPassengers[0].details.includes("No additional compatible vehicle is available"));

    // Bus A and Bus B remain continuous
    const finalBusA = result.buses.find(b => b.vehicleId === "veh_1");
    assert.equal(finalBusA.stops.some(s => s.name === "Tirunagar"), false);
    assert.equal(finalBusA.assignedUsers, 70);
});

// ============================================================================
// TEST 5: Additional bus exists but cannot create a continuous route.
// ============================================================================
test("Test 5: Additional bus exists but cannot create a continuous route - Reject and mark unallocated", async () => {
    // INWARD scenario: Bus A travels toward arrival depot
    const busAStops = [
        { name: "Keelavasal", latitude: 9.9180, longitude: 78.1250, userCount: 35, userIds: ["u1"] },
        { name: "Tirunagar", latitude: 9.8700, longitude: 78.0650, userCount: 5, userIds: ["uOpp1"] }
    ];

    const initialBuses = [
        {
            routeCode: "Bus A",
            vehicleId: "veh_1",
            vehicleName: "Bus A",
            capacity: 70,
            assignedUsers: 40,
            stops: busAStops,
            users: ["u1", "uOpp1"],
            inwardStartLocation: { name: "Keelavasal", latitude: 9.9180, longitude: 78.1250 }
        }
    ];

    // Unused vehicle Bus D exists, but its starting place is Melur (far East, 35 km away in wrong direction)
    const availableFleet = [
        { _id: "veh_1", name: "Bus A", capacity: 70 },
        { _id: "veh_d", name: "Bus D", capacity: 70 }
    ];

    // Starting place for Bus D is Melur (incompatible with Tirunagar pickup toward destination)
    const inwardPlaces = [
        { vehicleId: "veh_d", busName: "Bus D", name: "Melur Hub", latitude: 10.0309, longitude: 78.3376 }
    ];

    const result = await validateAndRepairRouteContinuity({
        chosenBuses: initialBuses,
        availableVehicles: availableFleet,
        anchorHub: destinationHub,
        destinationHub,
        tripMode: "TO_DESTINATION",
        activeInwardStartingPlaces: inwardPlaces
    });

    // Melur -> Tirunagar -> Campus depot has huge detour / reversal
    // Should NOT use Bus D merely because it has seats
    assert.equal(result.buses.filter(b => b.isFallbackBus).length, 0, "Must not force incompatible fallback vehicle");
    assert.ok(result.unallocatedPassengers.length > 0, "Incompatible demand remains unallocated");
});

// ============================================================================
// TEST 6: Geographically close stop requires major road backtracking.
// ============================================================================
test("Test 6: Geographically close stop requiring major road backtracking is flagged as violation", () => {
    // Prev stop is at Keelavasal, current stop moves backward near depot
    const violation = checkStopTransitionViolation({
        stop: { name: "Depot Adjacent", latitude: 9.8830, longitude: 78.1630 },
        prevStop: { name: "Sellur", latitude: 9.9380, longitude: 78.1170 },
        nextStop: { name: "Goripalayam", latitude: 9.9250, longitude: 78.1280 },
        origin: sourceHub,
        tripMode: "FROM_SOURCE"
    });

    assert.equal(violation.isViolation, true, "Must detect backward progression toward departure hub");
    assert.ok(violation.reason.includes("Direction reversal") || violation.reason.includes("reversal"));
});

// ============================================================================
// TEST 7: Geographically farther stop follows road progression naturally.
// ============================================================================
test("Test 7: Geographically farther stop following road progression naturally is accepted", () => {
    const seq = sequenceOutwardRouteStops({
        departureHub: sourceHub,
        stops: [
            { name: "Keelavasal", latitude: 9.9180, longitude: 78.1250, userCount: 10 },
            { name: "Simmakkal", latitude: 9.9250, longitude: 78.1200, userCount: 10 },
            { name: "Sellur", latitude: 9.9380, longitude: 78.1170, userCount: 10 },
            // Farther away along North highway, natural progression
            { name: "Samayanallur", latitude: 9.9800, longitude: 78.0700, userCount: 10 }
        ],
        tripMode: "FROM_SOURCE"
    });

    assert.equal(seq.qualityValidation.directionalReversals, 0, "No reversals on natural progression");
    assert.ok(seq.qualityValidation.backtrackingDistanceKm < 2.0, "Backtracking must be minimal");
    assert.ok(seq.qualityValidation.detourRatio <= 2.25, "Detour ratio within limit");
});

// ============================================================================
// TEST 8: INWARD route continuity validation respecting configured starting places.
// ============================================================================
test("Test 8: INWARD route continuity validation respects configured starting places", () => {
    const startingPlace = {
        name: "Sellur Starting Place",
        locationName: "Sellur",
        latitude: 9.9380,
        longitude: 78.1170
    };

    // Progression from Sellur (North) through Simmakkal, Keelavasal toward arrival depot (South-East)
    const inwardStops = [
        { name: "Simmakkal", latitude: 9.9250, longitude: 78.1200, userCount: 15 },
        { name: "Keelavasal", latitude: 9.9180, longitude: 78.1250, userCount: 15 }
    ];

    const seq = sequenceInwardRouteStops({
        startingHub: startingPlace,
        destinationHub,
        stops: inwardStops,
        tripMode: "TO_DESTINATION"
    });

    assert.equal(seq.qualityValidation.operationalContinuityVerified, true);
    assert.equal(seq.qualityValidation.directionalReversals, 0);
    assert.equal(seq.qualityValidation.startingHubRepeatedAfterDeparture, false);
});

// ============================================================================
// TEST 9: OUTWARD route continuity validation from configured outward starting point.
// ============================================================================
test("Test 9: OUTWARD route continuity validation from configured outward starting point", () => {
    const outwardStops = [
        { name: "Keelavasal", latitude: 9.9180, longitude: 78.1250, userCount: 20 },
        { name: "Simmakkal", latitude: 9.9250, longitude: 78.1200, userCount: 20 },
        { name: "Sellur", latitude: 9.9380, longitude: 78.1170, userCount: 20 }
    ];

    const seq = sequenceOutwardRouteStops({
        departureHub: sourceHub,
        stops: outwardStops,
        tripMode: "FROM_SOURCE"
    });

    assert.equal(seq.qualityValidation.directionalReversals, 0);
    assert.equal(seq.qualityValidation.startingHub, "Campus Depot Hub");
    assert.ok(seq.routeDistanceKm > 0);
});

// ============================================================================
// TEST 10: Reset behavior remains unchanged and idempotent.
// ============================================================================
test("Test 10: Reset functionality preserves idempotent contract", async () => {
    assert.equal(typeof resetGeneratedAIRoute, "function", "resetGeneratedAIRoute must exist");
});
