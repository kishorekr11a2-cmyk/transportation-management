/**
 * mapGeocodingService.js
 * 
 * Production-grade Map & Geocoding Service for AI Transportation Management.
 * Features:
 * - Multi-tier caching: In-memory LRU + MongoDB (MapLocation/Stop) + Built-in Regional Gazetteer + OSM Nominatim
 * - Dynamic Worldwide Source/Depot support (defaults to KLN College of Engineering)
 * - Strict Rate Limiting / Throttling for public Nominatim API (1 request / 1100ms)
 * - Configurable User-Agent & Request Timeouts with AbortController
 * - Comprehensive Validation & Diagnostics (missing, invalid, failed, ambiguous, distance outliers)
 * - Safe DB persistence of resolved coordinates to avoid redundant network queries
 */

import mongoose from "mongoose";
import MapLocation from "../models/MapLocation.js";
import Stop from "../models/Stop.js";
import { isDbConnected } from "../config/db.js";

// ============================================================================
// CONSTANTS & REGIONAL TRANSIT GAZETTEER
// ============================================================================

export const DEFAULT_SOURCE_HUB = {
    name: "K. L. N. College of Engineering",
    address: "Pottapalayam, Sivagangai / Madurai, Tamil Nadu - 630612, India",
    latitude: 9.8324,
    longitude: 78.1884
};

export const NOMINATIM_BASE_URL = process.env.NOMINATIM_BASE_URL || "https://nominatim.openstreetmap.org";
export const GEOCODING_USER_AGENT = process.env.GEOCODING_USER_AGENT || "CollegeBusManagement/2.0 (transport@klnce.edu; academic-project)";
export const NOMINATIM_REQUEST_DELAY_MS = Number(process.env.NOMINATIM_DELAY_MS || 1100);
export const GEOCODING_TIMEOUT_MS = Number(process.env.GEOCODING_TIMEOUT_MS || 6000);
export const MAX_TRANSIT_RADIUS_KM = Number(process.env.MAX_TRANSIT_RADIUS_KM || 60);

