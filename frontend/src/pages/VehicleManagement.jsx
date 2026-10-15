import React, { useEffect, useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import {
  LuBus,
  LuCircleCheck,
  LuCircleX,
  LuArmchair,
  LuSearch,
  LuPlus,
  LuPencil,
  LuTrash2,
  LuRefreshCw,
  LuArrowLeft,
  LuCheck,
  LuX,
  LuCircleAlert
} from "react-icons/lu";

import api from "../services/api";
import "../css/VehicleManagement.css";

const VehicleManagement = () => {
  const navigate = useNavigate();

  // Fleet & Schedule Data
  const [vehicles, setVehicles] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Search & Filter States
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL"); // "ALL" | "AVAILABLE" | "NOT_AVAILABLE"

  // Fast-toggle updating tracker (stores vehicle ID being toggled)
  const [updatingVehicleId, setUpdatingVehicleId] = useState(null);

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

  // Bulk Availability Confirmation Modal State
  const [bulkModalAction, setBulkModalAction] = useState(null); // "Available" | "Not Available" | null
  const [submittingBulk, setSubmittingBulk] = useState(false);

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

  // ── Lifecycle & Background Sync ───────────────────────────
  useEffect(() => {
    let isMounted = true;
    loadData(true);

    const handleSync = () => {
      if (
        document.visibilityState === "visible" &&
        isMounted &&
        !showVehicleModal &&
        !vehicleToDelete &&
        !bulkModalAction &&
        !updatingVehicleId
      ) {
        loadData(false);
      }
    };

    window.addEventListener("focus", handleSync);
    document.addEventListener("visibilitychange", handleSync);

    const pollInterval = setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        isMounted &&
        !showVehicleModal &&
        !vehicleToDelete &&
        !bulkModalAction &&
        !updatingVehicleId
      ) {
        loadData(false);
      }
    }, 15000);

    return () => {
      isMounted = false;
      window.removeEventListener("focus", handleSync);
      document.removeEventListener("visibilitychange", handleSync);
      clearInterval(pollInterval);
    };
  }, [loadData, showVehicleModal, vehicleToDelete, bulkModalAction, updatingVehicleId]);

  // Lock page background scrolling when any modal is open
  useEffect(() => {
    const hasOpenModal = showVehicleModal || Boolean(vehicleToDelete) || Boolean(bulkModalAction);
    if (hasOpenModal) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [showVehicleModal, vehicleToDelete, bulkModalAction]);

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

  // ── Executive Metrics Calculation ─────────────────────────
  const metrics = useMemo(() => {
    const total = vehicleScheduleList.length;
    const available = vehicleScheduleList.filter((v) => v.availability === "Available").length;
    const notAvailable = total - available;
    const totalCapacity = vehicleScheduleList.reduce(
      (sum, v) => sum + (Number(v.capacity) || 0),
      0
    );
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

  // ── Search & Filter Logic ─────────────────────────────────
  const filteredVehicles = useMemo(() => {
    return vehicleScheduleList.filter((v) => {
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        v.vehicleName?.toLowerCase().includes(q) ||
        String(v.capacity).includes(q) ||
        String(v._id).toLowerCase().includes(q);

      if (!matchesSearch) return false;

      if (statusFilter === "AVAILABLE") return v.availability === "Available";
      if (statusFilter === "NOT_AVAILABLE") return v.availability === "Not Available";
      return true;
    });
  }, [vehicleScheduleList, searchQuery, statusFilter]);

  // ── Vehicle Add / Edit Modal Handlers ─────────────────────
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

  // ── Vehicle Delete Handlers ───────────────────────────────
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

  // ── Row-Level Availability Toggle ─────────────────────────
  const handleToggleAvailability = async (item, targetStatus) => {
    if (item.availability === targetStatus) return; // already in this status
    if (updatingVehicleId === item._id) return;

    try {
      setUpdatingVehicleId(item._id);

      // Optimistic update of local schedules
      setSchedules((prev) => {
        const idx = prev.findIndex(
          (s) => String(s.vehicle?._id || s.vehicle) === String(item._id)
        );
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], availability: targetStatus };
          return updated;
        }
        return [...prev, { vehicle: item, availability: targetStatus }];
      });

      await api.post("/schedules", {
        vehicle: item._id,
        availability: targetStatus
      });

      toast.success(`${item.vehicleName} marked as ${targetStatus}`);
      await loadData(false);
    } catch (err) {
      console.error("Toggle availability error:", err);
      toast.error(err.response?.data?.message || "Failed to update availability");
      await loadData(false);
    } finally {
      setUpdatingVehicleId(null);
    }
  };

  // ── Bulk Availability Set Handlers ────────────────────────
  const executeBulkStatus = async (status) => {
    try {
      setSubmittingBulk(true);
      await Promise.all(
        vehicles.map((v) =>
          api.post("/schedules", {
            vehicle: v._id,
            availability: status
          })
        )
      );
      toast.success(`All vehicles marked as ${status}`);
      setBulkModalAction(null);
      await loadData(false);
    } catch (err) {
      console.error("Bulk update error:", err);
      toast.error("Failed to update all vehicles");
    } finally {
      setSubmittingBulk(false);
    }
  };

  return (
    <div className="vm-page-container">
      {/* ── Ambient Page Background Overlay (matching User Management) ── */}
      <div className="vm-page-bg-overlay" aria-hidden="true" />

      {/* ── Top Navigation Bar ── */}
      <div className="vm-top-nav">
        <button
          type="button"
          className="vm-back-btn"
          onClick={() => navigate("/admin-dashboard")}
          aria-label="Back to Admin Dashboard"
        >
          <LuArrowLeft size={16} />
          Back
        </button>
      </div>

      {/* ── SECTION 1: Illustrated Header ── */}
      <header className="vm-illustrated-header" aria-label="Page Banner">
        <div className="vm-header-content">
          <span className="vm-header-pill">FLEET &amp; DISPATCH CONTROL</span>
          <h1 className="vm-header-title">Vehicle &amp; Schedule Management</h1>
          <p className="vm-header-subtitle">
            Manage your fleet, seating capacities, and vehicle availability in one place.
          </p>
        </div>
      </header>

      {/* ── SECTION 2: Four Fleet Statistics Cards ── */}
      <section className="vm-metrics-grid" aria-label="Fleet Overview Metrics">
        {/* Card 1: Total Vehicles */}
        <div className="vm-metric-card">
          <div className="vm-metric-icon fleet">
            <LuBus size={22} />
          </div>
          <div className="vm-metric-info">
            <span className="vm-metric-label">Total Vehicles</span>
            <span className="vm-metric-value">{loading ? "..." : metrics.total}</span>
            <span className="vm-metric-sub">Registered vehicles</span>
          </div>
        </div>

        {/* Card 2: Available Vehicles */}
        <div className="vm-metric-card">
          <div className="vm-metric-icon available">
            <LuCircleCheck size={22} />
          </div>
          <div className="vm-metric-info">
            <span className="vm-metric-label">Available Vehicles</span>
            <span className="vm-metric-value text-available">
              {loading ? "..." : metrics.available}
            </span>
            <span className="vm-metric-sub">Ready for allocation</span>
          </div>
        </div>

        {/* Card 3: Not Available */}
        <div className="vm-metric-card">
          <div className="vm-metric-icon unavailable">
            <LuCircleX size={22} />
          </div>
          <div className="vm-metric-info">
            <span className="vm-metric-label">Not Available</span>
            <span className="vm-metric-value text-unavailable">
              {loading ? "..." : metrics.notAvailable}
            </span>
            <span className="vm-metric-sub">Withheld from allocation</span>
          </div>
        </div>

        {/* Card 4: Available Seats */}
        <div className="vm-metric-card">
          <div className="vm-metric-icon capacity">
            <LuArmchair size={22} />
          </div>
          <div className="vm-metric-info">
            <span className="vm-metric-label">Available Seats</span>
            <div className="vm-metric-value">
              {loading ? "..." : metrics.availableCapacity}
              <span className="vm-metric-total-seats">
                {" "}/ {metrics.totalCapacity}
              </span>
            </div>
            <span className="vm-metric-sub">Seats in available vehicles</span>
          </div>
        </div>
      </section>

      {/* ── SECTIONS 3 & 4: Unified Fleet Directory Panel ── */}
      <main className="vm-directory-panel" aria-label="Fleet Directory and Schedule Controls">
        {/* Section 3 Header: Heading + Add Vehicle Button */}
        <div className="vm-directory-header">
          <div className="vm-directory-title-wrap">
            <h2 className="vm-directory-heading">Fleet Directory</h2>
            <p className="vm-directory-sub">
              Manage registered vehicles and schedule availability.
            </p>
          </div>

          <button
            type="button"
            className="vm-btn-add-vehicle"
            onClick={openAddModal}
            title="Register a new vehicle in the fleet"
          >
            <LuPlus size={16} />
            + Add Vehicle
          </button>
        </div>

        {/* Section 3 Controls: Search, Filters, Bulk Buttons */}
        <div className="vm-directory-toolbar">
          <div className="vm-toolbar-left">
            {/* Search Box */}
            <div className="vm-search-box">
              <LuSearch className="vm-search-icon" size={16} />
              <input
                type="text"
                className="vm-search-input"
                placeholder="Search vehicles by name, capacity, or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="vm-clear-search-btn"
                  onClick={() => setSearchQuery("")}
                  aria-label="Clear search query"
                >
                  ×
                </button>
              )}
            </div>

            {/* Filter Pills */}
            <div className="vm-filter-group" role="radiogroup" aria-label="Vehicle Status Filter">
              <button
                type="button"
                className={`vm-filter-pill ${statusFilter === "ALL" ? "active" : ""}`}
                onClick={() => setStatusFilter("ALL")}
              >
                All Vehicles ({metrics.total})
              </button>
              <button
                type="button"
                className={`vm-filter-pill ${statusFilter === "AVAILABLE" ? "active" : ""}`}
                onClick={() => setStatusFilter("AVAILABLE")}
              >
                Available ({metrics.available})
              </button>
              <button
                type="button"
                className={`vm-filter-pill ${statusFilter === "NOT_AVAILABLE" ? "active" : ""}`}
                onClick={() => setStatusFilter("NOT_AVAILABLE")}
              >
                Not Available ({metrics.notAvailable})
              </button>
            </div>
          </div>

          {/* Bulk Availability Controls */}
          <div className="vm-toolbar-right">
            <button
              type="button"
              className="vm-btn-bulk-available"
              onClick={() => setBulkModalAction("Available")}
              disabled={loading || refreshing || metrics.available === metrics.total}
              title="Mark all registered vehicles as Available for routes"
            >
              <LuCheck size={14} />
              Mark All Available
            </button>
            <button
              type="button"
              className="vm-btn-bulk-unavailable"
              onClick={() => setBulkModalAction("Not Available")}
              disabled={loading || refreshing || metrics.notAvailable === metrics.total}
              title="Mark all registered vehicles as Not Available"
            >
              <LuX size={14} />
              Mark All Not Available
            </button>
          </div>
        </div>

        {/* Section 4: Unified Table Viewport (Vertical Scroll on Rows Only) */}
        <div className="vm-table-scroll-container">
          {loading ? (
            <div className="vm-empty-state">
              <div className="vm-spinner" />
              <h3 className="vm-empty-title">Loading fleet assets...</h3>
              <p className="vm-empty-desc">
                Connecting to database and fetching fleet configuration.
              </p>
            </div>
          ) : error ? (
            <div className="vm-empty-state">
              <div className="vm-empty-icon text-warning">
                <LuCircleAlert size={36} />
              </div>
              <h3 className="vm-empty-title">Connection Error</h3>
              <p className="vm-empty-desc">{error}</p>
              <button
                type="button"
                className="vm-btn-primary"
                onClick={() => loadData(true)}
              >
                <LuRefreshCw size={15} /> Retry Connection
              </button>
            </div>
          ) : filteredVehicles.length === 0 ? (
            <div className="vm-empty-state">
              <div className="vm-empty-icon text-muted">
                <LuBus size={42} />
              </div>
              <h3 className="vm-empty-title">
                {vehicles.length === 0 ? "No Fleet Vehicles Registered" : "No Matching Vehicles"}
              </h3>
              <p className="vm-empty-desc">
                {vehicles.length === 0
                  ? "Get started by adding your first college transit vehicle with its seating capacity."
                  : "No registered vehicles match the search keyword or active status filter."}
              </p>
              {vehicles.length === 0 ? (
                <button type="button" className="vm-btn-add-vehicle" onClick={openAddModal}>
                  <LuPlus size={16} /> Register First Vehicle
                </button>
              ) : (
                <button
                  type="button"
                  className="vm-btn-secondary"
                  onClick={() => {
                    setSearchQuery("");
                    setStatusFilter("ALL");
                  }}
                >
                  Clear Filters
                </button>
              )}
            </div>
          ) : (
            <table className="vm-table" aria-label="Fleet and Schedule Management Table">
              <thead>
                <tr>
                  <th scope="col" style={{ width: "30%" }}>Vehicle</th>
                  <th scope="col" style={{ width: "16%" }}>Seats</th>
                  <th scope="col" style={{ width: "18%" }}>Status</th>
                  <th scope="col" style={{ width: "22%" }}>Availability</th>
                  <th scope="col" style={{ width: "14%", textAlign: "right" }}>Manage</th>
                </tr>
              </thead>
              <tbody>
                {filteredVehicles.map((bus) => {
                  const isAvail = bus.availability === "Available";
                  const isUpdating = updatingVehicleId === bus._id;

                  return (
                    <tr
                      key={bus._id}
                      className={!isAvail ? "row-unavailable" : ""}
                    >
                      {/* 1. Vehicle Column */}
                      <td>
                        <div className="vm-vehicle-cell">
                          <div className={`vm-bus-icon-wrap ${isAvail ? "avail" : "unavail"}`}>
                            <LuBus size={18} />
                          </div>
                          <div className="vm-bus-details">
                            <span className="vm-bus-name">{bus.vehicleName}</span>
                            <span className="vm-bus-id">
                              ID: {String(bus._id).slice(-6).toUpperCase()}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* 2. Seats Column */}
                      <td>
                        <span className="vm-seats-badge">
                          <span className="vm-seats-count">{bus.capacity}</span>
                          <span className="vm-seats-unit">seats</span>
                        </span>
                      </td>

                      {/* 3. Status Column */}
                      <td>
                        <span
                          className={`vm-status-pill ${isAvail ? "is-available" : "is-unavailable"}`}
                        >
                          <span className="vm-status-dot" />
                          {isAvail ? "Available" : "Not Available"}
                        </span>
                      </td>

                      {/* 4. Availability Controls Column */}
                      <td>
                        <div className="vm-avail-control-group" role="group" aria-label={`Set availability for ${bus.vehicleName}`}>
                          <button
                            type="button"
                            className={`vm-toggle-btn btn-avail ${isAvail ? "active" : ""}`}
                            onClick={() => handleToggleAvailability(bus, "Available")}
                            disabled={isUpdating || isAvail}
                            title={isAvail ? "Vehicle is currently Available" : "Click to mark Available"}
                          >
                            <LuCheck size={13} />
                            Available
                          </button>
                          <button
                            type="button"
                            className={`vm-toggle-btn btn-unavail ${!isAvail ? "active" : ""}`}
                            onClick={() => handleToggleAvailability(bus, "Not Available")}
                            disabled={isUpdating || !isAvail}
                            title={!isAvail ? "Vehicle is currently Not Available" : "Click to mark Not Available"}
                          >
                            <LuX size={13} />
                            Not Available
                          </button>
                        </div>
                      </td>

                      {/* 5. Manage Column */}
                      <td style={{ textAlign: "right" }}>
                        <div className="vm-manage-actions">
                          <button
                            type="button"
                            className="vm-action-btn edit"
                            onClick={() => openEditModal(bus)}
                            title={`Edit ${bus.vehicleName}`}
                            aria-label={`Edit ${bus.vehicleName}`}
                          >
                            <LuPencil size={14} />
                            <span className="vm-action-btn-text">Edit</span>
                          </button>
                          <button
                            type="button"
                            className="vm-action-btn delete"
                            onClick={() => setVehicleToDelete(bus)}
                            title={`Delete ${bus.vehicleName}`}
                            aria-label={`Delete ${bus.vehicleName}`}
                          >
                            <LuTrash2 size={14} />
                            <span className="vm-action-btn-text">Delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
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
                ×
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
                    placeholder="e.g. 50"
                    value={vehicleFormData.capacity}
                    onChange={(e) =>
                      setVehicleFormData({ ...vehicleFormData, capacity: e.target.value })
                    }
                    required
                  />
                  <span className="vm-form-hint">
                    Total seating capacity used by AI Route Optimization and route safety rules.
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
            <div className="vm-modal-header danger-header">
              <h2 className="vm-modal-title text-danger">Delete Vehicle</h2>
              <button
                type="button"
                className="vm-modal-close-btn"
                onClick={() => setVehicleToDelete(null)}
                aria-label="Close modal"
              >
                ×
              </button>
            </div>

            <div className="vm-modal-body">
              <p className="vm-delete-prompt">
                Are you sure you want to delete vehicle <strong>{vehicleToDelete.vehicleName}</strong>?
              </p>
              <p className="vm-delete-sub">
                This vehicle has a capacity of <strong>{vehicleToDelete.capacity} seats</strong>. Removing it will permanently delete its record from MongoDB and exclude it from route allocations.
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

      {/* ========================================================
          BULK AVAILABILITY CONFIRMATION MODAL
         ======================================================== */}
      {bulkModalAction && (
        <div
          className="vm-modal-overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => setBulkModalAction(null)}
        >
          <div className="vm-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="vm-modal-header">
              <h2 className="vm-modal-title">
                Mark All Vehicles as {bulkModalAction}?
              </h2>
              <button
                type="button"
                className="vm-modal-close-btn"
                onClick={() => setBulkModalAction(null)}
                aria-label="Close modal"
              >
                ×
              </button>
            </div>

            <div className="vm-modal-body">
              <p className="vm-delete-prompt">
                This will update all <strong>{metrics.total} registered vehicles</strong> in the fleet depot to <strong>{bulkModalAction}</strong>.
              </p>
              <p className="vm-delete-sub">
                {bulkModalAction === "Available"
                  ? "All vehicles will become immediately available for AI Route Optimization and manual route assignments."
                  : "Vehicles marked as Not Available will be withheld from passenger allocation during trip planning."}
              </p>
            </div>

            <div className="vm-modal-footer">
              <button
                type="button"
                className="vm-btn-secondary"
                onClick={() => setBulkModalAction(null)}
                disabled={submittingBulk}
              >
                Cancel
              </button>
              <button
                type="button"
                className={bulkModalAction === "Available" ? "vm-btn-success" : "vm-btn-danger"}
                onClick={() => executeBulkStatus(bulkModalAction)}
                disabled={submittingBulk}
              >
                {submittingBulk
                  ? "Updating..."
                  : `Confirm Mark All ${bulkModalAction}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VehicleManagement;