import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import api from "../services/api";
import {
    normalizeLocation,
    reverseGeocode,
    isValidCoordinate,
    getRouteFromGoogle
} from "../services/googleMapsService";
import {
    DEFAULT_LAT,
    DEFAULT_LNG,
    DEFAULT_LONG,
    DEFAULT_LOCATION
} from "../constants/locationConstants";
import LocationSearchBox from "../components/LocationSearchBox";
import {
    getManualPlan,
    confirmManualPlan
} from "../services/aiAgentService";
import "../css/RouteManagement.css";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

delete L.Icon.Default.prototype._getIconUrl;

L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png"
});

// Route calculation is now handled by Google Maps Directions API (via googleMapsService.js)

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
    const [routeDirection, setRouteDirection] = useState("INWARD");
    const [directionFilter, setDirectionFilter] = useState("ALL");
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

    // Admin Manual Transportation Plan State
    const [manualPlan, setManualPlan] = useState(null);
    const [manualPlanLoading, setManualPlanLoading] = useState(false);
    const [planActionLoading, setPlanActionLoading] = useState(false);
    const [activePlanDirection, setActivePlanDirection] = useState("INWARD");

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

    const inwardRoutesCount = useMemo(
        () => routes.filter((r) => (r.direction || "INWARD") === "INWARD").length,
        [routes]
    );
    const outwardRoutesCount = useMemo(
        () => routes.filter((r) => r.direction === "OUTWARD").length,
        [routes]
    );

    const filteredRoutes = useMemo(() => {
        if (directionFilter === "INWARD") {
            return routes.filter((r) => (r.direction || "INWARD") === "INWARD");
        }
        if (directionFilter === "OUTWARD") {
            return routes.filter((r) => r.direction === "OUTWARD");
        }
        return routes;
    }, [routes, directionFilter]);

    const handleSelectStopCandidateRef = useRef(null);

    // ==================================================
    // 2. LEAFLET INTERACTIVE MAP INITIALIZATION
    // ==================================================
    useEffect(() => {
        if (!mapContainerRef.current || mapRef.current) return;

        const map = L.map(mapContainerRef.current, {
            center: [DEFAULT_LAT, DEFAULT_LNG],
            zoom: 12,
            zoomControl: true,
            scrollWheelZoom: true,
            doubleClickZoom: true,
            boxZoom: true,
            keyboard: true,
            touchZoom: true
        });

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 19
        }).addTo(map);


        // Click on map to add stop directly to route stops
        map.on("click", async (event) => {
            if (aiViewingRoute) return;

            const lat = event.latlng.lat;
            const lng = event.latlng.lng;

            try {
                const rev = await reverseGeocode(lat, lng);
                const loc = {
                    name: rev.name || "Pinned Location",
                    address: rev.address || `Coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
                    displayName: rev.displayName || rev.address || rev.name || "Pinned Location",
                    latitude: lat,
                    longitude: lng,
                    placeId: rev.placeId || "",
                    types: rev.types || ["point_of_interest"]
                };

                if (handleSelectStopCandidateRef.current) {
                    handleSelectStopCandidateRef.current(loc);
                }
            } catch {
                const loc = {
                    name: "Pinned Location",
                    address: `Coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
                    displayName: `Coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
                    latitude: lat,
                    longitude: lng,
                    placeId: "",
                    types: ["point_of_interest"]
                };

                if (handleSelectStopCandidateRef.current) {
                    handleSelectStopCandidateRef.current(loc);
                }
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
    // 3. API DATA FETCHERS (Staged loading: routes first)
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

    const fetchManualPlan = useCallback(async (direction = null) => {
        try {
            setManualPlanLoading(true);
            const dir = direction || activePlanDirection || "INWARD";
            const res = await getManualPlan({ direction: dir });
            if (res?.success) {
                setManualPlan(res.plan);
            }
        } catch (err) {
            console.error("Error loading manual plan:", err);
        } finally {
            setManualPlanLoading(false);
        }
    }, [activePlanDirection]);

    useEffect(() => {
        let cancelled = false;

        const runFetch = async () => {
            try {
                setManualPlanLoading(true);
                const dir = activePlanDirection || "INWARD";
                const res = await getManualPlan({ direction: dir });
                if (!cancelled && res?.success) {
                    setManualPlan(res.plan);
                }
            } catch (err) {
                if (!cancelled) {
                    console.error("Error loading manual plan:", err);
                }
            } finally {
                if (!cancelled) {
                    setManualPlanLoading(false);
                }
            }
        };

        runFetch();

        return () => {
            cancelled = true;
        };
    }, [activePlanDirection]);

    const handleManualPlanOk = async () => {
        try {
            setPlanActionLoading(true);
            setError("");
            setSuccessMessage("");

            const routesInDir = (routes || []).filter((r) => {
                const d = (String(r.direction || "").toUpperCase().trim() === "OUTWARD") ? "OUTWARD" : "INWARD";
                return d === activePlanDirection;
            });
            const assignedInDir = routesInDir.filter((r) => Boolean(r.assignedVehicle || r.vehicleName));

            if (assignedInDir.length === 0 && (!manualPlan?.buses || manualPlan.buses.length === 0)) {
                const msg = `No routes with assigned buses found for ${activePlanDirection}. Please allocate an available bus to at least one ${activePlanDirection} route before clicking OK.`;
                setError(msg);
                toast.error(msg);
                return;
            }

            const res = await confirmManualPlan({ direction: activePlanDirection });
            if (res?.success) {
                const msg = res.message || `Admin manual ${activePlanDirection} plan confirmed and submitted! Open AI Route Management to review and approve.`;
                setSuccessMessage(msg);
                toast.success(msg);
                await Promise.all([loadDataSilently(), fetchManualPlan(activePlanDirection)]);
            }
        } catch (err) {
            console.error("Confirm manual plan error:", err);
            const msg = err.response?.data?.message || err.message || "Please ensure at least one route has an assigned bus before clicking OK.";
            setError(msg);
            toast.error(msg);
        } finally {
            setPlanActionLoading(false);
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
            const route = await getRouteFromGoogle(validLocations);
            let pathCoords = [];

            if (route && Array.isArray(route.geometry?.coordinates)) {
                // coordinates are [lng, lat] — convert to Leaflet [lat, lng]
                pathCoords = route.geometry.coordinates.map(([lng, lat]) => [
                    Number(lat),
                    Number(lng)
                ]);
            } else {
                // Fallback: straight lines between stops
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

        const isToDestination =
            aiRoute.direction === "INWARD" ||
            aiRoute.tripMode === "TO_DESTINATION" ||
            aiRoute.tripMode === "INWARD";
        const stops = Array.isArray(aiRoute.stops) ? aiRoute.stops : [];

        let locations = [];
        if (!isToDestination) {
            const src = aiRoute.source || aiRoute.sourceHub;
            if (src && isValidCoordinate(src)) {
                locations.push(src);
            }
            locations.push(...stops);
            const dst = aiRoute.destination || aiRoute.destinationHub;
            if (dst && isValidCoordinate(dst)) {
                locations.push(dst);
            }
        } else {
            const inStart =
                aiRoute.source ||
                aiRoute.startLocation ||
                aiRoute.inwardStartLocation;
            if (inStart && isValidCoordinate(inStart)) {
                locations.push(inStart);
            }
            locations.push(...stops);
            const dst = aiRoute.destination || aiRoute.destinationHub;
            if (dst && isValidCoordinate(dst)) {
                locations.push(dst);
            }
        }

        if (locations.length < 2) return;

        try {
            setRoutingLoading(true);
            let pathCoords = [];

            // 1. Fast path: use pre-calculated road geometry if available on this direction's route
            const activeGeometry = aiRoute.roadGeometry;

            if (Array.isArray(activeGeometry) && activeGeometry.length > 1) {
                pathCoords = activeGeometry.map((p) => [Number(p.latitude), Number(p.longitude)]);
            } else {
                const route = await getRouteFromGoogle(locations);
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
            }

            lineRef.current = L.polyline(pathCoords, {
                color: isToDestination ? "#059669" : "#2563eb",
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

        const newStop = {
            name: normalized.name,
            address: normalized.address || "",
            displayName: normalized.displayName || normalized.address || normalized.name,
            latitude: Number(normalized.latitude),
            longitude: Number(normalized.longitude),
            city: normalized.city || "",
            district: normalized.district || "",
            state: normalized.state || "",
            country: normalized.country || "",
            placeId: normalized.placeId || "",
            types: normalized.types || []
        };

        setSelectedStops((prev) => {
            const updatedStops = [...prev, newStop];
            setSuccessMessage(`Added stop: ${newStop.name} (Stop ${updatedStops.length})`);
            setTimeout(() => {
                redrawRoadRoute(updatedStops);
            }, 50);
            return updatedStops;
        });
        setNewStopCandidate(null);
        setError("");

        if (temporaryMarkerRef.current) {
            temporaryMarkerRef.current.remove();
            temporaryMarkerRef.current = null;
        }
    };

    handleSelectStopCandidateRef.current = handleSelectStopCandidate;

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
            city: normalized.city || "",
            district: normalized.district || "",
            state: normalized.state || "",
            country: normalized.country || "",
            placeId: normalized.placeId || "",
            types: normalized.types || []
        };

        const updatedStops = [...selectedStops, newStop];
        setSelectedStops(updatedStops);
        setNewStopCandidate(null);
        setError("");
        setSuccessMessage(`Added stop: ${newStop.name} (Stop ${updatedStops.length})`);

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

            let roadGeometry = [];
            if (lineRef.current && typeof lineRef.current.getLatLngs === "function") {
                const latLngs = lineRef.current.getLatLngs();
                roadGeometry = (Array.isArray(latLngs) ? latLngs.flat(2) : []).map((p) => ({
                    latitude: p.lat,
                    longitude: p.lng
                }));
            }

            const payload = {
                routeName: routeName.trim(),
                direction: routeDirection,
                source,
                stops,
                destination,
                assignedVehicle: selectedVehicle,
                roadGeometry
            };

            if (editingRoute) {
                await api.put(`/routes/${editingRoute._id}`, payload);
                const msg = `Route "${routeName.trim()}" updated successfully!`;
                setSuccessMessage(msg);
                toast.success(msg);
            } else {
                await api.post("/routes", payload);
                const msg = `Route "${routeName.trim()}" created successfully!`;
                setSuccessMessage(msg);
                toast.success(msg);
            }

            const routeRes = await api.get("/routes");
            const routeData = Array.isArray(routeRes.data)
                ? routeRes.data
                : routeRes.data?.routes || routeRes.data?.data || [];
            setRoutes(routeData);
            clearRoute();

            if (routeDirection && routeDirection !== activePlanDirection) {
                setActivePlanDirection(routeDirection);
                fetchManualPlan(routeDirection);
            } else {
                fetchManualPlan(activePlanDirection);
            }
        } catch (err) {
            console.error("Save Route Error:", err);
            const msg = err.response?.data?.message || err.message || "Unable to save route.";
            setError(msg);
            toast.error(msg);
        } finally {
            setLoading(false);
        }
    };

    const editRoute = (route) => {
        setEditingRoute(route);
        setRouteName(route.routeName || "");
        setRouteDirection(route.direction === "OUTWARD" ? "OUTWARD" : "INWARD");
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

        // Fast path: if route has pre-saved road geometry, display directly without OSRM/Google network call
        if (Array.isArray(route.roadGeometry) && route.roadGeometry.length > 1 && mapRef.current) {
            drawRouteMarkers(stopsList);
            if (lineRef.current) {
                lineRef.current.remove();
                lineRef.current = null;
            }
            const pathCoords = route.roadGeometry.map((p) => [Number(p.latitude), Number(p.longitude)]);
            lineRef.current = L.polyline(pathCoords, {
                color: "#2563eb",
                weight: 6,
                opacity: 0.9,
                lineJoin: "round",
                lineCap: "round"
            }).addTo(mapRef.current);
            mapRef.current.fitBounds(lineRef.current.getBounds(), { padding: [50, 50] });
        } else {
            redrawRoadRoute(stopsList);
        }
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
            fetchManualPlan(activePlanDirection);
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
        setRouteDirection("INWARD");
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

            {/* MANUAL TRANSPORTATION PLAN CONTROL & APPROVAL BAR */}
            {!fullscreen && (
                <section className="manual-plan-control-card">
                    <div className="manual-plan-control-header">
                        <div className="plan-title-col">
                            <div className="plan-title-row">
                                <span className="plan-type-chip">👨‍💼 ADMIN MANUAL PLAN</span>
                                <span className={`plan-approval-badge ${manualPlan?.isApproved ? "badge-approved" : (manualPlan?.isSubmitted ? "badge-ready" : ((manualPlan?.totalRoutes || 0) > 0 ? "badge-saved" : "badge-pending"))}`}>
                                    {manualPlan?.isApproved
                                        ? "✓ Approved & Active in MongoDB"
                                        : (manualPlan?.isSubmitted
                                            ? "✓ Confirmed & Submitted to AI Agent"
                                            : ((manualPlan?.totalRoutes || 0) > 0
                                                ? "✓ Saved / Click OK to Submit"
                                                : "⏳ Draft / No Routes Configured"))}
                                </span>
                            </div>
                            <p className="plan-title-sub">
                                Live capacity validation &amp; passenger seat allocation. Bus details are visible to students only after approval.
                            </p>
                        </div>

                        <div className="plan-direction-toggle-group">
                            <span className="toggle-label">Inspect Direction:</span>
                            <div className="plan-direction-pills">
                                <button
                                    type="button"
                                    className={`dir-pill-btn ${activePlanDirection === "INWARD" ? "active inward" : ""}`}
                                    onClick={() => setActivePlanDirection("INWARD")}
                                >
                                    🟢 Inward (To College)
                                </button>
                                <button
                                    type="button"
                                    className={`dir-pill-btn ${activePlanDirection === "OUTWARD" ? "active outward" : ""}`}
                                    onClick={() => setActivePlanDirection("OUTWARD")}
                                >
                                    🔵 Outward (From College)
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Capacity & Demand Metrics */}
                    <div className="plan-metrics-row">
                        <div className="plan-metric-item">
                            <span className="metric-label">Confirmed Coming Students</span>
                            {manualPlanLoading ? (
                                <span className="metric-loading-inline">Loading...</span>
                            ) : (
                                <strong className="metric-num">{manualPlan?.totalComingUsers ?? 0}</strong>
                            )}
                            <span className="metric-sub">Daily Travel Confirmed</span>
                        </div>
                        <div className="plan-metric-item">
                            <span className="metric-label">Fleet Bus Capacity</span>
                            {manualPlanLoading ? (
                                <span className="metric-loading-inline">Loading...</span>
                            ) : (
                                <strong className="metric-num">{manualPlan?.totalCapacity ?? 0}</strong>
                            )}
                            <span className="metric-sub">{manualPlan?.totalRoutes ?? 0} Routes Scheduled</span>
                        </div>
                        <div className="plan-metric-item">
                            <span className="metric-label">Allocated Seats</span>
                            {manualPlanLoading ? (
                                <span className="metric-loading-inline">Loading...</span>
                            ) : (
                                <strong className="metric-num text-success">{manualPlan?.assignedUsers ?? 0}</strong>
                            )}
                            <span className="metric-sub">
                                {manualPlan?.totalCapacity > 0
                                    ? `${Math.round(((manualPlan?.assignedUsers || 0) / manualPlan.totalCapacity) * 100)}% Fleet Load`
                                    : "No capacity"}
                            </span>
                        </div>
                        <div className="plan-metric-item">
                            <span className="metric-label">Standby / Unallocated</span>
                            {manualPlanLoading ? (
                                <span className="metric-loading-inline">Loading...</span>
                            ) : (
                                <strong className={`metric-num ${manualPlan?.unassignedUsers > 0 ? "text-danger" : ""}`}>
                                    {manualPlan?.unassignedUsers ?? 0}
                                </strong>
                            )}
                            <span className="metric-sub">
                                {manualPlan?.unassignedUsers > 0 ? "⚠️ Capacity Exceeded" : "✓ All Accommodated"}
                            </span>
                        </div>
                    </div>

                    {/* Warnings Banner */}
                    {manualPlan?.warnings && manualPlan.warnings.length > 0 && (
                        <div className="plan-warnings-banner">
                            <div className="warning-heading">
                                <span>⚠️</span>
                                <strong>Fleet Capacity &amp; Route Configuration Warnings:</strong>
                            </div>
                            <ul className="warning-list">
                                {manualPlan.warnings.map((warn, i) => (
                                    <li key={i}>{warn}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Action Row */}
                    <div className="manual-plan-actions-row">
                        <div className="status-hint">
                            {manualPlan?.isApproved ? (
                                <span>
                                    🟢 <strong>Plan Active in MongoDB:</strong> All confirmed students are currently seeing their allocated <strong>{activePlanDirection}</strong> buses, stops, and seat numbers.
                                </span>
                            ) : manualPlan?.isSubmitted ? (
                                <span>
                                    ✓ <strong>Plan Confirmed &amp; Submitted:</strong> Assigned routes are ready in <strong>AI Route Management</strong> for admin review and final approval.
                                </span>
                            ) : (
                                <span>
                                    📋 <strong>Saved Routes:</strong> Click <strong>"✓ OK"</strong> to confirm and submit these {activePlanDirection} routes to <strong>AI Route Management</strong> for approval.
                                </span>
                            )}
                        </div>

                        <div className="plan-btn-group" style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                            <button
                                type="button"
                                className="btn-ok-manual"
                                onClick={handleManualPlanOk}
                                disabled={planActionLoading}
                                title={((manualPlan?.totalRoutes || 0) > 0) ? `Confirm & submit ${activePlanDirection} plan to AI Route Management` : `Assign a bus to at least one ${activePlanDirection} route first`}
                                style={{
                                    cursor: planActionLoading ? "wait" : "pointer"
                                }}
                            >
                                {planActionLoading ? "⏳ Submitting..." : "✓ OK"}
                            </button>
                        </div>
                    </div>
                </section>
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
                                            placeholder="Example: Route 1 (or R-01, Madurai Inward Route)"
                                        />
                                    </div>

                                    <div style={{ marginBottom: "14px" }}>
                                        <label>Route Direction</label>
                                        <div className="direction-selector-group">
                                            <label className={`direction-radio-label ${routeDirection === "INWARD" ? "active-inward" : ""}`}>
                                                <input
                                                    type="radio"
                                                    name="routeDirection"
                                                    value="INWARD"
                                                    checked={routeDirection === "INWARD"}
                                                    onChange={() => setRouteDirection("INWARD")}
                                                />
                                                🟢 INWARD (Residential → College)
                                            </label>
                                            <label className={`direction-radio-label ${routeDirection === "OUTWARD" ? "active-outward" : ""}`}>
                                                <input
                                                    type="radio"
                                                    name="routeDirection"
                                                    value="OUTWARD"
                                                    checked={routeDirection === "OUTWARD"}
                                                    onChange={() => setRouteDirection("OUTWARD")}
                                                />
                                                🔵 OUTWARD (College → Residential)
                                            </label>
                                        </div>
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

                                    <button
                                        type="button"
                                        className="clear-route-button"
                                        onClick={clearRoute}
                                        title="Reset route creation form"
                                    >
                                        {editingRoute ? "Cancel Edit" : "🔄 Reset"}
                                    </button>
                                </div>

                                {/* 3. SAVED ROUTES LIST */}
                                <section className="route-card">
                                    <div className="section-title">
                                        <h3>Saved Routes ({loading ? "..." : filteredRoutes.length})</h3>
                                        <span>{loading ? "..." : routes.length} total</span>
                                    </div>

                                    {/* Direction Filter Tabs */}
                                    <div className="direction-filter-tabs">
                                        <button
                                            type="button"
                                            className={`dir-filter-tab ${directionFilter === "ALL" ? "active" : ""}`}
                                            onClick={() => setDirectionFilter("ALL")}
                                        >
                                            All ({loading ? "..." : routes.length})
                                        </button>
                                        <button
                                            type="button"
                                            className={`dir-filter-tab ${directionFilter === "INWARD" ? "active inward" : ""}`}
                                            onClick={() => setDirectionFilter("INWARD")}
                                        >
                                            🟢 Inward ({loading ? "..." : inwardRoutesCount})
                                        </button>
                                        <button
                                            type="button"
                                            className={`dir-filter-tab ${directionFilter === "OUTWARD" ? "active outward" : ""}`}
                                            onClick={() => setDirectionFilter("OUTWARD")}
                                        >
                                            🔵 Outward ({loading ? "..." : outwardRoutesCount})
                                        </button>
                                    </div>

                                    {filteredRoutes.length === 0 ? (
                                        <div className="empty-stops">
                                            {loading
                                                ? "Loading saved routes..."
                                                : routes.length === 0
                                                ? "No saved routes found. Create a route above."
                                                : `No ${directionFilter.toLowerCase()} routes found.`}
                                        </div>
                                    ) : (
                                        <div className="saved-routes">
                                            {filteredRoutes.map((route) => {
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

                                                const matchingBus = (manualPlan?.buses || manualPlan?.routes || []).find(
                                                    (b) => String(b.routeId) === String(route._id) || b.routeName === route.routeName
                                                );
                                                const allocatedCount = matchingBus?.assignedUsers ?? 0;
                                                const remainingCount = matchingBus?.remainingSeats ?? Math.max(0, capacity - allocatedCount);

                                                return (
                                                    <div className="saved-route" key={route._id}>
                                                        <div className="saved-route-header">
                                                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                                                <strong>{route.routeName}</strong>
                                                                <span className={`direction-badge ${route.direction === "OUTWARD" ? "outward" : "inward"}`}>
                                                                    {route.direction === "OUTWARD" ? "🔵 OUTWARD" : "🟢 INWARD"}
                                                                </span>
                                                            </div>
                                                            <span style={{ fontSize: "13px", fontWeight: "600" }}>
                                                                🚌 {vehicleName} {capacity > 0 ? (
                                                                    matchingBus ? (
                                                                        <span style={{ marginLeft: "4px", color: remainingCount > 0 ? "#15803d" : "#dc2626" }}>
                                                                            • <strong>{allocatedCount} / {capacity}</strong> seats ({remainingCount} left)
                                                                        </span>
                                                                    ) : (
                                                                        `(${capacity} seats)`
                                                                    )
                                                                ) : "(No vehicle)"}
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