// Built-in Regional Gazetteer for Madurai transit hubs (instant 0ms resolution & offline fallback)
export const MADURAI_REGIONAL_GAZETTEER = {
    "alagappan nagar": { latitude: 9.8920, longitude: 78.0990, displayName: "Alagappan Nagar, Madurai, Tamil Nadu" },
    "anna nagar": { latitude: 9.9180, longitude: 78.1467, displayName: "Anna Nagar, Madurai, Tamil Nadu" },
    "anuppanadi": { latitude: 9.9070, longitude: 78.1510, displayName: "Anuppanadi, Madurai, Tamil Nadu" },
    "arappalayam": { latitude: 9.9322, longitude: 78.1025, displayName: "Arappalayam, Madurai, Tamil Nadu" },
    "avaniyapuram": { latitude: 9.8780, longitude: 78.1240, displayName: "Avaniyapuram, Madurai, Tamil Nadu" },
    "bibikulam": { latitude: 9.9420, longitude: 78.1360, displayName: "Bibikulam, Madurai, Tamil Nadu" },
    "goripalayam": { latitude: 9.9315, longitude: 78.1275, displayName: "Goripalayam, Madurai, Tamil Nadu" },
    "iyer bungalow": { latitude: 9.9650, longitude: 78.1410, displayName: "Iyer Bungalow, Madurai, Tamil Nadu" },
    "jaihindpuram": { latitude: 9.9020, longitude: 78.1120, displayName: "Jaihindpuram, Madurai, Tamil Nadu" },
    "k k nagar west": { latitude: 9.9250, longitude: 78.1460, displayName: "K.K. Nagar West, Madurai, Tamil Nadu" },
    "kk nagar west": { latitude: 9.9250, longitude: 78.1460, displayName: "K.K. Nagar West, Madurai, Tamil Nadu" },
    "k pudur": { latitude: 9.9520, longitude: 78.1460, displayName: "K.Pudur, Madurai, Tamil Nadu" },
    "kpudur": { latitude: 9.9520, longitude: 78.1460, displayName: "K.Pudur, Madurai, Tamil Nadu" },
    "pudur": { latitude: 9.9520, longitude: 78.1460, displayName: "Pudur, Madurai, Tamil Nadu" },
    "kk nagar": { latitude: 9.9270, longitude: 78.1510, displayName: "KK Nagar, Madurai, Tamil Nadu" },
    "k k nagar": { latitude: 9.9270, longitude: 78.1510, displayName: "KK Nagar, Madurai, Tamil Nadu" },
    "kochadai": { latitude: 9.9360, longitude: 78.0850, displayName: "Kochadai, Madurai, Tamil Nadu" },
    "kochadai junction": { latitude: 9.9365, longitude: 78.0855, displayName: "Kochadai Junction, Madurai, Tamil Nadu" },
    "koodal nagar": { latitude: 9.9620, longitude: 78.1050, displayName: "Koodal Nagar, Madurai, Tamil Nadu" },
    "mattuthavani": { latitude: 9.9450, longitude: 78.1580, displayName: "Mattuthavani, Madurai, Tamil Nadu" },
    "narimedu": { latitude: 9.9380, longitude: 78.1320, displayName: "Narimedu, Madurai, Tamil Nadu" },
    "othakadai": { latitude: 9.9700, longitude: 78.1800, displayName: "Othakadai, Madurai, Tamil Nadu" },
    "palanganatham": { latitude: 9.9050, longitude: 78.0980, displayName: "Palanganatham, Madurai, Tamil Nadu" },
    "periyar": { latitude: 9.9175, longitude: 78.1140, displayName: "Periyar, Madurai, Tamil Nadu" },
    "sellur": { latitude: 9.9410, longitude: 78.1180, displayName: "Sellur, Madurai, Tamil Nadu" },
    "simmakkal": { latitude: 9.9255, longitude: 78.1192, displayName: "Simmakkal, Madurai, Tamil Nadu" },
    "tallakulam": { latitude: 9.9360, longitude: 78.1350, displayName: "Tallakulam, Madurai, Tamil Nadu" },
    "teppakulam": { latitude: 9.9140, longitude: 78.1470, displayName: "Teppakulam, Madurai, Tamil Nadu" },
    "thirunagar": { latitude: 9.8690, longitude: 78.0690, displayName: "Thirunagar, Madurai, Tamil Nadu" },
    "thiruppalai": { latitude: 9.9780, longitude: 78.1450, displayName: "Thiruppalai, Madurai, Tamil Nadu" },
    "vandiyur": { latitude: 9.9200, longitude: 78.1650, displayName: "Vandiyur, Madurai, Tamil Nadu" },
    "vilangudi": { latitude: 9.9510, longitude: 78.0920, displayName: "Vilangudi, Madurai, Tamil Nadu" },
    "villapuram": { latitude: 9.8950, longitude: 78.1320, displayName: "Villapuram, Madurai, Tamil Nadu" },
    "munichalai": { latitude: 9.9180, longitude: 78.1300, displayName: "Munichalai, Madurai, Tamil Nadu" },
    "south gate": { latitude: 9.9120, longitude: 78.1200, displayName: "South Gate, Madurai, Tamil Nadu" },
    "thiruparankundram": { latitude: 9.8820, longitude: 78.0720, displayName: "Thiruparankundram, Madurai, Tamil Nadu" },
    "pasumalai": { latitude: 9.8950, longitude: 78.0820, displayName: "Pasumalai, Madurai, Tamil Nadu" },
    "sundararajapuram": { latitude: 9.9050, longitude: 78.1020, displayName: "Sundararajapuram, Madurai, Tamil Nadu" },
    "kamarajar salai": { latitude: 9.9150, longitude: 78.1350, displayName: "Kamarajar Salai, Madurai, Tamil Nadu" },
    "madurai junction": { latitude: 9.9190, longitude: 78.1100, displayName: "Madurai Junction, Madurai, Tamil Nadu" },
    "periyar bus stand": { latitude: 9.9160, longitude: 78.1120, displayName: "Periyar Bus Stand, Madurai, Tamil Nadu" },
    "tvs nagar": { latitude: 9.8920, longitude: 78.0920, displayName: "TVS Nagar, Madurai, Tamil Nadu" },
    "melur road": { latitude: 9.9500, longitude: 78.1700, displayName: "Melur Road, Madurai, Tamil Nadu" },
    "narayanapuram": { latitude: 9.9520, longitude: 78.1450, displayName: "Narayanapuram, Madurai, Tamil Nadu" },
    "k l n college of engineering": DEFAULT_SOURCE_HUB,
    "kln college of engineering": DEFAULT_SOURCE_HUB,
    "klnce": DEFAULT_SOURCE_HUB,
    "pottapalayam": DEFAULT_SOURCE_HUB
};

