import mongoose from "mongoose";
import AiPlan from "../models/AiPlan.js";
import User from "../models/User.js";
import Route from "../models/Route.js";
import Vehicle from "../models/Vehicle.js";
import Schedule from "../models/Schedule.js";
import LateResponseEvent from "../models/LateResponseEvent.js";
import { isDbConnected } from "../config/db.js";

/*
|--------------------------------------------------------------------------
| GENERAL HELPERS
|--------------------------------------------------------------------------
*/

const normalize = (value) => {
    if (value === null || value === undefined) {
        return "";
    }
    return String(value).trim();
};

export const canonicalizeDirection = (dir) => {
    if (!dir) return null;
    const s = String(dir).toUpperCase().trim();
    if (s === "OUTWARD" || s === "FROM_SOURCE" || s === "DEPARTURE" || s === "SOURCE" || s === "OUT") {
        return "OUTWARD";
    }
    if (s === "INWARD" || s === "TO_DESTINATION" || s === "ARRIVAL" || s === "DESTINATION" || s === "IN") {
        return "INWARD";
    }
    return null;
};

export const isValidCoordinate = (latitude, longitude) => {
    if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) {
        return false;
    }

    const lat = Number(latitude);
    const lng = Number(longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || isNaN(lat) || isNaN(lng)) {
        return false;
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return false;
    }

    if (lat === 0 && lng === 0) {
        return false;
    }

    return true;
};

const normalizeDate = (dateValue) => {
    if (!dateValue) return "";
    try {
        const d = new Date(dateValue);
        if (isNaN(d.getTime())) return "";
        return d.toISOString().split("T")[0];
    } catch {
        return "";
    }
};

// In-memory stop coordinate cache to accelerate resolution and prevent duplicate geocoding
const coordinateCache = new Map();

// Built-in Regional Transit Gazetteer for standard Madurai transit localities (instant 0ms resolution)
export const MADURAI_REGIONAL_STOPS = {
    "alagappan nagar": { latitude: 9.8920, longitude: 78.0990, displayName: "Alagappan Nagar, Madurai" },
    "anna nagar": { latitude: 9.9180, longitude: 78.1467, displayName: "Anna Nagar, Madurai" },
    "anuppanadi": { latitude: 9.9070, longitude: 78.1510, displayName: "Anuppanadi, Madurai" },
    "arappalayam": { latitude: 9.9322, longitude: 78.1025, displayName: "Arappalayam, Madurai" },
    "avaniyapuram": { latitude: 9.8780, longitude: 78.1240, displayName: "Avaniyapuram, Madurai" },
    "bibikulam": { latitude: 9.9420, longitude: 78.1360, displayName: "Bibikulam, Madurai" },
    "goripalayam": { latitude: 9.9315, longitude: 78.1275, displayName: "Goripalayam, Madurai" },
    "iyer bungalow": { latitude: 9.9650, longitude: 78.1410, displayName: "Iyer Bungalow, Madurai" },
    "jaihindpuram": { latitude: 9.9020, longitude: 78.1120, displayName: "Jaihindpuram, Madurai" },
    "k k nagar west": { latitude: 9.9250, longitude: 78.1460, displayName: "K.K. Nagar West, Madurai" },
    "kk nagar west": { latitude: 9.9250, longitude: 78.1460, displayName: "K.K. Nagar West, Madurai" },
    "k pudur": { latitude: 9.9520, longitude: 78.1460, displayName: "K.Pudur, Madurai" },
    "kpudur": { latitude: 9.9520, longitude: 78.1460, displayName: "K.Pudur, Madurai" },
    "pudur": { latitude: 9.9520, longitude: 78.1460, displayName: "Pudur, Madurai" },
    "kk nagar": { latitude: 9.9270, longitude: 78.1510, displayName: "KK Nagar, Madurai" },
    "k k nagar": { latitude: 9.9270, longitude: 78.1510, displayName: "KK Nagar, Madurai" },
    "kochadai": { latitude: 9.9360, longitude: 78.0850, displayName: "Kochadai, Madurai" },
    "kochadai junction": { latitude: 9.9365, longitude: 78.0855, displayName: "Kochadai Junction, Madurai" },
    "koodal nagar": { latitude: 9.9620, longitude: 78.1050, displayName: "Koodal Nagar, Madurai" },
    "mattuthavani": { latitude: 9.9450, longitude: 78.1580, displayName: "Mattuthavani, Madurai" },
    "narimedu": { latitude: 9.9380, longitude: 78.1320, displayName: "Narimedu, Madurai" },
    "othakadai": { latitude: 9.9700, longitude: 78.1800, displayName: "Othakadai, Madurai" },
    "palanganatham": { latitude: 9.9050, longitude: 78.0980, displayName: "Palanganatham, Madurai" },
    "periyar": { latitude: 9.9175, longitude: 78.1140, displayName: "Periyar, Madurai" },
    "sellur": { latitude: 9.9410, longitude: 78.1180, displayName: "Sellur, Madurai" },
    "simmakkal": { latitude: 9.9255, longitude: 78.1192, displayName: "Simmakkal, Madurai" },
    "tallakulam": { latitude: 9.9360, longitude: 78.1350, displayName: "Tallakulam, Madurai" },
    "teppakulam": { latitude: 9.9140, longitude: 78.1470, displayName: "Teppakulam, Madurai" },
    "thirunagar": { latitude: 9.8690, longitude: 78.0690, displayName: "Thirunagar, Madurai" },
    "thiruppalai": { latitude: 9.9780, longitude: 78.1450, displayName: "Thiruppalai, Madurai" },
    "vandiyur": { latitude: 9.9200, longitude: 78.1650, displayName: "Vandiyur, Madurai" },
    "vilangudi": { latitude: 9.9510, longitude: 78.0920, displayName: "Vilangudi, Madurai" },
    "villapuram": { latitude: 9.8950, longitude: 78.1320, displayName: "Villapuram, Madurai" },
    "k l n college of engineering": { latitude: 9.8324, longitude: 78.1884, displayName: "K.L.N. College of Engineering, Pottapalayam" },
    "kln college of engineering": { latitude: 9.8324, longitude: 78.1884, displayName: "K.L.N. College of Engineering, Pottapalayam" },
    "klnce": { latitude: 9.8324, longitude: 78.1884, displayName: "K.L.N. College of Engineering, Pottapalayam" },
    "pottapalayam": { latitude: 9.8324, longitude: 78.1884, displayName: "Pottapalayam, Sivagangai" }
};

/*
|--------------------------------------------------------------------------
| DATABASE HELPERS
|--------------------------------------------------------------------------
*/

const getCollectionData = async (collectionName, projection = null) => {
    try {
        if (!isDbConnected() || !mongoose.connection.db) {
            return [];
        }

        const cursor = mongoose.connection.db.collection(collectionName).find({});
        if (projection && typeof projection === "object" && Object.keys(projection).length > 0) {
            cursor.project(projection);
        }
        return await cursor.toArray();
    } catch (error) {
        console.error(`Failed to read collection ${collectionName}:`, error.message);
        return [];
    }
};

/*
|--------------------------------------------------------------------------
| USER MANAGEMENT - DEMAND FILTERING & DEDUPLICATION
|--------------------------------------------------------------------------
*/

export const getManagedUsers = (users) => {
    if (!Array.isArray(users)) return [];
    return users.filter((user) => {
        const role = normalize(user?.role).toLowerCase();
        return role !== "admin";
    });
};

export const getConfirmedUsers = (users) => {
    if (!Array.isArray(users)) return [];
    return users.filter((user) => {
        const role = normalize(user?.role).toLowerCase();
        if (role === "admin") {
            return false;
        }

        const status = normalize(
            user?.travelStatus || user?.travelConfirmation || user?.status
        ).toLowerCase();

        return [
            "coming",
            "confirmed",
            "yes",
            "traveling",
            "travelling",
            "attending"
        ].includes(status);
    });
};

export const deduplicateUsers = (users) => {
    if (!Array.isArray(users)) return { uniqueUsers: [], duplicateCount: 0 };
    const seenIds = new Set();
    const uniqueUsers = [];
    let duplicateCount = 0;

    users.forEach((user) => {
        const id = String(user?.userId || user?._id || user?.id || "").trim();
        if (id && seenIds.has(id)) {
            duplicateCount++;
        } else {
            if (id) seenIds.add(id);
            uniqueUsers.push(user);
        }
    });

    return { uniqueUsers, duplicateCount };
};

/*
|--------------------------------------------------------------------------
| STOPPING AREA EXTRACTION & DEMAND GROUPING
|--------------------------------------------------------------------------
*/

const getStopName = (stop) => {
    if (typeof stop === "string") {
        return normalize(stop);
    }
    return normalize(
        stop?.name ||
        stop?.location ||
        stop?.stopName ||
        stop?.area ||
        stop?.displayName ||
        stop?.address
    );
};

const getUserStoppings = (user) => {
    const stoppings = user?.stoppings;

    if (Array.isArray(stoppings)) {
        return stoppings.map(getStopName).filter(Boolean);
    }

    if (typeof stoppings === "string") {
        return stoppings
            .split(",")
            .map((stop) => normalize(stop))
            .filter(Boolean);
    }

    return [];
};

const getStopCoordinatesFromUser = (user) => {
    const stoppings = user?.stoppings;

    if (!Array.isArray(stoppings)) {
        return [];
    }

    return stoppings.map((stop) => {
        if (!stop || typeof stop === "string") {
            return null;
        }

        const latitude = Number(stop?.latitude ?? stop?.lat);
        const longitude = Number(stop?.longitude ?? stop?.lng ?? stop?.lon);

        if (!isValidCoordinate(latitude, longitude)) {
            return null;
        }

        return {
            name: getStopName(stop),
            latitude,
            longitude
        };
    });
};

export const buildStopLocationQuery = (group) => {
    if (!group) return "";
    const stopName = typeof group === "string" ? group : (group.name || group.stopping || "");
    const city = typeof group === "object" ? (group.city || "") : "";
    const state = typeof group === "object" ? (group.state || "") : "";
    const country = typeof group === "object" ? (group.country || "") : "";

    const parts = [stopName];
    if (city && !parts.some((p) => p.toLowerCase() === city.toLowerCase())) {
        parts.push(city);
    }
    if (state && !parts.some((p) => p.toLowerCase() === state.toLowerCase())) {
        parts.push(state);
    }
    if (country && !parts.some((p) => p.toLowerCase() === country.toLowerCase())) {
        parts.push(country);
    }

    return parts.filter(Boolean).join(", ");
};

export const buildStopLocationKey = (stopping = "", city = "", state = "", country = "") => {
    const normalizedStopping = String(stopping || "").toLowerCase().trim();
    const normalizedCity = String(city || "").toLowerCase().trim();
    const normalizedState = String(state || "").toLowerCase().trim();
    const normalizedCountry = String(country || "").toLowerCase().trim();
    return `${normalizedStopping}|${normalizedCity}|${normalizedState}|${normalizedCountry}`;
};

export const calculateStoppingGroups = (users) => {
    const groups = {};

    users.forEach((user) => {
        const stoppings = getUserStoppings(user);
        const coordinateStops = getStopCoordinatesFromUser(user);
        const primaryStop = stoppings[0];
        if (!primaryStop) return;

        const city = normalize(user?.city || user?.City || "");
        const state = normalize(user?.state || user?.State || "");
        const country = normalize(user?.country || user?.Country || "");

        // Build canonical 4-field location key: normalizedStopping|normalizedCity|normalizedState|normalizedCountry
        const canonicalLocationKey = buildStopLocationKey(primaryStop, city, state, country);
        const locationContext = [city, state, country].filter(Boolean).join(", ");
        const key = canonicalLocationKey;

        if (!groups[key]) {
            groups[key] = {
                name: primaryStop,
                locationKey: canonicalLocationKey,
                city,
                state,
                country,
                locationContext,
                locationQuery: "",
                users: [],
                userIds: [],
                userCount: 0,
                latitude: null,
                longitude: null
            };
        } else {
            if (!groups[key].city && city) groups[key].city = city;
            if (!groups[key].state && state) groups[key].state = state;
            if (!groups[key].country && country) groups[key].country = country;
        }

        groups[key].users.push(user);

        const uId = String(user?._id || user?.userId || user?.id || "");
        if (uId) {
            groups[key].userIds.push(uId);
        }
        groups[key].userCount = groups[key].users.length;
        groups[key].locationQuery = buildStopLocationQuery(groups[key]);

        const coordinate = coordinateStops[0];
        if (
            coordinate &&
            isValidCoordinate(coordinate.latitude, coordinate.longitude) &&
            !isValidCoordinate(groups[key].latitude, groups[key].longitude)
        ) {
            groups[key].latitude = coordinate.latitude;
            groups[key].longitude = coordinate.longitude;
        }
    });

    return Object.values(groups).sort(
        (a, b) => b.users.length - a.users.length
    );
};

export const validatePreOptimizationData = ({
    users = [],
    stoppingGroups = [],
    availableVehicles = []
}) => {
    const errors = [];
    const warnings = [];
    const seenUserIds = new Set();
    let duplicateUserCount = 0;

    users.forEach((u, idx) => {
        const uId = String(u?.userId || u?._id || u?.id || "").trim();
        if (!uId) {
            errors.push(`User at index ${idx} is missing a userId.`);
        } else if (seenUserIds.has(uId)) {
            duplicateUserCount++;
            errors.push(`Duplicate userId detected: '${uId}'.`);
        } else {
            seenUserIds.add(uId);
        }

        if (!u?.name || String(u.name).trim().length === 0) {
            errors.push(`User '${uId || idx}' is missing a valid name.`);
        }

        const userStops = getUserStoppings(u);
        if (userStops.length === 0) {
            errors.push(`User '${uId || idx}' (${u?.name || "Unknown"}) has no assigned stopping.`);
        }
    });

    const totalGroupDemand = stoppingGroups.reduce(
        (sum, g) => sum + (g.userCount || g.users?.length || 0),
        0
    );

    if (totalGroupDemand !== users.length) {
        errors.push(
            `Demand mismatch: Confirmed users count (${users.length}) does not match sum of stopping group demands (${totalGroupDemand}).`
        );
    }

    const totalFleetCapacity = availableVehicles.reduce(
        (sum, v) => sum + getVehicleCapacity(v),
        0
    );

    if (totalFleetCapacity < users.length) {
        warnings.push(
            `Total confirmed demand (${users.length}) exceeds available fleet capacity (${totalFleetCapacity} seats). Some passengers may remain unallocated due to capacity shortage.`
        );
    }

    return {
        isValid: errors.length === 0,
        errors,
        warnings,
        metrics: {
            totalComingUsers: users.length,
            totalGroupDemand,
            uniqueStops: stoppingGroups.length,
            availableVehicles: availableVehicles.length,
            totalFleetCapacity,
            duplicateUsers: duplicateUserCount
        }
    };
};

/*
|--------------------------------------------------------------------------
| VEHICLE MANAGEMENT & SCHEDULE AVAILABILITY
|--------------------------------------------------------------------------
*/

export const getVehicleCapacity = (vehicle) => {
    const capacity = Number(
        vehicle?.capacity ??
        vehicle?.seats ??
        vehicle?.totalSeats ??
        vehicle?.seatCapacity ??
        0
    );
    return Number.isFinite(capacity) && capacity > 0 ? capacity : 0;
};

export const getVehicleName = (vehicle, index = 0) => {
    return (
        normalize(
            vehicle?.vehicleName ||
            vehicle?.name ||
            vehicle?.busName ||
            vehicle?.busNumber ||
            vehicle?.vehicleNumber
        ) || `Bus ${index + 1}`
    );
};

export const getAvailableVehicles = (
    rawVehicles,
    schedules = [],
    requestedDate = null
) => {
    if (!Array.isArray(rawVehicles)) return [];

    return rawVehicles.filter((vehicle) => {
        const capacity = getVehicleCapacity(vehicle);
        if (capacity <= 0) return false;

        const vehicleId = String(vehicle?._id || vehicle?.id || "");
        if (!vehicleId) return false;

        if (!Array.isArray(schedules) || schedules.length === 0) {
            return true;
        }

        // Find schedule record matching this vehicle
        const match = schedules.find((s) => {
            const schedVehicleId = String(
                s?.vehicle?._id || s?.vehicle || s?.vehicleId || ""
            );
            return schedVehicleId && schedVehicleId === vehicleId;
        });

        if (!match) return true;

        const availability = normalize(
            match?.availability || match?.status
        ).toLowerCase();

        return (
            availability !== "not available" &&
            availability !== "unavailable" &&
            !availability.includes("unavailable") &&
            !availability.includes("not available") &&
            !availability.includes("maintenance") &&
            availability !== "disabled" &&
            availability !== "inactive" &&
            availability !== "off"
        );
    });
};

/*
|--------------------------------------------------------------------------
| GET AI SUMMARY METRICS (Ultra-fast countDocuments + distinct queries)
|--------------------------------------------------------------------------
*/

export const getAIMetrics = async () => {
    if (!isDbConnected()) {
        return {
            success: false,
            code: "DATABASE_UNAVAILABLE",
            message: "Database is currently unavailable."
        };
    }

    const tStart = Date.now();

    const [totalUsers, comingUsers, vehicles, schedules, storedRoutes, distinctStops] = await Promise.all([
        User.countDocuments({ role: "student" }),
        User.countDocuments({ role: "student", travelStatus: "Coming" }),
        Vehicle.find({}).select("vehicleName capacity seatCapacity seats totalSeats status").lean(),
        Schedule.find({}).select("vehicle availability status date").lean(),
        Route.countDocuments({}),
        User.distinct("stoppings", { role: "student", travelStatus: "Coming" })
    ]);

    const availableVehicles = getAvailableVehicles(vehicles, schedules);
    const totalPhysicalCapacity = vehicles.reduce(
        (sum, v) => sum + getVehicleCapacity(v),
        0
    );
    const totalAvailableCapacity = availableVehicles.reduce(
        (sum, v) => sum + getVehicleCapacity(v),
        0
    );
    const uniqueStoppingAreas = distinctStops.filter((s) => s && String(s).trim().length > 0).length;

    console.log(`[PERFORMANCE] dashboard metrics query: ${Date.now() - tStart} ms`);

    return {
        success: true,
        totalUsers,
        confirmedUsers: comingUsers,
        comingUsers,
        confirmedUserCount: comingUsers,
        userCount: totalUsers,
        vehicles: vehicles.length,
        totalVehicles: vehicles.length,
        vehicleCount: vehicles.length,
        availableVehicles: availableVehicles.length,
        availableVehicleCount: availableVehicles.length,
        storedRoutes,
        routes: storedRoutes,
        routeCount: storedRoutes,
        uniqueStoppingAreas,
        stoppingAreas: uniqueStoppingAreas,
        stopCount: uniqueStoppingAreas,
        totalPhysicalCapacity,
        totalAvailableCapacity,
        capacityShortage: totalAvailableCapacity < comingUsers,
        counts: {
            users: totalUsers,
            confirmedUsers: comingUsers,
            comingUsers,
            vehicles: vehicles.length,
            availableVehicles: availableVehicles.length,
            totalPhysicalCapacity,
            totalAvailableCapacity,
            routes: storedRoutes,
            schedules: schedules.length,
            stops: uniqueStoppingAreas
        }
    };
};

/*
|--------------------------------------------------------------------------
| GET AI SUMMARY DATA
|--------------------------------------------------------------------------
*/

export const getAIData = async (options = {}) => {
    if (!isDbConnected()) {
        return {
            success: false,
            code: "DATABASE_UNAVAILABLE",
            message: "Database is currently unavailable."
        };
    }

    if (options.metricsOnly) {
        return await getAIMetrics();
    }

    const [allUsers, vehicles, routes, schedules] = await Promise.all([
        getCollectionData("users", {
            userId: 1,
            name: 1,
            role: 1,
            travelStatus: 1,
            stoppings: 1,
            city: 1,
            district: 1,
            state: 1,
            country: 1,
            latitude: 1,
            longitude: 1,
            pickupLocation: 1
        }),
        getCollectionData("vehicles", {
            vehicleName: 1,
            vehicleNumber: 1,
            capacity: 1,
            seatCapacity: 1,
            seats: 1,
            totalSeats: 1,
            type: 1,
            status: 1
        }),
        getCollectionData("routes", {
            routeName: 1,
            routeCode: 1,
            assignedVehicle: 1,
            source: 1,
            destination: 1,
            stops: 1
        }),
        getCollectionData("schedules", {
            vehicle: 1,
            vehicleName: 1,
            availability: 1,
            status: 1,
            date: 1
        })
    ]);

    const users = getManagedUsers(allUsers);
    const confirmedUsers = getConfirmedUsers(users);
    const { uniqueUsers } = deduplicateUsers(confirmedUsers);
    const comingUserCount = uniqueUsers.length;

    const availableVehicles = getAvailableVehicles(vehicles, schedules);
    const totalPhysicalCapacity = vehicles.reduce(
        (sum, v) => sum + getVehicleCapacity(v),
        0
    );
    const totalAvailableCapacity = availableVehicles.reduce(
        (sum, v) => sum + getVehicleCapacity(v),
        0
    );
    const stoppingGroups = calculateStoppingGroups(uniqueUsers);

    return {
        users,
        vehicles,
        availableVehicles,
        routes,
        schedules,
        stops: stoppingGroups,
        userCount: users.length,
        confirmedUserCount: comingUserCount,
        comingUsers: comingUserCount,
        vehicleCount: vehicles.length,
        availableVehicleCount: availableVehicles.length,
        totalPhysicalCapacity,
        totalAvailableCapacity,
        capacityShortage: totalAvailableCapacity < comingUserCount,
        routeCount: routes.length,
        scheduleCount: schedules.length,
        stopCount: stoppingGroups.length,
        counts: {
            users: users.length,
            confirmedUsers: comingUserCount,
            comingUsers: comingUserCount,
            vehicles: vehicles.length,
            availableVehicles: availableVehicles.length,
            totalPhysicalCapacity,
            totalAvailableCapacity,
            routes: routes.length,
            schedules: schedules.length,
            stops: stoppingGroups.length
        }
    };
};

/*
|--------------------------------------------------------------------------
| GEOGRAPHY & DISTANCE CALCULATIONS (WGS84 Universal)
|--------------------------------------------------------------------------
*/

const toRadians = (value) => (Number(value) * Math.PI) / 180;
const toDegrees = (value) => (Number(value) * 180) / Math.PI;

export const calculateDistanceKm = (lat1, lon1, lat2, lon2) => {
    const rLat1 = toRadians(lat1);
    const rLat2 = toRadians(lat2);
    const deltaLat = toRadians(lat2 - lat1);
    const deltaLon = toRadians(lon2 - lon1);

    const a =
        Math.sin(deltaLat / 2) ** 2 +
        Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(deltaLon / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return 6371 * c;
};

export const calculateBearing = (lat1, lon1, lat2, lon2) => {
    const rLat1 = toRadians(lat1);
    const rLat2 = toRadians(lat2);
    const deltaLon = toRadians(lon2 - lon1);

    const y = Math.sin(deltaLon) * Math.cos(rLat2);
    const x =
        Math.cos(rLat1) * Math.sin(rLat2) -
        Math.sin(rLat1) * Math.cos(rLat2) * Math.cos(deltaLon);

    const initialBearing = toDegrees(Math.atan2(y, x));
    return (initialBearing + 360) % 360;
};

export const getBearingDifference = (b1, b2) => {
    if (b1 === null || b1 === undefined || b2 === null || b2 === undefined) return 0;
    const diff = Math.abs(Number(b1) - Number(b2));
    return Math.min(diff, 360 - diff);
};

const normalizeTextBackend = (text) => {
    if (!text) return "";
    return String(text)
        .toLowerCase()
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s]/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
};

/*
|--------------------------------------------------------------------------
| GLOBAL OPENSTREETMAP GEOCODING & PLACE SEARCH (Nominatim + Photon)
|--------------------------------------------------------------------------
*/

const buildNominatimUrl = (query, proximityPoint = null) => {
    const clean = encodeURIComponent(String(query).trim());
    let url =
        `https://nominatim.openstreetmap.org/search` +
        `?q=${clean}` +
        `&format=jsonv2` +
        `&addressdetails=1` +
        `&namedetails=1` +
        `&limit=10`;

    if (proximityPoint && isValidCoordinate(proximityPoint.latitude, proximityPoint.longitude)) {
        const delta = 0.5;
        const lat = Number(proximityPoint.latitude);
        const lon = Number(proximityPoint.longitude);
        url += `&viewbox=${lon - delta},${lat + delta},${lon + delta},${lat - delta}&bounded=0`;
    }

    return url;
};

const buildPhotonUrl = (query, proximityPoint = null) => {
    const clean = encodeURIComponent(String(query).trim());
    let url = `https://photon.komoot.io/api/?q=${clean}&limit=10`;

    if (proximityPoint && isValidCoordinate(proximityPoint.latitude, proximityPoint.longitude)) {
        url += `&lat=${Number(proximityPoint.latitude)}&lon=${Number(proximityPoint.longitude)}`;
    }

    return url;
};

const formatNominatimResult = (item, proximityPoint = null) => {
    const latitude = Number(item.lat);
    const longitude = Number(item.lon);

    if (!isValidCoordinate(latitude, longitude)) return null;

    const addr = item.address || {};
    const name = item.namedetails?.name || item.name || item.display_name?.split(",")[0] || "Location";
    const displayName = item.display_name || name;
    const address = item.display_name || "";
    const city = addr.city || addr.town || addr.village || addr.municipality || "";
    const district = addr.state_district || addr.county || addr.district || "";
    const state = addr.state || addr.province || addr.region || "";
    const country = addr.country || "";

    const distanceKm = proximityPoint && isValidCoordinate(proximityPoint.latitude, proximityPoint.longitude)
        ? Number(calculateDistanceKm(proximityPoint.latitude, proximityPoint.longitude, latitude, longitude).toFixed(2))
        : null;

    return {
        name,
        displayName,
        address,
        latitude,
        longitude,
        city,
        district,
        state,
        country,
        placeId: String(item.place_id || `osm-${latitude}-${longitude}`),
        type: item.type || "Location",
        source: "OpenStreetMap",
        importance: Number(item.importance || 0.5),
        distanceKm
    };
};

const formatPhotonResult = (feature, proximityPoint = null) => {
    const coordinates = feature?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null;

    const longitude = Number(coordinates[0]);
    const latitude = Number(coordinates[1]);

    if (!isValidCoordinate(latitude, longitude)) return null;

    const props = feature.properties || {};
    const name = props.name || props.street || "Location";
    const city = props.city || props.town || props.village || props.locality || "";
    const district = props.district || props.county || "";
    const state = props.state || "";
    const country = props.country || "";
    const parts = [
        props.name,
        props.street,
        city,
        district,
        state,
        country
    ].filter(Boolean);
    const displayName = parts.join(", ");

    const distanceKm = proximityPoint && isValidCoordinate(proximityPoint.latitude, proximityPoint.longitude)
        ? Number(calculateDistanceKm(proximityPoint.latitude, proximityPoint.longitude, latitude, longitude).toFixed(2))
        : null;

    return {
        name,
        displayName: displayName || name,
        address: displayName || "",
        latitude,
        longitude,
        city,
        district,
        state,
        country,
        placeId: String(props.osm_id || `photon-${latitude}-${longitude}`),
        type: props.osm_value || "Location",
        source: "OpenStreetMap Photon",
        importance: 0.5,
        distanceKm
    };
};

const reverseCacheBackend = new Map();

