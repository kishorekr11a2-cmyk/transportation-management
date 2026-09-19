/**
 * roadMatrixService.js
 * 
 * Production Logistics Road Routing & Distance Matrix Service.
 * Features:
 * - OSRM Table API integration for all-pairs directional road distances and durations (asymmetric-safe)
 * - Explicit routing confidence & verification metadata: routingSource, osrmVerified, geometryVerified, requiresRevalidation
 * - OSRM Route API integration for full road geometries, per-leg steps, and Leaflet polyline coords
 * - In-memory multi-level caching for road segments, matrices, and geometries (tracking cached vs live status)
 * - Calibrated offline fallback using Haversine with empirical urban transit detour factors
 * - Logistics operational metrics: boarding dwell times, ETAs/ETDs, fuel consumption, CO2 footprint, driver regulation compliance
 * - Non-fatal resilience: gracefully handles OSRM timeouts and rate limits
 */

import mongoose from "mongoose";
import { isValidCoordinate, calculateDistanceKm } from "./mapGeocodingService.js";
import RoadMatrixCache from "../models/RoadMatrixCache.js";

// ============================================================================
// CONFIGURATION & CONSTANTS
// ============================================================================

export const ROUTING_BASE_URL = process.env.ROUTING_BASE_URL || process.env.OSRM_BASE_URL || "https://router.project-osrm.org";
export const OSRM_TIMEOUT_MS = Number(process.env.OSRM_TIMEOUT_MS || 7000);
export const MAX_OSRM_TABLE_BATCH = 60; // Max coordinates per single OSRM table request

// Operational Logistics Standards
export const STANDARD_BUS_SPEED_KMH = 32.0; // Realistic average urban bus travel speed
export const STOP_BASE_DWELL_MINUTES = 1.0; // Base vehicle stop time (opening doors, maneuvering)
export const PASSENGER_BOARDING_SECONDS = 4.0; // Average boarding/alighting time per passenger
export const DIESEL_BUS_KM_PER_LITER = 3.8; // Fuel economy for transit buses
export const CO2_KG_PER_LITER_DIESEL = 2.68; // Carbon intensity of commercial diesel
export const MAX_CONTINUOUS_DRIVE_HOURS = 4.5; // Maximum continuous commercial driver duty time before mandatory rest

// In-memory caches
const matrixCache = new Map();
const segmentCache = new Map();
const geometryCache = new Map();

// ============================================================================
// OSRM TABLE API (DIRECTIONAL ALL-PAIRS ROAD DISTANCE & DURATION MATRIX)
// ============================================================================

/**
 * Builds a road distance and duration matrix for an array of locations.
 * Note: Directional matrix is asymmetric (matrix[i][j] may differ from matrix[j][i] due to one-way streets, turns, etc.).
 * 
 * Returns:
 * {
 *   distances: number[][], // Matrix of distances in kilometers
 *   durations: number[][], // Matrix of durations in minutes
 *   routingSource: "osrm" | "calibrated_fallback" | "cached_osrm" | "cached_fallback",
 *   osrmVerified: boolean,
 *   geometryVerified: boolean,
 *   requiresRevalidation: boolean,
 *   provider: string,
 *   locationCount: number
 * }
 */
