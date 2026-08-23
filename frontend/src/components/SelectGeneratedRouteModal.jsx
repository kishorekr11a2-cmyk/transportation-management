import React, { useState } from "react";
import { FiX, FiMap, FiTruck, FiUsers, FiMapPin, FiNavigation } from "react-icons/fi";

export default function SelectGeneratedRouteModal({
    isOpen,
    onClose,
    routes = [],
    onConfirmSelect
}) {
    const [selectedCode, setSelectedCode] = useState(
        routes.length > 0 ? (routes[0].routeCode || routes[0].routeNumber || "") : ""
    );

    if (!isOpen) return null;

    const activeRoute = routes.find(
        (r) => (r.routeCode || r.routeNumber) === selectedCode
    );

    const handleConfirm = () => {
        if (activeRoute) {
            onConfirmSelect(activeRoute);
        }
    };

    return (
        <div className="ai-modal-overlay" onClick={onClose}>
            <div
                className="ai-modal-card select-route-modal-card"
                style={{ maxWidth: "680px", width: "92%" }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Close Button */}
                <button
                    type="button"
                    className="ai-modal-close-icon"
                    onClick={onClose}
                    title="Close"
                >
                    <FiX />
                </button>

                {/* Modal Header */}
                <div className="ai-modal-header">
                    <div className="ai-modal-icon-wrap" style={{ background: "#eff6ff", color: "#2563eb" }}>
                        <FiMap />
                    </div>
                    <div>
                        <h2>Select Generated Route</h2>
                        <span className="ai-modal-subtitle">
                            Choose an AI-generated route to view on the map.
                        </span>
                    </div>
                </div>

                {/* Modal Body */}
                <div className="ai-modal-body" style={{ maxHeight: "60vh", overflowY: "auto", paddingRight: "4px" }}>
                    {routes.length === 0 ? (
                        <div style={{ textAlign: "center", padding: "30px 10px", color: "#64748b" }}>
                            <span style={{ fontSize: "32px", display: "block", marginBottom: "8px" }}>🗺️</span>
                            <strong>No generated routes are available to view.</strong>
                            <p style={{ margin: "4px 0 0", fontSize: "13px" }}>
                                Generate an AI route plan first before selecting a route.
                            </p>
                        </div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                            {routes.map((route, idx) => {
                                const code = route.routeCode || `R-${String(idx + 1).padStart(2, "0")}`;
                                const isSelected = selectedCode === code;
                                const isToDestination = route.tripMode === "TO_DESTINATION" || route.tripMode === "INWARD";
                                
                                const firstPointName = isToDestination
                                    ? route.stops?.[0]?.name || "Outer Pickup"
                                    : (route.sourceHub?.name || "Departure Hub");
                                const lastPointName = isToDestination
                                    ? (route.destinationHub?.name || "Destination Hub")
                                    : route.stops?.[route.stops.length - 1]?.name || "Terminus";

                                return (
                                    <div
                                        key={code}
                                        onClick={() => setSelectedCode(code)}
                                        style={{
                                            display: "flex",
                                            alignItems: "flex-start",
                                            gap: "14px",
                                            padding: "14px 16px",
                                            borderRadius: "12px",
                                            border: isSelected ? "2px solid #2563eb" : "1.5px solid #e2e8f0",
                                            background: isSelected ? "#f0f7ff" : "#ffffff",
                                            cursor: "pointer",
                                            transition: "all 0.15s ease",
                                            boxShadow: isSelected ? "0 4px 12px rgba(37,99,235,0.12)" : "0 1px 3px rgba(0,0,0,0.02)"
                                        }}
                                    >
                                        {/* Radio Indicator */}
                                        <div style={{
                                            marginTop: "3px",
                                            width: "18px",
                                            height: "18px",
                                            borderRadius: "50%",
                                            border: isSelected ? "5px solid #2563eb" : "2px solid #cbd5e1",
                                            background: "#fff",
                                            flexShrink: 0,
                                            transition: "all 0.15s ease"
                                        }} />

                                        {/* Route Details */}
                                        <div style={{ flex: 1 }}>
                                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                                    <strong style={{ fontSize: "15px", color: isSelected ? "#1d4ed8" : "#0f172a" }}>
                                                        {code}
                                                    </strong>
                                                    <span style={{
                                                        fontSize: "12px",
                                                        fontWeight: "600",
                                                        color: "#475569"
                                                    }}>
                                                        • {route.sectorName || "Transit"} Corridor
                                                    </span>
                                                </div>

                                                <span style={{
                                                    fontSize: "11px",
                                                    fontWeight: "700",
                                                    padding: "3px 8px",
                                                    borderRadius: "20px",
                                                    background: isToDestination ? "#fef3c7" : "#dcfce7",
                                                    color: isToDestination ? "#92400e" : "#166534"
                                                }}>
                                                    {isToDestination ? "Inward Route" : "Outward Route"}
                                                </span>
                                            </div>

                                            {/* Span / Path */}
                                            <div style={{ fontSize: "12.5px", color: "#334155", fontWeight: "600", marginBottom: "8px" }}>
                                                <span>{firstPointName}</span>
                                                <span style={{ margin: "0 6px", color: "#94a3b8" }}>→</span>
                                                <span>{lastPointName}</span>
                                            </div>

                                            {/* Metrics Row */}
                                            <div style={{
                                                display: "flex",
                                                flexWrap: "wrap",
                                                alignItems: "center",
                                                gap: "14px",
                                                fontSize: "12px",
                                                color: "#64748b"
                                            }}>
                                                <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                                    <FiTruck style={{ color: "#2563eb" }} />
                                                    <strong>{route.vehicleName || route.vehicleId || "Bus"}</strong>
                                                </span>
                                                <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                                    <FiUsers style={{ color: "#16a34a" }} />
                                                    <span><b>{route.assignedUsers || 0}</b> / {route.capacity || 0} passengers</span>
                                                </span>
                                                <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                                    <FiMapPin style={{ color: "#f59e0b" }} />
                                                    <span><b>{route.stops?.length || 0}</b> stops</span>
                                                </span>
                                                {route.routeDistanceKm && (
                                                    <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                                        <FiNavigation style={{ color: "#8b5cf6" }} />
                                                        <span>{route.routeDistanceKm} km</span>
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Modal Actions */}
                <div className="ai-modal-actions" style={{ marginTop: "20px" }}>
                    <button
                        type="button"
                        className="ai-modal-btn cancel-btn"
                        onClick={onClose}
                    >
                        Cancel
                    </button>

                    <button
                        type="button"
                        className="ai-modal-btn"
                        style={{
                            background: activeRoute ? "#2563eb" : "#94a3b8",
                            color: "#ffffff",
                            border: "none",
                            fontWeight: "700",
                            cursor: activeRoute ? "pointer" : "not-allowed"
                        }}
                        onClick={handleConfirm}
                        disabled={!activeRoute}
                    >
                        🗺 View Route
                    </button>
                </div>
            </div>
        </div>
    );
}
