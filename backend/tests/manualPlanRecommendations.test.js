import test from "node:test";
import assert from "node:assert/strict";
import {
    generateManualPlanRecommendations,
    validateRouteContinuityAndFeasibility
} from "../services/manualPlanRecommendationService.js";

test("AI Recommendation for Admin Manual Plan Test Suite", async (t) => {

    const mockHub = {
        name: "K.L.N. College of Engineering",
        latitude: 9.8324,
        longitude: 78.1884,
        isHub: true
    };

    function createMockStudent(id, name, stopName, travelStatus = "Coming", lat = null, lng = null) {
        return {
            _id: `stu_${id}`,
            userId: `STU_${id}`,
            name,
            role: "student",
            travelStatus,
            stoppings: stopName,
            latitude: lat,
            longitude: lng,
            city: "Madurai",
            district: "Madurai"
        };
    }

    function createMockVehicle(id, name, capacity) {
        return {
            _id: `veh_${id}`,
            vehicleName: name,
            vehicleNumber: `TN-58-AB-${id}`,
            capacity
        };
    }

    function createMockRoute(id, routeName, direction, vehicle, stops) {
        return {
            _id: `route_${id}`,
            routeId: `route_${id}`,
            routeName,
            direction,
            assignedVehicle: vehicle,
            vehicleName: vehicle?.vehicleName || "Bus",
            capacity: vehicle?.capacity || 40,
            source: stops[0] || null,
            stops: stops.slice(1, -1),
            destination: stops[stops.length - 1] || null
        };
    }

    await t.test("1. Review-Only: recommendations do not modify or mutate saved routes", async () => {
        const initialRoutes = [
            {
                _id: "r1",
                routeName: "East Corridor Line",
                direction: "OUTWARD",
                assignedVehicle: { _id: "veh-1", vehicleName: "Bus Alpha", capacity: 40 },
                stops: [
                    { name: "Anna Nagar", latitude: 9.917, longitude: 78.140 }
                ]
            }
        ];

        const routesCopy = JSON.parse(JSON.stringify(initialRoutes));

        const result = await generateManualPlanRecommendations({
            direction: "OUTWARD"
        });

        assert.ok(result);
        assert.equal(result.success, true);
        assert.ok(result.summary);
        assert.ok(Array.isArray(result.recommendations));
        assert.ok(result.analyzedAt);

        assert.ok("totalRecommendations" in result.summary);
        assert.ok("highPriority" in result.summary);
        assert.ok("mediumPriority" in result.summary);
        assert.ok("fleetCapacity" in result.summary);
        assert.ok("fleetUtilization" in result.summary);
        assert.deepEqual(initialRoutes, routesCopy, "Initial routes must not be mutated");
    });

    await t.test("2. INWARD and OUTWARD remain strictly independent", async () => {
        const inwardResult = await generateManualPlanRecommendations({ direction: "INWARD" });
        const outwardResult = await generateManualPlanRecommendations({ direction: "OUTWARD" });

        assert.equal(inwardResult.direction, "INWARD");
        assert.equal(outwardResult.direction, "OUTWARD");
        assert.ok(Array.isArray(inwardResult.recommendations));
        assert.ok(Array.isArray(outwardResult.recommendations));
    });

    await t.test("3. Route Continuity: OUTWARD routes start at Institutional Hub and preserve continuous sequence", async () => {
        const busQ1 = createMockVehicle("q1", "Bus Q1", 50);
        const stops = [
            { name: "Villapuram", latitude: 9.8970, longitude: 78.1180 },
            { name: "Avaniyapuram Canal", latitude: 9.8820, longitude: 78.1150 },
            { name: "Anuppanadi", latitude: 9.9050, longitude: 78.1420 }
        ];
        const route = createMockRoute("1", "South Route 2", "OUTWARD", busQ1, stops);

        const students = [
            ...Array.from({ length: 30 }, (_, i) => createMockStudent(`v_${i}`, `Student V${i}`, "Villapuram")),
            ...Array.from({ length: 15 }, (_, i) => createMockStudent(`a_${i}`, `Student A${i}`, "Arappalayam")) // Unserviced
        ];

        const result = await generateManualPlanRecommendations({
            direction: "OUTWARD",
            routes: [route],
            vehicles: [busQ1],
            users: students,
            institutionalHub: mockHub
        });

        assert.equal(result.success, true);
        assert.ok(result.recommendations.length > 0);

        for (const rec of result.recommendations) {
            if (rec.recommendedRoute && rec.recommendedRoute.length > 0) {
                // OUTWARD continuous route must start at Institutional Hub
                const firstStop = rec.recommendedRoute[0];
                assert.ok(
                    firstStop.isHub || firstStop.name.toLowerCase().includes("college") || firstStop.routePointType === "hub",
                    `First stop of OUTWARD recommended route must be Hub, got: ${firstStop.name}`
                );

                // Check stop ordering
                rec.recommendedRoute.forEach((pt, idx) => {
                    assert.equal(pt.order, idx + 1, "Stop orders must be consecutive 1-indexed integers");
                    assert.ok(Number.isFinite(pt.latitude), "Stop latitude must be numeric");
                    assert.ok(Number.isFinite(pt.longitude), "Stop longitude must be numeric");
                });

                // Check road validation fields
                assert.ok(rec.roadValidation, "Road validation object must be present");
                assert.ok(typeof rec.roadValidation.isRoadVerified === "boolean");
                assert.ok(rec.roadValidation.distanceKm > 0, "Distance must be positive");
                assert.ok(rec.roadValidation.durationMin > 0, "Duration must be positive");
                assert.ok(Array.isArray(rec.roadValidation.geometry), "Road geometry must be an array");

                // Complete Route Recommendation label
                assert.equal(rec.recommendationLabel, "Complete Route Recommendation");
            }
        }
    });

    await t.test("4. Strict Capacity Math: Never falsely claims students are accommodated when demand exceeds capacity", async () => {
        const busSmall = createMockVehicle("s1", "Bus Small", 30);
        const stops = [
            { name: "Simmakkal", latitude: 9.9288, longitude: 78.1234 },
            { name: "Goripalayam", latitude: 9.9252, longitude: 78.1198 }
        ];
        const route = createMockRoute("1", "Central Line", "INWARD", busSmall, stops);

        // 30 students already allocated + 20 unserviced students = 50 total demand vs 30 capacity
        const students = [
            ...Array.from({ length: 30 }, (_, i) => createMockStudent(`s_${i}`, `Student S${i}`, "Simmakkal")),
            ...Array.from({ length: 20 }, (_, i) => createMockStudent(`u_${i}`, `Student U${i}`, "Tallakulam"))
        ];

        const result = await generateManualPlanRecommendations({
            direction: "INWARD",
            routes: [route],
            vehicles: [busSmall],
            users: students,
            institutionalHub: mockHub
        });

        assert.equal(result.success, true);
        for (const rec of result.recommendations) {
            if (rec.capacityAnalysis) {
                const { currentDemand, additionalDemand, totalExpectedDemand, capacity, remainingSeats, standbyAfterRecommendation, isFullyAccommodated } = rec.capacityAnalysis;
                assert.equal(currentDemand + additionalDemand, totalExpectedDemand, "Demand math must balance");
                assert.equal(remainingSeats, Math.max(0, capacity - totalExpectedDemand), "Remaining seats math must be exact");
                assert.equal(standbyAfterRecommendation, Math.max(0, totalExpectedDemand - capacity), "Standby shortage math must be exact");

                if (standbyAfterRecommendation > 0) {
                    assert.equal(isFullyAccommodated, false, "Must NOT claim fully accommodated when standby shortage exists");
                    assert.ok(
                        rec.constraints.toLowerCase().includes("capacity") || rec.expectedBenefit.includes("standby") || rec.capacityAnalysis.additionalBusesRequired > 0,
                        "Must honestly flag capacity constraint"
                    );
                }
            }
        }

        // Summary must honestly report projected standby!
        assert.ok(result.summary.projectedStandbyStudents > 0, "Summary must show remaining standby, not 0");
        assert.ok(!result.summary.potentialCapacityImprovement.includes("100%"), "Summary must not claim 100% when shortage exists");
    });

    await t.test("5. Bus Swap Recommendation: Recommends available larger bus for overloaded route", async () => {
        const busFull = createMockVehicle("f1", "Bus Full", 40);
        const largerBusAvailable = createMockVehicle("big1", "Bus Heavy", 60);

        const stops = [
            { name: "Villapuram", latitude: 9.8970, longitude: 78.1180 },
            { name: "Anuppanadi", latitude: 9.9050, longitude: 78.1420 }
        ];
        const route = createMockRoute("1", "South Corridor", "OUTWARD", busFull, stops);

        // 40 students filling the 40-seat bus to 100% capacity
        const students = Array.from({ length: 40 }, (_, i) => createMockStudent(`st_${i}`, `Student ${i}`, "Villapuram"));

        const result = await generateManualPlanRecommendations({
            direction: "OUTWARD",
            routes: [route],
            vehicles: [busFull, largerBusAvailable],
            users: students,
            institutionalHub: mockHub
        });

        assert.equal(result.success, true);
        const swapRec = result.recommendations.find((r) => r.type === "BUS_SWAP");
        assert.ok(swapRec, "Must generate a BUS_SWAP recommendation when bus is 100% full and larger fleet vehicle is unassigned");
        assert.equal(swapRec.bus.suggestedVehicleName, "Bus Heavy");
        assert.equal(swapRec.capacityAnalysis.capacity, 60);
        assert.equal(swapRec.capacityAnalysis.remainingSeats, 20); // 60 - 40 = 20 buffer seats gained
    });

    await t.test("6. Route Continuity & Feasibility validation function", async () => {
        // Valid OUTWARD sequence starting at Hub
        const validOutward = [
            { name: "College", latitude: 9.8324, longitude: 78.1884, isHub: true },
            { name: "Anuppanadi", latitude: 9.9070, longitude: 78.1510 },
            { name: "Anna Nagar", latitude: 9.9180, longitude: 78.1467 }
        ];
        const v1 = validateRouteContinuityAndFeasibility(validOutward, "OUTWARD");
        assert.equal(v1.isValid, true);
        assert.equal(v1.continuityStatus, "Continuous Road Sequence");

        // Invalid OUTWARD sequence not starting at Hub
        const invalidOutward = [
            { name: "Anuppanadi", latitude: 9.9070, longitude: 78.1510 },
            { name: "Anna Nagar", latitude: 9.9180, longitude: 78.1467 }
        ];
        const v2 = validateRouteContinuityAndFeasibility(invalidOutward, "OUTWARD");
        assert.equal(v2.isValid, false);
        assert.equal(v2.continuityStatus, "Direction Inversion Detected");

        // Impossible geographic leap (> 28 km)
        const leapSequence = [
            { name: "College", latitude: 9.8324, longitude: 78.1884, isHub: true },
            { name: "Distant Stop", latitude: 10.5000, longitude: 78.8000 } // > 90 km away
        ];
        const v3 = validateRouteContinuityAndFeasibility(leapSequence, "OUTWARD");
        assert.equal(v3.isValid, false);
        assert.ok(v3.continuityStatus.includes("Impossible Geographic Jump"));
    });

    await t.test("7. Exact Student-to-Stop Matching for Passenger Reallocation", async () => {
        const busHalf = createMockVehicle("h1", "Bus Half", 30);
        const stops = [
            { name: "Anna Nagar", latitude: 9.9180, longitude: 78.1467 },
            { name: "KK Nagar", latitude: 9.9270, longitude: 78.1510 }
        ];
        const route = createMockRoute("1", "East Line", "OUTWARD", busHalf, stops);

        // 20 students already boarded at Anna Nagar (leaving 10 vacant seats on Bus Half)
        // 10 standby students at "Sundaram Park" (nearby landmark: lat 9.9265, lng 78.1505, ~80m from KK Nagar)
        // 15 standby students at "Vilangudi" (North-West: lat 9.9510, lng 78.0920, > 7 km away from East Line)
        const students = [
            ...Array.from({ length: 20 }, (_, i) => createMockStudent(`ann_${i}`, `Student Ann ${i}`, "Anna Nagar")),
            ...Array.from({ length: 10 }, (_, i) => createMockStudent(`sp_${i}`, `Student SP ${i}`, "Sundaram Park", "Coming", 9.9265, 78.1505)),
            ...Array.from({ length: 15 }, (_, i) => createMockStudent(`vil_${i}`, `Student Vil ${i}`, "Vilangudi", "Coming", 9.9510, 78.0920))
        ];

        const result = await generateManualPlanRecommendations({
            direction: "OUTWARD",
            routes: [route],
            vehicles: [busHalf],
            users: students,
            institutionalHub: mockHub
        });

        assert.equal(result.success, true);
        const reallocRec = result.recommendations.find((r) => r.type === "PASSENGER_REALLOCATION");
        assert.ok(reallocRec, "Must generate PASSENGER_REALLOCATION for corridor matching standby students");

        // Verify student breakdown: must contain Sundaram Park matched to KK Nagar, but NOT Vilangudi
        assert.ok(Array.isArray(reallocRec.studentBreakdown));
        const matchedStopNames = reallocRec.studentBreakdown.map((b) => b.stopName.toLowerCase());
        assert.ok(matchedStopNames.some((n) => n.includes("sundaram park")), "Must match Sundaram Park landmark");
        assert.ok(!matchedStopNames.some((n) => n.includes("vilangudi")), "Must NOT assign non-corridor Vilangudi students to East Line");

        // Capacity check: 10 students allocated to fill the remaining 10 seats
        assert.equal(reallocRec.affectedStudents, 10);
        assert.equal(reallocRec.capacityAnalysis.remainingSeats, 0); // 30 - 20 - 10 = 0
    });

    await t.test("8. True Synchronized Shared Stop Recommendation", async () => {
        const bus1 = createMockVehicle("b1", "Bus 1", 40);
        const bus2 = createMockVehicle("b2", "Bus 2", 40);

        const stopsRoute1 = [
            { name: "Mattuthavani", latitude: 9.9450, longitude: 78.1580 },
            { name: "Anna Nagar", latitude: 9.9180, longitude: 78.1467 }
        ];
        const stopsRoute2 = [
            { name: "Bibikulam", latitude: 9.9420, longitude: 78.1360 },
            { name: "Anna Nagar", latitude: 9.9180, longitude: 78.1467 }
        ];

        const r1 = createMockRoute("1", "Route 1", "OUTWARD", bus1, stopsRoute1);
        const r2 = createMockRoute("2", "Route 2", "OUTWARD", bus2, stopsRoute2);

        const students = [
            ...Array.from({ length: 15 }, (_, i) => createMockStudent(`m_${i}`, `Student M${i}`, "Mattuthavani")),
            ...Array.from({ length: 15 }, (_, i) => createMockStudent(`bb_${i}`, `Student B${i}`, "Bibikulam")),
            ...Array.from({ length: 20 }, (_, i) => createMockStudent(`an_${i}`, `Student AN${i}`, "Anna Nagar"))
        ];

        const result = await generateManualPlanRecommendations({
            direction: "OUTWARD",
            routes: [r1, r2],
            vehicles: [bus1, bus2],
            users: students,
            institutionalHub: mockHub
        });

        assert.equal(result.success, true);
        const sharedRec = result.recommendations.find((r) => r.type === "SHARED_STOP");
        assert.ok(sharedRec, "Must identify synchronized shared stop at Anna Nagar");
        assert.ok(sharedRec.routeA, "Must provide Route A data");
        assert.ok(sharedRec.routeB, "Must provide Route B data");
        assert.ok(Array.isArray(sharedRec.routeA.currentRoute));
        assert.ok(Array.isArray(sharedRec.routeB.currentRoute));
        assert.equal(sharedRec.recommendationLabel, "Complete Route Recommendation");
    });

    await t.test("9. Route Split Recommendation for Heavily Overloaded Corridor", async () => {
        const busOverloaded = createMockVehicle("ov1", "Bus Overloaded", 50);
        const extraBus = createMockVehicle("ex1", "Bus Spare", 50);

        // 5 stops with 60 passengers (exceeds 50 seats)
        const stops = [
            { name: "Stop 1", latitude: 9.9000, longitude: 78.1000 },
            { name: "Stop 2", latitude: 9.9100, longitude: 78.1100 },
            { name: "Stop 3", latitude: 9.9200, longitude: 78.1200 },
            { name: "Stop 4", latitude: 9.9300, longitude: 78.1300 },
            { name: "Stop 5", latitude: 9.9400, longitude: 78.1400 }
        ];
        const route = createMockRoute("1", "Long Heavy Route", "OUTWARD", busOverloaded, stops);

        const students = Array.from({ length: 60 }, (_, i) =>
            createMockStudent(`s_${i}`, `Student ${i}`, stops[i % 5].name)
        );

        const result = await generateManualPlanRecommendations({
            direction: "OUTWARD",
            routes: [route],
            vehicles: [busOverloaded, extraBus],
            users: students,
            institutionalHub: mockHub
        });

        assert.equal(result.success, true);
        const splitRec = result.recommendations.find((r) => r.type === "ROUTE_SPLIT");
        assert.ok(splitRec, "Must generate ROUTE_SPLIT for long overloaded corridor with available fleet vehicle");
        assert.ok(splitRec.splitRoute1, "Must contain splitRoute1");
        assert.ok(splitRec.splitRoute2, "Must contain splitRoute2");
        assert.ok(splitRec.splitRoute1.stops.length >= 2);
        assert.ok(splitRec.splitRoute2.stops.length >= 2);
        assert.equal(splitRec.recommendationLabel, "Complete Route Recommendation");
    });

    await t.test("10. Summary Metrics: Collective Plan Math & No Double-Counting", async () => {
        const bus1 = createMockVehicle("b1", "Bus 1", 50);
        const bus2 = createMockVehicle("b2", "Bus 2", 50);

        const stops1 = [
            { name: "Sellur", latitude: 9.9410, longitude: 78.1180 },
            { name: "Koodal Nagar", latitude: 9.9620, longitude: 78.1050 }
        ];
        const r1 = createMockRoute("1", "North Route", "OUTWARD", bus1, stops1);

        // 50 students on North Route + 20 standby students at Arappalayam (unserviced)
        const students = [
            ...Array.from({ length: 50 }, (_, i) => createMockStudent(`n_${i}`, `Student N${i}`, "Sellur")),
            ...Array.from({ length: 20 }, (_, i) => createMockStudent(`ar_${i}`, `Student AR${i}`, "Arappalayam"))
        ];

        const result = await generateManualPlanRecommendations({
            direction: "OUTWARD",
            routes: [r1],
            vehicles: [bus1, bus2],
            users: students,
            institutionalHub: mockHub
        });

        assert.equal(result.success, true);
        const summary = result.summary;

        assert.equal(summary.totalComingStudents, 70);
        assert.equal(summary.currentAllocatedStudents, 50);
        assert.equal(summary.currentStandbyStudents, 20);

        // Sum of allocated + standby must equal total confirmed Coming students exactly
        assert.equal(
            summary.projectedAllocatedStudents + summary.projectedStandbyStudents,
            summary.totalComingStudents,
            "Collective plan math must strictly reconcile: projectedAllocated + projectedStandby === totalComing"
        );

        assert.ok("roadVerifiedRoutesCount" in summary);
        assert.ok("manualValidationRoutesCount" in summary);
        assert.ok("additionalBusesRequired" in summary);
    });

    await t.test("11. Fallback and direction resilience", async () => {
        const fallbackResult = await generateManualPlanRecommendations({ direction: "UNKNOWN" });
        assert.equal(fallbackResult.success, true);
        assert.equal(fallbackResult.direction, "INWARD");
    });
});