export const getRoadDistanceDurationMatrix = async (locations = [], options = {}) => {
    const validLocations = locations.filter((loc) =>
        isValidCoordinate(loc?.latitude, loc?.longitude)
    );

    const N = validLocations.length;
    if (N === 0) {
        return {
            distances: [],
            durations: [],
            routingSource: "calibrated_fallback",
            osrmVerified: false,
            geometryVerified: false,
            requiresRevalidation: true,
            provider: "empty",
            locationCount: 0
        };
    }

    // Initialize output matrices
    const distances = Array.from({ length: N }, () => Array(N).fill(0));
    const durations = Array.from({ length: N }, () => Array(N).fill(0));

    if (N === 1) {
        return {
            distances,
            durations,
            routingSource: "osrm",
            osrmVerified: true,
            geometryVerified: true,
            requiresRevalidation: false,
            provider: "single_point",
            locationCount: 1
        };
    }

    // Construct cache key based on coordinates
    const cacheKey = validLocations
        .map((p) => `${Number(p.latitude).toFixed(4)},${Number(p.longitude).toFixed(4)}`)
        .join(";");

    if (matrixCache.has(cacheKey)) {
        const cached = matrixCache.get(cacheKey);
        return {
            ...cached,
            routingSource: cached.osrmVerified ? "cached_osrm" : "cached_fallback"
        };
    }

    // Check persistent MongoDB cache if available
    if (mongoose.connection && mongoose.connection.readyState === 1) {
        try {
            const dbCached = await RoadMatrixCache.findOne({ cacheKey }).lean();
            if (dbCached && Array.isArray(dbCached.distances) && dbCached.distances.length === N) {
                const res = {
                    distances: dbCached.distances,
                    durations: dbCached.durations,
                    routingSource: "cached_osrm",
                    osrmVerified: dbCached.source === "osrm",
                    geometryVerified: dbCached.source === "osrm",
                    requiresRevalidation: dbCached.source !== "osrm",
                    provider: dbCached.source || "cached_db",
                    locationCount: N
                };
                matrixCache.set(cacheKey, res);
                return res;
            }
        } catch {
            // non-fatal
        }
    }

    let isRoadVerified = false;
    let routingSource = "calibrated_fallback";

    // Attempt OSRM Table API if N is within batch limit
    if (N <= MAX_OSRM_TABLE_BATCH && options.useOnlineOsrm !== false) {
        try {
            const coordString = validLocations
                .map((p) => `${Number(p.longitude).toFixed(6)},${Number(p.latitude).toFixed(6)}`)
                .join(";");

            const url = `${ROUTING_BASE_URL}/table/v1/driving/${coordString}?annotations=distance,duration`;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS);

            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (res.ok) {
                const data = await res.json();
                if (data?.code === "Ok" && Array.isArray(data.distances) && Array.isArray(data.durations)) {
                    let matrixValid = true;

                    for (let i = 0; i < N; i++) {
                        for (let j = 0; j < N; j++) {
                            if (i === j) {
                                distances[i][j] = 0;
                                durations[i][j] = 0;
                            } else {
                                const distM = data.distances[i]?.[j];
                                const durS = data.durations[i]?.[j];

                                if (distM === null || distM === undefined || distM < 0) {
                                    matrixValid = false;
                                    break;
                                }

                                // Preserve true asymmetric directional values
                                distances[i][j] = Number((distM / 1000).toFixed(2));
                                durations[i][j] = Number((durS / 60).toFixed(1));
                            }
                        }
                        if (!matrixValid) break;
                    }

                    if (matrixValid) {
                        isRoadVerified = true;
                        routingSource = "osrm";
                    }
                }
            }
        } catch (err) {
            // Non-blocking fallback to calibrated matrix
            console.warn("[roadMatrixService] OSRM table query fallback:", err.message);
        }
    }

    // Fallback if OSRM was unavailable, timed out, or exceeded batch size
    if (!isRoadVerified) {
        for (let i = 0; i < N; i++) {
            for (let j = 0; j < N; j++) {
                if (i === j) {
                    distances[i][j] = 0;
                    durations[i][j] = 0;
                } else {
                    const straightKm = calculateDistanceKm(
                        validLocations[i].latitude, validLocations[i].longitude,
                        validLocations[j].latitude, validLocations[j].longitude
                    );
                    // Empirical directional urban detour factor
                    const detourFactor = straightKm > 20 ? 1.22 : (straightKm > 8 ? 1.28 : 1.35);
                    const roadDistKm = Number((straightKm * detourFactor).toFixed(2));
                    const roadDurMin = Number(((roadDistKm / STANDARD_BUS_SPEED_KMH) * 60).toFixed(1));

                    distances[i][j] = roadDistKm;
                    durations[i][j] = roadDurMin;
                }
            }
        }
    }

    const result = {
        distances,
        durations,
        routingSource,
        osrmVerified: isRoadVerified,
        geometryVerified: isRoadVerified,
        requiresRevalidation: !isRoadVerified,
        provider: isRoadVerified ? "osrm" : "calibrated_fallback",
        locationCount: N
    };

    matrixCache.set(cacheKey, result);

    if (mongoose.connection && mongoose.connection.readyState === 1) {
        RoadMatrixCache.updateOne(
            { cacheKey },
            {
                $set: {
                    cacheKey,
                    distances: result.distances,
                    durations: result.durations,
                    source: isRoadVerified ? "osrm" : "calibrated_fallback",
                    locationCount: N
                }
            },
            { upsert: true }
        ).catch(() => {});
    }

    return result;
};

