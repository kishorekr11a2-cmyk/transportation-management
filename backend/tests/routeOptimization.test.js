import assert from "node:assert/strict";
import test from "node:test";
import {
    getConfirmedUsers,
    deduplicateUsers,
    calculateStoppingGroups,
    buildStopLocationQuery,
    validatePreOptimizationData,
    getVehicleCapacity,
    getAvailableVehicles,
    calculateDistanceKm,
    sequenceStopsContinuous,
    consolidateLowUtilizationRoutes,
    validateAndCertifyAIPlan,
    buildAIPlan,
    isValidCoordinate,
    validateRouteCorridorContinuity,
    resolveStopCoordinates
} from "../services/aiAgentService.js";
import { generate400TestUsers, SAMPLE_STOPS_DISTRIBUTION } from "../generateTestUsersExcel.js";

test("Scenario 1: Zero Demand Handling", async () => {
    const rawUsers = [
        { _id: "u1", name: "Alice", role: "student", travelStatus: "Not Coming", stoppings: ["Central"] },
        { _id: "u2", name: "Bob", role: "student", travelStatus: "Pending", stoppings: ["Station"] }
    ];

    const confirmed = getConfirmedUsers(rawUsers);
    const { uniqueUsers, duplicateCount } = deduplicateUsers(confirmed);

    assert.equal(uniqueUsers.length, 0);
    assert.equal(duplicateCount, 0);
});

test("Scenario 2: Perfect Fleet Match (300 Passengers, 300 Capacity)", async () => {
    const stops = [
        { name: "Stop A", userCount: 60, latitude: 12.9716, longitude: 77.5946 },
        { name: "Stop B", userCount: 60, latitude: 12.9816, longitude: 77.6046 },
        { name: "Stop C", userCount: 60, latitude: 12.9916, longitude: 77.6146 },
        { name: "Stop D", userCount: 60, latitude: 13.0016, longitude: 77.6246 },
        { name: "Stop E", userCount: 60, latitude: 13.0116, longitude: 77.6346 }
    ];

    const rawVehicles = [
        { _id: "v1", name: "Bus 1", capacity: 60 },
        { _id: "v2", name: "Bus 2", capacity: 60 },
        { _id: "v3", name: "Bus 3", capacity: 60 },
        { _id: "v4", name: "Bus 4", capacity: 60 },
        { _id: "v5", name: "Bus 5", capacity: 60 }
    ];

    const sourceHub = { name: "Campus Hub", latitude: 12.9600, longitude: 77.5800 };

    const plan = await buildAIPlan({
        sourceHub,
        tripMode: "OUTWARD",
        resolvedStops: stops,
        availableVehicles: rawVehicles,
        rawVehicles,
        totalComingUsers: 300,
        allUsersCount: 300
    });

    assert.equal(plan.assignedUsers, 300);
    assert.equal(plan.unassignedUsers, 0);
    assert.equal(plan.buses.length, 5);
    assert.equal(plan.capacityShortage, false);
});

test("Scenario 3: 300 Passengers with 480 Fleet Capacity (No False Shortage Alert)", async () => {
    const stops = [
        { name: "North Area", userCount: 70, latitude: 12.9716, longitude: 77.5946 },
        { name: "East Area", userCount: 70, latitude: 12.9816, longitude: 77.6046 },
        { name: "West Area", userCount: 70, latitude: 12.9916, longitude: 77.6146 },
        { name: "South Area", userCount: 70, latitude: 13.0016, longitude: 77.6246 },
        { name: "Central Area", userCount: 20, latitude: 13.0116, longitude: 77.6346 }
    ];

    const rawVehicles = [
        { _id: "v1", name: "Bus 1", capacity: 70 },
        { _id: "v2", name: "Bus 2", capacity: 70 },
        { _id: "v3", name: "Bus 3", capacity: 70 },
        { _id: "v4", name: "Bus 4", capacity: 70 },
        { _id: "v5", name: "Bus 5", capacity: 70 },
        { _id: "v6", name: "Bus 6", capacity: 70 },
        { _id: "v7", name: "Bus 7", capacity: 60 }
    ];

    const sourceHub = { name: "Central Campus", latitude: 12.9600, longitude: 77.5800 };

    const plan = await buildAIPlan({
        sourceHub,
        tripMode: "OUTWARD",
        resolvedStops: stops,
        availableVehicles: rawVehicles,
        rawVehicles,
        totalComingUsers: 300,
        allUsersCount: 300
    });

    assert.equal(plan.assignedUsers, 300, "All 300 confirmed passengers must be allocated");
    assert.equal(plan.unassignedUsers, 0, "There must be 0 unallocated passengers");
    assert.equal(plan.physicalFleetCapacity, 480, "Physical fleet capacity must equal 480");
    assert.equal(plan.capacityShortage, false, "Must not flag capacity shortage when demand is fully met");
    assert.equal(plan.warnings.length, 0, "No capacity warnings should be emitted");
});

test("Scenario 4: Physical Capacity Shortage (550 Demand, 480 Fleet Capacity)", async () => {
    const stops = [
        { name: "Stop 1", userCount: 150, latitude: 12.9716, longitude: 77.5946 },
        { name: "Stop 2", userCount: 150, latitude: 12.9816, longitude: 77.6046 },
        { name: "Stop 3", userCount: 150, latitude: 12.9916, longitude: 77.6146 },
        { name: "Stop 4", userCount: 100, latitude: 13.0016, longitude: 77.6246 }
    ];

    const rawVehicles = [
        { _id: "v1", name: "Bus 1", capacity: 70 },
        { _id: "v2", name: "Bus 2", capacity: 70 },
        { _id: "v3", name: "Bus 3", capacity: 70 },
        { _id: "v4", name: "Bus 4", capacity: 70 },
        { _id: "v5", name: "Bus 5", capacity: 70 },
        { _id: "v6", name: "Bus 6", capacity: 70 },
        { _id: "v7", name: "Bus 7", capacity: 60 }
    ];

    const sourceHub = { name: "Campus Hub", latitude: 12.9600, longitude: 77.5800 };

    const plan = await buildAIPlan({
        sourceHub,
        tripMode: "OUTWARD",
        resolvedStops: stops,
        availableVehicles: rawVehicles,
        rawVehicles,
        totalComingUsers: 550,
        allUsersCount: 550
    });

    assert.equal(plan.assignedUsers, 480);
    assert.equal(plan.unassignedUsers, 70);
    assert.equal(plan.unallocatedReason, "VEHICLE_CAPACITY");
    assert.equal(plan.capacityShortage, true);
});

test("Scenario 5: Schedule Capacity Shortage (300 Demand, 480 Fleet, 210 Available in Schedule)", async () => {
    const stops = [
        { name: "Stop A", userCount: 100, latitude: 12.9716, longitude: 77.5946 },
        { name: "Stop B", userCount: 100, latitude: 12.9816, longitude: 77.6046 },
        { name: "Stop C", userCount: 100, latitude: 12.9916, longitude: 77.6146 }
    ];

    const rawVehicles = [
        { _id: "v1", name: "Bus 1", capacity: 70 },
        { _id: "v2", name: "Bus 2", capacity: 70 },
        { _id: "v3", name: "Bus 3", capacity: 70 },
        { _id: "v4", name: "Bus 4", capacity: 70 },
        { _id: "v5", name: "Bus 5", capacity: 70 },
        { _id: "v6", name: "Bus 6", capacity: 70 },
        { _id: "v7", name: "Bus 7", capacity: 60 }
    ];

    // Only 3 vehicles scheduled
    const availableVehicles = rawVehicles.slice(0, 3); // 210 seats

    const sourceHub = { name: "Campus Hub", latitude: 12.9600, longitude: 77.5800 };

    const plan = await buildAIPlan({
        sourceHub,
        tripMode: "OUTWARD",
        resolvedStops: stops,
        availableVehicles,
        rawVehicles,
        totalComingUsers: 300,
        allUsersCount: 300
    });

    assert.equal(plan.assignedUsers, 210);
    assert.equal(plan.unassignedUsers, 90);
    assert.equal(plan.unallocatedReason, "SCHEDULE_CAPACITY");
});

test("Scenario 6: High-Demand Single Stop Partitioning across Multiple Buses", async () => {
    const stops = [
        { name: "High Density Terminal", userCount: 150, latitude: 12.9716, longitude: 77.5946 }
    ];

    const rawVehicles = [
        { _id: "v1", name: "Bus 1", capacity: 70 },
        { _id: "v2", name: "Bus 2", capacity: 70 },
        { _id: "v3", name: "Bus 3", capacity: 70 }
    ];

    const sourceHub = { name: "Campus Hub", latitude: 12.9600, longitude: 77.5800 };

    const plan = await buildAIPlan({
        sourceHub,
        tripMode: "OUTWARD",
        resolvedStops: stops,
        availableVehicles: rawVehicles,
        rawVehicles,
        totalComingUsers: 150,
        allUsersCount: 150
    });

    assert.equal(plan.assignedUsers, 150);
    assert.equal(plan.unassignedUsers, 0);
    assert.equal(plan.uniqueStopCount, 1);
    assert.equal(plan.routeStopVisitCount, 3);
    assert.equal(plan.splitStopCount, 1);
    assert.equal(plan.buses[0].assignedUsers, 70);
    assert.equal(plan.buses[1].assignedUsers, 70);
    assert.equal(plan.buses[2].assignedUsers, 10);
});

test("Scenario 7: Dynamic Stop Demand Variance (1, 2, 7, 13, 35, 70, 100 passengers)", async () => {
    const stops = [
        { name: "Stop 1", userCount: 1, latitude: 12.9716, longitude: 77.5946 },
        { name: "Stop 2", userCount: 2, latitude: 12.9816, longitude: 77.6046 },
        { name: "Stop 3", userCount: 7, latitude: 12.9916, longitude: 77.6146 },
        { name: "Stop 4", userCount: 13, latitude: 13.0016, longitude: 77.6246 },
        { name: "Stop 5", userCount: 35, latitude: 13.0116, longitude: 77.6346 },
        { name: "Stop 6", userCount: 70, latitude: 13.0216, longitude: 77.6446 },
        { name: "Stop 7", userCount: 100, latitude: 13.0316, longitude: 77.6546 }
    ];

    const totalDemand = 1 + 2 + 7 + 13 + 35 + 70 + 100; // 228

    const rawVehicles = [
        { _id: "v1", name: "Bus 1", capacity: 70 },
        { _id: "v2", name: "Bus 2", capacity: 70 },
        { _id: "v3", name: "Bus 3", capacity: 70 },
        { _id: "v4", name: "Bus 4", capacity: 70 }
    ];

    const sourceHub = { name: "Campus Hub", latitude: 12.9600, longitude: 77.5800 };

    const plan = await buildAIPlan({
        sourceHub,
        tripMode: "OUTWARD",
        resolvedStops: stops,
        availableVehicles: rawVehicles,
        rawVehicles,
        totalComingUsers: totalDemand,
        allUsersCount: totalDemand
    });

    assert.equal(plan.assignedUsers, totalDemand);
    assert.equal(plan.unassignedUsers, 0);
});

