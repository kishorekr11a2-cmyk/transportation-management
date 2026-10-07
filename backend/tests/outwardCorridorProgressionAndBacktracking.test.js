import test from "node:test";
import assert from "node:assert/strict";
import {
    calculateMaxBearingSpan,
    isRouteCorridorCoherent,
    sequenceOutwardRouteStops,
    mergeDuplicateStopsInRoute,
    isSamePlace
} from "../services/routeOptimizationService.js";
import {
    calculateBearing,
    getBearingDifference,
    canBusSafelyServeStop,
    validateRouteCorridorContinuity,
    isStopNearOrAlongRoute,
    normalizeCanonicalStopName,
    normalizeStopName
} from "../services/aiAgentService.js";

const KLN_HUB = {
    name: "KLN College of Engineering",
    latitude: 9.8515,
    longitude: 78.1882
};

// Realistic Madurai coordinates
const STOPS = {
    // South / South-West corridor
    Avaniyapuram: { name: "Avaniyapuram", latitude: 9.8850, longitude: 78.1150, userCount: 9 },
    Jaihindpuram: { name: "Jaihindpuram", latitude: 9.9050, longitude: 78.1090, userCount: 10 },
    AlagappanNagar: { name: "Alagappan Nagar", latitude: 9.9020, longitude: 78.0950, userCount: 9 },
    Thirunagar: { name: "Thirunagar", latitude: 9.8800, longitude: 78.0650, userCount: 7 },
    Palanganatham: { name: "Palanganatham", latitude: 9.9120, longitude: 78.0990, userCount: 12 },

    // West / Theni Road corridor
    Arappalayam: { name: "Arappalayam", latitude: 9.9320, longitude: 78.1050, userCount: 26 },
    Kalavasal: { name: "Kalavasal", latitude: 9.9350, longitude: 78.0920, userCount: 10 },
    Kochadai: { name: "Kochadai", latitude: 9.9360, longitude: 78.0850, userCount: 14 },

    // North corridor
    Simmakkal: { name: "Simmakkal", latitude: 9.9280, longitude: 78.1220, userCount: 19 },
    Goripalayam: { name: "Goripalayam", latitude: 9.9330, longitude: 78.1320, userCount: 10 },
    Tallakulam: { name: "Tallakulam", latitude: 9.9380, longitude: 78.1350, userCount: 21 },
    IyerBungalow: { name: "Iyer Bungalow", latitude: 9.9650, longitude: 78.1450, userCount: 13 },
    Thiruppalai: { name: "Thiruppalai", latitude: 9.9800, longitude: 78.1480, userCount: 14 },

    // East / North-East corridor
    Viraganur: { name: "Viraganur", latitude: 9.8980, longitude: 78.1650, userCount: 12 },
    Anuppanadi: { name: "Anuppanadi", latitude: 9.9080, longitude: 78.1520, userCount: 3 },
    Teppakulam: { name: "Teppakulam", latitude: 9.9150, longitude: 78.1460, userCount: 16 },
    AnnaNagar: { name: "Anna Nagar", latitude: 9.9220, longitude: 78.1510, userCount: 30 },
    Vandiyur: { name: "Vandiyur", latitude: 9.9280, longitude: 78.1680, userCount: 18 },
    Mattuthavani: { name: "Mattuthavani", latitude: 9.9450, longitude: 78.1590, userCount: 17 },
    Othakadai: { name: "Othakadai", latitude: 9.9700, longitude: 78.1850, userCount: 15 }
};