// ============================================================================
// PAIRWISE ROAD SEGMENT ROUTER
// ============================================================================

/**
 * Gets the road distance and travel time between two individual points.
 */
export const getRoadSegment = async (fromPt, toPt, options = {}) => {
    if (!isValidCoordinate(fromPt?.latitude, fromPt?.longitude) ||
        !isValidCoordinate(toPt?.latitude, toPt?.longitude)) {
        return null;
    }

    const key = `${Number(fromPt.latitude).toFixed(5)},${Number(fromPt.longitude).toFixed(5)}->${Number(toPt.latitude).toFixed(5)},${Number(toPt.longitude).toFixed(5)}`;
    if (segmentCache.has(key)) {
        const cached = segmentCache.get(key);
        return {
            ...cached,
            routingSource: cached.osrmVerified ? "cached_osrm" : "cached_fallback"
        };
    }

    const straightLineKm = calculateDistanceKm(fromPt.latitude, fromPt.longitude, toPt.latitude, toPt.longitude);

    if (straightLineKm < 0.05) {
        const zeroResult = {
            distanceKm: 0.05,
            durationMin: 0.5,
            straightLineKm,
            detourRatio: 1.0,
            routingSource: "osrm",
            osrmVerified: true,
            geometryVerified: true,
            requiresRevalidation: false,
            isRoadVerified: true,
            isFallback: false
        };
        segmentCache.set(key, zeroResult);
        return zeroResult;
    }

    let isRoadVerified = false;
    let routingSource = "calibrated_fallback";
    let distanceKm = 0;
    let durationMin = 0;

    if (options.useOnlineOsrm !== false) {
        const coords = `${Number(fromPt.longitude).toFixed(6)},${Number(fromPt.latitude).toFixed(6)};${Number(toPt.longitude).toFixed(6)},${Number(toPt.latitude).toFixed(6)}`;
        const url = `${ROUTING_BASE_URL}/route/v1/driving/${coords}?overview=false`;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2500);
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (response.ok) {
                const data = await response.json();
                if (data?.code === "Ok" && Array.isArray(data?.routes) && data.routes.length > 0) {
                    const distM = Number(data.routes[0].distance || 0);
                    const durS = Number(data.routes[0].duration || 0);
                    const osrmDist = Number((distM / 1000).toFixed(2));
                    const osrmDur = Number((durS / 60).toFixed(1));

                    // Sanity check detour bounds
                    if (osrmDist >= straightLineKm * 0.7 && osrmDist <= straightLineKm * 3.5 + 5) {
                        distanceKm = osrmDist;
                        durationMin = osrmDur;
                        isRoadVerified = true;
                        routingSource = "osrm";
                    }
                }
            }
        } catch {
            // Fall through to calibrated fallback
        }
    }

    if (!isRoadVerified) {
        const detourFactor = straightLineKm > 15 ? 1.20 : 1.28;
        distanceKm = Number((straightLineKm * detourFactor).toFixed(2));
        durationMin = Number(((distanceKm / STANDARD_BUS_SPEED_KMH) * 60).toFixed(1));
    }

    const detourRatio = straightLineKm > 0 ? Number((distanceKm / straightLineKm).toFixed(2)) : 1.0;

    const result = {
        distanceKm,
        durationMin,
        straightLineKm: Number(straightLineKm.toFixed(2)),
        detourRatio,
        routingSource,
        osrmVerified: isRoadVerified,
        geometryVerified: isRoadVerified,
        requiresRevalidation: !isRoadVerified,
        isRoadVerified,
        isFallback: !isRoadVerified
    };

    segmentCache.set(key, result);
    return result;
};

// ============================================================================
// CONSECUTIVE SEGMENT OSRM ROUTE GEOMETRY BUILDER
// ============================================================================

const segmentGeometryCache = new Map();

/**
 * Fetches true OSRM road geometry between two consecutive points with overview=full.
 */