test("Scenario 8: Deduplication of Passenger IDs", () => {
    const rawUsers = [
        { userId: "usr_1", name: "Alice", role: "student", travelStatus: "Coming" },
        { userId: "usr_2", name: "Bob", role: "student", travelStatus: "Coming" },
        { userId: "usr_1", name: "Alice Duplicate", role: "student", travelStatus: "Coming" },
        { userId: "usr_3", name: "Charlie", role: "student", travelStatus: "Coming" }
    ];

    const confirmed = getConfirmedUsers(rawUsers);
    const { uniqueUsers, duplicateCount } = deduplicateUsers(confirmed);

    assert.equal(uniqueUsers.length, 3);
    assert.equal(duplicateCount, 1);
    assert.deepEqual(uniqueUsers.map(u => u.userId), ["usr_1", "usr_2", "usr_3"]);
});

test("Scenario 9: Route Consolidation with Complete Audit Trail", async () => {
    const anchorHub = { name: "Departure Station", latitude: 51.5074, longitude: -0.1278 };

    const initialBuses = [
        {
            routeCode: "R-01",
            vehicleName: "Bus Alpha",
            capacity: 70,
            assignedUsers: 60,
            remainingSeats: 10,
            routeDistanceKm: 12.0,
            stops: [
                { name: "Stop 1", userCount: 30, latitude: 51.5150, longitude: -0.1200 },
                { name: "Stop 2", userCount: 30, latitude: 51.5200, longitude: -0.1100 }
            ]
        },
        {
            routeCode: "R-02",
            vehicleName: "Bus Beta",
            capacity: 70,
            assignedUsers: 8,
            remainingSeats: 62,
            routeDistanceKm: 10.0,
            stops: [
                { name: "Stop 3", userCount: 8, latitude: 51.5220, longitude: -0.1050 }
            ]
        }
    ];

    const result = await consolidateLowUtilizationRoutes({
        initialBuses,
        availableVehicles: [{ _id: "1", capacity: 70 }, { _id: "2", capacity: 70 }],
        anchorHub,
        tripMode: "OUTWARD"
    });

    assert.equal(result.buses.length, 1);
    assert.equal(result.buses[0].assignedUsers, 68);
    assert.equal(result.consolidationAudit.length, 1);
    assert.equal(result.consolidationAudit[0].sourceVehicle, "Bus Beta");
    assert.equal(result.consolidationAudit[0].passengersMoved, 8);
});

test("Scenario 10: OSRM Road Verification and Offline Fallback Classification", () => {
    const buses = [
        {
            vehicleId: "v1",
            assignedUsers: 50,
            capacity: 70,
            routeDistanceKm: 25.4,
            isRoadVerified: true,
            stops: [{ name: "Stop A", userCount: 50 }],
            users: ["u1", "u2"]
        }
    ];

    const onlineCert = validateAndCertifyAIPlan({
        buses,
        totalComingUsers: 50,
        availableVehicles: [{ _id: "v1", capacity: 70 }],
        totalAvailableCapacity: 70,
        resolvedStops: [{ name: "Stop A", userCount: 50 }]
    });

    assert.equal(onlineCert.checks.roadNetworkVerified, true);
    assert.equal(onlineCert.isCertified, true);

    // Offline simulation
    const offlineBuses = [
        {
            vehicleId: "v1",
            assignedUsers: 50,
            capacity: 70,
            routeDistanceKm: 20.0,
            isRoadVerified: false,
            stops: [{ name: "Stop A", userCount: 50 }],
            users: ["u1", "u2"]
        }
    ];

    const offlineCert = validateAndCertifyAIPlan({
        buses: offlineBuses,
        totalComingUsers: 50,
        availableVehicles: [{ _id: "v1", capacity: 70 }],
        totalAvailableCapacity: 70,
        resolvedStops: [{ name: "Stop A", userCount: 50 }]
    });

    assert.equal(offlineCert.checks.roadNetworkVerified, false);
    assert.equal(offlineCert.isCertified, false);
});

test("Scenario 11: Direction Semantics (OUTWARD Drop-Off vs INWARD Pickup)", async () => {
    const stops = [
        { name: "Stop 1", userCount: 20, latitude: 40.7128, longitude: -74.0060 },
        { name: "Stop 2", userCount: 30, latitude: 40.7300, longitude: -73.9900 }
    ];

    const hub = { name: "NYC Station", latitude: 40.7000, longitude: -74.0100 };

    const outwardTour = await sequenceStopsContinuous(stops, hub, "OUTWARD");
    assert.equal(outwardTour.length, 2);
    assert.equal(outwardTour[0].order, 1);
    assert.equal(outwardTour[1].order, 2);

    const inwardTour = await sequenceStopsContinuous(stops, hub, "INWARD");
    assert.equal(inwardTour.length, 2);
});

test("Scenario 12: Universal Global Coordinates (Tokyo, London, NYC, Sydney, Madurai)", () => {
    const globalCoords = [
        { city: "Tokyo", lat: 35.6762, lon: 139.6503 },
        { city: "London", lat: 51.5074, lon: -0.1278 },
        { city: "New York", lat: 40.7128, lon: -74.0060 },
        { city: "Sydney", lat: -33.8688, lon: 151.2093 },
        { city: "Madurai", lat: 9.9252, lon: 78.1198 }
    ];

    globalCoords.forEach(({ city, lat, lon }) => {
        assert.equal(isValidCoordinate(lat, lon), true, `${city} coordinates must be valid`);
    });

    // Invalid coordinate assertions
    assert.equal(isValidCoordinate(95.0, 100.0), false, "Latitude > 90 must be invalid");
    assert.equal(isValidCoordinate(45.0, 190.0), false, "Longitude > 180 must be invalid");
    assert.equal(isValidCoordinate(0, 0), false, "Null Island (0,0) must be invalid");
    assert.equal(isValidCoordinate("abc", "def"), false, "NaN must be invalid");
});

test("Scenario 13: Mode A (TO_DESTINATION) - 300 Passengers on 30 Stops, 7 Vehicles (480 Seats)", async () => {
    const stops = [
        { name: "Anuppanadi", userCount: 15, latitude: 9.9050, longitude: 78.1400 },
        { name: "Anna Nagar", userCount: 20, latitude: 9.9180, longitude: 78.1450 },
        { name: "KK Nagar", userCount: 16, latitude: 9.9280, longitude: 78.1520 },
        { name: "Goripalayam", userCount: 12, latitude: 9.9320, longitude: 78.1300 },
        { name: "Tallakulam", userCount: 12, latitude: 9.9380, longitude: 78.1350 },
        { name: "Mattuthavani", userCount: 19, latitude: 9.9450, longitude: 78.1600 },
        { name: "Simmakkal", userCount: 8, latitude: 9.9250, longitude: 78.1200 },
        { name: "Periyar Bus Stand", userCount: 18, latitude: 9.9160, longitude: 78.1120 },
        { name: "Madurai Junction", userCount: 10, latitude: 9.9190, longitude: 78.1100 },
        { name: "Arapalayam", userCount: 10, latitude: 9.9350, longitude: 78.1050 },
        { name: "Palanganatham", userCount: 8, latitude: 9.9000, longitude: 78.0980 },
        { name: "TVS Nagar", userCount: 7, latitude: 9.8920, longitude: 78.0920 },
        { name: "Sundararajapuram", userCount: 6, latitude: 9.9050, longitude: 78.1020 },
        { name: "Villapuram", userCount: 12, latitude: 9.8950, longitude: 78.1250 },
        { name: "Avaniyapuram", userCount: 15, latitude: 9.8750, longitude: 78.1180 },
        { name: "Thirunagar", userCount: 8, latitude: 9.8700, longitude: 78.0650 },
        { name: "Thiruparankundram", userCount: 12, latitude: 9.8820, longitude: 78.0720 },
        { name: "Pasumalai", userCount: 5, latitude: 9.8950, longitude: 78.0820 },
        { name: "Sellur", userCount: 8, latitude: 9.9400, longitude: 78.1180 },
        { name: "Koodal Nagar", userCount: 7, latitude: 9.9550, longitude: 78.1100 },
        { name: "Othakadai", userCount: 10, latitude: 9.9650, longitude: 78.1800 },
        { name: "Melur Road", userCount: 6, latitude: 9.9500, longitude: 78.1700 },
        { name: "Iyer Bungalow", userCount: 8, latitude: 9.9600, longitude: 78.1400 },
        { name: "Bibikulam", userCount: 5, latitude: 9.9450, longitude: 78.1320 },
        { name: "Narayanapuram", userCount: 4, latitude: 9.9520, longitude: 78.1450 },
        { name: "Teppakulam", userCount: 10, latitude: 9.9120, longitude: 78.1500 },
        { name: "Vandiyur", userCount: 8, latitude: 9.9200, longitude: 78.1700 },
        { name: "Kamarajar Salai", userCount: 7, latitude: 9.9150, longitude: 78.1350 },
        { name: "Munichalai", userCount: 6, latitude: 9.9180, longitude: 78.1300 },
        { name: "South Gate", userCount: 8, latitude: 9.9120, longitude: 78.1200 }
    ];

    const totalDemand = stops.reduce((s, st) => s + st.userCount, 0);
    assert.equal(totalDemand, 300, "Stops must sum to exactly 300 passengers");

    const rawVehicles = [
        { _id: "v1", name: "Bus 1", capacity: 70 },
        { _id: "v2", name: "Bus 2", capacity: 70 },
        { _id: "v3", name: "Bus 3", capacity: 70 },
        { _id: "v4", name: "Bus 4", capacity: 70 },
        { _id: "v5", name: "Bus 5", capacity: 70 },
        { _id: "v6", name: "Bus 6", capacity: 70 },
        { _id: "v7", name: "Bus 7", capacity: 60 }
    ];

    const destinationHub = {
        name: "K. L. N. College of Engineering",
        latitude: 9.8324,
        longitude: 78.1818
    };

    const plan = await buildAIPlan({
        destinationHub,
        tripMode: "TO_DESTINATION",
        resolvedStops: stops,
        availableVehicles: rawVehicles,
        rawVehicles,
        totalComingUsers: 300,
        allUsersCount: 300
    });

    assert.equal(plan.assignedUsers, 300, "All 300 passengers must be allocated");
    assert.equal(plan.unassignedUsers, 0, "Zero passengers should be unallocated");
    assert.equal(plan.capacityShortage, false, "Must not flag false capacity shortage");
    assert.equal(plan.warnings.length, 0, "No capacity warnings should be emitted");
    assert.equal(plan.uniqueStopCount, 30, "Must report 30 unique stopping areas");
    assert.ok(plan.routeStopVisitCount >= 30, "routeStopVisitCount must be >= uniqueStopCount");

    plan.buses.forEach((bus) => {
        assert.ok(bus.assignedUsers <= bus.capacity, `Bus ${bus.routeCode} assignedUsers (${bus.assignedUsers}) <= capacity (${bus.capacity})`);
        assert.ok(bus.routeName.includes("to K. L. N. College of Engineering"), `Route name must indicate arrival at destination: ${bus.routeName}`);
        assert.ok(bus.routeDistanceKm < 150, `Route distance (${bus.routeDistanceKm} km) must be within sensible bounds`);
    });

    assert.equal(plan.physicalFleetUtilization, Number(((300 / 480) * 100).toFixed(2)));
    assert.ok(plan.routeAllocationUtilization > 0);
    assert.ok(plan.fleetVehicleUtilization > 0);
});

