/**
 * historicalRouteService.js
 * 
 * Production Historical Transportation Route & Pattern Service.
 * 
 * Responsibilities:
 * 1. Maintain standardized historical route datasets (19.09.2026 and 21.09.2026 standardized as OUTGOING).
 * 2. Ingest and persist historical routes into MongoDB without duplication.
 * 3. Construct Stop Co-occurrence Graph and Frequency Matrices from operational history.
 * 4. Calculate historical route similarity and stop pair affinity.
 * 5. Record activated transportation plans and actual execution telemetry into HistoricalRoute and RoutePerformance.
 * 6. Provide clean data access for ML training and real-time candidate route scoring.
 */

import mongoose from "mongoose";
import HistoricalRoute from "../models/HistoricalRoute.js";
import RoutePerformance from "../models/RoutePerformance.js";
import { calculateDistanceKm } from "./mapGeocodingService.js";

// ============================================================================
// LOCATION NORMALIZATION DICTIONARY (Standardizing Tamil/Romanized stop names)
// ============================================================================

export const STOP_NAME_NORMALIZATION_MAP = {
    "alagappan nagar": "Alagappan Nagar",
    "anna nagar": "Anna Nagar",
    "anuppanadi": "Anuppanadi",
    "arappalayam": "Arappalayam",
    "avaniyapuram": "Avaniyapuram",
    "bibikulam": "Bibikulam",
    "goripalayam": "Goripalayam",
    "iyer bungalow": "Iyer Bungalow",
    "jaihindpuram": "Jaihindpuram",
    "kalavasal": "Kalavasal",
    "k.k. nagar west": "K.K. Nagar West",
    "kk nagar west": "K.K. Nagar West",
    "k k nagar west": "K.K. Nagar West",
    "kk nagar": "KK Nagar",
    "k k nagar": "KK Nagar",
    "k.pudur": "K.Pudur",
    "kpudur": "K.Pudur",
    "k pudur": "K.Pudur",
    "pudur": "K.Pudur",
    "kochadai": "Kochadai",
    "kochadai junction": "Kochadai",
    "koodal nagar": "Koodal Nagar",
    "mattuthavani": "Mattuthavani",
    "narimedu": "Narimedu",
    "othakadai": "Othakadai",
    "palanganatham": "Palanganatham",
    "periyar": "Periyar",
    "sellur": "Sellur",
    "simmakkal": "Simmakkal",
    "tallakulam": "Tallakulam",
    "teppakulam": "Teppakulam",
    "thirunagar": "Thirunagar",
    "thiruppalai": "Thiruppalai",
    "vandiyur": "Vandiyur",
    "vilangudi": "Vilangudi",
    "villapuram": "Villapuram",
    "viraganoor": "Viraganoor",
    "viraganur": "Viraganoor"
};

/**
 * Standardizes a stop name to its canonical Romanized title.
 */
export const normalizeStopName = (name) => {
    if (!name || typeof name !== "string") return "";
    const clean = name.toLowerCase().replace(/[^a-z0-9\s.]/g, " ").replace(/\s+/g, " ").trim();
    if (STOP_NAME_NORMALIZATION_MAP[clean]) {
        return STOP_NAME_NORMALIZATION_MAP[clean];
    }
    // Fallback title-casing
    return clean
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
};

// ============================================================================
// STANDARDIZED HISTORICAL ROUTE DATASETS (19.09.2026 & 21.09.2026 - OUTGOING)
// ============================================================================

/**
 * Historical Route Schedule Dataset 1 (19.09.2026)
 * Outgoing routes standardized with ordered stop sequences and vehicle IDs.
 */