export const getRoadSegmentGeometry = async (fromPt, toPt, options = {}) => {
    if (!isValidCoordinate(fromPt?.latitude, fromPt?.longitude) ||
        !isValidCoordinate(toPt?.latitude, toPt?.longitude)) {
        return {
            geometry: [],
            distanceKm: 0,
            durationMin: 0,
            osrmVerified: false,
            geometryVerified: false
        };
    }

    const key = `${Number(fromPt.latitude).toFixed(5)},${Number(fromPt.longitude).toFixed(5)}->${Number(toPt.latitude).toFixed(5)},${Number(toPt.longitude).toFixed(5)}`;
    if (segmentGeometryCache.has(key)) {
        return segmentGeometryCache.get(key);
    }

    const straightLineKm = calculateDistanceKm(fromPt.latitude, fromPt.longitude, toPt.latitude, toPt.longitude);

    if (straightLineKm < 0.05) {
        const zeroResult = {
            geometry: [[Number(fromPt.latitude), Number(fromPt.longitude)], [Number(toPt.latitude), Number(toPt.longitude)]],
            distanceKm: 0.05,
            durationMin: 0.5,
            osrmVerified: true,
            geometryVerified: true
        };
        segmentGeometryCache.set(key, zeroResult);
        return zeroResult;
    }

    let isRoadVerified = false;
    let geometry = [];
    let distanceKm = 0;
    let durationMin = 0;

    if (options.useOnlineOsrm !== false) {
        const coords = `${Number(fromPt.longitude).toFixed(6)},${Number(fromPt.latitude).toFixed(6)};${Number(toPt.longitude).toFixed(6)},${Number(toPt.latitude).toFixed(6)}`;
        const url = `${ROUTING_BASE_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson`;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS);
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (response.ok) {
                const data = await response.json();
                if (data?.code === "Ok" && Array.isArray(data?.routes) && data.routes.length > 0) {
                    const route = data.routes[0];
                    const rawCoords = Array.isArray(route?.geometry?.coordinates) ? route.geometry.coordinates : [];
                    geometry = rawCoords.map(([lng, lat]) => [Number(lat), Number(lng)]);
                    distanceKm = Number(((Number(route.distance || 0)) / 1000).toFixed(2));
                    durationMin = Number(((Number(route.duration || 0)) / 60).toFixed(1));

                    if (geometry.length >= 2 && distanceKm >= straightLineKm * 0.7 && distanceKm <= straightLineKm * 4.0 + 5) {
                        isRoadVerified = true;
                    }
                }
            }
        } catch {
            // Fall through to fallback
        }
    }

    if (!isRoadVerified) {
        geometry = [
            [Number(fromPt.latitude), Number(fromPt.longitude)],
            [Number(toPt.latitude), Number(toPt.longitude)]
        ];
        const detourFactor = straightLineKm > 15 ? 1.20 : 1.28;
        distanceKm = Number((straightLineKm * detourFactor).toFixed(2));
        durationMin = Number(((distanceKm / STANDARD_BUS_SPEED_KMH) * 60).toFixed(1));
    }

    const result = {
        geometry,
        distanceKm,
        durationMin,
        osrmVerified: isRoadVerified,
        geometryVerified: isRoadVerified
    };

    segmentGeometryCache.set(key, result);
    return result;
};

/**
 * Builds continuous road geometry by routing between EVERY consecutive waypoint:
 * Source -> Stop 1 -> Stop 2 -> ... -> Final Stop.
 * Joins all coordinates in order and removes only the duplicate bridge points.
 */