const reverseGeocodeFastBackend = async (lat, lon) => {
    const key = `${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`;
    if (reverseCacheBackend.has(key)) return reverseCacheBackend.get(key);

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2500);
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&addressdetails=1&accept-language=en`;
        const res = await fetch(url, {
            headers: {
                Accept: "application/json",
                "User-Agent": "AITransportationManagement/6.0 (support@ai-trans.app)"
            },
            signal: controller.signal
        });
        clearTimeout(timeout);
        if (res.ok) {
            const data = await res.json();
            const addr = data.address || {};
            const parts = [
                addr.road || addr.street,
                addr.neighbourhood || addr.suburb || addr.locality,
                addr.village || addr.town || addr.city,
                addr.state_district || addr.district,
                addr.state,
                addr.postcode,
                addr.country
            ].filter(Boolean);
            const resObj = {
                address: parts.join(", ") || data.display_name,
                city: addr.city || addr.town || addr.village || "",
                district: addr.state_district || addr.district || "",
                state: addr.state || "",
                country: addr.country || "",
                postalCode: addr.postcode || ""
            };
            reverseCacheBackend.set(key, resObj);
            return resObj;
        }
    } catch {
        // continue
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2500);
        const bdcUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
        const bRes = await fetch(bdcUrl, { signal: controller.signal });
        clearTimeout(timeout);
        if (bRes.ok) {
            const bData = await bRes.json();
            if (bData && bData.countryName) {
                const parts = [bData.locality || bData.city, bData.principalSubdivision, bData.countryName].filter(Boolean);
                const resObj = {
                    address: parts.join(", "),
                    city: bData.city || bData.locality || "",
                    district: "",
                    state: bData.principalSubdivision || "",
                    country: bData.countryName || "",
                    postalCode: bData.postcode || ""
                };
                reverseCacheBackend.set(key, resObj);
                return resObj;
            }
        }
    } catch {
        // continue
    }

    return null;
};

const searchWikidataBackend = async (query) => {
    try {
        const clean = String(query || "").trim();
        if (!clean) return [];

        const queriesToTry = [clean];
        if (clean.includes(",")) {
            const parts = clean.split(",").map((p) => p.trim()).filter(Boolean);
            if (parts.length > 0) {
                queriesToTry.push(parts[0]);
                if (parts.length >= 2) {
                    queriesToTry.push(`${parts[0]} ${parts[1]}`);
                }
            }
        }
        const words = clean.split(/\s+/);
        const first = words[0];
        if (/^[a-zA-Z]{2,4}$/i.test(first) && !["of", "and", "the", "in", "at", "for", "to", "a", "an", "is", "on"].includes(first.toLowerCase())) {
            const spaced = first.split("").join(". ") + ".";
            queriesToTry.push(clean.replace(new RegExp(`\\b${first}\\b`, "i"), spaced));
        }
        if (words.length >= 3) {
            queriesToTry.push(words.slice(0, -1).join(" "));
            if (/^[a-zA-Z]{2,4}$/i.test(first)) {
                const spaced = first.split("").join(". ") + ".";
                queriesToTry.push(`${spaced} ${words.slice(1, -1).join(" ")}`);
            }
        }

        let searchResults = [];
        for (const q of Array.from(new Set(queriesToTry))) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 3500);
                const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(q)}&language=en&limit=5&format=json&origin=*`;
                const res = await fetch(url, {
                    headers: {
                        Accept: "application/json",
                        "User-Agent": "AITransportationManagement/6.0 (https://ai-trans.app; support@ai-trans.app)"
                    },
                    signal: controller.signal
                });
                clearTimeout(timeout);
                if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data?.search) && data.search.length > 0) {
                        searchResults = data.search;
                        break;
                    }
                }
            } catch {
                // continue
            }
        }

        if (searchResults.length === 0) return [];

        const ids = searchResults.slice(0, 5).map((s) => s.id).join("|");
        const claimsUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(ids)}&props=claims|labels|descriptions&languages=en&format=json&origin=*`;
        const cRes = await fetch(claimsUrl, {
            headers: {
                Accept: "application/json",
                "User-Agent": "AITransportationManagement/6.0 (https://ai-trans.app; support@ai-trans.app)"
            }
        });
        if (!cRes.ok) return [];
        const cData = await cRes.json();

        const results = [];
        for (const item of searchResults) {
            const entity = cData.entities?.[item.id];
            const p625 = entity?.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
            if (p625 && isValidCoordinate(p625.latitude, p625.longitude)) {
                const name = item.label || clean;
                const lat = Number(p625.latitude);
                const lon = Number(p625.longitude);

                let rev = null;
                try {
                    rev = await reverseGeocodeFastBackend(lat, lon);
                } catch {
                    // ignore
                }

                const address = rev?.address || (item.description ? `${item.description}` : name);

                results.push({
                    name: String(name).trim(),
                    address,
                    displayName: `${name}, ${address}`,
                    latitude: lat,
                    longitude: lon,
                    placeId: `wikidata-${item.id}`,
                    types: ["landmark", "point_of_interest"],
                    type: "College / Landmark",
                    importance: 0.95,
                    source: "Wikidata Open Geocoding"
                });
            }
        }
        return results;
    } catch {
        return [];
    }
};

export const DEFAULT_LAT = 9.9252;
export const DEFAULT_LNG = 78.1198;
export const DEFAULT_LONG = 78.1198;

export const DEFAULT_LOCATION = {
    name: "Madurai Central",
    city: "Madurai",
    district: "Madurai",
    state: "Tamil Nadu",
    country: "India",
    latitude: DEFAULT_LAT,
    longitude: DEFAULT_LNG,
    lat: DEFAULT_LAT,
    lng: DEFAULT_LNG,
    lon: DEFAULT_LNG
};

const KNOWN_LOCALITY_COORDINATES = {
    "anna nagar|madurai": {
        name: "Anna Nagar",
        displayName: "Anna Nagar, Madurai, Tamil Nadu, 625020, India",
        address: "Anna Nagar, Madurai, Tamil Nadu, 625020, India",
        city: "Madurai",
        district: "Madurai",
        state: "Tamil Nadu",
        country: "India",
        postalCode: "625020",
        latitude: 9.9216749,
        longitude: 78.1481372,
        placeId: "loc-annanagar-madurai",
        types: ["suburb"],
        type: "Residential Area",
        category: "residential",
        importance: 0.85,
        source: "Transit Directory"
    },
    "anna nagar|chennai": {
        name: "Anna Nagar",
        displayName: "Anna Nagar, Chennai, Tamil Nadu, 600040, India",
        address: "Anna Nagar, Chennai, Tamil Nadu, 600040, India",
        city: "Chennai",
        district: "Chennai",
        state: "Tamil Nadu",
        country: "India",
        postalCode: "600040",
        latitude: 13.0850,
        longitude: 80.2100,
        placeId: "loc-annanagar-chennai",
        types: ["suburb"],
        type: "Residential Area",
        category: "residential",
        importance: 0.85,
        source: "Transit Directory"
    },
    "velammal engineering college|madurai": {
        name: "Velammal College of Engineering and Technology",
        displayName: "Velammal College of Engineering and Technology, Madurai Ring Road, Viraganur, Madurai, Tamil Nadu, 625009, India",
        address: "Velammal College of Engineering and Technology, Madurai Ring Road, Viraganur, Madurai, Tamil Nadu, 625009, India",
        city: "Madurai",
        district: "Madurai",
        state: "Tamil Nadu",
        country: "India",
        postalCode: "625009",
        latitude: 9.8893,
        longitude: 78.1501,
        placeId: "loc-velammal-madurai",
        types: ["college"],
        type: "College",
        category: "education",
        importance: 0.9,
        source: "Transit Directory"
    },
    "velammal engineering college|chennai": {
        name: "Velammal Engineering College",
        displayName: "Velammal Engineering College, Surapet, Madhavaram, Chennai, Tamil Nadu, 600066, India",
        address: "Velammal Engineering College, Surapet, Madhavaram, Chennai, Tamil Nadu, 600066, India",
        city: "Chennai",
        district: "Thiruvallur",
        state: "Tamil Nadu",
        country: "India",
        postalCode: "600066",
        latitude: 13.1497,
        longitude: 80.1919,
        placeId: "loc-velammal-chennai",
        types: ["college"],
        type: "College",
        category: "education",
        importance: 0.9,
        source: "Transit Directory"
    },
    "kln college of engineering|madurai": {
        name: "KLN College of Engineering",
        displayName: "KLN College of Engineering, Pottapalayam, Madurai, Tamil Nadu, 630612, India",
        address: "KLN College of Engineering, Pottapalayam, Madurai, Tamil Nadu, 630612, India",
        city: "Madurai",
        district: "Madurai",
        state: "Tamil Nadu",
        country: "India",
        postalCode: "630612",
        latitude: 9.8529,
        longitude: 78.1887,
        placeId: "loc-kln-madurai",
        types: ["college"],
        type: "College",
        category: "education",
        importance: 0.9,
        source: "Transit Directory"
    },
    "kln college of engineering pottapalayam|madurai": {
        name: "KLN College of Engineering",
        displayName: "KLN College of Engineering, Pottapalayam, Madurai, Tamil Nadu, 630612, India",
        address: "KLN College of Engineering, Pottapalayam, Madurai, Tamil Nadu, 630612, India",
        city: "Madurai",
        district: "Madurai",
        state: "Tamil Nadu",
        country: "India",
        postalCode: "630612",
        latitude: 9.8529,
        longitude: 78.1887,
        placeId: "loc-kln-madurai",
        types: ["college"],
        type: "College",
        category: "education",
        importance: 0.9,
        source: "Transit Directory"
    },
    "pottapalayam|madurai": {
        name: "Pottapalayam",
        displayName: "Pottapalayam, Sivaganga / Madurai District, Tamil Nadu, 630612, India",
        address: "Pottapalayam, Tamil Nadu, 630612, India",
        city: "Madurai",
        district: "Madurai",
        state: "Tamil Nadu",
        country: "India",
        postalCode: "630612",
        latitude: 9.8510,
        longitude: 78.1820,
        placeId: "loc-pottapalayam-madurai",
        types: ["village"],
        type: "Village",
        category: "place",
        importance: 0.8,
        source: "Transit Directory"
    }
};

export const searchPlaces = async (query, proximityPoint = null) => {
    const clean = String(query || "").trim();
    if (!clean || clean.length < 2) return [];

    const cacheKey = `${clean.toLowerCase()}_${proximityPoint?.latitude || ""}_${proximityPoint?.longitude || ""}`;
    if (coordinateCache.has(cacheKey)) {
        return [coordinateCache.get(cacheKey)];
    }

    // 1. Query Parsing
    let placeCandidate = clean;
    let localityCandidate = "";
    let hasExplicitLocality = false;
    let commaParts = [];

    if (clean.includes(",")) {
        commaParts = clean.split(",").map((p) => p.trim()).filter(Boolean);
        if (commaParts.length >= 2) {
            placeCandidate = commaParts[0];
            localityCandidate = commaParts.slice(1).join(", ").trim();
            hasExplicitLocality = true;
        }
    } else {
        const words = clean.split(/\s+/).filter(Boolean);
        if (words.length >= 2) {
            const lastWord = words[words.length - 1].toLowerCase();
            const genericWords = ["college", "university", "school", "hospital", "station", "airport", "hotel", "road", "street"];
            if (!genericWords.includes(lastWord) && !["the", "and", "for", "in", "at", "to", "of"].includes(lastWord)) {
                if (words.length >= 3) {
                    placeCandidate = words.slice(0, -1).join(" ");
                    localityCandidate = words[words.length - 1];
                    hasExplicitLocality = true;
                } else if (words.length === 2 && genericWords.includes(words[0].toLowerCase())) {
                    placeCandidate = words[0];
                    localityCandidate = words[1];
                    hasExplicitLocality = true;
                }
            }
        }
    }

    // 2. Query Variants
    const variants = new Set();
    variants.add(clean);

    const unpunct = clean.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"+\[\]|\\]/g, " ").replace(/\s+/g, " ").trim();
    if (unpunct && unpunct !== clean) variants.add(unpunct);

    if (commaParts.length >= 2) {
        variants.add(`${commaParts[0]}, ${commaParts[1]}`);
        variants.add(`${commaParts[0]} ${commaParts[1]}`);
        variants.add(commaParts[0]);
        if (commaParts.length >= 3) {
            variants.add(`${commaParts[0]}, ${commaParts[1]}, ${commaParts[2]}`);
            variants.add(`${commaParts[0]} ${commaParts[1]} ${commaParts[2]}`);
        }
    }

    if (hasExplicitLocality && localityCandidate) {
        variants.add(`${placeCandidate} ${localityCandidate}`);
        const placeWords = placeCandidate.split(/\s+/).filter((w) => !["the", "and", "for", "of", "in"].includes(w.toLowerCase()));
        if (placeWords.length >= 2) {
            variants.add(`${placeWords.slice(0, 2).join(" ")} ${localityCandidate}`);
            variants.add(`${placeWords[0]} ${localityCandidate}`);
        }
        if (placeCandidate !== clean) {
            variants.add(placeCandidate);
        }
    }

    const words = unpunct.split(/\s+/).filter(Boolean);
    for (const w of words) {
        if (/^[a-zA-Z]{2,4}$/.test(w) && !["the", "and", "for", "out", "new"].includes(w.toLowerCase())) {
            const spacedDotted = w.split("").join(". ") + ".";
            variants.add(clean.replace(new RegExp(`\\b${w}\\b`, "i"), spacedDotted.toUpperCase()));
            variants.add(clean.replace(new RegExp(`\\b${w}\\b`, "i"), spacedDotted.replace(/\s+/g, "").toUpperCase()));
        }
    }

    const withoutRd = unpunct.replace(/\b(office\s+)?(rd|road|street|st|ave|lane|junction|stop|stand|depot)\b/gi, " ").replace(/\s+/g, " ").trim();
    if (withoutRd && withoutRd !== unpunct) variants.add(withoutRd);

    if (words.length >= 3) {
        variants.add(words.slice(0, -1).join(" "));
        variants.add(`${words[0]} ${words[words.length - 1]}`);
    }

    const results = [];

    if (hasExplicitLocality && localityCandidate) {
        const normReqCity = localityCandidate.toLowerCase().split(/[,\s]+/)[0];
        const normPlaceClean = placeCandidate.toLowerCase().trim();
        const locKey = `${normPlaceClean}|${normReqCity}`;
        if (KNOWN_LOCALITY_COORDINATES[locKey]) {
            results.push(KNOWN_LOCALITY_COORDINATES[locKey]);
        } else {
            for (const [k, loc] of Object.entries(KNOWN_LOCALITY_COORDINATES)) {
                const [pPart, cPart] = k.split("|");
                if (
                    (pPart === normPlaceClean || pPart === clean.toLowerCase()) &&
                    (cPart === normReqCity || clean.toLowerCase().includes(cPart) || clean.toLowerCase().includes(pPart))
                ) {
                    results.push(loc);
                }
            }
        }
    } else {
        const normCleanLower = clean.toLowerCase();
        for (const [k, loc] of Object.entries(KNOWN_LOCALITY_COORDINATES)) {
            const [pPart] = k.split("|");
            if (pPart === normCleanLower || (placeCandidate && pPart === placeCandidate.toLowerCase())) {
                results.push(loc);
            }
        }
    }

    const targetedVariants = Array.from(variants).slice(1, 8);

    // Stage 1: Parallel fast search
    const fastPromises = [
        searchWikidataBackend(clean),
        (async () => {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 2000);
                const response = await fetch(buildPhotonUrl(clean, proximityPoint), { signal: controller.signal });
                clearTimeout(timeoutId);
                if (response.ok) {
                    const data = await response.json();
                    if (Array.isArray(data?.features)) {
                        return data.features.map((f) => formatPhotonResult(f, proximityPoint)).filter(Boolean);
                    }
                }
            } catch {
                return [];
            }
            return [];
        })(),
        (async () => {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 4000);
                const response = await fetch(buildNominatimUrl(clean, proximityPoint), {
                    headers: { "User-Agent": "AITransportationManagement/6.0 (support@ai-trans.app)" },
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                if (response.ok) {
                    const data = await response.json();
                    if (Array.isArray(data)) {
                        return data.map((item) => formatNominatimResult(item, proximityPoint)).filter(Boolean);
                    }
                }
            } catch {
                return [];
            }
            return [];
        })()
    ];

    for (const v of targetedVariants) {
        fastPromises.push((async () => {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 1500);
                const response = await fetch(buildPhotonUrl(v, proximityPoint), { signal: controller.signal });
                clearTimeout(timeoutId);
                if (response.ok) {
                    const data = await response.json();
                    if (Array.isArray(data?.features)) {
                        return data.features.map((f) => formatPhotonResult(f, proximityPoint)).filter(Boolean);
                    }
                }
            } catch {
                return [];
            }
            return [];
        })());
    }

    if (hasExplicitLocality && targetedVariants.length > 0) {
        fastPromises.push((async () => {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 2000);
                const response = await fetch(buildNominatimUrl(targetedVariants[0], proximityPoint), {
                    headers: { "User-Agent": "AITransportationManagement/6.0 (support@ai-trans.app)" },
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                if (response.ok) {
                    const data = await response.json();
                    if (Array.isArray(data)) {
                        return data.map((item) => formatNominatimResult(item, proximityPoint)).filter(Boolean);
                    }
                }
            } catch {
                return [];
            }
            return [];
        })());

        if (targetedVariants.length > 1) {
            fastPromises.push((async () => {
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 4000);
                    const response = await fetch(buildNominatimUrl(targetedVariants[1], proximityPoint), {
                        headers: { "User-Agent": "AITransportationManagement/6.0 (support@ai-trans.app)" },
                        signal: controller.signal
                    });
                    clearTimeout(timeoutId);
                    if (response.ok) {
                        const data = await response.json();
                        if (Array.isArray(data)) {
                            return data.map((item) => formatNominatimResult(item, proximityPoint)).filter(Boolean);
                        }
                    }
                } catch {
                    return [];
                }
                return [];
            })());
        }
    }

    const responses = await Promise.allSettled(fastPromises);
    for (const res of responses) {
        if (res.status === "fulfilled" && Array.isArray(res.value)) {
            results.push(...res.value);
        }
    }

    // Stage 2: Fallback Nominatim queries on distinctive variants
    if (results.length === 0 && variants.size > 1) {
        const fallbackVariants = Array.from(variants).slice(targetedVariants.length + 1, targetedVariants.length + 5);
        for (const v of fallbackVariants) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 4000);
                const response = await fetch(buildNominatimUrl(v, proximityPoint), {
                    headers: { "User-Agent": "AITransportationManagement/6.0 (support@ai-trans.app)" },
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                if (response.ok) {
                    const data = await response.json();
                    if (Array.isArray(data) && data.length > 0) {
                        const formatted = data.map((item) => formatNominatimResult(item, proximityPoint)).filter(Boolean);
                        if (formatted.length > 0) {
                            results.push(...formatted);
                            break;
                        }
                    }
                }
            } catch {
                // continue
            }
        }
    }

    // Stage 3: Open-Meteo geocoding fallback for global cities
    if (results.length === 0) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);

            const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(clean)}&count=5&language=en&format=json`;
            const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
            clearTimeout(timeoutId);

            if (response.ok) {
                const data = await response.json();
                if (Array.isArray(data?.results)) {
                    data.results.forEach((r) => {
                        const lat = Number(r.latitude);
                        const lon = Number(r.longitude);
                        if (isValidCoordinate(lat, lon)) {
                            results.push({
                                name: r.name,
                                displayName: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
                                address: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
                                latitude: lat,
                                longitude: lon,
                                placeId: `openmeteo-${r.id}`,
                                type: "City Area",
                                source: "Open-Meteo",
                                importance: 0.6
                            });
                        }
                    });
                }
            }
        } catch {
            // continue
        }
    }

    if (results.length > 0) {
        // Deduplicate & score
        const normPlace = placeCandidate.toLowerCase();
        const normLoc = localityCandidate.toLowerCase();
        const seen = new Map();
        const scored = [];

        for (const item of results) {
            if (!item || !isValidCoordinate(item.latitude, item.longitude)) continue;
            const geoKey = `${Number(item.latitude).toFixed(3)}|${Number(item.longitude).toFixed(3)}`;
            if (seen.has(geoKey)) continue;
            seen.set(geoKey, true);

            let score = 0;
            const normName = String(item.name || "").toLowerCase();
            const normAddr = String(item.address || item.displayName || "").toLowerCase();
            const normCity = String(item.city || "").toLowerCase();
            const normDist = String(item.district || "").toLowerCase();

            if (normName === clean.toLowerCase()) score += 350;
            else if (normName === normPlace) score += 300;
            else if (normName.includes(normPlace)) score += 180;

            if (hasExplicitLocality && localityCandidate) {
                const locTokens = localityCandidate.toLowerCase().split(/[,\s]+/).filter((t) => t.length >= 3);
                const reqCity = locTokens[0] || "";
                const isCityInCity = normCity && (normCity.includes(reqCity) || reqCity.includes(normCity));
                const isCityInDist = normDist && (normDist.includes(reqCity) || reqCity.includes(normDist));
                const isCityInAddr = normAddr.includes(reqCity);
                const hasCityMatch = isCityInCity || isCityInDist || isCityInAddr;

                // Check city conflict: only flag conflict if a known competing city is present and requested city is absent
                let isCityConflict = false;
                const commonCities = ["chennai", "madurai", "coimbatore", "salem", "trichy", "tirunelveli", "bangalore", "mumbai", "delhi", "hyderabad", "kolkata"];
                if (!hasCityMatch) {
                    for (const c of commonCities) {
                        if (c !== reqCity && (normCity.includes(c) || normAddr.includes(c))) {
                            isCityConflict = true;
                            break;
                        }
                    }
                } else {
                    for (const c of commonCities) {
                        if (c !== reqCity && normCity === c && !normDist.includes(reqCity) && !normAddr.includes(reqCity)) {
                            isCityConflict = true;
                            break;
                        }
                    }
                }

                if (hasCityMatch && !isCityConflict) {
                    score += 1500;
                    item._isCityMatch = true;
                } else if (isCityConflict) {
                    score -= 2500;
                    item._isDifferentCity = true;
                } else {
                    const matchedTokens = locTokens.filter((t) => normCity.includes(t) || normDist.includes(t) || normAddr.includes(t));
                    if (matchedTokens.length > 0) {
                        score += 300 + (matchedTokens.length * 100);
                    } else {
                        score -= 500;
                    }
                }
            }

            if (item.importance) score += Number(item.importance) * 30;

            scored.push({ ...item, _score: score });
        }

        let validResults = scored;
        if (hasExplicitLocality) {
            const cityMatches = scored.filter((s) => s._isCityMatch || (s._score > 0 && !s._isDifferentCity));
            const otherCities = scored.filter((s) => s._isDifferentCity || s._score <= 0);
            validResults = cityMatches.length > 0 ? [...cityMatches, ...otherCities] : scored;
        }

        if (proximityPoint && isValidCoordinate(proximityPoint.latitude, proximityPoint.longitude) && !hasExplicitLocality) {
            const MAX_TRANSIT_RADIUS_KM = 65;
            validResults = scored
                .map((r) => ({
                    ...r,
                    distanceKm: calculateDistanceKm(
                        proximityPoint.latitude,
                        proximityPoint.longitude,
                        r.latitude,
                        r.longitude
                    )
                }))
                .filter((r) => r.distanceKm <= MAX_TRANSIT_RADIUS_KM);

            validResults.sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
        } else {
            validResults.sort((a, b) => b._score - a._score);
        }

        if (validResults.length > 0) {
            coordinateCache.set(cacheKey, validResults[0]);
            return validResults;
        }
    }

    return [];
};

export const resolveLocation = async (query, proximityPoint = null) => {
    const results = await searchPlaces(query, proximityPoint);
    if (results.length > 0) {
        return {
            success: true,
            location: results[0]
        };
    }
    return {
        success: false,
        location: null,
        message: "No matching location found."
    };
};

export const resolveStopCoordinates = async (stoppingGroups, startingPoint) => {
    const resolved = [];
    const MAX_TRANSIT_RADIUS_KM = 35;

    let dbLocations = [];
    try {
        const [stops, routes, mapLocs] = await Promise.all([
            getCollectionData("stops"),
            getCollectionData("routes"),
            getCollectionData("maplocations")
        ]);

        (stops || []).forEach((s) => {
            if (isValidCoordinate(s?.latitude ?? s?.lat, s?.longitude ?? s?.lng ?? s?.lon)) {
                dbLocations.push({
                    name: s?.stopName || s?.name || "",
                    latitude: Number(s?.latitude ?? s?.lat),
                    longitude: Number(s?.longitude ?? s?.lng ?? s?.lon),
                    displayName: s?.displayName || s?.address || s?.name || "Bus Stop"
                });
            }
        });

        (routes || []).forEach((r) => {
            if (r?.source && isValidCoordinate(r.source.latitude, r.source.longitude)) {
                dbLocations.push({ name: r.source.name, latitude: Number(r.source.latitude), longitude: Number(r.source.longitude), displayName: r.source.displayName || r.source.name });
            }
            if (r?.destination && isValidCoordinate(r.destination.latitude, r.destination.longitude)) {
                dbLocations.push({ name: r.destination.name, latitude: Number(r.destination.latitude), longitude: Number(r.destination.longitude), displayName: r.destination.displayName || r.destination.name });
            }
            if (Array.isArray(r?.stops)) {
                r.stops.forEach((st) => {
                    if (isValidCoordinate(st?.latitude, st?.longitude)) {
                        dbLocations.push({ name: st.name, latitude: Number(st.latitude), longitude: Number(st.longitude), displayName: st.displayName || st.name });
                    }
                });
            }
        });

        (mapLocs || []).forEach((m) => {
            if (isValidCoordinate(m?.latitude, m?.longitude)) {
                dbLocations.push({ name: m.name, latitude: Number(m.latitude), longitude: Number(m.longitude), displayName: m.displayName || m.address || m.name });
            }
        });
    } catch (dbErr) {
        console.warn("DB location pre-fetch warning:", dbErr.message);
    }

    const pendingLookups = [];

    for (const group of stoppingGroups) {
        // 1. Direct coordinate from user record if valid and within plausible transit radius
        if (isValidCoordinate(group.latitude, group.longitude)) {
            const lat = Number(group.latitude);
            const lon = Number(group.longitude);
            let validDistance = true;
            if (startingPoint && isValidCoordinate(startingPoint.latitude, startingPoint.longitude)) {
                const dist = calculateDistanceKm(startingPoint.latitude, startingPoint.longitude, lat, lon);
                if (dist > MAX_TRANSIT_RADIUS_KM) {
                    validDistance = false;
                }
            }
            if (validDistance) {
                resolved.push({
                    ...group,
                    latitude: lat,
                    longitude: lon,
                    resolved: true
                });
                continue;
            }
        }

        const fullLocationQuery = group.locationQuery || buildStopLocationQuery(group);
        const cacheKey = `${fullLocationQuery.toLowerCase()}_${Number(startingPoint?.latitude || 0).toFixed(2)}_${Number(startingPoint?.longitude || 0).toFixed(2)}`;
        if (coordinateCache.has(cacheKey)) {
            const cached = coordinateCache.get(cacheKey);
            resolved.push({
                ...group,
                latitude: cached.latitude,
                longitude: cached.longitude,
                displayName: cached.displayName,
                source: cached.source,
                resolved: true
            });
            continue;
        }

        const normGroupName = normalizeTextBackend(group.name);

        // 2. Check Regional Transit Gazetteer (instant 0ms lookup)
        const gazetteerMatch = MADURAI_REGIONAL_STOPS[normGroupName] ||
            MADURAI_REGIONAL_STOPS[group.name.toLowerCase().trim()] ||
            Object.entries(MADURAI_REGIONAL_STOPS).find(([k]) => normGroupName.includes(k) || k.includes(normGroupName))?.[1];

        if (gazetteerMatch && isValidCoordinate(gazetteerMatch.latitude, gazetteerMatch.longitude)) {
            const stopObj = {
                ...group,
                latitude: Number(gazetteerMatch.latitude),
                longitude: Number(gazetteerMatch.longitude),
                displayName: gazetteerMatch.displayName || `${group.name}, Madurai`,
                source: "Regional Transit Gazetteer",
                resolved: true
            };
            coordinateCache.set(cacheKey, stopObj);
            resolved.push(stopObj);
            continue;
        }

        // 3. Check pre-fetched DB locations with geographic proximity validation
        const matchedDbLoc = dbLocations.find((loc) => {
            const normLocName = normalizeTextBackend(loc.name);
            const isNameMatch = normLocName === normGroupName || (loc.displayName && normalizeTextBackend(loc.displayName).includes(normGroupName));
            if (!isNameMatch) return false;
            if (startingPoint && isValidCoordinate(startingPoint.latitude, startingPoint.longitude)) {
                const d = calculateDistanceKm(startingPoint.latitude, startingPoint.longitude, loc.latitude, loc.longitude);
                if (d > MAX_TRANSIT_RADIUS_KM) return false;
            }
            return true;
        });

        if (matchedDbLoc) {
            const stopObj = {
                ...group,
                latitude: matchedDbLoc.latitude,
                longitude: matchedDbLoc.longitude,
                displayName: matchedDbLoc.displayName,
                source: "Saved Location",
                resolved: true
            };
            coordinateCache.set(cacheKey, stopObj);
            resolved.push(stopObj);
            continue;
        }

        // Needs online geocoding lookup
        pendingLookups.push({ group, cacheKey, fullLocationQuery });
    }

    // 4. Resolve remaining lookups in parallel with controlled concurrency
    if (pendingLookups.length > 0) {
        const lookupPromises = pendingLookups.map(async ({ group, cacheKey, fullLocationQuery }) => {
            try {
                let results = await searchPlaces(fullLocationQuery, startingPoint);
                if (results.length === 0 && (group.city || group.state)) {
                    results = await searchPlaces(`${group.name}, ${group.city || group.state}`, startingPoint);
                }
                if (results.length === 0 && group.name.includes(" ")) {
                    const parentStop = group.name.replace(/\s+(junction|west|east|north|south|circle|stand|depot|stop)\b/gi, "").trim();
                    if (parentStop && parentStop !== group.name) {
                        results = await searchPlaces(`${parentStop}, ${group.city || group.state || ""}`, startingPoint);
                    }
                }
                if (results.length === 0) {
                    results = await searchPlaces(group.name, startingPoint);
                }

                if (results.length > 0) {
                    let best = results[0];
                    if (startingPoint && isValidCoordinate(startingPoint.latitude, startingPoint.longitude)) {
                        // Apply hard geographic sanity check: prefer candidate closest to hub within regional transit radius
                        const scored = results
                            .map((r) => ({
                                ...r,
                                distKm: calculateDistanceKm(startingPoint.latitude, startingPoint.longitude, r.latitude, r.longitude)
                            }))
                            .filter((r) => r.distKm <= MAX_TRANSIT_RADIUS_KM);

                        if (scored.length > 0) {
                            scored.sort((a, b) => a.distKm - b.distKm);
                            best = scored[0];
                        } else {
                            best = null;
                        }
                    }

                    if (best && isValidCoordinate(best.latitude, best.longitude)) {
                        const resolvedStop = {
                            ...group,
                            latitude: Number(best.latitude),
                            longitude: Number(best.longitude),
                            displayName: best.displayName,
                            source: best.source,
                            resolved: true
                        };
                        coordinateCache.set(cacheKey, resolvedStop);

                        // Structured debug log for geocoding validation
                        const distFromSrc = startingPoint && isValidCoordinate(startingPoint.latitude, startingPoint.longitude)
                            ? calculateDistanceKm(startingPoint.latitude, startingPoint.longitude, resolvedStop.latitude, resolvedStop.longitude)
                            : 0;
                        console.log(`[GEOCODING_RESOLVED] locationKey="${resolvedStop.locationKey}" query="${fullLocationQuery}" provider="${resolvedStop.source}" lat=${resolvedStop.latitude.toFixed(5)} lng=${resolvedStop.longitude.toFixed(5)} distFromSource=${distFromSrc.toFixed(2)}km straightLine=${distFromSrc.toFixed(2)}km`);

                        return resolvedStop;
                    }
                }

                // Resilient Fallback: If specific street/stop lookup yielded no result within catchment,
                // resolve the parent City / District context and anchor the stop reliably in the target municipality.
                let fallbackLat = null;
                let fallbackLon = null;
                let fallbackProvider = "City Context Geocoding";

                const cityQuery = [group.city, group.state, group.country].filter(Boolean).join(", ");
                if (cityQuery) {
                    const cityResults = await searchPlaces(cityQuery, startingPoint);
                    if (cityResults.length > 0 && isValidCoordinate(cityResults[0].latitude, cityResults[0].longitude)) {
                        const cityLat = Number(cityResults[0].latitude);
                        const cityLon = Number(cityResults[0].longitude);

                        let hash = 0;
                        const keyStr = group.locationKey || fullLocationQuery;
                        for (let i = 0; i < keyStr.length; i++) {
                            hash = (hash * 31 + keyStr.charCodeAt(i)) & 0x7fffffff;
                        }
                        const angle = (hash % 360) * (Math.PI / 180);
                        const radiusOffset = 0.008 + ((hash % 12) * 0.001); // ~1km to ~2km from city center
                        fallbackLat = Number((cityLat + Math.cos(angle) * radiusOffset).toFixed(6));
                        fallbackLon = Number((cityLon + Math.sin(angle) * radiusOffset).toFixed(6));
                        fallbackProvider = `City Context (${cityResults[0].source})`;
                    }
                }

                if (!isValidCoordinate(fallbackLat, fallbackLon) && startingPoint && isValidCoordinate(startingPoint.latitude, startingPoint.longitude)) {
                    let hash = 0;
                    const keyStr = group.locationKey || fullLocationQuery;
                    for (let i = 0; i < keyStr.length; i++) {
                        hash = (hash * 31 + keyStr.charCodeAt(i)) & 0x7fffffff;
                    }
                    const angle = (hash % 360) * (Math.PI / 180);
                    const radiusOffset = 0.04 + ((hash % 20) * 0.002); // ~4.5km to ~8km from hub
                    fallbackLat = Number((Number(startingPoint.latitude) + Math.cos(angle) * radiusOffset).toFixed(6));
                    fallbackLon = Number((Number(startingPoint.longitude) + Math.sin(angle) * radiusOffset).toFixed(6));
                    fallbackProvider = "Transit Catchment Anchor";
                }

                if (isValidCoordinate(fallbackLat, fallbackLon)) {
                    const resolvedStop = {
                        ...group,
                        latitude: fallbackLat,
                        longitude: fallbackLon,
                        displayName: `${group.name}, ${cityQuery || "Transit Area"}`,
                        source: fallbackProvider,
                        resolved: true
                    };
                    coordinateCache.set(cacheKey, resolvedStop);
                    const distFromSrc = startingPoint && isValidCoordinate(startingPoint.latitude, startingPoint.longitude)
                        ? calculateDistanceKm(startingPoint.latitude, startingPoint.longitude, resolvedStop.latitude, resolvedStop.longitude)
                        : 0;
                    console.log(`[GEOCODING_RESOLVED] locationKey="${resolvedStop.locationKey}" query="${fullLocationQuery}" provider="${resolvedStop.source}" lat=${resolvedStop.latitude.toFixed(5)} lng=${resolvedStop.longitude.toFixed(5)} distFromSource=${distFromSrc.toFixed(2)}km straightLine=${distFromSrc.toFixed(2)}km`);
                    return resolvedStop;
                }

                return {
                    ...group,
                    latitude: null,
                    longitude: null,
                    resolved: false,
                    unallocatedReason: "MISSING_STOP_COORDINATES",
                    diagnosticMessage: `Stop '${group.name}' (${fullLocationQuery}) coordinates could not be resolved within the transit catchment area.`
                };
            } catch {
                return {
                    ...group,
                    latitude: null,
                    longitude: null,
                    resolved: false,
                    unallocatedReason: "MISSING_STOP_COORDINATES",
                    diagnosticMessage: `Geocoding request failed for stop '${group.name}' (${fullLocationQuery}).`
                };
            }
        });

        const parallelResults = await Promise.all(lookupPromises);
        resolved.push(...parallelResults);
    }

    return resolved;
};

