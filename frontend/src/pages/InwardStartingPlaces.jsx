import React, { useEffect, useState, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import { HiArrowLeft } from "react-icons/hi";
import {
    getInwardStartingPlaces,
    addInwardStartingPlace,
    updateInwardStartingPlace,
    deleteInwardStartingPlace,
    toggleInwardStartingPlaceStatus,
    getAIData,
    getActivePlan
} from "../services/aiAgentService";
import LocationSearchBox from "../components/LocationSearchBox";
import "../css/AIAgent.css";
import "../css/InwardStartingPlaces.css";

const getBusCapacity = (bus) =>
    Number(
        bus?.capacity ??
        bus?.seatCapacity ??
        bus?.seats ??
        bus?.totalSeats ??
        0
    );

const getBusName = (bus, index = 0) =>
    bus?.vehicleName ||
    bus?.name ||
    bus?.busName ||
    `Bus ${index + 1}`;

const InwardStartingPlaces = () => {
    const navigate = useNavigate();

    const [places, setPlaces] = useState(() => {
        try {
            const cached = localStorage.getItem("cached_inward_starting_places");
            if (cached) {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            }
        } catch { }
        return [];
    });
    const [loading, setLoading] = useState(() => {
        try {
            const cached = localStorage.getItem("cached_inward_starting_places");
            if (cached) {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed) && parsed.length > 0) return false;
            }
        } catch { }
        return true;
    });
    const [aiData, setAiData] = useState(null);
    const [activePlan, setActivePlan] = useState(null);

    // Modal state
    const [showModal, setShowModal] = useState(false);
    const [saving, setSaving] = useState(false);
    const [modalError, setModalError] = useState("");
    const [editingPlace, setEditingPlace] = useState(null);
    const [modalBusId, setModalBusId] = useState("");
    const [modalLocation, setModalLocation] = useState(null);

    // Prevent background scroll when modal is open
    useEffect(() => {
        if (showModal) {
            const originalOverflow = document.body.style.overflow;
            document.body.style.overflow = "hidden";
            return () => {
                document.body.style.overflow = originalOverflow;
            };
        }
    }, [showModal]);

    // Fetch starting places immediately and fleet metrics in background
    const loadStartingPlaces = async (showLoadingSpinner = true) => {
        try {
            if (showLoadingSpinner && (!places || places.length === 0)) {
                setLoading(true);
            }
            const res = await getInwardStartingPlaces();
            if (res?.success && Array.isArray(res.startingPlaces)) {
                setPlaces(res.startingPlaces);
                try {
                    localStorage.setItem("cached_inward_starting_places", JSON.stringify(res.startingPlaces));
                } catch { }
            }
        } catch (err) {
            console.error("Failed to load starting places:", err);
            toast.error("Failed to load starting places");
        } finally {
            setLoading(false);
        }
    };

    const loadFleetMetrics = async () => {
        try {
            const [aiRes, planRes] = await Promise.allSettled([
                getAIData(),
                getActivePlan({ direction: "INWARD", planType: "AI" })
            ]);
            if (aiRes.status === "fulfilled" && aiRes.value) {
                setAiData(aiRes.value);
            }
            if (planRes.status === "fulfilled" && planRes.value?.success) {
                setActivePlan(planRes.value.inwardPlan || planRes.value.plan || null);
            }
        } catch (err) {
            console.warn("Failed to load fleet metrics:", err);
        }
    };

    const loadAllData = async (showLoadingSpinner = true) => {
        await Promise.all([
            loadStartingPlaces(showLoadingSpinner),
            loadFleetMetrics()
        ]);
    };

    useEffect(() => {
        loadAllData(true);

        const handleSync = () => {
            if (document.visibilityState === "visible") {
                loadAllData(false);
            }
        };

        window.addEventListener("focus", handleSync);
        document.addEventListener("visibilitychange", handleSync);

        return () => {
            window.removeEventListener("focus", handleSync);
            document.removeEventListener("visibilitychange", handleSync);
        };
    }, []);

    // ── Fleet Readiness Calculations (Exact logic matching AI Agent) ──
    const studentCount = Number(
        aiData?.confirmedUserCount ??
        aiData?.comingUsers ??
        activePlan?.summary?.confirmedUsers ??
        0
    );

    const vehicleList = useMemo(() => {
        return aiData?.availableVehicles || aiData?.vehicles || [];
    }, [aiData]);

    const theoreticalMinBuses = Number(
        aiData?.requiredBusesCount ??
        activePlan?.summary?.requiredBusesCount ??
        activePlan?.theoreticalMinimum ??
        activePlan?.minimumCapacityBuses ??
        (studentCount > 0
            ? Math.max(1, Math.ceil(studentCount / (vehicleList?.[0]?.capacity || 65)))
            : 1)
    );

    const feasibleBusesCount = Number(
        activePlan?.feasibleBusCount ??
        activePlan?.buses?.length ??
        theoreticalMinBuses
    );

    const activeStartingPlacesCount = useMemo(() => {
        return places.filter((p) => p.active).length;
    }, [places]);

    const hasActiveInwardPlan = Boolean(
        activePlan ||
        (Array.isArray(activePlan?.buses) && activePlan.buses.length > 0)
    );

    const requiredBusTarget = hasActiveInwardPlan ? feasibleBusesCount : theoreticalMinBuses;
    const hasSufficientStartingPlaces = activeStartingPlacesCount >= requiredBusTarget;

    // ── Form Modal Handlers ──
    const handleOpenAddModal = () => {
        setEditingPlace(null);
        setModalBusId("");
        setModalLocation(null);
        setModalError("");
        setShowModal(true);
    };

    const handleOpenEditModal = (place) => {
        setEditingPlace(place);
        setModalBusId(place.vehicleId || place.busId || place._id || "");
        setModalLocation({
            name: place.locationName || place.name || "",
            displayName: place.address || place.locationName || place.name || "",
            address: place.address || "",
            latitude: place.latitude,
            longitude: place.longitude
        });
        setModalError("");
        setShowModal(true);
    };

    const handleCloseModal = () => {
        setShowModal(false);
        setEditingPlace(null);
        setModalBusId("");
        setModalLocation(null);
        setModalError("");
    };

    const handleSave = async (e) => {
        if (e) e.preventDefault();
        setModalError("");

        if (!modalBusId) {
            setModalError("Please select an available bus.");
            return;
        }

        if (!modalLocation || !modalLocation.latitude || !modalLocation.longitude) {
            setModalError("Please select a valid starting location.");
            return;
        }

        const chosenBus = vehicleList.find(
            (b) => String(b._id || b.id) === String(modalBusId)
        );
        const busName = chosenBus
            ? getBusName(chosenBus)
            : (editingPlace?.busName || modalBusId);
        const capacity = chosenBus
            ? getBusCapacity(chosenBus)
            : (editingPlace?.capacity || 0);

        try {
            setSaving(true);
            const payload = {
                vehicleId: String(modalBusId),
                busId: String(modalBusId),
                busName,
                capacity,
                locationName: modalLocation.name || modalLocation.displayName,
                name: modalLocation.name || modalLocation.displayName,
                address: modalLocation.address || modalLocation.displayName || "",
                latitude: Number(modalLocation.latitude),
                longitude: Number(modalLocation.longitude),
                active: true
            };

            let res;
            if (editingPlace?._id) {
                res = await updateInwardStartingPlace(editingPlace._id, payload);
            } else {
                res = await addInwardStartingPlace(payload);
            }

            if (res?.success) {
                toast.success(res.message || "Starting place saved successfully");
                handleCloseModal();
                await loadAllData(false);
            } else {
                setModalError(res?.message || "Failed to save starting place");
            }
        } catch (err) {
            const msg =
                err?.response?.data?.message ||
                err.message ||
                "Failed to save starting place";
            setModalError(msg);
        } finally {
            setSaving(false);
        }
    };

    const handleToggleStartingPlace = async (id) => {
        try {
            const res = await toggleInwardStartingPlaceStatus(id);
            if (res?.success) {
                toast.success(res.message || "Status updated");
                await loadAllData(false);
            } else {
                toast.error(res?.message || "Failed to toggle status");
            }
        } catch (err) {
            toast.error(
                err?.response?.data?.message || err.message || "Failed to toggle status"
            );
        }
    };

    const handleDeleteStartingPlace = async (id) => {
        if (!window.confirm("Are you sure you want to remove this inward starting place configuration?")) {
            return;
        }

        try {
            const res = await deleteInwardStartingPlace(id);
            if (res?.success) {
                toast.success("Starting place removed");
                await loadAllData(false);
            } else {
                toast.error(res?.message || "Failed to delete");
            }
        } catch (err) {
            toast.error(
                err?.response?.data?.message || err.message || "Failed to delete"
            );
        }
    };

    return (
        <div className="ai-page">
            {/* Campus & Bus Background Illustration (Ocean Breeze Theme) */}
            <div className="ai-hero-bg" aria-hidden="true">
                <div className="ai-hero-illustration"></div>
            </div>

            {/* Header */}
            <div className="ai-header inward-page-header">
                <div className="ai-header-left">
                    <button
                        type="button"
                        className="ai-back-btn"
                        onClick={() => navigate("/ai-agent")}
                        aria-label="Go back to AI Agent"
                    >
                        <HiArrowLeft size={16} />
                        Back
                    </button>
                    <h1 className="ai-page-title">INWARD BUS STARTING PLACES</h1>
                    <p className="ai-page-subtitle">
                        Configure and manage the starting hub/location for each inward bus.
                    </p>
                </div>

                <div className="ai-header-actions">
                    <div
                        className={`ai-ready ${
                            hasSufficientStartingPlaces ? "ready" : "invalidated"
                        }`}
                    >
                        <span className="ready-dot"></span>
                        {hasSufficientStartingPlaces
                            ? "Fleet Ready to Generate"
                            : "Configuration Required"}
                    </div>
                </div>
            </div>

            {/* Management Section */}
            <div className="inward-mgmt-container">
                {/* ── Fleet Readiness Information Banner ── */}
                <div
                    className={`inward-readiness-banner ${
                        hasSufficientStartingPlaces ? "banner-ready" : "banner-warning"
                    }`}
                >
                    <span className="banner-icon">
                        {hasSufficientStartingPlaces ? "✓" : "⚠️"}
                    </span>
                    <div className="banner-text">
                        {hasSufficientStartingPlaces
                            ? hasActiveInwardPlan && feasibleBusesCount !== theoreticalMinBuses
                                ? `${feasibleBusesCount} buses operationally required for ${studentCount} passengers (theoretical capacity minimum: ${theoreticalMinBuses} buses, operationally required fleet: ${feasibleBusesCount} buses). All selected inward buses have configured starting places. Ready to generate.`
                                : `${feasibleBusesCount || theoreticalMinBuses} buses operationally required for ${studentCount} passengers (theoretical capacity minimum: ${theoreticalMinBuses} buses). All selected inward buses have configured starting places. Ready to generate.`
                            : `Theoretical capacity minimum: ${theoreticalMinBuses} buses for ${studentCount} passengers. Starting locations configured for ${activeStartingPlacesCount} buses. Configuration required before generating inward routes.`}
                    </div>
                </div>

                {/* ── Control Toolbar ── */}
                <div className="inward-mgmt-toolbar">
                    <div className="inward-toolbar-left">
                        <span className="inward-count-badge">
                            Configured Starting Places ({places.length})
                        </span>
                        <span className="inward-active-count-badge">
                            {activeStartingPlacesCount} Active
                        </span>
                    </div>

                    <button
                        type="button"
                        className="configure-start-place-btn"
                        onClick={handleOpenAddModal}
                    >
                        + Configure Bus Starting Place
                    </button>
                </div>

                {/* ── Starting Hub Cards Grid ── */}
                {loading ? (
                    <div className="inward-loading-state">
                        Loading inward starting places...
                    </div>
                ) : places.length === 0 ? (
                    <div className="no-places-notice">
                        <p>
                            No inward bus starting places configured yet. Click{" "}
                            <strong>+ Configure Bus Starting Place</strong> to assign starting
                            locations for available buses.
                        </p>
                    </div>
                ) : (
                    <div className="inward-cards-grid-wrap">
                        <div className="bus-start-cards-grid">
                            {places.map((sp) => (
                                <div
                                    key={sp._id}
                                    className={`bus-start-card ${
                                        sp.active ? "active-place" : "inactive-place"
                                    }`}
                                >
                                    <div className="bus-start-info">
                                        {/* TOP ROW: Dark navy bus badge, light capacity badge, Active pill */}
                                        <div className="bus-badge-row">
                                            <span className="bus-name-badge">{sp.busName}</span>
                                            {sp.capacity > 0 && (
                                                <span className="bus-cap-badge">
                                                    {sp.capacity} seats
                                                </span>
                                            )}
                                            <span
                                                className={`status-pill ${
                                                    sp.active ? "active" : "inactive"
                                                }`}
                                            >
                                                {sp.active ? "Active" : "Inactive"}
                                            </span>
                                        </div>

                                        {/* MIDDLE AREA: Pink pin, bold name, address, coordinates */}
                                        <div className="location-detail">
                                            <span className="loc-icon">📍</span>
                                            <div>
                                                <strong>{sp.locationName || sp.name}</strong>
                                                {sp.address && <p>{sp.address}</p>}
                                                <small>
                                                    {Number(sp.latitude).toFixed(5)},{" "}
                                                    {Number(sp.longitude).toFixed(5)}
                                                </small>
                                            </div>
                                        </div>
                                    </div>

                                    {/* BOTTOM AREA: Divider and three equal buttons: Edit | Deactivate/Activate | Remove */}
                                    <div className="bus-start-actions">
                                        <button
                                            type="button"
                                            onClick={() => handleOpenEditModal(sp)}
                                        >
                                            Edit
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleToggleStartingPlace(sp._id)}
                                        >
                                            {sp.active ? "Deactivate" : "Activate"}
                                        </button>
                                        <button
                                            type="button"
                                            className="btn-remove"
                                            onClick={() => handleDeleteStartingPlace(sp._id)}
                                        >
                                            Remove
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* ── Configuration / Edit Modal ── */}
            {showModal && (
                <div className="start-modal-overlay">
                    <div className="start-modal-dialog">
                        <div className="start-modal-header">
                            <h3>
                                {editingPlace
                                    ? `Edit Inward Starting Place — ${editingPlace.busName}`
                                    : "Configure Inward Bus Starting Place"}
                            </h3>
                            <button
                                type="button"
                                className="start-modal-close"
                                onClick={handleCloseModal}
                                aria-label="Close dialog"
                            >
                                &times;
                            </button>
                        </div>

                        {modalError && (
                            <div className="start-modal-error">
                                ⚠ {modalError}
                            </div>
                        )}

                        <form onSubmit={handleSave} className="start-modal-form">
                            <div className="start-modal-group">
                                <label>Bus</label>
                                <select
                                    className="start-modal-select"
                                    value={modalBusId}
                                    onChange={(e) => setModalBusId(e.target.value)}
                                    disabled={Boolean(editingPlace)}
                                >
                                    <option value="">-- Select Available Bus --</option>
                                    {vehicleList.map((b) => (
                                        <option
                                            key={b._id || b.id}
                                            value={String(b._id || b.id)}
                                        >
                                            {getBusName(b)} - {getBusCapacity(b)} Seats
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="start-modal-group">
                                <label>Starting Hub / Location</label>
                                <LocationSearchBox
                                    placeholder="Search starting hub: bus stand, area, junction, terminal..."
                                    selectedLocation={modalLocation}
                                    onSelectLocation={(loc) => setModalLocation(loc)}
                                    onClear={() => setModalLocation(null)}
                                />
                                {modalLocation && (
                                    <div className="loc-selected-summary">
                                        <span>📍</span>
                                        <span>
                                            {modalLocation.name || modalLocation.displayName} (
                                            {Number(modalLocation.latitude).toFixed(4)},{" "}
                                            {Number(modalLocation.longitude).toFixed(4)})
                                        </span>
                                    </div>
                                )}
                            </div>

                            <div className="start-modal-actions">
                                <button
                                    type="button"
                                    className="start-modal-btn-cancel"
                                    onClick={handleCloseModal}
                                    disabled={saving}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="start-modal-btn-submit"
                                    disabled={saving || !modalBusId || !modalLocation}
                                >
                                    {saving ? "Saving..." : "Save Bus Starting Place"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default InwardStartingPlaces;
