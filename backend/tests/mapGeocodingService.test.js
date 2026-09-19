import { test, describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    isValidCoordinate,
    calculateDistanceKm,
    buildCanonicalLocationKey,
    normalizeStopName,
    resolveLocationCoordinates,
    resolveStopCoordinates,
    clearGeocodingCache,
    DEFAULT_SOURCE_HUB,
    MADURAI_REGIONAL_GAZETTEER
} from "../services/mapGeocodingService.js";

describe("Stage 1: Map Geocoding & Coordinate Service Suite", () => {
    beforeEach(() => {
        clearGeocodingCache();
    });

    it("1. Coordinate validation correctly accepts valid coordinates and rejects invalid/Null-Island coordinates", () => {
        assert.equal(isValidCoordinate(9.8324, 78.1884), true, "KLNCE coordinates must be valid");
        assert.equal(isValidCoordinate(0, 0), false, "Null Island (0,0) must be rejected");
        assert.equal(isValidCoordinate(95.0, 78.0), false, "Latitude > 90 must be rejected");
        assert.equal(isValidCoordinate(9.0, 185.0), false, "Longitude > 180 must be rejected");
        assert.equal(isValidCoordinate(null, 78.0), false, "Null latitude must be rejected");
        assert.equal(isValidCoordinate(undefined, 78.0), false, "Undefined latitude must be rejected");
        assert.equal(isValidCoordinate("abc", "def"), false, "Non-numeric coordinates must be rejected");
    });

    it("2. Haversine distance calculates accurate physical distance in kilometers", () => {
        // Distance from KLNCE (9.8324, 78.1884) to Anna Nagar Madurai (9.9180, 78.1467) ~ 10.5 km
        const dist = calculateDistanceKm(9.8324, 78.1884, 9.9180, 78.1467);
        assert.ok(dist >= 10 && dist <= 12, `Distance should be ~10.5 km, got ${dist}`);

        // Distance to self must be 0
        assert.equal(calculateDistanceKm(9.8324, 78.1884, 9.8324, 78.1884), 0);
    });

    it("3. Canonical location key and stop name normalization work deterministically", () => {
        const key1 = buildCanonicalLocationKey("Anna Nagar", "Madurai", "Tamil Nadu", "India");
        assert.equal(key1, "anna nagar|madurai|tamil nadu|india");

        const norm1 = normalizeStopName("  K.K. Nagar - West (Junction)  ");
        assert.equal(norm1, "k k nagar west junction");
    });

    it("4. Direct coordinates in payload bypass external geocoding and are preserved", async () => {
        const customStop = {
            name: "Custom Campus Stop",
            latitude: 12.9716,
            longitude: 77.5946
        };
        const res = await resolveLocationCoordinates(customStop);
        assert.equal(res.resolved, true);
        assert.equal(res.latitude, 12.9716);
        assert.equal(res.longitude, 77.5946);
        assert.equal(res.source, "Direct Payload");
    });

    it("5. Regional Gazetteer instantly resolves standard transit stops with 0ms overhead", async () => {
        const res = await resolveLocationCoordinates({ name: "Goripalayam" });
        assert.equal(res.resolved, true);
        assert.ok(isValidCoordinate(res.latitude, res.longitude));
        assert.equal(res.source, "Regional Transit Gazetteer");
    });

    it("6. In-memory cache returns previously resolved coordinates without repeating resolution", async () => {
        const stop1 = { name: "Vandiyur" };
        const res1 = await resolveLocationCoordinates(stop1);
        assert.equal(res1.resolved, true);

        // Second lookup must hit in-memory cache
        const res2 = await resolveLocationCoordinates(stop1);
        assert.equal(res2.resolved, true);
        assert.equal(res2.latitude, res1.latitude);
        assert.equal(res2.longitude, res1.longitude);
    });

    it("7. Batch stop resolver accurately resolves all 30 source stopping areas from dataset", async () => {
        const raw30Stops = [
            "Anna Nagar", "Arappalayam", "Simmakkal", "Tallakulam", "Goripalayam",
            "KK Nagar", "K.K. Nagar West", "Vandiyur", "Teppakulam", "Mattuthavani",
            "Othakadai", "Thiruppalai", "Iyer Bungalow", "K.Pudur", "Pudur",
            "Koodal Nagar", "Vilangudi", "Kochadai", "Kochadai Junction", "Palanganatham",
            "Jaihindpuram", "Alagappan Nagar", "Villapuram", "Avaniyapuram", "Anuppanadi",
            "Periyar", "Thirunagar", "Sellur", "Narimedu", "Bibikulam"
        ].map((name, idx) => ({
            name,
            userCount: 10,
            userIds: [`u_${idx}_1`, `u_${idx}_2`]
        }));

        assert.equal(raw30Stops.length, 30, "Source dataset must contain exactly 30 stopping areas");

        const { resolvedStops, diagnostics } = await resolveStopCoordinates(raw30Stops, DEFAULT_SOURCE_HUB);

        // Verification: ALL 30 stops must be resolved, none silently dropped!
        assert.equal(resolvedStops.length, 30, "All 30 stopping areas must be resolved without collapsing");
        assert.equal(diagnostics.coveredStoppingAreas, 30);
        assert.equal(diagnostics.missingStoppingAreas.length, 0);
        assert.equal(diagnostics.failedGeocodingLocations.length, 0);
        assert.equal(diagnostics.isValid, true);

        // Verify distinct coordinates even for near-stops (e.g. Kochadai vs Kochadai Junction)
        const kochadai = resolvedStops.find(s => s.name === "Kochadai");
        const kochadaiJunc = resolvedStops.find(s => s.name === "Kochadai Junction");
        assert.ok(kochadai && kochadaiJunc);
        const diffKochadai = Math.abs(kochadai.latitude - kochadaiJunc.latitude) + Math.abs(kochadai.longitude - kochadaiJunc.longitude);
        assert.ok(diffKochadai > 0, "Near-stops must have distinct micro-offset coordinates for valid OSRM legs");
    });

    it("8. Dynamic Source/Depot worldwide is accepted and distance calculated correctly", async () => {
        // Custom source in Bengaluru
        const customBengaluruSource = {
            name: "Bengaluru Tech Hub Depot",
            address: "Electronic City, Bengaluru, Karnataka, India",
            latitude: 12.8452,
            longitude: 77.6602
        };

        const stoppingGroups = [
            { name: "Silk Board", latitude: 12.9176, longitude: 77.6238, userCount: 20 },
            { name: "HSR Layout", latitude: 12.9116, longitude: 77.6388, userCount: 15 }
        ];

        const { resolvedStops, diagnostics } = await resolveStopCoordinates(stoppingGroups, customBengaluruSource);
        assert.equal(resolvedStops.length, 2);
        assert.equal(diagnostics.isValid, true);
        assert.ok(resolvedStops[0].distFromAnchor > 0, "Distance from dynamic source must be positive");
    });

    it("9. Diagnostics flags duplicate stopping names and distance outliers", async () => {
        const duplicateAndOutlierStops = [
            { name: "Anna Nagar", userCount: 10 },
            { name: "Anna Nagar", userCount: 5 }, // Duplicate
            { name: "Far Away Stop", latitude: 28.6139, longitude: 77.2090, userCount: 2 } // New Delhi (distance outlier > 60km from Madurai)
        ];

        const { resolvedStops, diagnostics } = await resolveStopCoordinates(duplicateAndOutlierStops, DEFAULT_SOURCE_HUB, { maxRadiusKm: 60 });
        assert.equal(diagnostics.duplicateStoppingAreas.length, 1, "Must detect duplicate stopping name");
        assert.equal(diagnostics.distanceOutlierLocations.length, 1, "Must detect distance outlier");
        assert.equal(diagnostics.distanceOutlierLocations[0].name, "Far Away Stop");
    });

    it("10. Diagnostics reports failed geocoding when an unresolvable stop name is supplied", async () => {
        const invalidStops = [
            { name: "XYZ_NonExistent_Invalid_Stop_12345" }
        ];

        const { resolvedStops, diagnostics } = await resolveStopCoordinates(invalidStops, DEFAULT_SOURCE_HUB);
        assert.equal(diagnostics.failedGeocodingLocations.length, 1);
        assert.equal(diagnostics.missingStoppingAreas.length, 1);
        assert.equal(diagnostics.isValid, false);
    });
});
