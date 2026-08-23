import {
    useEffect,
    useState,
    useMemo
} from "react";

import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import api from "../services/api";
import "../css/userManagement.css";

function UserManagement() {
    const navigate = useNavigate();

    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showResetModal, setShowResetModal] = useState(false);
    const [resetting, setResetting] = useState(false);

    // ===============================
    // Fetch Users
    // ===============================
    const fetchUsers = async (showSpinner = false) => {
        try {
            if (showSpinner) {
                setLoading(true);
            }
            const response = await api.get("/users");
            setUsers(response.data || []);
        } catch (error) {
            console.error("Fetch Users Error:", error);
            if (showSpinner) {
                toast.error(
                    error.response?.data?.message ||
                    "Failed to load users"
                );
            }
        } finally {
            if (showSpinner) {
                setLoading(false);
            }
        }
    };

    // ===============================
    // Load On Page Open & Cross-Tab Sync
    // ===============================
    useEffect(() => {
        fetchUsers(true);

        const handleSync = () => {
            if (document.visibilityState === "visible") {
                fetchUsers(false);
            }
        };

        window.addEventListener("focus", handleSync);
        document.addEventListener("visibilitychange", handleSync);

        // Background polling every 5s for real-time synchronization
        const pollInterval = setInterval(() => {
            fetchUsers(false);
        }, 5000);

        return () => {
            window.removeEventListener("focus", handleSync);
            document.removeEventListener("visibilitychange", handleSync);
            clearInterval(pollInterval);
        };
    }, []);

    // ===============================
    // Dynamic Summary Metrics
    // ===============================
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
                Boolean(user.allocatedBus?.isAllocated || user.allocatedBus?.vehicleName);

            if (isUserAllocated) {
                allocatedCount++;
            }
        });

        const totalUsers = users.length;
        const unallocatedCount = totalUsers - allocatedCount;

        return {
            totalUsers,
            comingCount,
            notComingCount,
            pendingCount,
            allocatedCount,
            unallocatedCount
        };
    }, [users]);

    // ===============================
    // Handle Global Reset Confirmation
    // ===============================
    const handleConfirmGlobalReset = async () => {
        try {
            setResetting(true);
            const response = await api.put("/users/reset-travel-status");

            if (response.data?.success) {
                localStorage.removeItem("active_ai_plan");

                // Update local state immediately: reset all travelStatus to Pending and clear allocations
                setUsers((prevUsers) =>
                    prevUsers.map((u) => ({
                        ...u,
                        travelStatus: "Pending",
                        allocatedBus: null
                    }))
                );

                toast.success(
                    response.data.message ||
                    "Travel status cycle reset successfully. All user responses, generated AI routes, and allocations have been reset."
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
            setResetting(false);
        }
    };

    // ===============================
    // Loading State
    // ===============================
    if (loading) {
        return (
            <div className="user-container">
                <div className="user-loading-spinner">
                    <div className="spinner"></div>
                    <h2>Loading Users...</h2>
                </div>
            </div>
        );
    }

    // ===============================
    // JSX
    // ===============================
    return (
        <div className="user-container">
            <button
                className="back-btn"
                onClick={() => navigate(-1)}
            >
                ← Back
            </button>

            {/* Header with Global Reset Button */}
            <div className="user-header-section">
                <div>
                    <h2>User Management</h2>
                    <p className="user-subtitle">Manage users and travel confirmation status.</p>
                </div>
                <div className="user-header-actions">
                    <button
                        type="button"
                        className="btn-global-reset"
                        onClick={() => setShowResetModal(true)}
                        title="Reset all user responses and allocations for the next cycle"
                    >
                        🔄 Reset Travel Status
                    </button>
                </div>
            </div>

            {/* Dynamic Summary Cards Grid */}
            <div className="summary-cards-grid">
                <div className="summary-card card-total">
                    <div className="summary-icon">👥</div>
                    <div className="summary-details">
                        <span className="summary-label">Total Users</span>
                        <span className="summary-value">{summary.totalUsers}</span>
                    </div>
                </div>

                <div className="summary-card card-coming">
                    <div className="summary-icon">✓</div>
                    <div className="summary-details">
                        <span className="summary-label">Coming</span>
                        <span className="summary-value">{summary.comingCount}</span>
                    </div>
                </div>

                <div className="summary-card card-not-coming">
                    <div className="summary-icon">✕</div>
                    <div className="summary-details">
                        <span className="summary-label">Not Coming</span>
                        <span className="summary-value">{summary.notComingCount}</span>
                    </div>
                </div>

                <div className="summary-card card-pending">
                    <div className="summary-icon">⏳</div>
                    <div className="summary-details">
                        <span className="summary-label">Pending</span>
                        <span className="summary-value">{summary.pendingCount}</span>
                    </div>
                </div>

                <div className="summary-card card-allocated">
                    <div className="summary-icon">🚌</div>
                    <div className="summary-details">
                        <span className="summary-label">Allocated</span>
                        <span className="summary-value">{summary.allocatedCount}</span>
                    </div>
                </div>

                <div className="summary-card card-unallocated">
                    <div className="summary-icon">⚠️</div>
                    <div className="summary-details">
                        <span className="summary-label">Unallocated</span>
                        <span className="summary-value">{summary.unallocatedCount}</span>
                    </div>
                </div>
            </div>

            {/* User Table */}
            <div className="table-responsive">
                <table>
                    <thead>
                        <tr>
                            <th>User</th>
                            <th>User ID</th>
                            <th>Stopping Area</th>
                            <th>Travel Status</th>
                            <th>Bus</th>
                            <th>Route</th>
                            <th>Allocation Status</th>
                        </tr>
                    </thead>

                    <tbody>
                        {users.length === 0 ? (
                            <tr>
                                <td colSpan="7" className="empty-row">
                                    No users found
                                </td>
                            </tr>
                        ) : (
                            users.map((user) => {
                                const status = user.travelStatus || "Pending";
                                const isAllocated =
                                    status === "Coming" &&
                                    Boolean(user.allocatedBus?.isAllocated || user.allocatedBus?.vehicleName);

                                const busName = isAllocated
                                    ? user.allocatedBus?.vehicleName || user.allocatedBus?.vehicleNumber || "BUS-Assigned"
                                    : "—";

                                const routeCode = isAllocated
                                    ? user.allocatedBus?.routeCode || user.allocatedBus?.routeName || "Route Assigned"
                                    : "—";

                                return (
                                    <tr key={user._id}>
                                        <td className="user-name-cell">{user.name}</td>
                                        <td className="user-id-cell">{user.userId}</td>
                                        <td>{user.stoppings || "—"}</td>
                                        <td>
                                            <span
                                                className={`status-pill ${
                                                    status === "Coming"
                                                        ? "coming"
                                                        : status === "Not Coming"
                                                        ? "not-coming"
                                                        : "pending"
                                                }`}
                                            >
                                                ● {status}
                                            </span>
                                        </td>
                                        <td className="bus-cell">{busName}</td>
                                        <td className="route-cell">{routeCode}</td>
                                        <td>
                                            <span
                                                className={`allocation-tag ${
                                                    isAllocated ? "tag-allocated" : "tag-unallocated"
                                                }`}
                                            >
                                                {isAllocated ? "✓ Allocated" : "Not Assigned"}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {/* Global Reset Travel Status Confirmation Modal */}
            {showResetModal && (
                <div className="reset-modal-overlay" onClick={() => !resetting && setShowResetModal(false)}>
                    <div className="reset-modal-content" onClick={(e) => e.stopPropagation()}>
                        <div className="reset-modal-header">
                            <div className="reset-modal-icon">🔄</div>
                            <h3>Reset Travel Status Cycle?</h3>
                        </div>

                        <div className="reset-modal-body">
                            <p>
                                This will reset <strong>all user travel responses</strong> (Coming / Not Coming) back to{" "}
                                <span className="highlight-pending">Pending</span> and <strong>remove their current transportation allocations</strong>.
                            </p>
                            <p>
                                After the reset, all users will be able to submit <strong>Coming</strong> or{" "}
                                <strong>Not Coming</strong> again for the new travel cycle.
                            </p>
                            <p className="modal-note">
                                ℹ️ Routes, vehicles, and schedules will not be deleted.
                            </p>
                        </div>

                        <div className="reset-modal-actions">
                            <button
                                type="button"
                                className="modal-btn-cancel"
                                onClick={() => setShowResetModal(false)}
                                disabled={resetting}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="modal-btn-confirm"
                                onClick={handleConfirmGlobalReset}
                                disabled={resetting}
                            >
                                {resetting ? "Resetting..." : "Reset Travel Status"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default UserManagement;