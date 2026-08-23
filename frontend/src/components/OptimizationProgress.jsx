import { FiCheck } from "react-icons/fi";

const DEFAULT_STAGES = [
    {
        id: 1,
        title: "Demand Analysis",
        subtitle: "Identifies Coming users & calculates total demand"
    },
    {
        id: 2,
        title: "Stopping Area Analysis",
        subtitle: "Groups users by stops & identifies density clusters"
    },
    {
        id: 3,
        title: "Vehicle Capacity Analysis",
        subtitle: "Reads available vehicles and verifies their actual seat capacities"
    },
    {
        id: 4,
        title: "Road Network Optimization",
        subtitle: "Builds continuous paths & applies 2-Opt road progression"
    },
    {
        id: 5,
        title: "Route Consolidation",
        subtitle: "Combines compatible stops & eliminates duplicate routes"
    },
    {
        id: 6,
        title: "Final Validation",
        subtitle: "Verifies 100% demand coverage, capacity & continuity"
    }
];

export default function OptimizationProgress({
    currentStage = 1,
    isCompleted = false,
    stages = DEFAULT_STAGES
}) {
    return (
        <div className="optimization-progress-container">
            <div className="progress-header-row">
                <span className="pipeline-title">OPTIMIZATION PIPELINE</span>
                <span className="pipeline-step-count">
                    {isCompleted
                        ? "Completed (6 / 6 Stages)"
                        : `Stage ${Math.min(currentStage, stages.length)} of ${stages.length}`}
                </span>
            </div>

            <div className="pipeline-stepper">
                {stages.map((stage, idx) => {
                    const stageNumber = idx + 1;
                    const isDone = isCompleted || stageNumber < currentStage;
                    const isActive = !isCompleted && stageNumber === currentStage;
                    const isPending = !isCompleted && stageNumber > currentStage;

                    return (
                        <div
                            key={stage.id}
                            className={`stepper-item ${
                                isDone
                                    ? "completed"
                                    : isActive
                                    ? "active"
                                    : "pending"
                            }`}
                        >
                            {/* Step Indicator Dot / Icon */}
                            <div className="stepper-indicator">
                                {isDone ? (
                                    <span className="indicator-icon done">
                                        <FiCheck />
                                    </span>
                                ) : isActive ? (
                                    <span className="indicator-icon active">
                                        <span className="active-pulse-dot"></span>
                                    </span>
                                ) : (
                                    <span className="indicator-icon pending">
                                        {stageNumber}
                                    </span>
                                )}

                                {idx < stages.length - 1 && (
                                    <div
                                        className={`connector-line ${
                                            isDone ? "connector-done" : ""
                                        }`}
                                    />
                                )}
                            </div>

                            {/* Step Content */}
                            <div className="stepper-content">
                                <div className="stepper-title-row">
                                    <strong className="stage-title">
                                        {stage.title}
                                    </strong>
                                    {isActive && (
                                        <span className="processing-tag">
                                            Processing...
                                        </span>
                                    )}
                                    {isDone && (
                                        <span className="verified-tag">
                                            Verified
                                        </span>
                                    )}
                                </div>
                                <p className="stage-desc">{stage.subtitle}</p>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
