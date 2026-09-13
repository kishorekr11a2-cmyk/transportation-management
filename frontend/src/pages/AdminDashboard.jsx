import React, { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  HiUsers,
  HiArrowLeft,
  HiArrowRight,
  HiExclamationTriangle,
  HiXMark,
} from "react-icons/hi2";
import {
  MdDirectionsBus,
  MdRoute,
  MdCalendarMonth,
  MdUploadFile,
} from "react-icons/md";
import { TbBrandOpenai } from "react-icons/tb";
import api from "../services/api";
import "../css/AdminDashboard.css";

const AdminDashboard = () => {
  const navigate = useNavigate();
  // Always read from the admin-specific key written by AdminLogin.
  // Never use the generic "user" key — that is shared with student sessions
  // and would show a student's userId (e.g. USR1007) here instead.
  const adminUser = JSON.parse(localStorage.getItem("admin_user"));
  // The Admin Dashboard identity is always the admin control panel identity.
  // Display "ADMIN" as the identifier and "Administrator" as the role label,
  // regardless of what the underlying DB record's name field contains.
  const adminDisplayId   = "ADMIN";
  const adminDisplayRole = "Administrator";

  const [lateData, setLateData] = useState({
    lateComingResponsesCount: 0,
    pendingReallocationUsersCount: 0,
    affectedDirections: [],
    inwardCount: 0,
    outwardCount: 0,
    users: [],
  });
  const [showInspectModal, setShowInspectModal] = useState(false);

  const fetchLateResponses = useCallback(async () => {
    try {
      const res = await api.get("/users/late-responses");
      if (res.data?.success) {
        setLateData({
          lateComingResponsesCount: res.data.lateComingResponsesCount || 0,
          pendingReallocationUsersCount: res.data.pendingReallocationUsersCount || 0,
          affectedDirections: res.data.affectedDirections || [],
          inwardCount: res.data.inwardCount || 0,
          outwardCount: res.data.outwardCount || 0,
          users: res.data.users || [],
        });
      }
    } catch (err) {
      console.warn("Failed to fetch late travel responses:", err);
    }
  }, []);

  useEffect(() => {
    fetchLateResponses();

    const handleSync = () => {
      if (document.visibilityState === "visible") {
        fetchLateResponses();
      }
    };

    window.addEventListener("focus", handleSync);
    document.addEventListener("visibilitychange", handleSync);

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        fetchLateResponses();
      }
    }, 15000);

    return () => {
      window.removeEventListener("focus", handleSync);
      document.removeEventListener("visibilitychange", handleSync);
      clearInterval(interval);
    };
  }, [fetchLateResponses]);

  return (
    <div className="admin-dashboard">

      {/* ── Header ── */}
      <header className="dash-header">
        <div className="dash-header__left">
          <button
            className="dash-back-btn"
            onClick={() => navigate(-1)}
            aria-label="Go back"
          >
            <HiArrowLeft size={16} />
            Back
          </button>
          <div className="dash-brand">
            <span className="dash-brand__icon">
              <MdDirectionsBus size={22} />
            </span>
            <div>
              <p className="dash-brand__label">AI Transportation Management</p>
              <h1 className="dash-brand__title">Admin Dashboard</h1>
            </div>
          </div>
        </div>

        <div className="dash-header__right">
          <div className="dash-admin-badge">
            <div className="dash-admin-avatar" aria-hidden="true">
              A
            </div>
            <div className="dash-admin-info">
              <span className="dash-admin-name">{adminDisplayId}</span>
              <span className="dash-admin-role">{adminDisplayRole}</span>
            </div>
          </div>
        </div>
      </header>

      {/* ── Page intro ── */}
      <div className="dash-intro">
        <h2 className="dash-intro__heading">Manage your college transportation system</h2>
        <p className="dash-intro__sub">Select a module below to open its management interface.</p>
      </div>

      {/* ── Late Travel Response Alert Card (High-Priority Alert) ── */}
      {lateData.pendingReallocationUsersCount > 0 && (
        <section className="dash-late-alert-container" aria-label="Late Travel Responses Alert">
          <div className="dash-late-alert-card" role="alert">
            <div className="dash-late-alert-header">
              <div className="dash-late-alert-title-wrap">
                <div className="dash-late-alert-icon-box">
                  <HiExclamationTriangle size={26} />
                </div>
                <div>
                  <div className="dash-late-alert-badge">ACTION REQUIRED</div>
                  <h3 className="dash-late-alert-heading">Late Travel Responses Detected</h3>
                  <p className="dash-late-alert-sub">
                    {lateData.pendingReallocationUsersCount} student{lateData.pendingReallocationUsersCount > 1 ? "s" : ""} submitted travel responses after the AI transportation plan was approved. Bus allocations are safely withheld to avoid vehicle overloading.
                  </p>
                </div>
              </div>
              <div className="dash-late-alert-actions">
                <button
                  type="button"
                  className="dash-late-btn dash-late-btn--inspect"
                  onClick={() => setShowInspectModal(true)}
                  id="btn-inspect-late-users"
                >
                  Inspect Users ({lateData.pendingReallocationUsersCount})
                </button>
                <button
                  type="button"
                  className="dash-late-btn dash-late-btn--reallocate"
                  onClick={() => navigate("/ai-agent")}
                  id="btn-reallocate-ai"
                >
                  Reset &amp; Regenerate Plan &rarr;
                </button>
              </div>
            </div>

            <div className="dash-late-chips">
              <div className="dash-late-chip">
                <span className="dash-late-chip__label">Late Coming Responses</span>
                <span className="dash-late-chip__val dash-late-chip__val--warning">
                  {lateData.lateComingResponsesCount}
                </span>
              </div>
              <div className="dash-late-chip">
                <span className="dash-late-chip__label">Pending Reallocation</span>
                <span className="dash-late-chip__val dash-late-chip__val--danger">
                  {lateData.pendingReallocationUsersCount}
                </span>
              </div>
              <div className="dash-late-chip">
                <span className="dash-late-chip__label">Affected Direction(s)</span>
                <div className="dash-late-chip__dirs">
                  {lateData.affectedDirections && lateData.affectedDirections.length > 0 ? (
                    lateData.affectedDirections.map((dir) => (
                      <span key={dir} className={`dash-dir-tag dash-dir-tag--${dir.toLowerCase()}`}>
                        {dir} ({dir === "INWARD" ? lateData.inwardCount : lateData.outwardCount})
                      </span>
                    ))
                  ) : (
                    <span className="dash-dir-tag dash-dir-tag--none">None</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── Bento Grid ── */}
      <main className="bento-grid" aria-label="Admin modules">

        {/* ── Users — primary card ── */}
        <Link to="/users" className="bento-card bento-card--users" aria-label="Open User Management">
          <div className="bento-card__header">
            <div className="bento-card__icon-wrap" aria-hidden="true">
              <HiUsers size={28} />
            </div>
            <span className="bento-card__tag">Users</span>
          </div>
          <div className="bento-card__body">
            <h3 className="bento-card__title">Users</h3>
            <p className="bento-card__desc">
              Manage users, travel information and stopping areas.
            </p>
          </div>
          <div className="bento-card__action">
            <span className="bento-card__action-text">Open Management</span>
            <span className="bento-card__arrow" aria-hidden="true">
              <HiArrowRight size={16} />
            </span>
          </div>
          <div className="bento-card__deco" aria-hidden="true" />
        </Link>

        {/* ── Vehicles — primary card ── */}
        <Link to="/vehicles" className="bento-card bento-card--vehicles" aria-label="Open Vehicle Management">
          <div className="bento-card__header">
            <div className="bento-card__icon-wrap" aria-hidden="true">
              <MdDirectionsBus size={28} />
            </div>
            <span className="bento-card__tag">Fleet</span>
          </div>
          <div className="bento-card__body">
            <h3 className="bento-card__title">Vehicles</h3>
            <p className="bento-card__desc">
              Manage the transportation fleet and vehicle configuration.
            </p>
          </div>
          <div className="bento-card__action">
            <span className="bento-card__action-text">Open Management</span>
            <span className="bento-card__arrow" aria-hidden="true">
              <HiArrowRight size={16} />
            </span>
          </div>
          <div className="bento-card__deco" aria-hidden="true" />
        </Link>

        {/* ── Routes — secondary card ── */}
        <Link to="/routes" className="bento-card bento-card--routes" aria-label="Open Route Management">
          <div className="bento-card__header">
            <div className="bento-card__icon-wrap" aria-hidden="true">
              <MdRoute size={26} />
            </div>
            <span className="bento-card__tag">Routes</span>
          </div>
          <div className="bento-card__body">
            <h3 className="bento-card__title">Routes</h3>
            <p className="bento-card__desc">
              Create and manage manual transportation routes and stops.
            </p>
          </div>
          <div className="bento-card__action">
            <span className="bento-card__action-text">Open Route Management</span>
            <span className="bento-card__arrow" aria-hidden="true">
              <HiArrowRight size={16} />
            </span>
          </div>
        </Link>

        {/* ── Schedule — secondary card ── */}
        <Link to="/schedule" className="bento-card bento-card--schedule" aria-label="Open Schedule Management">
          <div className="bento-card__header">
            <div className="bento-card__icon-wrap" aria-hidden="true">
              <MdCalendarMonth size={26} />
            </div>
            <span className="bento-card__tag">Schedule</span>
          </div>
          <div className="bento-card__body">
            <h3 className="bento-card__title">Schedule</h3>
            <p className="bento-card__desc">
              Manage bus timings and vehicle schedule availability.
            </p>
          </div>
          <div className="bento-card__action">
            <span className="bento-card__action-text">Open Schedule</span>
            <span className="bento-card__arrow" aria-hidden="true">
              <HiArrowRight size={16} />
            </span>
          </div>
        </Link>

        {/* ── Excel Upload — utility card ── */}
        <Link to="/excel-upload" className="bento-card bento-card--excel" aria-label="Open Excel Upload">
          <div className="bento-card__header">
            <div className="bento-card__icon-wrap" aria-hidden="true">
              <MdUploadFile size={26} />
            </div>
            <span className="bento-card__tag">Import</span>
          </div>
          <div className="bento-card__body">
            <h3 className="bento-card__title">Excel Upload</h3>
            <p className="bento-card__desc">
              Import transportation user data from Excel.
            </p>
          </div>
          <div className="bento-card__action">
            <span className="bento-card__action-text">Upload Data</span>
            <span className="bento-card__arrow" aria-hidden="true">
              <HiArrowRight size={16} />
            </span>
          </div>
        </Link>

        {/* ── AI Agent — featured card ── */}
        <Link to="/ai-agent" className="bento-card bento-card--ai" aria-label="Launch AI Agent">
          <div className="bento-card__ai-geo" aria-hidden="true">
            <span className="ai-geo-circle ai-geo-circle--1" />
            <span className="ai-geo-circle ai-geo-circle--2" />
          </div>
          <div className="bento-card__header">
            <div className="bento-card__icon-wrap bento-card__icon-wrap--ai" aria-hidden="true">
              <TbBrandOpenai size={28} />
            </div>
            <span className="bento-card__tag bento-card__tag--ai">AI</span>
          </div>
          <div className="bento-card__body">
            <h3 className="bento-card__title bento-card__title--ai">AI Route Optimization</h3>
            <p className="bento-card__desc">
              Analyze transportation demand and generate optimized route recommendations.
            </p>
            <p className="bento-card__ai-statement" aria-hidden="true">
              AI RECOMMENDS&nbsp;·&nbsp;ADMIN DECIDES
            </p>
          </div>
          <div className="bento-card__action">
            <span className="bento-card__action-text">Launch AI Agent</span>
            <span className="bento-card__arrow" aria-hidden="true">
              <HiArrowRight size={16} />
            </span>
          </div>
        </Link>
      </main>

      {/* ── Inspect Users Modal ── */}
      {showInspectModal && (
        <div className="dash-modal-overlay" onClick={() => setShowInspectModal(false)}>
          <div className="dash-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="dash-modal-header">
              <div className="dash-modal-title-group">
                <div className="dash-modal-icon-badge">
                  <HiExclamationTriangle size={20} />
                </div>
                <div>
                  <h3 className="dash-modal-title">Passengers Requiring Reallocation</h3>
                  <p className="dash-modal-subtitle">
                    Showing {lateData.users.length} student{lateData.users.length > 1 ? "s" : ""} awaiting route regeneration
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="dash-modal-close"
                onClick={() => setShowInspectModal(false)}
                aria-label="Close modal"
              >
                <HiXMark size={20} />
              </button>
            </div>

            <div className="dash-modal-body">
              <div className="dash-modal-info-banner">
                <span className="dash-modal-info-icon">ℹ️</span>
                <p>
                  These students switched from <strong>Pending</strong> to <strong>Coming</strong> after an active route plan was locked. To maintain vehicle safety and seat balance, their allocation is set to <em>Pending Reallocation</em> with no bus allocated until an administrator regenerates the route plan.
                </p>
              </div>

              <div className="dash-table-wrapper">
                <table className="dash-inspect-table">
                  <thead>
                    <tr>
                      <th>User ID</th>
                      <th>Name</th>
                      <th>Stopping Area</th>
                      <th>Response Time</th>
                      <th>Affected Direction</th>
                      <th>Allocation Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lateData.users.length === 0 ? (
                      <tr>
                        <td colSpan="6" style={{ textAlign: "center", padding: "2rem" }}>
                          No pending reallocation students found.
                        </td>
                      </tr>
                    ) : (
                      lateData.users.map((u) => (
                        <tr key={u._id || u.userId}>
                          <td><span className="dash-uid-pill">{u.userId}</span></td>
                          <td className="dash-uname"><strong>{u.name}</strong></td>
                          <td>{u.stoppings || "Not Specified"}</td>
                          <td className="dash-time">
                            {u.lateResponseAt
                              ? new Date(u.lateResponseAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                              : "Recently"}
                          </td>
                          <td>
                            {(u.affectedDirections || []).map((dir) => (
                              <span key={dir} className={`dash-dir-tag dash-dir-tag--${dir.toLowerCase()}`}>
                                {dir}
                              </span>
                            ))}
                          </td>
                          <td>
                            <span className="dash-status-pending-realloc">
                              ⏳ Pending Reallocation
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="dash-modal-footer">
              <button
                type="button"
                className="dash-modal-btn dash-modal-btn--secondary"
                onClick={() => setShowInspectModal(false)}
              >
                Close
              </button>
              <button
                type="button"
                className="dash-modal-btn dash-modal-btn--primary"
                onClick={() => {
                  setShowInspectModal(false);
                  navigate("/ai-agent");
                }}
              >
                Go to AI Route Optimization &rarr;
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default AdminDashboard;