export const buildConsecutiveSegmentRoadGeometry = async (waypoints = [], options = {}) => {
    const validPoints = (waypoints || []).filter((p) =>
        isValidCoordinate(p?.latitude, p?.longitude)
    );

    if (validPoints.length < 2) {
        return {
            geometry: validPoints.map((p) => [Number(p.latitude), Number(p.longitude)]),
            distanceKm: 0,
            durationMin: 0,
            legs: [],
            segmentCount: 0,
            successfulSegments: 0,
            failedSegments: 0,
            stopsMatchedCount: validPoints.length,
            isRoadVerified: false,
            isContinuous: false,
            geometryVerified: false,
            requiresRevalidation: true,
            roadRouteStatus: "Road validation unavailable — fallback estimate used",
            routingSource: "calibrated_fallback"
        };
    }

    const totalSegments = validPoints.length - 1;
    const segmentPromises = [];

    for (let i = 0; i < totalSegments; i++) {
        segmentPromises.push(getRoadSegmentGeometry(validPoints[i], validPoints[i + 1], options));
    }

    const resolvedSegments = await Promise.all(segmentPromises);

    const combinedGeometry = [];
    let totalDistanceKm = 0;
    let totalDurationMin = 0;
    let successfulSegments = 0;
    let failedSegments = 0;
    const legs = [];

    for (let i = 0; i < resolvedSegments.length; i++) {
        const seg = resolvedSegments[i];
        totalDistanceKm += seg.distanceKm;
        totalDurationMin += seg.durationMin;

        legs.push({
            fromIndex: i,
            toIndex: i + 1,
            fromName: validPoints[i]?.name || `Point ${i + 1}`,
            toName: validPoints[i + 1]?.name || `Point ${i + 2}`,
            distanceKm: seg.distanceKm,
            durationMin: seg.durationMin,
            osrmVerified: seg.osrmVerified,
            geometryVerified: seg.geometryVerified,
            coordinatesCount: seg.geometry?.length || 0
        });

        if (seg.osrmVerified) {
            successfulSegments++;
        } else {
            failedSegments++;
        }

        const segCoords = Array.isArray(seg.geometry) ? seg.geometry : [];

        if (combinedGeometry.length === 0) {
            combinedGeometry.push(...segCoords);
        } else if (segCoords.length > 0) {
            const lastPt = combinedGeometry[combinedGeometry.length - 1];
            const firstPt = segCoords[0];
            const distBetweenEndpoints = calculateDistanceKm(lastPt[0], lastPt[1], firstPt[0], firstPt[1]);

            // Remove only the duplicate connecting coordinate between adjacent segments (< 200m or identical)
            if (distBetweenEndpoints < 0.2) {
                combinedGeometry.push(...segCoords.slice(1));
            } else {
                combinedGeometry.push(...segCoords);
            }
        }
    }

    // Verify stops matched to combined polyline (within 600 meters tolerance)
    let stopsMatchedCount = 0;
    validPoints.forEach((wpt) => {
        const wptLat = Number(wpt.latitude);
        const wptLng = Number(wpt.longitude);
        let minD = Infinity;
        for (const pt of combinedGeometry) {
            const d = calculateDistanceKm(wptLat, wptLng, pt[0], pt[1]);
            if (d < minD) {
                minD = d;
                if (minD < 0.25) break;
            }
        }
        if (minD <= 0.6) {
            stopsMatchedCount++;
        }
    });

    const isContinuous = failedSegments === 0 &&
        successfulSegments === totalSegments &&
        combinedGeometry.length >= totalSegments * 2 &&
        stopsMatchedCount === validPoints.length;

    const roadRouteStatus = isContinuous
        ? "Continuous OSRM road progression verified"
        : "⚠ Continuous OSRM geometry unavailable";

    const segmentCoordinateCounts = legs.map((l) => l.coordinatesCount);

    return {
        geometry: combinedGeometry,
        geoJson: {
            type: "LineString",
            coordinates: combinedGeometry.map(([lat, lng]) => [lng, lat])
        },
        coordinates: combinedGeometry,
        distanceKm: Number(totalDistanceKm.toFixed(2)),
        durationMin: Number(totalDurationMin.toFixed(1)),
        legs,
        segmentCount: totalSegments,
        successfulSegments,
        failedSegments,
        segmentCoordinateCounts,
        stopsMatchedCount,
        totalWaypoints: validPoints.length,
        isRoadVerified: isContinuous,
        isContinuous,
        geometryVerified: isContinuous,
        requiresRevalidation: !isContinuous,
        usesCombinedOsrmGeometry: isContinuous && failedSegments === 0,
        straightLineFallbackUsed: failedSegments > 0,
        roadRouteStatus,
        routingSource: isContinuous ? "osrm" : "calibrated_fallback"
    };
};

// ============================================================================
// OSRM ROUTE API (FULL ROUTE GEOMETRY & STEP DETAILS)
// ============================================================================

/**
 * Derives exact road route geometry, individual leg metrics, and Leaflet polyline points
 * for an ordered sequence of waypoints.
 * Exposes strict geometry verification metadata (geometrySource, geometryVerified, osrmVerified, requiresRevalidation).
 */