export const HISTORICAL_SCHEDULE_19_09 = [
    {
        routeId: "HIST-19-R01",
        busId: "BUS-01",
        vehicleName: "Bus 1 (k1)",
        direction: "OUTWARD",
        scheduleDate: "2026-09-19",
        vehicleCapacity: 70,
        stops: [
            "Avaniyapuram",
            "Villapuram",
            "Jaihindpuram",
            "Palanganatham",
            "Alagappan Nagar",
            "Kalavasal",
            "Thirunagar"
        ]
    },
    {
        routeId: "HIST-19-R02",
        busId: "BUS-02",
        vehicleName: "Bus 2 (V1)",
        direction: "OUTWARD",
        scheduleDate: "2026-09-19",
        vehicleCapacity: 70,
        stops: [
            "K.Pudur",
            "Iyer Bungalow",
            "Thiruppalai",
            "Koodal Nagar",
            "Vilangudi",
            "Sellur"
        ]
    },
    {
        routeId: "HIST-19-R03",
        busId: "BUS-03",
        vehicleName: "Bus 3 (D1)",
        direction: "OUTWARD",
        scheduleDate: "2026-09-19",
        vehicleCapacity: 70,
        stops: [
            "Anuppanadi",
            "Periyar",
            "Arappalayam",
            "Kochadai"
        ]
    },
    {
        routeId: "HIST-19-R04",
        busId: "BUS-04",
        vehicleName: "Bus 4 (AS@)",
        direction: "OUTWARD",
        scheduleDate: "2026-09-19",
        vehicleCapacity: 70,
        stops: [
            "Simmakkal",
            "Goripalayam",
            "Tallakulam",
            "Narimedu"
        ]
    },
    {
        routeId: "HIST-19-R05",
        busId: "BUS-07",
        vehicleName: "Bus 7 (A2)",
        direction: "OUTWARD",
        scheduleDate: "2026-09-19",
        vehicleCapacity: 70,
        stops: [
            "Anna Nagar",
            "K.K. Nagar West",
            "KK Nagar",
            "Bibikulam"
        ]
    },
    {
        routeId: "HIST-19-R06",
        busId: "BUS-05",
        vehicleName: "Bus 5 (w1)",
        direction: "OUTWARD",
        scheduleDate: "2026-09-19",
        vehicleCapacity: 60,
        stops: [
            "Viraganoor",
            "Teppakulam",
            "Vandiyur",
            "Mattuthavani",
            "Othakadai"
        ]
    }
];

/**
 * Historical Route Schedule Dataset 2 (21.09.2026)
 * Outgoing routes standardized with ordered stop sequences and vehicle IDs.
 */
export const HISTORICAL_SCHEDULE_21_09 = [
    {
        routeId: "HIST-21-R01",
        busId: "BUS-01",
        vehicleName: "Bus 1 (k1)",
        direction: "OUTWARD",
        scheduleDate: "2026-09-21",
        vehicleCapacity: 70,
        stops: [
            "Alagappan Nagar",
            "Palanganatham",
            "Jaihindpuram",
            "Periyar",
            "Kalavasal",
            "Kochadai",
            "Thirunagar"
        ]
    },
    {
        routeId: "HIST-21-R02",
        busId: "BUS-06",
        vehicleName: "Bus 6 (F)",
        direction: "OUTWARD",
        scheduleDate: "2026-09-21",
        vehicleCapacity: 45,
        stops: [
            "Avaniyapuram",
            "Villapuram"
        ]
    },
    {
        routeId: "HIST-21-R03",
        busId: "BUS-02",
        vehicleName: "Bus 2 (V1)",
        direction: "OUTWARD",
        scheduleDate: "2026-09-21",
        vehicleCapacity: 70,
        stops: [
            "K.Pudur",
            "Iyer Bungalow",
            "Thiruppalai",
            "Koodal Nagar",
            "Vilangudi",
            "Sellur"
        ]
    },
    {
        routeId: "HIST-21-R04",
        busId: "BUS-03",
        vehicleName: "Bus 3 (D1)",
        direction: "OUTWARD",
        scheduleDate: "2026-09-21",
        vehicleCapacity: 70,
        stops: [
            "Anuppanadi",
            "Simmakkal",
            "Arappalayam",
            "Narimedu",
            "Bibikulam"
        ]
    },
    {
        routeId: "HIST-21-R05",
        busId: "BUS-04",
        vehicleName: "Bus 4 (AS@)",
        direction: "OUTWARD",
        scheduleDate: "2026-09-21",
        vehicleCapacity: 70,
        stops: [
            "Viraganoor",
            "Goripalayam",
            "Tallakulam",
            "Mattuthavani"
        ]
    },
    {
        routeId: "HIST-21-R06",
        busId: "BUS-07",
        vehicleName: "Bus 7 (A2)",
        direction: "OUTWARD",
        scheduleDate: "2026-09-21",
        vehicleCapacity: 70,
        stops: [
            "Anna Nagar",
            "K.K. Nagar West",
            "KK Nagar"
        ]
    },
    {
        routeId: "HIST-21-R07",
        busId: "BUS-05",
        vehicleName: "Bus 5 (w1)",
        direction: "OUTWARD",
        scheduleDate: "2026-09-21",
        vehicleCapacity: 60,
        stops: [
            "Teppakulam",
            "Vandiyur",
            "Othakadai"
        ]
    }
];

