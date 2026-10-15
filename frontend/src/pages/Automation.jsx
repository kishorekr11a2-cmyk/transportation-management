import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
    HiArrowLeft,
    HiArrowRight,
    HiPaperAirplane,
    HiCheckCircle,
    HiExclamationCircle,
    HiTruck,
    HiInformationCircle,
    HiExclamationTriangle,
    HiUsers,
    HiCheck,
    HiXMark
} from "react-icons/hi2";
import { toast } from "react-hot-toast";
import {
    triggerTravelStatusAutomation,
    getAllocationStatus,
    triggerAllocationDetailsAutomation
} from "../services/automationService";
import "../css/Automation.css";

function Automation() {
    const navigate = useNavigate();

    // Status state: "ready" | "sending" | "success" | "error"
    const [statusState, setStatusState] = useState("ready");
    const [statusMessage, setStatusMessage] = useState("Ready");
    const [activeAction, setActiveAction] = useState("");
    const [summary, setSummary] = useState(null);
    const [allocationReadiness, setAllocationReadiness] = useState(null);

    const fetchAllocationStatus = async () => {
        try {
            const res = await getAllocationStatus();
            if (res?.success) {
                setAllocationReadiness(res.data);
            }
        } catch (err) {
            console.warn("Could not load allocation readiness:", err);
        }
    };

    useEffect(() => {
        fetchAllocationStatus();
    }, []);

    // Send Travel Status Notification (Original flow)
    const handleSendTravelStatus = async () => {
        if (statusState === "sending") return;

        setActiveAction("travel-status");
        setStatusState("sending");
        setStatusMessage("Sending travel status notifications...");

        try {
            const res = await triggerTravelStatusAutomation();

            if (res?.success) {
                const data = res.data || {};
                setSummary(data);
                setStatusState("success");
                setStatusMessage("Travel status notifications sent successfully.");
                toast.success(res.message || "Travel status notifications sent successfully.");
            } else {
                const data = res?.data || null;
                if (data) setSummary(data);
                setStatusState("error");
                setStatusMessage(res?.message || "Failed to send travel status notifications.");
                toast.error(res?.message || "Failed to send travel status notifications.");
            }
        } catch (error) {
            console.error("Automation Webhook Error:", error);
            const errMsg =
                error?.response?.data?.message ||
                error?.message ||
                "Automation service is unavailable. Please make sure n8n is running.";
            setStatusState("error");
            setStatusMessage(errMsg);
            toast.error(errMsg);
        }
    };

    // Send Allocation Details (Strictly requires Approved + Allocated plan)
    const handleSendAllocationDetails = async () => {
        if (statusState === "sending") return;

        setActiveAction("allocation");
        setStatusState("sending");
        setStatusMessage(
            "Sending approved transportation allocation details..."
        );

        try {
            const res = await triggerAllocationDetailsAutomation();

            if (res?.success) {
                const data = res.data || {};
                setSummary(data);
                setStatusState("success");
                setStatusMessage(
                    "Transportation allocation details sent successfully."
                );
                toast.success(
                    res.message || "Allocation details sent successfully."
                );
            } else {
                const data = res?.data || null;
                if (data) setSummary(data);
                setStatusState("error");
                setStatusMessage(
                    res?.message || "Failed to send allocation details."
                );
                toast.error(
                    res?.message || "Failed to send allocation details."
                );
            }

            fetchAllocationStatus();
        } catch (error) {
            console.error("Allocation Details Send Error:", error);

            const errMsg =
                error?.response?.data?.message ||
                error?.message ||
                "Failed to send allocation details.";

            setStatusState("error");
            setStatusMessage(errMsg);
            toast.error(errMsg);

            fetchAllocationStatus();
        }
    };

    const isAllocationReady = Boolean(
        allocationReadiness?.canSendAllocation
    );

    return (
        <div className="automation-page">
            <div className="automation-page-shell">
                {/* ── Top Navigation Bar: Back Button ── */}
                <div className="automation-top-bar">
                    <button
                        type="button"
                        className="automation-back-btn"
                        onClick={() => navigate("/admin-dashboard")}
                        aria-label="Back to Admin Dashboard"
                    >
                        <HiArrowLeft size={16} />
                        Back
                    </button>
                </div>

                {/* ── TOP ILLUSTRATED BANNER CARD ── */}
                <header className="automation-banner">
                    <div className="automation-banner__content">
                        <span className="automation-banner__pill">WhatsApp & Automation Control</span>
                        <h1 className="automation-banner__title">Automation</h1>
                        <p className="automation-banner__desc">
                            Manage WhatsApp travel-status notifications and approved transportation allocation messages for registered students.
                        </p>
                    </div>
                </header>

                {/* ── SECTION 2: Action Status Bar ── */}
                <section className="automation-center-header" aria-label="Notification Center Control">
                    <div className="automation-center-header__left">
                        <h2 className="automation-center-title">WhatsApp Notification Center</h2>
                        <p className="automation-center-sub">
                            Choose a notification action to send transportation messages.
                        </p>
                    </div>

                    <div className="automation-center-header__right">
                        <div className="automation-header-status-box">
                            <span className="automation-status-tag">Action Status:</span>
                            {statusState === "ready" && (
                                <div className="automation-status-pill automation-status-pill--ready">
                                    <span className="automation-status-dot" />
                                    <span>Ready</span>
                                </div>
                            )}
                            {statusState === "sending" && (
                                <div className="automation-status-pill automation-status-pill--sending">
                                    <span className="automation-spinner-tiny" aria-hidden="true" />
                                    <span>Sending...</span>
                                </div>
                            )}
                            {statusState === "success" && (
                                <div className="automation-status-pill automation-status-pill--success">
                                    <HiCheckCircle size={15} />
                                    <span>Success</span>
                                </div>
                            )}
                            {statusState === "error" && (
                                <div className="automation-status-pill automation-status-pill--error">
                                    <HiExclamationCircle size={15} />
                                    <span>Error</span>
                                </div>
                            )}
                        </div>
                    </div>
                </section>

                {/* ── SECTION 3: Two Equal-Sized Gradient Action Cards (Style 1) ── */}
                <section className="automation-cards-grid" aria-label="Notification Actions">
                    {/* LEFT CARD — TRAVEL STATUS NOTIFICATION */}
                    <div className="automation-action-card automation-card--travel">
                        <div className="automation-card__top">
                            <div className="automation-card__icon-holder automation-icon--travel" aria-hidden="true">
                                <HiPaperAirplane size={20} />
                            </div>
                            <span className="automation-card__badge-label automation-badge--travel">
                                TRAVEL RESPONSES
                            </span>
                        </div>

                        <div className="automation-card__content">
                            <h3 className="automation-card__title">Travel Status Notification</h3>
                            <p className="automation-card__desc">
                                Send WhatsApp travel-status requests to registered students with valid phone numbers.
                            </p>

                            <div className="automation-card__info-box automation-info--travel">
                                <div className="automation-response-options">
                                    <span className="automation-chip automation-chip--coming">
                                        <HiCheck size={14} /> COMING
                                    </span>
                                    <span className="automation-chip automation-chip--not-coming">
                                        <HiXMark size={14} /> NOT COMING
                                    </span>
                                </div>
                                <p className="automation-card__info-text">
                                    Students can submit one valid travel response per reset cycle.
                                </p>
                            </div>
                        </div>

                        <div className="automation-card__bottom">
                            <button
                                type="button"
                                className="automation-pill-btn automation-btn--blue"
                                id="btn-send-travel-status"
                                onClick={handleSendTravelStatus}
                                disabled={statusState === "sending"}
                            >
                                <span className="automation-pill-btn__icon">
                                    <HiPaperAirplane size={18} />
                                </span>
                                <span className="automation-pill-btn__text">
                                    {statusState === "sending" && activeAction === "travel-status" ? (
                                        <>
                                            <span className="automation-spinner" aria-hidden="true" />
                                            Sending...
                                        </>
                                    ) : (
                                        "Send Travel Status"
                                    )}
                                </span>
                                <span className="automation-pill-btn__arrow">
                                    <HiArrowRight size={17} />
                                </span>
                            </button>
                        </div>
                    </div>

                    {/* RIGHT CARD — ALLOCATION DETAILS NOTIFICATION */}
                    <div className="automation-action-card automation-card--allocation">
                        <div className="automation-card__top">
                            <div className="automation-card__icon-holder automation-icon--allocation" aria-hidden="true">
                                <HiTruck size={20} />
                            </div>
                            <span className="automation-card__badge-label automation-badge--allocation">
                                APPROVED ALLOCATIONS
                            </span>
                        </div>

                        <div className="automation-card__content">
                            <h3 className="automation-card__title">Allocation Details Notification</h3>
                            <p className="automation-card__desc">
                                Send approved bus, route, direction, and stopping-area details to allocated students.
                            </p>

                            <div className={`automation-card__info-box ${isAllocationReady ? "automation-info--ready" : "automation-info--locked"}`}>
                                {isAllocationReady ? (
                                    <div className="automation-readiness-positive">
                                        <span className="automation-readiness-chip ready">
                                            <HiCheckCircle size={15} /> Ready to Dispatch
                                        </span>
                                        <p className="automation-card__info-text">
                                            {allocationReadiness?.reason || "Approved plan with allocated students ready for dispatch."}
                                        </p>
                                    </div>
                                ) : (
                                    <div className="automation-readiness-negative">
                                        <span className="automation-readiness-chip locked">
                                            <HiInformationCircle size={15} /> Prerequisites Pending
                                        </span>
                                        <p className="automation-card__info-text">
                                            Enabled only when an approved transportation plan exists and students have actually been allocated transportation.
                                            {allocationReadiness?.reason && (
                                                <span className="automation-readiness-reason">
                                                    {" "}({allocationReadiness.reason})
                                                </span>
                                            )}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="automation-card__bottom">
                            <button
                                type="button"
                                className="automation-pill-btn automation-btn--emerald"
                                id="btn-send-allocation-details"
                                onClick={handleSendAllocationDetails}
                                disabled={
                                    statusState === "sending" ||
                                    !isAllocationReady
                                }
                                title={
                                    !isAllocationReady
                                        ? "Disabled: Requires an Approved plan with Allocated students"
                                        : "Send confirmed bus and route details to allocated students"
                                }
                            >
                                <span className="automation-pill-btn__icon">
                                    <HiTruck size={18} />
                                </span>
                                <span className="automation-pill-btn__text">
                                    {statusState === "sending" &&
                                    activeAction === "allocation" ? (
                                        <>
                                            <span
                                                className="automation-spinner"
                                                aria-hidden="true"
                                            />
                                            Sending Details...
                                        </>
                                    ) : (
                                        "Send Allocation Details"
                                    )}
                                </span>
                                <span className="automation-pill-btn__arrow">
                                    <HiArrowRight size={17} />
                                </span>
                            </button>
                        </div>
                    </div>
                </section>



                {/* ── SECTION 5: Notification Status Panel ── */}
                <section className="automation-status-panel" aria-label="Notification Dispatch Status">
                    <div className="automation-status-panel__info">
                        <span className="automation-status-panel__label">Notification Status</span>
                        <p className="automation-status-panel__desc">
                            {statusMessage || "System is idle and ready to dispatch."}
                        </p>
                    </div>

                    <div className="automation-status-panel__badge">
                        {statusState === "ready" && (
                            <span className="automation-panel-pill ready">
                                <span className="automation-status-dot" />
                                Ready
                            </span>
                        )}
                        {statusState === "sending" && (
                            <span className="automation-panel-pill sending">
                                <span className="automation-spinner-tiny" aria-hidden="true" />
                                {activeAction === "allocation" ? "Dispatching Allocation..." : "Dispatching Travel Status..."}
                            </span>
                        )}
                        {statusState === "success" && (
                            <span className="automation-panel-pill success">
                                <HiCheckCircle size={16} />
                                Completed Successfully
                            </span>
                        )}
                        {statusState === "error" && (
                            <span className="automation-panel-pill error">
                                <HiExclamationCircle size={16} />
                                Dispatch Failed
                            </span>
                        )}
                    </div>
                </section>

                {/* ── SECTION 6: Conditional Execution Summary ── */}
                {summary && (
                    <section className="automation-summary-section" aria-label="Execution Summary">
                        <div className="automation-summary-header">
                            <h3 className="automation-summary-title">Execution Summary</h3>
                            <span className="automation-summary-sub">Results from latest dispatch cycle</span>
                        </div>
                        <div className="automation-summary-grid">
                            <div className="automation-stat-card automation-stat--total">
                                <div className="automation-stat-icon">
                                    <HiUsers size={20} />
                                </div>
                                <div className="automation-stat-info">
                                    <span className="automation-stat-label">Total Users</span>
                                    <span className="automation-stat-value">{summary.totalUsers ?? 0}</span>
                                </div>
                            </div>

                            {summary.totalAllocated !== undefined && (
                                <div className="automation-stat-card automation-stat--allocated">
                                    <div className="automation-stat-icon">
                                        <HiTruck size={20} />
                                    </div>
                                    <div className="automation-stat-info">
                                        <span className="automation-stat-label">Total Allocated</span>
                                        <span className="automation-stat-value">{summary.totalAllocated}</span>
                                    </div>
                                </div>
                            )}

                            <div className="automation-stat-card automation-stat--sent">
                                <div className="automation-stat-icon">
                                    <HiCheckCircle size={20} />
                                </div>
                                <div className="automation-stat-info">
                                    <span className="automation-stat-label">Messages Sent</span>
                                    <span className="automation-stat-value">{summary.sentCount ?? 0}</span>
                                </div>
                            </div>

                            <div className="automation-stat-card automation-stat--skipped">
                                <div className="automation-stat-icon">
                                    <HiExclamationTriangle size={20} />
                                </div>
                                <div className="automation-stat-info">
                                    <span className="automation-stat-label">Users Skipped</span>
                                    <span className="automation-stat-value">{summary.skippedCount ?? 0}</span>
                                </div>
                            </div>

                            <div className="automation-stat-card automation-stat--failed">
                                <div className="automation-stat-icon">
                                    <HiExclamationCircle size={20} />
                                </div>
                                <div className="automation-stat-info">
                                    <span className="automation-stat-label">Failed Messages</span>
                                    <span className="automation-stat-value">{summary.failedCount ?? 0}</span>
                                </div>
                            </div>
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
}

export default Automation;