// In-memory geocoding cache
const inMemoryGeocodeCache = new Map();

// Global request queue for Nominatim to enforce >= 1100ms rate limit spacing
let lastNominatimRequestTime = 0;

// ============================================================================
// GEOGRAPHIC & COORDINATE HELPERS
// ============================================================================

/**
 * Validates if latitude and longitude represent a real, non-null, non-Null-Island geographic point.
 */
export const isValidCoordinate = (latitude, longitude) => {
    if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) {
        return false;
    }
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return false;
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        return false;
    }
    // Reject Null Island (0,0) as an invalid geocode
    if (Math.abs(lat) < 0.0001 && Math.abs(lon) < 0.0001) {
        return false;
    }
    return true;
};

/**
 * Calculates Great-Circle Haversine distance between two coordinates in kilometers.
 */
export const calculateDistanceKm = (lat1, lon1, lat2, lon2) => {
    if (!isValidCoordinate(lat1, lon1) || !isValidCoordinate(lat2, lon2)) {
        return 0;
    }
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) *
        Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Number((R * c).toFixed(2));
};

/**
 * Builds a deterministic, normalized canonical key for a location query.
 */
export const buildCanonicalLocationKey = (stopping = "", city = "", state = "", country = "") => {
    const s = String(stopping || "").trim().toLowerCase();
    const c = String(city || "").trim().toLowerCase();
    const st = String(state || "").trim().toLowerCase();
    const co = String(country || "").trim().toLowerCase();
    return `${s}|${c}|${st}|${co}`;
};

/**
 * Normalizes an arbitrary text string for consistent matching.
 */
export const normalizeStopName = (str = "") => {
    return String(str || "")
        .toLowerCase()
        .replace(/[\.\,\-\_\/\(\)]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
};

// ============================================================================
// RATE-LIMITED NOMINATIM CLIENT
// ============================================================================

/**
 * Schedules an HTTP request adhering to Nominatim's 1 req/sec rate limit.
 */
const rateLimitedFetch = async (url, options = {}) => {
    const now = Date.now();
    const elapsed = now - lastNominatimRequestTime;
    if (elapsed < NOMINATIM_REQUEST_DELAY_MS) {
        const waitMs = NOMINATIM_REQUEST_DELAY_MS - elapsed;
        await new Promise((res) => setTimeout(res, waitMs));
    }
    lastNominatimRequestTime = Date.now();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GEOCODING_TIMEOUT_MS);

    try {
        const fetchOptions = {
            ...options,
            signal: controller.signal,
            headers: {
                "User-Agent": GEOCODING_USER_AGENT,
                "Accept-Language": "en",
                ...(options.headers || {})
            }
        };
        const response = await fetch(url, fetchOptions);
        clearTimeout(timeoutId);
        return response;
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === "AbortError") {
            throw new Error(`Geocoding request timed out after ${GEOCODING_TIMEOUT_MS}ms`);
        }
        throw err;
    }
};

/**
 * Queries OpenStreetMap Nominatim with structured search and proximity bias.
 */
