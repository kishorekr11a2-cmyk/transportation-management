import test from "node:test";
import assert from "node:assert/strict";
import {
    buildGlobalOptimizationMatrix,
    computeClarkeWrightSavings,
    insertStopNearestCost,
    optimizeTour2OptRoad,
    generateGlobalCandidateRoutes,
    sequenceInwardRouteStops,
    sequenceOutwardRouteStops,
    validateAndRepairRouteContinuity
} from "../services/routeOptimizationService.js";

// Common reference hubs
const collegeCampusHub = {
    name: "Engineering College Campus",
    latitude: 9.8825,
    longitude: 78.1633
};

const centralDepotHub = {
    name: "Central Transportation Depot",
    latitude: 9.9200,
    longitude: 78.1200
};

test("1. INWARD: Stops in divergent corridors are partitioned into geographically coherent routes", async () => {
    // South-West corridor stops vs North-East corridor stops heading inward to collegeCampusHub
    const stops = [
        // South-West Corridor (bearing ~230°-240° from campus)
        { name: "Palanganatham", latitude: 9.9050, longitude: 78.0950, userCount: 20, userIds: Array.from({ length: 20 }, (_, i) => `sw1_${i}`) },
        { name: "Thiruparankundram", latitude: 9.8780, longitude: 78.0710, userCount: 25, userIds: Array.from({ length: 25 }, (_, i) => `sw2_${i}`) },
        { name: "Tirunagar", latitude: 9.8620, longitude: 78.0550, userCount: 15, userIds: Array.from({ length: 15 }, (_, i) => `sw3_${i}`) },

        // North-East Corridor (bearing ~35°-45° from campus, divergent by ~170°)
        { name: "Othakadai", latitude: 9.9650, longitude: 78.1850, userCount: 20, userIds: Array.from({ length: 20 }, (_, i) => `ne1_${i}`) },
        { name: "Melur", latitude: 10.0309, longitude: 78.3376, userCount: 25, userIds: Array.from({ length: 25 }, (_, i) => `ne2_${i}`) }
    ];

    const matrix = await buildGlobalOptimizationMatrix({ depot: collegeCampusHub, stops });

    const candidateRoutes = generateGlobalCandidateRoutes({
        stops,
        matrix,
        maxBusCapacity: 70,
        tripMode: "TO_DESTINATION",
        options: {
            destinationHub: collegeCampusHub,
            anchorHub: collegeCampusHub
        }
    });

    // Cross-corridor merging must NOT combine South-West stops with North-East stops
    for (const route of candidateRoutes) {
        const hasSW = route.stops.some(s => ["Palanganatham", "Thiruparankundram", "Tirunagar"].includes(s.name));
        const hasNE = route.stops.some(s => ["Othakadai", "Melur"].includes(s.name));
        assert.ok(!(hasSW && hasNE), `Route ${route.routeId} must not mix divergent South-West and North-East corridors`);
    }

    // All passengers must be accounted for (zero passenger loss)
    const totalPax = candidateRoutes.reduce((sum, r) => sum + r.assignedUsers, 0);
    assert.equal(totalPax, 105, "All 105 passengers across corridors must be served");
});

test("2. OUTWARD: Stops in divergent corridors are not merged from departure origin", async () => {
    // Outward journey departing from collegeCampusHub
    const stops = [
        // West corridor (Arapalayam & Kalavasal)
        { name: "Arapalayam", latitude: 9.9320, longitude: 78.1060, userCount: 30, userIds: ["w1"] },
        { name: "Kalavasal", latitude: 9.9280, longitude: 78.0920, userCount: 25, userIds: ["w2"] },

        // South-East corridor (Kariyapatti & Aruppukottai)
        { name: "Kariyapatti", latitude: 9.6700, longitude: 78.1000, userCount: 20, userIds: ["se1"] },
        { name: "Aruppukottai", latitude: 9.5100, longitude: 78.1000, userCount: 20, userIds: ["se2"] }
    ];

    const matrix = await buildGlobalOptimizationMatrix({ depot: collegeCampusHub, stops });

    const candidateRoutes = generateGlobalCandidateRoutes({
        stops,
        matrix,
        maxBusCapacity: 70,
        tripMode: "FROM_SOURCE",
        options: {
            sourceHub: collegeCampusHub,
            anchorHub: collegeCampusHub
        }
    });

    for (const route of candidateRoutes) {
        const hasWest = route.stops.some(s => ["Arapalayam", "Kalavasal"].includes(s.name));
        const hasSE = route.stops.some(s => ["Kariyapatti", "Aruppukottai"].includes(s.name));
        assert.ok(!(hasWest && hasSE), `Route ${route.routeId} must not mix West and South-East corridors`);
    }
});

