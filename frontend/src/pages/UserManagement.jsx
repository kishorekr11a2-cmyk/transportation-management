import {
    useEffect,
    useState,
    useMemo,
    useCallback,
    useRef
} from "react";

import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import api from "../services/api";
import "../css/UserManagement.css";

function UserManagement() {
    const navigate = useNavigate();

    // Data states with instant session hydration
    const [users, setUsers] = useState(() => {
        try {
            const cached = sessionStorage.getItem("cached_users");
            return cached ? JSON.parse(cached) : [];
        } catch {
            return [];
        }
    });
    const [loading, setLoading] = useState(() => {
        try {
            return !sessionStorage.getItem("cached_users");
        } catch {
            return true;
        }
    });
    const [fetchError, setFetchError] = useState(null);

    // Search and Filter states
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState("All");
    const [stopFilter, setStopFilter] = useState("All");
    const [allocationFilter, setAllocationFilter] = useState("All");

    // Late Travel Response Alert & Filter states
    const [showLatePopup, setShowLatePopup] = useState(false);
    const [latePopupCount, setLatePopupCount] = useState(0);
    const [planApprovalTimes, setPlanApprovalTimes] = useState({ INWARD: null, OUTWARD: null });
    const popupTimerRef = useRef(null);
    const hasCheckedPopupOnMountRef = useRef(false);
    const pendingAckKeysRef = useRef([]);

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
    // 1. Fetch Users & Detect Late Coming Responses
    // =========================================================
    const fetchUsers = useCallback(async (showSpinner = false) => {
        try {
            console.log("[LateResponse] User Management loaded");
            if (showSpinner) {
                setLoading(true);
                setFetchError(null);
            }

            console.log("[LateResponse] Fetching users and late responses from API...");
            const [usersRes, lateRes] = await Promise.all([
                api.get("/users"),
                api.get("/users/late-travel-responses").catch((err) => {
                    console.warn("[LateResponse] Primary endpoint /users/late-travel-responses status:", err?.response?.status || err?.message);
                    return api.get("/users/late-responses").catch((err2) => {
                        console.error("[LateResponse] Fallback endpoint /users/late-responses status:", err2?.response?.status || err2?.message);
                        return null;
                    });
                })
            ]);

            const userData = usersRes?.data || [];
            console.log(`[LateResponse] Users loaded: ${userData.length}`);
            setUsers(userData);
            try {
                sessionStorage.setItem("cached_users", JSON.stringify(userData));
            } catch {
                // Ignore storage limits
            }

            const lateData = lateRes?.data;
            const inwardApproved = Boolean(lateData?.summary?.planApprovalTimes?.INWARD);
            const outwardApproved = Boolean(lateData?.summary?.planApprovalTimes?.OUTWARD);
            const approvedPlansCount = (inwardApproved ? 1 : 0) + (outwardApproved ? 1 : 0);
            console.log(`[LateResponse] Approved plans loaded: ${approvedPlansCount}`, {
                INWARD: lateData?.summary?.planApprovalTimes?.INWARD || "Not Approved",
                OUTWARD: lateData?.summary?.planApprovalTimes?.OUTWARD || "Not Approved"
            });

            if (lateData?.summary?.planApprovalTimes) {
                setPlanApprovalTimes(lateData.summary.planApprovalTimes);
            }

            // Qualifying late Coming students count from API or user records
            const apiLateUsers = lateData?.users || lateData?.lateResponses || [];
            const dbLateCount = Number.isInteger(lateData?.count)
            // Double check against loaded userData: Only genuinely unallocated late responses
            const localLateStudents = userData.filter((u) => {
                const isAllocated = Boolean(
                    u.travelStatus === "Coming" &&
                    (u.isAllocated ?? (u.allocationStatus === "Assigned" || u.allocatedBus?.isAllocated || u.assignedVehicle))
                );
                const isUnallocated = Boolean(u.travelStatus === "Coming" && !isAllocated);
                return isUnallocated && (
                    Boolean(u.isLateResponse) ||
                    Boolean(u.lateResponseDetected) ||
                    u.allocationStatus === "Pending Reallocation" ||
                    Boolean(u.requiresReallocation)
                );
            });

            const lateCount = Number.isInteger(lateData?.count) ? lateData.count : localLateStudents.length;
            console.log(`[LateResponse] Total unresolved Late Coming students: ${lateCount}`);

            // Notification Deduplication: Only notify newly unnotified late response events!
            const unnotifiedCount = Number.isInteger(lateData?.unnotifiedCount) ? lateData.unnotifiedCount : 0;
            const unnotifiedKeys = Array.isArray(lateData?.unnotifiedEventKeys) ? lateData.unnotifiedEventKeys : [];

            console.log(`[LateResponse] Newly unnotified late events: ${unnotifiedCount} (keys: ${unnotifiedKeys.length})`);

            if (unnotifiedCount > 0 && unnotifiedKeys.length > 0) {
                console.log("[LateResponse] Notification popup triggered for newly detected events");
                setLatePopupCount(unnotifiedCount);
                setShowLatePopup(true);
                pendingAckKeysRef.current = unnotifiedKeys;

                // Immediately persist acknowledgment to MongoDB so page refresh / tab switch / polling will NOT repeat popup
                api.post("/users/acknowledge-late-notifications", { eventKeys: unnotifiedKeys })
                    .then(() => {
                        console.log(`[LateResponse] Successfully marked ${unnotifiedKeys.length} event(s) as notified in MongoDB`);
                    })
                    .catch((ackErr) => {
                        console.warn("[LateResponse] Notification acknowledgment sync warning:", ackErr?.message);
                    });

                // Exactly 5-second display timer with safe cleanup
                if (popupTimerRef.current) {
                    clearTimeout(popupTimerRef.current);
                }
                popupTimerRef.current = setTimeout(() => {
                    console.log("[LateResponse] Notification auto-dismissed after 5 seconds");
                    setShowLatePopup(false);
                    popupTimerRef.current = null;
                }, 5000);
            } else {
                console.log("[LateResponse] Notification triggered: false (events already notified or none exist)");
                setShowLatePopup(false);
            }

            setFetchError(null);
        } catch (error) {
            console.error("[LateResponse] Fetch Users Error:", error);
            const msg = error.response?.data?.message || "Failed to load users from database";
            setFetchError(msg);
            if (showSpinner) {
                toast.error(msg);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    // Popup interaction handlers
    const handleDismissPopup = (e) => {
        if (e) e.stopPropagation();
        if (popupTimerRef.current) {
            clearTimeout(popupTimerRef.current);
            popupTimerRef.current = null;
        }
        setShowLatePopup(false);
        if (pendingAckKeysRef.current && pendingAckKeysRef.current.length > 0) {
            api.post("/users/acknowledge-late-notifications", { eventKeys: pendingAckKeysRef.current }).catch(() => {});
            pendingAckKeysRef.current = [];
        }
    };

    const handleReviewLateResponses = () => {
        if (popupTimerRef.current) {
            clearTimeout(popupTimerRef.current);
            popupTimerRef.current = null;
        }
        setShowLatePopup(false);
        if (pendingAckKeysRef.current && pendingAckKeysRef.current.length > 0) {
            api.post("/users/acknowledge-late-notifications", { eventKeys: pendingAckKeysRef.current }).catch(() => {});
            pendingAckKeysRef.current = [];
        }
        // Activate Late Coming Responses section/filter
        setAllocationFilter("Late Coming Responses");
        setStatusFilter("All");
        setStopFilter("All");
        setSearchQuery("");

        // Smoothly scroll to the table
        setTimeout(() => {
            const tableCard = document.getElementById("user-table-card");
            if (tableCard) {
                tableCard.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        }, 60);
    };

    // =========================================================
    // 2. Lifecycle & Real-Time Sync & Timer Cleanup
    // =========================================================
    useEffect(() => {
        let isMounted = true;
        const hasCache = users && users.length > 0;
        fetchUsers(!hasCache);

        const handleSync = () => {
            if (document.visibilityState === "visible" && isMounted && !resettingGlobal && !deletingUser && !addingUser) {
                fetchUsers(false);
            }
        };

        window.addEventListener("focus", handleSync);
        document.addEventListener("visibilitychange", handleSync);

        const pollInterval = setInterval(() => {
            if (document.visibilityState === "visible" && isMounted && !resettingGlobal && !deletingUser && !addingUser) {
                fetchUsers(false);
            }
        }, 15000);

        return () => {
            isMounted = false;
            window.removeEventListener("focus", handleSync);
            document.removeEventListener("visibilitychange", handleSync);
            clearInterval(pollInterval);
            if (popupTimerRef.current) {
                clearTimeout(popupTimerRef.current);
                popupTimerRef.current = null;
            }
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
        let unallocatedCount = 0;
        let lateComingCount = 0;
        let normalUnallocatedCount = 0;

        users.forEach((user) => {
            const status = user.travelStatus || "Pending";
            if (status === "Coming") comingCount++;
            else if (status === "Not Coming") notComingCount++;
            else pendingCount++;

            const isAllocated = Boolean(
                status === "Coming" &&
                (user.isAllocated ?? (user.allocationStatus === "Assigned" || user.allocationStatus === "Re-assigned" || user.allocatedBus?.isAllocated || user.assignedVehicle || user.allocatedBus?.vehicleName || user.manualBusId))
            );

            const isUnallocated = Boolean(status === "Coming" && !isAllocated);

            const isLateComing = Boolean(
                status === "Coming" &&
                (user.isLateResponse ?? (user.lateResponseDetected || user.allocationStatus === "Pending Reallocation" || user.requiresReallocation))
            );

            if (isAllocated) {
                allocatedCount++;
            }
            if (isLateComing) {
                lateComingCount++;
            }
            if (isUnallocated) {
                unallocatedCount++;
                if (!isLateComing) {
                    normalUnallocatedCount++;
                }
            }
        });

        const totalUsers = users.length;

        return {
            totalUsers,
            comingCount,
            notComingCount,
            pendingCount,
            allocatedCount,
            unallocatedCount,
            lateComingCount,
            normalUnallocatedCount
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
            user.previousTravelStatus,
            user.lateResponseDetected ? "Late Response" : "",
            user.role,
            user.assignedVehicle,
            user.assignedRoute,
            user.allocationStatus,
            user.allocatedBus?.vehicleName,
            user.allocatedBus?.vehicleNumber,
            user.allocatedBus?.routeCode,
            user.allocatedBus?.routeName,
            ...(Array.isArray(user.affectedDirections) ? user.affectedDirections : []),
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
                if (statusFilter === "Late Coming Responses") {
                    const isAllocated = Boolean(
                        user.travelStatus === "Coming" &&
                        (user.isAllocated ?? (user.allocationStatus === "Assigned" || user.allocatedBus?.isAllocated || user.assignedVehicle || user.allocatedBus?.vehicleName))
                    );
                    const isUnallocated = Boolean(user.travelStatus === "Coming" && !isAllocated);
                    const isLateComing = Boolean(
                        isUnallocated &&
                        (user.isLateResponse ?? (user.lateResponseDetected || user.allocationStatus === "Pending Reallocation" || user.requiresReallocation))
                    );
                    if (!isLateComing) return false;
                } else {
                    const userStatus = user.travelStatus || "Pending";
                    if (userStatus !== statusFilter) {
                        return false;
                    }
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
                const isAllocated = Boolean(
                    user.travelStatus === "Coming" &&
                    (user.isAllocated ?? (user.allocationStatus === "Assigned" || user.allocatedBus?.isAllocated || user.assignedVehicle || user.allocatedBus?.vehicleName))
                );
                const isUnallocated = Boolean(user.travelStatus === "Coming" && !isAllocated);
                const isLateComing = Boolean(
                    isUnallocated &&
                    (user.isLateResponse ?? (user.lateResponseDetected || user.allocationStatus === "Pending Reallocation" || user.requiresReallocation))
                );

                if (allocationFilter === "Allocated") {
                    if (!isAllocated) return false;
                } else if (allocationFilter === "Unallocated") {
                    // MUST SHOW ALL UNALLOCATED STUDENTS (both Type 1 and Type 2!)
                    if (!isUnallocated) return false;
                } else if (allocationFilter === "Normal Unallocated") {
                    // Show only Type 2 (Normal Unallocated due to capacity/route limits)
                    if (!isUnallocated || isLateComing) return false;
                } else if (allocationFilter === "Late Coming Responses") {
                    // Show only Type 1 (Late Coming Responses)
                    if (!isLateComing) return false;
                }
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

    // Helper to format timestamps cleanly for late response display
    const formatDateTime = (dateVal) => {
        if (!dateVal) return "—";
        try {
            const d = new Date(dateVal);
            if (isNaN(d.getTime())) return "—";
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' (' + d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ')';
        } catch {
            return "—";
        }
    };

    // Helper to retrieve the matching plan approval timestamp for a user
    const getPlanApprovalTimeForUser = (user) => {
        const dirs = Array.isArray(user.affectedDirections) ? user.affectedDirections : [];
        if (dirs.includes("INWARD") && planApprovalTimes?.INWARD) {
            return formatDateTime(planApprovalTimes.INWARD);
        }
        if (dirs.includes("OUTWARD") && planApprovalTimes?.OUTWARD) {
            return formatDateTime(planApprovalTimes.OUTWARD);
        }
        if (planApprovalTimes?.INWARD) return formatDateTime(planApprovalTimes.INWARD);
        if (planApprovalTimes?.OUTWARD) return formatDateTime(planApprovalTimes.OUTWARD);
        return "Before Response";
    };

    // View mode flag: is current view showing Late Coming Responses?
    const isLateView = allocationFilter === "Late Coming Responses" || statusFilter === "Late Coming Responses";

    // =========================================================
    // 7. Render Views
    // =========================================================

    if (fetchError && users.length === 0 && !loading) {
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
            {/* Floating Late Travel Response Notification Popup (5-Second Auto-Dismiss) */}
            {showLatePopup && (
                <aside
                    id="late-travel-response-popup"
                    className="late-response-popup-container"
                    onClick={handleReviewLateResponses}
                    role="alert"
                    aria-live="assertive"
                    title="Click to review late travel responses"
                >
                    <div className="late-response-popup-card">
                        <div className="late-response-popup-header">
                            <div className="late-response-popup-icon-box">
                                <span className="late-popup-icon">⏰</span>
                            </div>
                            <div className="late-response-popup-body">
                                <div className="late-response-popup-title-row">
                                    <h4 className="late-response-popup-title">⏰ Late Travel Responses</h4>
                                    <button
                                        type="button"
                                        className="late-response-popup-close-btn"
                                        onClick={handleDismissPopup}
                                        aria-label="Dismiss late travel response notification"
                                        title="Dismiss notification"
                                    >
                                        ✕
                                    </button>
                                </div>
                                <p className="late-response-popup-desc">
                                    <strong>{latePopupCount}</strong> {latePopupCount === 1 ? "student" : "students"} submitted Coming after transportation allocation.
                                </p>
                                <div className="late-response-popup-action-row">
                                    <span className="late-response-popup-action-link">
                                        Review Late Responses →
                                    </span>
                                </div>
                            </div>
                        </div>
                        {/* 5-second countdown progress bar */}
                        <div className="late-response-progress-track">
                            <div className="late-response-progress-bar"></div>
                        </div>
                    </div>
                </aside>
            )}

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
                        {loading && (!users || users.length === 0) ? (
                            <span className="metric-loading-inline">Loading...</span>
                        ) : (
                            <span className="metric-number">{summary.totalUsers}</span>
                        )}
                    </div>
                </div>

                <div className="metric-card metric-coming">
                    <div className="metric-icon-box">🟢</div>
                    <div className="metric-info">
                        <span className="metric-title">Coming</span>
                        {loading && (!users || users.length === 0) ? (
                            <span className="metric-loading-inline">Loading...</span>
                        ) : (
                            <span className="metric-number">{summary.comingCount}</span>
                        )}
                    </div>
                </div>

                <div className="metric-card metric-pending">
                    <div className="metric-icon-box">🟡</div>
                    <div className="metric-info">
                        <span className="metric-title">Pending</span>
                        {loading && (!users || users.length === 0) ? (
                            <span className="metric-loading-inline">Loading...</span>
                        ) : (
                            <span className="metric-number">{summary.pendingCount}</span>
                        )}
                    </div>
                </div>

                <div className="metric-card metric-not-coming">
                    <div className="metric-icon-box">🔴</div>
                    <div className="metric-info">
                        <span className="metric-title">Not Coming</span>
                        {loading && (!users || users.length === 0) ? (
                            <span className="metric-loading-inline">Loading...</span>
                        ) : (
                            <span className="metric-number">{summary.notComingCount}</span>
                        )}
                    </div>
                </div>

                <div className="metric-card metric-allocated">
                    <div className="metric-icon-box">🚌</div>
                    <div className="metric-info">
                        <span className="metric-title">Allocated</span>
                        {loading && (!users || users.length === 0) ? (
                            <span className="metric-loading-inline">Loading...</span>
                        ) : (
                            <span className="metric-number">{summary.allocatedCount}</span>
                        )}
                    </div>
                </div>

                <div
                    className={`metric-card metric-unallocated ${allocationFilter === "Unallocated" ? "active-filter-card" : ""}`}
                    onClick={() => {
                        if (allocationFilter === "Unallocated") {
                            setAllocationFilter("All");
                        } else {
                            setAllocationFilter("Unallocated");
                            setStatusFilter("All");
                        }
                    }}
                    style={{ cursor: "pointer" }}
                    title="Click to view all unallocated students (both normal capacity shortages and late responses)"
                >
                    <div className="metric-icon-box">⚠️</div>
                    <div className="metric-info">
                        <span className="metric-title">Unallocated</span>
                        {loading && (!users || users.length === 0) ? (
                            <span className="metric-loading-inline">Loading...</span>
                        ) : (
                            <span className="metric-number">{summary.unallocatedCount}</span>
                        )}
                    </div>
                </div>

                <div
                    className={`metric-card metric-late-response ${isLateView ? "active-filter-card" : ""}`}
                    onClick={() => {
                        if (isLateView) {
                            setAllocationFilter("All");
                            setStatusFilter("All");
                        } else {
                            setAllocationFilter("Late Coming Responses");
                            setStatusFilter("All");
                            setStopFilter("All");
                            setSearchQuery("");
                        }
                    }}
                    style={{ cursor: "pointer" }}
                    title="Click to view late travel responses submitted after route allocation"
                >
                    <div className="metric-icon-box" style={{ background: "#fef3c7", color: "#d97706" }}>⏰</div>
                    <div className="metric-info">
                        <span className="metric-title">Late Responses</span>
                        {loading && (!users || users.length === 0) ? (
                            <span className="metric-loading-inline">Loading...</span>
                        ) : (
                            <span className="metric-number" style={{ color: summary.lateComingCount > 0 ? "#d97706" : "inherit" }}>
                                {summary.lateComingCount}
                            </span>
                        )}
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
                            <option value="Late Coming Responses">⏰ Late Coming Responses ({summary.lateComingCount})</option>
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
                            <option value="Allocated">✓ Allocated ({summary.allocatedCount})</option>
                            <option value="Unallocated">⚠️ Unallocated - All ({summary.unallocatedCount})</option>
                            <option value="Normal Unallocated">⚠️ Normal Unallocated ({summary.normalUnallocatedCount})</option>
                            <option value="Late Coming Responses">⏰ Late Coming Responses ({summary.lateComingCount})</option>
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
            <div id="user-table-card" className="user-table-card">
                <div className="table-responsive-container">
                    <table className="modern-user-table">
                        <thead>
                            {isLateView ? (
                                <tr>
                                    <th style={{ width: "45px" }}>#</th>
                                    <th style={{ width: "110px" }}>User ID</th>
                                    <th>Student Name</th>
                                    <th>Stopping Area</th>
                                    <th style={{ width: "130px" }}>Travel Status</th>
                                    <th style={{ width: "110px" }}>Direction</th>
                                    <th style={{ width: "170px" }}>Response Submitted</th>
                                    <th style={{ width: "170px" }}>Plan Approved</th>
                                    <th style={{ width: "150px" }}>Allocation</th>
                                    <th style={{ width: "160px" }}>Bus / Route / Seat</th>
                                    <th style={{ width: "90px", textAlign: "right" }}>Actions</th>
                                </tr>
                            ) : (
                                <tr>
                                    <th style={{ width: "50px" }}>#</th>
                                    <th style={{ width: "120px" }}>User ID</th>
                                    <th>Name</th>
                                    <th>Stopping Area</th>
                                    <th style={{ width: "140px" }}>Travel Status</th>
                                    <th style={{ width: "170px" }}>Bus Allocation</th>
                                    <th style={{ width: "120px", textAlign: "right" }}>Actions</th>
                                </tr>
                            )}
                        </thead>

                        <tbody>
                            {users.length === 0 && loading ? (
                                <tr>
                                    <td colSpan={isLateView ? 11 : 7}>
                                        <div className="table-empty-state">
                                            <div className="modern-spinner" style={{ margin: "1.5rem auto" }}></div>
                                            <h4 style={{ color: "#38bdf8" }}>Loading Transportation Users</h4>
                                            <p>Fetching real-time passenger responses & stopping data...</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : filteredUsers.length === 0 ? (
                                <tr>
                                    <td colSpan={isLateView ? 11 : 7}>
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
                                            ) : isLateView ? (
                                                <>
                                                    <div className="empty-state-icon">⏰</div>
                                                    <h4>No Late Travel Responses Found</h4>
                                                    <p>
                                                        There are no students who submitted or changed their status to Coming after route allocation.
                                                    </p>
                                                    <button
                                                        type="button"
                                                        className="btn-empty-clear"
                                                        onClick={handleClearFilters}
                                                    >
                                                        View All Students
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
                                        Boolean(user.allocatedBus?.isAllocated || user.assignedVehicle || user.allocatedBus?.vehicleName || user.manualBusId || user.allocationStatus === "Assigned" || user.allocationStatus === "Re-assigned");

                                    const busName = isAllocated
                                        ? user.assignedVehicle || user.allocatedBus?.vehicleName || user.allocatedBus?.vehicleNumber || user.manualBusId || "BUS-Assigned"
                                        : null;

                                    const routeCode = isAllocated
                                        ? user.assignedRoute || user.allocatedBus?.routeCode || user.allocatedBus?.routeName || user.manualRouteId || "Route"
                                        : null;

                                    if (isLateView) {
                                        return (
                                            <tr key={user._id || user.userId} className="row-late-responder">
                                                {/* # Index */}
                                                <td className="col-index">{index + 1}</td>

                                                {/* User ID */}
                                                <td>
                                                    <span className="user-id-badge">{user.userId}</span>
                                                </td>

                                                {/* Student Name */}
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
                                                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                                        <span className="user-status-pill status-coming">
                                                            <span className="status-dot"></span>
                                                            Coming
                                                        </span>
                                                        <span className="late-indicator-badge" title="Submitted Coming after route plan approval">
                                                            ⏰ Late Response
                                                        </span>
                                                    </div>
                                                </td>

                                                {/* Relevant Direction */}
                                                <td>
                                                    <div className="affected-dirs-list">
                                                        {Array.isArray(user.affectedDirections) && user.affectedDirections.length > 0 ? (
                                                            user.affectedDirections.map((dir) => (
                                                                <span key={dir} className={`affected-dir-tag affected-dir-tag--${dir.toLowerCase()}`}>
                                                                    {dir}
                                                                </span>
                                                            ))
                                                        ) : user.allocatedBus?.direction ? (
                                                            <span className={`affected-dir-tag affected-dir-tag--${user.allocatedBus.direction.toLowerCase()}`}>
                                                                {user.allocatedBus.direction}
                                                            </span>
                                                        ) : (
                                                            <span className="affected-dir-tag affected-dir-tag--inward">INWARD</span>
                                                        )}
                                                    </div>
                                                </td>

                                                {/* Response Submitted Time */}
                                                <td>
                                                    <div className="late-time-display">
                                                        <span className="late-time-val">
                                                            {formatDateTime(user.lateResponseAt || user.travelResponseSubmittedAt || user.lastTravelResponseAt || user.updatedAt)}
                                                        </span>
                                                        <span className="late-time-subtag">After Approval</span>
                                                    </div>
                                                </td>

                                                {/* Plan Approved Time */}
                                                <td>
                                                    <div className="late-time-display">
                                                        <span className="late-time-val">{getPlanApprovalTimeForUser(user)}</span>
                                                        <span className="late-time-subtag approved-subtag">Plan Approved</span>
                                                    </div>
                                                </td>

                                                {/* Allocation Status */}
                                                <td>
                                                    <div className="allocation-info-cell">
                                                        {user.allocationStatus === "Re-assigned" ? (
                                                            <span className="allocation-tag tag-reassigned" style={{ background: "rgba(234, 179, 8, 0.15)", color: "#eab308", border: "1px solid rgba(234, 179, 8, 0.3)" }}>
                                                                🔄 Re-assigned
                                                            </span>
                                                        ) : isAllocated ? (
                                                            <span className="allocation-tag tag-allocated" style={{ background: "rgba(34, 197, 94, 0.15)", color: "#22c55e", border: "1px solid rgba(34, 197, 94, 0.3)" }}>
                                                                ✓ Allocated
                                                            </span>
                                                        ) : (
                                                            <span className="allocation-tag tag-pending-reallocation" title="Late travel response. Bus allocation safely withheld pending route regeneration.">
                                                                ⏳ Pending Reallocation
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>

                                                {/* Bus / Route / Seat */}
                                                <td>
                                                    {isAllocated ? (
                                                        <div className="allocation-info-cell">
                                                            <span className="bus-assigned-badge">🚌 {busName}</span>
                                                            {routeCode && <span className="route-assigned-badge">🛣️ {routeCode}</span>}
                                                            {user.allocatedBus?.seatNumber && (
                                                                <span className="seat-assigned-badge">💺 #{user.allocatedBus.seatNumber}</span>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <span className="allocation-tag tag-not-applicable">— Not Assigned</span>
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
                                    }

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
                                                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                                    <span
                                                        className={`user-status-pill status-${(status || "pending")
                                                            .toLowerCase()
                                                            .replace(/\s+/g, "-")}`}
                                                    >
                                                        <span className="status-dot"></span>
                                                        {status}
                                                    </span>
                                                    {Boolean(user.isLateResponse || user.lateResponseDetected) && (
                                                        <span className="late-indicator-badge" title="Travel status changed to Coming after route plan approval">
                                                            ⚠️ Late Response
                                                        </span>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Allocation */}
                                            <td>
                                                {user.allocationStatus === "Re-assigned" ? (
                                                    <div className="allocation-info-cell">
                                                        <span className="allocation-tag tag-reassigned" style={{ background: "rgba(234, 179, 8, 0.15)", color: "#eab308", border: "1px solid rgba(234, 179, 8, 0.3)" }}>
                                                            🔄 Re-assigned
                                                        </span>
                                                        {busName && (
                                                            <span className="bus-assigned-badge">
                                                                🚌 {busName}
                                                            </span>
                                                        )}
                                                        {routeCode && (
                                                            <span className="route-assigned-badge">
                                                                🛣️ {routeCode}
                                                            </span>
                                                        )}
                                                    </div>
                                                ) : isAllocated ? (
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
                                                ) : (user.allocationStatus === "Pending Reallocation" || user.requiresReallocation) ? (
                                                    <div className="allocation-info-cell">
                                                        <span className="allocation-tag tag-pending-reallocation" title="Late travel response detected. Bus allocation safely withheld pending route regeneration.">
                                                            ⏳ Pending Reallocation
                                                        </span>
                                                        {Array.isArray(user.affectedDirections) && user.affectedDirections.length > 0 && (
                                                            <div className="affected-dirs-list">
                                                                {user.affectedDirections.map((dir) => (
                                                                    <span key={dir} className={`affected-dir-tag affected-dir-tag--${dir.toLowerCase()}`}>
                                                                        {dir}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}
                                                        {user.lateResponseAt && (
                                                            <span className="late-response-time-sub">
                                                                Late: {new Date(user.lateResponseAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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