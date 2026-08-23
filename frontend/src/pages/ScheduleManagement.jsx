import { useEffect, useState, useMemo } from "react";
import axios from "axios";
import { toast } from "react-hot-toast";
import {
    FiTruck,
    FiCheckCircle,
    FiXCircle,
    FiSearch,
    FiLayers,
    FiRefreshCw,
    FiCheck,
    FiX
} from "react-icons/fi";
import "../css/ScheduleManagement.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const ScheduleManagement = () => {
    const [vehicles, setVehicles] = useState([]);
    const [schedules, setSchedules] = useState([]);
    const [loading, setLoading] = useState(true);
    const [updatingId, setUpdatingId] = useState(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState("ALL");

    const getConfig = () => ({
        headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`
        }
    });

    const loadData = async () => {
        try {
            setLoading(true);
            const [vehicleResponse, scheduleResponse] = await Promise.all([
                axios.get(`${API_URL}/vehicles`, getConfig()),
                axios.get(`${API_URL}/schedules`, getConfig())
            ]);

            const vehicleData =
                vehicleResponse.data.vehicles ||
                vehicleResponse.data.data ||
                [];

            setVehicles(vehicleData);
            setSchedules(scheduleResponse.data.schedules || []);
        } catch (error) {
            console.error("Load Scheduling Error:", error);
            toast.error(
                error.response?.data?.message || "Unable to load schedule data."
            );
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    // Create a unified list of vehicles with their availability status
    const vehicleScheduleList = useMemo(() => {
        const scheduleMap = new Map();
        schedules.forEach((s) => {
            const vId = String(s.vehicle?._id || s.vehicle || "");
            if (vId) {
                scheduleMap.set(vId, s);
            }
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

    // Metrics
    const metrics = useMemo(() => {
        const total = vehicleScheduleList.length;
        const available = vehicleScheduleList.filter(
            (v) => v.availability === "Available"
        ).length;
        const notAvailable = total - available;
        const availableCapacity = vehicleScheduleList
            .filter((v) => v.availability === "Available")
            .reduce((sum, v) => sum + (Number(v.capacity) || 0), 0);

        return { total, available, notAvailable, availableCapacity };
    }, [vehicleScheduleList]);

    // Filtered list
    const filteredList = useMemo(() => {
        return vehicleScheduleList.filter((item) => {
            const matchesSearch =
                !searchQuery ||
                item.vehicleName
                    ?.toLowerCase()
                    .includes(searchQuery.toLowerCase());

            if (!matchesSearch) return false;

            if (statusFilter === "AVAILABLE") {
                return item.availability === "Available";
            }
            if (statusFilter === "NOT_AVAILABLE") {
                return item.availability === "Not Available";
            }
            return true;
        });
    }, [vehicleScheduleList, searchQuery, statusFilter]);

    // Fast toggle availability
    const toggleAvailability = async (item) => {
        const newStatus =
            item.availability === "Available"
                ? "Not Available"
                : "Available";

        try {
            setUpdatingId(item._id);

            await axios.post(
                `${API_URL}/schedules`,
                {
                    vehicle: item._id,
                    availability: newStatus
                },
                getConfig()
            );

            toast.success(
                `${item.vehicleName} marked as ${newStatus}`
            );

            // Optimistic update
            setSchedules((prev) => {
                const existingIndex = prev.findIndex(
                    (s) => String(s.vehicle?._id || s.vehicle) === String(item._id)
                );
                if (existingIndex >= 0) {
                    const updated = [...prev];
                    updated[existingIndex] = {
                        ...updated[existingIndex],
                        availability: newStatus
                    };
                    return updated;
                } else {
                    return [
                        ...prev,
                        {
                            vehicle: item,
                            availability: newStatus
                        }
                    ];
                }
            });
        } catch (error) {
            console.error("Toggle Availability Error:", error);
            toast.error(
                error.response?.data?.message || "Failed to update availability."
            );
            await loadData();
        } finally {
            setUpdatingId(null);
        }
    };

    // Bulk set all
    const setAllStatus = async (status) => {
        try {
            setLoading(true);
            await Promise.all(
                vehicles.map((v) =>
                    axios.post(
                        `${API_URL}/schedules`,
                        {
                            vehicle: v._id,
                            availability: status
                        },
                        getConfig()
                    )
                )
            );
            toast.success(`All vehicles marked as ${status}`);
            await loadData();
        } catch (error) {
            console.error("Bulk update error:", error);
            toast.error("Failed to update all vehicles.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="schedule-management">
            {/* Header */}
            <div className="schedule-header">
                <div className="schedule-header-left">
                    <span className="schedule-badge-tag">
                        FLEET SCHEDULING &amp; DISPATCH
                    </span>
                    <h1>Schedule Management</h1>
                    <p>
                        Enable or disable vehicle availability for daily transportation and AI route optimization.
                    </p>
                </div>
                <div className="schedule-header-actions">
                    <button
                        type="button"
                        className="refresh-btn"
                        onClick={loadData}
                        disabled={loading}
                    >
                        <FiRefreshCw className={loading ? "spin" : ""} />
                        <span>Refresh</span>
                    </button>
                </div>
            </div>

            {/* Metrics Grid */}
            <div className="schedule-metrics-grid">
                <div className="sched-metric-card">
                    <div className="sched-metric-icon fleet">
                        <FiTruck />
                    </div>
                    <div className="sched-metric-data">
                        <span className="metric-val">{metrics.total}</span>
                        <span className="metric-lbl">Total Vehicles</span>
                    </div>
                </div>

                <div className="sched-metric-card">
                    <div className="sched-metric-icon available">
                        <FiCheckCircle />
                    </div>
                    <div className="sched-metric-data">
                        <span className="metric-val text-success">{metrics.available}</span>
                        <span className="metric-lbl">Available for Trips</span>
                    </div>
                </div>

                <div className="sched-metric-card">
                    <div className="sched-metric-icon unavailable">
                        <FiXCircle />
                    </div>
                    <div className="sched-metric-data">
                        <span className="metric-val text-danger">{metrics.notAvailable}</span>
                        <span className="metric-lbl">Not Available</span>
                    </div>
                </div>

                <div className="sched-metric-card">
                    <div className="sched-metric-icon capacity">
                        <FiLayers />
                    </div>
                    <div className="sched-metric-data">
                        <span className="metric-val">{metrics.availableCapacity}</span>
                        <span className="metric-lbl">Available Seats</span>
                    </div>
                </div>
            </div>

            {/* Control Bar */}
            <div className="schedule-controls-card">
                <div className="schedule-search-box">
                    <FiSearch className="search-icon" />
                    <input
                        type="text"
                        placeholder="Search bus name or vehicle number..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    {searchQuery && (
                        <button
                            type="button"
                            className="clear-search"
                            onClick={() => setSearchQuery("")}
                        >
                            ×
                        </button>
                    )}
                </div>

                <div className="schedule-filters">
                    <button
                        type="button"
                        className={`filter-btn ${statusFilter === "ALL" ? "active" : ""}`}
                        onClick={() => setStatusFilter("ALL")}
                    >
                        All ({metrics.total})
                    </button>
                    <button
                        type="button"
                        className={`filter-btn ${statusFilter === "AVAILABLE" ? "active" : ""}`}
                        onClick={() => setStatusFilter("AVAILABLE")}
                    >
                        Available ({metrics.available})
                    </button>
                    <button
                        type="button"
                        className={`filter-btn ${statusFilter === "NOT_AVAILABLE" ? "active" : ""}`}
                        onClick={() => setStatusFilter("NOT_AVAILABLE")}
                    >
                        Not Available ({metrics.notAvailable})
                    </button>
                </div>

                <div className="bulk-actions">
                    <button
                        type="button"
                        className="bulk-btn mark-all-avail"
                        onClick={() => setAllStatus("Available")}
                        disabled={loading || metrics.available === metrics.total}
                    >
                        <FiCheck /> Mark All Available
                    </button>
                    <button
                        type="button"
                        className="bulk-btn mark-all-unavail"
                        onClick={() => setAllStatus("Not Available")}
                        disabled={loading || metrics.notAvailable === metrics.total}
                    >
                        <FiX /> Mark All Unavailable
                    </button>
                </div>
            </div>

            {/* Schedule List */}
            <div className="schedule-list-card">
                {loading && vehicleScheduleList.length === 0 ? (
                    <div className="sched-loading-state">
                        <div className="sched-spinner"></div>
                        <p>Loading schedule availability...</p>
                    </div>
                ) : filteredList.length === 0 ? (
                    <div className="sched-empty-state">
                        <span className="empty-icon">🚌</span>
                        <h3>No vehicles found</h3>
                        <p>
                            {vehicles.length === 0
                                ? "No vehicles registered in Vehicle Management yet."
                                : "No vehicles match the selected filter or search term."}
                        </p>
                    </div>
                ) : (
                    <div className="schedule-table-responsive">
                        <table className="schedule-table">
                            <thead>
                                <tr>
                                    <th>Vehicle Name</th>
                                    <th>Seat Capacity</th>
                                    <th>Current Status</th>
                                    <th>Quick Status Control</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredList.map((item) => {
                                    const isAvailable = item.availability === "Available";
                                    const isUpdating = updatingId === item._id;

                                    return (
                                        <tr key={item._id} className={!isAvailable ? "row-unavailable" : ""}>
                                            <td className="vehicle-name-cell">
                                                <div className="vehicle-icon-wrap">
                                                    🚌
                                                </div>
                                                <div>
                                                    <strong>{item.vehicleName}</strong>
                                                    <span className="vehicle-sub-id">
                                                        ID: {item._id.slice(-6).toUpperCase()}
                                                    </span>
                                                </div>
                                            </td>

                                            <td className="capacity-cell">
                                                <span className="capacity-pill">
                                                    <b>{item.capacity}</b> seats
                                                </span>
                                            </td>

                                            <td className="status-cell">
                                                <span
                                                    className={`status-badge ${
                                                        isAvailable ? "badge-available" : "badge-unavailable"
                                                    }`}
                                                >
                                                    <span className="status-dot"></span>
                                                    {isAvailable ? "Available" : "Not Available"}
                                                </span>
                                            </td>

                                            <td className="action-cell">
                                                <div className="status-toggle-wrapper">
                                                    <button
                                                        type="button"
                                                        className={`status-btn btn-avail ${
                                                            isAvailable ? "is-selected" : ""
                                                        }`}
                                                        onClick={() =>
                                                            !isAvailable && toggleAvailability(item)
                                                        }
                                                        disabled={isUpdating || isAvailable}
                                                    >
                                                        <FiCheckCircle /> Available
                                                    </button>

                                                    <button
                                                        type="button"
                                                        className={`status-btn btn-unavail ${
                                                            !isAvailable ? "is-selected" : ""
                                                        }`}
                                                        onClick={() =>
                                                            isAvailable && toggleAvailability(item)
                                                        }
                                                        disabled={isUpdating || !isAvailable}
                                                    >
                                                        <FiXCircle /> Not Available
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
            </div>
        </div>
    );
};

export default ScheduleManagement;