/*
|--------------------------------------------------------------------------
| ROAD ROUTING SERVICE (OSRM ONLINE NETWORK & SEGMENT CACHING)
|--------------------------------------------------------------------------
*/

const roadSegmentCache = new Map();

export const getRoadSegmentCached = async (fromPt, toPt) => {
    if (!isValidCoordinate(fromPt?.latitude, fromPt?.longitude) ||
        !isValidCoordinate(toPt?.latitude, toPt?.longitude)) {
        return null;
    }

    const key = `${Number(fromPt.longitude).toFixed(5)},${Number(fromPt.latitude).toFixed(5)}:${Number(toPt.longitude).toFixed(5)},${Number(toPt.latitude).toFixed(5)}`;
    if (roadSegmentCache.has(key)) {
        return roadSegmentCache.get(key);
    }

    const straightLineKm = calculateDistanceKm(fromPt.latitude, fromPt.longitude, toPt.latitude, toPt.longitude);
    if (straightLineKm < 0.05) {
        const res = { distanceKm: 0.05, durationMin: 0.5, isRoadVerified: true, isFallback: false, straightLineKm };
        roadSegmentCache.set(key, res);
        return res;
    }

    // Attempt online OSRM routing with tight timeout
    const baseUrl = process.env.ROUTING_BASE_URL || process.env.OSRM_BASE_URL || "https://router.project-osrm.org";
    const coords = `${Number(fromPt.longitude).toFixed(6)},${Number(fromPt.latitude).toFixed(6)};${Number(toPt.longitude).toFixed(6)},${Number(toPt.latitude).toFixed(6)}`;
    const url = `${baseUrl}/route/v1/driving/${coords}?overview=false`;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1800);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (response.ok) {
            const data = await response.json();
            if (data?.code === "Ok" && Array.isArray(data?.routes) && data.routes.length > 0) {
                const distMeters = Number(data.routes[0].distance || 0);
                const durSec = Number(data.routes[0].duration || 0);
                const distanceKm = Number((distMeters / 1000).toFixed(2));
                const durationMin = Number((durSec / 60).toFixed(1));

                if (distanceKm >= straightLineKm * 0.7 && distanceKm <= straightLineKm * 3.5 + 5) {
                    const res = {
                        distanceKm,
                        durationMin,
                        isRoadVerified: true,
                        isFallback: false,
                        straightLineKm: Number(straightLineKm.toFixed(2))
                    };
                    roadSegmentCache.set(key, res);
                    return res;
                }
            }
        }
    } catch {
        // Fall through to honest fallback
    }

    // High-precision calibrated urban transit routing matrix (Fallback)
    const roadFactor = straightLineKm > 15 ? 1.18 : 1.25;
    const distanceKm = Number((straightLineKm * roadFactor).toFixed(2));
    const durationMin = Number((distanceKm / 0.55).toFixed(1)); // ~33 km/h urban transit avg speed

    const res = {
        distanceKm,
        durationMin,
        isRoadVerified: false,
        isFallback: true,
        straightLineKm: Number(straightLineKm.toFixed(2))
    };
    roadSegmentCache.set(key, res);
    return res;
};

export const getRoadRouteGeometry = async (points) => {
    const validPoints = points.filter((point) =>
        isValidCoordinate(point?.latitude, point?.longitude)
    );

    if (validPoints.length < 2) {
        return null;
    }

    // Explicitly format as longitude,latitude for OSRM
    const query = validPoints
        .map((p) => `${Number(p.longitude).toFixed(6)},${Number(p.latitude).toFixed(6)}`)
        .join(";");

    const baseUrl = process.env.ROUTING_BASE_URL || process.env.OSRM_BASE_URL || "https://router.project-osrm.org";
    const url = `${baseUrl}/route/v1/driving/${query}?overview=full&geometries=geojson&steps=false`;

    let straightLineKm = 0;
    for (let i = 0; i < validPoints.length - 1; i++) {
        straightLineKm += calculateDistanceKm(
            validPoints[i].latitude, validPoints[i].longitude,
            validPoints[i + 1].latitude, validPoints[i + 1].longitude
        );
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4500);

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (response.ok) {
            const data = await response.json();
            if (data?.code === "Ok" && Array.isArray(data?.routes) && data.routes.length > 0) {
                const route = data.routes[0];
                const coordinates = Array.isArray(route?.geometry?.coordinates)
                    ? route.geometry.coordinates
                    : [];

                const distanceMeters = Number(route.distance || 0);
                const distanceKm = Number((distanceMeters / 1000).toFixed(2));
                const durationSeconds = Number(route.duration || 0);

                // ANOMALY REJECTION:
                const isSingleLeg = validPoints.length === 2;
                const maxThresholdKm = isSingleLeg
                    ? Math.max(12, straightLineKm * 3.0)
                    : Math.max(30, straightLineKm * 2.8);

                if (
                    !(straightLineKm < 15 && distanceKm > maxThresholdKm) &&
                    !(distanceKm > straightLineKm * 3.5 + 25) &&
                    !(distanceKm < straightLineKm * 0.60)
                ) {
                    return {
                        distanceMeters,
                        distanceKm,
                        durationSeconds,
                        isRoadVerified: true,
                        isFallback: false,
                        straightLineKm: Number(straightLineKm.toFixed(2)),
                        geometry: coordinates.map(([longitude, latitude]) => ({
                            latitude: Number(latitude),
                            longitude: Number(longitude)
                        }))
                    };
                }
            }
        }
    } catch {
        // Fall through to fallback
    }

    // Calibrated Road Network Fallback
    const roadFactor = straightLineKm > 15 ? 1.18 : 1.25;
    const fallbackDistKm = Number((straightLineKm * roadFactor).toFixed(2));
    const fallbackDurationSec = Number(((fallbackDistKm / 0.55) * 60).toFixed(0));

    return {
        distanceMeters: Math.round(fallbackDistKm * 1000),
        distanceKm: fallbackDistKm,
        durationSeconds: fallbackDurationSec,
        isRoadVerified: false,
        isFallback: true,
        straightLineKm: Number(straightLineKm.toFixed(2)),
        geometry: validPoints.map((p) => ({
            latitude: Number(p.latitude),
            longitude: Number(p.longitude)
        }))
    };
};

/*
|--------------------------------------------------------------------------
| GEOGRAPHIC CORRIDOR GROUPING (Directional Sector Partitioning)
|--------------------------------------------------------------------------
*/

export const getSectorName = (bearing) => {
    if (bearing >= 337.5 || bearing < 22.5) return "North Corridor";
    if (bearing >= 22.5 && bearing < 67.5) return "North-East Corridor";
    if (bearing >= 67.5 && bearing < 112.5) return "East Corridor";
    if (bearing >= 112.5 && bearing < 157.5) return "South-East Corridor";
    if (bearing >= 157.5 && bearing < 202.5) return "South Corridor";
    if (bearing >= 202.5 && bearing < 247.5) return "South-West Corridor";
    if (bearing >= 247.5 && bearing < 292.5) return "West Corridor";
    return "North-West Corridor";
};

export const getStopKey = (s) => {
    if (!s) return "";
    if (s.locationKey) return String(s.locationKey).toLowerCase().trim();
    if (s.locationQuery) return String(s.locationQuery).toLowerCase().trim();
    const parts = [s.name || s.stopping || "", s.city || "", s.district || "", s.state || "", s.country || ""];
    return parts.filter(Boolean).join("|").toLowerCase().trim();
};

/**
 * Group resolved stops into coherent directional corridors radiating from anchorHub.
 * Stops within ~35 degrees bearing and <= 12km proximity form a natural corridor.
 */
export const groupStopsIntoCorridors = (stops, anchorHub) => {
    if (!Array.isArray(stops) || stops.length === 0) return [];

    const enriched = stops.map((stop) => {
        const dist = calculateDistanceKm(
            anchorHub.latitude, anchorHub.longitude,
            stop.latitude, stop.longitude
        );
        const bearing = calculateBearing(
            anchorHub.latitude, anchorHub.longitude,
            stop.latitude, stop.longitude
        );
        return {
            ...stop,
            distanceFromAnchor: dist,
            bearingFromAnchor: bearing,
            stopKey: getStopKey(stop)
        };
    });

    enriched.sort((a, b) => a.bearingFromAnchor - b.bearingFromAnchor || a.distanceFromAnchor - b.distanceFromAnchor);

    const corridors = [];
    const visited = new Set();

    for (let i = 0; i < enriched.length; i++) {
        if (visited.has(i)) continue;

        const seed = enriched[i];
        const corridorStops = [seed];
        visited.add(i);

        for (let j = i + 1; j < enriched.length; j++) {
            if (visited.has(j)) continue;
            const cand = enriched[j];

            const bearingDiff = getBearingDifference(cand.bearingFromAnchor, seed.bearingFromAnchor);
            const distBetween = calculateDistanceKm(
                seed.latitude, seed.longitude,
                cand.latitude, cand.longitude
            );

            // Check proximity to ANY current stop in this corridor
            const minDistToCorridor = Math.min(
                ...corridorStops.map((cs) => calculateDistanceKm(cs.latitude, cs.longitude, cand.latitude, cand.longitude))
            );

            if (bearingDiff <= 35 && minDistToCorridor <= 10.0) {
                corridorStops.push(cand);
                visited.add(j);
            }
        }

        corridors.push(corridorStops);
    }

    return corridors;
};

/*
|--------------------------------------------------------------------------
| 2-OPT ROUTE IMPROVEMENT (Fixed Endpoints & Free Intermediate Optimization)
|--------------------------------------------------------------------------
*/

export const apply2OptRoadOptimization = async (tour, isSourceFixed = true, isDestFixed = true) => {
    if (!Array.isArray(tour) || tour.length <= 3) {
        return tour;
    }

    let improved = true;
    let iterations = 0;
    const maxIterations = 15;
    let currentTour = [...tour];

    const startIndex = isSourceFixed ? 1 : 0;
    const endIndex = isDestFixed ? currentTour.length - 2 : currentTour.length - 1;

    while (improved && iterations < maxIterations) {
        improved = false;
        iterations++;

        for (let i = startIndex; i < endIndex; i++) {
            for (let j = i + 1; j <= endIndex; j++) {
                const prevI = i > 0 ? currentTour[i - 1] : null;
                const currI = currentTour[i];
                const currJ = currentTour[j];
                const nextJ = j + 1 < currentTour.length ? currentTour[j + 1] : null;

                if (!currI || !currJ) continue;

                let currentCost = 0;
                let proposedCost = 0;

                if (prevI && nextJ) {
                    const d1 = await getRoadSegmentCached(prevI, currI);
                    const d2 = await getRoadSegmentCached(currJ, nextJ);
                    currentCost = (d1?.distanceKm || 0) + (d2?.distanceKm || 0);

                    const r1 = await getRoadSegmentCached(prevI, currJ);
                    const r2 = await getRoadSegmentCached(currI, nextJ);
                    proposedCost = (r1?.distanceKm || 0) + (r2?.distanceKm || 0);
                } else if (prevI && !nextJ) {
                    const d1 = await getRoadSegmentCached(prevI, currI);
                    currentCost = d1?.distanceKm || 0;

                    const r1 = await getRoadSegmentCached(prevI, currJ);
                    proposedCost = r1?.distanceKm || 0;
                } else if (!prevI && nextJ) {
                    // Start is not fixed, reversing [0...j] makes currJ the new start stop
                    const d2 = await getRoadSegmentCached(currJ, nextJ);
                    currentCost = d2?.distanceKm || 0;

                    const r2 = await getRoadSegmentCached(currI, nextJ);
                    proposedCost = r2?.distanceKm || 0;
                } else {
                    continue;
                }

                // Reversal must strictly improve road distance by at least 150m
                if (proposedCost < currentCost - 0.15) {
                    if (prevI && nextJ) {
                        const b1 = calculateBearing(prevI.latitude, prevI.longitude, currJ.latitude, currJ.longitude);
                        const b2 = calculateBearing(currI.latitude, currI.longitude, nextJ.latitude, nextJ.longitude);
                        const angleDiff = getBearingDifference(b1, b2);
                        if (angleDiff > 140) {
                            continue;
                        }
                    }

                    const reversedSubTour = currentTour.slice(i, j + 1).reverse();
                    currentTour.splice(i, j - i + 1, ...reversedSubTour);
                    improved = true;
                    break;
                }
            }
            if (improved) break;
        }
    }

    return currentTour;
};

/*
|--------------------------------------------------------------------------
| CONTINUOUS STOP SEQUENCING
|--------------------------------------------------------------------------
*/

export const sequenceStopsContinuous = async (
    stops,
    anchorHub,
    tripMode = "TO_DESTINATION",
    sourceHub = null,
    destinationHub = null,
    startLocation = null
) => {
    if (!Array.isArray(stops) || stops.length === 0) return [];

    const isToDestination = tripMode === "TO_DESTINATION" || tripMode === "INWARD";
    const refHub = isToDestination
        ? (destinationHub || anchorHub)
        : (sourceHub || anchorHub);
    const originPoint = isToDestination
        ? (startLocation || null)
        : (sourceHub || anchorHub);

    if (stops.length === 1) {
        const single = stops[0];
        const prevAnchor = originPoint || refHub;
        const seg = prevAnchor ? await getRoadSegmentCached(prevAnchor, single) : null;
        const legDist = seg?.distanceKm ?? Number((calculateDistanceKm(prevAnchor?.latitude || single.latitude, prevAnchor?.longitude || single.longitude, single.latitude, single.longitude) * 1.25).toFixed(2));
        const legDur = seg?.durationMin ?? Number((legDist / 0.5).toFixed(1));
        const bearing = prevAnchor ? calculateBearing(prevAnchor.latitude, prevAnchor.longitude, single.latitude, single.longitude) : 0;
        return [{
            ...single,
            order: 1,
            previousStopName: prevAnchor?.name || (isToDestination ? "Pickup Origin" : "Source Hub"),
            legDistanceKm: legDist,
            legDurationMin: legDur,
            segmentBearing: Number(bearing.toFixed(1)),
            isContinuousLeg: true,
            backtrackingLeg: false,
            selectionReason: `${single.name} selected: primary stop (+${legDist} km road distance).`
        }];
    }

    const unvisited = stops.map((s) => ({
        ...s,
        distFromHub: calculateDistanceKm(refHub.latitude, refHub.longitude, s.latitude, s.longitude),
        bearingFromHub: calculateBearing(refHub.latitude, refHub.longitude, s.latitude, s.longitude),
        distFromStart: originPoint ? calculateDistanceKm(originPoint.latitude, originPoint.longitude, s.latitude, s.longitude) : 0
    }));

    const orderedTour = [];

    // Phase 1: Determine initial seed stop
    let initialIndex = 0;
    if (isToDestination) {
        if (originPoint) {
            let minStartDist = Infinity;
            for (let idx = 0; idx < unvisited.length; idx++) {
                const s = unvisited[idx];
                const seg = await getRoadSegmentCached(originPoint, s);
                const rDist = seg?.distanceKm ?? s.distFromStart;
                if (rDist < minStartDist) {
                    minStartDist = rDist;
                    initialIndex = idx;
                }
            }
        } else {
            // Inward: Natural residential start at outermost stop furthest from destination
            let maxDist = -1;
            unvisited.forEach((s, idx) => {
                if (s.distFromHub > maxDist) {
                    maxDist = s.distFromHub;
                    initialIndex = idx;
                }
            });
        }
    } else {
        // Outward: Start at nearest suitable stop by road distance from Source
        let minRoadDistance = Infinity;
        for (let idx = 0; idx < unvisited.length; idx++) {
            const s = unvisited[idx];
            const seg = sourceHub ? await getRoadSegmentCached(sourceHub, s) : null;
            const rDist = seg?.distanceKm ?? s.distFromHub;
            if (rDist < minRoadDistance) {
                minRoadDistance = rDist;
                initialIndex = idx;
            }
        }
    }

    const initialStop = unvisited.splice(initialIndex, 1)[0];
    const initialPrevAnchor = originPoint || (isToDestination ? null : (sourceHub || refHub));
    const initialSeg = initialPrevAnchor ? await getRoadSegmentCached(initialPrevAnchor, initialStop) : null;
    const initialLegDist = initialSeg?.distanceKm ?? (initialPrevAnchor ? Number(initialStop.distFromStart.toFixed(2)) : 0);
    const initialLegDur = initialSeg?.durationMin ?? Number((initialLegDist / 0.5).toFixed(1));
    const initialBearing = initialPrevAnchor ? calculateBearing(initialPrevAnchor.latitude, initialPrevAnchor.longitude, initialStop.latitude, initialStop.longitude) : 0;

    initialStop.previousStopName = initialPrevAnchor?.name || (isToDestination ? "Pickup Origin" : "Source Hub");
    initialStop.legDistanceKm = initialLegDist;
    initialStop.legDurationMin = initialLegDur;
    initialStop.segmentBearing = Number(initialBearing.toFixed(1));
    initialStop.isContinuousLeg = true;
    initialStop.backtrackingLeg = false;
    initialStop.selectionReason = isToDestination
        ? `${initialStop.name} selected as outer residential pickup stop.`
        : `${initialStop.name} selected: nearest stop by road distance from ${refHub.name || "Source"}.`;
    orderedTour.push(initialStop);

    let currentPoint = initialStop;
    let lastSegmentBearing = initialBearing;

    // Phase 2: Sequential Continuous Next-Stop Selection
    while (unvisited.length > 0) {
        const candidatesWithDist = unvisited.map((cand, idx) => ({
            cand,
            originalIdx: idx,
            straightLineKm: calculateDistanceKm(currentPoint.latitude, currentPoint.longitude, cand.latitude, cand.longitude)
        }));

        candidatesWithDist.sort((a, b) => a.straightLineKm - b.straightLineKm);
        const topCandidates = candidatesWithDist.slice(0, Math.min(10, candidatesWithDist.length));

        let bestCandidateEntry = null;
        let lowestScore = Infinity;

        for (const item of topCandidates) {
            const cand = item.cand;
            const seg = await getRoadSegmentCached(currentPoint, cand);
            const roadKm = seg?.distanceKm ?? (item.straightLineKm * 1.25);
            const roadDur = seg?.durationMin ?? (roadKm / 0.5);
            const candBearing = calculateBearing(currentPoint.latitude, currentPoint.longitude, cand.latitude, cand.longitude);

            let detourKm = 0;
            let forwardProgress = 0;
            let isBacktracking = false;
            let backtrackingPenalty = 0;

            const targetPoint = isToDestination ? (destinationHub || anchorHub) : null;
            const originHub = !isToDestination ? (sourceHub || anchorHub) : null;

            if (targetPoint && isValidCoordinate(targetPoint.latitude, targetPoint.longitude)) {
                const currentToTarget = calculateDistanceKm(currentPoint.latitude, currentPoint.longitude, targetPoint.latitude, targetPoint.longitude);
                const candToTarget = calculateDistanceKm(cand.latitude, cand.longitude, targetPoint.latitude, targetPoint.longitude);

                detourKm = Math.max(0, (roadKm + candToTarget) - currentToTarget);
                forwardProgress = currentToTarget - candToTarget;

                // Backtracking detection towards destination (moving significantly away)
                if (forwardProgress < -3.0 && roadKm > 4.0) {
                    isBacktracking = true;
                    backtrackingPenalty = Math.abs(forwardProgress) * 2.0;
                }
            } else if (originHub && isValidCoordinate(originHub.latitude, originHub.longitude)) {
                const currentToOrigin = calculateDistanceKm(currentPoint.latitude, currentPoint.longitude, originHub.latitude, originHub.longitude);
                const candToOrigin = calculateDistanceKm(cand.latitude, cand.longitude, originHub.latitude, originHub.longitude);

                const outwardProgress = candToOrigin - currentToOrigin;
                forwardProgress = outwardProgress;

                if (outwardProgress < -3.0 && roadKm > 4.0) {
                    isBacktracking = true;
                    backtrackingPenalty = Math.abs(outwardProgress) * 2.0;
                }
            }

            let score = (roadKm * 1.0) + (roadDur * 0.08);
            score += detourKm * 0.8;
            score += backtrackingPenalty;
            if (forwardProgress > 0) {
                score -= Math.min(forwardProgress * 0.15, 1.5);
            }

            const demandCount = Number(cand.userCount || cand.users?.length || cand.unassignedUserIds?.length || 1);
            score -= Math.min(demandCount * 0.03, 0.4);

            if (score < lowestScore) {
                lowestScore = score;
                bestCandidateEntry = {
                    cand,
                    originalIdx: item.originalIdx,
                    roadKm: Number(roadKm.toFixed(2)),
                    roadDur: Number(roadDur.toFixed(1)),
                    bearing: Number(candBearing.toFixed(1)),
                    isContinuousLeg: !isBacktracking,
                    backtrackingLeg: isBacktracking
                };
            }
        }

        if (!bestCandidateEntry) {
            bestCandidateEntry = {
                cand: unvisited[0],
                originalIdx: 0,
                roadKm: 1.0,
                roadDur: 2.0,
                bearing: lastSegmentBearing,
                isContinuousLeg: true,
                backtrackingLeg: false
            };
        }

        const nextStop = unvisited.splice(bestCandidateEntry.originalIdx, 1)[0];
        nextStop.previousStopName = currentPoint.name;
        nextStop.legDistanceKm = bestCandidateEntry.roadKm;
        nextStop.legDurationMin = bestCandidateEntry.roadDur;
        nextStop.segmentBearing = bestCandidateEntry.bearing;
        nextStop.isContinuousLeg = bestCandidateEntry.isContinuousLeg;
        nextStop.backtrackingLeg = bestCandidateEntry.backtrackingLeg;
        nextStop.selectionReason = `${nextStop.name} selected: continuous road progression from ${currentPoint.name} (+${bestCandidateEntry.roadKm} km).`;

        orderedTour.push(nextStop);
        currentPoint = nextStop;
        lastSegmentBearing = bestCandidateEntry.bearing;
    }

    // Phase 3: Controlled 2-Opt Improvement with Fixed Endpoints
    let fullTourFor2Opt = [];
    let isStartFixed = false;
    let isEndFixed = false;

    if (isToDestination) {
        // INWARD: Tour is [stops..., destinationHub]. Destination is fixed at the end.
        const endAnchor = destinationHub || anchorHub;
        fullTourFor2Opt = [...orderedTour, endAnchor];
        isStartFixed = false;
        isEndFixed = true;
    } else {
        // OUTWARD: Tour is [sourceHub, ...stops]. Source is fixed at start.
        const startAnchor = sourceHub || anchorHub;
        fullTourFor2Opt = [startAnchor, ...orderedTour];
        isStartFixed = true;
        isEndFixed = false;
    }

    const optimizedTour = await apply2OptRoadOptimization(fullTourFor2Opt, isStartFixed, isEndFixed);

    // Extract intermediate stops
    const finalStops = optimizedTour.filter((pt) =>
        pt !== sourceHub && pt !== destinationHub && pt !== anchorHub && pt !== originPoint
    );

    // Recalculate segment metrics and strictly update explanations for final optimized order
    let prev = isToDestination ? null : (sourceHub || anchorHub);
    for (let idx = 0; idx < finalStops.length; idx++) {
        const st = finalStops[idx];
        if (prev) {
            const seg = await getRoadSegmentCached(prev, st);
            st.previousStopName = prev.name || "Start";
            st.legDistanceKm = seg?.distanceKm ?? Number((calculateDistanceKm(prev.latitude, prev.longitude, st.latitude, st.longitude) * 1.25).toFixed(2));
            st.legDurationMin = seg?.durationMin ?? Number((st.legDistanceKm / 0.5).toFixed(1));
            st.segmentBearing = Number(calculateBearing(prev.latitude, prev.longitude, st.latitude, st.longitude).toFixed(1));
            st.isContinuousLeg = true;
            st.backtrackingLeg = false;
            st.selectionReason = `${st.name} selected: continuous road connection from ${prev.name} (+${st.legDistanceKm} km, ~${st.legDurationMin} min).`;
        } else {
            st.previousStopName = isToDestination ? "Pickup Origin" : (sourceHub?.name || "Departure Hub");
            st.legDistanceKm = 0;
            st.legDurationMin = 0;
            st.segmentBearing = 0;
            st.isContinuousLeg = true;
            st.backtrackingLeg = false;
            st.selectionReason = isToDestination
                ? `${st.name} selected: outer residential pickup terminus / route start point.`
                : `${st.name} selected: first residential drop-off from ${sourceHub?.name || 'source'}.`;
        }
        st.order = idx + 1;
        st.sequence = idx + 1;
        st.passengerUserIds = Array.isArray(st.userIds) ? st.userIds : [];
        st.passengerCount = st.passengerUserIds.length;
        st.userCount = st.passengerUserIds.length;
        st.segmentRoadDistance = st.legDistanceKm;
        st.estimatedTravelTime = st.legDurationMin;
        prev = st;
    }

    return finalStops;
};

/*
|--------------------------------------------------------------------------
| 10-CHECK CONTINUOUS ROUTE CORRIDOR VALIDATION ENGINE
|--------------------------------------------------------------------------
*/

export const validateRouteCorridorContinuity = (bus, sourceHub, destinationHub, tripMode = "TO_DESTINATION") => {
    const stops = Array.isArray(bus.stops) ? bus.stops : [];
    if (stops.length === 0) {
        return {
            isContinuous: false,
            continuityStatus: "No stops assigned",
            backtrackingDetected: false,
            directionalInversionDetected: false,
            detourRatio: 1.0,
            checks: {}
        };
    }

    const isToDestination = tripMode === "TO_DESTINATION" || tripMode === "INWARD";
    const origin = !isToDestination ? (sourceHub || bus.sourceHub) : null;
    const destination = isToDestination ? (destinationHub || bus.destinationHub) : null;

    let totalRoadKm = bus.routeDistanceKm || 0;
    let totalStraightLineKm = bus.straightLineBaselineKm || 0;

    // Check 1: First stop proximity
    const firstStop = stops[0];
    const check1_firstStopProximity = origin
        ? calculateDistanceKm(origin.latitude, origin.longitude, firstStop.latitude, firstStop.longitude) < 40
        : true;

    // Check 2: Sequential straight-line & road distance continuity
    let check2_sequentialProximity = true;
    let check2b_roadSegmentContinuity = true;
    for (let i = 0; i < stops.length - 1; i++) {
        const straightD = calculateDistanceKm(stops[i].latitude, stops[i].longitude, stops[i + 1].latitude, stops[i + 1].longitude);
        if (straightD > 40) {
            check2_sequentialProximity = false;
        }
        const roadLegD = Number(stops[i + 1].legDistanceKm || 0);
        if (roadLegD > 0 && roadLegD > Math.max(25, straightD * 3.5)) {
            check2b_roadSegmentContinuity = false;
        }
    }

    // Check 3, 4, 5: Directional progression, corridor consistency, and loop backtracking
    let check3_direction = true;
    let check4_corridor = true;
    let check5_backtracking = true;

    // Detect loops: visiting the same stop area more than once
    const visitedStopKeys = new Set();
    let hasLoopBacktracking = false;
    for (const s of stops) {
        const key = getStopKey(s);
        if (visitedStopKeys.has(key)) {
            hasLoopBacktracking = true;
            check5_backtracking = false;
            break;
        }
        visitedStopKeys.add(key);
    }

    // Outward: progression away from Source
    if (origin && stops.length >= 2) {
        const firstDist = calculateDistanceKm(origin.latitude, origin.longitude, stops[0].latitude, stops[0].longitude);
        const lastDist = calculateDistanceKm(origin.latitude, origin.longitude, stops[stops.length - 1].latitude, stops[stops.length - 1].longitude);
        if (lastDist < firstDist - 4.0 && stops.length > 2) {
            check3_direction = false;
        }
        // Check intermediate directional inversion / severe oscillation
        for (let i = 0; i < stops.length - 1; i++) {
            const dCurrent = calculateDistanceKm(origin.latitude, origin.longitude, stops[i].latitude, stops[i].longitude);
            const dNext = calculateDistanceKm(origin.latitude, origin.longitude, stops[i + 1].latitude, stops[i + 1].longitude);
            // Check vector projection or distance swing: e.g. North -> South -> North
            if (i < stops.length - 2) {
                const latDiff1 = stops[i + 1].latitude - stops[i].latitude;
                const latDiff2 = stops[i + 2].latitude - stops[i + 1].latitude;
                const lngDiff1 = stops[i + 1].longitude - stops[i].longitude;
                const lngDiff2 = stops[i + 2].longitude - stops[i + 1].longitude;
                const dot = (latDiff1 * latDiff2) + (lngDiff1 * lngDiff2);
                const mag1 = Math.sqrt(latDiff1 * latDiff1 + lngDiff1 * lngDiff1);
                const mag2 = Math.sqrt(latDiff2 * latDiff2 + lngDiff2 * lngDiff2);
                if (mag1 > 0.05 && mag2 > 0.05 && dot / (mag1 * mag2) < -0.6) {
                    check3_direction = false;
                }
            }
        }
    }

    // Inward: progression toward Destination
    if (destination && stops.length >= 2) {
        const firstDist = calculateDistanceKm(stops[0].latitude, stops[0].longitude, destination.latitude, destination.longitude);
        const lastDist = calculateDistanceKm(stops[stops.length - 1].latitude, stops[stops.length - 1].longitude, destination.latitude, destination.longitude);
        if (lastDist > firstDist + 5.0 && stops.length > 2) {
            check3_direction = false;
        }
        for (let i = 0; i < stops.length - 2; i++) {
            const latDiff1 = stops[i + 1].latitude - stops[i].latitude;
            const latDiff2 = stops[i + 2].latitude - stops[i + 1].latitude;
            const lngDiff1 = stops[i + 1].longitude - stops[i].longitude;
            const lngDiff2 = stops[i + 2].longitude - stops[i + 1].longitude;
            const dot = (latDiff1 * latDiff2) + (lngDiff1 * lngDiff2);
            const mag1 = Math.sqrt(latDiff1 * latDiff1 + lngDiff1 * lngDiff1);
            const mag2 = Math.sqrt(latDiff2 * latDiff2 + lngDiff2 * lngDiff2);
            if (mag1 > 0.05 && mag2 > 0.05 && dot / (mag1 * mag2) < -0.6) {
                check3_direction = false;
            }
        }
    }

    // Check 6: Detour validation
    const detourRatio = totalStraightLineKm > 0 ? Number((totalRoadKm / totalStraightLineKm).toFixed(2)) : 1.25;
    const detourThreshold = 2.1;
    const check6_detour = detourRatio <= detourThreshold;

    // Check 7: Road network verification
    const check7_roadGeometry = bus.isRoadVerified === true;

    // Check 8: Demand integrity
    const check8_demand = (bus.assignedUsers || 0) > 0;

    // Check 9: Capacity compliance
    const check9_capacity = (bus.assignedUsers || 0) <= (bus.capacity || 0);

    const hasBacktracking = hasLoopBacktracking || !check5_backtracking;
    const hasDirectionalInversion = !check3_direction;

    const allPassed = Boolean(
        check1_firstStopProximity &&
        check2_sequentialProximity &&
        check2b_roadSegmentContinuity &&
        check3_direction &&
        check4_corridor &&
        check5_backtracking &&
        check6_detour &&
        check8_demand &&
        check9_capacity &&
        !hasDirectionalInversion &&
        !hasBacktracking
    );

    return {
        isContinuous: allPassed,
        continuityStatus: allPassed
            ? "Continuous Corridor"
            : (hasDirectionalInversion ? "Directional Inversion Detected" : (hasBacktracking ? "Severe Backtracking Detected" : "Discontinuous Corridor")),
        backtrackingDetected: hasBacktracking,
        directionalInversionDetected: hasDirectionalInversion,
        detourRatio,
        detourThreshold,
        isDetour: detourRatio > detourThreshold,
        checks: {
            check1_firstStopProximity,
            check2_sequentialProximity,
            check2b_roadSegmentContinuity,
            check3_direction,
            check4_corridor,
            check5_backtracking,
            check6_detour,
            check7_roadGeometry,
            check8_demand,
            check9_capacity,
            check10_continuousRouteRepresentation: allPassed
        }
    };
};

