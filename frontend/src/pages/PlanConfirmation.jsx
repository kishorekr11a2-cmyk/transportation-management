import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "react-hot-toast";
import { HiArrowLeft } from "react-icons/hi";
import {
    getActivePlan,
    getManualPlan,
    saveSelectedPlan,
    confirmAIPlan,
    approveAIPlan,
    confirmAndAllocatePlan,
    approveManualPlan,
    getAIData
} from "../services/aiAgentService";
import "../css/PlanConfirmation.css";

const PlanConfirmation = () => {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    // Check if entered via pending staging (?pending=1)
    const isPendingParam = searchParams.get("pending") === "1";
    const [pendingPlan, setPendingPlan] = useState(() => {
        if (!isPendingParam) return null;
        try {
            const raw = sessionStorage.getItem("pending_confirmation_plan");
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    });
    const isPendingMode = Boolean(isPendingParam && pendingPlan?.plan);

    const urlDirection = searchParams.get("direction")?.toUpperCase();
    const initialDirection = (urlDirection === "OUTWARD" || urlDirection === "INWARD")
        ? urlDirection
        : ((pendingPlan?.direction === "OUTWARD" || pendingPlan?.direction === "INWARD")
            ? pendingPlan.direction
            : (() => {
                try {
                    const stored = localStorage.getItem("active_confirmation_direction") || localStorage.getItem("active_plan_direction");
                    return (stored === "OUTWARD" || stored === "INWARD") ? stored : "OUTWARD";
                } catch { return "OUTWARD"; }
            })());

    const urlPlanType = searchParams.get("type")?.toUpperCase();
    const initialPlanType = (urlPlanType === "AI" || urlPlanType === "ADMIN" || urlPlanType === "MANUAL")
        ? (urlPlanType === "MANUAL" ? "ADMIN" : urlPlanType)
        : (pendingPlan?.planType || (() => {
            try { return localStorage.getItem("active_confirmation_plan_type") || "AI"; }
            catch { return "AI"; }
        })());

    const [direction, setDirection] = useState(initialDirection);
    const [planType, setPlanType] = useState(initialPlanType);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [confirmLoading, setConfirmLoading] = useState(false);
    const [confirmStep, setConfirmStep] = useState("");

    // Plan data stores for both directions
    const [outwardAiPlan, setOutwardAiPlan] = useState(null);
    const [outwardManualPlan, setOutwardManualPlan] = useState(null);
    const [inwardAiPlan, setInwardAiPlan] = useState(null);
    const [inwardManualPlan, setInwardManualPlan] = useState(null);
    const [outwardAttendance, setOutwardAttendance] = useState({ comingStudents: 0, totalStudents: 0 });
    const [inwardAttendance, setInwardAttendance] = useState({ comingStudents: 0, totalStudents: 0 });

    const isActionRunningRef = useRef(false);

    // Load both directions in parallel
    const loadConfirmationData = useCallback(async () => {
        try {
            setLoading(true);
            const [
                outwardAiRes,
                outwardManualRes,
                outwardAiDataRes,
                inwardAiRes,
                inwardManualRes,
                inwardAiDataRes
            ] = await Promise.allSettled([
                getActivePlan({ direction: "OUTWARD", planType: "AI", forceRefresh: true }),
                getManualPlan({ direction: "OUTWARD" }),
                getAIData({ direction: "OUTWARD" }).catch(() => null),
                getActivePlan({ direction: "INWARD", planType: "AI", forceRefresh: true }),
                getManualPlan({ direction: "INWARD" }),
                getAIData({ direction: "INWARD" }).catch(() => null)
            ]);

            // Outward AI
            if (outwardAiRes.status === "fulfilled" && outwardAiRes.value?.success) {
                const plan = outwardAiRes.value.outwardPlan || outwardAiRes.value.plan;
                setOutwardAiPlan(plan || null);
            }
            // Outward Manual
            if (outwardManualRes.status === "fulfilled" && outwardManualRes.value?.success && outwardManualRes.value?.plan) {
                const m = outwardManualRes.value.plan;
                setOutwardManualPlan({
                    ...m,
                    planType: "ADMIN",
                    direction: "OUTWARD",
                    isApproved: Boolean(m.isApproved),
                    status: m.isApproved ? "active" : "draft"
                });
            }
            // Outward Attendance
            if (outwardAiDataRes.status === "fulfilled" && outwardAiDataRes.value?.success) {
                const d = outwardAiDataRes.value;
                const coming = Array.isArray(d.comingStudents) ? d.comingStudents.length : (d.summary?.comingStudents ?? 0);
                const total = Array.isArray(d.students) ? d.students.length : (d.summary?.totalStudents ?? coming);
                setOutwardAttendance({ comingStudents: coming, totalStudents: total });
            }

            // Inward AI
            if (inwardAiRes.status === "fulfilled" && inwardAiRes.value?.success) {
                const plan = inwardAiRes.value.inwardPlan || inwardAiRes.value.plan;
                setInwardAiPlan(plan || null);
            }
            // Inward Manual
            if (inwardManualRes.status === "fulfilled" && inwardManualRes.value?.success && inwardManualRes.value?.plan) {
                const m = inwardManualRes.value.plan;
                setInwardManualPlan({
                    ...m,
                    planType: "ADMIN",
                    direction: "INWARD",
                    isApproved: Boolean(m.isApproved),
                    status: m.isApproved ? "active" : "draft"
                });
            }
            // Inward Attendance
            if (inwardAiDataRes.status === "fulfilled" && inwardAiDataRes.value?.success) {
                const d = inwardAiDataRes.value;
                const coming = Array.isArray(d.comingStudents) ? d.comingStudents.length : (d.summary?.comingStudents ?? 0);
                const total = Array.isArray(d.students) ? d.students.length : (d.summary?.totalStudents ?? coming);
                setInwardAttendance({ comingStudents: coming, totalStudents: total });
            }

            // Auto-detect planType based on persistent MongoDB lifecycle priority if not explicitly specified in URL
            if (!urlPlanType) {
                const getPlanRank = (p) => {
                    if (!p || p.isStale === true || p.status === "stale") return 0;
                    if (p.isApproved === true || p.approved === true || (p.status === "active" && p.approvedAt)) return 3; // Approved & Assigned
                    if (p.isSubmitted === true || p.status === "pending_approval" || p.status === "submitted") return 2; // Pending approval
                    const bList = Array.isArray(p.buses) ? p.buses : (Array.isArray(p.routes) ? p.routes : []);
                    if (bList.length > 0 || p.status === "generated") return 1; // Generated
                    return 0;
                };

                const curDir = direction === "INWARD" ? "INWARD" : "OUTWARD";
                const aiP = (curDir === "INWARD")
                    ? (inwardAiRes.status === "fulfilled" && inwardAiRes.value?.success ? (inwardAiRes.value.inwardPlan || inwardAiRes.value.plan) : null)
                    : (outwardAiRes.status === "fulfilled" && outwardAiRes.value?.success ? (outwardAiRes.value.outwardPlan || outwardAiRes.value.plan) : null);
                const manP = (curDir === "INWARD")
                    ? (inwardManualRes.status === "fulfilled" && inwardManualRes.value?.success ? inwardManualRes.value.plan : null)
                    : (outwardManualRes.status === "fulfilled" && outwardManualRes.value?.success ? outwardManualRes.value.plan : null);

                const aiRank = getPlanRank(aiP);
                const manRank = getPlanRank(manP);

                if (manRank > aiRank) {
                    setPlanType("ADMIN");
                } else if (aiRank >= manRank && aiRank > 0) {
                    setPlanType("AI");
                }
            }

            // Auto-detect direction if URL didn't force a single direction
            if (!urlDirection) {
                const outDoc = outwardAiRes.status === "fulfilled" && outwardAiRes.value?.success ? (outwardAiRes.value.outwardPlan || outwardAiRes.value.plan) : null;
                const inDoc = inwardAiRes.status === "fulfilled" && inwardAiRes.value?.success ? (inwardAiRes.value.inwardPlan || inwardAiRes.value.plan) : null;
                const hasOut = Boolean(outDoc && (Array.isArray(outDoc.buses) ? outDoc.buses.length : outDoc.routes?.length));
                const hasIn = Boolean(inDoc && (Array.isArray(inDoc.buses) ? inDoc.buses.length : inDoc.routes?.length));
                if (hasIn && !hasOut) {
                    setDirection("INWARD");
                } else {
                    setDirection((prev) => (prev === "INWARD" ? "INWARD" : "OUTWARD"));
                }
            }
        } catch (err) {
            console.error("Load Confirmation Data Error:", err);
            toast.error("Failed to load plan confirmation data from server.");
        } finally {
            setLoading(false);
        }
    }, [direction, urlPlanType]);

    useEffect(() => {
        loadConfirmationData();
    }, [loadConfirmationData]);

    const handleDirectionChange = (newDir) => {
        if (newDir !== "OUTWARD" && newDir !== "INWARD") return;
        if (newDir === direction) return;
        setDirection(newDir);
        try {
            localStorage.setItem("active_confirmation_direction", newDir);
            localStorage.setItem("active_plan_direction", newDir);
        } catch {}
        setSearchParams((prev) => {
            const p = new URLSearchParams(prev);
            p.set("direction", newDir);
            return p;
        });

        if (!urlPlanType) {
            const getPlanRank = (p) => {
                if (!p || p.isStale === true || p.status === "stale") return 0;
                if (p.isApproved === true || p.approved === true || (p.status === "active" && p.approvedAt)) return 3;
                if (p.isSubmitted === true || p.status === "pending_approval" || p.status === "submitted") return 2;
                const bList = Array.isArray(p.buses) ? p.buses : (Array.isArray(p.routes) ? p.routes : []);
                if (bList.length > 0 || p.status === "generated") return 1;
                return 0;
            };

            const targetAi = (newDir === "INWARD") ? inwardAiPlan : outwardAiPlan;
            const targetMan = (newDir === "INWARD") ? inwardManualPlan : outwardManualPlan;
            const aiR = getPlanRank(targetAi);
            const manR = getPlanRank(targetMan);
            if (manR > aiR) {
                setPlanType("ADMIN");
            } else if (aiR >= manR && aiR > 0) {
                setPlanType("AI");
            }
        }
    };

    const handlePlanTypeToggle = (type) => {
        if (type === planType) return;
        setPlanType(type);
        try { localStorage.setItem("active_confirmation_plan_type", type); } catch {}
        setSearchParams((prev) => {
            const p = new URLSearchParams(prev);
            p.set("type", type);
            return p;
        });
    };

    const handleBack = () => {
        if (isPendingMode) {
            try { sessionStorage.removeItem("pending_confirmation_plan"); } catch {}
            setPendingPlan(null);
        }
        navigate("/admin-dashboard");
    };

    // Calculate metrics for any plan
    const extractPlanMetrics = (plan, attendance, isPendingTarget = false) => {
        const targetPlan = (isPendingTarget && pendingPlan?.plan) ? pendingPlan.plan : plan;

        if (!targetPlan) {
            return {
                students: attendance?.comingStudents || attendance?.totalStudents || 0,
                routes: 0,
                vehicles: 0,
                seats: 0,
                allocated: 0,
                isActive: false,
                isAvailable: false
            };
        }

        const buses = Array.isArray(targetPlan.buses)
            ? targetPlan.buses
            : (Array.isArray(targetPlan.routes) ? targetPlan.routes : []);

        const routesCount = buses.length;

        const vehiclesCount = (() => {
            if (buses.length === 0) return 0;
            const vSet = new Set();
            buses.forEach((b) => {
                const vId = b.assignedVehicle?._id || b.assignedVehicle?.vehicleName || b.assignedVehicle?.vehicleNumber || b.vehicleId || b.vehicleName || b.busNumber;
                if (vId) vSet.add(String(vId).trim());
            });
            return vSet.size > 0 ? vSet.size : buses.length;
        })();

        const seats = buses.reduce((acc, b) => acc + (Number(b.capacity || b.totalCapacity || b.assignedVehicle?.capacity) || 0), 0);

        const allocated = Number(
            targetPlan.assignedUsers ??
            targetPlan.allocatedUsers ??
            targetPlan.summary?.allocatedSeats ??
            targetPlan.summary?.totalAllocated ??
            buses.reduce((acc, b) => acc + (Number(b.allocatedCount || b.studentCount || b.assignedStudents?.length || b.students?.length) || 0), 0)
        ) || 0;

        const students = allocated > 0
            ? allocated
            : (attendance?.comingStudents || attendance?.totalStudents || 0);

        const hasLate = Boolean(targetPlan.hasLateResponses || targetPlan.pendingReallocation);

        // A plan is truly confirmed/active ONLY when explicitly approved or selected AND has no pending late responses
        const isActive = !isPendingMode && !hasLate && Boolean(
            targetPlan.isApproved === true ||
            targetPlan.approved === true ||
            (targetPlan.status === "active" && targetPlan.approvedAt)
        );

        // A plan is pending approval when submitted but NOT yet approved, OR when approved plan has pending late responses, OR when generated and awaiting approval
        const isPendingApproval = !isActive && Boolean(
            hasLate ||
            targetPlan.isSubmitted === true ||
            targetPlan.status === "pending_approval" ||
            targetPlan.status === "submitted" ||
            targetPlan.status === "generated" ||
            isPendingMode ||
            (routesCount > 0 && !isActive)
        );

        return {
            students,
            routes: routesCount,
            vehicles: vehiclesCount,
            seats,
            allocated,
            isActive,
            isPendingApproval,
            isAvailable: routesCount > 0 || seats > 0 || allocated > 0
        };
    };

    // Resolve metrics based on selected planType
    const isOutwardPending = Boolean(isPendingMode && (pendingPlan?.direction === "OUTWARD" || !pendingPlan?.direction));
    const isInwardPending = Boolean(isPendingMode && pendingPlan?.direction === "INWARD");

    const outwardTargetDoc = (isOutwardPending && pendingPlan?.plan)
        ? pendingPlan.plan
        : (planType === "ADMIN" ? outwardManualPlan : outwardAiPlan);
    const inwardTargetDoc = (isInwardPending && pendingPlan?.plan)
        ? pendingPlan.plan
        : (planType === "ADMIN" ? inwardManualPlan : inwardAiPlan);

    const outwardMetrics = extractPlanMetrics(outwardTargetDoc, outwardAttendance, isOutwardPending);
    const inwardMetrics = extractPlanMetrics(inwardTargetDoc, inwardAttendance, isInwardPending);

    const activeMetrics = direction === "INWARD" ? inwardMetrics : outwardMetrics;
    const activeTargetDoc = direction === "INWARD" ? inwardTargetDoc : outwardTargetDoc;

    // Determine if current selection is active/confirmed
    const isCurrentPlanActive = !isPendingMode && Boolean(activeMetrics.isActive);

    // Determine if current selection is submitted and pending approval
    const isCurrentPlanPendingApproval = !isPendingMode && Boolean(activeMetrics.isPendingApproval);

    // Stale Demand Check: plan marked stale by backend
    const isPlanDemandStale = Boolean(
        !isPendingMode &&
        (activeTargetDoc?.isStale === true || activeTargetDoc?.status === "stale")
    );

    // Confirmation / Approval Handler
    const handleConfirm = async () => {
        if (isActionRunningRef.current || actionLoading || confirmLoading) return;

        if (isPlanDemandStale) {
            const currentDemand = activeTargetDoc?.currentDemandCount || (direction === "OUTWARD" ? outwardAttendance?.comingStudents : inwardAttendance?.comingStudents) || 0;
            toast.error(`Cannot activate plan: Demand mismatch (${activeMetrics.allocated} vs ${currentDemand} Coming students). Please regenerate.`);
            return;
        }

        try {
            isActionRunningRef.current = true;
            setConfirmLoading(true);
            setConfirmStep("Approving plan and allocating students in database...");

            const targetDirection = (isPendingMode && pendingPlan?.direction) ? pendingPlan.direction : direction;
            const targetPlanType = (isPendingMode && pendingPlan?.planType) ? pendingPlan.planType : planType;

            if (targetDirection === "OUTWARD") {
                if (targetPlanType === "ADMIN") {
                    const res = await approveManualPlan({ direction: "OUTWARD" });
                    if (!res?.success) throw new Error(res?.message || "Failed to approve Outward Manual plan.");
                } else if (outwardAiPlan || (isPendingMode && pendingPlan?.direction === "OUTWARD")) {
                    const planPayload = (isPendingMode && pendingPlan?.direction === "OUTWARD" && pendingPlan?.plan)
                        ? pendingPlan.plan
                        : (outwardAiPlan?.aiPlan || outwardAiPlan);
                    const res = await approveAIPlan({
                        planType: "AI",
                        direction: "OUTWARD",
                        tripMode: "FROM_SOURCE",
                        plan: planPayload,
                        planId: (isPendingMode && pendingPlan?.direction === "OUTWARD" && pendingPlan?.planId) || outwardAiPlan?._id || outwardAiPlan?.planId,
                        startingPoint: (isPendingMode && pendingPlan?.direction === "OUTWARD" && pendingPlan?.startingPoint) || outwardAiPlan?.startingPoint || null
                    });
                    if (!res?.success) throw new Error(res?.message || "Failed to approve Outward AI plan.");
                }
            } else if (targetDirection === "INWARD") {
                if (targetPlanType === "ADMIN") {
                    const res = await approveManualPlan({ direction: "INWARD" });
                    if (!res?.success) throw new Error(res?.message || "Failed to approve Inward Manual plan.");
                } else if (inwardAiPlan || (isPendingMode && pendingPlan?.direction === "INWARD")) {
                    const planPayload = (isPendingMode && pendingPlan?.direction === "INWARD" && pendingPlan?.plan)
                        ? pendingPlan.plan
                        : (inwardAiPlan?.aiPlan || inwardAiPlan);
                    const res = await approveAIPlan({
                        planType: "AI",
                        direction: "INWARD",
                        tripMode: "TO_DESTINATION",
                        plan: planPayload,
                        planId: (isPendingMode && pendingPlan?.direction === "INWARD" && pendingPlan?.planId) || inwardAiPlan?._id || inwardAiPlan?.planId,
                        startingPoint: (isPendingMode && pendingPlan?.direction === "INWARD" && pendingPlan?.startingPoint) || inwardAiPlan?.startingPoint || null
                    });
                    if (!res?.success) throw new Error(res?.message || "Failed to approve Inward AI plan.");
                }
            }

            toast.success(`✓ ${targetDirection === "OUTWARD" ? "Outward" : "Inward"} ${targetPlanType === "ADMIN" ? "Manual" : "AI"} plan approved & students allocated successfully in database!`);

            try { sessionStorage.removeItem("pending_confirmation_plan"); } catch {}
            setPendingPlan(null);
            setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.delete("pending");
                return next;
            });

            await loadConfirmationData();
        } catch (err) {
            console.error("Approve plan error:", err);
            toast.error(err?.response?.data?.message || err?.message || "Failed to approve plan.");
        } finally {
            isActionRunningRef.current = false;
            setConfirmLoading(false);
            setConfirmStep("");
            setActionLoading(false);
        }
    };

    // Render a single compact card
    const renderCompactCard = (dirLabel, dirIcon, metrics) => {
        const planTypeName = planType === "ADMIN" ? "Manual Plan" : "AI Plan";
        return (
            <div className="compact-plan-card">
                <div className="compact-card-header">
                    <h3 className="compact-card-title">
                        {dirIcon} {dirLabel} · {planType === "ADMIN" ? "👨‍💼" : "🤖"} {planTypeName}
                    </h3>
                    {metrics.isActive && (
                        <span className="compact-active-badge">✓ ACTIVE</span>
                    )}
                    {!metrics.isActive && metrics.isPendingApproval && (
                        <span className="compact-pending-badge" style={{ background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a", padding: "2px 8px", borderRadius: "12px", fontSize: "11px", fontWeight: "bold" }}>⏳ PENDING APPROVAL</span>
                    )}
                </div>

                <div className="compact-stats-list">
                    <div className="stat-line">
                        <span className="stat-label">Students</span>
                        <span className="stat-val font-numeric">{metrics.students}</span>
                    </div>
                    <div className="stat-line">
                        <span className="stat-label">Routes</span>
                        <span className="stat-val font-numeric">{metrics.routes}</span>
                    </div>
                    <div className="stat-line">
                        <span className="stat-label">Vehicles</span>
                        <span className="stat-val font-numeric">{metrics.vehicles}</span>
                    </div>
                    <div className="stat-line">
                        <span className="stat-label">Seats</span>
                        <span className="stat-val font-numeric">{metrics.seats}</span>
                    </div>
                    <div className="stat-line">
                        <span className="stat-label">Allocated</span>
                        <span className={`stat-val font-numeric ${metrics.isActive ? "highlight-green" : ""}`} style={metrics.isPendingApproval ? { color: "#b45309", fontWeight: "600" } : {}}>
                            {metrics.isActive ? `${metrics.allocated} / ${metrics.students}` : (metrics.isPendingApproval ? "Pending Approval" : "Not Allocated")}
                        </span>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="final-plan-page">
            <div className="final-plan-container">
                <div className="final-plan-header" style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "20px" }}>
                    <button
                        type="button"
                        className="plan-header-back-btn"
                        onClick={handleBack}
                        aria-label="Go back"
                    >
                        <HiArrowLeft size={16} />
                        Back
                    </button>
                    <h1 className="final-plan-page-title" style={{ margin: 0 }}>Final Plan Confirmation</h1>
                </div>

                {/* 1. Plan Selection */}
                <div className="plan-selection-controls">
                    <div className="selector-group">
                        <span className="selector-label">Direction</span>
                        <div className="selector-buttons">
                            <button
                                type="button"
                                className={`sel-btn ${direction === "OUTWARD" ? "active outward" : ""}`}
                                onClick={() => handleDirectionChange("OUTWARD")}
                            >
                                🔵 OUTWARD
                            </button>
                            <button
                                type="button"
                                className={`sel-btn ${direction === "INWARD" ? "active inward" : ""}`}
                                onClick={() => handleDirectionChange("INWARD")}
                            >
                                🟢 INWARD
                            </button>
                        </div>
                    </div>

                    <div className="selector-group">
                        <span className="selector-label">Plan Type</span>
                        <div className="selector-buttons">
                            <button
                                type="button"
                                className={`sel-btn ${planType === "AI" ? "active ai" : ""}`}
                                onClick={() => handlePlanTypeToggle("AI")}
                            >
                                🤖 AI PLAN
                            </button>
                            <button
                                type="button"
                                className={`sel-btn ${planType === "ADMIN" ? "active admin" : ""}`}
                                onClick={() => handlePlanTypeToggle("ADMIN")}
                            >
                                👨‍💼 MANUAL PLAN
                            </button>
                        </div>
                    </div>
                </div>

                {/* 2. Respective Plan Details */}
                {loading ? (
                    <div className="compact-loading-card">
                        <div className="loading-spinner" />
                        <p>Loading plan summary...</p>
                    </div>
                ) : (
                    <div className="compact-summary-section">
                        {direction === "OUTWARD"
                            ? renderCompactCard("Outward", "🔵", outwardMetrics)
                            : renderCompactCard("Inward", "🟢", inwardMetrics)}
                    </div>
                )}

                {/* 3. Confirmation Section */}
                <div className="confirmation-box">
                    {isPlanDemandStale && (
                        <div style={{
                            background: "#fef2f2",
                            border: "1.5px solid #fecaca",
                            borderRadius: "10px",
                            padding: "12px 16px",
                            marginBottom: "16px",
                            color: "#991b1b",
                            fontSize: "13px",
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                            textAlign: "left"
                        }}>
                            <span style={{ fontSize: "20px" }}>⚠️</span>
                            <div>
                                <b style={{ display: "block", marginBottom: "2px" }}>Demand Changed — Regeneration Required</b>
                                Student demand has changed since this plan was generated. This plan is stale and cannot be activated. Return to AI Agent to regenerate.
                            </div>
                        </div>
                    )}
                    <p className="confirmation-prompt">
                        {isCurrentPlanActive
                            ? "This plan is already active and confirmed."
                            : "Approve and activate this plan (allocates students in database)?"}
                    </p>
                    <div className="confirmation-action-buttons">
                        <button
                            type="button"
                            className="btn-back"
                            onClick={handleBack}
                            disabled={actionLoading || confirmLoading}
                        >
                            ← Back
                        </button>

                        {!isPendingMode && !activeMetrics.isAvailable && (
                            <button
                                type="button"
                                className="btn-generate-new"
                                onClick={() => navigate(planType === "ADMIN" ? "/routes" : "/ai-agent")}
                                style={{
                                    padding: "10px 18px",
                                    fontSize: "14px",
                                    fontWeight: "600",
                                    background: "#2563eb",
                                    color: "#ffffff",
                                    border: "none",
                                    borderRadius: "8px",
                                    cursor: "pointer"
                                }}
                            >
                                ⚡ Generate New Plan →
                            </button>
                        )}

                        <button
                            type="button"
                            className="btn-confirm-plan"
                            onClick={handleConfirm}
                            disabled={actionLoading || confirmLoading || isCurrentPlanActive || isPlanDemandStale || (!isPendingMode && !activeMetrics.isAvailable)}
                            title={
                                isPlanDemandStale
                                    ? "Cannot confirm: Plan is stale. Please regenerate."
                                    : !activeMetrics.isAvailable && !isPendingMode
                                    ? "No route generated yet for this direction."
                                    : ""
                            }
                        >
                            {confirmLoading || actionLoading
                                ? "⏳ Processing..."
                                : isPlanDemandStale
                                    ? "⚠️ Plan Stale (Regeneration Required)"
                                    : isCurrentPlanActive
                                        ? "✓ Plan Active & Confirmed"
                                        : !activeMetrics.isAvailable && !isPendingMode
                                            ? "No Plan Generated"
                                            : "✓ Approve & Activate Plan"}
                        </button>
                    </div>
                </div>
            </div>

            {/* Confirm Progress Overlay */}
            {confirmLoading && (
                <div className="confirm-progress-overlay">
                    <div className="confirm-progress-dialog">
                        <div className="confirm-spinner" />
                        <h3 className="confirm-step-title">{confirmStep || "Processing..."}</h3>
                        <p className="confirm-substep-text">
                            Allocating students and activating transportation plan in database...
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PlanConfirmation;
