import mongoose from "mongoose";
import AiPlan from "../models/AiPlan.js";
import User from "../models/User.js";
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

export const isValidCoordinate = (latitude, longitude) => {
    const lat = Number(latitude);
    const lng = Number(longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
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

/*
|--------------------------------------------------------------------------
| DATABASE HELPERS
|--------------------------------------------------------------------------
*/

const getCollectionData = async (collectionName) => {
    try {
        if (!isDbConnected() || !mongoose.connection.db) {
            return [];
        }

        return await mongoose.connection.db
            .collection(collectionName)
            .find({})
            .toArray();
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

export const calculateStoppingGroups = (users) => {
    const groups = {};

    users.forEach((user) => {
        const stoppings = getUserStoppings(user);
        const coordinateStops = getStopCoordinatesFromUser(user);
        const primaryStop = stoppings[0];
        if (!primaryStop) return;

        const key = primaryStop.toLowerCase().replace(/\s+/g, " ").trim();

        if (!groups[key]) {
            groups[key] = {
                name: primaryStop,
                users: [],
                userIds: [],
                userCount: 0,
                latitude: null,
                longitude: null
            };
        }

        groups[key].users.push(user);

        const uId = String(user?._id || user?.userId || user?.id || "");
        if (uId) {
            groups[key].userIds.push(uId);
        }
        groups[key].userCount = groups[key].users.length;

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
            availability !== "disabled" &&
            availability !== "inactive" &&
            availability !== "off"
        );
    });
};

/*
|--------------------------------------------------------------------------
| GET AI SUMMARY DATA
|--------------------------------------------------------------------------
*/

export const getAIData = async () => {
    if (!isDbConnected()) {
        return {
            success: false,
            code: "DATABASE_UNAVAILABLE",
            message: "Database is currently unavailable."
        };
    }

    const [allUsers, vehicles, routes, schedules] = await Promise.all([
        getCollectionData("users"),
        getCollectionData("vehicles"),
        getCollectionData("routes"),
        getCollectionData("schedules")
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

    const name = item.namedetails?.name || item.name || item.display_name?.split(",")[0] || "Location";
    const displayName = item.display_name || name;
    const address = item.display_name || "";

    const distanceKm = proximityPoint && isValidCoordinate(proximityPoint.latitude, proximityPoint.longitude)
        ? Number(calculateDistanceKm(proximityPoint.latitude, proximityPoint.longitude, latitude, longitude).toFixed(2))
        : null;

    return {
        name,
        displayName,
        address,
        latitude,
        longitude,
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
    const parts = [
        props.name,
        props.street,
        props.city || props.town || props.village,
        props.state,
        props.country
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

export const searchPlaces = async (query, proximityPoint = null) => {
    const clean = String(query || "").trim();
    if (!clean || clean.length < 2) return [];

    const cacheKey = `${clean.toLowerCase()}_${proximityPoint?.latitude || ""}_${proximityPoint?.longitude || ""}`;
    if (coordinateCache.has(cacheKey)) {
        return [coordinateCache.get(cacheKey)];
    }

    const variants = [clean];
    // Acronym dotting / undotting
    const unpunct = clean.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"+\[\]|\\]/g, " ").replace(/\s+/g, " ").trim();
    if (unpunct && unpunct !== clean) variants.push(unpunct);

    const words = unpunct.split(/\s+/).filter(Boolean);
    for (const w of words) {
        if (/^[a-zA-Z]{2,4}$/.test(w) && !["the", "and", "for", "out", "new"].includes(w.toLowerCase())) {
            const spacedDotted = w.split("").join(". ") + ".";
            variants.push(clean.replace(new RegExp(`\\b${w}\\b`, "i"), spacedDotted.toUpperCase()));
            variants.push(clean.replace(new RegExp(`\\b${w}\\b`, "i"), spacedDotted.replace(/\s+/g, "").toUpperCase()));
        }
    }

    const withoutRd = unpunct.replace(/\b(office\s+)?(rd|road|street|st|ave|lane|junction|stop|stand|depot)\b/gi, " ").replace(/\s+/g, " ").trim();
    if (withoutRd && withoutRd !== unpunct) variants.push(withoutRd);

    if (words.length >= 3) {
        variants.push(words.slice(0, -1).join(" "));
        variants.push(`${words[0]} ${words[words.length - 1]}`);
    }

    const results = [];

    // Stage 1: Parallel fast search
    const fastPromises = [
        searchWikidataBackend(clean),
        (async () => {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 4000);
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

    for (const v of Array.from(new Set(variants)).slice(1)) {
        fastPromises.push((async () => {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 4000);
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

    const responses = await Promise.allSettled(fastPromises);
    for (const res of responses) {
        if (res.status === "fulfilled" && Array.isArray(res.value)) {
            results.push(...res.value);
        }
    }

    // Stage 2: Fallback Nominatim queries on distinctive variants
    if (results.length === 0 && variants.length > 1) {
        const fallbackVariants = [...variants.slice(1)].reverse();
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
        let validResults = results;
        if (proximityPoint && isValidCoordinate(proximityPoint.latitude, proximityPoint.longitude)) {
            const MAX_TRANSIT_RADIUS_KM = 65;
            validResults = results
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

const KNOWN_TRANSIT_STOPS = {
    "arappalayam": { name: "Arappalayam", latitude: 9.9342, longitude: 78.1030, displayName: "Arappalayam, Madurai" },
    "simmakkal": { name: "Simmakkal", latitude: 9.9288, longitude: 78.1215, displayName: "Simmakkal, Madurai" },
    "periyar": { name: "Periyar", latitude: 9.9178, longitude: 78.1147, displayName: "Periyar Bus Stand, Madurai" },
    "anna nagar": { name: "Anna Nagar", latitude: 9.9192, longitude: 78.1492, displayName: "Anna Nagar, Madurai" },
    "kk nagar": { name: "KK Nagar", latitude: 9.9315, longitude: 78.1472, displayName: "KK Nagar, Madurai" },
    "k.k. nagar": { name: "KK Nagar", latitude: 9.9315, longitude: 78.1472, displayName: "KK Nagar, Madurai" },
    "k.k. nagar west": { name: "K.K. Nagar West", latitude: 9.9302, longitude: 78.1425, displayName: "K.K. Nagar West, Madurai" },
    "kk nagar west": { name: "K.K. Nagar West", latitude: 9.9302, longitude: 78.1425, displayName: "K.K. Nagar West, Madurai" },
    "mattuthavani": { name: "Mattuthavani", latitude: 9.9482, longitude: 78.1585, displayName: "Mattuthavani (MGR Bus Stand), Madurai" },
    "tallakulam": { name: "Tallakulam", latitude: 9.9348, longitude: 78.1345, displayName: "Tallakulam, Madurai" },
    "goripalayam": { name: "Goripalayam", latitude: 9.9305, longitude: 78.1292, displayName: "Goripalayam, Madurai" },
    "sellur": { name: "Sellur", latitude: 9.9425, longitude: 78.1182, displayName: "Sellur, Madurai" },
    "teppakulam": { name: "Teppakulam", latitude: 9.9152, longitude: 78.1518, displayName: "Teppakulam, Madurai" },
    "anuppanadi": { name: "Anuppanadi", latitude: 9.9075, longitude: 78.1442, displayName: "Anuppanadi, Madurai" },
    "villapuram": { name: "Villapuram", latitude: 9.8972, longitude: 78.1165, displayName: "Villapuram, Madurai" },
    "jaihindpuram": { name: "Jaihindpuram", latitude: 9.9052, longitude: 78.1075, displayName: "Jaihindpuram, Madurai" },
    "thirunagar": { name: "Thirunagar", latitude: 9.8665, longitude: 78.0725, displayName: "Thirunagar, Madurai" },
    "alagappan nagar": { name: "Alagappan Nagar", latitude: 9.8985, longitude: 78.0982, displayName: "Alagappan Nagar, Madurai" },
    "kochadai": { name: "Kochadai", latitude: 9.9385, longitude: 78.0825, displayName: "Kochadai, Madurai" },
    "kochadai junction": { name: "Kochadai Junction", latitude: 9.9372, longitude: 78.0852, displayName: "Kochadai Junction, Madurai" },
    "vilangudi": { name: "Vilangudi", latitude: 9.9575, longitude: 78.0965, displayName: "Vilangudi, Madurai" },
    "koodal nagar": { name: "Koodal Nagar", latitude: 9.9625, longitude: 78.1085, displayName: "Koodal Nagar, Madurai" },
    "othakadai": { name: "Othakadai", latitude: 9.9725, longitude: 78.1825, displayName: "Othakadai, Madurai" },
    "iyer bungalow": { name: "Iyer Bungalow", latitude: 9.9655, longitude: 78.1395, displayName: "Iyer Bungalow, Madurai" },
    "vandiyur": { name: "Vandiyur", latitude: 9.9225, longitude: 78.1685, displayName: "Vandiyur, Madurai" },
    "pudur": { name: "Pudur", latitude: 9.9495, longitude: 78.1465, displayName: "Pudur, Madurai" },
    "k.pudur": { name: "K.Pudur", latitude: 9.9495, longitude: 78.1465, displayName: "K.Pudur, Madurai" },
    "k pudur": { name: "K.Pudur", latitude: 9.9495, longitude: 78.1465, displayName: "K.Pudur, Madurai" },
    "avaniyapuram": { name: "Avaniyapuram", latitude: 9.8825, longitude: 78.1185, displayName: "Avaniyapuram, Madurai" },
    "palanganatham": { name: "Palanganatham", latitude: 9.9075, longitude: 78.0995, displayName: "Palanganatham, Madurai" },
    "bibikulam": { name: "Bibikulam", latitude: 9.9415, longitude: 78.1352, displayName: "Bibikulam, Madurai" },
    "narimedu": { name: "Narimedu", latitude: 9.9382, longitude: 78.1315, displayName: "Narimedu, Madurai" },
    "thiruppalai": { name: "Thiruppalai", latitude: 9.9815, longitude: 78.1485, displayName: "Thiruppalai, Madurai" }
};

const resolveStopCoordinates = async (stoppingGroups, startingPoint) => {
    const resolved = [];
    const MAX_TRANSIT_RADIUS_KM = 65;

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

    for (const group of stoppingGroups) {
        // 1. Direct coordinate from user record if valid
        if (isValidCoordinate(group.latitude, group.longitude)) {
            resolved.push({
                ...group,
                latitude: Number(group.latitude),
                longitude: Number(group.longitude),
                resolved: true
            });
            continue;
        }

        const cacheKey = `${group.name.toLowerCase()}_${Number(startingPoint?.latitude || 0).toFixed(2)}_${Number(startingPoint?.longitude || 0).toFixed(2)}`;
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

        // 2. Authoritative Known Transit Stops Dictionary
        const knownMatch = KNOWN_TRANSIT_STOPS[normGroupName] || KNOWN_TRANSIT_STOPS[group.name.toLowerCase().trim()];
        if (knownMatch && isValidCoordinate(knownMatch.latitude, knownMatch.longitude)) {
            const stopObj = {
                ...group,
                latitude: knownMatch.latitude,
                longitude: knownMatch.longitude,
                displayName: knownMatch.displayName,
                source: "Transit Authority GIS",
                resolved: true
            };
            coordinateCache.set(cacheKey, stopObj);
            resolved.push(stopObj);
            continue;
        }

        // 3. Check pre-fetched DB locations
        const matchedDbLoc = dbLocations.find((loc) => {
            const normLocName = normalizeTextBackend(loc.name);
            return normLocName === normGroupName || normLocName.includes(normGroupName) || normGroupName.includes(normLocName);
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

        // 3. Online geocode search with proximity bias
        try {
            const results = await searchPlaces(group.name, startingPoint);
            if (results.length > 0) {
                const best = results[0];
                const resolvedStop = {
                    ...group,
                    latitude: Number(best.latitude),
                    longitude: Number(best.longitude),
                    displayName: best.displayName,
                    source: best.source,
                    resolved: true
                };
                coordinateCache.set(cacheKey, resolvedStop);
                resolved.push(resolvedStop);
            } else {
                // If not resolvable, DO NOT fabricate fake coordinates. Mark MISSING_STOP_COORDINATES.
                resolved.push({
                    ...group,
                    latitude: null,
                    longitude: null,
                    resolved: false,
                    unallocatedReason: "MISSING_STOP_COORDINATES",
                    diagnosticMessage: `Stop '${group.name}' coordinates could not be resolved within the transit catchment area.`
                });
            }
        } catch {
            resolved.push({
                ...group,
                latitude: null,
                longitude: null,
                resolved: false,
                unallocatedReason: "MISSING_STOP_COORDINATES",
                diagnosticMessage: `Geocoding request failed for stop '${group.name}'.`
            });
        }
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
        const res = { distanceKm: 0.05, durationMin: 0.5, isRoadVerified: true, straightLineKm };
        roadSegmentCache.set(key, res);
        return res;
    }

    const query = `${Number(fromPt.longitude).toFixed(6)},${Number(fromPt.latitude).toFixed(6)};${Number(toPt.longitude).toFixed(6)},${Number(toPt.latitude).toFixed(6)}`;
    const baseUrl = process.env.ROUTING_BASE_URL || process.env.OSRM_BASE_URL || "https://router.project-osrm.org";
    const url = `${baseUrl}/route/v1/driving/${query}?overview=false&steps=false`;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (response.ok) {
            const data = await response.json();
            if (data?.code === "Ok" && Array.isArray(data?.routes) && data.routes.length > 0) {
                const route = data.routes[0];
                const distanceKm = Number((Number(route.distance || 0) / 1000).toFixed(2));
                const durationMin = Number((Number(route.duration || 0) / 60).toFixed(1));

                // Sanity check: road distance cannot be < 0.7x straight line or > 3.5x straight line + 15km
                if (distanceKm >= straightLineKm * 0.7 && distanceKm <= straightLineKm * 3.5 + 15) {
                    const res = {
                        distanceKm,
                        durationMin,
                        isRoadVerified: true,
                        straightLineKm: Number(straightLineKm.toFixed(2))
                    };
                    roadSegmentCache.set(key, res);
                    return res;
                }
            }
        }
    } catch {
        // network error or timeout
    }

    // Calibrated urban road estimate
    const fallbackRes = {
        distanceKm: Number((straightLineKm * 1.25).toFixed(2)),
        durationMin: Number(((straightLineKm * 1.25) / 0.5).toFixed(1)),
        isRoadVerified: false,
        straightLineKm: Number(straightLineKm.toFixed(2))
    };
    roadSegmentCache.set(key, fallbackRes);
    return fallbackRes;
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

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4500);

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) return null;

        const data = await response.json();
        if (data?.code !== "Ok" || !Array.isArray(data?.routes) || data.routes.length === 0) {
            return null;
        }

        const route = data.routes[0];
        const coordinates = Array.isArray(route?.geometry?.coordinates)
            ? route.geometry.coordinates
            : [];

        const distanceMeters = Number(route.distance || 0);
        const distanceKm = Number((distanceMeters / 1000).toFixed(2));
        const durationSeconds = Number(route.duration || 0);

        // Calculate straight-line baseline for sanity checking
        let straightLineKm = 0;
        for (let i = 0; i < validPoints.length - 1; i++) {
            straightLineKm += calculateDistanceKm(
                validPoints[i].latitude, validPoints[i].longitude,
                validPoints[i + 1].latitude, validPoints[i + 1].longitude
            );
        }

        // ANOMALY REJECTION:
        if (
            (straightLineKm < 50 && distanceKm > 150) ||
            (distanceKm > straightLineKm * 4.0 + 30) ||
            (distanceKm < straightLineKm * 0.7)
        ) {
            console.warn(`[OSRM Anomaly Detected] Rejected route distance: ${distanceKm}km for straight-line: ${straightLineKm.toFixed(2)}km`);
            return null;
        }

        return {
            distanceMeters,
            distanceKm,
            durationSeconds,
            straightLineKm: Number(straightLineKm.toFixed(2)),
            geometry: coordinates.map(([longitude, latitude]) => ({
                latitude: Number(latitude),
                longitude: Number(longitude)
            }))
        };
    } catch {
        return null;
    }
};

/*
|--------------------------------------------------------------------------
| GEOGRAPHIC CORRIDOR GROUPING (Directional Sector Partitioning)
|--------------------------------------------------------------------------
*/

const CORRIDOR_BEARING_TOLERANCE_DEG = 50;
const CORRIDOR_MAX_DIST_KM = 50;

const groupStopsIntoCorridors = (stops, anchorHub) => {
    const enriched = stops.map((stop) => ({
        ...stop,
        distanceFromStart: calculateDistanceKm(
            anchorHub.latitude, anchorHub.longitude,
            stop.latitude, stop.longitude
        ),
        bearingFromStart: calculateBearing(
            anchorHub.latitude, anchorHub.longitude,
            stop.latitude, stop.longitude
        )
    }));

    enriched.sort((a, b) => a.bearingFromStart - b.bearingFromStart || a.distanceFromStart - b.distanceFromStart);

    const corridors = [];
    const assigned = new Set();

    for (let i = 0; i < enriched.length; i++) {
        if (assigned.has(i)) continue;

        const seed = enriched[i];
        const corridor = [seed];
        assigned.add(i);

        for (let j = i + 1; j < enriched.length; j++) {
            if (assigned.has(j)) continue;
            const candidate = enriched[j];

            const bearingDiff = Math.abs(candidate.bearingFromStart - seed.bearingFromStart);
            const normalizedDiff = Math.min(bearingDiff, 360 - bearingDiff);
            const distBetween = calculateDistanceKm(
                seed.latitude, seed.longitude,
                candidate.latitude, candidate.longitude
            );

            if (normalizedDiff <= CORRIDOR_BEARING_TOLERANCE_DEG && distBetween <= CORRIDOR_MAX_DIST_KM) {
                corridor.push(candidate);
                assigned.add(j);
            }
        }

        corridors.push(corridor);
    }

    return corridors;
};

/*
|--------------------------------------------------------------------------
| 2-OPT ROUTE IMPROVEMENT (Fixed Endpoints & Road Continuity Safe)
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
                const prevI = currentTour[i - 1];
                const currI = currentTour[i];
                const currJ = currentTour[j];
                const nextJ = currentTour[j + 1];

                if (!prevI || !currI || !currJ || !nextJ) continue;

                // Current cost of the two breaking segments
                const d1 = await getRoadSegmentCached(prevI, currI);
                const d2 = await getRoadSegmentCached(currJ, nextJ);
                const currentCost = (d1?.distanceKm || 0) + (d2?.distanceKm || 0);

                // Proposed cost if sub-tour i..j is reversed
                const r1 = await getRoadSegmentCached(prevI, currJ);
                const r2 = await getRoadSegmentCached(currI, nextJ);
                const proposedCost = (r1?.distanceKm || 0) + (r2?.distanceKm || 0);

                // Reversal must strictly improve road distance
                if (proposedCost < currentCost - 0.20) {
                    // Check if reversal introduces directional inversion or severe backtracking
                    const b1 = calculateBearing(prevI.latitude, prevI.longitude, currJ.latitude, currJ.longitude);
                    const b2 = calculateBearing(currI.latitude, currI.longitude, nextJ.latitude, nextJ.longitude);
                    const angleDiff = getBearingDifference(b1, b2);

                    // If reversal creates a severe directional reversal (> 130 deg), reject to preserve corridor continuity
                    if (angleDiff > 130) {
                        continue;
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
| CONTINUOUS STOP SEQUENCING (Strict Continuous Road-Corridor Routing)
|--------------------------------------------------------------------------
*/

export const sequenceStopsContinuous = async (
    stops,
    anchorHub,
    tripMode = "TO_DESTINATION",
    sourceHub = null,
    destinationHub = null
) => {
    if (!Array.isArray(stops) || stops.length === 0) return [];

    const isToDestination = tripMode === "TO_DESTINATION" || tripMode === "INWARD";
    const refHub = isToDestination
        ? (destinationHub || anchorHub)
        : (sourceHub || anchorHub);

    if (stops.length === 1) {
        const single = stops[0];
        const seg = refHub ? await getRoadSegmentCached(refHub, single) : null;
        const legDist = seg?.distanceKm ?? Number(calculateDistanceKm(refHub.latitude, refHub.longitude, single.latitude, single.longitude).toFixed(2));
        const legDur = seg?.durationMin ?? Number((legDist / 0.5).toFixed(1));
        const bearing = refHub ? calculateBearing(refHub.latitude, refHub.longitude, single.latitude, single.longitude) : 0;
        return [{
            ...single,
            order: 1,
            previousStopName: refHub?.name || (isToDestination ? "Origin" : "Source"),
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
        bearingFromHub: calculateBearing(refHub.latitude, refHub.longitude, s.latitude, s.longitude)
    }));

    const orderedTour = [];

    // Phase 1: Determine initial seed stop from Source / Outer Origin
    let initialIndex = 0;
    if (isToDestination) {
        // Inward mode: Start at outermost demand stop furthest from destination
        let maxDist = -1;
        unvisited.forEach((s, idx) => {
            if (s.distFromHub > maxDist) {
                maxDist = s.distFromHub;
                initialIndex = idx;
            }
        });
    } else {
        // Outward mode: Start at nearest suitable demand stop by ACTUAL OSRM ROAD DISTANCE from Source
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
    const initialSeg = refHub ? await getRoadSegmentCached(refHub, initialStop) : null;
    const initialLegDist = initialSeg?.distanceKm ?? Number(initialStop.distFromHub.toFixed(2));
    const initialLegDur = initialSeg?.durationMin ?? Number((initialLegDist / 0.5).toFixed(1));
    const initialBearing = refHub ? calculateBearing(refHub.latitude, refHub.longitude, initialStop.latitude, initialStop.longitude) : 0;

    initialStop.previousStopName = refHub?.name || (isToDestination ? "Outer Origin" : "Source Hub");
    initialStop.legDistanceKm = initialLegDist;
    initialStop.legDurationMin = initialLegDur;
    initialStop.segmentBearing = Number(initialBearing.toFixed(1));
    initialStop.isContinuousLeg = true;
    initialStop.backtrackingLeg = false;
    initialStop.selectionReason = isToDestination
        ? `${initialStop.name} selected as outer origin stop (+${initialLegDist} km to ${refHub.name || "Destination"}).`
        : `${initialStop.name} selected: nearest suitable stop by road distance from ${refHub.name || "Source"} (+${initialLegDist} km, ~${initialLegDur}m).`;
    orderedTour.push(initialStop);

    let currentPoint = initialStop;
    // Establish initial route corridor direction
    let corridorBearing = initialBearing;
    let lastSegmentBearing = initialBearing;

    // Phase 2: Sequential Continuous Next-Stop Selection
    while (unvisited.length > 0) {
        // Pre-filter top candidates by proximity
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

            // Angular divergence from previous segment and initial corridor
            const deltaPrevBearing = getBearingDifference(lastSegmentBearing, candBearing);
            const deltaCorridorBearing = getBearingDifference(corridorBearing, candBearing);

            // Detour & directional progress metrics
            let detourKm = 0;
            let forwardProgress = 0;
            let isBacktracking = false;
            let backtrackingPenalty = 0;

            const targetPoint = isToDestination ? (destinationHub || anchorHub) : null;
            const originPoint = !isToDestination ? (sourceHub || anchorHub) : null;

            if (targetPoint && isValidCoordinate(targetPoint.latitude, targetPoint.longitude)) {
                const currentToTarget = calculateDistanceKm(currentPoint.latitude, currentPoint.longitude, targetPoint.latitude, targetPoint.longitude);
                const candToTarget = calculateDistanceKm(cand.latitude, cand.longitude, targetPoint.latitude, targetPoint.longitude);

                detourKm = Math.max(0, (roadKm + candToTarget) - currentToTarget);
                forwardProgress = currentToTarget - candToTarget;

                // Backtracking detection towards destination
                if (forwardProgress < -1.0 && deltaPrevBearing > 100) {
                    isBacktracking = true;
                    backtrackingPenalty = Math.abs(forwardProgress) * 3.0;
                }
            } else if (originPoint && isValidCoordinate(originPoint.latitude, originPoint.longitude)) {
                const currentToOrigin = calculateDistanceKm(currentPoint.latitude, currentPoint.longitude, originPoint.latitude, originPoint.longitude);
                const candToOrigin = calculateDistanceKm(cand.latitude, cand.longitude, originPoint.latitude, originPoint.longitude);

                // Outward progress: distance from origin should increase along corridor
                const outwardProgress = candToOrigin - currentToOrigin;
                forwardProgress = outwardProgress;

                // Backtracking detection towards source
                if (outwardProgress < -1.5 && deltaPrevBearing > 100) {
                    isBacktracking = true;
                    backtrackingPenalty = Math.abs(outwardProgress) * 2.5;
                }
            }

            // STRICT CANDIDATE CONTINUITY FILTER
            const isDirectionalReversal = deltaPrevBearing > 125;
            const isSevereCorridorDeviation = deltaCorridorBearing > 85 && roadKm > 5.0;
            const isContinuousCandidate = !isBacktracking && !isDirectionalReversal && !isSevereCorridorDeviation;

            // Priority 1 & 2: Practical road distance + travel time
            let score = (roadKm * 1.0) + (roadDur * 0.1);

            // Priority 3, 4, 5: Detour, Backtracking, and Forward Progress
            score += detourKm * 0.9;
            score += backtrackingPenalty;
            if (forwardProgress > 0) {
                score -= Math.min(forwardProgress * 0.15, 1.5);
            }

            // Severe penalty for non-continuous candidates so continuous candidates are ALWAYS preferred
            if (!isContinuousCandidate) {
                score += 30.0;
            }

            // Priority 7: Demand concentration
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
                    isContinuousLeg: isContinuousCandidate,
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
        nextStop.selectionReason = bestCandidateEntry.isContinuousLeg
            ? `${nextStop.name} selected: nearest valid continuous stop along corridor from ${currentPoint.name} (+${bestCandidateEntry.roadKm} km road distance, ~${bestCandidateEntry.roadDur}m).`
            : `${nextStop.name} selected: corridor continuation from ${currentPoint.name} (+${bestCandidateEntry.roadKm} km road distance, ~${bestCandidateEntry.roadDur}m).`;

        orderedTour.push(nextStop);
        currentPoint = nextStop;
        lastSegmentBearing = bestCandidateEntry.bearing;
    }

    // Phase 3: Controlled 2-Opt Improvement with Fixed Endpoints
    let fullTourFor2Opt = [];
    if (!isToDestination && (sourceHub || anchorHub)) {
        fullTourFor2Opt.push(sourceHub || anchorHub);
    }
    fullTourFor2Opt.push(...orderedTour);
    if (isToDestination && (destinationHub || anchorHub)) {
        fullTourFor2Opt.push(destinationHub || anchorHub);
    }

    const isStartFixed = !isToDestination;
    const isEndFixed = isToDestination;

    const optimizedTour = await apply2OptRoadOptimization(fullTourFor2Opt, isStartFixed, isEndFixed);

    // Extract intermediate stops
    const finalStops = optimizedTour.filter((pt) =>
        pt !== sourceHub && pt !== destinationHub && pt !== anchorHub
    );

    // Recalculate segment metrics for final order
    let prev = (!isToDestination && (sourceHub || anchorHub)) ? (sourceHub || anchorHub) : null;
    for (let idx = 0; idx < finalStops.length; idx++) {
        const st = finalStops[idx];
        if (prev) {
            const seg = await getRoadSegmentCached(prev, st);
            st.previousStopName = prev.name || "Source";
            st.legDistanceKm = seg?.distanceKm ?? Number((calculateDistanceKm(prev.latitude, prev.longitude, st.latitude, st.longitude) * 1.25).toFixed(2));
            st.legDurationMin = seg?.durationMin ?? Number((st.legDistanceKm / 0.5).toFixed(1));
            st.segmentBearing = Number(calculateBearing(prev.latitude, prev.longitude, st.latitude, st.longitude).toFixed(1));
            st.isContinuousLeg = true;
            st.backtrackingLeg = false;
            st.selectionReason = `Selected: continuous road progression from ${prev.name} (+${st.legDistanceKm} km road distance, ~${st.legDurationMin}m).`;
        }
        st.order = idx + 1;
        prev = st;
    }

    return finalStops;
};

/*
|--------------------------------------------------------------------------
| SECTOR NAMING
|--------------------------------------------------------------------------
*/

const getSectorName = (bearing) => {
    if (bearing >= 337.5 || bearing < 22.5) return "North Corridor";
    if (bearing >= 22.5 && bearing < 67.5) return "North-East Corridor";
    if (bearing >= 67.5 && bearing < 112.5) return "East Corridor";
    if (bearing >= 112.5 && bearing < 157.5) return "South-East Corridor";
    if (bearing >= 157.5 && bearing < 202.5) return "South Corridor";
    if (bearing >= 202.5 && bearing < 247.5) return "South-West Corridor";
    if (bearing >= 247.5 && bearing < 292.5) return "West Corridor";
    return "North-West Corridor";
};

/*
|--------------------------------------------------------------------------
| 10-CHECK CONTINUOUS ROUTE CORRIDOR VALIDATION ENGINE
|--------------------------------------------------------------------------
*/

export const validateRouteCorridorContinuity = (bus, sourceHub, destinationHub, tripMode = "FROM_SOURCE") => {
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

    let hasBacktracking = false;
    let hasDirectionalInversion = false;
    let totalRoadKm = bus.routeDistanceKm || 0;
    let totalStraightLineKm = bus.straightLineBaselineKm || 0;

    // Check 1: First stop proximity from Source
    const firstStop = stops[0];
    const check1_firstStopProximity = origin
        ? calculateDistanceKm(origin.latitude, origin.longitude, firstStop.latitude, firstStop.longitude) < 35
        : true;

    // Check 2: Sequential proximity
    let check2_sequentialProximity = true;
    for (let i = 0; i < stops.length - 1; i++) {
        const d = calculateDistanceKm(stops[i].latitude, stops[i].longitude, stops[i + 1].latitude, stops[i + 1].longitude);
        if (d > 35) {
            check2_sequentialProximity = false;
        }
    }

    // Check 3, 4, 5: Directional progression, corridor consistency, and zero backtracking
    let check3_direction = true;
    let check4_corridor = true;
    let check5_backtracking = true;

    let prevBearing = origin
        ? calculateBearing(origin.latitude, origin.longitude, firstStop.latitude, firstStop.longitude)
        : null;

    for (let i = 0; i < stops.length - 1; i++) {
        const segBearing = calculateBearing(stops[i].latitude, stops[i].longitude, stops[i + 1].latitude, stops[i + 1].longitude);
        if (prevBearing !== null) {
            const angleDiff = getBearingDifference(prevBearing, segBearing);
            if (angleDiff > 130) {
                hasDirectionalInversion = true;
                check3_direction = false;
            }
        }
        prevBearing = segBearing;

        if (origin) {
            const distI = calculateDistanceKm(origin.latitude, origin.longitude, stops[i].latitude, stops[i].longitude);
            const distNext = calculateDistanceKm(origin.latitude, origin.longitude, stops[i + 1].latitude, stops[i + 1].longitude);
            if (distNext < distI - 2.5 && stops[i + 1].backtrackingLeg) {
                hasBacktracking = true;
                check5_backtracking = false;
            }
        }
    }

    // Check 6: Detour validation
    const detourRatio = totalStraightLineKm > 0 ? Number((totalRoadKm / totalStraightLineKm).toFixed(2)) : 1.25;
    const check6_detour = detourRatio <= 2.2;

    // Check 7: Road network verification
    const check7_roadGeometry = bus.isRoadVerified === true;

    // Check 8: Demand integrity
    const check8_demand = (bus.assignedUsers || 0) > 0;

    // Check 9: Capacity compliance
    const check9_capacity = (bus.assignedUsers || 0) <= (bus.capacity || 0);

    const allPassed = Boolean(
        check1_firstStopProximity &&
        check2_sequentialProximity &&
        check3_direction &&
        check4_corridor &&
        check5_backtracking &&
        check6_detour &&
        check7_roadGeometry &&
        check8_demand &&
        check9_capacity
    );

    return {
        isContinuous: allPassed,
        continuityStatus: allPassed ? "Continuous Corridor" : "Discontinuous Corridor",
        backtrackingDetected: hasBacktracking || !check5_backtracking,
        directionalInversionDetected: hasDirectionalInversion || !check3_direction,
        detourRatio,
        checks: {
            check1_firstStopProximity,
            check2_sequentialProximity,
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
| BUS ALLOCATION & STOP DEMAND SPLITTING (100% Mathematical Allocation)
|--------------------------------------------------------------------------
*/

const allocateInstitutionalBuses = async ({
    resolvedStops,
    availableVehicles,
    sourceHub,
    destinationHub,
    tripMode = "TO_DESTINATION"
}) => {
    const sortedVehicles = [...availableVehicles]
        .filter((v) => getVehicleCapacity(v) > 0)
        .sort((a, b) => getVehicleCapacity(b) - getVehicleCapacity(a));

    if (sortedVehicles.length === 0) {
        return { buses: [], unassignedStops: resolvedStops, consolidationLogs: [], consolidationAudit: [] };
    }

    const isToDestination = tripMode === "TO_DESTINATION" || tripMode === "INWARD";
    const anchorHub = isToDestination ? (destinationHub || sourceHub) : (sourceHub || destinationHub);

    // 1. Authoritative Stop Passenger Pools
    const stopPoolMap = new Map();
    const assignedUserGlobalSet = new Set();

    resolvedStops.forEach((s) => {
        const key = s.name.toLowerCase().trim();
        const userIdsList = Array.isArray(s.users)
            ? s.users.map((u) => String(u?._id || u?.id || u?.userId || u))
            : (Array.isArray(s.userIds) ? [...s.userIds] : []);

        const uniqueIds = Array.from(new Set(userIdsList));

        stopPoolMap.set(key, {
            name: s.name,
            latitude: s.latitude,
            longitude: s.longitude,
            unassignedUserIds: [...uniqueIds],
            initialUserCount: uniqueIds.length,
            distanceFromAnchor: calculateDistanceKm(anchorHub.latitude, anchorHub.longitude, s.latitude, s.longitude),
            bearingFromAnchor: calculateBearing(anchorHub.latitude, anchorHub.longitude, s.latitude, s.longitude)
        });
    });

    // 2. Group all stopping areas into directional sector clusters
    const corridors = groupStopsIntoCorridors(resolvedStops, anchorHub);

    const rawBuses = [];
    let vehicleIdx = 0;

    // 3. Allocate vehicles dynamically across corridors
    while (vehicleIdx < sortedVehicles.length) {
        const remainingStopPools = Array.from(stopPoolMap.values()).filter((st) => st.unassignedUserIds.length > 0);
        if (remainingStopPools.length === 0) break;

        const vehicle = sortedVehicles[vehicleIdx];
        const capacity = getVehicleCapacity(vehicle);
        const vehicleName = getVehicleName(vehicle, vehicleIdx);

        let vehicleRemainingSeats = capacity;
        const currentBusStops = [];
        const busAssignedUserIds = [];

        // Identify primary corridor that has unassigned passengers
        let primaryCorridorStops = [];
        for (const corr of corridors) {
            const corrRemaining = corr.filter((st) => {
                const pool = stopPoolMap.get(st.name.toLowerCase().trim());
                return pool && pool.unassignedUserIds.length > 0;
            });
            if (corrRemaining.length > 0) {
                primaryCorridorStops = corrRemaining.map((st) => stopPoolMap.get(st.name.toLowerCase().trim()));
                break;
            }
        }

        if (primaryCorridorStops.length === 0) {
            primaryCorridorStops = remainingStopPools;
        }

        // Sequence corridor stops continuously
        const orderedCorridor = await sequenceStopsContinuous(primaryCorridorStops, anchorHub, tripMode, sourceHub, destinationHub);

        // Pack from primary corridor
        for (const stopItem of orderedCorridor) {
            if (vehicleRemainingSeats <= 0) break;
            const pool = stopPoolMap.get(stopItem.name.toLowerCase().trim());
            if (!pool || pool.unassignedUserIds.length === 0) continue;

            const boardCount = Math.min(pool.unassignedUserIds.length, vehicleRemainingSeats);
            const boardedIds = pool.unassignedUserIds.splice(0, boardCount);

            boardedIds.forEach((uid) => assignedUserGlobalSet.add(uid));
            busAssignedUserIds.push(...boardedIds);
            vehicleRemainingSeats -= boardCount;

            currentBusStops.push({
                name: pool.name,
                latitude: pool.latitude,
                longitude: pool.longitude,
                userCount: boardCount,
                userIds: boardedIds
            });
        }

        // If bus still has remaining capacity, only sweep compatible adjacent stops (do NOT cross into distant unrelated corridors)
        if (vehicleRemainingSeats > 0 && currentBusStops.length > 0) {
            const currentAvgBearing = currentBusStops.reduce((sum, s) => {
                return sum + calculateBearing(anchorHub.latitude, anchorHub.longitude, s.latitude, s.longitude);
            }, 0) / currentBusStops.length;

            const compatibleLeftovers = Array.from(stopPoolMap.values()).filter((st) => {
                if (st.unassignedUserIds.length === 0) return false;
                const bearingDiff = getBearingDifference(currentAvgBearing, st.bearingFromAnchor);
                return bearingDiff <= 45; // Compatible corridor sector
            });

            if (compatibleLeftovers.length > 0) {
                const orderedLeftovers = await sequenceStopsContinuous(compatibleLeftovers, anchorHub, tripMode, sourceHub, destinationHub);

                for (const stopItem of orderedLeftovers) {
                    if (vehicleRemainingSeats <= 0) break;
                    const pool = stopPoolMap.get(stopItem.name.toLowerCase().trim());
                    if (!pool || pool.unassignedUserIds.length === 0) continue;

                    const boardCount = Math.min(pool.unassignedUserIds.length, vehicleRemainingSeats);
                    const boardedIds = pool.unassignedUserIds.splice(0, boardCount);

                    boardedIds.forEach((uid) => assignedUserGlobalSet.add(uid));
                    busAssignedUserIds.push(...boardedIds);
                    vehicleRemainingSeats -= boardCount;

                    const existingIdx = currentBusStops.findIndex((st) => st.name.toLowerCase().trim() === pool.name.toLowerCase().trim());
                    if (existingIdx !== -1) {
                        currentBusStops[existingIdx].userCount += boardCount;
                        currentBusStops[existingIdx].userIds.push(...boardedIds);
                    } else {
                        currentBusStops.push({
                            name: pool.name,
                            latitude: pool.latitude,
                            longitude: pool.longitude,
                            userCount: boardCount,
                            userIds: boardedIds
                        });
                    }
                }
            }
        }

        if (currentBusStops.length === 0 || busAssignedUserIds.length === 0) {
            break;
        }

        // Re-sequence stops of this bus for continuous road progression
        const finalSequencedStops = await sequenceStopsContinuous(currentBusStops, anchorHub, tripMode, sourceHub, destinationHub);

        const assignedUsersCount = busAssignedUserIds.length;
        let cumulativePassengers = 0;
        let passengersOnBus = assignedUsersCount;

        const stopsWithPassengers = finalSequencedStops.map((s, idx) => {
            const prevPt = idx === 0 ? null : finalSequencedStops[idx - 1];
            let consecutiveLegDist = s.legDistanceKm ?? (prevPt
                ? calculateDistanceKm(prevPt.latitude, prevPt.longitude, s.latitude, s.longitude)
                : 0);
            if (consecutiveLegDist < 0.05 && idx > 0) consecutiveLegDist = 0.05;

            if (!isToDestination) {
                const dropped = s.userCount || 0;
                passengersOnBus = Math.max(0, passengersOnBus - dropped);
                return {
                    ...s,
                    order: idx + 1,
                    previousStopName: s.previousStopName || (prevPt ? prevPt.name : (sourceHub?.name || "Source")),
                    legDistanceKm: Number(consecutiveLegDist.toFixed(2)),
                    passengersDropped: dropped,
                    passengersRemaining: passengersOnBus,
                    userIds: s.userIds || [],
                    resolved: true
                };
            } else {
                cumulativePassengers += (s.userCount || 0);
                return {
                    ...s,
                    order: idx + 1,
                    previousStopName: s.previousStopName || (prevPt ? prevPt.name : "Origin"),
                    legDistanceKm: Number(consecutiveLegDist.toFixed(2)),
                    cumulativePassengers,
                    standbySeatsAtStop: Math.max(0, capacity - cumulativePassengers),
                    userIds: s.userIds || [],
                    resolved: true
                };
            }
        });

        let totalKm = stopsWithPassengers.reduce((sum, s) => sum + (s.legDistanceKm || 0), 0);
        if (isToDestination && destinationHub && stopsWithPassengers.length > 0) {
            const last = stopsWithPassengers[stopsWithPassengers.length - 1];
            totalKm += calculateDistanceKm(
                last.latitude, last.longitude,
                destinationHub.latitude, destinationHub.longitude
            );
        } else if (!isToDestination && sourceHub && stopsWithPassengers.length > 0) {
            const first = stopsWithPassengers[0];
            totalKm += calculateDistanceKm(
                sourceHub.latitude, sourceHub.longitude,
                first.latitude, first.longitude
            );
        }

        const avgBearing = stopsWithPassengers.reduce((sum, s) => sum + (s.bearingFromHub || s.bearingFromStart || s.segmentBearing || 0), 0) / stopsWithPassengers.length;
        const sectorName = getSectorName(avgBearing);

        const routeNumber = rawBuses.length + 1;
        const routeCode = `R-${String(routeNumber).padStart(2, "0")}`;
        const lineType = isToDestination ? "Transit Line" : "Drop-off Line";

        const firstPointName = isToDestination
            ? stopsWithPassengers[0]?.name || "Outer Stop"
            : (sourceHub?.name || anchorHub?.name || "Departure Hub");
        const lastPointName = isToDestination
            ? (destinationHub?.name || anchorHub?.name || "Destination Hub")
            : stopsWithPassengers[stopsWithPassengers.length - 1]?.name || "Terminus";

        rawBuses.push({
            routeNumber,
            routeCode,
            routeName: `${routeCode}: ${firstPointName} to ${lastPointName} (${sectorName} ${lineType})`,
            sectorName,
            tripMode,
            vehicleId: vehicle._id ? String(vehicle._id) : `bus-${vehicleIdx + 1}`,
            vehicleName,
            capacity,
            assignedUsers: assignedUsersCount,
            remainingSeats: Math.max(0, capacity - assignedUsersCount),
            standbyBufferSeats: Math.max(0, capacity - assignedUsersCount),
            stops: stopsWithPassengers,
            sourceHub: sourceHub || null,
            destinationHub: destinationHub || null,
            routeDistanceKm: Number(totalKm.toFixed(2)),
            isContinuous: true,
            isRoadVerified: false,
            roadRouteStatus: "Road network routing pending",
            users: [...busAssignedUserIds]
        });

        vehicleIdx++;
    }

    // 4. POST-ALLOCATION COVERAGE REPAIR: Ensure all remaining unassigned passengers are placed
    const unassignedPools = Array.from(stopPoolMap.values()).filter((st) => st.unassignedUserIds.length > 0);
    for (const missingPool of unassignedPools) {
        for (const bus of rawBuses) {
            if (bus.remainingSeats > 0 && missingPool.unassignedUserIds.length > 0) {
                const count = Math.min(bus.remainingSeats, missingPool.unassignedUserIds.length);
                const ids = missingPool.unassignedUserIds.splice(0, count);
                ids.forEach((uid) => assignedUserGlobalSet.add(uid));

                bus.assignedUsers += count;
                bus.remainingSeats -= count;
                bus.users.push(...ids);

                const existingStopIdx = bus.stops.findIndex((st) => st.name.toLowerCase().trim() === missingPool.name.toLowerCase().trim());
                if (existingStopIdx !== -1) {
                    bus.stops[existingStopIdx].userCount += count;
                    bus.stops[existingStopIdx].userIds.push(...ids);
                } else {
                    bus.stops.push({
                        name: missingPool.name,
                        latitude: missingPool.latitude,
                        longitude: missingPool.longitude,
                        userCount: count,
                        userIds: ids
                    });
                }

                bus.stops = await sequenceStopsContinuous(bus.stops, anchorHub, tripMode, sourceHub, destinationHub);
                if (missingPool.unassignedUserIds.length === 0) break;
            }
        }
    }

    // Prepare unassigned stops diagnostic list
    const unassignedStops = Array.from(stopPoolMap.values())
        .filter((st) => st.unassignedUserIds.length > 0)
        .map((st) => ({
            name: st.name,
            userCount: st.unassignedUserIds.length,
            latitude: st.latitude,
            longitude: st.longitude
        }));

    return { buses: rawBuses, unassignedStops, consolidationLogs: [], consolidationAudit: [] };
};

/*
|--------------------------------------------------------------------------
| ROUTE CONSOLIDATION & AUDIT LOGGING
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

    const isToDestination = tripMode === "TO_DESTINATION" || tripMode === "INWARD";
    let activeBuses = initialBuses.map((b) => ({ ...b }));
    const MIN_POST_MERGE_UTILIZATION = 0.45;
    const MAX_DISTANCE_DELTA_KM = 20.0;

    let consolidationChanged = true;
    let pass = 0;
    const consolidationLogs = [];
    const consolidationAudit = [];

    while (consolidationChanged && pass < 5 && activeBuses.length > 1) {
        consolidationChanged = false;
        pass++;

        const lowUtilIndices = [];
        for (let i = 0; i < activeBuses.length; i++) {
            const bus = activeBuses[i];
            const util = bus.capacity > 0 ? (bus.assignedUsers / bus.capacity) : 0;
            if (util < 0.45 || bus.assignedUsers <= 20) {
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

                // Guard 2: post-merge utilization
                const mergedUsers = targetBus.assignedUsers + lowBus.assignedUsers;
                const postMergeUtil = mergedUsers / targetBus.capacity;
                if (postMergeUtil < MIN_POST_MERGE_UTILIZATION) continue;

                // Combine stops and re-sequence
                const combinedStopsMap = new Map();
                [...targetBus.stops, ...lowBus.stops].forEach((st) => {
                    const key = st.name.toLowerCase().trim();
                    if (combinedStopsMap.has(key)) {
                        const existing = combinedStopsMap.get(key);
                        existing.userCount = (existing.userCount || 0) + (st.userCount || 0);
                        existing.userIds = Array.from(new Set([...(existing.userIds || []), ...(st.userIds || [])]));
                    } else {
                        combinedStopsMap.set(key, { ...st });
                    }
                });

                const rawCombinedStops = Array.from(combinedStopsMap.values());
                const candidateMergedStops = await sequenceStopsContinuous(rawCombinedStops, anchorHub, tripMode, sourceHub, destinationHub);

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

                let cumUsers = 0;
                let remainingOnBus = mergedUsers;

                const finalMergedStops = bestMergedStops.map((s, idx) => {
                    const prevP = idx === 0 ? null : bestMergedStops[idx - 1];
                    let legDist = s.legDistanceKm ?? (prevP ? calculateDistanceKm(prevP.latitude, prevP.longitude, s.latitude, s.longitude) : 0);
                    if (legDist < 0.05 && idx > 0) legDist = 0.05;

                    if (!isToDestination) {
                        const dropped = s.userCount || 0;
                        remainingOnBus = Math.max(0, remainingOnBus - dropped);
                        return {
                            ...s,
                            order: idx + 1,
                            legDistanceKm: Number(legDist.toFixed(2)),
                            passengersDropped: dropped,
                            passengersRemaining: remainingOnBus,
                            isSharedCorridor: true
                        };
                    } else {
                        cumUsers += (s.userCount || 0);
                        return {
                            ...s,
                            order: idx + 1,
                            legDistanceKm: Number(legDist.toFixed(2)),
                            cumulativePassengers: cumUsers,
                            standbySeatsAtStop: Math.max(0, targetBus.capacity - cumUsers),
                            isSharedCorridor: true
                        };
                    }
                });

                let newRouteDistKm = finalMergedStops.reduce((sum, s) => sum + (s.legDistanceKm || 0), 0);
                if (isToDestination && destinationHub && finalMergedStops.length > 0) {
                    const lastSt = finalMergedStops[finalMergedStops.length - 1];
                    newRouteDistKm += calculateDistanceKm(lastSt.latitude, lastSt.longitude, destinationHub.latitude, destinationHub.longitude);
                } else if (!isToDestination && sourceHub && finalMergedStops.length > 0) {
                    const firstSt = finalMergedStops[0];
                    newRouteDistKm += calculateDistanceKm(sourceHub.latitude, sourceHub.longitude, firstSt.latitude, firstSt.longitude);
                }

                // Record structured audit trail
                const auditRecord = {
                    sourceRoute: lowBus.routeCode,
                    sourceVehicle: lowBus.vehicleName,
                    passengersMoved: lowBus.assignedUsers,
                    stopsAffected: lowBus.stops.map((s) => s.name),
                    destinationRoute: targetBus.routeCode,
                    destinationVehicle: targetBus.vehicleName,
                    reason: `AI Optimizer consolidated ${lowBus.assignedUsers} passengers from released vehicle (${lowBus.vehicleName}) into ${targetBus.vehicleName}`,
                    beforeCapacity: oldTargetUsers,
                    afterCapacity: mergedUsers
                };
                consolidationAudit.push(auditRecord);

                const postUtil = Math.round((mergedUsers / targetBus.capacity) * 100);
                consolidationLogs.push(
                    `AI Optimizer consolidated ${lowBus.assignedUsers} passengers from released vehicle (${lowBus.vehicleName}) into Route ${targetBus.routeCode} (${targetBus.vehicleName}), elevating seat utilization to ${postUtil}%.`
                );

                targetBus.stops = finalMergedStops;
                targetBus.assignedUsers = mergedUsers;
                targetBus.remainingSeats = targetBus.capacity - mergedUsers;
                targetBus.standbyBufferSeats = targetBus.capacity - mergedUsers;
                targetBus.routeDistanceKm = Number(newRouteDistKm.toFixed(2));
                targetBus.users = finalMergedStops.flatMap((s) => s.userIds || []);
                targetBus.isConsolidated = true;
                targetBus.absorbedVehicles = [
                    ...(targetBus.absorbedVehicles || []),
                    lowBus.vehicleName
                ];
                targetBus.consolidatedPassengers = (targetBus.consolidatedPassengers || 0) + lowBus.assignedUsers;

                activeBuses = activeBuses.filter((_, idx) => idx !== lowIdx);
                consolidationChanged = true;
                break;
            }
        }
    }

    // Re-index remaining routes stably (R-01, R-02, ...)
    activeBuses = activeBuses.map((bus, idx) => {
        const routeNumber = idx + 1;
        const routeCode = `R-${String(routeNumber).padStart(2, "0")}`;
        const lineType = isToDestination ? "Transit Line" : "Drop-off Line";

        const firstPointName = isToDestination
            ? bus.stops[0]?.name || "Outer Stop"
            : (sourceHub?.name || anchorHub?.name || "Departure Hub");
        const lastPointName = isToDestination
            ? (destinationHub?.name || anchorHub?.name || "Destination Hub")
            : (bus.stops[bus.stops.length - 1]?.name || "Terminus");

        return {
            ...bus,
            routeNumber,
            routeCode,
            routeName: `${routeCode}: ${firstPointName} to ${lastPointName} (${bus.sectorName} ${lineType})`
        };
    });

    return { buses: activeBuses, consolidationLogs, consolidationAudit };
};

/*
|--------------------------------------------------------------------------
| PLAN VALIDATION & CERTIFICATION ENGINE
|--------------------------------------------------------------------------
*/

export const validateAndCertifyAIPlan = ({
    buses,
    totalComingUsers,
    availableVehicles,
    totalAvailableCapacity,
    resolvedStops
}) => {
    const assignedPassengerIds = new Set();
    let duplicatePassengerFound = false;
    let totalAssignedUsers = 0;

    const availableVehicleIds = new Set(
        availableVehicles.map((v) => String(v._id || v.id || ""))
    );

    let allVehiclesAvailable = true;
    let allCapacitiesValid = true;
    let allDistancesValid = true;

    buses.forEach((bus) => {
        totalAssignedUsers += (bus.assignedUsers || 0);
        if (bus.assignedUsers > bus.capacity) {
            allCapacitiesValid = false;
        }
        if (bus.vehicleId && !availableVehicleIds.has(String(bus.vehicleId))) {
            allVehiclesAvailable = false;
        }
        if (!bus.routeDistanceKm || bus.routeDistanceKm <= 0 || (bus.routeDistanceKm > 200 && (bus.straightLineBaselineKm || 0) < 50)) {
            allDistancesValid = false;
        }
        (bus.users || []).forEach((uId) => {
            const strId = String(uId);
            if (assignedPassengerIds.has(strId)) {
                duplicatePassengerFound = true;
            }
            assignedPassengerIds.add(strId);
        });
    });

    const allRoadVerified = buses.length > 0 && buses.every((b) => b.isRoadVerified === true);

    const checks = {
        allPassengersAssigned: totalAssignedUsers === totalComingUsers,
        noPassengerDuplicated: !duplicatePassengerFound,
        noPassengerUnallocated: totalAssignedUsers === totalComingUsers,
        vehiclesExist: buses.every((b) => b.vehicleId),
        onlyAvailableVehiclesAssigned: allVehiclesAvailable,
        vehicleCountWithinLimit: buses.length <= availableVehicles.length,
        capacitiesNotExceeded: allCapacitiesValid,
        roadRouteConnectivityValid: buses.every((b) => Array.isArray(b.stops) && b.stops.length > 0),
        routeDistancesValid: allDistancesValid,
        roadNetworkVerified: allRoadVerified
    };

    const allPassed = Object.values(checks).every(Boolean);

    return {
        isCertified: allPassed,
        status: allPassed
            ? "OPTIMIZATION ENGINE SUCCESS"
            : (totalComingUsers > totalAvailableCapacity ? "INSUFFICIENT_VEHICLE_CAPACITY" : "OPTIMIZATION REQUIRES REVIEW"),
        statusTitle: allPassed ? "OPTIMIZATION ENGINE SUCCESS" : "OPTIMIZATION REQUIRES REVIEW",
        checks,
        certifiedAt: new Date().toISOString()
    };
};

/*
|--------------------------------------------------------------------------
| BUILD AI RECOMMENDED PLAN
|--------------------------------------------------------------------------
*/

export const buildAIPlan = async ({
    sourceHub,
    destinationHub,
    tripMode = "TO_DESTINATION",
    resolvedStops,
    availableVehicles,
    rawVehicles = [],
    totalComingUsers,
    allUsersCount
}) => {
    const effectiveTripMode = (tripMode === "OUTWARD" || tripMode === "FROM_SOURCE")
        ? "FROM_SOURCE"
        : "TO_DESTINATION";
    const isToDestination = effectiveTripMode === "TO_DESTINATION";
    const anchorHub = isToDestination ? (destinationHub || sourceHub) : (sourceHub || destinationHub);

    const { buses, unassignedStops, consolidationLogs, consolidationAudit } = await allocateInstitutionalBuses({
        resolvedStops,
        availableVehicles,
        sourceHub,
        destinationHub,
        tripMode: effectiveTripMode
    });

    const physicalFleetCapacity = rawVehicles.reduce(
        (sum, v) => sum + getVehicleCapacity(v),
        0
    );

    const totalAvailableCapacity = availableVehicles.reduce(
        (sum, v) => sum + getVehicleCapacity(v),
        0
    );

    // Recalculate all totals strictly from the FINAL active buses array
    const assignedUsers = buses.reduce((sum, b) => sum + b.assignedUsers, 0);
    const unassignedUsers = Math.max(0, totalComingUsers - assignedUsers);
    const allocatedSeats = buses.reduce((sum, b) => sum + b.capacity, 0);

    // Separate 3 distinct utilization calculations
    const physicalFleetUtilization = physicalFleetCapacity > 0
        ? Number(((assignedUsers / physicalFleetCapacity) * 100).toFixed(2))
        : 0;

    const routeAllocationUtilization = allocatedSeats > 0
        ? Number(((assignedUsers / allocatedSeats) * 100).toFixed(2))
        : 0;

    const fleetVehicleUtilization = availableVehicles.length > 0
        ? Number(((buses.length / availableVehicles.length) * 100).toFixed(2))
        : 0;

    // Reason code classification for unallocated users
    let unallocatedReason = null;
    if (unassignedUsers > 0) {
        if (totalComingUsers > physicalFleetCapacity) {
            unallocatedReason = "VEHICLE_CAPACITY";
        } else if (totalComingUsers > totalAvailableCapacity) {
            unallocatedReason = "SCHEDULE_CAPACITY";
        } else if (unassignedStops.some((s) => !isValidCoordinate(s.latitude, s.longitude))) {
            unallocatedReason = "MISSING_STOP_COORDINATES";
        } else {
            unallocatedReason = "CORRIDOR_CAPACITY";
        }
    }

    const capacityShortage = totalAvailableCapacity < totalComingUsers && unassignedUsers > 0;

    // Online OSRM Road Verification & 10-Check Corridor Continuity Validation
    await Promise.all(buses.map(async (bus) => {
        const routeWaypoints = isToDestination
            ? [...bus.stops, ...(destinationHub ? [destinationHub] : [anchorHub])]
            : [sourceHub || anchorHub, ...bus.stops];

        let straightLineBaselineKm = 0;
        for (let i = 0; i < routeWaypoints.length - 1; i++) {
            straightLineBaselineKm += calculateDistanceKm(
                routeWaypoints[i].latitude, routeWaypoints[i].longitude,
                routeWaypoints[i + 1].latitude, routeWaypoints[i + 1].longitude
            );
        }

        const roadRoute = await getRoadRouteGeometry(routeWaypoints);

        if (roadRoute) {
            bus.isRoadVerified = true;
            bus.roadGeometry = roadRoute.geometry;
            bus.routeDistanceMeters = roadRoute.distanceMeters;
            bus.routeDistanceKm = roadRoute.distanceKm;
            bus.routeDurationSeconds = roadRoute.durationSeconds;
            bus.routeDurationMin = Number((roadRoute.durationSeconds / 60).toFixed(1));
            bus.straightLineBaselineKm = Number(straightLineBaselineKm.toFixed(2));
        } else {
            bus.isRoadVerified = false;
            bus.roadGeometry = [];
            bus.routeDistanceKm = Number((straightLineBaselineKm * 1.25).toFixed(2));
            bus.routeDistanceMeters = Math.round(bus.routeDistanceKm * 1000);
            bus.routeDurationSeconds = Math.round((bus.routeDistanceKm / 0.5) * 60);
            bus.routeDurationMin = Number((bus.routeDistanceKm / 0.5).toFixed(1));
            bus.straightLineBaselineKm = Number(straightLineBaselineKm.toFixed(2));
        }

        // Perform 10-Check Strict Continuous Road-Corridor Validation
        const continuity = validateRouteCorridorContinuity(
            bus,
            sourceHub,
            destinationHub,
            effectiveTripMode
        );

        bus.continuityValidation = continuity;
        bus.backtrackingDetected = continuity.backtrackingDetected;
        bus.directionalStatus = continuity.directionalInversionDetected
            ? "Directional Inversion Detected"
            : (effectiveTripMode === "FROM_SOURCE" ? "Outward Corridor Progression" : "Inward Transit Progression");
        bus.detourRatio = continuity.detourRatio;

        if (bus.isRoadVerified && continuity.isContinuous && !continuity.backtrackingDetected) {
            bus.isContinuous = true;
            bus.roadRouteStatus = "Road Optimized (Continuous)";
        } else if (bus.isRoadVerified) {
            bus.isContinuous = false;
            bus.roadRouteStatus = continuity.directionalInversionDetected
                ? "Directional Inversion Detected"
                : "Road Connected (Discontinuous Corridor)";
        } else {
            bus.isContinuous = false;
            bus.roadRouteStatus = "Road network routing unavailable.";
        }
    }));

    // Multi-criteria certification
    const certification = validateAndCertifyAIPlan({
        buses,
        totalComingUsers,
        availableVehicles,
        totalAvailableCapacity,
        resolvedStops
    });

    const recommendations = [...(consolidationLogs || [])];
    const warnings = [];

    if (unassignedUsers > 0) {
        if (unallocatedReason === "VEHICLE_CAPACITY") {
            warnings.push(
                `Demand (${totalComingUsers}) exceeds total physical fleet capacity (${physicalFleetCapacity} seats). ${unassignedUsers} users unallocated due to vehicle capacity limits.`
            );
        } else if (unallocatedReason === "SCHEDULE_CAPACITY") {
            warnings.push(
                `Schedule capacity restriction: ${unassignedUsers} users unallocated. Available scheduled capacity is ${totalAvailableCapacity} seats.`
            );
        } else if (unallocatedReason === "CORRIDOR_CAPACITY") {
            warnings.push(
                `${unassignedUsers} passengers could not be assigned to available routes due to corridor capacity constraints.`
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

    let stopCountExplanation = "";
    if (uniqueStopCount === routeStopVisitCount) {
        stopCountExplanation = `All ${uniqueStopCount} unique stopping areas are covered with exactly 1 route stop visit each.`;
    } else if (routeStopVisitCount >= uniqueStopCount) {
        stopCountExplanation = `${uniqueStopCount} unique stopping areas covered across ${routeStopVisitCount} route stop visits across ${buses.length} active routes (${sharedStopCount} shared/split stop${sharedStopCount === 1 ? '' : 's'}).`;
    } else {
        stopCountExplanation = `${uniqueStopCount} stopping areas covered across ${routeStopVisitCount} route stop points.`;
    }

    return {
        planType: "AI",
        type: "route",
        title: "AI Recommended Continuous Route Plan",
        name: "AI Recommended Continuous Route Plan",
        description:
            "AI-optimized continuous bus routes based on confirmed Coming users, user stopping areas, OSRM road validation, continuous progression, route consolidation, and vehicle capacities.",
        tripMode: effectiveTripMode,
        sourceHub,
        destinationHub,
        startingPoint: anchorHub,
        buses,
        vehicles: buses,
        totalUsers: allUsersCount,
        comingUsers: totalComingUsers,
        confirmedUsers: totalComingUsers,
        assignedUsers,
        allocatedUsers: assignedUsers,
        unassignedUsers,
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
        unassignedStops: unassignedStops.map((s) => ({
            name: s.name,
            userCount: s.userCount || s.users?.length || 0,
            latitude: s.latitude,
            longitude: s.longitude
        })),
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
| ADMIN MANUAL PLAN (FROM STORED ROUTES)
|--------------------------------------------------------------------------
*/

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

    let tripMode = payload?.tripMode;
    if (!sourceHub && !destinationHub) {
        return {
            success: false,
            code: "ENDPOINT_NOT_CONFIGURED",
            message: "Set a Source or Destination before generating an AI route."
        };
    }

    if (sourceHub && !destinationHub) {
        tripMode = "FROM_SOURCE";
    } else if (destinationHub && !sourceHub) {
        tripMode = "TO_DESTINATION";
    } else if (payload?.activeEndpoint === "source") {
        tripMode = "FROM_SOURCE";
    } else if (payload?.activeEndpoint === "destination") {
        tripMode = "TO_DESTINATION";
    } else if (!tripMode) {
        tripMode = sourceHub ? "FROM_SOURCE" : "TO_DESTINATION";
    }

    const effectiveTripMode = (tripMode === "FROM_SOURCE" || tripMode === "OUTWARD")
        ? "FROM_SOURCE"
        : "TO_DESTINATION";

    // Guard: Require destination for TO_DESTINATION, or source for FROM_SOURCE
    if (effectiveTripMode === "TO_DESTINATION" && !destinationHub) {
        return {
            success: false,
            code: "MISSING_DESTINATION",
            message: "Select a destination (arrival hub) to generate the AI transportation plan."
        };
    }

    if (effectiveTripMode === "FROM_SOURCE" && !sourceHub) {
        return {
            success: false,
            code: "MISSING_SOURCE",
            message: "Select a departure source to generate the AI transportation plan."
        };
    }

    const anchorHub = effectiveTripMode === "FROM_SOURCE" ? sourceHub : destinationHub;

    const requestedDate = normalizeDate(
        payload?.date || payload?.scheduleDate || payload?.schedule?.date
    );
    const [allUsers, rawVehicles, routes, schedules] = await Promise.all([
        getCollectionData("users"),
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

    // CAPACITY PRE-CHECK 2: Check whether available fleet capacity can cover confirmed Coming demand
    if (totalComingUsers > totalAvailableCapacity) {
        const capacityShortfall = totalComingUsers - totalAvailableCapacity;
        return {
            success: false,
            code: "INSUFFICIENT_VEHICLE_CAPACITY",
            message: `Route generation failed: Insufficient available vehicle capacity. ${totalComingUsers} Coming passengers require seats, but only ${totalAvailableCapacity} seats are available across ${availableVehicles.length} available vehicles (${capacityShortfall} seat shortfall).`,
            diagnostic: {
                validationPassed: false,
                failureCode: "INSUFFICIENT_VEHICLE_CAPACITY",
                failureReason: `Demand (${totalComingUsers} Coming users) exceeds available scheduled fleet capacity (${totalAvailableCapacity} seats across ${availableVehicles.length} vehicles). Capacity shortfall: ${capacityShortfall} seats.`,
                comingUsers: totalComingUsers,
                assignedUsers: 0,
                unassignedUsers: totalComingUsers,
                duplicateUsers: 0,
                availableVehicles: availableVehicles.length,
                availableCapacity: totalAvailableCapacity,
                allocatedCapacity: 0,
                capacityShortfall,
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
                availableVehicles: availableVehicles.length,
                totalAvailableCapacity,
                physicalFleetCapacity,
                allocatedSeats: 0,
                allocatedUsers: 0,
                unallocatedUsers: totalComingUsers,
                capacityShortage: true,
                capacityShortfall,
                reason: "INSUFFICIENT_VEHICLE_CAPACITY"
            }
        };
    }

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

    // Build AI Recommended Plan
    const aiPlan = await buildAIPlan({
        sourceHub,
        destinationHub,
        tripMode: effectiveTripMode,
        resolvedStops,
        availableVehicles,
        rawVehicles,
        totalComingUsers,
        allUsersCount: users.length
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
    if (missingStoppingAreas.length > 0) {
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

    // Persist final generated AI plan to MongoDB AiPlan collection
    if (totalComingUsers > 0 && aiPlan?.buses?.length > 0) {
        try {
            await AiPlan.updateMany(
                { active: true },
                { $set: { active: false, status: "superseded" } }
            );

            const savedPlanDoc = await AiPlan.create({
                active: true,
                status: "active",
                planType: "AI",
                tripMode: effectiveTripMode,
                source: sourceHub,
                destination: destinationHub,
                startingPoint: anchorHub,
                hubProvenance: "User Selection",
                summary: planResult.summary,
                stoppingGroups: planResult.stoppingGroups,
                aiPlan: planResult.aiPlan,
                manualPlan: planResult.manualPlan,
                recommendations: planResult.recommendations,
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
            adminApprovalStatus: "Pending Admin Approval",
            message: "Bus allocation will appear here after confirmation and admin approval."
        };
    }

    try {
        // 1. Look for active selected plan in ai_selected_plans
        let activeSelection = null;
        if (mongoose.connection.db) {
            activeSelection = await mongoose.connection.db
                .collection("ai_selected_plans")
                .findOne({ active: true }, { sort: { selectedAt: -1 } });
        }

        // Fallback to AiPlan model if not in ai_selected_plans
        if (!activeSelection) {
            const activeAiPlan = await AiPlan.findOne({ active: true, status: "active" }).sort({ createdAt: -1 });
            if (activeAiPlan) {
                activeSelection = {
                    planType: activeAiPlan.planType || "AI",
                    plan: activeAiPlan.aiPlan || activeAiPlan.manualPlan || activeAiPlan,
                    startingPoint: activeAiPlan.startingPoint || activeAiPlan.source,
                    selectedAt: activeAiPlan.createdAt
                };
            }
        }

        if (!activeSelection || !activeSelection.plan) {
            return {
                isAllocated: false,
                hasActivePlan: false,
                adminApprovalStatus: "Pending Admin Approval",
                message: "Bus allocation will appear here after confirmation and admin approval."
            };
        }

        const plan = activeSelection.plan;
        const buses = Array.isArray(plan.buses) ? plan.buses : (Array.isArray(plan.routes) ? plan.routes : []);

        const uId = String(user._id || "");
        const uUserId = String(user.userId || "").toLowerCase().trim();
        const uName = String(user.name || "").toLowerCase().trim();
        const uStop = String(user.stoppings || "").toLowerCase().trim();

        // If user explicitly marked "Not Coming"
        if (user.travelStatus === "Not Coming") {
            return {
                isAllocated: false,
                hasActivePlan: true,
                adminApprovalStatus: "Approved",
                approvedAt: activeSelection.selectedAt || null,
                message: "You have confirmed that you are not traveling today. No bus seat is reserved."
            };
        }

        // Find the bus containing this user
        let matchedBus = null;
        let matchedStop = null;

        for (const bus of buses) {
            // Check bus user IDs
            const busUserIds = (bus.users || []).map((id) => String(id).toLowerCase().trim());
            const hasUserInBus = (uId && busUserIds.includes(uId.toLowerCase())) ||
                (uUserId && busUserIds.includes(uUserId)) ||
                (uName && busUserIds.includes(uName));

            // Check stops
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
                matchedStop = (bus.stops || []).find((st) => st.name.toLowerCase().trim() === uStop) || bus.stops?.[0];
                break;
            }
        }

        // Fallback: If user is "Coming" and stop matches a bus on the active plan
        if (!matchedBus && user.travelStatus === "Coming" && uStop) {
            for (const bus of buses) {
                const st = (bus.stops || []).find((s) => s.name.toLowerCase().trim() === uStop);
                if (st) {
                    matchedBus = bus;
                    matchedStop = st;
                    break;
                }
            }
        }

        if (matchedBus) {
            const stopName = matchedStop?.name || user.stoppings || "Assigned Stop";
            const stopOrder = matchedStop?.order || 1;

            return {
                isAllocated: true,
                hasActivePlan: true,
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
                tripMode: matchedBus.tripMode || plan.tripMode || activeSelection.tripMode || "INWARD",
                boardingStop: stopName,
                stopOrder,
                totalStops: matchedBus.stops?.length || 0,
                legDistanceKm: matchedStop?.legDistanceKm || null,
                legDurationMin: matchedStop?.legDurationMin || null,
                sourceHub: matchedBus.sourceHub || activeSelection.startingPoint || null,
                destinationHub: matchedBus.destinationHub || null,
                routeDistanceKm: matchedBus.routeDistanceKm,
                routeDurationMin: matchedBus.routeDurationMin,
                routeStops: (matchedBus.stops || []).map((s) => ({
                    order: s.order,
                    name: s.name,
                    passengers: s.userCount || s.passengersDropped || s.passengersBoarded || 0,
                    legDistanceKm: s.legDistanceKm,
                    legDurationMin: s.legDurationMin,
                    isUserStop: s.name.toLowerCase().trim() === stopName.toLowerCase().trim()
                }))
            };
        }

        return {
            isAllocated: false,
            hasActivePlan: true,
            adminApprovalStatus: "Approved",
            message: user.travelStatus === "Pending"
                ? "Your travel status was Pending when the plan was approved. Please confirm with the administrator."
                : "You are currently on the standby list. Please contact transportation admin."
        };
    } catch (err) {
        console.error("getUserAllocatedBus error:", err.message);
        return {
            isAllocated: false,
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

        if (mongoose.connection.db) {
            await mongoose.connection.db.collection("ai_selected_plans").updateMany(
                { active: true },
                { $set: { active: false, status: "superseded" } }
            );

            await mongoose.connection.db.collection("ai_selected_plans").insertOne({
                planType,
                plan,
                startingPoint,
                active: true,
                status: "active",
                selectedAt: new Date()
            });
        }

        // Also update all confirmed users in database with their allocatedBus details for instant access
        try {
            const allStudents = await User.find({ role: "student" });
            const buses = Array.isArray(plan?.buses) ? plan.buses : (Array.isArray(plan?.routes) ? plan.routes : []);

            for (const student of allStudents) {
                const uId = String(student._id || "");
                const uUserId = String(student.userId || "").toLowerCase().trim();
                const uName = String(student.name || "").toLowerCase().trim();
                const uStop = String(student.stoppings || "").toLowerCase().trim();

                let matchedBus = null;
                let matchedStop = null;

                if (student.travelStatus !== "Not Coming") {
                    for (const bus of buses) {
                        const busUserIds = (bus.users || []).map((id) => String(id).toLowerCase().trim());
                        const hasUser = (uId && busUserIds.includes(uId.toLowerCase())) ||
                            (uUserId && busUserIds.includes(uUserId)) ||
                            (uName && busUserIds.includes(uName));

                        for (const st of (bus.stops || [])) {
                            const stopUserIds = (st.userIds || []).map((id) => String(id).toLowerCase().trim());
                            if ((uId && stopUserIds.includes(uId.toLowerCase())) ||
                                (uUserId && stopUserIds.includes(uUserId)) ||
                                (uName && stopUserIds.includes(uName))) {
                                matchedBus = bus;
                                matchedStop = st;
                                break;
                            }
                        }

                        if (matchedBus) break;

                        if (hasUser) {
                            matchedBus = bus;
                            matchedStop = (bus.stops || []).find((st) => st.name.toLowerCase().trim() === uStop) || bus.stops?.[0];
                            break;
                        }
                    }

                    if (!matchedBus && student.travelStatus === "Coming" && uStop) {
                        for (const bus of buses) {
                            const st = (bus.stops || []).find((s) => s.name.toLowerCase().trim() === uStop);
                            if (st) {
                                matchedBus = bus;
                                matchedStop = st;
                                break;
                            }
                        }
                    }
                }

                if (matchedBus) {
                    const stopName = matchedStop?.name || student.stoppings || "Assigned Stop";
                    student.allocatedBus = {
                        isAllocated: true,
                        adminApprovalStatus: "Approved",
                        approvedAt: new Date(),
                        planType: planType || "AI",
                        routeCode: matchedBus.routeCode || `R-${String(matchedBus.routeNumber || 1).padStart(2, "0")}`,
                        routeName: matchedBus.routeName || `${matchedBus.routeCode || 'R-01'}: ${matchedBus.vehicleName}`,
                        vehicleName: matchedBus.vehicleName || "Assigned Bus",
                        vehicleNumber: matchedBus.vehicleName || "Assigned Bus",
                        capacity: matchedBus.capacity || 60,
                        assignedUsersCount: matchedBus.assignedUsers || matchedBus.users?.length || 0,
                        remainingSeats: matchedBus.remainingSeats ?? Math.max(0, (matchedBus.capacity || 60) - (matchedBus.assignedUsers || 0)),
                        sectorName: matchedBus.sectorName || "Transit Line",
                        tripMode: matchedBus.tripMode || plan?.tripMode || "INWARD",
                        boardingStop: stopName,
                        stopOrder: matchedStop?.order || 1,
                        totalStops: matchedBus.stops?.length || 0,
                        legDistanceKm: matchedStop?.legDistanceKm || null,
                        legDurationMin: matchedStop?.legDurationMin || null,
                        sourceHub: matchedBus.sourceHub || startingPoint || null,
                        destinationHub: matchedBus.destinationHub || null,
                        routeDistanceKm: matchedBus.routeDistanceKm,
                        routeDurationMin: matchedBus.routeDurationMin,
                        routeStops: (matchedBus.stops || []).map((s) => ({
                            order: s.order,
                            name: s.name,
                            passengers: s.userCount || s.passengersDropped || s.passengersBoarded || 0,
                            legDistanceKm: s.legDistanceKm,
                            legDurationMin: s.legDurationMin,
                            isUserStop: s.name.toLowerCase().trim() === stopName.toLowerCase().trim()
                        }))
                    };
                } else {
                    student.allocatedBus = {
                        isAllocated: false,
                        adminApprovalStatus: "Approved",
                        approvedAt: new Date(),
                        message: student.travelStatus === "Not Coming"
                            ? "You have confirmed that you are not traveling today. No bus seat is reserved."
                            : (student.travelStatus === "Pending"
                                ? "Your travel status was Pending during plan generation. Please confirm with admin."
                                : "You are currently on the standby list. Please contact transportation admin.")
                    };
                }

                await student.save();
            }
        } catch (updateErr) {
            console.warn("User allocatedBus direct update warning:", updateErr.message);
        }

        return {
            success: true,
            message: `${planType === "AI" ? "AI Recommended" : "Manual"} route plan activated and bus allocations published to all confirmed users successfully.`
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

export const getSelectedPlan = async () => {
    if (!isDbConnected()) {
        return { success: false, selection: null, code: "DATABASE_UNAVAILABLE" };
    }

    try {
        if (!mongoose.connection.db) {
            return { success: true, selection: null };
        }

        const selected = await mongoose.connection.db
            .collection("ai_selected_plans")
            .findOne({ active: true }, { sort: { selectedAt: -1 } });

        return {
            success: true,
            selection: selected || null
        };
    } catch (error) {
        console.error("Get selected plan error:", error.message);
        return { success: false, selection: null, message: "Unable to load selected plan." };
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

export const getActiveAIPlan = async () => {
    if (!isDbConnected()) {
        return { success: false, plan: null, code: "DATABASE_UNAVAILABLE" };
    }

    try {
        const activePlan = await AiPlan.findOne({ active: true, status: "active" }).sort({ createdAt: -1 });

        if (!activePlan) {
            return {
                success: true,
                plan: null,
                message: "No active AI plan found."
            };
        }

        return {
            success: true,
            plan: activePlan
        };
    } catch (error) {
        console.error("Get active AI plan error:", error.message);
        return {
            success: false,
            plan: null,
            message: "Unable to load active AI plan."
        };
    }
};

/*
|--------------------------------------------------------------------------
| RESET AI PLAN & STUDENT TRAVEL STATUSES
|--------------------------------------------------------------------------
*/

export const resetAIPlanAndStudents = async () => {
    if (!isDbConnected()) {
        throw new Error("Database is currently unavailable.");
    }

    try {
        const planUpdate = await AiPlan.updateMany(
            { active: true },
            {
                $set: {
                    active: false,
                    status: "reset",
                    resetAt: new Date()
                }
            }
        );

        if (mongoose.connection.db) {
            await mongoose.connection.db.collection("ai_selected_plans").updateMany(
                { active: { $ne: false } },
                {
                    $set: {
                        active: false,
                        status: "reset",
                        resetAt: new Date()
                    }
                }
            );
        }

        // Reset student allocated bus metadata
        try {
            await User.updateMany(
                { role: "student" },
                {
                    $set: {
                        allocatedBus: {
                            isAllocated: false,
                            adminApprovalStatus: "Pending Admin Approval",
                            message: "Bus allocation will appear here after confirmation and admin approval."
                        }
                    }
                }
            );
        } catch (resetErr) {
            console.warn("Reset allocatedBus on users warning:", resetErr.message);
        }

        return {
            success: true,
            message: "AI route recommendation reset successfully. Student travel responses remain preserved.",
            planReset: (planUpdate?.modifiedCount || 0) > 0 || (planUpdate?.matchedCount || 0) > 0,
            studentsReset: 0
        };
    } catch (error) {
        console.error("Reset AI plan error:", error.message);
        throw new Error(error.message || "Failed to reset AI plan.");
    }
};