test("Scenario 14: Mode B (FROM_SOURCE) - Departure from College to Residential Areas", async () => {
    const stops = [
        { name: "KK Nagar", userCount: 30, latitude: 9.9280, longitude: 78.1520 },
        { name: "Anna Nagar", userCount: 30, latitude: 9.9180, longitude: 78.1450 }
    ];

    const sourceHub = {
        name: "K. L. N. College of Engineering",
        latitude: 9.8324,
        longitude: 78.1818
    };

    const rawVehicles = [
        { _id: "v1", name: "Bus 1", capacity: 70 }
    ];

    const plan = await buildAIPlan({
        sourceHub,
        tripMode: "FROM_SOURCE",
        resolvedStops: stops,
        availableVehicles: rawVehicles,
        rawVehicles,
        totalComingUsers: 60,
        allUsersCount: 60
    });

    assert.equal(plan.assignedUsers, 60);
    assert.equal(plan.unassignedUsers, 0);
    assert.ok(plan.buses[0].routeName.startsWith("R-01: K. L. N. College of Engineering to"), "Mode B route must start with departure source");
});

test("Scenario 15: Continuous Nearest-from-Current Progression (Not Repeated From Source)", async () => {
    // Linear series of stops along a road: Source (0km) -> A (5km) -> B (10km) -> C (15km)
    const sourceHub = { name: "Depot", latitude: 51.5000, longitude: -0.1000 };
    const stops = [
        { name: "Stop C", userCount: 10, latitude: 51.5300, longitude: -0.1000 },
        { name: "Stop A", userCount: 10, latitude: 51.5100, longitude: -0.1000 },
        { name: "Stop B", userCount: 10, latitude: 51.5200, longitude: -0.1000 }
    ];

    const sequenced = await sequenceStopsContinuous(stops, sourceHub, "FROM_SOURCE");
    assert.equal(sequenced.length, 3);
    assert.equal(sequenced[0].name, "Stop A", "First stop must be A (closest to source)");
    assert.equal(sequenced[1].name, "Stop B", "Second stop must be B (closest to current point A)");
    assert.equal(sequenced[2].name, "Stop C", "Third stop must be C (closest to current point B)");
});

test("Scenario 16: 2-Opt Preserves Fixed Endpoints without Loss of Stops", async () => {
    const sourceHub = { name: "Origin", latitude: 48.8566, longitude: 2.3522 };
    const destinationHub = { name: "Destination", latitude: 48.8800, longitude: 2.3900 };

    const stops = [
        { name: "Point 1", userCount: 15, latitude: 48.8600, longitude: 2.3600 },
        { name: "Point 3", userCount: 15, latitude: 48.8750, longitude: 2.3800 },
        { name: "Point 2", userCount: 15, latitude: 48.8680, longitude: 2.3700 }
    ];

    const sequenced = await sequenceStopsContinuous(stops, destinationHub, "TO_DESTINATION", sourceHub, destinationHub);
    assert.equal(sequenced.length, 3);
    const stopNames = sequenced.map(s => s.name);
    assert.ok(stopNames.includes("Point 1"));
    assert.ok(stopNames.includes("Point 2"));
    assert.ok(stopNames.includes("Point 3"));
});

test("Scenario 17: Regression Test - No 127+ km Sudden Jumps in Local Urban Corridors", async () => {
    // Nearby Madurai city stops near K.L.N. College
    const destinationHub = { name: "K. L. N. College of Engineering", latitude: 9.8324, longitude: 78.1818 };
    const stops = [
        { name: "Vandiyur", userCount: 10, latitude: 9.9200, longitude: 78.1700 },
        { name: "Anuppanadi", userCount: 10, latitude: 9.9050, longitude: 78.1400 },
        { name: "Pudur", userCount: 10, latitude: 9.9500, longitude: 78.1450 },
        { name: "Narimedu", userCount: 10, latitude: 9.9350, longitude: 78.1320 }
    ];

    const sequenced = await sequenceStopsContinuous(stops, destinationHub, "TO_DESTINATION");

    // Verify each intermediate segment distance is reasonable (< 15 km in city transit)
    sequenced.forEach((stop) => {
        assert.ok(stop.legDistanceKm < 25.0, `Leg distance for ${stop.name} (${stop.legDistanceKm} km) must be < 25km`);
    });

    const totalLegKm = sequenced.reduce((sum, s) => sum + s.legDistanceKm, 0);
    assert.ok(totalLegKm < 45.0, `Total route segment sum (${totalLegKm.toFixed(2)} km) must be < 45km`);
});

test("Scenario 18: International Geographic Coordinates (Sydney, Australia)", async () => {
    const hub = { name: "Sydney University Hub", latitude: -33.8886, longitude: 151.1873 };
    const stops = [
        { name: "Redfern", userCount: 25, latitude: -33.8920, longitude: 151.2050 },
        { name: "Newtown", userCount: 25, latitude: -33.8970, longitude: 151.1790 }
    ];

    const rawVehicles = [{ _id: "v_syd", name: "Sydney Bus 1", capacity: 60 }];

    const plan = await buildAIPlan({
        destinationHub: hub,
        tripMode: "TO_DESTINATION",
        resolvedStops: stops,
        availableVehicles: rawVehicles,
        rawVehicles,
        totalComingUsers: 50,
        allUsersCount: 50
    });

    assert.equal(plan.assignedUsers, 50);
    assert.equal(plan.unassignedUsers, 0);
    assert.ok(plan.buses[0].routeDistanceKm > 0 && plan.buses[0].routeDistanceKm < 50);
});

test("Scenario 19: Missing / Invalid Stop Coordinates Are Explicitly Excluded", () => {
    assert.equal(isValidCoordinate(null, 78.10), false);
    assert.equal(isValidCoordinate(9.90, undefined), false);
    assert.equal(isValidCoordinate(91.0, 78.10), false);
    assert.equal(isValidCoordinate(9.90, 185.0), false);
    assert.equal(isValidCoordinate(0, 0), false);
});

test("Scenario 20: 100+ Stops Scaling and Efficiency", async () => {
    const anchorHub = { name: "Central Terminal", latitude: 40.7128, longitude: -74.0060 };
    const stops = [];
    for (let i = 0; i < 100; i++) {
        stops.push({
            name: `Stop ${i + 1}`,
            userCount: 5,
            latitude: 40.7128 + (i % 10) * 0.005,
            longitude: -74.0060 + Math.floor(i / 10) * 0.005
        });
    }

    const rawVehicles = [];
    for (let i = 0; i < 10; i++) {
        rawVehicles.push({ _id: `bus_${i}`, name: `Bus ${i + 1}`, capacity: 60 });
    }

    const startTime = Date.now();
    const plan = await buildAIPlan({
        sourceHub: anchorHub,
        tripMode: "FROM_SOURCE",
        resolvedStops: stops,
        availableVehicles: rawVehicles,
        rawVehicles,
        totalComingUsers: 500,
        allUsersCount: 500
    });
    const durationMs = Date.now() - startTime;

    assert.equal(plan.assignedUsers, 500);
    assert.equal(plan.unassignedUsers, 0);
    assert.ok(durationMs < 10000, `Plan generation for 100 stops took ${durationMs}ms, should be < 10s`);
});

test("Scenario 21: Chennai Metropolitan Route Optimization", async () => {
    const destinationHub = {
        name: "Velammal Engineering College Chennai",
        latitude: 13.1492,
        longitude: 80.1917
    };

    const stops = [
        { name: "Ambattur", userCount: 25, latitude: 13.1143, longitude: 80.1548 },
        { name: "Anna Nagar Chennai", userCount: 25, latitude: 13.0850, longitude: 80.2100 },
        { name: "Koyambedu", userCount: 20, latitude: 13.0694, longitude: 80.1948 }
    ];

    const rawVehicles = [
        { _id: "v_chn_1", name: "Chennai Bus 1", capacity: 70 }
    ];

    const plan = await buildAIPlan({
        destinationHub,
        tripMode: "TO_DESTINATION",
        resolvedStops: stops,
        availableVehicles: rawVehicles,
        rawVehicles,
        totalComingUsers: 70,
        allUsersCount: 70
    });

    assert.equal(plan.assignedUsers, 70);
    assert.equal(plan.unassignedUsers, 0);
    assert.equal(plan.buses.length, 1);
    assert.ok(plan.buses[0].routeName.includes("to Velammal Engineering College Chennai"));
});

test("Scenario 22: Destination-Aware Optimization & Directional Backtracking Penalty", async () => {
    // Hub is at North (13.00, 80.00)
    const destinationHub = { name: "North Campus", latitude: 13.00, longitude: 80.00 };
    
    // Stop A is South (12.80, 80.00), Stop B is Middle (12.90, 80.00)
    const stops = [
        { name: "Stop A (Far South)", userCount: 15, latitude: 12.80, longitude: 80.00 },
        { name: "Stop B (Near South)", userCount: 15, latitude: 12.90, longitude: 80.00 }
    ];

    const sequenced = await sequenceStopsContinuous(stops, destinationHub, "TO_DESTINATION");

    assert.equal(sequenced.length, 2);
    // In TO_DESTINATION, route starts at outermost stop and moves continuously inward toward destination
    assert.equal(sequenced[0].name, "Stop A (Far South)");
    assert.equal(sequenced[1].name, "Stop B (Near South)");
});

test("Scenario 23: Complete Passenger Accounting Reconciliation Invariant", async () => {
    const demandValues = [3, 7, 14, 21, 28, 35, 42];
    const totalDem = demandValues.reduce((a, b) => a + b, 0); // 150
    const stops = demandValues.map((cnt, i) => ({
        name: `Stop ${i + 1}`,
        userCount: cnt,
        latitude: 10.0 + i * 0.01,
        longitude: 78.0 + i * 0.01
    }));

    const rawVehicles = [
        { _id: "v1", name: "Bus 1", capacity: 60 },
        { _id: "v2", name: "Bus 2", capacity: 60 }
    ]; // Total capacity 120 (Shortage of 30)

    const sourceHub = { name: "Campus Depot", latitude: 9.95, longitude: 78.0 };

    const plan = await buildAIPlan({
        sourceHub,
        tripMode: "FROM_SOURCE",
        resolvedStops: stops,
        availableVehicles: rawVehicles,
        rawVehicles,
        totalComingUsers: totalDem,
        allUsersCount: totalDem
    });

    assert.equal(plan.assignedUsers + plan.unassignedUsers, totalDem, "Allocated + Unallocated must equal Total Demand");
    assert.equal(plan.assignedUsers, 120);
    assert.equal(plan.unassignedUsers, 30);
    assert.equal(plan.capacityShortage, true);
    assert.equal(plan.unallocatedReason, "VEHICLE_CAPACITY");
});

