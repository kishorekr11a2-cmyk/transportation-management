import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
    HiArrowLeft,
    HiPaperAirplane,
    HiCheckCircle,
    HiExclamationCircle,
    HiTruck
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
            {/* Header */}
            <header className="automation-header">
                <div className="automation-header__left">
                    <button
                        type="button"
                        className="automation-back-btn"
                        onClick={() => navigate("/admin-dashboard")}
                        aria-label="Go back to Dashboard"
                    >
                        <HiArrowLeft size={16} />
                        Back
                    </button>
                    <div>
                        <p className="automation-brand__label">Transportation Notification Automation</p>
                        <h1 className="automation-brand__title">Automation</h1>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="automation-container">
                <div className="automation-intro">
                    <h2 className="automation-intro__title">Transportation Notification Automation</h2>
                    <p className="automation-intro__sub">
                        Trigger automated travel status notifications for registered passengers via n8n.
                    </p>
                </div>

                <div className="automation-card">
                    <div className="automation-card__header">
                        <div className="automation-card__icon" aria-hidden="true">
                            <HiPaperAirplane size={22} />
                        </div>
                        <h3 className="automation-card__title">
                            Travel Status WhatsApp Notification
                        </h3>
                    </div>

                    <div className="automation-card__body">
                        <p className="automation-card__desc">
                            Send a WhatsApp message to users who have a phone number registered in the system.
                        </p>
                        <p className="automation-card__desc">
                            Users without a phone number will be skipped.
                        </p>

                        <div className="automation-card__note">
                            <strong>Note:</strong> Clicking <strong>Send Travel Status</strong> queries registered users, verifies each user's registered phone number, and dispatches individual travel status WhatsApp notifications via n8n.
                        </div>
                    </div>

                    {/* Actions Area */}
                    <div className="automation-card__actions">
                        <div className="automation-btn-actions-row">
                            {/* Original Send Travel Status Button */}
                            <button
                                type="button"
                                className="automation-btn-primary"
                                id="btn-send-travel-status"
                                onClick={handleSendTravelStatus}
                                disabled={statusState === "sending"}
                            >
                                {statusState === "sending" && activeAction === "travel-status" ? (
                                    <>
                                        <span className="automation-spinner" aria-hidden="true" />
                                        Sending...
                                    </>
                                ) : (
                                    "Send Travel Status"
                                )}
                            </button>

                            {/* Send Allocation Details Button */}
                            <button
                                type="button"
                                className="automation-btn-success"
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
                                    <>
                                        <HiTruck size={18} />
                                        Send Allocation Details
                                    </>
                                )}
                            </button>
                        </div>

                        {!isAllocationReady && (
                            <div className="automation-allocation-hint">
                                ℹ️{" "}
                                <strong>Send Allocation Details</strong> is
                                enabled only when an approved transportation
                                plan exists and students have actually been
                                allocated transportation.
                                {allocationReadiness?.reason && (
                                    <span>
                                        {" "}
                                        ({allocationReadiness.reason})
                                    </span>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Status feedback section */}
                    <div className="automation-status-box">
                        <span className="automation-status-label">Status:</span>

                        {statusState === "ready" && (
                            <div className="automation-status-pill automation-status-pill--ready">
                                <span className="automation-status-dot" />
                                <span>● {statusMessage}</span>
                            </div>
                        )}

                        {statusState === "sending" && (
                            <div className="automation-status-pill automation-status-pill--sending">
                                <span className="automation-status-dot" />
                                <span>{statusMessage}</span>
                            </div>
                        )}

                        {statusState === "success" && (
                            <div className="automation-status-pill automation-status-pill--success">
                                <HiCheckCircle size={16} />
                                <span>{statusMessage}</span>
                            </div>
                        )}

                        {statusState === "error" && (
                            <div className="automation-status-pill automation-status-pill--error">
                                <HiExclamationCircle size={16} />
                                <span>{statusMessage}</span>
                            </div>
                        )}
                    </div>

                    {/* Summary metrics display */}
                    {summary && (
                        <div className="automation-summary-card">
                            <h4 className="automation-summary-title">Execution Summary</h4>
                            <div className="automation-summary-grid">
                                <div className="automation-stat-box">
                                    <span className="automation-stat-label">Total Users</span>
                                    <span className="automation-stat-value">{summary.totalUsers ?? 0}</span>
                                </div>
                                {summary.totalAllocated !== undefined && (
                                    <div className="automation-stat-box">
                                        <span className="automation-stat-label">Total Allocated</span>
                                        <span className="automation-stat-value">{summary.totalAllocated}</span>
                                    </div>
                                )}
                                <div className="automation-stat-box automation-stat-box--success">
                                    <span className="automation-stat-label">Messages Sent</span>
                                    <span className="automation-stat-value">{summary.sentCount ?? 0}</span>
                                </div>
                                <div className="automation-stat-box automation-stat-box--warning">
                                    <span className="automation-stat-label">Users Skipped (No Phone)</span>
                                    <span className="automation-stat-value">{summary.skippedCount ?? 0}</span>
                                </div>
                                <div className="automation-stat-box automation-stat-box--danger">
                                    <span className="automation-stat-label">Failed Messages</span>
                                    <span className="automation-stat-value">{summary.failedCount ?? 0}</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}

export default Automation;