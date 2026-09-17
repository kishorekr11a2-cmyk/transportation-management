import React from "react";
import { FiAlertTriangle, FiX } from "react-icons/fi";

export default function ResetManualPlanModal({
    isOpen,
    onClose,
    onConfirm,
    isResetting = false,
    direction = null
}) {
    if (!isOpen) return null;

    const dirLabel = direction === "OUTWARD" ? "Outward" : direction === "INWARD" ? "Inward" : "";

    return (
        <div
            className="ai-modal-overlay"
            onClick={() => !isResetting && onClose()}
        >
            <div
                className="ai-modal-card"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Close X */}
                <button
                    type="button"
                    className="ai-modal-close-icon"
                    onClick={() => !isResetting && onClose()}
                    disabled={isResetting}
                    aria-label="Close modal"
                >
                    <FiX />
                </button>

                {/* Modal Header */}
                <div className="ai-modal-header">
                    <div className="ai-modal-icon-wrap" style={{ background: "#fef2f2", color: "#dc2626" }}>
                        <FiAlertTriangle />
                    </div>
                    <div>
                        <h2>Reset Admin Manual Route Plan?</h2>
                        <span className="ai-modal-subtitle">
                            Confirmation required before clearing {dirLabel ? `${dirLabel.toLowerCase()} ` : ""}manual plan and bus allocations
                        </span>
                    </div>
                </div>

                {/* Modal Body */}
                <div className="ai-modal-body">
                    <p className="ai-modal-lead" style={{ fontWeight: "600", color: "#1e293b", marginBottom: "14px" }}>
                        Are you sure you want to reset the Admin Manual Route Plan? This will clear all manual bus allocations and approval status.
                    </p>

                    {dirLabel && (
                        <p style={{ fontSize: "13px", color: "#475569", marginBottom: "14px", lineHeight: "1.5" }}>
                            Only the <strong>{dirLabel}</strong> manual transportation plan and its student bus allocations will be reset. The opposite direction will remain completely untouched.
                        </p>
                    )}

                    <div className="ai-modal-safe-callout" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "12px 14px", borderRadius: "8px", marginBottom: "14px" }}>
                        <span className="safe-badge" style={{ color: "#16a34a", fontWeight: "700", fontSize: "12px", display: "block", marginBottom: "4px" }}>✓ SAFE ACTION — DATA PROTECTED</span>
                        <p style={{ margin: 0, fontSize: "12px", color: "#166534", lineHeight: "1.5" }}>
                            <strong>Master user records, vehicle fleet capacities, saved routes in Route Management, and AI-generated plans will NOT be affected.</strong>
                        </p>
                    </div>

                    <p className="ai-modal-note" style={{ fontSize: "12px", color: "#64748b", margin: 0 }}>
                        Student travel responses (Coming / Not Coming) will remain preserved in the database.
                    </p>
                </div>

                {/* Modal Actions */}
                <div className="ai-modal-actions">
                    <button
                        type="button"
                        className="ai-modal-btn cancel-btn"
                        onClick={onClose}
                        disabled={isResetting}
                    >
                        Cancel
                    </button>

                    <button
                        type="button"
                        className="ai-modal-btn reset-btn"
                        onClick={onConfirm}
                        disabled={isResetting}
                        style={{
                            background: "#dc2626",
                            borderColor: "#dc2626",
                            color: "#ffffff"
                        }}
                    >
                        {isResetting ? "Resetting Manual Plan..." : "Reset Manual Plan"}
                    </button>
                </div>
            </div>
        </div>
    );
}