test("TEST 1: calculateMaxBearingSpan correctly differentiates single corridor vs cross-town spread", () => {
    // Single South corridor (Avaniyapuram -> Jaihindpuram -> Palanganatham -> Thirunagar)
    const southStops = [STOPS.Avaniyapuram, STOPS.Jaihindpuram, STOPS.Palanganatham, STOPS.Thirunagar];
    const southSpan = calculateMaxBearingSpan(KLN_HUB, southStops);
    assert.ok(southSpan <= 38.0, `South corridor span should be <= 38°, got ${southSpan}°`);

    // Single North corridor (Simmakkal -> Goripalayam -> Iyer Bungalow -> Thiruppalai)
    const northStops = [STOPS.Simmakkal, STOPS.Goripalayam, STOPS.IyerBungalow, STOPS.Thiruppalai];
    const northSpan = calculateMaxBearingSpan(KLN_HUB, northStops);
    assert.ok(northSpan <= 38.0, `North corridor span should be <= 38°, got ${northSpan}°`);

    // Mixed South + North-East corridor (Palanganatham + Iyer Bungalow + Othakadai)
    const mixedStops = [STOPS.Palanganatham, STOPS.IyerBungalow, STOPS.Othakadai];
    const mixedSpan = calculateMaxBearingSpan(KLN_HUB, mixedStops);
    assert.ok(mixedSpan > 38.0, `Cross-town route should exceed 38° span, got ${mixedSpan}°`);
    assert.equal(isRouteCorridorCoherent(KLN_HUB, mixedStops, 38.0), false, "Mixed corridor should not be coherent");
});

test("TEST 2: Natural corridor progression produces 0 reversals and high quality", () => {
    const westStops = [STOPS.Palanganatham, STOPS.Arappalayam, STOPS.Kalavasal, STOPS.Kochadai];
    const seq = sequenceOutwardRouteStops({
        departureHub: KLN_HUB,
        stops: westStops
    });

    assert.equal(seq.qualityValidation?.directionalReversals, 0, "Clean corridor should have 0 reversals");
    assert.ok((seq.qualityValidation?.backtrackingDistanceKm || 0) < 1.0, "Clean corridor should have minimal backtracking");
    assert.ok((seq.qualityValidation?.detourRatio || 1.0) <= 1.5, "Detour should be reasonable");
});

test("TEST 3: Backtracking detection flags hairpin reversals and visited corridor returns", () => {
    // Fixed bus route with hairpin reversal: KLN -> Palanganatham -> Arappalayam -> Palanganatham -> Kochadai
    const backtrackingBus = {
        stops: [
            STOPS.Palanganatham,
            STOPS.Arappalayam,
            { ...STOPS.Palanganatham, name: "Palanganatham_return" },
            STOPS.Kochadai
        ],
        routeDistanceKm: 35.0,
        straightLineBaselineKm: 14.0
    };

    const res = validateRouteCorridorContinuity(backtrackingBus, KLN_HUB, null, "FROM_SOURCE");
    assert.equal(res.isContinuous, false, "Route with hairpin/backtracking must fail continuity");
    assert.ok(
        res.backtrackingDetected || res.directionalInversionDetected || !res.checks.check5_backtracking || !res.checks.check3_direction,
        "Backtracking or directional inversion must be detected"
    );
});

test("TEST 4: Cross-corridor mixing penalty prevents combining unrelated corridors", () => {
    // Stop sequence mixing Palanganatham (South-West) with Iyer Bungalow, Thiruppalai, Othakadai (North-East)
    const mixedCandidate = [
        STOPS.Palanganatham,
        STOPS.IyerBungalow,
        STOPS.Thiruppalai,
        STOPS.Othakadai
    ];

    const isCoherent = isRouteCorridorCoherent(KLN_HUB, mixedCandidate, 38.0, 4.75);
    assert.equal(isCoherent, false, "Palanganatham to Iyer Bungalow to Othakadai must be marked non-coherent");

    const check = canBusSafelyServeStop(
        { stops: [STOPS.IyerBungalow, STOPS.Thiruppalai], avgBearing: 345 },
        STOPS.Palanganatham,
        KLN_HUB
    );
    assert.equal(check, false, "canBusSafelyServeStop must reject Palanganatham on North route");
});

