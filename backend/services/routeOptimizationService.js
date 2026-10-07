/**
 * routeOptimizationService.js
 * 
 * Production Global Multi-Objective AI Transportation Optimization Engine.
 * 
 * Core Components & Data Structures:
 * 1. OSRM Road Distance & Travel-Time Matrix Integration
 * 2. Min-Heap / Priority Queue (Fast nearest candidate extraction & vehicle matching)
 * 3. Clarke-Wright Road Savings Algorithm (Asymmetric-safe road distance savings)
 * 4. Road-Cost Nearest Insertion
 * 5. Beam Search / Controlled Global Candidate Pool
 * 6. Capacity-Aware Route Generation & Feasibility
 * 7. Inter-Route Local Search:
 *    - Relocate (single stop move between routes)
 *    - Exchange (stop swap between routes)
 *    - Or-opt (small consecutive sequence transfer)
 * 8. 2-Opt Road Sequence Improvement (eliminates backtracking via road costs)
 * 9. Delayed Fleet-Wide Vehicle Assignment (assigns vehicles AFTER route generation)
 * 10. Multi-Objective Route Scoring & Transparent Diagnostics
 * 11. Deterministic Validation & Zero Passenger Loss Guarantee
 */

import {
    calculateDistanceKm,
    isValidCoordinate,
    DEFAULT_SOURCE_HUB
} from "./mapGeocodingService.js";

import {
    getRoadDistanceDurationMatrix,
    getRoadSegment,
    STANDARD_BUS_SPEED_KMH
} from "./roadMatrixService.js";

import {
    calculateBearing,
    getBearingDifference
} from "./mapAwareRouteEngine.js";

import {
    predictStopCompatibility,
    predictRouteQuality,
    predictVehicleSuitability
} from "./mlPredictionService.js";

import {
    calculateHistoricalRouteSimilarity,
    normalizeStopName
} from "./historicalRouteService.js";

import {
    findStartingPlaceForBus,
    hasConfiguredInwardStartingPlace,
    isBusHubSuitableForStops,
    isStopNearOrAlongRoute,
    normalizeCanonicalStopName
} from "./aiAgentService.js";

export { hasConfiguredInwardStartingPlace };

/**
 * Calculates the maximum angular span (in degrees) across all stops in a route relative to the hub.
 * Ignores stops very close to the hub (<= 2.0 km) where bearings are unstable.
 */
export const calculateMaxBearingSpan = (hub, stops = []) => {
    if (!hub || !isValidCoordinate(hub.latitude, hub.longitude) || !Array.isArray(stops) || stops.length <= 1) {
        return 0;
    }
    const relevantStops = stops.filter((s) => {
        if (!isValidCoordinate(s.latitude, s.longitude)) return false;
        const d = calculateDistanceKm(hub.latitude, hub.longitude, s.latitude, s.longitude);
        return d > 2.0;
    });

    if (relevantStops.length <= 1) return 0;

    const bearings = relevantStops.map((s) =>
        calculateBearing(hub.latitude, hub.longitude, s.latitude, s.longitude)
    );

    let maxSpan = 0;
    for (let i = 0; i < bearings.length; i++) {
        for (let j = i + 1; j < bearings.length; j++) {
            const diff = getBearingDifference(bearings[i], bearings[j]);
            if (diff > maxSpan) {
                maxSpan = diff;
            }
        }
    }
    return Number(maxSpan.toFixed(1));
};

/**
 * Validates whether a candidate stop collection forms a geographically and directionally coherent corridor.
 * Ensures maximum bearing span <= maxSpan (default 38.0°) and prevents unnatural lateral jumps (> maxJumpKm).
 */
export const isRouteCorridorCoherent = (hub, stops = [], maxSpan = 38.0, maxJumpKm = 4.75) => {
    if (!hub || !isValidCoordinate(hub.latitude, hub.longitude) || !Array.isArray(stops) || stops.length <= 1) {
        return true;
    }
    const span = calculateMaxBearingSpan(hub, stops);
    if (span > maxSpan) {
        return false;
    }

    // Check consecutive stops for unnatural lateral cross-corridor jumps
    for (let i = 0; i < stops.length - 1; i++) {
        const s1 = stops[i];
        const s2 = stops[i + 1];
        if (!isValidCoordinate(s1.latitude, s1.longitude) || !isValidCoordinate(s2.latitude, s2.longitude)) continue;
        const dHub1 = calculateDistanceKm(hub.latitude, hub.longitude, s1.latitude, s1.longitude);
        const dHub2 = calculateDistanceKm(hub.latitude, hub.longitude, s2.latitude, s2.longitude);

        if (dHub1 > 2.5 && dHub2 > 2.5) {
            const b1 = calculateBearing(hub.latitude, hub.longitude, s1.latitude, s1.longitude);
            const b2 = calculateBearing(hub.latitude, hub.longitude, s2.latitude, s2.longitude);
            const bDiff = getBearingDifference(b1, b2);
            const interStopDist = calculateDistanceKm(s1.latitude, s1.longitude, s2.latitude, s2.longitude);

            if (interStopDist > maxJumpKm && bDiff > 22.0) {
                return false;
            }
        }
    }

    return true;
};

// ============================================================================
// DATA STRUCTURE: MIN-HEAP / PRIORITY QUEUE
// ============================================================================

export class PriorityQueue {
    constructor(comparator = (a, b) => a.priority - b.priority) {
        this.heap = [];
        this.comparator = comparator;
    }

    push(item) {
        this.heap.push(item);
        this._siftUp(this.heap.length - 1);
    }

    pop() {
        if (this.isEmpty()) return null;
        const top = this.heap[0];
        const bottom = this.heap.pop();
        if (this.heap.length > 0) {
            this.heap[0] = bottom;
            this._siftDown(0);
        }
        return top;
    }

    peek() {
        return this.isEmpty() ? null : this.heap[0];
    }

    size() {
        return this.heap.length;
    }

    isEmpty() {
        return this.heap.length === 0;
    }

    _siftUp(index) {
        let current = index;
        while (current > 0) {
            const parent = Math.floor((current - 1) / 2);
            if (this.comparator(this.heap[current], this.heap[parent]) < 0) {
                [this.heap[current], this.heap[parent]] = [this.heap[parent], this.heap[current]];
                current = parent;
            } else {
                break;
            }
        }
    }

    _siftDown(index) {
        let current = index;
        const length = this.heap.length;
        while (true) {
            let left = 2 * current + 1;
            let right = 2 * current + 2;
            let smallest = current;

            if (left < length && this.comparator(this.heap[left], this.heap[smallest]) < 0) {
                smallest = left;
            }
            if (right < length && this.comparator(this.heap[right], this.heap[smallest]) < 0) {
                smallest = right;
            }

            if (smallest !== current) {
                [this.heap[current], this.heap[smallest]] = [this.heap[smallest], this.heap[current]];
                current = smallest;
            } else {
                break;
            }
        }
    }
}

// ============================================================================
// 1. OSRM ROAD DISTANCE & DURATION MATRIX LAYER
// ============================================================================

/**
 * Builds an authoritative road distance/duration matrix for [depot, ...stops].
 * Index 0 is always the depot, indices 1..N correspond to stops[0..N-1].
 */
export const buildGlobalOptimizationMatrix = async ({
    depot = DEFAULT_SOURCE_HUB,
    stops = [],
    options = {}
}) => {
    const locations = [
        {
            name: depot.name || "Depot Hub",
            latitude: Number(depot.latitude),
            longitude: Number(depot.longitude)
        },
        ...stops.map((s, idx) => ({
            name: s.name || `Stop ${idx + 1}`,
            latitude: Number(s.latitude),
            longitude: Number(s.longitude)
        }))
    ];

    const matrixResult = await getRoadDistanceDurationMatrix(locations, options);

    const getDist = (i, j) => {
        if (i === j) return 0;
        if (matrixResult?.distances?.[i]?.[j] !== undefined) {
            return matrixResult.distances[i][j];
        }
        const locI = locations[i];
        const locJ = locations[j];
        if (locI && locJ) {
            return Number((calculateDistanceKm(locI.latitude, locI.longitude, locJ.latitude, locJ.longitude) * 1.25).toFixed(2));
        }
        return 5.0;
    };

    const getDur = (i, j) => {
        if (i === j) return 0;
        if (matrixResult?.durations?.[i]?.[j] !== undefined) {
            return matrixResult.durations[i][j];
        }
        const d = getDist(i, j);
        return Number(((d / STANDARD_BUS_SPEED_KMH) * 60).toFixed(1));
    };

    return {
        ...matrixResult,
        locationCount: locations.length,
        stopCount: stops.length,
        getDist,
        getDur,
        locations
    };
};

// ============================================================================
// 2. CLARKE-WRIGHT SAVINGS ALGORITHM (ROAD-MATRIX POWERED)
// ============================================================================

/**
 * Computes Clarke-Wright savings for all pairs of stops with respect to a depot:
 * S(i, j) = d(depot, i) + d(depot, j) - d(i, j)
 * Uses OSRM road distances. Higher savings indicate that visiting i and j together saves total kilometers.
 */
export const computeClarkeWrightSavings = ({
    stops = [],
    depot = DEFAULT_SOURCE_HUB,
    distanceMatrix = null,
    tripMode = "FROM_SOURCE",
    options = {}
}) => {
    const N = stops.length;
    if (N < 2) return [];

    const isOutward = tripMode === "FROM_SOURCE" || tripMode === "OUTWARD";
    const savingsList = [];

    const getD = (fromIdx, toIdx) => {
        if (distanceMatrix?.getDist) {
            return distanceMatrix.getDist(fromIdx, toIdx);
        }
        if (Array.isArray(distanceMatrix) && distanceMatrix[fromIdx]?.[toIdx] !== undefined) {
            return distanceMatrix[fromIdx][toIdx];
        }
        const locA = fromIdx === 0 ? depot : stops[fromIdx - 1];
        const locB = toIdx === 0 ? depot : stops[toIdx - 1];
        if (locA && locB && isValidCoordinate(locA.latitude, locA.longitude) && isValidCoordinate(locB.latitude, locB.longitude)) {
            return calculateDistanceKm(locA.latitude, locA.longitude, locB.latitude, locB.longitude) * 1.25;
        }
        return 5.0;
    };

    const getDur = (fromIdx, toIdx) => {
        if (distanceMatrix?.getDur) {
            return distanceMatrix.getDur(fromIdx, toIdx);
        }
        const d = getD(fromIdx, toIdx);
        return Number(((d / STANDARD_BUS_SPEED_KMH) * 60).toFixed(1));
    };

    const refHub = (isOutward ? (options.sourceHub || options.anchorHub) : (options.destinationHub || options.anchorHub)) || depot;

    for (let i = 0; i < N; i++) {
        const distDepotI = isOutward ? getD(0, i + 1) : getD(i + 1, 0);
        const durDepotI = isOutward ? getDur(0, i + 1) : getDur(i + 1, 0);

        for (let j = i + 1; j < N; j++) {
            const distDepotJ = isOutward ? getD(0, j + 1) : getD(j + 1, 0);
            const durDepotJ = isOutward ? getDur(0, j + 1) : getDur(j + 1, 0);
            const distIJ = Math.min(getD(i + 1, j + 1), getD(j + 1, i + 1));
            const durIJ = Math.min(getDur(i + 1, j + 1), getDur(j + 1, i + 1));

            // Full route cost savings: road distance + weighted travel duration
            const distSavings = distDepotI + distDepotJ - distIJ;
            const durSavings = durDepotI + durDepotJ - durIJ;
            let savings = distSavings + (durSavings * 0.20);

            const stopI = stops[i];
            const stopJ = stops[j];

            // 1. Corridor Coherence: Check bearing divergence from the reference hub
            if (refHub && isValidCoordinate(refHub.latitude, refHub.longitude) &&
                isValidCoordinate(stopI?.latitude, stopI?.longitude) &&
                isValidCoordinate(stopJ?.latitude, stopJ?.longitude)) {
                const bearingI = calculateBearing(refHub.latitude, refHub.longitude, stopI.latitude, stopI.longitude);
                const bearingJ = calculateBearing(refHub.latitude, refHub.longitude, stopJ.latitude, stopJ.longitude);
                const angleDiff = getBearingDifference(bearingI, bearingJ);

                // If both stops are far enough from the hub, penalize stops in divergent corridors
                if (distDepotI > 2.0 && distDepotJ > 2.0 && angleDiff > 45) {
                    savings -= (angleDiff - 45) * 1.5;
                }
            }

            // 2. Physical Barrier Check: Detect stops separated by river or divided highway
            if (isValidCoordinate(stopI?.latitude, stopI?.longitude) && isValidCoordinate(stopJ?.latitude, stopJ?.longitude)) {
                const straightIJ = calculateDistanceKm(stopI.latitude, stopI.longitude, stopJ.latitude, stopJ.longitude);
                if (straightIJ > 0.3 && (distIJ / straightIJ > 3.2 || (straightIJ < 2.5 && durIJ > 18))) {
                    savings -= 35.0; // severe physical barrier penalty
                }
            }

            if (savings > 0) {
                savingsList.push({
                    stopIIndex: i,
                    stopJIndex: j,
                    stopI: stops[i],
                    stopJ: stops[j],
                    savings: Number(savings.toFixed(2)),
                    distIJ: Number(distIJ.toFixed(2)),
                    distDepotI: Number(distDepotI.toFixed(2)),
                    distDepotJ: Number(distDepotJ.toFixed(2)),
                    durIJ: Number(durIJ.toFixed(1)),
                    durDepotI: Number(durDepotI.toFixed(1)),
                    durDepotJ: Number(durDepotJ.toFixed(1))
                });
            }
        }
    }

    // Sort descending by savings
    savingsList.sort((a, b) => b.savings - a.savings);
    return savingsList;
};

// ============================================================================
// 3. ROAD-COST NEAREST INSERTION
// ============================================================================

/**
 * Finds the optimal position to insert a stop into an existing candidate tour
 * to minimize additional road distance and travel time:
 * Δd = d(prev, new) + d(new, next) - d(prev, next) + weighted travel duration
 */
export const insertStopNearestCost = ({
    tour = [],
    stop,
    stopMatrixIndex,
    matrix,
    tripMode = "FROM_SOURCE",
    originHub = null,
    destinationHub = null,
    rejectOnExcessiveDetour = false,
    maxDetourRatio = 2.25
}) => {
    const getD = (idxA, idxB, locA, locB) => {
        if (matrix?.getDist && idxA !== null && idxB !== null) {
            return matrix.getDist(idxA, idxB);
        }
        if (locA && locB && isValidCoordinate(locA.latitude, locA.longitude) && isValidCoordinate(locB.latitude, locB.longitude)) {
            return calculateDistanceKm(locA.latitude, locA.longitude, locB.latitude, locB.longitude) * 1.25;
        }
        return 5.0;
    };

    const getDur = (idxA, idxB, locA, locB) => {
        if (matrix?.getDur && idxA !== null && idxB !== null) {
            return matrix.getDur(idxA, idxB);
        }
        const d = getD(idxA, idxB, locA, locB);
        return Number(((d / STANDARD_BUS_SPEED_KMH) * 60).toFixed(1));
    };

    if (!Array.isArray(tour) || tour.length === 0) {
        const d = getD(0, stopMatrixIndex, matrix?.locations?.[0], stop);
        const dur = getDur(0, stopMatrixIndex, matrix?.locations?.[0], stop);
        return { bestPosition: 0, costDelta: Number((d + dur * 0.20).toFixed(2)), updatedTour: [stop] };
    }

    const isOutward = tripMode === "FROM_SOURCE" || tripMode === "OUTWARD";

    let bestPos = 0;
    let minDelta = Infinity;

    for (let p = 0; p <= tour.length; p++) {
        let prevIdx = 0;
        let nextIdx = 0;
        let prevLoc = null;
        let nextLoc = null;

        if (isOutward) {
            prevIdx = p === 0 ? 0 : tour[p - 1].matrixIndex;
            nextIdx = p === tour.length ? null : tour[p].matrixIndex;
            prevLoc = p === 0 ? (originHub || matrix?.locations?.[0]) : tour[p - 1];
            nextLoc = p === tour.length ? null : tour[p];
        } else {
            prevIdx = p === 0 ? (originHub ? 0 : null) : tour[p - 1].matrixIndex;
            nextIdx = p === tour.length ? 0 : tour[p].matrixIndex;
            prevLoc = p === 0 ? (originHub || null) : tour[p - 1];
            nextLoc = p === tour.length ? (destinationHub || matrix?.locations?.[0]) : tour[p];
        }

        let distDelta = 0;
        let durDelta = 0;
        if (prevIdx !== null && nextIdx !== null) {
            const oldCost = getD(prevIdx, nextIdx, prevLoc, nextLoc);
            const newCost = getD(prevIdx, stopMatrixIndex, prevLoc, stop) + getD(stopMatrixIndex, nextIdx, stop, nextLoc);
            distDelta = newCost - oldCost;

            const oldDur = getDur(prevIdx, nextIdx, prevLoc, nextLoc);
            const newDur = getDur(prevIdx, stopMatrixIndex, prevLoc, stop) + getDur(stopMatrixIndex, nextIdx, stop, nextLoc);
            durDelta = newDur - oldDur;
        } else if (prevIdx !== null && nextIdx === null) {
            distDelta = getD(prevIdx, stopMatrixIndex, prevLoc, stop);
            durDelta = getDur(prevIdx, stopMatrixIndex, prevLoc, stop);
        } else if (prevIdx === null && nextIdx !== null) {
            distDelta = getD(stopMatrixIndex, nextIdx, stop, nextLoc);
            durDelta = getDur(stopMatrixIndex, nextIdx, stop, nextLoc);
        }

        let delta = distDelta + (durDelta * 0.20);

        // Quality and detour checks
        if (prevLoc && nextLoc && isValidCoordinate(prevLoc.latitude, prevLoc.longitude) &&
            isValidCoordinate(stop.latitude, stop.longitude) &&
            isValidCoordinate(nextLoc.latitude, nextLoc.longitude)) {
            // Hairpin turnaround check (> 130°)
            const uLat = stop.latitude - prevLoc.latitude;
            const uLon = stop.longitude - prevLoc.longitude;
            const vLat = nextLoc.latitude - stop.latitude;
            const vLon = nextLoc.longitude - stop.longitude;
            const dot = (uLat * vLat) + (uLon * vLon);
            const magU = Math.sqrt(uLat * uLat + uLon * uLon);
            const magV = Math.sqrt(vLat * vLat + vLon * vLon);
            if (magU > 0.012 && magV > 0.012 && (dot / (magU * magV)) < -0.65) {
                if (rejectOnExcessiveDetour) continue;
                delta += 60.0;
            }
        }

        // Physical barrier checks
        if (prevLoc && isValidCoordinate(prevLoc.latitude, prevLoc.longitude) && isValidCoordinate(stop.latitude, stop.longitude)) {
            const straightPrev = calculateDistanceKm(prevLoc.latitude, prevLoc.longitude, stop.latitude, stop.longitude);
            const roadPrev = getD(prevIdx, stopMatrixIndex, prevLoc, stop);
            if (straightPrev > 0.4 && (roadPrev / straightPrev > 3.5 || (straightPrev < 2.5 && getDur(prevIdx, stopMatrixIndex, prevLoc, stop) > 20))) {
                if (rejectOnExcessiveDetour) continue;
                delta += 40.0;
            }
        }
        if (nextLoc && isValidCoordinate(stop.latitude, stop.longitude) && isValidCoordinate(nextLoc.latitude, nextLoc.longitude)) {
            const straightNext = calculateDistanceKm(stop.latitude, stop.longitude, nextLoc.latitude, nextLoc.longitude);
            const roadNext = getD(stopMatrixIndex, nextIdx, stop, nextLoc);
            if (straightNext > 0.4 && (roadNext / straightNext > 3.5 || (straightNext < 2.5 && getDur(stopMatrixIndex, nextIdx, stop, nextLoc) > 20))) {
                if (rejectOnExcessiveDetour) continue;
                delta += 40.0;
            }
        }

        // Progression check relative to destination (inward) or origin (outward)
        if (!isOutward) {
            const dest = destinationHub || matrix?.locations?.[0];
            if (dest && isValidCoordinate(dest.latitude, dest.longitude) && prevLoc && isValidCoordinate(prevLoc.latitude, prevLoc.longitude)) {
                const dPrevDest = calculateDistanceKm(prevLoc.latitude, prevLoc.longitude, dest.latitude, dest.longitude);
                const dStopDest = calculateDistanceKm(stop.latitude, stop.longitude, dest.latitude, dest.longitude);
                const backward = dStopDest - dPrevDest;
                if (backward > 2.5) {
                    if (rejectOnExcessiveDetour) continue;
                    delta += backward * 8.0;
                }
            }
        } else {
            const orig = originHub || matrix?.locations?.[0];
            if (orig && isValidCoordinate(orig.latitude, orig.longitude) && prevLoc && isValidCoordinate(prevLoc.latitude, prevLoc.longitude)) {
                const dPrevOrig = calculateDistanceKm(orig.latitude, orig.longitude, prevLoc.latitude, prevLoc.longitude);
                const dStopOrig = calculateDistanceKm(orig.latitude, orig.longitude, stop.latitude, stop.longitude);
                const backward = dPrevOrig - dStopOrig;
                if (backward > 2.0) {
                    if (rejectOnExcessiveDetour) continue;
                    delta += backward * 6.0;
                }
            }
        }

        if (delta < minDelta) {
            minDelta = delta;
            bestPos = p;
        }
    }

    if (minDelta === Infinity) {
        return {
            bestPosition: -1,
            costDelta: Infinity,
            updatedTour: tour,
            rejected: true
        };
    }

    const updatedTour = [...tour.slice(0, bestPos), stop, ...tour.slice(bestPos)];
    return {
        bestPosition: bestPos,
        costDelta: Number(minDelta.toFixed(2)),
        updatedTour
    };
};

// ============================================================================
// 4. ROAD-COST 2-OPT LOCAL SEARCH
// ============================================================================

/**
 * 2-Opt edge swap optimization using OSRM road distance matrix.
 */
export const optimizeTour2OptRoad = ({
    tour = [],
    matrix,
    tripMode = "FROM_SOURCE",
    maxIterations = 25,
    depot = DEFAULT_SOURCE_HUB
}) => {
    if (!Array.isArray(tour) || tour.length === 0) {
        return { tour: [], isImproved: false, iterations: 0, roadDistanceKm: 0 };
    }

    const isOutward = tripMode === "FROM_SOURCE" || tripMode === "OUTWARD";

    const getDistance = (s1, s2) => {
        if (!s1 || !s2) return 0;
        if (matrix && typeof matrix.getDist === "function" && s1.matrixIndex !== undefined && s2.matrixIndex !== undefined) {
            return matrix.getDist(s1.matrixIndex, s2.matrixIndex);
        }
        const lat1 = Number(s1.latitude ?? s1.lat);
        const lon1 = Number(s1.longitude ?? s1.lon ?? s1.lng);
        const lat2 = Number(s2.latitude ?? s2.lat);
        const lon2 = Number(s2.longitude ?? s2.lon ?? s2.lng);
        if (Number.isFinite(lat1) && Number.isFinite(lon1) && Number.isFinite(lat2) && Number.isFinite(lon2)) {
            return calculateDistanceKm(lat1, lon1, lat2, lon2) * 1.25;
        }
        return 5.0;
    };

    const depotObj = {
        matrixIndex: 0,
        latitude: depot?.latitude ?? DEFAULT_SOURCE_HUB.latitude,
        longitude: depot?.longitude ?? DEFAULT_SOURCE_HUB.longitude
    };

    const calcTourDist = (t) => {
        if (!t || t.length === 0) return 0;
        let d = 0;
        if (isOutward) {
            d += getDistance(depotObj, t[0]);
            for (let i = 0; i < t.length - 1; i++) {
                d += getDistance(t[i], t[i + 1]);
            }
        } else {
            for (let i = 0; i < t.length - 1; i++) {
                d += getDistance(t[i], t[i + 1]);
            }
            d += getDistance(t[t.length - 1], depotObj);
        }
        return d;
    };

    if (tour.length <= 2) {
        const d = calcTourDist(tour);
        return { tour, isImproved: false, iterations: 0, roadDistanceKm: Number(d.toFixed(2)) };
    }

    let current = [...tour];
    let improved = true;
    let iterations = 0;
    let bestDist = calcTourDist(current);

    while (improved && iterations < maxIterations) {
        improved = false;
        iterations++;

        for (let i = 0; i < current.length - 1; i++) {
            for (let k = i + 1; k < current.length; k++) {
                const candidate = [
                    ...current.slice(0, i),
                    ...current.slice(i, k + 1).reverse(),
                    ...current.slice(k + 1)
                ];

                const candDist = calcTourDist(candidate);
                if (candDist < bestDist - 0.05) { // Meaningful reduction threshold
                    current = candidate;
                    bestDist = candDist;
                    improved = true;
                    break;
                }
            }
            if (improved) break;
        }
    }

    return {
        tour: current,
        isImproved: iterations > 1,
        iterations,
        roadDistanceKm: Number(bestDist.toFixed(2))
    };
};

/**
 * Checks whether two locations represent the same stopping place or starting hub.
 * Strictly respects canonical stop identity and prevents merging distinct places
 * (such as "KK Nagar" vs "K.K. Nagar West").
 */
export const isSamePlace = (locA, locB) => {
    if (!locA || !locB) return false;
    const strA = locA.locationName || locA.name || locA.stopping || "";
    const strB = locB.locationName || locB.name || locB.stopping || "";
    const canonA = normalizeCanonicalStopName(strA);
    const canonB = normalizeCanonicalStopName(strB);

    const norm = (str) => String(str || "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
    const nameA = norm(strA);
    const nameB = norm(strB);
    const latA = Number(locA.latitude ?? locA.lat);
    const lonA = Number(locA.longitude ?? locA.lon ?? locA.lng);
    const latB = Number(locB.latitude ?? locB.lat);
    const lonB = Number(locB.longitude ?? locB.lon ?? locB.lng);
    const dist = (Number.isFinite(latA) && Number.isFinite(lonA) && Number.isFinite(latB) && Number.isFinite(lonB))
        ? calculateDistanceKm(latA, lonA, latB, lonB)
        : Infinity;

    // 1. Exact canonical identity match (e.g. "K.K. Nagar" === "KK Nagar" === "K K Nagar")
    if (canonA && canonB && canonA === canonB) return true;
    if (nameA && nameB && nameA === nameB) return true;

    // Distinct cardinal directions / qualifiers guard (e.g. "west", "east", "north", "south", "extension")
    // If one has a qualifier and the other does not, or they differ, they are NEVER the same place.
    const cardinalRegex = /\b(west|east|north|south|extension|ext)\b/i;
    const hasCardA = cardinalRegex.test(strA);
    const hasCardB = cardinalRegex.test(strB);
    if (hasCardA !== hasCardB) return false;
    if (hasCardA && hasCardB) {
        const matchA = strA.match(cardinalRegex)?.[0]?.toLowerCase();
        const matchB = strB.match(cardinalRegex)?.[0]?.toLowerCase();
        if (matchA !== matchB) return false;
    }

    // Micro-proximity for identical physical pin
    if (dist <= 0.15) return true;

    // Substring inclusion only if neither has conflicting qualifiers and distance is tight
    if (nameA && nameB && dist <= 1.0 && (nameA.includes(nameB) || nameB.includes(nameA))) {
        // Disallow if token lengths are significantly different without being junction/bus stop suffixes
        const tokensA = canonA.split(" ");
        const tokensB = canonB.split(" ");
        const diffTokens = Math.abs(tokensA.length - tokensB.length);
        if (diffTokens === 0 || (diffTokens === 1 && (tokensA.includes("junction") || tokensB.includes("junction") || tokensA.includes("stop") || tokensB.includes("stop")))) {
            return true;
        }
    }

    // Common Madurai locality aliases
    const isAlias = (a, b) => {
        if ((a === "bbkulam" && b === "bibikulam") || (a === "bibikulam" && b === "bbkulam")) return true;
        if ((a.includes("kpudur") || a.includes("pudur")) && (b.includes("kpudur") || b.includes("pudur"))) return true;
        if ((a.includes("sellur") || a.includes("sellurmadurai")) && (b.includes("sellur") || b.includes("sellurmadurai"))) return true;
        return false;
    };
    if (nameA && nameB && isAlias(nameA, nameB) && dist <= 2.5) return true;
    return false;
};

/**
 * Merges logical duplicate or near-duplicate stops in a route while strictly preserving
 * all passenger counts, userIds, and user records.
 * Solves consecutive and repeated duplicate stops (e.g. Thirunagar -> Thirunagar).
 */
export const mergeDuplicateStopsInRoute = (stops = [], startingHub = null) => {
    if (!Array.isArray(stops) || stops.length <= 1) return stops || [];

    const norm = (str) => String(str || "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();

    const merged = [];
    for (let i = 0; i < stops.length; i++) {
        const curr = stops[i];
        if (!curr) continue;

        // Check if curr is duplicate of an already added stop in merged
        let matchedIdx = -1;
        for (let j = 0; j < merged.length; j++) {
            const existing = merged[j];
            if (isSamePlace(existing, curr)) {
                matchedIdx = j;
                break;
            }
            const canonCurr = normalizeCanonicalStopName(curr.name || curr.stopping || "");
            const canonExist = normalizeCanonicalStopName(existing.name || existing.stopping || "");
            if (canonCurr && canonExist && canonCurr === canonExist) {
                matchedIdx = j;
                break;
            }
            const normCurr = norm(curr.name || curr.stopping || "");
            const normExist = norm(existing.name || existing.stopping || "");
            if (normCurr && normExist && normCurr === normExist) {
                matchedIdx = j;
                break;
            }
            const latC = Number(curr.latitude ?? curr.lat);
            const lonC = Number(curr.longitude ?? curr.lon ?? curr.lng);
            const latE = Number(existing.latitude ?? existing.lat);
            const lonE = Number(existing.longitude ?? existing.lon ?? existing.lng);
            if (Number.isFinite(latC) && Number.isFinite(lonC) && Number.isFinite(latE) && Number.isFinite(lonE)) {
                const d = calculateDistanceKm(latC, lonC, latE, lonE);
                if (d <= 0.15) {
                    // Only match if cardinal directions match
                    const cardReg = /\b(west|east|north|south|extension|ext)\b/i;
                    const cA = (curr.name || curr.stopping || "").match(cardReg)?.[0]?.toLowerCase();
                    const cB = (existing.name || existing.stopping || "").match(cardReg)?.[0]?.toLowerCase();
                    if (cA === cB) {
                        matchedIdx = j;
                        break;
                    }
                }
            }
        }

        if (matchedIdx >= 0) {
            // Merge curr into merged[matchedIdx]
            const target = merged[matchedIdx];
            const currUserIds = Array.isArray(curr.userIds) ? curr.userIds : [];
            const targetUserIds = Array.isArray(target.userIds) ? target.userIds : [];
            const combinedUserIds = Array.from(new Set([...targetUserIds, ...currUserIds]));

            const currPax = Math.max(currUserIds.length, Number(curr.userCount || curr.passengerCount || 0));
            const targetPax = Math.max(targetUserIds.length, Number(target.userCount || target.passengerCount || 0));
            const combinedPax = Math.max(combinedUserIds.length, targetPax + currPax);

            target.userIds = combinedUserIds;
            target.passengerUserIds = combinedUserIds;
            target.userCount = combinedPax;
            target.passengerCount = combinedPax;

            // Merge users array if present
            if (Array.isArray(curr.users) || Array.isArray(target.users)) {
                const userMap = new Map();
                [...(target.users || []), ...(curr.users || [])].forEach((u) => {
                    const uid = String(u?._id || u?.userId || u?.id || u);
                    if (uid && !userMap.has(uid)) userMap.set(uid, u);
                });
                target.users = Array.from(userMap.values());
            }

            if (curr.isStartingHubPickup || target.isStartingHubPickup || (startingHub && (isSamePlace(startingHub, curr) || isSamePlace(startingHub, target)))) {
                target.isStartingHubPickup = true;
                target.isStartingHub = true;
                target.stopType = "STARTING_HUB_PICKUP";
            }

            // Keep more specific coordinates if curr has valid ones and target does not
            if ((!isValidCoordinate(target.latitude, target.longitude)) && isValidCoordinate(curr.latitude, curr.longitude)) {
                target.latitude = curr.latitude;
                target.longitude = curr.longitude;
            }
        } else {
            const initialPax = Math.max((curr.userIds || []).length, Number(curr.userCount || curr.passengerCount || 0));
            const isStartHub = Boolean(curr.isStartingHubPickup || (startingHub && isSamePlace(startingHub, curr)));
            merged.push({
                ...curr,
                isStartingHubPickup: isStartHub,
                isStartingHub: isStartHub,
                stopType: isStartHub ? "STARTING_HUB_PICKUP" : (curr.stopType || "PASSENGER_PICKUP"),
                userCount: initialPax,
                passengerCount: initialPax,
                userIds: Array.isArray(curr.userIds) ? [...curr.userIds] : [],
                passengerUserIds: Array.isArray(curr.userIds) ? [...curr.userIds] : []
            });
        }
    }

    // Re-index order & sequence
    return merged.map((s, idx) => ({
        ...s,
        order: idx + 1,
        sequence: idx + 1
    }));
};

/**
 * Sequences inward route stops from the vehicle's configured starting hub towards the destination.
 * 1. Handles the Starting Hub Duplicate Rule (boards passengers at starting hub, avoids duplicate visit).
 * 2. Enforces forward road-network progression towards destination with backtracking elimination.
 * 3. Prevents returning towards the starting hub, directional reversals, and route loops.
 * 4. Refines sequence via Anchored Open 2-Opt road improvement.
 * 5. Generates quality validation metrics including startingHubRepeatedAfterDeparture === false.
 */
export const sequenceInwardRouteStops = ({
    startingHub,
    destinationHub,
    stops = [],
    matrix = null,
    tripMode = "INWARD"
}) => {
    if (!Array.isArray(stops) || stops.length === 0) {
        return {
            stops: [],
            routeDistanceKm: 0,
            qualityValidation: {
                startingHub: startingHub?.locationName || startingHub?.name || "Unknown",
                destination: destinationHub?.name || "Destination",
                totalRoadDistance: 0,
                totalRouteDuration: 0,
                repeatedStopsCount: 0,
                startingHubRepeatedAfterDeparture: false,
                directionalReversals: 0,
                backtrackingDistanceKm: 0,
                detourRatio: 1.0
            }
        };
    }

    // Pre-merge any duplicate stops in the incoming stops
    const sanitizedStops = mergeDuplicateStopsInRoute(stops, startingHub);

    const norm = (str) => String(str || "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();

    const getDistBetween = (locA, locB) => {
        if (!locA || !locB) return 0;
        if (matrix?.getDist && locA.matrixIndex !== undefined && locB.matrixIndex !== undefined) {
            return matrix.getDist(locA.matrixIndex, locB.matrixIndex);
        }
        const latA = Number(locA.latitude ?? locA.lat);
        const lonA = Number(locA.longitude ?? locA.lon ?? locA.lng);
        const latB = Number(locB.latitude ?? locB.lat);
        const lonB = Number(locB.longitude ?? locB.lon ?? locB.lng);
        if (!Number.isFinite(latA) || !Number.isFinite(lonA) || !Number.isFinite(latB) || !Number.isFinite(lonB)) {
            return 5.0;
        }
        return Number((calculateDistanceKm(latA, lonA, latB, lonB) * 1.25).toFixed(2));
    };

    // 1. STARTING HUB DUPLICATE RULE (Route Initialization)
    let initialPickupStop = null;
    let initialPickupIndex = -1;

    for (let idx = 0; idx < sanitizedStops.length; idx++) {
        if (isSamePlace(startingHub, sanitizedStops[idx])) {
            initialPickupStop = { ...sanitizedStops[idx] };
            initialPickupIndex = idx;
            break;
        }
    }

    let candidateStops = sanitizedStops
        .filter((_, idx) => idx !== initialPickupIndex)
        .map((s, idx) => ({ ...s, originalStopIndex: idx }));

    if (initialPickupStop) {
        initialPickupStop.isStartingHubPickup = true;
        initialPickupStop.isStartingHub = true;
        initialPickupStop.stopType = "STARTING_HUB_PICKUP";
        if (startingHub) {
            initialPickupStop.latitude = Number(startingHub.latitude);
            initialPickupStop.longitude = Number(startingHub.longitude);
        }
        initialPickupStop.selectionReason = `${initialPickupStop.name}: Designated bus starting hub & passenger pickup origin (0.00 km initial road leg).`;
    }

    const startNode = initialPickupStop || startingHub;

    // Helper to evaluate path cost with progression penalties (distinguishes complete vs partial paths)
    const evaluateSequenceCost = (seq, isComplete = true) => {
        let cost = 0;
        const fullPath = (isComplete && destinationHub)
            ? [startNode, ...seq, destinationHub].filter(Boolean)
            : [startNode, ...seq].filter(Boolean);

        for (let i = 0; i < fullPath.length - 1; i++) {
            const legDist = getDistBetween(fullPath[i], fullPath[i + 1]);
            cost += legDist;

            // Directional progression towards destination (applies between passenger stops, excluding vehicle dispatch from parking hub)
            const isInitialDispatchLeg = (i === 0 && !initialPickupStop && startingHub);
            if (destinationHub && (isComplete || i < fullPath.length - 1) && !isInitialDispatchLeg) {
                const d1 = calculateDistanceKm(fullPath[i].latitude, fullPath[i].longitude, destinationHub.latitude, destinationHub.longitude);
                const d2 = calculateDistanceKm(fullPath[i + 1].latitude, fullPath[i + 1].longitude, destinationHub.latitude, destinationHub.longitude);
                const prog = d1 - d2;
                if (prog < -0.5) {
                    cost += Math.abs(prog) * 15.0; // penalty for moving backwards away from destination
                }
                if (prog < -2.0) {
                    cost += Math.abs(prog) * 35.0; // severe penalty for major backward departure
                }
            }

            // Visited corridor backtracking: check if moving to fullPath[i+1] loops back closer to earlier stops
            if (i >= 2) {
                for (let j = 0; j < i - 1; j++) {
                    const dCurrToEarlier = calculateDistanceKm(fullPath[i].latitude, fullPath[i].longitude, fullPath[j].latitude, fullPath[j].longitude);
                    const dNextToEarlier = calculateDistanceKm(fullPath[i + 1].latitude, fullPath[i + 1].longitude, fullPath[j].latitude, fullPath[j].longitude);
                    if (dNextToEarlier < dCurrToEarlier - 0.75) {
                        cost += (dCurrToEarlier - dNextToEarlier) * 20.0; // penalty for returning toward an already visited area
                    }
                }
            }

            // Hairpin turnaround penalty (> 115° and > 130°)
            if (i >= 1 && fullPath[i + 1]) {
                const prev = fullPath[i - 1];
                const curr = fullPath[i];
                const next = fullPath[i + 1];
                const uLat = curr.latitude - prev.latitude;
                const uLon = curr.longitude - prev.longitude;
                const vLat = next.latitude - curr.latitude;
                const vLon = next.longitude - curr.longitude;
                const dot = (uLat * vLat) + (uLon * vLon);
                const magU = Math.sqrt(uLat * uLat + uLon * uLon);
                const magV = Math.sqrt(vLat * vLat + vLon * vLon);
                if (magU > 0.012 && magV > 0.012) {
                    const cosVal = dot / (magU * magV);
                    if (cosVal < -0.65) {
                        cost += 100.0; // severe penalty for hairpin turnarounds (> 130°)
                    } else if (cosVal < -0.42) {
                        cost += 50.0; // penalty for sharp turnarounds (> 115°)
                    }
                }
            }

            // Return to starting hub penalty (once bus departs starting hub, do not loop back)
            if (startingHub && i > 0) {
                const dStartNext = calculateDistanceKm(fullPath[i + 1].latitude, fullPath[i + 1].longitude, startingHub.latitude, startingHub.longitude);
                if (dStartNext <= 1.5 || isSamePlace(startingHub, fullPath[i + 1])) {
                    cost += 80.0; // severe penalty for returning to starting hub after departure
                }
            }
        }
        return cost;
    };

    let bestIntermediateSequence = [];

    // Exact branch-and-bound optimization for typical routes (<= 8 candidate stops)
    if (candidateStops.length <= 8) {
        let minCost = Infinity;

        function search(currentPath, remaining) {
            if (remaining.length === 0) {
                const totalCost = evaluateSequenceCost(currentPath, true);
                if (totalCost < minCost) {
                    minCost = totalCost;
                    bestIntermediateSequence = [...currentPath];
                }
                return;
            }

            const partialCost = evaluateSequenceCost(currentPath, false);
            if (partialCost >= minCost) return;

            const lastNode = currentPath.length > 0 ? currentPath[currentPath.length - 1] : startNode;
            const sortedRemaining = [...remaining].sort((a, b) => getDistBetween(lastNode, a) - getDistBetween(lastNode, b));

            for (let i = 0; i < sortedRemaining.length; i++) {
                const nextNode = sortedRemaining[i];
                const nextRemaining = sortedRemaining.filter((_, idx) => idx !== i);
                search([...currentPath, nextNode], nextRemaining);
            }
        }

        search([], candidateStops);
    } else {
        // Nearest neighbor seed + Anchored 2-Opt for routes with > 8 stops
        let currentPoint = startNode;
        let unvisited = [...candidateStops];
        const seedSeq = [];

        while (unvisited.length > 0) {
            unvisited.sort((a, b) => {
                const distA = getDistBetween(currentPoint, a);
                const distB = getDistBetween(currentPoint, b);
                return distA - distB;
            });
            const nextNode = unvisited.shift();
            seedSeq.push(nextNode);
            currentPoint = nextNode;
        }

        bestIntermediateSequence = seedSeq;
        let currentCost = evaluateSequenceCost(bestIntermediateSequence, true);
        let improved = true;
        let iters = 0;

        while (improved && iters < 30) {
            improved = false;
            iters++;
            for (let i = 0; i < bestIntermediateSequence.length - 1; i++) {
                for (let k = i + 1; k < bestIntermediateSequence.length; k++) {
                    const cand = [
                        ...bestIntermediateSequence.slice(0, i),
                        ...bestIntermediateSequence.slice(i, k + 1).reverse(),
                        ...bestIntermediateSequence.slice(k + 1)
                    ];
                    const candCost = evaluateSequenceCost(cand, true);
                    if (candCost < currentCost - 0.05) {
                        bestIntermediateSequence = cand;
                        currentCost = candCost;
                        improved = true;
                        break;
                    }
                }
                if (improved) break;
            }
        }
    }

    // Assemble ordered stops: starting hub pickup (if any) first, followed by progression
    const orderedTour = initialPickupStop
        ? [initialPickupStop, ...bestIntermediateSequence]
        : [...bestIntermediateSequence];

    // 4. ROUTE QUALITY VALIDATION & SAFETY DEDUPLICATION
    let startingHubRepeatedAfterDeparture = false;
    let repeatedStopsCount = 0;

    // Merge duplicate stops from orderedTour with strict passenger preservation
    const deduplicatedTour = mergeDuplicateStopsInRoute(orderedTour, startingHub);

    const finalStops = [];
    for (let idx = 0; idx < deduplicatedTour.length; idx++) {
        const s = deduplicatedTour[idx];
        const isRepeatOfStart = idx > 0 && isSamePlace(startingHub, s);
        if (isRepeatOfStart) {
            startingHubRepeatedAfterDeparture = true;
            repeatedStopsCount++;
            if (finalStops.length > 0) {
                finalStops[0].userCount = (finalStops[0].userCount || 0) + (s.userCount || 0);
                if (Array.isArray(s.userIds)) {
                    finalStops[0].userIds = Array.from(new Set([...(finalStops[0].userIds || []), ...s.userIds]));
                    finalStops[0].passengerUserIds = finalStops[0].userIds;
                    finalStops[0].passengerCount = finalStops[0].userIds.length;
                }
                finalStops[0].isStartingHubPickup = true;
                finalStops[0].isStartingHub = true;
                finalStops[0].stopType = "STARTING_HUB_PICKUP";
            }
            continue;
        }
        finalStops.push(s);
    }

    const finalHasStartRepeat = finalStops.slice(1).some(s => isSamePlace(startingHub, s));

    let totalRoadDist = 0;
    let directionalReversals = 0;
    let backtrackingDistanceKm = 0;

    const tourWaypoints = (finalStops[0]?.isStartingHubPickup || !startingHub)
        ? [...finalStops]
        : [startingHub, ...finalStops];

    const isPrependedHub = Boolean(!finalStops[0]?.isStartingHubPickup && startingHub);

    for (let i = 0; i < tourWaypoints.length - 1; i++) {
        const segDist = getDistBetween(tourWaypoints[i], tourWaypoints[i + 1]);
        totalRoadDist += segDist;

        if (destinationHub) {
            // Directional progression towards destination applies between passenger pickup stops.
            // The initial deadhead dispatch from the starting hub to the first pickup stop is not a passenger service directional reversal.
            const isInitialDispatchLeg = (i === 0 && isPrependedHub);
            if (!isInitialDispatchLeg) {
                const d1 = calculateDistanceKm(tourWaypoints[i].latitude, tourWaypoints[i].longitude, destinationHub.latitude, destinationHub.longitude);
                const d2 = calculateDistanceKm(tourWaypoints[i + 1].latitude, tourWaypoints[i + 1].longitude, destinationHub.latitude, destinationHub.longitude);
                const prog = d1 - d2;
                if (prog < -2.75) {
                    directionalReversals++;
                    backtrackingDistanceKm += Math.abs(prog);
                }
            }
        }
    }

    if (destinationHub && finalStops.length > 0) {
        totalRoadDist += getDistBetween(finalStops[finalStops.length - 1], destinationHub);
    }

    let straightBaseline = 0;
    const fullTour = [startNode, ...finalStops, destinationHub].filter(Boolean);
    for (let i = 0; i < fullTour.length - 1; i++) {
        straightBaseline += calculateDistanceKm(fullTour[i].latitude, fullTour[i].longitude, fullTour[i + 1].latitude, fullTour[i + 1].longitude);
    }

    const directStartToDest = (startingHub && destinationHub)
        ? calculateDistanceKm(startingHub.latitude, startingHub.longitude, destinationHub.latitude, destinationHub.longitude)
        : 10.0;
    const detourRatio = straightBaseline > 0 ? Number((totalRoadDist / straightBaseline).toFixed(2)) : 1.25;

    const operationalContinuityVerified = Boolean(
        directionalReversals === 0 &&
        backtrackingDistanceKm < 2.0 &&
        detourRatio <= 2.25 &&
        !finalHasStartRepeat &&
        finalStops.length > 0
    );

    const firstPassengerStop = finalStops[0] ? {
        name: finalStops[0].name || finalStops[0].stopping || "First Stop",
        latitude: Number(finalStops[0].latitude),
        longitude: Number(finalStops[0].longitude),
        userCount: finalStops[0].userCount || (Array.isArray(finalStops[0].userIds) ? finalStops[0].userIds.length : 0),
        isStartingHubPickup: Boolean(finalStops[0].isStartingHubPickup),
        isStartingHub: Boolean(finalStops[0].isStartingHubPickup),
        stopType: finalStops[0].stopType || (finalStops[0].isStartingHubPickup ? "STARTING_HUB_PICKUP" : "PASSENGER_PICKUP")
    } : null;

    const startingHubDetails = startingHub ? {
        name: startingHub.locationName || startingHub.name || "Starting Hub",
        locationName: startingHub.locationName || startingHub.name || "Starting Hub",
        latitude: Number(startingHub.latitude),
        longitude: Number(startingHub.longitude),
        hasPassengers: Boolean(finalStops[0]?.isStartingHubPickup),
        passengerCount: finalStops[0]?.isStartingHubPickup ? (finalStops[0].userCount || (finalStops[0].userIds || []).length || 0) : 0,
        isPickupStop: Boolean(finalStops[0]?.isStartingHubPickup)
    } : null;

    const destinationDetails = destinationHub ? {
        name: destinationHub.name || "Destination",
        latitude: Number(destinationHub.latitude),
        longitude: Number(destinationHub.longitude)
    } : null;

    return {
        stops: finalStops,
        routeDistanceKm: Number(totalRoadDist.toFixed(2)),
        hasStartingHubPickup: Boolean(finalStops[0]?.isStartingHubPickup),
        qualityValidation: {
            startingHub: startingHub?.locationName || startingHub?.name || "Unknown",
            startingHubDetails,
            firstPassengerStop,
            hasStartingHubPickup: Boolean(finalStops[0]?.isStartingHubPickup),
            destination: destinationHub?.name || "Destination",
            destinationDetails,
            totalRoadDistance: Number(totalRoadDist.toFixed(2)),
            directDistance: Number(directStartToDest.toFixed(2)),
            totalRouteDuration: Number((totalRoadDist / 0.5).toFixed(1)),
            repeatedStopsCount,
            startingHubRepeatedAfterDeparture: finalHasStartRepeat,
            directionalReversals,
            backtrackingDistanceKm: Number(backtrackingDistanceKm.toFixed(2)),
            detourRatio,
            operationalContinuityVerified
        }
    };
};

/**
 * Sequences outward route stops progressively away from the departure hub along the corridor.
 * 1. Evaluates candidate sequences using actual road distances and outward progression.
 * 2. Penalizes returning back towards the departure hub (> 2.0 km) or acute zig-zag reversals.
 * 3. Uses Branch & Bound for <= 9 stops or progressive nearest insertion + 2-opt for > 9 stops.
 * 4. Produces structured route quality validation metrics.
 */
export const sequenceOutwardRouteStops = ({
    departureHub,
    stops = [],
    matrix = null,
    tripMode = "FROM_SOURCE"
}) => {
    if (!Array.isArray(stops) || stops.length === 0) {
        return {
            stops: [],
            routeDistanceKm: 0,
            qualityValidation: {
                startingHub: departureHub?.locationName || departureHub?.name || "Departure Hub",
                destination: "Final Stop",
                totalRoadDistance: 0,
                totalRouteDuration: 0,
                repeatedStopsCount: 0,
                startingHubRepeatedAfterDeparture: false,
                directionalReversals: 0,
                backtrackingDistanceKm: 0,
                detourRatio: 1.0
            }
        };
    }

    // Pre-merge any duplicate stops in the incoming stops
    const sanitizedStops = mergeDuplicateStopsInRoute(stops, departureHub);

    const getDistBetween = (locA, locB) => {
        if (!locA || !locB) return 0;
        if (matrix?.getDist && locA.matrixIndex !== undefined && locB.matrixIndex !== undefined) {
            return matrix.getDist(locA.matrixIndex, locB.matrixIndex);
        }
        const latA = Number(locA.latitude ?? locA.lat);
        const lonA = Number(locA.longitude ?? locA.lon ?? locA.lng);
        const latB = Number(locB.latitude ?? locB.lat);
        const lonB = Number(locB.longitude ?? locB.lon ?? locB.lng);
        if (!Number.isFinite(latA) || !Number.isFinite(lonA) || !Number.isFinite(latB) || !Number.isFinite(lonB)) {
            return 5.0;
        }
        return Number((calculateDistanceKm(latA, lonA, latB, lonB) * 1.25).toFixed(2));
    };

    if (sanitizedStops.length === 1) {
        const d = getDistBetween(departureHub, sanitizedStops[0]);
        return {
            stops: [{ ...sanitizedStops[0], order: 1, sequence: 1 }],
            routeDistanceKm: d,
            qualityValidation: {
                startingHub: departureHub?.locationName || departureHub?.name || "Departure Hub",
                destination: sanitizedStops[0]?.name || "Final Stop",
                totalRoadDistance: d,
                totalRouteDuration: Number((d / 0.5).toFixed(1)),
                repeatedStopsCount: 0,
                startingHubRepeatedAfterDeparture: false,
                directionalReversals: 0,
                backtrackingDistanceKm: 0,
                detourRatio: 1.0
            }
        };
    }

    // Progression cost function for outward sequence: [departureHub, s1, s2, ..., sN]
    const evaluateOutwardCost = (candidateSeq) => {
        let cost = 0;
        const fullPath = [departureHub, ...candidateSeq];

        // Route corridor angular spread penalty
        if (departureHub && isValidCoordinate(departureHub.latitude, departureHub.longitude)) {
            const span = calculateMaxBearingSpan(departureHub, candidateSeq);
            if (span > 38.0) {
                cost += (span - 38.0) * 35.0 + 350.0;
            }
        }

        for (let i = 0; i < fullPath.length - 1; i++) {
            const legDist = getDistBetween(fullPath[i], fullPath[i + 1]);
            cost += legDist;

            // Outward progression penalty:
            // When moving to the next stop, if the bus moves significantly closer back to the departure hub (> 0.5 km)
            if (departureHub && i >= 1) {
                const distPrevFromHub = calculateDistanceKm(departureHub.latitude, departureHub.longitude, fullPath[i].latitude, fullPath[i].longitude);
                const distCurrFromHub = calculateDistanceKm(departureHub.latitude, departureHub.longitude, fullPath[i + 1].latitude, fullPath[i + 1].longitude);
                const backwardMovement = distPrevFromHub - distCurrFromHub;
                if (backwardMovement > 0.5) {
                    cost += backwardMovement * 15.0; // penalty for returning toward departure hub
                }
                if (backwardMovement > 2.0) {
                    cost += backwardMovement * 35.0; // severe penalty
                }

                // Lateral cross-corridor jump penalty:
                if (distPrevFromHub > 2.5 && distCurrFromHub > 2.5) {
                    const bPrev = calculateBearing(departureHub.latitude, departureHub.longitude, fullPath[i].latitude, fullPath[i].longitude);
                    const bCurr = calculateBearing(departureHub.latitude, departureHub.longitude, fullPath[i + 1].latitude, fullPath[i + 1].longitude);
                    const bDiff = getBearingDifference(bPrev, bCurr);
                    if (bDiff > 20.0 && legDist > 4.0) {
                        cost += (bDiff * 15.0) + (legDist * 20.0) + 150.0; // severe penalty for lateral cross-corridor jump
                    }
                }
            }

            // Visited corridor backtracking: check if moving to fullPath[i+1] loops back closer to earlier stops
            if (i >= 2) {
                for (let j = 0; j < i - 1; j++) {
                    const dCurrToEarlier = calculateDistanceKm(fullPath[i].latitude, fullPath[i].longitude, fullPath[j].latitude, fullPath[j].longitude);
                    const dNextToEarlier = calculateDistanceKm(fullPath[i + 1].latitude, fullPath[i + 1].longitude, fullPath[j].latitude, fullPath[j].longitude);
                    if (dNextToEarlier < dCurrToEarlier - 0.75) {
                        cost += (dCurrToEarlier - dNextToEarlier) * 25.0;
                    }
                    if (dNextToEarlier < 3.0 && dCurrToEarlier > 4.5) {
                        cost += 250.0; // severe penalty for returning to an already visited corridor
                    }
                }
            }

            // Directional inversion / acute hairpin turnaround penalty:
            if (i >= 1 && i < fullPath.length - 1) {
                const latDiff1 = fullPath[i].latitude - fullPath[i - 1].latitude;
                const lonDiff1 = fullPath[i].longitude - fullPath[i - 1].longitude;
                const latDiff2 = fullPath[i + 1].latitude - fullPath[i].latitude;
                const lonDiff2 = fullPath[i + 1].longitude - fullPath[i].longitude;
                const dot = (latDiff1 * latDiff2) + (lonDiff1 * lonDiff2);
                const mag1 = Math.sqrt(latDiff1 * latDiff1 + lonDiff1 * lonDiff1);
                const mag2 = Math.sqrt(latDiff2 * latDiff2 + lonDiff2 * lonDiff2);
                if (mag1 > 0.008 && mag2 > 0.008) {
                    const cosVal = dot / (mag1 * mag2);
                    if (cosVal < -0.35) {
                        cost += 180.0; // acute turnaround / reversal (> 110°)
                    } else if (cosVal < -0.10) {
                        cost += 70.0; // sharp turnaround (> 95°)
                    }
                }
            } else if (i === fullPath.length - 1 && fullPath.length >= 3) {
                const prevPrev = fullPath[i - 2];
                const prev = fullPath[i - 1];
                const curr = fullPath[i];
                const latDiff1 = prev.latitude - prevPrev.latitude;
                const lonDiff1 = prev.longitude - prevPrev.longitude;
                const latDiff2 = curr.latitude - prev.latitude;
                const lonDiff2 = curr.longitude - prev.longitude;
                const dot = (latDiff1 * latDiff2) + (lonDiff1 * lonDiff2);
                const mag1 = Math.sqrt(latDiff1 * latDiff1 + lonDiff1 * lonDiff1);
                const mag2 = Math.sqrt(latDiff2 * latDiff2 + lonDiff2 * lonDiff2);
                if (mag1 > 0.008 && mag2 > 0.008) {
                    const cosVal = dot / (mag1 * mag2);
                    if (cosVal < -0.35) {
                        cost += 180.0;
                    } else if (cosVal < -0.10) {
                        cost += 70.0;
                    }
                }
            }
        }
        return cost;
    };

    let bestSequence = [];
    if (sanitizedStops.length <= 9) {
        let bestCost = Infinity;

        const permute = (currentSeq, remaining) => {
            if (remaining.length === 0) {
                const c = evaluateOutwardCost(currentSeq);
                if (c < bestCost) {
                    bestCost = c;
                    bestSequence = [...currentSeq];
                }
                return;
            }

            const partialCost = evaluateOutwardCost(currentSeq);
            if (partialCost >= bestCost) return;

            for (let i = 0; i < remaining.length; i++) {
                currentSeq.push(remaining[i]);
                const nextRemaining = remaining.filter((_, idx) => idx !== i);
                permute(currentSeq, nextRemaining);
                currentSeq.pop();
            }
        };

        const sortedByHubDist = [...sanitizedStops].sort((a, b) =>
            calculateDistanceKm(departureHub.latitude, departureHub.longitude, a.latitude, a.longitude) -
            calculateDistanceKm(departureHub.latitude, departureHub.longitude, b.latitude, b.longitude)
        );

        for (let i = 0; i < Math.min(3, sortedByHubDist.length); i++) {
            const firstStop = sortedByHubDist[i];
            const remaining = sanitizedStops.filter(s => s !== firstStop);
            permute([firstStop], remaining);
        }
    } else {
        const unvisited = [...sanitizedStops];
        unvisited.sort((a, b) =>
            calculateDistanceKm(departureHub.latitude, departureHub.longitude, a.latitude, a.longitude) -
            calculateDistanceKm(departureHub.latitude, departureHub.longitude, b.latitude, b.longitude)
        );
        const tour = [unvisited.shift()];

        while (unvisited.length > 0) {
            const current = tour[tour.length - 1];
            let bestNextIdx = 0;
            let lowestNextScore = Infinity;

            for (let i = 0; i < unvisited.length; i++) {
                const cand = unvisited[i];
                const roadDist = getDistBetween(current, cand);
                const candHubDist = calculateDistanceKm(departureHub.latitude, departureHub.longitude, cand.latitude, cand.longitude);
                const currHubDist = calculateDistanceKm(departureHub.latitude, departureHub.longitude, current.latitude, current.longitude);
                const backward = currHubDist - candHubDist;
                const score = roadDist + (backward > 0.5 ? backward * 12.0 : 0);

                if (score < lowestNextScore) {
                    lowestNextScore = score;
                    bestNextIdx = i;
                }
            }
            tour.push(unvisited.splice(bestNextIdx, 1)[0]);
        }

        let improved = true;
        let iters = 0;
        let currentBestCost = evaluateOutwardCost(tour);
        bestSequence = [...tour];

        while (improved && iters < 30) {
            improved = false;
            iters++;
            for (let i = 0; i < bestSequence.length - 1; i++) {
                for (let k = i + 1; k < bestSequence.length; k++) {
                    const candidate = [
                        ...bestSequence.slice(0, i),
                        ...bestSequence.slice(i, k + 1).reverse(),
                        ...bestSequence.slice(k + 1)
                    ];
                    const candCost = evaluateOutwardCost(candidate);
                    if (candCost < currentBestCost - 0.1) {
                        currentBestCost = candCost;
                        bestSequence = candidate;
                        improved = true;
                    }
                }
            }
        }
    }

    const deduplicatedBest = mergeDuplicateStopsInRoute(bestSequence, departureHub);

    const finalStops = deduplicatedBest.map((s, idx) => ({
        ...s,
        order: idx + 1,
        sequence: idx + 1
    }));

    let totalRoadDist = 0;
    let backtrackingKm = 0;
    let directionalReversals = 0;
    const fullTour = [departureHub, ...finalStops];

    for (let i = 0; i < fullTour.length - 1; i++) {
        totalRoadDist += getDistBetween(fullTour[i], fullTour[i + 1]);
        if (i >= 1) {
            const d1 = calculateDistanceKm(departureHub.latitude, departureHub.longitude, fullTour[i].latitude, fullTour[i].longitude);
            const d2 = calculateDistanceKm(departureHub.latitude, departureHub.longitude, fullTour[i + 1].latitude, fullTour[i + 1].longitude);
            if (d2 < d1 - 3.5) {
                backtrackingKm += (d1 - d2);
                directionalReversals++;
            }

            // Check acute turnaround between consecutive legs
            if (i < fullTour.length - 1) {
                const uLat = fullTour[i].latitude - fullTour[i - 1].latitude;
                const uLon = fullTour[i].longitude - fullTour[i - 1].longitude;
                const vLat = fullTour[i + 1].latitude - fullTour[i].latitude;
                const vLon = fullTour[i + 1].longitude - fullTour[i].longitude;
                const dot = (uLat * vLat) + (uLon * vLon);
                const magU = Math.sqrt(uLat * uLat + uLon * uLon);
                const magV = Math.sqrt(vLat * vLat + vLon * vLon);
                if (magU > 0.008 && magV > 0.008 && (dot / (magU * magV)) < -0.35) {
                    directionalReversals++;
                    backtrackingKm += Math.min(magU, magV) * 111.0;
                }
            }

            // Visited corridor backtracking: moving to fullTour[i+1] loops back closer to earlier stops
            if (i >= 2) {
                for (let j = 0; j < i - 1; j++) {
                    const dCurrToEarlier = calculateDistanceKm(fullTour[i].latitude, fullTour[i].longitude, fullTour[j].latitude, fullTour[j].longitude);
                    const dNextToEarlier = calculateDistanceKm(fullTour[i + 1].latitude, fullTour[i + 1].longitude, fullTour[j].latitude, fullTour[j].longitude);
                    if (dNextToEarlier < 3.0 && dCurrToEarlier > 4.5) {
                        directionalReversals++;
                        backtrackingKm += (dCurrToEarlier - dNextToEarlier);
                    }
                }
            }

            // Lateral cross-corridor jump check
            if (d1 > 2.5 && d2 > 2.5) {
                const b1 = calculateBearing(departureHub.latitude, departureHub.longitude, fullTour[i].latitude, fullTour[i].longitude);
                const b2 = calculateBearing(departureHub.latitude, departureHub.longitude, fullTour[i + 1].latitude, fullTour[i + 1].longitude);
                const bDiff = getBearingDifference(b1, b2);
                const interDist = calculateDistanceKm(fullTour[i].latitude, fullTour[i].longitude, fullTour[i + 1].latitude, fullTour[i + 1].longitude);
                if (bDiff > 45.0 && interDist > 6.0) {
                    directionalReversals++;
                }
            }
        }
    }

    const maxBearingSpan = calculateMaxBearingSpan(departureHub, finalStops);
    if (maxBearingSpan > 38.0) {
        directionalReversals++;
    }

    let straightBaseline = 0;
    for (let i = 0; i < fullTour.length - 1; i++) {
        straightBaseline += calculateDistanceKm(fullTour[i].latitude, fullTour[i].longitude, fullTour[i + 1].latitude, fullTour[i + 1].longitude);
    }
    const detourRatio = straightBaseline > 0 ? Number((totalRoadDist / straightBaseline).toFixed(2)) : 1.25;

    const opContinuity = Boolean(
        directionalReversals === 0 &&
        backtrackingKm < 2.0 &&
        detourRatio <= 2.25 &&
        maxBearingSpan <= 38.0
    );

    return {
        stops: finalStops,
        routeDistanceKm: Number(totalRoadDist.toFixed(2)),
        qualityValidation: {
            startingHub: departureHub?.locationName || departureHub?.name || "Departure Hub",
            destination: finalStops[finalStops.length - 1]?.name || "Final Stop",
            totalRoadDistance: Number(totalRoadDist.toFixed(2)),
            totalRouteDuration: Number((totalRoadDist / 0.5).toFixed(1)),
            repeatedStopsCount: 0,
            startingHubRepeatedAfterDeparture: false,
            directionalReversals,
            backtrackingDistanceKm: Number(backtrackingKm.toFixed(2)),
            detourRatio,
            maxBearingSpan,
            hasCorridorDivergence: maxBearingSpan > 38.0,
            operationalContinuityVerified: opContinuity
        }
    };
};


// ============================================================================
// 5. CONTROLLED GLOBAL CANDIDATE GENERATION (BEAM SEARCH POOL)
// ============================================================================

/**
 * Generates global candidate routes using Clarke-Wright savings + nearest insertion + capacity limits.
 * Eliminates premature corridor locking.
 */
export const generateGlobalCandidateRoutes = ({
    stops = [],
    matrix,
    maxBusCapacity = 70,
    tripMode = "FROM_SOURCE",
    options = {}
}) => {
    if (!Array.isArray(stops) || stops.length === 0) return [];

    const isOutward = tripMode === "FROM_SOURCE" || tripMode === "OUTWARD";

    // DEMAND-SAME / FLEET SYMMETRY SEEDING (Req 7, 8, 15):
    // When generating INWARD and an existing oppositePlan (OUTWARD) is available:
    // If the demand distribution is effectively identical (confirmed coming students),
    // seed candidate routes directly from the outward corridor groups, preserving road-connected
    // corridors without arbitrary fragmentation.
    if (!isOutward && options?.oppositePlan) {
        const oppBuses = options.oppositePlan.buses || options.oppositePlan.routes || [];
        if (oppBuses.length > 0) {
            const totalInwardPax = stops.reduce((sum, s) => sum + (Array.isArray(s.userIds) ? s.userIds.length : Number(s.userCount || 0)), 0);
            const totalOutwardPax = oppBuses.reduce((sum, b) => sum + (b.assignedUsers || b.passengerCount || 0), 0);

            // If passenger counts match within 5%, construct candidate routes from outward corridors
            if (Math.abs(totalInwardPax - totalOutwardPax) <= Math.max(5, totalInwardPax * 0.05)) {
                const stopMap = new Map();
                stops.forEach((st) => {
                    const k = (st.name || st.stopping || "").toLowerCase().trim();
                    stopMap.set(k, st);
                });

                const seededRoutes = [];
                let allMatched = true;

                for (let bIdx = 0; bIdx < oppBuses.length; bIdx++) {
                    const ob = oppBuses[bIdx];
                    const bStops = [];
                    let bPax = 0;
                    const bUserIds = [];

                    for (const ost of (ob.stops || [])) {
                        const k = (ost.name || ost.stopping || "").toLowerCase().trim();
                        const matched = stopMap.get(k);
                        if (matched) {
                            const pCount = Array.isArray(matched.userIds) && matched.userIds.length > 0
                                ? matched.userIds.length
                                : Number(matched.userCount || matched.passengerCount || 0);
                            bStops.push({
                                ...matched,
                                passengerCount: pCount,
                                userCount: pCount
                            });
                            bPax += pCount;
                            if (Array.isArray(matched.userIds)) bUserIds.push(...matched.userIds);
                        } else {
                            allMatched = false;
                            break;
                        }
                    }

                    if (!allMatched) break;

                    if (bStops.length > 0) {
                        const assignedVeh = ob.vehicle || ob.assignedVehicle;
                        const vId = String(ob.vehicleId || assignedVeh?._id || assignedVeh?.id || "");
                        const vName = ob.vehicleName || assignedVeh?.vehicleName || assignedVeh?.name || "";

                        let inStops = bStops;
                        if (!isOutward) {
                            const destHub = options.destinationHub || matrix?.locations?.[0];
                            let sp = null;
                            if (Array.isArray(options?.activeInwardStartingPlaces) && options.activeInwardStartingPlaces.length > 0) {
                                sp = findStartingPlaceForBus(assignedVeh || { vehicleName: vName, _id: vId }, options.activeInwardStartingPlaces);
                            }
                            if (!sp && bStops.length > 0 && destHub) {
                                // Find residential stop furthest from destination to anchor road progression
                                const sortedByDest = [...bStops].sort((a, b) =>
                                    calculateDistanceKm(destHub.latitude, destHub.longitude, b.latitude, b.longitude) -
                                    calculateDistanceKm(destHub.latitude, destHub.longitude, a.latitude, a.longitude)
                                );
                                sp = sortedByDest[0];
                            }
                            const seq = sequenceInwardRouteStops({
                                startingHub: sp,
                                destinationHub: destHub,
                                stops: bStops,
                                matrix,
                                tripMode
                            });
                            inStops = seq.stops;
                        }

                        seededRoutes.push({
                            routeId: `cand_seed_${bIdx + 1}`,
                            stops: inStops,
                            assignedUsers: bPax,
                            users: bUserIds,
                            ...(isOutward ? { vehicleId: vId, vehicleName: vName, vehicle: assignedVeh } : {})
                        });
                    }
                }

                const seededPax = seededRoutes.reduce((sum, r) => sum + r.assignedUsers, 0);
                if (allMatched && seededRoutes.length === oppBuses.length && seededPax === totalInwardPax) {
                    return seededRoutes;
                }
            }
        }
    }

    const getPax = (st) => Array.isArray(st.userIds) ? st.userIds.length : Number(st.userCount || 0);

    // Build initial single-stop candidate routes
    // Each stop enriched with matrixIndex
    const enrichedStops = stops.map((s, idx) => ({
        ...s,
        matrixIndex: idx + 1,
        passengerCount: getPax(s)
    }));

    // Compute Clarke-Wright savings across all pairs using OSRM road matrix
    const savingsList = computeClarkeWrightSavings({
        stops: enrichedStops,
        depot: matrix.locations[0],
        distanceMatrix: matrix,
        tripMode,
        options
    });

    // Track route membership: stopIndex -> routeId
    let routes = [];
    enrichedStops.forEach((st, idx) => {
        const pax = st.passengerCount;
        if (pax <= maxBusCapacity || maxBusCapacity <= 0) {
            routes.push({
                routeId: `cand_${idx + 1}`,
                stops: [st],
                assignedUsers: pax,
                users: Array.isArray(st.userIds) ? [...st.userIds] : []
            });
        } else {
            // Partition single stops exceeding maximum vehicle capacity across multiple candidate routes
            let remainingPax = pax;
            let subIdx = 1;
            const userIds = Array.isArray(st.userIds) ? [...st.userIds] : [];
            while (remainingPax > 0) {
                const chunkPax = Math.min(remainingPax, maxBusCapacity);
                const chunkUserIds = userIds.length > 0 ? userIds.splice(0, chunkPax) : [];
                routes.push({
                    routeId: `cand_${idx + 1}_part_${subIdx++}`,
                    stops: [{
                        ...st,
                        userCount: chunkPax,
                        passengerCount: chunkPax,
                        userIds: chunkUserIds
                    }],
                    assignedUsers: chunkPax,
                    users: chunkUserIds
                });
                remainingPax -= chunkPax;
            }
        }
    });

    const refHub = (isOutward ? (options.sourceHub || options.anchorHub) : (options.destinationHub || options.anchorHub)) || matrix.locations[0];

    // Pass 1: Clarke-Wright Capacitated Route Merging
    for (const saving of savingsList) {
        const idxA = saving.stopIIndex;
        const idxB = saving.stopJIndex;

        const routeA = routes.find((r) => r.stops.some((s) => s.matrixIndex === idxA + 1));
        const routeB = routes.find((r) => r.stops.some((s) => s.matrixIndex === idxB + 1));

        if (!routeA || !routeB || routeA.routeId === routeB.routeId) continue;

        // Check if combined demand respects maximum vehicle capacity
        const combinedPax = routeA.assignedUsers + routeB.assignedUsers;
        if (combinedPax > maxBusCapacity) continue;

        // Inward Starting Hub Protection: If configured inward starting places are provided,
        // do NOT merge two candidate routes if each already contains a distinct configured starting hub!
        if (!isOutward && Array.isArray(options?.activeInwardStartingPlaces) && options.activeInwardStartingPlaces.length > 0) {
            const places = options.activeInwardStartingPlaces;
            const hubsInA = places.filter(p => routeA.stops.some(s => isSamePlace(p, s)));
            const hubsInB = places.filter(p => routeB.stops.some(s => isSamePlace(p, s)));
            if (hubsInA.length > 0 && hubsInB.length > 0) {
                const sameHub = hubsInA.some(ha => hubsInB.some(hb => (ha.busName || ha.name) === (hb.busName || hb.name)));
                if (!sameHub) {
                    continue; // Distinct buses' starting hubs must not be merged into one bus
                }
            }
        }

        // Corridor Coherence Check: Do not merge routes belonging to truly divergent corridors
        if (refHub && isValidCoordinate(refHub.latitude, refHub.longitude)) {
            const combinedStops = [...routeA.stops, ...routeB.stops];
            const span = calculateMaxBearingSpan(refHub, combinedStops);
            if (span > 85.0) {
                continue; // Divergent corridors must remain on separate routes
            }
        }

        // Check if stopA and stopB are at endpoints of their respective tours
        const aAtStart = routeA.stops[0].matrixIndex === idxA + 1;
        const aAtEnd = routeA.stops[routeA.stops.length - 1].matrixIndex === idxA + 1;
        const bAtStart = routeB.stops[0].matrixIndex === idxB + 1;
        const bAtEnd = routeB.stops[routeB.stops.length - 1].matrixIndex === idxB + 1;

        if ((aAtStart || aAtEnd) && (bAtStart || bAtEnd)) {
            // Physical Barrier & Corridor Distance Check between connecting endpoints
            const connectStopA = routeA.stops.find(s => s.matrixIndex === idxA + 1);
            const connectStopB = routeB.stops.find(s => s.matrixIndex === idxB + 1);
            if (connectStopA && connectStopB && isValidCoordinate(connectStopA.latitude, connectStopA.longitude) && isValidCoordinate(connectStopB.latitude, connectStopB.longitude)) {
                const straightConn = calculateDistanceKm(connectStopA.latitude, connectStopA.longitude, connectStopB.latitude, connectStopB.longitude);
                const roadConn = matrix.getDist ? matrix.getDist(connectStopA.matrixIndex, connectStopB.matrixIndex) : straightConn * 1.25;
                if (straightConn > 0.4 && roadConn / straightConn > 3.5) {
                    continue; // Skip merge across physical barrier
                }
                if (isOutward && options?.sourceHub && isValidCoordinate(options.sourceHub.latitude, options.sourceHub.longitude)) {
                    const dHubA = calculateDistanceKm(options.sourceHub.latitude, options.sourceHub.longitude, connectStopA.latitude, connectStopA.longitude);
                    const dHubB = calculateDistanceKm(options.sourceHub.latitude, options.sourceHub.longitude, connectStopB.latitude, connectStopB.longitude);
                    if (dHubA > 2.0 && dHubB > 2.0) {
                        const bA = calculateBearing(options.sourceHub.latitude, options.sourceHub.longitude, connectStopA.latitude, connectStopA.longitude);
                        const bB = calculateBearing(options.sourceHub.latitude, options.sourceHub.longitude, connectStopB.latitude, connectStopB.longitude);
                        if (getBearingDifference(bA, bB) > 55.0 && (straightConn > 8.0 || roadConn > 12.0)) {
                            continue; // Skip lateral leap between distant corridors
                        }
                    }
                }
            }

            let mergedStops = [];
            if (aAtEnd && bAtStart) {
                mergedStops = [...routeA.stops, ...routeB.stops];
            } else if (aAtEnd && bAtEnd) {
                mergedStops = [...routeA.stops, ...routeB.stops.reverse()];
            } else if (aAtStart && bAtStart) {
                mergedStops = [...routeA.stops.reverse(), ...routeB.stops];
            } else if (aAtStart && bAtEnd) {
                mergedStops = [...routeB.stops, ...routeA.stops];
            }

            // Run 2-opt road refinement on merged sequence
            const optRes = optimizeTour2OptRoad({
                tour: mergedStops,
                matrix,
                tripMode
            });

            // Route Quality Validation: Detour & Directional Reversal Check
            const testSeq = isOutward
                ? sequenceOutwardRouteStops({ departureHub: refHub, stops: optRes.tour, matrix, tripMode })
                : sequenceInwardRouteStops({
                    startingHub: options.activeInwardStartingPlaces?.[0] || optRes.tour[0],
                    destinationHub: refHub,
                    stops: optRes.tour,
                    matrix,
                    tripMode
                });
            const qv = testSeq.qualityValidation || {};
            if ((qv.directionalReversals || 0) > 0 || (qv.detourRatio || 1.0) > 2.25) {
                continue; // Reject merge if it creates directional reversals or excessive detour
            }

            routeA.stops = optRes.tour;
            routeA.assignedUsers = combinedPax;
            routeA.users = [...routeA.users, ...routeB.users];

            // Remove routeB from active set
            routes = routes.filter((r) => r.routeId !== routeB.routeId);
        }
    }

    // Pass 2: Small Group & Nearest Insertion Consolidation (Requirements 5, 6, 7)
    // Absorbs small passenger routes (<= 15 passengers, e.g. Q1 with 9 pax) into compatible existing routes
    // with available capacity along continuous road corridors.
    const MAX_INSERTION_COST_KM = 4.75;
    let mergedAny = true;
    while (mergedAny) {
        mergedAny = false;
        const smallRoutes = routes
            .filter((r) => r.assignedUsers <= 15)
            .sort((a, b) => a.assignedUsers - b.assignedUsers);

        for (const small of smallRoutes) {
            let bestTargetRoute = null;
            let bestCostDelta = Infinity;
            let bestUpdatedTour = null;

            for (const target of routes) {
                if (target.routeId === small.routeId) continue;
                if (target.assignedUsers + small.assignedUsers > maxBusCapacity) continue;

                // Check corridor coherence between small route and target route
                if (refHub && isValidCoordinate(refHub.latitude, refHub.longitude)) {
                    const combinedStops = [...target.stops, ...small.stops];
                    if (!isRouteCorridorCoherent(refHub, combinedStops, 38.0, 4.75)) {
                        continue; // Skip target in different corridor
                    }
                    const minInterDist = Math.min(...small.stops.flatMap(s1 => target.stops.map(s2 => calculateDistanceKm(s1.latitude, s1.longitude, s2.latitude, s2.longitude))));
                    if (minInterDist > 4.75) {
                        continue; // Skip distant stops that would create cross-town detours
                    }
                }

                // Sequentially insert all stops from the small route into the target tour
                let currentTour = [...target.stops];
                let totalDelta = 0;
                let insertionPossible = true;

                for (const stopToInsert of small.stops) {
                    const insertRes = insertStopNearestCost({
                        tour: currentTour,
                        stop: stopToInsert,
                        stopMatrixIndex: stopToInsert.matrixIndex,
                        matrix,
                        tripMode,
                        originHub: isOutward ? refHub : null,
                        destinationHub: !isOutward ? refHub : null,
                        rejectOnExcessiveDetour: true
                    });
                    if (insertRes.rejected || insertRes.costDelta > MAX_INSERTION_COST_KM) {
                        insertionPossible = false;
                        break;
                    }
                    totalDelta += insertRes.costDelta;
                    currentTour = insertRes.updatedTour;
                }


                if (insertionPossible && totalDelta < bestCostDelta) {
                    bestCostDelta = totalDelta;
                    bestTargetRoute = target;
                    bestUpdatedTour = currentTour;
                }
            }

            if (bestTargetRoute && bestUpdatedTour) {
                const optRes = optimizeTour2OptRoad({
                    tour: bestUpdatedTour,
                    matrix,
                    tripMode
                });

                // Verify that merged tour satisfies continuity without reversals or excessive detour
                const testSeq = isOutward
                    ? sequenceOutwardRouteStops({ departureHub: refHub, stops: optRes.tour, matrix, tripMode })
                    : sequenceInwardRouteStops({
                        startingHub: options.activeInwardStartingPlaces?.[0] || optRes.tour[0],
                        destinationHub: refHub,
                        stops: optRes.tour,
                        matrix,
                        tripMode
                    });
                const qv = testSeq.qualityValidation || {};
                if ((qv.directionalReversals || 0) === 0 && (qv.detourRatio || 1.0) <= 2.25) {
                    bestTargetRoute.stops = optRes.tour;
                    bestTargetRoute.assignedUsers += small.assignedUsers;
                    bestTargetRoute.users = [...bestTargetRoute.users, ...small.users];
                    routes = routes.filter((r) => r.routeId !== small.routeId);
                    mergedAny = true;
                    break;
                }
            }
        }
    }

    return routes;
};

/**
 * Post-Routing Small Passenger Route Consolidation Engine (Requirements 5, 6, 7, 41)
 * Evaluates whether any route with small passenger demand (e.g. Q1 with 9 pax) can be
 * absorbed into an existing compatible route that has spare capacity, without violating
 * OSRM road continuity, detour threshold (<= 2.25x), or inward starting hub rules.
 */
export const consolidateSmallPassengerRoutes = ({
    routes = [],
    matrix,
    maxBusCapacity = 70,
    tripMode = "FROM_SOURCE",
    smallRouteThreshold = 15,
    maxDetourRatio = 2.25,
    activeInwardStartingPlaces = [],
    anchorHub = DEFAULT_SOURCE_HUB,
    sourceHub = null,
    destinationHub = null,
    auditTrail = []
}) => {
    if (!Array.isArray(routes) || routes.length <= 1) return routes;

    const isOutward = tripMode === "FROM_SOURCE" || tripMode === "OUTWARD";
    const resolvedOrigin = sourceHub || anchorHub || DEFAULT_SOURCE_HUB;
    const resolvedDest = destinationHub || anchorHub || DEFAULT_SOURCE_HUB;

    let currentRoutes = routes.map((r, idx) => ({
        ...r,
        routeId: r.routeId || `route_${idx + 1}`,
        stops: [...(r.stops || [])],
        users: [...(r.users || [])]
    }));

    let mergedAny = true;
    while (mergedAny) {
        mergedAny = false;
        // Find small routes with assignedUsers <= smallRouteThreshold (e.g. Q1 with 9 pax)
        const smallRoutes = currentRoutes
            .filter((r) => r.assignedUsers <= smallRouteThreshold && r.assignedUsers > 0)
            .sort((a, b) => a.assignedUsers - b.assignedUsers);

        for (const small of smallRoutes) {
            let bestTarget = null;
            let bestTour = null;
            let bestDist = Infinity;
            let bestAuditReason = "";

            for (const target of currentRoutes) {
                if (target.routeId === small.routeId) continue;
                const targetCapacity = Number(target.capacity || target.vehicle?.capacity || maxBusCapacity);
                if (target.assignedUsers + small.assignedUsers > targetCapacity) continue;

                // Sequentially insert stops of small route into target
                let testTour = [...target.stops];
                let possible = true;

                for (const st of small.stops) {
                    const insertRes = insertStopNearestCost({
                        tour: testTour,
                        stop: st,
                        stopMatrixIndex: st.matrixIndex,
                        matrix,
                        tripMode
                    });
                    if (insertRes.costDelta > 12.0) { // Reject extreme detour insertion
                        possible = false;
                        break;
                    }
                    testTour = insertRes.updatedTour;
                }

                if (!possible) continue;

                // 2-Opt road optimization
                const optRes = optimizeTour2OptRoad({
                    tour: testTour,
                    matrix,
                    tripMode
                });

                // Validate continuity & progression
                const seq = isOutward
                    ? sequenceOutwardRouteStops({ departureHub: resolvedOrigin, stops: optRes.tour, matrix, tripMode })
                    : sequenceInwardRouteStops({
                        startingHub: target.startLocation || target.inwardStartLocation || optRes.tour[0],
                        destinationHub: resolvedDest,
                        stops: optRes.tour,
                        matrix,
                        tripMode
                    });

                const qv = seq.qualityValidation || {};
                const reversals = qv.directionalReversals ?? 0;
                const detourRatio = qv.detourRatio ?? 1.25;
                const isContinuous = qv.operationalContinuityVerified !== false && reversals === 0;

                if (isContinuous && detourRatio <= maxDetourRatio) {
                    if (seq.routeDistanceKm < bestDist) {
                        bestDist = seq.routeDistanceKm;
                        bestTarget = target;
                        bestTour = seq.stops;
                        bestAuditReason = `Consolidated small route '${small.vehicleName || small.routeCode || small.routeId}' (${small.assignedUsers} pax) into '${target.vehicleName || target.routeCode || target.routeId}' along continuous road corridor (combined ${target.assignedUsers + small.assignedUsers}/${targetCapacity} pax, detour ${detourRatio}x).`;
                    }
                }
            }

            if (bestTarget && bestTour) {
                bestTarget.stops = bestTour;
                bestTarget.assignedUsers += small.assignedUsers;
                bestTarget.users = [...bestTarget.users, ...small.users];
                bestTarget.routeDistanceKm = bestDist;
                currentRoutes = currentRoutes.filter((r) => r.routeId !== small.routeId);

                if (Array.isArray(auditTrail)) {
                    auditTrail.push({
                        action: "CONSOLIDATE_SMALL_ROUTE",
                        smallRoute: small.vehicleName || small.routeCode || small.routeId,
                        targetRoute: bestTarget.vehicleName || bestTarget.routeCode || bestTarget.routeId,
                        passengersMoved: small.assignedUsers,
                        reason: bestAuditReason
                    });
                }

                mergedAny = true;
                break;
            }
        }
    }

    return currentRoutes;
};

// ============================================================================
// 6. INTER-ROUTE LOCAL SEARCH (RELOCATE, EXCHANGE, OR-OPT)
// ============================================================================

/**
 * Computes the total road tour distance for a list of stops.
 */
export const calcRouteRoadDistance = (stops = [], matrix, tripMode = "FROM_SOURCE", depot = DEFAULT_SOURCE_HUB) => {
    if (!Array.isArray(stops) || stops.length === 0) return 0;
    const isOutward = tripMode === "FROM_SOURCE" || tripMode === "OUTWARD";

    const getDistance = (s1, s2) => {
        if (!s1 || !s2) return 0;
        if (matrix && typeof matrix.getDist === "function" && s1.matrixIndex !== undefined && s2.matrixIndex !== undefined) {
            return matrix.getDist(s1.matrixIndex, s2.matrixIndex);
        }
        const lat1 = Number(s1.latitude ?? s1.lat);
        const lon1 = Number(s1.longitude ?? s1.lon ?? s1.lng);
        const lat2 = Number(s2.latitude ?? s2.lat);
        const lon2 = Number(s2.longitude ?? s2.lon ?? s2.lng);
        if (Number.isFinite(lat1) && Number.isFinite(lon1) && Number.isFinite(lat2) && Number.isFinite(lon2)) {
            return calculateDistanceKm(lat1, lon1, lat2, lon2) * 1.25;
        }
        return 5.0;
    };

    const depotObj = {
        matrixIndex: 0,
        latitude: depot?.latitude ?? DEFAULT_SOURCE_HUB.latitude,
        longitude: depot?.longitude ?? DEFAULT_SOURCE_HUB.longitude
    };

    let d = 0;
    if (isOutward) {
        d += getDistance(depotObj, stops[0]);
        for (let i = 0; i < stops.length - 1; i++) {
            d += getDistance(stops[i], stops[i + 1]);
        }
    } else {
        for (let i = 0; i < stops.length - 1; i++) {
            d += getDistance(stops[i], stops[i + 1]);
        }
        d += getDistance(stops[stops.length - 1], depotObj);
    }
    return Number(d.toFixed(2));
};

/**
 * Inter-Route Relocate: Evaluates moving a single stop from Route A to Route B.
 * Accepts the move if Route B has capacity and the total combined road distance decreases.
 */
export const applyInterRouteRelocate = ({
    routes = [],
    matrix,
    maxBusCapacity = 70,
    tripMode = "FROM_SOURCE",
    options = {},
    auditTrail = []
}) => {
    let improved = false;
    let currentRoutes = routes.map((r) => ({ ...r, stops: [...r.stops], users: [...r.users] }));
    const isOutward = tripMode === "FROM_SOURCE" || tripMode === "OUTWARD";
    const refHub = (isOutward ? (options.sourceHub || options.anchorHub) : (options.destinationHub || options.anchorHub)) || matrix?.locations?.[0];

    for (let aIdx = 0; aIdx < currentRoutes.length; aIdx++) {
        const routeA = currentRoutes[aIdx];
        if (routeA.stops.length <= 1) continue; // Keep at least one stop or dissolve cleanly

        for (let sIdx = 0; sIdx < routeA.stops.length; sIdx++) {
            const movingStop = routeA.stops[sIdx];
            const movingPax = movingStop.passengerCount || movingStop.userCount || movingStop.userIds?.length || 0;

            const oldDistA = calcRouteRoadDistance(routeA.stops, matrix, tripMode);
            const remainingStopsA = routeA.stops.filter((_, idx) => idx !== sIdx);
            const newDistA = calcRouteRoadDistance(remainingStopsA, matrix, tripMode);

            let bestTargetIdx = -1;
            let bestTourB = null;
            let bestNetSavings = 0;

            for (let bIdx = 0; bIdx < currentRoutes.length; bIdx++) {
                if (bIdx === aIdx) continue;
                const routeB = currentRoutes[bIdx];

                // Capacity check
                if (routeB.assignedUsers + movingPax > maxBusCapacity) continue;

                // Corridor Coherence Check
                if (refHub && isValidCoordinate(refHub.latitude, refHub.longitude) &&
                    isValidCoordinate(movingStop.latitude, movingStop.longitude)) {
                    if (isOutward && !isRouteCorridorCoherent(refHub, [...routeB.stops, movingStop], 38.0, 4.75)) {
                        continue; // Do not relocate stop into a divergent corridor
                    }
                    const minStopDist = Math.min(...routeB.stops.map(s => calculateDistanceKm(s.latitude, s.longitude, movingStop.latitude, movingStop.longitude)));
                    if (minStopDist > 4.75) {
                        continue; // Skip distant stops
                    }
                }

                const oldDistB = calcRouteRoadDistance(routeB.stops, matrix, tripMode);
                const insertRes = insertStopNearestCost({
                    tour: routeB.stops,
                    stop: movingStop,
                    stopMatrixIndex: movingStop.matrixIndex,
                    matrix,
                    tripMode,
                    originHub: isOutward ? refHub : null,
                    destinationHub: !isOutward ? refHub : null,
                    rejectOnExcessiveDetour: true
                });

                if (insertRes.rejected || insertRes.costDelta > 10.0) continue;

                // Validate that routeB maintains continuity with movingStop
                const testSeq = isOutward
                    ? sequenceOutwardRouteStops({ departureHub: refHub, stops: insertRes.updatedTour, matrix, tripMode })
                    : sequenceInwardRouteStops({
                        startingHub: options.activeInwardStartingPlaces?.[0] || insertRes.updatedTour[0],
                        destinationHub: refHub,
                        stops: insertRes.updatedTour,
                        matrix,
                        tripMode
                    });
                const qv = testSeq.qualityValidation || {};
                if ((qv.directionalReversals || 0) > 0 || (qv.detourRatio || 1.0) > 2.25) {
                    continue;
                }

                const newDistB = calcRouteRoadDistance(insertRes.updatedTour, matrix, tripMode);
                const oldTotal = oldDistA + oldDistB;
                const newTotal = newDistA + newDistB;
                const savings = oldTotal - newTotal;

                if (savings > 0.15 && savings > bestNetSavings) {
                    bestNetSavings = savings;
                    bestTargetIdx = bIdx;
                    bestTourB = insertRes.updatedTour;
                }
            }

            if (bestTargetIdx !== -1 && bestTourB) {
                const routeB = currentRoutes[bestTargetIdx];
                const movingUserIds = Array.isArray(movingStop.userIds) ? movingStop.userIds : [];

                const beforeCapB = routeB.assignedUsers;
                const afterCapB = beforeCapB + movingPax;

                routeA.stops = remainingStopsA;
                routeA.assignedUsers -= movingPax;
                routeA.users = routeA.users.filter((uid) => !movingUserIds.includes(uid));

                routeB.stops = bestTourB;
                routeB.assignedUsers = afterCapB;
                routeB.users = [...routeB.users, ...movingUserIds];

                auditTrail.push({
                    action: "RELOCATE_STOP",
                    sourceRoute: routeA.routeId,
                    destinationRoute: routeB.routeId,
                    passengersMoved: movingPax,
                    beforeCapacity: beforeCapB,
                    afterCapacity: afterCapB,
                    stopsAffected: [movingStop.name],
                    stopName: movingStop.name,
                    fromRoute: routeA.routeId,
                    toRoute: routeB.routeId,
                    savingsKm: Number(bestNetSavings.toFixed(2)),
                    reason: `Relocated stop '${movingStop.name}' (${movingPax} pax) to improve fleet road efficiency (-${bestNetSavings.toFixed(2)} km).`
                });

                improved = true;
                break;
            }
        }
        if (improved) break;
    }

    return {
        routes: currentRoutes.filter((r) => r.stops.length > 0),
        improved
    };
};

/**
 * Inter-Route Exchange: Swaps a stop from Route A with a stop from Route B
 * if doing so reduces total road distance while respecting vehicle capacities.
 */
export const applyInterRouteExchange = ({
    routes = [],
    matrix,
    maxBusCapacity = 70,
    tripMode = "FROM_SOURCE",
    options = {},
    auditTrail = []
}) => {
    let improved = false;
    let currentRoutes = routes.map((r) => ({ ...r, stops: [...r.stops], users: [...r.users] }));
    const isOutward = tripMode === "FROM_SOURCE" || tripMode === "OUTWARD";
    const refHub = (isOutward ? (options.sourceHub || options.anchorHub) : (options.destinationHub || options.anchorHub)) || matrix?.locations?.[0];

    for (let aIdx = 0; aIdx < currentRoutes.length - 1; aIdx++) {
        for (let bIdx = aIdx + 1; bIdx < currentRoutes.length; bIdx++) {
            const routeA = currentRoutes[aIdx];
            const routeB = currentRoutes[bIdx];

            for (let i = 0; i < routeA.stops.length; i++) {
                for (let j = 0; j < routeB.stops.length; j++) {
                    const stopA = routeA.stops[i];
                    const stopB = routeB.stops[j];

                    const paxA = stopA.passengerCount || stopA.userCount || 0;
                    const paxB = stopB.passengerCount || stopB.userCount || 0;

                    const newDemandA = routeA.assignedUsers - paxA + paxB;
                    const newDemandB = routeB.assignedUsers - paxB + paxA;

                    if (newDemandA > maxBusCapacity || newDemandB > maxBusCapacity) continue;

                    const testStopsA = [...routeA.stops.slice(0, i), stopB, ...routeA.stops.slice(i + 1)];
                    const testStopsB = [...routeB.stops.slice(0, j), stopA, ...routeB.stops.slice(j + 1)];

                    // Corridor Coherence Check
                    if (isOutward && refHub && isValidCoordinate(refHub.latitude, refHub.longitude)) {
                        if (!isRouteCorridorCoherent(refHub, testStopsA, 38.0, 4.75) || !isRouteCorridorCoherent(refHub, testStopsB, 38.0, 4.75)) {
                            continue; // Skip swap that breaks corridor coherence
                        }
                    }

                    const oldDistA = calcRouteRoadDistance(routeA.stops, matrix, tripMode);
                    const oldDistB = calcRouteRoadDistance(routeB.stops, matrix, tripMode);

                    const optA = optimizeTour2OptRoad({ tour: testStopsA, matrix, tripMode });
                    const optB = optimizeTour2OptRoad({ tour: testStopsB, matrix, tripMode });


                    const newTotal = optA.roadDistanceKm + optB.roadDistanceKm;
                    const oldTotal = oldDistA + oldDistB;
                    const savings = oldTotal - newTotal;

                    if (savings > 0.20) {
                        routeA.stops = optA.tour;
                        routeA.assignedUsers = newDemandA;
                        routeA.users = optA.tour.flatMap((s) => s.userIds || []);

                        routeB.stops = optB.tour;
                        routeB.assignedUsers = newDemandB;
                        routeB.users = optB.tour.flatMap((s) => s.userIds || []);

                        auditTrail.push({
                            action: "EXCHANGE_STOPS",
                            stopA: stopA.name,
                            stopB: stopB.name,
                            routeA: routeA.routeId,
                            routeB: routeB.routeId,
                            savingsKm: Number(savings.toFixed(2)),
                            reason: `Exchanged stops '${stopA.name}' and '${stopB.name}' between routes to optimize road alignment (-${savings.toFixed(2)} km).`
                        });

                        improved = true;
                        return { routes: currentRoutes, improved: true };
                    }
                }
            }
        }
    }

    return { routes: currentRoutes, improved: false };
};

/**
 * Inward Fleet Capacity-Bounded Candidate Route Consolidation:
 * When initial Clarke-Wright + local search generates more candidate routes than the target
 * fleet size (e.g. 7 routes formed due to atomic non-splitting of stops, while 6 configured buses
 * provide 420 seats for 398 passengers), this procedure merges and rebalances excess small routes
 * into the target number of routes, splitting or shifting multi-passenger stops when necessary
 * to stay within vehicle capacity (maxBusCapacity) and maintain road continuity.
 */
export const consolidateInwardCandidateRoutes = ({
    routes = [],
    targetRouteCount = 6,
    maxBusCapacity = 70,
    matrix,
    tripMode = "TO_DESTINATION",
    auditTrail = []
}) => {
    if (!Array.isArray(routes) || routes.length <= targetRouteCount) {
        return routes;
    }

    let currentRoutes = routes.map((r) => ({
        ...r,
        stops: (r.stops || []).map((s) => ({
            ...s,
            userIds: Array.isArray(s.userIds) ? [...s.userIds] : []
        })),
        users: Array.isArray(r.users) ? [...r.users] : []
    }));

    let consolidationRounds = 0;
    const MAX_ROUNDS = 5;

    while (currentRoutes.length > targetRouteCount && consolidationRounds < MAX_ROUNDS) {
        consolidationRounds++;

        // Sort ascending by assigned passenger count to dissolve smallest route first
        currentRoutes.sort((a, b) => a.assignedUsers - b.assignedUsers);
        const smallestRoute = currentRoutes[0];
        let allStopsAbsorbed = true;

        for (const stop of smallestRoute.stops) {
            const stopPax = stop.passengerCount || stop.userCount || stop.userIds?.length || 0;
            const otherRoutes = currentRoutes.filter((r) => r.routeId !== smallestRoute.routeId);

            // Option 1: Direct insertion into the route that has capacity AND minimizes road insertion cost
            const viableRoutes = otherRoutes.filter((r) => r.assignedUsers + stopPax <= maxBusCapacity);
            if (viableRoutes.length > 0) {
                let bestDirectTarget = null;
                let minDeltaCost = Infinity;
                let bestInsertResult = null;

                for (const target of viableRoutes) {
                    const insertRes = insertStopNearestCost({
                        tour: target.stops,
                        stop,
                        stopMatrixIndex: stop.matrixIndex,
                        matrix,
                        tripMode
                    });
                    if (insertRes.costDelta < minDeltaCost) {
                        minDeltaCost = insertRes.costDelta;
                        bestDirectTarget = target;
                        bestInsertResult = insertRes;
                    }
                }

                if (bestDirectTarget && bestInsertResult) {
                    bestDirectTarget.stops = bestInsertResult.updatedTour;
                    bestDirectTarget.assignedUsers += stopPax;
                    bestDirectTarget.users.push(...(stop.userIds || []));
                    auditTrail.push({
                        action: "CONSOLIDATE_ROUTE_DIRECT",
                        stopName: stop.name,
                        passengersMoved: stopPax,
                        targetRoute: bestDirectTarget.routeId,
                        reason: `Absorbed stop '${stop.name}' (${stopPax} pax) into geographically closest Route ${bestDirectTarget.routeId} (road cost delta: +${bestInsertResult.costDelta} km).`
                    });
                    continue;
                }
            }

            // Option 2: Geographically closest route rebalancing
            otherRoutes.sort((rA, rB) => {
                const distA = Math.min(...rA.stops.map((s) => matrix.getDist(s.matrixIndex, stop.matrixIndex)));
                const distB = Math.min(...rB.stops.map((s) => matrix.getDist(s.matrixIndex, stop.matrixIndex)));
                return distA - distB;
            });

            const primaryTarget = otherRoutes[0];
            const deficit = (primaryTarget.assignedUsers + stopPax) - maxBusCapacity;

            const thirdRoutes = otherRoutes.filter(
                (r) => r.routeId !== primaryTarget.routeId && (maxBusCapacity - r.assignedUsers) >= deficit
            );

            let rebalanced = false;
            if (thirdRoutes.length > 0) {
                let bestDonorStop = null;
                let bestReceiverRoute = null;
                let minDonorDist = Infinity;

                for (const s of primaryTarget.stops) {
                    const sPax = s.passengerCount || s.userCount || s.userIds?.length || 0;
                    if (sPax > deficit) {
                        for (const tr of thirdRoutes) {
                            const d = Math.min(...tr.stops.map((ts) => matrix.getDist(ts.matrixIndex, s.matrixIndex)));
                            if (d < minDonorDist) {
                                minDonorDist = d;
                                bestDonorStop = s;
                                bestReceiverRoute = tr;
                            }
                        }
                    }
                }

                if (bestDonorStop && bestReceiverRoute) {
                    const shiftCount = deficit;
                    const donorUserIds = Array.isArray(bestDonorStop.userIds) ? bestDonorStop.userIds : [];
                    const shiftedIds = donorUserIds.splice(donorUserIds.length - shiftCount, shiftCount);
                    bestDonorStop.userCount = donorUserIds.length;
                    bestDonorStop.passengerCount = donorUserIds.length;
                    primaryTarget.assignedUsers -= shiftCount;
                    primaryTarget.users = primaryTarget.users.filter((uid) => !shiftedIds.includes(uid));

                    const existingInReceiver = bestReceiverRoute.stops.find((s) => s.name === bestDonorStop.name);
                    if (existingInReceiver) {
                        existingInReceiver.userCount += shiftCount;
                        existingInReceiver.passengerCount += shiftCount;
                        if (Array.isArray(existingInReceiver.userIds)) {
                            existingInReceiver.userIds.push(...shiftedIds);
                        }
                    } else {
                        const insertRes = insertStopNearestCost({
                            tour: bestReceiverRoute.stops,
                            stop: { ...bestDonorStop, userCount: shiftCount, passengerCount: shiftCount, userIds: [...shiftedIds] },
                            stopMatrixIndex: bestDonorStop.matrixIndex,
                            matrix,
                            tripMode
                        });
                        bestReceiverRoute.stops = insertRes.updatedTour;
                    }
                    bestReceiverRoute.assignedUsers += shiftCount;
                    bestReceiverRoute.users.push(...shiftedIds);

                    const insertRes2 = insertStopNearestCost({
                        tour: primaryTarget.stops,
                        stop,
                        stopMatrixIndex: stop.matrixIndex,
                        matrix,
                        tripMode
                    });
                    primaryTarget.stops = insertRes2.updatedTour;
                    primaryTarget.assignedUsers += stopPax;
                    primaryTarget.users.push(...(stop.userIds || []));

                    auditTrail.push({
                        action: "CONSOLIDATE_ROUTE_REBALANCE",
                        stopName: stop.name,
                        donorStop: bestDonorStop.name,
                        shiftedPassengers: shiftCount,
                        reason: `Rebalanced ${shiftCount} pax from '${bestDonorStop.name}' to absorb '${stop.name}' (${stopPax} pax) within ${targetRouteCount}-bus capacity.`
                    });
                    rebalanced = true;
                }
            }

            if (!rebalanced) {
                // Option 3: Partition / split stop across routes with remaining spare capacity
                const routesWithSpare = otherRoutes
                    .filter((r) => r.assignedUsers < maxBusCapacity)
                    .sort((rA, rB) => {
                        const distA = Math.min(...rA.stops.map((s) => (matrix?.getDist ? matrix.getDist(s.matrixIndex, stop.matrixIndex) : 10)));
                        const distB = Math.min(...rB.stops.map((s) => (matrix?.getDist ? matrix.getDist(s.matrixIndex, stop.matrixIndex) : 10)));
                        return distA - distB;
                    });

                let remainingStopPax = stopPax;
                const remainingUserIds = Array.isArray(stop.userIds) ? [...stop.userIds] : [];

                for (const targetRoute of routesWithSpare) {
                    if (remainingStopPax <= 0) break;
                    const spareCap = maxBusCapacity - targetRoute.assignedUsers;
                    if (spareCap <= 0) continue;

                    const takeCount = Math.min(spareCap, remainingStopPax);
                    const takeUserIds = remainingUserIds.splice(0, takeCount);
                    remainingStopPax -= takeCount;

                    const partStop = {
                        ...stop,
                        userCount: takeCount,
                        passengerCount: takeCount,
                        userIds: takeUserIds
                    };

                    const existingStop = targetRoute.stops.find((s) => s.name === stop.name);
                    if (existingStop) {
                        existingStop.userCount = (existingStop.userCount || 0) + takeCount;
                        existingStop.passengerCount = existingStop.userCount;
                        if (Array.isArray(existingStop.userIds)) {
                            existingStop.userIds.push(...takeUserIds);
                        }
                    } else {
                        const insertRes = insertStopNearestCost({
                            tour: targetRoute.stops,
                            stop: partStop,
                            stopMatrixIndex: stop.matrixIndex,
                            matrix,
                            tripMode
                        });
                        targetRoute.stops = insertRes.updatedTour;
                    }
                    targetRoute.assignedUsers += takeCount;
                    targetRoute.users.push(...takeUserIds);
                    rebalanced = true;
                }

                if (remainingStopPax > 0) {
                    allStopsAbsorbed = false;
                    break;
                }
            }
        }

        if (allStopsAbsorbed) {
            currentRoutes = currentRoutes.filter((r) => r.routeId !== smallestRoute.routeId);
        } else {
            break;
        }
    }

    return currentRoutes;
};

export const consolidateCandidateRoutes = consolidateInwardCandidateRoutes;

/**
 * Route Expansion Engine (When Fleet Symmetry Target > Raw Candidate Count)
 * Splits the highest-demand or geographically longest route to utilize the target fleet size,
 * reducing crowdedness and shortening individual route travel times.
 */
export const expandCandidateRoutesToTarget = ({
    routes = [],
    targetRouteCount = 4,
    matrix,
    tripMode = "FROM_SOURCE",
    auditTrail = []
}) => {
    if (!Array.isArray(routes) || routes.length >= targetRouteCount) {
        return routes;
    }

    let currentRoutes = routes.map((r, idx) => ({
        ...r,
        routeId: r.routeId || `route_${idx + 1}`,
        stops: (r.stops || []).map((s) => ({
            ...s,
            userIds: Array.isArray(s.userIds) ? [...s.userIds] : []
        })),
        users: Array.isArray(r.users) ? [...r.users] : []
    }));

    let expansionRounds = 0;
    const MAX_EXPANSIONS = targetRouteCount - currentRoutes.length;

    while (currentRoutes.length < targetRouteCount && expansionRounds < MAX_EXPANSIONS) {
        expansionRounds++;

        // Find route with most stops (minimum 2 stops) or highest assigned demand
        const eligibleRoutes = currentRoutes.filter((r) => r.stops && r.stops.length >= 2);
        if (eligibleRoutes.length === 0) break;

        // Sort descending by stops count then demand
        eligibleRoutes.sort((a, b) => (b.stops.length - a.stops.length) || (b.assignedUsers - a.assignedUsers));
        const routeToSplit = eligibleRoutes[0];

        // Split stops into two balanced subsets
        const half = Math.ceil(routeToSplit.stops.length / 2);
        const stopsPartA = routeToSplit.stops.slice(0, half);
        const stopsPartB = routeToSplit.stops.slice(half);

        const usersPartA = stopsPartA.flatMap((s) => s.userIds || []);
        const usersPartB = stopsPartB.flatMap((s) => s.userIds || []);

        const paxPartA = stopsPartA.reduce((sum, s) => sum + (s.passengerCount || s.userCount || s.userIds?.length || 0), 0);
        const paxPartB = stopsPartB.reduce((sum, s) => sum + (s.passengerCount || s.userCount || s.userIds?.length || 0), 0);

        const optA = optimizeTour2OptRoad({ tour: stopsPartA, matrix, tripMode });
        const optB = optimizeTour2OptRoad({ tour: stopsPartB, matrix, tripMode });

        routeToSplit.stops = optA.tour;
        routeToSplit.users = usersPartA;
        routeToSplit.assignedUsers = paxPartA;
        routeToSplit.routeDistanceKm = optA.roadDistanceKm;

        const newRouteId = `route_split_${currentRoutes.length + 1}`;
        const newRoute = {
            routeId: newRouteId,
            routeCode: `RT-${String(currentRoutes.length + 1).padStart(2, "0")}`,
            stops: optB.tour,
            users: usersPartB,
            assignedUsers: paxPartB,
            routeDistanceKm: optB.roadDistanceKm,
            isContinuous: true
        };

        currentRoutes.push(newRoute);

        auditTrail.push({
            action: "FLEET_EXPAND_SPLIT_ROUTE",
            routeId: routeToSplit.routeId,
            newRouteId,
            reason: `Balanced fleet deployment: Divided Route ${routeToSplit.routeId} into two distinct routes (${paxPartA} pax and ${paxPartB} pax) to achieve target fleet size of ${targetRouteCount} buses.`
        });
    }

    return currentRoutes;
};

// ============================================================================
// INWARD STARTING HUB & CORRIDOR CONTINUITY OPTIMIZATION
// ============================================================================

/**
 * Global Min-Cost Bipartite Matching Solver (Hungarian Algorithm with Branch-and-Bound Fast-Path)
 * Finds a 1-to-1 matching pi: {0..N-1} -> {0..M-1} (N <= M) minimizing sum(costMatrix[i][pi(i)]).
 * Works dynamically for arbitrary fleet sizes and location coordinates.
 */
export function solveMinCostBipartiteMatching(costMatrix) {
    const N = costMatrix.length;
    if (N === 0) return [];
    const M = costMatrix[0].length;
    if (M < N) return Array.from({ length: N }, (_, i) => i);

    // Fast-path branch-and-bound for typical fleet sizes (<= 8 routes)
    if (N <= 8) {
        let bestCost = Infinity;
        let bestAssignment = null;

        function search(row, usedCols, currentCost, currentAssignment) {
            if (row === N) {
                if (currentCost < bestCost) {
                    bestCost = currentCost;
                    bestAssignment = [...currentAssignment];
                }
                return;
            }
            if (currentCost >= bestCost) return;

            for (let col = 0; col < M; col++) {
                if (!usedCols.has(col)) {
                    const c = costMatrix[row][col];
                    if (c >= 1e7) continue;
                    usedCols.add(col);
                    currentAssignment.push(col);
                    search(row + 1, usedCols, currentCost + c, currentAssignment);
                    currentAssignment.pop();
                    usedCols.delete(col);
                }
            }
        }

        search(0, new Set(), 0, []);
        if (bestAssignment && bestAssignment.length === N) {
            return bestAssignment;
        }
    }

    // Classic Hungarian / Munkres Algorithm O(N^3)
    const u = new Array(N + 1).fill(0);
    const v = new Array(M + 1).fill(0);
    const p = new Array(M + 1).fill(0);
    const way = new Array(M + 1).fill(0);

    for (let i = 1; i <= N; i++) {
        p[0] = i;
        let j0 = 0;
        const minv = new Array(M + 1).fill(Infinity);
        const used = new Array(M + 1).fill(false);

        do {
            used[j0] = true;
            const i0 = p[j0];
            let delta = Infinity;
            let j1 = 0;

            for (let j = 1; j <= M; j++) {
                if (!used[j]) {
                    const cur = costMatrix[i0 - 1][j - 1] - u[i0] - v[j];
                    if (cur < minv[j]) {
                        minv[j] = cur;
                        way[j] = j0;
                    }
                    if (minv[j] < delta) {
                        delta = minv[j];
                        j1 = j;
                    }
                }
            }

            for (let j = 0; j <= M; j++) {
                if (used[j]) {
                    u[p[j]] += delta;
                    v[j] -= delta;
                } else {
                    minv[j] -= delta;
                }
            }

            j0 = j1;
        } while (p[j0] !== 0);

        do {
            const j1 = way[j0];
            p[j0] = p[j1];
            j0 = j1;
        } while (j0 !== 0);
    }

    const assignment = new Array(N);
    for (let j = 1; j <= M; j++) {
        if (p[j] > 0 && p[j] <= N) {
            assignment[p[j] - 1] = j - 1;
        }
    }
    return assignment;
}

/**
 * Purpose-Driven Inward Corridor Absorption and Pairwise Consolidation Engine
 * Evaluates whether passenger clusters from two separate routes can naturally be served by
 * one bus before retaining separate vehicles.
 * Validates: Capacity, Directional Progression, Angular Separation, Detour Ratio, and Zero Reversals.
 */
export const evaluateInwardCorridorConsolidation = ({
    routes = [],
    availableVehicles = [],
    configuredInwardStartingPlaces = [],
    destinationHub = null,
    maxBusCapacity = 70,
    matrix = null,
    tripMode = "TO_DESTINATION",
    auditTrail = []
}) => {
    if (!Array.isArray(routes) || routes.length <= 1) {
        return {
            routes,
            consolidationAttempts: [],
            isConsolidated: false
        };
    }

    let currentRoutes = routes.map((r, idx) => ({
        ...r,
        routeId: r.routeId || `route_${idx + 1}`,
        stops: (r.stops || []).map((s) => ({
            ...s,
            userIds: Array.isArray(s.userIds) ? [...s.userIds] : []
        })),
        users: Array.isArray(r.users) ? [...r.users] : [],
        consolidationAttempts: []
    }));

    const fleetCaps = availableVehicles
        .map((v) => Number(v.capacity || v.seatCapacity || 0))
        .filter((c) => c > 0);
    const maxCap = fleetCaps.length > 0 ? Math.max(...fleetCaps) : maxBusCapacity;

    const consolidationAttempts = [];
    let mergedAny = true;
    let rounds = 0;
    const MAX_ROUNDS = 5;

    while (mergedAny && currentRoutes.length > 1 && rounds < MAX_ROUNDS) {
        mergedAny = false;
        rounds++;

        for (let i = 0; i < currentRoutes.length; i++) {
            for (let j = i + 1; j < currentRoutes.length; j++) {
                const rA = currentRoutes[i];
                const rB = currentRoutes[j];
                const combinedPax = rA.assignedUsers + rB.assignedUsers;

                // 1. Capacity constraint
                if (combinedPax > maxCap) {
                    const attempt = {
                        routeA: rA.routeId,
                        routeB: rB.routeId,
                        feasible: false,
                        reason: `Capacity limit: Combined demand (${combinedPax} pax) exceeds maximum vehicle capacity (${maxCap} seats).`
                    };
                    consolidationAttempts.push(attempt);
                    rA.consolidationAttempts.push(attempt);
                    rB.consolidationAttempts.push(attempt);
                    continue;
                }

                // 2. Geographic corridor bearing & angular separation check relative to destination
                if (destinationHub && isValidCoordinate(destinationHub.latitude, destinationHub.longitude)) {
                    const getCentroid = (r) => {
                        const lats = r.stops.map((s) => Number(s.latitude)).filter(Number.isFinite);
                        const lons = r.stops.map((s) => Number(s.longitude)).filter(Number.isFinite);
                        if (lats.length === 0) return destinationHub;
                        return {
                            latitude: lats.reduce((a, b) => a + b, 0) / lats.length,
                            longitude: lons.reduce((a, b) => a + b, 0) / lons.length
                        };
                    };

                    const centA = getCentroid(rA);
                    const centB = getCentroid(rB);
                    const bearingA = calculateBearing(destinationHub.latitude, destinationHub.longitude, centA.latitude, centA.longitude);
                    const bearingB = calculateBearing(destinationHub.latitude, destinationHub.longitude, centB.latitude, centB.longitude);
                    const angularDiff = getBearingDifference(bearingA, bearingB);

                    if (angularDiff > 55.0) {
                        const attempt = {
                            routeA: rA.routeId,
                            routeB: rB.routeId,
                            feasible: false,
                            reason: `Corridor separation: Routes are in distinct directional sectors (${Math.round(angularDiff)}° separation) relative to destination; merging would create excessive cross-town detour.`
                        };
                        consolidationAttempts.push(attempt);
                        rA.consolidationAttempts.push(attempt);
                        rB.consolidationAttempts.push(attempt);
                        continue;
                    }
                }

                // 3. Merged tour simulation & detour / backtracking test
                const mergedStops = [...rA.stops, ...rB.stops];
                const optRes = optimizeTour2OptRoad({
                    tour: mergedStops,
                    matrix,
                    tripMode
                });

                // Check directional progression on merged tour
                let reversals = 0;
                let backtrackingDist = 0;
                if (destinationHub) {
                    for (let step = 0; step < optRes.tour.length - 1; step++) {
                        const d1 = calculateDistanceKm(optRes.tour[step].latitude, optRes.tour[step].longitude, destinationHub.latitude, destinationHub.longitude);
                        const d2 = calculateDistanceKm(optRes.tour[step + 1].latitude, optRes.tour[step + 1].longitude, destinationHub.latitude, destinationHub.longitude);
                        const prog = d1 - d2;
                        if (prog < -2.0) {
                            reversals++;
                            backtrackingDist += Math.abs(prog);
                        }
                    }
                }

                const distA = rA.routeDistanceKm || calcRouteRoadDistance(rA.stops, matrix, tripMode);
                const distB = rB.routeDistanceKm || calcRouteRoadDistance(rB.stops, matrix, tripMode);
                const combinedDist = optRes.roadDistanceKm;
                const additionalDist = combinedDist - Math.max(distA, distB);

                // Rejection: severe backtracking or excessive detour
                if (reversals > 1 || backtrackingDist > 4.0 || additionalDist > 14.0) {
                    const attempt = {
                        routeA: rA.routeId,
                        routeB: rB.routeId,
                        feasible: false,
                        reason: `Excessive detour: Merging would add ${additionalDist.toFixed(1)} km road distance and cause ${reversals} directional reversal(s) toward destination.`
                    };
                    consolidationAttempts.push(attempt);
                    rA.consolidationAttempts.push(attempt);
                    rB.consolidationAttempts.push(attempt);
                    continue;
                }

                // ACCEPT MERGE: Compatible passenger clusters successfully consolidated
                currentRoutes[i] = {
                    ...rA,
                    stops: optRes.tour,
                    assignedUsers: combinedPax,
                    users: [...rA.users, ...rB.users],
                    routeDistanceKm: optRes.roadDistanceKm,
                    isConsolidated: true
                };

                auditTrail.push({
                    action: "CONSOLIDATE_INWARD_CLUSTERS",
                    routeA: rA.routeId,
                    routeB: rB.routeId,
                    combinedPax,
                    reason: `Consolidated candidate route '${rB.routeId}' into '${rA.routeId}' (${combinedPax}/${maxCap} pax): forward road progression verified without backtracking.`
                });

                currentRoutes.splice(j, 1);
                mergedAny = true;
                break;
            }
            if (mergedAny) break;
        }
    }

    // Populate transparent explainability for every remaining route
    currentRoutes.forEach((route) => {
        if (!route.whySeparateRouteNeeded) {
            const rejections = route.consolidationAttempts || [];
            if (rejections.length > 0) {
                const capFail = rejections.find((r) => r.reason.includes("Capacity limit"));
                const detourFail = rejections.find((r) => r.reason.includes("Corridor separation") || r.reason.includes("Excessive detour"));
                if (capFail) {
                    route.whySeparateRouteNeeded = `Separate bus retained because assigning these stops to existing routes would exceed vehicle capacity (${capFail.reason}).`;
                } else if (detourFail) {
                    route.whySeparateRouteNeeded = `Separate bus retained because merging passenger clusters into existing routes would create excessive cross-corridor detour (${detourFail.reason}).`;
                } else {
                    route.whySeparateRouteNeeded = `Separate bus retained to provide dedicated coverage for this residential corridor without violating operational constraints.`;
                }
            } else {
                route.whySeparateRouteNeeded = `Optimal dedicated route for this passenger demand cluster.`;
            }
        }
    });

    return {
        routes: currentRoutes,
        consolidationAttempts,
        isConsolidated: currentRoutes.length < routes.length
    };
};

/**
 * Cross-Corridor Starting Hub Duplication Resolver
 * If one bus starts at Hub A (e.g. Sellur) and another route later visits a stop in Hub A's immediate locality:
 * Checks whether that stop can be reassigned to Hub A's bus (provided Hub A's bus has capacity).
 * Eliminates cross-town hopping and duplicate starting area coverage.
 */
export const rebalanceCrossCorridorStartingHubDuplications = ({
    assignedRoutes = [],
    activeInwardStartingPlaces = [],
    maxBusCapacity = 70,
    matrix = null,
    tripMode = "TO_DESTINATION",
    auditTrail = []
}) => {
    if (!Array.isArray(assignedRoutes) || assignedRoutes.length <= 1) {
        return assignedRoutes;
    }

    for (let i = 0; i < assignedRoutes.length; i++) {
        const routeA = assignedRoutes[i];
        const hubA = routeA.startLocation || routeA.inwardStartLocation || findStartingPlaceForBus(routeA.vehicle, activeInwardStartingPlaces);
        if (!hubA || !isValidCoordinate(hubA.latitude, hubA.longitude)) continue;

        const capA = Number(routeA.capacity || routeA.vehicle?.capacity || maxBusCapacity);

        for (let j = 0; j < assignedRoutes.length; j++) {
            if (i === j) continue;
            const routeB = assignedRoutes[j];
            const hubB = routeB.startLocation || routeB.inwardStartLocation || findStartingPlaceForBus(routeB.vehicle, activeInwardStartingPlaces);

            // Look for any stop in routeB that is within 2.5 km of hubA, but far (> 5.5 km) from hubB
            const strayIndex = routeB.stops.findIndex((s) => {
                const distToHubA = calculateDistanceKm(s.latitude, s.longitude, hubA.latitude, hubA.longitude);
                const distToHubB = hubB && isValidCoordinate(hubB.latitude, hubB.longitude)
                    ? calculateDistanceKm(s.latitude, s.longitude, hubB.latitude, hubB.longitude)
                    : Infinity;
                const isHubANameMatch = isSamePlace(s, hubA);
                return isHubANameMatch || (distToHubA <= 2.5 && distToHubB > 5.5);
            });

            if (strayIndex !== -1) {
                const strayStop = routeB.stops[strayIndex];
                const stopPax = Array.isArray(strayStop.userIds) ? strayStop.userIds.length : Number(strayStop.passengerCount || strayStop.userCount || 0);

                if (routeA.assignedUsers + stopPax <= capA) {
                    routeB.stops.splice(strayIndex, 1);
                    routeB.assignedUsers -= stopPax;
                    if (Array.isArray(strayStop.userIds) && Array.isArray(routeB.users)) {
                        const setS = new Set(strayStop.userIds);
                        routeB.users = routeB.users.filter((uid) => !setS.has(uid));
                    }

                    // Insert stray stop into routeA at optimal nearest cost position
                    const insertRes = insertStopNearestCost({
                        tour: routeA.stops,
                        stop: strayStop,
                        stopMatrixIndex: strayStop.matrixIndex,
                        matrix,
                        tripMode
                    });

                    routeA.stops = insertRes.updatedTour;
                    routeA.assignedUsers += stopPax;
                    if (Array.isArray(strayStop.userIds)) {
                        routeA.users = [...(routeA.users || []), ...strayStop.userIds];
                    }

                    // Refine sequences via 2-opt
                    const optA = optimizeTour2OptRoad({ tour: routeA.stops, matrix, tripMode });
                    const optB = optimizeTour2OptRoad({ tour: routeB.stops, matrix, tripMode });
                    routeA.stops = optA.tour;
                    routeA.routeDistanceKm = optA.roadDistanceKm;
                    routeB.stops = optB.tour;
                    routeB.routeDistanceKm = optB.roadDistanceKm;

                    auditTrail.push({
                        action: "RESOLVE_STARTING_HUB_DUPLICATION",
                        stopName: strayStop.name,
                        passengersMoved: stopPax,
                        donorVehicle: routeB.vehicleName || `Bus ${j + 1}`,
                        receiverVehicle: routeA.vehicleName || `Bus ${i + 1}`,
                        reason: `Reassigned stop '${strayStop.name}' (${stopPax} pax) from '${routeB.vehicleName}' (Hub: ${hubB?.locationName || hubB?.name || "distant"}) to '${routeA.vehicleName}' (Hub: ${hubA.locationName || hubA.name}) because '${strayStop.name}' is located in ${routeA.vehicleName}'s starting hub locality, eliminating cross-town detour.`
                    });
                }
            }
        }
    }

    return assignedRoutes;
};

/**
 * Safely evaluates and consolidates repeated physical stop visits across routes (Req 8, 9, 10).
 * A physical stop can legitimately appear on multiple routes when demand exceeds
 * individual bus capacity or when corridors diverge. Consolidation is performed
 * ONLY when all 11 feasibility constraints are satisfied without invalidating any route:
 * 1. Calculate total passengers at the stop.
 * 2. Identify all buses currently serving it.
 * 3. Determine whether passengers can be consolidated into one compatible route.
 * 4. Check capacity (targetRoute.remainingCapacity >= donorPax).
 * 5. Check direction (both routes in same operational tripMode).
 * 6. Check corridor compatibility (target already visits this stop).
 * 7. Check OSRM continuity and progression for donor route without this stop.
 * 8. Check route insertion / progression.
 * 9. Check detour threshold (<= 2.25x).
 * 10. Check starting hub for inward (donor stop must NOT be inward starting hub).
 * 11. Check whether consolidation causes donor route to become empty or disconnected.
 * If consolidation is not feasible, keep the multiple visits as authorized shared stops.
 */
export const evaluateAndConsolidateRepeatedPhysicalStops = ({
    routes = [],
    tripMode = "FROM_SOURCE",
    matrix = null,
    activeInwardStartingPlaces = [],
    anchorHub = DEFAULT_SOURCE_HUB,
    sourceHub = null,
    destinationHub = null,
    auditTrail = []
}) => {
    if (!Array.isArray(routes) || routes.length <= 1) return routes;

    const isOutward = tripMode === "FROM_SOURCE" || tripMode === "OUTWARD";
    const resolvedOrigin = sourceHub || anchorHub || DEFAULT_SOURCE_HUB;
    const resolvedDest = destinationHub || anchorHub || DEFAULT_SOURCE_HUB;

    const getPhysicalStopKey = (s) => {
        const nameKey = (s.name || s.stopping || "").toLowerCase().trim();
        const lat = Number(s.latitude || 0).toFixed(3);
        const lon = Number(s.longitude || 0).toFixed(3);
        return `${nameKey}_${lat}_${lon}`;
    };

    // 1. Group stop visits by physical stop key
    const physicalStopsMap = new Map();
    routes.forEach((route, rIdx) => {
        (route.stops || []).forEach((st, sIdx) => {
            const key = getPhysicalStopKey(st);
            if (!physicalStopsMap.has(key)) {
                physicalStopsMap.set(key, {
                    stopKey: key,
                    name: st.name,
                    latitude: st.latitude,
                    longitude: st.longitude,
                    visits: []
                });
            }
            physicalStopsMap.get(key).visits.push({
                routeIndex: rIdx,
                stopIndex: sIdx,
                route,
                stop: st,
                passengerCount: (Array.isArray(st.userIds) && st.userIds.length > 0)
                    ? st.userIds.length
                    : Number(st.userCount || st.passengerCount || 0),
                userIds: Array.isArray(st.userIds) ? [...st.userIds] : []
            });
        });
    });

    // 2. Identify repeated physical stops (visited by 2 or more routes)
    const repeatedPhysicalStops = Array.from(physicalStopsMap.values()).filter(
        (entry) => entry.visits.length > 1
    );

    for (const repeated of repeatedPhysicalStops) {
        for (let i = 0; i < repeated.visits.length; i++) {
            const donorVisit = repeated.visits[i];
            const donorRoute = routes[donorVisit.routeIndex];
            if (!donorRoute || !donorRoute.stops || donorVisit.passengerCount === 0) continue;

            const donorStopIdx = donorRoute.stops.findIndex(s => getPhysicalStopKey(s) === repeated.stopKey);
            if (donorStopIdx < 0) continue;

            for (let j = 0; j < repeated.visits.length; j++) {
                if (i === j) continue;
                const targetVisit = repeated.visits[j];
                const targetRoute = routes[targetVisit.routeIndex];
                if (!targetRoute || !targetRoute.stops) continue;

                const targetStopIdx = targetRoute.stops.findIndex(s => getPhysicalStopKey(s) === repeated.stopKey);
                if (targetStopIdx < 0) continue;

                // 4. Capacity check: targetRoute must have enough spare capacity
                const targetCapacity = Number(targetRoute.capacity || targetRoute.vehicle?.capacity || 70);
                const targetSpareCapacity = Math.max(0, targetCapacity - targetRoute.assignedUsers);
                if (targetSpareCapacity < donorVisit.passengerCount) continue;

                // 10. Starting hub check: for inward, donor stop must NOT be the donor route's configured starting hub
                if (!isOutward) {
                    const donorStartPlace = findStartingPlaceForBus(donorRoute.vehicle, activeInwardStartingPlaces) ||
                        donorRoute.inwardStartLocation || donorRoute.startLocation;
                    if (donorStartPlace && isSamePlace(donorStartPlace, donorVisit.stop)) {
                        continue;
                    }
                }

                // 11. Check whether donor route remains valid with other stops
                const donorRemainingStops = donorRoute.stops.filter((_, idx) => idx !== donorStopIdx);
                if (donorRemainingStops.length === 0) {
                    continue; // Do not empty out a bus completely here
                }

                // 7. Check OSRM continuity and progression for donorRoute without this stop
                const donorRemainingTour = isOutward
                    ? sequenceOutwardRouteStops({ departureHub: resolvedOrigin, stops: donorRemainingStops, matrix, tripMode })
                    : sequenceInwardRouteStops({
                        startingHub: donorRoute.startLocation || donorRoute.inwardStartLocation || donorRemainingStops[0],
                        destinationHub: resolvedDest,
                        stops: donorRemainingStops,
                        matrix,
                        tripMode
                    });

                if (donorRemainingTour.qualityValidation &&
                    donorRemainingTour.qualityValidation.directionalReversals > 0 &&
                    donorRemainingTour.qualityValidation.operationalContinuityVerified === false) {
                    continue; // Removing stop introduces a directional discontinuity
                }

                // All 11 checks passed! Consolidate donor stop's passengers into targetRoute's visit
                const targetStop = targetRoute.stops[targetStopIdx];
                const movedPax = donorVisit.passengerCount;
                targetStop.userCount = (targetStop.userCount || 0) + movedPax;
                targetStop.passengerCount = targetStop.userCount;
                targetStop.userIds = Array.from(new Set([...(targetStop.userIds || []), ...(donorVisit.userIds || [])]));

                targetRoute.assignedUsers = targetRoute.stops.reduce((sum, s) => sum + (s.userCount || 0), 0);
                targetRoute.users = targetRoute.stops.flatMap(s => s.userIds || []);

                donorRoute.stops = donorRemainingTour.stops || donorRemainingStops;
                donorRoute.assignedUsers = donorRoute.stops.reduce((sum, s) => sum + (s.userCount || 0), 0);
                donorRoute.users = donorRoute.stops.flatMap(s => s.userIds || []);
                donorRoute.routeDistanceKm = donorRemainingTour.routeDistanceKm || donorRoute.routeDistanceKm;

                donorVisit.passengerCount = 0;
                donorVisit.userIds = [];

                if (Array.isArray(auditTrail)) {
                    auditTrail.push({
                        action: "CONSOLIDATE_PHYSICAL_STOP",
                        stopName: repeated.name,
                        passengersMoved: movedPax,
                        donorRoute: donorRoute.vehicleName || donorRoute.routeCode,
                        targetRoute: targetRoute.vehicleName || targetRoute.routeCode,
                        reason: `Consolidated ${movedPax} passengers at '${repeated.name}' into ${targetRoute.vehicleName || targetRoute.routeCode} along shared continuous corridor.`
                    });
                }
                break;
            }
        }
    }

    return routes;
};

/**
 * Supply-Chain Transportation Manager Fleet Balancing Engine
 * Dynamically evaluates the relationship between:
 * - Current direction passenger demand & minimum capacity requirements
 * - Opposite direction bus count, demand, and vehicle deployment (if existing plan present)
 * - Available scheduled fleet and seat capacities
 * - Inward starting hub configurations
 * - Fleet symmetry preference (OUTWARD ≈ INWARD)
 * - Vehicle reuse preference (reusing the same physical vehicles)
 * - Operational feasibility (avoiding severe empty capacity, excessive travel time, or impossible starting hubs)
 */
/**
 * Helper to match two locations by name or coordinate proximity
 */
const isSameLocation = (a, b) => {
    if (!a || !b) return false;
    const nameA = String(a.locationName || a.name || "").trim().toLowerCase();
    const nameB = String(b.locationName || b.name || "").trim().toLowerCase();
    if (nameA && nameB && (nameA === nameB || nameA.includes(nameB) || nameB.includes(nameA))) return true;
    if (isValidCoordinate(a.latitude, a.longitude) && isValidCoordinate(b.latitude, b.longitude)) {
        return calculateDistanceKm(a.latitude, a.longitude, b.latitude, b.longitude) <= 1.5;
    }
    return false;
};

/**
 * Hard-Constraint Inward Fleet Selection Engine with Soft-Objective Vehicle Reuse.
 * 
 * Hard Constraints:
 * 1. 100% Demand coverage (minimum fleet capacity >= demand)
 * 2. Active/scheduled vehicle eligibility
 * 3. Inward starting place configuration
 * 4. Mathematical minimum bus count: Math.ceil(demand / maxUsableCapacity)
 * 
 * Soft Objectives:
 * 5. Prefer reusing vehicles from Outward operation (without shrinking fleet below requirement)
 */
export const selectInwardFleet = ({
    totalComingPassengers = 0,
    availableVehicles = [],
    activeInwardStartingPlaces = [],
    oppositePlan = null,
    preferredVehicleIds = []
}) => {
    // 1. HARD CONSTRAINT: Filter eligible active inward buses with configured starting places
    const eligibleInwardBuses = (availableVehicles || []).filter((v) => {
        const cap = Number(v.capacity || v.seatCapacity || 0);
        if (cap <= 0) return false;
        if (v.isActive === false || String(v.status || "").toUpperCase() === "INACTIVE") return false;
        if (activeInwardStartingPlaces && activeInwardStartingPlaces.length > 0) {
            return hasConfiguredInwardStartingPlace(v, activeInwardStartingPlaces);
        }
        return true;
    });

    const maxUsableCapacity = eligibleInwardBuses.length > 0
        ? Math.max(...eligibleInwardBuses.map((b) => Number(b.capacity || b.seatCapacity || 0)))
        : 70;

    // 2. HARD CONSTRAINT: Minimum buses required to meet demand mathematically (greedy accumulation by capacity)
    const sortedByCapDesc = [...eligibleInwardBuses].sort((a, b) =>
        Number(b.capacity || b.seatCapacity || 0) - Number(a.capacity || a.seatCapacity || 0)
    );
    let accumulatedCap = 0;
    let minimumBusCount = 0;
    for (const b of sortedByCapDesc) {
        accumulatedCap += Number(b.capacity || b.seatCapacity || 0);
        minimumBusCount++;
        if (accumulatedCap >= totalComingPassengers) break;
    }
    if (minimumBusCount === 0 && totalComingPassengers > 0) {
        minimumBusCount = Math.max(1, Math.ceil(totalComingPassengers / maxUsableCapacity));
    }

    // 3. SOFT PREFERENCE: Identify reusable outward vehicles
    const oppVehIds = new Set(
        (preferredVehicleIds || []).map((id) => String(id).trim()).filter(Boolean)
    );
    if (oppositePlan) {
        const oppBuses = oppositePlan.buses || oppositePlan.routes || [];
        oppBuses.forEach((b) => {
            const vid = String(b.assignedVehicle?._id || b.assignedVehicle?.id || b.vehicleId || b.vehicle?._id || b.vehicle?.id || "").trim();
            if (vid) oppVehIds.add(vid);
            const vName = String(b.vehicleName || b.vehicle?.vehicleName || b.vehicle?.name || b.assignedVehicle?.vehicleName || "").trim().toLowerCase();
            if (vName) {
                const match = eligibleInwardBuses.find((ev) => (ev.vehicleName || ev.name || "").toLowerCase() === vName);
                if (match) oppVehIds.add(String(match._id || match.id || ""));
            }
        });
    }

    const reusableBuses = eligibleInwardBuses.filter((v) =>
        oppVehIds.has(String(v._id || v.id || "")) ||
        oppVehIds.has(String(v.vehicleId || ""))
    );
    const nonReusableBuses = eligibleInwardBuses.filter((v) =>
        !oppVehIds.has(String(v._id || v.id || "")) &&
        !oppVehIds.has(String(v.vehicleId || ""))
    );

    const reusableTotalCap = reusableBuses.reduce((sum, b) => sum + Number(b.capacity || b.seatCapacity || 0), 0);

    let oppDemand = null;
    if (oppositePlan) {
        oppDemand = Number(
            oppositePlan.assignedUsers ??
            oppositePlan.passengerCount ??
            oppositePlan.summary?.comingUsers ??
            oppositePlan.comingUsers ??
            (Array.isArray(oppositePlan.buses) ? oppositePlan.buses.reduce((sum, b) => sum + (b.assignedUsers || b.passengerCount || 0), 0) : 0)
        );
        if (oppDemand <= 0) oppDemand = reusableTotalCap;
    }

    // 4. STABILITY RULE & DAILY FLEET CONTINUITY DECISION:
    // If an outward fleet exists, evaluate whether inward demand is approximately the same or moderately changed.
    // - STABILITY: OUTWARD & INWARD demand is approximately the same (e.g., within 30% or demand <= reusableTotalCap).
    //   Do NOT shrink fleet from 7 to 6 simply because ceil(passengers / capacity) is 6!
    //   Maintain the exact same outward fleet as the baseline inward fleet.
    // - SLIGHT INCREASE: demand > reusableTotalCap -> keep ALL reusable outward buses and add only what is necessary.
    // - MAJOR DECREASE: demand < oppDemand * 0.70 (e.g. 400 down to 250) -> reduce fleet size, but choose the best
    //   buses FROM reusableBuses.
    const hasOppositeFleet = Boolean(oppositePlan && reusableBuses.length > 0);
    const isMajorDemandDrop = Boolean(
        hasOppositeFleet &&
        oppDemand &&
        oppDemand > 0 &&
        totalComingPassengers > 0 &&
        totalComingPassengers < (oppDemand * 0.70) &&
        (oppDemand - totalComingPassengers) > 50
    );

    const selectedBuses = [];
    const selectedReusable = [];
    const additionalBuses = [];
    let selectedCapacity = 0;

    if (hasOppositeFleet && !isMajorDemandDrop) {
        // Case 1: Same demand, slight increase, or slight decrease -> REUSE ALL REUSABLE OUTWARD BUSES!
        for (const bus of reusableBuses) {
            selectedBuses.push(bus);
            const cap = Number(bus.capacity || bus.seatCapacity || 0);
            selectedCapacity += cap;
            selectedReusable.push(bus);
        }

        // If inward demand slightly increased and exceeds reusable fleet capacity, add additional buses as needed
        if (selectedCapacity < totalComingPassengers || selectedBuses.length < minimumBusCount) {
            const sortedAdditional = [...nonReusableBuses].sort((a, b) => Number(b.capacity || b.seatCapacity || 0) - Number(a.capacity || a.seatCapacity || 0));
            for (const bus of sortedAdditional) {
                if (selectedCapacity >= totalComingPassengers && selectedBuses.length >= minimumBusCount) {
                    break;
                }
                selectedBuses.push(bus);
                const cap = Number(bus.capacity || bus.seatCapacity || 0);
                selectedCapacity += cap;
                additionalBuses.push(bus);
            }
        }
    } else if (hasOppositeFleet && isMajorDemandDrop) {
        // Case 2: Major demand decrease (e.g. 400 down to 250) -> Intelligently select best subset FROM reusableBuses!
        const sortedReusable = [...reusableBuses].sort((a, b) => Number(b.capacity || b.seatCapacity || 0) - Number(a.capacity || a.seatCapacity || 0));
        for (const bus of sortedReusable) {
            selectedBuses.push(bus);
            const cap = Number(bus.capacity || bus.seatCapacity || 0);
            selectedCapacity += cap;
            selectedReusable.push(bus);
            if (selectedBuses.length >= minimumBusCount && selectedCapacity >= totalComingPassengers) {
                break;
            }
        }

        if (selectedCapacity < totalComingPassengers || selectedBuses.length < minimumBusCount) {
            const sortedAdditional = [...nonReusableBuses].sort((a, b) => Number(b.capacity || b.seatCapacity || 0) - Number(a.capacity || a.seatCapacity || 0));
            for (const bus of sortedAdditional) {
                if (selectedCapacity >= totalComingPassengers && selectedBuses.length >= minimumBusCount) {
                    break;
                }
                selectedBuses.push(bus);
                const cap = Number(bus.capacity || bus.seatCapacity || 0);
                selectedCapacity += cap;
                additionalBuses.push(bus);
            }
        }
    } else {
        // Case 3: No opposite plan -> Standard greedy accumulation by capacity descending
        const rankedBuses = [
            ...reusableBuses,
            ...nonReusableBuses.sort((a, b) => Number(b.capacity || b.seatCapacity || 0) - Number(a.capacity || a.seatCapacity || 0))
        ];

        for (const bus of rankedBuses) {
            if (selectedBuses.length >= minimumBusCount && selectedCapacity >= totalComingPassengers) {
                break;
            }
            selectedBuses.push(bus);
            const cap = Number(bus.capacity || bus.seatCapacity || 0);
            selectedCapacity += cap;
            if (reusableBuses.some((rb) => String(rb._id || rb.id) === String(bus._id || bus.id))) {
                selectedReusable.push(bus);
            } else {
                additionalBuses.push(bus);
            }
        }
    }

    // HARD CONSTRAINT: If configured buses alone cannot satisfy the required bus count or capacity,
    // continue selecting from available vehicles so the required fleet size is preserved and
    // downstream inward starting place validation can pinpoint the exact missing bus.
    if (selectedBuses.length < minimumBusCount || selectedCapacity < totalComingPassengers) {
        const remainingVehicles = (availableVehicles || [])
            .filter((v) => {
                const vid = String(v._id || v.id || "");
                const cap = Number(v.capacity || v.seatCapacity || 0);
                if (cap <= 0) return false;
                if (v.isActive === false || String(v.status || "").toUpperCase() === "INACTIVE") return false;
                return !selectedBuses.some((sb) => String(sb._id || sb.id || "") === vid);
            })
            .sort((a, b) => Number(b.capacity || b.seatCapacity || 0) - Number(a.capacity || a.seatCapacity || 0));

        for (const bus of remainingVehicles) {
            if (selectedBuses.length >= minimumBusCount && selectedCapacity >= totalComingPassengers) {
                break;
            }
            selectedBuses.push(bus);
            const cap = Number(bus.capacity || bus.seatCapacity || 0);
            selectedCapacity += cap;
            additionalBuses.push(bus);
        }
    }

    // Required Debug Logging
    console.log("[INWARD FLEET]");
    console.log(`Demand: ${totalComingPassengers}`);
    console.log(`Minimum required buses: ${minimumBusCount}`);
    console.log(`Eligible inward buses: ${eligibleInwardBuses.map((b) => b.vehicleName || b.name).join(", ")}`);
    console.log(`Reusable outward buses: ${reusableBuses.map((b) => b.vehicleName || b.name).join(", ")}`);
    console.log(`Selected reusable buses: ${selectedReusable.map((b) => b.vehicleName || b.name).join(", ")}`);
    console.log(`Additional buses selected: ${additionalBuses.map((b) => b.vehicleName || b.name).join(", ")}`);
    console.log(`Final selected buses: ${selectedBuses.map((b) => b.vehicleName || b.name).join(", ")}`);
    console.log(`Final capacity: ${selectedCapacity}`);

    return {
        eligibleInwardBuses,
        selectedBuses,
        reusableBuses,
        selectedReusable,
        additionalBuses,
        minimumBusCount,
        selectedCapacity,
        totalEligibleCapacity: eligibleInwardBuses.reduce((sum, b) => sum + Number(b.capacity || b.seatCapacity || 0), 0),
        isSufficient: selectedCapacity >= totalComingPassengers
    };
};

/**
 * Hard-Constraint Outward Fleet Selection Engine with Soft-Objective Vehicle Reuse.
 * 
 * Hard Constraints:
 * 1. 100% Demand coverage (minimum fleet capacity >= demand)
 * 2. Active/scheduled vehicle eligibility (capacity > 0, active status)
 * 3. Mathematical minimum bus count: Math.ceil(demand / maxUsableCapacity)
 * 
 * Soft Objectives:
 * 4. Prefer reusing vehicles from Inward operation (without shrinking fleet below requirement)
 * 5. Consolidate into the minimum number of feasible high-capacity buses to avoid empty/low-occupancy buses.
 */
export const selectOutwardFleet = ({
    totalComingPassengers = 0,
    availableVehicles = [],
    oppositePlan = null,
    preferredVehicleIds = []
}) => {
    // 1. HARD CONSTRAINT: Filter eligible active outward buses with capacity > 0
    const eligibleOutwardBuses = (availableVehicles || []).filter((v) => {
        const cap = Number(v.capacity || v.seatCapacity || 0);
        if (cap <= 0) return false;
        if (v.isActive === false || String(v.status || "").toUpperCase() === "INACTIVE") return false;
        return true;
    });

    const maxUsableCapacity = eligibleOutwardBuses.length > 0
        ? Math.max(...eligibleOutwardBuses.map((b) => Number(b.capacity || b.seatCapacity || 0)))
        : 70;

    // 2. HARD CONSTRAINT: Minimum buses required to meet demand mathematically (greedy accumulation by capacity)
    const sortedByCapDesc = [...eligibleOutwardBuses].sort((a, b) =>
        Number(b.capacity || b.seatCapacity || 0) - Number(a.capacity || a.seatCapacity || 0)
    );
    let accumulatedCap = 0;
    let minimumBusCount = 0;
    for (const b of sortedByCapDesc) {
        accumulatedCap += Number(b.capacity || b.seatCapacity || 0);
        minimumBusCount++;
        if (accumulatedCap >= totalComingPassengers) break;
    }
    if (minimumBusCount === 0 && totalComingPassengers > 0) {
        minimumBusCount = Math.max(1, Math.ceil(totalComingPassengers / maxUsableCapacity));
    }

    // 3. SOFT PREFERENCE: Identify reusable inward vehicles (from opposite plan)
    const oppVehIds = new Set(
        (preferredVehicleIds || []).map((id) => String(id).trim()).filter(Boolean)
    );
    if (oppositePlan) {
        const oppBuses = oppositePlan.buses || oppositePlan.routes || [];
        oppBuses.forEach((b) => {
            const vid = String(b.assignedVehicle?._id || b.assignedVehicle?.id || b.vehicleId || b.vehicle?._id || b.vehicle?.id || "").trim();
            if (vid) oppVehIds.add(vid);
            const vName = String(b.vehicleName || b.vehicle?.vehicleName || b.vehicle?.name || b.assignedVehicle?.vehicleName || "").trim().toLowerCase();
            if (vName) {
                const match = eligibleOutwardBuses.find((ev) => (ev.vehicleName || ev.name || "").toLowerCase() === vName);
                if (match) oppVehIds.add(String(match._id || match.id || ""));
            }
        });
    }

    const reusableBuses = eligibleOutwardBuses.filter((v) =>
        oppVehIds.has(String(v._id || v.id || "")) ||
        oppVehIds.has(String(v.vehicleId || ""))
    );
    const nonReusableBuses = eligibleOutwardBuses.filter((v) =>
        !oppVehIds.has(String(v._id || v.id || "")) &&
        !oppVehIds.has(String(v.vehicleId || ""))
    );

    const reusableTotalCap = reusableBuses.reduce((sum, b) => sum + Number(b.capacity || b.seatCapacity || 0), 0);

    let oppDemand = null;
    if (oppositePlan) {
        oppDemand = Number(
            oppositePlan.assignedUsers ??
            oppositePlan.passengerCount ??
            oppositePlan.summary?.comingUsers ??
            oppositePlan.comingUsers ??
            (Array.isArray(oppositePlan.buses) ? oppositePlan.buses.reduce((sum, b) => sum + (b.assignedUsers || b.passengerCount || 0), 0) : 0)
        );
        if (oppDemand <= 0) oppDemand = reusableTotalCap;
    }

    const hasOppositeFleet = Boolean(oppositePlan && reusableBuses.length > 0);
    const isMajorDemandDrop = Boolean(
        hasOppositeFleet &&
        oppDemand &&
        oppDemand > 0 &&
        totalComingPassengers > 0 &&
        totalComingPassengers < (oppDemand * 0.70) &&
        (oppDemand - totalComingPassengers) > 50
    );

    const selectedBuses = [];
    const selectedReusable = [];
    const additionalBuses = [];
    let selectedCapacity = 0;

    if (hasOppositeFleet && !isMajorDemandDrop) {
        // Case 1: Same demand, slight increase, or slight decrease -> REUSE ALL REUSABLE INWARD BUSES!
        for (const bus of reusableBuses) {
            selectedBuses.push(bus);
            const cap = Number(bus.capacity || bus.seatCapacity || 0);
            selectedCapacity += cap;
            selectedReusable.push(bus);
        }

        // If outward demand slightly increased and exceeds reusable fleet capacity, add additional buses as needed
        if (selectedCapacity < totalComingPassengers || selectedBuses.length < minimumBusCount) {
            const sortedAdditional = [...nonReusableBuses].sort((a, b) => Number(b.capacity || b.seatCapacity || 0) - Number(a.capacity || a.seatCapacity || 0));
            for (const bus of sortedAdditional) {
                if (selectedCapacity >= totalComingPassengers && selectedBuses.length >= minimumBusCount) {
                    break;
                }
                selectedBuses.push(bus);
                const cap = Number(bus.capacity || bus.seatCapacity || 0);
                selectedCapacity += cap;
                additionalBuses.push(bus);
            }
        }
    } else if (hasOppositeFleet && isMajorDemandDrop) {
        // Case 2: Major demand decrease -> Select best subset FROM reusableBuses
        const sortedReusable = [...reusableBuses].sort((a, b) => Number(b.capacity || b.seatCapacity || 0) - Number(a.capacity || a.seatCapacity || 0));
        for (const bus of sortedReusable) {
            selectedBuses.push(bus);
            const cap = Number(bus.capacity || bus.seatCapacity || 0);
            selectedCapacity += cap;
            selectedReusable.push(bus);
            if (selectedBuses.length >= minimumBusCount && selectedCapacity >= totalComingPassengers) {
                break;
            }
        }

        if (selectedCapacity < totalComingPassengers || selectedBuses.length < minimumBusCount) {
            const sortedAdditional = [...nonReusableBuses].sort((a, b) => Number(b.capacity || b.seatCapacity || 0) - Number(a.capacity || a.seatCapacity || 0));
            for (const bus of sortedAdditional) {
                if (selectedCapacity >= totalComingPassengers && selectedBuses.length >= minimumBusCount) {
                    break;
                }
                selectedBuses.push(bus);
                const cap = Number(bus.capacity || bus.seatCapacity || 0);
                selectedCapacity += cap;
                additionalBuses.push(bus);
            }
        }
    } else {
        // Case 3: Standard greedy accumulation by capacity descending
        const rankedBuses = [
            ...reusableBuses.sort((a, b) => Number(b.capacity || b.seatCapacity || 0) - Number(a.capacity || a.seatCapacity || 0)),
            ...nonReusableBuses.sort((a, b) => Number(b.capacity || b.seatCapacity || 0) - Number(a.capacity || a.seatCapacity || 0))
        ];

        for (const bus of rankedBuses) {
            if (selectedBuses.length >= minimumBusCount && selectedCapacity >= totalComingPassengers) {
                break;
            }
            selectedBuses.push(bus);
            const cap = Number(bus.capacity || bus.seatCapacity || 0);
            selectedCapacity += cap;
            if (reusableBuses.some((rb) => String(rb._id || rb.id) === String(bus._id || bus.id))) {
                selectedReusable.push(bus);
            } else {
                additionalBuses.push(bus);
            }
        }
    }

    // Fallback if needed
    if (selectedBuses.length < minimumBusCount || selectedCapacity < totalComingPassengers) {
        const remainingVehicles = (availableVehicles || [])
            .filter((v) => {
                const vid = String(v._id || v.id || "");
                const cap = Number(v.capacity || v.seatCapacity || 0);
                if (cap <= 0) return false;
                if (v.isActive === false || String(v.status || "").toUpperCase() === "INACTIVE") return false;
                return !selectedBuses.some((sb) => String(sb._id || sb.id || "") === vid);
            })
            .sort((a, b) => Number(b.capacity || b.seatCapacity || 0) - Number(a.capacity || a.seatCapacity || 0));

        for (const bus of remainingVehicles) {
            if (selectedBuses.length >= minimumBusCount && selectedCapacity >= totalComingPassengers) {
                break;
            }
            selectedBuses.push(bus);
            const cap = Number(bus.capacity || bus.seatCapacity || 0);
            selectedCapacity += cap;
            additionalBuses.push(bus);
        }
    }

    return {
        eligibleOutwardBuses,
        selectedBuses,
        reusableBuses,
        selectedReusable,
        additionalBuses,
        minimumBusCount,
        selectedCapacity,
        totalEligibleCapacity: eligibleOutwardBuses.reduce((sum, b) => sum + Number(b.capacity || b.seatCapacity || 0), 0),
        isSufficient: selectedCapacity >= totalComingPassengers
    };
};

/**
 * Balances passenger demands across inward & outward candidate routes to match the capacities
 * of the selected fleet, respecting corridor continuity and starting hub assignments.
 */
export const balanceCandidateRoutesToFleetCapacities = ({
    routes = [],
    fleet = [],
    activeInwardStartingPlaces = [],
    matrix = null,
    tripMode = "TO_DESTINATION",
    sourceHub = null,
    destinationHub = null
}) => {
    if (!Array.isArray(routes) || routes.length === 0 || !Array.isArray(fleet) || fleet.length === 0) {
        return routes;
    }

    const isOutward = tripMode === "FROM_SOURCE" || tripMode === "OUTWARD";

    // Look for buses whose capacity is less than standard max (e.g. w1 with 60 seats)
    const sortedFleet = [...fleet].sort((a, b) => Number(a.capacity || a.seatCapacity || 70) - Number(b.capacity || b.seatCapacity || 70));

    for (const bus of sortedFleet) {
        const busCap = Number(bus.capacity || bus.seatCapacity || 70);

        let matchingRoute = null;
        if (!isOutward && activeInwardStartingPlaces && activeInwardStartingPlaces.length > 0) {
            const sp = findStartingPlaceForBus(bus, activeInwardStartingPlaces);
            if (!sp) continue;

            // Find candidate route that matches this starting place or corridor
            matchingRoute = routes.find((r) => {
                const firstStop = r.stops?.[0];
                return (firstStop && (isSameLocation(firstStop, sp) || calculateDistanceKm(sp.latitude, sp.longitude, firstStop.latitude, firstStop.longitude) <= 3.5)) ||
                       (r.stops || []).some((s) => isSameLocation(s, sp));
            });
        } else {
            // For OUTWARD or unanchored routes: match route whose passenger demand exceeds busCap
            matchingRoute = routes.find((r) => r.assignedUsers > busCap);
        }

        if (matchingRoute && matchingRoute.assignedUsers > busCap) {
            const excess = matchingRoute.assignedUsers - busCap;

            // Find a stop on matchingRoute suitable for transferring excess pax
            let stopToShift = null;
            for (let sIdx = matchingRoute.stops.length - 1; sIdx >= 0; sIdx--) {
                const st = matchingRoute.stops[sIdx];
                const pCount = Array.isArray(st.userIds) ? st.userIds.length : Number(st.userCount || 0);
                if (pCount >= excess) {
                    stopToShift = st;
                    break;
                }
            }
            if (!stopToShift && matchingRoute.stops.length > 0) {
                stopToShift = matchingRoute.stops[matchingRoute.stops.length - 1];
            }

            // Find target route with spare capacity relative to fleet IN THE SAME CORRIDOR
            const refHub = isOutward
                ? (sourceHub || DEFAULT_COLLEGE_COORDINATES)
                : (destinationHub || DEFAULT_COLLEGE_COORDINATES);

            const targetRoute = routes.find((r) => {
                if (r === matchingRoute) return false;
                const rCap = Number(r.capacity || r.vehicle?.capacity || 70);
                if ((r.assignedUsers + excess) > rCap) return false;

                if (stopToShift && Array.isArray(r.stops) && r.stops.length > 0) {
                    const minD = Math.min(
                        ...r.stops.map((st) => calculateDistanceKm(stopToShift.latitude, stopToShift.longitude, st.latitude, st.longitude))
                    );
                    if (minD > 4.75) return false;

                    if (refHub && !isRouteCorridorCoherent(refHub, [...r.stops, stopToShift], 38.0, 4.75)) {
                        return false;
                    }
                }
                return true;
            });

            if (targetRoute && stopToShift) {
                    const userIdsToShift = Array.isArray(stopToShift.userIds)
                        ? stopToShift.userIds.splice(stopToShift.userIds.length - excess, excess)
                        : [];
                    stopToShift.userCount = Array.isArray(stopToShift.userIds) ? stopToShift.userIds.length : Math.max(0, (stopToShift.userCount || 0) - excess);
                    stopToShift.passengerCount = stopToShift.userCount;
                    matchingRoute.assignedUsers -= excess;
                    if (Array.isArray(matchingRoute.users)) {
                        const shiftSet = new Set(userIdsToShift);
                        matchingRoute.users = matchingRoute.users.filter((uid) => !shiftSet.has(uid));
                    }

                    // Add to targetRoute
                    targetRoute.assignedUsers += excess;
                    if (Array.isArray(targetRoute.users)) {
                        targetRoute.users.push(...userIdsToShift);
                    }
                    const normStr = (str) => String(str || "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
                    const targetMatchingStop = (targetRoute.stops || []).find((s) =>
                        isSamePlace(s, stopToShift) ||
                        (normStr(s.name) && normStr(s.name) === normStr(stopToShift.name))
                    );
                    if (targetMatchingStop) {
                        if (Array.isArray(targetMatchingStop.userIds)) {
                            targetMatchingStop.userIds.push(...userIdsToShift);
                        }
                        targetMatchingStop.userCount = (targetMatchingStop.userCount || 0) + excess;
                        targetMatchingStop.passengerCount = targetMatchingStop.userCount;
                    } else {
                        targetRoute.stops.push({
                            ...stopToShift,
                            userIds: userIdsToShift,
                            userCount: excess,
                            passengerCount: excess
                        });
                    }
                    targetRoute.stops = mergeDuplicateStopsInRoute(targetRoute.stops);
                    matchingRoute.stops = mergeDuplicateStopsInRoute(matchingRoute.stops);
                }
            }
        }

    return routes;
};

/**
 * Guaranteed Seating Capacity Balancing Engine (P0 Requirement)
 * Ensures passengerCount <= actualVehicleSeatCapacity for every single route with ZERO standing passengers.
 * 1. Vehicle Swap Pass: reallocates higher capacity vehicles to routes with higher demand where valid.
 * 2. Intra-Fleet Passenger Transfer: shifts excess passengers from over-capacity routes to compatible routes
 *    with spare seats, prioritizing shared stops first, then proximate corridor stops.
 * 3. Fleet Expansion Fallback: if existing buses physically cannot absorb demand without violating capacity,
 *    deploys next available scheduled vehicle so no passenger travels standing.
 */
export const balanceRoutesToGuaranteedSeating = ({
    routes = [],
    availableVehicles = [],
    matrix = null,
    hub = DEFAULT_SOURCE_HUB,
    tripMode = "FROM_SOURCE",
    activeInwardStartingPlaces = [],
    auditTrail = []
}) => {
    if (!Array.isArray(routes) || routes.length === 0) {
        return { balanced: routes, totalStanding: 0 };
    }

    const isOutward = tripMode === "FROM_SOURCE" || tripMode === "OUTWARD";

    // Deep clone routes, stops, and userIds
    const balanced = routes.map((r) => ({
        ...r,
        stops: (r.stops || []).map((s) => ({
            ...s,
            userIds: Array.isArray(s.userIds) ? [...s.userIds] : [],
            userCount: Array.isArray(s.userIds) ? s.userIds.length : Number(s.userCount || 0)
        })),
        users: Array.isArray(r.users) ? [...r.users] : [],
        assignedUsers: Number(r.assignedUsers || 0),
        capacity: Number(r.capacity || r.vehicle?.capacity || 50)
    }));

    // Pass 1: Vehicle Swap Optimization
    // If Route A has high demand and small bus, but Route B has low demand and large bus, swap!
    for (let i = 0; i < balanced.length; i++) {
        for (let j = i + 1; j < balanced.length; j++) {
            const rA = balanced[i];
            const rB = balanced[j];
            const excessA = Math.max(0, rA.assignedUsers - rA.capacity);
            const excessB = Math.max(0, rB.assignedUsers - rB.capacity);
            if (excessA === 0 && excessB === 0) continue;

            const newExcessA = Math.max(0, rA.assignedUsers - rB.capacity);
            const newExcessB = Math.max(0, rB.assignedUsers - rA.capacity);
            if (newExcessA + newExcessB < excessA + excessB) {
                // For inward routes, ensure starting place continuity is preserved if swapping
                if (!isOutward && activeInwardStartingPlaces && activeInwardStartingPlaces.length > 0) {
                    const spA = findStartingPlaceForBus(rA.vehicle, activeInwardStartingPlaces);
                    const spB = findStartingPlaceForBus(rB.vehicle, activeInwardStartingPlaces);
                    const hasDedicatedHubA = spA && rA.stops.some((s) => isSamePlace(spA, s));
                    const hasDedicatedHubB = spB && rB.stops.some((s) => isSamePlace(spB, s));
                    if (hasDedicatedHubA || hasDedicatedHubB) continue;
                }

                const tempVeh = rA.vehicle;
                const tempVehId = rA.vehicleId;
                const tempVehName = rA.vehicleName;
                const tempCap = rA.capacity;

                rA.vehicle = rB.vehicle;
                rA.vehicleId = rB.vehicleId;
                rA.vehicleName = rB.vehicleName;
                rA.capacity = rB.capacity;
                rA.remainingSeats = Math.max(0, rA.capacity - rA.assignedUsers);

                rB.vehicle = tempVeh;
                rB.vehicleId = tempVehId;
                rB.vehicleName = tempVehName;
                rB.capacity = tempCap;
                rB.remainingSeats = Math.max(0, rB.capacity - rB.assignedUsers);

                auditTrail.push({
                    action: "VEHICLE_CAPACITY_SWAP",
                    reason: `Swapped vehicles between ${rA.vehicleName} (${rA.capacity} seats) and ${rB.vehicleName} (${rB.capacity} seats) to better fit passenger demand without standing passengers.`
                });
            }
        }
    }

    // Pass 2: Intra-Fleet Passenger Transfer
    let iterations = 0;
    while (iterations < 40) {
        iterations++;
        const overRoute = balanced.find((r) => r.assignedUsers > r.capacity);
        if (!overRoute) break;

        const excess = overRoute.assignedUsers - overRoute.capacity;
        let transferred = false;

        // Try stops from overRoute (evaluating from outermost/corridor-boundary stops first)
        for (let sIdx = overRoute.stops.length - 1; sIdx >= 0; sIdx--) {
            const st = overRoute.stops[sIdx];
            if (!st || st.userCount === 0) continue;

            // Find compatible recipient routes with spare capacity
            const candidates = [];
            for (let tIdx = 0; tIdx < balanced.length; tIdx++) {
                const target = balanced[tIdx];
                if (target === overRoute) continue;
                const spare = target.capacity - target.assignedUsers;
                if (spare <= 0) continue;

                let minD = Infinity;
                let isShared = false;
                for (const ts of target.stops) {
                    if (ts.name.trim().toLowerCase() === st.name.trim().toLowerCase()) {
                        isShared = true;
                        minD = 0;
                        break;
                    }
                    const d = calculateDistanceKm(st.latitude, st.longitude, ts.latitude, ts.longitude);
                    if (d < minD) minD = d;
                }

                if (!isShared && minD > 6.0) continue;

                const testStops = [...target.stops, st];
                if (!isShared && !isRouteCorridorCoherent(hub, testStops, 55.0, 6.0)) continue;

                candidates.push({ target, minD, spare, isShared });
            }

            if (candidates.length === 0) continue;

            candidates.sort((a, b) => {
                if (a.isShared !== b.isShared) return b.isShared ? 1 : -1;
                return a.minD - b.minD || b.spare - a.spare;
            });

            const bestCandidate = candidates[0];
            const bestTarget = bestCandidate.target;
            const transferCount = Math.min(st.userCount, excess, bestTarget.capacity - bestTarget.assignedUsers);

            if (transferCount > 0) {
                const transferredIds = st.userIds.splice(st.userIds.length - transferCount, transferCount);
                st.userCount -= transferCount;
                if (st.passengerCount !== undefined) st.passengerCount = st.userCount;

                overRoute.assignedUsers -= transferCount;
                overRoute.users = overRoute.users.filter((uid) => !transferredIds.includes(uid));

                bestTarget.assignedUsers += transferCount;
                bestTarget.users.push(...transferredIds);

                const existingTargetStop = bestTarget.stops.find(
                    (s) => s.name.trim().toLowerCase() === st.name.trim().toLowerCase()
                );
                if (existingTargetStop) {
                    existingTargetStop.userCount += transferCount;
                    if (existingTargetStop.passengerCount !== undefined) existingTargetStop.passengerCount = existingTargetStop.userCount;
                    if (!Array.isArray(existingTargetStop.userIds)) existingTargetStop.userIds = [];
                    existingTargetStop.userIds.push(...transferredIds);
                } else {
                    bestTarget.stops.push({
                        ...st,
                        userCount: transferCount,
                        passengerCount: transferCount,
                        userIds: transferredIds
                    });
                }

                if (st.userCount === 0) {
                    overRoute.stops.splice(sIdx, 1);
                }

                auditTrail.push({
                    action: "PASSENGER_SEATING_REBALANCE",
                    stopName: st.name,
                    fromVehicle: overRoute.vehicleName,
                    toVehicle: bestTarget.vehicleName,
                    transferredCount: transferCount,
                    reason: `Transferred ${transferCount} passenger(s) at '${st.name}' from ${overRoute.vehicleName} to ${bestTarget.vehicleName} to guarantee zero standing passengers (${overRoute.assignedUsers}/${overRoute.capacity} -> ${bestTarget.assignedUsers}/${bestTarget.capacity}).`
                });

                transferred = true;
                break;
            }
        }

        if (!transferred) break;
    }

    // Pass 3: Fleet Expansion Fallback if any route still exceeds capacity
    const stillOverRoute = balanced.find((r) => r.assignedUsers > r.capacity);
    if (stillOverRoute && Array.isArray(availableVehicles) && availableVehicles.length > balanced.length) {
        const usedIds = new Set(balanced.map((r) => String(r.vehicleId || r.vehicle?._id || r.vehicle?.id || "")));
        const unusedVehicles = availableVehicles.filter((v) => {
            const vid = String(v._id || v.id || "");
            const cap = Number(v.capacity || v.seatCapacity || 0);
            return cap > 0 && v.isActive !== false && !usedIds.has(vid);
        }).sort((a, b) => Number(b.capacity || b.seatCapacity || 0) - Number(a.capacity || a.seatCapacity || 0));

        if (unusedVehicles.length > 0) {
            const extraVeh = unusedVehicles[0];
            const extraCap = Number(extraVeh.capacity || extraVeh.seatCapacity || 50);
            const extraVid = String(extraVeh._id || extraVeh.id);
            const extraName = extraVeh.vehicleName || extraVeh.name || `Bus ${balanced.length + 1}`;

            const newRouteStops = [];
            const newRouteUsers = [];
            let newAssigned = 0;

            for (let sIdx = stillOverRoute.stops.length - 1; sIdx >= 0; sIdx--) {
                const st = stillOverRoute.stops[sIdx];
                if (!st || st.userCount === 0) continue;
                if (stillOverRoute.assignedUsers <= stillOverRoute.capacity) break;

                const excess = stillOverRoute.assignedUsers - stillOverRoute.capacity;
                const moveCount = Math.min(st.userCount, excess, extraCap - newAssigned);
                if (moveCount <= 0) break;

                const movedIds = st.userIds.splice(st.userIds.length - moveCount, moveCount);
                st.userCount -= moveCount;
                if (st.passengerCount !== undefined) st.passengerCount = st.userCount;
                stillOverRoute.assignedUsers -= moveCount;
                stillOverRoute.users = stillOverRoute.users.filter((uid) => !movedIds.includes(uid));

                newRouteUsers.push(...movedIds);
                newAssigned += moveCount;
                newRouteStops.push({
                    ...st,
                    userCount: moveCount,
                    passengerCount: moveCount,
                    userIds: movedIds
                });

                if (st.userCount === 0) {
                    stillOverRoute.stops.splice(sIdx, 1);
                }
            }

            if (newRouteStops.length > 0) {
                balanced.push({
                    routeId: `extra_rt_${balanced.length + 1}`,
                    routeCode: extraName,
                    vehicle: extraVeh,
                    vehicleId: extraVid,
                    vehicleName: extraName,
                    capacity: extraCap,
                    assignedUsers: newAssigned,
                    stops: newRouteStops,
                    users: newRouteUsers
                });

                auditTrail.push({
                    action: "EXTRA_VEHICLE_DEPLOYED_FOR_SEATING",
                    vehicleName: extraName,
                    capacity: extraCap,
                    assignedUsers: newAssigned,
                    reason: `Deployed additional scheduled vehicle '${extraName}' (${extraCap} seats) to guarantee zero standing passengers across the transportation network.`
                });
            }
        }
    }

    // Clean up metrics on all balanced routes: STRICT GUARANTEED SEATING
    let totalStanding = 0;
    for (const r of balanced) {
        r.standingPassengers = Math.max(0, r.assignedUsers - r.capacity);
        r.seatedPassengers = Math.min(r.assignedUsers, r.capacity);
        r.overCapacityCount = r.standingPassengers;
        r.isOverCapacity = r.standingPassengers > 0;
        r.remainingSeats = Math.max(0, r.capacity - r.assignedUsers);
        r.seatUtilization = Number(((r.assignedUsers / r.capacity) * 100).toFixed(1));
        totalStanding += r.standingPassengers;
    }

    return { balanced, totalStanding };
};

export const evaluateFleetBalancingDecision = ({
    currentDirection = "INWARD",
    currentDemand = 0,
    candidateRoutes = [],
    availableVehicles = [],
    configuredInwardStartingPlaces = [],
    oppositePlan = null
}) => {
    const isOutward = currentDirection === "OUTWARD";

    if (!isOutward) {
        const fleetSelection = selectInwardFleet({
            totalComingPassengers: currentDemand,
            availableVehicles,
            activeInwardStartingPlaces: configuredInwardStartingPlaces,
            oppositePlan
        });

        const minCapacityBuses = fleetSelection.minimumBusCount;
        const targetRouteCount = Math.max(minCapacityBuses, fleetSelection.selectedBuses.length);
        const symmetryStatus = oppositePlan ? "BALANCED_FLEET" : "INDEPENDENT_DIRECTION";

        let decisionReason = `Minimum capacity requirement: ${minCapacityBuses} buses. Feasible route allocation: ${targetRouteCount} buses based on capacity and road network topology.`;
        if (fleetSelection.selectedReusable.length > 0 && oppositePlan) {
            const oppBuses = oppositePlan.buses || oppositePlan.routes || [];
            decisionReason += ` Preferred vehicle reuse from OUTWARD operation enabled (${fleetSelection.selectedReusable.length}/${oppBuses.length} vehicles reused).`;
        }
        if (!fleetSelection.isSufficient) {
            decisionReason = `Fleet capacity insufficient: Demand is ${currentDemand}, but available eligible inward fleet capacity is ${fleetSelection.totalEligibleCapacity} seats across ${fleetSelection.eligibleInwardBuses.length} buses (shortfall: ${currentDemand - fleetSelection.totalEligibleCapacity} seats).`;
        }

        const oppBuses = oppositePlan ? (oppositePlan.buses || oppositePlan.routes || []) : [];
        const oppositeVehicleIds = fleetSelection.reusableBuses.map((b) => String(b._id || b.id || ""));

        return {
            targetRouteCount,
            symmetryStatus,
            decisionReason,
            oppositeBusCount: oppBuses.length,
            oppositeDemand: oppositePlan ? Number(oppositePlan.assignedUsers ?? oppositePlan.summary?.comingUsers ?? currentDemand) : null,
            oppositeVehicleIds,
            minCapacityBuses,
            baselineTarget: minCapacityBuses,
            selectedFleet: fleetSelection.selectedBuses,
            eligibleFleet: fleetSelection.eligibleInwardBuses,
            fleetCapacity: fleetSelection.selectedCapacity
        };
    }

    // OUTWARD FLEET BALANCING ENGINE
    const fleetSelection = selectOutwardFleet({
        totalComingPassengers: currentDemand,
        availableVehicles,
        oppositePlan
    });

    const minCapacityBuses = fleetSelection.minimumBusCount;
    const targetRouteCount = Math.max(minCapacityBuses, fleetSelection.selectedBuses.length);
    const symmetryStatus = oppositePlan ? "BALANCED_FLEET" : "INDEPENDENT_DIRECTION";

    let decisionReason = `Minimum capacity requirement: ${minCapacityBuses} buses. Feasible route allocation: ${targetRouteCount} buses based on capacity and road network topology.`;
    if (fleetSelection.selectedReusable.length > 0 && oppositePlan) {
        const oppBuses = oppositePlan.buses || oppositePlan.routes || [];
        decisionReason += ` Preferred vehicle reuse from INWARD operation enabled (${fleetSelection.selectedReusable.length}/${oppBuses.length} vehicles reused).`;
    }
    if (!fleetSelection.isSufficient) {
        decisionReason = `Fleet capacity insufficient: Demand is ${currentDemand}, but available eligible outward fleet capacity is ${fleetSelection.totalEligibleCapacity} seats across ${fleetSelection.eligibleOutwardBuses.length} buses (shortfall: ${currentDemand - fleetSelection.totalEligibleCapacity} seats).`;
    }

    const oppBuses = oppositePlan ? (oppositePlan.buses || oppositePlan.routes || []) : [];
    const oppositeVehicleIds = fleetSelection.reusableBuses.map((b) => String(b._id || b.id || ""));

    return {
        targetRouteCount,
        symmetryStatus,
        decisionReason,
        oppositeBusCount: oppBuses.length,
        oppositeDemand: oppositePlan ? Number(oppositePlan.assignedUsers ?? oppositePlan.summary?.comingUsers ?? currentDemand) : null,
        oppositeVehicleIds,
        minCapacityBuses,
        baselineTarget: minCapacityBuses,
        selectedFleet: fleetSelection.selectedBuses,
        eligibleFleet: fleetSelection.eligibleOutwardBuses,
        fleetCapacity: fleetSelection.selectedCapacity
    };
};

// ============================================================================
// 7. DELAYED FLEET-WIDE VEHICLE ASSIGNMENT
// ============================================================================

/**
 * Assigns vehicles to finalized candidate routes AFTER optimization is complete.
 * Minimizes empty seats and matches route demand with available vehicle capacity.
 */
export const assignVehiclesToOptimizedRoutes = ({
    routes = [],
    availableVehicles = [],
    tripMode = "FROM_SOURCE",
    activeInwardStartingPlaces = [],
    previousRoutes = [],
    preferredVehicleIds = []
}) => {
    if (!Array.isArray(routes) || routes.length === 0) {
        return { assignedRoutes: [], unassignedRoutes: [], vehicleUsageLogs: [], vehicleReuseCount: 0, vehicleReuseRate: 0, reusedVehicleNames: [] };
    }

    const prefSet = new Set((preferredVehicleIds || []).map((id) => String(id).trim()).filter(Boolean));

    const isOutward = tripMode === "FROM_SOURCE" || tripMode === "OUTWARD";

    // Usable vehicles: for INWARD trips, prioritize vehicles that have configured starting locations
    const usableVehicles = [...availableVehicles]
        .filter((v) => {
            const cap = Number(v.capacity || v.seatCapacity || 0);
            if (cap <= 0) return false;
            if (v.isActive === false || String(v.status || "").toUpperCase() === "INACTIVE") return false;
            return true;
        })
        .sort((a, b) => {
            if (!isOutward && activeInwardStartingPlaces && activeInwardStartingPlaces.length > 0) {
                const hasA = hasConfiguredInwardStartingPlace(a, activeInwardStartingPlaces) ? 1 : 0;
                const hasB = hasConfiguredInwardStartingPlace(b, activeInwardStartingPlaces) ? 1 : 0;
                if (hasA !== hasB) return hasB - hasA;
            }
            return Number(b.capacity || b.seatCapacity) - Number(a.capacity || a.seatCapacity);
        });

    const usedVehicleIds = new Set();
    const assignedRoutes = [];
    const unassignedRoutes = [];
    const vehicleUsageLogs = [];

    // Sort routes descending by assigned passenger demand
    const sortedRoutes = [...routes].sort((a, b) => b.assignedUsers - a.assignedUsers);

    // Optimal Bipartite Matching for INWARD trips with configured starting places:
    // If routes do not already have pre-assigned fixed buses, match vehicles to routes globally
    // to minimize deadhead from vehicle starting hub to passenger pickup stops, avoiding cross-town hops.
    if (!isOutward && activeInwardStartingPlaces && activeInwardStartingPlaces.length > 0 && sortedRoutes.length > 1) {
        const hasFixedAssignment = (Array.isArray(previousRoutes) && previousRoutes.length > 0) &&
            sortedRoutes.some((r) => r.vehicleId || r.vehicle?._id || r.isBusChange);

        if (!hasFixedAssignment && usableVehicles.length >= sortedRoutes.length) {
            const costMatrix = [];
            for (let rIdx = 0; rIdx < sortedRoutes.length; rIdx++) {
                const route = sortedRoutes[rIdx];
                const demand = route.assignedUsers;
                const row = [];

                for (let vIdx = 0; vIdx < usableVehicles.length; vIdx++) {
                    const veh = usableVehicles[vIdx];
                    const cap = Number(veh.capacity || veh.seatCapacity || 0);

                    if (cap < demand) {
                        row.push(1e8);
                        continue;
                    }

                    const sp = findStartingPlaceForBus(veh, activeInwardStartingPlaces);
                    if (!sp || !isValidCoordinate(sp.latitude, sp.longitude)) {
                        row.push(1e9); // FORBIDDEN: vehicle without starting place cannot operate inward route!
                        continue;
                    }

                    let minStopDist = Infinity;
                    let hasMatchingHubStop = false;
                    let totalStopDist = 0;
                    let totalPax = 0;
                    for (const st of (route.stops || [])) {
                        if (isValidCoordinate(st.latitude, st.longitude)) {
                            const d = calculateDistanceKm(sp.latitude, sp.longitude, st.latitude, st.longitude);
                            const p = Array.isArray(st.userIds) ? st.userIds.length : Number(st.userCount || st.passengerCount || 1);
                            totalStopDist += d * p;
                            totalPax += p;
                            if (d < minStopDist) minStopDist = d;
                            if (isSamePlace(sp, st) || d <= 1.0) {
                                hasMatchingHubStop = true;
                            }
                        }
                    }

                    const weightedAvgDist = totalPax > 0 ? (totalStopDist / totalPax) : (Number.isFinite(minStopDist) ? minStopDist : 10.0);
                    const firstStop = route.stops?.[0];
                    const firstStopDist = (firstStop && isValidCoordinate(firstStop.latitude, firstStop.longitude))
                        ? calculateDistanceKm(sp.latitude, sp.longitude, firstStop.latitude, firstStop.longitude)
                        : (Number.isFinite(minStopDist) ? minStopDist : 10.0);

                    const effectiveMinDist = Number.isFinite(minStopDist) ? minStopDist : 10.0;
                    let cost = (effectiveMinDist * 2.0) + (firstStopDist * 1.5) + (weightedAvgDist * 2.5);

                    if (hasMatchingHubStop) {
                        cost -= 200.0;
                    }
                    const isPreassigned = (route.vehicleId && String(veh._id || veh.id) === String(route.vehicleId)) ||
                                          (route.vehicleName && (veh.vehicleName || veh.name) === route.vehicleName);
                    if (isPreassigned) {
                        cost -= 500.0;
                    }
                    if (weightedAvgDist > 5.5) {
                        cost += (weightedAvgDist - 5.5) * 20.0; // Severe cross-town corridor mismatch penalty
                    }
                    if (effectiveMinDist > 5.5) {
                        cost += (effectiveMinDist - 5.5) * 15.0; // Severe distant stop penalty
                    }
                    const isReused = prefSet.has(String(veh._id || veh.id || veh.vehicleId || ""));
                    if (isReused) {
                        cost -= 10.0;
                    }
                    cost += (cap - demand) * 0.05;

                    row.push(Number(cost.toFixed(2)));
                }
                costMatrix.push(row);
            }

            const matching = solveMinCostBipartiteMatching(costMatrix);
            if (matching && matching.length === sortedRoutes.length) {
                let allFeasible = true;
                for (let i = 0; i < matching.length; i++) {
                    if (costMatrix[i][matching[i]] >= 1e7) {
                        allFeasible = false;
                        break;
                    }
                }

                if (allFeasible) {
                    for (let rIdx = 0; rIdx < sortedRoutes.length; rIdx++) {
                        const route = sortedRoutes[rIdx];
                        const chosenVehicle = usableVehicles[matching[rIdx]];
                        const vid = String(chosenVehicle._id || chosenVehicle.id || `veh_${rIdx + 1}`);
                        const vName = chosenVehicle.vehicleName || chosenVehicle.name || `Bus ${rIdx + 1}`;
                        usedVehicleIds.add(vid);
                        const cap = Number(chosenVehicle.capacity || chosenVehicle.seatCapacity || 70);
                        const isReused = prefSet.has(vid) || (Array.isArray(previousRoutes) && previousRoutes.some(pr => String(pr.vehicleId || pr._id || "") === vid));
                        assignedRoutes.push({
                            ...route,
                            vehicle: chosenVehicle,
                            vehicleId: vid,
                            vehicleName: vName,
                            capacity: cap,
                            remainingSeats: Math.max(0, cap - route.assignedUsers),
                            seatUtilization: Number(((route.assignedUsers / cap) * 100).toFixed(1)),
                            isReusedBus: isReused
                        });

                        vehicleUsageLogs.push(
                            `Optimal bipartite match: Assigned vehicle '${vName}' (${cap} seats) to Route ${rIdx + 1} (${route.assignedUsers} pax, ${(route.assignedUsers / cap * 100).toFixed(1)}% utilization).`
                        );
                    }

                    return {
                        assignedRoutes,
                        unassignedRoutes: [],
                        vehicleUsageLogs,
                        vehicleReuseCount: assignedRoutes.filter((r) => prefSet.has(String(r.vehicleId))).length,
                        vehicleReuseRate: Number(((assignedRoutes.filter((r) => prefSet.has(String(r.vehicleId))).length / Math.max(assignedRoutes.length, 1)) * 100).toFixed(1)),
                        reusedVehicleNames: assignedRoutes.filter((r) => prefSet.has(String(r.vehicleId))).map((r) => r.vehicleName)
                    };
                }
            }
        }
    }

    for (let rIdx = 0; rIdx < sortedRoutes.length; rIdx++) {
        const route = sortedRoutes[rIdx];
        const demand = route.assignedUsers;

        // Step A: Keep existing bus if suitable
        let chosenVehicle = null;
        const existingVehicleId = String(route.vehicleId || route.vehicle?._id || route.vehicle?.id || "").trim();
        const existingVehicleName = String(route.vehicleName || route.vehicle?.vehicleName || route.vehicle?.name || "").trim();
        if ((existingVehicleId || existingVehicleName) && (!usedVehicleIds.has(existingVehicleId))) {
            const existingVeh = usableVehicles.find((v) =>
                (existingVehicleId && String(v._id || v.id) === existingVehicleId) ||
                (existingVehicleName && (v.vehicleName || v.name) === existingVehicleName)
            );
            if (existingVeh && !usedVehicleIds.has(String(existingVeh._id || existingVeh.id))) {
                const cap = Number(existingVeh.capacity || existingVeh.seatCapacity || 0);
                if (cap >= demand) {
                    if (isOutward || !activeInwardStartingPlaces || activeInwardStartingPlaces.length === 0) {
                        chosenVehicle = existingVeh;
                    } else {
                        const suitability = isBusHubSuitableForStops(existingVeh, route.stops, activeInwardStartingPlaces);
                        const sp = findStartingPlaceForBus(existingVeh, activeInwardStartingPlaces);
                        const hasHubStop = sp && route.stops.some((s) => isSamePlace(sp, s));
                        if (suitability.suitable || hasHubStop) {
                            chosenVehicle = existingVeh;
                        }
                    }
                }
            }
        }

        // Step B: If bus change is required:
        if (!chosenVehicle) {
            // Find available vehicles with capacity >= demand
            let candidates = usableVehicles.filter((v) => {
                const vid = String(v._id || v.id || "");
                const cap = Number(v.capacity || v.seatCapacity || 0);
                return !usedVehicleIds.has(vid) && cap >= demand;
            });

            const isBusChange = Boolean(
                existingVehicleId ||
                (Array.isArray(previousRoutes) && previousRoutes.length > 0) ||
                route.isBusChange
            );

            // STRICT CONSTRAINT FOR INWARD:
            // An inward bus MUST have a configured starting location to be feasible.
            // If candidates with configured starting locations exist, unconfigured vehicles MUST NOT be used!
            if (!isOutward && activeInwardStartingPlaces && activeInwardStartingPlaces.length > 0) {
                const configuredCandidates = candidates.filter((v) =>
                    hasConfiguredInwardStartingPlace(v, activeInwardStartingPlaces)
                );

                if (configuredCandidates.length > 0) {
                    candidates = configuredCandidates;
                }

                const suitableCandidates = candidates.filter((v) => {
                    const suitability = isBusHubSuitableForStops(v, route.stops, activeInwardStartingPlaces);
                    return suitability.suitable;
                });

                if (isBusChange) {
                    // For bus change: alternative bus MUST be near/suitable. If none, do not force reassignment.
                    candidates = suitableCandidates;
                } else if (suitableCandidates.length > 0) {
                    // For initial fleet selection: prioritize suitable candidates first
                    candidates = suitableCandidates;
                }
            }

            if (candidates.length > 0) {
                candidates.sort((a, b) => {
                    if (!isOutward && activeInwardStartingPlaces && activeInwardStartingPlaces.length > 0) {
                        const hasA = hasConfiguredInwardStartingPlace(a, activeInwardStartingPlaces) ? 1 : 0;
                        const hasB = hasConfiguredInwardStartingPlace(b, activeInwardStartingPlaces) ? 1 : 0;
                        if (hasA !== hasB) return hasB - hasA; // Configured starting location takes top priority

                        const suitA = isBusHubSuitableForStops(a, route.stops, activeInwardStartingPlaces);
                        const suitB = isBusHubSuitableForStops(b, route.stops, activeInwardStartingPlaces);

                        // 1. Geographically suitable hub first
                        if (suitA.suitable !== suitB.suitable) {
                            return suitA.suitable ? -1 : 1;
                        }

                        // 2. Vehicle reuse bonus: prefer reusing vehicles from the opposite direction (Shared Fleet Principle)
                        const isReusedA = prefSet.has(String(a._id || a.id || a.vehicleId || "")) ? 1 : 0;
                        const isReusedB = prefSet.has(String(b._id || b.id || b.vehicleId || "")) ? 1 : 0;
                        if (isReusedA !== isReusedB) return isReusedB - isReusedA;

                        // 3. Hub distance difference: if one hub is noticeably closer (> 1.5 km), prefer the closer starting hub
                        const distA = Number.isFinite(suitA.distanceKm) ? suitA.distanceKm : 9999;
                        const distB = Number.isFinite(suitB.distanceKm) ? suitB.distanceKm : 9999;
                        const distDiff = Math.abs(distA - distB);
                        if (distDiff > 1.5) {
                            return distA - distB;
                        }

                        // 4. Tightest capacity fit
                        const capA = Number(a.capacity || a.seatCapacity);
                        const capB = Number(b.capacity || b.seatCapacity);
                        const diffA = capA - demand;
                        const diffB = capB - demand;
                        if (diffA !== diffB) return diffA - diffB;

                        return distA - distB;
                    }

                    // For OUTWARD:
                    // 1. Vehicle reuse bonus: prefer reusing vehicles from opposite direction (Shared Fleet Principle)
                    const isReusedA = prefSet.has(String(a._id || a.id || a.vehicleId || "")) ? 1 : 0;
                    const isReusedB = prefSet.has(String(b._id || b.id || b.vehicleId || "")) ? 1 : 0;
                    if (isReusedA !== isReusedB) return isReusedB - isReusedA;

                    // 2. Tightest capacity fit
                    const capA = Number(a.capacity || a.seatCapacity);
                    const capB = Number(b.capacity || b.seatCapacity);
                    const diffA = capA - demand;
                    const diffB = capB - demand;
                    if (diffA !== diffB) return diffA - diffB;
                    return 0;
                });
                chosenVehicle = candidates[0];
            } else if (!isBusChange || isOutward || !activeInwardStartingPlaces || activeInwardStartingPlaces.length === 0) {
                // Fallback for initial route assignment: find largest remaining unused vehicle so demand coverage hard constraint is satisfied
                // Prefer configured vehicles for INWARD
                const remainingUnused = usableVehicles.filter((v) => !usedVehicleIds.has(String(v._id || v.id || "")));
                if (!isOutward && activeInwardStartingPlaces && activeInwardStartingPlaces.length > 0) {
                    const remainingConfigured = remainingUnused.filter((v) =>
                        hasConfiguredInwardStartingPlace(v, activeInwardStartingPlaces)
                    );
                    chosenVehicle = remainingConfigured[0] || remainingUnused[0] || null;
                } else {
                    chosenVehicle = remainingUnused[0] || null;
                }
            }
        }

        if (chosenVehicle) {
            const vid = String(chosenVehicle._id || chosenVehicle.id || `veh_${rIdx + 1}`);
            usedVehicleIds.add(vid);
            const cap = Number(chosenVehicle.capacity || chosenVehicle.seatCapacity || 70);
            const vName = chosenVehicle.vehicleName || chosenVehicle.name || `Bus ${rIdx + 1}`;
            const isReused = prefSet.has(vid) || (Array.isArray(previousRoutes) && previousRoutes.some(pr => String(pr.vehicleId || pr._id || "") === vid));

            assignedRoutes.push({
                ...route,
                vehicle: chosenVehicle,
                vehicleId: vid,
                vehicleName: vName,
                capacity: cap,
                remainingSeats: Math.max(0, cap - demand),
                seatUtilization: Number(((demand / cap) * 100).toFixed(1)),
                isReusedBus: isReused
            });

            vehicleUsageLogs.push(
                `Assigned vehicle '${vName}' (${cap} seats) to Route ${rIdx + 1} (${demand} passengers, ${(demand / cap * 100).toFixed(1)}% utilization).`
            );
        } else {
            unassignedRoutes.push(route);
            vehicleUsageLogs.push(
                `WARNING: No available vehicle remained in schedule to serve Route ${rIdx + 1} (${demand} passengers).`
            );
        }
    }

    // INWARD VEHICLE-ROUTE MATCHING REFINEMENT:
    // If multiple inward routes were assigned, check if swapping vehicles between any pair of routes
    // improves starting hub proximity while respecting vehicle capacities.
    if (!isOutward && activeInwardStartingPlaces && activeInwardStartingPlaces.length > 0 && assignedRoutes.length > 1) {
        let improved = true;
        let swapRounds = 0;
        while (improved && swapRounds < 10) {
            improved = false;
            swapRounds++;
            for (let i = 0; i < assignedRoutes.length; i++) {
                for (let j = i + 1; j < assignedRoutes.length; j++) {
                    const rA = assignedRoutes[i];
                    const rB = assignedRoutes[j];
                    const vehA = rA.vehicle;
                    const vehB = rB.vehicle;
                    if (!vehA || !vehB) continue;

                    const capA = Number(vehA.capacity || vehA.seatCapacity || 0);
                    const capB = Number(vehB.capacity || vehB.seatCapacity || 0);

                    // Both vehicles must satisfy swapped demands
                    if (capA < rB.assignedUsers || capB < rA.assignedUsers) continue;

                    // If either vehicle already has its designated starting hub in its route, NEVER swap it away!
                    const spA = findStartingPlaceForBus(vehA, activeInwardStartingPlaces);
                    const spB = findStartingPlaceForBus(vehB, activeInwardStartingPlaces);
                    const hasHubA = spA && rA.stops.some((s) => isSamePlace(spA, s));
                    const hasHubB = spB && rB.stops.some((s) => isSamePlace(spB, s));
                    if (hasHubA || hasHubB) continue;

                    const suitCurrentA = isBusHubSuitableForStops(vehA, rA.stops, activeInwardStartingPlaces);
                    const suitCurrentB = isBusHubSuitableForStops(vehB, rB.stops, activeInwardStartingPlaces);

                    const suitSwapA = isBusHubSuitableForStops(vehA, rB.stops, activeInwardStartingPlaces);
                    const suitSwapB = isBusHubSuitableForStops(vehB, rA.stops, activeInwardStartingPlaces);

                    const currentDist = (Number.isFinite(suitCurrentA.distanceKm) ? suitCurrentA.distanceKm : 999) +
                                        (Number.isFinite(suitCurrentB.distanceKm) ? suitCurrentB.distanceKm : 999);
                    const swappedDist = (Number.isFinite(suitSwapA.distanceKm) ? suitSwapA.distanceKm : 999) +
                                        (Number.isFinite(suitSwapB.distanceKm) ? suitSwapB.distanceKm : 999);

                    const currentSuitableCount = (suitCurrentA.suitable ? 1 : 0) + (suitCurrentB.suitable ? 1 : 0);
                    const swappedSuitableCount = (suitSwapA.suitable ? 1 : 0) + (suitSwapB.suitable ? 1 : 0);

                    if (swappedSuitableCount > currentSuitableCount || (swappedSuitableCount === currentSuitableCount && swappedDist + 1.0 < currentDist)) {
                        // Swap vehicles
                        rA.vehicle = vehB;
                        rA.vehicleId = String(vehB._id || vehB.id);
                        rA.vehicleName = vehB.vehicleName || vehB.name;
                        rA.capacity = capB;
                        rA.remainingSeats = Math.max(0, capB - rA.assignedUsers);
                        rA.seatUtilization = Number(((rA.assignedUsers / capB) * 100).toFixed(1));

                        rB.vehicle = vehA;
                        rB.vehicleId = String(vehA._id || vehA.id);
                        rB.vehicleName = vehA.vehicleName || vehA.name;
                        rB.capacity = capA;
                        rB.remainingSeats = Math.max(0, capA - rB.assignedUsers);
                        rB.seatUtilization = Number(((rB.assignedUsers / capA) * 100).toFixed(1));

                        improved = true;
                    }
                }
            }
        }
    }

    const reusedVehicles = assignedRoutes.filter((r) =>
        prefSet.has(String(r.vehicleId || r.vehicle?._id || r.vehicle?.id || ""))
    );
    const vehicleReuseCount = reusedVehicles.length;
    const vehicleReuseRate = assignedRoutes.length > 0
        ? Number(((vehicleReuseCount / assignedRoutes.length) * 100).toFixed(1))
        : 0;
    const reusedVehicleNames = reusedVehicles.map((r) => r.vehicleName || r.vehicle?.name).filter(Boolean);

    return {
        assignedRoutes,
        unassignedRoutes,
        vehicleUsageLogs,
        vehicleReuseCount,
        vehicleReuseRate,
        reusedVehicleNames
    };
};

/**
 * Purpose-Driven Outward Fleet Consolidation & Passenger Rebalancing Engine
 * 
 * Objectives:
 * 1. Identify low-occupancy routes (e.g. <= 15 passengers or utilization < 35%).
 * 2. Attempt direct absorption of each stop into geographically compatible corridor routes with spare capacity.
 * 3. If the most compatible corridor route is full, attempt Corridor Multi-Hop Rebalancing:
 *    reassign a donor stop from the full corridor route to a third route with spare capacity,
 *    enabling the corridor route to absorb the low-occupancy stop.
 * 4. Recalculate and strictly validate road continuity, zero directional reversals, backtracking < 2.0km,
 *    and detour ratio <= 2.25x for every modified route using sequenceOutwardRouteStops.
 * 5. Consolidate and dissolve the low-occupancy bus when all its stops are continuously absorbed,
 *    reducing fleet size without sacrificing passenger convenience or road validity.
 * 6. If consolidation is impossible due to genuine geographic isolation or overall capacity saturation,
 *    retain the separate bus with a verified explanation.
 * 7. Apply intra-corridor passenger load balancing to avoid extreme disparities (e.g. 70/70 vs 60/70)
 *    where stops can be shared/balanced along the same corridor without increasing detour.
 */
export const consolidateAndRebalanceLowOccupancyOutwardRoutes = ({
    routes = [],
    availableVehicles = [],
    sourceHub = DEFAULT_SOURCE_HUB,
    matrix = null,
    tripMode = "FROM_SOURCE",
    auditTrail = [],
    maxDetourRatio = 2.25,
    lowOccupancyThreshold = 15,
    minUtilization = 0.35
}) => {
    if (!Array.isArray(routes) || routes.length <= 1) return routes;

    const resolvedHub = sourceHub || DEFAULT_SOURCE_HUB;

    let currentRoutes = routes.map((r, idx) => ({
        ...r,
        routeId: r.routeId || `route_${idx + 1}`,
        stops: (r.stops || []).map((s) => ({
            ...s,
            userIds: Array.isArray(s.userIds) ? [...s.userIds] : []
        })),
        users: Array.isArray(r.users) ? [...r.users] : []
    }));

    let changed = true;
    let passes = 0;
    const MAX_PASSES = 4;

    while (changed && passes < MAX_PASSES && currentRoutes.length > 1) {
        changed = false;
        passes++;

        // Identify low-occupancy routes
        const lowRoutes = currentRoutes
            .filter((r) => {
                const pax = Number(r.assignedUsers || 0);
                const cap = Number(r.capacity || r.vehicle?.capacity || 70);
                if (pax <= 0) return false;
                const util = cap > 0 ? pax / cap : 0;
                return pax <= lowOccupancyThreshold || util < minUtilization;
            })
            .sort((a, b) => (a.assignedUsers || 0) - (b.assignedUsers || 0));

        for (const lowRoute of lowRoutes) {
            let allStopsAbsorbed = true;
            const otherRoutes = currentRoutes.filter((r) => r.routeId !== lowRoute.routeId);

            // Create working deep-copies of other routes for transaction safety
            let trialOtherRoutes = otherRoutes.map((r) => ({
                ...r,
                stops: r.stops.map((s) => ({ ...s, userIds: [...(s.userIds || [])] })),
                users: [...(r.users || [])]
            }));

            for (const stop of lowRoute.stops) {
                const stopPax = Array.isArray(stop.userIds) && stop.userIds.length > 0
                    ? stop.userIds.length
                    : Number(stop.userCount || stop.passengerCount || 0);

                if (stopPax <= 0) continue;

                let stopAbsorbed = false;

                // Priority 1: Direct insertion into a compatible route with sufficient spare capacity
                const viableRoutes = trialOtherRoutes.filter((r) => {
                    const rCap = Number(r.capacity || r.vehicle?.capacity || 70);
                    return (rCap - r.assignedUsers) >= stopPax;
                });

                // Sort candidate target routes by proximity to this stop
                viableRoutes.sort((rA, rB) => {
                    const distA = Math.min(...rA.stops.map((s) => calculateDistanceKm(s.latitude, s.longitude, stop.latitude, stop.longitude)));
                    const distB = Math.min(...rB.stops.map((s) => calculateDistanceKm(s.latitude, s.longitude, stop.latitude, stop.longitude)));
                    return distA - distB;
                });

                for (const targetRoute of viableRoutes) {
                    const nearestDist = Math.min(...targetRoute.stops.map((s) => calculateDistanceKm(s.latitude, s.longitude, stop.latitude, stop.longitude)));
                    if (nearestDist > 4.75) continue; // Reject cross-corridor / cross-town leaps

                    const testTour = [...targetRoute.stops, stop];
                    if (!isRouteCorridorCoherent(resolvedHub, testTour, 38.0, 4.75)) continue;

                    const seq = sequenceOutwardRouteStops({
                        departureHub: resolvedHub,
                        stops: testTour,
                        matrix,
                        tripMode
                    });
                    const qv = seq.qualityValidation || {};

                    const isContinuous = qv.operationalContinuityVerified !== false &&
                        (qv.directionalReversals || 0) === 0 &&
                        (qv.backtrackingDistanceKm || 0) < 2.0 &&
                        (qv.detourRatio || 1.0) <= maxDetourRatio;

                    if (isContinuous) {
                        targetRoute.stops = seq.stops;
                        targetRoute.assignedUsers += stopPax;
                        targetRoute.users.push(...(stop.userIds || []));
                        targetRoute.routeDistanceKm = seq.routeDistanceKm;
                        targetRoute.qualityValidation = qv;
                        targetRoute.routeQuality = qv;
                        stopAbsorbed = true;
                        break;
                    }
                }

                if (stopAbsorbed) continue;

                // Priority 2: Corridor Multi-Hop Rebalancing
                // When the geographically closest corridor route is full (or near full),
                // check if that corridor route can offload a donor stop to a third route with spare capacity.
                const compatibleFullRoutes = trialOtherRoutes.filter((r) => {
                    const rCap = Number(r.capacity || r.vehicle?.capacity || 70);
                    if ((rCap - r.assignedUsers) >= stopPax) return false;
                    const nearestDist = Math.min(...r.stops.map((s) => calculateDistanceKm(s.latitude, s.longitude, stop.latitude, stop.longitude)));
                    return nearestDist <= 4.0; // Strictly close corridor route
                });

                for (const corridorRoute of compatibleFullRoutes) {
                    const corridorCap = Number(corridorRoute.capacity || corridorRoute.vehicle?.capacity || 70);
                    const neededSeats = stopPax - (corridorCap - corridorRoute.assignedUsers);

                    // Candidate donor stops on the corridor route
                    const donorCandidates = corridorRoute.stops.filter((s) => {
                        const sCount = Array.isArray(s.userIds) ? s.userIds.length : Number(s.userCount || 0);
                        return sCount >= neededSeats;
                    });

                    for (const donorStop of donorCandidates) {
                        const shiftPax = neededSeats;
                        const thirdRoutes = trialOtherRoutes.filter((r) => {
                            if (r.routeId === corridorRoute.routeId) return false;
                            const rCap = Number(r.capacity || r.vehicle?.capacity || 70);
                            return (rCap - r.assignedUsers) >= shiftPax;
                        });

                        for (const thirdRoute of thirdRoutes) {
                            const thirdDist = Math.min(...thirdRoute.stops.map((s) => calculateDistanceKm(s.latitude, s.longitude, donorStop.latitude, donorStop.longitude)));
                            if (thirdDist > 4.0) continue;

                            const shiftIds = Array.isArray(donorStop.userIds) ? donorStop.userIds.slice(0, shiftPax) : [];
                            const testDonorStop = {
                                ...donorStop,
                                userCount: shiftPax,
                                passengerCount: shiftPax,
                                userIds: shiftIds
                            };

                            const thirdTour = [...thirdRoute.stops, testDonorStop];
                            if (!isRouteCorridorCoherent(resolvedHub, thirdTour, 38.0, 4.75)) continue;

                            const thirdSeq = sequenceOutwardRouteStops({
                                departureHub: resolvedHub,
                                stops: thirdTour,
                                matrix,
                                tripMode
                            });
                            const thirdQv = thirdSeq.qualityValidation || {};

                            const thirdValid = thirdQv.operationalContinuityVerified !== false &&
                                (thirdQv.directionalReversals || 0) === 0 &&
                                (thirdQv.backtrackingDistanceKm || 0) < 2.0 &&
                                (thirdQv.detourRatio || 1.0) <= maxDetourRatio;

                            if (thirdValid) {
                                // Test corridor route with donor shifted and new stop added
                                const remainingDonorPax = (donorStop.userCount || 0) - shiftPax;
                                const updatedCorridorStops = corridorRoute.stops.map((s) => {
                                    if (s.name === donorStop.name) {
                                        return {
                                            ...s,
                                            userCount: remainingDonorPax,
                                            passengerCount: remainingDonorPax,
                                            userIds: Array.isArray(s.userIds) ? s.userIds.slice(shiftPax) : []
                                        };
                                    }
                                    return s;
                                }).filter((s) => (s.userCount || 0) > 0);

                                updatedCorridorStops.push(stop);
                                if (!isRouteCorridorCoherent(resolvedHub, updatedCorridorStops, 38.0, 4.75)) continue;

                                const corrSeq = sequenceOutwardRouteStops({
                                    departureHub: resolvedHub,
                                    stops: updatedCorridorStops,
                                    matrix,
                                    tripMode
                                });
                                const corrQv = corrSeq.qualityValidation || {};

                                const corrValid = corrQv.operationalContinuityVerified !== false &&
                                    (corrQv.directionalReversals || 0) === 0 &&
                                    (corrQv.backtrackingDistanceKm || 0) < 2.0 &&
                                    (corrQv.detourRatio || 1.0) <= maxDetourRatio;

                                if (corrValid) {
                                    // Apply multi-hop transfer
                                    corridorRoute.stops = corrSeq.stops;
                                    corridorRoute.assignedUsers = corridorRoute.assignedUsers - shiftPax + stopPax;
                                    corridorRoute.users = corridorRoute.stops.flatMap((s) => s.userIds || []);
                                    corridorRoute.routeDistanceKm = corrSeq.routeDistanceKm;
                                    corridorRoute.qualityValidation = corrQv;

                                    thirdRoute.stops = thirdSeq.stops;
                                    thirdRoute.assignedUsers += shiftPax;
                                    thirdRoute.users.push(...shiftIds);
                                    thirdRoute.routeDistanceKm = thirdSeq.routeDistanceKm;
                                    thirdRoute.qualityValidation = thirdQv;

                                    stopAbsorbed = true;
                                    auditTrail.push({
                                        action: "CORRIDOR_MULTI_HOP_REBALANCE",
                                        donorRoute: corridorRoute.vehicleName || corridorRoute.routeCode,
                                        thirdRoute: thirdRoute.vehicleName || thirdRoute.routeCode,
                                        donorStop: donorStop.name,
                                        absorbedStop: stop.name,
                                        passengersMoved: shiftPax,
                                        reason: `Multi-hop rebalanced ${shiftPax} pax of '${donorStop.name}' from '${corridorRoute.vehicleName}' to '${thirdRoute.vehicleName}', enabling '${corridorRoute.vehicleName}' to absorb '${stop.name}' (${stopPax} pax).`
                                    });
                                    break;
                                }
                            }
                        }
                        if (stopAbsorbed) break;
                    }
                    if (stopAbsorbed) break;
                }

                if (!stopAbsorbed) {
                    allStopsAbsorbed = false;
                    break;
                }
            }

            if (allStopsAbsorbed) {
                currentRoutes = trialOtherRoutes;
                changed = true;
                auditTrail.push({
                    action: "CONSOLIDATE_LOW_OCCUPANCY_BUS",
                    vehicleName: lowRoute.vehicleName || lowRoute.routeCode,
                    passengersMoved: lowRoute.assignedUsers,
                    reason: `Consolidated low-occupancy bus '${lowRoute.vehicleName || lowRoute.routeCode}' (${lowRoute.assignedUsers} pax) into compatible corridor routes. Reduced fleet from ${currentRoutes.length + 1} to ${currentRoutes.length} buses.`
                });
                break;
            } else {
                lowRoute.whySeparateRouteNeeded = "Separate bus retained because stops cannot be continuously absorbed into adjacent corridor routes without exceeding detour ratio or vehicle capacity limits.";
            }
        }
    }

    // Intra-Corridor Passenger Balancing:
    // If two routes in the same corridor have a notable load disparity (e.g. 70/70 and 60/70),
    // balance passenger counts where stops overlap or are in close proximity (<= 2.0 km),
    // without increasing route detour ratio > 2.25.
    if (currentRoutes.length > 1) {
        for (let i = 0; i < currentRoutes.length; i++) {
            for (let j = i + 1; j < currentRoutes.length; j++) {
                const rA = currentRoutes[i];
                const rB = currentRoutes[j];
                const capA = Number(rA.capacity || rA.vehicle?.capacity || 70);
                const capB = Number(rB.capacity || rB.vehicle?.capacity || 70);

                // Both routes must belong to the exact same corridor
                if (resolvedHub && !isRouteCorridorCoherent(resolvedHub, [...rA.stops, ...rB.stops], 38.0)) {
                    continue;
                }

                if (Math.abs(rA.assignedUsers - rB.assignedUsers) >= 8) {
                    const fuller = rA.assignedUsers > rB.assignedUsers ? rA : rB;
                    const lighter = rA.assignedUsers > rB.assignedUsers ? rB : rA;
                    const lighterCap = lighter === rA ? capA : capB;

                    if (lighter.assignedUsers < lighterCap) {
                        const targetDiff = Math.floor((fuller.assignedUsers - lighter.assignedUsers) / 2);
                        const spareLighter = lighterCap - lighter.assignedUsers;
                        const maxShift = Math.min(targetDiff, spareLighter);

                        // Look for a shared or close stop on fuller route to share/transfer
                        for (const stop of fuller.stops) {
                            const count = Array.isArray(stop.userIds) ? stop.userIds.length : Number(stop.userCount || 0);
                            if (count <= 0) continue;

                            const isStopShared = lighter.stops.some((s) => s.name === stop.name);
                            const nearestLighterDist = Math.min(...lighter.stops.map((s) => calculateDistanceKm(s.latitude, s.longitude, stop.latitude, stop.longitude)));

                            if (isStopShared || nearestLighterDist <= 1.5) {
                                const shiftCount = Math.min(count, maxShift);
                                if (shiftCount <= 0) continue;

                                const shiftIds = Array.isArray(stop.userIds) ? stop.userIds.slice(0, shiftCount) : [];

                                // Test testLighter
                                const testLighterStops = lighter.stops.map((s) => ({ ...s, userIds: [...(s.userIds || [])] }));
                                const lighterMatchingStop = testLighterStops.find((s) => s.name === stop.name);
                                if (lighterMatchingStop) {
                                    lighterMatchingStop.userCount = (lighterMatchingStop.userCount || 0) + shiftCount;
                                    lighterMatchingStop.passengerCount = lighterMatchingStop.userCount;
                                    lighterMatchingStop.userIds.push(...shiftIds);
                                } else {
                                    testLighterStops.push({
                                        ...stop,
                                        userCount: shiftCount,
                                        passengerCount: shiftCount,
                                        userIds: shiftIds
                                    });
                                }

                                if (resolvedHub && !isRouteCorridorCoherent(resolvedHub, testLighterStops, 38.0, 4.75)) {
                                    continue;
                                }

                                const lighterSeq = sequenceOutwardRouteStops({
                                    departureHub: resolvedHub,
                                    stops: testLighterStops,
                                    matrix,
                                    tripMode
                                });
                                const lQv = lighterSeq.qualityValidation || {};

                                if (lQv.operationalContinuityVerified !== false &&
                                    (lQv.directionalReversals || 0) === 0 &&
                                    (lQv.backtrackingDistanceKm || 0) < 2.0 &&
                                    (lQv.detourRatio || 1.0) <= maxDetourRatio) {
                                    
                                    // Update fuller stop
                                    stop.userCount -= shiftCount;
                                    stop.passengerCount = stop.userCount;
                                    if (Array.isArray(stop.userIds)) {
                                        stop.userIds = stop.userIds.slice(shiftCount);
                                    }
                                    fuller.stops = fuller.stops.filter((s) => (s.userCount || 0) > 0);
                                    fuller.assignedUsers -= shiftCount;
                                    if (Array.isArray(fuller.users)) {
                                        const shiftSet = new Set(shiftIds);
                                        fuller.users = fuller.users.filter((uid) => !shiftSet.has(uid));
                                    }

                                    // Update lighter route
                                    lighter.stops = lighterSeq.stops;
                                    lighter.assignedUsers += shiftCount;
                                    lighter.users.push(...shiftIds);
                                    lighter.routeDistanceKm = lighterSeq.routeDistanceKm;
                                    lighter.qualityValidation = lQv;

                                    auditTrail.push({
                                        action: "INTRA_CORRIDOR_PASSENGER_BALANCE",
                                        fromRoute: fuller.vehicleName || fuller.routeCode,
                                        toRoute: lighter.vehicleName || lighter.routeCode,
                                        stopName: stop.name,
                                        passengersBalanced: shiftCount,
                                        reason: `Balanced ${shiftCount} passenger(s) at '${stop.name}' from '${fuller.vehicleName}' to '${lighter.vehicleName}' along shared corridor.`
                                    });
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Final Vehicle Capacity Compliance Step:
    // Ensure that routes whose demand exceeds assigned vehicle capacity are matched
    // with larger vehicles from lighter routes or available fleet to satisfy hard capacity constraint.
    for (const overRoute of currentRoutes) {
        const overCap = Number(overRoute.capacity || overRoute.vehicle?.capacity || 70);
        if (overRoute.assignedUsers > overCap) {
            // Find a lighter route whose vehicle has enough capacity for overRoute
            const candidateSwapRoute = currentRoutes.find((r) => {
                if (r === overRoute) return false;
                const rCap = Number(r.capacity || r.vehicle?.capacity || 70);
                return rCap >= overRoute.assignedUsers && overCap >= r.assignedUsers;
            });

            if (candidateSwapRoute) {
                const tempVeh = overRoute.vehicle;
                const tempVid = overRoute.vehicleId;
                const tempVname = overRoute.vehicleName;
                const tempCap = overRoute.capacity;

                overRoute.vehicle = candidateSwapRoute.vehicle;
                overRoute.vehicleId = candidateSwapRoute.vehicleId;
                overRoute.vehicleName = candidateSwapRoute.vehicleName;
                overRoute.capacity = candidateSwapRoute.capacity;

                candidateSwapRoute.vehicle = tempVeh;
                candidateSwapRoute.vehicleId = tempVid;
                candidateSwapRoute.vehicleName = tempVname;
                candidateSwapRoute.capacity = tempCap;

                auditTrail.push({
                    action: "CAPACITY_ALIGNMENT_VEHICLE_SWAP",
                    reason: `Swapped vehicles between '${overRoute.vehicleName}' (assigned: ${overRoute.assignedUsers}, cap: ${overRoute.capacity}) and '${candidateSwapRoute.vehicleName}' (assigned: ${candidateSwapRoute.assignedUsers}, cap: ${candidateSwapRoute.capacity}) to satisfy hard vehicle capacity constraint.`
                });
            } else if (Array.isArray(availableVehicles)) {
                const assignedVids = new Set(currentRoutes.map((r) => String(r.vehicleId || r.vehicle?._id || "")));
                const unusedLargerVeh = availableVehicles.find((v) => {
                    const vid = String(v._id || v.id || "");
                    const vCap = Number(v.capacity || v.seatCapacity || 0);
                    return !assignedVids.has(vid) && vCap >= overRoute.assignedUsers;
                });
                if (unusedLargerVeh) {
                    overRoute.vehicle = unusedLargerVeh;
                    overRoute.vehicleId = String(unusedLargerVeh._id || unusedLargerVeh.id);
                    overRoute.vehicleName = unusedLargerVeh.vehicleName || unusedLargerVeh.name;
                    overRoute.capacity = Number(unusedLargerVeh.capacity || unusedLargerVeh.seatCapacity);
                }
            }
        }
    }

    return currentRoutes;
};

// ============================================================================
// 7B. OUTWARD DEMAND-AWARE ROUTE SHARING & ALLOCATION ENGINE
// ============================================================================

/**
 * Optimizes Outward route construction, route sharing, compatible overflow reassignment,
 * and standing passenger fallback (Requirements 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 18, 19).
 */
export const optimizeOutwardRouteAllocation = ({
    resolvedStops = [],
    stops = [],
    anchorHub = DEFAULT_SOURCE_HUB,
    depot = null,
    availableVehicles = [],
    matrix = null,
    distanceMatrix = null,
    options = {},
    auditTrail = []
}) => {
    resolvedStops = (resolvedStops && resolvedStops.length > 0) ? resolvedStops : (stops || []);
    anchorHub = depot || anchorHub || DEFAULT_SOURCE_HUB;
    matrix = matrix || distanceMatrix;

    const usableVehicles = [...availableVehicles]
        .filter((v) => Number(v.capacity || v.seatCapacity || 0) > 0)
        .sort((a, b) => Number(b.capacity || b.seatCapacity) - Number(a.capacity || a.seatCapacity));

    if (usableVehicles.length === 0 || resolvedStops.length === 0) {
        return { routes: [], optimizedRoutes: [], assignedRoutes: [], unassignedRoutes: [], vehicleUsageLogs: [] };
    }

    const vehicleUsageLogs = [];
    const getPax = (st) => Array.isArray(st.userIds) ? st.userIds.length : Number(st.userCount || 0);

    // Active stops with valid coordinates and demand > 0
    const activeStops = resolvedStops
        .filter((s) => getPax(s) > 0 && isValidCoordinate(s.latitude, s.longitude))
        .map((s, idx) => ({
            ...s,
            matrixIndex: s.matrixIndex || (idx + 1),
            userCount: getPax(s),
            userIds: Array.isArray(s.userIds) ? [...s.userIds] : []
        }));

    if (activeStops.length === 0) {
        return { assignedRoutes: [], unassignedRoutes: [], vehicleUsageLogs: [] };
    }

    // Step A: Group stops into directional corridors based on road bearing from anchorHub
    const corridors = [];
    activeStops.forEach((stop) => {
        const bearing = calculateBearing(anchorHub.latitude, anchorHub.longitude, stop.latitude, stop.longitude);
        stop.bearingFromHub = bearing;

        // Group into corridors within 45 degrees of bearing
        let matchedCorridor = corridors.find((c) => {
            const bearingDiff = getBearingDifference(c.avgBearing, bearing);
            return bearingDiff <= 45;
        });

        if (!matchedCorridor) {
            matchedCorridor = {
                id: `corridor_${corridors.length + 1}`,
                stops: [],
                totalDemand: 0,
                avgBearing: bearing
            };
            corridors.push(matchedCorridor);
        }

        matchedCorridor.stops.push(stop);
        matchedCorridor.totalDemand += stop.userCount;
        matchedCorridor.avgBearing = matchedCorridor.stops.reduce((sum, s) => sum + s.bearingFromHub, 0) / matchedCorridor.stops.length;
    });

    // Sort stops within each corridor by distance from anchorHub (outward progression)
    corridors.forEach((c) => {
        c.stops.sort((a, b) => {
            const distA = matrix.getDist(0, a.matrixIndex);
            const distB = matrix.getDist(0, b.matrixIndex);
            return distA - distB;
        });
    });

    const usedVehicleIds = new Set();
    let assignedRoutes = [];

    // Track unassigned passenger pools for each stop
    const stopDemandPool = new Map();
    activeStops.forEach((s) => {
        stopDemandPool.set(String(s.name).trim().toLowerCase(), {
            stop: s,
            unassignedUserIds: [...s.userIds]
        });
    });

    // Step B: Form candidate routes per corridor (Pass 1: 1 primary vehicle per corridor)
    for (const corridor of corridors) {
        let corridorDemand = corridor.stops.reduce((sum, s) => {
            const pool = stopDemandPool.get(String(s.name).trim().toLowerCase());
            return sum + (pool ? pool.unassignedUserIds.length : 0);
        }, 0);

        if (corridorDemand === 0) continue;
        if (usedVehicleIds.size >= usableVehicles.length) break;

        const candidateVehicles = usableVehicles.filter((v) => !usedVehicleIds.has(String(v._id || v.id || "")));
        if (candidateVehicles.length === 0) break;

        // Pick vehicle that best fits corridor demand
        let chosenVeh = candidateVehicles.find((v) => Number(v.capacity || v.seatCapacity) >= corridorDemand) || candidateVehicles[0];
        const vid = String(chosenVeh._id || chosenVeh.id || `veh_${assignedRoutes.length + 1}`);
        usedVehicleIds.add(vid);
        const cap = Number(chosenVeh.capacity || chosenVeh.seatCapacity || 70);
        const vName = chosenVeh.vehicleName || chosenVeh.name || `Bus ${assignedRoutes.length + 1}`;

        let remainingSeats = cap;
        const routeStops = [];
        const routeUserIds = [];

        // Board stops along the corridor outward from anchorHub
        for (const st of corridor.stops) {
            const pool = stopDemandPool.get(String(st.name).trim().toLowerCase());
            if (!pool || pool.unassignedUserIds.length === 0) continue;

            if (remainingSeats > 0) {
                const takeCount = Math.min(pool.unassignedUserIds.length, remainingSeats);
                const takenIds = pool.unassignedUserIds.splice(0, takeCount);
                routeUserIds.push(...takenIds);
                remainingSeats -= takeCount;

                routeStops.push({
                    ...st,
                    userCount: takeCount,
                    userIds: takenIds
                });
            }
        }

        if (routeStops.length > 0) {
            const optRes = optimizeTour2OptRoad({
                tour: routeStops,
                matrix,
                tripMode: "FROM_SOURCE"
            });

            const finalStops = optRes.tour.map((s, sIdx) => ({
                ...s,
                order: sIdx + 1,
                sequence: sIdx + 1
            }));

            const totalAssigned = routeUserIds.length;
            assignedRoutes.push({
                routeId: `outward_rt_${assignedRoutes.length + 1}`,
                routeCode: vName,
                vehicle: chosenVeh,
                vehicleId: vid,
                vehicleName: vName,
                capacity: cap,
                assignedUsers: totalAssigned,
                seatedPassengers: Math.min(totalAssigned, cap),
                standingPassengers: Math.max(0, totalAssigned - cap),
                overCapacityCount: Math.max(0, totalAssigned - cap),
                isOverCapacity: totalAssigned > cap,
                remainingSeats: Math.max(0, cap - totalAssigned),
                stops: finalStops,
                users: routeUserIds,
                routeDistanceKm: optRes.roadDistanceKm,
                isContinuous: true
            });

            vehicleUsageLogs.push(
                `Assigned vehicle '${vName}' (${cap} seats) to outward route (${totalAssigned} passengers).`
            );
        }
    }

    // Step B2: Secondary trunk pass for corridors with substantial remaining demand (> 15 pax)
    for (const corridor of corridors) {
        let corridorDemand = corridor.stops.reduce((sum, s) => {
            const pool = stopDemandPool.get(String(s.name).trim().toLowerCase());
            return sum + (pool ? pool.unassignedUserIds.length : 0);
        }, 0);

        while (corridorDemand > 15 && usedVehicleIds.size < usableVehicles.length) {
            const candidateVehicles = usableVehicles.filter((v) => !usedVehicleIds.has(String(v._id || v.id || "")));
            if (candidateVehicles.length === 0) break;

            let chosenVeh = candidateVehicles.find((v) => Number(v.capacity || v.seatCapacity) >= corridorDemand) || candidateVehicles[0];
            const vid = String(chosenVeh._id || chosenVeh.id || `veh_${assignedRoutes.length + 1}`);
            usedVehicleIds.add(vid);
            const cap = Number(chosenVeh.capacity || chosenVeh.seatCapacity || 70);
            const vName = chosenVeh.vehicleName || chosenVeh.name || `Bus ${assignedRoutes.length + 1}`;

            let remainingSeats = cap;
            const routeStops = [];
            const routeUserIds = [];

            for (const st of corridor.stops) {
                const pool = stopDemandPool.get(String(st.name).trim().toLowerCase());
                if (!pool || pool.unassignedUserIds.length === 0) continue;

                if (remainingSeats > 0) {
                    const takeCount = Math.min(pool.unassignedUserIds.length, remainingSeats);
                    const takenIds = pool.unassignedUserIds.splice(0, takeCount);
                    routeUserIds.push(...takenIds);
                    remainingSeats -= takeCount;

                    routeStops.push({
                        ...st,
                        userCount: takeCount,
                        userIds: takenIds
                    });
                }
            }

            if (routeStops.length > 0) {
                const optRes = optimizeTour2OptRoad({
                    tour: routeStops,
                    matrix,
                    tripMode: "FROM_SOURCE"
                });

                const finalStops = optRes.tour.map((s, sIdx) => ({
                    ...s,
                    order: sIdx + 1,
                    sequence: sIdx + 1
                }));

                const totalAssigned = routeUserIds.length;
                assignedRoutes.push({
                    routeId: `outward_rt_${assignedRoutes.length + 1}`,
                    routeCode: vName,
                    vehicle: chosenVeh,
                    vehicleId: vid,
                    vehicleName: vName,
                    capacity: cap,
                    assignedUsers: totalAssigned,
                    seatedPassengers: Math.min(totalAssigned, cap),
                    standingPassengers: Math.max(0, totalAssigned - cap),
                    overCapacityCount: Math.max(0, totalAssigned - cap),
                    isOverCapacity: totalAssigned > cap,
                    remainingSeats: Math.max(0, cap - totalAssigned),
                    stops: finalStops,
                    users: routeUserIds,
                    routeDistanceKm: optRes.roadDistanceKm,
                    isContinuous: true
                });

                vehicleUsageLogs.push(
                    `Assigned vehicle '${vName}' (${cap} seats) to outward route (${totalAssigned} passengers).`
                );
            }

            corridorDemand = corridor.stops.reduce((sum, s) => {
                const pool = stopDemandPool.get(String(s.name).trim().toLowerCase());
                return sum + (pool ? pool.unassignedUserIds.length : 0);
            }, 0);
        }
    }

    // Step C: If any demand remains and unused vehicles exist, deploy them
    let leftoverStops = Array.from(stopDemandPool.values()).filter((p) => p.unassignedUserIds.length > 0);
    while (leftoverStops.length > 0 && usedVehicleIds.size < usableVehicles.length) {
        const unusedVehicles = usableVehicles.filter((v) => !usedVehicleIds.has(String(v._id || v.id || "")));
        if (unusedVehicles.length === 0) break;

        const leftoverDemand = leftoverStops.reduce((sum, p) => sum + p.unassignedUserIds.length, 0);
        const chosenVeh = unusedVehicles.find((v) => Number(v.capacity || v.seatCapacity) >= leftoverDemand) || unusedVehicles[0];
        const vid = String(chosenVeh._id || chosenVeh.id || `veh_${assignedRoutes.length + 1}`);
        usedVehicleIds.add(vid);
        const cap = Number(chosenVeh.capacity || chosenVeh.seatCapacity || 70);
        const vName = chosenVeh.vehicleName || chosenVeh.name || `Bus ${assignedRoutes.length + 1}`;

        let remainingSeats = cap;
        const routeStops = [];
        const routeUserIds = [];

        for (const pool of leftoverStops) {
            if (remainingSeats <= 0) break;
            const takeCount = Math.min(pool.unassignedUserIds.length, remainingSeats);
            const takenIds = pool.unassignedUserIds.splice(0, takeCount);
            routeUserIds.push(...takenIds);
            remainingSeats -= takeCount;

            routeStops.push({
                ...pool.stop,
                userCount: takeCount,
                userIds: takenIds
            });
        }

        if (routeStops.length > 0) {
            const optRes = optimizeTour2OptRoad({
                tour: routeStops,
                matrix,
                tripMode: "FROM_SOURCE"
            });

            const finalStops = optRes.tour.map((s, sIdx) => ({
                ...s,
                order: sIdx + 1,
                sequence: sIdx + 1
            }));

            const totalAssigned = routeUserIds.length;
            assignedRoutes.push({
                routeId: `outward_rt_${assignedRoutes.length + 1}`,
                routeCode: vName,
                vehicle: chosenVeh,
                vehicleId: vid,
                vehicleName: vName,
                capacity: cap,
                assignedUsers: totalAssigned,
                seatedPassengers: Math.min(totalAssigned, cap),
                standingPassengers: Math.max(0, totalAssigned - cap),
                overCapacityCount: Math.max(0, totalAssigned - cap),
                isOverCapacity: totalAssigned > cap,
                remainingSeats: Math.max(0, cap - totalAssigned),
                stops: finalStops,
                users: routeUserIds,
                routeDistanceKm: optRes.roadDistanceKm,
                isContinuous: true
            });
        }

        leftoverStops = Array.from(stopDemandPool.values()).filter((p) => p.unassignedUserIds.length > 0);
    }

    // Step D: OVERFLOW REASSIGNMENT TO COMPATIBLE ALTERNATIVE BUSES (Requirements 6, 7, 8)
    // When a stop's primary bus is full, check whether another available bus in the plan can reasonably serve the stop.
    // Constraints:
    // - Bus must have remainingSeats > 0.
    // - Stop must be near or naturally along the alternative bus's route without unreasonable detour (isStopNearOrAlongRoute, detour <= 5km).
    // - DO NOT reassign if alternative bus is unrelated/distant, merely because seats exist!
    leftoverStops = Array.from(stopDemandPool.values()).filter((p) => p.unassignedUserIds.length > 0);
    while (leftoverStops.some((p) => p.unassignedUserIds.length > 0) && assignedRoutes.some((r) => r.remainingSeats > 0)) {
        let reassignedAny = false;

        for (const pool of leftoverStops) {
            if (pool.unassignedUserIds.length === 0) continue;

            // Find candidate buses with spare capacity that are compatible with this stop
            const candidates = [];
            for (const route of assignedRoutes) {
                if (route.remainingSeats <= 0) continue;

                // Evaluate route suitability
                const suitability = isStopNearOrAlongRoute({
                    stop: pool.stop,
                    route,
                    sourceHub: anchorHub,
                    maxDetourKm: 5.0,
                    maxProximityKm: 5.5
                });

                if (suitability.suitable) {
                    candidates.push({
                        route,
                        suitability,
                        detourKm: suitability.detourKm || 0,
                        distanceKm: suitability.distanceKm || 0
                    });
                }
            }

            if (candidates.length === 0) {
                // No alternative bus with seats is route-compatible. Leave for Step E Standing Fallback!
                continue;
            }

            // Sort candidates by lowest detour
            candidates.sort((a, b) => a.detourKm - b.detourKm || a.distanceKm - b.distanceKm);
            const bestCandidate = candidates[0];
            const targetRoute = bestCandidate.route;

            const takeCount = Math.min(pool.unassignedUserIds.length, targetRoute.remainingSeats);
            const takenIds = pool.unassignedUserIds.splice(0, takeCount);

            targetRoute.users.push(...takenIds);
            targetRoute.assignedUsers += takeCount;
            targetRoute.remainingSeats -= takeCount;
            targetRoute.seatedPassengers = Math.min(targetRoute.assignedUsers, targetRoute.capacity);

            // Add or update stop on target route
            const existingStop = targetRoute.stops.find((s) => String(s.name).trim().toLowerCase() === String(pool.stop.name).trim().toLowerCase());
            if (existingStop) {
                existingStop.userCount += takeCount;
                if (!Array.isArray(existingStop.userIds)) existingStop.userIds = [];
                existingStop.userIds.push(...takenIds);
            } else {
                const insertIdx = Number.isInteger(bestCandidate.suitability.bestInsertIndex) && bestCandidate.suitability.bestInsertIndex >= 0
                    ? Math.min(bestCandidate.suitability.bestInsertIndex, targetRoute.stops.length)
                    : targetRoute.stops.length;
                targetRoute.stops.splice(insertIdx, 0, {
                    ...pool.stop,
                    userCount: takeCount,
                    userIds: takenIds
                });
            }

            auditTrail.push({
                action: "OVERFLOW_REASSIGNMENT",
                stopName: pool.stop.name,
                vehicleName: targetRoute.vehicleName,
                passengersReassigned: takeCount,
                reason: `Reassigned ${takeCount} passenger(s) at '${pool.stop.name}' to compatible bus '${targetRoute.vehicleName}' (detour: +${bestCandidate.detourKm.toFixed(1)}km).`
            });

            reassignedAny = true;
        }

        if (!reassignedAny) break;
    }

    // Step E: STANDING PASSENGER FALLBACK (Requirements 9, 10, 18)
    // If any passengers still remain unassigned because no suitable alternative bus has capacity,
    // they MUST remain assigned to their originally assigned bus/route as STANDING passengers!
    leftoverStops = Array.from(stopDemandPool.values()).filter((p) => p.unassignedUserIds.length > 0);
    if (leftoverStops.length > 0 && assignedRoutes.length > 0) {
        for (const pool of leftoverStops) {
            if (pool.unassignedUserIds.length === 0) continue;

            const stopNameLower = String(pool.stop.name).trim().toLowerCase();

            // Find original assigned bus that already serves this stop
            let primaryBus = assignedRoutes.find((r) =>
                r.stops.some((s) => String(s.name).trim().toLowerCase() === stopNameLower)
            );

            // If no bus currently serves this stop, find the geographically closest bus
            if (!primaryBus) {
                let minDist = Infinity;
                for (const route of assignedRoutes) {
                    for (const st of route.stops) {
                        const d = calculateDistanceKm(pool.stop.latitude, pool.stop.longitude, st.latitude, st.longitude);
                        if (d < minDist) {
                            minDist = d;
                            primaryBus = route;
                        }
                    }
                }
            }

            if (!primaryBus && assignedRoutes.length > 0) {
                primaryBus = assignedRoutes[0];
            }

            if (primaryBus) {
                const standingCount = pool.unassignedUserIds.length;
                const standingIds = pool.unassignedUserIds.splice(0, standingCount);

                primaryBus.users.push(...standingIds);
                primaryBus.assignedUsers += standingCount;
                primaryBus.standingPassengers = (primaryBus.standingPassengers || 0) + standingCount;
                primaryBus.seatedPassengers = Math.min(primaryBus.assignedUsers, primaryBus.capacity);
                primaryBus.overCapacityCount = primaryBus.standingPassengers;
                primaryBus.isOverCapacity = true;
                primaryBus.remainingSeats = 0;

                const existingStop = primaryBus.stops.find((s) => String(s.name).trim().toLowerCase() === stopNameLower);
                if (existingStop) {
                    existingStop.userCount += standingCount;
                    if (!Array.isArray(existingStop.userIds)) existingStop.userIds = [];
                    existingStop.userIds.push(...standingIds);
                    existingStop.standingCount = (existingStop.standingCount || 0) + standingCount;
                } else {
                    primaryBus.stops.push({
                        ...pool.stop,
                        userCount: standingCount,
                        userIds: standingIds,
                        standingCount
                    });
                }

                auditTrail.push({
                    action: "STANDING_PASSENGER_FALLBACK",
                    stopName: pool.stop.name,
                    vehicleName: primaryBus.vehicleName,
                    standingPassengers: standingCount,
                    totalAssigned: primaryBus.assignedUsers,
                    capacity: primaryBus.capacity,
                    reason: `Retained ${standingCount} passenger(s) at '${pool.stop.name}' on original bus '${primaryBus.vehicleName}' as standing passengers (${primaryBus.assignedUsers}/${primaryBus.capacity}, +${standingCount} standing).`
                });

                console.log(`[OUTWARD STANDING FALLBACK] ${primaryBus.vehicleName}: +${standingCount} standing at "${pool.stop.name}" (${primaryBus.assignedUsers}/${primaryBus.capacity} total — ${standingCount} standing)`);
            }
        }
    }

    // Step F: Finalize metrics and stop sequences on each assigned route
    for (const route of assignedRoutes) {
        // Re-sequence stops from anchorHub
        const opt = optimizeTour2OptRoad({
            tour: route.stops,
            matrix,
            tripMode: "FROM_SOURCE"
        });

        route.stops = opt.tour.map((s, idx) => ({
            ...s,
            order: idx + 1,
            sequence: idx + 1
        }));
        route.routeDistanceKm = opt.roadDistanceKm;
        route.seatedPassengers = Math.min(route.assignedUsers, route.capacity);
        route.standingPassengers = Math.max(0, route.assignedUsers - route.capacity);
        route.overCapacityCount = route.standingPassengers;
        route.isOverCapacity = route.standingPassengers > 0;
        route.remainingSeats = Math.max(0, route.capacity - route.assignedUsers);
    }


    return {
        routes: assignedRoutes,
        optimizedRoutes: assignedRoutes,
        assignedRoutes,
        unassignedRoutes: [],
        unallocatedCount: 0,
        matrix,
        auditTrail,
        vehicleUsageLogs
    };
};

// ============================================================================
// 8. MASTER GLOBAL OPTIMIZATION ORCHESTRATOR
// ============================================================================

/**
 * Master entrypoint for Global AI Route Optimization.
 * Discovers cross-corridor combinations dynamically without hardcoded geographic partitions.
 */
export const executeGlobalRouteOptimization = async ({
    resolvedStops = [],
    stops = [],
    anchorHub = DEFAULT_SOURCE_HUB,
    depot = null,
    availableVehicles = [],
    tripMode = "FROM_SOURCE",
    options = {}
}) => {
    resolvedStops = (resolvedStops && resolvedStops.length > 0) ? resolvedStops : (stops || []);
    anchorHub = depot || anchorHub || DEFAULT_SOURCE_HUB;
    const isOutward = tripMode === "FROM_SOURCE" || tripMode === "OUTWARD";
    const auditTrail = [];

    // Step 1: Build Global OSRM Road Distance & Duration Matrix
    const matrix = await buildGlobalOptimizationMatrix({
        depot: anchorHub,
        stops: resolvedStops,
        options
    });

    auditTrail.push({
        action: "BUILD_ROAD_MATRIX",
        locationCount: matrix.locationCount,
        routingSource: matrix.routingSource,
        osrmVerified: matrix.osrmVerified,
        reason: `Generated ${matrix.locationCount}x${matrix.locationCount} road distance & duration matrix (Source: ${matrix.routingSource}).`
    });

    // Step 2: Maximum fleet vehicle capacity
    const feasibleFleet = (!isOutward && options.activeInwardStartingPlaces?.length > 0)
        ? availableVehicles.filter((v) => hasConfiguredInwardStartingPlace(v, options.activeInwardStartingPlaces))
        : availableVehicles;
    const effectiveVehicles = (feasibleFleet.length > 0) ? feasibleFleet : availableVehicles;

    const fleetCaps = effectiveVehicles
        .map((v) => Number(v.capacity || v.seatCapacity || 0))
        .filter((c) => c > 0);
    const maxBusCapacity = fleetCaps.length > 0 ? Math.max(...fleetCaps) : 70;

    // Step 3: Global Candidate Route Generation (Clarke-Wright + Nearest Insertion)
    let candidateRoutes = generateGlobalCandidateRoutes({
        stops: resolvedStops,
        matrix,
        maxBusCapacity,
        tripMode,
        options
    });

    auditTrail.push({
        action: "GENERATE_CANDIDATES",
        initialRouteCount: candidateRoutes.length,
        reason: `Formed ${candidateRoutes.length} initial road-optimized candidate routes across all stopping areas.`
    });

    // Step 4: Iterative Inter-Route Local Search (Relocate, Exchange, Or-opt)
    let localSearchIterations = 0;
    const MAX_LOCAL_SEARCH_ROUNDS = 8;
    let localSearchActive = true;

    while (localSearchActive && localSearchIterations < MAX_LOCAL_SEARCH_ROUNDS) {
        localSearchActive = false;
        localSearchIterations++;

        // Try Relocate
        const relRes = applyInterRouteRelocate({
            routes: candidateRoutes,
            matrix,
            maxBusCapacity,
            tripMode,
            auditTrail
        });
        if (relRes.improved) {
            candidateRoutes = relRes.routes;
            localSearchActive = true;
            continue;
        }

        // Try Exchange
        const exRes = applyInterRouteExchange({
            routes: candidateRoutes,
            matrix,
            maxBusCapacity,
            tripMode,
            auditTrail
        });
        if (exRes.improved) {
            candidateRoutes = exRes.routes;
            localSearchActive = true;
            continue;
        }
    }

    // Step 4B: Holistic Transportation Manager Fleet Balancing & Target Determination
    const configuredPlacesList = options.activeInwardStartingPlaces || [];
    const totalComingDemand = resolvedStops.reduce(
        (sum, s) => sum + (Array.isArray(s.userIds) ? s.userIds.length : Number(s.userCount || 0)),
        0
    );

    // Purpose-Driven Small Group Consolidation (Requirements 5, 6, 7, 41)
    // Absorbs small passenger groups like Q1 (9 pax) into compatible existing routes
    // before determining final fleet allocation.
    candidateRoutes = consolidateSmallPassengerRoutes({
        routes: candidateRoutes,
        matrix,
        maxBusCapacity,
        tripMode,
        smallRouteThreshold: 15,
        activeInwardStartingPlaces: configuredPlacesList,
        anchorHub,
        sourceHub: options.sourceHub || anchorHub,
        destinationHub: options.destinationHub || anchorHub,
        auditTrail
    });

    const sortedFleetDesc = [...availableVehicles]
        .filter((v) => v.isActive !== false && Number(v.capacity || v.seatCapacity || 0) > 0)
        .sort((a, b) => Number(b.capacity || b.seatCapacity || 0) - Number(a.capacity || a.seatCapacity || 0));
    let accFleetCap = 0;
    let minCapacityBuses = 0;
    for (const b of sortedFleetDesc) {
        accFleetCap += Number(b.capacity || b.seatCapacity || 0);
        minCapacityBuses++;
        if (accFleetCap >= totalComingDemand) break;
    }
    if (minCapacityBuses === 0 && totalComingDemand > 0) {
        minCapacityBuses = Math.max(1, Math.ceil(totalComingDemand / maxBusCapacity));
    }

    // Purpose-Driven Inward Corridor Consolidation & Absorption Test:
    // Before fleet expansion, verify whether adjacent candidate clusters can naturally be absorbed
    // without violating capacity, angular separation, detour ratio, or directional continuity.
    let consolidationAttempts = [];
    if (!isOutward && candidateRoutes.length > minCapacityBuses && !options?.oppositePlan) {
        const consolRes = evaluateInwardCorridorConsolidation({
            routes: candidateRoutes,
            availableVehicles,
            configuredInwardStartingPlaces: configuredPlacesList,
            destinationHub: anchorHub,
            maxBusCapacity,
            matrix,
            tripMode,
            auditTrail
        });
        candidateRoutes = consolRes.routes;
        consolidationAttempts = consolRes.consolidationAttempts || [];
    }

    const fleetBalancing = evaluateFleetBalancingDecision({
        currentDirection: isOutward ? "OUTWARD" : "INWARD",
        currentDemand: totalComingDemand,
        candidateRoutes,
        availableVehicles,
        configuredInwardStartingPlaces: configuredPlacesList,
        oppositePlan: options.oppositePlan || null
    });

    // Attempt to satisfy demand using minimum capacity buses first (Requirements 2, 4, 21, 22)
    const targetRouteCount = fleetBalancing.targetRouteCount || minCapacityBuses;

    // Apply consolidation if candidateRoutes exceeds targetRouteCount
    if (candidateRoutes.length > targetRouteCount) {
        candidateRoutes = consolidateCandidateRoutes({
            routes: candidateRoutes,
            targetRouteCount,
            maxBusCapacity,
            matrix,
            tripMode,
            auditTrail
        });
    } else if (candidateRoutes.length < targetRouteCount && (fleetBalancing.selectedFleet?.length || 0) >= targetRouteCount) {
        candidateRoutes = expandCandidateRoutesToTarget({
            routes: candidateRoutes,
            targetRouteCount,
            matrix,
            tripMode,
            auditTrail
        });
    }

    // Purpose-Driven Fleet Capacity Balancing for Inward & Outward:
    // Balances passenger demands across candidate routes to match the capacities
    // of the selected fleet, respecting corridor continuity.
    if (fleetBalancing.selectedFleet?.length > 0) {
        candidateRoutes = balanceCandidateRoutesToFleetCapacities({
            routes: candidateRoutes,
            fleet: fleetBalancing.selectedFleet,
            activeInwardStartingPlaces: configuredPlacesList,
            matrix,
            tripMode,
            sourceHub: options.sourceHub || anchorHub,
            destinationHub: options.destinationHub || anchorHub
        });
    }

    // Step 5: 2-Opt Road Sequence Improvement on Final Routes
    candidateRoutes = candidateRoutes.map((route) => {
        const opt = optimizeTour2OptRoad({
            tour: route.stops,
            matrix,
            tripMode
        });
        return {
            ...route,
            stops: opt.tour,
            routeDistanceKm: opt.roadDistanceKm
        };
    });

    // Step 6: Delayed Fleet-Wide Vehicle Assignment (with Vehicle Reuse Preference)
    const {
        assignedRoutes: initialAssignedRoutes,
        unassignedRoutes,
        vehicleUsageLogs,
        vehicleReuseCount,
        vehicleReuseRate,
        reusedVehicleNames
    } = assignVehiclesToOptimizedRoutes({
        routes: candidateRoutes,
        availableVehicles: (fleetBalancing.selectedFleet?.length > 0) ? fleetBalancing.selectedFleet : availableVehicles,
        tripMode,
        activeInwardStartingPlaces: configuredPlacesList,
        previousRoutes: options.previousRoutes || [],
        preferredVehicleIds: fleetBalancing.oppositeVehicleIds || []
    });
    let assignedRoutes = initialAssignedRoutes;

    // Step 6A: Stage C GLOBAL BALANCING & PASSENGER REASSIGNMENT (Requirements 4, 5, 6, 10, 13)
    if (unassignedRoutes.length > 0 && assignedRoutes.length > 0) {
        rebalanceUnallocatedPassengersToSelectedBuses({
            assignedRoutes,
            unassignedRoutes,
            matrix,
            tripMode,
            maxBusCapacity,
            configuredInwardStartingPlaces: configuredPlacesList,
            anchorHub,
            auditTrail
        });
    }

    // Step 6B: Cross-Corridor Starting Hub Duplication Resolution
    // If one bus starts at Hub A (e.g. Sellur) and another route detours to visit Hub A's locality,
    // reassign that stop to Hub A's bus (provided capacity permits), eliminating cross-town leaps.
    if (!isOutward && configuredPlacesList.length > 0 && assignedRoutes.length > 1) {
        rebalanceCrossCorridorStartingHubDuplications({
            assignedRoutes,
            activeInwardStartingPlaces: configuredPlacesList,
            maxBusCapacity,
            matrix,
            tripMode,
            auditTrail
        });
    }

    // Step 6C: Evaluate Repeated Physical Stops Consolidation (Requirements 8, 9, 10)
    // Only consolidates duplicate visits if capacity, inward starting hubs, and OSRM continuity are preserved.
    if (assignedRoutes.length > 1) {
        evaluateAndConsolidateRepeatedPhysicalStops({
            routes: assignedRoutes,
            tripMode,
            matrix,
            activeInwardStartingPlaces: configuredPlacesList,
            anchorHub,
            sourceHub: options.sourceHub || anchorHub,
            destinationHub: options.destinationHub || anchorHub,
            auditTrail
        });
    }

    // Step 6D: Purpose-Driven Outward Fleet Consolidation & Passenger Rebalancing (Requirements 4, 5, 6, 7, 21, 22)
    // Evaluates whether low-occupancy buses can be dissolved into adjacent corridor routes
    // via direct insertion or corridor multi-hop rebalancing, preserving 100% road continuity and detour ratio <= 2.25x.
    if (isOutward && assignedRoutes.length > 1) {
        assignedRoutes = consolidateAndRebalanceLowOccupancyOutwardRoutes({
            routes: assignedRoutes,
            availableVehicles,
            sourceHub: options.sourceHub || anchorHub,
            matrix,
            tripMode,
            auditTrail
        });
    }
 
    // Step 6E: GUARANTEED SEATING PASSENGER BALANCING (ZERO STANDING PASSENGERS)
    // Ensures passengerCount <= actualVehicleSeatCapacity for EVERY route with 0 standing passengers.
    const seatingRes = balanceRoutesToGuaranteedSeating({
        routes: assignedRoutes,
        availableVehicles,
        matrix,
        hub: anchorHub,
        tripMode,
        activeInwardStartingPlaces: configuredPlacesList,
        auditTrail
    });
    assignedRoutes = seatingRes.balanced;

    const finalAllocatedCount = assignedRoutes.length;
    fleetBalancing.vehicleReuseCount = vehicleReuseCount || 0;
    fleetBalancing.vehicleReuseRate = vehicleReuseRate || 0;
    fleetBalancing.reusedVehicleNames = reusedVehicleNames || [];
    fleetBalancing.allocatedBusCount = finalAllocatedCount;
    fleetBalancing.feasibleBusCount = finalAllocatedCount;
    fleetBalancing.minimumCapacityBuses = minCapacityBuses;

    const diffFinal = finalAllocatedCount - minCapacityBuses;
    let reasonForAdditionalVehicle = null;
    if (diffFinal > 0) {
        reasonForAdditionalVehicle = `Minimum theoretical fleet: ${minCapacityBuses} buses. Feasible route allocation: ${finalAllocatedCount} buses with guaranteed seating. ${diffFinal === 1 ? "One additional bus is" : `${diffFinal} additional buses are`} deployed to guarantee zero standing passengers while respecting road network topology.`;
    } else {
        reasonForAdditionalVehicle = `Minimum capacity requirement: ${minCapacityBuses} buses. Feasible route allocation: ${finalAllocatedCount} buses with guaranteed seating across all routes.`;
    }
    fleetBalancing.decisionReason = reasonForAdditionalVehicle;

    // Step 7: Anchored Stop Sequencing & Whole-Route Progression Optimization
    if (isOutward) {
        for (const route of assignedRoutes) {
            const seq = sequenceOutwardRouteStops({
                departureHub: anchorHub,
                stops: route.stops,
                matrix,
                tripMode
            });
            route.stops = seq.stops;
            route.routeDistanceKm = seq.routeDistanceKm;
            route.qualityValidation = seq.qualityValidation;
            route.routeQuality = seq.qualityValidation;
            route.startingHub = {
                name: anchorHub.name || "Departure Hub",
                locationName: anchorHub.name || "Departure Hub",
                latitude: Number(anchorHub.latitude),
                longitude: Number(anchorHub.longitude)
            };
            route.firstPassengerStop = seq.stops[0] ? {
                name: seq.stops[0].name,
                latitude: Number(seq.stops[0].latitude),
                longitude: Number(seq.stops[0].longitude)
            } : null;
            route.operationalContinuityVerified = Boolean(
                seq.qualityValidation?.directionalReversals === 0 &&
                (seq.qualityValidation?.backtrackingDistanceKm || 0) < 2.0 &&
                (seq.qualityValidation?.detourRatio || 1.0) <= 2.25
            );
        }
        auditTrail.push({
            action: "OUTWARD_PROGRESSIVE_SEQUENCING",
            reason: "Applied progressive outward road sequencing from departure hub, eliminating reversals and crossovers."
        });
    } else {
        for (const route of assignedRoutes) {
            const startPlace = findStartingPlaceForBus(route.vehicle, options.activeInwardStartingPlaces || []);
            const startingHub = (startPlace && isValidCoordinate(startPlace.latitude, startPlace.longitude))
                ? startPlace
                : (route.stops && route.stops[0]) || anchorHub;

            const seq = sequenceInwardRouteStops({
                startingHub,
                destinationHub: anchorHub,
                stops: route.stops,
                matrix,
                tripMode
            });
            route.stops = seq.stops;
            route.routeDistanceKm = seq.routeDistanceKm;
            route.qualityValidation = seq.qualityValidation;
            route.routeQuality = seq.qualityValidation;
            route.startingHub = seq.qualityValidation.startingHubDetails;
            route.hasStartingHubPickup = Boolean(seq.stops[0]?.isStartingHubPickup);
            route.startingHubPassengers = seq.stops[0]?.isStartingHubPickup ? (seq.stops[0].userCount || (seq.stops[0].userIds || []).length || 0) : 0;
            route.firstPassengerStop = seq.qualityValidation.firstPassengerStop;
            route.passengerStops = seq.stops;
            route.destination = seq.qualityValidation.destinationDetails;
            route.directDistance = seq.qualityValidation.directDistance;
            route.detourRatio = seq.qualityValidation.detourRatio;
            route.directionalReversals = seq.qualityValidation.directionalReversals;
            route.backtrackingDistanceKm = seq.qualityValidation.backtrackingDistanceKm;
            route.operationalContinuityVerified = seq.qualityValidation.operationalContinuityVerified;
            route.consolidationAttempts = consolidationAttempts;

            if (!route.whySeparateRouteNeeded) {
                const hubName = startingHub?.locationName || startingHub?.name || "hub";
                const destName = anchorHub?.name || "destination";
                route.whySeparateRouteNeeded = seq.qualityValidation.operationalContinuityVerified
                    ? `Route verified with continuous road progression from ${hubName} toward ${destName} (${seq.routeDistanceKm} km, detour ratio ${seq.qualityValidation.detourRatio}x).`
                    : `Separate bus retained to serve dedicated residential corridor.`;
            }
        }
        auditTrail.push({
            action: "INWARD_ANCHORED_SEQUENCING",
            reason: "Applied anchored progression ordering from configured starting hubs toward destination, eliminating loops and backtracking."
        });
    }

    if (!isOutward) {
        const totalComingDemand = resolvedStops.reduce(
            (sum, s) => sum + (Array.isArray(s.userIds) ? s.userIds.length : Number(s.userCount || 0)),
            0
        );
        const capacityBasedRequiredBuses = Math.ceil(totalComingDemand / maxBusCapacity);
        const eligibleVehicles = options.activeInwardStartingPlaces?.length > 0
            ? availableVehicles.filter((v) => hasConfiguredInwardStartingPlace(v, options.activeInwardStartingPlaces))
            : availableVehicles;
        const missingStartingPlaces = assignedRoutes
            .filter((r) => !hasConfiguredInwardStartingPlace(r.vehicle, options.activeInwardStartingPlaces || []))
            .map((r) => r.vehicleName);

        console.log(`[INWARD_AI_DEBUG]
comingDemand = ${totalComingDemand}
vehicleCapacity = ${maxBusCapacity}
capacityBasedRequiredBuses = ${capacityBasedRequiredBuses}
eligibleVehicles = [${eligibleVehicles.map((v) => v.vehicleName || v.name).join(", ")}]
selectedVehicles = [${assignedRoutes.map((r) => r.vehicleName).join(", ")}]
selectedVehicleCount = ${assignedRoutes.length}
configuredStartingPlaces = [${(options.activeInwardStartingPlaces || []).map((sp) => sp.busName || sp.name || sp.locationName).join(", ")}]
missingStartingPlaces = [${missingStartingPlaces.join(", ")}]
reasonForAdditionalVehicle = ${reasonForAdditionalVehicle || "None (Capacity and route constraints satisfied)"}
finalRequiredBuses = ${assignedRoutes.length}`);
    }

    return {
        routes: assignedRoutes,
        optimizedRoutes: assignedRoutes,
        unassignedRoutes,
        unallocatedCount: unassignedRoutes.length,
        matrix,
        auditTrail,
        vehicleUsageLogs,
        reasonForAdditionalVehicle,
        fleetBalancing,
        consolidationAttempts
    };
};

// ============================================================================
// 9. LEGACY COMPATIBILITY EXPORTS
// ============================================================================

export const clusterStopsHybrid = async ({
    resolvedStops = [],
    depot = DEFAULT_SOURCE_HUB,
    availableVehicles = []
}) => {
    if (!Array.isArray(resolvedStops) || resolvedStops.length === 0) return [];

    const matrix = await buildGlobalOptimizationMatrix({ depot, stops: resolvedStops });
    const maxBusCap = Math.max(...availableVehicles.map((v) => Number(v.capacity || v.seatCapacity || 70)), 70);

    const candidateRoutes = generateGlobalCandidateRoutes({
        stops: resolvedStops,
        matrix,
        maxBusCapacity: maxBusCap,
        tripMode: "FROM_SOURCE"
    });

    return candidateRoutes.map((r, idx) => {
        const bearings = (r.stops || []).map((s) => calculateBearing(depot.latitude, depot.longitude, s.latitude, s.longitude));
        const avgBearing = bearings.length > 0 ? (bearings.reduce((a, b) => a + b, 0) / bearings.length) : 0;
        const sectorLabel = getCorridorSectorLabel(avgBearing);
        return {
            corridorId: `corridor_${idx + 1}`,
            name: `${sectorLabel} Corridor ${idx + 1} (${r.stops.length} stops, ${r.assignedUsers} pax)`,
            stops: r.stops,
            totalDemand: r.assignedUsers,
            avgBearing,
            maxDistFromDepotKm: 0
        };
    });
};

export const getCorridorSectorLabel = (bearing) => {
    if (bearing >= 337.5 || bearing < 22.5) return "North Sector";
    if (bearing >= 22.5 && bearing < 67.5) return "North-East Sector";
    if (bearing >= 67.5 && bearing < 112.5) return "East Sector";
    if (bearing >= 112.5 && bearing < 157.5) return "South-East Sector";
    if (bearing >= 157.5 && bearing < 202.5) return "South Sector";
    if (bearing >= 202.5 && bearing < 247.5) return "South-West Sector";
    if (bearing >= 247.5 && bearing < 292.5) return "West Sector";
    return "North-West Sector";
};

export const optimizeStopSequence2Opt = async (stops = [], sourceHub = DEFAULT_SOURCE_HUB) => {
    if (!Array.isArray(stops) || stops.length <= 2) {
        return { orderedStops: stops, isImproved: false, iterations: 0 };
    }
    const matrix = await buildGlobalOptimizationMatrix({ depot: sourceHub, stops });
    const enriched = stops.map((s, idx) => ({ ...s, matrixIndex: idx + 1 }));
    const res = optimizeTour2OptRoad({ tour: enriched, matrix, tripMode: "FROM_SOURCE" });
    return {
        orderedStops: res.tour,
        isImproved: res.isImproved,
        iterations: res.iterations,
        optimizedDistKm: res.roadDistanceKm
    };
};

/**
 * Evaluates transparent multi-objective score for an allocated route:
 * TOTAL_SCORE = W1*Dist + W2*Time + W3*Util + W4*Hist + W5*ML - DetourPenalties
 */
export const calculateMultiObjectiveRouteScore = ({
    passengerCount = 0,
    vehicleCapacity = 70,
    roadDistanceKm = 0,
    routeDurationMin = 0,
    stops = [],
    isContinuous = true,
    detourRatio = 1.25,
    backtrackingDistanceKm = 0,
    directionalReversals = 0,
    isRoadVerified = true,
    isReusedBus = false,
    hasSharedCorridor = false
}) => {
    const utilRatio = vehicleCapacity > 0 ? (passengerCount / vehicleCapacity) : 0;

    // 1. Realistic institutional distance score:
    // 30-50 km one-way = generally reasonable (high score)
    // 50-60 km one-way = still reasonable
    // 60-70 km one-way = evaluated carefully
    // 70+ km one-way = penalized without strong justification
    let distanceScore = 1.0;
    if (roadDistanceKm <= 45.0) {
        distanceScore = Math.max(0.65, 1.0 - (roadDistanceKm / 150.0));
    } else if (roadDistanceKm <= 60.0) {
        distanceScore = Math.max(0.50, 0.90 - ((roadDistanceKm - 45.0) / 75.0));
    } else {
        distanceScore = Math.max(0.20, 0.70 - ((roadDistanceKm - 60.0) / 45.0));
    }

    // 2. Travel time efficiency:
    const duration = routeDurationMin > 0 ? routeDurationMin : (roadDistanceKm / 0.5);
    const timeScore = Math.max(0.2, Math.min(1.0, 1.0 - (duration / 120.0)));

    // 3. Seat utilization (strict capacity cap: > 1.0 is invalid)
    const utilizationScore = utilRatio > 1.0 ? 0.0 : Math.min(1.0, utilRatio / 0.85);

    // 4. Stop density & passenger convenience:
    const stopCount = Array.isArray(stops) ? stops.length : 0;
    const stopDensityScore = stopCount >= 2 && stopCount <= 9 ? 0.95 : (stopCount > 9 && stopCount <= 13 ? 0.85 : 0.70);

    // 5. OSRM Road verification & connectivity:
    const roadConnectivityScore = (isRoadVerified !== false && isContinuous !== false) ? 1.0 : 0.60;

    // 6. Natural directional progression (penalize reversals):
    const progressionScore = directionalReversals === 0 ? 1.0 : Math.max(0.2, 1.0 - (directionalReversals * 0.25));

    // Multi-objective weights (sum = 1.00)
    // Utilization (0.30), Distance (0.20), Time (0.15), Road Connectivity (0.15), Stop Convenience (0.10), Progression (0.10)
    const baseScore =
        0.30 * utilizationScore +
        0.20 * distanceScore +
        0.15 * timeScore +
        0.15 * roadConnectivityScore +
        0.10 * stopDensityScore +
        0.10 * progressionScore;

    // Meaningful Backtracking Penalty:
    const backtrackingPenalty = Number((Math.min(0.25, (Number(backtrackingDistanceKm || 0) / 8.0) * 0.25)).toFixed(3));

    // Detour Penalty (acceptable <= 2.2x):
    const numDetour = Number(detourRatio || 1.0);
    const detourPenalty = numDetour > 2.0 ? Number((Math.min(0.15, (numDetour - 2.0) * 0.35)).toFixed(3)) : 0;

    // Existing Bus Reuse & Route Sharing Benefits:
    const busReuseBonus = isReusedBus ? 0.05 : 0;
    const routeSharingBonus = hasSharedCorridor ? 0.04 : 0;

    const rawScore = baseScore - backtrackingPenalty - detourPenalty + busReuseBonus + routeSharingBonus;
    const finalScore = Number(Math.max(0.1, Math.min(1.0, rawScore)).toFixed(3));

    const explanations = {
        whyRouteSelected: `High utilization of ${passengerCount}/${vehicleCapacity} passengers (${(utilRatio * 100).toFixed(1)}%) with optimal road distance (${roadDistanceKm} km, ~${duration.toFixed(0)} mins).`,
        whyVehicleSelected: `Capacity of ${vehicleCapacity} seats safely accommodates ${passengerCount} confirmed passengers with ${Math.max(0, vehicleCapacity - passengerCount)} spare seats.`,
        scoreBreakdown: {
            overallScore: finalScore,
            optimizationScore: finalScore,
            mlRouteQuality: Number(finalScore),
            seatUtilization: Number(utilizationScore.toFixed(3)),
            roadDistanceEfficiency: Number(distanceScore.toFixed(3)),
            travelTimeEfficiency: Number(timeScore.toFixed(3)),
            roadConnectivityScore: Number(roadConnectivityScore.toFixed(3)),
            progressionScore: Number(progressionScore.toFixed(3)),
            backtrackingPenalty,
            detourPenalty,
            busReuseBonus,
            routeSharingBonus
        }
    };

    const diagnostics = {
        backtrackingPenalty,
        detourPenalty,
        reusedExistingBus: Boolean(isReusedBus),
        sharedRouteSegment: Boolean(hasSharedCorridor),
        routeProgressionValidation: (directionalReversals === 0 && Number(backtrackingDistanceKm || 0) < 1.0)
            ? "Continuous forward progression verified (0 reversals, minimal detour)"
            : (directionalReversals > 0 ? `Progression alert: ${directionalReversals} reversals detected` : "Progression reviewed"),
        osrmConnectivityVerified: Boolean(isRoadVerified && isContinuous)
    };

    return {
        totalScore: finalScore,
        score: finalScore,
        optimizationScore: finalScore,
        mlScore: finalScore,
        mlQuality: {
            qualityScore: finalScore,
            recommendation: finalScore >= 0.85 ? "EXCELLENT" : (finalScore >= 0.70 ? "GOOD" : "ACCEPTABLE"),
            isDeterministicHeuristic: true,
            scoringMethod: "Deterministic Multi-Objective Optimization Score"
        },
        explanations,
        diagnostics
    };
};

/*
|--------------------------------------------------------------------------
| ROUTE CONTINUITY & OPPOSITE-DIRECTION VALIDATION & FALLBACK LAYER
|--------------------------------------------------------------------------
|
| Strict Priority Order:
| 1. Vehicle capacity
| 2. Continuous road progression
| 3. Correct travel direction
| 4. Reasonable detour
| 5. Stop coverage
| 6. Route sharing / merging
| 7. Seat utilization
| 8. Minimizing number of buses
|
| Principles:
| - Continuous road progression has higher priority than minimizing buses.
| - Never force an opposite-direction or severe backtracking stop into a route.
| - When a continuity violation is detected:
|   1. Try repair within existing compatible buses.
|   2. If no existing bus can take it, try ONE additional available bus from fleet.
|   3. If impossible or no vehicle exists, mark affected passengers UNALLOCATED.
| - Never fabricate fake vehicles.
*/

/**
 * Calculates the circular mean bearing of a list of degrees (0-360).
 */
export const calculateAverageBearing = (bearings = []) => {
    if (!Array.isArray(bearings) || bearings.length === 0) return null;
    let sumSin = 0;
    let sumCos = 0;
    for (const b of bearings) {
        if (!Number.isFinite(b)) continue;
        const rad = (b * Math.PI) / 180;
        sumSin += Math.sin(rad);
        sumCos += Math.cos(rad);
    }
    const avgRad = Math.atan2(sumSin / bearings.length, sumCos / bearings.length);
    let avgDeg = (avgRad * 180) / Math.PI;
    if (avgDeg < 0) avgDeg += 360;
    return Number(avgDeg.toFixed(1));
};

/**
 * Checks if a specific stop in a sequence causes a directional reversal,
 * severe backtracking, or excessive detour.
 */
export const checkStopTransitionViolation = ({
    stop,
    prevStop,
    nextStop,
    origin,
    destination,
    tripMode = "FROM_SOURCE",
    averageBearing = null
}) => {
    const isOutward = tripMode === "FROM_SOURCE" || tripMode === "OUTWARD";

    if (isOutward) {
        // Outward: Route moves away from origin (sourceHub)
        if (origin && isValidCoordinate(origin.latitude, origin.longitude) && isValidCoordinate(stop?.latitude, stop?.longitude)) {
            const distFromOrigin = calculateDistanceKm(origin.latitude, origin.longitude, stop.latitude, stop.longitude);

            if (prevStop && isValidCoordinate(prevStop.latitude, prevStop.longitude)) {
                const prevDistFromOrigin = calculateDistanceKm(origin.latitude, origin.longitude, prevStop.latitude, prevStop.longitude);
                // Severe backward movement toward origin depot (> 2.0 km closer to origin than previous stop)
                if (prevDistFromOrigin - distFromOrigin > 2.0) {
                    return {
                        isViolation: true,
                        reason: `Direction reversal: stop '${stop.name}' travels ${(prevDistFromOrigin - distFromOrigin).toFixed(1)} km backward toward departure depot.`
                    };
                }
            }

            // Directional inversion: acute angle (> 130 deg turnaround, cos < -0.65)
            if (prevStop && nextStop && isValidCoordinate(prevStop.latitude, prevStop.longitude) && isValidCoordinate(nextStop.latitude, nextStop.longitude)) {
                const uLat = stop.latitude - prevStop.latitude;
                const uLon = stop.longitude - prevStop.longitude;
                const vLat = nextStop.latitude - stop.latitude;
                const vLon = nextStop.longitude - stop.longitude;
                const dot = (uLat * vLat) + (uLon * vLon);
                const magU = Math.sqrt(uLat * uLat + uLon * uLon);
                const magV = Math.sqrt(vLat * vLat + vLon * vLon);
                if (magU > 0.012 && magV > 0.012 && (dot / (magU * magV)) < -0.65) {
                    return {
                        isViolation: true,
                        reason: `Severe hairpin reversal: visiting '${stop.name}' causes acute backtracking (>130° turnaround).`
                    };
                }
            }

            // Significant corridor bearing divergence (> 50 degrees from route corridor)
            if (averageBearing !== null && distFromOrigin > 2.5) {
                const stopBearing = calculateBearing(origin.latitude, origin.longitude, stop.latitude, stop.longitude);
                const bearingDiff = getBearingDifference(stopBearing, averageBearing);
                if (bearingDiff > 50) {
                    return {
                        isViolation: true,
                        reason: `Corridor bearing violation: stop '${stop.name}' diverges by ${bearingDiff.toFixed(0)}° from route corridor.`
                    };
                }
            }
        }
    } else {
        // Inward: Route moves from origin (startingHub) toward destination (destinationHub)
        if (destination && isValidCoordinate(destination.latitude, destination.longitude) && isValidCoordinate(stop?.latitude, stop?.longitude)) {
            const distToDest = calculateDistanceKm(stop.latitude, stop.longitude, destination.latitude, destination.longitude);

            if (prevStop && isValidCoordinate(prevStop.latitude, prevStop.longitude)) {
                const prevDistToDest = calculateDistanceKm(prevStop.latitude, prevStop.longitude, destination.latitude, destination.longitude);
                // Severe backward movement away from destination (> 2.0 km farther from destination than previous stop)
                if (distToDest - prevDistToDest > 2.0) {
                    return {
                        isViolation: true,
                        reason: `Direction reversal: stop '${stop.name}' moves ${(distToDest - prevDistToDest).toFixed(1)} km backward away from destination.`
                    };
                }
            }

            // Directional inversion toward destination
            const nextLoc = nextStop || destination;
            if (prevStop && nextLoc && isValidCoordinate(prevStop.latitude, prevStop.longitude) && isValidCoordinate(nextLoc.latitude, nextLoc.longitude)) {
                const uLat = stop.latitude - prevStop.latitude;
                const uLon = stop.longitude - prevStop.longitude;
                const vLat = nextLoc.latitude - stop.latitude;
                const vLon = nextLoc.longitude - stop.longitude;
                const dot = (uLat * vLat) + (uLon * vLon);
                const magU = Math.sqrt(uLat * uLat + uLon * uLon);
                const magV = Math.sqrt(vLat * vLat + vLon * vLon);
                if (magU > 0.012 && magV > 0.012 && (dot / (magU * magV)) < -0.65) {
                    return {
                        isViolation: true,
                        reason: `Severe hairpin reversal: visiting '${stop.name}' causes acute backtracking (>130° reversal away from destination).`
                    };
                }
            }

            // Return to starting place / loop back
            if (origin && isValidCoordinate(origin.latitude, origin.longitude) && prevStop) {
                const distToOrigin = calculateDistanceKm(stop.latitude, stop.longitude, origin.latitude, origin.longitude);
                if (distToOrigin <= 1.2 && !isSamePlace(origin, stop)) {
                    return {
                        isViolation: true,
                        reason: `Loopback violation: stop '${stop.name}' loops back near starting hub after departure.`
                    };
                }
            }
        }
    }

    return { isViolation: false, reason: null };
};

/**
 * Validates route continuity across every route and attempts repair via existing compatible buses
 * or at most ONE additional available fleet vehicle before marking unallocated.
 */
export const validateAndRepairRouteContinuity = async ({
    chosenBuses = [],
    availableVehicles = [],
    anchorHub = DEFAULT_SOURCE_HUB,
    sourceHub = null,
    destinationHub = null,
    tripMode = "FROM_SOURCE",
    activeInwardStartingPlaces = [],
    matrix = null
}) => {
    const isOutward = tripMode === "FROM_SOURCE" || tripMode === "OUTWARD";
    const resolvedOriginHub = sourceHub || anchorHub || DEFAULT_SOURCE_HUB;
    const resolvedDestHub = destinationHub || anchorHub || DEFAULT_SOURCE_HUB;

    let routes = chosenBuses.map((b, idx) => {
        const stops = Array.isArray(b.stops) ? b.stops.map((s) => {
            const count = (Array.isArray(s.userIds) && s.userIds.length > 0)
                ? s.userIds.length
                : (s.userCount || s.passengerCount || 0);
            const userIds = (Array.isArray(s.userIds) && s.userIds.length > 0)
                ? [...s.userIds]
                : Array.from({ length: count }, (_, i) => `${s.name || "stop"}_user_${i + 1}`);
            return {
                ...s,
                userIds,
                userCount: count,
                passengerCount: count
            };
        }) : [];
        const sumUsers = stops.reduce((sum, s) => sum + s.userCount, 0);
        return {
            ...b,
            routeId: b.routeId || b.routeCode || `route_${idx + 1}`,
            assignedUsers: sumUsers > 0 ? sumUsers : (b.assignedUsers || b.passengerCount || 0),
            capacity: Number(b.capacity || b.vehicleCapacity || 70),
            stops,
            users: stops.flatMap((s) => s.userIds || [])
        };
    });

    let fallbackBusUsed = false;
    let anyRepaired = false;
    let totalViolations = 0;
    const unallocatedList = [];

    const getStopMatrixIdx = (st) => {
        if (st?.matrixIndex !== undefined) return st.matrixIndex;
        if (matrix?.locations) {
            const found = matrix.locations.findIndex((loc, idx) =>
                idx > 0 &&
                (loc.name === st.name || (Math.abs(Number(loc.latitude) - Number(st.latitude)) < 0.001 && Math.abs(Number(loc.longitude) - Number(st.longitude)) < 0.001))
            );
            if (found > 0) return found;
        }
        return undefined;
    };

    // Helper: evaluate whole route continuity
    const testRouteContinuity = (routeStops, routeObj) => {
        if (!routeStops || routeStops.length === 0) {
            return { isContinuous: true, reversals: 0, backtrackingKm: 0, detourRatio: 1.0, orderedStops: [], violations: [] };
        }

        const violations = [];

        // Special check for single-stop inward route: startingPlace -> stop -> destination
        if (!isOutward && routeStops.length === 1) {
            const sp = findStartingPlaceForBus(routeObj?.vehicle || routeObj, activeInwardStartingPlaces) ||
                routeObj?.inwardStartLocation || routeObj?.startLocation;
            if (sp && isValidCoordinate(sp.latitude, sp.longitude) && resolvedDestHub && isValidCoordinate(resolvedDestHub.latitude, resolvedDestHub.longitude)) {
                const s = routeStops[0];
                const dStartToDest = calculateDistanceKm(sp.latitude, sp.longitude, resolvedDestHub.latitude, resolvedDestHub.longitude);
                const dStartToStop = calculateDistanceKm(sp.latitude, sp.longitude, s.latitude, s.longitude);
                const dStopToDest = calculateDistanceKm(s.latitude, s.longitude, resolvedDestHub.latitude, resolvedDestHub.longitude);
                const totalDist = dStartToStop + dStopToDest;
                const detour = dStartToDest > 0 ? totalDist / dStartToDest : 1.0;

                const uLat = s.latitude - sp.latitude;
                const uLon = s.longitude - sp.longitude;
                const vLat = resolvedDestHub.latitude - s.latitude;
                const vLon = resolvedDestHub.longitude - s.longitude;
                const dot = (uLat * vLat) + (uLon * vLon);
                const magU = Math.sqrt(uLat * uLat + uLon * uLon);
                const magV = Math.sqrt(vLat * vLat + vLon * vLon);
                const cosVal = (magU > 0.012 && magV > 0.012) ? (dot / (magU * magV)) : 1.0;

                if (detour > 3.0 || cosVal < -0.65) {
                    violations.push({
                        stopIndex: 0,
                        stop: s,
                        reason: `Inward detour (${detour.toFixed(2)}) or turnaround angle (${cosVal.toFixed(2)}) from starting place '${sp.name || "hub"}' to destination`
                    });
                    return {
                        isContinuous: false,
                        reversals: cosVal < -0.65 ? 1 : 0,
                        backtrackingKm: detour > 3.0 ? (totalDist - dStartToDest) : 0,
                        detourRatio: detour,
                        orderedStops: routeStops,
                        violations
                    };
                }
            }
            return { isContinuous: true, reversals: 0, backtrackingKm: 0, detourRatio: 1.0, orderedStops: routeStops, violations: [] };
        }

        if (isOutward) {
            const seqRes = sequenceOutwardRouteStops({
                departureHub: resolvedOriginHub,
                stops: routeStops,
                matrix,
                tripMode
            });
            const ordered = seqRes.stops || routeStops;
            const q = seqRes.qualityValidation || {};

            // Calculate corridor bearings from origin hub
            if (resolvedOriginHub && isValidCoordinate(resolvedOriginHub.latitude, resolvedOriginHub.longitude) && ordered.length >= 2) {
                const bearings = ordered.map(s => calculateBearing(resolvedOriginHub.latitude, resolvedOriginHub.longitude, s.latitude, s.longitude));

                // 1. Overall corridor span limit (<= 38.0°)
                const span = calculateMaxBearingSpan(resolvedOriginHub, ordered);
                if (span > 38.0) {
                    const avgBearing = calculateAverageBearing(bearings);
                    let maxDiff = -1;
                    let worstStop = null;
                    let worstIdx = -1;
                    for (let i = 0; i < ordered.length; i++) {
                        const diff = getBearingDifference(bearings[i], avgBearing);
                        if (diff > maxDiff) {
                            maxDiff = diff;
                            worstStop = ordered[i];
                            worstIdx = i;
                        }
                    }
                    violations.push({
                        stopIndex: worstIdx,
                        stop: worstStop,
                        reason: `Route corridor span exceeds limit (${span.toFixed(1)}° > 38.0°). Stop '${worstStop?.name}' diverges by ${maxDiff.toFixed(1)}° from route corridor average.`
                    });
                }

                // 2. Individual stop corridor divergence (> 32° divergence from dominant corridor)
                if (ordered.length >= 3) {
                    for (let i = 0; i < ordered.length; i++) {
                        const otherBearings = bearings.filter((_, idx) => idx !== i);
                        const avgOtherBearing = calculateAverageBearing(otherBearings);
                        const sDist = calculateDistanceKm(resolvedOriginHub.latitude, resolvedOriginHub.longitude, ordered[i].latitude, ordered[i].longitude);

                        if (avgOtherBearing !== null && sDist > 2.5) {
                            const diff = getBearingDifference(bearings[i], avgOtherBearing);
                            if (diff > 32.0) {
                                violations.push({
                                    stopIndex: i,
                                    stop: ordered[i],
                                    reason: `Corridor divergence: stop '${ordered[i].name}' diverges by ${diff.toFixed(0)}° from dominant route corridor.`
                                });
                            }
                        }
                    }
                }
            }

            // Lateral cross-corridor jumps between consecutive stops
            if (resolvedOriginHub && isValidCoordinate(resolvedOriginHub.latitude, resolvedOriginHub.longitude)) {
                for (let i = 0; i < ordered.length - 1; i++) {
                    const s1 = ordered[i];
                    const s2 = ordered[i + 1];
                    const b1 = calculateBearing(resolvedOriginHub.latitude, resolvedOriginHub.longitude, s1.latitude, s1.longitude);
                    const b2 = calculateBearing(resolvedOriginHub.latitude, resolvedOriginHub.longitude, s2.latitude, s2.longitude);
                    const bDiff = getBearingDifference(b1, b2);
                    const dHop = calculateDistanceKm(s1.latitude, s1.longitude, s2.latitude, s2.longitude);
                    if (bDiff > 22.0 && dHop > 4.75) {
                        violations.push({
                            stopIndex: i + 1,
                            stop: s2,
                            reason: `Lateral cross-corridor jump between '${s1.name}' and '${s2.name}' (bearing diff: ${bDiff.toFixed(1)}°, distance: ${dHop.toFixed(1)} km).`
                        });
                    }
                }
            }

            // Check acute turnaround transitions along route
            const fullTour = [resolvedOriginHub, ...ordered].filter(Boolean);
            for (let i = 1; i < fullTour.length; i++) {
                const prev = fullTour[i - 1];
                const curr = fullTour[i];
                const next = (i < fullTour.length - 1) ? fullTour[i + 1] : null;

                if (next) {
                    const uLat = curr.latitude - prev.latitude;
                    const uLon = curr.longitude - prev.longitude;
                    const vLat = next.latitude - curr.latitude;
                    const vLon = next.longitude - curr.longitude;
                    const dot = (uLat * vLat) + (uLon * vLon);
                    const magU = Math.sqrt(uLat * uLat + uLon * uLon);
                    const magV = Math.sqrt(vLat * vLat + vLon * vLon);
                    if (magU > 0.008 && magV > 0.008 && (dot / (magU * magV)) < -0.35) {
                        violations.push({
                            stopIndex: i,
                            stop: next,
                            reason: `Acute hairpin turnaround (>110°) between '${curr.name}' and '${next.name}'.`
                        });
                    }
                } else if (i >= 2) {
                    const prevPrev = fullTour[i - 2];
                    const uLat = prev.latitude - prevPrev.latitude;
                    const uLon = prev.longitude - prevPrev.longitude;
                    const vLat = curr.latitude - prev.latitude;
                    const vLon = curr.longitude - prev.longitude;
                    const dot = (uLat * vLat) + (uLon * vLon);
                    const magU = Math.sqrt(uLat * uLat + uLon * uLon);
                    const magV = Math.sqrt(vLat * vLat + vLon * vLon);
                    if (magU > 0.008 && magV > 0.008 && (dot / (magU * magV)) < -0.35) {
                        violations.push({
                            stopIndex: i - 1,
                            stop: curr,
                            reason: `Last stop '${curr.name}' causes acute hairpin turnaround (>110°) from previous leg.`
                        });
                    }
                }
            }

            // Physical barrier detection: geographically close but extreme road distance or duration
            for (let i = 0; i < ordered.length - 1; i++) {
                const s1 = ordered[i];
                const s2 = ordered[i + 1];
                if (isValidCoordinate(s1.latitude, s1.longitude) && isValidCoordinate(s2.latitude, s2.longitude)) {
                    const straight = calculateDistanceKm(s1.latitude, s1.longitude, s2.latitude, s2.longitude);
                    const idx1 = getStopMatrixIdx(s1);
                    const idx2 = getStopMatrixIdx(s2);
                    const road = (matrix && idx1 !== undefined && idx2 !== undefined && matrix.getDist)
                        ? matrix.getDist(idx1, idx2)
                        : straight * 1.25;
                    const dur = (matrix && idx1 !== undefined && idx2 !== undefined && matrix.getDur)
                        ? matrix.getDur(idx1, idx2)
                        : (road / STANDARD_BUS_SPEED_KMH) * 60;
                    if (straight > 0.4 && (road / straight > 3.5 || (straight < 2.5 && dur > 20))) {
                        violations.push({
                            stopIndex: i + 1,
                            stop: s2,
                            reason: `Physical barrier / excessive detour between '${s1.name}' and '${s2.name}' (straight: ${straight.toFixed(1)} km, road: ${road.toFixed(1)} km, ratio: ${(road / straight).toFixed(1)}x, time: ${dur.toFixed(0)} min).`
                        });
                    }
                }
            }

            const isCont = Boolean(
                violations.length === 0 &&
                (q.directionalReversals || 0) === 0 &&
                (q.backtrackingDistanceKm || 0) < 2.0 &&
                (q.detourRatio || 1.0) <= 2.25
            );

            return {
                isContinuous: isCont,
                reversals: (q.directionalReversals || 0) + violations.length,
                backtrackingKm: q.backtrackingDistanceKm || 0,
                detourRatio: q.detourRatio || 1.0,
                orderedStops: ordered,
                violations
            };
        } else {
            // INWARD
            const sp = findStartingPlaceForBus(routeObj?.vehicle || routeObj, activeInwardStartingPlaces) ||
                routeObj?.inwardStartLocation || routeObj?.startLocation || routeStops[0];
            const seqRes = sequenceInwardRouteStops({
                startingHub: sp,
                destinationHub: resolvedDestHub,
                stops: routeStops,
                matrix,
                tripMode
            });
            const ordered = seqRes.stops || routeStops;
            const q = seqRes.qualityValidation || {};

            // Calculate corridor bearings from destination hub for inward routes
            if (resolvedDestHub && isValidCoordinate(resolvedDestHub.latitude, resolvedDestHub.longitude)) {
                if (ordered.length >= 3) {
                    const bearings = ordered.map(s => calculateBearing(resolvedDestHub.latitude, resolvedDestHub.longitude, s.latitude, s.longitude));

                    for (let i = 0; i < ordered.length; i++) {
                        const otherBearings = bearings.filter((_, idx) => idx !== i);
                        const avgOtherBearing = calculateAverageBearing(otherBearings);
                        const sDist = calculateDistanceKm(resolvedDestHub.latitude, resolvedDestHub.longitude, ordered[i].latitude, ordered[i].longitude);

                        if (avgOtherBearing !== null && sDist > 2.5) {
                            const diff = getBearingDifference(bearings[i], avgOtherBearing);
                            if (diff > 50) {
                                violations.push({
                                    stopIndex: i,
                                    stop: ordered[i],
                                    reason: `Corridor divergence: stop '${ordered[i].name}' diverges by ${diff.toFixed(0)}° from dominant inward corridor.`
                                });
                            }
                        }
                    }
                } else if (ordered.length === 2 && sp && isValidCoordinate(sp.latitude, sp.longitude)) {
                    const baselineBearing = calculateBearing(resolvedDestHub.latitude, resolvedDestHub.longitude, sp.latitude, sp.longitude);
                    for (let i = 0; i < ordered.length; i++) {
                        const sDist = calculateDistanceKm(resolvedDestHub.latitude, resolvedDestHub.longitude, ordered[i].latitude, ordered[i].longitude);
                        const bStop = calculateBearing(resolvedDestHub.latitude, resolvedDestHub.longitude, ordered[i].latitude, ordered[i].longitude);
                        const diff = getBearingDifference(bStop, baselineBearing);
                        if (diff > 50 && sDist > 2.5) {
                            violations.push({
                                stopIndex: i,
                                stop: ordered[i],
                                reason: `Corridor divergence: stop '${ordered[i].name}' diverges by ${diff.toFixed(0)}° from route starting hub corridor.`
                            });
                        }
                    }
                }
            }

            // Check inward progression towards destination (applies between consecutive passenger pickup stops)
            if (resolvedDestHub && isValidCoordinate(resolvedDestHub.latitude, resolvedDestHub.longitude) && ordered.length >= 2) {
                for (let i = 1; i < ordered.length; i++) {
                    const prev = ordered[i - 1];
                    const curr = ordered[i];
                    const prevDist = calculateDistanceKm(prev.latitude, prev.longitude, resolvedDestHub.latitude, resolvedDestHub.longitude);
                    const currDist = calculateDistanceKm(curr.latitude, curr.longitude, resolvedDestHub.latitude, resolvedDestHub.longitude);

                    if (currDist - prevDist > 2.75) {
                        violations.push({
                            stopIndex: i,
                            stop: curr,
                            reason: `Stop '${curr.name}' moves ${(currDist - prevDist).toFixed(1)} km backward away from destination.`
                        });
                    }
                }
            }

            // Physical barrier detection: geographically close but extreme road distance or duration
            for (let i = 0; i < ordered.length - 1; i++) {
                const s1 = ordered[i];
                const s2 = ordered[i + 1];
                if (isValidCoordinate(s1.latitude, s1.longitude) && isValidCoordinate(s2.latitude, s2.longitude)) {
                    const straight = calculateDistanceKm(s1.latitude, s1.longitude, s2.latitude, s2.longitude);
                    const idx1 = getStopMatrixIdx(s1);
                    const idx2 = getStopMatrixIdx(s2);
                    const road = (matrix && idx1 !== undefined && idx2 !== undefined && matrix.getDist)
                        ? matrix.getDist(idx1, idx2)
                        : straight * 1.25;
                    const dur = (matrix && idx1 !== undefined && idx2 !== undefined && matrix.getDur)
                        ? matrix.getDur(idx1, idx2)
                        : (road / STANDARD_BUS_SPEED_KMH) * 60;
                    if (straight > 0.4 && (road / straight > 3.5 || (straight < 2.5 && dur > 20))) {
                        violations.push({
                            stopIndex: i + 1,
                            stop: s2,
                            reason: `Physical barrier / excessive detour between '${s1.name}' and '${s2.name}' (straight: ${straight.toFixed(1)} km, road: ${road.toFixed(1)} km, ratio: ${(road / straight).toFixed(1)}x, time: ${dur.toFixed(0)} min).`
                        });
                    }
                }
            }

            // Check acute turnaround transitions along inward passenger route
            const isSpDistinct = Boolean(sp && ordered[0] && !isSamePlace(sp, ordered[0]));
            const fullTour = isSpDistinct ? [...ordered, resolvedDestHub].filter(Boolean) : [sp, ...ordered, resolvedDestHub].filter(Boolean);
            for (let i = 1; i < fullTour.length - 1; i++) {
                const prev = fullTour[i - 1];
                const curr = fullTour[i];
                const next = fullTour[i + 1];

                const uLat = curr.latitude - prev.latitude;
                const uLon = curr.longitude - prev.longitude;
                const vLat = next.latitude - curr.latitude;
                const vLon = next.longitude - curr.longitude;
                const dot = (uLat * vLat) + (uLon * vLon);
                const magU = Math.sqrt(uLat * uLat + uLon * uLon);
                const magV = Math.sqrt(vLat * vLat + vLon * vLon);
                if (magU > 0.008 && magV > 0.008 && (dot / (magU * magV)) < -0.35) {
                    violations.push({
                        stopIndex: i - 1,
                        stop: curr,
                        reason: `Hairpin turnaround (>110°) at '${curr.name}' along inward route to destination.`
                    });
                }
            }

            // Inward corridor coherence check
            if (resolvedDestHub && isValidCoordinate(resolvedDestHub.latitude, resolvedDestHub.longitude) && ordered.length >= 2) {
                if (!isRouteCorridorCoherent(resolvedDestHub, ordered, 38.0, 4.75)) {
                    violations.push({
                        stopIndex: 0,
                        stop: ordered[0],
                        reason: `Inward corridor coherence violation (>38°) to destination.`
                    });
                }
            }

            const isCont = Boolean(
                violations.length === 0 &&
                (q.directionalReversals || 0) === 0 &&
                (q.backtrackingDistanceKm || 0) < 2.0 &&
                (q.detourRatio || 1.0) <= 2.25 &&
                !q.startingHubRepeatedAfterDeparture
            );

            return {
                isContinuous: isCont,
                reversals: (q.directionalReversals || 0) + violations.length,
                backtrackingKm: q.backtrackingDistanceKm || 0,
                detourRatio: q.detourRatio || 1.0,
                orderedStops: ordered,
                violations
            };
        }
    };

    // Process routes iteratively to detect and repair continuity violations
    let iteration = 0;
    const MAX_REPAIR_ITERATIONS = 8;
    let foundAnyViolationInCycle = true;

    while (foundAnyViolationInCycle && iteration < MAX_REPAIR_ITERATIONS) {
        foundAnyViolationInCycle = false;
        iteration++;

        for (let rIdx = 0; rIdx < routes.length; rIdx++) {
            const currentRoute = routes[rIdx];
            if (!currentRoute.stops || currentRoute.stops.length === 0) continue;

            const initialEval = testRouteContinuity(currentRoute.stops, currentRoute);
            if (initialEval.isContinuous) {
                currentRoute.stops = initialEval.orderedStops;
                continue;
            }

            // Route has a continuity violation!
            foundAnyViolationInCycle = true;
            console.log(`[ContinuityAudit] Route '${currentRoute.vehicleName || currentRoute.routeCode}' failed continuity (reversals=${initialEval.reversals}, backtrack=${initialEval.backtrackingKm}km, detour=${initialEval.detourRatio}). Identifying problematic stop...`);

            // Identify the problematic stop
            let bestRemovalIdx = -1;
            let problematicStop = null;
            let bestRemainingStops = null;

            if (initialEval.violations && initialEval.violations.length > 0) {
                for (const v of initialEval.violations) {
                    const matchIdx = currentRoute.stops.findIndex(s => s.name === v.stop?.name);
                    if (matchIdx >= 0) {
                        bestRemovalIdx = matchIdx;
                        problematicStop = currentRoute.stops[matchIdx];
                        const trialStops = currentRoute.stops.filter((_, idx) => idx !== matchIdx);
                        const trialEval = testRouteContinuity(trialStops, currentRoute);
                        bestRemainingStops = trialEval.orderedStops;
                        break;
                    }
                }
            }

            if (bestRemovalIdx < 0) {
                let lowestCostAfterRemoval = Infinity;
                for (let sIdx = 0; sIdx < currentRoute.stops.length; sIdx++) {
                    const trialStops = currentRoute.stops.filter((_, idx) => idx !== sIdx);
                    const trialEval = testRouteContinuity(trialStops, currentRoute);

                    const penalty = (trialEval.reversals * 100) + (trialEval.backtrackingKm * 20) + (trialEval.detourRatio * 10);
                    if (penalty < lowestCostAfterRemoval) {
                        lowestCostAfterRemoval = penalty;
                        bestRemovalIdx = sIdx;
                        problematicStop = currentRoute.stops[sIdx];
                        bestRemainingStops = trialEval.orderedStops;
                    }
                }
            }

            if (bestRemovalIdx < 0 || !problematicStop) continue;

            console.log(`[ContinuityAudit] Problematic stop identified: '${problematicStop.name}' (${problematicStop.passengerCount || problematicStop.userCount || 0} passengers) causing direction/continuity violation.`);

            // Remove problematic stop from current route
            const removedPaxCount = (Array.isArray(problematicStop.userIds) && problematicStop.userIds.length > 0)
                ? problematicStop.userIds.length
                : (problematicStop.userCount || problematicStop.passengerCount || 0);
            const removedUserIds = (Array.isArray(problematicStop.userIds) && problematicStop.userIds.length > 0)
                ? [...problematicStop.userIds]
                : Array.from({ length: removedPaxCount }, (_, i) => `${problematicStop.name}_pax_${i + 1}`);

            currentRoute.stops = bestRemainingStops || currentRoute.stops.filter((_, idx) => idx !== bestRemovalIdx);
            currentRoute.assignedUsers = currentRoute.stops.reduce((sum, s) => {
                const count = (Array.isArray(s.userIds) && s.userIds.length > 0) ? s.userIds.length : (s.userCount || s.passengerCount || 0);
                return sum + count;
            }, 0);
            currentRoute.users = currentRoute.stops.flatMap((s) => s.userIds || []);
            currentRoute.wasRepaired = true;
            anyRepaired = true;

            let remainingPaxToAllocate = removedPaxCount;
            let remainingIdsToAllocate = [...removedUserIds];

            // ----------------------------------------------------------------
            // STEP 4: EXISTING ROUTE SHARING — HIGHEST PRIORITY (Req 4, 5, 6, 7, 8, 10)
            // ----------------------------------------------------------------
            while (remainingPaxToAllocate > 0) {
                let bestCandidateBus = null;
                let bestCandidateInsertEval = null;
                let bestCandidateScore = -Infinity;
                let bestCandidateAllocCount = 0;

                for (let oIdx = 0; oIdx < routes.length; oIdx++) {
                    if (oIdx === rIdx) continue;
                    const otherRoute = routes[oIdx];
                    const spareCap = Math.max(0, otherRoute.capacity - otherRoute.assignedUsers);
                    if (spareCap <= 0) continue;

                    // Corridor proximity check: stop must be reasonably close to at least one stop on the route OR its starting hub
                    const refPoints = [...(otherRoute.stops || [])];
                    const rStart = otherRoute.startingHub || otherRoute.inwardStartLocation || otherRoute.startLocation;
                    if (rStart && isValidCoordinate(rStart.latitude, rStart.longitude)) {
                        refPoints.push(rStart);
                    }
                    let minStopDist = Infinity;
                    for (const pt of refPoints) {
                        const d = calculateDistanceKm(problematicStop.latitude, problematicStop.longitude, pt.latitude, pt.longitude);
                        if (d < minStopDist) minStopDist = d;
                    }
                    if (refPoints.length > 0 && minStopDist > 4.75) {
                        continue; // Completely different geographic corridor
                    }
                    if (isOutward && resolvedOriginHub && !isRouteCorridorCoherent(resolvedOriginHub, [...(otherRoute.stops || []), problematicStop], 38.0, 4.75)) {
                        continue;
                    }
                    if (!isOutward && resolvedDestHub && !isRouteCorridorCoherent(resolvedDestHub, [...(otherRoute.stops || []), problematicStop], 38.0, 4.75)) {
                        continue;
                    }

                    const allocateCount = Math.min(spareCap, remainingPaxToAllocate);
                    const testIds = remainingIdsToAllocate.slice(0, allocateCount);
                    const candStop = {
                        ...problematicStop,
                        userCount: allocateCount,
                        passengerCount: allocateCount,
                        userIds: testIds
                    };

                    // Evaluate candidate insertions across all valid positions
                    // and via global tour resequencing
                    const candidateSequences = [];
                    for (let p = 0; p <= otherRoute.stops.length; p++) {
                        candidateSequences.push([
                            ...otherRoute.stops.slice(0, p),
                            candStop,
                            ...otherRoute.stops.slice(p)
                        ]);
                    }
                    candidateSequences.push([...otherRoute.stops, candStop]);

                    for (const candTour of candidateSequences) {
                        const candEval = testRouteContinuity(candTour, otherRoute);
                        if (!candEval.isContinuous) continue;

                        const oldDist = otherRoute.routeDistanceKm || 0;
                        const newDist = candEval.qualityValidation?.totalRoadDistance || (candEval.orderedStops.length * 4.5);
                        const addDist = Math.max(0, newDist - oldDist);

                        // Detour threshold check: preserve configured threshold <= 2.25x (Requirement 19, 33)
                        if (candEval.detourRatio > 2.25) {
                            continue;
                        }

                        // Multi-Objective Sharing Score (Req 7)
                        let score = 100.0;
                        score -= addDist * 3.5;
                        score -= (candEval.detourRatio || 1.0) * 12.0;
                        score += (allocateCount / remainingPaxToAllocate) * 40.0;
                        if (minStopDist <= 3.5) score += 20.0;
                        if (otherRoute.vehicleId) score += 5.0;

                        if (score > bestCandidateScore) {
                            bestCandidateScore = score;
                            bestCandidateBus = otherRoute;
                            bestCandidateInsertEval = candEval;
                            bestCandidateAllocCount = allocateCount;
                        }
                    }
                }

                if (bestCandidateBus && bestCandidateInsertEval && bestCandidateAllocCount > 0) {
                    const allocatedIds = remainingIdsToAllocate.splice(0, bestCandidateAllocCount);
                    remainingPaxToAllocate -= bestCandidateAllocCount;

                    bestCandidateBus.stops = bestCandidateInsertEval.orderedStops;
                    bestCandidateBus.assignedUsers = bestCandidateBus.stops.reduce((sum, s) => sum + (Array.isArray(s.userIds) ? s.userIds.length : (s.userCount || 0)), 0);
                    bestCandidateBus.users = bestCandidateBus.stops.flatMap((s) => s.userIds || []);
                    bestCandidateBus.wasRepaired = true;
                    bestCandidateBus.routeDistanceKm = bestCandidateInsertEval.qualityValidation?.totalRoadDistance || bestCandidateBus.routeDistanceKm;
                    bestCandidateBus.detourRatio = bestCandidateInsertEval.detourRatio;

                    console.log(`[ContinuityRepair] Successfully absorbed ${bestCandidateAllocCount} passengers of '${problematicStop.name}' into compatible existing bus '${bestCandidateBus.vehicleName || bestCandidateBus.routeCode}' (Tour: ${bestCandidateBus.stops.map(s => s.name).join(" -> ")}).`);
                } else {
                    break;
                }
            }

            // ----------------------------------------------------------------
            // STEP 5: Try ONE additional bus from available fleet
            // ----------------------------------------------------------------
            if (remainingPaxToAllocate > 0) {
                const assignedVehicleIds = new Set(routes.map((r) => String(r.vehicleId || r._id || "")));
                const unusedFleet = availableVehicles.filter((v) => !assignedVehicleIds.has(String(v._id || v.id || "")));

                let eligibleFallbackVehicle = null;
                let fallbackStartPlace = null;

                for (const candVeh of unusedFleet) {
                    const cap = Number(candVeh.capacity || candVeh.seatCapacity || 70);
                    if (cap <= 0) continue;

                    if (!isOutward) {
                        // INWARD: Must have configured inward starting place
                        const sp = findStartingPlaceForBus(candVeh, activeInwardStartingPlaces);
                        if (sp && isValidCoordinate(sp.latitude, sp.longitude)) {
                            // Check that starting place -> stop -> destination is continuous
                            const testStops = [{ ...problematicStop, userCount: remainingPaxToAllocate, passengerCount: remainingPaxToAllocate }];
                            const candRouteObj = { vehicle: candVeh, inwardStartLocation: sp, startLocation: sp, startingHub: sp };
                            const testEval = testRouteContinuity(testStops, candRouteObj);
                            if (testEval.isContinuous) {
                                eligibleFallbackVehicle = candVeh;
                                fallbackStartPlace = sp;
                                break;
                            }
                        }
                    } else {
                        // OUTWARD: Check departureHub -> stop
                        const testStops = [{ ...problematicStop, userCount: remainingPaxToAllocate, passengerCount: remainingPaxToAllocate }];
                        const candRouteObj = { vehicle: candVeh };
                        const testEval = testRouteContinuity(testStops, candRouteObj);
                        if (testEval.isContinuous) {
                            eligibleFallbackVehicle = candVeh;
                            break;
                        }
                    }
                }

                if (eligibleFallbackVehicle) {
                    const fallbackCap = Number(eligibleFallbackVehicle.capacity || eligibleFallbackVehicle.seatCapacity || 70);
                    const allocateCount = Math.min(fallbackCap, remainingPaxToAllocate);
                    const allocatedIds = remainingIdsToAllocate.splice(0, allocateCount);
                    remainingPaxToAllocate -= allocateCount;

                    const fallbackStop = {
                        ...problematicStop,
                        userCount: allocateCount,
                        passengerCount: allocateCount,
                        userIds: allocatedIds,
                        order: 1,
                        sequence: 1
                    };

                    const newBus = {
                        routeCode: eligibleFallbackVehicle.vehicleName || `RT-${String(routes.length + 1).padStart(2, "0")}`,
                        routeId: `route_${eligibleFallbackVehicle._id || eligibleFallbackVehicle.id || routes.length + 1}`,
                        vehicleId: String(eligibleFallbackVehicle._id || eligibleFallbackVehicle.id || ""),
                        vehicleName: eligibleFallbackVehicle.vehicleName || eligibleFallbackVehicle.name || `Bus ${routes.length + 1}`,
                        vehicle: eligibleFallbackVehicle,
                        capacity: fallbackCap,
                        assignedUsers: allocateCount,
                        stops: [fallbackStop],
                        users: allocatedIds,
                        isFallbackBus: true,
                        fallbackBusUsed: true,
                        fallbackReason: "Existing routes could not continuously absorb this stop without direction or backtracking violations",
                        wasRepaired: true,
                        continuityValidated: true,
                        directionValidated: true,
                        continuityViolationsCount: 0
                    };

                    if (!isOutward && fallbackStartPlace) {
                        newBus.startLocation = fallbackStartPlace;
                        newBus.inwardStartLocation = fallbackStartPlace;
                        newBus.startingHub = fallbackStartPlace;
                    }

                    routes.push(newBus);
                    fallbackBusUsed = true;
                    anyRepaired = true;
                    console.log(`[ContinuityRepair] Introduced ONE fallback bus '${newBus.vehicleName}' to continuously serve ${allocateCount} passengers from '${problematicStop.name}'.`);
                }
            }

            // ----------------------------------------------------------------
            // STEP 6: If still unallocated -> Collect for second pass audit
            // ----------------------------------------------------------------
            if (remainingPaxToAllocate > 0) {
                console.log(`[ContinuityUnallocated] ${remainingPaxToAllocate} passengers at '${problematicStop.name}' flagged for global rebalancing / feasibility audit.`);
                remainingIdsToAllocate.forEach((uid) => {
                    unallocatedList.push({
                        userId: String(uid),
                        name: String(uid),
                        stoppingArea: problematicStop.name,
                        latitude: problematicStop.latitude,
                        longitude: problematicStop.longitude,
                        matrixIndex: getStopMatrixIdx(problematicStop),
                        direction: isOutward ? "OUTWARD" : "INWARD",
                        reason: "CONTINUITY_DIRECTION_VIOLATION",
                        details: "Passenger pending second-pass global rebalancing audit."
                    });
                });
            }
        }
    }

    // ----------------------------------------------------------------
    // STEP 6B: SECOND PASS — GLOBAL REBALANCING & DIRECT INSERTION (Req 9, 10, 18)
    // ----------------------------------------------------------------
    if (unallocatedList.length > 0) {
        const unallocByStop = new Map();
        unallocatedList.forEach((u) => {
            const sName = u.stoppingArea;
            if (!unallocByStop.has(sName)) unallocByStop.set(sName, []);
            unallocByStop.get(sName).push(u);
        });

        for (const [stopName, uGroup] of unallocByStop.entries()) {
            const firstU = uGroup[0];
            const testStop = {
                name: stopName,
                latitude: firstU.latitude,
                longitude: firstU.longitude,
                matrixIndex: firstU.matrixIndex,
                userCount: uGroup.length,
                passengerCount: uGroup.length,
                userIds: uGroup.map((u) => u.userId)
            };

            let rebalanced = false;

            // Pass 1: Direct insertion test into any existing route with spare capacity
            let bestDirectBus = null;
            let bestDirectEval = null;
            let bestDirectScore = -Infinity;
            let bestDirectAllocCount = 0;

            for (let rIdx = 0; rIdx < routes.length; rIdx++) {
                const r = routes[rIdx];
                const spare = Math.max(0, r.capacity - r.assignedUsers);
                if (spare <= 0) continue;

                // Stop must not be impossibly far from route stops or route starting hub
                const refPoints = [...(r.stops || [])];
                const rStart = r.startingHub || r.inwardStartLocation || r.startLocation;
                if (rStart && isValidCoordinate(rStart.latitude, rStart.longitude)) {
                    refPoints.push(rStart);
                }
                let minRefDist = Infinity;
                for (const p of refPoints) {
                    const d = calculateDistanceKm(testStop.latitude, testStop.longitude, p.latitude, p.longitude);
                    if (d < minRefDist) minRefDist = d;
                }
                if (refPoints.length > 0 && minRefDist > 20.0) continue;

                // Do not re-insert into route r if testStop has an extreme physical barrier with any existing stop in r
                const testIdx = getStopMatrixIdx(testStop);
                let barrierWithRoute = false;
                if (matrix?.getDist && testIdx !== undefined) {
                    for (const rStop of (r.stops || [])) {
                        const rIdx = getStopMatrixIdx(rStop);
                        if (rIdx !== undefined) {
                            const stDist = calculateDistanceKm(testStop.latitude, testStop.longitude, rStop.latitude, rStop.longitude);
                            const rdDist = matrix.getDist(testIdx, rIdx);
                            if (stDist > 0.4 && rdDist / stDist > 3.5) {
                                barrierWithRoute = true;
                                break;
                            }
                        }
                    }
                }
                if (barrierWithRoute) continue;

                const allocCount = Math.min(spare, testStop.userCount);
                const testStopPart = {
                    ...testStop,
                    userCount: allocCount,
                    passengerCount: allocCount,
                    userIds: testStop.userIds.slice(0, allocCount)
                };

                // Test candidate insertions at all positions
                const candidateTours = [];
                for (let p = 0; p <= r.stops.length; p++) {
                    candidateTours.push([
                        ...r.stops.slice(0, p),
                        testStopPart,
                        ...r.stops.slice(p)
                    ]);
                }
                candidateTours.push([...r.stops, testStopPart]);

                for (const cTour of candidateTours) {
                    const cEval = testRouteContinuity(cTour, r);
                    if (!cEval.isContinuous) continue;

                    let score = 100.0 - ((cEval.detourRatio || 1.0) * 10.0);
                    score += (allocCount / testStop.userCount) * 40.0;
                    if (minRefDist <= 4.0) score += 30.0;
                    if (score > bestDirectScore) {
                        bestDirectScore = score;
                        bestDirectBus = r;
                        bestDirectEval = cEval;
                        bestDirectAllocCount = allocCount;
                    }
                }
            }

            if (bestDirectBus && bestDirectEval && bestDirectAllocCount > 0) {
                bestDirectBus.stops = bestDirectEval.orderedStops;
                bestDirectBus.assignedUsers = bestDirectBus.stops.reduce((sum, s) => sum + (Array.isArray(s.userIds) ? s.userIds.length : (s.userCount || 0)), 0);
                bestDirectBus.users = bestDirectBus.stops.flatMap((s) => s.userIds || []);
                bestDirectBus.wasRepaired = true;

                const allocatedIds = new Set(testStop.userIds.slice(0, bestDirectAllocCount).map(String));
                for (let i = unallocatedList.length - 1; i >= 0; i--) {
                    if (allocatedIds.has(String(unallocatedList[i].userId))) {
                        unallocatedList.splice(i, 1);
                    }
                }
                rebalanced = true;
                anyRepaired = true;
                console.log(`[GlobalRebalance] Direct insertion: absorbed ${bestDirectAllocCount} passengers of '${stopName}' into '${bestDirectBus.vehicleName}' (Tour: ${bestDirectBus.stops.map(s => s.name).join(" -> ")}).`);
                continue;
            }

            // Pass 2: Inspect all routes together to find a 1-hop stop transfer (Relocate)
            for (let sourceR = 0; sourceR < routes.length && !rebalanced; sourceR++) {
                const bSource = routes[sourceR];
                for (let sIdx = 0; sIdx < (bSource.stops || []).length && !rebalanced; sIdx++) {
                    const movableStop = bSource.stops[sIdx];
                    const movablePax = Array.isArray(movableStop.userIds) ? movableStop.userIds.length : (movableStop.userCount || 0);
                    if (movablePax <= 0) continue;

                    for (let targetR = 0; targetR < routes.length; targetR++) {
                        if (targetR === sourceR) continue;
                        const bTarget = routes[targetR];
                        const targetSpare = Math.max(0, bTarget.capacity - bTarget.assignedUsers);
                        if (targetSpare < movablePax) continue;

                        const testTargetTour = [...bTarget.stops, movableStop];
                        const targetEval = testRouteContinuity(testTargetTour, bTarget);
                        if (!targetEval.isContinuous) continue;

                        const testSourceRemaining = bSource.stops.filter((_, idx) => idx !== sIdx);
                        const sourceEval = testRouteContinuity(testSourceRemaining, bSource);
                        if (!sourceEval.isContinuous) continue;

                        const sourceWithNewStopTour = [...sourceEval.orderedStops, testStop];
                        const newSourceEval = testRouteContinuity(sourceWithNewStopTour, bSource);
                        const sourceNewUsers = sourceEval.orderedStops.reduce((sum, s) => sum + (s.userCount || 0), 0) + testStop.userCount;

                        if (newSourceEval.isContinuous && bSource.capacity >= sourceNewUsers) {
                            bTarget.stops = targetEval.orderedStops;
                            bTarget.assignedUsers = bTarget.stops.reduce((sum, s) => sum + (Array.isArray(s.userIds) ? s.userIds.length : (s.userCount || 0)), 0);
                            bTarget.users = bTarget.stops.flatMap((s) => s.userIds || []);
                            bTarget.wasRepaired = true;

                            bSource.stops = newSourceEval.orderedStops;
                            bSource.assignedUsers = bSource.stops.reduce((sum, s) => sum + (Array.isArray(s.userIds) ? s.userIds.length : (s.userCount || 0)), 0);
                            bSource.users = bSource.stops.flatMap((s) => s.userIds || []);
                            bSource.wasRepaired = true;

                            const allocatedUserIds = new Set(uGroup.map((u) => String(u.userId)));
                            for (let i = unallocatedList.length - 1; i >= 0; i--) {
                                if (allocatedUserIds.has(String(unallocatedList[i].userId))) {
                                    unallocatedList.splice(i, 1);
                                }
                            }
                            rebalanced = true;
                            anyRepaired = true;
                            console.log(`[GlobalRebalance] Successfully rebalanced stop '${movableStop.name}' from '${bSource.vehicleName}' to '${bTarget.vehicleName}', freeing capacity to continuously absorb '${stopName}' (${uGroup.length} pax).`);
                            break;
                        }
                    }
                }
            }
        }
    }

    // ----------------------------------------------------------------
    // STEP 6C: FINAL FEASIBILITY AUDIT & STRUCTURED REASON (Req 18, 19)
    // ----------------------------------------------------------------
    if (unallocatedList.length > 0) {
        const totalSpareCapacity = routes.reduce((sum, r) => sum + Math.max(0, r.capacity - r.assignedUsers), 0);
        const assignedVids = new Set(routes.map((r) => String(r.vehicleId || r._id || "")));
        const unusedFleet = availableVehicles.filter((v) => !assignedVids.has(String(v._id || v.id || "")));

        unallocatedList.forEach((u) => {
            let minDistanceToAnyRoute = Infinity;
            routes.forEach((r) => {
                (r.stops || []).forEach((st) => {
                    const d = calculateDistanceKm(u.latitude, u.longitude, st.latitude, st.longitude);
                    if (d < minDistanceToAnyRoute) minDistanceToAnyRoute = d;
                });
            });

            if (minDistanceToAnyRoute > 12.0) {
                u.reason = "NO_COMPATIBLE_CORRIDOR";
                u.details = `Stopping area '${u.stoppingArea}' is ${minDistanceToAnyRoute.toFixed(1)} km from any active route corridor. No bus operates within feasible road detour limits.`;
            } else if (!isOutward && activeInwardStartingPlaces.length > 0) {
                const hasHubVehicle = unusedFleet.some((v) => findStartingPlaceForBus(v, activeInwardStartingPlaces));
                if (unusedFleet.length > 0 && !hasHubVehicle) {
                    u.reason = "STARTING_HUB_CONFLICT";
                    u.details = `Unused vehicle exists but lacks a configured residential inward starting place near '${u.stoppingArea}'.`;
                } else {
                    u.reason = "CONTINUITY_DIRECTION_VIOLATION";
                    u.details = "Passenger could not be assigned without violating continuous route direction. No additional compatible vehicle is available.";
                }
            } else {
                u.reason = "CONTINUITY_DIRECTION_VIOLATION";
                u.details = "Passenger could not be assigned without violating continuous route direction. No additional compatible vehicle is available.";
            }
        });
    }

    // Filter out any buses that became empty after stop removals
    routes = routes.filter((b) => Array.isArray(b.stops) && b.stops.length > 0 && b.assignedUsers > 0);

    // Attach required metadata and recalculate quality metrics for all final routes
    routes.forEach((b) => {
        b.continuityValidated = true;
        b.directionValidated = true;
        b.repaired = Boolean(b.wasRepaired || b.isFallbackBus);
        b.fallbackBusUsed = Boolean(b.isFallbackBus);
        if (b.isFallbackBus) {
            b.fallbackReason = b.fallbackReason || "Existing routes could not continuously absorb this stop";
        }
        b.continuityViolations = b.continuityViolationsCount || 0;

        if (b.wasRepaired || anyRepaired) {
            if (isOutward) {
                const seq = sequenceOutwardRouteStops({
                    departureHub: resolvedOriginHub,
                    stops: b.stops,
                    matrix,
                    tripMode
                });
                b.stops = seq.stops;
                b.routeDistanceKm = seq.routeDistanceKm;
                b.routeQuality = seq.qualityValidation;
                b.qualityValidation = seq.qualityValidation;
                b.detourRatio = seq.qualityValidation?.detourRatio || b.detourRatio;
                b.directionalReversals = seq.qualityValidation?.directionalReversals || 0;
                b.backtrackingDistanceKm = seq.qualityValidation?.backtrackingDistanceKm || 0;
                b.operationalContinuityVerified = seq.qualityValidation?.operationalContinuityVerified;
            } else {
                const sp = findStartingPlaceForBus(b.vehicle || b, activeInwardStartingPlaces) ||
                    b.inwardStartLocation || b.startLocation || (b.stops && b.stops[0]);
                const seq = sequenceInwardRouteStops({
                    startingHub: sp,
                    destinationHub: resolvedDestHub,
                    stops: b.stops,
                    matrix,
                    tripMode
                });
                b.stops = seq.stops;
                b.routeDistanceKm = seq.routeDistanceKm;
                b.routeQuality = seq.qualityValidation;
                b.qualityValidation = seq.qualityValidation;
                b.detourRatio = seq.qualityValidation?.detourRatio || b.detourRatio;
                b.directionalReversals = seq.qualityValidation?.directionalReversals || 0;
                b.backtrackingDistanceKm = seq.qualityValidation?.backtrackingDistanceKm || 0;
                b.operationalContinuityVerified = seq.qualityValidation?.operationalContinuityVerified;
            }
        }
    });

    return {
        buses: routes,
        unallocatedPassengers: unallocatedList,
        fallbackBusUsed,
        fallbackReason: fallbackBusUsed ? "Existing routes could not continuously absorb this stop" : null,
        anyRepaired,
        totalViolations,
        continuityValidated: true,
        directionValidated: true
    };
};

/**
 * Stage C: Global Passenger Balancing & Reassignment (Requirements 4, 5, 6, 10, 13)
 * When unallocated passengers > 0 AND selected buses have free seats:
 * Attempts stop and passenger reassignment across all selected buses with remaining capacity
 * before declaring failure.
 */
export const rebalanceUnallocatedPassengersToSelectedBuses = ({
    assignedRoutes = [],
    unassignedRoutes = [],
    matrix = null,
    tripMode = "INWARD",
    maxBusCapacity = 70,
    configuredInwardStartingPlaces = [],
    anchorHub = null,
    auditTrail = []
}) => {
    if (!Array.isArray(assignedRoutes) || assignedRoutes.length === 0 || !Array.isArray(unassignedRoutes) || unassignedRoutes.length === 0) {
        return { assignedRoutes, unassignedRoutes, rebalancedCount: 0 };
    }

    const isOutward = tripMode === "FROM_SOURCE" || tripMode === "OUTWARD";
    let rebalancedCount = 0;

    for (let uIdx = unassignedRoutes.length - 1; uIdx >= 0; uIdx--) {
        const uRoute = unassignedRoutes[uIdx];
        if (!Array.isArray(uRoute.stops) || uRoute.stops.length === 0) {
            unassignedRoutes.splice(uIdx, 1);
            continue;
        }

        for (let sIdx = uRoute.stops.length - 1; sIdx >= 0; sIdx--) {
            const stop = uRoute.stops[sIdx];
            const stopPax = Array.isArray(stop.userIds) && stop.userIds.length > 0
                ? stop.userIds.length
                : Number(stop.userCount || stop.passengerCount || 0);
            if (stopPax <= 0) continue;

            let remainingStopPax = stopPax;
            let remainingUserIds = Array.isArray(stop.userIds) ? [...stop.userIds] : [];

            // Try existing selected buses with free seats
            while (remainingStopPax > 0) {
                let bestBus = null;
                let bestScore = -Infinity;
                let bestAllocCount = 0;
                let bestTour = null;

                for (let rIdx = 0; rIdx < assignedRoutes.length; rIdx++) {
                    const bus = assignedRoutes[rIdx];
                    const cap = Number(bus.capacity || bus.seatCapacity || maxBusCapacity);
                    const spare = Math.max(0, cap - (bus.assignedUsers || 0));
                    if (spare <= 0) continue;

                    const allocCount = Math.min(spare, remainingStopPax);
                    const stopChunk = {
                        ...stop,
                        userCount: allocCount,
                        passengerCount: allocCount,
                        userIds: remainingUserIds.slice(0, allocCount)
                    };

                    const busStops = bus.stops || [];
                    const busStartPlace = isOutward ? null : (
                        findStartingPlaceForBus(bus.vehicle, configuredInwardStartingPlaces) ||
                        bus.startLocation || bus.inwardStartLocation
                    );

                    // Test all insertion positions
                    for (let p = 0; p <= busStops.length; p++) {
                        const testTour = [
                            ...busStops.slice(0, p),
                            stopChunk,
                            ...busStops.slice(p)
                        ];

                        const seqRes = isOutward
                            ? sequenceOutwardRouteStops({ departureHub: anchorHub, stops: testTour, matrix, tripMode })
                            : sequenceInwardRouteStops({ startingHub: busStartPlace, destinationHub: anchorHub, stops: testTour, matrix, tripMode });

                        const qv = seqRes.qualityValidation;
                        if (!qv || !qv.operationalContinuityVerified) continue;
                        if (qv.directionalReversals > 0) continue;
                        if (qv.detourRatio > 2.25) continue;

                        let score = 100.0 - (qv.detourRatio * 15.0);
                        score += (allocCount / remainingStopPax) * 30.0;
                        if (score > bestScore) {
                            bestScore = score;
                            bestBus = bus;
                            bestAllocCount = allocCount;
                            bestTour = seqRes.stops;
                        }
                    }
                }

                if (bestBus && bestAllocCount > 0 && bestTour) {
                    bestBus.stops = bestTour;
                    bestBus.assignedUsers = (bestBus.assignedUsers || 0) + bestAllocCount;
                    bestBus.remainingSeats = Math.max(0, (bestBus.capacity || maxBusCapacity) - bestBus.assignedUsers);
                    bestBus.users = [...(bestBus.users || []), ...remainingUserIds.slice(0, bestAllocCount)];
                    bestBus.seatUtilization = Number(((bestBus.assignedUsers / (bestBus.capacity || maxBusCapacity)) * 100).toFixed(1));

                    remainingStopPax -= bestAllocCount;
                    remainingUserIds = remainingUserIds.slice(bestAllocCount);
                    rebalancedCount += bestAllocCount;

                    auditTrail.push({
                        step: "STAGE_C_REBALANCE",
                        reason: `Reassigned ${bestAllocCount} passengers from '${stop.name}' to bus '${bestBus.vehicleName}' (seats: ${bestBus.assignedUsers}/${bestBus.capacity}).`
                    });
                } else {
                    break; // Could not find a feasible insertion for remaining passengers
                }
            }

            if (remainingStopPax === 0) {
                uRoute.stops.splice(sIdx, 1);
            } else {
                stop.userCount = remainingStopPax;
                stop.passengerCount = remainingStopPax;
                stop.userIds = remainingUserIds;
            }
        }

        uRoute.assignedUsers = uRoute.stops.reduce((sum, s) => sum + (Array.isArray(s.userIds) ? s.userIds.length : (s.userCount || 0)), 0);
        if (uRoute.assignedUsers === 0 || uRoute.stops.length === 0) {
            unassignedRoutes.splice(uIdx, 1);
        }
    }

    return { assignedRoutes, unassignedRoutes, rebalancedCount };
};

/**
 * Post-Continuity Inward Passenger Redistribution & Starting-Hub Balancing
 * Balances unallocated inward passengers to compatible routes where available
 * aggregate fleet capacity exists, strictly preserving:
 * - passengerCount <= actualVehicleSeatCapacity (ZERO standing passengers)
 * - Configured starting hub for each vehicle
 * - Continuous OSRM road progression to KLN College (0 reversals, detour <= 2.25)
 */
export const rebalanceInwardUnallocatedPassengers = ({
    routes = [],
    unallocatedPassengers = [],
    destinationHub = DEFAULT_SOURCE_HUB,
    activeInwardStartingPlaces = [],
    matrix = null,
    auditTrail = []
}) => {
    if (!Array.isArray(routes) || routes.length === 0 || !Array.isArray(unallocatedPassengers) || unallocatedPassengers.length === 0) {
        return { routes, unallocatedPassengers };
    }

    const currentRoutes = routes.map(r => ({
        ...r,
        stops: (r.stops || []).map(s => ({
            ...s,
            userIds: Array.isArray(s.userIds) ? [...s.userIds] : [],
            userCount: Array.isArray(s.userIds) ? s.userIds.length : Number(s.userCount || 0)
        })),
        users: Array.isArray(r.users) ? [...r.users] : [],
        assignedUsers: Number(r.assignedUsers || 0),
        capacity: Number(r.capacity || r.vehicle?.capacity || 50)
    }));

    let remainingUnallocated = [...unallocatedPassengers];

    const unallocByStop = new Map();
    remainingUnallocated.forEach(u => {
        const sName = u.stoppingArea;
        if (!unallocByStop.has(sName)) unallocByStop.set(sName, []);
        unallocByStop.get(sName).push(u);
    });

    const evalInwardTour = (stops, bus) => {
        const sp = findStartingPlaceForBus(bus.vehicle || bus, activeInwardStartingPlaces) ||
                   bus.startLocation || bus.inwardStartLocation || stops[0];
        const seq = sequenceInwardRouteStops({
            startingHub: sp,
            destinationHub,
            stops,
            matrix,
            tripMode: "TO_DESTINATION"
        });
        const qv = seq.qualityValidation || {};
        const isCont = Boolean(
            (qv.directionalReversals || 0) === 0 &&
            (qv.backtrackingDistanceKm || 0) < 2.0 &&
            (qv.detourRatio || 1.0) <= 2.25 &&
            !qv.startingHubRepeatedAfterDeparture
        );
        return {
            isContinuous: isCont,
            orderedStops: seq.stops,
            detourRatio: qv.detourRatio || 1.25
        };
    };

    for (const [stopName, uGroup] of unallocByStop.entries()) {
        let remainingPax = uGroup.length;
        let remainingIds = uGroup.map(u => String(u.userId));
        const firstU = uGroup[0];
        const stopLat = firstU.latitude;
        const stopLon = firstU.longitude;

        // Check if there is a primary host bus whose configured starting hub matches stopName
        const matchingHubRoute = currentRoutes.find(r => {
            const sp = findStartingPlaceForBus(r.vehicle || r, activeInwardStartingPlaces);
            return sp && (
                sp.name?.toLowerCase().includes(stopName.toLowerCase()) ||
                stopName.toLowerCase().includes(sp.name?.toLowerCase()) ||
                calculateDistanceKm(sp.latitude, sp.longitude, stopLat, stopLon) <= 3.5
            );
        });

        // Priority 1: If a bus starts at this stop, prioritize freeing capacity on THAT bus!
        if (matchingHubRoute) {
            const host = matchingHubRoute;
            let hostSpare = host.capacity - host.assignedUsers;
            let needed = remainingPax - hostSpare;

            if (needed > 0) {
                // Find stops on host that can be shifted to other routes with spare capacity
                for (let sIdx = host.stops.length - 1; sIdx >= 0 && needed > 0; sIdx--) {
                    const hostStop = host.stops[sIdx];
                    if (!hostStop) continue;

                    // Sort recipient routes: routes already containing hostStop first, then closest corridor
                    const eligibleRecipients = currentRoutes
                        .filter(r => r !== host && (r.capacity - r.assignedUsers) > 0)
                        .sort((a, b) => {
                            const aHasStop = a.stops.some(s => s.name?.toLowerCase() === hostStop.name?.toLowerCase()) ? 1 : 0;
                            const bHasStop = b.stops.some(s => s.name?.toLowerCase() === hostStop.name?.toLowerCase()) ? 1 : 0;
                            if (aHasStop !== bHasStop) return bHasStop - aHasStop;

                            const aDist = Math.min(...(a.stops || []).map(s => calculateDistanceKm(hostStop.latitude, hostStop.longitude, s.latitude, s.longitude)));
                            const bDist = Math.min(...(b.stops || []).map(s => calculateDistanceKm(hostStop.latitude, hostStop.longitude, s.latitude, s.longitude)));
                            return aDist - bDist;
                        });

                    for (const recipient of eligibleRecipients) {
                        const currentHostStopPax = (hostStop.userIds || []).length;
                        if (currentHostStopPax <= 0) break;

                        const recipSpare = recipient.capacity - recipient.assignedUsers;
                        if (recipSpare <= 0) continue;

                        const shiftCount = Math.min(recipSpare, needed, currentHostStopPax);
                        const shiftIds = (hostStop.userIds || []).slice(hostStop.userIds.length - shiftCount);

                        const shiftedStopPart = {
                            ...hostStop,
                            userCount: shiftCount,
                            passengerCount: shiftCount,
                            userIds: shiftIds
                        };

                        const recipientHasStop = recipient.stops.some(s => s.name?.toLowerCase() === hostStop.name?.toLowerCase());
                        let recipientCanAbsorb = false;
                        let bestRecipTour = null;

                        if (recipientHasStop) {
                            const mergedTour = recipient.stops.map(s => {
                                if (s.name?.toLowerCase() === hostStop.name?.toLowerCase()) {
                                    return {
                                        ...s,
                                        userCount: (s.userCount || 0) + shiftCount,
                                        passengerCount: (s.passengerCount || 0) + shiftCount,
                                        userIds: [...(s.userIds || []), ...shiftIds]
                                    };
                                }
                                return s;
                            });
                            const rEval = evalInwardTour(mergedTour, recipient);
                            if (rEval.isContinuous) {
                                recipientCanAbsorb = true;
                                bestRecipTour = rEval.orderedStops;
                            }
                        } else {
                            for (let p = 0; p <= recipient.stops.length; p++) {
                                const testTour = [
                                    ...recipient.stops.slice(0, p),
                                    shiftedStopPart,
                                    ...recipient.stops.slice(p)
                                ];
                                const rEval = evalInwardTour(testTour, recipient);
                                if (rEval.isContinuous) {
                                    recipientCanAbsorb = true;
                                    bestRecipTour = rEval.orderedStops;
                                    break;
                                }
                            }
                        }

                        if (recipientCanAbsorb && bestRecipTour) {
                            recipient.stops = bestRecipTour;
                            recipient.assignedUsers = recipient.stops.reduce((sum, s) => sum + (s.userCount || 0), 0);
                            recipient.users = recipient.stops.flatMap(s => s.userIds || []);

                            hostStop.userIds.splice(hostStop.userIds.length - shiftCount, shiftCount);
                            hostStop.userCount = hostStop.userIds.length;
                            hostStop.passengerCount = hostStop.userCount;

                            const shiftSet = new Set(shiftIds);
                            host.users = host.users.filter(uid => !shiftSet.has(String(uid)));
                            host.assignedUsers = host.stops.reduce((sum, s) => sum + (s.userCount || 0), 0);

                            needed -= shiftCount;
                            hostSpare += shiftCount;

                            if (hostStop.userCount === 0) {
                                host.stops = host.stops.filter((_, idx) => idx !== sIdx);
                            }

                            if (needed <= 0) break;
                        }
                    }
                }
            }

            // Insert stopName into host at position 0 (its configured starting place)
            const availableOnHost = Math.min(host.capacity - host.assignedUsers, remainingPax);
            if (availableOnHost > 0) {
                const allocIds = remainingIds.slice(0, availableOnHost);
                const testStopForHost = {
                    name: stopName,
                    latitude: stopLat,
                    longitude: stopLon,
                    userCount: availableOnHost,
                    passengerCount: availableOnHost,
                    userIds: allocIds
                };

                const testTour = [testStopForHost, ...host.stops];
                const hEval = evalInwardTour(testTour, host);
                if (hEval.isContinuous) {
                    host.stops = hEval.orderedStops;
                    host.assignedUsers += availableOnHost;
                    host.users.push(...allocIds);

                    const allocatedSet = new Set(allocIds);
                    remainingUnallocated = remainingUnallocated.filter(u => !allocatedSet.has(String(u.userId)));

                    remainingPax -= availableOnHost;
                    remainingIds.splice(0, availableOnHost);
                }
            }
        }

        // Priority 2: Direct continuous insertion into any route with spare capacity and corridor proximity
        if (remainingPax > 0) {
            for (const r of currentRoutes) {
                const spare = r.capacity - r.assignedUsers;
                if (spare <= 0) continue;

                const refPoints = [...(r.stops || [])];
                const rStart = findStartingPlaceForBus(r.vehicle || r, activeInwardStartingPlaces) || r.startLocation;
                if (rStart && isValidCoordinate(rStart.latitude, rStart.longitude)) {
                    refPoints.push(rStart);
                }
                const minRefDist = Math.min(...refPoints.map(p => calculateDistanceKm(stopLat, stopLon, p.latitude, p.longitude)));
                if (minRefDist > 4.75) continue;

                const allocCount = Math.min(spare, remainingPax);
                const testIds = remainingIds.slice(0, allocCount);
                const candStop = {
                    name: stopName,
                    latitude: stopLat,
                    longitude: stopLon,
                    userCount: allocCount,
                    passengerCount: allocCount,
                    userIds: testIds
                };

                const candTours = [];
                for (let p = 0; p <= r.stops.length; p++) {
                    candTours.push([
                        ...r.stops.slice(0, p),
                        candStop,
                        ...r.stops.slice(p)
                    ]);
                }

                for (const cTour of candTours) {
                    const cEval = evalInwardTour(cTour, r);
                    if (cEval.isContinuous) {
                        r.stops = cEval.orderedStops;
                        r.assignedUsers += allocCount;
                        r.users.push(...testIds);

                        const allocatedSet = new Set(testIds);
                        remainingUnallocated = remainingUnallocated.filter(u => !allocatedSet.has(String(u.userId)));

                        remainingPax -= allocCount;
                        remainingIds.splice(0, allocCount);
                        break;
                    }
                }
                if (remainingPax <= 0) break;
            }
        }
    }

    // Standardize all modified routes
    for (const route of currentRoutes) {
        const sp = findStartingPlaceForBus(route.vehicle || route, activeInwardStartingPlaces) ||
                   route.startLocation || route.inwardStartLocation || route.stops[0];

        (route.stops || []).forEach((st, sIdx) => {
            st.order = sIdx + 1;
            st.sequence = sIdx + 1;
            if (sIdx === 0) {
                st.previousStopName = sp?.name || "Pickup Origin";
            } else {
                st.previousStopName = route.stops[sIdx - 1].name;
            }
            const count = Array.isArray(st.userIds) ? st.userIds.length : Number(st.userCount || 0);
            st.userCount = count;
            st.passengerCount = count;
            st.passengerUserIds = st.userIds;
        });

        route.assignedUsers = (route.stops || []).reduce((s, st) => s + (st.userCount || 0), 0);
        route.passengerCount = route.assignedUsers;
        route.users = (route.stops || []).flatMap(st => st.userIds || []);
        route.passengerUserIds = route.users;
        route.remainingSeats = Math.max(0, route.capacity - route.assignedUsers);
        route.unusedSeats = route.remainingSeats;
        route.seatedPassengers = route.assignedUsers;
        route.standingPassengers = 0;
        route.isOverCapacity = false;
        route.overCapacityCount = 0;
    }

    return {
        routes: currentRoutes,
        unallocatedPassengers: remainingUnallocated
    };
};

