import React from "react";
import { FiAlertTriangle, FiX } from "react-icons/fi";

export default function ResetManualAllocationModal({
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
                        <h2>Reset Manual Plan Allocations?</h2>
                        <span className="ai-modal-subtitle">
                            Confirmation required before clearing {dirLabel ? `${dirLabel.toLowerCase()} ` : ""}user bus allocations
                        </span>
                    </div>
                </div>

                {/* Modal Body */}
                <div className="ai-modal-body">
                    <p className="ai-modal-lead" style={{ fontWeight: "600", color: "#1e293b", marginBottom: "14px" }}>
                        Are you sure you want to remove all manual plan allocations? This will not delete your manual routes or affect the AI plan.
                    </p>

                    <div className="ai-modal-safe-callout" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "12px 14px", borderRadius: "8px", marginBottom: "14px" }}>
                        <span className="safe-badge" style={{ color: "#16a34a", fontWeight: "700", fontSize: "12px", display: "block", marginBottom: "4px" }}>✓ SAFE ACTION — ROUTES &amp; AI PROTECTED</span>
                        <p style={{ margin: 0, fontSize: "12px", color: "#166534", lineHeight: "1.5" }}>
                            <strong>Manual routes, stopping areas, vehicle fleet capacities, and AI-generated plans will remain completely unchanged.</strong>
                        </p>
                    </div>

                    <p className="ai-modal-note" style={{ fontSize: "12px", color: "#64748b", margin: 0 }}>
                        Student travel responses (Coming / Not Coming / Pending) remain preserved in the database.
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
                        {isResetting ? "Resetting Allocations..." : "Reset Manual Plan Allocation"}
                    </button>
                </div>
            </div>
        </div>
    );
}