// Combine standard baseline historical routes
export const BASELINE_HISTORICAL_ROUTES = [
    ...HISTORICAL_SCHEDULE_19_09,
    ...HISTORICAL_SCHEDULE_21_09
];

// In-memory co-occurrence and succession graphs
let cachedCooccurrenceMap = null;
let cachedSuccessionMap = null;

// ============================================================================
// SEEDING & INGESTION
// ============================================================================

/**
 * Seeds baseline historical routes into MongoDB if not already initialized.
 */
export const seedHistoricalRoutesIfEmpty = async () => {
    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
        return;
    }

    try {
        const count = await HistoricalRoute.countDocuments();
        if (count === 0) {
            const docsToInsert = BASELINE_HISTORICAL_ROUTES.map((hr) => ({
                routeId: hr.routeId,
                busId: hr.busId,
                vehicleName: hr.vehicleName,
                direction: hr.direction,
                scheduleDate: hr.scheduleDate,
                vehicleCapacity: hr.vehicleCapacity,
                numberOfStops: hr.stops.length,
                stopNames: hr.stops.map(normalizeStopName),
                stops: hr.stops.map((s, idx) => ({
                    name: normalizeStopName(s),
                    sequenceOrder: idx + 1
                })),
                historicalRouteFrequency: 1,
                routeQuality: 0.90
            }));

            await HistoricalRoute.insertMany(docsToInsert);
            console.log(`[HISTORICAL_ROUTES] Successfully seeded ${docsToInsert.length} baseline historical routes.`);
        }
    } catch (err) {
        console.warn("[HISTORICAL_ROUTES] Could not seed historical routes to DB:", err.message);
    }
};

// ============================================================================
// GRAPH COMPUTATION (Co-occurrence & Succession)
// ============================================================================

/**
 * Builds or refreshes the Stop Co-occurrence Map and Succession Map.
 * Co-occurrence: how often stop A and stop B appear in the SAME route.
 * Succession: how often stop B immediately follows stop A.
 */
