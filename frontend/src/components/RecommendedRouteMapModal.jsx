import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { FiX, FiMapPin, FiNavigation, FiClock, FiUsers, FiCheckCircle, FiAlertTriangle } from "react-icons/fi";
import { extractPolylineLatLngs } from "../utils/routeGeometry";

export default function RecommendedRouteMapModal({
    isOpen,
    onClose,
    recommendation,
    direction = "OUTWARD"
}) {
    const mapContainerRef = useRef(null);
    const mapRef = useRef(null);

    useEffect(() => {
        if (!isOpen || !mapContainerRef.current || !recommendation) return;

        // Cleanup any previous map instance on container
        if (mapRef.current) {
            mapRef.current.remove();
            mapRef.current = null;
        }

        const map = L.map(mapContainerRef.current, {
            center: [9.9252, 78.1198], // Default Madurai center
            zoom: 12,
            zoomControl: true,
            scrollWheelZoom: true
        });

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 19
        }).addTo(map);

        const isInward = direction === "INWARD" || recommendation?.tripMode === "TO_DESTINATION" || recommendation?.direction === "INWARD";

        let routePoints = recommendation.recommendedRoute;
        if (!Array.isArray(routePoints) || routePoints.length === 0) {
            const src = recommendation.sourceHub || recommendation.source || recommendation.startLocation || recommendation.inwardStartLocation;
            const stops = Array.isArray(recommendation.stops) ? recommendation.stops : [];
            routePoints = [
                ...(src && typeof src === "object" ? [{ ...src, isHub: true, name: src.name || (isInward ? "Starting Hub" : "Institutional Source") }] : []),
                ...stops
            ];
        }

        if (isInward && Array.isArray(routePoints) && routePoints.length > 1) {
            const first = routePoints[0];
            const second = routePoints[1];
            if (first?.name && second?.name && first.name.trim().toLowerCase() === second.name.trim().toLowerCase()) {
                routePoints = [first, ...routePoints.slice(2)];
            }
        }
        const bounds = L.latLngBounds([]);

        // 1. Add markers for each ordered stop
        routePoints.forEach((point, idx) => {
            const lat = Number(point.latitude);
            const lng = Number(point.longitude);

            if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) {
                bounds.extend([lat, lng]);

                const isHub = Boolean(point.isHub || point.routePointType === "hub" || (!isInward && point.name?.toLowerCase().includes("college")));
                const isNew = Boolean(point.isNewStop);
                const markerLabel = isInward ? String(idx + 1) : (isHub ? "🏛️" : (isNew ? "✨" : String(idx + 1)));

                const markerHtml = `
                    <div style="
                        background: ${isInward ? (idx === 0 ? "#059669" : "#2563eb") : (isHub ? "#059669" : (isNew ? "#7c3aed" : "#2563eb"))};
                        color: #ffffff;
                        font-weight: 800;
                        font-size: 11px;
                        width: 26px;
                        height: 26px;
                        border-radius: 50%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        border: 2px solid #ffffff;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.35);
                    ">
                        ${markerLabel}
                    </div>
                `;

                const customIcon = L.divIcon({
                    className: "rec-map-marker-pin",
                    html: markerHtml,
                    iconSize: [26, 26],
                    iconAnchor: [13, 13]
                });

                const marker = L.marker([lat, lng], { icon: customIcon }).addTo(map);

                const popupHtml = `
                    <div style="min-width: 170px; font-family: sans-serif; font-size: 12px; line-height: 1.4;">
                        <strong style="display: block; font-size: 13px; color: #0f172a; margin-bottom: 2px;">
                            ${point.name}
                        </strong>
                        <div style="color: ${isInward ? (idx === 0 ? "#059669" : "#2563eb") : (isHub ? "#059669" : (isNew ? "#7c3aed" : "#2563eb"))}; font-weight: 700; font-size: 11px; text-transform: uppercase;">
                            ${isInward ? (idx === 0 ? "🚩 Starting Hub (#1)" : `Stop #${idx + 1}`) : (isHub ? "🏛️ Institutional Hub" : (isNew ? "✨ Proposed New Stop" : `Stop #${point.order || idx + 1}`))}
                        </div>
                        ${point.userCount > 0 ? `<div style="color: #1e40af; margin-top: 3px;">👥 <b>${point.userCount}</b> students boarding</div>` : ""}
                        <div style="color: #64748b; font-size: 10px; margin-top: 2px;">GPS: ${lat.toFixed(4)}, ${lng.toFixed(4)}</div>
                    </div>
                `;
                marker.bindPopup(popupHtml);
            }
        });

        // 2. Draw polyline using continuous OSRM road geometry
        const polyCoords = extractPolylineLatLngs(recommendation);
        if (polyCoords.length >= 2) {
            const polyline = L.polyline(polyCoords, {
                color: "#4f46e5",
                weight: 5,
                opacity: 0.85,
                lineJoin: "round",
                lineCap: "round"
            }).addTo(map);

            polyCoords.forEach((c) => bounds.extend(c));
        } else if (routePoints.length >= 2) {
            // Fallback connecting stops
            const fallbackPts = routePoints
                .filter((p) => Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude)))
                .map((p) => [Number(p.latitude), Number(p.longitude)]);

            if (fallbackPts.length >= 2) {
                L.polyline(fallbackPts, {
                    color: "#6366f1",
                    weight: 4,
                    dashArray: "6, 6",
                    opacity: 0.75
                }).addTo(map);
            }
        }

        if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [40, 40] });
        }

        mapRef.current = map;

        return () => {
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
            }
        };
    }, [isOpen, recommendation]);

    if (!isOpen || !recommendation) return null;

    const roadVal = recommendation.roadValidation || {};
    const capAnalysis = recommendation.capacityAnalysis || {};
    const isInwardModal = direction === "INWARD" || recommendation?.tripMode === "TO_DESTINATION" || recommendation?.direction === "INWARD";
    let stops = recommendation.recommendedRoute;
    if (!Array.isArray(stops) || stops.length === 0) {
        const src = recommendation.sourceHub || recommendation.source || recommendation.startLocation || recommendation.inwardStartLocation;
        const recStops = Array.isArray(recommendation.stops) ? recommendation.stops : [];
        stops = [
            ...(src && typeof src === "object" ? [{ ...src, isHub: true, name: src.name || (isInwardModal ? "Starting Hub" : "Institutional Source") }] : []),
            ...recStops
        ];
    }
    if (isInwardModal && Array.isArray(stops) && stops.length > 1) {
        const first = stops[0];
        const second = stops[1];
        if (first?.name && second?.name && first.name.trim().toLowerCase() === second.name.trim().toLowerCase()) {
            stops = [first, ...stops.slice(2)];
        }
    }
    stops = stops || [];

    return (
        <div className="ai-modal-overlay" onClick={onClose} style={{ zIndex: 9999 }}>
            <div
                className="ai-modal-card"
                style={{
                    maxWidth: "880px",
                    width: "95%",
                    maxHeight: "92vh",
                    display: "flex",
                    flexDirection: "column",
                    padding: 0,
                    borderRadius: "16px",
                    overflow: "hidden"
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Modal Header */}
                <div style={{
                    padding: "16px 20px",
                    background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
                    color: "#ffffff",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center"
                }}>
                    <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                            <span style={{
                                padding: "2px 8px",
                                borderRadius: "6px",
                                fontSize: "11px",
                                fontWeight: "800",
                                background: direction === "OUTWARD" ? "#2563eb" : "#059669",
                                color: "#ffffff",
                                textTransform: "uppercase"
                            }}>
                                {direction}
                            </span>
                            <span style={{
                                padding: "2px 8px",
                                borderRadius: "6px",
                                fontSize: "11px",
                                fontWeight: "800",
                                background: recommendation.priority === "HIGH" ? "#ef4444" : "#f59e0b",
                                color: "#ffffff"
                            }}>
                                {recommendation.priority} PRIORITY
                            </span>
                            <span style={{
                                padding: "2px 8px",
                                borderRadius: "6px",
                                fontSize: "11px",
                                fontWeight: "800",
                                background: "#4338ca",
                                color: "#ffffff"
                            }}>
                                🛡️ {recommendation.recommendationLabel || "Complete Route Recommendation"}
                            </span>
                            <span style={{
                                fontSize: "12px",
                                color: roadVal.isRoadVerified ? "#86efac" : "#fde047",
                                fontWeight: "700"
                            }}>
                                {roadVal.isRoadVerified ? "✓ OSRM Road Verified" : (roadVal.roadRouteStatus || "Road validation unavailable — fallback estimate used")}
                            </span>
                        </div>
                        <h3 style={{ margin: "6px 0 0", fontSize: "17px", fontWeight: "800", color: "#ffffff" }}>
                            🗺️ {recommendation.title}
                        </h3>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        style={{
                            background: "rgba(255, 255, 255, 0.1)",
                            border: "none",
                            color: "#ffffff",
                            width: "32px",
                            height: "32px",
                            borderRadius: "50%",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "16px"
                        }}
                        title="Close map preview"
                    >
                        <FiX />
                    </button>
                </div>

                {/* Metrics Bar */}
                <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                    gap: "8px",
                    padding: "10px 20px",
                    background: "#f8fafc",
                    borderBottom: "1px solid #e2e8f0",
                    fontSize: "12px"
                }}>
                    <div>
                        <span style={{ color: "#64748b", fontWeight: "600" }}>🚌 Assigned Bus:</span>
                        <div style={{ fontWeight: "800", color: "#0f172a" }}>{bus.suggestedVehicleName || bus.currentVehicleName || "Bus"} ({bus.capacity} seats)</div>
                    </div>
                    <div>
                        <span style={{ color: "#64748b", fontWeight: "600" }}>👥 Expected Demand:</span>
                        <div style={{ fontWeight: "800", color: "#16a34a" }}>{capAnalysis.totalExpectedDemand ?? recommendation.affectedStudents ?? 0} passengers</div>
                    </div>
                    <div>
                        <span style={{ color: "#64748b", fontWeight: "600" }}>🪑 Remaining Seats:</span>
                        <div style={{ fontWeight: "800", color: (capAnalysis.remainingSeats > 0 ? "#2563eb" : "#dc2626") }}>{capAnalysis.remainingSeats ?? 0} seats free</div>
                    </div>
                    <div>
                        <span style={{ color: "#64748b", fontWeight: "600" }}>🛣️ Road Distance:</span>
                        <div style={{ fontWeight: "800", color: "#0f172a" }}>{roadVal.distanceKm || "~"} km</div>
                    </div>
                    <div>
                        <span style={{ color: "#64748b", fontWeight: "600" }}>⏱️ Est. Travel Time:</span>
                        <div style={{ fontWeight: "800", color: "#0f172a" }}>~{roadVal.durationMin || "~"} min</div>
                    </div>
                </div>

                {/* Interactive Leaflet Map Container */}
                <div
                    ref={mapContainerRef}
                    style={{
                        width: "100%",
                        height: "440px",
                        background: "#e2e8f0"
                    }}
                />

                {/* Ordered Route Stop Sequence */}
                <div style={{
                    padding: "12px 20px",
                    background: "#ffffff",
                    borderTop: "1px solid #e2e8f0",
                    maxHeight: "150px",
                    overflowY: "auto"
                }}>
                    <span style={{ fontSize: "11px", fontWeight: "800", color: "#64748b", textTransform: "uppercase", display: "block", marginBottom: "6px" }}>
                        Complete Continuous Route Sequence ({stops.length} Stops):
                    </span>
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
                        {stops.map((stop, sIdx) => {
                            const isHub = Boolean(stop.isHub || stop.routePointType === "hub" || (!isInwardModal && stop.name?.toLowerCase().includes("college")));
                            const isNew = Boolean(stop.isNewStop);
                            const stopBadge = isInwardModal ? `#${sIdx + 1}` : (isHub ? "🏛️" : (isNew ? "✨" : `#${sIdx + 1}`));
                            return (
                                <React.Fragment key={`${stop.name}-${sIdx}`}>
                                    <span style={{
                                        padding: "4px 10px",
                                        borderRadius: "6px",
                                        fontSize: "12px",
                                        fontWeight: "700",
                                        background: isInwardModal ? (sIdx === 0 ? "#ecfdf5" : "#f1f5f9") : (isHub ? "#ecfdf5" : (isNew ? "#f3e8ff" : "#f1f5f9")),
                                        color: isInwardModal ? (sIdx === 0 ? "#047857" : "#334155") : (isHub ? "#047857" : (isNew ? "#7e22ce" : "#334155")),
                                        border: `1px solid ${isInwardModal ? (sIdx === 0 ? "#a7f3d0" : "#cbd5e1") : (isHub ? "#a7f3d0" : (isNew ? "#d8b4fe" : "#cbd5e1"))}`,
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: "4px"
                                    }}>
                                        {stopBadge} {stop.name}
                                        {stop.userCount > 0 && <span style={{ color: "#2563eb", fontWeight: "800" }}>({stop.userCount})</span>}
                                    </span>
                                    {sIdx < stops.length - 1 && (
                                        <span style={{ color: "#94a3b8", fontWeight: "800", fontSize: "13px" }}>→</span>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </div>
                </div>

                {/* Footer Modal Action */}
                <div style={{
                    padding: "12px 20px",
                    background: "#f8fafc",
                    borderTop: "1px solid #e2e8f0",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center"
                }}>
                    <span style={{ fontSize: "12px", color: "#64748b" }}>
                        🛡️ <strong>Review-Only:</strong> Visual inspection of road sequence. No saved routes are modified.
                    </span>
                    <button
                        type="button"
                        onClick={onClose}
                        style={{
                            padding: "8px 18px",
                            background: "#2563eb",
                            color: "#ffffff",
                            border: "none",
                            borderRadius: "8px",
                            fontWeight: "700",
                            fontSize: "13px",
                            cursor: "pointer"
                        }}
                    >
                        Done Reviewing
                    </button>
                </div>
            </div>
        </div>
    );
}
