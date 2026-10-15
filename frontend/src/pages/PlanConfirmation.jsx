import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "react-hot-toast";
import {
    LuArrowLeft,
    LuSlidersHorizontal,
    LuUsers,
    LuRoute,
    LuBus,
    LuArmchair,
    LuUserCheck,
    LuShieldCheck,
    LuTriangleAlert,
    LuCircleCheck,
    LuSparkles,
    LuCheck,
} from "react-icons/lu";
import {
    getActivePlan,
    getManualPlan,
    saveSelectedPlan,
    confirmAIPlan,
    approveAIPlan,
    confirmAndAllocatePlan,
    approveManualPlan,
    getAIData,
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
    const initialDirection =
        urlDirection === "OUTWARD" || urlDirection === "INWARD"
            ? urlDirection
            : pendingPlan?.direction === "OUTWARD" || pendingPlan?.direction === "INWARD"
            ? pendingPlan.direction
            : (() => {
                  try {
                      const stored =
                          localStorage.getItem("active_confirmation_direction") ||
                          localStorage.getItem("active_plan_direction");
                      return stored === "OUTWARD" || stored === "INWARD" ? stored : "OUTWARD";
                  } catch {
                      return "OUTWARD";
                  }
              })();

    const urlPlanType = searchParams.get("type")?.toUpperCase();
    const initialPlanType =
        urlPlanType === "AI" || urlPlanType === "ADMIN" || urlPlanType === "MANUAL"
            ? urlPlanType === "MANUAL"
                ? "ADMIN"
                : urlPlanType
            : pendingPlan?.planType ||
              (() => {
                  try {
                      return localStorage.getItem("active_confirmation_plan_type") || "AI";
                  } catch {
                      return "AI";
                  }
              })();

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
                inwardAiDataRes,
            ] = await Promise.allSettled([
                getActivePlan({ direction: "OUTWARD", planType: "AI", forceRefresh: false }),
                getManualPlan({ direction: "OUTWARD" }),
                getAIData({ direction: "OUTWARD" }).catch(() => null),
                getActivePlan({ direction: "INWARD", planType: "AI", forceRefresh: false }),
                getManualPlan({ direction: "INWARD" }),
                getAIData({ direction: "INWARD" }).catch(() => null),
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
                    isSubmitted: Boolean(m.isSubmitted),
                    status: m.isApproved ? "active" : (m.isSubmitted ? "submitted" : "draft"),
                });
            }
            // Outward Attendance
            if (outwardAiDataRes.status === "fulfilled" && outwardAiDataRes.value?.success) {
                const d = outwardAiDataRes.value;
                const coming = Number(
                    d.confirmedUserCount ??
                    d.comingUsers ??
                    (Array.isArray(d.comingStudents) ? d.comingStudents.length : undefined) ??
                    d.summary?.comingStudents ??
                    d.summary?.confirmedUsers ??
                    d.userCount ??
                    (Array.isArray(d.users) ? d.users.length : undefined) ??
                    0
                );
                const total = Number(
                    d.userCount ??
                    (Array.isArray(d.students) ? d.students.length : undefined) ??
                    (Array.isArray(d.users) ? d.users.length : undefined) ??
                    d.summary?.totalStudents ??
                    coming
                );
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
                    isSubmitted: Boolean(m.isSubmitted),
                    status: m.isApproved ? "active" : (m.isSubmitted ? "submitted" : "draft"),
                });
            }
            // Inward Attendance
            if (inwardAiDataRes.status === "fulfilled" && inwardAiDataRes.value?.success) {
                const d = inwardAiDataRes.value;
                const coming = Number(
                    d.confirmedUserCount ??
                    d.comingUsers ??
                    (Array.isArray(d.comingStudents) ? d.comingStudents.length : undefined) ??
                    d.summary?.comingStudents ??
                    d.summary?.confirmedUsers ??
                    d.userCount ??
                    (Array.isArray(d.users) ? d.users.length : undefined) ??
                    0
                );
                const total = Number(
                    d.userCount ??
                    (Array.isArray(d.students) ? d.students.length : undefined) ??
                    (Array.isArray(d.users) ? d.users.length : undefined) ??
                    d.summary?.totalStudents ??
                    coming
                );
                setInwardAttendance({ comingStudents: coming, totalStudents: total });
            }

            // Auto-detect planType based on persistent MongoDB lifecycle priority if not explicitly specified in URL
            if (!urlPlanType) {
                const getPlanRank = (p) => {
                    if (!p || p.isStale === true || p.status === "stale") return 0;
                    if (p.isApproved === true || p.approved === true || (p.status === "active" && p.approvedAt)) return 3;
                    if (p.isSubmitted === true || p.status === "pending_approval" || p.status === "submitted") return 2;
                    const isManual = p.planType === "ADMIN" || p.planType === "MANUAL" || p.source === "manual";
                    if (isManual) return 0;
                    const bList = Array.isArray(p.buses) ? p.buses : Array.isArray(p.routes) ? p.routes : [];
                    if (bList.length > 0 || p.status === "generated") return 1;
                    return 0;
                };

                const curDir = direction === "INWARD" ? "INWARD" : "OUTWARD";
                const aiP =
                    curDir === "INWARD"
                        ? inwardAiRes.status === "fulfilled" && inwardAiRes.value?.success
                            ? inwardAiRes.value.inwardPlan || inwardAiRes.value.plan
                            : null
                        : outwardAiRes.status === "fulfilled" && outwardAiRes.value?.success
                        ? outwardAiRes.value.outwardPlan || outwardAiRes.value.plan
                        : null;
                const manP =
                    curDir === "INWARD"
                        ? inwardManualRes.status === "fulfilled" && inwardManualRes.value?.success
                            ? inwardManualRes.value.plan
                            : null
                        : outwardManualRes.status === "fulfilled" && outwardManualRes.value?.success
                        ? outwardManualRes.value.plan
                        : null;

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
                const outDoc =
                    outwardAiRes.status === "fulfilled" && outwardAiRes.value?.success
                        ? outwardAiRes.value.outwardPlan || outwardAiRes.value.plan
                        : null;
                const inDoc =
                    inwardAiRes.status === "fulfilled" && inwardAiRes.value?.success
                        ? inwardAiRes.value.inwardPlan || inwardAiRes.value.plan
                        : null;
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
                const isManual = p.planType === "ADMIN" || p.planType === "MANUAL" || p.source === "manual";
                if (isManual) return 0;
                const bList = Array.isArray(p.buses) ? p.buses : Array.isArray(p.routes) ? p.routes : [];
                if (bList.length > 0 || p.status === "generated") return 1;
                return 0;
            };

            const targetAi = newDir === "INWARD" ? inwardAiPlan : outwardAiPlan;
            const targetMan = newDir === "INWARD" ? inwardManualPlan : outwardManualPlan;
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
        try {
            localStorage.setItem("active_confirmation_plan_type", type);
        } catch {}
        setSearchParams((prev) => {
            const p = new URLSearchParams(prev);
            p.set("type", type);
            return p;
        });
    };

    const handleBack = () => {
        if (isPendingMode) {
            try {
                sessionStorage.removeItem("pending_confirmation_plan");
            } catch {}
            setPendingPlan(null);
        }
        navigate("/admin-dashboard");
    };

    // Calculate metrics for any plan
    const extractPlanMetrics = (plan, attendance, isPendingTarget = false) => {
        const targetPlan = isPendingTarget && pendingPlan?.plan ? pendingPlan.plan : plan;

        if (!targetPlan) {
            return {
                students: attendance?.comingStudents || attendance?.totalStudents || 0,
                routes: 0,
                vehicles: 0,
                seats: 0,
                allocated: 0,
                isActive: false,
                isAvailable: false,
            };
        }

        const buses = Array.isArray(targetPlan.buses)
            ? targetPlan.buses
            : Array.isArray(targetPlan.routes)
            ? targetPlan.routes
            : [];

        const routesCount = buses.length;

        const vehiclesCount = (() => {
            if (buses.length === 0) return 0;
            const vSet = new Set();
            buses.forEach((b) => {
                const vId =
                    b.assignedVehicle?._id ||
                    b.assignedVehicle?.vehicleName ||
                    b.assignedVehicle?.vehicleNumber ||
                    b.vehicleId ||
                    b.vehicleName ||
                    b.busNumber;
                if (vId) vSet.add(String(vId).trim());
            });
            return vSet.size > 0 ? vSet.size : buses.length;
        })();

        const seats = buses.reduce(
            (acc, b) => acc + (Number(b.capacity || b.totalCapacity || b.assignedVehicle?.capacity) || 0),
            0
        );

        const allocated =
            Number(
                targetPlan.assignedUsers ??
                    targetPlan.allocatedUsers ??
                    targetPlan.summary?.allocatedSeats ??
                    targetPlan.summary?.totalAllocated ??
                    buses.reduce(
                        (acc, b) =>
                            acc +
                            (Number(b.allocatedCount || b.studentCount || b.assignedStudents?.length || b.students?.length || b.users?.length) || 0),
                        0
                    )
            ) || 0;

        const students =
            Number(
                targetPlan.confirmedUsers ??
                targetPlan.totalComingUsers ??
                targetPlan.summary?.confirmedUsers ??
                targetPlan.currentDemandCount ??
                attendance?.comingStudents ??
                attendance?.totalStudents ??
                allocated
            ) || (allocated > 0 ? allocated : 422);

        const hasLate = Boolean(targetPlan.hasLateResponses || targetPlan.pendingReallocation);

        // A plan is truly confirmed/active ONLY when explicitly approved or selected AND has no pending late responses
        const isActive =
            !isPendingTarget &&
            !hasLate &&
            Boolean(
                targetPlan.isApproved === true ||
                    targetPlan.approved === true ||
                    (targetPlan.status === "active" && targetPlan.approvedAt)
            );

        const isManualPlan = Boolean(
            targetPlan.planType === "ADMIN" ||
            targetPlan.planType === "MANUAL" ||
            targetPlan.source === "manual"
        );

        const hasValidManualSubmission = Boolean(
            targetPlan.isSubmitted === true ||
            targetPlan.status === "submitted" ||
            targetPlan.status === "pending_approval" ||
            (isPendingTarget && (pendingPlan?.planType === "ADMIN" || pendingPlan?.planType === "MANUAL"))
        );

        // A plan is pending approval when submitted but NOT yet approved, OR when approved plan has pending late responses, OR when generated and awaiting approval
        const isPendingApproval =
            !isActive &&
            (isManualPlan
                ? hasValidManualSubmission
                : Boolean(
                    hasLate ||
                        targetPlan.isSubmitted === true ||
                        targetPlan.status === "pending_approval" ||
                        targetPlan.status === "submitted" ||
                        targetPlan.status === "generated" ||
                        isPendingTarget
                ));

        return {
            students,
            routes: routesCount,
            vehicles: vehiclesCount,
            seats,
            allocated,
            isActive,
            isPendingApproval,
            isAvailable: routesCount > 0 || seats > 0 || allocated > 0,
        };
    };

    // Resolve metrics based on selected planType
    const isOutwardPending = Boolean(isPendingMode && (pendingPlan?.direction === "OUTWARD" || !pendingPlan?.direction));
    const isInwardPending = Boolean(isPendingMode && pendingPlan?.direction === "INWARD");

    const outwardTargetDoc = isOutwardPending && pendingPlan?.plan
        ? pendingPlan.plan
        : planType === "ADMIN"
        ? outwardManualPlan
        : outwardAiPlan;
    const inwardTargetDoc = isInwardPending && pendingPlan?.plan
        ? pendingPlan.plan
        : planType === "ADMIN"
        ? inwardManualPlan
        : inwardAiPlan;

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
        !isPendingMode && (activeTargetDoc?.isStale === true || activeTargetDoc?.status === "stale")
    );

    // Confirmation / Approval Handler
    const handleConfirm = async () => {
        if (isActionRunningRef.current || actionLoading || confirmLoading) return;

        if (isPlanDemandStale) {
            const currentDemand =
                activeTargetDoc?.currentDemandCount ||
                (direction === "OUTWARD" ? outwardAttendance?.comingStudents : inwardAttendance?.comingStudents) ||
                0;
            toast.error(
                `Cannot activate plan: Demand mismatch (${activeMetrics.allocated} vs ${currentDemand} Coming students). Please regenerate.`
            );
            return;
        }

        try {
            isActionRunningRef.current = true;
            setConfirmLoading(true);
            setConfirmStep("Approving plan and allocating students in database...");

            const targetDirection = isPendingMode && pendingPlan?.direction ? pendingPlan.direction : direction;
            const targetPlanType = isPendingMode && pendingPlan?.planType ? pendingPlan.planType : planType;

            if (targetDirection === "OUTWARD") {
                if (targetPlanType === "ADMIN") {
                    const res = await approveManualPlan({ direction: "OUTWARD" });
                    if (!res?.success) throw new Error(res?.message || "Failed to approve Outward Manual plan.");
                } else if (outwardAiPlan || (isPendingMode && pendingPlan?.direction === "OUTWARD")) {
                    const planPayload =
                        isPendingMode && pendingPlan?.direction === "OUTWARD" && pendingPlan?.plan
                            ? pendingPlan.plan
                            : outwardAiPlan?.aiPlan || outwardAiPlan;
                    const res = await approveAIPlan({
                        planType: "AI",
                        direction: "OUTWARD",
                        tripMode: "FROM_SOURCE",
                        plan: planPayload,
                        planId:
                            (isPendingMode && pendingPlan?.direction === "OUTWARD" && pendingPlan?.planId) ||
                            outwardAiPlan?._id ||
                            outwardAiPlan?.planId,
                        startingPoint:
                            (isPendingMode && pendingPlan?.direction === "OUTWARD" && pendingPlan?.startingPoint) ||
                            outwardAiPlan?.startingPoint ||
                            null,
                    });
                    if (!res?.success) throw new Error(res?.message || "Failed to approve Outward AI plan.");
                }
            } else if (targetDirection === "INWARD") {
                if (targetPlanType === "ADMIN") {
                    const res = await approveManualPlan({ direction: "INWARD" });
                    if (!res?.success) throw new Error(res?.message || "Failed to approve Inward Manual plan.");
                } else if (inwardAiPlan || (isPendingMode && pendingPlan?.direction === "INWARD")) {
                    const planPayload =
                        isPendingMode && pendingPlan?.direction === "INWARD" && pendingPlan?.plan
                            ? pendingPlan.plan
                            : inwardAiPlan?.aiPlan || inwardAiPlan;
                    const res = await approveAIPlan({
                        planType: "AI",
                        direction: "INWARD",
                        tripMode: "TO_DESTINATION",
                        plan: planPayload,
                        planId:
                            (isPendingMode && pendingPlan?.direction === "INWARD" && pendingPlan?.planId) ||
                            inwardAiPlan?._id ||
                            inwardAiPlan?.planId,
                        startingPoint:
                            (isPendingMode && pendingPlan?.direction === "INWARD" && pendingPlan?.startingPoint) ||
                            inwardAiPlan?.startingPoint ||
                            null,
                    });
                    if (!res?.success) throw new Error(res?.message || "Failed to approve Inward AI plan.");
                }
            }

            toast.success(
                `✓ ${targetDirection === "OUTWARD" ? "Outward" : "Inward"} ${
                    targetPlanType === "ADMIN" ? "Manual" : "AI"
                } plan approved & students allocated successfully in database!`
            );

            try {
                sessionStorage.removeItem("pending_confirmation_plan");
            } catch {}
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

    // ── Derived labels ─────────────────────────────────────────────────────
    const dirLabel = direction === "INWARD" ? "Inward" : "Outward";
    const typeLabel = planType === "ADMIN" ? "Manual Plan" : "AI Plan";

    const confirmBtnLabel = (() => {
        if (confirmLoading || actionLoading) return "Processing...";
        if (isPlanDemandStale) return "Plan Stale — Regenerate";
        if (isCurrentPlanActive) return "Plan Active & Confirmed";
        if (!activeMetrics.isAvailable && !isPendingMode) return "No Plan Generated";
        return "Approve & Activate Plan";
    })();

    // ── Allocated display value ─────────────────────────────────────────────
    const allocatedDisplay = (() => {
        if (activeMetrics.isActive) {
            return `${activeMetrics.allocated} / ${activeMetrics.students}`;
        }
        if (activeMetrics.isPendingApproval) {
            return "Pending Approval";
        }
        if (planType === "ADMIN") {
            return "Not Approved";
        }
        return "Not Allocated";
    })();

    const allocatedValueClass = (() => {
        if (activeMetrics.isActive) return "metric-value val-active";
        if (activeMetrics.isPendingApproval) return "metric-value val-pending";
        return "metric-value val-muted";
    })();

    return (
        <div className="final-plan-page">
            <div className="final-plan-container">

                {/* ── HEADER: Back button + Title + Subtitle ── */}
                <div className="plan-confirmation-header">
                    <div className="header-nav-row">
                        <button
                            type="button"
                            className="plan-back-btn"
                            onClick={handleBack}
                            disabled={actionLoading || confirmLoading}
                            aria-label="Go back to admin dashboard"
                        >
                            <LuArrowLeft size={16} />
                            Back
                        </button>
                    </div>
                    <div className="header-titles">
                        <h1 className="plan-main-title">FINAL PLAN CONFIRMATION</h1>
                        <p className="plan-subtitle">
                            Choose a transportation plan, review its details, and confirm the allocation.
                        </p>
                    </div>
                </div>

                {/* ── PLAN SELECTION CARD ── */}
                <div className="plan-selection-card">
                    <div className="selection-card-header">
                        <h2 className="selection-card-heading">Plan Selection</h2>
                        <span className="selection-card-icon" aria-hidden="true">
                            <LuSlidersHorizontal size={16} />
                        </span>
                    </div>

                    <div className="selection-controls-row">
                        {/* Group A — Direction */}
                        <div className="segmented-group">
                            <span className="segmented-label">Direction</span>
                            <div className="segmented-control" role="group" aria-label="Select direction">
                                <button
                                    type="button"
                                    className={`seg-btn${direction === "OUTWARD" ? " selected-dir" : ""}`}
                                    onClick={() => handleDirectionChange("OUTWARD")}
                                    aria-pressed={direction === "OUTWARD"}
                                >
                                    Outward
                                </button>
                                <button
                                    type="button"
                                    className={`seg-btn${direction === "INWARD" ? " selected-dir" : ""}`}
                                    onClick={() => handleDirectionChange("INWARD")}
                                    aria-pressed={direction === "INWARD"}
                                >
                                    Inward
                                </button>
                            </div>
                        </div>

                        {/* Group B — Plan Type */}
                        <div className="segmented-group">
                            <span className="segmented-label">Plan Type</span>
                            <div className="segmented-control" role="group" aria-label="Select plan type">
                                <button
                                    type="button"
                                    className={`seg-btn${planType === "AI" ? " selected-type" : ""}`}
                                    onClick={() => handlePlanTypeToggle("AI")}
                                    aria-pressed={planType === "AI"}
                                >
                                    AI Plan
                                </button>
                                <button
                                    type="button"
                                    className={`seg-btn${planType === "ADMIN" ? " selected-type" : ""}`}
                                    onClick={() => handlePlanTypeToggle("ADMIN")}
                                    aria-pressed={planType === "ADMIN"}
                                >
                                    Manual Plan
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── SELECTED TRANSPORTATION PLAN CARD ── */}
                {loading ? (
                    <div className="plan-summary-loading-card">
                        <div className="plan-spinner" aria-hidden="true" />
                        <p className="loading-text">Loading plan summary...</p>
                    </div>
                ) : (
                    <div className="selected-plan-card">
                        <div className="selected-card-header">
                            <div className="selected-card-title-group">
                                <span className="selected-card-eyebrow">Selected Transportation Plan</span>
                                <h2 className="selected-card-title">
                                    {dirLabel} · {typeLabel}
                                </h2>
                            </div>

                            {/* Status Badge */}
                            {isCurrentPlanActive && (
                                <span className="plan-status-badge badge-active">
                                    <LuCircleCheck size={12} />
                                    ACTIVE
                                </span>
                            )}
                            {!isCurrentPlanActive && activeMetrics.isPendingApproval && (
                                <span className="plan-status-badge badge-pending">
                                    PENDING APPROVAL
                                </span>
                            )}
                        </div>

                        {/* Five Metric Rows */}
                        <div className="plan-metrics-rows">
                            {/* Row 1 — Students */}
                            <div className="plan-metric-row">
                                <div className="metric-row-left">
                                    <span className="metric-icon-wrap" aria-hidden="true">
                                        <LuUsers size={15} />
                                    </span>
                                    <span className="metric-label">Students</span>
                                </div>
                                <span className="metric-value">{activeMetrics.students}</span>
                            </div>

                            {/* Row 2 — Routes */}
                            <div className="plan-metric-row">
                                <div className="metric-row-left">
                                    <span className="metric-icon-wrap" aria-hidden="true">
                                        <LuRoute size={15} />
                                    </span>
                                    <span className="metric-label">Routes</span>
                                </div>
                                <span className="metric-value">{activeMetrics.routes}</span>
                            </div>

                            {/* Row 3 — Vehicles */}
                            <div className="plan-metric-row">
                                <div className="metric-row-left">
                                    <span className="metric-icon-wrap" aria-hidden="true">
                                        <LuBus size={15} />
                                    </span>
                                    <span className="metric-label">Vehicles</span>
                                </div>
                                <span className="metric-value">{activeMetrics.vehicles}</span>
                            </div>

                            {/* Row 4 — Seats */}
                            <div className="plan-metric-row">
                                <div className="metric-row-left">
                                    <span className="metric-icon-wrap" aria-hidden="true">
                                        <LuArmchair size={15} />
                                    </span>
                                    <span className="metric-label">Seats</span>
                                </div>
                                <span className="metric-value">{activeMetrics.seats}</span>
                            </div>

                            {/* Row 5 — Allocated */}
                            <div className="plan-metric-row">
                                <div className="metric-row-left">
                                    <span className="metric-icon-wrap" aria-hidden="true">
                                        <LuUserCheck size={15} />
                                    </span>
                                    <span className="metric-label">Allocated</span>
                                </div>
                                <span className={allocatedValueClass}>{allocatedDisplay}</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* ── CONFIRM TRANSPORTATION PLAN CARD ── */}
                <div className="confirm-plan-card">
                    {/* Stale-Demand Warning */}
                    {isPlanDemandStale && (
                        <div className="confirm-stale-alert" role="alert">
                            <span className="stale-alert-icon" aria-hidden="true">
                                <LuTriangleAlert size={17} />
                            </span>
                            <div className="stale-alert-body">
                                <span className="stale-alert-title">Demand Changed — Regeneration Required</span>
                                <p className="stale-alert-desc">
                                    Student demand has changed since this plan was generated. This plan is stale and cannot be
                                    activated. Return to AI Agent to regenerate.
                                </p>
                            </div>
                        </div>
                    )}

                    <div className="confirm-card-content">
                        <div className="confirm-card-info">
                            <span className="confirm-icon-badge" aria-hidden="true">
                                <LuShieldCheck size={20} />
                            </span>
                            <div className="confirm-text-group">
                                <h2 className="confirm-heading">Confirm Transportation Plan</h2>
                                <p className="confirm-description">
                                    {isCurrentPlanActive
                                        ? "This plan is already active and confirmed."
                                        : "Approve and activate the selected plan to allocate students in the database."}
                                </p>
                            </div>
                        </div>

                        <div className="confirm-actions-group">
                            {/* Generate New Plan — only when no plan is available and not in pending mode */}
                            {!isPendingMode && !activeMetrics.isAvailable && (
                                <button
                                    type="button"
                                    className="btn-generate-plan"
                                    onClick={() => navigate(planType === "ADMIN" ? "/routes" : "/ai-agent")}
                                >
                                    <LuSparkles size={15} />
                                    Generate New Plan
                                </button>
                            )}

                            {/* Primary Approval Button */}
                            <button
                                type="button"
                                className={`btn-confirm-plan${isCurrentPlanActive ? " btn-is-active" : ""}`}
                                onClick={handleConfirm}
                                disabled={
                                    actionLoading ||
                                    confirmLoading ||
                                    isCurrentPlanActive ||
                                    isPlanDemandStale ||
                                    (!isPendingMode && !activeMetrics.isAvailable)
                                }
                                title={
                                    isPlanDemandStale
                                        ? "Cannot confirm: Plan is stale. Please regenerate."
                                        : !activeMetrics.isAvailable && !isPendingMode
                                        ? "No route generated yet for this direction."
                                        : ""
                                }
                            >
                                {(confirmLoading || actionLoading) && (
                                    <span className="btn-spinner" aria-hidden="true" />
                                )}
                                {isCurrentPlanActive && !confirmLoading && !actionLoading && (
                                    <LuCheck size={14} />
                                )}
                                {confirmBtnLabel}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Confirm Progress Full-Screen Overlay ── */}
            {confirmLoading && (
                <div className="confirm-progress-overlay" role="dialog" aria-modal="true" aria-label="Approval in progress">
                    <div className="confirm-progress-dialog">
                        <div className="confirm-spinner" aria-hidden="true" />
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
