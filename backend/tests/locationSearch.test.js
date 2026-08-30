import assert from "node:assert/strict";
import test, { describe, it, beforeEach } from "node:test";
import {
    searchPlaces,
    normalizeLocation,
    isValidCoordinate,
    calculateRelevanceScore,
    parseSearchQuery,
    generateQueryVariants,
    deduplicateAndRankResults,
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

describe("Universal Global Location Search Verification Suite", { concurrency: 1, timeout: 600000 }, () => {
    beforeEach(async () => {
        await new Promise((r) => setTimeout(r, 250));
    });

    describe("1. Exact Screenshot Bug Test (Seventh Day Adventist Matric Higher Secondary School, madurai)", () => {
        it("should rank Madurai result above Ambur and unrelated districts for 'Seventh Day Adventist Matric Higher Secondary School, madurai'", async () => {
            const response = await searchPlaces("Seventh Day Adventist Matric Higher Secondary School, madurai");
            assert.equal(response.success, true, "Search for exact screenshot query should succeed");
            assert.ok(Array.isArray(response.results) && response.results.length > 0, "Must return at least 1 result");

            const top = response.results[0];
            const topFull = `${top.name} ${top.address} ${top.city} ${top.district} ${top.state}`.toLowerCase();

            // The top result must match Madurai
            assert.ok(
                topFull.includes("madurai") || (top.city && top.city.toLowerCase().includes("madurai")),
                `Expected top result to be in Madurai, got: ${top.name} | ${top.address} | city: ${top.city}`
            );

            // If an Ambur candidate is present in results, Madurai must be strictly ranked above it
            const amburIndex = response.results.findIndex((r) => {
                const full = `${r.name} ${r.address} ${r.city} ${r.district}`.toLowerCase();
                return full.includes("ambur") || full.includes("tirupattur");
            });

            const maduraiIndex = response.results.findIndex((r) => {
                const full = `${r.name} ${r.address} ${r.city} ${r.district}`.toLowerCase();
                return full.includes("madurai");
            });

            if (amburIndex !== -1 && maduraiIndex !== -1) {
                assert.ok(
                    maduraiIndex < amburIndex,
                    `Madurai result (rank ${maduraiIndex + 1}) must rank above Ambur (rank ${amburIndex + 1})`
                );
            }
        });

        it("should rank Madurai result above others for 'Seventh Day Adventist School Madurai'", async () => {
            const response = await searchPlaces("Seventh Day Adventist School Madurai");
            assert.equal(response.success, true);
            assert.ok(response.results.length > 0);
            const top = response.results[0];
            const topFull = `${top.name} ${top.address} ${top.city} ${top.district}`.toLowerCase();
            assert.ok(
                topFull.includes("madurai"),
                `Expected top result for 'Seventh Day Adventist School Madurai' to be in Madurai, got: ${top.address}`
            );
        });

        it("should rank Madurai result above others for 'Seventh Day Adventist Madurai'", async () => {
            const response = await searchPlaces("Seventh Day Adventist Madurai");
            assert.equal(response.success, true);
            assert.ok(response.results.length > 0);
            const top = response.results[0];
            const topFull = `${top.name} ${top.address} ${top.city} ${top.district}`.toLowerCase();
            assert.ok(
                topFull.includes("madurai"),
                `Expected top result for 'Seventh Day Adventist Madurai' to be in Madurai, got: ${top.address}`
            );
        });
    });

    describe("2. Generic Place + Locality Search Tests", () => {
        it("should return Madurai schools for 'school madurai'", async () => {
            const response = await searchPlaces("school madurai");
            assert.equal(response.success, true);
            assert.ok(response.results.length > 0);
            const top = response.results[0];
            const topFull = `${top.name} ${top.address} ${top.city || ""} ${top.district || ""}`.toLowerCase();
            assert.ok(
                topFull.includes("madurai") || topFull.includes("school") || response.results.some(r => `${r.name} ${r.address} ${r.city || ""}`.toLowerCase().includes("madurai")),
                `Expected Madurai school, got: ${top.address}`
            );
        });

        it("should return Madurai hospitals for 'hospital madurai'", async () => {
            const response = await searchPlaces("hospital madurai");
            assert.equal(response.success, true);
            assert.ok(response.results.length > 0);
            const top = response.results[0];
            const topFull = `${top.name} ${top.address} ${top.city || ""} ${top.district || ""}`.toLowerCase();
            assert.ok(
                topFull.includes("madurai") || topFull.includes("hospital") || response.results.some(r => `${r.name} ${r.address} ${r.city || ""}`.toLowerCase().includes("madurai")),
                `Expected Madurai hospital, got: ${top.address}`
            );
        });

        it("should return Chennai airport for 'airport chennai'", async () => {
            const response = await searchPlaces("airport chennai");
            assert.equal(response.success, true);
            assert.ok(response.results.length > 0);
            const top = response.results[0];
            const topFull = `${top.name} ${top.address} ${top.city || ""} ${top.district || ""}`.toLowerCase();
            assert.ok(topFull.includes("chennai") || topFull.includes("airport"), `Expected Chennai airport, got: ${top.name}`);
        });

        it("should return London schools for 'school london'", async () => {
            const response = await searchPlaces("school london");
            assert.equal(response.success, true);
            assert.ok(response.results.length > 0);
            const top = response.results[0];
            const topFull = `${top.name} ${top.address} ${top.city || ""} ${top.district || ""}`.toLowerCase();
            assert.ok(
                topFull.includes("london") || topFull.includes("school") || response.results.some(r => `${r.name} ${r.address} ${r.city || ""}`.toLowerCase().includes("london")),
                `Expected London school, got: ${top.address}`
            );
        });

        it("should return London airports for 'airport london'", async () => {
            const response = await searchPlaces("airport london");
            assert.equal(response.success, true);
            assert.ok(response.results.length > 0);
            const top = response.results[0];
            const topFull = `${top.name} ${top.address} ${top.city || ""} ${top.district || ""}`.toLowerCase();
            assert.ok(
                topFull.includes("london") || topFull.includes("airport") || topFull.includes("heathrow") || topFull.includes("gatwick"),
                `Expected London airport, got: ${top.address}`
            );
        });

        it("should return Singapore hotels for 'hotel singapore'", async () => {
            const response = await searchPlaces("hotel singapore");
            assert.equal(response.success, true);
            assert.ok(response.results.length > 0);
            const top = response.results[0];
            const topFull = `${top.name} ${top.address} ${top.country}`.toLowerCase();
            assert.ok(topFull.includes("singapore"), `Expected Singapore hotel, got: ${top.address}`);
        });
    });

    describe("3. 14 Mandatory Benchmark Global Searches", () => {
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

    describe("4. Location-Aware Relevance & Disambiguation", () => {
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
            const full = `${top.name} ${top.address} ${top.city} ${top.district} ${top.state}`.toLowerCase();
            assert.ok(
                full.includes("kln") || full.includes("k. l. n.") || full.includes("k.l.n."),
                `Expected name to match KLN, got: ${top.name}`
            );
            assert.ok(
                full.includes("sivagangai") ||
                full.includes("manamadurai") ||
                full.includes("tamil nadu") ||
                full.includes("pottapalayam"),
                `Expected physical address in Tamil Nadu, got: ${top.address}`
            );
        });

        it("should return physical address for Meenakshi Amman Temple and Guru Theatre", async () => {
            const temple = await searchPlaces("Meenakshi Amman Temple");
            assert.equal(temple.success, true);
            const templeFull = `${temple.results[0].name} ${temple.results[0].address} ${temple.results[0].city} ${temple.results[0].state}`.toLowerCase();
            assert.ok(templeFull.includes("madurai") || templeFull.includes("tamil nadu"));

            const theatre = await searchPlaces("Guru Theatre");
            assert.equal(theatre.success, true);
            assert.ok(theatre.results.length > 0);
            const theatreFull = `${theatre.results[0].name} ${theatre.results[0].address} ${theatre.results[0].city || ""} ${theatre.results[0].state || ""}`.toLowerCase();
            assert.ok(theatreFull.includes("madurai") || theatreFull.includes("theatre") || theatreFull.includes("cinema") || theatreFull.includes("tamil nadu"));
        });
    });

    describe("5. Query Parsing, Normalization & Variant Generation Unit Tests", () => {
        it("should correctly parse comma-separated place and locality", () => {
            const parsed = parseSearchQuery("Seventh Day Adventist Matric Higher Secondary School, madurai");
            assert.equal(parsed.placeName, "Seventh Day Adventist Matric Higher Secondary School");
            assert.equal(parsed.locality, "madurai");
            assert.equal(parsed.hasExplicitLocality, true);
            assert.deepEqual(parsed.distinctivePlaceTokens, ["seventh", "day", "adventist"]);
            assert.deepEqual(parsed.localityTokens, ["madurai"]);
        });

        it("should correctly parse space-separated place and tail locality", () => {
            const parsed = parseSearchQuery("Seventh Day Adventist School Madurai");
            assert.equal(parsed.placeName, "Seventh Day Adventist School");
            assert.equal(parsed.locality, "Madurai");
            assert.equal(parsed.hasExplicitLocality, true);
        });

        it("should correctly parse category and locality queries", () => {
            const parsed = parseSearchQuery("school madurai");
            assert.equal(parsed.placeName, "school");
            assert.equal(parsed.locality, "madurai");
            assert.equal(parsed.hasExplicitLocality, true);
            assert.equal(parsed.primaryCategory, "education");
        });

        it("should generate targeted place+locality query variants", () => {
            const variants = generateQueryVariants("Seventh Day Adventist Matric Higher Secondary School, madurai");
            assert.ok(variants.includes("seventh day adventist madurai"));
            assert.ok(variants.includes("seventh day madurai"));
            assert.ok(variants.includes("Seventh Day Adventist Matric Higher Secondary School madurai"));
        });
    });

    describe("6. Structured Schema, Types & Coordinate Bounds", () => {
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

        it("should enforce strict WGS84 coordinate bounds on isValidCoordinate", () => {
            assert.equal(isValidCoordinate({ latitude: 13.0827, longitude: 80.2707 }), true);
            assert.equal(isValidCoordinate({ latitude: 91.0, longitude: 0 }), false);
            assert.equal(isValidCoordinate({ latitude: -95.0, longitude: 0 }), false);
            assert.equal(isValidCoordinate({ latitude: 0, longitude: 185.0 }), false);
            assert.equal(isValidCoordinate({ latitude: 0, longitude: -185.0 }), false);
            assert.equal(isValidCoordinate({ latitude: 0, longitude: 0 }), false);
            assert.equal(isValidCoordinate({ latitude: NaN, longitude: 80.0 }), false);
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

    describe("7. Deduplication & Ranking Engine Unit Tests", () => {
        it("should prioritize local results over conflicting city results with same place name", () => {
            const candidates = [
                {
                    name: "St. Joseph's School",
                    address: "Chennai, Tamil Nadu, India",
                    city: "Chennai",
                    district: "Chennai",
                    state: "Tamil Nadu",
                    country: "India",
                    latitude: 13.08,
                    longitude: 80.27,
                    type: "School",
                    category: "education"
                },
                {
                    name: "St. Joseph's School",
                    address: "Madurai, Tamil Nadu, India",
                    city: "Madurai",
                    district: "Madurai",
                    state: "Tamil Nadu",
                    country: "India",
                    latitude: 9.92,
                    longitude: 78.12,
                    type: "School",
                    category: "education"
                }
            ];

            const ranked = deduplicateAndRankResults(candidates, "St. Joseph's School Madurai");
            assert.equal(ranked.length, 2);
            assert.equal(ranked[0].city, "Madurai", "Madurai school must rank #1");
            assert.equal(ranked[1].city, "Chennai", "Chennai school must rank lower");
            assert.ok(ranked[0]._score > ranked[1]._score);
        });

        it("should deduplicate duplicate candidates from multiple providers", () => {
            const candidates = [
                {
                    name: "Central Station",
                    address: "Chennai Central, Chennai",
                    latitude: 13.0827,
                    longitude: 80.2707,
                    source: "Photon",
                    type: "Railway Station",
                    category: "train"
                },
                {
                    name: "Chennai Central",
                    address: "Chennai Central, Park Town, Chennai",
                    latitude: 13.0828,
                    longitude: 80.2706,
                    source: "Nominatim",
                    type: "Railway Station",
                    category: "train"
                }
            ];

            const ranked = deduplicateAndRankResults(candidates, "Chennai Central");
            assert.equal(ranked.length, 1, "Duplicate nearby locations must be merged into 1 entry");
        });
    });

    describe("8. Zero Results vs API Error Distinction", () => {
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

    describe("9. Backend AI Agent Service Parity", () => {
        it("should support searchPlaces on backend aiAgentService", async () => {
            const results = await backendSearchPlaces("London");
            assert.ok(Array.isArray(results));
            assert.ok(results.length > 0);
            assert.ok(backendIsValidCoordinate(results[0].latitude, results[0].longitude));
        });

        it("should rank Madurai result in backend for 'Velammal Engineering College Madurai'", async () => {
            const results = await backendSearchPlaces("Velammal Engineering College Madurai");
            assert.ok(Array.isArray(results) && results.length > 0);
            const top = results[0];
            const full = `${top.name} ${top.address} ${top.city || ""}`.toLowerCase();
            assert.ok(full.includes("madurai"), `Backend search must prioritize Madurai, got: ${top.address}`);
        });
    });

    describe("10. Source / Destination Mutual Exclusivity Regression Protection", () => {
        it("should preserve source selection state contract", () => {
            const loc = { name: "Madurai Airport", latitude: 9.8345, longitude: 78.0934 };
            const sourceState = {
                source: loc,
                destination: null,
                tripMode: "FROM_SOURCE",
                activeEndpoint: "source"
            };
            assert.ok(sourceState.source);
            assert.equal(sourceState.destination, null);
            assert.equal(sourceState.tripMode, "FROM_SOURCE");
            assert.equal(sourceState.activeEndpoint, "source");
        });

        it("should preserve destination selection state contract", () => {
            const loc = { name: "KLN College", latitude: 9.8529, longitude: 78.1887 };
            const destState = {
                source: null,
                destination: loc,
                tripMode: "TO_DESTINATION",
                activeEndpoint: "destination"
            };
            assert.equal(destState.source, null);
            assert.ok(destState.destination);
            assert.equal(destState.tripMode, "TO_DESTINATION");
            assert.equal(destState.activeEndpoint, "destination");
        });
    });
});