test("TEST 5: Route sharing is permitted for stops along the same corridor", () => {
    // Bus 1 and Bus 2 can both serve stops in the East corridor (Viraganur -> Teppakulam)
    const bus1Stops = [STOPS.Viraganur, STOPS.Anuppanadi, STOPS.Teppakulam];
    const bus2Stops = [STOPS.Viraganur, STOPS.Teppakulam, STOPS.AnnaNagar];

    assert.ok(isRouteCorridorCoherent(KLN_HUB, bus1Stops, 38.0), "Bus 1 corridor should be coherent");
    assert.ok(isRouteCorridorCoherent(KLN_HUB, bus2Stops, 38.0), "Bus 2 corridor should be coherent");

    // Both buses are coherent and share Viraganur & Teppakulam
    const sharedStops = bus1Stops.filter(s1 => bus2Stops.some(s2 => s2.name === s1.name));
    assert.equal(sharedStops.length, 2, "Expected 2 shared stops in the East corridor");
});

test("TEST 6: Spare capacity does NOT force absorption of a distant corridor stop", () => {
    const northBus = {
        vehicleName: "z1",
        capacity: 55,
        assignedUsers: 40, // 15 spare seats
        stops: [STOPS.Tallakulam, STOPS.IyerBungalow, STOPS.Thiruppalai],
        avgBearing: 345
    };

    // Candidate stop from South corridor (Alagappan Nagar)
    const suitability = isStopNearOrAlongRoute({
        stop: STOPS.AlagappanNagar,
        route: northBus,
        sourceHub: KLN_HUB,
        maxDetourKm: 5.0,
        maxProximityKm: 4.75
    });

    assert.equal(suitability.suitable, false, "North bus with spare seats must NOT absorb South corridor stop");
});

test("TEST 7: Duplicate stops are merged cleanly without losing passengers", () => {
    const stopsWithDup = [
        { ...STOPS.Thirunagar, userCount: 4, userIds: ["u1", "u2", "u3", "u4"] },
        { ...STOPS.Thirunagar, userCount: 3, userIds: ["u5", "u6", "u7"] },
        { ...STOPS.AlagappanNagar, userCount: 9, userIds: Array.from({ length: 9 }, (_, i) => `a${i+1}`) }
    ];

    const merged = mergeDuplicateStopsInRoute(stopsWithDup, KLN_HUB);
    assert.equal(merged.length, 2, "Duplicate Thirunagar stop should be merged into single stop");
    assert.equal(merged[0].name, "Thirunagar");
    assert.equal(merged[0].userCount, 7, "Merged stop must preserve combined passenger count (4 + 3 = 7)");
    assert.equal(merged[0].userIds.length, 7, "Merged stop must preserve all 7 user IDs");
});

test("TEST 8: normalizeCanonicalStopName produces consistent canonical identities while keeping West distinct", () => {
    // Canonical equivalence tests
    assert.equal(normalizeCanonicalStopName("KK Nagar"), "kk nagar");
    assert.equal(normalizeCanonicalStopName("K.K. Nagar"), "kk nagar");
    assert.equal(normalizeCanonicalStopName("K K Nagar"), "kk nagar");
    assert.equal(normalizeCanonicalStopName("k.k. nagar"), "kk nagar");
    assert.equal(normalizeCanonicalStopName("K.K.Nagar"), "kk nagar");
    assert.equal(normalizeCanonicalStopName("  KK Nagar  "), "kk nagar");

    // Suffix distinction tests
    assert.equal(normalizeCanonicalStopName("K.K. Nagar West"), "kk nagar west");
    assert.equal(normalizeCanonicalStopName("KK Nagar West"), "kk nagar west");

    // Equivalence assertions
    assert.equal(
        normalizeCanonicalStopName("KK Nagar"),
        normalizeCanonicalStopName("K.K. Nagar"),
        "KK Nagar and K.K. Nagar must resolve to same canonical identity"
    );
    assert.equal(
        normalizeCanonicalStopName("KK Nagar"),
        normalizeCanonicalStopName("K K Nagar"),
        "KK Nagar and K K Nagar must resolve to same canonical identity"
    );

    // Distinction assertion (CRITICAL: MUST NOT MATCH)
    assert.notEqual(
        normalizeCanonicalStopName("KK Nagar"),
        normalizeCanonicalStopName("K.K. Nagar West"),
        "KK Nagar and K.K. Nagar West must remain distinct"
    );
    assert.notEqual(
        normalizeCanonicalStopName("K.K. Nagar"),
        normalizeCanonicalStopName("K.K. Nagar West"),
        "K.K. Nagar and K.K. Nagar West must remain distinct"
    );
});

