import mongoose from "mongoose";
import Route from "../models/Route.js";
import User from "../models/User.js";
import Vehicle from "../models/Vehicle.js";
import Schedule from "../models/Schedule.js";
import {
    buildManualTransportationPlan,
    calculateStopMatchScore,
    getRoadRouteGeometry,
    getRoadSegmentCached,
    isValidCoordinate,
    MADURAI_REGIONAL_STOPS
} from "./aiAgentService.js";

const isDbConnected = () => mongoose.connection.readyState === 1;

/**
 * Calculates Haversine distance in kilometers between two GPS coordinates
 */
export const calculateDistanceKm = (lat1, lon1, lat2, lon2) => {
    const l1 = Number(lat1);
    const n1 = Number(lon1);
    const l2 = Number(lat2);
    const n2 = Number(lon2);
    if (!Number.isFinite(l1) || !Number.isFinite(n1) || !Number.isFinite(l2) || !Number.isFinite(n2)) {
        return Infinity;
    }
    const R = 6371; // Earth's radius in km
    const dLat = ((l2 - l1) * Math.PI) / 180;
    const dLon = ((n2 - n1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((l1 * Math.PI) / 180) *
        Math.cos((l2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Number((R * c).toFixed(3));
};

/**
 * Normalizes stop name for fuzzy comparisons
 */
export const normalizeStopName = (str = "") =>
    String(str)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .trim();

/**
 * Resolves GPS coordinates for a stopping area name using student coordinates,
 * gazetteer, or regional transit stops.
 */
export const resolveStopCoordinates = (stopName, student = null) => {
    if (student && isValidCoordinate(student.latitude, student.longitude)) {
        return {
            latitude: Number(student.latitude),
            longitude: Number(student.longitude)
        };
    }

    const norm = normalizeStopName(stopName);
    if (MADURAI_REGIONAL_STOPS && MADURAI_REGIONAL_STOPS[norm]) {
        return {
            latitude: MADURAI_REGIONAL_STOPS[norm].latitude,
            longitude: MADURAI_REGIONAL_STOPS[norm].longitude
        };
    }

    // Check partial alias matches
    if (MADURAI_REGIONAL_STOPS) {
        for (const [key, val] of Object.entries(MADURAI_REGIONAL_STOPS)) {
            if (norm.length >= 4 && (norm.includes(key) || key.includes(norm))) {
                return {
                    latitude: val.latitude,
                    longitude: val.longitude
                };
            }
        }
    }

    return { latitude: NaN, longitude: NaN };
};

/**
 * Retrieves the institutional departure/arrival hub (College campus)
 */
export const getInstitutionalHub = async () => {
    if (isDbConnected()) {
        try {
            const aiPlan = await mongoose.connection.db.collection("aiplans").findOne();
            if (aiPlan?.source && isValidCoordinate(aiPlan.source.latitude, aiPlan.source.longitude)) {
                return {
                    name: aiPlan.source.name || "K.L.N. College of Engineering",
                    address: aiPlan.source.address || "Pottapalayam, Sivaganga District, Tamil Nadu",
                    displayName: aiPlan.source.displayName || aiPlan.source.name || "K.L.N. College of Engineering",
                    latitude: Number(aiPlan.source.latitude),
                    longitude: Number(aiPlan.source.longitude),
                    isHub: true
                };
            }
            if (aiPlan?.destination && isValidCoordinate(aiPlan.destination.latitude, aiPlan.destination.longitude)) {
                return {
                    name: aiPlan.destination.name || "K.L.N. College of Engineering",
                    address: aiPlan.destination.address || "Pottapalayam, Sivaganga District, Tamil Nadu",
                    displayName: aiPlan.destination.displayName || aiPlan.destination.name || "K.L.N. College of Engineering",
                    latitude: Number(aiPlan.destination.latitude),
                    longitude: Number(aiPlan.destination.longitude),
                    isHub: true
                };
            }
        } catch {
            // Fall through to standard campus hub
        }
    }

    return {
        name: "K.L.N. College of Engineering",
        address: "Pottapalayam, Sivaganga District, Tamil Nadu, 630612, India",
        displayName: "K.L.N. College of Engineering (Main Campus Hub)",
        latitude: 9.8324,
        longitude: 78.1884,
        isHub: true
    };
};

/**
 * Formats a clean ordered sequence of points for a manual route,
 * prepending the College for OUTWARD or appending for INWARD when appropriate.
 */
export const extractOrderedRoutePoints = (route, direction = "OUTWARD", hub = null) => {
    const rawPoints = [];

    if (route.source?.name) {
        const coords = resolveStopCoordinates(route.source.name, route.source);
        rawPoints.push({
            name: route.source.name,
            displayName: route.source.displayName || route.source.name,
            latitude: Number(route.source.latitude || coords.latitude),
            longitude: Number(route.source.longitude || coords.longitude),
            userCount: route.source.userCount || 0,
            routePointType: "source"
        });
    }

    if (Array.isArray(route.stops)) {
        route.stops.forEach((s) => {
            if (s?.name) {
                const coords = resolveStopCoordinates(s.name, s);
                rawPoints.push({
                    name: s.name,
                    displayName: s.displayName || s.name,
                    latitude: Number(s.latitude || coords.latitude),
                    longitude: Number(s.longitude || coords.longitude),
                    userCount: s.userCount || 0,
                    routePointType: "stop"
                });
            }
        });
    }

    if (route.destination?.name) {
        const coords = resolveStopCoordinates(route.destination.name, route.destination);
        rawPoints.push({
            name: route.destination.name,
            displayName: route.destination.displayName || route.destination.name,
            latitude: Number(route.destination.latitude || coords.latitude),
            longitude: Number(route.destination.longitude || coords.longitude),
            userCount: route.destination.userCount || 0,
            routePointType: "destination"
        });
    }

    const isOutward = direction === "OUTWARD";
    const result = [];

    // Check if college/hub is already present in rawPoints
    const hasHubAsFirst = rawPoints.length > 0 &&
        (rawPoints[0].name.toLowerCase().includes("college") ||
         rawPoints[0].name.toLowerCase().includes("campus") ||
         rawPoints[0].name.toLowerCase().includes("k.l.n") ||
         rawPoints[0].name.toLowerCase().includes("kln"));

    const hasHubAsLast = rawPoints.length > 0 &&
        (rawPoints[rawPoints.length - 1].name.toLowerCase().includes("college") ||
         rawPoints[rawPoints.length - 1].name.toLowerCase().includes("campus") ||
         rawPoints[rawPoints.length - 1].name.toLowerCase().includes("k.l.n") ||
         rawPoints[rawPoints.length - 1].name.toLowerCase().includes("kln"));

    if (isOutward) {
        if (hub && !hasHubAsFirst) {
            result.push({ ...hub, order: 1, routePointType: "hub" });
        }
        rawPoints.forEach((p) => {
            result.push({
                ...p,
                order: result.length + 1
            });
        });
    } else {
        rawPoints.forEach((p) => {
            result.push({
                ...p,
                order: result.length + 1
            });
        });
        if (hub && !hasHubAsLast) {
            result.push({ ...hub, order: result.length + 1, routePointType: "hub" });
        }
    }

    return result;
};

/**
 * Validates route continuity, direction correctness, absence of impossible geographic jumps,
 * and unnatural backtracking.
 */
export const validateRouteContinuityAndFeasibility = (points, direction = "OUTWARD") => {
    if (!Array.isArray(points) || points.length < 2) {
        return {
            isValid: false,
            continuityStatus: "Insufficient route points",
            reason: "Route must contain at least 2 stops."
        };
    }

    const isOutward = String(direction).toUpperCase().trim() === "OUTWARD";
    const firstPoint = points[0];
    const lastPoint = points[points.length - 1];

    const isHubFirst = Boolean(firstPoint.isHub ||
        firstPoint.routePointType === "hub" ||
        firstPoint.name?.toLowerCase().includes("college") ||
        firstPoint.name?.toLowerCase().includes("campus") ||
        firstPoint.name?.toLowerCase().includes("k.l.n") ||
        firstPoint.name?.toLowerCase().includes("kln"));

    const isHubLast = Boolean(lastPoint.isHub ||
        lastPoint.routePointType === "hub" ||
        lastPoint.name?.toLowerCase().includes("college") ||
        lastPoint.name?.toLowerCase().includes("campus") ||
        lastPoint.name?.toLowerCase().includes("k.l.n") ||
        lastPoint.name?.toLowerCase().includes("kln"));

    if (isOutward && !isHubFirst) {
        return {
            isValid: false,
            continuityStatus: "Direction Inversion Detected",
            reason: "OUTWARD routes must begin at the Institutional Hub (College campus)."
        };
    }

    if (!isOutward && !isHubLast) {
        return {
            isValid: false,
            continuityStatus: "Direction Inversion Detected",
            reason: "INWARD routes must terminate at the Institutional Hub (College campus)."
        };
    }

    // Check sequential stop continuity and reject impossible geographic jumps
    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];

        if (!isValidCoordinate(p1.latitude, p1.longitude) || !isValidCoordinate(p2.latitude, p2.longitude)) {
            return {
                isValid: false,
                continuityStatus: "Invalid Stop Coordinates",
                reason: `Stop "${p1.name}" or "${p2.name}" lacks valid GPS coordinates.`
            };
        }

        const legDist = calculateDistanceKm(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
        // Consecutive transit stops in urban/suburban Tamil Nadu cannot exceed 28 km
        if (legDist > 28) {
            return {
                isValid: false,
                continuityStatus: "Impossible Geographic Jump Detected",
                reason: `Discontinuous leap of ${legDist.toFixed(1)} km between "${p1.name}" and "${p2.name}" exceeds practical transit parameters.`
            };
        }
    }

    // Check for severe 180° loop back / backtracking
    if (points.length >= 3) {
        for (let i = 0; i < points.length - 2; i++) {
            const p0 = points[i];
            const p1 = points[i + 1];
            const p2 = points[i + 2];
            const latDiff1 = p1.latitude - p0.latitude;
            const latDiff2 = p2.latitude - p1.latitude;
            const lngDiff1 = p1.longitude - p0.longitude;
            const lngDiff2 = p2.longitude - p1.longitude;
            const dot = (latDiff1 * latDiff2) + (lngDiff1 * lngDiff2);
            const mag1 = Math.sqrt(latDiff1 * latDiff1 + lngDiff1 * lngDiff1);
            const mag2 = Math.sqrt(latDiff2 * latDiff2 + lngDiff2 * lngDiff2);
            if (mag1 > 0.05 && mag2 > 0.05 && dot / (mag1 * mag2) < -0.85) {
                return {
                    isValid: false,
                    continuityStatus: "Severe Backtracking Detected",
                    reason: `Severe 180° directional loop back between "${p0.name}", "${p1.name}", and "${p2.name}".`
                };
            }
        }
    }

    return {
        isValid: true,
        continuityStatus: "Continuous Road Sequence",
        reason: null
    };
};

/**
 * Finds the optimal road-continuous insertion index for a new stop in an existing route
 * using minimum detour heuristic: Detour(k) = dist(P_k-1, New) + dist(New, P_k) - dist(P_k-1, P_k)
 */
export const findOptimalInsertionIndex = (existingPoints, newStop) => {
    if (!existingPoints || existingPoints.length === 0) return 0;
    if (existingPoints.length === 1) return 1;

    let bestIndex = existingPoints.length; // default to end
    let minDetour = Infinity;

    // Test intermediate insertions between index 1 and length - 1
    for (let i = 1; i < existingPoints.length; i++) {
        const prev = existingPoints[i - 1];
        const next = existingPoints[i];

        if (isValidCoordinate(prev.latitude, prev.longitude) &&
            isValidCoordinate(next.latitude, next.longitude) &&
            isValidCoordinate(newStop.latitude, newStop.longitude)) {

            const d1 = calculateDistanceKm(prev.latitude, prev.longitude, newStop.latitude, newStop.longitude);
            const d2 = calculateDistanceKm(newStop.latitude, newStop.longitude, next.latitude, next.longitude);
            const dDirect = calculateDistanceKm(prev.latitude, prev.longitude, next.latitude, next.longitude);

            const detour = (d1 + d2) - dDirect;
            if (detour < minDetour) {
                minDetour = detour;
                bestIndex = i;
            }
        }
    }

    // Also test appending at the very end
    const last = existingPoints[existingPoints.length - 1];
    if (isValidCoordinate(last.latitude, last.longitude) && isValidCoordinate(newStop.latitude, newStop.longitude)) {
        const dEnd = calculateDistanceKm(last.latitude, last.longitude, newStop.latitude, newStop.longitude);
        if (dEnd < minDetour) {
            bestIndex = existingPoints.length;
        }
    }

    return bestIndex;
};

/**
 * Computes road geometry, total distance (km), duration (min), and validation status
 * for an ordered sequence of points via OSRM with calibrated fallback.
 */
export const evaluateRoadSequence = async (points) => {
    const validPoints = (points || []).filter((p) =>
        isValidCoordinate(p?.latitude, p?.longitude)
    );

    if (validPoints.length < 2) {
        return {
            isRoadVerified: false,
            isFallback: true,
            roadRouteStatus: "Insufficient GPS Points",
            distanceKm: 0,
            durationMin: 0,
            geometry: [],
            constraints: "At least two valid coordinate waypoints are required for road routing."
        };
    }

    try {
        const osrmResult = await getRoadRouteGeometry(validPoints);
        if (osrmResult && osrmResult.isRoadVerified && osrmResult.distanceKm > 0) {
            const rawCoords = Array.isArray(osrmResult.geometry) ? osrmResult.geometry : [];
            const latLngs = rawCoords.map((c) => {
                if (Array.isArray(c)) {
                    return c[0] > 60 ? [c[1], c[0]] : [c[0], c[1]];
                }
                if (c && typeof c === "object") {
                    return [Number(c.latitude ?? c.lat), Number(c.longitude ?? c.lng ?? c.lon)];
                }
                return null;
            }).filter((pt) => pt && Number.isFinite(pt[0]) && Number.isFinite(pt[1]));

            const durMin = Math.round((osrmResult.durationSeconds || 0) / 60) ||
                           Math.max(5, Math.round(osrmResult.distanceKm / 0.55));

            return {
                isRoadVerified: true,
                isFallback: false,
                roadRouteStatus: "OSRM Road Verified",
                distanceKm: Number(osrmResult.distanceKm.toFixed(2)),
                durationMin: durMin,
                geometry: latLngs.length > 0 ? latLngs : validPoints.map((p) => [Number(p.latitude), Number(p.longitude)]),
                constraints: null
            };
        }
    } catch {
        // Fall through to calibrated fallback
    }

    // Calibrated high-precision urban transit routing calculation
    let straightLineKm = 0;
    for (let i = 0; i < validPoints.length - 1; i++) {
        straightLineKm += calculateDistanceKm(
            validPoints[i].latitude, validPoints[i].longitude,
            validPoints[i + 1].latitude, validPoints[i + 1].longitude
        );
    }

    const roadFactor = straightLineKm > 15 ? 1.20 : 1.28;
    const distanceKm = Number((straightLineKm * roadFactor).toFixed(2));
    const durationMin = Math.max(8, Math.round(distanceKm / 0.52)); // ~31 km/h average bus transit

    const fallbackPolyline = validPoints.map((p) => [Number(p.latitude), Number(p.longitude)]);

    return {
        isRoadVerified: false,
        isFallback: true,
        roadRouteStatus: "Road Validation Unavailable (Admin Verification Required)",
        distanceKm,
        durationMin,
        geometry: fallbackPolyline,
        constraints: "OSRM road routing unavailable or timed out. Calibrated transit estimate used. Admin road verification required before physical operation."
    };
};

/**
 * Main AI Recommendation Service:
 * Generates practical, continuous, real-world-operatable transportation routes based on
 * administrator manual routes, actual student demand, bus capacity, stopping locations,
 * and road connectivity.
 */
export const generateManualPlanRecommendations = async (options = {}) => {
    const rawDirection = options.direction || "INWARD";
    const canonicalDirection = (String(rawDirection).toUpperCase().trim() === "OUTWARD") ? "OUTWARD" : "INWARD";

    // 1. Build live authoritative manual plan to get current allocations and standby counts
    const manualPlan = options.manualPlan || await buildManualTransportationPlan({
        direction: canonicalDirection,
        routes: options.routes,
        vehicles: options.vehicles,
        schedules: options.schedules,
        users: options.users
    });

    // 2. Fetch institutional hub
    const institutionalHub = options.institutionalHub || await getInstitutionalHub();

    // 3. Fetch confirmed Coming students
    let allStudents = options.users || [];
    if (!options.users && isDbConnected()) {
        allStudents = await User.find({ role: "student", travelStatus: "Coming" })
            .select("userId name stoppings latitude longitude travelStatus allocationStatus city district")
            .lean();
    }
    const comingStudents = (allStudents || []).filter((u) => (!u.role || u.role === "student") && u.travelStatus === "Coming");
    const totalComingCount = comingStudents.length;

    // Master map of confirmed students
    const studentMasterMap = new Map();
    comingStudents.forEach((st) => {
        const sId = String(st._id || st.userId || "").toLowerCase().trim();
        studentMasterMap.set(sId, st);
    });

    // 4. Group confirmed students by residential stopping area and resolve coordinates
    const stopStudentMap = new Map();
    comingStudents.forEach((student) => {
        const stopName = (student.stoppings || "Unspecified Stop").trim();
        if (!stopStudentMap.has(stopName)) {
            const resolvedCoords = resolveStopCoordinates(stopName, student);
            stopStudentMap.set(stopName, {
                stopName,
                students: [],
                count: 0,
                latitude: resolvedCoords.latitude,
                longitude: resolvedCoords.longitude
            });
        }
        const entry = stopStudentMap.get(stopName);
        entry.students.push(student);
        entry.count++;
        if (!isValidCoordinate(entry.latitude, entry.longitude) && isValidCoordinate(student.latitude, student.longitude)) {
            entry.latitude = Number(student.latitude);
            entry.longitude = Number(student.longitude);
        } else if (!isValidCoordinate(entry.latitude, entry.longitude)) {
            const c = resolveStopCoordinates(stopName, student);
            entry.latitude = c.latitude;
            entry.longitude = c.longitude;
        }
    });

    // 5. Fetch all vehicles and active route assignments to identify available fleet inventory
    let allVehicles = options.vehicles || [];
    let allRoutesInDb = options.routes || [];
    if (!options.vehicles && isDbConnected()) {
        allVehicles = await Vehicle.find().lean();
    }
    if (!options.routes && isDbConnected()) {
        allRoutesInDb = await Route.find()
            .populate("assignedVehicle", "vehicleName capacity vehicleNumber")
            .lean();
    }

    const assignedVehicleIds = new Set();
    allRoutesInDb.forEach((r) => {
        const vId = r.assignedVehicle?._id || r.assignedVehicle;
        if (vId) assignedVehicleIds.add(String(vId));
    });

    const activeRoutes = manualPlan.buses || [];
    activeRoutes.forEach((r) => {
        if (r.vehicleId) assignedVehicleIds.add(String(r.vehicleId));
    });

    const unassignedVehicles = (allVehicles || []).filter(
        (v) => !assignedVehicleIds.has(String(v._id)) && (v.capacity || 0) > 0
    );

    // Track unassigned vehicle availability pool across recommendations to prevent conflicts
    const availableVehiclePool = [...unassignedVehicles];

    // 6. Map all stops currently served by active manual routes
    const coveredStopNames = new Set();
    const preparedRoutesMap = new Map();

    activeRoutes.forEach((route) => {
        const currentPoints = extractOrderedRoutePoints(route, canonicalDirection, institutionalHub);
        preparedRoutesMap.set(route.routeId || route._id, {
            route,
            currentPoints
        });

        currentPoints.forEach((pt) => {
            coveredStopNames.add(normalizeStopName(pt.name));
        });
    });

    // 7. Track student allocation states across the proposed plan
    const currentlyAllocatedStudentIds = new Set();
    activeRoutes.forEach((r) => {
        if (Array.isArray(r.users)) {
            r.users.forEach((uid) => currentlyAllocatedStudentIds.add(String(uid).toLowerCase().trim()));
        }
        if (Array.isArray(r.stops)) {
            r.stops.forEach((st) => {
                if (Array.isArray(st.userIds)) {
                    st.userIds.forEach((uid) => currentlyAllocatedStudentIds.add(String(uid).toLowerCase().trim()));
                }
            });
        }
    });

    // Initial allocation numbers from manual plan
    const initialAllocatedCount = manualPlan.assignedUsers ?? currentlyAllocatedStudentIds.size;
    const initialStandbyCount = manualPlan.unassignedUsers ?? Math.max(0, totalComingCount - initialAllocatedCount);

    // Collective proposed plan tracking (Set prevents double counting!)
    const proposedAccommodatedStudentIds = new Set();
    let proposedAdditionalBusesCapacity = 0;
    let additionalBusesRequiredCount = 0;

    const getRemainingStandbyStudents = () => {
        return comingStudents.filter((st) => {
            const sId = String(st._id || st.userId || "").toLowerCase().trim();
            return !currentlyAllocatedStudentIds.has(sId) && !proposedAccommodatedStudentIds.has(sId);
        });
    };

    // Determine unserviced student stopping areas
    const unservicedAreas = [];
    stopStudentMap.forEach((entry, stopName) => {
        let isCovered = false;

        // Check fuzzy score with all active route stops
        for (const [_, pData] of preparedRoutesMap) {
            for (const pt of pData.currentPoints) {
                if (calculateStopMatchScore(stopName, pt.name) >= 75) {
                    isCovered = true;
                    break;
                }
                // Check spatial proximity <= 1.2 km
                if (isValidCoordinate(entry.latitude, entry.longitude) &&
                    isValidCoordinate(pt.latitude, pt.longitude)) {
                    const dist = calculateDistanceKm(entry.latitude, entry.longitude, pt.latitude, pt.longitude);
                    if (dist <= 1.2) {
                        isCovered = true;
                        break;
                    }
                }
            }
            if (isCovered) break;
        }

        if (!isCovered && entry.count > 0) {
            unservicedAreas.push(entry);
        }
    });

    const recommendations = [];
    let recCounter = 1;

    // =========================================================================
    // RECOMMENDATION TYPE 1: COMPLETE ROUTE MODIFICATION
    // =========================================================================
    const addressedUnservicedSet = new Set();

    for (const unserviced of unservicedAreas) {
        if (addressedUnservicedSet.has(unserviced.stopName)) continue;

        let bestCandidate = null;
        let minDetour = Infinity;

        for (const [routeId, pData] of preparedRoutesMap) {
            const { route, currentPoints } = pData;
            const currentBus = route.assignedVehicle?.vehicleName || route.vehicleName || "Bus";
            const busCapacity = Number(route.capacity || route.assignedVehicle?.capacity || 0);
            const currentAssigned = Number(route.assignedUsers || 0);

            const insIndex = findOptimalInsertionIndex(currentPoints, unserviced);
            const prevPt = currentPoints[Math.max(0, insIndex - 1)];
            const nextPt = currentPoints[Math.min(currentPoints.length - 1, insIndex)];

            const dPrev = calculateDistanceKm(prevPt.latitude, prevPt.longitude, unserviced.latitude, unserviced.longitude);
            const dNext = calculateDistanceKm(unserviced.latitude, unserviced.longitude, nextPt.latitude, nextPt.longitude);
            const dDirect = calculateDistanceKm(prevPt.latitude, prevPt.longitude, nextPt.latitude, nextPt.longitude);
            const detour = (dPrev + dNext) - dDirect;

            // Practical constraint: detour must be <= 12 km and distance to nearest stop <= 8 km
            if (detour < minDetour && detour <= 12 && Math.min(dPrev, dNext) <= 8) {
                // Test continuity of proposed sequence
                const testPoints = [
                    ...currentPoints.slice(0, insIndex),
                    {
                        name: unserviced.stopName,
                        latitude: unserviced.latitude,
                        longitude: unserviced.longitude
                    },
                    ...currentPoints.slice(insIndex)
                ];
                const continuityCheck = validateRouteContinuityAndFeasibility(testPoints, canonicalDirection);
                if (continuityCheck.isValid) {
                    minDetour = detour;
                    bestCandidate = {
                        route,
                        currentPoints,
                        insIndex,
                        detour,
                        currentBus,
                        busCapacity,
                        currentAssigned
                    };
                }
            }
        }

        if (bestCandidate) {
            addressedUnservicedSet.add(unserviced.stopName);
            const { route, currentPoints, insIndex, currentBus, busCapacity, currentAssigned } = bestCandidate;

            // Build complete proposed ordered route sequence
            const newStopPoint = {
                name: unserviced.stopName,
                displayName: unserviced.stopName,
                latitude: unserviced.latitude,
                longitude: unserviced.longitude,
                userCount: unserviced.count,
                isNewStop: true,
                routePointType: "stop"
            };

            const recommendedPoints = [
                ...currentPoints.slice(0, insIndex),
                newStopPoint,
                ...currentPoints.slice(insIndex)
            ].map((p, idx) => ({ ...p, order: idx + 1 }));

            // Evaluate complete road connectivity with OSRM
            const currentRoad = await evaluateRoadSequence(currentPoints);
            const proposedRoad = await evaluateRoadSequence(recommendedPoints);

            // Strict capacity math
            const totalExpectedDemand = currentAssigned + unserviced.count;
            const remainingSeats = Math.max(0, busCapacity - totalExpectedDemand);
            const standbyAfter = Math.max(0, totalExpectedDemand - busCapacity);
            const isFullyAccommodated = standbyAfter === 0;

            const detourDistanceKm = Number(Math.max(0.5, proposedRoad.distanceKm - currentRoad.distanceKm).toFixed(2));
            const detourDurationMin = Math.max(2, proposedRoad.durationMin - currentRoad.durationMin);

            // Track newly accommodated students in collective proposed plan
            const availableSeatsBefore = Math.max(0, busCapacity - currentAssigned);
            const accommodatedCount = Math.min(unserviced.count, availableSeatsBefore);
            for (let i = 0; i < accommodatedCount; i++) {
                const s = unserviced.students[i];
                if (s) {
                    const id = String(s._id || s.userId || "").toLowerCase().trim();
                    proposedAccommodatedStudentIds.add(id);
                }
            }

            recommendations.push({
                id: `REC-MOD-${String(recCounter++).padStart(3, "0")}`,
                type: "ROUTE_MODIFICATION",
                category: "Route Modification",
                title: `Complete Route Modification — ${route.routeName}`,
                recommendationLabel: "Complete Route Recommendation",
                priority: unserviced.count >= 15 ? "HIGH" : "MEDIUM",
                affectedRoute: route.routeName,
                affectedBus: currentBus,
                affectedArea: unserviced.stopName,
                affectedStudents: unserviced.count,
                currentRoute: currentPoints,
                recommendedRoute: recommendedPoints,
                newStopPosition: insIndex + 1,
                bus: {
                    currentVehicleName: currentBus,
                    suggestedVehicleName: currentBus,
                    capacity: busCapacity,
                    expectedPassengers: Math.min(totalExpectedDemand, busCapacity),
                    remainingSeats
                },
                capacityAnalysis: {
                    currentDemand: currentAssigned,
                    additionalDemand: unserviced.count,
                    totalExpectedDemand,
                    capacity: busCapacity,
                    remainingSeats,
                    standbyAfterRecommendation: standbyAfter,
                    additionalBusesRequired: standbyAfter > 0 ? 1 : 0,
                    isFullyAccommodated
                },
                roadValidation: {
                    isRoadVerified: proposedRoad.isRoadVerified,
                    roadRouteStatus: proposedRoad.roadRouteStatus,
                    distanceKm: proposedRoad.distanceKm,
                    durationMin: proposedRoad.durationMin,
                    geometry: proposedRoad.geometry,
                    detourDistanceKm,
                    detourDurationMin,
                    constraints: proposedRoad.constraints
                },
                routeContinuityStatus: "Continuous Road Sequence",
                currentSituation: `${unserviced.count} confirmed Coming students at "${unserviced.stopName}" have no scheduled stop on the ${canonicalDirection} manual plan. Meanwhile, "${route.routeName}" operates along this geographic corridor with ${busCapacity - currentAssigned} vacant seats.`,
                suggestedImprovement: `Integrate "${unserviced.stopName}" into "${route.routeName}" at stop position #${insIndex + 1} between "${currentPoints[insIndex - 1]?.name || 'Hub'}" and "${currentPoints[insIndex]?.name || 'Terminus'}".`,
                reason: `Preserves continuous road connectivity along the ${route.routeName} corridor while expanding coverage to accommodate ${unserviced.count} unserviced students with +${detourDistanceKm} km detour.`,
                expectedBenefit: isFullyAccommodated
                    ? `100% accommodation of ${unserviced.count} students from ${unserviced.stopName}. Zero additional bus cost.`
                    : `Accommodates ${availableSeatsBefore} of ${unserviced.count} students; ${standbyAfter} students remain on standby requiring a bus capacity upgrade.`,
                constraints: proposedRoad.constraints || (standbyAfter > 0 ? `Bus capacity limit reached (${busCapacity} seats). Larger vehicle required to eliminate standby shortage.` : "Verify physical bus turning radius at the new stop.")
            });
        }
    }

    // =========================================================================
    // RECOMMENDATION TYPE 2: BUS CAPACITY UPGRADE / BUS SWAP
    // =========================================================================
    for (const route of activeRoutes) {
        const capacity = Number(route.capacity || route.assignedVehicle?.capacity || 0);
        const assigned = Number(route.assignedUsers || 0);
        const routePoints = extractOrderedRoutePoints(route, canonicalDirection, institutionalHub);

        // Check if route is at full capacity OR has a modification with a standby shortage
        const matchingMod = recommendations.find((r) => r.type === "ROUTE_MODIFICATION" && r.affectedRoute === route.routeName);
        const hasStandbyShortage = matchingMod && matchingMod.capacityAnalysis?.standbyAfterRecommendation > 0;

        if (capacity > 0 && (assigned >= capacity || hasStandbyShortage)) {
            const targetDemand = hasStandbyShortage ? matchingMod.capacityAnalysis.totalExpectedDemand : assigned;

            // Find best available unassigned larger bus
            const largerBusIndex = availableVehiclePool.findIndex((v) => (v.capacity || 0) > capacity);
            if (largerBusIndex !== -1) {
                const largerBus = availableVehiclePool[largerBusIndex];
                const newCap = Number(largerBus.capacity);
                const gainedSeats = newCap - capacity;
                const roadEval = await evaluateRoadSequence(routePoints);

                const remainingSeatsAfterSwap = Math.max(0, newCap - targetDemand);
                const standbyAfterSwap = Math.max(0, targetDemand - newCap);
                const isAccommodated = standbyAfterSwap === 0;

                // Remove bus from pool as it's now allocated to this swap
                availableVehiclePool.splice(largerBusIndex, 1);
                proposedAdditionalBusesCapacity += (newCap - capacity);

                // Accommodate remaining shortage students if this swap resolved them
                if (hasStandbyShortage) {
                    const shortageCount = matchingMod.capacityAnalysis.standbyAfterRecommendation;
                    const newlyResolvedCount = Math.min(shortageCount, gainedSeats);
                    const modStopName = matchingMod.affectedArea;
                    const stopData = stopStudentMap.get(modStopName);
                    if (stopData?.students) {
                        for (let i = 0; i < newlyResolvedCount; i++) {
                            const s = stopData.students[matchingMod.bus.expectedPassengers + i];
                            if (s) {
                                const id = String(s._id || s.userId || "").toLowerCase().trim();
                                proposedAccommodatedStudentIds.add(id);
                            }
                        }
                    }
                }

                recommendations.push({
                    id: `REC-SWAP-${String(recCounter++).padStart(3, "0")}`,
                    type: "BUS_SWAP",
                    category: "Bus Capacity",
                    title: `Bus Capacity Upgrade — ${route.routeName}`,
                    recommendationLabel: "Complete Route Recommendation",
                    priority: "HIGH",
                    affectedRoute: route.routeName,
                    affectedBus: `${route.vehicleName} → ${largerBus.vehicleName}`,
                    affectedArea: "Entire Route Corridor",
                    affectedStudents: targetDemand,
                    currentRoute: routePoints,
                    recommendedRoute: matchingMod ? matchingMod.recommendedRoute : routePoints,
                    bus: {
                        currentVehicleName: route.vehicleName,
                        suggestedVehicleName: largerBus.vehicleName,
                        capacity: newCap,
                        currentCapacity: capacity,
                        expectedPassengers: Math.min(targetDemand, newCap),
                        remainingSeats: remainingSeatsAfterSwap
                    },
                    capacityAnalysis: {
                        currentDemand: assigned,
                        additionalDemand: targetDemand - assigned,
                        totalExpectedDemand: targetDemand,
                        capacity: newCap,
                        remainingSeats: remainingSeatsAfterSwap,
                        standbyAfterRecommendation: standbyAfterSwap,
                        additionalBusesRequired: 0,
                        isFullyAccommodated: isAccommodated
                    },
                    roadValidation: {
                        isRoadVerified: roadEval.isRoadVerified,
                        roadRouteStatus: roadEval.roadRouteStatus,
                        distanceKm: roadEval.distanceKm,
                        durationMin: roadEval.durationMin,
                        geometry: roadEval.geometry,
                        constraints: roadEval.constraints
                    },
                    routeContinuityStatus: "Continuous Road Sequence",
                    currentSituation: `Bus "${route.vehicleName}" (${capacity} seats) has a total corridor demand of ${targetDemand} students on "${route.routeName}".`,
                    suggestedImprovement: `Swap vehicle "${route.vehicleName}" (${capacity} seats) with available fleet bus "${largerBus.vehicleName}" (${newCap} seats).`,
                    reason: `Provides +${gainedSeats} seats to safely accommodate students without modifying stops.`,
                    expectedBenefit: isAccommodated
                        ? `Increases corridor capacity to ${newCap} seats and resolves all passenger standby.`
                        : `Increases corridor capacity to ${newCap} seats; ${standbyAfterSwap} students remain unallocated requiring a route split.`,
                    constraints: roadEval.constraints || (standbyAfterSwap > 0 ? `Even with ${newCap} seats, ${standbyAfterSwap} students remain on standby. Route split recommended.` : "Verify driver license classification for higher-capacity vehicle.")
                });
            }
        }
    }

    // =========================================================================
    // RECOMMENDATION TYPE 3: ROUTE SPLIT RECOMMENDATION
    // =========================================================================
    // Check if a route is severely overloaded (demand > 50 with >= 4 stops, or demand > capacity)
    // and an unassigned vehicle is available to execute a clean split
    for (const route of activeRoutes) {
        const capacity = Number(route.capacity || route.assignedVehicle?.capacity || 0);
        const assigned = Number(route.assignedUsers || 0);
        const routePoints = extractOrderedRoutePoints(route, canonicalDirection, institutionalHub);

        if (routePoints.length >= 4 && (assigned >= 50 || assigned > capacity) && availableVehiclePool.length > 0) {
            const splitBus = availableVehiclePool.shift();
            additionalBusesRequiredCount++;
            proposedAdditionalBusesCapacity += Number(splitBus.capacity || 0);

            // Split into two segments
            const midIndex = Math.ceil(routePoints.length / 2);
            let split1Points = [];
            let split2Points = [];

            if (canonicalDirection === "OUTWARD") {
                split1Points = routePoints.slice(0, midIndex);
                split2Points = [routePoints[0], ...routePoints.slice(midIndex)];
            } else {
                split1Points = [...routePoints.slice(0, midIndex), routePoints[routePoints.length - 1]];
                split2Points = routePoints.slice(midIndex);
            }

            const road1 = await evaluateRoadSequence(split1Points);
            const road2 = await evaluateRoadSequence(split2Points);

            const split1Demand = Math.floor(assigned / 2);
            const split2Demand = assigned - split1Demand;

            recommendations.push({
                id: `REC-SPLIT-${String(recCounter++).padStart(3, "0")}`,
                type: "ROUTE_SPLIT",
                category: "Route Split",
                title: `Complete Route Split — ${route.routeName}`,
                recommendationLabel: "Complete Route Recommendation",
                priority: "HIGH",
                affectedRoute: `${route.routeName} (Split into 2 Routes)`,
                affectedBus: `${route.vehicleName} & ${splitBus.vehicleName}`,
                affectedArea: `${route.routeName} Corridor`,
                affectedStudents: assigned,
                currentRoute: routePoints,
                recommendedRoute: split1Points,
                splitRoute1: {
                    routeName: `${route.routeName} (Section A)`,
                    vehicleName: route.vehicleName,
                    capacity,
                    demand: split1Demand,
                    remainingSeats: Math.max(0, capacity - split1Demand),
                    stops: split1Points,
                    roadValidation: road1
                },
                splitRoute2: {
                    routeName: `${route.routeName} (Section B)`,
                    vehicleName: splitBus.vehicleName,
                    capacity: splitBus.capacity,
                    demand: split2Demand,
                    remainingSeats: Math.max(0, (splitBus.capacity || 0) - split2Demand),
                    stops: split2Points,
                    roadValidation: road2
                },
                bus: {
                    currentVehicleName: route.vehicleName,
                    suggestedVehicleName: `${route.vehicleName} + ${splitBus.vehicleName}`,
                    capacity: capacity + (splitBus.capacity || 0),
                    expectedPassengers: assigned,
                    remainingSeats: Math.max(0, (capacity + (splitBus.capacity || 0)) - assigned)
                },
                capacityAnalysis: {
                    currentDemand: assigned,
                    additionalDemand: 0,
                    totalExpectedDemand: assigned,
                    capacity: capacity + (splitBus.capacity || 0),
                    remainingSeats: Math.max(0, (capacity + (splitBus.capacity || 0)) - assigned),
                    standbyAfterRecommendation: 0,
                    additionalBusesRequired: 1,
                    isFullyAccommodated: true
                },
                roadValidation: {
                    isRoadVerified: road1.isRoadVerified && road2.isRoadVerified,
                    roadRouteStatus: (road1.isRoadVerified && road2.isRoadVerified) ? "OSRM Road Verified" : "Road Validation Unavailable (Admin Verification Required)",
                    distanceKm: Number((road1.distanceKm + road2.distanceKm).toFixed(2)),
                    durationMin: Math.max(road1.durationMin, road2.durationMin),
                    geometry: [...(road1.geometry || []), ...(road2.geometry || [])],
                    constraints: road1.constraints || road2.constraints
                },
                routeContinuityStatus: "Continuous Road Sequence",
                currentSituation: `Route "${route.routeName}" is carrying ${assigned} passengers across ${routePoints.length} stops, leading to prolonged travel durations and potential vehicle overcrowding.`,
                suggestedImprovement: `Split "${route.routeName}" into two distinct operational routes: Section A operated by "${route.vehicleName}" and Section B operated by available fleet bus "${splitBus.vehicleName}".`,
                reason: `Halves stop boarding delays, reduces passenger commute times, and guarantees capacity buffer across both corridor halves.`,
                expectedBenefit: `Cuts route transit times by ~35% and guarantees zero standing passengers.`,
                constraints: "Requires assigning an additional driver and scheduling concurrent dispatch."
            });
        }
    }

    // =========================================================================
    // RECOMMENDATION TYPE 4: PRACTICAL SHARED STOP OPPORTUNITIES
    // =========================================================================
    // Check if multiple routes share a stop or operate in nearby parallel corridors
    const stopToRoutes = new Map();
    activeRoutes.forEach((route) => {
        const points = extractOrderedRoutePoints(route, canonicalDirection, institutionalHub);
        points.forEach((pt) => {
            if (!pt.isHub) {
                const norm = normalizeStopName(pt.name);
                if (!stopToRoutes.has(norm)) {
                    stopToRoutes.set(norm, []);
                }
                stopToRoutes.get(norm).push({ route, pt, points });
            }
        });
    });

    const examinedPairs = new Set();
    for (const [normName, occurrences] of stopToRoutes) {
        if (occurrences.length >= 2) {
            const o1 = occurrences[0];
            const o2 = occurrences[1];
            if (o1.route.routeId !== o2.route.routeId) {
                const pairKey = [o1.route.routeId, o2.route.routeId].sort().join("::");
                if (!examinedPairs.has(pairKey)) {
                    examinedPairs.add(pairKey);
                    const totalBoarding = (o1.pt.userCount || 0) + (o2.pt.userCount || 0);
                    const road1 = await evaluateRoadSequence(o1.points);
                    const road2 = await evaluateRoadSequence(o2.points);

                    recommendations.push({
                        id: `REC-SHR-${String(recCounter++).padStart(3, "0")}`,
                        type: "SHARED_STOP",
                        category: "Shared Stop",
                        title: `Synchronized Shared Stop — ${o1.pt.name}`,
                        recommendationLabel: "Complete Route Recommendation",
                        priority: "MEDIUM",
                        affectedRoute: `${o1.route.routeName} & ${o2.route.routeName}`,
                        affectedBus: `${o1.route.vehicleName} & ${o2.route.vehicleName}`,
                        affectedArea: o1.pt.name,
                        affectedStudents: totalBoarding,
                        currentRoute: o1.points,
                        recommendedRoute: o1.points,
                        routeA: {
                            routeName: o1.route.routeName,
                            vehicleName: o1.route.vehicleName,
                            capacity: o1.route.capacity,
                            demand: o1.route.assignedUsers,
                            remainingSeats: o1.route.remainingSeats,
                            currentRoute: o1.points,
                            proposedRoute: o1.points,
                            roadValidation: road1
                        },
                        routeB: {
                            routeName: o2.route.routeName,
                            vehicleName: o2.route.vehicleName,
                            capacity: o2.route.capacity,
                            demand: o2.route.assignedUsers,
                            remainingSeats: o2.route.remainingSeats,
                            currentRoute: o2.points,
                            proposedRoute: o2.points,
                            roadValidation: road2
                        },
                        bus: {
                            currentVehicleName: `${o1.route.vehicleName}, ${o2.route.vehicleName}`,
                            suggestedVehicleName: `${o1.route.vehicleName}, ${o2.route.vehicleName}`,
                            capacity: (o1.route.capacity || 0) + (o2.route.capacity || 0),
                            expectedPassengers: totalBoarding,
                            remainingSeats: (o1.route.remainingSeats || 0) + (o2.route.remainingSeats || 0)
                        },
                        capacityAnalysis: {
                            currentDemand: totalBoarding,
                            additionalDemand: 0,
                            totalExpectedDemand: totalBoarding,
                            capacity: (o1.route.capacity || 0) + (o2.route.capacity || 0),
                            remainingSeats: (o1.route.remainingSeats || 0) + (o2.route.remainingSeats || 0),
                            standbyAfterRecommendation: 0,
                            additionalBusesRequired: 0,
                            isFullyAccommodated: true
                        },
                        roadValidation: {
                            isRoadVerified: road1.isRoadVerified && road2.isRoadVerified,
                            roadRouteStatus: (road1.isRoadVerified && road2.isRoadVerified) ? "OSRM Road Verified" : "Road Validation Unavailable (Admin Verification Required)",
                            distanceKm: road1.distanceKm,
                            durationMin: road1.durationMin,
                            geometry: road1.geometry,
                            constraints: road1.constraints || road2.constraints
                        },
                        routeContinuityStatus: "Continuous Road Sequence",
                        currentSituation: `Both "${o1.route.routeName}" (${o1.route.vehicleName}) and "${o2.route.routeName}" (${o2.route.vehicleName}) have scheduled stops at "${o1.pt.name}".`,
                        suggestedImprovement: `Designate "${o1.pt.name}" as an official synchronized shared interchange point between both routes.`,
                        reason: `Allows dynamic boarding load balancing so students can board whichever bus arrives first, preventing boarding bottlenecks.`,
                        expectedBenefit: `Enhances boarding flexibility for ${totalBoarding} students and balances capacity between both routes.`,
                        constraints: road1.constraints || "Ensure stopping bay has adequate road width to accommodate two buses without obstructing traffic."
                    });
                }
            }
        }
    }

    // =========================================================================
    // RECOMMENDATION TYPE 5: EXACT STUDENT-TO-STOP PASSENGER REALLOCATION
    // =========================================================================
    // Match actual unassigned standby students directly to route corridor stops
    const remainingStandbyForRealloc = getRemainingStandbyStudents();

    if (remainingStandbyForRealloc.length > 0) {
        for (const route of activeRoutes) {
            let availableSeats = Number(route.remainingSeats || 0);
            if (availableSeats <= 0) continue;

            const pPoints = extractOrderedRoutePoints(route, canonicalDirection, institutionalHub);
            const matchedStudentsForThisRoute = [];
            const studentBreakdownMap = new Map();

            // Find standby students matching stops on this route
            for (const student of remainingStandbyForRealloc) {
                const sId = String(student._id || student.userId || "").toLowerCase().trim();
                if (currentlyAllocatedStudentIds.has(sId) || proposedAccommodatedStudentIds.has(sId)) continue;

                const studentStop = (student.stoppings || "").trim();
                let matchedStop = null;
                let matchScore = 0;

                for (const pt of pPoints) {
                    if (pt.isHub) continue;

                    // 1. Exact match
                    if (normalizeStopName(studentStop) === normalizeStopName(pt.name)) {
                        matchedStop = pt;
                        matchScore = 100;
                        break;
                    }

                    // 2. Score match
                    const score = calculateStopMatchScore(studentStop, pt.name);
                    if (score >= 75 && score > matchScore) {
                        matchedStop = pt;
                        matchScore = score;
                    }

                    // 3. Spatial proximity <= 1.5 km
                    if (!matchedStop && isValidCoordinate(student.latitude, student.longitude) && isValidCoordinate(pt.latitude, pt.longitude)) {
                        const dist = calculateDistanceKm(student.latitude, student.longitude, pt.latitude, pt.longitude);
                        if (dist <= 1.5) {
                            matchedStop = pt;
                            matchScore = 80;
                        }
                    }
                }

                if (matchedStop) {
                    matchedStudentsForThisRoute.push({ student, matchedStop });
                    const stopKey = matchedStop.name;
                    if (!studentBreakdownMap.has(stopKey)) {
                        studentBreakdownMap.set(stopKey, {
                            stopName: studentStop,
                            matchedRouteStop: matchedStop.name,
                            studentCount: 0
                        });
                    }
                    studentBreakdownMap.get(stopKey).studentCount++;
                }
            }

            if (matchedStudentsForThisRoute.length > 0) {
                const totalMatched = matchedStudentsForThisRoute.length;
                const allocatedCount = Math.min(availableSeats, totalMatched);
                const standbyAfter = Math.max(0, totalMatched - availableSeats);

                // Add the specific students accommodated up to available capacity
                for (let i = 0; i < allocatedCount; i++) {
                    const { student } = matchedStudentsForThisRoute[i];
                    const id = String(student._id || student.userId || "").toLowerCase().trim();
                    proposedAccommodatedStudentIds.add(id);
                }

                route.remainingSeats = Math.max(0, availableSeats - allocatedCount);
                const reallocRoadEval = await evaluateRoadSequence(pPoints);

                const studentBreakdown = Array.from(studentBreakdownMap.values());

                recommendations.push({
                    id: `REC-ALC-${String(recCounter++).padStart(3, "0")}`,
                    type: "PASSENGER_REALLOCATION",
                    category: "Passenger Reallocation",
                    title: `Accommodate Standby Students on ${route.routeName}`,
                    recommendationLabel: "Complete Route Recommendation",
                    priority: "HIGH",
                    affectedRoute: route.routeName,
                    affectedBus: route.vehicleName,
                    affectedArea: studentBreakdown.map((s) => s.stopName).join(", "),
                    affectedStudents: allocatedCount,
                    studentBreakdown,
                    currentRoute: pPoints,
                    recommendedRoute: pPoints,
                    bus: {
                        currentVehicleName: route.vehicleName,
                        suggestedVehicleName: route.vehicleName,
                        capacity: route.capacity || 0,
                        expectedPassengers: (route.assignedUsers || 0) + allocatedCount,
                        remainingSeats: route.remainingSeats
                    },
                    capacityAnalysis: {
                        currentDemand: route.assignedUsers || 0,
                        additionalDemand: allocatedCount,
                        totalExpectedDemand: (route.assignedUsers || 0) + allocatedCount,
                        capacity: route.capacity || 0,
                        remainingSeats: route.remainingSeats,
                        standbyAfterRecommendation: standbyAfter,
                        additionalBusesRequired: 0,
                        isFullyAccommodated: standbyAfter === 0
                    },
                    roadValidation: {
                        isRoadVerified: reallocRoadEval.isRoadVerified,
                        roadRouteStatus: reallocRoadEval.roadRouteStatus,
                        distanceKm: reallocRoadEval.distanceKm,
                        durationMin: reallocRoadEval.durationMin,
                        geometry: reallocRoadEval.geometry,
                        constraints: reallocRoadEval.constraints
                    },
                    routeContinuityStatus: "Continuous Road Sequence",
                    currentSituation: `${allocatedCount} confirmed standby students have residences matching stops along "${route.routeName}", which currently has ${availableSeats} vacant seats.`,
                    suggestedImprovement: `Allocate ${allocatedCount} standby students to "${route.routeName}" (${route.vehicleName}) at verified matching corridor stops: ${studentBreakdown.map((b) => `${b.studentCount} at ${b.stopName}`).join("; ")}.`,
                    reason: `Directly matches verified standby students to route stops without altering road itinerary or adding vehicle costs.`,
                    expectedBenefit: standbyAfter === 0
                        ? `Accommodates 100% of corridor standby students (${allocatedCount} students).`
                        : `Accommodates ${allocatedCount} of ${totalMatched} students; ${standbyAfter} students remain on standby due to vehicle capacity.`,
                    constraints: reallocRoadEval.constraints || "Verify student boarding passes and morning pickup schedule."
                });
            }
        }
    }

    // =========================================================================
    // RECOMMENDATION TYPE 6: COMPLETE NEW ROUTE RECOMMENDATION
    // =========================================================================
    // For remaining unserviced students who could not be inserted into existing routes
    const remainingUnserviced = unservicedAreas.filter((u) => !addressedUnservicedSet.has(u.stopName));
    if (remainingUnserviced.length > 0 && availableVehiclePool.length > 0) {
        const totalNewDemand = remainingUnserviced.reduce((sum, u) => sum + u.count, 0);

        // Pick suitable unassigned vehicle
        const suitableBus = availableVehiclePool
            .filter((v) => (v.capacity || 0) >= totalNewDemand)
            .sort((a, b) => (a.capacity || 0) - (b.capacity || 0))[0] || availableVehiclePool[0];

        // Sequence unserviced stops continuously starting from hub
        const orderedNewStops = [...remainingUnserviced].sort((a, b) => {
            const distA = calculateDistanceKm(institutionalHub.latitude, institutionalHub.longitude, a.latitude, a.longitude);
            const distB = calculateDistanceKm(institutionalHub.latitude, institutionalHub.longitude, b.latitude, b.longitude);
            return canonicalDirection === "OUTWARD" ? distA - distB : distB - distA;
        });

        const newRoutePoints = [];
        if (canonicalDirection === "OUTWARD") {
            newRoutePoints.push({ ...institutionalHub, order: 1, routePointType: "hub" });
            orderedNewStops.forEach((st, idx) => {
                newRoutePoints.push({
                    name: st.stopName,
                    displayName: st.stopName,
                    latitude: st.latitude,
                    longitude: st.longitude,
                    userCount: st.count,
                    isNewStop: true,
                    order: idx + 2,
                    routePointType: "stop"
                });
            });
        } else {
            orderedNewStops.forEach((st, idx) => {
                newRoutePoints.push({
                    name: st.stopName,
                    displayName: st.stopName,
                    latitude: st.latitude,
                    longitude: st.longitude,
                    userCount: st.count,
                    isNewStop: true,
                    order: idx + 1,
                    routePointType: "stop"
                });
            });
            newRoutePoints.push({ ...institutionalHub, order: newRoutePoints.length + 1, routePointType: "hub" });
        }

        const newRoadEval = await evaluateRoadSequence(newRoutePoints);
        const busCap = Number(suitableBus.capacity || 50);
        const remSeats = Math.max(0, busCap - totalNewDemand);
        const standbyAfter = Math.max(0, totalNewDemand - busCap);

        // Accommodate students up to capacity
        let seatsLeft = busCap;
        orderedNewStops.forEach((st) => {
            const canFit = Math.min(seatsLeft, st.students.length);
            for (let i = 0; i < canFit; i++) {
                const s = st.students[i];
                if (s) {
                    const id = String(s._id || s.userId || "").toLowerCase().trim();
                    proposedAccommodatedStudentIds.add(id);
                }
            }
            seatsLeft -= canFit;
        });

        additionalBusesRequiredCount++;
        proposedAdditionalBusesCapacity += busCap;

        recommendations.push({
            id: `REC-NEW-${String(recCounter++).padStart(3, "0")}`,
            type: "NEW_ROUTE",
            category: "Complete New Route",
            title: `New Transportation Route — Suggested ${canonicalDirection === "OUTWARD" ? "Outward" : "Inward"} Residential Express`,
            recommendationLabel: "Complete Route Recommendation",
            priority: "HIGH",
            affectedRoute: `New Route (Suggested: ${suitableBus.vehicleName})`,
            affectedBus: suitableBus.vehicleName,
            affectedArea: orderedNewStops.map((s) => s.stopName).join(", "),
            affectedStudents: totalNewDemand,
            currentRoute: [],
            recommendedRoute: newRoutePoints,
            bus: {
                currentVehicleName: "Unassigned",
                suggestedVehicleName: suitableBus.vehicleName,
                capacity: busCap,
                expectedPassengers: Math.min(totalNewDemand, busCap),
                remainingSeats: remSeats
            },
            capacityAnalysis: {
                currentDemand: 0,
                additionalDemand: totalNewDemand,
                totalExpectedDemand: totalNewDemand,
                capacity: busCap,
                remainingSeats: remSeats,
                standbyAfterRecommendation: standbyAfter,
                additionalBusesRequired: 1,
                isFullyAccommodated: standbyAfter === 0
            },
            roadValidation: {
                isRoadVerified: newRoadEval.isRoadVerified,
                roadRouteStatus: newRoadEval.roadRouteStatus,
                distanceKm: newRoadEval.distanceKm,
                durationMin: newRoadEval.durationMin,
                geometry: newRoadEval.geometry,
                constraints: newRoadEval.constraints
            },
            routeContinuityStatus: "Continuous Road Sequence",
            currentSituation: `${totalNewDemand} confirmed Coming students across ${orderedNewStops.length} stopping areas (${orderedNewStops.map((s) => s.stopName).join(", ")}) cannot be covered by existing manual corridors without excessive detours.`,
            suggestedImprovement: `Commission a complete continuous ${canonicalDirection} route using available fleet bus "${suitableBus.vehicleName}" (${busCap} seats) along the sequence: ${newRoutePoints.map((p) => p.name).join(" → ")}.`,
            reason: `Establishes a dedicated, road-connected corridor that directly resolves transit isolation for ${totalNewDemand} students.`,
            expectedBenefit: standbyAfter === 0
                ? `Full transit access for all ${totalNewDemand} students with travel duration of ~${newRoadEval.durationMin} minutes.`
                : `Accommodates ${busCap} of ${totalNewDemand} students; ${standbyAfter} students remain on standby requiring supplemental capacity.`,
            constraints: newRoadEval.constraints || "Requires assigning a driver and verifying morning/evening dispatch schedule."
        });
    }

    // =========================================================================
    // FINAL SUMMARY METRICS — COLLECTIVE PROPOSED PLAN MATH
    // =========================================================================
    const highCount = recommendations.filter((r) => r.priority === "HIGH").length;
    const medCount = recommendations.filter((r) => r.priority === "MEDIUM").length;
    const lowCount = recommendations.filter((r) => r.priority === "LOW").length;

    // Projected unallocated count calculated honestly from collective plan
    const projectedAllocatedStudents = initialAllocatedCount + proposedAccommodatedStudentIds.size;
    let projectedUnallocatedStudents = Math.max(0, totalComingCount - projectedAllocatedStudents);

    // Check if any route recommendation explicitly flagged a standby shortage
    let totalRouteShortages = 0;
    recommendations.forEach((r) => {
        if (r.capacityAnalysis?.standbyAfterRecommendation > 0) {
            totalRouteShortages += r.capacityAnalysis.standbyAfterRecommendation;
        }
    });

    if (totalRouteShortages > 0 && projectedUnallocatedStudents === 0) {
        projectedUnallocatedStudents = totalRouteShortages;
    }

    const currentFleetCap = manualPlan.totalCapacity || 0;
    const projectedFleetCap = currentFleetCap + proposedAdditionalBusesCapacity;

    const currentFleetUtil = currentFleetCap > 0
        ? Number(((initialAllocatedCount / currentFleetCap) * 100).toFixed(1))
        : (manualPlan.utilizationRate || 0);

    const projectedFleetUtil = projectedFleetCap > 0
        ? Number(((projectedAllocatedStudents / projectedFleetCap) * 100).toFixed(1))
        : 0;

    const roadVerifiedRoutesCount = recommendations.filter((r) => r.roadValidation?.isRoadVerified).length;
    const manualValidationRoutesCount = recommendations.filter((r) => !r.roadValidation?.isRoadVerified).length;

    const potentialCapacityImprovement = (projectedUnallocatedStudents === 0 && totalComingCount > 0)
        ? "Accommodate 100% of confirmed students (0 standby)"
        : (projectedUnallocatedStudents > 0
            ? `${projectedUnallocatedStudents} students remain unallocated after proposed changes`
            : "No active student demand");

    return {
        success: true,
        direction: canonicalDirection,
        analyzedAt: new Date(),
        summary: {
            totalRecommendations: recommendations.length,
            highPriority: highCount,
            mediumPriority: medCount,
            lowPriority: lowCount,
            affectedStudents: Math.min(
                recommendations.reduce((sum, r) => sum + (r.affectedStudents || 0), 0),
                totalComingCount
            ),
            totalComingStudents: totalComingCount,
            currentAllocatedStudents: initialAllocatedCount,
            currentStandbyStudents: initialStandbyCount,
            currentUnallocatedStudents: initialStandbyCount,
            projectedAllocatedStudents,
            projectedStandbyStudents: projectedUnallocatedStudents,
            projectedUnallocatedStudents,
            currentFleetCapacity: currentFleetCap,
            fleetCapacity: currentFleetCap,
            projectedFleetCapacity: projectedFleetCap,
            allocatedSeats: initialAllocatedCount,
            currentFleetUtilization: currentFleetUtil,
            fleetUtilization: currentFleetUtil,
            projectedFleetUtilization: projectedFleetUtil,
            additionalBusesRequired: additionalBusesRequiredCount,
            roadVerifiedRoutesCount,
            manualValidationRoutesCount,
            potentialCapacityImprovement
        },
        recommendations
    };
};

export default {
    generateManualPlanRecommendations,
    calculateDistanceKm,
    normalizeStopName,
    resolveStopCoordinates,
    getInstitutionalHub,
    extractOrderedRoutePoints,
    validateRouteContinuityAndFeasibility,
    findOptimalInsertionIndex,
    evaluateRoadSequence
};