test("3. REVERSAL / HAIRPIN PENALTY: Candidate stop causing acute turnaround is rejected", () => {
    // Existing tour going progressively North
    const tour = [
        { name: "Stop 1", latitude: 9.9100, longitude: 78.1200, matrixIndex: 1 },
        { name: "Stop 2", latitude: 9.9300, longitude: 78.1200, matrixIndex: 2 }
    ];

    // Candidate stop that is way behind Stop 1 or causes acute hairpin turnaround (>130°)
    const hairpinStop = {
        name: "Hairpin Outlier",
        latitude: 9.8500, // 8 km behind Stop 1
        longitude: 78.1200,
        matrixIndex: 3
    };

    const insertResult = insertStopNearestCost({
        tour,
        stop: hairpinStop,
        stopMatrixIndex: 3,
        matrix: null,
        tripMode: "TO_DESTINATION",
        originHub: { name: "Starting Place", latitude: 9.9050, longitude: 78.1200 },
        destinationHub: { latitude: 9.9900, longitude: 78.1200 },
        rejectOnExcessiveDetour: true
    });

    assert.equal(insertResult.rejected, true, "Stop causing acute reversal away from destination must be rejected");
    assert.equal(insertResult.costDelta, Infinity);
});

test("4. LEGITIMATE ROAD DETOUR: Reasonable road network deviation (<= 2.0 km) is accepted", () => {
    const tour = [
        { name: "Goripalayam", latitude: 9.9300, longitude: 78.1300, matrixIndex: 1 },
        { name: "Tallakulam", latitude: 9.9360, longitude: 78.1340, matrixIndex: 2 }
    ];

    // Nearby stop in a residential lane with a slight natural road detour (0.5 km)
    const reasonableStop = {
        name: "Chinna Chokkikulam",
        latitude: 9.9330,
        longitude: 78.1360,
        matrixIndex: 3
    };

    const insertResult = insertStopNearestCost({
        tour,
        stop: reasonableStop,
        stopMatrixIndex: 3,
        matrix: null,
        tripMode: "TO_DESTINATION",
        destinationHub: collegeCampusHub,
        rejectOnExcessiveDetour: true
    });

    assert.equal(insertResult.rejected, undefined, "Reasonable road network deviation must be accepted");
    assert.ok(insertResult.bestPosition >= 0);
    assert.ok(insertResult.costDelta < 10.0);
    assert.equal(insertResult.updatedTour.length, 3);
});

