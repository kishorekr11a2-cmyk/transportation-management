import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import { HiArrowLeft } from "react-icons/hi";
import {
    getManualPlan,
    approveManualPlan,
    resetManualPlanAllocations,
    getManualPlanRecommendations
} from "../services/aiAgentService";
import "../css/AdminManualPlan.css";

const AdminManualPlan = () => {
    const navigate = useNavigate();

    // Direction state: defaults to INWARD or saved localStorage preference
    const [direction, setDirection] = useState(() => {
        try {
            return localStorage.getItem("active_manual_plan_direction") || "INWARD";
        } catch {
            return "INWARD";
        }
    });

    const [loading, setLoading] = useState(true);
    const [approving, setApproving] = useState(false);
    const [resetting, setResetting] = useState(false);
    const [recsLoading, setRecsLoading] = useState(false);
    const [planData, setPlanData] = useState(null);
    const [showResetModal, setShowResetModal] = useState(false);
    const [recommendations, setRecommendations] = useState(null);
    const [showRecsPanel, setShowRecsPanel] = useState(false);

    // Fetch manual plan data from backend
    const loadPlan = useCallback(async (dirToFetch) => {
        try {
            setLoading(true);
            const currentDir = dirToFetch || direction;
            const res = await getManualPlan({ direction: currentDir });
            if (res?.success) {
                setPlanData(res.plan || null);
            } else {
                setPlanData(null);
            }
        } catch (err) {
            console.error("Error loading manual plan:", err);
            toast.error(err.response?.data?.message || "Failed to load manual plan.");
            setPlanData(null);
        } finally {
            setLoading(false);
        }
    }, [direction]);

    useEffect(() => {
        loadPlan(direction);
    }, [direction, loadPlan]);

    // Live background re-fetch when tab is focused
    useEffect(() => {
        const handleSync = () => {
            if (document.visibilityState === "visible") {
                loadPlan(direction);
            }
        };
        window.addEventListener("focus", handleSync);
        document.addEventListener("visibilitychange", handleSync);
        return () => {
            window.removeEventListener("focus", handleSync);
            document.removeEventListener("visibilitychange", handleSync);
        };
    }, [direction, loadPlan]);

    const handleDirectionChange = (newDir) => {
        if (newDir === direction) return;
        setDirection(newDir);
        setRecommendations(null);
        setShowRecsPanel(false);
        try {
            localStorage.setItem("active_manual_plan_direction", newDir);
        } catch {}
    };

    // Approve manual plan
    const handleApprove = async () => {
        try {
            setApproving(true);
            const res = await approveManualPlan({ direction });
            if (res?.success) {
                toast.success(res.message || `Admin manual ${direction} plan approved successfully!`);
                await loadPlan(direction);
                navigate(`/admin/plan-confirmation?direction=${direction}&type=ADMIN`);
            } else {
                toast.error(res?.message || "Failed to approve manual plan.");
            }
        } catch (err) {
            console.error("Approve manual plan error:", err);
            toast.error(err.response?.data?.message || err.message || "Failed to approve manual plan.");
        } finally {
            setApproving(false);
        }
    };

    // Reset manual plan allocations
    const handleResetAllocations = async () => {
        try {
            setResetting(true);
            const res = await resetManualPlanAllocations({ direction });
            if (res?.success) {
                toast.success(res.message || `Manual plan allocations for ${direction} reset successfully.`);
                setShowResetModal(false);
                await loadPlan(direction);
            } else {
                toast.error(res?.message || "Failed to reset manual plan allocations.");
            }
        } catch (err) {
            console.error("Reset manual allocations error:", err);
            toast.error(err.response?.data?.message || err.message || "Failed to reset manual plan allocations.");
        } finally {
            setResetting(false);
        }
    };

    // Advisory AI Recommendations
    const handleFetchRecs = async () => {
        try {
            setRecsLoading(true);
            const res = await getManualPlanRecommendations({ direction });
            if (res?.success) {
                setRecommendations(res);
                setShowRecsPanel(true);
                const count = res.recommendations?.length || 0;
                toast.success(count > 0 ? `Generated ${count} AI recommendations for review.` : "0 issues found for manual plan.");
            } else {
                toast.error(res?.message || "Failed to analyze manual plan.");
            }
        } catch (err) {
            console.error("AI recommendations error:", err);
            toast.error(err.response?.data?.message || err.message || "Failed to analyze manual plan.");
        } finally {
            setRecsLoading(false);
        }
    };

    const routes = Array.isArray(planData?.buses) ? planData.buses : (Array.isArray(planData?.routes) ? planData.routes : []);
    const isSubmitted = Boolean(planData?.isSubmitted || planData?.isApproved);
    const isApproved = Boolean(planData?.isApproved);
    const warnings = Array.isArray(planData?.warnings) ? planData.warnings : [];

    return (
        <div className="manual-plan-page">
            {/* Header */}
            <div className="manual-plan-page-header">
                <div className="header-left" style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                    <button
                        type="button"
                        className="manual-back-btn"
                        onClick={() => navigate(-1)}
                        aria-label="Go back"
                    >
                        <HiArrowLeft size={16} />
                        Back
                    </button>
                    <div>
                        <h1 className="page-title">
                            👨‍💼 Admin Manual Plan
                        </h1>
                        <p className="page-subtitle">
                            Review and approve manually created routes and bus seat allocations.
                        </p>
                    </div>
                </div>

                <div className="header-right">
                    <div className="direction-toggle-container">
                        <button
                            type="button"
                            className={`dir-toggle-btn ${direction === "INWARD" ? "active inward" : ""}`}
                            onClick={() => handleDirectionChange("INWARD")}
                        >
                            🟢 INWARD Plan
                        </button>
                        <button
                            type="button"
                            className={`dir-toggle-btn ${direction === "OUTWARD" ? "active outward" : ""}`}
                            onClick={() => handleDirectionChange("OUTWARD")}
                        >
                            🔵 OUTWARD Plan
                        </button>
                    </div>

                    <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => navigate(`/admin/plan-confirmation?direction=${direction}&type=ADMIN`)}
                    >
                        Plan Confirmation →
                    </button>
                </div>
            </div>

            {/* Overview Card */}
            <div className="manual-overview-card">
                <div className="overview-top-row">
                    <div className="overview-title-group">
                        <span className="plan-type-badge">PLAN TYPE: MANUAL</span>
                        <span className={`status-badge ${isApproved ? "approved" : (isSubmitted ? "submitted" : "not-submitted")}`}>
                            {isApproved
                                ? `✓ ${direction} Approved & Active in MongoDB`
                                : (isSubmitted
                                    ? `✓ ${direction} Submitted • Pending Approval`
                                    : `⏳ ${direction} Not Submitted`)}
                        </span>
                    </div>

                    <div style={{ fontSize: "12px", color: "#64748b" }}>
                        Direction: <strong style={{ color: "#0f172a" }}>{direction}</strong>
                    </div>
                </div>

                {/* Metrics Grid */}
                <div className="manual-metrics-grid">
                    <div className="metric-card">
                        <span className="metric-label">Confirmed Students</span>
                        <span className="metric-value">
                            {loading ? "..." : (planData?.totalComingUsers ?? 0)}
                        </span>
                        <span className="metric-sub">Daily attendance Coming</span>
                    </div>

                    <div className="metric-card">
                        <span className="metric-label">Fleet Capacity</span>
                        <span className="metric-value">
                            {loading ? "..." : `${planData?.totalCapacity ?? 0}`}
                        </span>
                        <span className="metric-sub">{routes.length} buses scheduled</span>
                    </div>

                    <div className="metric-card">
                        <span className="metric-label">Allocated Seats</span>
                        <span className="metric-value success">
                            {loading ? "..." : (planData?.assignedUsers ?? 0)}
                        </span>
                        <span className="metric-sub">
                            {planData?.totalCapacity > 0
                                ? `${Math.round(((planData?.assignedUsers || 0) / planData.totalCapacity) * 100)}% load factor`
                                : "No capacity"}
                        </span>
                    </div>

                    <div className="metric-card">
                        <span className="metric-label">Standby / Unallocated</span>
                        <span className={`metric-value ${planData?.unassignedUsers > 0 ? "danger" : ""}`}>
                            {loading ? "..." : (planData?.unassignedUsers ?? 0)}
                        </span>
                        <span className="metric-sub">
                            {planData?.unassignedUsers > 0 ? "⚠️ Capacity Exceeded" : "✓ All Accommodated"}
                        </span>
                    </div>

                    <div className="metric-card">
                        <span className="metric-label">Assigned Routes</span>
                        <span className="metric-value">
                            {loading ? "..." : routes.length}
                        </span>
                        <span className="metric-sub">Configured routes</span>
                    </div>
                </div>

                {/* Warnings Banner */}
                {warnings.length > 0 && routes.length > 0 && (
                    <div className="warnings-banner">
                        <strong>⚠️ Manual Plan Capacity &amp; Route Configuration Warnings:</strong>
                        <ul>
                            {warnings.map((w, idx) => (
                                <li key={idx}>{w}</li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* Actions Row */}
                <div className="actions-row">
                    <button
                        type="button"
                        className={`btn-approve-primary ${isApproved ? "is-approved" : ""}`}
                        onClick={handleApprove}
                        disabled={loading || approving || isApproved || !isSubmitted || routes.length === 0}
                    >
                        {approving
                            ? `⏳ Approving & Allocating ${direction} Plan...`
                            : isApproved
                                ? `✓ ${direction} Manual Plan Approved & Active in MongoDB`
                                : `✓ Approve ${direction} Manual Plan`}
                    </button>

                    <button
                        type="button"
                        className="btn-reset-allocations"
                        onClick={() => setShowResetModal(true)}
                        disabled={resetting || approving || !isApproved}
                        title="Remove student allocations while preserving manual routes"
                    >
                        {resetting ? "Resetting..." : "Reset Manual Plan Allocations"}
                    </button>

                    <button
                        type="button"
                        className="btn-secondary"
                        onClick={handleFetchRecs}
                        disabled={recsLoading || routes.length === 0}
                        title="Analyze routes for coverage, fleet utilization, and seat optimization"
                    >
                        {recsLoading ? "Analyzing..." : "✨ AI Recommendation"}
                    </button>

                    <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => navigate(`/admin/plan-confirmation?direction=${direction}&type=ADMIN`)}
                    >
                        Go to Final Confirmation →
                    </button>
                </div>
            </div>

            {/* AI Recommendation Review Panel */}
            {showRecsPanel && recommendations && (
                <div style={{
                    background: "#ffffff",
                    border: "1px solid #e0e7ff",
                    borderLeft: "4px solid #6366f1",
                    borderRadius: "12px",
                    padding: "20px",
                    marginBottom: "24px"
                }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <span style={{ fontSize: "20px" }}>✨</span>
                            <h3 style={{ margin: 0, fontSize: "16px", color: "#1e1b4b" }}>
                                AI Recommendations for {direction} Manual Plan (Advisory Only)
                            </h3>
                        </div>
                        <button
                            type="button"
                            style={{ background: "transparent", border: "none", cursor: "pointer", color: "#64748b", fontWeight: "600" }}
                            onClick={() => setShowRecsPanel(false)}
                        >
                            ✕ Close
                        </button>
                    </div>
                    <p style={{ margin: "0 0 12px 0", fontSize: "13px", color: "#475569" }}>
                        {recommendations.recommendations?.length === 0
                            ? "✓ No bottlenecks or capacity violations detected. Your manual route configuration is well optimized."
                            : `Found ${recommendations.recommendations.length} optimization suggestions:`}
                    </p>
                    {Array.isArray(recommendations.recommendations) && recommendations.recommendations.map((rec, i) => (
                        <div key={i} style={{ padding: "10px 14px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0", marginBottom: "8px", fontSize: "13px" }}>
                            <strong style={{ color: "#1e293b", display: "block" }}>{rec.title}</strong>
                            <span style={{ color: "#64748b" }}>{rec.suggestedImprovement || rec.currentSituation}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* Route Cards / Empty State */}
            <div className="routes-section-heading">
                <h3>{direction} Assigned Manual Routes ({routes.length})</h3>
            </div>

            {loading ? (
                <div style={{ textAlign: "center", padding: "40px", color: "#64748b" }}>
                    Loading manual plan data...
                </div>
            ) : (!isSubmitted && !isApproved) ? (
                <div className="empty-plan-card">
                    <div className="empty-icon">📋</div>
                    <h3 className="empty-title">
                        No Confirmed {direction} Manual Plan Submitted Yet
                    </h3>
                    <p className="empty-desc">
                        In <strong>Route Management</strong>, select <strong>{direction}</strong>, configure your routes, assign buses to them, and click <strong>"✓ OK"</strong> to submit.
                    </p>
                    <button
                        type="button"
                        className="btn-goto-routes"
                        onClick={() => navigate("/routes")}
                    >
                        Go to Route Management →
                    </button>
                </div>
            ) : routes.length === 0 ? (
                <div className="empty-plan-card">
                    <div className="empty-icon">🛣️</div>
                    <h3 className="empty-title">
                        No Routes with Assigned Buses Found for {direction}
                    </h3>
                    <p className="empty-desc">
                        Please assign at least one bus to your routes in Route Management, then click "✓ OK".
                    </p>
                    <button
                        type="button"
                        className="btn-goto-routes"
                        onClick={() => navigate("/routes")}
                    >
                        Go to Route Management →
                    </button>
                </div>
            ) : (
                <div className="route-cards-list">
                    {routes.map((route, idx) => {
                        const vehicleName = route.vehicleName || route.assignedVehicle?.vehicleName || "Assigned Bus";
                        const capacity = Number(route.capacity || route.assignedVehicle?.capacity || 0);
                        const assignedUsers = Number(route.assignedUsers ?? route.users?.length ?? 0);
                        const remainingSeats = route.remainingSeats ?? Math.max(0, capacity - assignedUsers);

                        const stops = Array.isArray(route.stops) ? route.stops : (Array.isArray(route.routeStops) ? route.routeStops : []);

                        return (
                            <div className="manual-route-card" key={route._id || route.routeId || idx}>
                                <div className="manual-route-top">
                                    <div className="route-meta-title">
                                        <div className="route-badge-number">
                                            {idx + 1}
                                        </div>
                                        <div>
                                            <h4 className="route-name-title">
                                                {route.routeName || `Route ${idx + 1}`}
                                            </h4>
                                            <span className="route-code-sub">
                                                LINE CODE: {route.routeCode || `R-${String(idx + 1).padStart(2, "0")}`} • DIRECTION: {route.direction || direction}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="assigned-bus-box">
                                        <span className="bus-icon">🚌</span>
                                        <div className="bus-details-text">
                                            <strong>{vehicleName}</strong>
                                            <span>{assignedUsers} / {capacity} seats allocated</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="route-stats-pill-row">
                                    <span className={`stat-pill ${remainingSeats > 0 ? "seats-left" : "seats-full"}`}>
                                        {remainingSeats > 0 ? `+${remainingSeats} standby seats available` : "Bus full (0 seats left)"}
                                    </span>
                                    <span style={{ color: "#64748b" }}>
                                        {stops.length} stopping points
                                    </span>
                                    {route.distanceKm && (
                                        <span style={{ color: "#64748b" }}>
                                            • {route.distanceKm} km
                                        </span>
                                    )}
                                </div>

                                <div className="stops-progression-box">
                                    <span className="stops-progression-label">Ordered Stop Progression &amp; Boarding Demand</span>
                                    <div className="stops-chain">
                                        {stops.length === 0 ? (
                                            <span style={{ fontSize: "12px", color: "#94a3b8" }}>Stops not configured</span>
                                        ) : (
                                            stops.map((st, sIdx) => (
                                                <React.Fragment key={sIdx}>
                                                    <span className={`stop-tag ${st.isHub || st.routePointType === "hub" ? "hub" : ""}`}>
                                                        {st.isHub ? "🏛️" : `#${sIdx + 1}`} {st.name || st.stopName}
                                                        {st.userCount > 0 && (
                                                            <span className="boarding-count-tag">
                                                                ({st.userCount} boarding)
                                                            </span>
                                                        )}
                                                    </span>
                                                    {sIdx < stops.length - 1 && (
                                                        <span className="stop-arrow">→</span>
                                                    )}
                                                </React.Fragment>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Reset Confirmation Modal */}
            {showResetModal && (
                <div style={{
                    position: "fixed",
                    top: 0, left: 0, right: 0, bottom: 0,
                    background: "rgba(15, 23, 42, 0.6)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    zIndex: 9999, padding: "20px"
                }}>
                    <div style={{
                        background: "#ffffff",
                        borderRadius: "12px",
                        maxWidth: "480px",
                        width: "100%",
                        padding: "24px",
                        boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)"
                    }}>
                        <h3 style={{ margin: "0 0 12px 0", color: "#be123c", fontSize: "18px" }}>
                            ⚠️ Reset {direction} Manual Plan Allocations?
                        </h3>
                        <p style={{ margin: "0 0 20px 0", fontSize: "14px", color: "#475569", lineHeight: "1.5" }}>
                            Are you sure you want to remove all student allocations for the <strong>{direction}</strong> manual plan? This will unassign seats from students, but your routes and buses in Route Management will <strong>not</strong> be deleted.
                        </p>
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                            <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => setShowResetModal(false)}
                                disabled={resetting}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                style={{
                                    padding: "10px 18px",
                                    background: "#e11d48",
                                    color: "#ffffff",
                                    border: "none",
                                    borderRadius: "8px",
                                    fontWeight: "700",
                                    fontSize: "13px",
                                    cursor: resetting ? "not-allowed" : "pointer"
                                }}
                                onClick={handleResetAllocations}
                                disabled={resetting}
                            >
                                {resetting ? "Resetting..." : "Yes, Reset Allocations"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminManualPlan;
