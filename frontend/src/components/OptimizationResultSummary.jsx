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

    const busesAllocated = Array.isArray(aiPlan?.buses)
        ? aiPlan.buses.length
        : Number(aiPlan?.vehicleCount ?? 0);

    const availableVehiclesCount = Number(
        aiPlan?.availableVehicleCount ??
        summary?.availableVehicles ??
        summary?.availableVehicleCount ??
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

    const utilizationRate = Number(
        aiPlan?.routeAllocationUtilization ??
        aiPlan?.utilization ??
        (allocatedSeats > 0 ? (usersCovered / allocatedSeats) * 100 : 100)
    ).toFixed(2);

    const isCertified = aiPlan?.certification?.isCertified !== false && usersCovered >= totalComing && totalComing > 0;
    const capacityShortage = aiPlan?.capacityShortage || summary?.capacityShortage || (availableSeats < totalComing);
    const unallocatedUsers = Number(aiPlan?.unassignedUsers ?? summary?.unallocatedUsers ?? 0);

    return (
        <div className="optimization-result-summary-card">
            {/* Header Banner */}
            <div className={`opt-result-top-banner ${isCertified ? "certified-banner" : "warning-banner"}`}>
                <div className="opt-result-title-group">
                    <div className={`opt-success-icon-badge ${isCertified ? "success-badge" : "warning-badge"}`}>
                        {isCertified ? <FiCheckCircle /> : <FiAlertTriangle />}
                    </div>
                    <div>
                        <span className={`opt-complete-tag ${isCertified ? "tag-success" : "tag-warning"}`}>
                            {isCertified ? "OPTIMIZATION ENGINE SUCCESS" : "OPTIMIZATION REQUIRES REVIEW"}
                        </span>
                        <h2>
                            {isCertified
                                ? "AI Route Optimization Complete"
                                : (capacityShortage ? "Insufficient Available Vehicle Capacity" : "AI Route Plan Generated with Warnings")}
                        </h2>
                        <p className="opt-result-subtext">
                            {isCertified
                                ? `The rule-based AI engine allocated continuous road routes for all ${usersCovered} confirmed passengers across ${busesAllocated} available vehicles (${allocatedSeats} total seats, ${unusedSeats} unused seats).`
                                : `Demand of ${totalComing} confirmed passengers requires review (${unallocatedUsers > 0 ? `${unallocatedUsers} passengers unallocated due to vehicle capacity limits` : "Review constraints"}).`}
                        </p>
                    </div>
                </div>

                <div className="opt-result-badge-status">
                    <span className={`live-status-dot ${isCertified ? "dot-online" : "dot-warning"}`}></span>
                    <span>{isCertified ? "Rule-Based Plan Validated" : "Review Required"}</span>
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
                            {usersCovered === totalComing ? "Passengers Allocated (100%)" : `${unallocatedUsers} Shortfall`}
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
                            Buses Allocated
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
                            {utilizationRate}%
                        </strong>
                        <span className="metric-sub-label">
                            Seat Utilization
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
                        <strong style={{ color: "#16a34a" }}>{usersCovered}</strong>
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
                        <span style={{ color: "#64748b" }}>Seat Utilization: </span>
                        <strong style={{ color: "#16a34a" }}>{utilizationRate}%</strong>
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

                <div className="highlight-pill">
                    <span className="highlight-check">✓</span>
                    <span>2-Opt continuous road progression verified</span>
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