test("TEST 9: ASSERT 11 stop coverage verification handles aliases and rejects missing stops", () => {
    // Helper simulating the exact ASSERT 10 & 11 verification in buildAIPlan
    function verifyAssert11Coverage(requiredStops, generatedStops) {
        const requiredStopMap = new Map();
        requiredStops
            .filter((s) => (s.users?.length || s.userCount || 0) > 0)
            .forEach((s) => {
                const canon = normalizeCanonicalStopName(s.name);
                if (canon && !requiredStopMap.has(canon)) {
                    requiredStopMap.set(canon, s.name);
                }
            });

        const visitedCanonicalStops = new Set();
        generatedStops.forEach((st) => {
            const canon = normalizeCanonicalStopName(st.name);
            if (canon) visitedCanonicalStops.add(canon);
        });

        const missingStoppingAreas = Array.from(requiredStopMap.entries())
            .filter(([canon]) => !visitedCanonicalStops.has(canon))
            .map(([, displayName]) => displayName);

        return {
            passed: missingStoppingAreas.length === 0,
            missingStoppingAreas
        };
    }

    // 1. Required KK Nagar, generated KK Nagar -> PASS
    const r1 = verifyAssert11Coverage([{ name: "KK Nagar", userCount: 10 }], [{ name: "KK Nagar" }]);
    assert.equal(r1.passed, true, "Scenario 1: Required KK Nagar, generated KK Nagar must PASS");
    assert.equal(r1.missingStoppingAreas.length, 0);

    // 2. Required KK Nagar, generated K.K. Nagar -> PASS
    const r2 = verifyAssert11Coverage([{ name: "KK Nagar", userCount: 10 }], [{ name: "K.K. Nagar" }]);
    assert.equal(r2.passed, true, "Scenario 2: Required KK Nagar, generated K.K. Nagar must PASS");
    assert.equal(r2.missingStoppingAreas.length, 0);

    // 3. Required K.K. Nagar, generated KK Nagar -> PASS
    const r3 = verifyAssert11Coverage([{ name: "K.K. Nagar", userCount: 10 }], [{ name: "KK Nagar" }]);
    assert.equal(r3.passed, true, "Scenario 3: Required K.K. Nagar, generated KK Nagar must PASS");
    assert.equal(r3.missingStoppingAreas.length, 0);

    // 4. Required KK Nagar, generated K.K. Nagar West -> FAIL correctly
    const r4 = verifyAssert11Coverage([{ name: "KK Nagar", userCount: 10 }], [{ name: "K.K. Nagar West" }]);
    assert.equal(r4.passed, false, "Scenario 4: Required KK Nagar, generated K.K. Nagar West must FAIL");
    assert.deepEqual(r4.missingStoppingAreas, ["KK Nagar"], "Must report KK Nagar as missing");

    // 5. Required KK Nagar, generated K K Nagar -> PASS
    const r5 = verifyAssert11Coverage([{ name: "KK Nagar", userCount: 10 }], [{ name: "K K Nagar" }]);
    assert.equal(r5.passed, true, "Scenario 5: Required KK Nagar, generated K K Nagar must PASS");
    assert.equal(r5.missingStoppingAreas.length, 0);

    // 6. Required KK Nagar, generated unrelated stop -> FAIL correctly
    const r6 = verifyAssert11Coverage([{ name: "KK Nagar", userCount: 10 }], [{ name: "Anna Nagar" }]);
    assert.equal(r6.passed, false, "Scenario 6: Required KK Nagar, generated unrelated stop must FAIL");
    assert.deepEqual(r6.missingStoppingAreas, ["KK Nagar"], "Must report KK Nagar as missing");
});