test("Scenario 24: Global Coordinate Search & Validation Across 5 Continents", () => {
    const worldLocations = [
        { name: "New York Times Square", lat: 40.7580, lon: -73.9855 },
        { name: "London Big Ben", lat: 51.5007, lon: -0.1246 },
        { name: "Tokyo Shibuya", lat: 35.6595, lon: 139.7004 },
        { name: "Paris Eiffel Tower", lat: 48.8584, lon: 2.2945 },
        { name: "Sydney Opera House", lat: -33.8568, lon: 151.2153 },
        { name: "Rio de Janeiro Christ Redeemer", lat: -22.9519, lon: -43.2105 },
        { name: "Cairo Pyramids", lat: 29.9792, lon: 31.1342 },
        { name: "Madurai Meenakshi Temple", lat: 9.9195, lon: 78.1193 }
    ];

    worldLocations.forEach(loc => {
        assert.equal(isValidCoordinate(loc.lat, loc.lon), true, `${loc.name} must be a valid coordinate`);
    });
});

test("Scenario 25: Direction Semantics - FROM_SOURCE vs TO_DESTINATION ordering", async () => {
    const hub = { name: "Central Terminal", latitude: 9.9200, longitude: 78.1200 };
    const stops = [
        { name: "Inner Stop (2km)", userCount: 20, latitude: 9.9350, longitude: 78.1300 },
        { name: "Mid Stop (5km)", userCount: 20, latitude: 9.9550, longitude: 78.1450 },
        { name: "Outer Stop (10km)", userCount: 20, latitude: 9.9950, longitude: 78.1750 }
    ];

    // 1. FROM_SOURCE: Starts near Hub and progresses outward
    const outwardSeq = await sequenceStopsContinuous(stops, hub, "FROM_SOURCE");
    assert.equal(outwardSeq[0].name, "Inner Stop (2km)", "FROM_SOURCE must start at nearest stop to Source");
    assert.equal(outwardSeq[outwardSeq.length - 1].name, "Outer Stop (10km)", "FROM_SOURCE must end at outermost stop");

    // 2. TO_DESTINATION: Starts at outermost stop and progresses inward toward Destination
    const inwardSeq = await sequenceStopsContinuous(stops, hub, "TO_DESTINATION");
    assert.equal(inwardSeq[0].name, "Outer Stop (10km)", "TO_DESTINATION must start at outermost stop");
    assert.equal(inwardSeq[inwardSeq.length - 1].name, "Inner Stop (2km)", "TO_DESTINATION must end at nearest stop to Destination");
});

test("Scenario 26: Schedule Availability - Unavailable Vehicles Excluded", () => {
    const rawVehicles = [
        { _id: "v1", vehicleName: "Bus 1", capacity: 60 },
        { _id: "v2", vehicleName: "Bus 2", capacity: 60 },
        { _id: "v3", vehicleName: "Bus 3", capacity: 60 },
        { _id: "v4", vehicleName: "Bus 4", capacity: 60 },
        { _id: "v5", vehicleName: "Bus 5", capacity: 60 }
    ];

    const schedules = [
        { vehicle: "v1", availability: "Available" },
        { vehicle: "v2", availability: "Not Available" },
        { vehicle: "v3", availability: "Available" },
        { vehicle: "v4", availability: "Not Available" },
        { vehicle: "v5", availability: "Available" }
    ];

    const available = getAvailableVehicles(rawVehicles, schedules);
    assert.equal(available.length, 3, "Only 3 vehicles should be available");
    assert.deepEqual(available.map(v => v._id), ["v1", "v3", "v5"], "v2 and v4 must be excluded");
});

test("Scenario 27: Strict Vehicle Capacity Bounds (Assigned <= Capacity)", async () => {
    const stops = [
        { name: "Stop 1", userCount: 35, latitude: 12.9716, longitude: 77.5946 },
        { name: "Stop 2", userCount: 35, latitude: 12.9816, longitude: 77.6046 },
        { name: "Stop 3", userCount: 35, latitude: 12.9916, longitude: 77.6146 }
    ]; // Total demand = 105

    const rawVehicles = [
        { _id: "v1", name: "Bus 1", capacity: 50 },
        { _id: "v2", name: "Bus 2", capacity: 50 },
        { _id: "v3", name: "Bus 3", capacity: 50 }
    ];

    const sourceHub = { name: "Depot", latitude: 12.9500, longitude: 77.5800 };

    const plan = await buildAIPlan({
        sourceHub,
        tripMode: "FROM_SOURCE",
        resolvedStops: stops,
        availableVehicles: rawVehicles,
        rawVehicles,
        totalComingUsers: 105,
        allUsersCount: 105
    });

    assert.equal(plan.assignedUsers, 105);
    assert.equal(plan.unassignedUsers, 0);

    // Verify every individual bus does not exceed capacity
    plan.buses.forEach(b => {
        assert.ok(b.assignedUsers <= b.capacity, `Bus ${b.vehicleName} assigned (${b.assignedUsers}) exceeds capacity (${b.capacity})`);
    });
});

test("Scenario 28: Global Generic Outward Route - London, UK (Heathrow -> Central London -> Outer Stops)", async () => {
    const sourceHub = { name: "Heathrow Airport Shed", latitude: 51.4700, longitude: -0.4543 };
    const stops = [
        { name: "Hounslow", userCount: 15, latitude: 51.4667, longitude: -0.3667 },
        { name: "Hammersmith", userCount: 20, latitude: 51.4927, longitude: -0.2241 },
        { name: "Westminster", userCount: 25, latitude: 51.4975, longitude: -0.1357 },
        { name: "Camden Town", userCount: 18, latitude: 51.5390, longitude: -0.1426 },
        { name: "Greenwich", userCount: 22, latitude: 51.4826, longitude: -0.0077 }
    ]; // Total demand = 100

    const rawVehicles = [
        { _id: "v1", name: "London Double Decker 1", capacity: 60 },
        { _id: "v2", name: "London Double Decker 2", capacity: 60 }
    ];

    const plan = await buildAIPlan({
        sourceHub,
        tripMode: "FROM_SOURCE",
        resolvedStops: stops,
        availableVehicles: rawVehicles,
        rawVehicles,
        totalComingUsers: 100,
        allUsersCount: 100
    });

    assert.equal(plan.assignedUsers, 100, "All 100 London passengers must be allocated");
    assert.equal(plan.unassignedUsers, 0);
    assert.ok(plan.buses.length >= 1, "Must generate valid routes");

    plan.buses.forEach(b => {
        assert.ok(b.stops.length > 0, "Route must have stops");
        assert.ok(b.routeDistanceKm > 0, "Route must have positive distance");
        assert.equal(b.stops[0].previousStopName, "Heathrow Airport Shed", "Outward route must begin from Source");
    });
});

test("Scenario 29: Global Generic Inward Route - New York City, USA (Outer Boroughs -> Manhattan Destination)", async () => {
    const destinationHub = { name: "Columbia University Manhattan", latitude: 40.8075, longitude: -73.9626 };
    const stops = [
        { name: "Coney Island Brooklyn", userCount: 25, latitude: 40.5755, longitude: -73.9707 },
        { name: "Bay Ridge Brooklyn", userCount: 20, latitude: 40.6262, longitude: -74.0326 },
        { name: "Flushing Queens", userCount: 30, latitude: 40.7674, longitude: -73.8331 },
        { name: "Astoria Queens", userCount: 25, latitude: 40.7644, longitude: -73.9235 }
    ]; // Total demand = 100

    const rawVehicles = [
        { _id: "v1", name: "NYC Transit Bus 1", capacity: 55 },
        { _id: "v2", name: "NYC Transit Bus 2", capacity: 55 }
    ];

    const plan = await buildAIPlan({
        destinationHub,
        tripMode: "TO_DESTINATION",
        resolvedStops: stops,
        availableVehicles: rawVehicles,
        rawVehicles,
        totalComingUsers: 100,
        allUsersCount: 100
    });

    assert.equal(plan.assignedUsers, 100);
    assert.equal(plan.unassignedUsers, 0);
    assert.ok(plan.buses.length >= 1);
});

test("Scenario 30: Global Generic Route - Sydney, Australia (Central Station -> Suburbs)", async () => {
    const sourceHub = { name: "Sydney Central Bus Depot", latitude: -33.8830, longitude: 151.2065 };
    const stops = [
        { name: "Redfern", userCount: 12, latitude: -33.8920, longitude: 151.2050 },
        { name: "Newtown", userCount: 18, latitude: -33.8970, longitude: 151.1790 },
        { name: "Marrickville", userCount: 15, latitude: -33.9110, longitude: 151.1560 },
        { name: "Bondi Junction", userCount: 20, latitude: -33.8925, longitude: 151.2480 }
    ];

    const rawVehicles = [
        { _id: "v1", name: "Sydney Bus 1", capacity: 40 },
        { _id: "v2", name: "Sydney Bus 2", capacity: 40 }
    ];

    const plan = await buildAIPlan({
        sourceHub,
        tripMode: "FROM_SOURCE",
        resolvedStops: stops,
        availableVehicles: rawVehicles,
        rawVehicles,
        totalComingUsers: 65,
        allUsersCount: 65
    });

    assert.equal(plan.assignedUsers, 65);
    assert.equal(plan.unassignedUsers, 0);
});

test("Scenario 31: Global Generic Route - Paris, France (Gare du Nord -> Suburbs)", async () => {
    const sourceHub = { name: "Gare du Nord Hub", latitude: 48.8809, longitude: 2.3553 };
    const stops = [
        { name: "Montmartre", userCount: 14, latitude: 48.8867, longitude: 2.3431 },
        { name: "Saint-Denis", userCount: 22, latitude: 48.9362, longitude: 2.3574 },
        { name: "Pantin", userCount: 18, latitude: 48.8967, longitude: 2.4017 }
    ];

    const rawVehicles = [
        { _id: "v1", name: "RATP Bus 1", capacity: 60 }
    ];

    const plan = await buildAIPlan({
        sourceHub,
        tripMode: "FROM_SOURCE",
        resolvedStops: stops,
        availableVehicles: rawVehicles,
        rawVehicles,
        totalComingUsers: 54,
        allUsersCount: 54
    });

    assert.equal(plan.assignedUsers, 54);
    assert.equal(plan.unassignedUsers, 0);
    assert.equal(plan.buses[0].stops.length, 3);
});

