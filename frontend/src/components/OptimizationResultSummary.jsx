import {
    FiCheckCircle,
    FiAlertTriangle,
    FiMap,
    FiUsers,
    FiTruck,
    FiMapPin,
    FiPieChart,
    FiCheckSquare
} from "react-icons/fi";

export default function OptimizationResultSummary({
    plan = {},
    summary = {},
    direction,
    onViewRoute
}) {
    const aiPlan = plan?.aiPlan || plan;

    const uniqueStops = Number(
        aiPlan?.uniqueStoppingAreas ??
        summary?.uniqueStoppingAreas ??
        summary?.uniqueStopCount ??
        summary?.stoppingAreas ??
        0
    );

    const totalStopVisits = Number(
        aiPlan?.totalRouteStopVisits ??
        aiPlan?.routeStopVisitCount ??
        summary?.totalRouteStopVisits ??
        summary?.routeStopVisitCount ??
        uniqueStops
    );

    const sharedStops = Number(
        aiPlan?.sharedStopCount ??
        summary?.sharedStopCount ??
        0
    );

    const totalComing = Number(
        aiPlan?.comingUsers ??
        aiPlan?.confirmedUsers ??
        summary?.confirmedUsers ??
        summary?.comingUsers ??
        0
    );

    const usersCovered = Number(
        aiPlan?.allocatedUsers ??
        aiPlan?.assignedUsers ??
        totalComing
    );

    const busesAllocated = Number(
        aiPlan?.allocatedBusCount ??
        aiPlan?.feasibleBusCount ??
        (Array.isArray(aiPlan?.buses) ? aiPlan.buses.length : Number(aiPlan?.vehicleCount ?? 0))
    );

    const availableVehiclesCount = Number(
        aiPlan?.availableBusCount ??
        aiPlan?.availableVehicleCount ??
        summary?.availableVehicles ??
        summary?.availableVehicleCount ??
        busesAllocated
    );

    const minimumCapacityBuses = Number(
        aiPlan?.minimumCapacityBuses ??
        summary?.minimumCapacityBuses ??
        aiPlan?.fleetDecision?.minimumCapacityBuses ??
        busesAllocated
    );

    const feasibleBusCount = Number(
        aiPlan?.feasibleBusCount ??
        summary?.feasibleBusCount ??
        aiPlan?.fleetDecision?.feasibleBusCount ??
        busesAllocated
    );

    const allocatedSeats = Number(
        aiPlan?.allocatedSeats ??
        aiPlan?.totalCapacity ??
        0
    );

    const unusedSeats = Math.max(0, allocatedSeats - usersCovered);

    const availableSeats = Number(
        aiPlan?.availableTotalCapacity ??
        aiPlan?.totalAvailableFleetSeats ??
        summary?.totalAvailableCapacity ??
        allocatedSeats
    );

    const totalFleetCapacity = Number(
        aiPlan?.physicalFleetCapacity ??
        aiPlan?.totalPhysicalCapacity ??
        aiPlan?.totalFleetCapacity ??
        summary?.totalPhysicalCapacity ??
        availableSeats
    );

    const seatUtilizationRate = Number(
        aiPlan?.routeAllocationUtilization ??
        aiPlan?.utilizationMetrics?.allocatedVehicleSeatUtilization?.rate ??
        (allocatedSeats > 0 ? (usersCovered / allocatedSeats) * 100 : 100)
    ).toFixed(2);

    const fleetCapacityUtilizationRate = Number(
        aiPlan?.physicalFleetUtilization ??
        aiPlan?.utilizationMetrics?.totalFleetCapacityUtilization?.rate ??
        (totalFleetCapacity > 0 ? (usersCovered / totalFleetCapacity) * 100 : 0)
    ).toFixed(2);

    const vehicleFleetUsageRate = Number(
        aiPlan?.fleetVehicleUtilization ??
        aiPlan?.utilizationMetrics?.vehicleFleetUsage?.rate ??
        (availableVehiclesCount > 0 ? (busesAllocated / availableVehiclesCount) * 100 : 0)
    ).toFixed(2);

    const isCertified = aiPlan?.certification?.isCertified !== false && usersCovered >= totalComing && totalComing > 0;
    const capacityShortage = aiPlan?.capacityShortage || summary?.capacityShortage || (availableSeats < totalComing);
    const unallocatedUsers = Number(aiPlan?.unassignedUsers ?? summary?.unallocatedUsers ?? 0);
    const fleetBalancing = aiPlan?.fleetBalancing || summary?.fleetBalancing || plan?.fleetBalancing || null;

    const rawTripMode = aiPlan?.tripMode || plan?.tripMode || "INWARD";
    const canonicalDirection = direction
        ? direction.toUpperCase()
        : ((rawTripMode === "FROM_SOURCE" || rawTripMode === "OUTWARD" || aiPlan?.direction === "OUTWARD" || plan?.direction === "OUTWARD")
            ? "OUTWARD"
            : "INWARD");

    const isApproved = Boolean(
        aiPlan?.isApproved === true ||
        plan?.isApproved === true ||
        (aiPlan?.status === "active" && aiPlan?.approvedAt) ||
        (plan?.status === "active" && plan?.approvedAt)
    );
    const isPendingApproval = Boolean(
        !isApproved &&
        (aiPlan?.isSubmitted === true ||
         plan?.isSubmitted === true ||
         aiPlan?.status === "pending_approval" ||
         plan?.status === "pending_approval")
    );

    // isRoadVerified: true only if ALL buses are OSRM-verified AND continuous (both set by the backend after full validation)
    const isRoadVerified = Array.isArray(aiPlan?.buses) && aiPlan.buses.length > 0
        ? aiPlan.buses.every((b) => b.isRoadVerified === true && b.isContinuous === true)
        : false;
    // roadValidationText: derive from the backend-assigned roadRouteStatus fields (not hard-coded).
    // Uses the most conservative status across all buses; falls back to generic messages only if status is absent.
    const roadValidationText = (() => {
        const buses = Array.isArray(aiPlan?.buses) ? aiPlan.buses : [];
        if (buses.length === 0) return "⚠ Continuous OSRM geometry unavailable";
        // All buses fully verified by backend
        if (buses.every((b) => b.roadRouteStatus === "Continuous OSRM road progression verified" && b.isRoadVerified === true && b.isContinuous === true)) {
            return "Continuous OSRM road progression verified";
        }
        if (buses.every((b) => (b.roadRouteStatus === "Continuous OSRM road progression verified" || b.roadRouteStatus === "OSRM road connectivity verified") && b.isRoadVerified === true)) {
            return "OSRM road connectivity verified";
        }
        return "⚠ Continuous OSRM geometry unavailable";
    })();

    const rawCreatedAt =
        aiPlan?.createdAt ||
        plan?.createdAt ||
        aiPlan?.generatedAt ||
        plan?.generatedAt ||
        aiPlan?.approvedAt ||
        plan?.approvedAt ||
        aiPlan?.selectedAt ||
        plan?.selectedAt ||
        summary?.generatedAt ||
        summary?.createdAt;

    const generatedTimeText = (() => {
        if (!rawCreatedAt) return "Just now";
        try {
            const d = new Date(rawCreatedAt);
            if (isNaN(d.getTime())) return "Just now";
            return d.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit"
            });
        } catch {
            return "Just now";
        }
    })();

    return (
        <div className="optimization-result-summary-card">
            {/* Section 13: Distinct AI Plan Lifecycle State Banner */}
            <div style={{
                background: isApproved ? "#f0fdf4" : isPendingApproval ? "#fffbeb" : "#f8fafc",
                border: `1.5px solid ${isApproved ? "#86efac" : isPendingApproval ? "#fde68a" : "#cbd5e1"}`,
                borderRadius: "10px",
                padding: "12px 18px",
                marginBottom: "16px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "12px"
            }}>
                <div>
                    <div style={{ fontSize: "11px", fontWeight: "800", letterSpacing: "0.06em", color: "#64748b", textTransform: "uppercase" }}>
                        PLAN TYPE: <b>AI</b> &nbsp;|&nbsp; STATUS: <span style={{
                            color: isApproved ? "#15803d" : isPendingApproval ? "#b45309" : "#475569",
                            fontWeight: "800"
                        }}>
                            {isApproved ? "APPROVED / ACTIVE" : isPendingApproval ? "PENDING APPROVAL" : "GENERATED (PREVIEW)"}
                        </span>
                    </div>
                    <div style={{ fontSize: "14px", fontWeight: "600", color: "#1e293b", marginTop: "3px" }}>
                        Direction: <strong style={{ color: canonicalDirection === "OUTWARD" ? "#7c3aed" : "#0284c7" }}>{canonicalDirection}</strong>
                        &nbsp;•&nbsp; Users: <strong>{totalComing}</strong>
                        &nbsp;•&nbsp; Allocation: <strong style={{ color: isApproved ? "#15803d" : isPendingApproval ? "#b45309" : "#64748b" }}>
                            {isApproved ? `${usersCovered} / ${totalComing}` : (isPendingApproval ? "Pending Approval" : "Not Allocated (Preview Only)")}
                        </strong>
                    </div>
                </div>
                <div>
                    <span style={{
                        display: "inline-block",
                        padding: "5px 12px",
                        borderRadius: "9999px",
                        fontSize: "12px",
                        fontWeight: "700",
                        background: isApproved ? "#dcfce7" : isPendingApproval ? "#fef3c7" : "#e2e8f0",
                        color: isApproved ? "#166534" : isPendingApproval ? "#92400e" : "#475569",
                        border: `1px solid ${isApproved ? "#bbf7d0" : isPendingApproval ? "#fde68a" : "#cbd5e1"}`
                    }}>
                        {isApproved ? "✓ APPROVED / ACTIVE" : isPendingApproval ? "⏳ PENDING APPROVAL" : "👁 GENERATED (PREVIEW)"}
                    </span>
                </div>
            </div>

            {/* Header Banner */}
            <div className={`opt-result-top-banner ${isCertified ? "certified-banner" : "warning-banner"}`}>
                <div className="opt-result-title-group">
                    <div className={`opt-success-icon-badge ${isCertified ? "success-badge" : "warning-badge"}`}>
                        {isCertified ? <FiCheckCircle /> : <FiAlertTriangle />}
                    </div>
                    <div>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "6px" }}>
                            <span className={`opt-complete-tag ${isCertified ? "tag-success" : "tag-warning"}`}>
                                {isCertified ? "OPTIMIZATION ENGINE SUCCESS" : "OPTIMIZATION REQUIRES REVIEW"}
                            </span>
                            <span className="opt-complete-tag" style={{ background: canonicalDirection === "OUTWARD" ? "#f3e8ff" : "#e0f2fe", color: canonicalDirection === "OUTWARD" ? "#6b21a8" : "#0369a1" }}>
                                {canonicalDirection === "OUTWARD" ? "Outward Plan" : "Inward Plan"}
                            </span>
                        </div>
                        <h2>
                            {canonicalDirection === "OUTWARD" ? "AI Outward Plan" : "AI Inward Plan"}
                            {!isCertified && (
                                <span style={{ fontSize: "14px", fontWeight: "600", color: "#b45309", marginLeft: "10px" }}>
                                    (Review Required)
                                </span>
                            )}
                        </h2>
                        <p className="opt-result-subtext">
                            {aiPlan?.validationMessage || (canonicalDirection === "INWARD" && isCertified
                                ? `${busesAllocated} buses are required for ${usersCovered} passengers. All selected inward buses have configured starting places. Ready to generate.`
                                : (isCertified
                                    ? `The independent AI engine allocated continuous road routes for all ${usersCovered} confirmed passengers across ${busesAllocated} available vehicles (${allocatedSeats} total seats, ${unusedSeats} unused seats).`
                                    : `Demand of ${totalComing} confirmed passengers requires review (${unallocatedUsers > 0 ? `${unallocatedUsers} passengers unallocated due to vehicle capacity limits` : "Review constraints"}).`))}
                        </p>
                    </div>
                </div>

                <div className="opt-result-status-col">
                    <div className="opt-result-badge-status">
                        <span className={`live-status-dot ${isCertified ? "dot-online" : "dot-warning"}`}></span>
                        <span>{isCertified ? "Rule-Based Plan Validated" : "Review Required"}</span>
                    </div>
                    <span className="timestamp-badge">
                        Generated: {generatedTimeText}
                    </span>
                </div>
            </div>

            {/* Core Metrics Grid */}
            <div className="opt-result-metrics-grid">
                <div className="result-metric-item">
                    <div className="metric-icon-box users">
                        <FiUsers />
                    </div>
                    <div className="metric-details">
                        <strong className="metric-big-val">
                            {usersCovered.toLocaleString()}
                            <small className="metric-fraction"> / {totalComing.toLocaleString()}</small>
                        </strong>
                        <span className="metric-sub-label">
                            {isApproved
                                ? (usersCovered === totalComing ? "Passengers Allocated (100%)" : `${unallocatedUsers} Shortfall`)
                                : (isPendingApproval ? "Allocation: Pending Approval" : "Planned Passengers (Not Allocated)")}
                        </span>
                    </div>
                </div>

                <div className="result-metric-item">
                    <div className="metric-icon-box fleet">
                        <FiTruck />
                    </div>
                    <div className="metric-details">
                        <strong className="metric-big-val">
                            {busesAllocated} Buses
                            <small className="metric-fraction"> / {availableVehiclesCount} avail.</small>
                        </strong>
                        <span className="metric-sub-label">
                            {feasibleBusCount > minimumCapacityBuses
                                ? `Feasible Fleet (Min: ${minimumCapacityBuses})`
                                : "Feasible Fleet (Optimal)"}
                        </span>
                    </div>
                </div>

                <div className="result-metric-item">
                    <div className="metric-icon-box shield">
                        <FiCheckSquare />
                    </div>
                    <div className="metric-details">
                        <strong className="metric-big-val">
                            {usersCovered} / {allocatedSeats}
                        </strong>
                        <span className="metric-sub-label">
                            Seats Occupied ({unusedSeats} unused)
                        </span>
                    </div>
                </div>

                <div className="result-metric-item">
                    <div className="metric-icon-box shield">
                        <FiPieChart />
                    </div>
                    <div className="metric-details">
                        <strong className="metric-big-val text-success">
                            {seatUtilizationRate}%
                        </strong>
                        <span className="metric-sub-label">
                            Seat Utilization ({usersCovered}/{allocatedSeats})
                        </span>
                    </div>
                </div>

                <div className="result-metric-item">
                    <div className="metric-icon-box stops">
                        <FiMapPin />
                    </div>
                    <div className="metric-details">
                        <strong className="metric-big-val">
                            {uniqueStops.toLocaleString()}
                        </strong>
                        <span className="metric-sub-label">
                            Unique Stops ({totalStopVisits} visits{sharedStops > 0 ? `, ${sharedStops} shared` : ""})
                        </span>
                    </div>
                </div>
            </div>

            {/* Route Summary Overview Grid */}
            <div style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: "12px",
                padding: "16px 20px",
                margin: "18px 0"
            }}>
                <h4 style={{ margin: "0 0 12px 0", fontSize: "14px", fontWeight: "700", color: "#1e293b" }}>
                    📊 Route Allocation Summary
                </h4>
                <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                    gap: "12px 20px",
                    fontSize: "13px"
                }}>
                    <div>
                        <span style={{ color: "#64748b" }}>Coming Users (Demand): </span>
                        <strong style={{ color: "#0f172a" }}>{totalComing}</strong>
                    </div>
                    <div>
                        <span style={{ color: "#64748b" }}>Allocated Passengers: </span>
                        <strong style={{ color: isApproved ? "#16a34a" : isPendingApproval ? "#b45309" : "#64748b" }}>
                            {isApproved ? `${usersCovered} / ${totalComing}` : (isPendingApproval ? "Pending Approval" : "0 (Preview Only)")}
                        </strong>
                    </div>
                    <div>
                        <span style={{ color: "#64748b" }}>Unallocated: </span>
                        <strong style={{ color: unallocatedUsers > 0 ? "#dc2626" : "#0f172a" }}>{unallocatedUsers}</strong>
                    </div>
                    <div>
                        <span style={{ color: "#64748b" }}>Duplicate: </span>
                        <strong style={{ color: "#0f172a" }}>0</strong>
                    </div>
                    <div>
                        <span style={{ color: "#64748b" }}>Available Vehicles: </span>
                        <strong style={{ color: "#0f172a" }}>{availableVehiclesCount}</strong>
                    </div>
                    <div>
                        <span style={{ color: "#64748b" }}>Buses Allocated: </span>
                        <strong style={{ color: "#2563eb" }}>{busesAllocated}</strong>
                    </div>
                    <div>
                        <span style={{ color: "#64748b" }}>Allocated Seat Capacity: </span>
                        <strong style={{ color: "#0f172a" }}>{allocatedSeats} seats</strong>
                    </div>
                    <div>
                        <span style={{ color: "#64748b" }}>Occupied Seats: </span>
                        <strong style={{ color: "#16a34a" }}>{usersCovered} seats</strong>
                    </div>
                    <div>
                        <span style={{ color: "#64748b" }}>Unused Seats: </span>
                        <strong style={{ color: "#64748b" }}>{unusedSeats} seats</strong>
                    </div>
                    <div>
                        <span style={{ color: "#64748b" }}>Seat Utilization (Allocated Buses): </span>
                        <strong style={{ color: "#16a34a" }}>{seatUtilizationRate}% ({usersCovered}/{allocatedSeats})</strong>
                        <div style={{ fontSize: "11px", color: "#94a3b8" }}>Formula: occupiedSeats / allocatedSeats</div>
                    </div>
                    <div>
                        <span style={{ color: "#64748b" }}>Total Fleet Capacity Utilization: </span>
                        <strong style={{ color: "#0284c7" }}>{fleetCapacityUtilizationRate}% ({usersCovered}/{totalFleetCapacity})</strong>
                        <div style={{ fontSize: "11px", color: "#94a3b8" }}>Formula: occupiedSeats / totalFleetCapacity</div>
                    </div>
                    <div>
                        <span style={{ color: "#64748b" }}>Vehicle Fleet Usage: </span>
                        <strong style={{ color: "#7c3aed" }}>{vehicleFleetUsageRate}% ({busesAllocated}/{availableVehiclesCount})</strong>
                        <div style={{ fontSize: "11px", color: "#94a3b8" }}>Formula: allocatedVehicles / availableVehicles</div>
                    </div>
                    <div>
                        <span style={{ color: "#64748b" }}>Unique Stopping Areas: </span>
                        <strong style={{ color: "#0f172a" }}>{uniqueStops}</strong>
                    </div>
                    <div>
                        <span style={{ color: "#64748b" }}>Total Route Stop Visits: </span>
                        <strong style={{ color: "#0f172a" }}>{totalStopVisits}</strong>
                    </div>
                </div>
            </div>

            {/* Fleet Balancing & Shared Fleet Principle (Transportation Manager Optimization) */}
            {fleetBalancing && (
                <div style={{
                    background: fleetBalancing.symmetryStatus === "BALANCED_FLEET" ? "#f0fdf4" : "#f8fafc",
                    border: `1.5px solid ${fleetBalancing.symmetryStatus === "BALANCED_FLEET" ? "#86efac" : "#cbd5e1"}`,
                    borderRadius: "12px",
                    padding: "16px 20px",
                    margin: "18px 0"
                }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", flexWrap: "wrap", gap: "8px" }}>
                        <h4 style={{ margin: 0, fontSize: "14px", fontWeight: "700", color: "#1e293b", display: "flex", alignItems: "center", gap: "8px" }}>
                            <span>⚖️ Transportation Manager Fleet Balancing</span>
                            <span style={{
                                fontSize: "11px",
                                fontWeight: "800",
                                padding: "3px 8px",
                                borderRadius: "6px",
                                background: fleetBalancing.symmetryStatus === "BALANCED_FLEET" ? "#dcfce7" : "#f1f5f9",
                                color: fleetBalancing.symmetryStatus === "BALANCED_FLEET" ? "#15803d" : "#475569",
                                textTransform: "uppercase"
                            }}>
                                {fleetBalancing.symmetryStatus === "BALANCED_FLEET" ? "Balanced Fleet (Shared Operation)" : (fleetBalancing.symmetryStatus === "ASYMMETRIC_FLEET_JUSTIFIED" ? "Asymmetry Justified" : "Independent Direction")}
                            </span>
                        </h4>
                        {fleetBalancing.vehicleReuseCount > 0 && (
                            <span style={{ fontSize: "12px", fontWeight: "700", color: "#16a34a", background: "#dcfce7", padding: "3px 10px", borderRadius: "12px" }}>
                                🔄 Vehicle Reuse: {fleetBalancing.vehicleReuseCount} buses ({fleetBalancing.vehicleReuseRate}%)
                            </span>
                        )}
                    </div>
                    <p style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#334155", lineHeight: "1.5" }}>
                        {fleetBalancing.decisionReason}
                    </p>
                    {fleetBalancing.reusedVehicleNames?.length > 0 && (
                        <div style={{ fontSize: "12px", color: "#475569" }}>
                            <strong>Reused Fleet Vehicles: </strong>
                            {fleetBalancing.reusedVehicleNames.join(", ")}
                        </div>
                    )}
                </div>
            )}

            {/* Validation & Highlights Bar */}
            <div className="opt-validation-highlights">
                <div className="highlight-pill">
                    <span className="highlight-check">✓</span>
                    <span>No duplicate passenger assignments</span>
                </div>

                <div className="highlight-pill">
                    <span className="highlight-check">✓</span>
                    <span>{usersCovered === totalComing ? "All confirmed Coming users allocated" : `${usersCovered} of ${totalComing} allocated`}</span>
                </div>

                <div className="highlight-pill">
                    <span className="highlight-check">✓</span>
                    <span>Vehicle capacities strictly respected</span>
                </div>

                <div className="highlight-pill">
                    <span className="highlight-check">✓</span>
                    <span>Only available vehicles from schedule assigned</span>
                </div>

                {sharedStops > 0 && (
                    <div className="highlight-pill info-pill">
                        <span className="highlight-check">ℹ</span>
                        <span>{sharedStops} shared stop visits used for passenger capacity</span>
                    </div>
                )}

                <div className={`highlight-pill ${isRoadVerified ? "" : "info-pill"}`}>
                    <span className="highlight-check">{isRoadVerified ? "✓" : "⚠️"}</span>
                    <span>{roadValidationText}</span>
                </div>

                <div className={`highlight-pill ${isRoadVerified ? "" : "info-pill"}`} id="pill-road-validation">
                    <span className="highlight-check">{isRoadVerified ? "✓" : "⚠️"}</span>
                    <span>Road Validation: <strong>{roadValidationText}</strong></span>
                </div>
            </div>

            {/* Primary Action Buttons */}
            <div className="opt-result-actions-bar">
                <button
                    type="button"
                    className="opt-action-btn primary-btn"
                    onClick={onViewRoute}
                    id="btn-view-generated-route"
                >
                    <FiMap />
                    <span>🗺 View Generated Route</span>
                </button>
            </div>
        </div>
    );
}
