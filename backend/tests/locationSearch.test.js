import assert from "node:assert/strict";
import test, { describe, it } from "node:test";
import {
    searchPlaces,
    normalizeLocation,
    isValidCoordinate,
    calculateRelevanceScore,
    formatPlaceType,
    detectCategory,
    getCategoryIcon
} from "../../frontend/src/services/locationSearchService.js";
import {
    searchPlaces as backendSearchPlaces,
    isValidCoordinate as backendIsValidCoordinate
} from "../services/aiAgentService.js";

const MANDATORY_14_BENCHMARK_TESTS = [
    { label: "1. KLN College of Engineering", query: "KLN College of Engineering" },
    { label: "2. KLN College of Engineering Pottapalayam", query: "KLN College of Engineering Pottapalayam" },
    { label: "3. Velammal Engineering College", query: "Velammal Engineering College" },
    { label: "4. Velammal Engineering College Chennai", query: "Velammal Engineering College Chennai" },
    { label: "5. Velammal Engineering College Madurai", query: "Velammal Engineering College Madurai" },
    { label: "6. Meenakshi Amman Temple", query: "Meenakshi Amman Temple" },
    { label: "7. Guru Theatre", query: "Guru Theatre" },
    { label: "8. Theekathir Office Rd, Madurai", query: "Theekathir Office Rd, Madurai" },
    { label: "9. Random street (10 Downing Street)", query: "10 Downing Street" },
    { label: "10. Random village (Oia)", query: "Oia" },
    { label: "11. Random city (Seattle)", query: "Seattle" },
    { label: "12. International place (London)", query: "London" },
    { label: "13. International institution (University of Sydney)", query: "University of Sydney" },
    { label: "14. Same institution name across different locations (Velammal)", query: "Velammal" }
];