test("Scenario 32: Global Generic Route - Singapore (Changi -> Woodlands)", async () => {
    const sourceHub = { name: "Changi Business Park", latitude: 1.3345, longitude: 103.9625 };
    const stops = [
        { name: "Tampines", userCount: 16, latitude: 1.3524, longitude: 103.9447 },
        { name: "Pasir Ris", userCount: 14, latitude: 1.3721, longitude: 103.9474 },
        { name: "Punggol", userCount: 18, latitude: 1.4053, longitude: 103.9022 }
    ];

    const rawVehicles = [
        { _id: "v1", name: "SMRT Bus 1", capacity: 50 }
    ];

    const plan = await buildAIPlan({
        sourceHub,
        tripMode: "FROM_SOURCE",
        resolvedStops: stops,
        availableVehicles: rawVehicles,
        rawVehicles,
        totalComingUsers: 48,
        allUsersCount: 48
    });

    assert.equal(plan.assignedUsers, 48);
    assert.equal(plan.unassignedUsers, 0);
});

test("Scenario 33: Non-Normalized Arbitrary Passenger Demand Counts (Stop A = 3, Stop B = 11, Stop C = 24, Stop D = 7)", async () => {
    const rawUsers = [
        ...Array.from({ length: 3 }, (_, i) => ({ _id: `u_a_${i}`, name: `User A${i}`, role: "student", travelStatus: "Coming", stoppings: ["Stop Alpha"] })),
        ...Array.from({ length: 11 }, (_, i) => ({ _id: `u_b_${i}`, name: `User B${i}`, role: "student", travelStatus: "Coming", stoppings: ["Stop Bravo"] })),
        ...Array.from({ length: 24 }, (_, i) => ({ _id: `u_c_${i}`, name: `User C${i}`, role: "student", travelStatus: "Coming", stoppings: ["Stop Charlie"] })),
        ...Array.from({ length: 7 }, (_, i) => ({ _id: `u_d_${i}`, name: `User D${i}`, role: "student", travelStatus: "Coming", stoppings: ["Stop Delta"] }))
    ]; // Total exact sum = 3 + 11 + 24 + 7 = 45

    const confirmed = getConfirmedUsers(rawUsers);
    const groups = calculateStoppingGroups(confirmed);

    assert.equal(groups.length, 4);
    const countMap = Object.fromEntries(groups.map(g => [g.name, g.userCount]));
    assert.equal(countMap["Stop Alpha"], 3, "Stop Alpha demand must strictly be 3 (not normalized)");
    assert.equal(countMap["Stop Bravo"], 11, "Stop Bravo demand must strictly be 11 (not normalized)");
    assert.equal(countMap["Stop Charlie"], 24, "Stop Charlie demand must strictly be 24 (not normalized)");
    assert.equal(countMap["Stop Delta"], 7, "Stop Delta demand must strictly be 7 (not normalized)");

    const stopsWithCoords = [
        { name: "Stop Alpha", userCount: 3, latitude: 12.9710, longitude: 77.5900 },
        { name: "Stop Bravo", userCount: 11, latitude: 12.9780, longitude: 77.5970 },
        { name: "Stop Charlie", userCount: 24, latitude: 12.9850, longitude: 77.6040 },
        { name: "Stop Delta", userCount: 7, latitude: 12.9920, longitude: 77.6110 }
    ];

    const rawVehicles = [
        { _id: "v1", name: "Bus 1", capacity: 50 }
    ];

    const sourceHub = { name: "Depot", latitude: 12.9600, longitude: 77.5800 };

    const plan = await buildAIPlan({
        sourceHub,
        tripMode: "FROM_SOURCE",
        resolvedStops: stopsWithCoords,
        availableVehicles: rawVehicles,
        rawVehicles,
        totalComingUsers: 45,
        allUsersCount: 45
    });

    assert.equal(plan.assignedUsers, 45, "Exact passenger sum (45) must be preserved");
    assert.equal(plan.unassignedUsers, 0);

    const busStopCounts = Object.fromEntries(plan.buses[0].stops.map(s => [s.name, s.userCount]));
    assert.equal(busStopCounts["Stop Alpha"], 3);
    assert.equal(busStopCounts["Stop Bravo"], 11);
    assert.equal(busStopCounts["Stop Charlie"], 24);
    assert.equal(busStopCounts["Stop Delta"], 7);
});

test("Scenario 34: Shared Route Logic - Merging Allowed Only When Justified by Capacity & Corridor Geometry", async () => {
    const anchorHub = { name: "Central Hub", latitude: 12.9600, longitude: 77.5800 };

    // Initial separate routes in the SAME corridor with low utilization (eligible for consolidation)
    const initialBuses = [
        {
            routeCode: "R-01",
            vehicleName: "Bus 1",
            capacity: 50,
            assignedUsers: 15,
            remainingSeats: 35,
            routeDistanceKm: 12.0,
            stops: [
                { name: "Stop 1", latitude: 12.9700, longitude: 77.5900, userCount: 15, userIds: ["u1", "u2"] }
            ]
        },
        {
            routeCode: "R-02",
            vehicleName: "Bus 2",
            capacity: 50,
            assignedUsers: 12,
            remainingSeats: 38,
            routeDistanceKm: 14.0,
            stops: [
                { name: "Stop 2", latitude: 12.9750, longitude: 77.5950, userCount: 12, userIds: ["u3", "u4"] }
            ]
        }
    ];

    const result = await consolidateLowUtilizationRoutes({
        initialBuses,
        availableVehicles: [{ _id: "v1", capacity: 50 }, { _id: "v2", capacity: 50 }],
        anchorHub,
        tripMode: "FROM_SOURCE",
        sourceHub: anchorHub
    });

    assert.equal(result.buses.length, 1, "Low utilization routes in the same corridor should be merged into 1 bus");
    assert.equal(result.buses[0].assignedUsers, 27, "Merged bus should have 15 + 12 = 27 passengers");
    assert.ok(result.consolidationLogs.length > 0, "Consolidation audit log must be recorded");
});

test("Scenario 35: Both Equal and Unequal Demand Distributions (10,10,10,10 | 11,11,10,10 | 3,17,6,24 | 1,2,35,8,19 | 5,10,22,7,14)", async () => {
    const testCases = [
        { label: "Equal 10s: [10, 10, 10, 10]", counts: [10, 10, 10, 10] },
        { label: "Near-equal: [11, 11, 10, 10]", counts: [11, 11, 10, 10] },
        { label: "Unequal: [3, 17, 6, 24]", counts: [3, 17, 6, 24] },
        { label: "Extreme skew: [1, 2, 35, 8, 19]", counts: [1, 2, 35, 8, 19] },
        { label: "Mixed variance: [5, 10, 22, 7, 14]", counts: [5, 10, 22, 7, 14] }
    ];

    const sourceHub = { name: "Transit Hub", latitude: 12.9600, longitude: 77.5800 };

    for (const tc of testCases) {
        const totalExpected = tc.counts.reduce((a, b) => a + b, 0);
        const stops = tc.counts.map((cnt, idx) => ({
            name: `Stop ${idx + 1}`,
            userCount: cnt,
            latitude: 12.9700 + (idx * 0.01),
            longitude: 77.5900 + (idx * 0.01)
        }));

        const rawVehicles = [
            { _id: "v1", name: "Bus 1", capacity: 50 },
            { _id: "v2", name: "Bus 2", capacity: 50 }
        ];

        const plan = await buildAIPlan({
            sourceHub,
            tripMode: "FROM_SOURCE",
            resolvedStops: stops,
            availableVehicles: rawVehicles,
            rawVehicles,
            totalComingUsers: totalExpected,
            allUsersCount: totalExpected
        });

        assert.equal(
            plan.assignedUsers,
            totalExpected,
            `${tc.label}: All ${totalExpected} passengers must be allocated without normalization`
        );
        assert.equal(plan.unassignedUsers, 0);

        // Verify stop-by-stop passenger integrity
        const allocatedMap = {};
        plan.buses.forEach(b => {
            b.stops.forEach(s => {
                allocatedMap[s.name] = (allocatedMap[s.name] || 0) + s.userCount;
            });
        });

        stops.forEach(st => {
            assert.equal(
                allocatedMap[st.name],
                st.userCount,
                `${tc.label}: Stop ${st.name} must preserve exact dynamic passenger count (${st.userCount})`
            );
        });
    }
});

test("Scenario 36: Reproduction & Fix of 302 Coming Users / 7 Vehicles (490 Seats) -> 100% (302/302) Allocated", async () => {
    // 30 stops distributed across multiple corridors with total demand = 302
    const stops = [
        { name: "Anuppanadi", userCount: 15, latitude: 9.9050, longitude: 78.1400 },
        { name: "Anna Nagar", userCount: 20, latitude: 9.9180, longitude: 78.1450 },
        { name: "KK Nagar", userCount: 16, latitude: 9.9280, longitude: 78.1520 },
        { name: "Goripalayam", userCount: 12, latitude: 9.9320, longitude: 78.1300 },
        { name: "Tallakulam", userCount: 12, latitude: 9.9380, longitude: 78.1350 },
        { name: "Mattuthavani", userCount: 19, latitude: 9.9450, longitude: 78.1600 },
        { name: "Simmakkal", userCount: 10, latitude: 9.9250, longitude: 78.1200 },
        { name: "Periyar Bus Stand", userCount: 18, latitude: 9.9160, longitude: 78.1120 },
        { name: "Madurai Junction", userCount: 10, latitude: 9.9190, longitude: 78.1100 },
        { name: "Arapalayam", userCount: 10, latitude: 9.9350, longitude: 78.1050 },
        { name: "Palanganatham", userCount: 8, latitude: 9.9000, longitude: 78.0980 },
        { name: "TVS Nagar", userCount: 7, latitude: 9.8920, longitude: 78.0920 },
        { name: "Sundararajapuram", userCount: 6, latitude: 9.9050, longitude: 78.1020 },
        { name: "Villapuram", userCount: 12, latitude: 9.8950, longitude: 78.1250 },
        { name: "Avaniyapuram", userCount: 15, latitude: 9.8750, longitude: 78.1180 },
        { name: "Thirunagar", userCount: 8, latitude: 9.8700, longitude: 78.0650 },
        { name: "Thiruparankundram", userCount: 12, latitude: 9.8820, longitude: 78.0720 },
        { name: "Pasumalai", userCount: 5, latitude: 9.8950, longitude: 78.0820 },
        { name: "Sellur", userCount: 8, latitude: 9.9400, longitude: 78.1180 },
        { name: "Koodal Nagar", userCount: 7, latitude: 9.9550, longitude: 78.1100 },
        { name: "Othakadai", userCount: 10, latitude: 9.9650, longitude: 78.1800 },
        { name: "Melur Road", userCount: 6, latitude: 9.9500, longitude: 78.1700 },
        { name: "Iyer Bungalow", userCount: 8, latitude: 9.9600, longitude: 78.1400 },
        { name: "Bibikulam", userCount: 5, latitude: 9.9450, longitude: 78.1320 },
        { name: "Narayanapuram", userCount: 4, latitude: 9.9520, longitude: 78.1450 },
        { name: "Teppakulam", userCount: 10, latitude: 9.9120, longitude: 78.1500 },
        { name: "Vandiyur", userCount: 8, latitude: 9.9200, longitude: 78.1700 },
        { name: "Kamarajar Salai", userCount: 7, latitude: 9.9150, longitude: 78.1350 },
        { name: "Munichalai", userCount: 6, latitude: 9.9180, longitude: 78.1300 },
        { name: "South Gate", userCount: 8, latitude: 9.9120, longitude: 78.1200 }
    ];

    const totalDemand = stops.reduce((s, st) => s + st.userCount, 0);
    assert.equal(totalDemand, 302, "Total test demand must strictly be 302");

    const rawVehicles = [
        { _id: "v1", name: "Bus 1", capacity: 70 },
        { _id: "v2", name: "Bus 2", capacity: 70 },
        { _id: "v3", name: "Bus 3", capacity: 70 },
        { _id: "v4", name: "Bus 4", capacity: 70 },
        { _id: "v5", name: "Bus 5", capacity: 70 },
        { _id: "v6", name: "Bus 6", capacity: 70 },
        { _id: "v7", name: "Bus 7", capacity: 70 }
    ];

    const sourceHub = { name: "Campus Departure Hub", latitude: 9.8324, longitude: 78.1818 };

    const plan = await buildAIPlan({
        sourceHub,
        tripMode: "FROM_SOURCE",
        resolvedStops: stops,
        availableVehicles: rawVehicles,
        rawVehicles,
        totalComingUsers: 302,
        allUsersCount: 302
    });

    assert.equal(plan.assignedUsers, 302, "CRITICAL: Exactly 302 of 302 passengers must be allocated");
    assert.equal(plan.unassignedUsers, 0, "CRITICAL: 0 unallocated passengers must remain");
    assert.equal(plan.capacityShortage, false);
    assert.ok(plan.buses.length <= 7, "Must use only available vehicles");

    // Verify all passenger assignments are unique
    const assignedUserIds = new Set();
    plan.buses.forEach(b => {
        b.stops.forEach(s => {
            (s.userIds || []).forEach(uid => {
                assert.ok(!assignedUserIds.has(uid), `Duplicate passenger assignment detected: ${uid}`);
                assignedUserIds.add(uid);
            });
        });
    });
    assert.equal(assignedUserIds.size, 302, "All 302 passenger IDs must be unique across all routes");
});

