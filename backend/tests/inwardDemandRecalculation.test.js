import test from "node:test";
import assert from "node:assert/strict";

import {
    isBusHubSuitableForStops,
    findStartingPlaceForBus,
    isStopNearOrAlongRoute,
    allocateVehiclesToDemandClusters
} from "../services/aiAgentService.js";

import {
    assignVehiclesToOptimizedRoutes
} from "../services/routeOptimizationService.js";

test("Inward Demand Recalculation & Strict Geographic Bus Change Constraints", async (t) => {

    // Configured inward starting places
    // Othakadai: East/Melur Road
    const othakadaiHub = {
        _id: "sp_othakadai",
        vehicleId: "veh_k1",
        busId: "veh_k1",
        busName: "K1",
        capacity: 50,
        locationName: "Othakadai Bus Stand",
        name: "Othakadai Bus Stand",
        latitude: 9.9678,
        longitude: 78.1925,
        active: true
    };

    // Thiruppalai: North Madurai (~8km away from Othakadai)
    const thiruppalaiHub = {
        _id: "sp_thiruppalai",
        vehicleId: "veh_k2",
        busId: "veh_k2",
        busName: "K2",
        capacity: 70,
        locationName: "Thiruppalai Bus Stand",
        name: "Thiruppalai Bus Stand",
        latitude: 9.9800,
        longitude: 78.1400,
        active: true
    };

    // Second bus configured at Othakadai (larger capacity vehicle K4)
    const othakadaiLargeHub = {
        _id: "sp_k4_othakadai",
        vehicleId: "veh_k4",
        busId: "veh_k4",
        busName: "K4",
        capacity: 75,
        locationName: "Othakadai Bus Stand",
        name: "Othakadai Bus Stand",
        latitude: 9.9678,
        longitude: 78.1925,
        active: true
    };

    const startingPlaces = [othakadaiHub, thiruppalaiHub, othakadaiLargeHub];

    // Stops in Othakadai area
    const othakadaiStops = [
        {
            name: "Othakadai Market",
            latitude: 9.9690,
            longitude: 78.1930,
            passengerCount: 20
        },
        {
            name: "High Court Bench",
            latitude: 9.9580,
            longitude: 78.1750,
            passengerCount: 15
        }
    ];

    // ── 1. Unit Check: isBusHubSuitableForStops ──
    await t.test("1. isBusHubSuitableForStops: correctly identifies suitable vs distant starting hubs", () => {
        const busK1 = { vehicleId: "veh_k1", vehicleName: "K1", capacity: 50 };
        const busK2 = { vehicleId: "veh_k2", vehicleName: "K2", capacity: 70 };

        // Bus K1 (hub = Othakadai) is very close to Othakadai stops (~0.1 - 2.0 km)
        const checkK1 = isBusHubSuitableForStops(busK1, othakadaiStops, startingPlaces);
        assert.equal(checkK1.suitable, true, "K1 must be suitable for Othakadai stops");
        assert.ok(checkK1.distanceKm < 2.5, "Distance from Othakadai hub to Othakadai stops should be < 2.5km");

        // Bus K2 (hub = Thiruppalai) is far from Othakadai stops (> 6.5 km across town)
        const checkK2 = isBusHubSuitableForStops(busK2, othakadaiStops, startingPlaces);
        assert.equal(checkK2.suitable, false, "K2 must NOT be suitable for Othakadai stops");
        assert.ok(checkK2.distanceKm > 5.0, "Distance from Thiruppalai hub to Othakadai stops should be > 5.0km");
    });

    // ── 2. Route Assignment: Capacity alone must NOT cause bus replacement ──
    await t.test("2. assignVehiclesToOptimizedRoutes: K2 (Thiruppalai) must NOT replace K1 (Othakadai) merely due to free seats", () => {
        const routeOthakadai = {
            routeCode: "RT-01",
            assignedUsers: 35,
            stops: othakadaiStops
        };

        const availableVehicles = [
            { _id: "veh_k2", vehicleName: "K2", capacity: 70, seatCapacity: 70 }, // 70 seats, Thiruppalai hub
            { _id: "veh_k1", vehicleName: "K1", capacity: 50, seatCapacity: 50 }  // 50 seats, Othakadai hub
        ];

        // Demand is 35. Both K1 (50) and K2 (70) have capacity.
        // A naive capacity/order algorithm might select K2 (either because sorted first, or 70 seats).
        // The STRICT geographic constraint MUST select K1 because K1's hub is near Othakadai, while K2's hub is NOT!
        const result = assignVehiclesToOptimizedRoutes({
            routes: [routeOthakadai],
            availableVehicles,
            tripMode: "TO_DESTINATION",
            activeInwardStartingPlaces: startingPlaces
        });

        assert.equal(result.assignedRoutes.length, 1);
        const assigned = result.assignedRoutes[0];
        assert.equal(assigned.vehicleName, "K1", "Must assign K1 whose hub is Othakadai, NOT K2");
        assert.notEqual(assigned.vehicleName, "K2", "Must NOT assign K2 (Thiruppalai hub) to Othakadai stops");
    });

    // ── 3. Keep Existing Bus if Suitable under Demand Changes ──
    await t.test("3. Keep existing bus when demand changes within its available capacity", () => {
        // Suppose current plan had K1 assigned to RT-01.
        // Demand changes from 35 to 45 (more students coming at High Court Bench).
        // Since K1 capacity = 50, K1 is still suitable (45 <= 50).
        const routeWithChangedDemand = {
            routeCode: "RT-01",
            vehicleId: "veh_k1",
            vehicleName: "K1",
            assignedUsers: 45,
            stops: othakadaiStops
        };

        const availableVehicles = [
            { _id: "veh_k1", vehicleName: "K1", capacity: 50, seatCapacity: 50 },
            { _id: "veh_k2", vehicleName: "K2", capacity: 70, seatCapacity: 70 }
        ];

        const result = assignVehiclesToOptimizedRoutes({
            routes: [routeWithChangedDemand],
            availableVehicles,
            tripMode: "TO_DESTINATION",
            activeInwardStartingPlaces: startingPlaces
        });

        assert.equal(result.assignedRoutes.length, 1);
        assert.equal(result.assignedRoutes[0].vehicleName, "K1", "K1 must be retained as existing bus");
    });

    // ── 4. Strict Reassignment Rule when Demand Exceeds Existing Bus ──
    await t.test("4. Bus Change: When demand exceeds K1, K2 (distant hub) is REJECTED, but K4 (nearby hub) is ACCEPTED", () => {
        // Demand increases to 65 passengers (exceeding K1's 50 seats).
        const heavyDemandRoute = {
            routeCode: "RT-01",
            vehicleId: "veh_k1",
            vehicleName: "K1",
            assignedUsers: 65,
            stops: othakadaiStops
        };

        // Scenario 4A: Only K1 (50 seats) and K2 (70 seats, Thiruppalai hub) available.
        // K1 cannot fit 65 passengers.
        // K2 has 70 seats, BUT its hub is Thiruppalai (not near Othakadai).
        // System must NOT force K2!
        const resultScenarioA = assignVehiclesToOptimizedRoutes({
            routes: [heavyDemandRoute],
            availableVehicles: [
                { _id: "veh_k1", vehicleName: "K1", capacity: 50, seatCapacity: 50 },
                { _id: "veh_k2", vehicleName: "K2", capacity: 70, seatCapacity: 70 }
            ],
            tripMode: "TO_DESTINATION",
            activeInwardStartingPlaces: startingPlaces
        });

        assert.equal(
            resultScenarioA.assignedRoutes.length,
            0,
            "K2 must NOT be assigned to Othakadai stops because its hub is not near the area"
        );
        assert.equal(
            resultScenarioA.unassignedRoutes.length,
            1,
            "Route remains unassigned rather than forcing an unsuitable distant bus"
        );

        // Scenario 4B: Now K4 (75 seats, Othakadai hub) IS available.
        // K4 has capacity >= 65 AND its hub is Othakadai.
        // The bus change to K4 is PERMITTED!
        const resultScenarioB = assignVehiclesToOptimizedRoutes({
            routes: [heavyDemandRoute],
            availableVehicles: [
                { _id: "veh_k1", vehicleName: "K1", capacity: 50, seatCapacity: 50 },
                { _id: "veh_k2", vehicleName: "K2", capacity: 70, seatCapacity: 70 },
                { _id: "veh_k4", vehicleName: "K4", capacity: 75, seatCapacity: 75 }
            ],
            tripMode: "TO_DESTINATION",
            activeInwardStartingPlaces: startingPlaces
        });

        assert.equal(resultScenarioB.assignedRoutes.length, 1);
        assert.equal(resultScenarioB.assignedRoutes[0].vehicleName, "K4", "K4 must be assigned because its hub is Othakadai");
    });

    // ── 5. OUTWARD Independence: Outward routes are NOT constrained by inward hub rules ──
    await t.test("5. OUTWARD vehicle assignment is 100% unconstrained by inward starting places", () => {
        const outwardRoute = {
            routeCode: "RT-OUT-01",
            assignedUsers: 65,
            stops: othakadaiStops
        };

        const resultOutward = assignVehiclesToOptimizedRoutes({
            routes: [outwardRoute],
            availableVehicles: [
                { _id: "veh_k1", vehicleName: "K1", capacity: 50, seatCapacity: 50 },
                { _id: "veh_k2", vehicleName: "K2", capacity: 70, seatCapacity: 70 }
            ],
            tripMode: "FROM_SOURCE",
            activeInwardStartingPlaces: startingPlaces
        });

        assert.equal(resultOutward.assignedRoutes.length, 1);
        assert.equal(resultOutward.assignedRoutes[0].vehicleName, "K2", "Outward route can use K2 normally");
    });

    // ── 6. Clarification Rule: Alternative bus hub does NOT need to be close to affected stop ──
    // Strict condition: Stop must be near/along the alternative bus's existing route without unreasonable detour!
    await t.test("6. User Clarification Scenario: K2 accommodates Stop 3 because Stop 3 is along K2's route, even though Hub B is distant", () => {
        const college = { latitude: 9.9200, longitude: 78.1200, name: "College" };

        // Bus K1: Hub A → Stop 1 → Stop 2 → Stop 3 → College
        const hubA = { latitude: 9.9700, longitude: 78.1900, name: "Hub A (Othakadai)" };
        const stop1 = { latitude: 9.9650, longitude: 78.1800, name: "Stop 1" };
        const stop2 = { latitude: 9.9600, longitude: 78.1700, name: "Stop 2" };
        const stop3 = { latitude: 9.9500, longitude: 78.1580, name: "Stop 3" };

        const routeK1 = {
            vehicleName: "K1",
            startLocation: hubA,
            stops: [stop1, stop2, stop3],
            remainingSeats: 0 // K1 is full
        };

        // Bus K2: Hub B (Thiruppalai - distant from Stop 3) → Stop 4 → Stop 5 → Stop 6 → College
        const hubB = { latitude: 9.9900, longitude: 78.1300, name: "Hub B (Thiruppalai)" };
        const stop4 = { latitude: 9.9560, longitude: 78.1550, name: "Stop 4" };
        const stop5 = { latitude: 9.9420, longitude: 78.1450, name: "Stop 5" };
        const stop6 = { latitude: 9.9320, longitude: 78.1320, name: "Stop 6" };

        const routeK2 = {
            vehicleName: "K2",
            startLocation: hubB,
            stops: [stop4, stop5, stop6],
            remainingSeats: 10 // K2 has 10 seats
        };

        // Bus K3: Hub C (Thirunagar - completely different southern corridor) → Stop 7 → Stop 8 → College
        const hubC = { latitude: 9.8750, longitude: 78.0750, name: "Hub C (Thirunagar)" };
        const stop7 = { latitude: 9.8850, longitude: 78.0850, name: "Stop 7" };
        const stop8 = { latitude: 9.9000, longitude: 78.1000, name: "Stop 8" };

        const routeK3 = {
            vehicleName: "K3",
            startLocation: hubC,
            stops: [stop7, stop8],
            remainingSeats: 20 // K3 has 20 free seats across town
        };

        // Check K2 suitability for Stop 3:
        // Distance from Hub B to Stop 3 is > 5.3 km.
        // But Stop 3 is right next to Stop 4 on K2's route (~0.7 km away).
        // Adding Stop 3 creates an insertion detour of only ~0.8 km (<= 5.0 km).
        const checkK2 = isStopNearOrAlongRoute({
            stop: stop3,
            route: routeK2,
            sourceHub: hubB,
            destinationHub: college,
            maxDetourKm: 5.0,
            maxProximityKm: 5.5
        });

        assert.equal(checkK2.suitable, true, "K2 must be suitable because Stop 3 is near/along K2's route");
        assert.ok(checkK2.distanceKm <= 1.5, `Proximity to K2 route should be close (was ${checkK2.distanceKm}km)`);
        assert.ok(checkK2.detourKm <= 2.0, `Detour on K2 route should be minimal (was ${checkK2.detourKm}km)`);

        // Check K3 suitability for Stop 3:
        // Stop 3 is in North-East Madurai; K3 route is in South-West Madurai (> 8 km away).
        // Adding Stop 3 creates an unreasonable detour.
        const checkK3 = isStopNearOrAlongRoute({
            stop: stop3,
            route: routeK3,
            sourceHub: hubC,
            destinationHub: college,
            maxDetourKm: 5.0,
            maxProximityKm: 5.5
        });

        assert.equal(checkK3.suitable, false, "K3 must NOT be suitable merely because it has 20 free seats");
        assert.ok(checkK3.distanceKm > 5.5, `Stop 3 must be far from K3 route (was ${checkK3.distanceKm}km)`);
    });

    // ── 7. Allocation Logic: Unaccommodated demand is NOT forced onto unsuitable buses ──
    await t.test("7. allocateVehiclesToDemandClusters: Does not force assignment onto an unsuitable distant bus", () => {
        const college = { latitude: 9.9200, longitude: 78.1200, name: "College" };

        // Two stops in Corridor East (Othakadai), total 45 passengers
        const eastStops = [
            {
                name: "Othakadai Market",
                latitude: 9.9690,
                longitude: 78.1930,
                userCount: 25,
                userIds: Array.from({ length: 25 }, (_, i) => `u_east_${i + 1}`)
            },
            {
                name: "High Court Bench",
                latitude: 9.9580,
                longitude: 78.1750,
                userCount: 20,
                userIds: Array.from({ length: 20 }, (_, i) => `u_court_${i + 1}`)
            }
        ];

        // One stop in Corridor South (Thirunagar), 30 passengers
        const southStops = [
            {
                name: "Thirunagar Bus Stand",
                latitude: 9.8750,
                longitude: 78.0750,
                userCount: 30,
                userIds: Array.from({ length: 30 }, (_, i) => `u_south_${i + 1}`)
            }
        ];

        // Only 1 vehicle available for East (capacity 35). So 10 East passengers overflow!
        // 1 vehicle available for South (capacity 50). So South vehicle has 20 free seats remaining!
        const availableVehicles = [
            { _id: "veh_east_1", vehicleName: "East Bus 1", capacity: 35, seatCapacity: 35 },
            { _id: "veh_south_1", vehicleName: "South Bus 1", capacity: 50, seatCapacity: 50 }
        ];

        const allocation = allocateVehiclesToDemandClusters({
            resolvedStops: [...eastStops, ...southStops],
            availableVehicles,
            anchorHub: college
        });

        // The South bus has empty seats (cap 35 - 30 demand = 5 remaining seats).
        // But the East stop (High Court Bench) is > 12 km away from South corridor.
        // The system must NOT dump overflow East students onto the South bus!
        const southBusCluster = allocation.busClusters.find((b) =>
            b.stops.some((s) => s.name === "Thirunagar Bus Stand")
        );
        assert.ok(southBusCluster, "South bus cluster must exist");

        // Verify that South Bus stops ONLY contain South stops, NOT East stops!
        const hasEastStopInSouthBus = southBusCluster.stops.some(
            (s) => s.name === "Othakadai Market" || s.name === "High Court Bench"
        );
        assert.equal(
            hasEastStopInSouthBus,
            false,
            "South Bus must NOT serve Othakadai or High Court Bench stops merely because it had free seats!"
        );
        assert.ok(southBusCluster.remainingSeats > 0, "South bus has free seats remaining without forcing East assignment");
    });

    await t.test("8. Standing Passenger Fallback: Extra students stay on original bus when no suitable alternative exists", () => {
        // Scenario matches the user's exact example:
        // K1 capacity = 70, K1 current passengers = 70
        // New demand = +5 at a stop on K1's route
        // ONLY ONE BUS AVAILABLE (capacity 70), so 5 students overflow into Step B.
        // No alternative bus available at all → standing fallback triggers on K1 bus.
        // Expected result: K1 = 75 passengers, seated = 70, standing = 5, isOverCapacity = true

        const college = { name: "College", latitude: 9.9252, longitude: 78.1198 };

        // All 75 students on the same K1 east-approach corridor
        const k1Stops = [
            {
                name: "Mattuthavani Stop A",
                latitude: 9.8760,
                longitude: 78.0890,
                users: Array.from({ length: 20 }, (_, i) => ({ _id: `k1_u${i + 1}` }))
            },
            {
                name: "Mattuthavani Stop B",
                latitude: 9.8790,
                longitude: 78.0920,
                users: Array.from({ length: 25 }, (_, i) => ({ _id: `k1_u${i + 21}` }))
            },
            {
                // This stop has extra students: 20+25+30 = 75 total, but K1 bus capacity = 70
                name: "Mattuthavani Stop C",
                latitude: 9.8810,
                longitude: 78.0950,
                users: Array.from({ length: 30 }, (_, i) => ({ _id: `k1_u${i + 46}` }))
            }
        ];
        // Total demand = 75. Only 1 vehicle available (capacity 70). 5 will overflow to Step B.

        const resolvedStops = [...k1Stops];

        // ONLY ONE VEHICLE AVAILABLE — capacity 70, demand 75 → 5 leftover in Step B
        const availableVehicles = [
            { _id: "k1_vehicle", vehicleName: "KBS-001", capacity: 70, seatCapacity: 70 }
        ];

        const { busClusters } = allocateVehiclesToDemandClusters({
            resolvedStops,
            availableVehicles,
            anchorHub: college
        });

        // Find K1's bus cluster (serves Mattuthavani stops)
        const k1Cluster = busClusters.find((b) =>
            b.stops.some((s) => s.name.includes("Mattuthavani"))
        );

        assert.ok(k1Cluster, "K1 bus cluster must exist for Mattuthavani corridor");

        // CRITICAL: K1 had demand 75, capacity 70. 5 students must be standing.
        // isOverCapacity must be true
        assert.equal(
            k1Cluster.isOverCapacity,
            true,
            "K1 bus must be marked isOverCapacity=true when 75 passengers > 70 capacity"
        );

        // standingPassengers must be 5
        assert.ok(
            (k1Cluster.standingPassengers || 0) > 0,
            "K1 bus must have standingPassengers > 0 (extra students kept on board)"
        );

        // seatedPassengers must equal capacity (70)
        assert.equal(
            k1Cluster.seatedPassengers,
            70,
            "K1 bus seated passengers must equal its capacity (70)"
        );

        // overCapacityCount must be 5
        assert.ok(
            (k1Cluster.overCapacityCount || 0) > 0,
            "K1 bus overCapacityCount must be > 0"
        );

        // Total assigned = 75 (no students left unallocated)
        assert.ok(
            k1Cluster.assignedUsers >= 75,
            "K1 bus total assignedUsers must be >= 75 (all 75 students allocated)"
        );

        // All 75 student IDs must be in the bus users list
        assert.ok(
            k1Cluster.users.length >= 75,
            "All 75 K1 corridor students must be in K1 bus users list (seated + standing)"
        );
    });
});

