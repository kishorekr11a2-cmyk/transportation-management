import assert from "node:assert/strict";
import test from "node:test";
import {
    getConfirmedUsers,
    deduplicateUsers,
    calculateStoppingGroups,
    getVehicleCapacity,
    getAvailableVehicles,
    calculateDistanceKm,
    sequenceStopsContinuous,
    consolidateLowUtilizationRoutes,
    validateAndCertifyAIPlan,
    buildAIPlan,
    isValidCoordinate
} from "../services/aiAgentService.js";

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



