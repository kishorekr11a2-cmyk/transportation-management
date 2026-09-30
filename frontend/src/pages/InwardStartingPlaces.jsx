import React, { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import {
    MdPlace,
    MdAdd,
    MdEdit,
    MdDelete,
    MdClose,
    MdRefresh,
    MdSearch,
    MdCheckCircle,
    MdCancel,
    MdInfo
} from "react-icons/md";
import { HiArrowLeft } from "react-icons/hi2";

import api from "../services/api";
import LocationSearchBox from "../components/LocationSearchBox";
import "../css/InwardStartingPlaces.css";

const InwardStartingPlaces = () => {
    const navigate = useNavigate();

    const [places, setPlaces] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");

    // Modal state
    const [showModal, setShowModal] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editId, setEditId] = useState(null);

    // Form fields
    const [formData, setFormData] = useState({
        name: "",
        address: "",
        latitude: "",
        longitude: "",
        active: true
    });

    // Delete confirmation modal state
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleting, setDeleting] = useState(false);

    // ── Fetch Starting Places ──────────────────────────────
    const fetchStartingPlaces = async () => {
        try {
            setLoading(true);
            const res = await api.get("/inward-starting-places");
            if (res.data?.success) {
                setPlaces(res.data.startingPlaces || []);
            }
        } catch (err) {
            console.error("Failed to load inward starting places:", err);
            toast.error(err.response?.data?.message || "Failed to load starting places");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStartingPlaces();

        const handleSync = () => {
            if (document.visibilityState === "visible") {
                fetchStartingPlaces();
            }
        };

        window.addEventListener("focus", handleSync);
        document.addEventListener("visibilitychange", handleSync);

        return () => {
            window.removeEventListener("focus", handleSync);
            document.removeEventListener("visibilitychange", handleSync);
        };
    }, []);

    // ── Form Handlers ──────────────────────────────────────
    const handleOpenAddModal = () => {
        setEditId(null);
        setFormData({
            name: "",
            address: "",
            latitude: "",
            longitude: "",
            active: true
        });
        setShowModal(true);
    };

    const handleOpenEditModal = (place) => {
        setEditId(place._id);
        setFormData({
            name: place.name || "",
            address: place.address || "",
            latitude: place.latitude !== undefined ? String(place.latitude) : "",
            longitude: place.longitude !== undefined ? String(place.longitude) : "",
            active: place.active !== undefined ? place.active : true
        });
        setShowModal(true);
    };

    const handleCloseModal = () => {
        setShowModal(false);
        setEditId(null);
    };

    const handleLocationSelect = (loc) => {
        if (!loc) return;
        setFormData((prev) => ({
            ...prev,
            name: prev.name || loc.name || loc.displayName || "",
            address: loc.address || loc.displayName || prev.address,
            latitude: loc.latitude !== undefined ? String(loc.latitude) : prev.latitude,
            longitude: loc.longitude !== undefined ? String(loc.longitude) : prev.longitude
        }));
        toast.success(`Coordinates loaded for "${loc.name || 'Selected Place'}"`);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        const cleanName = formData.name.trim();
        const latNum = Number(formData.latitude);
        const lngNum = Number(formData.longitude);

        if (!cleanName) {
            toast.error("Please enter a starting place name.");
            return;
        }

        if (
            formData.latitude === "" ||
            formData.longitude === "" ||
            !Number.isFinite(latNum) ||
            !Number.isFinite(lngNum)
        ) {
            toast.error("Please provide valid latitude and longitude coordinates.");
            return;
        }

        if (latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
            toast.error("Coordinates out of geographic range.");
            return;
        }

        try {
            setSaving(true);
            const payload = {
                name: cleanName,
                address: formData.address.trim(),
                latitude: latNum,
                longitude: lngNum,
                active: Boolean(formData.active)
            };

            if (editId) {
                const res = await api.put(`/inward-starting-places/${editId}`, payload);
                toast.success(res.data?.message || "Starting place updated successfully");
            } else {
                const res = await api.post("/inward-starting-places", payload);
                toast.success(res.data?.message || "Starting place added successfully");
            }

            handleCloseModal();
            fetchStartingPlaces();
        } catch (err) {
            console.error("Save starting place error:", err);
            toast.error(err.response?.data?.message || "Failed to save starting place");
        } finally {
            setSaving(false);
        }
    };

    // ── Toggle Status ──────────────────────────────────────
    const handleToggleStatus = async (place) => {
        try {
            const res = await api.patch(`/inward-starting-places/${place._id}/toggle`);
            toast.success(res.data?.message || "Status updated");
            setPlaces((prev) =>
                prev.map((p) => (p._id === place._id ? { ...p, active: !p.active } : p))
            );
        } catch (err) {
            console.error("Toggle status error:", err);
            toast.error(err.response?.data?.message || "Failed to update status");
        }
    };

    // ── Delete ─────────────────────────────────────────────
    const handleDelete = async () => {
        if (!deleteTarget) return;
        try {
            setDeleting(true);
            const res = await api.delete(`/inward-starting-places/${deleteTarget._id}`);
            toast.success(res.data?.message || "Starting place deleted");
            setDeleteTarget(null);
            fetchStartingPlaces();
        } catch (err) {
            console.error("Delete error:", err);
            toast.error(err.response?.data?.message || "Failed to delete starting place");
        } finally {
            setDeleting(false);
        }
    };

    // ── Metrics ────────────────────────────────────────────
    const totalCount = places.length;
    const activeCount = useMemo(() => places.filter((p) => p.active).length, [places]);
    const inactiveCount = totalCount - activeCount;

    const filteredPlaces = useMemo(() => {
        if (!searchQuery.trim()) return places;
        const q = searchQuery.toLowerCase();
        return places.filter(
            (p) =>
                p.name?.toLowerCase().includes(q) ||
                p.address?.toLowerCase().includes(q)
        );
    }, [places, searchQuery]);

    return (
        <div className="inward-places-page">
            {/* ── Header ── */}
            <header className="inward-places-header">
                <div className="inward-places-header__left">
                    <button
                        className="inward-places-back-btn"
                        onClick={() => navigate("/admin-dashboard")}
                        aria-label="Go back"
                    >
                        <HiArrowLeft size={16} />
                        Back
                    </button>

                    <div className="inward-places-brand">
                        <div className="inward-places-brand__icon" aria-hidden="true">
                            <MdPlace size={24} />
                        </div>
                        <div>
                            <p className="inward-places-brand__label">Route Origins Configuration</p>
                            <h1 className="inward-places-brand__title">Inward Starting Places</h1>
                        </div>
                    </div>
                </div>

                <div className="inward-places-header__right">
                    <p className="inward-places-subtitle">
                        Configure origin hubs from which inward buses will depart before picking up passengers.
                    </p>
                    <button
                        className="inward-places-add-btn"
                        onClick={handleOpenAddModal}
                        aria-label="Add starting place"
                    >
                        <MdAdd size={18} />
                        Add Starting Place
                    </button>
                </div>
            </header>

            {/* ── Informational Notice ── */}
            <div className="inward-places-info-banner">
                <MdInfo size={20} />
                <div>
                    <strong>How Inward Starting Places Work:</strong> When the AI generates an <b>INWARD</b> transportation plan, each bus route will dynamically start from the configured active starting place closest to its passenger pickup cluster (e.g. <i>Starting Hub → Pickups → College</i>). At least one active place is required for inward plan generation.
                </div>
            </div>

            {/* ── Stats Row ── */}
            <div className="inward-places-stats">
                <div className="inward-places-stat-card">
                    <p className="inward-places-stat-card__label">Total Configured</p>
                    <p className="inward-places-stat-card__val">{totalCount}</p>
                </div>
                <div className="inward-places-stat-card active">
                    <p className="inward-places-stat-card__label">Active Hubs</p>
                    <p className="inward-places-stat-card__val">{activeCount}</p>
                </div>
                <div className="inward-places-stat-card inactive">
                    <p className="inward-places-stat-card__label">Inactive / Standby</p>
                    <p className="inward-places-stat-card__val">{inactiveCount}</p>
                </div>
            </div>

            {/* ── Table Card ── */}
            <div className="inward-places-table-card">
                <div className="inward-places-table-toolbar">
                    <div className="inward-places-search-box">
                        <MdSearch size={18} color="#64748b" />
                        <input
                            type="text"
                            placeholder="Filter starting places..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                    <button
                        className="inward-places-back-btn"
                        onClick={fetchStartingPlaces}
                        title="Refresh list"
                    >
                        <MdRefresh size={16} />
                        Refresh
                    </button>
                </div>

                <div className="inward-places-table-container">
                    {loading ? (
                        <div style={{ textAlign: "center", padding: "40px", color: "#94a3b8" }}>
                            Loading inward starting places...
                        </div>
                    ) : filteredPlaces.length === 0 ? (
                        <div className="inward-places-empty">
                            <MdPlace className="inward-places-empty__icon" />
                            <h3>No inward starting places found</h3>
                            <p>
                                {searchQuery
                                    ? "No starting places match your filter query."
                                    : "No inward starting places have been configured yet. Add at least one starting place before generating inward routes."}
                            </p>
                            {!searchQuery && (
                                <button
                                    className="inward-places-add-btn"
                                    onClick={handleOpenAddModal}
                                >
                                    <MdAdd size={18} />
                                    Add First Starting Place
                                </button>
                            )}
                        </div>
                    ) : (
                        <table className="inward-places-table">
                            <thead>
                                <tr>
                                    <th>Starting Place Name</th>
                                    <th>Address / Landmark</th>
                                    <th>Coordinates</th>
                                    <th>Status</th>
                                    <th style={{ textAlign: "right" }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredPlaces.map((place) => (
                                    <tr key={place._id}>
                                        <td className="place-name-cell">
                                            {place.name}
                                        </td>
                                        <td className="place-address-cell" title={place.address}>
                                            {place.address || <span style={{ color: "#64748b" }}>—</span>}
                                        </td>
                                        <td>
                                            <span className="inward-places-coord-badge">
                                                {Number(place.latitude).toFixed(4)}, {Number(place.longitude).toFixed(4)}
                                            </span>
                                        </td>
                                        <td>
                                            <span
                                                className={`status-pill ${place.active ? "active" : "inactive"}`}
                                                style={{ cursor: "pointer" }}
                                                onClick={() => handleToggleStatus(place)}
                                                title="Click to toggle active status"
                                            >
                                                {place.active ? (
                                                    <>
                                                        <MdCheckCircle size={13} />
                                                        Active
                                                    </>
                                                ) : (
                                                    <>
                                                        <MdCancel size={13} />
                                                        Inactive
                                                    </>
                                                )}
                                            </span>
                                        </td>
                                        <td>
                                            <div
                                                className="inward-places-actions"
                                                style={{ justifyContent: "flex-end" }}
                                            >
                                                <button
                                                    className="action-icon-btn toggle"
                                                    onClick={() => handleToggleStatus(place)}
                                                    title={place.active ? "Deactivate" : "Activate"}
                                                    aria-label="Toggle active status"
                                                >
                                                    {place.active ? <MdCancel size={16} /> : <MdCheckCircle size={16} />}
                                                </button>
                                                <button
                                                    className="action-icon-btn edit"
                                                    onClick={() => handleOpenEditModal(place)}
                                                    title="Edit place details"
                                                    aria-label="Edit starting place"
                                                >
                                                    <MdEdit size={16} />
                                                </button>
                                                <button
                                                    className="action-icon-btn delete"
                                                    onClick={() => setDeleteTarget(place)}
                                                    title="Delete starting place"
                                                    aria-label="Delete starting place"
                                                >
                                                    <MdDelete size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            {/* ── Add / Edit Modal ── */}
            {showModal && (
                <div className="inward-modal-overlay" onClick={handleCloseModal}>
                    <div
                        className="inward-modal"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="inward-modal__header">
                            <h2>{editId ? "Edit Inward Starting Place" : "Add Inward Starting Place"}</h2>
                            <button
                                className="inward-modal__close-btn"
                                onClick={handleCloseModal}
                                aria-label="Close modal"
                            >
                                <MdClose size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit}>
                            <div className="inward-modal__body">
                                {/* Search helper */}
                                <div className="inward-form-group">
                                    <label>Search & Auto-Fill Coordinates (Optional)</label>
                                    <LocationSearchBox
                                        placeholder="Search bus stand, hub or area (e.g. Mattuthavani Bus Stand)..."
                                        onSelectLocation={handleLocationSelect}
                                    />
                                </div>

                                <div className="inward-form-group">
                                    <label>Starting Place Name *</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Mattuthavani Bus Stand"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        required
                                    />
                                </div>

                                <div className="inward-form-group">
                                    <label>Address / Landmark</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Melur Main Road, Madurai"
                                        value={formData.address}
                                        onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                    />
                                </div>

                                <div className="inward-form-row">
                                    <div className="inward-form-group">
                                        <label>Latitude *</label>
                                        <input
                                            type="number"
                                            step="any"
                                            placeholder="e.g. 9.9408"
                                            value={formData.latitude}
                                            onChange={(e) => setFormData({ ...formData, latitude: e.target.value })}
                                            required
                                        />
                                    </div>
                                    <div className="inward-form-group">
                                        <label>Longitude *</label>
                                        <input
                                            type="number"
                                            step="any"
                                            placeholder="e.g. 78.1565"
                                            value={formData.longitude}
                                            onChange={(e) => setFormData({ ...formData, longitude: e.target.value })}
                                            required
                                        />
                                    </div>
                                </div>

                                <div className="inward-toggle-row">
                                    <input
                                        type="checkbox"
                                        id="activeToggle"
                                        checked={formData.active}
                                        onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                                    />
                                    <label htmlFor="activeToggle" style={{ cursor: "pointer", textTransform: "none" }}>
                                        Active (Included as an available hub for Inward AI route generation)
                                    </label>
                                </div>
                            </div>

                            <div className="inward-modal__footer">
                                <button
                                    type="button"
                                    className="inward-btn-cancel"
                                    onClick={handleCloseModal}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="inward-btn-submit"
                                    disabled={saving}
                                >
                                    {saving ? "Saving..." : editId ? "Update Starting Place" : "Save Starting Place"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ── Delete Confirmation Modal ── */}
            {deleteTarget && (
                <div className="inward-modal-overlay" onClick={() => setDeleteTarget(null)}>
                    <div
                        className="inward-modal inward-delete-modal"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="inward-modal__header">
                            <h2>Delete Starting Place?</h2>
                            <button
                                className="inward-modal__close-btn"
                                onClick={() => setDeleteTarget(null)}
                                aria-label="Close modal"
                            >
                                <MdClose size={20} />
                            </button>
                        </div>
                        <div className="inward-modal__body">
                            <p>
                                Are you sure you want to delete <b>{deleteTarget.name}</b>?
                                This will remove it from the list of configured starting places for inward route generation.
                            </p>
                        </div>
                        <div className="inward-modal__footer">
                            <button
                                type="button"
                                className="inward-btn-cancel"
                                onClick={() => setDeleteTarget(null)}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="inward-btn-delete"
                                onClick={handleDelete}
                                disabled={deleting}
                            >
                                {deleting ? "Deleting..." : "Delete Starting Place"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default InwardStartingPlaces;
