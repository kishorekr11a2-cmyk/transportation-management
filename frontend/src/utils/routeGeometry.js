/**
 * Universal Polyline LatLng Extractor for Leaflet Maps
 * Safely extracts [[lat, lng], [lat, lng], ...] from any of:
 * - Direct roadGeometry or coordinates array: [[lat, lng], ...]
 * - Object coordinate array: [{ latitude, longitude }, ...] or [{ lat, lng }, ...]
 * - GeoJSON LineString: { type: "LineString", coordinates: [[lng, lat], ...] }
 * - Nested roadValidation / geoJson / geometry structures
 */
export const extractPolylineLatLngs = (routeObj) => {
    if (!routeObj) return [];

    // 1. Direct roadGeometry array
    const directRoad = routeObj.roadGeometry || routeObj.coordinates;
    if (Array.isArray(directRoad) && directRoad.length > 1) {
        const parsed = directRoad.map((p) => {
            if (Array.isArray(p)) {
                return [Number(p[0]), Number(p[1])];
            }
            return [Number(p.latitude ?? p.lat), Number(p.longitude ?? p.lng)];
        }).filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
        if (parsed.length > 1) return parsed;
    }

    // 2. GeoJSON LineString geometry: { type: "LineString", coordinates: [[lng, lat], ...] }
    const geo = routeObj.geometry || routeObj.geoJson || routeObj.roadValidation?.geometry;
    if (geo && Array.isArray(geo.coordinates) && geo.coordinates.length > 1) {
        // GeoJSON standard is [lng, lat] -> convert to Leaflet [lat, lng]
        const parsed = geo.coordinates.map(([lng, lat]) => [Number(lat), Number(lng)])
            .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
        if (parsed.length > 1) return parsed;
    }

    // 3. Flat array in geometry property: [[lat, lng], ...]
    if (Array.isArray(geo) && geo.length > 1) {
        const parsed = geo.map((p) => {
            if (Array.isArray(p)) {
                return [Number(p[0]), Number(p[1])];
            }
            return [Number(p.latitude ?? p.lat), Number(p.longitude ?? p.lng)];
        }).filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
        if (parsed.length > 1) return parsed;
    }

    // 4. Fallback: check nested roadValidation.geometry.coordinates
    if (routeObj.roadValidation?.geometry?.coordinates) {
        const coords = routeObj.roadValidation.geometry.coordinates;
        if (Array.isArray(coords) && coords.length > 1) {
            const parsed = coords.map(([lng, lat]) => [Number(lat), Number(lng)])
                .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
            if (parsed.length > 1) return parsed;
        }
    }

    return [];
};