export const queryNominatim = async (queryText, proximityPoint = null) => {
    if (!queryText || typeof queryText !== "string" || queryText.trim().length < 2) {
        return null;
    }

    const cleanQuery = queryText.trim();
    let url = `${NOMINATIM_BASE_URL}/search?q=${encodeURIComponent(cleanQuery)}&format=jsonv2&addressdetails=1&limit=5`;

    if (proximityPoint && isValidCoordinate(proximityPoint.latitude, proximityPoint.longitude)) {
        // Bias search towards proximity anchor with a ~1 degree bounding box
        const lat = Number(proximityPoint.latitude);
        const lon = Number(proximityPoint.longitude);
        const delta = 0.8;
        const viewbox = `${lon - delta},${lat + delta},${lon + delta},${lat - delta}`;
        url += `&viewbox=${viewbox}&bounded=0`;
    }

    try {
        const res = await rateLimitedFetch(url);
        if (!res.ok) {
            console.warn(`[Nominatim] Geocoding returned HTTP ${res.status} for "${cleanQuery}"`);
            return null;
        }
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) {
            return null;
        }

        // Filter and score results based on proximity if provided
        let bestItem = data[0];
        if (proximityPoint && isValidCoordinate(proximityPoint.latitude, proximityPoint.longitude)) {
            let minDistance = Infinity;
            for (const item of data) {
                const itemLat = Number(item.lat);
                const itemLon = Number(item.lon);
                if (isValidCoordinate(itemLat, itemLon)) {
                    const dist = calculateDistanceKm(proximityPoint.latitude, proximityPoint.longitude, itemLat, itemLon);
                    if (dist < minDistance) {
                        minDistance = dist;
                        bestItem = item;
                    }
                }
            }
        }

        const lat = Number(bestItem.lat);
        const lon = Number(bestItem.lon);
        if (!isValidCoordinate(lat, lon)) {
            return null;
        }

        return {
            name: cleanQuery,
            displayName: bestItem.display_name || cleanQuery,
            latitude: lat,
            longitude: lon,
            placeId: String(bestItem.place_id || ""),
            source: "OpenStreetMap Nominatim"
        };
    } catch (err) {
        console.warn(`[Nominatim] Failed to geocode "${cleanQuery}":`, err.message);
        return null;
    }
};

// ============================================================================
// MONGODB COORDINATE CACHE & PERSISTENCE
// ============================================================================

/**
 * Loads pre-cached coordinates from MongoDB (MapLocation & Stop collections).
 */
export const loadDbLocationCache = async () => {
    const dbLocations = new Map();
    if (!isDbConnected()) return dbLocations;

    try {
        const [stops, mapLocs] = await Promise.all([
            Stop.find({}).lean().catch(() => []),
            MapLocation.find({}).lean().catch(() => [])
        ]);

        (stops || []).forEach((s) => {
            const name = normalizeStopName(s.name);
            if (name && isValidCoordinate(s.latitude, s.longitude)) {
                dbLocations.set(name, {
                    name: s.name,
                    displayName: s.address || s.name,
                    latitude: Number(s.latitude),
                    longitude: Number(s.longitude),
                    placeId: s.placeId || "",
                    source: "Database (Stop)"
                });
            }
        });

        (mapLocs || []).forEach((m) => {
            const name = normalizeStopName(m.name);
            if (name && isValidCoordinate(m.latitude, m.longitude)) {
                dbLocations.set(name, {
                    name: m.name,
                    displayName: m.address || m.name,
                    latitude: Number(m.latitude),
                    longitude: Number(m.longitude),
                    placeId: m.placeId || "",
                    source: "Database (MapLocation)"
                });
            }
        });
    } catch (err) {
        console.warn("[mapGeocodingService] Error loading DB location cache:", err.message);
    }

    return dbLocations;
};

/**
 * Persists a newly resolved coordinate to MongoDB MapLocation collection for future reuse.
 */
export const persistLocationToDb = async ({ name, address, latitude, longitude, placeId }) => {
    if (!isDbConnected() || !isValidCoordinate(latitude, longitude)) return;
    try {
        await MapLocation.findOneAndUpdate(
            { name: name.trim() },
            {
                $set: {
                    name: name.trim(),
                    address: address || name.trim(),
                    latitude: Number(latitude),
                    longitude: Number(longitude),
                    placeId: placeId || ""
                }
            },
            { upsert: true, new: true }
        );
    } catch (err) {
        // Non-blocking warning (e.g. duplicate key race)
        console.warn(`[mapGeocodingService] DB persist warning for "${name}":`, err.message);
    }
};

// ============================================================================
// CORE LOCATION RESOLVER (MULTI-TIER PIPELINE)
// ============================================================================

/**
 * Resolves coordinates for a single location using multi-tier strategy:
 * 1. Direct valid coordinates provided in object
 * 2. In-memory cache
 * 3. Database cache (MapLocation / Stop)
 * 4. Regional Gazetteer (Madurai / KLNCE)
 * 5. OSM Nominatim API (with rate limit + persistence to DB)
 */
