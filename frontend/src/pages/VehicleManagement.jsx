import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import { MdDirectionsBus, MdAdd, MdEdit, MdDelete, MdClose, MdRefresh } from "react-icons/md";
import { HiArrowLeft } from "react-icons/hi2";

import api from "../services/api";

import "../css/VehicleManagement.css";


const VehicleManagement = () => {

    const navigate = useNavigate();

    const [vehicles, setVehicles] = useState([]);
    const [loading, setLoading]   = useState(true);
    const [error, setError]       = useState(false);
    const [showForm, setShowForm] = useState(false);

    const [vehicle, setVehicle] = useState({
        vehicleName: "",
        capacity: ""
    });

    const [editId, setEditId] = useState(null);


    // ── Get Vehicles ──────────────────────────────────────────
    const getVehicles = async () => {
        try {
            setError(false);
            const response = await api.get("/vehicles");
            setVehicles(response.data.vehicles || []);
        } catch (error) {
            console.error("Failed to load vehicles:", error);
            setError(true);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        getVehicles();

        const handleSync = () => {
            if (document.visibilityState === "visible") {
                getVehicles();
            }
        };

        window.addEventListener("focus", handleSync);
        document.addEventListener("visibilitychange", handleSync);

        const pollInterval = setInterval(() => {
            getVehicles();
        }, 5000);

        return () => {
            window.removeEventListener("focus", handleSync);
            document.removeEventListener("visibilitychange", handleSync);
            clearInterval(pollInterval);
        };
    }, []);


    // ── Input Change ──────────────────────────────────────────
    const handleChange = (e) => {
        setVehicle({
            ...vehicle,
            [e.target.name]: e.target.value
        });
    };


    // ── Add / Update Vehicle ──────────────────────────────────
    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!vehicle.vehicleName || !vehicle.capacity) {
            toast.error("Fill all fields");
            return;
        }

        try {
            if (editId) {
                const response = await api.put(
                    `/vehicles/${editId}`,
                    vehicle
                );
                toast.success(response.data.message);
                setEditId(null);
            } else {
                const response = await api.post(
                    "/vehicles",
                    vehicle
                );
                toast.success(response.data.message);
            }

            setVehicle({ vehicleName: "", capacity: "" });
            setShowForm(false);
            getVehicles();

        } catch (error) {
            toast.error(
                error.response?.data?.message ||
                "Operation failed"
            );
        }
    };


    // ── Edit Vehicle ──────────────────────────────────────────
    const editVehicle = (bus) => {
        setVehicle({
            vehicleName: bus.vehicleName,
            capacity: bus.capacity
        });
        setEditId(bus._id);
        setShowForm(true);
        window.scrollTo({ top: 0, behavior: "smooth" });
    };


    // ── Delete Vehicle ────────────────────────────────────────
    const deleteVehicle = async (id) => {
        try {
            const response = await api.delete(`/vehicles/${id}`);
            toast.success(response.data.message);
            getVehicles();
        } catch (error) {
            toast.error(
                error.response?.data?.message ||
                "Delete failed"
            );
        }
    };


    // ── Cancel form ───────────────────────────────────────────
    const cancelForm = () => {
        setVehicle({ vehicleName: "", capacity: "" });
        setEditId(null);
        setShowForm(false);
    };


    // ── Bay number formatter ──────────────────────────────────
    const bayLabel = (index) =>
        `BAY ${String(index + 1).padStart(2, "0")}`;


    // ── Render ────────────────────────────────────────────────
    return (
        <div className="depot-page">

            {/* ── Page Header ── */}
            <header className="depot-header">
                <div className="depot-header__left">
                    <button
                        className="depot-back-btn"
                        onClick={() => navigate(-1)}
                        aria-label="Go back"
                    >
                        <HiArrowLeft size={16} />
                        Back
                    </button>

                    <div className="depot-brand">
                        <div className="depot-brand__icon" aria-hidden="true">
                            <MdDirectionsBus size={22} />
                        </div>
                        <div>
                            <p className="depot-brand__label">Fleet Depot</p>
                            <h1 className="depot-brand__title">Vehicle Management</h1>
                        </div>
                    </div>
                </div>

                <div className="depot-header__right">
                    <p className="depot-header__subtitle">
                        Manage and organize the registered transportation fleet
                    </p>
                    <button
                        className="depot-add-btn"
                        onClick={() => { cancelForm(); setShowForm(true); }}
                        aria-label="Add new vehicle"
                    >
                        <MdAdd size={18} />
                        Add Vehicle
                    </button>
                </div>
            </header>


            {/* ── Add / Edit Form Panel ── */}
            {showForm && (
                <div className="depot-form-overlay" role="dialog" aria-modal="true" aria-label={editId ? "Edit vehicle" : "Add vehicle"}>
                    <div className="depot-form-panel">
                        <div className="depot-form-panel__header">
                            <h2 className="depot-form-panel__title">
                                {editId ? "Edit Vehicle" : "Register New Vehicle"}
                            </h2>
                            <button
                                className="depot-form-close"
                                onClick={cancelForm}
                                aria-label="Close form"
                            >
                                <MdClose size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="depot-form">
                            <div className="depot-form__group">
                                <label htmlFor="vehicleName" className="depot-form__label">
                                    Vehicle Name
                                </label>
                                <input
                                    id="vehicleName"
                                    type="text"
                                    name="vehicleName"
                                    placeholder="e.g. J1, Q1, A2"
                                    value={vehicle.vehicleName}
                                    onChange={handleChange}
                                    className="depot-form__input"
                                    autoComplete="off"
                                />
                            </div>

                            <div className="depot-form__group">
                                <label htmlFor="capacity" className="depot-form__label">
                                    Seat Capacity
                                </label>
                                <input
                                    id="capacity"
                                    type="number"
                                    name="capacity"
                                    placeholder="e.g. 70"
                                    value={vehicle.capacity}
                                    onChange={handleChange}
                                    className="depot-form__input"
                                    min="1"
                                />
                            </div>

                            <div className="depot-form__actions">
                                <button
                                    type="button"
                                    className="depot-form__cancel"
                                    onClick={cancelForm}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="depot-form__submit"
                                >
                                    {editId ? "Update Vehicle" : "Register Vehicle"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}


            {/* ── Depot Floor ── */}
            <main className="depot-floor">
                <div className="depot-floor__header">
                    <div className="depot-floor__header-left">
                        <h2 className="depot-floor__title">Depot Floor</h2>
                        <p className="depot-floor__subtitle">Registered fleet vehicles</p>
                    </div>
                    <div className="depot-floor__header-right">
                        {!loading && !error && (
                            <span className="depot-vehicle-count">
                                {vehicles.length === 0
                                    ? "No vehicles registered"
                                    : `${vehicles.length} registered vehicle${vehicles.length !== 1 ? "s" : ""}`
                                }
                            </span>
                        )}
                    </div>
                </div>

                <div className="depot-floor__divider" aria-hidden="true" />


                {/* ── Loading State ── */}
                {loading && (
                    <div className="depot-bay-grid" aria-busy="true" aria-label="Loading vehicles">
                        {[1, 2, 3, 4, 5, 6].map((n) => (
                            <div className="depot-bay depot-bay--skeleton" key={n} aria-hidden="true">
                                <div className="depot-bay__label-sk" />
                                <div className="depot-bay__icon-sk" />
                                <div className="depot-bay__name-sk" />
                                <div className="depot-bay__capacity-sk" />
                                <div className="depot-bay__actions-sk" />
                            </div>
                        ))}
                    </div>
                )}


                {/* ── Error State ── */}
                {!loading && error && (
                    <div className="depot-state depot-state--error" role="alert">
                        <MdDirectionsBus size={48} className="depot-state__icon" aria-hidden="true" />
                        <p className="depot-state__message">Unable to load fleet vehicles.</p>
                        <button
                            className="depot-retry-btn"
                            onClick={getVehicles}
                        >
                            <MdRefresh size={16} />
                            Retry
                        </button>
                    </div>
                )}


                {/* ── Empty State ── */}
                {!loading && !error && vehicles.length === 0 && (
                    <div className="depot-state depot-state--empty">
                        <MdDirectionsBus size={56} className="depot-state__icon" aria-hidden="true" />
                        <h3 className="depot-state__heading">Depot Is Empty</h3>
                        <p className="depot-state__message">
                            No vehicles have been registered yet.
                        </p>
                        <button
                            className="depot-add-btn depot-add-btn--center"
                            onClick={() => setShowForm(true)}
                        >
                            <MdAdd size={18} />
                            Add Vehicle
                        </button>
                    </div>
                )}


                {/* ── Depot Bay Grid ── */}
                {!loading && !error && vehicles.length > 0 && (
                    <div className="depot-bay-grid">
                        {vehicles.map((bus, index) => (
                            <article
                                className="depot-bay"
                                key={bus._id}
                                aria-label={`${bayLabel(index)}: ${bus.vehicleName}`}
                            >
                                {/* Bay label */}
                                <div className="depot-bay__label" aria-hidden="true">
                                    <span className="depot-bay__label-text">{bayLabel(index)}</span>
                                    <span className="depot-bay__label-line" />
                                </div>

                                {/* Bus silhouette */}
                                <div className="depot-bay__icon-wrap" aria-hidden="true">
                                    <MdDirectionsBus size={52} className="depot-bay__bus-icon" />
                                </div>

                                {/* Vehicle identity */}
                                <div className="depot-bay__identity">
                                    <span className="depot-bay__name">{bus.vehicleName}</span>
                                    <span className="depot-bay__type-label">Vehicle</span>
                                </div>

                                {/* Divider */}
                                <div className="depot-bay__separator" aria-hidden="true" />

                                {/* Seat capacity */}
                                <div className="depot-bay__capacity">
                                    <span className="depot-bay__capacity-label">Seat Capacity</span>
                                    <span className="depot-bay__capacity-value">
                                        {bus.capacity} <span className="depot-bay__seats-unit">seats</span>
                                    </span>
                                </div>

                                {/* Actions */}
                                <div className="depot-bay__actions">
                                    <button
                                        className="depot-bay__edit-btn"
                                        onClick={() => editVehicle(bus)}
                                        aria-label={`Edit ${bus.vehicleName}`}
                                    >
                                        <MdEdit size={14} />
                                        Edit
                                    </button>
                                    <button
                                        className="depot-bay__delete-btn"
                                        onClick={() => deleteVehicle(bus._id)}
                                        aria-label={`Delete ${bus.vehicleName}`}
                                    >
                                        <MdDelete size={14} />
                                        Delete
                                    </button>
                                </div>
                            </article>
                        ))}
                    </div>
                )}

            </main>

        </div>
    );

};


export default VehicleManagement;