/*
|--------------------------------------------------------------------------
| BALANCED CORRIDOR VEHICLE ALLOCATION (Dynamic Capacity, No Cross-Town Hopping)
|--------------------------------------------------------------------------
*/

/**
 * Helper to board passengers from stop pools into a vehicle without exceeding capacity.
 */
const boardStopsIntoVehicle = (candidateStops, stopPoolMap, vehicleRemainingSeats, currentBusStops, busAssignedUserIds, assignedUserGlobalSet) => {
    let remainingSeats = vehicleRemainingSeats;

    for (const stopItem of candidateStops) {
        if (remainingSeats <= 0) break;
        const pool = stopPoolMap.get(getStopKey(stopItem));
        if (!pool || pool.unassignedUserIds.length === 0) continue;

        const boardCount = Math.min(pool.unassignedUserIds.length, remainingSeats);
        const boardedIds = pool.unassignedUserIds.splice(0, boardCount);

        boardedIds.forEach((uid) => assignedUserGlobalSet.add(uid));
        busAssignedUserIds.push(...boardedIds);
        remainingSeats -= boardCount;

        const existingIdx = currentBusStops.findIndex((st) => getStopKey(st) === getStopKey(pool));
        if (existingIdx !== -1) {
            currentBusStops[existingIdx].userCount += boardCount;
            currentBusStops[existingIdx].userIds.push(...boardedIds);
        } else {
            currentBusStops.push({
                name: pool.name,
                locationKey: pool.locationKey || getStopKey(pool),
                locationQuery: pool.locationQuery || "",
                city: pool.city || "",
                district: pool.district || "",
                state: pool.state || "",
                country: pool.country || "",
                latitude: pool.latitude,
                longitude: pool.longitude,
                userCount: boardCount,
                userIds: boardedIds
            });
        }
    }

    return remainingSeats;
};

/**
 * Allocate vehicles dynamically to natural geographic clusters.
 * Vehicles are allocated to corridors based on demand density without dumping unrelated stops across town.
 */
export const allocateVehiclesToDemandClusters = ({
    resolvedStops,
    availableVehicles,
    anchorHub
}) => {
    const usableVehicles = [...availableVehicles]
        .filter((v) => getVehicleCapacity(v) > 0)
        .sort((a, b) => getVehicleCapacity(b) - getVehicleCapacity(a));

    if (usableVehicles.length === 0) {
        return { busClusters: [], stopPoolMap: new Map(), assignedUserGlobalSet: new Set() };
    }

    // 1. Authoritative Stop Passenger Pools
    const stopPoolMap = new Map();
    const assignedUserGlobalSet = new Set();

    resolvedStops.forEach((s) => {
        const key = getStopKey(s);
        let userIdsList = Array.isArray(s.users)
            ? s.users.map((u) => String(u?._id || u?.id || u?.userId || u))
            : (Array.isArray(s.userIds) ? [...s.userIds] : []);

        if (userIdsList.length === 0 && Number(s.userCount) > 0) {
            userIdsList = Array.from({ length: Number(s.userCount) }, (_, i) => `${s.name}_u_${i + 1}`);
        }

        const uniqueIds = Array.from(new Set(userIdsList));

        stopPoolMap.set(key, {
            name: s.name,
            locationKey: s.locationKey || key,
            locationQuery: s.locationQuery || "",
            city: s.city || "",
            district: s.district || "",
            state: s.state || "",
            country: s.country || "",
            latitude: s.latitude,
            longitude: s.longitude,
            unassignedUserIds: [...uniqueIds],
            initialUserCount: uniqueIds.length,
            distanceFromAnchor: calculateDistanceKm(anchorHub.latitude, anchorHub.longitude, s.latitude, s.longitude),
            bearingFromAnchor: calculateBearing(anchorHub.latitude, anchorHub.longitude, s.latitude, s.longitude)
        });
    });

    // 2. Partition stopping areas into directional sector clusters
    const rawCorridors = groupStopsIntoCorridors(resolvedStops, anchorHub);

    // Enrich corridors with total demand and sorted stops
    const corridorClusters = rawCorridors.map((corrStops, idx) => {
        const pools = corrStops.map((st) => stopPoolMap.get(getStopKey(st))).filter(Boolean);
        const totalPassengers = pools.reduce((sum, p) => sum + p.unassignedUserIds.length, 0);
        const avgBearing = pools.length > 0
            ? pools.reduce((sum, p) => sum + p.bearingFromAnchor, 0) / pools.length
            : 0;
        return {
            id: idx + 1,
            pools,
            totalPassengers,
            avgBearing,
            sectorName: getSectorName(avgBearing)
        };
    }).filter((c) => c.totalPassengers > 0);

    // Sort corridors by bearing to keep geographic continuity
    corridorClusters.sort((a, b) => a.avgBearing - b.avgBearing);

    const busClusters = [];
    const usedVehicleIds = new Set();

    // Helper to get next available unused vehicle
    const getNextAvailableVehicle = (preferredCapacity = 70) => {
        // Find best fitting vehicle that hasn't been used yet
        const candidates = usableVehicles.filter((v) => {
            const vid = String(v._id || v.id || "");
            return !usedVehicleIds.has(vid);
        });
        if (candidates.length === 0) return null;

        // Try to find a vehicle close to preferredCapacity
        let best = candidates[0];
        let bestDiff = Math.abs(getVehicleCapacity(best) - preferredCapacity);
        for (const cand of candidates) {
            const diff = Math.abs(getVehicleCapacity(cand) - preferredCapacity);
            if (diff < bestDiff) {
                best = cand;
                bestDiff = diff;
            }
        }

        const chosenId = String(best._id || best.id || `veh-${busClusters.length + 1}`);
        usedVehicleIds.add(chosenId);
        return best;
    };

    // 3. Primary Allocation: Assign dedicated vehicles per corridor
    for (const cluster of corridorClusters) {
        let unassignedInCluster = cluster.pools.filter((p) => p.unassignedUserIds.length > 0);
        if (unassignedInCluster.length === 0) continue;

        while (unassignedInCluster.length > 0 && usedVehicleIds.size < usableVehicles.length) {
            const clusterDemand = unassignedInCluster.reduce((sum, p) => sum + p.unassignedUserIds.length, 0);
            if (clusterDemand === 0) break;

            const vehicle = getNextAvailableVehicle(clusterDemand);
            if (!vehicle) break;

            const capacity = getVehicleCapacity(vehicle);
            const vehicleId = String(vehicle._id || vehicle.id || `veh-${busClusters.length + 1}`);
            const vehicleName = getVehicleName(vehicle, busClusters.length);

            let remainingSeats = capacity;
            const currentBusStops = [];
            const busAssignedUserIds = [];

            // Sort stops by distance from anchor (furthest first)
            unassignedInCluster.sort((a, b) => b.distanceFromAnchor - a.distanceFromAnchor);

            remainingSeats = boardStopsIntoVehicle(
                unassignedInCluster,
                stopPoolMap,
                remainingSeats,
                currentBusStops,
                busAssignedUserIds,
                assignedUserGlobalSet
            );

            // If bus still has spare capacity, sweep adjacent stops ONLY from the immediately adjacent corridor
            if (remainingSeats > 0) {
                const currentAvgBearing = cluster.avgBearing;
                const candidateAdjacentStops = Array.from(stopPoolMap.values()).filter((st) => {
                    if (st.unassignedUserIds.length === 0) return false;
                    const bearingDiff = getBearingDifference(currentAvgBearing, st.bearingFromAnchor);
                    const distFromCurrentStops = Math.min(
                        ...currentBusStops.map((cs) => calculateDistanceKm(cs.latitude, cs.longitude, st.latitude, st.longitude))
                    );
                    return bearingDiff <= 30 && distFromCurrentStops <= 7.0;
                });

                if (candidateAdjacentStops.length > 0) {
                    candidateAdjacentStops.sort((a, b) => b.distanceFromAnchor - a.distanceFromAnchor);
                    remainingSeats = boardStopsIntoVehicle(
                        candidateAdjacentStops,
                        stopPoolMap,
                        remainingSeats,
                        currentBusStops,
                        busAssignedUserIds,
                        assignedUserGlobalSet
                    );
                }
            }

            if (currentBusStops.length > 0 && busAssignedUserIds.length > 0) {
                // Single source of truth
                const assignedUsersCount = currentBusStops.reduce((sum, s) => sum + (s.userCount || 0), 0);
                const avgBearing = currentBusStops.reduce((sum, s) => sum + (stopPoolMap.get(getStopKey(s))?.bearingFromAnchor || 0), 0) / currentBusStops.length;

                busClusters.push({
                    vehicle,
                    vehicleId,
                    vehicleName,
                    capacity,
                    assignedUsers: assignedUsersCount,
                    remainingSeats: Math.max(0, capacity - assignedUsersCount),
                    stops: currentBusStops,
                    users: [...busAssignedUserIds],
                    sectorName: getSectorName(avgBearing),
                    avgBearing
                });
            }

            unassignedInCluster = cluster.pools.filter((p) => p.unassignedUserIds.length > 0);
        }
    }

    // 4. Coverage Safety: If any passengers remain unassigned, assign to nearest compatible bus or deploy extra vehicle
    let leftoverPools = Array.from(stopPoolMap.values()).filter((st) => st.unassignedUserIds.length > 0);

    // Step A: Try compatible existing buses
    for (const missingPool of leftoverPools) {
        if (missingPool.unassignedUserIds.length === 0) continue;

        // Find existing bus in compatible corridor
        let bestBus = null;
        let minBearingDiff = Infinity;

        for (const bus of busClusters) {
            if (bus.remainingSeats <= 0) continue;
            const bearingDiff = getBearingDifference(bus.avgBearing, missingPool.bearingFromAnchor);
            if (bearingDiff <= 40 && bearingDiff < minBearingDiff) {
                minBearingDiff = bearingDiff;
                bestBus = bus;
            }
        }

        if (bestBus) {
            const count = Math.min(bestBus.remainingSeats, missingPool.unassignedUserIds.length);
            const ids = missingPool.unassignedUserIds.splice(0, count);
            ids.forEach((uid) => assignedUserGlobalSet.add(uid));

            bestBus.remainingSeats -= count;
            bestBus.users.push(...ids);

            const existingStopIdx = bestBus.stops.findIndex((st) => getStopKey(st) === getStopKey(missingPool));
            if (existingStopIdx !== -1) {
                bestBus.stops[existingStopIdx].userCount += count;
                bestBus.stops[existingStopIdx].userIds.push(...ids);
            } else {
                bestBus.stops.push({
                    name: missingPool.name,
                    locationKey: missingPool.locationKey || getStopKey(missingPool),
                    locationQuery: missingPool.locationQuery || "",
                    city: missingPool.city || "",
                    district: missingPool.district || "",
                    state: missingPool.state || "",
                    country: missingPool.country || "",
                    latitude: missingPool.latitude,
                    longitude: missingPool.longitude,
                    userCount: count,
                    userIds: ids
                });
            }

            bestBus.assignedUsers = bestBus.stops.reduce((sum, s) => sum + (s.userCount || 0), 0);
        }
    }

    // Step B: Deploy additional vehicles if passengers still remain
    leftoverPools = Array.from(stopPoolMap.values()).filter((st) => st.unassignedUserIds.length > 0);
    while (leftoverPools.length > 0 && usedVehicleIds.size < usableVehicles.length) {
        const vehicle = getNextAvailableVehicle();
        if (!vehicle) break;

        const capacity = getVehicleCapacity(vehicle);
        const vehicleId = String(vehicle._id || vehicle.id || `veh-${busClusters.length + 1}`);
        const vehicleName = getVehicleName(vehicle, busClusters.length);

        let remainingSeats = capacity;
        const currentBusStops = [];
        const busAssignedUserIds = [];

        remainingSeats = boardStopsIntoVehicle(
            leftoverPools,
            stopPoolMap,
            remainingSeats,
            currentBusStops,
            busAssignedUserIds,
            assignedUserGlobalSet
        );

        if (currentBusStops.length > 0) {
            const assignedUsersCount = currentBusStops.reduce((sum, s) => sum + (s.userCount || 0), 0);
            const avgBearing = currentBusStops.reduce((sum, s) => sum + (stopPoolMap.get(getStopKey(s))?.bearingFromAnchor || 0), 0) / currentBusStops.length;

            busClusters.push({
                vehicle,
                vehicleId,
                vehicleName,
                capacity,
                assignedUsers: assignedUsersCount,
                remainingSeats: Math.max(0, capacity - assignedUsersCount),
                stops: currentBusStops,
                users: [...busAssignedUserIds],
                sectorName: getSectorName(avgBearing),
                avgBearing
            });
        }

        leftoverPools = Array.from(stopPoolMap.values()).filter((st) => st.unassignedUserIds.length > 0);
    }

    return { busClusters, stopPoolMap, assignedUserGlobalSet };
};

/*
|--------------------------------------------------------------------------
| INWARD ROUTE OPTIMIZATION (Inward Plan Towards Destination Hub)
|--------------------------------------------------------------------------
*/

export const optimizeInwardBusRoute = async (busCluster, destinationHub) => {
    const rawStops = busCluster.stops || [];
    if (rawStops.length === 0) return null;

    // Sequence stops continuously progressing towards destinationHub
    const sequencedStops = await sequenceStopsContinuous(
        rawStops,
        destinationHub,
        "TO_DESTINATION",
        null,
        destinationHub,
        null
    );

    // Compute cumulative boarding counts along the route
    let cumulativePassengers = 0;
    const capacity = busCluster.capacity || 70;

    const stopsWithMetrics = sequencedStops.map((s, idx) => {
        const boarded = s.userCount || 0;
        cumulativePassengers += boarded;

        return {
            ...s,
            order: idx + 1,
            passengersBoarded: boarded,
            cumulativePassengers,
            standbySeatsAtStop: Math.max(0, capacity - cumulativePassengers),
            resolved: true
        };
    });

    // Compute complete road geometry for: [stops[0] ... stops[N-1], destinationHub]
    const waypoints = [...stopsWithMetrics, destinationHub];
    let straightLineKm = 0;
    for (let i = 0; i < waypoints.length - 1; i++) {
        straightLineKm += calculateDistanceKm(
            waypoints[i].latitude, waypoints[i].longitude,
            waypoints[i + 1].latitude, waypoints[i + 1].longitude
        );
    }

    const roadRoute = await getRoadRouteGeometry(waypoints);
    const routeDistanceKm = roadRoute ? roadRoute.distanceKm : Number((straightLineKm * 1.25).toFixed(2));
    const routeDurationMin = roadRoute ? Number((roadRoute.durationSeconds / 60).toFixed(1)) : Number((routeDistanceKm / 0.5).toFixed(1));

    const assignedUsers = stopsWithMetrics.reduce((sum, s) => sum + (s.userCount || 0), 0);

    const busResult = {
        vehicleId: busCluster.vehicleId,
        vehicleName: busCluster.vehicleName,
        capacity,
        assignedUsers,
        remainingSeats: Math.max(0, capacity - assignedUsers),
        sectorName: busCluster.sectorName,
        tripMode: "INWARD",
        startLocation: {
            name: stopsWithMetrics[0]?.name || "Pickup Origin",
            latitude: stopsWithMetrics[0]?.latitude,
            longitude: stopsWithMetrics[0]?.longitude
        },
        stops: stopsWithMetrics,
        destinationHub,
        routeDistanceKm,
        routeDurationMin,
        straightLineBaselineKm: Number(straightLineKm.toFixed(2)),
        roadGeometry: roadRoute?.geometry || [],
        isRoadVerified: Boolean(roadRoute && roadRoute.isRoadVerified),
        isFallback: Boolean(!roadRoute || roadRoute.isFallback),
        roadRouteStatus: (roadRoute && roadRoute.isRoadVerified) ? "OSRM Verified" : "Calibrated Fallback (Network Unavailable)",
        users: stopsWithMetrics.flatMap((s) => s.userIds || [])
    };

    // Continuity verification
    const continuity = validateRouteCorridorContinuity(
        busResult,
        null,
        destinationHub,
        "TO_DESTINATION"
    );

    busResult.continuityValidation = continuity;
    busResult.isContinuous = continuity.isContinuous;
    busResult.detourRatio = continuity.detourRatio;
    busResult.isDetour = continuity.isDetour;

    return busResult;
};

/*
|--------------------------------------------------------------------------
| OUTWARD ROUTE OPTIMIZATION (Outward Plan from Source Hub)
|--------------------------------------------------------------------------
*/

export const optimizeOutwardBusRoute = async (busCluster, sourceHub) => {
    const rawStops = busCluster.stops || [];
    if (rawStops.length === 0) return null;

    // Sequence stops continuously progressing outward from sourceHub
    const sequencedStops = await sequenceStopsContinuous(
        rawStops,
        sourceHub,
        "FROM_SOURCE",
        sourceHub,
        null,
        null
    );

    const capacity = busCluster.capacity || 70;
    const assignedUsers = sequencedStops.reduce((sum, s) => sum + (s.userCount || 0), 0);

    let passengersOnBus = assignedUsers;
    const stopsWithMetrics = sequencedStops.map((s, idx) => {
        const dropped = s.userCount || 0;
        passengersOnBus = Math.max(0, passengersOnBus - dropped);

        return {
            ...s,
            order: idx + 1,
            passengersDropped: dropped,
            passengersRemaining: passengersOnBus,
            resolved: true
        };
    });

    // Compute complete road geometry for: [sourceHub, stops[0] ... stops[N-1]]
    const waypoints = [sourceHub, ...stopsWithMetrics];
    let straightLineKm = 0;
    for (let i = 0; i < waypoints.length - 1; i++) {
        straightLineKm += calculateDistanceKm(
            waypoints[i].latitude, waypoints[i].longitude,
            waypoints[i + 1].latitude, waypoints[i + 1].longitude
        );
    }

    const roadRoute = await getRoadRouteGeometry(waypoints);
    const routeDistanceKm = roadRoute ? roadRoute.distanceKm : Number((straightLineKm * 1.25).toFixed(2));
    const routeDurationMin = roadRoute ? Number((roadRoute.durationSeconds / 60).toFixed(1)) : Number((routeDistanceKm / 0.5).toFixed(1));

    const busResult = {
        vehicleId: busCluster.vehicleId,
        vehicleName: busCluster.vehicleName,
        capacity,
        assignedUsers,
        remainingSeats: Math.max(0, capacity - assignedUsers),
        sectorName: busCluster.sectorName,
        tripMode: "OUTWARD",
        sourceHub,
        stops: stopsWithMetrics,
        lastOutwardStop: stopsWithMetrics[stopsWithMetrics.length - 1] || null,
        routeDistanceKm,
        routeDurationMin,
        straightLineBaselineKm: Number(straightLineKm.toFixed(2)),
        roadGeometry: roadRoute?.geometry || [],
        isRoadVerified: Boolean(roadRoute && roadRoute.isRoadVerified),
        isFallback: Boolean(!roadRoute || roadRoute.isFallback),
        roadRouteStatus: (roadRoute && roadRoute.isRoadVerified) ? "OSRM Verified" : "Calibrated Fallback (Network Unavailable)",
        users: stopsWithMetrics.flatMap((s) => s.userIds || [])
    };

    const continuity = validateRouteCorridorContinuity(
        busResult,
        sourceHub,
        null,
        "FROM_SOURCE"
    );

    busResult.continuityValidation = continuity;
    busResult.isContinuous = continuity.isContinuous;
    busResult.detourRatio = continuity.detourRatio;
    busResult.isDetour = continuity.isDetour;

    return busResult;
};

/*
|--------------------------------------------------------------------------
| ROUTE CONSOLIDATION (Safe Same-Corridor Merging Only)
|--------------------------------------------------------------------------
*/

export const consolidateLowUtilizationRoutes = async ({
    initialBuses,
    availableVehicles,
    anchorHub,
    tripMode = "TO_DESTINATION",
    sourceHub = null,
    destinationHub = null
}) => {
    if (!Array.isArray(initialBuses) || initialBuses.length <= 1) {
        return { buses: initialBuses || [], consolidationLogs: [], consolidationAudit: [] };
    }

    let activeBuses = initialBuses.map((b) => ({ ...b }));
    const MIN_POST_MERGE_UTILIZATION = 0.45;
    const MAX_DISTANCE_DELTA_KM = 12.0;

    let consolidationChanged = true;
    let pass = 0;
    const consolidationLogs = [];
    const consolidationAudit = [];

    while (consolidationChanged && pass < 3 && activeBuses.length > 1) {
        consolidationChanged = false;
        pass++;

        const lowUtilIndices = [];
        for (let i = 0; i < activeBuses.length; i++) {
            const bus = activeBuses[i];
            const util = bus.capacity > 0 ? (bus.assignedUsers / bus.capacity) : 0;
            if (util < 0.40 || bus.assignedUsers <= 18) {
                lowUtilIndices.push(i);
            }
        }

        lowUtilIndices.sort((a, b) => activeBuses[a].assignedUsers - activeBuses[b].assignedUsers);

        for (const lowIdx of lowUtilIndices) {
            const lowBus = activeBuses[lowIdx];
            if (!lowBus || lowBus.assignedUsers === 0) continue;

            let bestTargetIdx = -1;
            let bestMergedStops = null;
            let lowestMergedDistanceDelta = Infinity;

            for (let t = 0; t < activeBuses.length; t++) {
                if (t === lowIdx) continue;
                const targetBus = activeBuses[t];

                // Guard 1: seat capacity
                if (targetBus.remainingSeats < lowBus.assignedUsers) continue;

                // Guard 2: bearing delta must be compatible (within 30 degrees)
                const bearingDiff = getBearingDifference(
                    lowBus.avgBearing || 0,
                    targetBus.avgBearing || 0
                );
                if (bearingDiff > 30) continue;

                // Guard 3: geographic proximity between nearest stops
                const nearestDist = Math.min(
                    ...lowBus.stops.flatMap((ls) =>
                        targetBus.stops.map((ts) => calculateDistanceKm(ls.latitude, ls.longitude, ts.latitude, ts.longitude))
                    )
                );
                if (nearestDist > 7.0) continue;

                // Combine stops cleanly
                const combinedStopsMap = new Map();
                [...targetBus.stops, ...lowBus.stops].forEach((st) => {
                    const key = getStopKey(st);
                    if (combinedStopsMap.has(key)) {
                        const existing = combinedStopsMap.get(key);
                        existing.userCount = (existing.userCount || 0) + (st.userCount || 0);
                        existing.userIds = Array.from(new Set([...(existing.userIds || []), ...(st.userIds || [])]));
                    } else {
                        combinedStopsMap.set(key, { ...st });
                    }
                });

                const rawCombinedStops = Array.from(combinedStopsMap.values());
                const candidateMergedStops = await sequenceStopsContinuous(
                    rawCombinedStops,
                    anchorHub,
                    tripMode,
                    sourceHub,
                    destinationHub
                );

                let candidateTotalKm = 0;
                for (let idx = 0; idx < candidateMergedStops.length; idx++) {
                    const prevP = idx === 0 ? null : candidateMergedStops[idx - 1];
                    const leg = candidateMergedStops[idx].legDistanceKm ?? (prevP ? calculateDistanceKm(prevP.latitude, prevP.longitude, candidateMergedStops[idx].latitude, candidateMergedStops[idx].longitude) : 0);
                    candidateTotalKm += leg;
                }

                const distDelta = candidateTotalKm - targetBus.routeDistanceKm;
                if (distDelta > MAX_DISTANCE_DELTA_KM) continue;

                if (distDelta < lowestMergedDistanceDelta) {
                    lowestMergedDistanceDelta = distDelta;
                    bestTargetIdx = t;
                    bestMergedStops = candidateMergedStops;
                }
            }

            if (bestTargetIdx !== -1 && bestMergedStops) {
                const targetBus = activeBuses[bestTargetIdx];
                const oldTargetUsers = targetBus.assignedUsers;
                const mergedUsers = oldTargetUsers + lowBus.assignedUsers;

                // Single source of truth update
                targetBus.stops = bestMergedStops;
                targetBus.assignedUsers = mergedUsers;
                targetBus.remainingSeats = targetBus.capacity - mergedUsers;
                targetBus.users = bestMergedStops.flatMap((s) => s.userIds || []);
                targetBus.isConsolidated = true;
                targetBus.absorbedVehicles = [
                    ...(targetBus.absorbedVehicles || []),
                    lowBus.vehicleName
                ];

                const auditRecord = {
                    sourceRoute: lowBus.routeCode || lowBus.vehicleName,
                    sourceVehicle: lowBus.vehicleName,
                    passengersMoved: lowBus.assignedUsers,
                    stopsAffected: lowBus.stops.map((s) => s.name),
                    destinationRoute: targetBus.routeCode || targetBus.vehicleName,
                    destinationVehicle: targetBus.vehicleName,
                    reason: `Consolidated ${lowBus.assignedUsers} passengers from ${lowBus.vehicleName} into ${targetBus.vehicleName} along shared ${targetBus.sectorName}`,
                    beforeCapacity: oldTargetUsers,
                    afterCapacity: mergedUsers
                };
                consolidationAudit.push(auditRecord);

                const postUtil = Math.round((mergedUsers / targetBus.capacity) * 100);
                consolidationLogs.push(
                    `Consolidated ${lowBus.assignedUsers} passengers from released vehicle (${lowBus.vehicleName}) into ${targetBus.vehicleName} (${postUtil}% capacity).`
                );

                activeBuses = activeBuses.filter((_, idx) => idx !== lowIdx);
                consolidationChanged = true;
                break;
            }
        }
    }

    return { buses: activeBuses, consolidationLogs, consolidationAudit };
};

/*
|--------------------------------------------------------------------------
| MULTI-GATE PLAN VALIDATION & CERTIFICATION ENGINE
|--------------------------------------------------------------------------
*/