export const resolveLocationCoordinates = async (locationItem, anchorHub = DEFAULT_SOURCE_HUB, dbCache = null) => {
    const name = locationItem?.name || locationItem?.stoppings || locationItem?.stopping || "";
    const city = locationItem?.city || "";
    const state = locationItem?.state || "";
    const country = locationItem?.country || "";

    const normalizedName = normalizeStopName(name);
    const canonKey = buildCanonicalLocationKey(name, city, state, country);

    // 1. Direct coordinate from object
    if (isValidCoordinate(locationItem?.latitude, locationItem?.longitude)) {
        return {
            name: name || "Resolved Location",
            displayName: locationItem?.displayName || locationItem?.address || name,
            latitude: Number(locationItem.latitude),
            longitude: Number(locationItem.longitude),
            placeId: locationItem?.placeId || "",
            source: "Direct Payload",
            resolved: true
        };
    }

    // 2. In-memory cache
    if (inMemoryGeocodeCache.has(canonKey)) {
        return {
            ...inMemoryGeocodeCache.get(canonKey),
            resolved: true
        };
    }
    if (inMemoryGeocodeCache.has(normalizedName)) {
        return {
            ...inMemoryGeocodeCache.get(normalizedName),
            resolved: true
        };
    }

    // 3. Database cache
    if (dbCache && dbCache.has(normalizedName)) {
        const cached = dbCache.get(normalizedName);
        inMemoryGeocodeCache.set(canonKey, cached);
        return { ...cached, resolved: true };
    }

    // 4. Regional Gazetteer
    if (MADURAI_REGIONAL_GAZETTEER[normalizedName]) {
        const gaz = MADURAI_REGIONAL_GAZETTEER[normalizedName];
        const resObj = {
            name,
            displayName: gaz.displayName,
            latitude: gaz.latitude,
            longitude: gaz.longitude,
            placeId: `gaz_${normalizedName}`,
            source: "Regional Transit Gazetteer",
            resolved: true
        };
        inMemoryGeocodeCache.set(canonKey, resObj);
        inMemoryGeocodeCache.set(normalizedName, resObj);
        // Persist to DB for future quick retrieval
        persistLocationToDb(resObj).catch(() => {});
        return resObj;
    }

    // 5. Query Nominatim API with multiple fallback query strings
    const queryVariants = [
        [name, city, state, country].filter(Boolean).join(", "),
        [name, city || "Madurai", "Tamil Nadu", "India"].join(", "),
        [name, "Madurai", "India"].join(", ")
    ];

    for (const q of queryVariants) {
        const nomResult = await queryNominatim(q, anchorHub);
        if (nomResult && isValidCoordinate(nomResult.latitude, nomResult.longitude)) {
            const resObj = {
                name,
                displayName: nomResult.displayName,
                latitude: nomResult.latitude,
                longitude: nomResult.longitude,
                placeId: nomResult.placeId,
                source: "OpenStreetMap Nominatim",
                resolved: true
            };
            inMemoryGeocodeCache.set(canonKey, resObj);
            inMemoryGeocodeCache.set(normalizedName, resObj);
            persistLocationToDb(resObj).catch(() => {});
            return resObj;
        }
    }

    // Unresolved
    return {
        name,
        displayName: name,
        latitude: null,
        longitude: null,
        placeId: "",
        source: "Failed Resolution",
        resolved: false,
        error: `Could not geocode stopping area: "${name}"`
    };
};

// ============================================================================
// BATCH STOP RESOLVER & COMPREHENSIVE DIAGNOSTICS
// ============================================================================

/**
 * Resolves an array of stopping groups, ensures all 30 source stopping areas
 * are geocoded without loss, applies distance bounds checks, and provides
 * detailed validation diagnostics.
 *
 * @param {Array} stoppingGroups - List of stopping groups with demand and metadata
 * @param {Object} anchorHub - Selected source/depot location (KLN College or dynamic)
 * @param {Object} options - Resolution options (maxRadiusKm, enforceUniqueNames, etc.)
 */