describe("Universal Global Location Search Verification Suite", { concurrency: 1, timeout: 180000 }, () => {
    describe("14 Mandatory Benchmark Global Searches", () => {
        for (const item of MANDATORY_14_BENCHMARK_TESTS) {
            it(`should find valid WGS84 location for ${item.label} ("${item.query}")`, async () => {
                const response = await searchPlaces(item.query);
                assert.equal(response.success, true, `Search for "${item.query}" should succeed`);
                assert.ok(Array.isArray(response.results), `Results should be an array for "${item.query}"`);
                assert.ok(response.results.length > 0, `Search for "${item.query}" should return at least 1 result`);

                const top = response.results[0];
                assert.ok(top.name, `Top result for "${item.query}" must have a name`);
                assert.ok(top.address || top.displayName, `Top result for "${item.query}" must have an address/displayName`);
                assert.equal(typeof top.latitude, "number", `Top result for "${item.query}" must have numeric latitude`);
                assert.equal(typeof top.longitude, "number", `Top result for "${item.query}" must have numeric longitude`);
                assert.ok(top.type, `Top result for "${item.query}" must have a place type`);
                assert.equal(
                    isValidCoordinate(top),
                    true,
                    `Coordinates [${top.latitude}, ${top.longitude}] for "${item.query}" must be valid WGS84`
                );
            });
        }
    });

    describe("Location-Aware Relevance & Disambiguation", () => {
        it("should rank Madurai higher for 'Velammal Engineering College Madurai' and Chennai higher for 'Velammal Engineering College Chennai'", async () => {
            const maduraiRes = await searchPlaces("Velammal Engineering College Madurai");
            assert.equal(maduraiRes.success, true);
            assert.ok(maduraiRes.results.length > 0);
            const topMadurai = maduraiRes.results[0];
            const maduraiFull = `${topMadurai.name} ${topMadurai.address} ${topMadurai.city} ${topMadurai.district}`.toLowerCase();
            assert.ok(
                maduraiFull.includes("madurai"),
                `Expected top result for 'Velammal Engineering College Madurai' to be in Madurai, got: ${topMadurai.address}`
            );

            const chennaiRes = await searchPlaces("Velammal Engineering College Chennai");
            assert.equal(chennaiRes.success, true);
            assert.ok(chennaiRes.results.length > 0);
            const topChennai = chennaiRes.results[0];
            const chennaiFull = `${topChennai.name} ${topChennai.address} ${topChennai.city} ${topChennai.district}`.toLowerCase();
            assert.ok(
                chennaiFull.includes("chennai") || chennaiFull.includes("thiruvallur") || chennaiFull.includes("madhavaram"),
                `Expected top result for 'Velammal Engineering College Chennai' to be in Chennai, got: ${topChennai.address}`
            );
        });

        it("should return physical location for KLN College of Engineering in Sivagangai/Manamadurai/Pottapalayam", async () => {
            const res = await searchPlaces("KLN College of Engineering");
            assert.equal(res.success, true);
            assert.ok(res.results.length > 0);
            const top = res.results[0];
            assert.ok(
                top.name.toLowerCase().includes("kln") || top.name.toLowerCase().includes("k. l. n.") || top.name.toLowerCase().includes("k.l.n."),
                `Expected name to match KLN, got: ${top.name}`
            );
            assert.ok(
                top.address.toLowerCase().includes("sivagangai") ||
                top.address.toLowerCase().includes("manamadurai") ||
                top.address.toLowerCase().includes("tamil nadu"),
                `Expected physical address in Tamil Nadu, got: ${top.address}`
            );
            assert.notEqual(top.address.toLowerCase(), "indian engineering college", "Address must not be replaced with generic description");
        });

        it("should return physical address for Meenakshi Amman Temple and Guru Theatre", async () => {
            const temple = await searchPlaces("Meenakshi Amman Temple");
            assert.equal(temple.success, true);
            assert.ok(temple.results[0].address.toLowerCase().includes("madurai") || temple.results[0].address.toLowerCase().includes("tamil nadu"));

            const theatre = await searchPlaces("Guru Theatre");
            assert.equal(theatre.success, true);
            assert.ok(theatre.results[0].address.toLowerCase().includes("madurai"));
        });
    });

    describe("Structured Schema & UI Format Integrity", () => {
        it("should format types into human-friendly categories", () => {
            assert.equal(formatPlaceType("college"), "College");
            assert.equal(formatPlaceType("university"), "University");
            assert.equal(formatPlaceType("place_of_worship"), "Place of Worship");
            assert.equal(formatPlaceType("cinema"), "Cinema");
            assert.equal(formatPlaceType("bus_stop"), "Bus Stop");
            assert.equal(formatPlaceType("hospital"), "Hospital");
            assert.equal(formatPlaceType("residential"), "Residential Area");
            assert.equal(formatPlaceType("secondary", "highway"), "Road");
        });

        it("should map categories and icons accurately", () => {
            assert.equal(detectCategory(["college"]), "education");
            assert.equal(detectCategory(["hospital"]), "hospital");
            assert.equal(detectCategory(["station"]), "train");
            assert.equal(detectCategory(["bus_stop"]), "bus");
            assert.equal(detectCategory(["airport"]), "airport");

            assert.equal(getCategoryIcon("education"), "🎓");
            assert.equal(getCategoryIcon("hospital"), "🏥");
            assert.equal(getCategoryIcon("train"), "🚆");
            assert.equal(getCategoryIcon("bus"), "🚌");
            assert.equal(getCategoryIcon("airport"), "✈️");
        });

        it("should normalize raw coordinates accurately through normalizeLocation", () => {
            const raw = {
                name: "10 Downing Street",
                address: "10 Downing Street, London, SW1A 2AA, UK",
                latitude: 51.5033,
                longitude: -0.1277,
                type: "government"
            };
            const normalized = normalizeLocation(raw);
            assert.ok(normalized);
            assert.equal(normalized.name, "10 Downing Street");
            assert.equal(normalized.latitude, 51.5033);
            assert.equal(normalized.longitude, -0.1277);
            assert.equal(isValidCoordinate(normalized), true);
        });
    });

    describe("Zero Results vs API Error Distinction", () => {
        it("should return NO_RESULTS for impossible queries without marking as service error", async () => {
            const res = await searchPlaces("xyz998877665544nonexistentlocation123");
            assert.equal(res.success, false);
            assert.equal(res.results.length, 0);
            assert.equal(res.hasError, false);
            assert.equal(res.errorType, "NO_RESULTS");
        });

        it("should gracefully handle empty or single character input", async () => {
            const r0 = await searchPlaces("");
            assert.equal(r0.success, true);
            assert.equal(r0.results.length, 0);

            const r1 = await searchPlaces("a");
            assert.equal(r1.success, true);
            assert.equal(r1.results.length, 0);
        });
    });

    describe("Backend AI Agent Service Parity", () => {
        it("should support searchPlaces on backend aiAgentService", async () => {
            const results = await backendSearchPlaces("London");
            assert.ok(Array.isArray(results));
            assert.ok(results.length > 0);
            assert.ok(backendIsValidCoordinate(results[0].latitude, results[0].longitude));
        });
    });
});
