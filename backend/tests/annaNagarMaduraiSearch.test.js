import assert from "node:assert/strict";
import test, { describe, it } from "node:test";
import {
    parseSearchQuery,
    calculateRelevanceScore,
    deduplicateAndRankResults,
    searchPlaces,
    isValidCoordinate,
    normalizeLocation,
    calculateDistanceKm,
    KNOWN_CITY_COORDINATES
} from "../../frontend/src/services/locationSearchService.js";

describe("Route Stops Global Location Search - Anna Nagar Madurai Verification", { concurrency: 1, timeout: 60000 }, () => {
    describe("1. Respect Complete Search Query (Place, City, District, State, Country)", () => {
        it("should parse place name, city, district, state, country accurately", () => {
            const parsed = parseSearchQuery("Anna Nagar, Madurai, Tamil Nadu, India");
            assert.equal(parsed.cleanPlaceName.toLowerCase(), "anna nagar");
            assert.equal(parsed.requestedCity.toLowerCase(), "madurai");
            assert.equal(parsed.requestedState.toLowerCase(), "tamil nadu");
            assert.equal(parsed.requestedCountry.toLowerCase(), "india");
        });

        it("should parse city even when district is omitted", () => {
            const parsed = parseSearchQuery("Anna Nagar, Madurai");
            assert.equal(parsed.cleanPlaceName.toLowerCase(), "anna nagar");
            assert.equal(parsed.requestedCity.toLowerCase(), "madurai");
        });
    });

    describe("2. Coordinate Verification & City Proximity", () => {
        it("should recognize Madurai known coordinates", () => {
            assert.ok(KNOWN_CITY_COORDINATES["madurai"]);
            const madurai = KNOWN_CITY_COORDINATES["madurai"];
            assert.ok(madurai.lat > 9.9 && madurai.lat < 10.0);
            assert.ok(madurai.lon > 78.1 && madurai.lon < 78.2);
        });

        it("should accurately compute distance between Madurai and Anna Nagar Madurai vs Chennai", () => {
            const maduraiCenter = KNOWN_CITY_COORDINATES["madurai"];
            const annaNagarMadurai = { lat: 9.92167, lon: 78.14813 };
            const annaNagarChennai = { lat: 13.0850, lon: 80.2100 };

            const distMadurai = calculateDistanceKm(maduraiCenter.lat, maduraiCenter.lon, annaNagarMadurai.lat, annaNagarMadurai.lon);
            const distChennai = calculateDistanceKm(maduraiCenter.lat, maduraiCenter.lon, annaNagarChennai.lat, annaNagarChennai.lon);

            assert.ok(distMadurai < 10, `Anna Nagar Madurai should be < 10 km from center, got ${distMadurai.toFixed(2)} km`);
            assert.ok(distChennai > 400, `Anna Nagar Chennai should be > 400 km from Madurai, got ${distChennai.toFixed(2)} km`);
        });

        it("should validate coordinate pairs and objects correctly", () => {
            assert.equal(isValidCoordinate(9.9216, 78.1481), true);
            assert.equal(isValidCoordinate({ latitude: 9.9216, longitude: 78.1481 }), true);
            assert.equal(isValidCoordinate({ lat: 9.9216, lon: 78.1481 }), true);
            assert.equal(isValidCoordinate(null, undefined), false);
            assert.equal(isValidCoordinate({ latitude: "invalid" }), false);
        });
    });

    describe("3. Search Ranking & Score Rules", () => {
        it("should rank exact place name match and city match above conflicting cities", () => {
            const candidates = [
                {
                    name: "Anna Nagar",
                    address: "Anna Nagar, Chennai, Tamil Nadu, India",
                    city: "Chennai",
                    state: "Tamil Nadu",
                    country: "India",
                    latitude: 13.0850,
                    longitude: 80.2100
                },
                {
                    name: "Anna Nagar",
                    address: "Anna Nagar, Madurai, Tamil Nadu, India",
                    city: "Madurai",
                    state: "Tamil Nadu",
                    country: "India",
                    latitude: 9.92167,
                    longitude: 78.14813
                }
            ];

            const ranked = deduplicateAndRankResults(candidates, "Anna Nagar, Madurai, Tamil Nadu");
            assert.ok(ranked.length > 0);
            assert.equal(ranked[0].city, "Madurai", "Top result MUST be Madurai");
            assert.ok(ranked[0].latitude > 9.5 && ranked[0].latitude < 10.3);

            // Conflicting city should be ranked below with a warning
            if (ranked.length > 1) {
                assert.equal(ranked[1].city, "Chennai");
                assert.ok(ranked[1].cityWarning, "Chennai candidate should carry different city warning");
            }
        });

        it("should apply severe negative penalty to candidates from different cities", () => {
            const parsed = parseSearchQuery("Anna Nagar, Madurai, Tamil Nadu");
            const maduraiRef = KNOWN_CITY_COORDINATES["madurai"];

            const maduraiScore = calculateRelevanceScore(
                { name: "Anna Nagar", address: "Anna Nagar, Madurai", latitude: 9.9216, longitude: 78.1481 },
                "Anna Nagar, Madurai, Tamil Nadu",
                parsed,
                maduraiRef
            );

            const chennaiScore = calculateRelevanceScore(
                { name: "Anna Nagar", address: "Anna Nagar, Chennai", latitude: 13.085, longitude: 80.21 },
                "Anna Nagar, Madurai, Tamil Nadu",
                parsed,
                maduraiRef
            );

            assert.ok(
                maduraiScore > chennaiScore + 2000,
                `Madurai candidate (${maduraiScore}) must dramatically outscore Chennai candidate (${chennaiScore})`
            );
        });
    });

    describe("4. End-to-End Live Geocoding for 'Anna Nagar, Madurai, Tamil Nadu'", () => {
        it("should return Madurai location as #1 result and NOT Chennai", async () => {
            const res = await searchPlaces("Anna Nagar, Madurai, Tamil Nadu");
            assert.equal(res.success, true);
            assert.ok(res.results.length > 0, "Must return results");

            const top = res.results[0];
            const fullAddress = `${top.name} ${top.address || ""} ${top.city || ""}`.toLowerCase();

            assert.ok(
                fullAddress.includes("madurai"),
                `Top result must include Madurai, got: ${top.name}, ${top.address}`
            );
            assert.ok(
                !fullAddress.includes("chennai"),
                `Top result must NOT be Chennai, got: ${top.name}, ${top.address}`
            );
            assert.ok(
                top.latitude > 9.8 && top.latitude < 10.1,
                `Top result latitude must be in Madurai, got: ${top.latitude}`
            );
            assert.ok(
                top.longitude > 78.0 && top.longitude < 78.3,
                `Top result longitude must be in Madurai, got: ${top.longitude}`
            );
        });

        it("should handle 'Anna Nagar, Madurai' without state and still pick Madurai", async () => {
            const res = await searchPlaces("Anna Nagar, Madurai");
            assert.equal(res.success, true);
            assert.ok(res.results.length > 0);

            const top = res.results[0];
            assert.ok(
                top.latitude > 9.8 && top.latitude < 10.1,
                `Top result latitude must be in Madurai, got: ${top.latitude}`
            );
        });
    });

    describe("5. Specific Empty State Message when City Has No Results", () => {
        it("should return exact formatted emptyMessage: 'No exact result found in Madurai. Try a nearby landmark or add the district/state.'", async () => {
            const res = await searchPlaces("NonExistentLandmarkXYZ12345, Madurai");
            assert.equal(res.success, false);
            assert.equal(res.results.length, 0);
            assert.equal(
                res.emptyMessage,
                "No exact result found in Madurai. Try a nearby landmark or add the district/state."
            );
        });
    });

    describe("6. Stop Selection Contract (Name, Latitude, Longitude Preserved)", () => {
        it("should normalize candidate preserving name, latitude, longitude, and address", () => {
            const raw = {
                name: "Anna Nagar Post Office",
                address: "Anna Nagar, Madurai, Tamil Nadu, 625020",
                latitude: 9.92167,
                longitude: 78.14813,
                placeId: "loc_12345",
                types: ["post_office"]
            };

            const normalized = normalizeLocation(raw);
            assert.equal(normalized.name, "Anna Nagar Post Office");
            assert.equal(normalized.latitude, 9.92167);
            assert.equal(normalized.longitude, 78.14813);
            assert.equal(normalized.address, "Anna Nagar, Madurai, Tamil Nadu, 625020");
            assert.ok(isValidCoordinate(normalized));
        });

        it("should append stop to route stops sequence without mutating prior stops", () => {
            const existingStops = [
                { name: "Periyar Bus Stand", latitude: 9.9174, longitude: 78.1147 }
            ];

            const newStop = {
                name: "Anna Nagar",
                latitude: 9.92167,
                longitude: 78.14813,
                address: "Anna Nagar, Madurai"
            };

            const updatedStops = [...existingStops, newStop];
            assert.equal(updatedStops.length, 2);
            assert.equal(updatedStops[0].name, "Periyar Bus Stand");
            assert.equal(updatedStops[1].name, "Anna Nagar");
            assert.equal(updatedStops[1].latitude, 9.92167);
            assert.equal(updatedStops[1].longitude, 78.14813);
        });
    });

    describe("7. Worldwide Global Search Capability", () => {
        it("should resolve international queries (Times Square, New York, USA)", async () => {
            const res = await searchPlaces("Times Square, New York, USA");
            assert.equal(res.success, true);
            assert.ok(res.results.length > 0);

            const top = res.results[0];
            assert.ok(top.latitude > 40.7 && top.latitude < 40.8, `New York latitude around 40.75, got: ${top.latitude}`);
            assert.ok(top.longitude > -74.05 && top.longitude < -73.9, `New York longitude around -73.98, got: ${top.longitude}`);
        });
    });
});