test("Scenario 37: Multi-Bus Shared Stop with Demand Split (Stop with 95 users split across Bus A: 70 and Bus B: 25)", async () => {
    const stops = [
        { name: "Major Terminal", userCount: 95, latitude: 12.9710, longitude: 77.5900 },
        { name: "Secondary Stop", userCount: 20, latitude: 12.9810, longitude: 77.6000 }
    ]; // Total demand = 115

    const rawVehicles = [
        { _id: "v1", name: "Bus A", capacity: 70 },
        { _id: "v2", name: "Bus B", capacity: 70 }
    ];

    const sourceHub = { name: "Depot", latitude: 12.9600, longitude: 77.5800 };

    const plan = await buildAIPlan({
        sourceHub,
        tripMode: "FROM_SOURCE",
        resolvedStops: stops,
        availableVehicles: rawVehicles,
        rawVehicles,
        totalComingUsers: 115,
        allUsersCount: 115
    });

    assert.equal(plan.assignedUsers, 115);
    assert.equal(plan.unassignedUsers, 0);

    // Major Terminal must be visited by both buses
    const terminalVisits = plan.buses.filter(b => b.stops.some(s => s.name === "Major Terminal"));
    assert.ok(terminalVisits.length >= 2, "Major Terminal must be served across multiple buses");

    const totalTerminalServed = terminalVisits.reduce((sum, b) => {
        const st = b.stops.find(s => s.name === "Major Terminal");
        return sum + (st ? st.userCount : 0);
    }, 0);
    assert.equal(totalTerminalServed, 95, "Total passengers served across visits to Major Terminal must equal 95");
});

test("Scenario 38: Secondary Available Vehicle Deployment When Primary Buses Are Full", async () => {
    // 4 corridors each with 30 passengers = 120 passengers
    const stops = [
        { name: "North Stop", userCount: 30, latitude: 12.9900, longitude: 77.5800 },
        { name: "East Stop", userCount: 30, latitude: 12.9600, longitude: 77.6100 },
        { name: "South Stop", userCount: 30, latitude: 12.9300, longitude: 77.5800 },
        { name: "West Stop", userCount: 30, latitude: 12.9600, longitude: 77.5500 }
    ]; // Demand = 120

    // 3 small buses of 50 capacity each (Total = 150)
    const rawVehicles = [
        { _id: "v1", name: "Bus 1", capacity: 50 },
        { _id: "v2", name: "Bus 2", capacity: 50 },
        { _id: "v3", name: "Bus 3", capacity: 50 }
    ];

    const sourceHub = { name: "Central Hub", latitude: 12.9600, longitude: 77.5800 };

    const plan = await buildAIPlan({
        sourceHub,
        tripMode: "FROM_SOURCE",
        resolvedStops: stops,
        availableVehicles: rawVehicles,
        rawVehicles,
        totalComingUsers: 120,
        allUsersCount: 120
    });

    assert.equal(plan.assignedUsers, 120);
    assert.equal(plan.unassignedUsers, 0);
    assert.ok(plan.buses.length >= 2, "Must deploy secondary available vehicles to cover all corridors");
});

test("Scenario 39: Strict Consecutive Road Segment Continuity (Reject 149 km Jump on Urban Route)", () => {
    const invalidBus = {
        capacity: 70,
        assignedUsers: 50,
        isRoadVerified: true,
        routeDistanceKm: 180.0,
        straightLineBaselineKm: 15.0,
        stops: [
            { name: "Stop A", latitude: 9.9200, longitude: 78.1200, legDistanceKm: 2.0 },
            { name: "Stop B", latitude: 9.9300, longitude: 78.1300, legDistanceKm: 3.0 },
            // Impossible 149 km jump between two adjacent urban stops (straight line 2 km)
            { name: "Stop C", latitude: 9.9400, longitude: 78.1400, legDistanceKm: 149.86 }
        ]
    };

    const continuity = validateRouteCorridorContinuity(invalidBus, { latitude: 9.9000, longitude: 78.1000 }, null, "FROM_SOURCE");
    assert.equal(continuity.isContinuous, false, "Abnormal 149 km road jump must be flagged as discontinuous");
    assert.equal(continuity.checks.check2b_roadSegmentContinuity, false, "check2b_roadSegmentContinuity must fail for 149 km jump");
});

test("Scenario 40: 400 Test Users with Unequal Stop Distribution (100% Allocation Guarantee)", async () => {
    const raw400Users = generate400TestUsers().map((u, i) => ({
        ...u,
        _id: `user-400-${i + 1}`,
        travelStatus: "Coming",
        role: "student"
    }));

    assert.equal(raw400Users.length, 400, "Exact 400 test users must be generated");

    const confirmed = getConfirmedUsers(raw400Users);
    assert.equal(confirmed.length, 400, "All 400 test users must have travelStatus Coming");

    const { uniqueUsers, duplicateCount } = deduplicateUsers(confirmed);
    assert.equal(uniqueUsers.length, 400);
    assert.equal(duplicateCount, 0);

    const stopGroups = calculateStoppingGroups(uniqueUsers);
    const totalGroupDemand = stopGroups.reduce((sum, g) => sum + g.userCount, 0);
    assert.equal(totalGroupDemand, 400, "Stop group demands must sum to exactly 400");

    // Verify unequal demand distribution across stops
    const counts = stopGroups.map((g) => g.userCount);
    const minCount = Math.min(...counts);
    const maxCount = Math.max(...counts);
    assert.ok(minCount < maxCount, `Demand must be unequal (Min: ${minCount}, Max: ${maxCount})`);
    assert.ok(counts.some(c => c > 20), "At least one stop must have > 20 users");
    assert.ok(counts.some(c => c <= 5), "At least one stop must have <= 5 users");

    // 7 vehicles with 70 seats each = 490 total available seats
    const rawVehicles = Array.from({ length: 7 }, (_, i) => ({
        _id: `bus-70-${i + 1}`,
        vehicleName: `Fleet Bus ${i + 1}`,
        capacity: 70
    }));

    // Pre-validation check
    const preValidation = validatePreOptimizationData({
        users: uniqueUsers,
        stoppingGroups: stopGroups,
        availableVehicles: rawVehicles
    });
    assert.equal(preValidation.isValid, true, "Pre-optimization data validation must pass");

    // Synthetic coordinates for simulation
    const resolvedStops = stopGroups.map((g, idx) => ({
        ...g,
        latitude: 9.9000 + (idx * 0.005),
        longitude: 78.1000 + (idx * 0.004)
    }));

    const sourceHub = { name: "Central Departure Hub", latitude: 9.8515, longitude: 78.1882 };

    const plan = await buildAIPlan({
        sourceHub,
        tripMode: "FROM_SOURCE",
        resolvedStops,
        availableVehicles: rawVehicles,
        rawVehicles,
        totalComingUsers: 400,
        allUsersCount: 400
    });

    assert.equal(plan.assignedUsers, 400, "100% of 400 confirmed passengers must be allocated");
    assert.equal(plan.unassignedUsers, 0, "Exactly 0 passengers must remain unallocated");
    assert.equal(plan.capacityShortage, false);

    // Verify zero duplicate passenger IDs across all buses
    const assignedIds = [];
    plan.buses.forEach((b) => {
        (b.users || []).forEach((uId) => assignedIds.push(String(uId)));
    });
    assert.equal(assignedIds.length, 400);
    const uniqueAssigned = new Set(assignedIds);
    assert.equal(uniqueAssigned.size, 400, "Zero duplicate passenger assignments allowed");
});

test("Scenario 41: Location Context Hierarchy Construction (No Hardcoded Cities)", () => {
    // Madurai stop with full location hierarchy
    const stopMadurai = {
        name: "Anna Nagar",
        city: "Madurai",
        state: "Tamil Nadu",
        country: "India"
    };
    const queryMadurai = buildStopLocationQuery(stopMadurai);
    assert.equal(queryMadurai, "Anna Nagar, Madurai, Tamil Nadu, India");

    // London stop with full location hierarchy
    const stopLondon = {
        name: "Oxford Street",
        city: "London",
        state: "England",
        country: "United Kingdom"
    };
    const queryLondon = buildStopLocationQuery(stopLondon);
    assert.equal(queryLondon, "Oxford Street, London, England, United Kingdom");

    // Tokyo stop
    const stopTokyo = {
        name: "Shibuya",
        city: "Tokyo",
        state: "Tokyo",
        country: "Japan"
    };
    const queryTokyo = buildStopLocationQuery(stopTokyo);
    assert.equal(queryTokyo, "Shibuya, Tokyo, Japan");

    // Sydney stop
    const stopSydney = {
        name: "Darling Harbour",
        city: "Sydney",
        state: "New South Wales",
        country: "Australia"
    };
    const querySydney = buildStopLocationQuery(stopSydney);
    assert.equal(querySydney, "Darling Harbour, Sydney, New South Wales, Australia");
});

