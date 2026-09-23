import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import { HiArrowLeft } from "react-icons/hi";
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
import { confirmManualPlan, getActivePlan } from "../services/aiAgentService";
import { extractPolylineLatLngs } from "../utils/routeGeometry";
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
    const [outwardPlan, setOutwardPlan] = useState(null);
    const [inwardPlan, setInwardPlan] = useState(null);

    // Single Unified Route Stop Form State
    const [routeName, setRouteName] = useState("");
    const [routeDirection, setRouteDirection] = useState("OUTWARD");
    const [directionFilter, setDirectionFilter] = useState("OUTWARD");
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

    // Manual Plan Submission State (Submits configured routes to separate Admin Manual Plan page)
    const [planActionLoading, setPlanActionLoading] = useState(false);
    const [activePlanDirection, setActivePlanDirection] = useState("OUTWARD");

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

        const isBoth = String(routeDirection || "").toUpperCase().trim() === "BOTH";

        // Direction-specific assignment check.
        // Rules:
        // - A BOTH route on the existing list occupies BOTH directions.
        // - For BOTH new direction: exclude vehicles already on ANY route (INWARD, OUTWARD, or BOTH).
        // - For INWARD/OUTWARD: exclude vehicles already on a same-direction route OR a BOTH route.
        const getAssignedVehicleIds = (direction) => new Set(
            routes
                .filter((r) => {
                    if (editingRoute && String(r._id) === String(editingRoute._id)) return false;
                    const rDir = String(r.direction || "INWARD").toUpperCase().trim();
                    // A BOTH route in the list occupies every direction
                    if (rDir === "BOTH") return true;
                    return rDir === direction;
                })
                .map((r) => String(r.assignedVehicle?._id || r.assignedVehicle || ""))
                .filter(Boolean)
        );

        const currentDirection = isBoth ? null : ((String(routeDirection || "INWARD").toUpperCase().trim() === "OUTWARD") ? "OUTWARD" : "INWARD");
        const assignedOutward = isBoth ? getAssignedVehicleIds("OUTWARD") : null;
        const assignedInward = isBoth ? getAssignedVehicleIds("INWARD") : null;
        const assignedVehicleIds = isBoth ? null : getAssignedVehicleIds(currentDirection);

        // Filter vehicles: MUST have schedule === "Available" AND NOT allocated to other routes in the relevant direction(s)
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

            // For BOTH: vehicle must not be allocated in either direction
            if (isBoth) {
                if (assignedOutward.has(vId) || assignedInward.has(vId)) {
                    return false;
                }
            } else {
                // Check if allocated to another route in the SAME direction
                if (assignedVehicleIds.has(vId)) {
                    return false;
                }
            }

            // Check if vehicle is scheduled and available in Schedule Management
            const sched = scheduleMap.get(vId);
            if (!sched || sched.availability !== "Available") {
                return false;
            }

            return true;
        });
    }, [routes, vehicles, schedules, editingRoute, routeDirection]);

    const assignedVehicleObj = useMemo(() => {
        return vehicles.find((v) => String(v._id) === String(selectedVehicle)) || null;
    }, [vehicles, selectedVehicle]);

    // If selected vehicle is not available in the active direction (when not editing), clear it
    useEffect(() => {
        if (selectedVehicle && !editingRoute) {
            const isAvailable = availableVehicles.some((v) => String(v._id) === String(selectedVehicle));
            if (!isAvailable) {
                setSelectedVehicle("");
            }
        }
    }, [availableVehicles, selectedVehicle, editingRoute]);

    const outwardRoutes = useMemo(
        () => routes.filter((r) => {
            const d = String(r.direction || "").toUpperCase().trim();
            return d === "OUTWARD" || d === "BOTH";
        }),
        [routes]
    );

    const inwardRoutes = useMemo(
        () => routes.filter((r) => {
            const d = String(r.direction || "").toUpperCase().trim();
            return d === "INWARD" || d === "BOTH";
        }),
        [routes]
    );

    const inwardRoutesCount = inwardRoutes.length;
    const outwardRoutesCount = outwardRoutes.length;

    // Metric stats calculations for both directions
    const outwardAllocatedSeats = useMemo(() => {
        return outwardPlan?.allocatedSeats ?? outwardRoutes.reduce((s, r) => s + Number(r.outwardAllocatedSeats ?? r.allocatedSeats ?? 0), 0);
    }, [outwardPlan, outwardRoutes]);

    const outwardTotalCapacity = useMemo(() => {
        return outwardPlan?.totalCapacity ?? outwardRoutes.reduce((s, r) => s + Number(r.assignedVehicle?.capacity || r.capacity || 0), 0);
    }, [outwardPlan, outwardRoutes]);

    const outwardVehiclesCount = useMemo(() => {
        return outwardRoutes.filter(r => r.assignedVehicle || r.vehicleName).length;
    }, [outwardRoutes]);

    const outwardPlanStatus = useMemo(() => {
        return outwardPlan
            ? (outwardPlan.isApproved ? "Approved & Active" : (outwardPlan.isSubmitted ? "Submitted (Pending)" : "Saved Draft"))
            : (outwardRoutes.length > 0 ? "Routes Configured" : "No Plan Available");
    }, [outwardPlan, outwardRoutes]);

    const inwardAllocatedSeats = useMemo(() => {
        return inwardPlan?.allocatedSeats ?? inwardRoutes.reduce((s, r) => s + Number(r.inwardAllocatedSeats ?? r.allocatedSeats ?? 0), 0);
    }, [inwardPlan, inwardRoutes]);

    const inwardTotalCapacity = useMemo(() => {
        return inwardPlan?.totalCapacity ?? inwardRoutes.reduce((s, r) => s + Number(r.assignedVehicle?.capacity || r.capacity || 0), 0);
    }, [inwardPlan, inwardRoutes]);

    const inwardVehiclesCount = useMemo(() => {
        return inwardRoutes.filter(r => r.assignedVehicle || r.vehicleName).length;
    }, [inwardRoutes]);

    const inwardPlanStatus = useMemo(() => {
        return inwardPlan
            ? (inwardPlan.isApproved ? "Approved & Active" : (inwardPlan.isSubmitted ? "Submitted (Pending)" : "Saved Draft"))
            : (inwardRoutes.length > 0 ? "Routes Configured" : "No Plan Available");
    }, [inwardPlan, inwardRoutes]);

    // Ordered stops helper [1. Source -> 2. Stop -> ... -> Destination]
    const getRouteOrderedStops = (route) => {
        const stopsList = [];
        if (route.source?.name) {
            stopsList.push(route.source.name);
        } else if (typeof route.source === "string" && route.source) {
            stopsList.push(route.source);
        }
        if (Array.isArray(route.stops)) {
            route.stops.forEach((st) => {
                const name = typeof st === "string" ? st : (st.name || st.stopName);
                if (name && !stopsList.includes(name)) {
                    stopsList.push(name);
                }
            });
        }
        if (route.destination?.name && !stopsList.includes(route.destination.name)) {
            stopsList.push(route.destination.name);
        } else if (typeof route.destination === "string" && route.destination && !stopsList.includes(route.destination)) {
            stopsList.push(route.destination);
        }
        if (stopsList.length === 0) {
            return ["Origin Hub", "Corridor Stops", "Destination Hub"];
        }
        return stopsList;
    };

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
            const [routeRes, vehicleRes, scheduleRes, activePlanRes] = await Promise.all([
                api.get("/routes"),
                api.get("/vehicles"),
                api.get("/schedules").catch(() => ({ data: { schedules: [] } })),
                getActivePlan({ forceRefresh: true }).catch(() => null)
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

            if (activePlanRes?.success) {
                setOutwardPlan(activePlanRes.outwardPlan || null);
                setInwardPlan(activePlanRes.inwardPlan || null);
            } else {
                setOutwardPlan(null);
                setInwardPlan(null);
            }
        } catch (err) {
            console.error("Load Data Error:", err);
            setError("Unable to load routes and vehicle schedules.");
        } finally {
            setLoading(false);
        }
    };

    const loadDataSilently = async () => {
        try {
            const [routeRes, vehicleRes, scheduleRes, activePlanRes] = await Promise.all([
                api.get("/routes"),
                api.get("/vehicles"),
                api.get("/schedules").catch(() => ({ data: { schedules: [] } })),
                getActivePlan({ forceRefresh: true }).catch(() => null)
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

            if (activePlanRes?.success) {
                setOutwardPlan(activePlanRes.outwardPlan || null);
                setInwardPlan(activePlanRes.inwardPlan || null);
            }
        } catch {
            // silent background sync
        }
    };

    const handleManualPlanOk = async (targetDir = null) => {
        const dirToSubmit = targetDir || activePlanDirection || "OUTWARD";
        try {
            setPlanActionLoading(true);
            setError("");
            setSuccessMessage("");

            const routesInDir = (routes || []).filter((r) => {
                const d = String(r.direction || "").toUpperCase().trim();
                return d === dirToSubmit || d === "BOTH";
            });
            const assignedInDir = routesInDir.filter((r) => Boolean(r.assignedVehicle || r.vehicleName));

            if (assignedInDir.length === 0) {
                const msg = `No routes with assigned buses found for ${dirToSubmit}. Please allocate an available bus to at least one ${dirToSubmit} route before clicking OK.`;
                setError(msg);
                toast.error(msg);
                return;
            }

            const res = await confirmManualPlan({ direction: dirToSubmit });
            if (res?.success) {
                const msg = res.message || `Admin manual ${dirToSubmit} plan submitted! Opening Final Confirmation...`;
                toast.success(msg);
                try {
                    localStorage.setItem("active_manual_plan_direction", dirToSubmit);
                    localStorage.setItem("active_confirmation_direction", dirToSubmit);
                    localStorage.setItem("active_confirmation_plan_type", "ADMIN");
                } catch (e) {}
                // Open the existing Final Confirmation page with the manual plan data
                navigate(`/admin/plan-confirmation?direction=${dirToSubmit}&type=ADMIN`);
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
                const lastStop = locations[locations.length - 1];
                const isDuplicateLast =
                    lastStop &&
                    Math.abs(Number(lastStop.latitude) - Number(dst.latitude)) < 0.0001 &&
                    Math.abs(Number(lastStop.longitude) - Number(dst.longitude)) < 0.0001;
                if (!isDuplicateLast) {
                    locations.push(dst);
                }
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

        const validLocations = locations.filter((loc) => isValidCoordinate(loc));
        drawRouteMarkers(validLocations);

        if (validLocations.length < 2) return;

        try {
            setRoutingLoading(true);
            let pathCoords = extractPolylineLatLngs(aiRoute);

            if (pathCoords.length < 2) {
                const route = await getRouteFromGoogle(validLocations);
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
            }

            if (pathCoords.length >= 2) {
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
            }
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

        const isBoth = String(routeDirection || "").toUpperCase().trim() === "BOTH";

        try {
            setLoading(true);
            setError("");
            setSuccessMessage("");

            let roadGeometry = [];
            if (lineRef.current && typeof lineRef.current.getLatLngs === "function") {
                const latLngs = lineRef.current.getLatLngs();
                roadGeometry = (Array.isArray(latLngs) ? latLngs.flat(2) : []).map((p) => ({
                    latitude: p.lat,
                    longitude: p.lng
                }));
            }

            if (isBoth && !editingRoute) {
                // BOTH: save ONE route record with direction "BOTH"
                // The backend now accepts this and returns the route in both Outward and Inward tabs.
                const source = selectedStops[0];
                const destination = selectedStops[selectedStops.length - 1];
                const stops = selectedStops.length > 2 ? selectedStops.slice(1, -1) : [];

                const payload = {
                    routeName: routeName.trim(),
                    direction: "BOTH",
                    source,
                    stops,
                    destination,
                    assignedVehicle: selectedVehicle,
                    roadGeometry
                };

                await api.post("/routes", payload);

                const msg = `Route "${routeName.trim()}" saved with BOTH directions (Outward + Inward)!`;
                setSuccessMessage(msg);
                toast.success(msg);
            } else {
                // Single direction (OUTWARD or INWARD), or editing an existing BOTH route
                const effectiveDirection = isBoth ? "BOTH" : routeDirection;
                const source = selectedStops[0];
                const destination = selectedStops[selectedStops.length - 1];
                const stops = selectedStops.length > 2 ? selectedStops.slice(1, -1) : [];

                const payload = {
                    routeName: routeName.trim(),
                    direction: effectiveDirection,
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
            }

            await loadDataSilently();
            clearRoute();

            // After saving:
            // - If route was BOTH: keep the current active filter tab (OUTWARD or INWARD), since BOTH route appears in both lists.
            // - If route was OUTWARD: switch to OUTWARD tab.
            // - If route was INWARD: switch to INWARD tab.
            if (isBoth) {
                setActivePlanDirection(directionFilter === "INWARD" ? "INWARD" : "OUTWARD");
            } else {
                if (routeDirection === "OUTWARD") {
                    setDirectionFilter("OUTWARD");
                    setActivePlanDirection("OUTWARD");
                } else if (routeDirection === "INWARD") {
                    setDirectionFilter("INWARD");
                    setActivePlanDirection("INWARD");
                }
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
        // Preserve the actual stored direction — including "BOTH"
        const dir = String(route.direction || "INWARD").toUpperCase().trim();
        setRouteDirection(dir === "OUTWARD" || dir === "BOTH" ? dir : "INWARD");
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
        const savedPathCoords = extractPolylineLatLngs(route);
        if (savedPathCoords.length > 1 && mapRef.current) {
            drawRouteMarkers(stopsList);
            if (lineRef.current) {
                lineRef.current.remove();
                lineRef.current = null;
            }
            lineRef.current = L.polyline(savedPathCoords, {
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
            await loadDataSilently();
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
            {!fullscreen && (
                <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "16px" }}>
                    <button
                        type="button"
                        className="route-back-btn"
                        onClick={() => navigate(-1)}
                        aria-label="Go back"
                    >
                        <HiArrowLeft size={16} />
                        Back
                    </button>
                    <h2 style={{ margin: 0 }}>🛣️ Route Management</h2>
                </div>
            )}

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

            {/* Main Interactive Route Layout */}
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
                                            <label className={`direction-radio-label ${routeDirection === "BOTH" ? "active-both" : ""}`}>
                                                <input
                                                    type="radio"
                                                    name="routeDirection"
                                                    value="BOTH"
                                                    checked={routeDirection === "BOTH"}
                                                    onChange={() => setRouteDirection("BOTH")}
                                                />
                                                🔄 BOTH (Outward + Inward)
                                            </label>
                                        </div>
                                        {routeDirection === "BOTH" && (
                                            <p style={{ margin: "8px 0 0", fontSize: "12px", color: "#7c3aed", fontWeight: "600", lineHeight: "1.5" }}>
                                                ⚡ BOTH mode: Saves a single route configuration that appears in both <strong>Outward</strong> and <strong>Inward</strong> lists with the same assigned vehicle.
                                            </p>
                                        )}
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

                                {/* 3. SAVED ROUTES & TRANSPORTATION PLANS */}
                                <section className="route-card">
                                    {/* Direction Filter Tabs & Header */}
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", marginBottom: "16px" }}>
                                        <div>
                                            <h3 style={{ margin: 0, fontSize: "17px", color: "#0f172a" }}>Route Management</h3>
                                            <span style={{ fontSize: "12px", color: "#64748b" }}>
                                                {routes.length} total saved routes ({outwardRoutes.length} Outward · {inwardRoutes.length} Inward)
                                            </span>
                                        </div>

                                        <div className="direction-filter-tabs">
                                            <button
                                                type="button"
                                                className={`dir-filter-tab ${directionFilter === "OUTWARD" ? "active outward" : ""}`}
                                                onClick={() => {
                                                    setDirectionFilter("OUTWARD");
                                                    setActivePlanDirection("OUTWARD");
                                                }}
                                            >
                                                🔵 OUTWARD ({loading ? "..." : outwardRoutesCount})
                                            </button>
                                            <button
                                                type="button"
                                                className={`dir-filter-tab ${directionFilter === "INWARD" ? "active inward" : ""}`}
                                                onClick={() => {
                                                    setDirectionFilter("INWARD");
                                                    setActivePlanDirection("INWARD");
                                                }}
                                            >
                                                🟢 INWARD ({loading ? "..." : inwardRoutesCount})
                                            </button>
                                        </div>
                                    </div>

                                    {/* Helper to render a single route card */}
                                    {(() => {
                                        // renderSingleRoute: displayDirection overrides the badge for BOTH routes
                                        // so they show the correct 🔵/🟢 badge depending on which tab they appear in.
                                        const renderSingleRoute = (route, displayDirection) => {
                                            const vehicleName =
                                                route.assignedVehicle?.vehicleName ||
                                                route.vehicleName ||
                                                "";
                                            const capacity = Number(
                                                route.assignedVehicle?.capacity ||
                                                route.capacity ||
                                                route.totalSeats ||
                                                0
                                            );
                                            const allocatedSeats = Number(
                                                (displayDirection === "OUTWARD" ? route.outwardAllocatedSeats : route.inwardAllocatedSeats) ??
                                                route.allocatedSeats ??
                                                0
                                            );
                                            const remainingSeats = Number(
                                                Math.max(0, capacity - allocatedSeats)
                                            );
                                            const hasVehicle = Boolean(vehicleName && capacity > 0);
                                            const isFull = hasVehicle && (remainingSeats === 0 || route.isFull);
                                            const orderedStops = getRouteOrderedStops(route);

                                            // Determine effective direction for badge display:
                                            // When rendered in Outward section -> 🔵 OUTWARD
                                            // When rendered in Inward section -> 🟢 INWARD
                                            const routeDir = String(route.direction || "").toUpperCase().trim();
                                            const effectiveDisplayDir = displayDirection || (routeDir === "BOTH" ? "OUTWARD" : routeDir);
                                            const badgeIsOutward = effectiveDisplayDir === "OUTWARD";
                                            const badgeClass = badgeIsOutward ? "outward" : "inward";
                                            const badgeLabel = badgeIsOutward ? "🔵 OUTWARD" : "🟢 INWARD";

                                            return (
                                                <div className="saved-route" key={`${route._id}-${effectiveDisplayDir}`}>
                                                    <div className="saved-route-header">
                                                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                                            <strong>{route.routeName}</strong>
                                                            <span className={`direction-badge ${badgeClass}`}>
                                                                {badgeLabel}
                                                            </span>
                                                        </div>
                                                        <div className="route-allocation-display">
                                                            {hasVehicle ? (
                                                                <>
                                                                    <div className="route-allocation-main">
                                                                        <span className="route-vehicle-name">🚌 {vehicleName}</span>
                                                                        <span className="route-seat-ratio">
                                                                            <strong>{allocatedSeats} / {capacity}</strong> seats allocated
                                                                        </span>
                                                                    </div>
                                                                    <span className={`route-standby-badge ${isFull ? "full" : "available"}`}>
                                                                        {!isFull
                                                                            ? `+${remainingSeats} standby seats available`
                                                                            : "Bus full (0 seats left)"}
                                                                    </span>
                                                                </>
                                                            ) : (
                                                                <span className="route-no-vehicle-badge">
                                                                    🚌 (No vehicle assigned)
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Ordered Stops: 1. Source -> 2. Stop -> ... -> Destination */}
                                                    <div className="route-preview-ordered">
                                                        <span className="ordered-stops-title">📍 Ordered Stops:</span>
                                                        <div className="ordered-stops-chips">
                                                            {orderedStops.map((stopName, sIdx) => (
                                                                <React.Fragment key={sIdx}>
                                                                    <span className="route-stop-chip">
                                                                        <b>{sIdx + 1}.</b> {stopName}
                                                                    </span>
                                                                    {sIdx < orderedStops.length - 1 && (
                                                                        <span className="stop-chip-arrow">→</span>
                                                                    )}
                                                                </React.Fragment>
                                                            ))}
                                                        </div>
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
                                        };

                                        // Render saved route list based on selected direction tab
                                        if (directionFilter === "OUTWARD") {
                                            return (
                                                <div className="direction-plan-section">
                                                    <div className="direction-plan-section-header outward">
                                                        <div className="plan-section-title-group">
                                                            <h4 className="plan-section-title">🔵 Outward Routes</h4>
                                                            <span className="plan-section-stats">
                                                                ({outwardRoutes.length} routes · {outwardAllocatedSeats} / {outwardTotalCapacity} seats allocated)
                                                            </span>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            className="btn-ok-manual"
                                                            onClick={() => handleManualPlanOk("OUTWARD")}
                                                            disabled={planActionLoading || outwardRoutes.length === 0}
                                                            style={{ padding: "6px 14px", fontSize: "12px", background: "#2563eb" }}
                                                            title="Submit Outward Plan to Final Confirmation"
                                                        >
                                                            {planActionLoading ? "⏳..." : "✓ Submit Outward Plan →"}
                                                        </button>
                                                    </div>

                                                    {outwardRoutes.length === 0 ? (
                                                        <div className="no-plan-card">
                                                            <span className="no-plan-badge">No Plan Available</span>
                                                            <p>No Outward plan or routes available. Configure an Outward route above.</p>
                                                        </div>
                                                    ) : (
                                                        <div className="saved-routes">
                                                            {outwardRoutes.map(r => renderSingleRoute(r, "OUTWARD"))}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        }

                                        // INWARD ONLY
                                        return (
                                            <div className="direction-plan-section">
                                                <div className="direction-plan-section-header inward">
                                                    <div className="plan-section-title-group">
                                                        <h4 className="plan-section-title">🟢 Inward Routes</h4>
                                                        <span className="plan-section-stats">
                                                            ({inwardRoutes.length} routes · {inwardAllocatedSeats} / {inwardTotalCapacity} seats allocated)
                                                        </span>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        className="btn-ok-manual"
                                                        onClick={() => handleManualPlanOk("INWARD")}
                                                        disabled={planActionLoading || inwardRoutes.length === 0}
                                                        style={{ padding: "6px 14px", fontSize: "12px", background: "#059669" }}
                                                        title="Submit Inward Plan to Final Confirmation"
                                                    >
                                                        {planActionLoading ? "⏳..." : "✓ Submit Inward Plan →"}
                                                    </button>
                                                </div>

                                                {inwardRoutes.length === 0 ? (
                                                    <div className="no-plan-card">
                                                        <span className="no-plan-badge">No Plan Available</span>
                                                        <p>No Inward plan or routes available. Configure an Inward route above.</p>
                                                    </div>
                                                ) : (
                                                    <div className="saved-routes">
                                                        {inwardRoutes.map(r => renderSingleRoute(r, "INWARD"))}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })()}
                                </section>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}