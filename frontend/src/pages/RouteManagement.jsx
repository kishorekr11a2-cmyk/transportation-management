import { useEffect, useRef, useState } from "react";
import api from "../services/api";
import {
    normalizeLocation,
    reverseGeocode,
    isValidCoordinate
} from "../services/locationSearchService";
import LocationSearchBox from "../components/LocationSearchBox";
import "../css/RouteManagement.css";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

delete L.Icon.Default.prototype._getIconUrl;

L.Icon.Default.mergeOptions({
    iconRetinaUrl:
        "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl:
        "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl:
        "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png"
});

const getRouteFromOSRM = async (locations) => {
    if (locations.length < 2) {
        return null;
    }

    const coordinates = locations
        .map((location) => `${Number(location.longitude)},${Number(location.latitude)}`)
        .join(";");

    const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Road routing service failed.");
        const data = await response.json();
        if (data.code !== "Ok" || !data.routes || !data.routes.length) {
            throw new Error("Unable to find a road route.");
        }
        return data.routes[0];
    } catch {
        return null;
    }
};

export default function RouteManagement() {
    const mapRef = useRef(null);
    const mapContainerRef = useRef(null);

    const markersRef = useRef([]);
    const lineRef = useRef(null);
    const temporaryMarkerRef = useRef(null);

    const [routes, setRoutes] = useState([]);
    const [vehicles, setVehicles] = useState([]);

    const [routeName, setRouteName] = useState("");
    const [routeStops, setRouteStops] = useState([]);
    const [destination, setDestination] = useState(null);

    const [selectedVehicle, setSelectedVehicle] = useState("");
    const [selectedLocation, setSelectedLocation] = useState(null);

    const [loading, setLoading] = useState(false);
    const [routingLoading, setRoutingLoading] = useState(false);
    const [error, setError] = useState("");
    const [editingRoute, setEditingRoute] = useState(null);
    const [fullscreen, setFullscreen] = useState(false);

    // ==================================================
    // FULL ACCESS INTERACTIVE MAP INITIALIZATION
    // ==================================================
    useEffect(() => {
        if (!mapContainerRef.current || mapRef.current) {
            return;
        }

        const map = L.map(mapContainerRef.current, {
            center: [13.0827, 80.2707], // Default centered on Chennai corridor
            zoom: 12,
            zoomControl: true,
            dragging: true,
            scrollWheelZoom: true,
            doubleClickZoom: true,
            boxZoom: true,
            keyboard: true,
            touchZoom: true
        });

        // CartoDB Voyager — Vector tiles, crisp and high performance
        L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: "abcd",
            maxZoom: 20
        }).addTo(map);

        map.on("click", async (event) => {
            const lat = event.latlng.lat;
            const lng = event.latlng.lng;

            try {
                const rev = await reverseGeocode(lat, lng);
                const location = {
                    name: rev.name || "Pinned Location",
                    address: rev.address || `Coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
                    latitude: lat,
                    longitude: lng,
                    placeId: rev.placeId || "",
                    types: rev.types || ["point_of_interest"]
                };

                setSelectedLocation(location);
                setError("");
                showTemporaryMarker(location);
            } catch {
                const location = {
                    name: "Pinned Location",
                    address: `Coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
                    latitude: lat,
                    longitude: lng,
                    placeId: "",
                    types: ["point_of_interest"]
                };

                setSelectedLocation(location);
                setError("");
                showTemporaryMarker(location);
            }
        });

        mapRef.current = map;

        loadRoutes();
        loadVehicles();

        return () => {
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
            }
        };
    }, []);

    const showTemporaryMarker = (location) => {
        if (!mapRef.current || !isValidCoordinate(location)) return;

        if (temporaryMarkerRef.current) {
            temporaryMarkerRef.current.remove();
            temporaryMarkerRef.current = null;
        }

        const tempIcon = L.divIcon({
            className: "custom-map-icon temp-pin",
            html: `<div style="background:#ef4444; color:#fff; border:2px solid #fff; border-radius:50%; width:30px; height:30px; display:flex; align-items:center; justify-content:center; font-size:15px; box-shadow:0 3px 12px rgba(239,68,68,0.5); transform:scale(1.1);">📍</div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 30]
        });

        const marker = L.marker([Number(location.latitude), Number(location.longitude)], {
            icon: tempIcon
        })
            .addTo(mapRef.current)
            .bindPopup(
                `<div style="font-family:system-ui; font-size:13px;">
                    <strong style="color:#0f172a; font-size:14px;">📍 ${location.name || "Selected Location"}</strong>
                    <div style="color:#475569; font-size:12px; margin-top:3px;">${location.address || ""}</div>
                    <div style="color:#94a3b8; font-size:11px; margin-top:3px;">${Number(location.latitude).toFixed(5)}, ${Number(location.longitude).toFixed(5)}</div>
                 </div>`
            )
            .openPopup();

        temporaryMarkerRef.current = marker;
        mapRef.current.setView([Number(location.latitude), Number(location.longitude)], 15, { animate: true });
    };

    const loadRoutes = async () => {
        try {
            setLoading(true);
            const response = await api.get("/routes");
            const routeData = Array.isArray(response.data)
                ? response.data
                : response.data?.routes || response.data?.data || [];
            setRoutes(routeData);
        } catch (err) {
            console.error("Load Routes Error:", err);
            setError("Unable to load routes.");
        } finally {
            setLoading(false);
        }
    };

    const loadVehicles = async () => {
        try {
            const response = await api.get("/vehicles");
            const vehicleData = Array.isArray(response.data)
                ? response.data
                : response.data?.vehicles || response.data?.data || [];
            setVehicles(vehicleData);
        } catch (err) {
            console.error("Load Vehicles Error:", err);
        }
    };

    const selectSearchResult = (result) => {
        const location = normalizeLocation(result);
        if (!location || !isValidCoordinate(location)) {
            setError("This location does not have valid coordinates.");
            return;
        }
        setSelectedLocation(location);
        setError("");
        showTemporaryMarker(location);
    };

    const addLocationToRoute = async () => {
        if (!selectedLocation) {
            setError("Search or pin a location first.");
            return;
        }

        const exists = routeStops.some(
            (stop) =>
                (stop.placeId && selectedLocation.placeId && stop.placeId === selectedLocation.placeId) ||
                (Number(stop.latitude).toFixed(4) === Number(selectedLocation.latitude).toFixed(4) &&
                 Number(stop.longitude).toFixed(4) === Number(selectedLocation.longitude).toFixed(4))
        );

        if (exists) {
            setError("This location is already added in the route.");
            return;
        }

        const newStop = {
            name: selectedLocation.name,
            address: selectedLocation.address || "",
            latitude: Number(selectedLocation.latitude),
            longitude: Number(selectedLocation.longitude),
            placeId: selectedLocation.placeId || "",
            types: selectedLocation.types || []
        };

        const updatedStops = [...routeStops, newStop];
        setRouteStops(updatedStops);
        setSelectedLocation(null);
        setError("");

        if (temporaryMarkerRef.current) {
            temporaryMarkerRef.current.remove();
            temporaryMarkerRef.current = null;
        }

        await redrawRoadRoute(updatedStops, destination);
    };

    const setDestinationLocation = async () => {
        if (!selectedLocation) {
            setError("Search or pin a location first.");
            return;
        }

        const newDestination = {
            name: selectedLocation.name,
            address: selectedLocation.address || "",
            latitude: Number(selectedLocation.latitude),
            longitude: Number(selectedLocation.longitude),
            placeId: selectedLocation.placeId || "",
            types: selectedLocation.types || []
        };

        setDestination(newDestination);
        setSelectedLocation(null);
        setError("");

        if (temporaryMarkerRef.current) {
            temporaryMarkerRef.current.remove();
            temporaryMarkerRef.current = null;
        }

        await redrawRoadRoute(routeStops, newDestination);
    };

    const removeStop = async (index) => {
        const updated = routeStops.filter((_, i) => i !== index);
        setRouteStops(updated);
        await redrawRoadRoute(updated, destination);
    };

    const moveStop = async (index, direction) => {
        const updated = [...routeStops];
        const newIndex = index + direction;

        if (newIndex < 0 || newIndex >= updated.length) return;

        [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
        setRouteStops(updated);
        await redrawRoadRoute(updated, destination);
    };

    const redrawRoadRoute = async (stops, dest) => {
        if (!mapRef.current) return;

        if (lineRef.current) {
            lineRef.current.remove();
            lineRef.current = null;
        }

        const locations = [...stops, ...(dest ? [dest] : [])];

        if (locations.length < 2) {
            drawSavedRouteMarkers(stops, dest);
            return;
        }

        try {
            setRoutingLoading(true);

            const route = await getRouteFromOSRM(locations);
            let pathCoords = [];

            if (route && Array.isArray(route.geometry?.coordinates)) {
                pathCoords = route.geometry.coordinates.map(([lng, lat]) => [
                    Number(lat),
                    Number(lng)
                ]);
            } else {
                pathCoords = locations.map((loc) => [
                    Number(loc.latitude),
                    Number(loc.longitude)
                ]);
            }

            lineRef.current = L.polyline(pathCoords, {
                color: "#2563eb",
                weight: 6,
                opacity: 0.9,
                lineJoin: "round",
                lineCap: "round"
            }).addTo(mapRef.current);

            drawSavedRouteMarkers(stops, dest);

            mapRef.current.fitBounds(lineRef.current.getBounds(), {
                padding: [50, 50]
            });
        } catch (err) {
            console.error("Road Route Error:", err);
            setError("Unable to create road route.");
        } finally {
            setRoutingLoading(false);
        }
    };

    const drawSavedRouteMarkers = (stops, dest) => {
        if (!mapRef.current) return;

        markersRef.current.forEach((marker) => marker.remove());
        markersRef.current = [];

        stops.forEach((stop, index) => {
            const stopIcon = L.divIcon({
                className: "custom-map-icon stop-icon",
                html: `<div style="background:#2563eb; color:#fff; border:2px solid #fff; border-radius:50%; width:28px; height:28px; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:800; box-shadow:0 3px 8px rgba(0,0,0,0.3);">${index + 1}</div>`,
                iconSize: [28, 28],
                iconAnchor: [14, 28]
            });

            const marker = L.marker([Number(stop.latitude), Number(stop.longitude)], {
                icon: stopIcon
            })
                .addTo(mapRef.current)
                .bindPopup(
                    `<strong>Stop ${index + 1}: ${stop.name}</strong><br><small>${stop.address || ""}</small>`
                );

            markersRef.current.push(marker);
        });

        if (dest) {
            const destIcon = L.divIcon({
                className: "custom-map-icon dest-icon",
                html: `<div style="background:#16a34a; color:#fff; border:2px solid #fff; border-radius:50%; width:32px; height:32px; display:flex; align-items:center; justify-content:center; font-size:15px; box-shadow:0 3px 10px rgba(0,0,0,0.3);">🏁</div>`,
                iconSize: [32, 32],
                iconAnchor: [16, 32]
            });

            const marker = L.marker([Number(dest.latitude), Number(dest.longitude)], {
                icon: destIcon
            })
                .addTo(mapRef.current)
                .bindPopup(`<strong>🏁 Destination: ${dest.name}</strong><br><small>${dest.address || ""}</small>`);

            markersRef.current.push(marker);
        }
    };

    const saveRoute = async () => {
        if (!routeName.trim()) {
            setError("Enter a route name or route number.");
            return;
        }

        if (routeStops.length < 1) {
            setError("Add at least one stop to the route.");
            return;
        }

        if (!destination) {
            setError("Select a destination.");
            return;
        }

        try {
            setLoading(true);
            setError("");

            const payload = {
                routeName: routeName.trim(),
                source: routeStops[0] || destination,
                stops: routeStops,
                destination,
                assignedVehicle: selectedVehicle || null
            };

            if (editingRoute) {
                await api.put(`/routes/${editingRoute._id}`, payload);
            } else {
                await api.post("/routes", payload);
            }

            await loadRoutes();
            clearRoute();
        } catch (err) {
            console.error("Save Route Error:", err);
            setError(err.response?.data?.message || err.message || "Unable to save route.");
        } finally {
            setLoading(false);
        }
    };

    const editRoute = (route) => {
        setEditingRoute(route);
        setRouteName(route.routeName || "");
        setRouteStops(Array.isArray(route.stops) ? route.stops : []);
        setDestination(route.destination || null);
        setSelectedVehicle(route.assignedVehicle?._id || route.assignedVehicle || "");
        setSelectedLocation(null);
        setError("");

        redrawRoadRoute(
            Array.isArray(route.stops) ? route.stops : [],
            route.destination || null
        );
    };

    const deleteRoute = async (route) => {
        if (!window.confirm(`Are you sure you want to delete "${route.routeName}"?`)) {
            return;
        }

        try {
            setLoading(true);
            await api.delete(`/routes/${route._id}`);
            setRoutes((prev) => prev.filter((r) => r._id !== route._id));
            if (editingRoute?._id === route._id) {
                clearRoute();
            }
        } catch (err) {
            console.error("Delete Route Error:", err);
            setError("Unable to delete route.");
        } finally {
            setLoading(false);
        }
    };

    const clearRoute = () => {
        setEditingRoute(null);
        setRouteName("");
        setRouteStops([]);
        setDestination(null);
        setSelectedVehicle("");
        setSelectedLocation(null);
        setError("");

        if (lineRef.current) {
            lineRef.current.remove();
            lineRef.current = null;
        }

        markersRef.current.forEach((marker) => marker.remove());
        markersRef.current = [];

        if (temporaryMarkerRef.current) {
            temporaryMarkerRef.current.remove();
            temporaryMarkerRef.current = null;
        }
    };

    const newRoute = () => {
        clearRoute();
        if (mapRef.current) {
            mapRef.current.setView([13.0827, 80.2707], 12);
        }
    };

    const panMap = (direction) => {
        if (!mapRef.current) return;
        const distance = 250;
        const offsets = {
            up: [0, -distance],
            down: [0, distance],
            left: [-distance, 0],
            right: [distance, 0]
        };
        mapRef.current.panBy(offsets[direction], { animate: true, duration: 0.4 });
    };

    const toggleFullscreen = () => {
        setFullscreen((prev) => !prev);
        setTimeout(() => {
            mapRef.current?.invalidateSize();
        }, 250);
    };

    const assignedVehicleObj = vehicles.find(
        (v) => String(v._id) === String(selectedVehicle)
    );

    return (
        <div className={`route-container ${fullscreen ? "route-fullscreen" : ""}`}>
            {!fullscreen && <h2>🛣️ Route Management</h2>}

            {error && <div className="route-error">{error}</div>}

            <div className="route-layout">
                {/* 100% FULL ACCESS INTERACTIVE MAP */}
                <div className="map-section">
                    <button className="fullscreen-button" onClick={toggleFullscreen}>
                        {fullscreen ? "✕ Exit Fullscreen" : "⛶ Fullscreen"}
                    </button>

                    {/* MAP PAN CONTROLS */}
                    <div className="map-pan-controls">
                        <button onClick={() => panMap("up")} title="Move map up">
                            ↑
                        </button>
                        <div>
                            <button onClick={() => panMap("left")} title="Move map left">
                                ←
                            </button>
                            <button onClick={() => panMap("right")} title="Move map right">
                                →
                            </button>
                        </div>
                        <button onClick={() => panMap("down")} title="Move map down">
                            ↓
                        </button>
                    </div>

                    <div ref={mapContainerRef} className="route-map" />
                </div>

                {/* ROUTE CONTROL PANEL */}
                {!fullscreen && (
                    <div className="route-panel">
                        {/* ROUTE INFO */}
                        <section className="route-card">
                            <div className="route-title-row">
                                <div>
                                    <h3>🛣️ Route Details</h3>
                                    <p>Create a route and add multiple stops along transit corridors.</p>
                                </div>

                                <button className="new-route-button" onClick={newRoute}>
                                    + New Route
                                </button>
                            </div>

                            <label>Route Name / Number</label>
                            <input
                                value={routeName}
                                onChange={(e) => setRouteName(e.target.value)}
                                placeholder="Example: Route 1 - Chennai Corridor"
                            />
                        </section>

                        {/* BUS ALLOCATION */}
                        <section className="route-card bus-allocation-card">
                            <div className="section-title">
                                <div>
                                    <h3>🚌 Allocate Bus</h3>
                                    <p className="help-text">Select the bus that will operate this route.</p>
                                </div>
                                {selectedVehicle && (
                                    <span className="allocation-status">Bus Assigned</span>
                                )}
                            </div>

                            <label>Select Vehicle</label>
                            <select
                                value={selectedVehicle}
                                onChange={(e) => setSelectedVehicle(e.target.value)}
                            >
                                <option value="">-- Select Bus --</option>
                                {vehicles.map((vehicle) => (
                                    <option key={vehicle._id} value={vehicle._id}>
                                        {vehicle.vehicleName} — {vehicle.capacity} seats
                                    </option>
                                ))}
                            </select>

                            {assignedVehicleObj && (
                                <div className="selected-bus">
                                    <span className="bus-icon">🚌</span>
                                    <div>
                                        <strong>{assignedVehicleObj.vehicleName}</strong>
                                        <small>{assignedVehicleObj.capacity} seats capacity</small>
                                    </div>
                                </div>
                            )}
                        </section>

                        {/* LOCATION SEARCH */}
                        <section className="route-card">
                            <h3>📍 Add Route Location</h3>
                            <p className="help-text">
                                Search globally (city, college, hospital, station, airport, landmark), or click directly on the map.
                            </p>

                            <div className="search-row-global">
                                <LocationSearchBox
                                    placeholder="Search location (Chennai, Tambaram, Airport, Station, College)..."
                                    selectedLocation={selectedLocation}
                                    onSelectLocation={(loc) => selectSearchResult(loc)}
                                    onClear={() => {
                                        setSelectedLocation(null);
                                        if (temporaryMarkerRef.current) {
                                            temporaryMarkerRef.current.remove();
                                            temporaryMarkerRef.current = null;
                                        }
                                    }}
                                />
                            </div>

                            {selectedLocation && (
                                <div className="selected-location">
                                    <div>
                                        <strong>{selectedLocation.name}</strong>
                                        <p style={{ margin: "2px 0 4px 0", fontSize: "12px", color: "#64748b" }}>
                                            {selectedLocation.address}
                                        </p>
                                        <small>
                                            {Number(selectedLocation.latitude).toFixed(5)}, {Number(selectedLocation.longitude).toFixed(5)}
                                        </small>
                                    </div>

                                    <div className="location-actions">
                                        <button onClick={addLocationToRoute}>+ Add Stop</button>
                                        <button onClick={setDestinationLocation}>Set Destination</button>
                                    </div>
                                </div>
                            )}
                        </section>

                        {/* ROUTE STOPS LIST */}
                        <section className="route-card">
                            <div className="section-title">
                                <h3>📍 Route Stops ({routeStops.length})</h3>
                                <span>{routeStops.length} stops</span>
                            </div>

                            {routingLoading && (
                                <div className="routing-status">Calculating road route...</div>
                            )}

                            {routeStops.length === 0 ? (
                                <div className="empty-stops">
                                    No stops added yet.<br />
                                    Search for a place above or click on the map to pin stops.
                                </div>
                            ) : (
                                <div className="route-stop-list">
                                    {routeStops.map((stop, index) => (
                                        <div className="route-stop" key={`${stop.name}-${index}`}>
                                            <span className="stop-number">{index + 1}</span>

                                            <div className="stop-info">
                                                <strong>{stop.name}</strong>
                                                {stop.address && stop.address !== stop.name && (
                                                    <p style={{ margin: "1px 0", fontSize: "11px", color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                        {stop.address}
                                                    </p>
                                                )}
                                                <small>
                                                    {Number(stop.latitude).toFixed(4)}, {Number(stop.longitude).toFixed(4)}
                                                </small>
                                            </div>

                                            <div className="stop-actions">
                                                <button
                                                    onClick={() => moveStop(index, -1)}
                                                    disabled={index === 0}
                                                    title="Move stop up"
                                                >
                                                    ↑
                                                </button>
                                                <button
                                                    onClick={() => moveStop(index, 1)}
                                                    disabled={index === routeStops.length - 1}
                                                    title="Move stop down"
                                                >
                                                    ↓
                                                </button>
                                                <button
                                                    onClick={() => removeStop(index)}
                                                    title="Remove stop"
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* DESTINATION */}
                            {destination && (
                                <div className="destination-box">
                                    <span className="stop-number">🏁</span>
                                    <div className="stop-info">
                                        <strong>Destination: {destination.name}</strong>
                                        {destination.address && (
                                            <p style={{ margin: "1px 0", fontSize: "11px", color: "#64748b" }}>
                                                {destination.address}
                                            </p>
                                        )}
                                        <small>
                                            {Number(destination.latitude).toFixed(4)}, {Number(destination.longitude).toFixed(4)}
                                        </small>
                                    </div>
                                    <button onClick={() => setDestination(null)} title="Remove destination">
                                        ✕
                                    </button>
                                </div>
                            )}
                        </section>

                        {/* ROUTE ACTIONS */}
                        <div className="route-actions">
                            <button
                                className="save-route-button"
                                onClick={saveRoute}
                                disabled={loading}
                            >
                                {loading
                                    ? "Saving..."
                                    : editingRoute
                                    ? "✓ Update Route"
                                    : "✓ Save Route"}
                            </button>

                            {(editingRoute || routeStops.length > 0) && (
                                <button className="clear-route-button" onClick={clearRoute}>
                                    Clear
                                </button>
                            )}
                        </div>

                        {/* SAVED ROUTES */}
                        <section className="route-card">
                            <div className="section-title">
                                <h3>Saved Routes ({routes.length})</h3>
                                <span>{routes.length} total</span>
                            </div>

                            {routes.length === 0 ? (
                                <div className="empty-stops">No saved routes found.</div>
                            ) : (
                                <div className="saved-routes">
                                    {routes.map((route) => {
                                        const vehicleName =
                                            route.assignedVehicle?.vehicleName ||
                                            route.vehicleName ||
                                            "Unassigned Bus";
                                        const capacity =
                                            route.assignedVehicle?.capacity ||
                                            route.capacity ||
                                            0;
                                        const stops = Array.isArray(route.stops) ? route.stops : [];
                                        const dest = route.destination;

                                        return (
                                            <div className="saved-route" key={route._id}>
                                                <div className="saved-route-header">
                                                    <strong>{route.routeName}</strong>
                                                    <span>
                                                        🚌 {vehicleName} ({capacity} seats)
                                                    </span>
                                                </div>

                                                <div className="route-preview">
                                                    {stops.length === 0 ? (
                                                        <span>No stops configured</span>
                                                    ) : (
                                                        stops.map((stop, sIdx) => (
                                                            <span key={`${stop.name}-${sIdx}`}>
                                                                {stop.name} →{" "}
                                                            </span>
                                                        ))
                                                    )}
                                                    {dest && <strong>🏁 {dest.name}</strong>}
                                                </div>

                                                <div className="saved-route-actions">
                                                    <button onClick={() => editRoute(route)}>
                                                        Edit
                                                    </button>
                                                    <button onClick={() => deleteRoute(route)}>
                                                        Delete
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </section>
                    </div>
                )}
            </div>
        </div>
    );
}