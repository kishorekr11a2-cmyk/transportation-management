import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import InwardStartingPlace from "../models/InwardStartingPlace.js";
import {
    findStartingPlaceForBus,
    calculateRequiredFleet,
    buildAIPlan,
    generateAgentRecommendations
} from "../services/aiAgentService.js";

test("Inward Starting Places Feature Comprehensive Test Suite", async (t) => {

    const mockMattuthavani = {
        _id: "sp_mattuthavani_01",
        vehicleId: "veh_k3",
        busId: "veh_k3",
        busName: "K3",
        capacity: 50,
        locationName: "Mattuthavani Bus Stand",
        name: "Mattuthavani Bus Stand",
        address: "Melur Main Road, Mattuthavani, Madurai",
        latitude: 9.9408,
        longitude: 78.1565,
        active: true
    };

    const mockOthakadai = {
        _id: "sp_othakadai_02",
        vehicleId: "veh_k1",
        busId: "veh_k1",
        busName: "K1",
        capacity: 50,
        locationName: "Othakadai Bus Stand",
        name: "Othakadai Bus Stand",
        address: "Othakadai, Madurai",
        latitude: 9.9678,
        longitude: 78.1925,
        active: true
    };

    const mockThiruppalai = {
        _id: "sp_thiruppalai_03",
        vehicleId: "veh_k2",
        busId: "veh_k2",
        busName: "K2",
        capacity: 50,
        locationName: "Thiruppalai Bus Stand",
        name: "Thiruppalai Bus Stand",
        address: "Thiruppalai, Madurai",
        latitude: 9.9800,
        longitude: 78.1400,
        active: true
    };

    const mockArapalayamInactive = {
        _id: "sp_arapalayam_04",
        vehicleId: "veh_k4",
        busId: "veh_k4",
        busName: "K4",
        capacity: 50,
        locationName: "Arapalayam Bus Stand",
        name: "Arapalayam Bus Stand",
        address: "Palam Station Road, Arapalayam, Madurai",
        latitude: 9.9328,
        longitude: 78.1098,
        active: false // Inactive test case
    };

    const mockDestinationCollege = {
        name: "KLN College of Engineering",
        latitude: 9.8515,
        longitude: 78.1882
    };

    // ── 1. Model Structure & Field Persistence Checks ──
    await t.test("1. InwardStartingPlace Model structure validates required fields & ID persistence", () => {
        const place = new InwardStartingPlace({
            vehicleId: "veh_12345",
            busId: "veh_12345",
            busName: "K1",
            capacity: 70,
            locationName: "Othakadai Bus Stand",
            address: "Sample Address",
            latitude: 9.9678,
            longitude: 78.1925,
            active: true
        });

        assert.equal(place.vehicleId, "veh_12345");
        assert.equal(place.busId, "veh_12345");
        assert.equal(place.busName, "K1");
        assert.equal(place.capacity, 70);
        assert.equal(place.locationName, "Othakadai Bus Stand");
        assert.equal(place.latitude, 9.9678);
        assert.equal(place.longitude, 78.1925);
        assert.equal(place.active, true);
    });

    // ── 2. findStartingPlaceForBus: ID-First Matching & Name Fallback ──
    await t.test("2. findStartingPlaceForBus prioritizes vehicleId and falls back to busName", () => {
        const activePlaces = [mockOthakadai, mockThiruppalai, mockMattuthavani, mockArapalayamInactive];

        // 2a. Match by exact vehicleId even if vehicleName differs (e.g. vehicle renamed)
        const busWithRenamedName = { vehicleId: "veh_k1", vehicleName: "K1 - Renamed Express" };
        const foundById = findStartingPlaceForBus(busWithRenamedName, activePlaces);
        assert.ok(foundById, "Should match by vehicleId");
        assert.equal(foundById.locationName, "Othakadai Bus Stand");

        // 2b. Match by busName when vehicleId is missing
        const busWithNameOnly = { vehicleName: "K3" };
        const foundByName = findStartingPlaceForBus(busWithNameOnly, activePlaces);
        assert.ok(foundByName, "Should match by busName");
        assert.equal(foundByName.locationName, "Mattuthavani Bus Stand");

        // 2c. Inactive place must NOT be matched
        const busK4 = { vehicleId: "veh_k4", vehicleName: "K4" };
        const foundK4 = findStartingPlaceForBus(busK4, activePlaces);
        assert.equal(foundK4, null, "Inactive starting place must not be returned");

        // 2d. Unknown bus returns null
        const busK5 = { vehicleId: "veh_k5", vehicleName: "K5" };
        const foundK5 = findStartingPlaceForBus(busK5, activePlaces);
        assert.equal(foundK5, null, "Unconfigured bus must return null");
    });

    // ── 3. calculateRequiredFleet: Dynamic derivation without hard-coding ──
    await t.test("3. calculateRequiredFleet accurately derives fleet size and capacity dynamically", () => {
        const fleet = [
            { _id: "v1", vehicleName: "K1", capacity: 70 },
            { _id: "v2", vehicleName: "K2", capacity: 50 },
            { _id: "v3", vehicleName: "K3", capacity: 50 }
        ];

        // 60 students: 1 bus (K1 with 70 seats) is sufficient
        const req60 = calculateRequiredFleet(60, fleet);
        assert.equal(req60.requiredBusesCount, 1);
        assert.equal(req60.requiredCapacity, 70);

        // 110 students: 2 buses (K1 70 + K2 50 = 120 seats)
        const req110 = calculateRequiredFleet(110, fleet);
        assert.equal(req110.requiredBusesCount, 2);
        assert.equal(req110.requiredCapacity, 120);

        // 160 students: 3 buses (K1 70 + K2 50 + K3 50 = 170 seats)
        const req160 = calculateRequiredFleet(160, fleet);
        assert.equal(req160.requiredBusesCount, 3);
        assert.equal(req160.requiredCapacity, 170);
    });

    // ── 4. Validation: No Inward Starting Places Configured ──
    await t.test("4. Inward generation returns error when zero active starting places exist", async () => {
        const origReadyState = mongoose.connection.readyState;
        Object.defineProperty(mongoose.connection, "readyState", { value: 1, configurable: true });
        try {
            const result = await generateAgentRecommendations({
                direction: "INWARD",
                tripMode: "TO_DESTINATION",
                destination: mockDestinationCollege,
                activeInwardStartingPlaces: []
            });

            assert.equal(result.success, false);
            assert.equal(result.code, "NO_INWARD_STARTING_PLACES");
            assert.ok(result.message.includes("No inward starting places configured."));
            assert.ok(result.message.includes("Please add a starting place for the required inward buses before generating the inward transportation plan."));
        } finally {
            Object.defineProperty(mongoose.connection, "readyState", { value: origReadyState, configurable: true });
        }
    });

    // ── 5. CRITICAL VALIDATION: Exact Selected Bus Validation (Count Match is NOT Enough) ──
    await t.test("5. Exact Selected Bus Validation: FAILS when AI selects K1, K3, K5 but configured are K1, K2, K3", async () => {
        // Demand requiring 3 buses
        const stops = [
            {
                name: "Stop A",
                latitude: 9.9400,
                longitude: 78.1500,
                userCount: 45,
                userIds: Array.from({ length: 45 }, (_, i) => `u_a_${i}`)
            },
            {
                name: "Stop B",
                latitude: 9.9600,
                longitude: 78.1800,
                userCount: 45,
                userIds: Array.from({ length: 45 }, (_, i) => `u_b_${i}`)
            },
            {
                name: "Stop C",
                latitude: 9.9800,
                longitude: 78.1300,
                userCount: 45,
                userIds: Array.from({ length: 45 }, (_, i) => `u_c_${i}`)
            }
        ];

        // Fleet has K1, K3, K5
        const availableVehicles = [
            { _id: "veh_k1", vehicleName: "K1", capacity: 50, seatCapacity: 50 },
            { _id: "veh_k3", vehicleName: "K3", capacity: 50, seatCapacity: 50 },
            { _id: "veh_k5", vehicleName: "K5", capacity: 50, seatCapacity: 50 }
        ];

        // Admin configured 3 starting places, but for K1, K2, K3 (K2 is configured, but NOT in selected buses; K5 is selected, but has NO starting place!)
        // Total count configured = 3. Total count required = 3.
        // A naive count check (3 === 3) would mistakenly PASS.
        // The EXACT selected bus validation MUST FAIL because K5 is missing!
        const configuredPlaces = [mockOthakadai, mockThiruppalai, mockMattuthavani]; // K1, K2, K3

        await assert.rejects(
            async () => {
                await buildAIPlan({
                    destinationHub: mockDestinationCollege,
                    tripMode: "TO_DESTINATION",
                    resolvedStops: stops,
                    availableVehicles,
                    rawVehicles: availableVehicles,
                    totalComingUsers: 135,
                    allUsersCount: 135,
                    totalAvailableCapacity: 150,
                    physicalFleetCapacity: 150,
                    confirmedUsers: stops.flatMap((s) => s.userIds.map((id) => ({ _id: id, userId: id }))),
                    activeInwardStartingPlaces: configuredPlaces
                });
            },
            (err) => {
                assert.equal(err.code, "INWARD_STARTING_PLACES_INCOMPLETE");
                assert.ok(err.missingBuses.includes("K5"), "Must explicitly identify K5 as missing");
                assert.ok(err.message.includes("Missing starting location for: K5"));
                assert.ok(err.message.includes("⚠️ Inward Starting Locations Incomplete"));
                return true;
            }
        );
    });

    // ── 6. Inward Route Origin & Waypoint Construction ──
    await t.test("6. Every selected inward bus starts from its EXACT configured origin and links stops[0].previousStopName", async () => {
        const stops = [
            {
                name: "Thiruppalai Stop",
                latitude: 9.9800,
                longitude: 78.1400,
                userCount: 20,
                userIds: Array.from({ length: 20 }, (_, i) => `user_${i + 1}`)
            }
        ];

        const vehicles = [
            { _id: "veh_k1", vehicleName: "K1", capacity: 50, seatCapacity: 50 }
        ];

        const plan = await buildAIPlan({
            destinationHub: mockDestinationCollege,
            tripMode: "TO_DESTINATION",
            resolvedStops: stops,
            availableVehicles: vehicles,
            rawVehicles: vehicles,
            totalComingUsers: 20,
            allUsersCount: 20,
            totalAvailableCapacity: 50,
            physicalFleetCapacity: 50,
            confirmedUsers: stops.flatMap((s) => s.userIds.map((id) => ({ _id: id, userId: id }))),
            activeInwardStartingPlaces: [mockOthakadai] // K1 -> Othakadai
        });

        assert.ok(plan, "Plan must be built");
        assert.equal(plan.buses.length, 1);

        const bus = plan.buses[0];
        assert.equal(bus.direction, "INWARD");
        assert.equal(bus.startLocation?.locationName, "Othakadai Bus Stand");
        assert.equal(bus.inwardStartLocation?.locationName, "Othakadai Bus Stand");
        assert.equal(bus.sourceHub?.locationName, "Othakadai Bus Stand");

        // First pickup stop must have previousStopName as the starting location
        assert.equal(bus.stops[0].previousStopName, "Othakadai Bus Stand");
    });

    // ── 7. OUTWARD Independence: Outward does NOT require Inward Starting Places ──
    await t.test("7. OUTWARD generation is 100% unaffected and does not require inward starting places", async () => {
        const result = await generateAgentRecommendations({
            direction: "OUTWARD",
            tripMode: "FROM_SOURCE",
            source: mockDestinationCollege
        });

        assert.notEqual(result.code, "NO_INWARD_STARTING_PLACES");
        assert.notEqual(result.code, "INWARD_STARTING_PLACES_INCOMPLETE");
    });

    // ── 8. User Scenario: 6 buses required (397 Coming Users) with 6 configured buses (A2, AS@, D1, J1, V1, k1) and unconfigured buses (w1 with 60 seats) ──
    await t.test("8. Inward Route Generation: AI selects all 6 configured buses and does NOT arbitrarily pick unconfigured w1", async () => {
        // 397 students across 6 stopping areas
        const stopDemands = [68, 67, 66, 65, 66, 65]; // sum = 397
        const stopCoords = [
            { name: "KK Nagar Stop", latitude: 9.9180, longitude: 78.1470 },
            { name: "Vandiyur Stop", latitude: 9.9120, longitude: 78.1650 },
            { name: "Thiruppalai Stop", latitude: 9.9800, longitude: 78.1400 },
            { name: "B B Kulam Stop", latitude: 9.9450, longitude: 78.1320 },
            { name: "Othakadai Stop", latitude: 9.9678, longitude: 78.1925 },
            { name: "Walk-King Stop", latitude: 9.9200, longitude: 78.1500 }
        ];

        let userCounter = 0;
        const resolvedStops = stopCoords.map((sc, idx) => {
            const count = stopDemands[idx];
            const ids = Array.from({ length: count }, () => `u_in_${++userCounter}`);
            return {
                name: sc.name,
                latitude: sc.latitude,
                longitude: sc.longitude,
                userCount: count,
                userIds: ids
            };
        });

        // 6 Configured Buses (70 seats each = 420 seats)
        const configuredBuses = [
            { _id: "veh_A2", vehicleName: "A2", capacity: 70, seatCapacity: 70 },
            { _id: "veh_AS", vehicleName: "AS@", capacity: 70, seatCapacity: 70 },
            { _id: "veh_D1", vehicleName: "D1", capacity: 70, seatCapacity: 70 },
            { _id: "veh_J1", vehicleName: "J1", capacity: 70, seatCapacity: 70 },
            { _id: "veh_V1", vehicleName: "V1", capacity: 70, seatCapacity: 70 },
            { _id: "veh_k1", vehicleName: "k1", capacity: 70, seatCapacity: 70 }
        ];

        // Unconfigured Buses in schedule (e.g. w1 with 60 seats)
        const unconfiguredBuses = [
            { _id: "veh_w1", vehicleName: "w1", capacity: 60, seatCapacity: 60 },
            { _id: "veh_w2", vehicleName: "w2", capacity: 60, seatCapacity: 60 },
            { _id: "veh_q1", vehicleName: "Q1", capacity: 50, seatCapacity: 50 }
        ];

        const availableVehicles = [...configuredBuses, ...unconfiguredBuses];

        const configuredPlaces = [
            { busId: "veh_A2", busName: "A2", locationName: "KK Nagar", latitude: 9.9180, longitude: 78.1470, active: true },
            { busId: "veh_AS", busName: "AS@", locationName: "Vandiyur", latitude: 9.9120, longitude: 78.1650, active: true },
            { busId: "veh_D1", busName: "D1", locationName: "Thiruppalai", latitude: 9.9800, longitude: 78.1400, active: true },
            { busId: "veh_J1", busName: "J1", locationName: "B B Kulam", latitude: 9.9450, longitude: 78.1320, active: true },
            { busId: "veh_V1", busName: "V1", locationName: "Othakadai", latitude: 9.9678, longitude: 78.1925, active: true },
            { busId: "veh_k1", busName: "k1", locationName: "Walk-King Shoe Company - KK Nagar", latitude: 9.9210, longitude: 78.1490, active: true }
        ];

        const confirmedUsers = resolvedStops.flatMap(s => s.userIds.map(id => ({ _id: id, userId: id })));

        const plan = await buildAIPlan({
            destinationHub: mockDestinationCollege,
            tripMode: "TO_DESTINATION",
            resolvedStops,
            availableVehicles,
            rawVehicles: availableVehicles,
            totalComingUsers: 397,
            allUsersCount: 397,
            totalAvailableCapacity: 590,
            physicalFleetCapacity: 590,
            confirmedUsers,
            activeInwardStartingPlaces: configuredPlaces
        });

        assert.ok(plan, "Inward plan should generate successfully");
        assert.equal(plan.buses.length, 6, "Must select exactly 6 buses");

        const selectedNames = plan.buses.map(b => b.vehicleName);
        assert.ok(!selectedNames.includes("w1"), "Unconfigured vehicle w1 must NOT be selected when 6 configured vehicles can satisfy demand");

        // Every selected vehicle MUST have a configured starting location
        for (const bus of plan.buses) {
            assert.ok(bus.startLocation, `Bus ${bus.vehicleName} must have a startLocation`);
            assert.ok(bus.inwardStartLocation, `Bus ${bus.vehicleName} must have an inwardStartLocation`);
            assert.ok(bus.startLocation.locationName, `Bus ${bus.vehicleName} starting location name must exist`);
        }

        const totalAssigned = plan.buses.reduce((sum, b) => sum + (b.assignedUsers || 0), 0);
        assert.equal(totalAssigned, 397, "All 397 Coming Users must be assigned to routes");
    });

    // ── 9. Insufficient Configured Buses: Legitimate Error when only 5 buses configured for 6-bus demand ──
    await t.test("9. When only 5 buses are configured but 6 are needed, optimizer selects 5 configured + 1 unconfigured and fails with clear message", async () => {
        const stopDemands = [68, 67, 66, 65, 66, 65]; // sum = 397
        const stopCoords = [
            { name: "KK Nagar Stop", latitude: 9.9180, longitude: 78.1470 },
            { name: "Vandiyur Stop", latitude: 9.9120, longitude: 78.1650 },
            { name: "Thiruppalai Stop", latitude: 9.9800, longitude: 78.1400 },
            { name: "B B Kulam Stop", latitude: 9.9450, longitude: 78.1320 },
            { name: "Othakadai Stop", latitude: 9.9678, longitude: 78.1925 },
            { name: "Walk-King Stop", latitude: 9.9200, longitude: 78.1500 }
        ];

        let userCounter = 0;
        const resolvedStops = stopCoords.map((sc, idx) => {
            const count = stopDemands[idx];
            const ids = Array.from({ length: count }, () => `u_in9_${++userCounter}`);
            return {
                name: sc.name,
                latitude: sc.latitude,
                longitude: sc.longitude,
                userCount: count,
                userIds: ids
            };
        });

        // Only 5 configured buses (A2, AS@, D1, J1, V1) - k1 is NOT configured
        const configuredBuses = [
            { _id: "veh_A2", vehicleName: "A2", capacity: 70, seatCapacity: 70 },
            { _id: "veh_AS", vehicleName: "AS@", capacity: 70, seatCapacity: 70 },
            { _id: "veh_D1", vehicleName: "D1", capacity: 70, seatCapacity: 70 },
            { _id: "veh_J1", vehicleName: "J1", capacity: 70, seatCapacity: 70 },
            { _id: "veh_V1", vehicleName: "V1", capacity: 70, seatCapacity: 70 }
        ];
        const unconfiguredBuses = [
            { _id: "veh_w1", vehicleName: "w1", capacity: 60, seatCapacity: 60 }
        ];

        const availableVehicles = [...configuredBuses, ...unconfiguredBuses];

        const only5Places = [
            { busId: "veh_A2", busName: "A2", locationName: "KK Nagar", latitude: 9.9180, longitude: 78.1470, active: true },
            { busId: "veh_AS", busName: "AS@", locationName: "Vandiyur", latitude: 9.9120, longitude: 78.1650, active: true },
            { busId: "veh_D1", busName: "D1", locationName: "Thiruppalai", latitude: 9.9800, longitude: 78.1400, active: true },
            { busId: "veh_J1", busName: "J1", locationName: "B B Kulam", latitude: 9.9450, longitude: 78.1320, active: true },
            { busId: "veh_V1", busName: "V1", locationName: "Othakadai", latitude: 9.9678, longitude: 78.1925, active: true }
        ];

        const confirmedUsers = resolvedStops.flatMap(s => s.userIds.map(id => ({ _id: id, userId: id })));

        await assert.rejects(
            async () => {
                await buildAIPlan({
                    destinationHub: mockDestinationCollege,
                    tripMode: "TO_DESTINATION",
                    resolvedStops,
                    availableVehicles,
                    rawVehicles: availableVehicles,
                    totalComingUsers: 397,
                    allUsersCount: 397,
                    totalAvailableCapacity: 410,
                    physicalFleetCapacity: 410,
                    confirmedUsers,
                    activeInwardStartingPlaces: only5Places
                });
            },
            (err) => {
                assert.equal(err.code, "INWARD_STARTING_PLACES_INCOMPLETE");
                assert.ok(err.missingBuses.includes("w1"), "Must identify w1 as missing starting location");
                assert.equal(err.requiredCount, 6, "Must show 6 buses required");
                assert.equal(err.configuredCount, 5, "Must show 5 buses configured");
                return true;
            }
        );
    });
});