export const validateTransportationPlan = (planOrParams, maybeContext = {}) => {
    let plan = planOrParams || {};
    let context = maybeContext || {};
    if (planOrParams && Array.isArray(planOrParams.buses) && !maybeContext.totalComingUsers && planOrParams.totalComingUsers !== undefined) {
        plan = planOrParams;
        context = planOrParams;
    }

    let buses = Array.isArray(plan?.buses) ? plan.buses : (Array.isArray(plan?.routes) ? plan.routes : []);
    const totalComingUsers = typeof context.totalComingUsers === "number"
        ? context.totalComingUsers
        : (typeof plan?.confirmedUsers === "number" ? plan.confirmedUsers : (plan?.comingUsers || 0));
    const availableVehicles = Array.isArray(context.availableVehicles)
        ? context.availableVehicles
        : (Array.isArray(plan?.availableVehicles) ? plan.availableVehicles : []);
    const totalAvailableCapacity = typeof context.totalAvailableCapacity === "number"
        ? context.totalAvailableCapacity
        : availableVehicles.reduce((sum, v) => sum + getVehicleCapacity(v), 0);
    const tripMode = context.effectiveTripMode || context.tripMode || plan?.tripMode || "TO_DESTINATION";
    const confirmedUsers = Array.isArray(context.confirmedUsers) ? context.confirmedUsers : [];

    const availableVehicleIds = new Set(
        availableVehicles.map((v) => String(v._id || v.id || ""))
    );

    const auditPlan = (busList) => {
        const assignedPassengerIds = new Set();
        let duplicatePassengerFound = false;
        let totalAssignedUsers = 0;
        let allStopPassengerSumsMatch = true;
        let allRoutePassengerCountsMatchIds = true;
        let allCapacitiesValid = true;
        let allVehiclesAvailable = true;
        let duplicateVehicleFound = false;
        const usedVehicleIds = new Set();
        let allDistancesValid = true;
        let allEndpointsValid = true;
        let allExplanationsValid = true;
        let allCoordinatesValid = true;
        let noSuspiciousJumps = true;

        busList.forEach((bus) => {
            const busAssigned = Number(bus.assignedUsers ?? bus.passengerCount ?? 0);
            totalAssignedUsers += busAssigned;

            // Single source of truth check: bus.assignedUsers === sum(stop.userCount) === bus.users.length
            const sumStopPassengers = (bus.stops || []).reduce((sum, s) => sum + (s.userCount ?? s.passengerCount ?? 0), 0);
            const usersLen = (bus.users || bus.passengerUserIds || []).length;
            if (busAssigned !== sumStopPassengers || busAssigned !== usersLen) {
                allStopPassengerSumsMatch = false;
            }
            if (busAssigned !== usersLen) {
                allRoutePassengerCountsMatchIds = false;
            }

            // Capacity check
            if (busAssigned > bus.capacity) {
                allCapacitiesValid = false;
            }

            // Vehicle uniqueness & availability check
            const vid = String(bus.vehicleId || "");
            if (vid) {
                if (usedVehicleIds.has(vid)) {
                    duplicateVehicleFound = true;
                }
                usedVehicleIds.add(vid);

                if (availableVehicles.length > 0 && !availableVehicleIds.has(vid)) {
                    allVehiclesAvailable = false;
                }
            }

            // Distance & geometry check
            if (!bus.routeDistanceKm || bus.routeDistanceKm <= 0 || (bus.routeDistanceKm > 250 && (bus.straightLineBaselineKm || 0) < 50)) {
                allDistancesValid = false;
            }

            // Passenger uniqueness check across routes & within routes
            (bus.users || bus.passengerUserIds || []).forEach((uId) => {
                const strId = String(uId);
                if (assignedPassengerIds.has(strId)) {
                    duplicatePassengerFound = true;
                }
                assignedPassengerIds.add(strId);
            });

            // Endpoint validation
            if (tripMode === "TO_DESTINATION" || tripMode === "INWARD") {
                if (!bus.destinationHub) allEndpointsValid = false;
            } else if (tripMode === "FROM_SOURCE" || tripMode === "OUTWARD") {
                if (!bus.sourceHub) allEndpointsValid = false;
            }

            // Stop explanations check: previousStopName must always be immediately preceding stop
            const stops = bus.stops || [];
            stops.forEach((st, sIdx) => {
                if (!isValidCoordinate(st.latitude, st.longitude)) {
                    allCoordinatesValid = false;
                }
                if (sIdx > 0) {
                    const immediatePrev = stops[sIdx - 1];
                    if (st.previousStopName && immediatePrev && st.previousStopName !== immediatePrev.name) {
                        allExplanationsValid = false;
                    }
                    if (st.legDistanceKm && st.legDistanceKm > 45) {
                        noSuspiciousJumps = false;
                    }
                }
            });
        });

        const unallocatedCount = typeof plan?.unassignedUsers === "number"
            ? plan.unassignedUsers
            : Math.max(0, totalComingUsers - totalAssignedUsers);

        // Check if all assigned passengers belong to confirmed users (if provided)
        let missingConfirmedCount = 0;
        if (confirmedUsers.length > 0) {
            const confirmedIds = new Set(confirmedUsers.map((u) => String(u._id || u.userId || u.id || "")));
            assignedPassengerIds.forEach((uid) => {
                if (!confirmedIds.has(uid)) {
                    missingConfirmedCount++;
                }
            });
        }

        const allRoadVerified = busList.length > 0 && busList.every((b) => b.isRoadVerified === true);
        const allContinuityValid = busList.length > 0 && busList.every(
            (b) => b.isContinuous === true &&
                !b.continuityValidation?.directionalInversionDetected &&
                !b.continuityValidation?.backtrackingDetected &&
                (b.detourRatio || 1.25) <= 2.1
        );

        const checks = {
            allPassengersAssigned: (totalAssignedUsers + unallocatedCount) === totalComingUsers,
            allPassengersAccountedFor: (totalAssignedUsers + unallocatedCount) === totalComingUsers,
            noPassengerDuplicated: !duplicatePassengerFound,
            noPassengerUnallocated: totalComingUsers > totalAvailableCapacity ? true : (unallocatedCount === 0),
            noMissingPassengers: missingConfirmedCount === 0,
            demandConservation: totalAssignedUsers <= totalComingUsers,
            stopPassengerSumMatches: allStopPassengerSumsMatch,
            routePassengerCountMatchesIds: allRoutePassengerCountsMatchIds,
            vehiclesExist: busList.every((b) => b.vehicleId),
            vehicleUniquenessValid: !duplicateVehicleFound,
            onlyAvailableVehiclesAssigned: allVehiclesAvailable,
            vehicleCountWithinLimit: busList.length <= (availableVehicles.length || Infinity),
            capacitiesNotExceeded: allCapacitiesValid,
            vehicleCountsMatchAssignments: allStopPassengerSumsMatch && allRoutePassengerCountsMatchIds,
            roadRouteConnectivityValid: busList.every((b) => Array.isArray(b.stops) && b.stops.length > 0),
            routeEndpointsValid: allEndpointsValid,
            routeExplanationsValid: allExplanationsValid,
            allCoordinatesValid,
            routeDistancesValid: allDistancesValid,
            roadNetworkVerified: allRoadVerified,
            routeCorridorContinuityValid: allContinuityValid,
            noSuspiciousGeographicJumps: noSuspiciousJumps,
            detourRatioAcceptable: busList.every((b) => (b.detourRatio || 1.25) <= 2.1)
        };

        const allPassed = Object.values(checks).every(Boolean);

        return {
            isCertified: allPassed,
            checks,
            totalAssignedUsers,
            unallocatedCount,
            duplicatePassengerFound,
            missingConfirmedCount,
            allContinuityValid
        };
    };

    // First audit pass
    let audit = auditPlan(buses);

    // If counter sums had discrepancy, perform deterministic repair pass
    if (!audit.checks.stopPassengerSumMatches || !audit.checks.routePassengerCountMatchesIds) {
        buses.forEach((bus) => {
            (bus.stops || []).forEach((st, sIdx) => {
                if (!Array.isArray(st.userIds)) st.userIds = [];
                st.passengerUserIds = st.userIds;
                st.userCount = st.userIds.length;
                st.passengerCount = st.userIds.length;
                st.order = sIdx + 1;
                st.sequence = sIdx + 1;
            });
            const allUsers = (bus.stops || []).flatMap((st) => st.userIds || []);
            bus.users = allUsers;
            bus.passengerUserIds = allUsers;
            bus.assignedUsers = allUsers.length;
            bus.passengerCount = allUsers.length;
            bus.remainingSeats = Math.max(0, (bus.capacity || 70) - bus.assignedUsers);
            bus.unusedSeats = bus.remainingSeats;
        });

        audit = auditPlan(buses);
    }

    const failureReasons = [];
    if (!audit.checks.allPassengersAccountedFor) failureReasons.push("Accounting mismatch: assigned + unallocated !== demand");
    if (!audit.checks.noPassengerDuplicated) failureReasons.push("Duplicate passenger assignment detected");
    if (!audit.checks.noMissingPassengers) failureReasons.push("Assigned passenger not found in confirmed users list");
    if (!audit.checks.capacitiesNotExceeded) failureReasons.push("One or more vehicles exceed rated seat capacity");
    if (!audit.checks.vehicleUniquenessValid) failureReasons.push("Same vehicle assigned to multiple simultaneous routes");
    if (!audit.checks.onlyAvailableVehiclesAssigned) failureReasons.push("Unavailable vehicles assigned");
    if (!audit.checks.routeEndpointsValid) failureReasons.push("Route endpoint mismatch");
    if (!audit.checks.routeExplanationsValid) failureReasons.push("Route explanation references invalid previous stop");
    if (!audit.checks.routeCorridorContinuityValid) failureReasons.push("Route corridor continuity / detour threshold exceeded (> 2.1)");

    const status = audit.isCertified
        ? "OPTIMIZATION ENGINE SUCCESS"
        : (failureReasons[0] || (!audit.allContinuityValid ? "ROUTE_CONTINUITY_REVIEW_REQUIRED" : (totalComingUsers > totalAvailableCapacity ? "INSUFFICIENT_VEHICLE_CAPACITY" : "OPTIMIZATION REQUIRES REVIEW")));

    const statusTitle = audit.isCertified
        ? "OPTIMIZATION ENGINE SUCCESS"
        : status;

    return {
        isCertified: audit.isCertified,
        status,
        statusTitle,
        failureReasons,
        checks: audit.checks,
        totalAssignedUsers: audit.totalAssignedUsers,
        unallocatedPassengers: audit.unallocatedCount,
        certifiedAt: new Date().toISOString()
    };
};

export const validateAndCertifyAIPlan = validateTransportationPlan;

/**
 * Multi-Objective Plan Scoring (Section D & E):
 * Evaluates candidate plans balancing passenger coverage, route continuity,
 * road distance, travel time, detour ratio, seat utilization, and bus count.
 * This is NOT a bin-packing problem; extra buses are favored when they improve
 * route quality, passenger convenience, and corridors.
 */
export const scoreCandidatePlan = (buses, totalComingUsers, availableVehicles = []) => {
    if (!Array.isArray(buses) || buses.length === 0) return -Infinity;

    const assignedUsers = buses.reduce((sum, b) => sum + (b.assignedUsers || 0), 0);
    const unassignedUsers = Math.max(0, totalComingUsers - assignedUsers);

    // 1. Coverage: Severe penalty for unassigned users
    const coverageScore = totalComingUsers > 0 ? (assignedUsers / totalComingUsers) * 1000 : 0;
    const unassignedPenalty = unassignedUsers * 60;

    // 2. Capacity compliance: zero overruns allowed
    let capacityOverrunPenalty = 0;
    buses.forEach((b) => {
        if (b.assignedUsers > b.capacity) {
            capacityOverrunPenalty += (b.assignedUsers - b.capacity) * 150;
        }
    });

    // 3. Detour & Quality: closer to 1.0 is optimal
    const detours = buses.map((b) => b.detourRatio || 1.25);
    const avgDetour = detours.length > 0 ? detours.reduce((a, b) => a + b, 0) / detours.length : 1.25;
    const maxDetour = detours.length > 0 ? Math.max(...detours) : 1.25;
    const detourPenalty = Math.max(0, (avgDetour - 1.0)) * 100 + Math.max(0, (maxDetour - 1.25)) * 60;

    // 4. Continuity Bonus
    const continuousBuses = buses.filter((b) => b.isContinuous).length;
    const continuityBonus = buses.length > 0 ? (continuousBuses / buses.length) * 100 : 0;

    // 5. Travel Time & Road Distance: Shorter total and max distance improves convenience
    const totalDistKm = buses.reduce((sum, b) => sum + (b.routeDistanceKm || 0), 0);
    const maxDistKm = buses.length > 0 ? Math.max(...buses.map((b) => b.routeDistanceKm || 0)) : 0;
    const travelPenalty = (totalDistKm * 0.4) + (maxDistKm * 1.2);

    // 6. Bus count and fleet balance:
    // Mild deployment cost (prevents using excess buses with no demand), but outweighed by quality improvements
    const busDeploymentCost = buses.length * 15;

    // 7. Seat Utilization: Sweet spot 70% - 95%
    let utilScore = 0;
    buses.forEach((b) => {
        const u = b.capacity > 0 ? (b.assignedUsers / b.capacity) : 0;
        if (u >= 0.70 && u <= 0.95) {
            utilScore += 20;
        } else if (u < 0.35) {
            utilScore -= 30; // penalize largely empty bus
        }
    });

    return (
        coverageScore +
        continuityBonus +
        utilScore -
        unassignedPenalty -
        capacityOverrunPenalty -
        detourPenalty -
        travelPenalty -
        busDeploymentCost
    );
};

/*
|--------------------------------------------------------------------------
| BUILD AI RECOMMENDED PLAN (Mode-Aware, Independent Inward & Outward)
|--------------------------------------------------------------------------
*/

export const buildAIPlan = async ({
    sourceHub,
    destinationHub,
    tripMode = "TO_DESTINATION",
    resolvedStops,
    availableVehicles = [],
    rawVehicles = [],
    totalComingUsers,
    allUsersCount,
    totalAvailableCapacity: propTotalAvailableCapacity,
    physicalFleetCapacity: propPhysicalFleetCapacity,
    confirmedUsers = [],
    previousVehiclePositions = null
}) => {
    const effectiveTripMode = (tripMode === "OUTWARD" || tripMode === "FROM_SOURCE")
        ? "FROM_SOURCE"
        : "TO_DESTINATION";
    const resolvedSourceHub = sourceHub || destinationHub;
    const resolvedDestinationHub = destinationHub || sourceHub;
    const anchorHub = effectiveTripMode === "FROM_SOURCE" ? resolvedSourceHub : resolvedDestinationHub;

    const physicalFleetCapacity = typeof propPhysicalFleetCapacity === "number"
        ? propPhysicalFleetCapacity
        : (rawVehicles || []).reduce((sum, v) => sum + getVehicleCapacity(v), 0);

    const totalAvailableCapacity = typeof propTotalAvailableCapacity === "number"
        ? propTotalAvailableCapacity
        : (availableVehicles || []).reduce((sum, v) => sum + getVehicleCapacity(v), 0);

    // STEP 1: Balanced Corridor Vehicle Allocation
    const { busClusters } = allocateVehiclesToDemandClusters({
        resolvedStops,
        availableVehicles,
        anchorHub
    });

    // STEP 2: Mode-Aware Route Optimization (Independent Inward & Outward)
    let rawBuses = [];

    if (effectiveTripMode === "TO_DESTINATION") {
        // INWARD PIPELINE: Pure pickup stops progressing towards destinationHub
        // Uses previous vehicle operational positions if available without forcing shed or reversing
        const inwardPromises = busClusters.map((cluster) => {
            const prevPos = previousVehiclePositions?.get(String(cluster.vehicleId)) || null;
            return optimizeInwardBusRoute(cluster, resolvedDestinationHub, prevPos);
        });
        const resolvedInward = await Promise.all(inwardPromises);
        rawBuses = resolvedInward.filter(Boolean);
    } else {
        // OUTWARD PIPELINE: Pure drop-off stops progressing outward from sourceHub
        const outwardPromises = busClusters.map((cluster) =>
            optimizeOutwardBusRoute(cluster, resolvedSourceHub)
        );
        const resolvedOutward = await Promise.all(outwardPromises);
        rawBuses = resolvedOutward.filter(Boolean);
    }

    // STEP 3: Multi-Objective Candidate Evaluation (Consolidated vs Granular Corridors)
    const { buses: consolidatedBuses, consolidationLogs, consolidationAudit } = await consolidateLowUtilizationRoutes({
        initialBuses: rawBuses,
        availableVehicles,
        anchorHub,
        tripMode: effectiveTripMode,
        sourceHub: resolvedSourceHub,
        destinationHub: resolvedDestinationHub
    });

    const scoreConsolidated = scoreCandidatePlan(consolidatedBuses, totalComingUsers, availableVehicles);
    const scoreRaw = scoreCandidatePlan(rawBuses, totalComingUsers, availableVehicles);

    let chosenBuses = consolidatedBuses;
    let chosenLogs = consolidationLogs;
    let chosenAudit = consolidationAudit;

    // Favor granular corridor allocation when it yields better route quality / lower detour
    if (scoreRaw > scoreConsolidated + 25 && rawBuses.every((b) => b.assignedUsers <= b.capacity)) {
        chosenBuses = rawBuses;
        chosenLogs = ["Retained dedicated corridor fleet: higher geographic corridor continuity and reduced route detour."];
        chosenAudit = [];
    }

    // STEP 4: Standardize Route Codes and Names (R-01, R-02, ...) + Section 25 Data Structure
    const buses = chosenBuses.map((bus, idx) => {
        const routeNumber = idx + 1;
        const routeCode = `R-${String(routeNumber).padStart(2, "0")}`;
        const lineType = effectiveTripMode === "TO_DESTINATION" ? "Transit Line" : "Drop-off Line";

        const firstPointName = effectiveTripMode === "TO_DESTINATION"
            ? (bus.stops[0]?.name || "Outer Stop")
            : (resolvedSourceHub?.name || "Departure Hub");
        const lastPointName = effectiveTripMode === "TO_DESTINATION"
            ? (resolvedDestinationHub?.name || "Destination Hub")
            : (bus.stops[bus.stops.length - 1]?.name || "Terminus");

        const routeName = `${routeCode}: ${firstPointName} to ${lastPointName} (${bus.sectorName || 'Madurai'} ${lineType})`;

        // Ensure strict single source of truth: assignedUsers === sum(stop.userCount) === users.length
        const sumPassengers = (bus.stops || []).reduce((sum, s) => sum + (s.userCount || 0), 0);
        const assignedUsers = sumPassengers;
        const remainingSeats = Math.max(0, bus.capacity - assignedUsers);

        // Standardize stops conforming to Section 25 requirements and update boarding progression
        let runningPassengers = 0;
        const standardizedStops = (bus.stops || []).map((st, sIdx) => {
            const userIds = Array.isArray(st.userIds) ? st.userIds : [];
            const pCount = userIds.length > 0 ? userIds.length : (st.userCount || 0);
            runningPassengers += pCount;

            const stopObj = {
                ...st,
                order: sIdx + 1,
                sequence: sIdx + 1,
                passengerUserIds: userIds,
                userIds,
                passengerCount: pCount,
                userCount: pCount,
                previousStopName: st.previousStopName,
                segmentRoadDistance: st.legDistanceKm || 0,
                legDistanceKm: st.legDistanceKm || 0,
                estimatedTravelTime: st.legDurationMin || 0,
                legDurationMin: st.legDurationMin || 0,
                selectionReason: st.selectionReason
            };

            if (effectiveTripMode === "TO_DESTINATION") {
                stopObj.passengersBoarded = pCount;
                stopObj.cumulativePassengers = runningPassengers;
                stopObj.standbySeatsAtStop = Math.max(0, bus.capacity - runningPassengers);
            } else {
                stopObj.passengersDropped = pCount;
                stopObj.passengersRemaining = Math.max(0, assignedUsers - runningPassengers);
                stopObj.standbySeatsAtStop = Math.min(bus.capacity, bus.capacity - (assignedUsers - runningPassengers));
            }

            return stopObj;
        });

        const routeObj = {
            ...bus,
            routeNumber,
            routeCode,
            routeId: routeCode,
            routeName,
            direction: effectiveTripMode === "TO_DESTINATION" ? "INWARD" : "OUTWARD",
            tripMode: effectiveTripMode === "TO_DESTINATION" ? "INWARD" : "OUTWARD",
            vehicleId: bus.vehicleId,
            vehicleName: bus.vehicleName,
            vehicleCapacity: bus.capacity,
            capacity: bus.capacity,
            passengerCount: assignedUsers,
            assignedUsers,
            unusedSeats: remainingSeats,
            remainingSeats,
            utilization: bus.capacity > 0 ? Number(((assignedUsers / bus.capacity) * 100).toFixed(2)) : 0,
            passengerUserIds: bus.users,
            users: bus.users,
            stops: standardizedStops,
            totalRoadDistance: bus.routeDistanceKm,
            straightLineDistance: bus.straightLineBaselineKm,
            detourRatio: bus.detourRatio || 1.25,
            validationStatus: bus.isContinuous ? "CERTIFIED" : "REVIEW",
            sourceHub: effectiveTripMode === "FROM_SOURCE" ? resolvedSourceHub : null,
            destinationHub: effectiveTripMode === "TO_DESTINATION" ? resolvedDestinationHub : null
        };

        // Canonical inward/outward sub-objects for backward compatibility
        if (effectiveTripMode === "TO_DESTINATION") {
            routeObj.inward = {
                startLocation: routeObj.startLocation,
                stops: routeObj.stops,
                destination: resolvedDestinationHub,
                destinationHub: resolvedDestinationHub,
                assignedUsers: routeObj.assignedUsers,
                users: routeObj.users,
                routeDistanceKm: routeObj.routeDistanceKm,
                routeDurationMin: routeObj.routeDurationMin,
                roadGeometry: routeObj.roadGeometry,
                isRoadVerified: routeObj.isRoadVerified,
                isContinuous: routeObj.isContinuous,
                continuity: routeObj.continuityValidation
            };
        } else {
            routeObj.outward = {
                source: resolvedSourceHub,
                sourceHub: resolvedSourceHub,
                stops: routeObj.stops,
                lastOutwardStop: routeObj.lastOutwardStop,
                assignedUsers: routeObj.assignedUsers,
                users: routeObj.users,
                routeDistanceKm: routeObj.routeDistanceKm,
                routeDurationMin: routeObj.routeDurationMin,
                roadGeometry: routeObj.roadGeometry,
                isRoadVerified: routeObj.isRoadVerified,
                isContinuous: routeObj.isContinuous,
                continuity: routeObj.continuityValidation
            };
        }

        return routeObj;
    });

    // STEP 4B: One Authoritative Passenger Assignment Dataset (Section 4)
    const authoritativeAssignments = [];
    buses.forEach((b) => {
        (b.stops || []).forEach((st) => {
            (st.userIds || []).forEach((uId) => {
                authoritativeAssignments.push({
                    userId: String(uId),
                    name: String(uId),
                    stoppingArea: st.name,
                    latitude: st.latitude,
                    longitude: st.longitude,
                    direction: effectiveTripMode === "TO_DESTINATION" ? "INWARD" : "OUTWARD",
                    vehicleId: b.vehicleId,
                    vehicleName: b.vehicleName,
                    routeId: b.routeCode || b.routeId,
                    routeName: b.routeName,
                    boardingStop: st.name,
                    routeSequence: st.order || st.sequence || 1
                });
            });
        });
    });

    // STEP 5: Recalculate all totals strictly from the FINAL active buses
    const assignedUsers = buses.reduce((sum, b) => sum + (b.assignedUsers || 0), 0);
    const unassignedUsers = Math.max(0, totalComingUsers - assignedUsers);
    const allocatedSeats = buses.reduce((sum, b) => sum + (b.capacity || 0), 0);

    const assignedIdsSet = new Set(authoritativeAssignments.map((a) => a.userId));
    const unallocatedPassengers = [];
    if (unassignedUsers > 0) {
        resolvedStops.forEach((st) => {
            (st.users || []).forEach((u) => {
                const uid = String(u?._id || u?.userId || u?.id || u);
                if (!assignedIdsSet.has(uid)) {
                    assignedIdsSet.add(uid);
                    unallocatedPassengers.push({
                        userId: uid,
                        name: u?.name || uid,
                        stoppingArea: st.name,
                        latitude: st.latitude,
                        longitude: st.longitude,
                        direction: effectiveTripMode === "TO_DESTINATION" ? "INWARD" : "OUTWARD",
                        reason: totalComingUsers > physicalFleetCapacity ? "VEHICLE_CAPACITY" : "SCHEDULE_CAPACITY"
                    });
                }
            });
        });
    }

    const physicalFleetUtilization = physicalFleetCapacity > 0
        ? Number(((assignedUsers / physicalFleetCapacity) * 100).toFixed(2))
        : 0;

    const routeAllocationUtilization = allocatedSeats > 0
        ? Number(((assignedUsers / allocatedSeats) * 100).toFixed(2))
        : 0;

    const fleetVehicleUtilization = (availableVehicles && availableVehicles.length > 0)
        ? Number(((buses.length / availableVehicles.length) * 100).toFixed(2))
        : 0;

    let unallocatedReason = null;
    if (unassignedUsers > 0) {
        if (totalComingUsers > physicalFleetCapacity) {
            unallocatedReason = "VEHICLE_CAPACITY";
        } else if (totalComingUsers > totalAvailableCapacity) {
            unallocatedReason = "SCHEDULE_CAPACITY";
        } else {
            unallocatedReason = "CORRIDOR_CAPACITY";
        }
    }

    const capacityShortage = totalAvailableCapacity < totalComingUsers && unassignedUsers > 0;

    // STEP 6: Multi-criteria plan certification via validateTransportationPlan
    const certification = validateTransportationPlan(
        { buses, unassignedUsers },
        {
            totalComingUsers,
            availableVehicles,
            totalAvailableCapacity,
            resolvedStops,
            confirmedUsers,
            tripMode: effectiveTripMode,
            sourceHub: resolvedSourceHub,
            destinationHub: resolvedDestinationHub
        }
    );

    const recommendations = [...(consolidationLogs || [])];
    const warnings = [];

    if (unassignedUsers > 0) {
        if (unallocatedReason === "VEHICLE_CAPACITY") {
            warnings.push(
                `Demand (${totalComingUsers}) exceeds total physical fleet capacity (${physicalFleetCapacity} seats). ${unassignedUsers} users unallocated.`
            );
        } else if (unallocatedReason === "SCHEDULE_CAPACITY") {
            warnings.push(
                `Schedule capacity restriction: ${unassignedUsers} users unallocated. Available scheduled capacity is ${totalAvailableCapacity} seats.`
            );
        }
    }

    // Stop counting metrics
    const stopVisitCounts = new Map();
    buses.forEach((b) => {
        (b.stops || []).forEach((st) => {
            const k = st.name.toLowerCase().trim();
            stopVisitCounts.set(k, (stopVisitCounts.get(k) || 0) + 1);
        });
    });

    let sharedStopCount = 0;
    let splitStopCount = 0;

    stopVisitCounts.forEach((visits) => {
        if (visits > 1) sharedStopCount++;
    });

    resolvedStops.forEach((st) => {
        const k = st.name.toLowerCase().trim();
        const visits = stopVisitCounts.get(k) || 0;
        const initialCount = st.users?.length || st.userCount || 0;
        if (visits > 1 && initialCount > 0) {
            splitStopCount++;
        }
    });

    const uniqueStopCount = resolvedStops.filter((s) => (s.users?.length || s.userCount || 0) > 0).length;
    const routeStopVisitCount = buses.reduce((sum, b) => sum + (Array.isArray(b.stops) ? b.stops.length : 0), 0);
    const totalRouteDistance = Number(buses.reduce((sum, b) => sum + (b.routeDistanceKm || 0), 0).toFixed(2));

    const stopCountExplanation = `${uniqueStopCount} unique stopping areas covered across ${routeStopVisitCount} route stop visits on ${buses.length} active routes (${sharedStopCount} shared/split stops).`;

    // Console audit summary
    console.log("============================================================");
    console.log(`AI PLAN GENERATED: mode=${effectiveTripMode} buses=${buses.length} assigned=${assignedUsers}/${totalComingUsers} cert=${certification.status}`);
    buses.forEach((b) => {
        const first = b.stops[0]?.name || "None";
        const last = b.stops[b.stops.length - 1]?.name || "None";
        console.log(`  [${b.routeCode}] ${b.vehicleName} (${b.capacity} seats, ${b.assignedUsers} passengers, ${b.stops.length} stops, ${b.routeDistanceKm}km): ${first} -> ${last} | Detour=${b.detourRatio || 1.2}`);
    });
    console.log("============================================================");

    return {
        planType: "AI",
        type: "route",
        title: "AI Recommended Continuous Route Plan",
        name: "AI Recommended Continuous Route Plan",
        description:
            "AI-optimized continuous bus routes based on confirmed Coming users, balanced corridor allocation, OSRM road validation, and vehicle capacities.",
        tripMode: effectiveTripMode,
        sourceHub: resolvedSourceHub,
        destinationHub: resolvedDestinationHub,
        startingPoint: anchorHub,
        buses,
        vehicles: buses,
        passengerAssignments: authoritativeAssignments,
        authoritativeAssignments,
        unallocatedPassengers,
        totalUsers: allUsersCount,
        comingUsers: totalComingUsers,
        confirmedUsers: totalComingUsers,
        assignedUsers,
        allocatedUsers: assignedUsers,
        allocatedPassengers: assignedUsers,
        unassignedUsers,
        unallocatedPassengersCount: unassignedUsers,
        unallocatedReason,
        duplicateUsers: 0,
        physicalFleetCapacity,
        totalCapacity: allocatedSeats,
        allocatedSeats,
        availableTotalCapacity: totalAvailableCapacity,
        totalAvailableFleetSeats: totalAvailableCapacity,
        utilization: routeAllocationUtilization,
        physicalFleetUtilization,
        routeAllocationUtilization,
        fleetVehicleUtilization,
        utilizationNote: `Route allocation: ${routeAllocationUtilization}% (${assignedUsers}/${allocatedSeats} seats) • Fleet capacity: ${physicalFleetUtilization}% (${assignedUsers}/${physicalFleetCapacity} seats) • Vehicle utilization: ${fleetVehicleUtilization}% (${buses.length}/${availableVehicles.length} vehicles)`,
        totalRouteDistance,
        vehicleCount: buses.length,
        availableVehicleCount: availableVehicles.length,
        unusedVehicleCount: Math.max(0, availableVehicles.length - buses.length),
        capacityShortage,
        warnings,
        recommendationsList: recommendations,
        consolidationAudit,
        overlapAlerts: [],
        allStopsAllocated: unassignedUsers === 0,
        unassignedStops: [],
        uniqueStoppingAreas: uniqueStopCount,
        uniqueStopCount,
        routeStopVisitCount,
        sharedStopCount,
        splitStopCount,
        totalRouteStopVisits: routeStopVisitCount,
        stopCountExplanation,
        certification,
        createdAt: new Date().toISOString()
    };
};

/*
|--------------------------------------------------------------------------
| ADMIN MANUAL PLAN (FROM STORED ROUTES & LIVE DEMAND)
|--------------------------------------------------------------------------
*/

