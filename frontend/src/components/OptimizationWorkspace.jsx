import { FiUsers, FiTruck, FiMapPin, FiActivity } from "react-icons/fi";
import OptimizationProgress from "./OptimizationProgress";
import OptimizationStatCard from "./OptimizationStatCard";

export default function OptimizationWorkspace({
    currentStage = 1,
    statusMessage = "Analyzing confirmed demand...",
    summary = {},
    sourceName = "",
    destinationName = "",
    tripMode = "FROM_SOURCE"
}) {
    const confirmedDemand = Number(
        summary?.confirmedUsers ??
        summary?.confirmedUserCount ??
        summary?.comingUsers ??
        0
    );

    const availableVehicleCount = Number(
        summary?.availableVehicles ??
        summary?.availableVehicleCount ??
        0
    );

    const stoppingAreaCount = Number(
        summary?.uniqueStoppingAreas ??
        summary?.stoppingAreas ??
        summary?.stopCount ??
        0
    );

    const isOutward = tripMode === "FROM_SOURCE" || tripMode === "OUTWARD" || (sourceName && !destinationName);

    return (
        <div className="optimization-workspace-card">
            {/* Header */}
            <div className="opt-workspace-header">
                <div className="opt-badge-row">
                    <span className="opt-engine-tag">
                        AI ROUTE OPTIMIZATION
                    </span>
                    <span className="opt-engine-subtag">
                        Transportation Optimization Engine
                    </span>
                </div>
            </div>

            {/* Core Visualizer & Engine Status */}
            <div className="opt-engine-center">
                <div className="ai-engine-visualizer">
                    <div className="engine-orbit ring-3"></div>
                    <div className="engine-orbit ring-2"></div>
                    <div className="engine-orbit ring-1"></div>
                    <div className="engine-radar-sweep"></div>
                    <div className="engine-core">
                        <div className="engine-core-inner">
                            <FiActivity className="engine-pulse-icon" />
                        </div>
                    </div>
                </div>

            <div className="opt-engine-titles">
                <h2>Optimizing Transportation Network</h2>
                <p className="opt-engine-subtext">
                    {isOutward
                        ? "Analyzing demand, stops, vehicles and outward road continuity..."
                        : "Analyzing demand, stops, vehicles and inward road continuity..."}
                </p>

                {(sourceName || destinationName) && (
                    <div className="opt-corridor-pill">
                        <span className="corridor-dot"></span>
                        <span>
                            Corridor:{" "}
                            {isOutward ? (
                                <>
                                    <strong>{sourceName || "Configured Source"}</strong> →{" "}
                                    <strong>Residential Drop-off Network</strong>
                                </>
                            ) : (
                                <>
                                    <strong>Residential Pickup Network</strong> →{" "}
                                    <strong>{destinationName || "Configured Destination"}</strong>
                                </>
                            )}
                        </span>
                    </div>
                )}
            </div>

            {/* Dynamic Status Message Box */}
            <div className="opt-dynamic-status-box">
                <div className="dynamic-status-pulse"></div>
                <span className="dynamic-status-text">{statusMessage}</span>
            </div>
        </div>

        {/* Live Data Summary Cards */}
        <div className="opt-live-summary-grid">
            <OptimizationStatCard
                icon={<FiUsers />}
                value={confirmedDemand}
                label="Coming Users"
                subtitle="Confirmed Demand"
                variant="demand"
            />

            <OptimizationStatCard
                icon={<FiTruck />}
                value={availableVehicleCount}
                label="Available Vehicles"
                subtitle="Eligible Fleet"
                variant="fleet"
            />

            <OptimizationStatCard
                icon={<FiMapPin />}
                value={stoppingAreaCount}
                label="Stopping Areas"
                subtitle="Mapped Locations"
                variant="stops"
            />

            <OptimizationStatCard
                icon={<FiActivity />}
                value="100%"
                label="Demand Loaded"
                subtitle="Active Verification"
                variant="status"
            />
        </div>

            {/* 6-Stage Optimization Stepper */}
            <div className="opt-pipeline-section">
                <OptimizationProgress
                    currentStage={currentStage}
                    isCompleted={false}
                />
            </div>
        </div>
    );
}
