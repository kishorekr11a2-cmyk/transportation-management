import React, { useEffect, useState, useRef } from "react";
import { toast } from "react-hot-toast";
import api from "../services/api";
import "../css/StudentDashboard.css";

const StudentDashboard = () => {
    const [student, setStudent] = useState(() => {
        try {
            const raw = sessionStorage.getItem("user") || localStorage.getItem("student_user") || localStorage.getItem("user");
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    });
    const [loading, setLoading] = useState(() => {
        try {
            const raw = sessionStorage.getItem("user") || localStorage.getItem("student_user") || localStorage.getItem("user");
            return !raw;
        } catch {
            return true;
        }
    });
    const [updating, setUpdating] = useState(false);
    const [submittingStatus, setSubmittingStatus] = useState(null);
    const isSubmittingRef = useRef(false);

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
        // Initial load: show spinner only if no cached student session was present
        const hasCachedSession = Boolean(
            sessionStorage.getItem("user") ||
            localStorage.getItem("student_user") ||
            localStorage.getItem("user")
        );
        loadStudentData(!hasCachedSession);

        // Immediate background re-fetch when tab is focused or becomes visible
        const handleSync = () => {
            if (document.visibilityState === "visible" && !isSubmittingRef.current) {
                loadStudentData(false);
            }
        };

        window.addEventListener("focus", handleSync);
        document.addEventListener("visibilitychange", handleSync);

        // Real-time background sync interval (checks every 15s when active, instant sync on focus)
        const pollInterval = setInterval(() => {
            if (document.visibilityState === "visible" && !isSubmittingRef.current) {
                loadStudentData(false);
            }
        }, 15000);

        return () => {
            window.removeEventListener("focus", handleSync);
            document.removeEventListener("visibilitychange", handleSync);
            clearInterval(pollInterval);
        };
    }, []);

    const handleTravelStatus = async (status) => {
        // 1. Immediate double-click & duplicate request prevention
        if (isSubmittingRef.current || updating) {
            console.warn("[Timing] Duplicate submission attempt blocked.");
            return;
        }

        const tClick = performance.now();
        console.log(`[Timing] Button Click (${status}) at: ${new Date().toISOString()}`);

        isSubmittingRef.current = true;
        setUpdating(true);
        setSubmittingStatus(status);

        try {
            const tApiStart = performance.now();
            console.log(`[Timing] API Request Start (${status}): +${(tApiStart - tClick).toFixed(2)}ms`);

            // Single API request
            const response = await api.put("/users/travel-status", {
                travelStatus: status
            });

            const tApiEnd = performance.now();
            console.log(`[Timing] API Response Received: status ${response.status} in ${(tApiEnd - tApiStart).toFixed(2)}ms`);

            if (response.data?.success) {
                // 2. Immediate local UI update directly from backend response without full reload
                const backendUser = response.data.user;
                const updatedUser = backendUser ? {
                    ...student,
                    ...backendUser
                } : {
                    ...student,
                    travelStatus: response.data.travelStatus || status,
                    allocationStatus: response.data.allocationStatus || student?.allocationStatus || "Not Assigned",
                    requiresReallocation: response.data.lateResponse ?? student?.requiresReallocation,
                    affectedDirections: response.data.affectedDirections || student?.affectedDirections || []
                };

                setStudent(updatedUser);

                try {
                    sessionStorage.setItem("user", JSON.stringify(updatedUser));
                    localStorage.setItem("student_user", JSON.stringify(updatedUser));
                    localStorage.setItem("user", JSON.stringify(updatedUser));
                } catch (e) {}

                const tUiDone = performance.now();
                console.log(`[Timing] UI Update Completed: total ${(tUiDone - tClick).toFixed(2)}ms`);

                toast.success(response.data.message || `Travel response confirmed: ${status}`);
            }
        } catch (error) {
            const tError = performance.now();
            console.error(`[Timing] Travel Status Error after ${(tError - tClick).toFixed(2)}ms:`, error);

            const httpStatus = error.response?.status;
            const msg = error.response?.data?.message || error.message || "Failed to update travel status";

            // Requirement 5: If backend returns 400/409 "Travel status already submitted"
            if (
                (httpStatus === 400 || httpStatus === 409) &&
                (msg.toLowerCase().includes("already submitted") || error.response?.data?.responseLocked)
            ) {
                toast.error(msg);
                // Stop loading state and fetch latest authoritative status only once
                await loadStudentData(false);
            } else {
                toast.error(msg);
            }
        } finally {
            isSubmittingRef.current = false;
            setUpdating(false);
            setSubmittingStatus(null);
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
    const affectedDirections = Array.isArray(student.affectedDirections) ? student.affectedDirections : [];
    const isPendingReallocation =
        student.allocationStatus === "Pending Reallocation" ||
        Boolean(student.requiresReallocation);

    // Strict direction-specific verification:
    // Only consider inward allocated if inward is explicitly present, approved, allocated, AND not in affectedDirections
    const inwardAlloc = (!affectedDirections.includes("INWARD") && allocatedBus?.inward && (allocatedBus.inward.approved === true || allocatedBus.inward.adminApprovalStatus === "Approved") && allocatedBus.inward.isAllocated)
        ? allocatedBus.inward
        : null;

    // Only consider outward allocated if outward is explicitly present, approved, allocated, AND not in affectedDirections
    const outwardAlloc = (!affectedDirections.includes("OUTWARD") && allocatedBus?.outward && (allocatedBus.outward.approved === true || allocatedBus.outward.adminApprovalStatus === "Approved") && allocatedBus.outward.isAllocated)
        ? allocatedBus.outward
        : null;

    const isInwardPendingRealloc = affectedDirections.includes("INWARD");
    const isOutwardPendingRealloc = affectedDirections.includes("OUTWARD");

    const isAllocated = Boolean(inwardAlloc || outwardAlloc);

    const renderPendingDirectionNotice = (title, subtitle, icon, dir) => (
        <div className="bus-pending-realloc-card" key={dir}>
            <div className="pending-realloc-header">
                <div className="dir-indicator-label">
                    <span>{icon}</span>
                    <span>{title}</span>
                    <span className="dir-sub">({subtitle})</span>
                </div>
                <span className="pending-realloc-badge">
                    ⏳ Allocation Pending
                </span>
            </div>
            <div className="pending-realloc-body">
                <div className="pending-realloc-warning-icon">⚠️</div>
                <div>
                    <h4 className="pending-realloc-heading">Transportation Allocation Pending</h4>
                    <p className="pending-realloc-desc">
                        Your response <strong>Coming</strong> was submitted after the {dir.toLowerCase()} route plan was approved.
                        Your boarding stop (<strong>{student.stoppings || "Not Specified"}</strong>) has been queued for inclusion in the upcoming route recalculation.
                    </p>
                    <p className="pending-realloc-sub">
                        To maintain fleet capacity limits, your bus and seat will be finalized once the administrator resets and regenerates the {dir.toLowerCase()} plan.
                    </p>
                </div>
            </div>
        </div>
    );

    const renderDirectionDetails = (alloc, title, subtitle, icon) => {
        if (!alloc || !alloc.isAllocated) return null;
        return (
            <div className="bus-allocation-details" style={{ marginBottom: "28px" }} key={title}>
                <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "8px 14px",
                    background: "#f1f5f9",
                    borderRadius: "8px",
                    marginBottom: "16px",
                    fontSize: "14px",
                    fontWeight: "700",
                    color: "#1e293b"
                }}>
                    <span>{icon}</span>
                    <span>{title}</span>
                    <span style={{ color: "#64748b", fontWeight: "400", fontSize: "13px" }}>({subtitle})</span>
                </div>

                <div className="bus-top-summary">
                    <div className="bus-hero-badge">
                        <div className="hero-bus-number">{alloc.vehicleName}</div>
                        <div className="hero-route-code">{alloc.routeCode}</div>
                    </div>
                    <div className="bus-hero-text">
                        <h3 className="bus-route-title">{alloc.routeName}</h3>
                        <div className="bus-meta-tags">
                            <span className="meta-pill sector-pill">📍 {alloc.sectorName}</span>
                            <span className="meta-pill capacity-pill">👥 {alloc.assignedUsersCount} / {alloc.capacity} Seats Allocated</span>
                            {alloc.roadRouteStatus && (
                                <span className="meta-pill" style={{
                                    background: alloc.isRoadVerified ? "#dcfce7" : "#fef3c7",
                                    color: alloc.isRoadVerified ? "#15803d" : "#b45309"
                                }}>
                                    🛣️ {alloc.roadRouteStatus}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                <div className="allocation-metrics-grid">
                    <div className="metric-box highlighted-stop-box">
                        <span className="metric-label">Your Boarding Stop</span>
                        <span className="metric-value stop-name">{alloc.boardingStop}</span>
                        <span className="metric-hint">Stop #{alloc.stopOrder} of {alloc.totalStops}</span>
                    </div>

                    <div className="metric-box">
                        <span className="metric-label">Assigned Vehicle</span>
                        <span className="metric-value">{alloc.vehicleName}</span>
                        <span className="metric-hint">Total Capacity: {alloc.capacity}</span>
                    </div>

                    <div className="metric-box">
                        <span className="metric-label">Route Line Code</span>
                        <span className="metric-value">{alloc.routeCode}</span>
                        <span className="metric-hint">{alloc.sectorName}</span>
                    </div>

                    <div className="metric-box">
                        <span className="metric-label">Seat Allocation Status</span>
                        <span className="metric-value status-active">
                            {alloc.seatNumber ? `✓ Seat #${alloc.seatNumber}` : "✓ Confirmed"}
                        </span>
                        <span className="metric-hint">
                            {alloc.remainingSeats} standby seats left on bus
                        </span>
                    </div>
                </div>

                {Array.isArray(alloc.routeStops) && alloc.routeStops.length > 0 && (
                    <div className="route-roadmap-section">
                        <h4>🛣️ Route Stopping Progression</h4>
                        <div className="roadmap-flow">
                            {alloc.routeStops.map((st, idx) => (
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
                                    {idx < alloc.routeStops.length - 1 && (
                                        <div className="step-connector"></div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    };

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
                        <div className="info-item">
                            <span className="info-label">Email Address</span>
                            <span className="info-value">{student.email}</span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Registered Stop</span>
                            <span className="info-value stop-highlight">{student.stoppings || "Not Specified"}</span>
                        </div>
                    </div>
                </div>

                {/* 2. Travel Status Selection Card */}
                <div className="student-card travel-status-card">
                    <div className="card-header-line">
                        <h2>🚦 Daily Travel Response</h2>
                        <span className={`badge ${student.travelStatus === 'Coming' ? 'badge-success' : (student.travelStatus === 'Not Coming' ? 'badge-danger' : 'badge-warning')}`}>
                            {student.travelStatus || "Pending"}
                        </span>
                    </div>

                    <p className="card-desc">
                        Your attendance response directly determines dynamic fleet sizing and seat allocation on college bus routes.
                    </p>

                    <div className="travel-response-buttons-grid">
                        {/* Coming Today Card */}
                        <button
                            type="button"
                            className={`travel-response-card card-coming ${
                                student.travelStatus === "Coming" ? "is-selected" : ""
                            } ${
                                student.travelStatus === "Not Coming" ? "is-unselected" : ""
                            } ${
                                updating && submittingStatus === "Coming" ? "is-submitting" : ""
                            }`}
                            onClick={() => handleTravelStatus("Coming")}
                            disabled={updating || isSubmittingRef.current || student.travelStatus === "Coming"}
                            aria-pressed={student.travelStatus === "Coming"}
                            aria-busy={updating && submittingStatus === "Coming"}
                        >
                            <div className="travel-btn-header">
                                <span className="travel-btn-icon">
                                    {updating && submittingStatus === "Coming" ? (
                                        <span className="btn-spinner-icon" aria-hidden="true" />
                                    ) : (
                                        "✓"
                                    )}
                                </span>
                                <span className="travel-btn-title">
                                    {updating && submittingStatus === "Coming"
                                        ? "Submitting..."
                                        : "Coming Today"}
                                </span>
                                {student.travelStatus === "Coming" && (
                                    <span className="travel-btn-selected-badge">Selected</span>
                                )}
                            </div>
                            <div className="travel-btn-desc">
                                {updating && submittingStatus === "Coming"
                                    ? "Confirming your seat request..."
                                    : "I need college transportation today"}
                            </div>
                        </button>

                        {/* Not Coming Card */}
                        <button
                            type="button"
                            className={`travel-response-card card-not-coming ${
                                student.travelStatus === "Not Coming" ? "is-selected" : ""
                            } ${
                                student.travelStatus === "Coming" ? "is-unselected" : ""
                            } ${
                                updating && submittingStatus === "Not Coming" ? "is-submitting" : ""
                            }`}
                            onClick={() => handleTravelStatus("Not Coming")}
                            disabled={updating || isSubmittingRef.current || student.travelStatus === "Not Coming"}
                            aria-pressed={student.travelStatus === "Not Coming"}
                            aria-busy={updating && submittingStatus === "Not Coming"}
                        >
                            <div className="travel-btn-header">
                                <span className="travel-btn-icon">
                                    {updating && submittingStatus === "Not Coming" ? (
                                        <span className="btn-spinner-icon" aria-hidden="true" />
                                    ) : (
                                        "✕"
                                    )}
                                </span>
                                <span className="travel-btn-title">
                                    {updating && submittingStatus === "Not Coming"
                                        ? "Submitting..."
                                        : "Not Coming"}
                                </span>
                                {student.travelStatus === "Not Coming" && (
                                    <span className="travel-btn-selected-badge">Selected</span>
                                )}
                            </div>
                            <div className="travel-btn-desc">
                                {updating && submittingStatus === "Not Coming"
                                    ? "Opting out for today..."
                                    : "I do not need transportation today"}
                            </div>
                        </button>
                    </div>

                    {/* Status Feedback & Notice */}
                    {student.travelStatus && student.travelStatus !== "Pending" && (
                        <div className="travel-response-lock-box">
                            {student.travelStatus === "Coming" && isPendingReallocation && (
                                <div className="late-response-flag-alert">
                                    <span className="late-flag-icon">⚠️</span>
                                    <div className="late-flag-text">
                                        <strong>Late Travel Response Received</strong>
                                        <p>You confirmed travel after the route plan was approved. Your boarding stop is registered, and your seat will be assigned once the administrator reviews and regenerates the transportation plan.</p>
                                    </div>
                                </div>
                            )}

                            <div className="status-lock-notice">
                                <span className="lock-icon">{student.travelStatus === "Coming" ? "✓" : "ℹ️"}</span>
                                <span>
                                    {student.travelStatus === "Coming"
                                        ? "Your response is confirmed as Coming Today. You can change your status to Not Coming if your plans change."
                                        : "Your response is recorded as Not Coming. You can change your status to Coming Today if you need transportation."}
                                </span>
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
                                ✓ Admin Approved &amp; Allocated
                            </span>
                        ) : isPendingReallocation ? (
                            <span className="allocation-badge badge-pending-realloc">
                                ⏳ Pending Reallocation
                            </span>
                        ) : student.allocationStatus === "Unallocated" || allocatedBus?.unallocatedReason === "VEHICLE_CAPACITY" || allocatedBus?.reason === "VEHICLE_CAPACITY" ? (
                            <span className="allocation-badge" style={{ background: "#fef3c7", color: "#b45309", border: "1px solid #fde68a" }}>
                                ⚠️ Standby (Capacity Full)
                            </span>
                        ) : (
                            <span className="allocation-badge badge-pending">
                                ⏳ Not Assigned
                            </span>
                        )}
                    </div>

                    {isAllocated ? (
                        <div>
                            {inwardAlloc && renderDirectionDetails(
                                inwardAlloc,
                                "Inward Plan",
                                "Residential → College",
                                "📍"
                            )}
                            {isInwardPendingRealloc && !inwardAlloc && renderPendingDirectionNotice(
                                "Inward Plan",
                                "Residential → College",
                                "📍",
                                "INWARD"
                            )}
                            {outwardAlloc && renderDirectionDetails(
                                outwardAlloc,
                                "Outward Plan",
                                "College → Residential",
                                "📍"
                            )}
                            {isOutwardPendingRealloc && !outwardAlloc && renderPendingDirectionNotice(
                                "Outward Plan",
                                "College → Residential",
                                "📍",
                                "OUTWARD"
                            )}
                        </div>
                    ) : isPendingReallocation ? (
                        <div className="bus-pending-reallocation-state">
                            <div className="realloc-icon-box">⚠️</div>
                            <h3>Transportation Allocation Pending</h3>
                            <p className="realloc-desc">
                                Your travel response was confirmed as <strong>Coming</strong> after the active transportation plan was approved.
                            </p>
                            <p className="realloc-detail">
                                To prevent vehicle overcrowding and ensure proper seat availability, your bus and seat will be assigned as soon as the administrator resets and regenerates the route plan with updated passenger counts.
                            </p>
                            {affectedDirections.length > 0 && (
                                <div className="realloc-affected-dirs">
                                    <span className="realloc-affected-label">Affected Direction(s):</span>
                                    <div className="realloc-tags-row">
                                        {affectedDirections.map((dir) => (
                                            <span key={dir} className={`realloc-tag realloc-tag--${dir.toLowerCase()}`}>
                                                {dir === "INWARD" ? "Inward (Residential → College)" : "Outward (College → Residential)"}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <div className="status-flow-hint">
                                <span className="flow-step done">✓ Travel Confirmed: Coming</span>
                                <span className="flow-arrow">→</span>
                                <span className="flow-step current">⏳ Administrator Plan Regeneration</span>
                                <span className="flow-arrow">→</span>
                                <span className="flow-step">🚌 Bus &amp; Seat Assignment</span>
                            </div>
                        </div>
                    ) : (
                        <div className="bus-unallocated-state">
                            <div className="unallocated-icon">
                                {student.allocationStatus === "Unallocated" || allocatedBus?.unallocatedReason === "VEHICLE_CAPACITY" || allocatedBus?.reason === "VEHICLE_CAPACITY" ? "⚠️" : "🚌"}
                            </div>
                            <h3>
                                {student.allocationStatus === "Unallocated" || allocatedBus?.unallocatedReason === "VEHICLE_CAPACITY" || allocatedBus?.reason === "VEHICLE_CAPACITY"
                                    ? "Seat Capacity Full — Standby List"
                                    : "Transportation Not Assigned"}
                            </h3>
                            <p className="unallocated-desc">
                                {allocatedBus?.message || (student.travelStatus === "Coming" ? "Your travel is confirmed, but route plan is pending admin approval." : "No approved transportation plan available yet.")}
                            </p>
                            {student.travelStatus === "Coming" && (
                                <div className="status-flow-hint">
                                    <span className="flow-step done">✓ Travel Confirmed: Coming</span>
                                    <span className="flow-arrow">→</span>
                                    <span className="flow-step current">
                                        {student.allocationStatus === "Unallocated" || allocatedBus?.unallocatedReason === "VEHICLE_CAPACITY" || allocatedBus?.reason === "VEHICLE_CAPACITY"
                                            ? "⚠️ Standby: Awaiting Bus Reallocation"
                                            : "⏳ Admin Route Plan Approval"}
                                    </span>
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