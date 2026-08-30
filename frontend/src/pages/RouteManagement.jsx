import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png"
});

const getRouteFromOSRM = async (locations) => {
    if (!Array.isArray(locations) || locations.length < 2) {
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
    const location = useLocation();
    const navigate = useNavigate();

    const mapRef = useRef(null);
    const mapContainerRef = useRef(null);

    const markersRef = useRef([]);
    const lineRef = useRef(null);
    const temporaryMarkerRef = useRef(null);

    // Database state
    const [routes, setRoutes] = useState([]);
    const [vehicles, setVehicles] = useState([]);
    const [schedules, setSchedules] = useState([]);

    // Single Unified Route Stop Form State
    const [routeName, setRouteName] = useState("");
    const [selectedVehicle, setSelectedVehicle] = useState("");
    const [selectedStops, setSelectedStops] = useState([]);
    const [newStopCandidate, setNewStopCandidate] = useState(null);

    const [editingRoute, setEditingRoute] = useState(null);
    const [loading, setLoading] = useState(false);
    const [routingLoading, setRoutingLoading] = useState(false);
    const [error, setError] = useState("");
    const [successMessage, setSuccessMessage] = useState("");
    const [fullscreen, setFullscreen] = useState(false);

    // AI Generated Route Inspection State (Read-only viewer)
    const [aiViewingRoute, setAiViewingRoute] = useState(null);

    // ==================================================
    // 1. VEHICLE ALLOCATION AVAILABILITY (SCHEDULED + AVAILABLE + UNASSIGNED)
    // ==================================================
    const availableVehicles = useMemo(() => {
        // Map of schedules by vehicle ID
        const scheduleMap = new Map();
        schedules.forEach((s) => {
            const vId = String(s.vehicle?._id || s.vehicle || "");
            if (vId) {
                scheduleMap.set(vId, s);
            }
        });

        // Set of vehicle IDs allocated to other active routes
        const assignedVehicleIds = new Set(
            routes
                .filter((r) => !editingRoute || String(r._id) !== String(editingRoute._id))
                .map((r) => String(r.assignedVehicle?._id || r.assignedVehicle || ""))
                .filter(Boolean)
        );

        // Filter vehicles: MUST have schedule === "Available" AND NOT allocated to other routes
        return vehicles.filter((v) => {
            const vId = String(v._id);

            // If editing, allow the route's currently assigned vehicle
            if (editingRoute) {
                const currentAssignedId = String(
                    editingRoute.assignedVehicle?._id || editingRoute.assignedVehicle || ""
                );
                if (vId === currentAssignedId) {
                    return true;
                }
            }

            // Check if allocated to another route
            if (assignedVehicleIds.has(vId)) {
                return false;
            }

            // Check if vehicle is scheduled and available in Schedule Management
            const sched = scheduleMap.get(vId);
            if (!sched || sched.availability !== "Available") {
                return false;
            }

            return true;
        });
    }, [routes, vehicles, schedules, editingRoute]);

    const assignedVehicleObj = useMemo(() => {
        return vehicles.find((v) => String(v._id) === String(selectedVehicle)) || null;
    }, [vehicles, selectedVehicle]);

    // ==================================================
    // 2. MAP INITIALIZATION & EVENT LISTENERS
    // ==================================================
    useEffect(() => {
        if (!mapContainerRef.current || mapRef.current) {
            return;
        }

        const map = L.map(mapContainerRef.current, {
            center: [9.9252, 78.1198], // Default transit region
            zoom: 12,
            zoomControl: true,
            dragging: true,
            scrollWheelZoom: true,
            doubleClickZoom: true,
            boxZoom: true,
            keyboard: true,
            touchZoom: true
        });

        L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: "abcd",
            maxZoom: 20
        }).addTo(map);

        // Click on map to add stop candidate
        map.on("click", async (event) => {
            if (aiViewingRoute) return;

            const lat = event.latlng.lat;
            const lng = event.latlng.lng;

            try {
                const rev = await reverseGeocode(lat, lng);
                const loc = {
                    name: rev.name || "Pinned Location",
                    address: rev.address || `Coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
                    latitude: lat,
                    longitude: lng,
                    placeId: rev.placeId || "",
                    types: rev.types || ["point_of_interest"]
                };

                setNewStopCandidate(loc);
                setError("");
                showTemporaryMarker(loc);
            } catch {
                const loc = {
                    name: "Pinned Location",
                    address: `Coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
                    latitude: lat,
                    longitude: lng,
                    placeId: "",
                    types: ["point_of_interest"]
                };

                setNewStopCandidate(loc);
                setError("");
                showTemporaryMarker(loc);
            }
        });

        mapRef.current = map;

        loadData();

        // Check if an AI route was passed to view
        let aiRouteToView = location.state?.selectedAiRoute;
        if (!aiRouteToView) {
            try {
                const stored = sessionStorage.getItem("activeAiViewRoute");
                if (stored) {
                    aiRouteToView = JSON.parse(stored);
                }
            } catch {
                // Ignore parsing error
            }
        }

        if (aiRouteToView && Array.isArray(aiRouteToView.stops) && aiRouteToView.stops.length > 0) {
            setAiViewingRoute(aiRouteToView);
            setTimeout(() => {
                redrawAiRoadRoute(aiRouteToView);
            }, 350);
        }

        // Silent background sync without resetting active route builder state
        const handleSync = () => {
            if (document.visibilityState === "visible") {
                loadDataSilently();
            }
        };

        window.addEventListener("focus", handleSync);
        document.addEventListener("visibilitychange", handleSync);

        return () => {
            window.removeEventListener("focus", handleSync);
            document.removeEventListener("visibilitychange", handleSync);
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
            }
        };
    }, []);

    // ==================================================
    // 3. API DATA FETCHERS
    // ==================================================
    const loadData = async () => {
        try {
            setLoading(true);
            const [routeRes, vehicleRes, scheduleRes] = await Promise.all([
                api.get("/routes"),
                api.get("/vehicles"),
                api.get("/schedules").catch(() => ({ data: { schedules: [] } }))
            ]);

            const routeData = Array.isArray(routeRes.data)
                ? routeRes.data
                : routeRes.data?.routes || routeRes.data?.data || [];
            setRoutes(routeData);

            const vehicleData = Array.isArray(vehicleRes.data)
                ? vehicleRes.data
                : vehicleRes.data?.vehicles || vehicleRes.data?.data || [];
            setVehicles(vehicleData);

            setSchedules(scheduleRes.data?.schedules || []);
        } catch (err) {
            console.error("Load Data Error:", err);
            setError("Unable to load routes and vehicle schedules.");
        } finally {
            setLoading(false);
        }
    };

    const loadDataSilently = async () => {
        try {
            const [routeRes, vehicleRes, scheduleRes] = await Promise.all([
                api.get("/routes"),
                api.get("/vehicles"),
                api.get("/schedules").catch(() => ({ data: { schedules: [] } }))
            ]);

            const routeData = Array.isArray(routeRes.data)
                ? routeRes.data
                : routeRes.data?.routes || routeRes.data?.data || [];
            setRoutes(routeData);

            const vehicleData = Array.isArray(vehicleRes.data)
                ? vehicleRes.data
                : vehicleRes.data?.vehicles || vehicleRes.data?.data || [];
            setVehicles(vehicleData);

            setSchedules(scheduleRes.data?.schedules || []);
        } catch {
            // silent background sync
        }
    };

    // ==================================================
    // 4. MAP DRAWING & MARKERS
    // ==================================================
    const showTemporaryMarker = (loc) => {
        if (!mapRef.current || !isValidCoordinate(loc)) return;

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

        const marker = L.marker([Number(loc.latitude), Number(loc.longitude)], { icon: tempIcon })
            .addTo(mapRef.current)
            .bindPopup(
                `<div style="font-family:system-ui; font-size:13px;">
                    <strong style="color:#0f172a; font-size:14px;">📍 ${loc.name || "Selected Location"}</strong>
                    <div style="color:#475569; font-size:12px; margin-top:3px;">${loc.address || ""}</div>
                    <div style="color:#94a3b8; font-size:11px; margin-top:3px;">${Number(loc.latitude).toFixed(5)}, ${Number(loc.longitude).toFixed(5)}</div>
                 </div>`
            )
            .openPopup();

        temporaryMarkerRef.current = marker;
        mapRef.current.setView([Number(loc.latitude), Number(loc.longitude)], 14, { animate: true });
    };

    const drawRouteMarkers = (locations) => {
        if (!mapRef.current) return;

        markersRef.current.forEach((m) => m.remove());
        markersRef.current = [];

        if (!Array.isArray(locations) || locations.length === 0) return;

        locations.forEach((loc, index) => {
            if (!isValidCoordinate(loc)) return;

            const stopNumber = index + 1;
            const customIcon = L.divIcon({
                className: "custom-map-icon",
                html: `<div style="background:#2563eb; color:#fff; border:2px solid #fff; border-radius:50%; width:28px; height:28px; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:800; box-shadow:0 3px 8px rgba(37,99,235,0.4);">${stopNumber}</div>`,
                iconSize: [28, 28],
                iconAnchor: [14, 28]
            });

            const marker = L.marker([Number(loc.latitude), Number(loc.longitude)], { icon: customIcon })
                .addTo(mapRef.current)
                .bindPopup(`<strong>Stop ${stopNumber}: ${loc.name}</strong><br><small>${loc.address || ""}</small>`);
            markersRef.current.push(marker);
        });
    };

    const redrawRoadRoute = useCallback(async (locations) => {
        if (!mapRef.current) return;

        if (lineRef.current) {
            lineRef.current.remove();
            lineRef.current = null;
        }

        const validLocations = (locations || []).filter((loc) => isValidCoordinate(loc));

        drawRouteMarkers(validLocations);

        if (validLocations.length < 2) {
            return;
        }

        try {
            setRoutingLoading(true);
            const route = await getRouteFromOSRM(validLocations);
            let pathCoords = [];

            if (route && Array.isArray(route.geometry?.coordinates)) {
                pathCoords = route.geometry.coordinates.map(([lng, lat]) => [
                    Number(lat),
                    Number(lng)
                ]);
            } else {
                pathCoords = validLocations.map((loc) => [
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

            mapRef.current.fitBounds(lineRef.current.getBounds(), {
                padding: [50, 50]
            });
        } catch (err) {
            console.error("Road Route Error:", err);
            setError("Unable to calculate road route between selected stops.");
        } finally {
            setRoutingLoading(false);
        }
    }, []);

    const redrawAiRoadRoute = async (aiRoute) => {
        if (!mapRef.current || !aiRoute) return;

        if (lineRef.current) {
            lineRef.current.remove();
            lineRef.current = null;
        }

        const isToDestination = aiRoute.tripMode === "TO_DESTINATION" || aiRoute.tripMode === "INWARD";
        const stops = Array.isArray(aiRoute.stops) ? aiRoute.stops : [];

        let locations = [];
        if (!isToDestination) {
            if (aiRoute.sourceHub && isValidCoordinate(aiRoute.sourceHub)) {
                locations.push(aiRoute.sourceHub);
            }
            locations.push(...stops);
        } else {
            locations.push(...stops);
            if (aiRoute.destinationHub && isValidCoordinate(aiRoute.destinationHub)) {
                locations.push(aiRoute.destinationHub);
            }
        }

        if (locations.length < 2) return;

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

            mapRef.current.fitBounds(lineRef.current.getBounds(), {
                padding: [50, 50]
            });
        } catch (err) {
            console.error("AI Road Route Error:", err);
        } finally {
            setRoutingLoading(false);
        }
    };

    // ==================================================
    // 5. UNIFIED SINGLE ROUTE BUILDER ACTIONS
    // ==================================================
    const handleSelectStopCandidate = (loc) => {
        const normalized = normalizeLocation(loc);
        if (!normalized || !isValidCoordinate(normalized)) {
            setError("Selected location does not have valid coordinates.");
            return;
        }
        setNewStopCandidate(normalized);
        setError("");
        showTemporaryMarker(normalized);
    };

    const handleAddStopToRoute = () => {
        if (!newStopCandidate) {
            setError("Search and select a location from the results first.");
            return;
        }

        const normalized = normalizeLocation(newStopCandidate);
        if (!normalized || !isValidCoordinate(normalized)) {
            setError("Selected location does not have valid coordinates.");
            return;
        }

        const newStop = {
            name: normalized.name,
            address: normalized.address || "",
            displayName: normalized.displayName || normalized.address || normalized.name,
            latitude: Number(normalized.latitude),
            longitude: Number(normalized.longitude),
            placeId: normalized.placeId || "",
            types: normalized.types || []
        };

        const updatedStops = [...selectedStops, newStop];
        setSelectedStops(updatedStops);
        setNewStopCandidate(null);
        setError("");

        if (temporaryMarkerRef.current) {
            temporaryMarkerRef.current.remove();
            temporaryMarkerRef.current = null;
        }

        redrawRoadRoute(updatedStops);
    };

    const removeStop = (index) => {
        const updated = selectedStops.filter((_, i) => i !== index);
        setSelectedStops(updated);
        redrawRoadRoute(updated);
    };

    const moveStop = (index, direction) => {
        const updated = [...selectedStops];
        const newIndex = index + direction;

        if (newIndex < 0 || newIndex >= updated.length) return;

        [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
        setSelectedStops(updated);
        redrawRoadRoute(updated);
    };

    // ==================================================
    // 6. SAVE, EDIT, DELETE & RESET ROUTE
    // ==================================================
    const saveRoute = async () => {
        if (!routeName.trim()) {
            setError("Route name or number is required.");
            return;
        }

        if (selectedStops.length < 2) {
            setError("Please add at least two stops.");
            return;
        }

        if (!selectedVehicle) {
            setError("Please select an available scheduled bus for this route.");
            return;
        }

        try {
            setLoading(true);
            setError("");
            setSuccessMessage("");

            // Internally derive source, stops, destination from unified sequence
            const source = selectedStops[0];
            const destination = selectedStops[selectedStops.length - 1];
            const stops = selectedStops.length > 2 ? selectedStops.slice(1, -1) : [];

            const payload = {
                routeName: routeName.trim(),
                source,
                stops,
                destination,
                assignedVehicle: selectedVehicle
            };

            if (editingRoute) {
                await api.put(`/routes/${editingRoute._id}`, payload);
                setSuccessMessage(`Route "${routeName.trim()}" updated successfully!`);
            } else {
                await api.post("/routes", payload);
                setSuccessMessage(`Route "${routeName.trim()}" created successfully!`);
            }

            await loadData();
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
        setSelectedVehicle(route.assignedVehicle?._id || route.assignedVehicle || "");

        // Reconstruct unified sequence: source + stops + destination
        const stopsList = [
            route.source,
            ...(Array.isArray(route.stops) ? route.stops : []),
            route.destination
        ].filter((l) => isValidCoordinate(l));

        setSelectedStops(stopsList);
        setNewStopCandidate(null);
        setError("");
        setSuccessMessage("");

        if (temporaryMarkerRef.current) {
            temporaryMarkerRef.current.remove();
            temporaryMarkerRef.current = null;
        }

        redrawRoadRoute(stopsList);
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
            setSuccessMessage(`Route "${route.routeName}" deleted successfully.`);
        } catch (err) {
            console.error("Delete Route Error:", err);
            setError(err.response?.data?.message || err.message || "Unable to delete route.");
        } finally {
            setLoading(false);
        }
    };

    const clearRoute = () => {
        setEditingRoute(null);
        setRouteName("");
        setSelectedVehicle("");
        setSelectedStops([]);
        setNewStopCandidate(null);
        setError("");

        if (lineRef.current) {
            lineRef.current.remove();
            lineRef.current = null;
        }

        markersRef.current.forEach((m) => m.remove());
        markersRef.current = [];

        if (temporaryMarkerRef.current) {
            temporaryMarkerRef.current.remove();
            temporaryMarkerRef.current = null;
        }
    };

    const newRoute = () => {
        clearRoute();
        setSuccessMessage("");
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

    return (
        <div className={`route-container ${fullscreen ? "route-fullscreen" : ""}`}>
            {!fullscreen && <h2>🛣️ Route Management</h2>}

            {error && <div className="route-error">{error}</div>}
            {successMessage && (
                <div style={{
                    padding: "10px 14px",
                    background: "#ecfdf5",
                    color: "#047857",
                    borderRadius: "10px",
                    border: "1px solid #a7f3d0",
                    marginBottom: "16px",
                    fontWeight: "600",
                    fontSize: "13px"
                }}>
                    ✓ {successMessage}
                </div>
            )}

            <div className="route-layout">
                {/* 100% INTERACTIVE ROAD MAP */}
                <div className="map-section">
                    <button className="fullscreen-button" onClick={toggleFullscreen}>
                        {fullscreen ? "✕ Exit Fullscreen" : "⛶ Fullscreen"}
                    </button>

                    {/* MAP PAN CONTROLS */}
                    <div className="map-pan-controls">
                        <button onClick={() => panMap("up")} title="Move map up">↑</button>
                        <div>
                            <button onClick={() => panMap("left")} title="Move map left">←</button>
                            <button onClick={() => panMap("right")} title="Move map right">→</button>
                        </div>
                        <button onClick={() => panMap("down")} title="Move map down">↓</button>
                    </div>

                    <div ref={mapContainerRef} className="route-map" />
                </div>

                {/* ROUTE CONTROL PANEL */}
                {!fullscreen && (
                    <div className="route-panel">
                        {aiViewingRoute ? (
                            <section className="route-card" style={{ border: "2px solid #3b82f6", background: "#f8fafc" }}>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                                    <span style={{
                                        background: "#eff6ff",
                                        color: "#1d4ed8",
                                        fontSize: "11px",
                                        fontWeight: "800",
                                        padding: "4px 10px",
                                        borderRadius: "20px",
                                        border: "1px solid #bfdbfe",
                                        letterSpacing: "0.5px"
                                    }}>
                                        🤖 AI GENERATED ROUTE
                                    </span>
                                    <span style={{
                                        background: "#ecfdf5",
                                        color: "#047857",
                                        fontSize: "11px",
                                        fontWeight: "700",
                                        padding: "3px 8px",
                                        borderRadius: "12px"
                                    }}>
                                        Inspection Mode
                                    </span>
                                </div>

                                <h3 style={{ margin: "0 0 4px", fontSize: "18px", color: "#0f172a" }}>
                                    {aiViewingRoute.routeCode || "AI Route"}: {aiViewingRoute.sectorName || "Transit"} Corridor
                                </h3>
                                <p style={{ margin: "0 0 14px", fontSize: "12px", color: "#64748b" }}>
                                    {aiViewingRoute.tripMode === "TO_DESTINATION" || aiViewingRoute.tripMode === "INWARD"
                                        ? "Inward Route (Residential Network → Destination)"
                                        : "Outward Route (Source → Residential Network)"}
                                </p>

                                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "14px" }}>
                                    <button
                                        type="button"
                                        style={{
                                            padding: "10px 14px",
                                            background: "#2563eb",
                                            color: "#fff",
                                            border: "none",
                                            borderRadius: "8px",
                                            fontWeight: "700",
                                            cursor: "pointer",
                                            fontSize: "13px"
                                        }}
                                        onClick={() => navigate("/ai-agent")}
                                    >
                                        ← Back to AI Route Optimizer
                                    </button>

                                    <button
                                        type="button"
                                        style={{
                                            padding: "8px 12px",
                                            background: "transparent",
                                            color: "#64748b",
                                            border: "1px solid #cbd5e1",
                                            borderRadius: "8px",
                                            fontWeight: "600",
                                            cursor: "pointer",
                                            fontSize: "12px"
                                        }}
                                        onClick={() => {
                                            setAiViewingRoute(null);
                                            sessionStorage.removeItem("activeAiViewRoute");
                                            clearRoute();
                                        }}
                                    >
                                        ✕ Exit AI View / Manual Routes
                                    </button>
                                </div>
                            </section>
                        ) : (
                            <>
                                {/* 1. ROUTE DETAILS & BUS ALLOCATION */}
                                <section className="route-card">
                                    <div className="route-title-row">
                                        <div>
                                            <h3>🛣️ Manual Route Creation</h3>
                                            <p>Administrator defines route name, vehicle, and ordered route stops.</p>
                                        </div>

                                        <button className="new-route-button" onClick={newRoute}>
                                            + New Route
                                        </button>
                                    </div>

                                    <div style={{ marginBottom: "14px" }}>
                                        <label>Route Name / Number</label>
                                        <input
                                            value={routeName}
                                            onChange={(e) => setRouteName(e.target.value)}
                                            placeholder="Example: Route 1 (or R-01, Madurai Morning Route)"
                                        />
                                    </div>

                                    <div>
                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                                            <label style={{ margin: 0 }}>Allocate Bus / Vehicle</label>
                                            {selectedVehicle && (
                                                <span className="allocation-status">Bus Assigned</span>
                                            )}
                                        </div>
                                        <select
                                            value={selectedVehicle}
                                            onChange={(e) => setSelectedVehicle(e.target.value)}
                                        >
                                            <option value="">-- Select Available Scheduled Bus --</option>
                                            {availableVehicles.map((vehicle) => (
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
                                    </div>
                                </section>

                                {/* 2. SINGLE UNIFIED ROUTE STOP BUILDER */}
                                <section className="route-card">
                                    <div className="section-title">
                                        <h3>📍 Route Stops ({selectedStops.length})</h3>
                                        <span>{selectedStops.length} stops</span>
                                    </div>
                                    <p className="help-text">
                                        Search any global location or click directly on the map to add stops to the route sequence.
                                    </p>

                                    {/* SINGLE UNIFIED SEARCH BOX */}
                                    <div style={{ marginBottom: "12px" }}>
                                        <LocationSearchBox
                                            placeholder="Search any location (e.g. Periyar Bus Stand, SIMMAKKAL, Arappalayam)..."
                                            selectedLocation={newStopCandidate}
                                            onSelectLocation={handleSelectStopCandidate}
                                            onClear={() => {
                                                setNewStopCandidate(null);
                                                if (temporaryMarkerRef.current) {
                                                    temporaryMarkerRef.current.remove();
                                                    temporaryMarkerRef.current = null;
                                                }
                                            }}
                                        />
                                    </div>

                                    {/* CANDIDATE STOP ADD ACTION */}
                                    {newStopCandidate && (
                                        <div className="selected-location" style={{ marginBottom: "14px" }}>
                                            <div>
                                                <strong>{newStopCandidate.name}</strong>
                                                <p style={{ margin: "2px 0 4px 0", fontSize: "12px", color: "#64748b" }}>
                                                    {newStopCandidate.address}
                                                </p>
                                                <small>
                                                    {Number(newStopCandidate.latitude).toFixed(5)}, {Number(newStopCandidate.longitude).toFixed(5)}
                                                </small>
                                            </div>

                                            <div className="location-actions">
                                                <button type="button" onClick={handleAddStopToRoute}>
                                                    + Add Stop
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {routingLoading && (
                                        <div className="routing-status">Calculating road route...</div>
                                    )}

                                    {/* UNIFIED ORDERED SEQUENCE */}
                                    {selectedStops.length === 0 ? (
                                        <div className="empty-stops">
                                            No stops added yet.<br />
                                            Search for a location above or click on the map to begin building the route.
                                        </div>
                                    ) : (
                                        <div className="unified-route-builder">
                                            {selectedStops.map((stop, index) => {
                                                const stopNumber = index + 1;

                                                return (
                                                    <div key={`${stop.name}-${index}`}>
                                                        <div className="unified-route-item is-stop">
                                                            <div className="unified-route-icon stop-icon">
                                                                {stopNumber}
                                                            </div>

                                                            <div className="unified-route-content">
                                                                <strong>📍 {stop.name}</strong>
                                                                {stop.address && stop.address !== stop.name && (
                                                                    <p>{stop.address}</p>
                                                                )}
                                                                <span className="unified-role-tag stop-tag">
                                                                    Stop {stopNumber}
                                                                </span>
                                                            </div>

                                                            <div className="unified-route-actions">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => moveStop(index, -1)}
                                                                    disabled={index === 0}
                                                                    title="Move stop up"
                                                                >
                                                                    ↑
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => moveStop(index, 1)}
                                                                    disabled={index === selectedStops.length - 1}
                                                                    title="Move stop down"
                                                                >
                                                                    ↓
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className="remove-btn"
                                                                    onClick={() => removeStop(index)}
                                                                    title="Remove stop"
                                                                >
                                                                    ✕
                                                                </button>
                                                            </div>
                                                        </div>

                                                        {index < selectedStops.length - 1 && (
                                                            <div className="unified-route-connector">
                                                                ↓
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {selectedStops.length === 1 && (
                                        <p style={{ marginTop: "10px", fontSize: "12px", color: "#f59e0b", fontWeight: "600" }}>
                                            ⚠️ Please add at least two stops to complete the route.
                                        </p>
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

                                    {(editingRoute || selectedStops.length > 0 || routeName) && (
                                        <button className="clear-route-button" onClick={clearRoute}>
                                            {editingRoute ? "Cancel Edit" : "Clear Form"}
                                        </button>
                                    )}
                                </div>

                                {/* 3. SAVED ROUTES LIST */}
                                <section className="route-card">
                                    <div className="section-title">
                                        <h3>Saved Routes ({routes.length})</h3>
                                        <span>{routes.length} total</span>
                                    </div>

                                    {routes.length === 0 ? (
                                        <div className="empty-stops">No saved routes found. Create a route above.</div>
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
                                                const source = route.source;
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
                                                            {source && (
                                                                <span style={{ color: "#4f46e5", fontWeight: "600" }}>
                                                                    {source.name} →{" "}
                                                                </span>
                                                            )}
                                                            {stops.map((stop, sIdx) => (
                                                                <span key={`${stop.name}-${sIdx}`}>
                                                                    {stop.name} →{" "}
                                                                </span>
                                                            ))}
                                                            {dest && (
                                                                <strong style={{ color: "#16a34a" }}>
                                                                    🏁 {dest.name}
                                                                </strong>
                                                            )}
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
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}