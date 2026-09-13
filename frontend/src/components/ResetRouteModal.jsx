import { FiAlertTriangle, FiX } from "react-icons/fi";

export default function ResetRouteModal({
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
                >
                    <FiX />
                </button>

                {/* Modal Header */}
                <div className="ai-modal-header">
                    <div className="ai-modal-icon-wrap">
                        <FiAlertTriangle />
                    </div>
                    <div>
                        <h2>Reset {dirLabel ? `${dirLabel} ` : ""}AI Generated Route?</h2>
                        <span className="ai-modal-subtitle">
                            Confirmation required before clearing {dirLabel ? `${dirLabel.toLowerCase()} ` : ""}recommendation
                        </span>
                    </div>
                </div>

                {/* Modal Body */}
                <div className="ai-modal-body">
                    <p className="ai-modal-lead">
                        This will remove the currently generated {dirLabel ? `${dirLabel} ` : ""}AI recommendation and associated student allocations. {dirLabel ? `The opposite direction (if independently approved) remains completely untouched.` : ""}
                    </p>
                    <div className="ai-modal-safe-callout">
                        <span className="safe-badge">✓ SAFE ACTION</span>
                        <p>
                            <strong>Manual administrator routes will not be affected.</strong> Manual routes configured in Route Management remain completely intact.
                        </p>
                    </div>
                    <p className="ai-modal-note">
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
                    >
                        {isResetting ? "Resetting AI Route..." : "Reset AI Route"}
                    </button>
                </div>
            </div>
        </div>
    );
}
