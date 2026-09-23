import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "react-hot-toast";
import { HiArrowLeft } from "react-icons/hi";
import {
    getActivePlan,
    getManualPlan,
    saveSelectedPlan,
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
    const initialDirection = (urlDirection === "OUTWARD" || urlDirection === "INWARD" || urlDirection === "BOTH")
        ? urlDirection
        : (pendingPlan?.direction || (() => {
            try {
                return localStorage.getItem("active_confirmation_direction") ||
                    localStorage.getItem("active_plan_direction") ||
                    "OUTWARD";
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
                getActivePlan({ direction: "OUTWARD", forceRefresh: true }),
                getManualPlan({ direction: "OUTWARD" }),
                getAIData({ direction: "OUTWARD" }).catch(() => null),
                getActivePlan({ direction: "INWARD", forceRefresh: true }),
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
        } catch (err) {
            console.error("Load Confirmation Data Error:", err);
            toast.error("Failed to load plan confirmation data from server.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadConfirmationData();
    }, [loadConfirmationData]);

    const handleDirectionChange = (newDir) => {
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
            navigate(planType === "ADMIN" ? "/admin/manual-plan" : "/ai-agent");
            return;
        }
        navigate(planType === "ADMIN" ? "/admin/manual-plan" : "/ai-agent");
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

        // A plan is truly confirmed/active ONLY when explicitly approved or selected
        const isActive = !isPendingMode && Boolean(
            targetPlan.isApproved === true ||
            targetPlan.approved === true ||
            (targetPlan.status === "active" && targetPlan.approvedAt)
        );

        return {
            students,
            routes: routesCount,
            vehicles: vehiclesCount,
            seats,
            allocated,
            isActive,
            isAvailable: routesCount > 0 || seats > 0 || allocated > 0
        };
    };

    // Resolve metrics based on selected planType
    const isOutwardPending = Boolean(isPendingMode && (pendingPlan?.direction === "OUTWARD" || !pendingPlan?.direction));
    const isInwardPending = Boolean(isPendingMode && pendingPlan?.direction === "INWARD");

    const outwardTargetDoc = planType === "ADMIN" ? outwardManualPlan : outwardAiPlan;
    const inwardTargetDoc = planType === "ADMIN" ? inwardManualPlan : inwardAiPlan;

    const outwardMetrics = extractPlanMetrics(outwardTargetDoc, outwardAttendance, isOutwardPending);
    const inwardMetrics = extractPlanMetrics(inwardTargetDoc, inwardAttendance, isInwardPending);

    const activeMetrics = (() => {
        if (direction === "OUTWARD") return outwardMetrics;
        if (direction === "INWARD") return inwardMetrics;
        return {
            students: Math.max(outwardMetrics.students, inwardMetrics.students),
            routes: outwardMetrics.routes + inwardMetrics.routes,
            vehicles: outwardMetrics.vehicles + inwardMetrics.vehicles,
            seats: outwardMetrics.seats + inwardMetrics.seats,
            allocated: outwardMetrics.allocated + inwardMetrics.allocated,
            isActive: outwardMetrics.isActive && inwardMetrics.isActive,
            isAvailable: outwardMetrics.isAvailable || inwardMetrics.isAvailable
        };
    })();

    // Determine if current selection is active/confirmed
    const isCurrentPlanActive = (() => {
        if (isPendingMode) return false;
        if (direction === "OUTWARD") return outwardMetrics.isActive;
        if (direction === "INWARD") return inwardMetrics.isActive;
        if (direction === "BOTH") return outwardMetrics.isActive && inwardMetrics.isActive;
        return false;
    })();

    // Stale Demand Check: plan marked stale by backend
    const activeTargetDoc = direction === "INWARD" ? inwardTargetDoc : outwardTargetDoc;
    const isPlanDemandStale = Boolean(
        !isPendingMode &&
        (activeTargetDoc?.isStale === true || activeTargetDoc?.status === "stale")
    );

    // Confirmation Handler
    const handleConfirm = async () => {
        if (isActionRunningRef.current || actionLoading || confirmLoading) return;

        if (isPlanDemandStale) {
            const currentDemand = activeTargetDoc?.currentDemandCount || (direction === "OUTWARD" ? outwardAttendance?.comingStudents : inwardAttendance?.comingStudents) || 0;
            toast.error(`Cannot activate plan: Demand mismatch (${activeMetrics.allocated} vs ${currentDemand} Coming students). Please regenerate.`);
            return;
        }

        // Pending Staged Mode confirmation
        if (isPendingMode && pendingPlan) {
            try {
                isActionRunningRef.current = true;
                setConfirmLoading(true);
                setConfirmStep("Validating plan constraints & allocating students...");

                const payload = {
                    planType: pendingPlan.planType || planType || "AI",
                    direction: pendingPlan.direction || direction || "INWARD",
                    tripMode: pendingPlan.tripMode,
                    plan: pendingPlan.plan,
                    startingPoint: pendingPlan.startingPoint
                };

                const res = await confirmAndAllocatePlan(payload);
                if (!res?.success) {
                    throw new Error(res?.message || "Failed to confirm and allocate transportation plan.");
                }

                try { sessionStorage.removeItem("pending_confirmation_plan"); } catch {}
                setPendingPlan(null);

                setSearchParams((prev) => {
                    const next = new URLSearchParams(prev);
                    next.delete("pending");
                    return next;
                });

                toast.success(`✓ ${payload.direction} plan confirmed and students allocated successfully!`);
                await loadConfirmationData();
            } catch (err) {
                console.error("Confirm & allocate plan error:", err);
                toast.error(err?.response?.data?.message || err?.message || "Failed to confirm plan.");
            } finally {
                isActionRunningRef.current = false;
                setConfirmLoading(false);
                setConfirmStep("");
            }
            return;
        }

        // Standard Confirmation / Activation Flow
        try {
            isActionRunningRef.current = true;
            setActionLoading(true);

            if (direction === "OUTWARD") {
                if (planType === "ADMIN") {
                    const res = await approveManualPlan({ direction: "OUTWARD" });
                    if (!res?.success) throw new Error(res?.message || "Failed to approve Outward Manual plan.");
                } else {
                    const planPayload = outwardAiPlan?.aiPlan || outwardAiPlan;
                    const res = await saveSelectedPlan({
                        planType: "AI",
                        direction: "OUTWARD",
                        tripMode: "FROM_SOURCE",
                        plan: planPayload,
                        planId: outwardAiPlan?._id || outwardAiPlan?.planId,
                        startingPoint: outwardAiPlan?.startingPoint || null,
                        allocationMode: "AI"
                    });
                    if (!res?.success) throw new Error(res?.message || "Failed to activate Outward AI plan.");
                }
                toast.success(`✓ Outward ${planType === "ADMIN" ? "Manual" : "AI"} plan confirmed & activated!`);
            } else if (direction === "INWARD") {
                if (planType === "ADMIN") {
                    const res = await approveManualPlan({ direction: "INWARD" });
                    if (!res?.success) throw new Error(res?.message || "Failed to approve Inward Manual plan.");
                } else {
                    const planPayload = inwardAiPlan?.aiPlan || inwardAiPlan;
                    const res = await saveSelectedPlan({
                        planType: "AI",
                        direction: "INWARD",
                        tripMode: "TO_DESTINATION",
                        plan: planPayload,
                        planId: inwardAiPlan?._id || inwardAiPlan?.planId,
                        startingPoint: inwardAiPlan?.startingPoint || null,
                        allocationMode: "AI"
                    });
                    if (!res?.success) throw new Error(res?.message || "Failed to activate Inward AI plan.");
                }
                toast.success(`✓ Inward ${planType === "ADMIN" ? "Manual" : "AI"} plan confirmed & activated!`);
            } else if (direction === "BOTH") {
                if (planType === "ADMIN") {
                    if (outwardMetrics.isAvailable) await approveManualPlan({ direction: "OUTWARD" });
                    if (inwardMetrics.isAvailable) await approveManualPlan({ direction: "INWARD" });
                } else {
                    const outPayload = outwardAiPlan?.aiPlan || outwardAiPlan;
                    const inPayload = inwardAiPlan?.aiPlan || inwardAiPlan;
                    const activated = [];

                    if (outwardMetrics.isAvailable && outPayload) {
                        const outRes = await saveSelectedPlan({
                            planType: "AI",
                            direction: "OUTWARD",
                            tripMode: "FROM_SOURCE",
                            plan: outPayload,
                            planId: outwardAiPlan?._id || outwardAiPlan?.planId,
                            startingPoint: outwardAiPlan?.startingPoint || null,
                            allocationMode: "AI"
                        });
                        if (outRes?.success) activated.push("Outward");
                    }

                    if (inwardMetrics.isAvailable && inPayload) {
                        const inRes = await saveSelectedPlan({
                            planType: "AI",
                            direction: "INWARD",
                            tripMode: "TO_DESTINATION",
                            plan: inPayload,
                            planId: inwardAiPlan?._id || inwardAiPlan?.planId,
                            startingPoint: inwardAiPlan?.startingPoint || null,
                            allocationMode: "AI"
                        });
                        if (inRes?.success) activated.push("Inward");
                    }

                    if (activated.length === 0) {
                        throw new Error("No valid generated plan available to confirm.");
                    }
                }
                toast.success(`✓ ${planType === "ADMIN" ? "Manual" : "AI"} plan confirmed & activated!`);
            }

            await loadConfirmationData();
        } catch (err) {
            console.error("Plan Confirmation Error:", err);
            toast.error(err?.response?.data?.message || err?.message || "Failed to confirm transportation plan.");
        } finally {
            isActionRunningRef.current = false;
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
                        <span className="stat-val font-numeric highlight-green">{metrics.allocated}</span>
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
                            <button
                                type="button"
                                className={`sel-btn ${direction === "BOTH" ? "active both" : ""}`}
                                onClick={() => handleDirectionChange("BOTH")}
                            >
                                🔄 BOTH
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

                {/* 2. Compact Plan Summary */}
                {loading ? (
                    <div className="compact-loading-card">
                        <div className="loading-spinner" />
                        <p>Loading plan summary...</p>
                    </div>
                ) : (
                    <div className="compact-summary-section">
                        {direction === "OUTWARD" && renderCompactCard("Outward", "🔵", outwardMetrics)}

                        {direction === "INWARD" && renderCompactCard("Inward", "🟢", inwardMetrics)}

                        {direction === "BOTH" && (
                            <div className="both-summaries-stack">
                                {renderCompactCard("Outward", "🔵", outwardMetrics)}
                                {renderCompactCard("Inward", "🟢", inwardMetrics)}

                                {/* Small Combined Summary */}
                                <div className="compact-plan-card combined-card">
                                    <div className="compact-card-header">
                                        <h4 className="compact-card-title combined-title">Combined Summary</h4>
                                    </div>
                                    <div className="compact-stats-list">
                                        <div className="stat-line">
                                            <span className="stat-label">Students</span>
                                            <span className="stat-val font-numeric">
                                                {outwardMetrics.students + inwardMetrics.students}
                                            </span>
                                        </div>
                                        <div className="stat-line">
                                            <span className="stat-label">Total Routes</span>
                                            <span className="stat-val font-numeric">
                                                {outwardMetrics.routes + inwardMetrics.routes}
                                            </span>
                                        </div>
                                        <div className="stat-line">
                                            <span className="stat-label">Total Vehicles</span>
                                            <span className="stat-val font-numeric">
                                                {outwardMetrics.vehicles + inwardMetrics.vehicles}
                                            </span>
                                        </div>
                                        <div className="stat-line">
                                            <span className="stat-label">Total Seats</span>
                                            <span className="stat-val font-numeric">
                                                {outwardMetrics.seats + inwardMetrics.seats}
                                            </span>
                                        </div>
                                        <div className="stat-line">
                                            <span className="stat-label">Total Allocated</span>
                                            <span className="stat-val font-numeric highlight-green">
                                                {outwardMetrics.allocated + inwardMetrics.allocated}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
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
                    <p className="confirmation-prompt">Confirm this transportation plan?</p>
                    <div className="confirmation-action-buttons">
                        <button
                            type="button"
                            className="btn-back"
                            onClick={handleBack}
                            disabled={actionLoading || confirmLoading}
                        >
                            ← Back
                        </button>
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
                                ? "⏳ Confirming..."
                                : isPlanDemandStale
                                    ? "⚠️ Plan Stale (Regeneration Required)"
                                    : isCurrentPlanActive
                                        ? "✓ Plan Active & Confirmed"
                                        : !activeMetrics.isAvailable && !isPendingMode
                                            ? "No Plan Generated"
                                            : "✓ Confirm Plan"}
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
