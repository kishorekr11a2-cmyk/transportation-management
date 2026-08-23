import React, { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import api from "../services/api";
import "../css/StudentDashboard.css";

const StudentDashboard = () => {
    const [student, setStudent] = useState(null);
    const [loading, setLoading] = useState(true);
    const [updating, setUpdating] = useState(false);

    const loadStudentData = async (showSpinner = false) => {
        try {
            if (showSpinner) {
                setLoading(true);
            }
            const response = await api.get("/users/me");

            if (response.data.success && response.data.user) {
                setStudent(response.data.user);

                try {
                    sessionStorage.setItem("user", JSON.stringify(response.data.user));
                    localStorage.setItem("student_user", JSON.stringify(response.data.user));
                    localStorage.setItem("user", JSON.stringify(response.data.user));
                } catch (e) {}
            }
        } catch (error) {
            console.error("Load Student Error:", error);
            if (showSpinner) {
                toast.error(
                    error.response?.data?.message ||
                    "Failed to load user information"
                );
            }
        } finally {
            if (showSpinner) {
                setLoading(false);
            }
        }
    };

    useEffect(() => {
        // Initial load with spinner
        loadStudentData(true);

        // Immediate background re-fetch when tab is focused or becomes visible
        const handleSync = () => {
            if (document.visibilityState === "visible") {
                loadStudentData(false);
            }
        };

        window.addEventListener("focus", handleSync);
        document.addEventListener("visibilitychange", handleSync);

        // Real-time background sync interval (polls every 5s for admin approvals / resets)
        const pollInterval = setInterval(() => {
            loadStudentData(false);
        }, 5000);

        return () => {
            window.removeEventListener("focus", handleSync);
            document.removeEventListener("visibilitychange", handleSync);
            clearInterval(pollInterval);
        };
    }, []);

    const handleTravelStatus = async (status) => {
        try {
            setUpdating(true);
            const response = await api.put("/users/travel-status", {
                travelStatus: status
            });

            if (response.data.success) {
                toast.success(response.data.message);
                // Reload full authoritative database data to refresh bus allocation
                await loadStudentData(false);
            }
        } catch (error) {
            console.error("Travel Status Error:", error);
            toast.error(
                error.response?.data?.message ||
                "Failed to update travel status"
            );
        } finally {
            setUpdating(false);
        }
    };

    if (loading) {
        return (
            <div className="student-dashboard">
                <div className="student-loading">
                    <div className="spinner"></div>
                    <h2>Loading user portal...</h2>
                </div>
            </div>
        );
    }

    if (!student) {
        return (
            <div className="student-dashboard">
                <h2>Unable to load user information</h2>
            </div>
        );
    }

    const allocatedBus = student.allocatedBus;
    const isAllocated = Boolean(allocatedBus?.isAllocated);

    return (
        <div className="student-dashboard">
            <div className="student-header">
                <div>
                    <h1>Welcome, {student.name}</h1>
                    <p className="student-subtitle">Transport Member Portal & Route Allocation</p>
                </div>
                <div className="header-status-badge">
                    <span className={`status-pill ${student.travelStatus?.toLowerCase().replace(/\s+/g, '-') || 'pending'}`}>
                        ● {student.travelStatus || "Status Pending"}
                    </span>
                </div>
            </div>

            <div className="student-cards">
                {/* 1. User Information Card */}
                <div className="student-card user-info-card">
                    <div className="card-header-line">
                        <h2>👤 User Information</h2>
                        <span className="role-tag">{student.role?.toUpperCase() || "STUDENT"}</span>
                    </div>

                    <div className="info-grid">
                        <div className="info-item">
                            <span className="info-label">User ID</span>
                            <span className="info-value">{student.userId}</span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Full Name</span>
                            <span className="info-value">{student.name}</span>
                        </div>
                        <div className="info-item full-width">
                            <span className="info-label">Registered Stopping Area</span>
                            <span className="info-value highlight">{student.stoppings || "Not assigned"}</span>
                        </div>
                    </div>
                </div>

                {/* 2. Travel Status Card */}
                <div className="student-card travel-status-card">
                    <div className="card-header-line">
                        <h2>🚍 Daily Travel Status</h2>
                        <span className={`status-tag ${student.travelStatus === "Coming" ? "tag-green" : student.travelStatus === "Not Coming" ? "tag-red" : "tag-amber"}`}>
                            {student.travelStatus || "Pending"}
                        </span>
                    </div>

                    <p className="card-desc">Confirm your travel intention so the AI routing engine can allocate your bus seat.</p>

                    {(!student.travelStatus || student.travelStatus === "Pending") && (
                        <div className="travel-buttons">
                            <button
                                type="button"
                                className="primary-btn btn-coming"
                                onClick={() => handleTravelStatus("Coming")}
                                disabled={updating}
                            >
                                {updating ? "Saving..." : "✓ I am Coming"}
                            </button>

                            <button
                                type="button"
                                className="primary-btn btn-not-coming"
                                onClick={() => handleTravelStatus("Not Coming")}
                                disabled={updating}
                            >
                                {updating ? "Saving..." : "✕ I am Not Coming"}
                            </button>
                        </div>
                    )}

                    {student.travelStatus === "Coming" && (
                        <div className="status-confirmed-box box-success locked-response">
                            <div className="status-icon">✓</div>
                            <div className="status-text-content">
                                <strong>Travel Confirmed: Coming</strong>
                                <p className="status-subtext">Your seat request is registered for today's transit schedule.</p>
                                <div className="status-lock-notice">
                                    <span className="lock-icon">🔒</span>
                                    <span>Your response has been submitted. You cannot change your response until the administrator resets it.</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {student.travelStatus === "Not Coming" && (
                        <div className="status-confirmed-box box-muted locked-response">
                            <div className="status-icon">✕</div>
                            <div className="status-text-content">
                                <strong>Travel Confirmed: Not Coming</strong>
                                <p className="status-subtext">You have opted out of travel for today. No bus seat will be reserved.</p>
                                <div className="status-lock-notice">
                                    <span className="lock-icon">🔒</span>
                                    <span>Your response has been submitted. You cannot change your response until the administrator resets it.</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* 3. Bus Information Card (Rich Admin-Approved Allocation View) */}
                <div className={`student-card bus-info-card full-width ${isAllocated ? 'bus-allocated' : ''}`}>
                    <div className="card-header-line">
                        <h2>🚌 {isAllocated ? "My Transportation" : "Transportation Status"}</h2>
                        {isAllocated ? (
                            <span className="allocation-badge badge-approved">
                                ✓ Admin Approved & Allocated
                            </span>
                        ) : (
                            <span className="allocation-badge badge-pending">
                                ⏳ Not Assigned
                            </span>
                        )}
                    </div>

                    {isAllocated ? (
                        <div className="bus-allocation-details">
                            <div className="bus-top-summary">
                                <div className="bus-hero-badge">
                                    <div className="hero-bus-number">{allocatedBus.vehicleName}</div>
                                    <div className="hero-route-code">{allocatedBus.routeCode}</div>
                                </div>
                                <div className="bus-hero-text">
                                    <h3 className="bus-route-title">{allocatedBus.routeName}</h3>
                                    <div className="bus-meta-tags">
                                        <span className="meta-pill sector-pill">📍 {allocatedBus.sectorName}</span>
                                        <span className="meta-pill capacity-pill">👥 {allocatedBus.assignedUsersCount} / {allocatedBus.capacity} Seats Allocated</span>
                                        {allocatedBus.tripMode && (
                                            <span className="meta-pill mode-pill">
                                                {allocatedBus.tripMode === "FROM_SOURCE" ? "🚀 Outward Drop-off" : "🏁 Inward Transit"}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="allocation-metrics-grid">
                                <div className="metric-box highlighted-stop-box">
                                    <span className="metric-label">Your Boarding Stop</span>
                                    <span className="metric-value stop-name">{allocatedBus.boardingStop}</span>
                                    <span className="metric-hint">Stop #{allocatedBus.stopOrder} of {allocatedBus.totalStops}</span>
                                </div>

                                <div className="metric-box">
                                    <span className="metric-label">Assigned Vehicle</span>
                                    <span className="metric-value">{allocatedBus.vehicleName}</span>
                                    <span className="metric-hint">Total Capacity: {allocatedBus.capacity}</span>
                                </div>

                                <div className="metric-box">
                                    <span className="metric-label">Route Line Code</span>
                                    <span className="metric-value">{allocatedBus.routeCode}</span>
                                    <span className="metric-hint">{allocatedBus.sectorName}</span>
                                </div>

                                <div className="metric-box">
                                    <span className="metric-label">Seat Allocation Status</span>
                                    <span className="metric-value status-active">✓ Confirmed</span>
                                    <span className="metric-hint">{allocatedBus.remainingSeats} standby seats left</span>
                                </div>
                            </div>

                            {Array.isArray(allocatedBus.routeStops) && allocatedBus.routeStops.length > 0 && (
                                <div className="route-roadmap-section">
                                    <h4>🛣️ Route Stopping Progression</h4>
                                    <div className="roadmap-flow">
                                        {allocatedBus.routeStops.map((st, idx) => (
                                            <div 
                                                key={idx} 
                                                className={`roadmap-step ${st.isUserStop ? 'active-user-stop' : ''}`}
                                            >
                                                <div className="step-circle">
                                                    {st.isUserStop ? "★" : st.order || idx + 1}
                                                </div>
                                                <div className="step-content">
                                                    <div className="step-name">
                                                        {st.name}
                                                        {st.isUserStop && <span className="your-stop-pill">You Board Here</span>}
                                                    </div>
                                                    {st.legDistanceKm > 0 && (
                                                        <div className="step-dist">+{st.legDistanceKm} km</div>
                                                    )}
                                                </div>
                                                {idx < allocatedBus.routeStops.length - 1 && (
                                                    <div className="step-connector"></div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="bus-unallocated-state">
                            <div className="unallocated-icon">🚌</div>
                            <h3>Transportation Not Assigned</h3>
                            <p className="unallocated-desc">
                                {allocatedBus?.message ||
                                    (student.travelStatus === "Coming"
                                        ? "Waiting for the administrator to finalize your transportation plan."
                                        : "Bus allocation will appear here after confirmation and admin approval.")}
                            </p>
                            {student.travelStatus === "Coming" && (
                                <div className="status-flow-hint">
                                    <span className="flow-step done">✓ Travel Confirmed: Coming</span>
                                    <span className="flow-arrow">→</span>
                                    <span className="flow-step current">⏳ Admin Route Plan Approval</span>
                                    <span className="flow-arrow">→</span>
                                    <span className="flow-step">🚌 Bus Seat Assignment</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default StudentDashboard;