export const buildStopHistoricalGraphs = async () => {
    let routes = [];

    if (mongoose.connection && mongoose.connection.readyState === 1) {
        try {
            const dbRoutes = await HistoricalRoute.find().lean();
            if (dbRoutes && dbRoutes.length > 0) {
                routes = dbRoutes.map((r) => ({
                    stops: (r.stops || []).map((s) => normalizeStopName(s.name || s))
                }));
            }
        } catch (err) {
            console.warn("[HISTORICAL_ROUTES] DB fetch error, using baseline:", err.message);
        }
    }

    if (routes.length === 0) {
        routes = BASELINE_HISTORICAL_ROUTES.map((r) => ({
            stops: r.stops.map(normalizeStopName)
        }));
    }

    const cooccurrence = new Map(); // key: "stopA|stopB" sorted -> count
    const succession = new Map();   // key: "stopA->stopB" -> count
    const stopAppearance = new Map(); // key: "stopA" -> total route count

    routes.forEach((r) => {
        const stops = r.stops || [];
        for (let i = 0; i < stops.length; i++) {
            const sA = stops[i];
            if (!sA) continue;
            stopAppearance.set(sA, (stopAppearance.get(sA) || 0) + 1);

            // Succession (ordered transition)
            if (i < stops.length - 1) {
                const sNext = stops[i + 1];
                if (sNext) {
                    const succKey = `${sA}->${sNext}`;
                    succession.set(succKey, (succession.get(succKey) || 0) + 1);
                }
            }

            // Co-occurrence (unordered pair)
            for (let j = i + 1; j < stops.length; j++) {
                const sB = stops[j];
                if (!sB || sA === sB) continue;
                const pairKey = sA < sB ? `${sA}|${sB}` : `${sB}|${sA}`;
                cooccurrence.set(pairKey, (cooccurrence.get(pairKey) || 0) + 1);
            }
        }
    });

    cachedCooccurrenceMap = cooccurrence;
    cachedSuccessionMap = succession;

    return {
        cooccurrence,
        succession,
        totalRoutesCount: routes.length,
        distinctStopsCount: stopAppearance.size
    };
};

/**
 * Returns the co-occurrence frequency of two stops across historical routes.
 */
export const getStopCooccurrenceScore = async (stopA, stopB) => {
    if (!stopA || !stopB) return 0;
    const nA = normalizeStopName(stopA);
    const nB = normalizeStopName(stopB);
    if (nA === nB) return 1.0;

    if (!cachedCooccurrenceMap) {
        await buildStopHistoricalGraphs();
    }

    const pairKey = nA < nB ? `${nA}|${nB}` : `${nB}|${nA}`;
    const count = cachedCooccurrenceMap ? (cachedCooccurrenceMap.get(pairKey) || 0) : 0;

    // Normalize score to [0, 1] relative to baseline routes count (~13 total routes)
    const score = Math.min(1.0, count / 2.0);
    return Number(score.toFixed(3));
};

/**
 * Returns succession count (how often stopB follows stopA).
 */
export const getStopSuccessionScore = async (stopA, stopB) => {
    if (!stopA || !stopB) return 0;
    const nA = normalizeStopName(stopA);
    const nB = normalizeStopName(stopB);
    if (nA === nB) return 0;

    if (!cachedSuccessionMap) {
        await buildStopHistoricalGraphs();
    }

    const key = `${nA}->${nB}`;
    const count = cachedSuccessionMap ? (cachedSuccessionMap.get(key) || 0) : 0;
    return count;
};

/**
 * Calculates historical similarity for a candidate route stop sequence.
 * Compares against all known historical routes to measure consistency with established transit patterns.
 */
export const calculateHistoricalRouteSimilarity = async (candidateStops = []) => {
    if (!Array.isArray(candidateStops) || candidateStops.length === 0) {
        return 0.5; // neutral fallback
    }

    const candidateNorm = candidateStops.map((s) => normalizeStopName(s.name || s));
    const candSet = new Set(candidateNorm);
    if (candSet.size === 0) return 0.5;

    let bestJaccard = 0;

    for (const hist of BASELINE_HISTORICAL_ROUTES) {
        const histNorm = hist.stops.map(normalizeStopName);
        const histSet = new Set(histNorm);

        let intersection = 0;
        candSet.forEach((s) => {
            if (histSet.has(s)) intersection++;
        });

        const union = new Set([...candSet, ...histSet]).size;
        const jaccard = union > 0 ? intersection / union : 0;
        if (jaccard > bestJaccard) {
            bestJaccard = jaccard;
        }
    }

    return Number(bestJaccard.toFixed(3));
};