export const getRoadRouteGeometry = async (waypoints = [], options = {}) => {
    const validPoints = (waypoints || []).filter((p) =>
        isValidCoordinate(p?.latitude, p?.longitude)
    );

    if (validPoints.length < 2) {
        return null;
    }

    const queryKey = validPoints
        .map((p) => `${Number(p.latitude).toFixed(5)},${Number(p.longitude).toFixed(5)}`)
        .join(";");

    if (geometryCache.has(queryKey)) {
        const cached = geometryCache.get(queryKey);
        return {
            ...cached,
            routingSource: cached.osrmVerified ? "cached_osrm" : "cached_fallback"
        };
    }

    // Straight-line baseline
    let straightLineKm = 0;
    for (let i = 0; i < validPoints.length - 1; i++) {
        straightLineKm += calculateDistanceKm(
            validPoints[i].latitude, validPoints[i].longitude,
            validPoints[i + 1].latitude, validPoints[i + 1].longitude
        );
    }
    straightLineKm = Number(straightLineKm.toFixed(2));

    const coordString = validPoints
        .map((p) => `${Number(p.longitude).toFixed(6)},${Number(p.latitude).toFixed(6)}`)
        .join(";");

    const url = `${ROUTING_BASE_URL}/route/v1/driving/${coordString}?overview=full&geometries=geojson&steps=true`;

    let geometry = [];
    let distanceKm = 0;
    let durationMin = 0;
    let legs = [];
    let isRoadVerified = false;
    let geometrySource = "estimated_straight_line";
    let routingSource = "calibrated_fallback";

    if (options.useOnlineOsrm !== false) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS);
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (response.ok) {
                const data = await response.json();
                if (data?.code === "Ok" && Array.isArray(data?.routes) && data.routes.length > 0) {
                    const route = data.routes[0];
                    const rawCoords = Array.isArray(route?.geometry?.coordinates) ? route.geometry.coordinates : [];

                    // Convert GeoJSON [lon, lat] to Leaflet [lat, lon]
                    geometry = rawCoords.map((c) => [Number(c[1]), Number(c[0])]);

                    const distMeters = Number(route.distance || 0);
                    const durSeconds = Number(route.duration || 0);
                    distanceKm = Number((distMeters / 1000).toFixed(2));
                    durationMin = Number((durSeconds / 60).toFixed(1));

                    // Validate route plausibility (no bizarre 10x detours)
                    const maxAllowedKm = Math.max(25, straightLineKm * 3.2);
                    if (distanceKm <= maxAllowedKm && distanceKm >= straightLineKm * 0.6) {
                        isRoadVerified = true;
                        geometrySource = "osrm_route";
                        routingSource = "osrm";

                        // Extract per-leg metrics with individual verification metadata
                        const rawLegs = Array.isArray(route.legs) ? route.legs : [];
                        legs = rawLegs.map((leg, lIdx) => {
                            const legDistKm = Number(((leg.distance || 0) / 1000).toFixed(2));
                            const legDurMin = Number(((leg.duration || 0) / 60).toFixed(1));
                            return {
                                fromIndex: lIdx,
                                toIndex: lIdx + 1,
                                distanceKm: legDistKm,
                                durationMin: legDurMin,
                                distanceMeters: leg.distance || 0,
                                durationSeconds: leg.duration || 0,
                                stepsCount: Array.isArray(leg.steps) ? leg.steps.length : 0,
                                routingSource: "osrm",
                                osrmVerified: true,
                                geometryVerified: true,
                                requiresRevalidation: false
                            };
                        });
                    }
                }
            }
        } catch (err) {
            console.warn("[roadMatrixService] OSRM route geometry query fallback:", err.message);
        }
    }

    // Honest fallback construction if real OSRM road geometry is unavailable
    if (!isRoadVerified) {
        geometry = validPoints.map((p) => [Number(p.latitude), Number(p.longitude)]);
        geometrySource = "estimated_straight_line";
        routingSource = "calibrated_fallback";

        const detourFactor = straightLineKm > 20 ? 1.22 : 1.28;
        distanceKm = Number((straightLineKm * detourFactor).toFixed(2));
        durationMin = Number(((distanceKm / STANDARD_BUS_SPEED_KMH) * 60).toFixed(1));

        legs = [];
        for (let i = 0; i < validPoints.length - 1; i++) {
            const segDist = calculateDistanceKm(
                validPoints[i].latitude, validPoints[i].longitude,
                validPoints[i + 1].latitude, validPoints[i + 1].longitude
            );
            const legDistKm = Number((segDist * detourFactor).toFixed(2));
            const legDurMin = Number(((legDistKm / STANDARD_BUS_SPEED_KMH) * 60).toFixed(1));
            legs.push({
                fromIndex: i,
                toIndex: i + 1,
                distanceKm: legDistKm,
                durationMin: legDurMin,
                distanceMeters: Math.round(legDistKm * 1000),
                durationSeconds: Math.round(legDurMin * 60),
                stepsCount: 1,
                routingSource: "calibrated_fallback",
                osrmVerified: false,
                geometryVerified: false,
                requiresRevalidation: true
            });
        }
    }

    const detourRatio = straightLineKm > 0 ? Number((distanceKm / straightLineKm).toFixed(2)) : 1.0;

    const result = {
        geometry,
        distanceKm,
        durationMin,
        durationSeconds: Math.round(durationMin * 60),
        straightLineBaselineKm: straightLineKm,
        detourRatio,
        legs,
        geometrySource,
        geometryVerified: isRoadVerified,
        routingSource,
        osrmVerified: isRoadVerified,
        requiresRevalidation: !isRoadVerified,
        isRoadVerified,
        provider: isRoadVerified ? "osrm" : "calibrated_fallback"
    };

    geometryCache.set(queryKey, result);
    return result;
};

