import { test, describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    getRoadDistanceDurationMatrix,
    getRoadSegment,
    getRoadRouteGeometry,
    calculateOperationalLogistics,
    clearRoutingCaches
} from "../services/roadMatrixService.js";

describe("Stage 2: Road Matrix & Logistics Geometry Service Suite", () => {
    beforeEach(() => {
        clearRoutingCaches();
    });

    const klnce = { name: "KLNCE Depot", latitude: 9.8324, longitude: 78.1884 };
    const annaNagar = { name: "Anna Nagar", latitude: 9.9180, longitude: 78.1467, userCount: 30 };
    const kkNagar = { name: "KK Nagar", latitude: 9.9270, longitude: 78.1510, userCount: 20 };
    const mattuthavani = { name: "Mattuthavani", latitude: 9.9450, longitude: 78.1580, userCount: 15 };

    it("1. Directional matrix preserves true asymmetric road values, non-negative numbers, and zero diagonal", async () => {
        const locations = [klnce, annaNagar, kkNagar, mattuthavani];
        const matrix = await getRoadDistanceDurationMatrix(locations);

        assert.equal(matrix.distances.length, 4);
        assert.equal(matrix.durations.length, 4);

        for (let i = 0; i < 4; i++) {
            // Diagonal must strictly be zero
            assert.equal(matrix.distances[i][i], 0, `Diagonal distance [${i}][${i}] must be exactly 0`);
            assert.equal(matrix.durations[i][i], 0, `Diagonal duration [${i}][${i}] must be exactly 0`);

            for (let j = 0; j < 4; j++) {
                assert.ok(Number.isFinite(matrix.distances[i][j]), "Distance must be finite");
                assert.ok(Number.isFinite(matrix.durations[i][j]), "Duration must be finite");
                assert.ok(matrix.distances[i][j] >= 0, "Distance must be non-negative");
                assert.ok(matrix.durations[i][j] >= 0, "Duration must be non-negative");

                if (i !== j) {
                    assert.ok(matrix.distances[i][j] > 0, `Distance between ${i} and ${j} must be > 0`);
                    assert.ok(matrix.durations[i][j] > 0, `Duration between ${i} and ${j} must be > 0`);
                }
            }
        }

        // Verify metadata
        assert.ok(["osrm", "calibrated_fallback"].includes(matrix.routingSource));
        assert.equal(typeof matrix.osrmVerified, "boolean");
        assert.equal(typeof matrix.requiresRevalidation, "boolean");
        assert.equal(matrix.osrmVerified, !matrix.requiresRevalidation);
    });

    it("2. Cache preserves routing source and verification metadata", async () => {
        const locations = [klnce, annaNagar];
        const m1 = await getRoadDistanceDurationMatrix(locations);
        const m2 = await getRoadDistanceDurationMatrix(locations);

        assert.equal(m1.distances[0][1], m2.distances[0][1]);
        assert.equal(m1.durations[0][1], m2.durations[0][1]);
        assert.ok(m2.routingSource.startsWith("cached_"), `Cache should flag routing source as cached, got ${m2.routingSource}`);
        assert.equal(m2.osrmVerified, m1.osrmVerified);
        assert.equal(m2.requiresRevalidation, m1.requiresRevalidation);
    });

    it("3. Pairwise road segment router returns valid distance, duration, detour ratio, and verification metadata", async () => {
        const seg = await getRoadSegment(klnce, annaNagar);
        assert.ok(seg);
        assert.ok(seg.distanceKm >= 10 && seg.distanceKm <= 16, `Road distance from KLN to Anna Nagar should be ~12-14km, got ${seg.distanceKm}`);
        assert.ok(seg.durationMin > 0);
        assert.ok(seg.detourRatio >= 1.0 && seg.detourRatio <= 2.2, `Detour ratio must be reasonable, got ${seg.detourRatio}`);
        assert.equal(typeof seg.osrmVerified, "boolean");
        assert.equal(typeof seg.requiresRevalidation, "boolean");
        assert.equal(seg.osrmVerified, !seg.requiresRevalidation);
    });

    it("4. Route geometry returns Leaflet-compatible coordinates, per-leg metrics, and leg-level verification", async () => {
        const waypoints = [klnce, annaNagar, kkNagar, mattuthavani];
        const routeData = await getRoadRouteGeometry(waypoints);

        assert.ok(routeData);
        assert.ok(Array.isArray(routeData.geometry), "Geometry must be an array");
        assert.ok(routeData.geometry.length >= 4, "Geometry must contain coordinates");

        // Verify Leaflet coordinates format: [lat, lon]
        const firstCoord = routeData.geometry[0];
        assert.equal(firstCoord.length, 2);
        assert.ok(firstCoord[0] >= 9 && firstCoord[0] <= 11, "Latitude should be in Madurai region (~9-10)");
        assert.ok(firstCoord[1] >= 77 && firstCoord[1] <= 79, "Longitude should be in Madurai region (~78)");

        // Verify per-leg verification metadata
        assert.equal(routeData.legs.length, 3, "4 waypoints must produce exactly 3 consecutive legs");
        routeData.legs.forEach((leg, idx) => {
            assert.ok(leg.distanceKm > 0, `Leg ${idx} distance must be positive`);
            assert.ok(leg.durationMin > 0, `Leg ${idx} duration must be positive`);
            assert.equal(typeof leg.osrmVerified, "boolean");
            assert.equal(typeof leg.requiresRevalidation, "boolean");
            assert.equal(leg.osrmVerified, !leg.requiresRevalidation);
        });

        // Top-level geometry metadata
        assert.ok(["osrm_route", "estimated_straight_line"].includes(routeData.geometrySource));
        assert.equal(routeData.geometryVerified, routeData.osrmVerified);
        assert.equal(routeData.requiresRevalidation, !routeData.osrmVerified);
    });

    it("5. Fallback routing explicitly marks osrmVerified: false, geometryVerified: false, and requiresRevalidation: true", async () => {
        const waypoints = [klnce, annaNagar];
        // Force fallback by setting useOnlineOsrm: false
        const fallbackRoute = await getRoadRouteGeometry(waypoints, { useOnlineOsrm: false });

        assert.ok(fallbackRoute);
        assert.equal(fallbackRoute.osrmVerified, false, "Fallback must NOT claim osrmVerified: true");
        assert.equal(fallbackRoute.geometryVerified, false, "Fallback must NOT claim geometryVerified: true");
        assert.equal(fallbackRoute.requiresRevalidation, true, "Fallback MUST require revalidation");
        assert.equal(fallbackRoute.geometrySource, "estimated_straight_line");
        assert.equal(fallbackRoute.routingSource, "calibrated_fallback");

        // Fallback per-leg verification
        assert.equal(fallbackRoute.legs[0].osrmVerified, false);
        assert.equal(fallbackRoute.legs[0].geometryVerified, false);
        assert.equal(fallbackRoute.legs[0].requiresRevalidation, true);
    });

    it("6. Operational logistics calculates dwell times, ETAs, fuel, emissions, and driver regulations", () => {
        const stops = [
            { name: "Anna Nagar", userCount: 30, legDurationMin: 18 },
            { name: "KK Nagar", userCount: 20, legDurationMin: 6 },
            { name: "Mattuthavani", userCount: 15, legDurationMin: 8 }
        ];

        const logistics = calculateOperationalLogistics({
            distanceKm: 24.5,
            drivingDurationMin: 32.0,
            stops,
            departureTime: "08:00 AM"
        });

        assert.equal(logistics.distanceKm, 24.5);
        assert.equal(logistics.drivingDurationMin, 32.0);
        assert.equal(logistics.totalPassengers, 65);

        // Verify dwell times (1 min base + 4s/pax)
        assert.ok(logistics.dwellDurationMin >= 7 && logistics.dwellDurationMin <= 8);
        assert.ok(logistics.totalMissionDurationMin > logistics.drivingDurationMin);

        // Fuel consumption: 24.5 km / 3.8 km/L ~ 6.45 Liters
        assert.ok(logistics.fuelConsumptionLiters >= 6.0 && logistics.fuelConsumptionLiters <= 7.0);

        // Carbon emissions: 6.45 L * 2.68 kg CO2/L ~ 17.28 kg
        assert.ok(logistics.carbonEmissionsKg >= 16.0 && logistics.carbonEmissionsKg <= 19.0);

        // Driver regulation compliance
        assert.equal(logistics.driverRegulationCompliant, true);
        assert.ok(logistics.driverRegulationNotes.includes("within the 4.5h commercial driver safety regulation limit"));

        // ETAs schedule progression
        assert.equal(logistics.stopSchedules.length, 3);
        assert.ok(logistics.stopSchedules[1].cumulativeEtaMinutes > logistics.stopSchedules[0].cumulativeEtdMinutes);
    });

    it("7. Operational logistics flags driver fatigue violation when route duration exceeds 4.5 hours", () => {
        const longLogistics = calculateOperationalLogistics({
            distanceKm: 180.0,
            drivingDurationMin: 280.0, // 4.67 hours
            stops: [{ name: "Far Stop", userCount: 50, legDurationMin: 280 }]
        });

        assert.equal(longLogistics.driverRegulationCompliant, false);
        assert.ok(longLogistics.driverRegulationNotes.includes("exceeds 4.5h driver duty limit"));
    });
});
