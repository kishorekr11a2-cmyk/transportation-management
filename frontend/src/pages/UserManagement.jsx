import {
    useEffect,
    useState,
    useMemo,
    useCallback
} from "react";

import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import api from "../services/api";
import "../css/UserManagement.css";

function UserManagement() {
    const navigate = useNavigate();

    // Data states
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState(null);

    // Search and Filter states
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState("All");
    const [stopFilter, setStopFilter] = useState("All");
    const [allocationFilter, setAllocationFilter] = useState("All");

    // Modal states
    const [showResetModal, setShowResetModal] = useState(false);
    const [resettingGlobal, setResettingGlobal] = useState(false);
    const [userToDelete, setUserToDelete] = useState(null);
    const [deletingUser, setDeletingUser] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);
    const [addingUser, setAddingUser] = useState(false);
    const [newUser, setNewUser] = useState({
        userId: "",
        name: "",
        stoppings: "",
        city: "",
        district: "",
        state: "",
        country: "India",
        travelStatus: "Coming"
    });

    // =========================================================
    // 1. Fetch Users
    // =========================================================
    const fetchUsers = useCallback(async (showSpinner = false) => {
        try {
            if (showSpinner) {
                setLoading(true);
                setFetchError(null);
            }
            const response = await api.get("/users");
            setUsers(response.data || []);
            setFetchError(null);
        } catch (error) {
            console.error("Fetch Users Error:", error);
            const msg = error.response?.data?.message || "Failed to load users from database";
            setFetchError(msg);
            if (showSpinner) {
                toast.error(msg);
            }
        } finally {
            if (showSpinner) {
                setLoading(false);
            }
        }
    }, []);

    // =========================================================
    // 2. Lifecycle & Real-Time Sync
    // =========================================================
    useEffect(() => {
        fetchUsers(true);

        const handleSync = () => {
            if (document.visibilityState === "visible") {
                fetchUsers(false);
            }
        };

        window.addEventListener("focus", handleSync);
        document.addEventListener("visibilitychange", handleSync);

        const pollInterval = setInterval(() => {
            fetchUsers(false);
        }, 5000);

        return () => {
            window.removeEventListener("focus", handleSync);
            document.removeEventListener("visibilitychange", handleSync);
            clearInterval(pollInterval);
        };
    }, [fetchUsers]);

    // =========================================================
    // 3. Dynamic Summary Metrics (Based on Unfiltered DB Data)
    // =========================================================
    const summary = useMemo(() => {
        let comingCount = 0;
        let notComingCount = 0;
        let pendingCount = 0;
        let allocatedCount = 0;

        users.forEach((user) => {
            const status = user.travelStatus || "Pending";
            if (status === "Coming") comingCount++;
            else if (status === "Not Coming") notComingCount++;
            else pendingCount++;

            const isUserAllocated =
                status === "Coming" &&
                Boolean(user.allocatedBus?.isAllocated || user.assignedVehicle || user.allocatedBus?.vehicleName);

            if (isUserAllocated) {
                allocatedCount++;
            }
        });

        const totalUsers = users.length;
        const unallocatedCount = Math.max(0, comingCount - allocatedCount);

        return {
            totalUsers,
            comingCount,
            notComingCount,
            pendingCount,
            allocatedCount,
            unallocatedCount
        };
    }, [users]);

    // =========================================================
    // 4. Unique Stopping Areas for Filter Dropdown
    // =========================================================
    const uniqueStops = useMemo(() => {
        const stopsSet = new Set();
        users.forEach((u) => {
            if (u.stoppings && typeof u.stoppings === "string" && u.stoppings.trim()) {
                stopsSet.add(u.stoppings.trim());
            }
        });
        return Array.from(stopsSet).sort((a, b) => a.localeCompare(b));
    }, [users]);

    // =========================================================
    // 5. Robust Multi-Field Search & Filter Engine
    // =========================================================
    const normalizeText = (val) => {
        if (val === null || val === undefined) return "";
        return String(val)
            .trim()
            .toLowerCase()
            .replace(/\s+/g, " ");
    };

    const matchesSearch = (user, query) => {
        if (!query) return true;
        const q = normalizeText(query);
        if (!q) return true;

        const searchableFields = [
            user.userId,
            user.name,
            user.stoppings,
            user.city,
            user.district,
            user.state,
            user.country,
            user.travelStatus,
            user.role,
            user.assignedVehicle,
            user.assignedRoute,
            user.allocationStatus,
            user.allocatedBus?.vehicleName,
            user.allocatedBus?.vehicleNumber,
            user.allocatedBus?.routeCode,
            user.allocatedBus?.routeName,
            // Combined geographic string
            [user.stoppings, user.city, user.state, user.country].filter(Boolean).join(", ")
        ];

        return searchableFields.some((field) => {
            if (!field) return false;
            return normalizeText(field).includes(q);
        });
    };

    const filteredUsers = useMemo(() => {
        return users.filter((user) => {
            // 1. Search Query Match
            if (!matchesSearch(user, searchQuery)) {
                return false;
            }

            // 2. Travel Status Filter
            if (statusFilter !== "All") {
                const userStatus = user.travelStatus || "Pending";
                if (userStatus !== statusFilter) {
                    return false;
                }
            }

            // 3. Stopping Area Filter
            if (stopFilter !== "All") {
                const userStop = user.stoppings ? user.stoppings.trim() : "Not set";
                if (userStop !== stopFilter) {
                    return false;
                }
            }

            // 4. Allocation Filter
            if (allocationFilter !== "All") {
                const isAllocated =
                    user.travelStatus === "Coming" &&
                    Boolean(user.allocatedBus?.isAllocated || user.assignedVehicle || user.allocatedBus?.vehicleName);

                if (allocationFilter === "Allocated" && !isAllocated) return false;
                if (allocationFilter === "Unallocated" && (isAllocated || user.travelStatus !== "Coming")) return false;
            }

            return true;
        });
    }, [users, searchQuery, statusFilter, stopFilter, allocationFilter]);

    const isFiltered = searchQuery.trim() !== "" || statusFilter !== "All" || stopFilter !== "All" || allocationFilter !== "All";

    const handleClearFilters = () => {
        setSearchQuery("");
        setStatusFilter("All");
        setStopFilter("All");
        setAllocationFilter("All");
    };

    // =========================================================
    // 6. User Actions: Global Reset, Single Reset, Add, Delete
    // =========================================================

    // Global Reset Travel Status
    const handleConfirmGlobalReset = async () => {
        try {
            setResettingGlobal(true);
            const response = await api.put("/users/reset-travel-status");

            if (response.data?.success) {
                localStorage.removeItem("active_ai_plan");

                setUsers((prevUsers) =>
                    prevUsers.map((u) => ({
                        ...u,
                        travelStatus: "Pending",
                        assignedVehicle: null,
                        assignedRoute: null,
                        allocationStatus: "Not Assigned",
                        allocatedBus: null
                    }))
                );

                toast.success(
                    response.data.message ||
                    "Travel status cycle reset successfully. All user responses and allocations have been cleared."
                );
                setShowResetModal(false);
            }
        } catch (error) {
            console.error("Reset Travel Status Error:", error);
            toast.error(
                error.response?.data?.message ||
                "Failed to reset travel status cycle"
            );
        } finally {
            setResettingGlobal(false);
        }
    };

    // Individual User Reset Travel Status
    const handleResetSingleUser = async (userId) => {
        try {
            const response = await api.put(`/users/${userId}/reset-travel-status`);
            if (response.data?.success) {
                const updatedUser = response.data.user;
                setUsers((prev) =>
                    prev.map((u) => (u.userId === userId || u._id === userId ? { ...u, ...updatedUser } : u))
                );
                toast.success(`Reset travel status for User ${userId}`);
            }
        } catch (error) {
            console.error("Single User Reset Error:", error);
            toast.error(
                error.response?.data?.message || `Failed to reset user ${userId}`
            );
        }
    };

    // Delete User
    const handleConfirmDelete = async () => {
        if (!userToDelete) return;
        try {
            setDeletingUser(true);
            const targetId = userToDelete._id || userToDelete.userId;
            const response = await api.delete(`/users/${targetId}`);
            if (response.data?.success) {
                setUsers((prev) => prev.filter((u) => u._id !== targetId && u.userId !== targetId));
                toast.success(`User ${userToDelete.name || userToDelete.userId} deleted`);
                setUserToDelete(null);
            }
        } catch (error) {
            console.error("Delete User Error:", error);
            toast.error(
                error.response?.data?.message || "Failed to delete user"
            );
        } finally {
            setDeletingUser(false);
        }
    };

    // Add User Manually
    const handleCreateUser = async (e) => {
        e.preventDefault();
        if (!newUser.userId.trim() || !newUser.name.trim()) {
            toast.error("User ID and Name are required");
            return;
        }

        try {
            setAddingUser(true);
            const response = await api.post("/users", newUser);
            if (response.data?.success || response.status === 201) {
                const created = response.data.user || response.data;
                setUsers((prev) => [created, ...prev]);
                toast.success(`User ${created.name} added successfully`);
                setShowAddModal(false);
                setNewUser({
                    userId: "",
                    name: "",
                    stoppings: "",
                    city: "",
                    district: "",
                    state: "",
                    country: "India",
                    travelStatus: "Coming"
                });
            }
        } catch (error) {
            console.error("Add User Error:", error);
            toast.error(
                error.response?.data?.message || "Failed to add user"
            );
        } finally {
            setAddingUser(false);
        }
    };

    // Helper for Stopping Location Display
    const renderStoppingArea = (user) => {
        const stop = user.stoppings?.trim();
        const subParts = [user.city, user.state].filter((p) => p && p.trim() && p.trim() !== stop);
        const subText = subParts.join(", ");

        if (!stop) {
            return <span className="stop-not-set">Not set</span>;
        }

        return (
            <div className="stop-location-display">
                <span className="stop-primary-name">📍 {stop}</span>
                {subText ? <span className="stop-sub-location">{subText}</span> : null}
            </div>
        );
    };

    // Helper for Name Avatar Initial
    const getInitials = (name) => {
        if (!name) return "U";
        const parts = name.trim().split(" ");
        if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
        return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    };

    // =========================================================
    // 7. Render Views
    // =========================================================

    if (loading) {
        return (
            <div className="user-page-container">
                <div className="user-loading-state">
                    <div className="modern-spinner"></div>
                    <h3>Loading Transportation Users</h3>
                    <p>Fetching real-time passenger responses & stopping data...</p>
                </div>
            </div>
        );
    }

    if (fetchError && users.length === 0) {
        return (
            <div className="user-page-container">
                <button className="user-back-btn" onClick={() => navigate(-1)}>
                    ← Back
                </button>
                <div className="user-error-state">
                    <div className="error-icon">⚠️</div>
                    <h3>Unable to Load Users</h3>
                    <p>{fetchError}</p>
                    <button className="btn-retry-action" onClick={() => fetchUsers(true)}>
                        🔄 Retry Connection
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="user-page-container">
            {/* Top Navigation */}
            <div className="user-top-nav">
                <button className="user-back-btn" onClick={() => navigate(-1)}>
                    ← Back
                </button>
                <div className="user-nav-actions">
                    <button
                        type="button"
                        className="btn-nav-upload"
                        onClick={() => navigate("/excel-upload")}
                        title="Upload Excel with students/passengers"
                    >
                        📄 Upload Excel
                    </button>
                    <button
                        type="button"
                        className="btn-nav-add"
                        onClick={() => setShowAddModal(true)}
                        title="Add student manually"
                    >
                        + Add User
                    </button>
                    <button
                        type="button"
                        className="btn-nav-reset"
                        onClick={() => setShowResetModal(true)}
                        title="Reset all user responses and allocations for the next cycle"
                    >
                        🔄 Reset Travel Status
                    </button>
                </div>
            </div>

            {/* Header Section */}
            <div className="user-main-header">
                <div>
                    <h1>USER MANAGEMENT</h1>
                    <p className="user-header-subtitle">
                        Manage users, travel confirmations and stopping areas
                    </p>
                </div>
            </div>

            {/* Dynamic Summary Cards Grid */}
            <div className="user-metrics-grid">
                <div className="metric-card metric-total">
                    <div className="metric-icon-box">👥</div>
                    <div className="metric-info">
                        <span className="metric-title">Total Users</span>
                        <span className="metric-number">{summary.totalUsers}</span>
                    </div>
                </div>

                <div className="metric-card metric-coming">
                    <div className="metric-icon-box">🟢</div>
                    <div className="metric-info">
                        <span className="metric-title">Coming</span>
                        <span className="metric-number">{summary.comingCount}</span>
                    </div>
                </div>

                <div className="metric-card metric-pending">
                    <div className="metric-icon-box">🟡</div>
                    <div className="metric-info">
                        <span className="metric-title">Pending</span>
                        <span className="metric-number">{summary.pendingCount}</span>
                    </div>
                </div>

                <div className="metric-card metric-not-coming">
                    <div className="metric-icon-box">🔴</div>
                    <div className="metric-info">
                        <span className="metric-title">Not Coming</span>
                        <span className="metric-number">{summary.notComingCount}</span>
                    </div>
                </div>

                <div className="metric-card metric-allocated">
                    <div className="metric-icon-box">🚌</div>
                    <div className="metric-info">
                        <span className="metric-title">Allocated</span>
                        <span className="metric-number">{summary.allocatedCount}</span>
                    </div>
                </div>

                <div className="metric-card metric-unallocated">
                    <div className="metric-icon-box">⚠️</div>
                    <div className="metric-info">
                        <span className="metric-title">Unallocated</span>
                        <span className="metric-number">{summary.unallocatedCount}</span>
                    </div>
                </div>
            </div>

            {/* Prominent Search & Filter Toolbar */}
            <div className="user-filter-toolbar">
                {/* Search Box */}
                <div className="user-search-wrapper">
                    <span className="search-icon-lens">🔍</span>
                    <input
                        type="text"
                        className="user-search-input"
                        placeholder="Search by name, user ID or stopping area..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        aria-label="Search by name, user ID or stopping area"
                    />
                    {searchQuery && (
                        <button
                            type="button"
                            className="search-clear-btn"
                            onClick={() => setSearchQuery("")}
                            title="Clear search"
                            aria-label="Clear search"
                        >
                            ✕
                        </button>
                    )}
                </div>

                {/* Filter Controls */}
                <div className="user-filter-controls">
                    {/* Status Filter */}
                    <div className="filter-select-group">
                        <label htmlFor="status-filter-select" className="filter-label">Status:</label>
                        <select
                            id="status-filter-select"
                            className="user-filter-select"
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            aria-label="Filter by travel status"
                        >
                            <option value="All">All Status</option>
                            <option value="Coming">🟢 Coming</option>
                            <option value="Pending">🟡 Pending</option>
                            <option value="Not Coming">🔴 Not Coming</option>
                        </select>
                    </div>

                    {/* Stopping Area Filter */}
                    <div className="filter-select-group">
                        <label htmlFor="stop-filter-select" className="filter-label">Stopping:</label>
                        <select
                            id="stop-filter-select"
                            className="user-filter-select"
                            value={stopFilter}
                            onChange={(e) => setStopFilter(e.target.value)}
                            aria-label="Filter by stopping area"
                        >
                            <option value="All">All Stops ({uniqueStops.length})</option>
                            {uniqueStops.map((stopName) => (
                                <option key={stopName} value={stopName}>
                                    📍 {stopName}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Allocation Filter */}
                    <div className="filter-select-group">
                        <label htmlFor="allocation-filter-select" className="filter-label">Allocation:</label>
                        <select
                            id="allocation-filter-select"
                            className="user-filter-select"
                            value={allocationFilter}
                            onChange={(e) => setAllocationFilter(e.target.value)}
                            aria-label="Filter by allocation status"
                        >
                            <option value="All">All Allocations</option>
                            <option value="Allocated">✓ Allocated</option>
                            <option value="Unallocated">⚠️ Unallocated</option>
                        </select>
                    </div>

                    {/* Clear Filters Button */}
                    {isFiltered && (
                        <button
                            type="button"
                            className="btn-clear-filters"
                            onClick={handleClearFilters}
                            title="Reset all search queries and dropdown filters"
                        >
                            ✕ Clear Filters
                        </button>
                    )}
                </div>
            </div>

            {/* Dynamic Results Counter Bar */}
            <div className="results-counter-bar">
                <span className="counter-text">
                    {filteredUsers.length === 0 ? (
                        <span className="counter-zero">No users found</span>
                    ) : isFiltered ? (
                        <>
                            Showing <strong>{filteredUsers.length}</strong> of <strong>{users.length}</strong> users
                        </>
                    ) : (
                        <>
                            Showing <strong>{users.length}</strong> users
                        </>
                    )}
                </span>
                {isFiltered && (
                    <span className="filter-active-indicator">
                        Active filter applied
                    </span>
                )}
            </div>

            {/* User Table Card */}
            <div className="user-table-card">
                <div className="table-responsive-container">
                    <table className="modern-user-table">
                        <thead>
                            <tr>
                                <th style={{ width: "50px" }}>#</th>
                                <th style={{ width: "120px" }}>User ID</th>
                                <th>Name</th>
                                <th>Stopping Area</th>
                                <th style={{ width: "140px" }}>Travel Status</th>
                                <th style={{ width: "170px" }}>Bus Allocation</th>
                                <th style={{ width: "120px", textAlign: "right" }}>Actions</th>
                            </tr>
                        </thead>

                        <tbody>
                            {filteredUsers.length === 0 ? (
                                <tr>
                                    <td colSpan="7">
                                        <div className="table-empty-state">
                                            {users.length === 0 ? (
                                                <>
                                                    <div className="empty-state-icon">👥</div>
                                                    <h4>No Users Have Been Added Yet</h4>
                                                    <p>Upload a student Excel file or add a user manually to begin.</p>
                                                    <button
                                                        type="button"
                                                        className="btn-empty-upload"
                                                        onClick={() => navigate("/excel-upload")}
                                                    >
                                                        📄 Upload Excel File
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <div className="empty-state-icon">🔍</div>
                                                    <h4>No Users Found</h4>
                                                    <p>
                                                        No users matched your search criteria{" "}
                                                        {searchQuery ? `"${searchQuery}"` : ""}. Try adjusting your keywords or clearing filters.
                                                    </p>
                                                    <button
                                                        type="button"
                                                        className="btn-empty-clear"
                                                        onClick={handleClearFilters}
                                                    >
                                                        Clear All Filters
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filteredUsers.map((user, index) => {
                                    const status = user.travelStatus || "Pending";
                                    const isAllocated =
                                        status === "Coming" &&
                                        Boolean(user.allocatedBus?.isAllocated || user.assignedVehicle || user.allocatedBus?.vehicleName);

                                    const busName = isAllocated
                                        ? user.assignedVehicle || user.allocatedBus?.vehicleName || user.allocatedBus?.vehicleNumber || "BUS-Assigned"
                                        : null;

                                    const routeCode = isAllocated
                                        ? user.assignedRoute || user.allocatedBus?.routeCode || user.allocatedBus?.routeName || "Route"
                                        : null;

                                    return (
                                        <tr key={user._id || user.userId}>
                                            {/* # Index */}
                                            <td className="col-index">{index + 1}</td>

                                            {/* User ID */}
                                            <td>
                                                <span className="user-id-badge">{user.userId}</span>
                                            </td>

                                            {/* Name with Avatar */}
                                            <td>
                                                <div className="user-name-cell">
                                                    <div className="user-avatar-circle">
                                                        {getInitials(user.name)}
                                                    </div>
                                                    <div className="user-name-details">
                                                        <span className="user-full-name">{user.name}</span>
                                                        <span className="user-role-tag">{user.role || "student"}</span>
                                                    </div>
                                                </div>
                                            </td>

                                            {/* Stopping Area */}
                                            <td>{renderStoppingArea(user)}</td>

                                            {/* Travel Status */}
                                            <td>
                                                <span
                                                    className={`user-status-pill status-${(status || "pending")
                                                        .toLowerCase()
                                                        .replace(/\s+/g, "-")}`}
                                                >
                                                    <span className="status-dot"></span>
                                                    {status}
                                                </span>
                                            </td>

                                            {/* Allocation */}
                                            <td>
                                                {isAllocated ? (
                                                    <div className="allocation-info-cell">
                                                        <span className="bus-assigned-badge">
                                                            🚌 {busName}
                                                        </span>
                                                        {routeCode && (
                                                            <span className="route-assigned-badge">
                                                                🛣️ {routeCode}
                                                            </span>
                                                        )}
                                                    </div>
                                                ) : status === "Coming" ? (
                                                    <span className="allocation-tag tag-unallocated">
                                                        ⚠️ Unallocated
                                                    </span>
                                                ) : (
                                                    <span className="allocation-tag tag-not-applicable">
                                                        — Not Assigned
                                                    </span>
                                                )}
                                            </td>

                                            {/* Actions */}
                                            <td style={{ textAlign: "right" }}>
                                                <div className="user-actions-cell">
                                                    <button
                                                        type="button"
                                                        className="action-btn btn-reset-single"
                                                        onClick={() => handleResetSingleUser(user.userId || user._id)}
                                                        title="Reset travel status to Pending"
                                                        aria-label={`Reset travel status for ${user.name}`}
                                                    >
                                                        🔄
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="action-btn btn-delete-single"
                                                        onClick={() => setUserToDelete(user)}
                                                        title="Delete user"
                                                        aria-label={`Delete user ${user.name}`}
                                                    >
                                                        🗑️
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* =========================================================
                MODALS
            ========================================================= */}

            {/* 1. Global Reset Travel Status Confirmation Modal */}
            {showResetModal && (
                <div className="user-modal-overlay" onClick={() => !resettingGlobal && setShowResetModal(false)}>
                    <div className="user-modal-card" onClick={(e) => e.stopPropagation()}>
                        <div className="user-modal-header">
                            <div className="modal-icon-badge reset-icon-badge">🔄</div>
                            <div>
                                <h3>Reset Travel Status Cycle</h3>
                                <p className="modal-header-desc">Prepare users for a new journey cycle</p>
                            </div>
                        </div>

                        <div className="user-modal-body">
                            <p>
                                This will reset <strong>all user travel responses</strong> (Coming / Not Coming) back to{" "}
                                <span className="highlight-pending">Pending</span> and <strong>clear active bus allocations</strong>.
                            </p>
                            <p>
                                All users can subsequently submit fresh responses for the next travel cycle.
                            </p>
                            <div className="modal-info-note">
                                ℹ️ Routes, vehicle records, and schedules will remain safely preserved.
                            </div>
                        </div>

                        <div className="user-modal-footer">
                            <button
                                type="button"
                                className="modal-btn-secondary"
                                onClick={() => setShowResetModal(false)}
                                disabled={resettingGlobal}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="modal-btn-danger"
                                onClick={handleConfirmGlobalReset}
                                disabled={resettingGlobal}
                            >
                                {resettingGlobal ? "Resetting..." : "Confirm Global Reset"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 2. Single User Delete Confirmation Modal */}
            {userToDelete && (
                <div className="user-modal-overlay" onClick={() => !deletingUser && setUserToDelete(null)}>
                    <div className="user-modal-card" onClick={(e) => e.stopPropagation()}>
                        <div className="user-modal-header">
                            <div className="modal-icon-badge delete-icon-badge">🗑️</div>
                            <div>
                                <h3>Delete User</h3>
                                <p className="modal-header-desc">Remove user from database</p>
                            </div>
                        </div>

                        <div className="user-modal-body">
                            <p>
                                Are you sure you want to permanently delete user{" "}
                                <strong>{userToDelete.name}</strong> (<code>{userToDelete.userId}</code>)?
                            </p>
                            <p className="modal-warning-note">
                                ⚠️ This action cannot be undone. Any active travel responses for this user will be removed.
                            </p>
                        </div>

                        <div className="user-modal-footer">
                            <button
                                type="button"
                                className="modal-btn-secondary"
                                onClick={() => setUserToDelete(null)}
                                disabled={deletingUser}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="modal-btn-danger"
                                onClick={handleConfirmDelete}
                                disabled={deletingUser}
                            >
                                {deletingUser ? "Deleting..." : "Delete User"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 3. Add User Modal */}
            {showAddModal && (
                <div className="user-modal-overlay" onClick={() => !addingUser && setShowAddModal(false)}>
                    <div className="user-modal-card modal-large" onClick={(e) => e.stopPropagation()}>
                        <div className="user-modal-header">
                            <div className="modal-icon-badge add-icon-badge">+</div>
                            <div>
                                <h3>Add New User</h3>
                                <p className="modal-header-desc">Create a single student record manually</p>
                            </div>
                        </div>

                        <form onSubmit={handleCreateUser}>
                            <div className="user-modal-body">
                                <div className="form-grid-two-col">
                                    <div className="form-group">
                                        <label htmlFor="add-user-id">User ID *</label>
                                        <input
                                            id="add-user-id"
                                            type="text"
                                            required
                                            placeholder="e.g. USR401"
                                            value={newUser.userId}
                                            onChange={(e) => setNewUser({ ...newUser, userId: e.target.value })}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label htmlFor="add-user-name">Full Name *</label>
                                        <input
                                            id="add-user-name"
                                            type="text"
                                            required
                                            placeholder="e.g. Kishore Kumar"
                                            value={newUser.name}
                                            onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                                        />
                                    </div>
                                </div>

                                <div className="form-grid-two-col">
                                    <div className="form-group">
                                        <label htmlFor="add-user-stop">Stopping Area *</label>
                                        <input
                                            id="add-user-stop"
                                            type="text"
                                            required
                                            placeholder="e.g. Arappalayam"
                                            value={newUser.stoppings}
                                            onChange={(e) => setNewUser({ ...newUser, stoppings: e.target.value })}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label htmlFor="add-user-city">City *</label>
                                        <input
                                            id="add-user-city"
                                            type="text"
                                            placeholder="e.g. Madurai"
                                            value={newUser.city}
                                            onChange={(e) => setNewUser({ ...newUser, city: e.target.value })}
                                        />
                                    </div>
                                </div>

                                <div className="form-grid-two-col">
                                    <div className="form-group">
                                        <label htmlFor="add-user-state">State *</label>
                                        <input
                                            id="add-user-state"
                                            type="text"
                                            placeholder="e.g. Tamil Nadu"
                                            value={newUser.state}
                                            onChange={(e) => setNewUser({ ...newUser, state: e.target.value })}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label htmlFor="add-user-country">Country *</label>
                                        <input
                                            id="add-user-country"
                                            type="text"
                                            placeholder="e.g. India"
                                            value={newUser.country}
                                            onChange={(e) => setNewUser({ ...newUser, country: e.target.value })}
                                        />
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label htmlFor="add-user-status">Initial Travel Status</label>
                                    <select
                                        id="add-user-status"
                                        value={newUser.travelStatus}
                                        onChange={(e) => setNewUser({ ...newUser, travelStatus: e.target.value })}
                                    >
                                        <option value="Coming">🟢 Coming</option>
                                        <option value="Pending">🟡 Pending</option>
                                        <option value="Not Coming">🔴 Not Coming</option>
                                    </select>
                                </div>
                            </div>

                            <div className="user-modal-footer">
                                <button
                                    type="button"
                                    className="modal-btn-secondary"
                                    onClick={() => setShowAddModal(false)}
                                    disabled={addingUser}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="modal-btn-primary"
                                    disabled={addingUser}
                                >
                                    {addingUser ? "Adding..." : "+ Create User"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

export default UserManagement;