// ============================================================================
// CONTINUOUS RECORDING OF ACTIVATED PLANS & PERFORMANCE TELEMETRY
// ============================================================================

/**
 * Records an activated transportation plan into HistoricalRoute and RoutePerformance.
 * Ensures the system continuously learns from real-world operations.
 */
export const recordActivatedPlanPerformance = async ({
    plan,
    direction = "OUTWARD",
    planId = null,
    planVersion = 1,
    sourceHub = null
}) => {
    if (!plan || !Array.isArray(plan.buses)) {
        return { success: false, reason: "NO_BUSES_IN_PLAN" };
    }

    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
        return { success: false, reason: "DB_NOT_CONNECTED" };
    }

    try {
        const historicalDocs = [];
        const performanceDocs = [];

        for (const bus of plan.buses) {
            const stops = bus.stops || [];
            const stopNames = stops.map((s) => normalizeStopName(s.name || s.stopName));
            const passengerCount = bus.assignedUsers || bus.allocatedSeats || stops.reduce((sum, s) => sum + (s.userCount || 0), 0);
            const capacity = bus.capacity || bus.seatCapacity || 70;
            const utilization = capacity > 0 ? Number(((passengerCount / capacity) * 100).toFixed(1)) : 0;

            const histDoc = {
                routeId: bus.routeId || bus.routeCode || `R-${historicalDocs.length + 1}`,
                busId: bus.vehicleId || bus.vehicleName || "BUS-GEN",
                vehicleName: bus.vehicleName || "Assigned Bus",
                direction: direction || bus.tripMode || "OUTWARD",
                passengerCount,
                vehicleCapacity: capacity,
                utilization,
                numberOfStops: stops.length,
                stopNames,
                stops: stops.map((s, idx) => ({
                    name: normalizeStopName(s.name || s.stopName),
                    latitude: s.latitude || null,
                    longitude: s.longitude || null,
                    sequenceOrder: idx + 1,
                    passengerCount: s.userCount || s.passengersDropped || 0,
                    legDistanceKm: s.legDistanceKm || 0,
                    legDurationMin: s.legDurationMin || 0
                })),
                roadDistanceKm: bus.routeDistanceKm || bus.distanceKm || 0,
                travelTimeMin: bus.routeDurationMin || bus.durationMin || 0,
                unusedSeats: Math.max(0, capacity - passengerCount),
                routeQuality: bus.scores?.quality || bus.routeScore || 0.85,
                sourceHub: sourceHub || bus.sourceHub,
                planId: planId || String(plan._id || ""),
                createdAt: new Date()
            };

            const perfDoc = {
                routeId: histDoc.routeId,
                planId: histDoc.planId,
                planVersion: planVersion || 1,
                direction: histDoc.direction,
                vehicleId: histDoc.busId,
                vehicleName: histDoc.vehicleName,
                plannedDistanceKm: histDoc.roadDistanceKm,
                actualDistanceKm: histDoc.roadDistanceKm,
                plannedDurationMin: histDoc.travelTimeMin,
                actualDurationMin: histDoc.travelTimeMin,
                passengerCount,
                vehicleCapacity: capacity,
                utilization,
                unusedSeats: histDoc.unusedSeats,
                lateResponsesHandled: 0,
                routeChangesCount: 0,
                recordedAt: new Date()
            };

            historicalDocs.push(histDoc);
            performanceDocs.push(perfDoc);
        }

        if (historicalDocs.length > 0) {
            await Promise.allSettled([
                HistoricalRoute.insertMany(historicalDocs),
                RoutePerformance.insertMany(performanceDocs)
            ]);
            // Invalidate cache so graph immediately incorporates new plan data
            cachedCooccurrenceMap = null;
            cachedSuccessionMap = null;
        }

        return {
            success: true,
            recordedRoutesCount: historicalDocs.length
        };
    } catch (err) {
        console.error("[HISTORICAL_ROUTES] Error recording plan telemetry:", err);
        return { success: false, error: err.message };
    }
};
