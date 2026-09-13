/* ==========================================================================
   GOOGLE MAPS SERVICE  (With Universal Global Fallback Engine)
   
   Architecture:
   - Primary: Google Maps JavaScript SDK (Places Autocomplete, Geocoding, Directions)
     when a valid, active VITE_GOOGLE_MAPS_API_KEY is configured.
   - Resilient Fallback: If Google Maps SDK fails, returns REQUEST_DENIED,
     hits quota limits, has billing inactive, or is blocked by network/adblockers:
     * searchPlaces       → locationSearchService (Komoot Photon + OSM Nominatim + Wikidata + Open-Meteo + Backend)
     * reverseGeocode     → locationSearchService (OSM Nominatim + BigDataCloud)
     * getRouteFromGoogle → Project OSRM driving router (Worldwide road navigation)
   - Zero Dead-Ends: Every place across the entire world can be searched reliably.
   ========================================================================== */

import {
    searchPlaces as searchOpenPlaces,
    reverseGeocode as openReverseGeocode,
    reverseGeocodeFast as openReverseGeocodeFast,
    normalizeLocation as openNormalizeLocation,
    isValidCoordinate as openIsValidCoordinate,
    getCategoryIcon as openGetCategoryIcon,
    formatPlaceType as openFormatPlaceType
} from "./locationSearchService.js";

export {
    DEFAULT_LAT,
    DEFAULT_LNG,
    DEFAULT_LONG,
    DEFAULT_LOCATION,
    DEFAULT_MAP_ZOOM
} from "../constants/locationConstants.js";

const GOOGLE_MAPS_API_KEY = (typeof import.meta !== "undefined" && import.meta.env?.VITE_GOOGLE_MAPS_API_KEY) || "";

let _sdkPromise = null;
let _googleUnavailable = !GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY.trim().length === 0;

// Listen for Google Maps runtime authentication error (e.g. invalid key, referrer blocked, billing missing)
if (typeof window !== "undefined") {
    const prevAuthFailure = window.gm_authFailure;
    window.gm_authFailure = () => {
        console.warn("[GoogleMapsService] Google Maps authentication rejected (API key restriction/billing). Seamlessly switching to Universal Global Search.");
        _googleUnavailable = true;
        if (typeof prevAuthFailure === "function") {
            try { prevAuthFailure(); } catch {}
        }
    };
}

/* ──────────────────────────────────────────────────────────────────────────
   1. SDK LOADER (idempotent, fails fast if unconfigured)
   ────────────────────────────────────────────────────────────────────────── */