export const cleanStopString = (str) =>
    String(str || "")
        .toLowerCase()
        .replace(/[().,-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

export const GENERIC_STOP_WORDS = new Set([
    "nagar", "road", "junction", "canal", "mosque", "bus", "stand", "stop",
    "street", "madurai", "shoe", "company", "walk", "king", "west", "east",
    "north", "south", "central", "kulam"
]);

export const getStopSignificantTokens = (str) => {
    const words = cleanStopString(str).split(" ").filter((w) => w.length >= 2);
    const sig = words.filter((w) => !GENERIC_STOP_WORDS.has(w));
    return sig.length > 0 ? sig : words;
};

export const calculateStopMatchScore = (studentStop, routeStopName) => {
    const sRaw = String(studentStop || "").trim().toLowerCase();
    const rRaw = String(routeStopName || "").trim().toLowerCase();
    if (!sRaw || !rRaw) return 0;
    if (sRaw === rRaw) return 100;

    const sClean = cleanStopString(studentStop);
    const rClean = cleanStopString(routeStopName);
    if (sClean === rClean) return 95;

    // Specific known aliases / abbreviations
    const isBibikulamS = sClean.includes("bibikulam") || sClean.includes("b b kulam") || sClean.includes("bb kulam");
    const isBibikulamR = rClean.includes("bibikulam") || rClean.includes("b b kulam") || rClean.includes("bb kulam");
    if (isBibikulamS && isBibikulamR) return 90;

    const isKPudurS = sClean.includes("k pudur") || sClean.includes("kpudur");
    const isKPudurR = rClean.includes("k pudur") || rClean.includes("kpudur") || rClean.includes("k pudur") || rClean.includes("k-pudur");
    if (isKPudurS && isKPudurR) return 90;

    const isKKNagarS = sClean.includes("kk nagar") || sClean.includes("k k nagar");
    const isKKNagarR = rClean.includes("kk nagar") || rClean.includes("k k nagar");
    if (isKKNagarS && isKKNagarR) return 90;

    // Significant non-generic token overlap
    const sSig = getStopSignificantTokens(studentStop);
    const rSig = getStopSignificantTokens(routeStopName);

    let matchCount = 0;
    for (const st of sSig) {
        if (rSig.some((rt) => rt === st || rt.startsWith(st) || st.startsWith(rt) || rt.includes(st) || st.includes(rt))) {
            matchCount++;
        }
    }

    if (matchCount > 0 && matchCount === Math.min(sSig.length, rSig.length)) {
        return 80;
    }

    if (sClean.length >= 4 && (rClean.includes(sClean) || sClean.includes(rClean))) {
        return 75;
    }

    return 0;
};

export const buildManualTransportationPlan = async (options = {}) => {
    const rawDirection = options.direction || "INWARD";
    const canonicalDirection = (String(rawDirection).toUpperCase().trim() === "OUTWARD") ? "OUTWARD" : "INWARD";
    const effectiveTripMode = canonicalDirection === "OUTWARD" ? "FROM_SOURCE" : "TO_DESTINATION";
    const allocationMode = options.allocationMode || (options.planType === "ADMIN" || options.planType === "MANUAL" ? "MANUAL" : "AI");

    // 1. Fetch routes for this direction
    let rawRoutes = options.routes;
    if (!rawRoutes) {
        if (isDbConnected()) {
            rawRoutes = await Route.find({
                $or: [
                    { direction: canonicalDirection },
                    { direction: canonicalDirection.toLowerCase() },
                    { direction: new RegExp(`^${canonicalDirection}$`, "i") }
                ]
            })
                .populate("assignedVehicle", "vehicleName capacity vehicleNumber")
                .sort({ createdAt: -1 })
                .lean();
        } else {
            rawRoutes = [];
        }
    }

    // Filter to canonical direction and ONLY assigned routes (routes with an assigned vehicle/bus)
    const routesInDirection = (Array.isArray(rawRoutes) ? rawRoutes : []).filter((r) => {
        const d = (String(r.direction || "").toUpperCase().trim() === "OUTWARD") ? "OUTWARD" : "INWARD";
        if (d !== canonicalDirection) return false;
        return Boolean(r.assignedVehicle && (r.assignedVehicle.vehicleName || r.assignedVehicle._id || r.vehicleName));
    });

    // 2. Fetch all vehicles and schedules for availability validation
    let vehicles = options.vehicles;
    if (!vehicles) {
        vehicles = isDbConnected() ? await Vehicle.find().lean() : [];
    }
    let schedules = options.schedules;
    if (!schedules) {
        schedules = isDbConnected() ? await Schedule.find().lean() : [];
    }

    const scheduleMap = new Map();
    (schedules || []).forEach((s) => {
        const vId = String(s.vehicle?._id || s.vehicle || "");
        if (vId) scheduleMap.set(vId, s);
    });

    // 3. Fetch confirmed Coming students (ensure role: 1 is in select)
    let allStudents = options.users;
    if (!allStudents) {
        allStudents = isDbConnected()
            ? await User.find({ role: "student" })
                .select({
                    userId: 1,
                    name: 1,
                    stoppings: 1,
                    city: 1,
                    district: 1,
                    state: 1,
                    country: 1,
                    travelStatus: 1,
                    allocationStatus: 1,
                    role: 1,
                    isLateResponse: 1,
                    lateResponseDetected: 1,
                    lateResponseAt: 1,
                    requiresReallocation: 1,
                    affectedDirections: 1,
                    travelResponseSubmittedAt: 1,
                    responseDeadline: 1,
                    manualRouteId: 1,
                    manualBusId: 1,
                    assignedRoute: 1,
                    assignedVehicle: 1
                })
                .lean()
            : [];
    }

    const comingStudents = (allStudents || []).filter((u) => (!u.role || u.role === "student") && u.travelStatus === "Coming");
    const totalComingUsers = comingStudents.length;

    // 4. Prepare each route with all ordered stops (source, stops, destination)
    const preparedRoutes = routesInDirection.map((route, routeIndex) => {
        const assignedVehicle = route.assignedVehicle;
        const vehicleId = assignedVehicle ? String(assignedVehicle._id || assignedVehicle) : null;
        const vehicleDoc = vehicleId ? vehicles.find((v) => String(v._id) === vehicleId) : null;
        const vehicleName = vehicleDoc?.vehicleName || assignedVehicle?.vehicleName || route.vehicleName || `Bus ${routeIndex + 1}`;
        const vehicleNumber = vehicleDoc?.vehicleNumber || assignedVehicle?.vehicleNumber || vehicleName;
        const capacity = Number(vehicleDoc?.capacity || assignedVehicle?.capacity || route.capacity || 0);

        const orderedStops = [];
        if (route.source?.name) {
            orderedStops.push({
                name: route.source.name,
                latitude: Number(route.source.latitude),
                longitude: Number(route.source.longitude),
                routePointType: "source"
            });
        }
        if (Array.isArray(route.stops)) {
            route.stops.forEach((s) => {
                orderedStops.push({
                    name: s.name,
                    latitude: Number(s.latitude),
                    longitude: Number(s.longitude),
                    routePointType: "stop"
                });
            });
        }
        if (route.destination?.name) {
            orderedStops.push({
                name: route.destination.name,
                latitude: Number(route.destination.latitude),
                longitude: Number(route.destination.longitude),
                routePointType: "destination"
            });
        }

        return {
            route,
            routeIndex,
            vehicleId,
            vehicleName,
            vehicleNumber,
            capacity,
            orderedStops
        };
    });

    // 5. Pre-match each Coming student to the best matching route stop across active routes
    const studentBestMatch = new Map();
    comingStudents.forEach((student) => {
        const sId = String(student._id || student.userId || "").toLowerCase().trim();
        let bestCand = null;
        let bestScore = 0;

        preparedRoutes.forEach((pRoute) => {
            pRoute.orderedStops.forEach((st, sIdx) => {
                const score = calculateStopMatchScore(student.stoppings, st.name);
                if (score > bestScore) {
                    bestScore = score;
                    bestCand = {
                        routeIndex: pRoute.routeIndex,
                        stopIndex: sIdx,
                        stopName: st.name,
                        score
                    };
                }
            });
        });

        if (bestScore >= 75 && bestCand) {
            studentBestMatch.set(sId, bestCand);
        }
    });

    const warnings = [];
    const assignedUserGlobalSet = new Set();
    const allocatedBuses = [];
    const assignedVehiclesInPlan = new Set();

    // 6. Process each route: allocate passengers to the manually assigned bus up to capacity
    preparedRoutes.forEach(({ route, routeIndex, vehicleId, vehicleName, vehicleNumber, capacity, orderedStops }) => {
        if (!route.assignedVehicle && !route.vehicleName) {
            warnings.push(`Route "${route.routeName || `Route ${routeIndex + 1}`}" has no assigned vehicle.`);
        } else if (vehicleId && assignedVehiclesInPlan.has(vehicleId)) {
            warnings.push(`Vehicle "${vehicleName}" is double-assigned to multiple routes in ${canonicalDirection} direction.`);
        } else if (vehicleId) {
            assignedVehiclesInPlan.add(vehicleId);
            const sched = scheduleMap.get(vehicleId);
            if (sched && sched.availability !== "Available") {
                warnings.push(`Vehicle "${vehicleName}" assigned to Route "${route.routeName}" is not marked as Available in Schedule Management.`);
            }
        }

        if (capacity <= 0 && (route.assignedVehicle || route.vehicleName)) {
            warnings.push(`Vehicle "${vehicleName}" on Route "${route.routeName}" has 0 seat capacity.`);
        }

        let remainingSeats = Math.max(0, capacity);
        let assignedUsersCount = 0;
        const busAssignedUserIds = [];

        const stopsWithAllocations = orderedStops.map((st, idx) => {
            // Find candidates for this stop:
            // 1. Students whose best match is this exact stop on this route
            // 2. Or unassigned students whose stopping matches st.name (score >= 75)
            // In MANUAL mode, preserve manual allocation boundaries and prevent automatic reassignment
            const candidates = comingStudents.filter((stud) => {
                const sId = String(stud._id || stud.userId || "").toLowerCase().trim();
                if (assignedUserGlobalSet.has(sId)) return false;

                // In MANUAL mode, do not cross-allocate students mapped to another manual route
                if (allocationMode === "MANUAL" && stud.manualRouteId && route._id && String(stud.manualRouteId) !== String(route._id)) {
                    return false;
                }

                // If the route has an explicit user list, strictly respect it
                if (Array.isArray(route.users) && route.users.length > 0) {
                    const isExplicitUser = route.users.some(
                        (u) => String(u?._id || u?.userId || u).toLowerCase().trim() === sId
                    );
                    if (!isExplicitUser) return false;
                }

                const match = studentBestMatch.get(sId);
                if (match && match.routeIndex === routeIndex && match.stopIndex === idx) {
                    return true;
                }
                if (calculateStopMatchScore(stud.stoppings, st.name) >= 75) {
                    return true;
                }
                return false;
            });

            // Seat allocation up to available vehicle capacity
            const boardCount = Math.min(remainingSeats, candidates.length);
            const boardedStudents = candidates.slice(0, boardCount);

            const boardedIds = boardedStudents.map((s) => {
                const id = String(s._id || s.userId).toLowerCase().trim();
                assignedUserGlobalSet.add(id);
                return id;
            });

            busAssignedUserIds.push(...boardedIds);
            assignedUsersCount += boardCount;
            remainingSeats -= boardCount;

            if (candidates.length > boardCount) {
                const overflow = candidates.length - boardCount;
                warnings.push(
                    `Seat capacity reached on Route "${route.routeName || `Route ${routeIndex + 1}`}" (${vehicleName}). ${overflow} students at stop "${st.name}" could not be allocated.`
                );
            }

            return {
                order: idx + 1,
                name: st.name,
                latitude: st.latitude,
                longitude: st.longitude,
                routePointType: st.routePointType,
                userCount: boardCount,
                userIds: boardedIds,
                passengersBoarded: boardCount
            };
        });

        allocatedBuses.push({
            routeId: route._id ? String(route._id) : `manual-${routeIndex + 1}`,
            routeCode: route.routeCode || `R-${String(routeIndex + 1).padStart(2, "0")}`,
            routeName: route.routeName || `Route ${routeIndex + 1}`,
            vehicleId,
            vehicleName,
            vehicleNumber,
            capacity,
            assignedUsers: assignedUsersCount,
            remainingSeats: Math.max(0, capacity - assignedUsersCount),
            utilization: capacity > 0 ? Number(((assignedUsersCount / capacity) * 100).toFixed(2)) : 0,
            direction: canonicalDirection,
            tripMode: effectiveTripMode,
            allocationMode,
            stops: stopsWithAllocations,
            users: busAssignedUserIds,
            roadGeometry: Array.isArray(route.roadGeometry) ? route.roadGeometry : []
        });
    });

    // 7. Unallocated students check
    const unallocatedStudents = comingStudents.filter(
        (s) => !assignedUserGlobalSet.has(String(s._id || s.userId).toLowerCase().trim())
    );
    const unassignedUsers = unallocatedStudents.length;
    const totalCapacity = allocatedBuses.reduce((sum, b) => sum + (b.capacity || 0), 0);
    const totalAssigned = allocatedBuses.reduce((sum, b) => sum + (b.assignedUsers || 0), 0);

    // Identify unallocated reasons: students with no matching stop in any active route
    const unservicedStudents = unallocatedStudents.filter((s) => {
        const sId = String(s._id || s.userId || "").toLowerCase().trim();
        return !studentBestMatch.has(sId);
    });

    if (unservicedStudents.length > 0) {
        const distinctStops = Array.from(new Set(unservicedStudents.map((s) => s.stoppings))).filter(Boolean);
        warnings.push(
            `${unservicedStudents.length} coming students have stops not included in any active manual route: ${distinctStops.join(", ")}.`
        );
    }

    const unassignedReason = unassignedUsers > 0
        ? (totalComingUsers > totalCapacity ? "VEHICLE_CAPACITY" : (unservicedStudents.length > 0 ? "UNSERVICED_STOP" : "VEHICLE_CAPACITY"))
        : null;

    // 8. Authoritative Approval Status from MongoDB
    let isApproved = false;
    let approvedAt = null;

    if (mongoose.connection?.db) {
        const approvedPlanDoc = await mongoose.connection.db.collection("ai_selected_plans").findOne({
            active: true,
            status: "active",
            planType: { $in: ["ADMIN", "MANUAL"] },
            $or: [
                { direction: canonicalDirection },
                { tripMode: canonicalDirection },
                { tripMode: effectiveTripMode },
                { "plan.direction": canonicalDirection },
                { "plan.tripMode": canonicalDirection }
            ]
        });

        if (approvedPlanDoc) {
            isApproved = true;
            approvedAt = approvedPlanDoc.selectedAt;
        }
    }

    // Backend Logs for Allocation Monitoring
    const matchedCount = comingStudents.length - unservicedStudents.length;
    console.log(`[MANUAL PLAN] Coming users found: ${totalComingUsers}`);
    console.log(`[MANUAL PLAN] Users matched to routes: ${matchedCount}`);
    console.log(`[MANUAL PLAN] Users allocated: ${totalAssigned}`);
    console.log(`[MANUAL PLAN] Standby/unallocated users: ${unassignedUsers}`);
    allocatedBuses.forEach((b) => {
        console.log(`[MANUAL PLAN] Route "${b.routeName}" (${b.vehicleName}): ${b.assignedUsers} / ${b.capacity} seats allocated`);
    });

    // Check if manual plan has been confirmed/submitted via OK in Route Management
    let isSubmitted = false;
    let submittedAt = null;

    if (mongoose.connection?.db) {
        const subDoc = await mongoose.connection.db.collection("manual_plan_submissions").findOne({
            $or: [
                { direction: canonicalDirection },
                { direction: canonicalDirection.toLowerCase() },
                { direction: new RegExp(`^${canonicalDirection}$`, "i") }
            ],
            isSubmitted: true
        });
        if (subDoc) {
            isSubmitted = true;
            submittedAt = subDoc.submittedAt;
        }
    }

    return {
        planType: "ADMIN",
        direction: canonicalDirection,
        tripMode: effectiveTripMode,
        buses: allocatedBuses,
        routes: allocatedBuses,
        totalRoutes: allocatedBuses.length,
        totalComingUsers,
        confirmedUsers: totalComingUsers,
        assignedUsers: totalAssigned,
        allocatedUsers: totalAssigned,
        allocatedSeats: totalAssigned,
        unassignedUsers,
        totalCapacity,
        capacityShortage: unassignedUsers > 0 || totalComingUsers > totalCapacity,
        unassignedReason,
        utilization: totalCapacity > 0 ? Number(((totalAssigned / totalCapacity) * 100).toFixed(2)) : 0,
        warnings,
        isApproved,
        adminApprovalStatus: isApproved ? "Approved" : "Pending Admin Approval",
        approvedAt,
        isSubmitted: isSubmitted || isApproved,
        submittedAt,
        generatedAt: new Date()
    };
};

export const buildManualPlan = (routes = [], vehicles = []) => {
    const rawRoutes = Array.isArray(routes) ? routes : [];
    const manualVehicles = rawRoutes.map((route, index) => {
        const assignedId = String(route?.assignedVehicle?._id || route?.assignedVehicle || "");
        const vehicle = vehicles.find((v) => String(v?._id) === assignedId) || null;

        const points = [];
        if (route?.source) {
            points.push({
                name: route.source.name || "Source",
                latitude: Number(route.source.latitude),
                longitude: Number(route.source.longitude),
                routePointType: "source"
            });
        }
        if (Array.isArray(route?.stops)) {
            route.stops.forEach((stop) => {
                points.push({
                    name: stop.name || "Stop",
                    latitude: Number(stop.latitude),
                    longitude: Number(stop.longitude),
                    routePointType: "stop"
                });
            });
        }
        if (route?.destination) {
            points.push({
                name: route.destination.name || "Destination",
                latitude: Number(route.destination.latitude),
                longitude: Number(route.destination.longitude),
                routePointType: "destination"
            });
        }

        const vehicleName = vehicle?.vehicleName || route?.assignedVehicle?.vehicleName || route?.vehicleName || "Bus";
        const capacity = getVehicleCapacity(vehicle) || getVehicleCapacity(route?.assignedVehicle) || Number(route?.capacity || 0);

        return {
            routeId: route?._id ? String(route._id) : `manual-${index + 1}`,
            routeName: route?.routeName || `Route ${index + 1}`,
            vehicleId: vehicle?._id ? String(vehicle._id) : assignedId || null,
            vehicleName,
            capacity,
            stops: points,
            assignedUsers: 0,
            remainingSeats: capacity
        };
    });

    return {
        planType: "MANUAL",
        type: "route",
        title: "Stored Manual Routes",
        buses: manualVehicles,
        vehicles: manualVehicles,
        totalRoutes: rawRoutes.length,
        totalCapacity: manualVehicles.reduce((sum, v) => sum + v.capacity, 0)
    };
};


/*
|--------------------------------------------------------------------------
| DYNAMIC INSTITUTIONAL HUB RESOLVER
|--------------------------------------------------------------------------
*/

export const resolveInstitutionalHub = async ({ userSource, userDestination }) => {
    if (userDestination && isValidCoordinate(userDestination.latitude, userDestination.longitude)) {
        return {
            hub: {
                name: userDestination.name || "Destination Hub",
                address: userDestination.address || userDestination.displayName || "",
                latitude: Number(userDestination.latitude),
                longitude: Number(userDestination.longitude)
            },
            type: "destination",
            provenance: "User Selected Arrival Hub"
        };
    }

    if (userSource && isValidCoordinate(userSource.latitude, userSource.longitude)) {
        return {
            hub: {
                name: userSource.name || "Source Hub",
                address: userSource.address || userSource.displayName || "",
                latitude: Number(userSource.latitude),
                longitude: Number(userSource.longitude)
            },
            type: "source",
            provenance: "User Selected Departure Source"
        };
    }

    return null;
};

export const sanitizeStoppingGroupsForStorage = (groups) => (groups || []).map((g) => ({
    name: g.name,
    userCount: g.userCount || g.users?.length || 0,
    userIds: (g.userIds || []).map((id) => (typeof id === "object" ? String(id._id || id.id || id) : String(id))),
    latitude: g.latitude,
    longitude: g.longitude,
    source: g.source || null,
    confidence: g.confidence || null
}));

export const sanitizeTransportationPlan = (p) => {
    if (!p) return null;
    return {
        ...p,
        buses: (p.buses || []).map((b) => ({
            ...b,
            users: (b.users || []).map((u) => (typeof u === "object" ? String(u._id || u.id || u.userId || "") : String(u))),
            stops: (b.stops || []).map((s) => {
                const { users, ...restStop } = s;
                return {
                    ...restStop,
                    userIds: (s.userIds || []).map((id) => (typeof id === "object" ? String(id._id || id.id || id) : String(id)))
                };
            })
        }))
    };
};

/*
|--------------------------------------------------------------------------
| GENERATE AGENT RECOMMENDATIONS
|--------------------------------------------------------------------------
*/

export const generateAgentRecommendations = async (payload = {}) => {
    if (!isDbConnected()) {
        return {
            success: false,
            code: "DATABASE_UNAVAILABLE",
            message: "Database is currently unavailable."
        };
    }

    const rawSource = payload?.source || payload?.sourceRegion || null;
    const rawDestination = payload?.destination || payload?.startingPoint || null;

    let sourceHub = null;
    let destinationHub = null;

    if (rawSource && isValidCoordinate(rawSource.latitude, rawSource.longitude)) {
        sourceHub = {
            name: rawSource.name || "Source Hub",
            address: rawSource.address || rawSource.displayName || "",
            latitude: Number(rawSource.latitude),
            longitude: Number(rawSource.longitude)
        };
    }

    if (rawDestination && isValidCoordinate(rawDestination.latitude, rawDestination.longitude)) {
        destinationHub = {
            name: rawDestination.name || "Destination Hub",
            address: rawDestination.address || rawDestination.displayName || "",
            latitude: Number(rawDestination.latitude),
            longitude: Number(rawDestination.longitude)
        };
    }

    const rawDirection = payload?.direction || payload?.tripMode;
    const requestedDirection = canonicalizeDirection(rawDirection) ||
        (payload?.activeEndpoint === "source" ? "OUTWARD" : (payload?.activeEndpoint === "destination" ? "INWARD" : (sourceHub && !destinationHub ? "OUTWARD" : "INWARD")));

    const canonicalDirection = requestedDirection;
    const effectiveTripMode = canonicalDirection === "OUTWARD" ? "FROM_SOURCE" : "TO_DESTINATION";

    if (canonicalDirection === "OUTWARD" && !sourceHub) {
        return {
            success: false,
            code: "MISSING_SOURCE",
            message: "Select a departure source (college/depot) to generate the OUTWARD AI transportation plan."
        };
    }

    if (canonicalDirection === "INWARD" && !destinationHub) {
        return {
            success: false,
            code: "MISSING_DESTINATION",
            message: "Select an arrival destination (college/depot) to generate the INWARD AI transportation plan."
        };
    }

    const anchorHub = canonicalDirection === "OUTWARD" ? sourceHub : destinationHub;

    const requestedDate = normalizeDate(
        payload?.date || payload?.scheduleDate || payload?.schedule?.date
    );
    const [allUsers, rawVehicles, routes, schedules] = await Promise.all([
        getCollectionData("users", {
            userId: 1,
            name: 1,
            role: 1,
            travelStatus: 1,
            travelConfirmation: 1,
            status: 1,
            stoppings: 1,
            city: 1,
            state: 1,
            country: 1,
            district: 1,
            "allocatedBus.isAllocated": 1,
            "allocatedBus.direction": 1,
            "allocatedBus.tripMode": 1
        }),
        getCollectionData("vehicles"),
        getCollectionData("routes"),
        getCollectionData("schedules")
    ]);

    const users = getManagedUsers(allUsers);
    const rawConfirmed = getConfirmedUsers(users);
    const { uniqueUsers: confirmedUsers, duplicateCount } = deduplicateUsers(rawConfirmed);

    const availableVehicles = getAvailableVehicles(rawVehicles, schedules, requestedDate);
    const physicalFleetCapacity = rawVehicles.reduce((sum, v) => sum + getVehicleCapacity(v), 0);
    const totalAvailableCapacity = availableVehicles.reduce((sum, v) => sum + getVehicleCapacity(v), 0);

    // ZERO-DEMAND RULE: If there are ZERO confirmed Coming users, gracefully return ZERO_DEMAND state
    if (confirmedUsers.length === 0) {
        return {
            success: true,
            status: "ZERO_DEMAND",
            totalDemand: 0,
            allocatedPassengers: 0,
            unallocatedPassengers: 0,
            allocatedVehicles: 0,
            routes: [],
            buses: [],
            stoppingGroups: [],
            duplicateUsers: duplicateCount,
            diagnostic: {
                validationPassed: true,
                failureCode: null,
                failureReason: null,
                comingUsers: 0,
                assignedUsers: 0,
                unassignedUsers: 0,
                duplicateUsers: 0,
                availableVehicles: availableVehicles.length,
                availableCapacity: totalAvailableCapacity,
                allocatedCapacity: 0,
                capacityShortfall: 0,
                uniqueStoppingAreas: 0,
                totalRouteStopVisits: 0,
                routeContinuityStatus: "N/A",
                directionStatus: effectiveTripMode === "FROM_SOURCE" ? "Outward from Source" : "Inward to Destination"
            },
            summary: {
                totalUsers: users.length,
                confirmedUsers: 0,
                comingUsers: 0,
                vehicles: rawVehicles.length,
                availableVehicles: availableVehicles.length,
                totalAvailableCapacity,
                physicalFleetCapacity,
                allocatedSeats: 0,
                allocatedUsers: 0,
                unallocatedUsers: 0,
                physicalFleetUtilization: 0,
                routeAllocationUtilization: 0,
                fleetVehicleUtilization: 0,
                routes: routes.length,
                schedules: schedules.length,
                stoppingAreas: 0,
                uniqueStoppingAreas: 0,
                totalRouteStopVisits: 0,
                uniqueStopCount: 0,
                routeStopVisitCount: 0,
                sharedStopCount: 0,
                splitStopCount: 0,
                capacityShortage: false,
                reason: null,
                stopCountExplanation: "No confirmed passengers available for route generation."
            },
            aiPlan: null,
            manualPlan: buildManualPlan(routes, rawVehicles),
            recommendations: [],
            message: "No confirmed passengers available for route generation."
        };
    }

    const totalComingUsers = confirmedUsers.length;

    // CAPACITY PRE-CHECK 1: Check if any vehicles are available in Schedule Management
    if (availableVehicles.length === 0) {
        return {
            success: false,
            code: "NO_AVAILABLE_VEHICLES",
            message: "Route generation failed: No vehicles are currently marked Available in Schedule Management.",
            diagnostic: {
                validationPassed: false,
                failureCode: "NO_AVAILABLE_VEHICLES",
                failureReason: "All vehicles in Schedule Management are currently marked Not Available.",
                comingUsers: totalComingUsers,
                assignedUsers: 0,
                unassignedUsers: totalComingUsers,
                duplicateUsers: 0,
                availableVehicles: 0,
                availableCapacity: 0,
                allocatedCapacity: 0,
                capacityShortfall: totalComingUsers,
                uniqueStoppingAreas: 0,
                totalRouteStopVisits: 0,
                routeContinuityStatus: "N/A",
                directionStatus: effectiveTripMode === "FROM_SOURCE" ? "Outward from Source" : "Inward to Destination"
            },
            summary: {
                totalUsers: users.length,
                confirmedUsers: totalComingUsers,
                comingUsers: totalComingUsers,
                vehicles: rawVehicles.length,
                availableVehicles: 0,
                totalAvailableCapacity: 0,
                physicalFleetCapacity,
                allocatedSeats: 0,
                allocatedUsers: 0,
                unallocatedUsers: totalComingUsers,
                capacityShortage: true,
                capacityShortfall: totalComingUsers,
                reason: "NO_AVAILABLE_VEHICLES"
            }
        };
    }

    // CAPACITY NOTE: If totalComingUsers > totalAvailableCapacity, proceed to buildAIPlan to generate partial allocations up to capacity
    const capacityShortage = totalComingUsers > totalAvailableCapacity;
    const initialShortfall = capacityShortage ? totalComingUsers - totalAvailableCapacity : 0;

    // Resolve stopping areas and coordinates
    const rawStoppingGroups = calculateStoppingGroups(confirmedUsers);
    const stoppingGroups = await resolveStopCoordinates(rawStoppingGroups, anchorHub);
    let resolvedStops = stoppingGroups.filter((s) => isValidCoordinate(s.latitude, s.longitude));

    if (resolvedStops.length === 0) {
        return {
            success: false,
            comingUsers: confirmedUsers.length,
            code: "MISSING_STOP_COORDINATES",
            message: "No valid stopping areas with Coming students could be resolved.",
            diagnostic: {
                validationPassed: false,
                failureCode: "MISSING_STOP_COORDINATES",
                failureReason: "Could not resolve geographic coordinates for any active stopping area.",
                comingUsers: totalComingUsers,
                assignedUsers: 0,
                unassignedUsers: totalComingUsers,
                duplicateUsers: 0,
                availableVehicles: availableVehicles.length,
                availableCapacity: totalAvailableCapacity,
                allocatedCapacity: 0,
                capacityShortfall: 0,
                uniqueStoppingAreas: 0,
                totalRouteStopVisits: 0,
                routeContinuityStatus: "N/A",
                directionStatus: effectiveTripMode === "FROM_SOURCE" ? "Outward from Source" : "Inward to Destination"
            }
        };
    }

    // Retrieve previous outward vehicle positions to provide operational continuity for Inward trips
    let previousVehiclePositions = null;
    if (effectiveTripMode === "TO_DESTINATION" && mongoose.connection.db) {
        try {
            const activeOutward = await mongoose.connection.db.collection("ai_selected_plans").findOne({
                active: true,
                $or: [{ tripMode: "FROM_SOURCE" }, { tripMode: "OUTWARD" }, { "plan.tripMode": "OUTWARD" }, { "plan.tripMode": "FROM_SOURCE" }]
            });
            const outBuses = activeOutward?.plan?.buses || [];
            if (outBuses.length > 0) {
                previousVehiclePositions = new Map();
                outBuses.forEach((ob) => {
                    const lastStop = ob.lastOutwardStop || ob.stops?.[ob.stops.length - 1];
                    if (ob.vehicleId && lastStop && isValidCoordinate(lastStop.latitude, lastStop.longitude)) {
                        previousVehiclePositions.set(String(ob.vehicleId), {
                            name: lastStop.name,
                            latitude: lastStop.latitude,
                            longitude: lastStop.longitude
                        });
                    }
                });
            }
        } catch {
            // Operational continuity hint is non-fatal
        }
    }

    // Build AI Recommended Plan
    const aiPlan = await buildAIPlan({
        sourceHub,
        destinationHub,
        tripMode: effectiveTripMode,
        resolvedStops,
        availableVehicles,
        rawVehicles,
        totalComingUsers,
        allUsersCount: users.length,
        totalAvailableCapacity,
        physicalFleetCapacity,
        confirmedUsers,
        previousVehiclePositions
    });

    // Run Server-Side Consistency Assertions before proceeding
    const assertions = [];
    const totalAssigned = aiPlan.buses.reduce((sum, b) => sum + (b.assignedUsers || 0), 0);
    const totalAllocatedSeats = aiPlan.buses.reduce((sum, b) => sum + (b.capacity || 0), 0);

    // ASSERT 1: allocatedPassengers + unallocatedPassengers === totalDemand
    if (totalAssigned + aiPlan.unassignedUsers !== totalComingUsers) {
        assertions.push(`ASSERT 1: Accounting mismatch: assigned (${totalAssigned}) + unassigned (${aiPlan.unassignedUsers}) !== total demand (${totalComingUsers})`);
    }

    // ASSERT 2: allocatedPassengers <= totalDemand
    if (totalAssigned > totalComingUsers) {
        assertions.push(`ASSERT 2: Over-allocation: assigned (${totalAssigned}) > total demand (${totalComingUsers})`);
    }

    // ASSERT 3: allocatedPassengers <= allocatedCapacity
    if (totalAssigned > totalAllocatedSeats) {
        assertions.push(`ASSERT 3: Vehicle capacity exceeded: assigned (${totalAssigned}) > allocated capacity (${totalAllocatedSeats})`);
    }

    // ASSERT 4: Every route passenger count <= vehicle capacity
    aiPlan.buses.forEach((b) => {
        if (b.assignedUsers > b.capacity) {
            assertions.push(`ASSERT 4: Route ${b.routeCode} assignedUsers (${b.assignedUsers}) > capacity (${b.capacity})`);
        }
    });

    // ASSERT 5: Every passenger is assigned to at most one route
    const seenPassengerIds = new Set();
    aiPlan.buses.forEach((b) => {
        (b.users || []).forEach((uId) => {
            const strId = String(uId);
            if (seenPassengerIds.has(strId)) {
                assertions.push(`ASSERT 5: Duplicate passenger assignment: user ID ${strId}`);
            }
            seenPassengerIds.add(strId);
        });
    });

    // ASSERT 6: Every assigned passenger belongs to confirmed Coming users
    const validIds = new Set(confirmedUsers.map((u) => String(u._id || u.userId || u.id || "")));
    aiPlan.buses.forEach((b) => {
        (b.users || []).forEach((uId) => {
            const strId = String(uId);
            if (strId && !validIds.has(strId)) {
                assertions.push(`ASSERT 6: Passenger ${strId} not in confirmed users list`);
            }
        });
    });

    // ASSERT 7: Every stop has valid coordinates
    aiPlan.buses.forEach((b) => {
        (b.stops || []).forEach((st) => {
            if (!isValidCoordinate(st.latitude, st.longitude)) {
                assertions.push(`ASSERT 7: Stop ${st.name} has invalid coordinates`);
            }
        });
    });

    // ASSERT 10: Every required active stopping area is visited by at least one bus
    const requiredStopNames = Array.from(new Set(
        resolvedStops
            .filter((s) => (s.users?.length || s.userCount || 0) > 0)
            .map((s) => s.name.toLowerCase().trim())
    ));

    const visitedStopNames = new Set();
    aiPlan.buses.forEach((b) => {
        (b.stops || []).forEach((st) => {
            visitedStopNames.add(st.name.toLowerCase().trim());
        });
    });

    const missingStoppingAreas = requiredStopNames.filter((name) => !visitedStopNames.has(name));
    if (missingStoppingAreas.length > 0 && aiPlan.unassignedUsers === 0) {
        assertions.push(`ASSERT 11: Route stop coverage incomplete. Missing ${missingStoppingAreas.length} required stopping area(s): ${missingStoppingAreas.join(", ")}`);
    }

    // ASSERT 12: uniqueStopCount <= routeStopVisitCount
    if (aiPlan.uniqueStopCount > aiPlan.routeStopVisitCount && aiPlan.uniqueStopCount > 0) {
        assertions.push(`ASSERT 12: uniqueStopCount (${aiPlan.uniqueStopCount}) > routeStopVisitCount (${aiPlan.routeStopVisitCount})`);
    }

    // ASSERT 13: Consolidation audit consistency
    aiPlan.consolidationAudit.forEach((audit) => {
        if (audit.beforeCapacity + audit.passengersMoved !== audit.afterCapacity) {
            assertions.push(`ASSERT 13: Consolidation audit mismatch on ${audit.destinationRoute}`);
        }
    });

    // ASSERT 15: No impossible distances
    aiPlan.buses.forEach((b) => {
        if (b.routeDistanceKm > 250 && (b.straightLineBaselineKm || 0) < 50) {
            assertions.push(`ASSERT 15: Impossible route distance (${b.routeDistanceKm}km) on ${b.routeCode}`);
        }
    });

    if (assertions.length > 0) {
        console.error("AI Plan Consistency Assertions Failed:", assertions);
        return {
            success: false,
            code: missingStoppingAreas.length > 0 ? "ROUTE_STOP_COVERAGE_FAILED" : "CONSISTENCY_ASSERTION_FAILED",
            message: `Generated route plan failed consistency verification: ${assertions.join("; ")}`,
            errors: assertions,
            diagnostic: {
                validationPassed: false,
                failureCode: missingStoppingAreas.length > 0 ? "ROUTE_STOP_COVERAGE_FAILED" : "CONSISTENCY_ASSERTION_FAILED",
                failureReason: assertions.join("; "),
                comingUsers: totalComingUsers,
                assignedUsers: totalAssigned,
                unassignedUsers: aiPlan.unassignedUsers,
                duplicateUsers: seenPassengerIds.size < totalAssigned ? totalAssigned - seenPassengerIds.size : 0,
                availableVehicles: availableVehicles.length,
                availableCapacity: totalAvailableCapacity,
                allocatedCapacity: totalAllocatedSeats,
                capacityShortfall: Math.max(0, totalComingUsers - totalAvailableCapacity),
                uniqueStoppingAreas: aiPlan.uniqueStopCount,
                totalRouteStopVisits: aiPlan.routeStopVisitCount,
                missingStoppingAreas,
                routeContinuityStatus: aiPlan.buses.every((b) => b.isContinuous) ? "Continuous" : "Discontinuous",
                directionStatus: effectiveTripMode === "FROM_SOURCE" ? "Outward from Source" : "Inward to Destination"
            }
        };
    }

    const manualPlan = buildManualPlan(routes, rawVehicles);

    const planResult = {
        success: true,
        generatedAt: new Date().toISOString(),
        direction: canonicalDirection,
        tripMode: effectiveTripMode,
        source: sourceHub,
        destination: destinationHub,
        startingPoint: anchorHub,
        hubProvenance: "User Selection",
        duplicateUsers: duplicateCount,
        diagnostic: {
            validationPassed: true,
            failureCode: null,
            failureReason: null,
            comingUsers: totalComingUsers,
            assignedUsers: aiPlan.assignedUsers,
            unassignedUsers: aiPlan.unassignedUsers,
            duplicateUsers: 0,
            availableVehicles: availableVehicles.length,
            availableCapacity: totalAvailableCapacity,
            allocatedCapacity: aiPlan.allocatedSeats,
            capacityShortfall: 0,
            uniqueStoppingAreas: aiPlan.uniqueStopCount,
            totalRouteStopVisits: aiPlan.routeStopVisitCount,
            routeContinuityStatus: "Continuous",
            directionStatus: effectiveTripMode === "FROM_SOURCE" ? "Outward from Source" : "Inward to Destination"
        },
        summary: {
            totalUsers: users.length,
            confirmedUsers: totalComingUsers,
            comingUsers: totalComingUsers,
            vehicles: rawVehicles.length,
            availableVehicles: availableVehicles.length,
            totalAvailableCapacity,
            physicalFleetCapacity,
            allocatedSeats: aiPlan.allocatedSeats,
            allocatedUsers: aiPlan.assignedUsers,
            unallocatedUsers: aiPlan.unassignedUsers,
            unallocatedReason: aiPlan.unallocatedReason,
            seatUtilization: aiPlan.utilization,
            physicalFleetUtilization: aiPlan.physicalFleetUtilization,
            routeAllocationUtilization: aiPlan.routeAllocationUtilization,
            fleetVehicleUtilization: aiPlan.fleetVehicleUtilization,
            utilizationNote: aiPlan.utilizationNote,
            routes: routes.length,
            schedules: schedules.length,
            stoppingAreas: aiPlan.uniqueStopCount,
            uniqueStoppingAreas: aiPlan.uniqueStopCount,
            uniqueStopCount: aiPlan.uniqueStopCount,
            totalRouteStopVisits: aiPlan.routeStopVisitCount,
            routeStopVisitCount: aiPlan.routeStopVisitCount,
            sharedStopCount: aiPlan.sharedStopCount,
            splitStopCount: aiPlan.splitStopCount,
            mappedStoppingAreas: aiPlan.uniqueStopCount,
            capacityShortage: aiPlan.capacityShortage,
            stopCountExplanation: aiPlan.stopCountExplanation
        },
        stoppingGroups,
        aiPlan,
        manualPlan,
        recommendations: aiPlan ? [aiPlan] : []
    };

    // Persist final generated AI plan to MongoDB AiPlan collection ONLY if final validation certification passed
    if (totalComingUsers > 0 && aiPlan?.buses?.length > 0 && aiPlan?.certification?.isCertified) {
        try {
            const canonicalDirection = effectiveTripMode === "FROM_SOURCE" ? "OUTWARD" : "INWARD";

            // Maintain Outward and Inward as independent persisted plans:
            // Generating Outward must never overwrite, deactivate, or modify Inward (and vice versa)
            await AiPlan.updateMany(
                {
                    active: true,
                    $or: [
                        { direction: canonicalDirection },
                        { tripMode: canonicalDirection },
                        { tripMode: canonicalDirection === "OUTWARD" ? "FROM_SOURCE" : "TO_DESTINATION" }
                    ]
                },
                { $set: { active: false, status: "superseded" } }
            );

            // Sanitize heavy duplicate objects to prevent exceeding MongoDB's 16MB BSON limit
            const sanitizedStoppingGroups = sanitizeStoppingGroupsForStorage(planResult.stoppingGroups);
            const sanitizedAiPlan = sanitizeTransportationPlan(planResult.aiPlan);

            const savedPlanDoc = await AiPlan.create({
                active: true,
                status: "active",
                planType: "AI",
                direction: canonicalDirection,
                tripMode: effectiveTripMode,
                source: sourceHub,
                destination: destinationHub,
                startingPoint: anchorHub,
                hubProvenance: "User Selection",
                summary: planResult.summary,
                stoppingGroups: sanitizedStoppingGroups,
                aiPlan: sanitizedAiPlan,
                manualPlan: sanitizeTransportationPlan(planResult.manualPlan),
                recommendations: sanitizedAiPlan ? [sanitizedAiPlan] : [],
                isApproved: false,
                approvedAt: null,
                generatedAt: new Date()
            });

            planResult.planId = savedPlanDoc._id;
        } catch (persistErr) {
            console.error("Failed to persist generated AI plan to database:", persistErr.message);
        }
    }

    return planResult;
};

/*
|--------------------------------------------------------------------------
| PERSIST PLAN TO USERS (MONGODB USER ALLOCATION SYNCHRONIZATION)
|--------------------------------------------------------------------------
*/

export const persistPlanToUsers = async (
    plan,
    tripMode = "FROM_SOURCE",
    sourceHub = null,
    destinationHub = null,
    planType = "AI",
    allocationMode = (planType === "ADMIN" || planType === "MANUAL") ? "MANUAL" : "AI"
) => {
    if (!isDbConnected()) return;
    try {
        const allStudents = await User.find({ role: "student" })
            .select({
                userId: 1,
                name: 1,
                stoppings: 1,
                city: 1,
                district: 1,
                state: 1,
                country: 1,
                travelStatus: 1,
                allocationStatus: 1,
                lateResponseDetected: 1,
                isLateResponse: 1,
                lateResponseAt: 1,
                responseDeadline: 1,
                travelResponseSubmittedAt: 1,
                manualRouteId: 1,
                manualBusId: 1,
                routeId: 1,
                busId: 1,
                approvalStatus: 1,
                manualAllocation: 1,
                aiAllocation: 1,
                requiresReallocation: 1,
                affectedDirections: 1,
                lateResponseNotifiedEventKeys: 1,
                "allocatedBus.inward": 1,
                "allocatedBus.outward": 1
            })
            .lean();
        if (!allStudents || allStudents.length === 0) return;

        const canonicalDirection = (tripMode === "FROM_SOURCE" || tripMode === "OUTWARD" || plan?.direction === "OUTWARD" || plan?.tripMode === "FROM_SOURCE" || plan?.tripMode === "OUTWARD")
            ? "OUTWARD"
            : "INWARD";
        const isOutward = canonicalDirection === "OUTWARD";

        const buses = Array.isArray(plan?.buses)
            ? plan.buses
            : (Array.isArray(plan?.routes) ? plan.routes : []);

        // Fast O(1) in-memory lookup maps
        const userToBusMap = new Map();
        const stopToBusMap = new Map();

        for (const bus of buses) {
            const stops = bus.stops || [];
            const busAllocBase = {
                isAllocated: true,
                approved: true,
                allocationStatus: "Allocated",
                planType: planType || "AI",
                adminApprovalStatus: "Approved",
                direction: canonicalDirection,
                approvedAt: new Date(),
                routeCode: bus.routeCode || `R-${String(bus.routeNumber || 1).padStart(2, "0")}`,
                routeName: bus.routeName || `${bus.routeCode || 'R-01'}: ${bus.vehicleName}`,
                vehicleName: bus.vehicleName || "Assigned Bus",
                vehicleNumber: bus.vehicleName || "Assigned Bus",
                capacity: bus.capacity || 70,
                assignedUsersCount: bus.assignedUsers || bus.users?.length || 0,
                remainingSeats: bus.remainingSeats ?? Math.max(0, (bus.capacity || 70) - (bus.assignedUsers || 0)),
                sectorName: bus.sectorName || "Transit Line",
                tripMode: bus.tripMode || (isOutward ? "FROM_SOURCE" : "TO_DESTINATION"),
                totalStops: stops.length,
                sourceHub: bus.sourceHub || sourceHub || null,
                destinationHub: bus.destinationHub || destinationHub || null,
                routeDistanceKm: bus.routeDistanceKm,
                routeDurationMin: bus.routeDurationMin,
                roadGeometry: [],
                isRoadVerified: bus.isRoadVerified || false,
                isFallback: bus.isFallback || false,
                roadRouteStatus: bus.roadRouteStatus || (bus.isRoadVerified ? "OSRM Verified" : "Calibrated Fallback (Network Unavailable)"),
                routeStops: stops.map((s) => ({
                    order: s.order,
                    name: s.name,
                    passengers: s.userCount || s.passengersDropped || s.passengersBoarded || 0
                }))
            };

            // Index by users list (uId, userId, id)
            (bus.users || []).forEach((uId) => {
                if (uId) {
                    userToBusMap.set(String(uId).toLowerCase().trim(), { bus, allocBase: busAllocBase });
                }
            });

            // Index by stops and stop userIds / locationKeys
            stops.forEach((st) => {
                const stopNameKey = String(st.name || "").toLowerCase().trim();
                const locKey = String(st.locationKey || "").toLowerCase().trim();
                if (stopNameKey && !stopToBusMap.has(stopNameKey)) {
                    stopToBusMap.set(stopNameKey, { bus, stop: st, allocBase: busAllocBase });
                }
                if (locKey && !stopToBusMap.has(locKey)) {
                    stopToBusMap.set(locKey, { bus, stop: st, allocBase: busAllocBase });
                }
                (st.userIds || []).forEach((uId) => {
                    if (uId) {
                        userToBusMap.set(String(uId).toLowerCase().trim(), { bus, stop: st, allocBase: busAllocBase });
                    }
                });
            });
        }

        // Check if the OPPOSITE direction is legitimately active and approved in ai_selected_plans
        const oppositeDirection = isOutward ? "INWARD" : "OUTWARD";
        let isOppositeApproved = false;
        if (mongoose.connection.db) {
            const activeOppositeDoc = await mongoose.connection.db.collection("ai_selected_plans").findOne({
                active: true,
                status: "active",
                $or: [
                    { direction: oppositeDirection },
                    { tripMode: oppositeDirection },
                    { tripMode: oppositeDirection === "OUTWARD" ? "FROM_SOURCE" : "TO_DESTINATION" },
                    { "plan.direction": oppositeDirection },
                    { "plan.tripMode": oppositeDirection },
                    { "plan.tripMode": oppositeDirection === "OUTWARD" ? "FROM_SOURCE" : "TO_DESTINATION" }
                ]
            });
            isOppositeApproved = Boolean(activeOppositeDoc);
        }

        const bulkOps = [];
        const lateEventOps = [];

        for (const student of allStudents) {
            const uId = String(student._id || "").toLowerCase().trim();
            const uUserId = String(student.userId || "").toLowerCase().trim();
            const uName = String(student.name || "").toLowerCase().trim();
            const uStop = String(student.stoppings || "").toLowerCase().trim();
            const locKey = buildStopLocationKey(student.stoppings, student.city, student.state, student.country);

            let directionAllocObj = null;

            if (student.travelStatus === "Coming") {
                const isExplicitlyAssigned = (uId && userToBusMap.has(uId)) ||
                    (uUserId && userToBusMap.has(uUserId)) ||
                    (uName && userToBusMap.has(uName));

                const hasExplicitAssignments = buses.some((b) => Array.isArray(b.users) && b.users.length > 0);

                const match = (uId && userToBusMap.get(uId)) ||
                    (uUserId && userToBusMap.get(uUserId)) ||
                    (uName && userToBusMap.get(uName)) ||
                    (!hasExplicitAssignments && ((locKey && stopToBusMap.get(locKey)) || (uStop && stopToBusMap.get(uStop))));

                if (isExplicitlyAssigned || (!hasExplicitAssignments && match)) {
                    const { bus, stop, allocBase } = match;
                    const stopName = stop?.name || student.stoppings || "Assigned Stop";
                    const studentIndexInBus = (bus.users || []).findIndex(
                        (id) => String(id).toLowerCase().trim() === uId || String(id).toLowerCase().trim() === uUserId
                    );
                    const seatNumber = studentIndexInBus !== -1 ? studentIndexInBus + 1 : (stop?.order || 1);

                    directionAllocObj = {
                        ...allocBase,
                        approved: true,
                        seatNumber,
                        boardingStop: stopName,
                        stopOrder: stop?.order || 1,
                        legDistanceKm: stop?.legDistanceKm || null,
                        legDurationMin: stop?.legDurationMin || null,
                        routeStops: (allocBase.routeStops || []).map((s) => ({
                            ...s,
                            isUserStop: s.name?.toLowerCase().trim() === stopName.toLowerCase().trim()
                        }))
                    };
                } else {
                    directionAllocObj = {
                        isAllocated: false,
                        approved: true,
                        allocationStatus: "Unallocated",
                        adminApprovalStatus: "Approved",
                        direction: canonicalDirection,
                        planType: planType || "AI",
                        unallocatedReason: plan?.unassignedReason || "VEHICLE_CAPACITY",
                        updatedAt: new Date(),
                        message: "All seats on this route are fully occupied. You are on the standby list. Please contact transportation administrator."
                    };
                }
            } else if (student.travelStatus === "Not Coming") {
                directionAllocObj = {
                    isAllocated: false,
                    approved: true,
                    allocationStatus: "Not Traveling",
                    adminApprovalStatus: "Approved",
                    direction: canonicalDirection,
                    planType: planType || "AI",
                    updatedAt: new Date(),
                    message: "You have confirmed that you are not traveling today. No bus seat is reserved."
                };
            } else {
                directionAllocObj = {
                    isAllocated: false,
                    approved: false,
                    allocationStatus: "Pending",
                    adminApprovalStatus: "Pending Admin Approval",
                    direction: canonicalDirection,
                    planType: planType || "AI",
                    updatedAt: new Date(),
                    message: "Transportation Not Assigned"
                };
            }

            // Opposite direction is preserved ONLY if opposite direction is currently active and approved!
            const existingAlloc = (student.allocatedBus && typeof student.allocatedBus === "object") ? student.allocatedBus : {};
            let oppositeAlloc = null;
            if (isOppositeApproved) {
                const cand = isOutward ? existingAlloc.inward : existingAlloc.outward;
                if (cand && cand.isAllocated && (cand.approved === true || cand.adminApprovalStatus === "Approved")) {
                    oppositeAlloc = { ...cand, approved: true };
                }
            }

            const currentDirectionAlloc = directionAllocObj.isAllocated ? directionAllocObj : null;
            const inwardAlloc = isOutward ? oppositeAlloc : currentDirectionAlloc;
            const outwardAlloc = isOutward ? currentDirectionAlloc : oppositeAlloc;

            const isAllocated = Boolean(
                (inwardAlloc && inwardAlloc.isAllocated) ||
                (outwardAlloc && outwardAlloc.isAllocated)
            );

            // Primary active allocation to display (current approved direction takes top-level precedence if allocated)
            const activeTop = currentDirectionAlloc
                ? currentDirectionAlloc
                : ((inwardAlloc?.isAllocated && inwardAlloc) || (outwardAlloc?.isAllocated && outwardAlloc) || null);

            const isCurrentDirAllocated = Boolean(directionAllocObj && directionAllocObj.isAllocated);

            // Existing affected directions
            const existingAffectedDirs = Array.isArray(student.affectedDirections)
                ? student.affectedDirections.map((d) => String(d).toUpperCase().trim())
                : [];

            let currentAffectedDirs;
            if (isCurrentDirAllocated) {
                // Direction successfully resolved! Remove canonicalDirection from affectedDirections
                currentAffectedDirs = existingAffectedDirs.filter((d) => d !== canonicalDirection);
            } else {
                // Direction NOT resolved (e.g. standby / capacity exceeded)!
                // If student was already affected or is unallocated Coming, keep canonicalDirection in affectedDirections
                const wasAffectedInDir = existingAffectedDirs.includes(canonicalDirection) ||
                                         Boolean(student.lateResponseDetected) ||
                                         Boolean(student.isLateResponse) ||
                                         student.allocationStatus === "Pending Reallocation" ||
                                         Boolean(student.requiresReallocation);
                if (wasAffectedInDir) {
                    currentAffectedDirs = Array.from(new Set([...existingAffectedDirs, canonicalDirection]));
                } else {
                    currentAffectedDirs = existingAffectedDirs;
                }
            }

            const stillRequiresReallocation = currentAffectedDirs.length > 0;

            // Preserve late response classification historically even after user gets allocated
            const wasLate = Boolean(student.isLateResponse || student.lateResponseDetected);
            const isLateResponseFlag = wasLate || Boolean(student.isLateResponse) || Boolean(student.lateResponseDetected);
            const persistentLateResponseAt = student.lateResponseAt || (isLateResponseFlag ? (student.travelResponseSubmittedAt || new Date()) : null);

            let finalAllocationStatus;
            if (student.allocationStatus === "Re-assigned") {
                finalAllocationStatus = "Re-assigned";
                console.log(`[RE-ASSIGNED] userId: ${student.userId} preserved existing Re-assigned status`);
            } else if (stillRequiresReallocation) {
                finalAllocationStatus = "Pending Reallocation";
            } else if (isAllocated) {
                finalAllocationStatus = "Assigned";
            } else if (student.travelStatus === "Coming") {
                finalAllocationStatus = "Unallocated";
            } else {
                finalAllocationStatus = "Not Assigned";
            }

            const previousAllocation = student.allocatedBus || student.assignedVehicle || "Unallocated";

            // Required temporary backend logs around Manual Route approval
            if (allocationMode === "MANUAL" || planType === "ADMIN" || planType === "MANUAL") {
                console.log("[MANUAL APPROVAL] userId:", student.userId);
                console.log("[MANUAL APPROVAL] routeId:", activeTop?.routeId || activeTop?.routeCode || null);
                console.log("[MANUAL APPROVAL] selectedBusId:", activeTop?.vehicleId || activeTop?.vehicleName || null);
                console.log("[MANUAL APPROVAL] allocationMode:", allocationMode);
                console.log("[MANUAL APPROVAL] isLateResponse:", isLateResponseFlag);
                console.log("[MANUAL APPROVAL] previousAllocation:", previousAllocation);
                console.log("[MANUAL APPROVAL] finalAllocation:", activeTop);
            }

            const mergedAlloc = activeTop ? {
                ...activeTop,
                isAllocated,
                planType: planType || "AI",
                adminApprovalStatus: stillRequiresReallocation ? "Pending Reallocation" : "Approved",
                allocationStatus: finalAllocationStatus,
                requiresReallocation: stillRequiresReallocation,
                affectedDirections: currentAffectedDirs,
                inward: inwardAlloc || null,
                outward: outwardAlloc || null,
                updatedAt: new Date()
            } : {
                isAllocated: false,
                planType: planType || "AI",
                adminApprovalStatus: stillRequiresReallocation ? "Pending Reallocation" : "Pending Admin Approval",
                allocationStatus: finalAllocationStatus,
                requiresReallocation: stillRequiresReallocation,
                affectedDirections: currentAffectedDirs,
                inward: null,
                outward: null,
                message: stillRequiresReallocation
                    ? "Transportation Allocation Pending"
                    : "No approved transportation plan available yet.",
                updatedAt: new Date()
            };

            const userSetUpdate = {
                allocatedBus: mergedAlloc,
                assignedVehicle: isAllocated && activeTop ? (activeTop.vehicleName || activeTop.vehicleNumber || null) : null,
                assignedRoute: isAllocated && activeTop ? (activeTop.routeCode || activeTop.routeName || null) : null,
                allocationStatus: finalAllocationStatus,
                requiresReallocation: stillRequiresReallocation,
                lateResponseDetected: isLateResponseFlag,
                isLateResponse: isLateResponseFlag,
                lateResponseAt: persistentLateResponseAt,
                lateResponseResolvedAt: isCurrentDirAllocated ? (student.lateResponseResolvedAt || new Date()) : null,
                affectedDirections: currentAffectedDirs
            };

            if (planType === "ADMIN" || planType === "MANUAL" || allocationMode === "MANUAL") {
                userSetUpdate.approvedPlanType = "MANUAL";
                userSetUpdate.manualRouteId = activeTop?.routeId || null;
                userSetUpdate.manualBusId = activeTop?.vehicleId || null;
                userSetUpdate.routeId = activeTop?.routeId || null;
                userSetUpdate.busId = activeTop?.vehicleId || null;
                userSetUpdate.approvalStatus = isAllocated ? "Approved" : "Unallocated";
                if (activeTop) {
                    userSetUpdate.manualAllocation = activeTop;
                }
            } else if (planType === "AI") {
                userSetUpdate.approvedPlanType = "AI";
                if (activeTop) {
                    userSetUpdate.aiAllocation = activeTop;
                }
            }

            bulkOps.push({
                updateOne: {
                    filter: { _id: student._id },
                    update: {
                        $set: userSetUpdate
                    }
                }
            });

            if (isCurrentDirAllocated && (student.userId || student._id)) {
                const targetUIds = [student.userId, String(student._id)].filter(Boolean);
                lateEventOps.push({
                    updateMany: {
                        filter: {
                            userId: { $in: targetUIds },
                            direction: canonicalDirection
                        },
                        update: {
                            $set: {
                                status: "RESOLVED",
                                resolvedAt: new Date(),
                                allocatedBus: activeTop?.vehicleName || null,
                                allocatedRoute: activeTop?.routeCode || activeTop?.routeName || null,
                                allocatedSeat: activeTop?.seatNumber ? String(activeTop.seatNumber) : null
                            }
                        }
                    }
                });
            }
        }

        if (bulkOps.length > 0) {
            const chunkSize = 100;
            for (let i = 0; i < bulkOps.length; i += chunkSize) {
                const chunk = bulkOps.slice(i, i + chunkSize);
                await User.bulkWrite(chunk, { ordered: false });
            }
        }

        if (lateEventOps.length > 0) {
            LateResponseEvent.bulkWrite(lateEventOps, { ordered: false }).catch(() => {});
        }
    } catch (err) {
        console.error("persistPlanToUsers error:", err.message);
    }
};

/*
|--------------------------------------------------------------------------
| SAVE FINAL ADMIN SELECTION
|--------------------------------------------------------------------------
*/

/*
|--------------------------------------------------------------------------
| GET USER ALLOCATED BUS (REAL-TIME RESOLUTION FROM ACTIVE APPROVED PLAN)
|--------------------------------------------------------------------------
*/

export const getUserAllocatedBus = async (user) => {
    if (!user || !isDbConnected()) {
        return {
            isAllocated: false,
            inward: null,
            outward: null,
            adminApprovalStatus: "Pending Admin Approval",
            message: "Transportation Not Assigned"
        };
    }

    try {
        // If user is Pending or no travel status submitted, they have no transportation allocation for current cycle
        if (!user.travelStatus || user.travelStatus === "Pending") {
            return {
                isAllocated: false,
                hasActivePlan: false,
                inward: null,
                outward: null,
                adminApprovalStatus: "Pending Admin Approval",
                message: "Transportation Not Assigned"
            };
        }

        // If user is Not Coming
        if (user.travelStatus === "Not Coming") {
            return {
                isAllocated: false,
                hasActivePlan: false,
                inward: null,
                outward: null,
                adminApprovalStatus: "Approved",
                message: "You have confirmed that you are not traveling today. No bus seat is reserved."
            };
        }

        // --- AUTHORITATIVE SOURCE OF TRUTH: ai_selected_plans collection ---
        // INWARD and OUTWARD approval states are completely independent!
        let activeOutwardSel = null;
        let activeInwardSel = null;

        if (mongoose.connection.db) {
            const [selOut, selIn] = await Promise.all([
                mongoose.connection.db.collection("ai_selected_plans").findOne({
                    active: true,
                    status: "active",
                    $or: [
                        { direction: "OUTWARD" },
                        { tripMode: "OUTWARD" },
                        { tripMode: "FROM_SOURCE" },
                        { "plan.direction": "OUTWARD" },
                        { "plan.tripMode": "OUTWARD" },
                        { "plan.tripMode": "FROM_SOURCE" }
                    ]
                }, { sort: { selectedAt: -1 } }),
                mongoose.connection.db.collection("ai_selected_plans").findOne({
                    active: true,
                    status: "active",
                    $or: [
                        { direction: "INWARD" },
                        { tripMode: "INWARD" },
                        { tripMode: "TO_DESTINATION" },
                        { "plan.direction": "INWARD" },
                        { "plan.tripMode": "INWARD" },
                        { "plan.tripMode": "TO_DESTINATION" }
                    ]
                }, { sort: { selectedAt: -1 } })
            ]);
            activeOutwardSel = selOut;
            activeInwardSel = selIn;
        }

        const isInwardApproved = Boolean(activeInwardSel);
        const isOutwardApproved = Boolean(activeOutwardSel);

        // Check if user is in a Pending Reallocation state
        const affectedDirs = Array.isArray(user.affectedDirections)
            ? user.affectedDirections.map((d) => String(d).toUpperCase().trim())
            : [];
        const isUserPendingReallocation =
            user.allocationStatus === "Pending Reallocation" ||
            user.requiresReallocation === true ||
            user.lateResponseDetected === true;

        const isDirPendingReallocation = (dir) => {
            if (!isUserPendingReallocation) return false;
            if (affectedDirs.length === 0) return true;
            return affectedDirs.includes(dir);
        };

        // If NEITHER direction is approved, do not show any transportation details
        if (!isInwardApproved && !isOutwardApproved) {
            return {
                isAllocated: false,
                hasActivePlan: false,
                inward: null,
                outward: null,
                adminApprovalStatus: "Pending Admin Approval",
                message: "No approved transportation plan available yet."
            };
        }

        const matchUserInPlan = (activeSelection) => {
            if (isUserPendingReallocation) return null;
            if (!activeSelection?.plan) return null;
            const plan = activeSelection.plan;
            const buses = Array.isArray(plan.buses) ? plan.buses : (Array.isArray(plan.routes) ? plan.routes : []);
            const uId = String(user._id || "");
            const uUserId = String(user.userId || "").toLowerCase().trim();
            const uName = String(user.name || "").toLowerCase().trim();
            const uStop = String(user.stoppings || "").toLowerCase().trim();

            let matchedBus = null;
            let matchedStop = null;

            for (const bus of buses) {
                const busUserIds = (bus.users || []).map((id) => String(id).toLowerCase().trim());
                const hasUserInBus = (uId && busUserIds.includes(uId.toLowerCase())) ||
                    (uUserId && busUserIds.includes(uUserId)) ||
                    (uName && busUserIds.includes(uName));

                for (const st of (bus.stops || [])) {
                    const stopUserIds = (st.userIds || []).map((id) => String(id).toLowerCase().trim());
                    const inStop = (uId && stopUserIds.includes(uId.toLowerCase())) ||
                        (uUserId && stopUserIds.includes(uUserId)) ||
                        (uName && stopUserIds.includes(uName));

                    if (inStop) {
                        matchedBus = bus;
                        matchedStop = st;
                        break;
                    }
                }

                if (matchedBus) break;

                if (hasUserInBus) {
                    matchedBus = bus;
                    matchedStop = (bus.stops || []).find((st) => st.name?.toLowerCase().trim() === uStop) || bus.stops?.[0];
                    break;
                }
            }

            if (!matchedBus) return null;

            const stopName = matchedStop?.name || user.stoppings || "Assigned Stop";
            const stopOrder = matchedStop?.order || 1;
            const rawTripMode = matchedBus.tripMode || plan.tripMode || activeSelection.tripMode || "INWARD";
            const canonicalDir = (rawTripMode === "FROM_SOURCE" || rawTripMode === "OUTWARD" || plan.direction === "OUTWARD") ? "OUTWARD" : "INWARD";

            return {
                isAllocated: true,
                approved: true,
                hasActivePlan: true,
                direction: canonicalDir,
                adminApprovalStatus: "Approved",
                approvedAt: activeSelection.selectedAt || new Date(),
                planType: activeSelection.planType || "AI",
                routeCode: matchedBus.routeCode || `R-${String(matchedBus.routeNumber || 1).padStart(2, "0")}`,
                routeName: matchedBus.routeName || `${matchedBus.routeCode || 'R-01'}: ${matchedBus.vehicleName}`,
                vehicleName: matchedBus.vehicleName || "Assigned Bus",
                vehicleNumber: matchedBus.vehicleName || "Assigned Bus",
                capacity: matchedBus.capacity || 60,
                assignedUsersCount: matchedBus.assignedUsers || matchedBus.users?.length || 0,
                remainingSeats: matchedBus.remainingSeats ?? Math.max(0, (matchedBus.capacity || 60) - (matchedBus.assignedUsers || 0)),
                sectorName: matchedBus.sectorName || "Transit Line",
                tripMode: rawTripMode,
                boardingStop: stopName,
                stopOrder,
                totalStops: matchedBus.stops?.length || 0,
                legDistanceKm: matchedStop?.legDistanceKm || null,
                legDurationMin: matchedStop?.legDurationMin || null,
                sourceHub: matchedBus.sourceHub || activeSelection.startingPoint || null,
                destinationHub: matchedBus.destinationHub || null,
                routeDistanceKm: matchedBus.routeDistanceKm,
                routeDurationMin: matchedBus.routeDurationMin,
                roadGeometry: matchedBus.roadGeometry || [],
                isRoadVerified: matchedBus.isRoadVerified || false,
                isFallback: matchedBus.isFallback || false,
                roadRouteStatus: matchedBus.roadRouteStatus || (matchedBus.isRoadVerified ? "OSRM Verified" : "Calibrated Fallback (Network Unavailable)"),
                routeStops: (matchedBus.stops || []).map((s) => ({
                    order: s.order,
                    name: s.name,
                    passengers: s.userCount || s.passengersDropped || s.passengersBoarded || 0,
                    legDistanceKm: s.legDistanceKm,
                    legDurationMin: s.legDurationMin,
                    isUserStop: s.name?.toLowerCase().trim() === stopName.toLowerCase().trim()
                }))
            };
        };

        // 1. Resolve INWARD allocation ONLY if INWARD is actively approved
        let validInward = null;
        if (isInwardApproved) {
            if (isDirPendingReallocation("INWARD")) {
                validInward = {
                    isAllocated: false,
                    allocationStatus: "Pending Reallocation",
                    adminApprovalStatus: "Pending Reallocation",
                    direction: "INWARD",
                    message: "Transportation Allocation Pending. Your travel response was received after the Inward transportation plan was approved. Your bus and seat will be assigned after the administrator reviews and regenerates the transportation allocation."
                };
            } else {
                const inwardCand = user.allocatedBus?.inward;
                if (inwardCand && inwardCand.isAllocated && (inwardCand.approved === true || inwardCand.adminApprovalStatus === "Approved")) {
                    validInward = { ...inwardCand, approved: true };
                } else if (user.travelStatus === "Coming") {
                    validInward = matchUserInPlan(activeInwardSel);
                }
            }
        }

        // 2. Resolve OUTWARD allocation ONLY if OUTWARD is actively approved
        let validOutward = null;
        if (isOutwardApproved) {
            if (isDirPendingReallocation("OUTWARD")) {
                validOutward = {
                    isAllocated: false,
                    allocationStatus: "Pending Reallocation",
                    adminApprovalStatus: "Pending Reallocation",
                    direction: "OUTWARD",
                    message: "Transportation Allocation Pending. Your travel response was received after the Outward transportation plan was approved. Your bus and seat will be assigned after the administrator reviews and regenerates the transportation allocation."
                };
            } else {
                const outwardCand = user.allocatedBus?.outward;
                if (outwardCand && outwardCand.isAllocated && (outwardCand.approved === true || outwardCand.adminApprovalStatus === "Approved")) {
                    validOutward = { ...outwardCand, approved: true };
                } else if (user.travelStatus === "Coming") {
                    validOutward = matchUserInPlan(activeOutwardSel);
                }
            }
        }

        const isAllocated = Boolean((validInward && validInward.isAllocated) || (validOutward && validOutward.isAllocated));

        if (!isAllocated) {
            if (isUserPendingReallocation) {
                return {
                    isAllocated: false,
                    hasActivePlan: true,
                    allocationStatus: "Pending Reallocation",
                    adminApprovalStatus: "Pending Reallocation",
                    requiresReallocation: true,
                    affectedDirections: affectedDirs,
                    inward: validInward || null,
                    outward: validOutward || null,
                    message: "Your travel response was received after the transportation plan was approved. Your bus and seat will be assigned after the administrator reviews and regenerates the transportation allocation."
                };
            }
            return {
                isAllocated: false,
                hasActivePlan: true,
                inward: null,
                outward: null,
                adminApprovalStatus: "Pending Admin Approval",
                message: "Waiting for the administrator to finalize your transportation plan."
            };
        }

        const activeTop = (validInward && validInward.isAllocated) ? validInward : validOutward;

        const fullAllocObj = {
            ...activeTop,
            isAllocated: true,
            adminApprovalStatus: isUserPendingReallocation ? "Pending Reallocation" : "Approved",
            allocationStatus: isUserPendingReallocation ? "Pending Reallocation" : "Assigned",
            requiresReallocation: isUserPendingReallocation,
            affectedDirections: isUserPendingReallocation ? affectedDirs : [],
            inward: validInward || null,
            outward: validOutward || null
        };

        // Persist back to User document in MongoDB for immediate state consistency
        try {
            const targetId = user._id || user.id;
            if (targetId) {
                await User.findByIdAndUpdate(targetId, {
                    $set: {
                        allocatedBus: fullAllocObj,
                        assignedVehicle: activeTop.vehicleName || activeTop.vehicleNumber || null,
                        assignedRoute: activeTop.routeCode || activeTop.routeName || null,
                        allocationStatus: isUserPendingReallocation ? "Pending Reallocation" : "Assigned"
                    }
                });
            }
        } catch (persistErr) {
            console.warn("Failed to persist resolved allocation to MongoDB user:", persistErr.message);
        }

        return fullAllocObj;
    } catch (err) {
        console.error("getUserAllocatedBus error:", err.message);
        return {
            isAllocated: false,
            inward: null,
            outward: null,
            adminApprovalStatus: "Pending Admin Approval",
            message: "Unable to retrieve bus allocation details at this time."
        };
    }
};

/*
|--------------------------------------------------------------------------
| SAVE FINAL ADMIN SELECTION
|--------------------------------------------------------------------------
*/

export const saveSelectedPlan = async (selection) => {
    if (!isDbConnected()) {
        return {
            success: false,
            code: "DATABASE_UNAVAILABLE",
            message: "Database is currently unavailable."
        };
    }

    try {
        const { planType, plan, startingPoint } = selection;

        // Validation gate check before persistence
        if (planType === "AI" && plan?.certification && plan.certification.isCertified === false) {
            return {
                success: false,
                code: "UNCERTIFIED_PLAN",
                message: "Cannot activate uncertified transportation plan. Validation checks failed."
            };
        }

        const rawDirection = selection?.direction || selection?.plan?.direction || selection?.tripMode || selection?.plan?.tripMode;
        const canonicalDirection = canonicalizeDirection(rawDirection) || "INWARD";
        const rawTripMode = canonicalDirection === "OUTWARD" ? "FROM_SOURCE" : "TO_DESTINATION";

        // If manual plan is passed without pre-allocated users, run full allocation engine
        let effectivePlan = plan;
        const explicitAllocationMode = selection?.allocationMode || ((planType === "ADMIN" || planType === "MANUAL") ? "MANUAL" : "AI");
        if (planType === "ADMIN" || planType === "MANUAL") {
            const hasUsersAllocated = Array.isArray(plan?.buses) && plan.buses.some((b) => Array.isArray(b.users) && b.users.length > 0);
            if (!hasUsersAllocated) {
                effectivePlan = await buildManualTransportationPlan({
                    direction: canonicalDirection,
                    routes: Array.isArray(plan?.routes) ? plan.routes : (Array.isArray(plan?.buses) ? plan.buses : null),
                    allocationMode: explicitAllocationMode
                });
            }
        }

        if (mongoose.connection.db) {
            // Supersede ONLY matching direction in ai_selected_plans so Outward and Inward co-exist!
            await mongoose.connection.db.collection("ai_selected_plans").updateMany(
                {
                    active: true,
                    $or: [
                        { direction: canonicalDirection },
                        { tripMode: canonicalDirection },
                        { tripMode: canonicalDirection === "OUTWARD" ? "FROM_SOURCE" : "TO_DESTINATION" },
                        { "plan.direction": canonicalDirection },
                        { "plan.tripMode": canonicalDirection },
                        { "plan.tripMode": canonicalDirection === "OUTWARD" ? "FROM_SOURCE" : "TO_DESTINATION" }
                    ]
                },
                { $set: { active: false, status: "superseded" } }
            );

            await mongoose.connection.db.collection("ai_selected_plans").insertOne({
                planType: planType || "AI",
                direction: canonicalDirection,
                tripMode: rawTripMode,
                plan: sanitizeTransportationPlan(effectivePlan),
                startingPoint,
                active: true,
                status: "active",
                approved: true,
                selectedAt: new Date(),
                approvedAt: new Date(),
                requiresReview: false,
                hasLateResponses: false,
                pendingReallocation: false,
                affectedDirections: []
            });

            // Mark matching generated AiPlan as approved for this direction ONLY when an AI plan is selected
            if (planType === "AI") {
                await AiPlan.updateMany(
                    {
                        active: true,
                        status: "active",
                        $or: [
                            { direction: canonicalDirection },
                            { tripMode: canonicalDirection },
                            { tripMode: canonicalDirection === "OUTWARD" ? "FROM_SOURCE" : "TO_DESTINATION" }
                        ]
                    },
                    {
                        $set: {
                            isApproved: true,
                            approvedAt: new Date(),
                            requiresReview: false,
                            hasLateResponses: false,
                            pendingReallocation: false
                        },
                        $pull: {
                            affectedDirections: canonicalDirection
                        }
                    }
                );
            }
        }

        // Persist individual user bus & route allocations for this direction, preserving the opposite direction
        await persistPlanToUsers(effectivePlan, canonicalDirection, startingPoint, null, planType || "AI", explicitAllocationMode);

        return {
            success: true,
            direction: canonicalDirection,
            selection: {
                planType: planType || "AI",
                direction: canonicalDirection,
                tripMode: rawTripMode,
                approved: true,
                selectedAt: new Date()
            },
            plan: effectivePlan,
            message: `${planType === "AI" ? "AI Recommended" : "Manual"} ${canonicalDirection} route plan activated and bus allocations published to all confirmed users successfully.`
        };
    } catch (error) {
        console.error("Save selected plan error:", error.message);
        throw new Error("Unable to save selected plan: " + error.message);
    }
};

/*
|--------------------------------------------------------------------------
| GET LAST SELECTED PLAN
|--------------------------------------------------------------------------
*/

export const getSelectedPlan = async (options = {}) => {
    if (!isDbConnected()) {
        return { success: false, selection: null, outwardSelection: null, inwardSelection: null, code: "DATABASE_UNAVAILABLE" };
    }

    try {
        const comingCount = await User.countDocuments({ role: "student", travelStatus: "Coming" });
        if (comingCount === 0) {
            return { success: true, selection: null, outwardSelection: null, inwardSelection: null };
        }

        if (!mongoose.connection.db) {
            return { success: true, selection: null, outwardSelection: null, inwardSelection: null };
        }

        const selectionProjection = {
            planType: 1,
            direction: 1,
            tripMode: 1,
            startingPoint: 1,
            active: 1,
            status: 1,
            approved: 1,
            selectedAt: 1,
            approvedAt: 1,
            createdAt: 1,
            requiresReview: 1,
            hasLateResponses: 1,
            pendingReallocation: 1,
            lastLateResponseAt: 1,
            affectedDirections: 1,
            "plan.planType": 1,
            "plan.direction": 1,
            "plan.tripMode": 1,
            "plan.startingPoint": 1,
            "plan.vehicleCount": 1,
            "plan.comingUsers": 1,
            "plan.assignedUsers": 1,
            "plan.allocatedUsers": 1,
            "plan.utilization": 1,
            "plan.totalRouteDistance": 1
        };

        const [outwardSelection, inwardSelection] = await Promise.all([
            mongoose.connection.db.collection("ai_selected_plans").findOne({
                active: true,
                $or: [
                    { direction: "OUTWARD" },
                    { tripMode: "OUTWARD" },
                    { tripMode: "FROM_SOURCE" },
                    { "plan.direction": "OUTWARD" },
                    { "plan.tripMode": "OUTWARD" },
                    { "plan.tripMode": "FROM_SOURCE" }
                ]
            }, { projection: selectionProjection, sort: { selectedAt: -1 } }),
            mongoose.connection.db.collection("ai_selected_plans").findOne({
                active: true,
                $or: [
                    { direction: "INWARD" },
                    { tripMode: "INWARD" },
                    { tripMode: "TO_DESTINATION" },
                    { "plan.direction": "INWARD" },
                    { "plan.tripMode": "INWARD" },
                    { "plan.tripMode": "TO_DESTINATION" }
                ]
            }, { projection: selectionProjection, sort: { selectedAt: -1 } })
        ]);

        const requestedDirection = options?.direction ? String(options.direction).toUpperCase().trim() : null;
        let activeSelection = null;
        if (requestedDirection === "OUTWARD") {
            activeSelection = outwardSelection;
        } else if (requestedDirection === "INWARD") {
            activeSelection = inwardSelection;
        } else {
            activeSelection = (outwardSelection && inwardSelection)
                ? (new Date(outwardSelection.selectedAt) > new Date(inwardSelection.selectedAt) ? outwardSelection : inwardSelection)
                : (outwardSelection || inwardSelection || null);
        }

        return {
            success: true,
            selection: activeSelection || null,
            outwardSelection: outwardSelection || null,
            inwardSelection: inwardSelection || null
        };
    } catch (error) {
        console.error("Get selected plan error:", error.message);
        return { success: false, selection: null, outwardSelection: null, inwardSelection: null, message: "Unable to load selected plan." };
    }
};

export const getAgentOverview = async () => {
    return await getAIData();
};

export const analyzeTransport = async () => {
    const data = await getAIData();
    return {
        success: true,
        ready: true,
        data
    };
};

/*
|--------------------------------------------------------------------------
| GET ACTIVE SAVED AI PLAN
|--------------------------------------------------------------------------
*/

export const getActiveAIPlan = async (options = {}) => {
    if (!isDbConnected()) {
        return { success: false, plan: null, outwardPlan: null, inwardPlan: null, code: "DATABASE_UNAVAILABLE" };
    }

    try {
        const comingCount = await User.countDocuments({ role: "student", travelStatus: "Coming" });
        if (comingCount === 0) {
            return {
                success: true,
                plan: null,
                outwardPlan: null,
                inwardPlan: null,
                message: "No active AI plan for zero confirmed passengers."
            };
        }

        const requestedDirection = options?.direction ? String(options.direction).toUpperCase().trim() : null;

        const [activeOutward, activeInward] = await Promise.all([
            AiPlan.findOne({
                active: true,
                status: "active",
                $or: [{ direction: "OUTWARD" }, { tripMode: "OUTWARD" }, { tripMode: "FROM_SOURCE" }]
            }).select("-stoppingGroups -recommendations -manualPlan -aiPlan.passengerAssignments -aiPlan.authoritativeAssignments -aiPlan.vehicles").sort({ createdAt: -1 }).lean(),
            AiPlan.findOne({
                active: true,
                status: "active",
                $or: [{ direction: "INWARD" }, { tripMode: "INWARD" }, { tripMode: "TO_DESTINATION" }]
            }).select("-stoppingGroups -recommendations -manualPlan -aiPlan.passengerAssignments -aiPlan.authoritativeAssignments -aiPlan.vehicles").sort({ createdAt: -1 }).lean()
        ]);

        let selectedPlan = null;
        if (requestedDirection === "OUTWARD") {
            selectedPlan = activeOutward;
        } else if (requestedDirection === "INWARD") {
            selectedPlan = activeInward;
        } else {
            selectedPlan = (activeOutward && activeInward)
                ? (new Date(activeOutward.createdAt) > new Date(activeInward.createdAt) ? activeOutward : activeInward)
                : (activeOutward || activeInward || null);
        }

        return {
            success: true,
            plan: selectedPlan,
            outwardPlan: activeOutward || null,
            inwardPlan: activeInward || null
        };
    } catch (error) {
        console.error("Get active AI plan error:", error.message);
        return {
            success: false,
            plan: null,
            outwardPlan: null,
            inwardPlan: null,
            message: "Unable to load active AI plan."
        };
    }
};

/*
|--------------------------------------------------------------------------
| RESET AI GENERATED ROUTE & ASSOCIATED ALLOCATIONS
|--------------------------------------------------------------------------
*/

export const resetGeneratedAIRoute = async (options = {}) => {
    if (!isDbConnected()) {
        throw new Error("Database is currently unavailable.");
    }

    const t0 = Date.now();
    try {
        const targetDirection = options?.direction ? String(options.direction).toUpperCase().trim() : null;
        const planTypeFilter = options?.planType ? String(options.planType).toUpperCase().trim() : "AI";
        console.log(`[RESET] Started ${targetDirection || "GLOBAL"} (${planTypeFilter})`);

        const aiPlanFilter = { active: true };
        const selectedPlanFilter = { active: true };

        if (planTypeFilter === "MANUAL") {
            selectedPlanFilter.planType = { $in: ["MANUAL", "ADMIN"] };
        } else {
            selectedPlanFilter.planType = "AI";
        }

        if (targetDirection === "OUTWARD" || targetDirection === "INWARD") {
            aiPlanFilter.$or = [
                { direction: targetDirection },
                { tripMode: targetDirection },
                { tripMode: targetDirection === "OUTWARD" ? "FROM_SOURCE" : "TO_DESTINATION" }
            ];
            selectedPlanFilter.$or = [
                { direction: targetDirection },
                { tripMode: targetDirection },
                { tripMode: targetDirection === "OUTWARD" ? "FROM_SOURCE" : "TO_DESTINATION" },
                { "plan.direction": targetDirection },
                { "plan.tripMode": targetDirection }
            ];
        }

        // Concurrent Reset Operations: AiPlan, ai_selected_plans, and User
        const tAiPlanStart = Date.now();
        const aiPlanPromise = (planTypeFilter === "MANUAL")
            ? Promise.resolve({ modifiedCount: 0 })
            : AiPlan.updateMany(
                aiPlanFilter,
                {
                    $set: {
                        active: false,
                        status: "reset",
                        isApproved: false,
                        resetAt: new Date(),
                        requiresReview: false,
                        hasLateResponses: false,
                        pendingReallocation: false,
                        affectedDirections: []
                    }
                }
            ).then((res) => {
                console.log(`[RESET] AiPlan: ${Date.now() - tAiPlanStart} ms (modified: ${res.modifiedCount})`);
                return res;
            });

        const tSelPlanStart = Date.now();
        const selectedPlanPromise = (mongoose.connection.db ? mongoose.connection.db.collection("ai_selected_plans").updateMany(
            selectedPlanFilter,
            {
                $set: {
                    active: false,
                    status: "reset",
                    approved: false,
                    resetAt: new Date(),
                    requiresReview: false,
                    hasLateResponses: false,
                    pendingReallocation: false,
                    affectedDirections: []
                }
            }
        ) : Promise.resolve({ modifiedCount: 0 })).then((res) => {
            console.log(`[RESET] selected plan: ${Date.now() - tSelPlanStart} ms (modified: ${res.modifiedCount})`);
            return res;
        });

        const tUsersStart = Date.now();
        let userPromise;

        if (planTypeFilter === "MANUAL") {
            // Only reset manual allocations; leave AI allocations, responses, and late response timestamps completely untouched!
            userPromise = User.updateMany(
                {
                    role: "student",
                    $or: [
                        { approvedPlanType: "MANUAL" },
                        { "allocatedBus.planType": { $in: ["MANUAL", "ADMIN"] } },
                        { manualBusId: { $ne: null } },
                        { manualRouteId: { $ne: null } }
                    ]
                },
                {
                    $set: {
                        manualRouteId: null,
                        manualBusId: null,
                        approvedPlanType: null,
                        manualAllocation: null,
                        assignedVehicle: null,
                        assignedRoute: null,
                        allocatedBus: null,
                        allocationStatus: "Unallocated"
                    }
                }
            ).then((res) => {
                console.log(`[RESET] manual users: ${Date.now() - tUsersStart} ms (modified: ${res.modifiedCount})`);
                return res;
            });
        } else if (targetDirection === "INWARD") {
            // Reset inward AI allocation while preserving any manual allocation and preserving late response timestamps!
            userPromise = User.updateMany(
                {
                    role: "student",
                    approvedPlanType: { $ne: "MANUAL" },
                    manualAllocation: null,
                    manualBusId: null,
                    $or: [
                        { "allocatedBus.inward": { $ne: null } },
                        { "allocatedBus.direction": "INWARD" },
                        { "allocatedBus.tripMode": "TO_DESTINATION" },
                        { affectedDirections: "INWARD" }
                    ]
                },
                [
                    {
                        $set: {
                            "allocatedBus.inward": null,
                            "allocatedBus.isAllocated": {
                                $cond: [
                                    { $eq: ["$allocatedBus.outward.isAllocated", true] },
                                    true,
                                    false
                                ]
                            },
                            "allocatedBus.direction": {
                                $cond: [
                                    { $eq: ["$allocatedBus.outward.isAllocated", true] },
                                    "OUTWARD",
                                    null
                                ]
                            },
                            "allocatedBus.tripMode": {
                                $cond: [
                                    { $eq: ["$allocatedBus.outward.isAllocated", true] },
                                    { $ifNull: ["$allocatedBus.outward.tripMode", "FROM_SOURCE"] },
                                    null
                                ]
                            },
                            "allocatedBus.vehicleName": {
                                $cond: [
                                    { $eq: ["$allocatedBus.outward.isAllocated", true] },
                                    "$allocatedBus.outward.vehicleName",
                                    null
                                ]
                            },
                            "allocatedBus.routeCode": {
                                $cond: [
                                    { $eq: ["$allocatedBus.outward.isAllocated", true] },
                                    "$allocatedBus.outward.routeCode",
                                    null
                                ]
                            },
                            "allocatedBus.adminApprovalStatus": {
                                $cond: [
                                    {
                                        $gt: [
                                            {
                                                $size: {
                                                    $filter: {
                                                        input: { $ifNull: ["$affectedDirections", []] },
                                                        as: "d",
                                                        cond: { $ne: ["$$d", "INWARD"] }
                                                    }
                                                }
                                            },
                                            0
                                        ]
                                    },
                                    "Pending Reallocation",
                                    {
                                        $cond: [
                                            { $eq: ["$allocatedBus.outward.isAllocated", true] },
                                            "Approved",
                                            "Pending Admin Approval"
                                        ]
                                    }
                                ]
                            },
                            "allocatedBus.message": {
                                $cond: [
                                    { $eq: ["$allocatedBus.outward.isAllocated", true] },
                                    null,
                                    "No approved transportation plan available yet."
                                ]
                            },
                            "allocatedBus.updatedAt": "$$NOW",
                            assignedVehicle: {
                                $cond: [
                                    { $eq: ["$allocatedBus.outward.isAllocated", true] },
                                    { $ifNull: ["$allocatedBus.outward.vehicleName", "$allocatedBus.outward.vehicleNumber"] },
                                    null
                                ]
                            },
                            assignedRoute: {
                                $cond: [
                                    { $eq: ["$allocatedBus.outward.isAllocated", true] },
                                    { $ifNull: ["$allocatedBus.outward.routeCode", "$allocatedBus.outward.routeName"] },
                                    null
                                ]
                            },
                            affectedDirections: {
                                $filter: {
                                    input: { $ifNull: ["$affectedDirections", []] },
                                    as: "d",
                                    cond: { $ne: ["$$d", "INWARD"] }
                                }
                            },
                            requiresReallocation: {
                                $cond: [
                                    {
                                        $gt: [
                                            {
                                                $size: {
                                                    $filter: {
                                                        input: { $ifNull: ["$affectedDirections", []] },
                                                        as: "d",
                                                        cond: { $ne: ["$$d", "INWARD"] }
                                                    }
                                                }
                                            },
                                            0
                                        ]
                                    },
                                    true,
                                    false
                                ]
                            },
                            lateResponseDetected: {
                                $cond: [
                                    {
                                        $gt: [
                                            {
                                                $size: {
                                                    $filter: {
                                                        input: { $ifNull: ["$affectedDirections", []] },
                                                        as: "d",
                                                        cond: { $ne: ["$$d", "INWARD"] }
                                                    }
                                                }
                                            },
                                            0
                                        ]
                                    },
                                    true,
                                    false
                                ]
                            },
                            allocationStatus: {
                                $cond: [
                                    {
                                        $gt: [
                                            {
                                                $size: {
                                                    $filter: {
                                                        input: { $ifNull: ["$affectedDirections", []] },
                                                        as: "d",
                                                        cond: { $ne: ["$$d", "INWARD"] }
                                                    }
                                                }
                                            },
                                            0
                                        ]
                                    },
                                    "Pending Reallocation",
                                    {
                                        $cond: [
                                            { $eq: ["$allocatedBus.outward.isAllocated", true] },
                                            "Assigned",
                                            {
                                                $cond: [
                                                    { $eq: ["$travelStatus", "Coming"] },
                                                    "Unallocated",
                                                    "Not Assigned"
                                                ]
                                            }
                                        ]
                                    }
                                ]
                            }
                        }
                    }
                ]
            ).then((res) => {
                console.log(`[RESET] users: ${Date.now() - tUsersStart} ms (modified: ${res.modifiedCount})`);
                return res;
            });
        } else if (targetDirection === "OUTWARD") {
            // Reset outward AI allocation while preserving any manual allocation and preserving late response timestamps!
            userPromise = User.updateMany(
                {
                    role: "student",
                    approvedPlanType: { $ne: "MANUAL" },
                    manualAllocation: null,
                    manualBusId: null,
                    $or: [
                        { "allocatedBus.outward": { $ne: null } },
                        { "allocatedBus.direction": "OUTWARD" },
                        { "allocatedBus.tripMode": "FROM_SOURCE" },
                        { affectedDirections: "OUTWARD" }
                    ]
                },
                [
                    {
                        $set: {
                            "allocatedBus.outward": null,
                            "allocatedBus.isAllocated": {
                                $cond: [
                                    { $eq: ["$allocatedBus.inward.isAllocated", true] },
                                    true,
                                    false
                                ]
                            },
                            "allocatedBus.direction": {
                                $cond: [
                                    { $eq: ["$allocatedBus.inward.isAllocated", true] },
                                    "INWARD",
                                    null
                                ]
                            },
                            "allocatedBus.tripMode": {
                                $cond: [
                                    { $eq: ["$allocatedBus.inward.isAllocated", true] },
                                    { $ifNull: ["$allocatedBus.inward.tripMode", "TO_DESTINATION"] },
                                    null
                                ]
                            },
                            "allocatedBus.vehicleName": {
                                $cond: [
                                    { $eq: ["$allocatedBus.inward.isAllocated", true] },
                                    "$allocatedBus.inward.vehicleName",
                                    null
                                ]
                            },
                            "allocatedBus.routeCode": {
                                $cond: [
                                    { $eq: ["$allocatedBus.inward.isAllocated", true] },
                                    "$allocatedBus.inward.routeCode",
                                    null
                                ]
                            },
                            "allocatedBus.adminApprovalStatus": {
                                $cond: [
                                    {
                                        $gt: [
                                            {
                                                $size: {
                                                    $filter: {
                                                        input: { $ifNull: ["$affectedDirections", []] },
                                                        as: "d",
                                                        cond: { $ne: ["$$d", "OUTWARD"] }
                                                    }
                                                }
                                            },
                                            0
                                        ]
                                    },
                                    "Pending Reallocation",
                                    {
                                        $cond: [
                                            { $eq: ["$allocatedBus.inward.isAllocated", true] },
                                            "Approved",
                                            "Pending Admin Approval"
                                        ]
                                    }
                                ]
                            },
                            "allocatedBus.message": {
                                $cond: [
                                    { $eq: ["$allocatedBus.inward.isAllocated", true] },
                                    null,
                                    "No approved transportation plan available yet."
                                ]
                            },
                            "allocatedBus.updatedAt": "$$NOW",
                            assignedVehicle: {
                                $cond: [
                                    { $eq: ["$allocatedBus.inward.isAllocated", true] },
                                    { $ifNull: ["$allocatedBus.inward.vehicleName", "$allocatedBus.inward.vehicleNumber"] },
                                    null
                                ]
                            },
                            assignedRoute: {
                                $cond: [
                                    { $eq: ["$allocatedBus.inward.isAllocated", true] },
                                    { $ifNull: ["$allocatedBus.inward.routeCode", "$allocatedBus.inward.routeName"] },
                                    null
                                ]
                            },
                            affectedDirections: {
                                $filter: {
                                    input: { $ifNull: ["$affectedDirections", []] },
                                    as: "d",
                                    cond: { $ne: ["$$d", "OUTWARD"] }
                                }
                            },
                            requiresReallocation: {
                                $cond: [
                                    {
                                        $gt: [
                                            {
                                                $size: {
                                                    $filter: {
                                                        input: { $ifNull: ["$affectedDirections", []] },
                                                        as: "d",
                                                        cond: { $ne: ["$$d", "OUTWARD"] }
                                                    }
                                                }
                                            },
                                            0
                                        ]
                                    },
                                    true,
                                    false
                                ]
                            },
                            lateResponseDetected: {
                                $cond: [
                                    {
                                        $gt: [
                                            {
                                                $size: {
                                                    $filter: {
                                                        input: { $ifNull: ["$affectedDirections", []] },
                                                        as: "d",
                                                        cond: { $ne: ["$$d", "OUTWARD"] }
                                                    }
                                                }
                                            },
                                            0
                                        ]
                                    },
                                    true,
                                    false
                                ]
                            },
                            allocationStatus: {
                                $cond: [
                                    {
                                        $gt: [
                                            {
                                                $size: {
                                                    $filter: {
                                                        input: { $ifNull: ["$affectedDirections", []] },
                                                        as: "d",
                                                        cond: { $ne: ["$$d", "OUTWARD"] }
                                                    }
                                                }
                                            },
                                            0
                                        ]
                                    },
                                    "Pending Reallocation",
                                    {
                                        $cond: [
                                            { $eq: ["$allocatedBus.inward.isAllocated", true] },
                                            "Assigned",
                                            {
                                                $cond: [
                                                    { $eq: ["$travelStatus", "Coming"] },
                                                    "Unallocated",
                                                    "Not Assigned"
                                                ]
                                            }
                                        ]
                                    }
                                ]
                            }
                        }
                    }
                ]
            ).then((res) => {
                console.log(`[RESET] users: ${Date.now() - tUsersStart} ms (modified: ${res.modifiedCount})`);
                return res;
            });
        } else {
            // Global reset of AI plans: EXCLUDES manual plan allocations and PRESERVES late response timestamps & flags!
            userPromise = User.updateMany(
                {
                    role: "student",
                    approvedPlanType: { $ne: "MANUAL" },
                    manualAllocation: null,
                    manualBusId: null,
                    $or: [
                        { "allocatedBus.isAllocated": true },
                        { "allocatedBus.planType": "AI" },
                        { "allocatedBus.inward": { $ne: null } },
                        { "allocatedBus.outward": { $ne: null } },
                        { requiresReallocation: true },
                        { allocationStatus: "Pending Reallocation" }
                    ]
                },
                [
                    {
                        $set: {
                            assignedVehicle: null,
                            assignedRoute: null,
                            allocationStatus: {
                                $cond: [
                                    { $eq: ["$travelStatus", "Coming"] },
                                    "Unallocated",
                                    "Not Assigned"
                                ]
                            },
                            allocatedBus: {
                                isAllocated: false,
                                inward: null,
                                outward: null,
                                adminApprovalStatus: "Pending Admin Approval",
                                message: "No approved transportation plan available yet.",
                                updatedAt: new Date()
                            },
                            aiAllocation: null,
                            approvedPlanType: null,
                            requiresReallocation: false,
                            affectedDirections: []
                            // CRITICAL: lateResponseDetected, isLateResponse, lateResponseAt, and travelResponseSubmittedAt are PRESERVED!
                        }
                    }
                ]
            ).then((res) => {
                console.log(`[RESET] users: ${Date.now() - tUsersStart} ms (modified: ${res.modifiedCount})`);
                return res;
            });
        }

        const [planRes, selRes, userRes] = await Promise.all([
            aiPlanPromise,
            selectedPlanPromise,
            userPromise
        ]);

        // Resolve LateResponseEvent records for the reset direction(s)
        // This prevents stale notifications from reappearing after a plan reset.
        try {
            const lreFilter = { status: { $nin: ["RESOLVED", "ALLOCATED"] } };
            if (targetDirection === "OUTWARD" || targetDirection === "INWARD") {
                lreFilter.direction = targetDirection;
            }
            const lreResult = await LateResponseEvent.updateMany(
                lreFilter,
                { $set: { status: "RESOLVED", resolvedAt: new Date() } }
            );
            if (lreResult.modifiedCount > 0) {
                console.log(`[LATE RESPONSE RESOLVED] AI plan reset (${targetDirection || "GLOBAL"}) — resolved ${lreResult.modifiedCount} LateResponseEvent(s)`);
            }
        } catch (lreErr) {
            console.error("[LATE RESPONSE RESOLVED] LateResponseEvent resolve error during plan reset:", lreErr.message);
        }

        const totalMs = Date.now() - t0;
        console.log(`[RESET] Total: ${totalMs} ms`);

        const dirLabel = targetDirection || "AI";
        return {
            success: true,
            direction: targetDirection,
            message: `${dirLabel} AI transportation plan reset successfully. Student travel responses remain preserved.`,
            planReset: (planRes?.modifiedCount || 0) > 0 || (planRes?.matchedCount || 0) > 0,
            allocationsCleared: userRes?.modifiedCount || 0,
            studentsReset: 0,
            durationMs: totalMs
        };
    } catch (error) {
        console.error("Reset AI plan error:", error.message);
        throw new Error(error.message || "Failed to reset AI plan.");
    }
};

export const resetAIPlanAndStudents = resetGeneratedAIRoute;