// ============================================================================
// LOGISTICS OPERATIONAL METRICS CALCULATOR
// ============================================================================

/**
 * Computes real-world logistics operational metrics for a vehicle route:
 * - Dwell time per stop based on passenger volume
 * - Scheduled time-windows (ETAs / ETDs)
 * - Fuel consumption (Liters)
 * - Carbon emissions footprint (kg CO2)
 * - Driver regulation compliance (continuous drive hours)
 */
export const calculateOperationalLogistics = ({
    distanceKm = 0,
    drivingDurationMin = 0,
    stops = [],
    departureTime = "08:00 AM"
}) => {
    let totalDwellMin = 0;
    let totalPassengers = 0;

    const stopSchedules = [];
    let cumulativeElapsedMin = 0;

    stops.forEach((stop, idx) => {
        const paxCount = Number(stop.userCount || (stop.userIds ? stop.userIds.length : 0));
        totalPassengers += paxCount;

        // Dwell time: 1 min base + 4 seconds per passenger
        const stopDwellMin = Number((STOP_BASE_DWELL_MINUTES + (paxCount * (PASSENGER_BOARDING_SECONDS / 60))).toFixed(1));
        totalDwellMin += stopDwellMin;

        const legDriveMin = Number(stop.legDurationMin || 5);
        cumulativeElapsedMin += legDriveMin;
        const etaMinutes = cumulativeElapsedMin;
        cumulativeElapsedMin += stopDwellMin;
        const etdMinutes = cumulativeElapsedMin;

        stopSchedules.push({
            stopIndex: idx + 1,
            stopName: stop.name,
            passengerCount: paxCount,
            dwellMinutes: stopDwellMin,
            cumulativeEtaMinutes: Number(etaMinutes.toFixed(1)),
            cumulativeEtdMinutes: Number(etdMinutes.toFixed(1))
        });
    });

    const totalMissionDurationMin = Number((drivingDurationMin + totalDwellMin).toFixed(1));
    const totalMissionHours = Number((totalMissionDurationMin / 60).toFixed(2));

    // Environmental Footprint
    const fuelConsumptionLiters = Number((distanceKm / DIESEL_BUS_KM_PER_LITER).toFixed(2));
    const carbonEmissionsKg = Number((fuelConsumptionLiters * CO2_KG_PER_LITER_DIESEL).toFixed(2));

    // Commercial Driver Regulation Check
    const driverRegulationCompliant = totalMissionHours <= MAX_CONTINUOUS_DRIVE_HOURS;

    return {
        distanceKm: Number(distanceKm.toFixed(2)),
        drivingDurationMin: Number(drivingDurationMin.toFixed(1)),
        dwellDurationMin: Number(totalDwellMin.toFixed(1)),
        totalMissionDurationMin,
        totalMissionHours,
        totalPassengers,
        fuelConsumptionLiters,
        carbonEmissionsKg,
        driverRegulationCompliant,
        driverRegulationNotes: driverRegulationCompliant
            ? `Mission duration ${totalMissionHours}h is within the ${MAX_CONTINUOUS_DRIVE_HOURS}h commercial driver safety regulation limit.`
            : `WARNING: Mission duration ${totalMissionHours}h exceeds ${MAX_CONTINUOUS_DRIVE_HOURS}h driver duty limit without relief.`,
        stopSchedules,
        departureTime
    };
};

/**
 * Clears all routing and matrix caches (useful for testing).
 */
export const clearRoutingCaches = () => {
    matrixCache.clear();
    segmentCache.clear();
    geometryCache.clear();
};
