import React, { useEffect, useState, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "react-hot-toast";
import {
  MdDirectionsBus,
  MdAdd,
  MdEdit,
  MdDelete,
  MdClose,
  MdRefresh,
  MdSearch
} from "react-icons/md";
import {
  FiTruck,
  FiCheckCircle,
  FiXCircle,
  FiLayers,
  FiCheck,
  FiX
} from "react-icons/fi";
import { HiArrowLeft } from "react-icons/hi2";

import api from "../services/api";
import "../css/VehicleManagement.css";

const VehicleManagement = ({ initialTab = "vehicles" }) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Tab state: "vehicles" | "schedules"
  const urlTab = searchParams.get("tab")?.toLowerCase();
  const defaultTab = urlTab === "schedule" || urlTab === "schedules" ? "schedules" : initialTab;
  const [activeTab, setActiveTab] = useState(defaultTab);

  // Sync tab with URL
  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  // Fleet & Schedule Data
  const [vehicles, setVehicles] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Search & Filter States
  const [searchQuery, setSearchQuery] = useState("");
  const [vehicleFilter, setVehicleFilter] = useState("ALL");
  const [scheduleFilter, setScheduleFilter] = useState("ALL");

  // Schedule fast-toggle loading tracker
  const [updatingScheduleId, setUpdatingScheduleId] = useState(null);

  // Vehicle Add / Edit Modal State
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [editingVehicleId, setEditingVehicleId] = useState(null);
  const [vehicleFormData, setVehicleFormData] = useState({
    vehicleName: "",
    capacity: ""
  });
  const [submittingVehicle, setSubmittingVehicle] = useState(false);

  // Vehicle Delete Confirmation Modal State
  const [vehicleToDelete, setVehicleToDelete] = useState(null);
  const [deletingVehicle, setDeletingVehicle] = useState(false);

  // ── Fetch Vehicles & Schedules ────────────────────────────
  const loadData = useCallback(async (showSpinner = false) => {
    try {
      if (showSpinner) setLoading(true);
      else setRefreshing(true);
      setError(null);

      const [vehicleRes, scheduleRes] = await Promise.all([
        api.get("/vehicles"),
        api.get("/schedules").catch(() => ({ data: { schedules: [] } }))
      ]);

      const vehicleData = vehicleRes.data?.vehicles || vehicleRes.data?.data || [];
      const scheduleData = scheduleRes.data?.schedules || [];

      setVehicles(vehicleData);
      setSchedules(scheduleData);
    } catch (err) {
      console.error("Failed to load fleet and schedules:", err);
      setError("Unable to connect to server to load fleet and schedule data.");
      if (showSpinner) {
        toast.error("Failed to load fleet and schedules");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Lifecycle & Background Sync
  useEffect(() => {
    let isMounted = true;
    loadData(true);

    const handleSync = () => {
      if (document.visibilityState === "visible" && isMounted && !showVehicleModal && !vehicleToDelete && !updatingScheduleId) {
        loadData(false);
      }
    };

    window.addEventListener("focus", handleSync);
    document.addEventListener("visibilitychange", handleSync);

    const pollInterval = setInterval(() => {
      if (document.visibilityState === "visible" && isMounted && !showVehicleModal && !vehicleToDelete && !updatingScheduleId) {
        loadData(false);
      }
    }, 15000);

    return () => {
      isMounted = false;
      window.removeEventListener("focus", handleSync);
      document.removeEventListener("visibilitychange", handleSync);
      clearInterval(pollInterval);
    };
  }, [loadData, showVehicleModal, vehicleToDelete, updatingScheduleId]);

  // ── Unified Vehicle & Schedule List ───────────────────────
  const vehicleScheduleList = useMemo(() => {
    const scheduleMap = new Map();
    schedules.forEach((s) => {
      const vId = String(s.vehicle?._id || s.vehicle || "");
      if (vId) scheduleMap.set(vId, s);
    });

    return vehicles.map((veh) => {
      const sched = scheduleMap.get(String(veh._id));
      const isAvailable = sched ? sched.availability === "Available" : true;
      return {
        ...veh,
        scheduleId: sched?._id || null,
        availability: isAvailable ? "Available" : "Not Available"
      };
    });
  }, [vehicles, schedules]);

  // ── Executive Metrics ─────────────────────────────────────
  const metrics = useMemo(() => {
    const total = vehicleScheduleList.length;
    const available = vehicleScheduleList.filter((v) => v.availability === "Available").length;
    const notAvailable = total - available;
    const totalCapacity = vehicleScheduleList.reduce((sum, v) => sum + (Number(v.capacity) || 0), 0);
    const availableCapacity = vehicleScheduleList
      .filter((v) => v.availability === "Available")
      .reduce((sum, v) => sum + (Number(v.capacity) || 0), 0);

    return {
      total,
      available,
      notAvailable,
      totalCapacity,
      availableCapacity
    };
  }, [vehicleScheduleList]);

  // ── Filtered Vehicles for Tab 1 (Vehicle Management) ──────
  const filteredVehicles = useMemo(() => {
    return vehicleScheduleList.filter((v) => {
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch = !q || v.vehicleName?.toLowerCase().includes(q) || String(v.capacity).includes(q);
      if (!matchesSearch) return false;

      if (vehicleFilter === "AVAILABLE") return v.availability === "Available";
      if (vehicleFilter === "NOT_AVAILABLE") return v.availability === "Not Available";
      return true;
    });
  }, [vehicleScheduleList, searchQuery, vehicleFilter]);

  // ── Filtered Schedules for Tab 2 (Schedule Management) ────
  const filteredSchedules = useMemo(() => {
    return vehicleScheduleList.filter((v) => {
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch = !q || v.vehicleName?.toLowerCase().includes(q) || String(v.capacity).includes(q);
      if (!matchesSearch) return false;

      if (scheduleFilter === "AVAILABLE") return v.availability === "Available";
      if (scheduleFilter === "NOT_AVAILABLE") return v.availability === "Not Available";
      return true;
    });
  }, [vehicleScheduleList, searchQuery, scheduleFilter]);

  // ── Vehicle Form Handlers (Add / Edit) ─────────────────────
  const openAddModal = () => {
    setEditingVehicleId(null);
    setVehicleFormData({ vehicleName: "", capacity: "" });
    setShowVehicleModal(true);
  };

  const openEditModal = (bus) => {
    setEditingVehicleId(bus._id);
    setVehicleFormData({
      vehicleName: bus.vehicleName,
      capacity: String(bus.capacity)
    });
    setShowVehicleModal(true);
  };

  const closeVehicleModal = () => {
    setShowVehicleModal(false);
    setEditingVehicleId(null);
    setVehicleFormData({ vehicleName: "", capacity: "" });
  };

  const handleVehicleFormSubmit = async (e) => {
    e.preventDefault();
    const name = vehicleFormData.vehicleName.trim();
    const cap = parseInt(vehicleFormData.capacity, 10);

    if (!name || isNaN(cap) || cap <= 0) {
      toast.error("Please enter a valid vehicle name and seat capacity");
      return;
    }

    try {
      setSubmittingVehicle(true);
      if (editingVehicleId) {
        const res = await api.put(`/vehicles/${editingVehicleId}`, {
          vehicleName: name,
          capacity: cap
        });
        toast.success(res.data?.message || "Vehicle updated successfully");
      } else {
        const res = await api.post("/vehicles", {
          vehicleName: name,
          capacity: cap
        });
        toast.success(res.data?.message || "Vehicle registered successfully");
      }

      closeVehicleModal();
      await loadData(false);
    } catch (err) {
      console.error("Vehicle save error:", err);
      toast.error(err.response?.data?.message || "Failed to save vehicle");
    } finally {
      setSubmittingVehicle(false);
    }
  };

  // ── Vehicle Delete Handlers ────────────────────────────────
  const confirmDelete = async () => {
    if (!vehicleToDelete) return;

    try {
      setDeletingVehicle(true);
      const res = await api.delete(`/vehicles/${vehicleToDelete._id}`);
      toast.success(res.data?.message || `Vehicle ${vehicleToDelete.vehicleName} deleted`);
      setVehicleToDelete(null);
      await loadData(false);
    } catch (err) {
      console.error("Vehicle delete error:", err);
      toast.error(err.response?.data?.message || "Failed to delete vehicle");
    } finally {
      setDeletingVehicle(false);
    }
  };

  // ── Schedule Availability Toggle ───────────────────────────
  const toggleScheduleAvailability = async (item) => {
    const newStatus = item.availability === "Available" ? "Not Available" : "Available";

    try {
      setUpdatingScheduleId(item._id);

      // Optimistic update of local schedules
      setSchedules((prev) => {
        const idx = prev.findIndex((s) => String(s.vehicle?._id || s.vehicle) === String(item._id));
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], availability: newStatus };
          return updated;
        }
        return [...prev, { vehicle: item, availability: newStatus }];
      });

      await api.post("/schedules", {
        vehicle: item._id,
        availability: newStatus
      });

      toast.success(`${item.vehicleName} marked as ${newStatus}`);
      await loadData(false);
    } catch (err) {
      console.error("Toggle availability error:", err);
      toast.error(err.response?.data?.message || "Failed to update availability");
      await loadData(false);
    } finally {
      setUpdatingScheduleId(null);
    }
  };

  // ── Bulk Set All Status ────────────────────────────────────
  const setAllStatus = async (status) => {
    try {
      setRefreshing(true);
      await Promise.all(
        vehicles.map((v) =>
          api.post("/schedules", {
            vehicle: v._id,
            availability: status
          })
        )
      );
      toast.success(`All vehicles marked as ${status}`);
      await loadData(false);
    } catch (err) {
      console.error("Bulk update error:", err);
      toast.error("Failed to update all vehicles");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="vm-page-container">
      {/* ── Top Navigation Bar ── */}
      <div className="vm-top-nav">
        <button
          type="button"
          className="vm-back-btn"
          onClick={() => navigate("/admin-dashboard")}
          aria-label="Back to Admin Dashboard"
        >
          <HiArrowLeft size={16} />
          Back to Dashboard
        </button>

        <div className="vm-nav-actions">
          <button
            type="button"
            className="vm-btn-refresh"
            onClick={() => loadData(false)}
            disabled={refreshing || loading}
            title="Refresh fleet data"
          >
            <MdRefresh size={16} className={refreshing ? "spin" : ""} />
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
          <button
            type="button"
            className="vm-btn-primary"
            onClick={openAddModal}
            title="Register a new fleet vehicle"
          >
            <MdAdd size={18} />
            Add Vehicle
          </button>
        </div>
      </div>

      {/* ── Main Page Header ── */}
      <header className="vm-main-header">
        <div>
          <span className="vm-header-badge">FLEET &amp; DISPATCH CONTROL</span>
          <h1 className="vm-header-title">Vehicle &amp; Schedule Management</h1>
          <p className="vm-header-subtitle">
            Manage transportation fleet assets, seat capacities, and daily operational availability.
          </p>
        </div>
      </header>

      {/* ── Executive Summary Metrics Bar ── */}
      <section className="vm-metrics-grid" aria-label="Fleet Overview Metrics">
        <div className="vm-metric-card">
          <div className="vm-metric-icon fleet">
            <FiTruck />
          </div>
          <div className="vm-metric-info">
            <span className="vm-metric-label">Total Fleet</span>
            <span className="vm-metric-value">{loading ? "..." : metrics.total}</span>
            <span className="vm-metric-sub">Registered vehicles</span>
          </div>
        </div>

        <div className="vm-metric-card">
          <div className="vm-metric-icon available">
            <FiCheckCircle />
          </div>
          <div className="vm-metric-info">
            <span className="vm-metric-label">Available for Trips</span>
            <span className="vm-metric-value text-success">{loading ? "..." : metrics.available}</span>
            <span className="vm-metric-sub">Ready for AI &amp; manual routes</span>
          </div>
        </div>

        <div className="vm-metric-card">
          <div className="vm-metric-icon unavailable">
            <FiXCircle />
          </div>
          <div className="vm-metric-info">
            <span className="vm-metric-label">Not Available</span>
            <span className="vm-metric-value text-danger">{loading ? "..." : metrics.notAvailable}</span>
            <span className="vm-metric-sub">Withheld from allocation</span>
          </div>
        </div>

        <div className="vm-metric-card">
          <div className="vm-metric-icon capacity">
            <FiLayers />
          </div>
          <div className="vm-metric-info">
            <span className="vm-metric-label">Available Seats</span>
            <span className="vm-metric-value">
              {loading ? "..." : metrics.availableCapacity}
              <span style={{ fontSize: "0.85rem", fontWeight: "600", color: "#64748b", marginLeft: "4px" }}>
                / {metrics.totalCapacity}
              </span>
            </span>
            <span className="vm-metric-sub">Seats in available vehicles</span>
          </div>
        </div>
      </section>

      {/* ── Tab Switcher Bar ── */}
      <nav className="vm-tabs-bar" aria-label="Management Sections">
        <button
          type="button"
          className={`vm-tab-btn ${activeTab === "vehicles" ? "active" : ""}`}
          onClick={() => handleTabChange("vehicles")}
        >
          <MdDirectionsBus size={18} />
          <span>Vehicle Management</span>
          <span className="vm-tab-pill-badge">{metrics.total}</span>
        </button>

        <button
          type="button"
          className={`vm-tab-btn ${activeTab === "schedules" ? "active" : ""}`}
          onClick={() => handleTabChange("schedules")}
        >
          <FiCheckCircle size={17} />
          <span>Schedule Management</span>
          <span className="vm-tab-pill-badge">
            {metrics.available} Available · {metrics.notAvailable} Unavailable
          </span>
        </button>
      </nav>

      {/* ── Main Content Card ── */}
      <main className="vm-content-card">
        {/* ========================================================
            TAB 1: VEHICLE MANAGEMENT SECTION
           ======================================================== */}
        {activeTab === "vehicles" && (
          <section aria-label="Vehicle Management Tab">
            {/* Toolbar */}
            <div className="vm-toolbar">
              <div className="vm-toolbar-left">
                <div className="vm-search-box">
                  <MdSearch className="vm-search-icon" />
                  <input
                    type="text"
                    className="vm-search-input"
                    placeholder="Search by vehicle name or capacity..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      className="vm-clear-search"
                      onClick={() => setSearchQuery("")}
                      aria-label="Clear search"
                    >
                      ×
                    </button>
                  )}
                </div>

                <div className="vm-filter-group">
                  <button
                    type="button"
                    className={`vm-filter-pill ${vehicleFilter === "ALL" ? "active" : ""}`}
                    onClick={() => setVehicleFilter("ALL")}
                  >
                    All ({metrics.total})
                  </button>
                  <button
                    type="button"
                    className={`vm-filter-pill ${vehicleFilter === "AVAILABLE" ? "active" : ""}`}
                    onClick={() => setVehicleFilter("AVAILABLE")}
                  >
                    Available ({metrics.available})
                  </button>
                  <button
                    type="button"
                    className={`vm-filter-pill ${vehicleFilter === "NOT_AVAILABLE" ? "active" : ""}`}
                    onClick={() => setVehicleFilter("NOT_AVAILABLE")}
                  >
                    Not Available ({metrics.notAvailable})
                  </button>
                </div>
              </div>

              <div className="vm-toolbar-right">
                <button
                  type="button"
                  className="vm-btn-primary"
                  onClick={openAddModal}
                >
                  <MdAdd size={16} />
                  Register Vehicle
                </button>
              </div>
            </div>

            {/* Sub-banner info */}
            <div className="vm-section-banner">
              <span>
                Showing <strong>{filteredVehicles.length}</strong> of <strong>{metrics.total}</strong> registered fleet vehicle{metrics.total !== 1 ? "s" : ""}
              </span>
              <span>Click Edit or Delete to manage individual vehicles</span>
            </div>

            {/* Table or States */}
            {loading ? (
              <div className="vm-state-box">
                <div className="vm-spinner" />
                <h3 className="vm-state-heading">Loading fleet assets...</h3>
                <p className="vm-state-message">Connecting to database and fetching fleet configuration.</p>
              </div>
            ) : error ? (
              <div className="vm-state-box">
                <div className="vm-state-icon">⚠️</div>
                <h3 className="vm-state-heading">Connection Error</h3>
                <p className="vm-state-message">{error}</p>
                <button type="button" className="vm-btn-primary" onClick={() => loadData(true)}>
                  <MdRefresh size={16} /> Retry Connection
                </button>
              </div>
            ) : filteredVehicles.length === 0 ? (
              <div className="vm-state-box">
                <div className="vm-state-icon">🚌</div>
                <h3 className="vm-state-heading">
                  {vehicles.length === 0 ? "No Fleet Vehicles Registered" : "No Matching Vehicles"}
                </h3>
                <p className="vm-state-message">
                  {vehicles.length === 0
                    ? "Get started by adding your first college transport vehicle with its designated capacity."
                    : "No vehicles match the active search term or status filter."}
                </p>
                {vehicles.length === 0 ? (
                  <button type="button" className="vm-btn-primary" onClick={openAddModal}>
                    <MdAdd size={16} /> Register First Vehicle
                  </button>
                ) : (
                  <button
                    type="button"
                    className="vm-btn-secondary"
                    onClick={() => {
                      setSearchQuery("");
                      setVehicleFilter("ALL");
                    }}
                  >
                    Clear Filter
                  </button>
                )}
              </div>
            ) : (
              <div className="vm-table-responsive">
                <table className="vm-table">
                  <thead>
                    <tr>
                      <th>Vehicle Name</th>
                      <th>Fleet Class</th>
                      <th>Seating Capacity</th>
                      <th>Schedule Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredVehicles.map((bus) => {
                      const isAvail = bus.availability === "Available";
                      return (
                        <tr key={bus._id} className={!isAvail ? "row-unavailable" : ""}>
                          <td>
                            <div className="vm-vehicle-identity">
                              <div className="vm-vehicle-icon-box">
                                <MdDirectionsBus />
                              </div>
                              <div>
                                <span className="vm-vehicle-name">{bus.vehicleName}</span>
                                <div className="vm-vehicle-subid">
                                  ID: {String(bus._id).slice(-6).toUpperCase()}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td>
                            <span style={{ fontSize: "13px", fontWeight: "600", color: "#475569" }}>
                              Standard Fleet Bus
                            </span>
                          </td>

                          <td>
                            <span className="vm-capacity-pill">
                              <span className="vm-capacity-num">{bus.capacity}</span>
                              <span className="vm-capacity-unit">seats</span>
                            </span>
                          </td>

                          <td>
                            <span className={`vm-status-badge ${isAvail ? "available" : "unavailable"}`}>
                              <span className="vm-status-dot" />
                              {isAvail ? "Available" : "Not Available"}
                            </span>
                          </td>

                          <td>
                            <div className="vm-actions-cell">
                              <button
                                type="button"
                                className="vm-btn-action-edit"
                                onClick={() => openEditModal(bus)}
                                title={`Edit ${bus.vehicleName}`}
                              >
                                <MdEdit size={14} />
                                Edit
                              </button>
                              <button
                                type="button"
                                className="vm-btn-action-delete"
                                onClick={() => setVehicleToDelete(bus)}
                                title={`Delete ${bus.vehicleName}`}
                              >
                                <MdDelete size={14} />
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* ========================================================
            TAB 2: SCHEDULE MANAGEMENT SECTION
           ======================================================== */}
        {activeTab === "schedules" && (
          <section aria-label="Schedule Management Tab">
            {/* Toolbar */}
            <div className="vm-toolbar">
              <div className="vm-toolbar-left">
                <div className="vm-search-box">
                  <MdSearch className="vm-search-icon" />
                  <input
                    type="text"
                    className="vm-search-input"
                    placeholder="Search by vehicle name or capacity..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      className="vm-clear-search"
                      onClick={() => setSearchQuery("")}
                      aria-label="Clear search"
                    >
                      ×
                    </button>
                  )}
                </div>

                <div className="vm-filter-group">
                  <button
                    type="button"
                    className={`vm-filter-pill ${scheduleFilter === "ALL" ? "active" : ""}`}
                    onClick={() => setScheduleFilter("ALL")}
                  >
                    All ({metrics.total})
                  </button>
                  <button
                    type="button"
                    className={`vm-filter-pill ${scheduleFilter === "AVAILABLE" ? "active" : ""}`}
                    onClick={() => setScheduleFilter("AVAILABLE")}
                  >
                    Available ({metrics.available})
                  </button>
                  <button
                    type="button"
                    className={`vm-filter-pill ${scheduleFilter === "NOT_AVAILABLE" ? "active" : ""}`}
                    onClick={() => setScheduleFilter("NOT_AVAILABLE")}
                  >
                    Not Available ({metrics.notAvailable})
                  </button>
                </div>
              </div>

              <div className="vm-toolbar-right">
                <button
                  type="button"
                  className="vm-btn-bulk-avail"
                  onClick={() => setAllStatus("Available")}
                  disabled={loading || refreshing || metrics.available === metrics.total}
                  title="Mark all fleet vehicles as Available"
                >
                  <FiCheck size={14} />
                  Mark All Available
                </button>
                <button
                  type="button"
                  className="vm-btn-bulk-unavail"
                  onClick={() => setAllStatus("Not Available")}
                  disabled={loading || refreshing || metrics.notAvailable === metrics.total}
                  title="Mark all fleet vehicles as Not Available"
                >
                  <FiX size={14} />
                  Mark All Unavailable
                </button>
              </div>
            </div>

            {/* Sub-banner info */}
            <div className="vm-section-banner">
              <span>
                Schedule availability determines which buses can be allocated in <strong>Route Management</strong> and <strong>AI Route Optimization</strong>.
              </span>
              <span>
                Status: <strong>{metrics.available} Available</strong> · <strong>{metrics.notAvailable} Unavailable</strong>
              </span>
            </div>

            {/* Table or States */}
            {loading ? (
              <div className="vm-state-box">
                <div className="vm-spinner" />
                <h3 className="vm-state-heading">Loading vehicle schedule availability...</h3>
                <p className="vm-state-message">Fetching dispatch availability from MongoDB.</p>
              </div>
            ) : error ? (
              <div className="vm-state-box">
                <div className="vm-state-icon">⚠️</div>
                <h3 className="vm-state-heading">Connection Error</h3>
                <p className="vm-state-message">{error}</p>
                <button type="button" className="vm-btn-primary" onClick={() => loadData(true)}>
                  <MdRefresh size={16} /> Retry
                </button>
              </div>
            ) : filteredSchedules.length === 0 ? (
              <div className="vm-state-box">
                <div className="vm-state-icon">📅</div>
                <h3 className="vm-state-heading">No Vehicles Found</h3>
                <p className="vm-state-message">
                  {vehicles.length === 0
                    ? "No vehicles registered in fleet depot yet. Add vehicles in the Vehicle Management tab first."
                    : "No vehicles match the selected filter or search keyword."}
                </p>
                {vehicles.length === 0 && (
                  <button
                    type="button"
                    className="vm-btn-primary"
                    onClick={() => handleTabChange("vehicles")}
                  >
                    Go to Vehicle Management &rarr;
                  </button>
                )}
              </div>
            ) : (
              <div className="vm-table-responsive">
                <table className="vm-table">
                  <thead>
                    <tr>
                      <th>Vehicle Name &amp; ID</th>
                      <th>Seat Capacity</th>
                      <th>Current Availability</th>
                      <th>Quick Status Control</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSchedules.map((item) => {
                      const isAvail = item.availability === "Available";
                      const isUpdating = updatingScheduleId === item._id;

                      return (
                        <tr key={item._id} className={!isAvail ? "row-unavailable" : ""}>
                          <td>
                            <div className="vm-vehicle-identity">
                              <div className="vm-vehicle-icon-box">
                                <MdDirectionsBus />
                              </div>
                              <div>
                                <span className="vm-vehicle-name">{item.vehicleName}</span>
                                <div className="vm-vehicle-subid">
                                  ID: {String(item._id).slice(-6).toUpperCase()}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td>
                            <span className="vm-capacity-pill">
                              <span className="vm-capacity-num">{item.capacity}</span>
                              <span className="vm-capacity-unit">seats</span>
                            </span>
                          </td>

                          <td>
                            <span className={`vm-status-badge ${isAvail ? "available" : "unavailable"}`}>
                              <span className="vm-status-dot" />
                              {isAvail ? "Available" : "Not Available"}
                            </span>
                          </td>

                          <td>
                            <div className="vm-toggle-control-group">
                              <button
                                type="button"
                                className={`vm-toggle-btn avail ${isAvail ? "is-active-avail" : ""}`}
                                onClick={() => !isAvail && toggleScheduleAvailability(item)}
                                disabled={isUpdating || isAvail}
                                title={isAvail ? "Currently Available" : "Click to mark Available"}
                              >
                                <FiCheckCircle size={14} />
                                Available
                              </button>

                              <button
                                type="button"
                                className={`vm-toggle-btn unavail ${!isAvail ? "is-active-unavail" : ""}`}
                                onClick={() => isAvail && toggleScheduleAvailability(item)}
                                disabled={isUpdating || !isAvail}
                                title={!isAvail ? "Currently Not Available" : "Click to mark Not Available"}
                              >
                                <FiXCircle size={14} />
                                Not Available
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>

      {/* ========================================================
          ADD / EDIT VEHICLE MODAL
         ======================================================== */}
      {showVehicleModal && (
        <div
          className="vm-modal-overlay"
          role="dialog"
          aria-modal="true"
          onClick={closeVehicleModal}
        >
          <div className="vm-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="vm-modal-header">
              <h2 className="vm-modal-title">
                {editingVehicleId ? "Edit Vehicle Details" : "Register New Vehicle"}
              </h2>
              <button
                type="button"
                className="vm-modal-close-btn"
                onClick={closeVehicleModal}
                aria-label="Close modal"
              >
                <MdClose />
              </button>
            </div>

            <form onSubmit={handleVehicleFormSubmit}>
              <div className="vm-modal-body">
                <div className="vm-form-group">
                  <label htmlFor="input-vehicle-name" className="vm-form-label">
                    Vehicle Name / Number *
                  </label>
                  <input
                    id="input-vehicle-name"
                    type="text"
                    className="vm-form-input"
                    placeholder="e.g. J1, Q1, A2, BUS-05"
                    value={vehicleFormData.vehicleName}
                    onChange={(e) =>
                      setVehicleFormData({ ...vehicleFormData, vehicleName: e.target.value })
                    }
                    autoFocus
                    required
                  />
                  <span className="vm-form-hint">
                    Enter the fleet designation code or license plate identifier.
                  </span>
                </div>

                <div className="vm-form-group">
                  <label htmlFor="input-vehicle-capacity" className="vm-form-label">
                    Passenger Seat Capacity *
                  </label>
                  <input
                    id="input-vehicle-capacity"
                    type="number"
                    min="1"
                    max="150"
                    className="vm-form-input"
                    placeholder="e.g. 70"
                    value={vehicleFormData.capacity}
                    onChange={(e) =>
                      setVehicleFormData({ ...vehicleFormData, capacity: e.target.value })
                    }
                    required
                  />
                  <span className="vm-form-hint">
                    Total student seating capacity for seat optimization and safety limits.
                  </span>
                </div>
              </div>

              <div className="vm-modal-footer">
                <button
                  type="button"
                  className="vm-btn-secondary"
                  onClick={closeVehicleModal}
                  disabled={submittingVehicle}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="vm-btn-primary"
                  disabled={submittingVehicle}
                >
                  {submittingVehicle
                    ? "Saving..."
                    : editingVehicleId
                    ? "Update Vehicle"
                    : "Register Vehicle"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================
          DELETE CONFIRMATION MODAL
         ======================================================== */}
      {vehicleToDelete && (
        <div
          className="vm-modal-overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => setVehicleToDelete(null)}
        >
          <div className="vm-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="vm-modal-header">
              <h2 className="vm-modal-title" style={{ color: "#b91c1c" }}>
                Delete Vehicle
              </h2>
              <button
                type="button"
                className="vm-modal-close-btn"
                onClick={() => setVehicleToDelete(null)}
                aria-label="Close modal"
              >
                <MdClose />
              </button>
            </div>

            <div className="vm-modal-body">
              <p style={{ margin: "0 0 12px 0", fontSize: "14px", color: "#334155", lineHeight: "1.5" }}>
                Are you sure you want to delete vehicle <strong>{vehicleToDelete.vehicleName}</strong>?
              </p>
              <p style={{ margin: "0", fontSize: "13px", color: "#64748b", lineHeight: "1.5" }}>
                This vehicle has a capacity of <strong>{vehicleToDelete.capacity} seats</strong>. Removing it will delete its registered record from fleet inventory.
              </p>
            </div>

            <div className="vm-modal-footer">
              <button
                type="button"
                className="vm-btn-secondary"
                onClick={() => setVehicleToDelete(null)}
                disabled={deletingVehicle}
              >
                Cancel
              </button>
              <button
                type="button"
                className="vm-btn-danger"
                onClick={confirmDelete}
                disabled={deletingVehicle}
              >
                {deletingVehicle ? "Deleting..." : "Yes, Delete Vehicle"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VehicleManagement;