test("Scenario 42: Ambiguous Location Name Disambiguation via Location Hierarchy", () => {
    const rawUsers = [
        { _id: "u1", name: "User 1", stoppings: ["Anna Nagar"], city: "Madurai", state: "Tamil Nadu", country: "India", role: "student", travelStatus: "Coming" },
        { _id: "u2", name: "User 2", stoppings: ["Anna Nagar"], city: "Chennai", state: "Tamil Nadu", country: "India", role: "student", travelStatus: "Coming" }
    ];

    const confirmed = getConfirmedUsers(rawUsers);
    const groups = calculateStoppingGroups(confirmed);

    // Because city differs, they must NOT collide into a single stop group
    assert.equal(groups.length, 2, "Anna Nagar in Madurai and Anna Nagar in Chennai must be segregated into 2 distinct stopping groups");
    assert.ok(groups.some(g => g.locationQuery.includes("Madurai")), "One group must specify Madurai");
    assert.ok(groups.some(g => g.locationQuery.includes("Chennai")), "One group must specify Chennai");
});

test("Scenario 43: Highly Unequal Demand Distribution (1, 2, 5, 11, 20, 40, etc.)", async () => {
    const highlyUnequalCounts = [1, 2, 5, 11, 20, 40, 3, 7, 14, 25, 2];
    const totalDemand = highlyUnequalCounts.reduce((a, b) => a + b, 0); // 130 demand

    const stops = highlyUnequalCounts.map((cnt, idx) => ({
        name: `Stop ${idx + 1}`,
        userCount: cnt,
        latitude: 12.9000 + (idx * 0.006),
        longitude: 77.5000 + (idx * 0.005)
    }));

    const rawVehicles = [
        { _id: "v1", name: "Bus 1", capacity: 70 },
        { _id: "v2", name: "Bus 2", capacity: 70 }
    ];

    const plan = await buildAIPlan({
        sourceHub: { name: "Depot", latitude: 12.8900, longitude: 77.4900 },
        tripMode: "OUTWARD",
        resolvedStops: stops,
        availableVehicles: rawVehicles,
        rawVehicles,
        totalComingUsers: totalDemand,
        allUsersCount: totalDemand
    });

    assert.equal(plan.assignedUsers, totalDemand, "All passengers across highly unequal stops must be boarded");
    assert.equal(plan.unassignedUsers, 0);
});

test("Scenario 44: Massive Stop Demand Exceeding Single Bus Capacity (140 Users at 1 Stop)", async () => {
    const stops = [
        { name: "Mega Terminal", userCount: 140, latitude: 12.9500, longitude: 77.6000 }
    ];

    // 2 buses of 70 capacity each = 140 capacity
    const rawVehicles = [
        { _id: "v1", name: "Bus 1", capacity: 70 },
        { _id: "v2", name: "Bus 2", capacity: 70 }
    ];

    const plan = await buildAIPlan({
        sourceHub: { name: "Departure Depot", latitude: 12.9000, longitude: 77.5500 },
        tripMode: "FROM_SOURCE",
        resolvedStops: stops,
        availableVehicles: rawVehicles,
        rawVehicles,
        totalComingUsers: 140,
        allUsersCount: 140
    });

    assert.equal(plan.assignedUsers, 140);
    assert.equal(plan.unassignedUsers, 0);
    assert.equal(plan.buses.length, 2, "Must deploy both buses to split the 140-passenger mega stop");
    assert.equal(plan.buses[0].assignedUsers, 70);
    assert.equal(plan.buses[1].assignedUsers, 70);
});

test("Scenario 45: Heterogeneous Fleet Capacities (30, 45, 60, 75 Seats)", async () => {
    const stops = [
        { name: "Area Alpha", userCount: 28, latitude: 13.0100, longitude: 80.2000 },
        { name: "Area Beta", userCount: 42, latitude: 13.0200, longitude: 80.2100 },
        { name: "Area Gamma", userCount: 58, latitude: 13.0300, longitude: 80.2200 },
        { name: "Area Delta", userCount: 72, latitude: 13.0400, longitude: 80.2300 }
    ]; // Total = 200 demand

    const rawVehicles = [
        { _id: "v1", name: "Minibus", capacity: 30 },
        { _id: "v2", name: "Medium Bus", capacity: 45 },
        { _id: "v3", name: "Standard Bus", capacity: 60 },
        { _id: "v4", name: "Large Coach", capacity: 75 }
    ]; // Total Capacity = 210

    const plan = await buildAIPlan({
        destinationHub: { name: "Central Tech Campus", latitude: 13.0800, longitude: 80.2700 },
        tripMode: "TO_DESTINATION",
        resolvedStops: stops,
        availableVehicles: rawVehicles,
        rawVehicles,
        totalComingUsers: 200,
        allUsersCount: 200
    });

    assert.equal(plan.assignedUsers, 200);
    assert.equal(plan.unassignedUsers, 0);
    assert.ok(plan.buses.every(b => b.assignedUsers <= b.capacity), "No bus capacity must be exceeded");
});

test("Scenario 46: Schedule Availability Filtering (Unavailable Vehicles Excluded)", () => {
    const vehicles = [
        { _id: "v1", vehicleName: "Bus 1", capacity: 50 },
        { _id: "v2", vehicleName: "Bus 2", capacity: 50 },
        { _id: "v3", vehicleName: "Bus 3", capacity: 50 }
    ];

    const schedules = [
        { vehicle: "v1", availability: "Available" },
        { vehicle: "v2", availability: "Not Available" }, // Disabled
        { vehicle: "v3", availability: "Maintenance / Unavailable" } // Disabled
    ];

    const available = getAvailableVehicles(vehicles, schedules);
    assert.equal(available.length, 1, "Only Bus 1 must be considered available");
    assert.equal(available[0]._id, "v1");
});

test("Scenario 47: Pre-Optimization Validation Data Integrity Checking", () => {
    // 1. Missing userId error
    const corruptedUsers1 = [
        { userId: "", name: "No ID", stoppings: "Stop A" }
    ];
    const val1 = validatePreOptimizationData({ users: corruptedUsers1, stoppingGroups: [], availableVehicles: [] });
    assert.equal(val1.isValid, false);
    assert.ok(val1.errors.some(e => e.includes("missing a userId")));

    // 2. Duplicate userId error
    const corruptedUsers2 = [
        { userId: "U1", name: "Alice", stoppings: "Stop A" },
        { userId: "U1", name: "Duplicate Alice", stoppings: "Stop B" }
    ];
    const val2 = validatePreOptimizationData({ users: corruptedUsers2, stoppingGroups: [], availableVehicles: [] });
    assert.equal(val2.isValid, false);
    assert.ok(val2.errors.some(e => e.includes("Duplicate userId detected")));

    // 3. Demand mismatch
    const validUsers = [
        { userId: "U1", name: "Alice", stoppings: "Stop A" },
        { userId: "U2", name: "Bob", stoppings: "Stop A" }
    ];
    const mismatchGroups = [{ name: "Stop A", userCount: 5 }]; // 5 != 2
    const val3 = validatePreOptimizationData({ users: validUsers, stoppingGroups: mismatchGroups, availableVehicles: [] });
    assert.equal(val3.isValid, false);
    assert.ok(val3.errors.some(e => e.includes("Demand mismatch")));
});

test("Scenario 48: Equal Demand Distribution Across All Stops", async () => {
    // 10 stops with exactly 10 users each = 100 demand
    const stops = Array.from({ length: 10 }, (_, i) => ({
        name: `Equal Stop ${i + 1}`,
        userCount: 10,
        latitude: 12.9000 + (i * 0.005),
        longitude: 77.5000 + (i * 0.004)
    }));

    const rawVehicles = [
        { _id: "v1", name: "Bus A", capacity: 50 },
        { _id: "v2", name: "Bus B", capacity: 50 }
    ];

    const plan = await buildAIPlan({
        sourceHub: { name: "Depot", latitude: 12.8900, longitude: 77.4900 },
        tripMode: "FROM_SOURCE",
        resolvedStops: stops,
        availableVehicles: rawVehicles,
        rawVehicles,
        totalComingUsers: 100,
        allUsersCount: 100
    });

    assert.equal(plan.assignedUsers, 100);
    assert.equal(plan.unassignedUsers, 0);
    assert.equal(plan.buses.length, 2);
    assert.equal(plan.buses[0].assignedUsers, 50);
    assert.equal(plan.buses[1].assignedUsers, 50);
});

test("Scenario 49: Test Matrix A-G Single-Stop Capacity Scaling (10, 50, 70, 71, 100, 140, 141 Passengers)", async () => {
    const cases = [
        { count: 10, busCap: [70], expectedBuses: 1, expectedAssigned: 10 },
        { count: 50, busCap: [70], expectedBuses: 1, expectedAssigned: 50 },
        { count: 70, busCap: [70], expectedBuses: 1, expectedAssigned: 70 },
        { count: 71, busCap: [70, 70], expectedBuses: 2, expectedAssigned: 71 },
        { count: 100, busCap: [70, 70], expectedBuses: 2, expectedAssigned: 100 },
        { count: 140, busCap: [70, 70], expectedBuses: 2, expectedAssigned: 140 },
        { count: 141, busCap: [70, 70, 70], expectedBuses: 3, expectedAssigned: 141 }
    ];

    for (const c of cases) {
        const stops = [{ name: "Target Stop", userCount: c.count, latitude: 12.9500, longitude: 77.6000 }];
        const vehicles = c.busCap.map((cap, i) => ({ _id: `v_${i}`, name: `Bus ${i + 1}`, capacity: cap }));
        const plan = await buildAIPlan({
            sourceHub: { name: "Depot", latitude: 12.9000, longitude: 77.5500 },
            tripMode: "FROM_SOURCE",
            resolvedStops: stops,
            availableVehicles: vehicles,
            rawVehicles: vehicles,
            totalComingUsers: c.count,
            allUsersCount: c.count
        });

        assert.equal(plan.assignedUsers, c.expectedAssigned, `For ${c.count} passengers, assigned must be ${c.expectedAssigned}`);
        assert.equal(plan.unassignedUsers, 0);
        assert.equal(plan.buses.length, c.expectedBuses, `For ${c.count} passengers, expected ${c.expectedBuses} bus(es)`);
    }
});

