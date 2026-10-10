import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    calculatePassengerTravelTimeMetrics,
    calculateMultiObjectiveRouteScore,
    evaluateCandidateFleetFeasibility
} from "../services/routeOptimizationService.js";

describe("Passenger Travel Time Optimization & 60-Minute Constraint", () => {
    const collegeHub = {
        name: "K. L. N. College of Engineering",
        latitude: 9.8375,
        longitude: 78.1887
    };

    it("calculates cumulative OSRM passenger travel times accurately for OUTWARD stops", () => {
        // Example from requirement:
        // College -> Stop A (15 min) -> Stop B (8 min) -> Stop C (10 min) -> Stop D (7 min)
        // Expected passenger travel time:
        // Stop A = 15 min, Stop B = 23 min, Stop C = 33 min, Stop D = 40 min
        const stops = [
            { name: "Stop A", latitude: 9.87, longitude: 78.15, userCount: 10, legDurationMin: 15.0, cumulativeDurationMin: 15.0 },
            { name: "Stop B", latitude: 9.89, longitude: 78.13, userCount: 15, legDurationMin: 8.0, cumulativeDurationMin: 23.0 },
            { name: "Stop C", latitude: 9.91, longitude: 78.12, userCount: 20, legDurationMin: 10.0, cumulativeDurationMin: 33.0 },
            { name: "Stop D", latitude: 9.93, longitude: 78.10, userCount: 10, legDurationMin: 7.0, cumulativeDurationMin: 40.0 }
        ];

        const metrics = calculatePassengerTravelTimeMetrics({
            direction: "OUTWARD",
            sourceHub: collegeHub,
            stops,
            totalRouteDurationMin: 40.0,
            totalRouteDistanceKm: 25.0
        });

        assert.equal(metrics.totalRouteDuration, 40.0);
        assert.equal(metrics.longestPassengerTravelTime, 40.0);
        // Weighted average: (10*15 + 15*23 + 20*33 + 10*40) / 55 = (150 + 345 + 660 + 400) / 55 = 1555 / 55 = 28.3 min
        assert.equal(metrics.averagePassengerTravelTime, 28.3);
        assert.equal(metrics.passengersWithin60, 55);
        assert.equal(metrics.passengersAbove60, 0);
        assert.equal(metrics.allPassengersWithin60, true);
        assert.equal(metrics.travelTimeConstraintSatisfied, true);
        assert.equal(metrics.violatingStops.length, 0);

        // Check per-stop cumulative duration calculation
        const stopA = metrics.stopTravelTimes.find(s => s.name === "Stop A");
        const stopB = metrics.stopTravelTimes.find(s => s.name === "Stop B");
        const stopC = metrics.stopTravelTimes.find(s => s.name === "Stop C");
        const stopD = metrics.stopTravelTimes.find(s => s.name === "Stop D");
        assert.equal(stopA.travelTimeMin, 15.0);
        assert.equal(stopB.travelTimeMin, 23.0);
        assert.equal(stopC.travelTimeMin, 33.0);
        assert.equal(stopD.travelTimeMin, 40.0);
    });

    it("detects routes where passengers exceed 60 minutes operational limit", () => {
        const stops = [
            { name: "Stop A", latitude: 9.87, longitude: 78.15, userCount: 20, legDurationMin: 20.0, cumulativeDurationMin: 20.0 },
            { name: "Stop B", latitude: 9.92, longitude: 78.12, userCount: 20, legDurationMin: 25.0, cumulativeDurationMin: 45.0 },
            { name: "Stop C", latitude: 9.98, longitude: 78.05, userCount: 15, legDurationMin: 22.0, cumulativeDurationMin: 67.0 }
        ];

        const metrics = calculatePassengerTravelTimeMetrics({
            direction: "OUTWARD",
            sourceHub: collegeHub,
            stops,
            totalRouteDurationMin: 67.0,
            totalRouteDistanceKm: 38.0
        });

        assert.equal(metrics.longestPassengerTravelTime, 67.0);
        assert.equal(metrics.passengersWithin60, 40);
        assert.equal(metrics.passengersAbove60, 15);
        assert.equal(metrics.allPassengersWithin60, false);
        assert.equal(metrics.travelTimeConstraintSatisfied, false);
        assert.equal(metrics.violatingStops.length, 1);
        assert.equal(metrics.violatingStops[0].name, "Stop C");
        assert.equal(metrics.violatingStops[0].travelTimeMin, 67.0);
    });

    it("calculates cumulative travel times accurately for INWARD stops (boarding stop -> college)", () => {
        // INWARD bus travels:
        // Start -> Stop 1 (10 pax) -> Stop 2 (15 pax) -> College
        // Leg durations: Start -> Stop 1 (10m), Stop 1 -> Stop 2 (12m), Stop 2 -> College (20m)
        // Stop 1 passenger travel time to college = Stop 1->Stop 2 (12m) + Stop 2->College (20m) = 32m
        // Stop 2 passenger travel time to college = Stop 2->College = 20m
        const stops = [
            { name: "Inward Stop 1", latitude: 9.95, longitude: 78.10, userCount: 10, legDurationMin: 12.0 },
            { name: "Inward Stop 2", latitude: 9.90, longitude: 78.14, userCount: 15, legDurationMin: 20.0 }
        ];

        const metrics = calculatePassengerTravelTimeMetrics({
            direction: "INWARD",
            sourceHub: { name: "Start Depot", latitude: 9.96, longitude: 78.09 },
            destinationHub: collegeHub,
            stops,
            totalRouteDurationMin: 42.0,
            totalRouteDistanceKm: 28.0
        });

        assert.ok(metrics.longestPassengerTravelTime <= 42.0);
        assert.equal(metrics.passengersWithin60, 25);
        assert.equal(metrics.passengersAbove60, 0);
        assert.equal(metrics.allPassengersWithin60, true);
    });

    it("penalizes route score when passenger travel time exceeds 60 minutes", () => {
        const standardScore = calculateMultiObjectiveRouteScore({
            passengerCount: 50,
            vehicleCapacity: 50,
            roadDistanceKm: 25,
            routeDurationMin: 35,
            stops: [{ name: "Stop A", userCount: 50 }],
            isContinuous: true,
            detourRatio: 1.1,
            longestPassengerTravelTime: 35,
            averagePassengerTravelTime: 35,
            passengersAbove60: 0
        });

        const penalizedScore = calculateMultiObjectiveRouteScore({
            passengerCount: 50,
            vehicleCapacity: 50,
            roadDistanceKm: 45,
            routeDurationMin: 70,
            stops: [{ name: "Stop B", userCount: 50 }],
            isContinuous: true,
            detourRatio: 1.1,
            longestPassengerTravelTime: 70,
            averagePassengerTravelTime: 70,
            passengersAbove60: 15
        });

        assert.ok(standardScore.totalScore > penalizedScore.totalScore, "Route with travel time violation should have lower score");
        assert.ok(penalizedScore.diagnostics.travelTimePenalty > 0, "Travel time penalty should be recorded in diagnostics");
    });

    it("evaluates fleet feasibility with 60-minute travel time constraint (7, 8, 9 buses)", () => {
        // Test Candidate Fleet Feasibility for 421 demand across scheduled buses
        const availableVehicles = [
            { vehicleName: "V1", capacity: 65 },
            { vehicleName: "w1", capacity: 60 },
            { vehicleName: "h1", capacity: 55 },
            { vehicleName: "z1", capacity: 55 },
            { vehicleName: "k1", capacity: 50 },
            { vehicleName: "D1", capacity: 50 },
            { vehicleName: "I1", capacity: 50 },
            { vehicleName: "A2", capacity: 50 },
            { vehicleName: "Q1", capacity: 50 }
        ];

        // 7 buses: Sum of top 7 capacities = 65+60+55+55+50+50+50 = 385 seats < 421 passengers -> Capacity FAIL
        const eval7 = evaluateCandidateFleetFeasibility({
            busCount: 7,
            totalComingUsers: 421,
            availableVehicles,
            activeRoutes: []
        });
        assert.equal(eval7.capacityPassed, false);
        assert.equal(eval7.verdict, "Reject");

        // 8 buses: Capacity = 385+50 = 435 seats >= 421 -> Capacity PASS, but if routing / travel time fails -> Reject
        const eval8 = evaluateCandidateFleetFeasibility({
            busCount: 8,
            totalComingUsers: 421,
            availableVehicles,
            activeRoutes: [
                {
                    vehicleName: "w1",
                    assignedUsers: 55,
                    isContinuous: true,
                    longestPassengerTravelTime: 68.0,
                    passengersAbove60: 12
                }
            ]
        });
        assert.equal(eval8.capacityPassed, true);
        assert.equal(eval8.travelTimePassed, false);
        assert.equal(eval8.verdict, "Reject");

        // 9 buses: All constraints pass -> Accept
        const eval9 = evaluateCandidateFleetFeasibility({
            busCount: 9,
            totalComingUsers: 421,
            availableVehicles,
            activeRoutes: [
                {
                    vehicleName: "V1",
                    assignedUsers: 47,
                    isContinuous: true,
                    longestPassengerTravelTime: 41.4,
                    passengersAbove60: 0
                },
                {
                    vehicleName: "w1",
                    assignedUsers: 57,
                    isContinuous: true,
                    longestPassengerTravelTime: 39.6,
                    passengersAbove60: 0
                }
            ]
        });
        assert.equal(eval9.capacityPassed, true);
        assert.equal(eval9.travelTimePassed, true);
        assert.equal(eval9.verdict, "Accept");
    });
});
