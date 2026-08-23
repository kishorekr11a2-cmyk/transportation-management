import { FiAlertTriangle, FiX } from "react-icons/fi";

export default function ResetRouteModal({
    isOpen,
    onClose,
    onConfirm,
    isResetting = false
}) {
    if (!isOpen) return null;

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
                        <h2>Reset AI Generated Route?</h2>
                        <span className="ai-modal-subtitle">
                            Confirmation required before clearing recommendation
                        </span>
                    </div>
                </div>

                {/* Modal Body */}
                <div className="ai-modal-body">
                    <p className="ai-modal-lead">
                        This will remove the currently generated AI recommendation.
                    </p>
                    <div className="ai-modal-safe-callout">
                        <span className="safe-badge">✓ SAFE ACTION</span>
                        <p>
                            <strong>Manual administrator routes will not be affected.</strong> Manual routes configured in Route Management remain completely intact.
                        </p>
                    </div>
                    <p className="ai-modal-note">
                        Student travel responses will reset to <em>Pending</em> so passengers can confirm their travel status for the next trip.
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