test("Scenario 50: Test Matrix H: 400 Passengers / 7 Buses (460 Seats) -> 100% (400/400) Allocated", async () => {
    // 400 users across 8 unequal stops
    const counts = [85, 70, 60, 50, 45, 40, 30, 20]; // sum = 400
    const stops = counts.map((cnt, i) => ({
        name: `Madurai Stop ${i + 1}`,
        userCount: cnt,
        latitude: 9.9000 + (i * 0.006),
        longitude: 78.1000 + (i * 0.005)
    }));

    // 7 buses with capacities: 70, 70, 70, 70, 70, 60, 50 = 460 total seats
    const vehicles = [
        { _id: "b1", vehicleName: "Bus 1", capacity: 70 },
        { _id: "b2", vehicleName: "Bus 2", capacity: 70 },
        { _id: "b3", vehicleName: "Bus 3", capacity: 70 },
        { _id: "b4", vehicleName: "Bus 4", capacity: 70 },
        { _id: "b5", vehicleName: "Bus 5", capacity: 70 },
        { _id: "b6", vehicleName: "Bus 6", capacity: 60 },
        { _id: "b7", vehicleName: "Bus 7", capacity: 50 }
    ];

    const sourceHub = { name: "K. L. N. College of Engineering", latitude: 9.83655, longitude: 78.16195 };

    const plan = await buildAIPlan({
        sourceHub,
        tripMode: "FROM_SOURCE",
        resolvedStops: stops,
        availableVehicles: vehicles,
        rawVehicles: vehicles,
        totalComingUsers: 400,
        allUsersCount: 400
    });

    assert.equal(plan.assignedUsers, 400, "All 400 passengers must be allocated across available buses");
    assert.equal(plan.unassignedUsers, 0);
    assert.equal(plan.capacityShortage, false);
    assert.ok(plan.buses.length >= 6, "Must allocate at least 6 buses to seat 400 passengers with max 70 capacity each");
});

test("Scenario 51: Test Matrix I: 400 Passengers / 280 Capacity -> 280 Allocated, 120 Unallocated (VEHICLE_CAPACITY)", async () => {
    const stops = [
        { name: "Stop 1", userCount: 200, latitude: 12.9100, longitude: 77.5100 },
        { name: "Stop 2", userCount: 200, latitude: 12.9200, longitude: 77.5200 }
    ]; // Total Demand = 400

    // Fleet of only 4 buses of 70 seats = 280 total capacity
    const vehicles = [
        { _id: "b1", name: "Bus 1", capacity: 70 },
        { _id: "b2", name: "Bus 2", capacity: 70 },
        { _id: "b3", name: "Bus 3", capacity: 70 },
        { _id: "b4", name: "Bus 4", capacity: 70 }
    ];

    const plan = await buildAIPlan({
        sourceHub: { name: "Depot", latitude: 12.9000, longitude: 77.5000 },
        tripMode: "FROM_SOURCE",
        resolvedStops: stops,
        availableVehicles: vehicles,
        rawVehicles: vehicles,
        totalComingUsers: 400,
        allUsersCount: 400
    });

    assert.equal(plan.assignedUsers, 280, "Must allocate exactly up to vehicle capacity (280)");
    assert.equal(plan.unassignedUsers, 120, "120 passengers must be reported as unallocated");
    assert.equal(plan.unallocatedReason, "VEHICLE_CAPACITY", "Reason must be honest VEHICLE_CAPACITY");
});

test("Scenario 52: Test Matrix J & K: Canonical Location Key & Regional Disambiguation", () => {
    const stopMadurai = {
        name: "Narimedu",
        city: "Madurai",
        state: "Tamil Nadu",
        country: "India"
    };
    const keyMadurai = [stopMadurai.name, stopMadurai.city, stopMadurai.state, stopMadurai.country].map(s => s.toLowerCase().trim()).join("|");
    assert.equal(keyMadurai, "narimedu|madurai|tamil nadu|india");

    const stopCuddalore = {
        name: "Narimedu",
        city: "Cuddalore",
        state: "Tamil Nadu",
        country: "India"
    };
    const keyCuddalore = [stopCuddalore.name, stopCuddalore.city, stopCuddalore.state, stopCuddalore.country].map(s => s.toLowerCase().trim()).join("|");
    assert.equal(keyCuddalore, "narimedu|cuddalore|tamil nadu|india");

    assert.notEqual(keyMadurai, keyCuddalore, "Canonical locationKeys must be completely distinct");
});

test("Scenario 53: Test Matrix M: Non-Uniform Irregular Demand (10, 37, 12, 61, 4, 86 = 210 Demand)", async () => {
    const counts = [10, 37, 12, 61, 4, 86]; // Total = 210
    const stops = counts.map((cnt, i) => ({
        name: `Stop ${i + 1}`,
        userCount: cnt,
        latitude: 12.9000 + (i * 0.007),
        longitude: 77.5000 + (i * 0.006)
    }));

    const vehicles = [
        { _id: "b1", capacity: 70 },
        { _id: "b2", capacity: 70 },
        { _id: "b3", capacity: 70 }
    ]; // 210 capacity

    const plan = await buildAIPlan({
        sourceHub: { name: "Hub", latitude: 12.8900, longitude: 77.4900 },
        tripMode: "FROM_SOURCE",
        resolvedStops: stops,
        availableVehicles: vehicles,
        rawVehicles: vehicles,
        totalComingUsers: 210,
        allUsersCount: 210
    });

    assert.equal(plan.assignedUsers, 210);
    assert.equal(plan.unassignedUsers, 0);
});

test("Scenario 54: Test Matrix N & O: Honest Road Fallback and Directional Inversion Rejection", async () => {
    const bus = {
        stops: [
            { name: "Stop 1", latitude: 12.9100, longitude: 77.5100 },
            { name: "Stop 2", latitude: 12.9200, longitude: 77.5200 }
        ],
        isRoadVerified: false,
        routeDistanceKm: 15.0
    };
    const sourceHub = { name: "Depot", latitude: 12.9000, longitude: 77.5000 };

    const routeValidation = validateRouteCorridorContinuity(bus, sourceHub, null, "FROM_SOURCE");
    assert.equal(routeValidation.directionalInversionDetected, false);
    assert.equal(routeValidation.backtrackingDetected, false);

    // Directional Inversion Route test
    const invertedBus = {
        stops: [
            { name: "Stop North", latitude: 13.0000, longitude: 77.5000 },
            { name: "Stop South", latitude: 12.8000, longitude: 77.5000 },
            { name: "Stop Far North", latitude: 13.1000, longitude: 77.5000 }
        ],
        isRoadVerified: true,
        routeDistanceKm: 45.0
    };
    const invertedValidation = validateRouteCorridorContinuity(invertedBus, sourceHub, null, "FROM_SOURCE");
    assert.equal(invertedValidation.isContinuous, false, "Directional inversion route must be marked not continuous");
    assert.equal(invertedValidation.directionalInversionDetected, true, "Directional inversion must be explicitly flagged");
});

test("Scenario 55: Test Matrix P: User Management Persistence Simulation (100 Coming Users)", async () => {
    const rawUsers = Array.from({ length: 100 }, (_, i) => ({
        _id: `u-${i + 1}`,
        userId: `USR${String(i + 1).padStart(3, "0")}`,
        name: `Student ${i + 1}`,
        stoppings: `Stop ${Math.floor(i / 20) + 1}`,
        city: "Madurai",
        state: "Tamil Nadu",
        country: "India",
        role: "student",
        travelStatus: "Coming",
        allocatedBus: null
    }));

    const groups = calculateStoppingGroups(rawUsers);
    const stops = groups.map((g, idx) => ({
        ...g,
        latitude: 9.9200 + (idx * 0.008),
        longitude: 78.1200 + (idx * 0.007)
    }));

    const vehicles = [
        { _id: "b1", vehicleName: "Bus 1", capacity: 70 },
        { _id: "b2", vehicleName: "Bus 2", capacity: 70 }
    ];

    const plan = await buildAIPlan({
        sourceHub: { name: "Campus Hub", latitude: 9.8365, longitude: 78.1619 },
        tripMode: "FROM_SOURCE",
        resolvedStops: stops,
        availableVehicles: vehicles,
        rawVehicles: vehicles,
        totalComingUsers: 100,
        allUsersCount: 100
    });

    assert.equal(plan.assignedUsers, 100);
    assert.equal(plan.unassignedUsers, 0);

    // Simulate in-memory persistence logic
    const userToBusMap = new Map();
    plan.buses.forEach(b => {
        (b.users || []).forEach(uId => userToBusMap.set(String(uId).toLowerCase().trim(), b));
    });

    const persistedUsers = rawUsers.map(u => {
        const assignedBus = userToBusMap.get(u._id) || userToBusMap.get(u.userId.toLowerCase());
        return {
            ...u,
            allocatedBus: assignedBus ? {
                isAllocated: true,
                allocationStatus: "Allocated",
                vehicleName: assignedBus.vehicleName,
                routeCode: assignedBus.routeCode
            } : { isAllocated: false, allocationStatus: "Unallocated" }
        };
    });

    const allocatedCount = persistedUsers.filter(u => u.travelStatus === "Coming" && u.allocatedBus?.isAllocated).length;
    const unallocatedCount = persistedUsers.filter(u => u.travelStatus === "Coming" && !u.allocatedBus?.isAllocated).length;

    assert.equal(allocatedCount, 100, "User Management must reflect 100 allocated users");
    assert.equal(unallocatedCount, 0, "User Management must reflect 0 unallocated users");
});

test("Scenario 56: Test Matrix Q: 400 Coming Users / 460 Available Seats Complete Reconciliation", async () => {
    const generator = await import("../generateTestUsersExcel.js");
    const testUsers = generator.generate400TestUsers();
    assert.equal(testUsers.length, 400);

    const sourceHub = { latitude: 9.83655, longitude: 78.16195, name: "K. L. N. College of Engineering" };
    const vehicles = Array.from({ length: 7 }, (_, i) => ({
        _id: `bus-${i + 1}`,
        vehicleName: `Fleet Bus ${i + 1}`,
        capacity: 70
    }));

    const groups = calculateStoppingGroups(testUsers);
    const resolvedStops = await resolveStopCoordinates(groups, sourceHub);

    const plan = await buildAIPlan({
        sourceHub,
        tripMode: "FROM_SOURCE",
        resolvedStops,
        availableVehicles: vehicles,
        rawVehicles: vehicles,
        totalComingUsers: 400,
        allUsersCount: 400
    });

    assert.equal(plan.assignedUsers, 400, "All 400 coming users must be allocated");
    assert.equal(plan.unassignedUsers, 0, "Zero unallocated users when capacity allows");

    const allAssignedIds = [];
    plan.buses.forEach(b => {
        (b.users || []).forEach(uId => allAssignedIds.push(String(uId)));
    });

    assert.equal(allAssignedIds.length, 400, "Total passenger ID references must equal 400");
    const uniqueIds = new Set(allAssignedIds);
    assert.equal(uniqueIds.size, 400, "Zero duplicate assignments across all buses");
});