test("5. PHYSICAL BARRIER: Nearby stops separated by river or highway without direct bridge are flagged", async () => {
    // Two stops geographically only 0.6 km apart across a river, but road distance is 8 km (18 min)
    const stops = [
        { name: "North River Bank", latitude: 9.9280, longitude: 78.1200, userCount: 10, userIds: Array.from({ length: 10 }, (_, i) => `r1_${i}`), matrixIndex: 1 },
        { name: "South River Bank (No Bridge)", latitude: 9.9230, longitude: 78.1200, userCount: 10, userIds: Array.from({ length: 10 }, (_, i) => `r2_${i}`), matrixIndex: 2 }
    ];

    // Mock matrix simulating the physical barrier
    const mockMatrix = {
        locations: [centralDepotHub, stops[0], stops[1]],
        getDist: (i, j) => {
            if (i === j) return 0;
            if ((i === 1 && j === 2) || (i === 2 && j === 1)) return 8.5; // 8.5 km road detour vs 0.55 km straight
            return 3.0;
        },
        getDur: (i, j) => {
            if (i === j) return 0;
            if ((i === 1 && j === 2) || (i === 2 && j === 1)) return 24.0; // 24 minutes driving
            return 8.0;
        }
    };

    // Clarke-Wright savings must heavily penalize connecting the barrier stops
    const savings = computeClarkeWrightSavings({
        stops,
        depot: centralDepotHub,
        distanceMatrix: mockMatrix,
        tripMode: "FROM_SOURCE"
    });

    // Because of the barrier penalty, savings between the two stops across the river should be <= 0 or rejected
    assert.equal(savings.length, 0, "Clarke-Wright savings must not recommend connecting stops across an extreme physical barrier");

    // validateAndRepairRouteContinuity should detect the barrier detour
    const routeWithBarrier = [
        {
            routeCode: "Barrier Test Bus",
            vehicleId: "veh_barrier",
            capacity: 50,
            assignedUsers: 20,
            stops: [stops[0], stops[1]]
        }
    ];

    const repairRes = await validateAndRepairRouteContinuity({
        chosenBuses: routeWithBarrier,
        availableVehicles: [{ _id: "veh_barrier", capacity: 50 }],
        anchorHub: centralDepotHub,
        sourceHub: centralDepotHub,
        tripMode: "FROM_SOURCE",
        matrix: mockMatrix
    });

    // The route failed continuity due to the barrier
    assert.ok(repairRes.unallocatedPassengers.length > 0 || repairRes.buses.length > 1,
        "System must isolate or split stops separated by severe physical road barrier");
});

test("6. UNAVAILABLE DISTANCES: Graceful fallback without crashing when matrix entries are missing", async () => {
    const stops = [
        { name: "Stop Alpha", latitude: 9.9200, longitude: 78.1200, userCount: 10, userIds: ["a1"] },
        { name: "Stop Beta", latitude: 9.9400, longitude: 78.1400, userCount: 10, userIds: ["b1"] }
    ];

    // Empty distanceMatrix without getDist/getDur
    const savings = computeClarkeWrightSavings({
        stops,
        depot: collegeCampusHub,
        distanceMatrix: null,
        tripMode: "TO_DESTINATION"
    });

    assert.ok(Array.isArray(savings), "computeClarkeWrightSavings must return an array even without matrix");

    const insertRes = insertStopNearestCost({
        tour: [stops[0]],
        stop: stops[1],
        stopMatrixIndex: 2,
        matrix: null,
        tripMode: "TO_DESTINATION"
    });

    assert.ok(Number.isFinite(insertRes.costDelta), "insertStopNearestCost must calculate finite cost delta with haversine fallback");
    assert.equal(insertRes.updatedTour.length, 2);
});

test("7. SINGLE-STOP ROUTES: Validated cleanly for both inward and outward directions", async () => {
    const singleStop = {
        name: "Isolated Village Center",
        latitude: 9.9600,
        longitude: 78.1400,
        userCount: 45,
        userIds: Array.from({ length: 45 }, (_, i) => `iso_${i}`)
    };

    // Outward 1-stop route
    const seqOutward = sequenceOutwardRouteStops({
        departureHub: collegeCampusHub,
        stops: [singleStop],
        matrix: null,
        tripMode: "FROM_SOURCE"
    });

    assert.equal(seqOutward.stops.length, 1);
    assert.equal(seqOutward.qualityValidation.directionalReversals, 0);
    assert.equal(seqOutward.qualityValidation.detourRatio, 1.0);

    // Inward 1-stop route
    const seqInward = sequenceInwardRouteStops({
        startingHub: { name: "Vehicle Village Parking", latitude: 9.9650, longitude: 78.1420 },
        destinationHub: collegeCampusHub,
        stops: [singleStop],
        matrix: null,
        tripMode: "TO_DESTINATION"
    });

    assert.equal(seqInward.stops.length, 1);
    assert.equal(seqInward.qualityValidation.directionalReversals, 0);
    assert.ok(seqInward.qualityValidation.detourRatio <= 3.0);
    assert.equal(seqInward.qualityValidation.operationalContinuityVerified, true);
});
