import React, { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  HiArrowRight,
  HiExclamationTriangle,
  HiXMark,
} from "react-icons/hi2";
import {
  MdDirectionsBus,
  MdLogout,
} from "react-icons/md";
import api from "../services/api";
import "../css/AdminDashboard.css";

// Local 3D Dashboard Illustrations
import userManagementImg from "../assets/dashboard/user-management.webp";
import vehicleManagementImg from "../assets/dashboard/vehicle-management.webp";
import routeManagementImg from "../assets/dashboard/route-management.webp";
import automationImg from "../assets/dashboard/automation.webp";
import aiOptimizationImg from "../assets/dashboard/ai-optimization.webp";
import finalDecisionImg from "../assets/dashboard/final-decision.webp";

const AdminDashboard = () => {
  const navigate = useNavigate();

  // The Admin Dashboard identity is always the admin control panel identity.
  const adminDisplayRole = "Administrator";

  const handleLogout = () => {
    try {
      sessionStorage.clear();
      localStorage.removeItem("admin_token");
      localStorage.removeItem("admin_user");
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      localStorage.removeItem("role");
    } catch (e) {}
    navigate("/");
  };

  const [lateData, setLateData] = useState({
    lateComingResponsesCount: 0,
    pendingReallocationUsersCount: 0,
    users: [],
  });
  const [showInspectModal, setShowInspectModal] = useState(false);

  // Lock page background scrolling when inspect modal is open
  useEffect(() => {
    if (showInspectModal) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [showInspectModal]);

  const fetchLateResponses = useCallback(async () => {
    try {
      const res = await api.get("/users/late-responses");
      if (res.data?.success) {
        const count = Number.isInteger(res.data.count) ? res.data.count : (res.data.lateComingResponsesCount || 0);
        setLateData({
          lateComingResponsesCount: count,
          pendingReallocationUsersCount: count,
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
    <div className="admin-dashboard studio-dashboard">

      {/* ── A. Minimal Floating Header (Option 1) ── */}
      <header className="dash-header studio-header">
        <div className="dash-header__left studio-header__left">
          <div className="dash-brand studio-brand">
            <span className="dash-brand__icon studio-brand__icon" aria-hidden="true">
              <MdDirectionsBus size={20} />
            </span>
            <div className="studio-brand__text">
              <h1 className="dash-brand__title studio-brand__title">TRANSPORTATION MANAGEMENT</h1>
              <p className="dash-brand__subtitle studio-brand__subtitle">Admin Workspace</p>
            </div>
          </div>
        </div>

        <div className="dash-header__right studio-header__right">
          <div className="dash-admin-badge studio-admin-badge" title="Administrator • Active Session">
            <div className="dash-admin-avatar studio-admin-avatar" aria-hidden="true">
              A
            </div>
            <div className="dash-admin-info studio-admin-info">
              <div className="studio-admin-name-row">
                <span className="dash-admin-role studio-admin-role">{adminDisplayRole}</span>
              </div>
              <div className="studio-admin-status-row">
                <span className="dash-admin-status-dot studio-status-dot" title="Active session" />
                <span className="studio-admin-status-text">Active Session</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="dash-logout-btn studio-nav-btn studio-logout-btn"
            onClick={handleLogout}
            title="Log Out"
            aria-label="Log out"
          >
            <MdLogout size={16} />
            <span>Logout</span>
          </button>
        </div>
      </header>

      {/* ── B. Coastal Welcome Section ── */}
      <section className="dash-intro studio-welcome" aria-label="Welcome Overview">
        <div className="studio-welcome__badge">
          <span className="studio-welcome__badge-dot" aria-hidden="true" />
          <span>ADMINISTRATOR WORKSPACE</span>
        </div>
        <h2 className="dash-intro__heading studio-welcome__heading">
          Manage. Connect. Optimize.
        </h2>
        <p className="dash-intro__sub studio-welcome__sub">
          Your transportation system, beautifully organized.
        </p>
      </section>

      {/* ── Late Travel Response Alert (Preserved Logic & Modal Trigger) ── */}
      {lateData.pendingReallocationUsersCount > 0 && (
        <section className="dash-late-alert-container studio-late-container" aria-label="Late Travel Responses Alert">
          <div className="dash-late-alert-card studio-late-card" role="alert">
            <div className="dash-late-alert-header">
              <div className="dash-late-alert-title-wrap">
                <div className="dash-late-alert-icon-box studio-late-icon" aria-hidden="true">
                  <HiExclamationTriangle size={22} />
                </div>
                <div className="dash-late-alert-info">
                  <div className="dash-late-alert-topline">
                    <span className="dash-late-alert-badge studio-late-badge">ACTION REQUIRED</span>
                    <h3 className="dash-late-alert-heading">Late Travel Responses Detected</h3>
                  </div>
                  <p className="dash-late-alert-sub">
                    {lateData.pendingReallocationUsersCount} student{lateData.pendingReallocationUsersCount > 1 ? "s" : ""} submitted travel responses after the AI plan was approved. Seat allocations are withheld for passenger safety.
                  </p>
                </div>
              </div>

              <div className="dash-late-chips">
                <div className="dash-late-chip studio-late-chip">
                  <span className="dash-late-chip__label">Late Coming</span>
                  <span className="dash-late-chip__val dash-late-chip__val--warning">
                    {lateData.lateComingResponsesCount}
                  </span>
                </div>
                <div className="dash-late-chip studio-late-chip">
                  <span className="dash-late-chip__label">Pending Reallocation</span>
                  <span className="dash-late-chip__val dash-late-chip__val--danger">
                    {lateData.pendingReallocationUsersCount}
                  </span>
                </div>
              </div>

              <div className="dash-late-alert-actions">
                <button
                  type="button"
                  className="dash-late-btn dash-late-btn--inspect studio-btn--inspect"
                  onClick={() => {
                    setShowInspectModal(true);
                    api.post("/users/acknowledge-late-notifications").catch(() => {});
                  }}
                  id="btn-inspect-late-users"
                >
                  Inspect Users ({lateData.pendingReallocationUsersCount})
                </button>
                <button
                  type="button"
                  className="dash-late-btn dash-late-btn--reallocate studio-btn--reallocate"
                  onClick={() => navigate("/ai-agent")}
                  id="btn-reallocate-ai"
                >
                  Reset &amp; Regenerate Plan &rarr;
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── C. Six Illustrated Navigation Scenes (Fullscreen 3x2 Grid) ── */}
      <main className="bento-grid studio-scenes-grid" aria-label="Transportation Management Modules">

        {/* ── Scene 1: User Management ── */}
        <Link
          to="/users"
          className="bento-card studio-scene studio-scene--users"
          aria-label="Open User Management"
          style={{ "--scene-idx": 0 }}
        >
          {/* TOP: Category Tag & Navigation Arrow */}
          <div className="studio-scene__meta">
            <span className="bento-card__tag studio-scene__tag">STUDENT ROSTER</span>
            <span className="bento-card__arrow studio-scene__arrow" aria-hidden="true">
              <HiArrowRight size={15} />
            </span>
          </div>

          {/* CENTER: One large new soft 3D illustration */}
          <div className="studio-scene__visual" aria-hidden="true">
            <img
              src={userManagementImg}
              alt="User Management Illustration"
              className="studio-scene__img"
              loading="eager"
            />
          </div>

          {/* BOTTOM: Title & Description */}
          <div className="studio-scene__content">
            <h3 className="bento-card__title studio-scene__title">User Management</h3>
            <p className="bento-card__desc studio-scene__desc">
              Manage student registrations, stopping locations, and live attendance status.
            </p>
          </div>
        </Link>

        {/* ── Scene 2: Vehicle Management ── */}
        <Link
          to="/vehicles"
          className="bento-card studio-scene studio-scene--vehicles"
          aria-label="Open Vehicle Management"
          style={{ "--scene-idx": 1 }}
        >
          {/* TOP: Category Tag & Navigation Arrow */}
          <div className="studio-scene__meta">
            <span className="bento-card__tag studio-scene__tag">FLEET &amp; CAPACITY</span>
            <span className="bento-card__arrow studio-scene__arrow" aria-hidden="true">
              <HiArrowRight size={15} />
            </span>
          </div>

          {/* CENTER: One large new soft 3D illustration */}
          <div className="studio-scene__visual" aria-hidden="true">
            <img
              src={vehicleManagementImg}
              alt="Vehicle Management Illustration"
              className="studio-scene__img"
              loading="eager"
            />
          </div>

          {/* BOTTOM: Title & Description */}
          <div className="studio-scene__content">
            <h3 className="bento-card__title studio-scene__title">Vehicle Management</h3>
            <p className="bento-card__desc studio-scene__desc">
              Inspect fleet capacity, seat configurations, and vehicle operational readiness.
            </p>
          </div>
        </Link>

        {/* ── Scene 3: Route Management ── */}
        <Link
          to="/routes"
          className="bento-card studio-scene studio-scene--routes"
          aria-label="Open Route Management"
          style={{ "--scene-idx": 2 }}
        >
          {/* TOP: Category Tag & Navigation Arrow */}
          <div className="studio-scene__meta">
            <span className="bento-card__tag studio-scene__tag">MANUAL PLANNING</span>
            <span className="bento-card__arrow studio-scene__arrow" aria-hidden="true">
              <HiArrowRight size={15} />
            </span>
          </div>

          {/* CENTER: One large new soft 3D illustration */}
          <div className="studio-scene__visual" aria-hidden="true">
            <img
              src={routeManagementImg}
              alt="Route Management Illustration"
              className="studio-scene__img"
              loading="eager"
            />
          </div>

          {/* BOTTOM: Title & Description */}
          <div className="studio-scene__content">
            <h3 className="bento-card__title studio-scene__title">Route Management</h3>
            <p className="bento-card__desc studio-scene__desc">
              Design custom paths, assign dedicated buses, and adjust transit stops.
            </p>
          </div>
        </Link>

        {/* ── Scene 4: Automation ── */}
        <Link
          to="/admin/automation"
          className="bento-card studio-scene studio-scene--automation"
          aria-label="Open Automation"
          style={{ "--scene-idx": 3 }}
        >
          {/* TOP: Category Tag & Navigation Arrow */}
          <div className="studio-scene__meta">
            <span className="bento-card__tag studio-scene__tag">WHATSAPP &amp; N8N</span>
            <span className="bento-card__arrow studio-scene__arrow" aria-hidden="true">
              <HiArrowRight size={15} />
            </span>
          </div>

          {/* CENTER: One large new soft 3D illustration */}
          <div className="studio-scene__visual" aria-hidden="true">
            <img
              src={automationImg}
              alt="Automation Illustration"
              className="studio-scene__img"
              loading="eager"
            />
          </div>

          {/* BOTTOM: Title & Description */}
          <div className="studio-scene__content">
            <h3 className="bento-card__title studio-scene__title">Automation</h3>
            <p className="bento-card__desc studio-scene__desc">
              Broadcast passenger status notifications and automated WhatsApp travel alerts.
            </p>
          </div>
        </Link>

        {/* ── Scene 5: AI Route Optimization ── */}
        <Link
          to="/ai-agent"
          className="bento-card studio-scene studio-scene--ai"
          aria-label="Launch AI Agent"
          style={{ "--scene-idx": 4 }}
        >
          {/* TOP: Category Tag & Navigation Arrow */}
          <div className="studio-scene__meta">
            <span className="bento-card__tag studio-scene__tag studio-scene__tag--ai">INTELLIGENT ROUTING</span>
            <span className="bento-card__arrow studio-scene__arrow" aria-hidden="true">
              <HiArrowRight size={15} />
            </span>
          </div>

          {/* CENTER: One large new soft 3D illustration */}
          <div className="studio-scene__visual" aria-hidden="true">
            <img
              src={aiOptimizationImg}
              alt="AI Route Optimization Illustration"
              className="studio-scene__img"
              loading="eager"
            />
          </div>

          {/* BOTTOM: Title & Description */}
          <div className="studio-scene__content">
            <h3 className="bento-card__title studio-scene__title">AI Route Optimization</h3>
            <p className="bento-card__desc studio-scene__desc">
              Calculate demand-balanced routes and optimize fleet mileage with AI.
            </p>
          </div>
        </Link>

        {/* ── Scene 6: Final Decision ── */}
        <Link
          to="/admin/plan-confirmation"
          className="bento-card studio-scene studio-scene--confirmation"
          aria-label="Open Plan Confirmation"
          style={{ "--scene-idx": 5 }}
        >
          {/* TOP: Category Tag & Navigation Arrow */}
          <div className="studio-scene__meta">
            <span className="bento-card__tag studio-scene__tag">OFFICIAL DISPATCH</span>
            <span className="bento-card__arrow studio-scene__arrow" aria-hidden="true">
              <HiArrowRight size={15} />
            </span>
          </div>

          {/* CENTER: One large new soft 3D illustration */}
          <div className="studio-scene__visual" aria-hidden="true">
            <img
              src={finalDecisionImg}
              alt="Final Decision Illustration"
              className="studio-scene__img"
              loading="eager"
            />
          </div>

          {/* BOTTOM: Title & Description */}
          <div className="studio-scene__content">
            <h3 className="bento-card__title studio-scene__title">Final Decision</h3>
            <p className="bento-card__desc studio-scene__desc">
              Review driver allocations, lock official operational routes, and dispatch.
            </p>
          </div>
        </Link>
      </main>

      {/* ── Inspect Users Modal (Preserved Functionality & Modern Styling) ── */}
      {showInspectModal && (
        <div className="dash-modal-overlay studio-modal-overlay" onClick={() => setShowInspectModal(false)}>
          <div className="dash-modal-card studio-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="dash-modal-header studio-modal-header">
              <div className="dash-modal-title-group">
                <div className="dash-modal-icon-badge studio-modal-icon">
                  <HiExclamationTriangle size={20} />
                </div>
                <div>
                  <h3 className="dash-modal-title studio-modal-title">Passengers Requiring Reallocation</h3>
                  <p className="dash-modal-subtitle">
                    Showing {lateData.users.length} student{lateData.users.length > 1 ? "s" : ""} awaiting route regeneration
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="dash-modal-close studio-modal-close"
                onClick={() => setShowInspectModal(false)}
                aria-label="Close modal"
              >
                <HiXMark size={20} />
              </button>
            </div>

            <div className="dash-modal-body studio-modal-body">
              <div className="dash-modal-info-banner studio-modal-info">
                <span className="dash-modal-info-icon" aria-hidden="true">ℹ️</span>
                <p>
                  These students switched from <strong>Pending</strong> to <strong>Coming</strong> after an active route plan was locked. To maintain vehicle safety and seat balance, their allocation is set to <em>Pending Reallocation</em> with no bus allocated until an administrator regenerates the route plan.
                </p>
              </div>

              <div className="dash-table-wrapper studio-table-wrapper">
                <table className="dash-inspect-table studio-inspect-table">
                  <thead>
                    <tr>
                      <th>User ID</th>
                      <th>Name</th>
                      <th>Stopping Area</th>
                      <th>Response Time</th>
                      <th>Allocation Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lateData.users.length === 0 ? (
                      <tr>
                        <td colSpan="5" style={{ textAlign: "center", padding: "2rem" }}>
                          No pending reallocation students found.
                        </td>
                      </tr>
                    ) : (
                      lateData.users.map((u) => (
                        <tr key={u._id || u.userId}>
                          <td><span className="dash-uid-pill studio-uid-pill">{u.userId}</span></td>
                          <td className="dash-uname"><strong>{u.name}</strong></td>
                          <td>{u.stoppings || "Not Specified"}</td>
                          <td className="dash-time">
                            {u.lateResponseAt || u.travelResponseSubmittedAt || u.responseSubmittedAt
                              ? new Date(u.lateResponseAt || u.travelResponseSubmittedAt || u.responseSubmittedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                              : "Recently"}
                          </td>
                          <td>
                            <span className="dash-status-pending-realloc studio-status-pending">
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

            <div className="dash-modal-footer studio-modal-footer">
              <button
                type="button"
                className="dash-modal-btn dash-modal-btn--secondary studio-modal-btn--sec"
                onClick={() => setShowInspectModal(false)}
              >
                Close
              </button>
              <button
                type="button"
                className="dash-modal-btn dash-modal-btn--primary studio-modal-btn--pri"
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