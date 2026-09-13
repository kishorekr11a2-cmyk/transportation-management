/**
 * Shared Location & Map Constants
 * Consistent geographic defaults across map views, route planning, and geocoding.
 */

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

export const DEFAULT_MAP_ZOOM = 12;

export default {
    DEFAULT_LAT,
    DEFAULT_LNG,
    DEFAULT_LONG,
    DEFAULT_LOCATION,
    DEFAULT_MAP_ZOOM
};