test("TEST 10: STEP 8 INWARD K.K. Nagar West regression tests", () => {
    function verifyAssert11Coverage(requiredStops, generatedStops) {
        const requiredStopMap = new Map();
        requiredStops
            .filter((s) => (s.users?.length || s.userCount || 0) > 0)
            .forEach((s) => {
                const canon = normalizeCanonicalStopName(s.name);
                if (canon && !requiredStopMap.has(canon)) {
                    requiredStopMap.set(canon, s.name);
                }
            });

        const visitedCanonicalStops = new Set();
        generatedStops.forEach((st) => {
            const canon = normalizeCanonicalStopName(st.name);
            if (canon) visitedCanonicalStops.add(canon);
        });

        const missingStoppingAreas = Array.from(requiredStopMap.entries())
            .filter(([canon]) => !visitedCanonicalStops.has(canon))
            .map(([, displayName]) => displayName);

        return {
            passed: missingStoppingAreas.length === 0,
            missingStoppingAreas
        };
    }

    // 1. Required K.K. Nagar West, generated K.K. Nagar West -> PASS
    const t1 = verifyAssert11Coverage([{ name: "K.K. Nagar West", userCount: 18 }], [{ name: "K.K. Nagar West" }]);
    assert.equal(t1.passed, true, "1. Required K.K. Nagar West, generated K.K. Nagar West -> PASS");

    // 2. Required K.K. Nagar West, generated KK Nagar West -> PASS
    const t2 = verifyAssert11Coverage([{ name: "K.K. Nagar West", userCount: 18 }], [{ name: "KK Nagar West" }]);
    assert.equal(t2.passed, true, "2. Required K.K. Nagar West, generated KK Nagar West -> PASS");

    // 3. Required K.K. Nagar West, generated K K Nagar West -> PASS
    const t3 = verifyAssert11Coverage([{ name: "K.K. Nagar West", userCount: 18 }], [{ name: "K K Nagar West" }]);
    assert.equal(t3.passed, true, "3. Required K.K. Nagar West, generated K K Nagar West -> PASS");

    // 4. Required K.K. Nagar West, generated K.K. Nagar -> FAIL
    const t4 = verifyAssert11Coverage([{ name: "K.K. Nagar West", userCount: 18 }], [{ name: "K.K. Nagar" }]);
    assert.equal(t4.passed, false, "4. Required K.K. Nagar West, generated K.K. Nagar -> FAIL");
    assert.deepEqual(t4.missingStoppingAreas, ["K.K. Nagar West"]);

    // 5. Required K.K. Nagar, generated K.K. Nagar West -> FAIL
    const t5 = verifyAssert11Coverage([{ name: "K.K. Nagar", userCount: 21 }], [{ name: "K.K. Nagar West" }]);
    assert.equal(t5.passed, false, "5. Required K.K. Nagar, generated K.K. Nagar West -> FAIL");
    assert.deepEqual(t5.missingStoppingAreas, ["K.K. Nagar"]);

    // 6. Required K.K. Nagar West, generated unrelated stop -> FAIL
    const t6 = verifyAssert11Coverage([{ name: "K.K. Nagar West", userCount: 18 }], [{ name: "Anna Nagar" }]);
    assert.equal(t6.passed, false, "6. Required K.K. Nagar West, generated unrelated stop -> FAIL");
    assert.deepEqual(t6.missingStoppingAreas, ["K.K. Nagar West"]);

    // 7. isSamePlace distinction verification
    const kkNagarLoc = { name: "KK Nagar", latitude: 9.927, longitude: 78.151 };
    const kkWestLoc = { name: "K.K. Nagar West", latitude: 9.925, longitude: 78.146 };
    assert.equal(isSamePlace(kkNagarLoc, kkWestLoc), false, "KK Nagar and K.K. Nagar West must NEVER be isSamePlace");
    assert.equal(isSamePlace(kkWestLoc, kkNagarLoc), false, "K.K. Nagar West and KK Nagar must NEVER be isSamePlace");

    // 8. mergeDuplicateStopsInRoute preservation
    const merged = mergeDuplicateStopsInRoute([kkNagarLoc, kkWestLoc]);
    assert.equal(merged.length, 2, "mergeDuplicateStopsInRoute must NOT merge KK Nagar and K.K. Nagar West");
});


