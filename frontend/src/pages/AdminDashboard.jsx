import React from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  HiUsers,
  HiArrowLeft,
  HiArrowRight,
} from "react-icons/hi2";
import {
  MdDirectionsBus,
  MdRoute,
  MdCalendarMonth,
  MdUploadFile,
} from "react-icons/md";
import { TbBrandOpenai } from "react-icons/tb";
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

    </div>
  );
};

export default AdminDashboard;