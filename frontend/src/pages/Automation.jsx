import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { HiArrowLeft, HiPaperAirplane, HiCheckCircle, HiExclamationCircle } from "react-icons/hi2";
import { toast } from "react-hot-toast";
import { triggerTravelStatusAutomation } from "../services/automationService";
import "../css/Automation.css";

function Automation() {
    const navigate = useNavigate();

    // Status state: "ready" | "sending" | "success" | "error"
    const [statusState, setStatusState] = useState("ready");
    const [statusMessage, setStatusMessage] = useState("Ready");
    const [summary, setSummary] = useState(null);

    const handleSendTravelStatus = async () => {
        if (statusState === "sending") return;

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
                            <strong>Note:</strong> Clicking the button queries registered users, verifies each user's registered phone number, and dispatches individual travel status WhatsApp notifications via n8n.
                        </div>
                    </div>

                    <div className="automation-card__actions">
                        <button
                            type="button"
                            className="automation-btn-primary"
                            id="btn-send-travel-status"
                            onClick={handleSendTravelStatus}
                            disabled={statusState === "sending"}
                        >
                            {statusState === "sending" ? (
                                <>
                                    <span className="automation-spinner" aria-hidden="true" />
                                    Sending...
                                </>
                            ) : (
                                "Send Travel Status"
                            )}
                        </button>
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