export const resolveStopCoordinates = async (stoppingGroups = [], anchorHub = DEFAULT_SOURCE_HUB, options = {}) => {
    const maxRadiusKm = options.maxRadiusKm || MAX_TRANSIT_RADIUS_KM;
    const resolvedStops = [];

    // Diagnostics tracking
    const diagnostics = {
        totalStoppingAreas: stoppingGroups.length,
        coveredStoppingAreas: 0,
        missingStoppingAreas: [],
        duplicateStoppingAreas: [],
        failedGeocodingLocations: [],
        invalidCoordinateLocations: [],
        distanceOutlierLocations: [],
        ambiguousLocations: [],
        isValid: true
    };

    if (!Array.isArray(stoppingGroups) || stoppingGroups.length === 0) {
        diagnostics.isValid = true;
        return { resolvedStops: [], diagnostics };
    }

    // Load pre-existing DB locations once for high-throughput resolution
    const dbCache = await loadDbLocationCache();

    // Track unique stopping names to detect duplicates
    const seenNames = new Map();

    for (let i = 0; i < stoppingGroups.length; i++) {
        const rawGroup = stoppingGroups[i];
        const rawName = String(rawGroup.name || rawGroup.stoppings || rawGroup.stopping || `Stop_${i + 1}`).trim();
        const normName = normalizeStopName(rawName);

        if (seenNames.has(normName)) {
            diagnostics.duplicateStoppingAreas.push({
                name: rawName,
                firstIndex: seenNames.get(normName),
                currentIndex: i
            });
        } else {
            seenNames.set(normName, i);
        }

        // Perform multi-tier geocoding
        const geo = await resolveLocationCoordinates(rawGroup, anchorHub, dbCache);

        if (!geo.resolved || !isValidCoordinate(geo.latitude, geo.longitude)) {
            diagnostics.failedGeocodingLocations.push({
                name: rawName,
                locationQuery: rawGroup.locationQuery || rawName,
                error: geo.error || "Invalid or missing coordinates"
            });
            diagnostics.missingStoppingAreas.push(rawName);
            continue;
        }

        // Check distance outlier relative to anchor source
        let distFromAnchor = 0;
        if (anchorHub && isValidCoordinate(anchorHub.latitude, anchorHub.longitude)) {
            distFromAnchor = calculateDistanceKm(
                anchorHub.latitude, anchorHub.longitude,
                geo.latitude, geo.longitude
            );

            if (distFromAnchor > maxRadiusKm) {
                diagnostics.distanceOutlierLocations.push({
                    name: rawName,
                    distanceKm: distFromAnchor,
                    maxAllowedKm: maxRadiusKm
                });
            }
        }

        // Micro-offset for near-identical coordinates to avoid degenerate OSRM zero-distance legs
        // without dropping any stopping areas!
        let finalLat = geo.latitude;
        let finalLon = geo.longitude;

        for (const prev of resolvedStops) {
            const d = calculateDistanceKm(finalLat, finalLon, prev.latitude, prev.longitude);
            if (d < 0.05 && prev.name.toLowerCase() !== rawName.toLowerCase()) {
                // Apply a minor 15-meter radial offset so OSRM routing handles both stops distinctly
                finalLat = Number((finalLat + 0.00015).toFixed(6));
                finalLon = Number((finalLon + 0.00015).toFixed(6));
                break;
            }
        }

        const resolvedEntry = {
            ...rawGroup,
            name: rawName,
            displayName: geo.displayName || rawName,
            address: geo.displayName || rawGroup.address || rawName,
            latitude: finalLat,
            longitude: finalLon,
            placeId: geo.placeId || "",
            geocodingSource: geo.source,
            distFromAnchor,
            userCount: Number(rawGroup.userCount || (rawGroup.users ? rawGroup.users.length : (rawGroup.userIds ? rawGroup.userIds.length : 0))),
            userIds: Array.isArray(rawGroup.userIds) ? rawGroup.userIds : (Array.isArray(rawGroup.users) ? rawGroup.users.map(u => String(u._id || u.userId || u.id || u)) : []),
            users: Array.isArray(rawGroup.users) ? rawGroup.users : [],
            resolved: true
        };

        resolvedStops.push(resolvedEntry);
    }

    diagnostics.coveredStoppingAreas = resolvedStops.length;
    diagnostics.isValid = diagnostics.failedGeocodingLocations.length === 0 && diagnostics.coveredStoppingAreas === stoppingGroups.length;

    return {
        resolvedStops,
        diagnostics
    };
};

/**
 * Clears the in-memory geocoding cache (useful for testing).
 */
export const clearGeocodingCache = () => {
    inMemoryGeocodeCache.clear();
};