export const loadGoogleMapsSDK = () => {
    if (_googleUnavailable) {
        return Promise.reject(new Error("Google Maps is not configured or is unavailable. Using Universal Global Search."));
    }

    if (_sdkPromise) return _sdkPromise;

    // Already loaded (e.g. HMR / hot reload)
    if (typeof window !== "undefined" && window.google?.maps?.places) {
        _sdkPromise = Promise.resolve(window.google.maps);
        return _sdkPromise;
    }

    _sdkPromise = new Promise((resolve, reject) => {
        if (typeof document === "undefined") {
            return reject(new Error("DOM is not available."));
        }

        // Avoid duplicate script tags
        if (document.querySelector('script[data-gmaps="1"]')) {
            const poll = setInterval(() => {
                if (window.google?.maps?.places) {
                    clearInterval(poll);
                    resolve(window.google.maps);
                }
            }, 100);
            return;
        }

        const callbackName = "__gmaps_cb_" + Date.now();
        window[callbackName] = () => {
            resolve(window.google.maps);
            delete window[callbackName];
        };

        const script = document.createElement("script");
        script.setAttribute("data-gmaps", "1");
        script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places&callback=${callbackName}`;
        script.async = true;
        script.defer = true;
        script.onerror = (e) => {
            console.warn("[GoogleMapsService] SDK script load failed, switching to Universal Global Search:", e);
            _googleUnavailable = true;
            _sdkPromise = null;
            reject(new Error("Google Maps SDK failed to load."));
        };

        document.head.appendChild(script);
    });

    return _sdkPromise;
};

/* ──────────────────────────────────────────────────────────────────────────
   2. PLACE SEARCH — Google Places with Universal Global Failover
   ────────────────────────────────────────────────────────────────────────── */

export const searchPlaces = async (query, signal) => {
    const clean = String(query || "").trim();
    if (clean.length < 2) {
        return { results: [], provider: "GLOBAL SEARCH", success: true };
    }

    // If Google Maps is known to be unavailable, directly invoke the universal open search
    if (_googleUnavailable) {
        return await searchOpenPlaces(clean, signal);
    }

    try {
        const maps = await loadGoogleMapsSDK();
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

        const autocomplete = new maps.places.AutocompleteService();
        const predictions = await new Promise((resolve, reject) => {
            if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
            autocomplete.getPlacePredictions(
                { input: clean },
                (results, status) => {
                    const S = maps.places.PlacesServiceStatus;
                    if (status === S.OK) return resolve(results || []);
                    if (status === S.ZERO_RESULTS) return resolve([]);
                    // Any error like REQUEST_DENIED, OVER_QUERY_LIMIT, INVALID_REQUEST
                    reject(new Error(`AutocompleteService status: ${status}`));
                }
            );
        });

        if (predictions && predictions.length > 0) {
            const dummyDiv = document.createElement("div");
            const detailsService = new maps.places.PlacesService(dummyDiv);

            const detailRequests = predictions.slice(0, 6).map(
                (prediction) =>
                    new Promise((resolve) => {
                        detailsService.getDetails(
                            {
                                placeId: prediction.place_id,
                                fields: ["name", "geometry", "formatted_address", "types", "place_id"]
                            },
                            (place, status) => {
                                const S = maps.places.PlacesServiceStatus;
                                if (status === S.OK && place?.geometry?.location) {
                                    resolve({
                                        name:
                                            place.name ||
                                            prediction.description.split(",")[0],
                                        address:
                                            place.formatted_address ||
                                            prediction.description,
                                        displayName:
                                            place.formatted_address ||
                                            prediction.description,
                                        latitude: place.geometry.location.lat(),
                                        longitude: place.geometry.location.lng(),
                                        placeId: place.place_id || prediction.place_id,
                                        types: place.types || ["point_of_interest"],
                                        type: formatPlaceType(place.types),
                                        provider: "google"
                                    });
                                } else {
                                    resolve(null);
                                }
                            }
                        );
                    })
            );

            const details = (await Promise.all(detailRequests)).filter(Boolean);

            if (details.length > 0) {
                return {
                    results: details,
                    provider: "GOOGLE PLACES",
                    success: true
                };
            }
        }
    } catch (err) {
        if (err?.name === "AbortError") throw err;
        console.warn(
            "[GoogleMapsService] Google Places search unavailable (" +
            (err?.message || err) +
            "). Seamlessly falling back to Universal Global Search."
        );
        _googleUnavailable = true;
    }

    // Transparent failover to Universal Open Location Search (Komoot Photon + OSM + Wikidata + Open-Meteo)
    return await searchOpenPlaces(clean, signal);
};

/* ──────────────────────────────────────────────────────────────────────────
   3. REVERSE GEOCODE — Google Geocoder with OpenStreetMap Fallback
   ────────────────────────────────────────────────────────────────────────── */

const reverseCache = new Map();

export const reverseGeocode = async (lat, lng) => {
    const numLat = Number(lat);
    const numLng = Number(lng);
    if (!Number.isFinite(numLat) || !Number.isFinite(numLng)) return null;

    const cacheKey = `${numLat.toFixed(5)},${numLng.toFixed(5)}`;
    if (reverseCache.has(cacheKey)) return reverseCache.get(cacheKey);

    if (!_googleUnavailable) {
        try {
            const maps = await loadGoogleMapsSDK();
            const geocoder = new maps.Geocoder();

            const response = await geocoder.geocode({
                location: { lat: numLat, lng: numLng }
            });

            if (response?.results?.length) {
                const top = response.results[0];
                const name =
                    top.address_components?.[0]?.long_name ||
                    top.formatted_address.split(",")[0];
                const result = {
                    name,
                    address: top.formatted_address,
                    displayName: top.formatted_address,
                    latitude: numLat,
                    longitude: numLng,
                    placeId: top.place_id || "",
                    types: top.types || ["point_of_interest"],
                    type: formatPlaceType(top.types),
                    source: "Google Geocoder"
                };
                reverseCache.set(cacheKey, result);
                return result;
            }
        } catch (err) {
            console.warn("[GoogleMapsService] Google reverseGeocode failed, using open reverse geocoder:", err);
            _googleUnavailable = true;
        }
    }

    // High-accuracy fallback: OpenStreetMap Nominatim + BigDataCloud
    try {
        const openResult = await openReverseGeocode(numLat, numLng);
        if (openResult) {
            reverseCache.set(cacheKey, openResult);
            return openResult;
        }
    } catch {
        // continue to pin fallback
    }

    return {
        name: "Pinned Location",
        address: `${numLat.toFixed(5)}, ${numLng.toFixed(5)}`,
        displayName: `${numLat.toFixed(5)}, ${numLng.toFixed(5)}`,
        latitude: numLat,
        longitude: numLng,
        placeId: `pin-${numLat.toFixed(4)}-${numLng.toFixed(4)}`,
        types: ["point_of_interest"],
        type: "Place"
    };
};

export const reverseGeocodeFast = reverseGeocode;

/* ──────────────────────────────────────────────────────────────────────────
   4. ROAD ROUTING — Google Directions with OSRM Universal Fallback & Caching
   ────────────────────────────────────────────────────────────────────────── */

// In-memory LRU-like route cache keyed by ordered stop coordinates
const _routeCache = new Map();
const MAX_ROUTE_CACHE_SIZE = 100;

export const getRouteCacheKey = (locations) => {
    if (!Array.isArray(locations) || locations.length < 2) return "";
    return locations
        .map((loc) => `${Number(loc.longitude).toFixed(5)},${Number(loc.latitude).toFixed(5)}`)
        .join(";");
};

/** OSRM Worldwide Road Driving Router */
export const getRouteFromOSRM = async (locations) => {
    if (!Array.isArray(locations) || locations.length < 2) return null;

    const cacheKey = getRouteCacheKey(locations);
    if (cacheKey && _routeCache.has(cacheKey)) {
        return _routeCache.get(cacheKey);
    }

    const coordinates = locations
        .map((loc) => `${Number(loc.longitude)},${Number(loc.latitude)}`)
        .join(";");

    const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("OSRM service failed");
        const data = await response.json();
        if (data.code !== "Ok" || !data.routes?.length) {
            throw new Error("Unable to find road route");
        }
        const route = data.routes[0];
        const result = {
            geometry: route.geometry,
            distance: route.distance,
            duration: route.duration,
            provider: "osrm"
        };

        if (cacheKey) {
            if (_routeCache.size >= MAX_ROUTE_CACHE_SIZE) {
                const firstKey = _routeCache.keys().next().value;
                _routeCache.delete(firstKey);
            }
            _routeCache.set(cacheKey, result);
        }

        return result;
    } catch (err) {
        console.warn("[GoogleMapsService] OSRM routing fallback error:", err);
        return null;
    }
};

/** Google Directions with automatic OSRM failover and in-memory caching */
export const getRouteFromGoogle = async (locations) => {
    if (!Array.isArray(locations) || locations.length < 2) return null;

    const cacheKey = getRouteCacheKey(locations);
    if (cacheKey && _routeCache.has(cacheKey)) {
        return _routeCache.get(cacheKey);
    }

    if (!_googleUnavailable) {
        try {
            const maps = await loadGoogleMapsSDK();
            const directionsService = new maps.DirectionsService();

            const origin = {
                lat: Number(locations[0].latitude),
                lng: Number(locations[0].longitude)
            };
            const destination = {
                lat: Number(locations[locations.length - 1].latitude),
                lng: Number(locations[locations.length - 1].longitude)
            };
            const waypoints = locations.slice(1, -1).map((loc) => ({
                location: {
                    lat: Number(loc.latitude),
                    lng: Number(loc.longitude)
                },
                stopover: true
            }));

            const result = await directionsService.route({
                origin,
                destination,
                waypoints,
                optimizeWaypoints: false,
                travelMode: maps.TravelMode.DRIVING
            });

            if (result.status === "OK" && result.routes?.length) {
                const allCoords = [];
                for (const leg of result.routes[0].legs) {
                    for (const step of leg.steps) {
                        const decoded = decodePolyline(step.polyline.points);
                        allCoords.push(...decoded);
                    }
                }

                const totalDistance = result.routes[0].legs.reduce(
                    (sum, l) => sum + l.distance.value, 0
                );
                const totalDuration = result.routes[0].legs.reduce(
                    (sum, l) => sum + l.duration.value, 0
                );

                const finalResult = {
                    geometry: {
                        type: "LineString",
                        coordinates: allCoords.map(([lat, lng]) => [lng, lat])
                    },
                    distance: totalDistance,
                    duration: totalDuration,
                    provider: "google"
                };

                if (cacheKey) {
                    if (_routeCache.size >= MAX_ROUTE_CACHE_SIZE) {
                        const firstKey = _routeCache.keys().next().value;
                        _routeCache.delete(firstKey);
                    }
                    _routeCache.set(cacheKey, finalResult);
                }

                return finalResult;
            }
        } catch (err) {
            console.warn("[GoogleMapsService] Google Directions failed, falling back to OSRM road router:", err);
            _googleUnavailable = true;
        }
    }

    // Worldwide road routing fallback via OSRM
    return await getRouteFromOSRM(locations);
};

/* ──────────────────────────────────────────────────────────────────────────
   5. HELPERS & FORMATTERS (Universal compatibility)
   ────────────────────────────────────────────────────────────────────────── */

/** Decode a Google Maps encoded polyline string → [[lat, lng], ...] */
export const decodePolyline = (encoded) => {
    const coords = [];
    let index = 0, lat = 0, lng = 0;
    while (index < encoded.length) {
        let b, shift = 0, result = 0;
        do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        lat += result & 1 ? ~(result >> 1) : result >> 1;
        shift = 0; result = 0;
        do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        lng += result & 1 ? ~(result >> 1) : result >> 1;
        coords.push([lat / 1e5, lng / 1e5]);
    }
    return coords;
};

export const formatPlaceType = openFormatPlaceType;
export const normalizeLocation = openNormalizeLocation;
export const isValidCoordinate = openIsValidCoordinate;
export const getCategoryIcon = openGetCategoryIcon;

export default {
    loadGoogleMapsSDK,
    searchPlaces,
    reverseGeocode,
    reverseGeocodeFast,
    getRouteFromGoogle,
    getRouteFromOSRM,
    normalizeLocation,
    isValidCoordinate,
    getCategoryIcon,
    formatPlaceType,
    decodePolyline
};
