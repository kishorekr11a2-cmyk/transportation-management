import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import {
    getAIData,
    generateRecommendations,
    getActivePlan,
    resetAIPlan,
    getManualRoutes,
    saveSelectedPlan,
    getSelectedPlan
} from "../services/aiAgentService";
import LocationSearchBox from "../components/LocationSearchBox";
import "../css/AIAgent.css";

const formatNumber = (value) =>
    Number(value || 0).toLocaleString();

const getCoordinates = (location) => {
    const latitude = Number(
        location?.latitude ?? location?.lat
    );

    const longitude = Number(
        location?.longitude ??
        location?.lng ??
        location?.lon
    );

    return {
        latitude,
        longitude
    };
};

const hasValidCoordinates = (location) => {
    const { latitude, longitude } =
        getCoordinates(location);

    return (
        Number.isFinite(latitude) &&
        Number.isFinite(longitude) &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180 &&
        !(latitude === 0 && longitude === 0)
    );
};

const getBusCapacity = (bus) =>
    Number(
        bus?.capacity ??
        bus?.seatCapacity ??
        bus?.seats ??
        bus?.totalSeats ??
        0
    );

const getBusName = (bus, index = 0) =>
    bus?.vehicleName ||
    bus?.name ||
    bus?.busName ||
    `Bus ${index + 1}`;

const getAIStopUsers = (stop) =>
    Number(
        stop?.userCount ??
        stop?.users?.length ??
        stop?.users ??
        0
    );

const getManualRoutePoints = (route) => {
    const points = [];

    if (route?.source) {
        points.push({
            ...route.source,
            routePointType: "source"
        });
    }

    if (Array.isArray(route?.stops)) {
        route.stops.forEach((stop) => {
            points.push({
                ...stop,
                routePointType: "stop"
            });
        });
    }

    if (route?.destination) {
        points.push({
            ...route.destination,
            routePointType: "destination"
        });
    }

    return points;
};

const normalizeManualRoutes = (response) => {
    if (Array.isArray(response)) {
        return response;
    }

    if (Array.isArray(response?.routes)) {
        return response.routes;
    }

    if (Array.isArray(response?.data)) {
        return response.data;
    }

    if (Array.isArray(response?.data?.routes)) {
        return response.data.routes;
    }

    return [];
};

export default function AIAgent() {
    const [data, setData] = useState(null);

    // Source = buses leave from here
    const [sourceLocation, setSourceLocation] =
        useState(null);

    // Destination = buses arrive here
    const [destinationLocation, setDestinationLocation] =
        useState(null);

    // Legacy alias for backward compatibility
    const selectedLocation =
        destinationLocation || sourceLocation;

    const [generating, setGenerating] =
        useState(false);

    const [generationError, setGenerationError] =
        useState("");

    const [planData, setPlanData] =
        useState(null);

    const [selectedPlanType, setSelectedPlanType] =
        useState("");

    const [savingSelection, setSavingSelection] =
        useState(false);

    const [selectionMessage, setSelectionMessage] =
        useState("");

    const [lastSelection, setLastSelection] =
        useState(null);

    const [showResetModal, setShowResetModal] =
        useState(false);

    const [resetting, setResetting] =
        useState(false);

    const [resetSuccessMessage, setResetSuccessMessage] =
        useState("");

    const [manualRoutes, setManualRoutes] =
        useState([]);

    const [manualRoutesLoading, setManualRoutesLoading] =
        useState(true);

    const [loading, setLoading] =
        useState(true);

    useEffect(() => {
        loadPageData();
    }, []);

    const loadPageData = async () => {
        await Promise.all([
            loadAIData(),
            loadActivePlan(),
            loadLastSelection(),
            loadManualRoutes()
        ]);

        setLoading(false);
    };

    const loadAIData = async () => {
        try {
            const response = await getAIData();
            setData(response);
        } catch (error) {
            console.error(
                "Unable to load AI data:",
                error
            );
        }
    };

    const loadActivePlan = async () => {
        try {
            const response = await getActivePlan();

            if (
                response?.success &&
                response?.active &&
                response?.plan
            ) {
                const plan = response.plan;

                setPlanData(plan);

                if (
                    plan.source &&
                    hasValidCoordinates(plan.source)
                ) {
                    setSourceLocation(plan.source);
                }

                if (
                    plan.destination &&
                    hasValidCoordinates(
                        plan.destination
                    )
                ) {
                    setDestinationLocation(
                        plan.destination
                    );
                } else if (
                    plan.startingPoint &&
                    hasValidCoordinates(
                        plan.startingPoint
                    ) &&
                    !plan.source
                ) {
                    setDestinationLocation(
                        plan.startingPoint
                    );
                }
            } else {
                setPlanData(null);
            }
        } catch (error) {
            console.error(
                "Unable to load active AI plan:",
                error
            );

            setPlanData(null);
        }
    };

    const loadManualRoutes = async () => {
        try {
            setManualRoutesLoading(true);

            const response = await getManualRoutes();

            const routes =
                normalizeManualRoutes(response);

            setManualRoutes(routes);
        } catch (error) {
            console.error(
                "Unable to load manual routes:",
                error
            );

            setManualRoutes([]);
        } finally {
            setManualRoutesLoading(false);
        }
    };

    const loadLastSelection = async () => {
        try {
            const response =
                await getSelectedPlan();

            if (
                response?.success &&
                response?.selection
            ) {
                setLastSelection(
                    response.selection
                );

                setSelectedPlanType(
                    response.selection.planType
                );
            }
        } catch (error) {
            console.error(
                "Unable to load selected plan:",
                error
            );
        }
    };

    const handleGenerateAIPlan = async () => {
        const comingCount = Number(
            data?.confirmedUserCount ??
            data?.comingUsers ??
            (planData
                ? planData.summary?.confirmedUsers
                : 0)
        );

        /*
         * IMPORTANT:
         * If demand is 0, do NOT generate any route.
         * This check happens before Source/Destination validation.
         */
        if (comingCount === 0) {
            const zeroDemandMsg =
                "No Coming students available. Students must confirm their travel status before an AI route can be generated.";

            setGenerationError(
                zeroDemandMsg
            );

            toast.error(
                "No Coming students available. No transportation route can be generated."
            );

            return;
        }

        const hasSource =
            sourceLocation &&
            hasValidCoordinates(
                sourceLocation
            );

        const hasDestination =
            destinationLocation &&
            hasValidCoordinates(
                destinationLocation
            );

        if (!hasSource && !hasDestination) {
            setGenerationError(
                "Please select a Source (leave from here) or a Destination (arrive here)."
            );

            return;
        }

        try {
            setGenerating(true);
            setGenerationError("");
            setSelectionMessage("");
            setResetSuccessMessage("");

            let tripMode = "INWARD";

            if (
                hasSource &&
                !hasDestination
            ) {
                tripMode = "OUTWARD";
            } else if (
                hasSource &&
                hasDestination
            ) {
                tripMode =
                    "SOURCE_TO_DESTINATION";
            }

            const payload = {
                tripMode,

                ...(hasSource
                    ? {
                        source:
                            sourceLocation
                    }
                    : {}),

                ...(hasDestination
                    ? {
                        destination:
                            destinationLocation
                    }
                    : {})
            };

            const response =
                await generateRecommendations(
                    payload
                );

            if (!response?.success) {
                throw new Error(
                    response?.message ||
                    "Unable to generate AI plan."
                );
            }

            setPlanData(response);
            setSelectedPlanType("");

            toast.success(
                "AI route plan generated and saved successfully."
            );

            await loadAIData();
        } catch (error) {
            console.error(
                "AI plan generation error:",
                error
            );

            setPlanData(null);

            setGenerationError(
                error?.response?.data?.message ||
                error?.message ||
                "Unable to generate AI route plan."
            );
        } finally {
            setGenerating(false);
        }
    };

    const handleConfirmReset = async () => {
        try {
            setResetting(true);

            const response =
                await resetAIPlan();

            if (response?.success) {
                setPlanData(null);
                setSourceLocation(null);
                setDestinationLocation(null);
                setSelectedPlanType("");
                setLastSelection(null);
                setGenerationError("");
                setSelectionMessage("");
                setShowResetModal(false);

                const msg =
                    "AI route reset successfully. Student travel responses have been reset to Pending.";

                setResetSuccessMessage(msg);

                toast.success(msg);

                await loadAIData();
            } else {
                throw new Error(
                    response?.message ||
                    "Unable to reset AI transportation plan."
                );
            }
        } catch (error) {
            console.error(
                "Reset AI Plan Error:",
                error
            );

            toast.error(
                error?.response?.data?.message ||
                error?.message ||
                "Failed to reset AI route."
            );
        } finally {
            setResetting(false);
        }
    };

    const handleSelectAIPlan = () => {
        if (!planData?.aiPlan) {
            return;
        }

        setSelectedPlanType("AI");
        setSelectionMessage("");
    };

    const handleSelectAdminPlan = () => {
        if (!manualRoutes.length) {
            return;
        }

        setSelectedPlanType("ADMIN");
        setSelectionMessage("");
    };

    const handleSaveFinalPlan = async () => {
        if (!selectedPlanType) {
            return;
        }

        const selectedPlan =
            selectedPlanType === "AI"
                ? planData?.aiPlan || null
                : {
                    routes: manualRoutes
                };

        if (!selectedPlan) {
            return;
        }

        try {
            setSavingSelection(true);
            setSelectionMessage("");

            const response =
                await saveSelectedPlan({
                    planType: selectedPlanType,
                    plan: selectedPlan,
                    startingPoint:
                        planData?.startingPoint ||
                        selectedLocation ||
                        null
                });

            if (response?.success) {
                setLastSelection(
                    response.selection
                );

                setSelectionMessage(
                    "Final transportation plan confirmed and saved successfully!"
                );
            } else {
                throw new Error(
                    response?.message ||
                    "Unable to save final plan."
                );
            }
        } catch (error) {
            console.error(
                "Final plan selection error:",
                error
            );

            setSelectionMessage(
                error?.response?.data?.message ||
                error?.message ||
                "Unable to save final plan."
            );
        } finally {
            setSavingSelection(false);
        }
    };

    const summary = planData?.summary || {
        totalUsers:
            data?.userCount ||
            data?.totalUsers ||
            0,

        confirmedUsers:
            data?.confirmedUserCount ||
            data?.comingUsers ||
            data?.confirmedUsers ||
            0,

        vehicles:
            data?.vehicleCount ||
            data?.vehicles?.length ||
            0,

        routes:
            data?.routeCount ||
            data?.routes?.length ||
            0,

        schedules:
            data?.scheduleCount ||
            data?.schedules?.length ||
            0,

        stoppingAreas:
            data?.stopCount ||
            data?.stops?.length ||
            0
    };

    const aiPlan = planData?.aiPlan;

    const aiAssigned =
        Number(aiPlan?.assignedUsers || 0);

    const aiUnassigned =
        Number(aiPlan?.unassignedUsers || 0);

    const aiCapacity =
        Number(aiPlan?.totalCapacity || 0);

    const aiAvailableCapacity =
        Number(
            aiPlan?.availableTotalCapacity || 0
        );

    const aiUtilization =
        Number(aiPlan?.utilization || 0);

    const aiBuses =
        Array.isArray(aiPlan?.buses)
            ? aiPlan.buses
            : [];

    const totalAIStops =
        Number(
            aiPlan?.totalRouteStopVisits || 0
        ) ||
        aiBuses.reduce(
            (total, bus) =>
                total +
                (Array.isArray(bus?.stops)
                    ? bus.stops.length
                    : 0),
            0
        );

    if (loading) {
        return (
            <div className="ai-page">
                <div className="ai-loading">
                    <span className="spinner"></span>
                    Loading saved AI plan...
                </div>
            </div>
        );
    }

    return (
        <div className="ai-page">

            {/* Header */}
            <div className="ai-header">
                <div>
                    <span className="ai-header-label">
                        AI TRANSPORTATION ENGINE
                    </span>

                    <h1>
                        AI Route Optimization
                    </h1>

                    <p>
                        The AI Agent independently
                        generates optimized,
                        continuous road routes
                        using confirmed Coming users,
                        stopping areas, vehicle
                        capacities, and schedule
                        availability. Map
                        visualization is managed in
                        Route Management, and the
                        administrator makes the final
                        decision.
                    </p>
                </div>

                <div className="ai-header-actions">
                    <div className="ai-ready">
                        <span className="ready-dot"></span>
                        AI Engine Ready
                    </div>

                    <button
                        type="button"
                        className="reset-ai-route-btn"
                        onClick={() =>
                            setShowResetModal(true)
                        }
                        title="Reset AI Generated Route and all student responses for the next trip"
                    >
                        🔄 Reset AI Generated Route
                    </button>
                </div>
            </div>

            {/* Reset Success Message Banner */}
            {resetSuccessMessage && (
                <div className="reset-success-banner">
                    <span className="banner-icon">
                        ✓
                    </span>

                    <div className="banner-text">
                        <strong>
                            AI Route Reset Complete
                        </strong>

                        <p>
                            {resetSuccessMessage}
                        </p>
                    </div>

                    <button
                        type="button"
                        className="banner-close"
                        onClick={() =>
                            setResetSuccessMessage("")
                        }
                    >
                        ×
                    </button>
                </div>
            )}

            {/* Top Statistics */}
            <section className="summary-grid">

                <div className="summary-card">
                    <span>👥</span>
                    <div>
                        <strong>
                            {formatNumber(
                                summary.totalUsers
                            )}
                        </strong>
                        <small>
                            Total Users
                        </small>
                    </div>
                </div>

                <div className="summary-card coming">
                    <span>🟢</span>
                    <div>
                        <strong>
                            {formatNumber(
                                summary.confirmedUsers
                            )}
                        </strong>
                        <small>
                            Coming Users (Demand)
                        </small>
                    </div>
                </div>

                <div className="summary-card">
                    <span>🚌</span>
                    <div>
                        <strong>
                            {formatNumber(
                                summary.vehicles
                            )}
                        </strong>
                        <small>
                            Vehicles
                        </small>
                    </div>
                </div>

                <div className="summary-card">
                    <span>🛣️</span>
                    <div>
                        <strong>
                            {formatNumber(
                                summary.routes
                            )}
                        </strong>
                        <small>
                            Stored Routes
                        </small>
                    </div>
                </div>

                <div className="summary-card">
                    <span>📅</span>
                    <div>
                        <strong>
                            {formatNumber(
                                summary.schedules
                            )}
                        </strong>
                        <small>
                            Schedules
                        </small>
                    </div>
                </div>

                <div className="summary-card">
                    <span>📍</span>
                    <div>
                        <strong>
                            {formatNumber(
                                summary.uniqueStoppingAreas ||
                                summary.stoppingAreas
                            )}
                        </strong>
                        <small>
                            Unique Stopping Areas
                        </small>
                    </div>
                </div>

            </section>

            {/* Section 1 */}
            <section className="ai-section">

                <div className="section-number">
                    01
                </div>

                <div className="section-content">

                    <div className="section-heading">
                        <h2>
                            Trip Route: Source &amp;
                            Destination
                        </h2>

                        <p>
                            Set the{" "}
                            <strong>
                                Source
                            </strong>{" "}
                            (where buses leave from —
                            residential zones, depots,
                            or townships) and the{" "}
                            <strong>
                                Destination
                            </strong>{" "}
                            (where buses arrive — your
                            college, school, or
                            institution). The AI
                            generates routes to bring
                            all Coming students to the
                            Destination hub.
                        </p>
                    </div>

                    {/* SOURCE */}
                    <div className="trip-endpoint-card source-card">

                        <div className="endpoint-label">
                            <span className="endpoint-icon source-icon">
                                🚌
                            </span>

                            <div>
                                <strong>
                                    Source (Departure Point)
                                </strong>

                                <small>
                                    Where buses leave from —
                                    residential areas, depot,
                                    or township
                                </small>
                            </div>

                            {sourceLocation && (
                                <span className="endpoint-badge source-badge">
                                    Set
                                </span>
                            )}
                        </div>

                        <div className="search-box-row">
                            <LocationSearchBox
                                placeholder="Search source: residential area, depot, bus stand, township..."
                                selectedLocation={
                                    sourceLocation
                                }
                                onSelectLocation={(
                                    location
                                ) => {
                                    setSourceLocation(
                                        location
                                    );

                                    setGenerationError(
                                        ""
                                    );
                                }}
                                onClear={() => {
                                    setSourceLocation(
                                        null
                                    );

                                    setGenerationError(
                                        ""
                                    );
                                }}
                            />
                        </div>

                        {sourceLocation && (
                            <div className="endpoint-selected">
                                <div className="selected-icon">
                                    ✓
                                </div>

                                <div>
                                    <strong>
                                        {
                                            sourceLocation.name
                                        }
                                    </strong>

                                    <p>
                                        {
                                            sourceLocation.displayName ||
                                            ""
                                        }
                                    </p>

                                    <small>
                                        {Number(
                                            sourceLocation.latitude
                                        ).toFixed(5)}
                                        ,{" "}
                                        {Number(
                                            sourceLocation.longitude
                                        ).toFixed(5)}
                                    </small>
                                </div>
                            </div>
                        )}

                    </div>

                    <div className="trip-arrow">
                        ↓ Buses travel
                    </div>

                    {/* DESTINATION */}
                    <div className="trip-endpoint-card destination-card">

                        <div className="endpoint-label">
                            <span className="endpoint-icon destination-icon">
                                🏛️
                            </span>

                            <div>
                                <strong>
                                    Destination
                                    (Arrival Hub) *
                                </strong>

                                <small>
                                    Where buses arrive —
                                    college, school,
                                    institution, or campus
                                    (required)
                                </small>
                            </div>

                            {destinationLocation && (
                                <span className="endpoint-badge destination-badge">
                                    Set
                                </span>
                            )}
                        </div>

                        <div className="search-box-row">
                            <LocationSearchBox
                                placeholder="Search destination: college, school, campus, institution..."
                                selectedLocation={
                                    destinationLocation
                                }
                                onSelectLocation={(
                                    location
                                ) => {
                                    setDestinationLocation(
                                        location
                                    );

                                    setGenerationError(
                                        ""
                                    );
                                }}
                                onClear={() => {
                                    setDestinationLocation(
                                        null
                                    );

                                    setGenerationError(
                                        ""
                                    );
                                }}
                            />
                        </div>

                        {destinationLocation && (
                            <div className="endpoint-selected">

                                <div className="selected-icon destination-check">
                                    🏁
                                </div>

                                <div>
                                    <strong>
                                        {
                                            destinationLocation.name
                                        }
                                    </strong>

                                    <p>
                                        {
                                            destinationLocation.displayName ||
                                            ""
                                        }
                                    </p>

                                    <small>
                                        {Number(
                                            destinationLocation.latitude
                                        ).toFixed(5)}
                                        ,{" "}
                                        {Number(
                                            destinationLocation.longitude
                                        ).toFixed(5)}
                                    </small>
                                </div>

                                <span className="selected-badge">
                                    Active Hub
                                </span>

                            </div>
                        )}

                    </div>

                </div>
            </section>

            {/* Section 2 */}
            <section className="ai-section">

                <div className="section-number">
                    02
                </div>

                <div className="section-content">

                    <div className="section-heading">
                        <h2>
                            AI Recommended Plan
                        </h2>

                        <p>
                            The AI agent independently
                            builds an optimized
                            transportation plan by
                            analyzing Coming users,
                            user stopping areas,
                            vehicle capacities, 2-opt
                            continuous progression,
                            and active schedule
                            availability.
                        </p>
                    </div>

                    <div className="generator-card">

                        <div className="generator-top">

                            <div className="robot-icon">
                                🤖
                            </div>

                            <div>
                                <h3>
                                    AI Transportation
                                    Route Optimizer
                                </h3>

                                <p>
                                    {sourceLocation &&
                                        !destinationLocation
                                        ? "OUTWARD mode: Generates continuous drop-off routes from the Source hub to sequential residential stops."
                                        : destinationLocation &&
                                            !sourceLocation
                                            ? "INWARD mode: Generates continuous pickup routes from outermost residential stops to the Destination campus/institution."
                                            : destinationLocation &&
                                                sourceLocation
                                                ? "CORRIDOR mode: Generates continuous routes from Source through stopping areas and arriving at Destination."
                                                : "Set a Source (leave from here) or Destination (arrive here) to generate optimized continuous bus routes."}
                                </p>
                            </div>

                        </div>

                        <button
                            className="generate-btn"
                            onClick={
                                handleGenerateAIPlan
                            }
                            disabled={
                                generating ||
                                (!destinationLocation &&
                                    !sourceLocation) ||
                                summary.confirmedUsers ===
                                0
                            }
                        >
                            {generating
                                ? "Calculating Optimization..."
                                : summary.confirmedUsers ===
                                    0
                                    ? "⚠️ No Coming Students (Demand: 0)"
                                    : "⚡ Generate AI Plan"}
                        </button>

                        <div className="generation-steps">

                            <div>
                                <b>1</b>
                                <span>
                                    Analyze coming users
                                    &amp; stopping areas
                                </span>
                            </div>

                            <div>
                                <b>2</b>
                                <span>
                                    Cluster stops &amp;
                                    optimize continuous
                                    2-opt paths
                                </span>
                            </div>

                            <div>
                                <b>3</b>
                                <span>
                                    Check vehicle
                                    availability &amp;
                                    seat capacities
                                </span>
                            </div>

                            <div>
                                <b>4</b>
                                <span>
                                    Consolidate
                                    low-utilization routes
                                    &amp; shared corridors
                                </span>
                            </div>

                            <div>
                                <b>5</b>
                                <span>
                                    Validate 7-point road
                                    continuity via OSRM
                                </span>
                            </div>

                        </div>

                    </div>

                    {generationError && (
                        <div className="error-box">
                            <strong>⚠</strong>
                            <span>
                                {generationError}
                            </span>
                        </div>
                    )}

                    {/* Zero Demand */}
                    {!aiPlan &&
                        !generating &&
                        summary.confirmedUsers ===
                        0 && (
                            <div className="empty-ai-box zero-demand-box">

                                <span className="empty-ai-icon">
                                    ⚠️
                                </span>

                                <div className="empty-ai-text">

                                    <h3>
                                        No active AI
                                        transportation
                                        plan.
                                    </h3>

                                    <p
                                        style={{
                                            color:
                                                "#b45309",
                                            fontWeight:
                                                "700",
                                            marginBottom:
                                                "4px"
                                        }}
                                    >
                                        Coming Users: 0
                                    </p>

                                    <p>
                                        No Coming students
                                        available.
                                        Students must
                                        confirm their
                                        travel status
                                        ("I am Coming")
                                        before an AI route
                                        can be generated.
                                    </p>

                                </div>

                            </div>
                        )}

                    {/* Demand Available */}
                    {!aiPlan &&
                        !generating &&
                        summary.confirmedUsers >
                        0 && (
                            <div className="empty-ai-box">

                                <span className="empty-ai-icon">
                                    🤖
                                </span>

                                <div className="empty-ai-text">

                                    <h3>
                                        No AI transportation
                                        plan generated.
                                    </h3>

                                    <p>
                                        Select a{" "}
                                        <strong>
                                            Source
                                        </strong>{" "}
                                        or{" "}
                                        <strong>
                                            Destination
                                        </strong>{" "}
                                        above and click{" "}
                                        <strong>
                                            ⚡ Generate AI Plan
                                        </strong>{" "}
                                        to calculate and
                                        save an optimized
                                        route plan for{" "}
                                        {
                                            summary.confirmedUsers
                                        }{" "}
                                        coming students.
                                    </p>

                                </div>

                            </div>
                        )}

                    {/* AI Plan */}
                    {aiPlan && (
                        <div className="plan-card ai-plan-card">

                            <div className="plan-status-row">

                                <div className="plan-status">
                                    ✓ Active AI Plan
                                    Saved in Database
                                </div>

                                {planData?.generatedAt && (
                                    <small className="plan-saved-at">
                                        Saved on{" "}
                                        {new Date(
                                            planData.generatedAt
                                        ).toLocaleString()}
                                    </small>
                                )}

                            </div>

                            <div className="plan-title-row">

                                <div>

                                    <span className="option-label">
                                        OPTION 1
                                    </span>

                                    <h2>
                                        AI Recommended Plan
                                    </h2>

                                    <p>
                                        Independently
                                        calculated and
                                        certified by the AI
                                        engine from demand,
                                        2-opt road networks,
                                        and vehicle
                                        consolidation.
                                    </p>

                                    {planData?.hubProvenance && (
                                        <div
                                            style={{
                                                marginTop:
                                                    "6px",
                                                fontSize:
                                                    "12px",
                                                color:
                                                    "#475569"
                                            }}
                                        >
                                            📍{" "}
                                            <strong>
                                                Hub Source:
                                            </strong>{" "}
                                            {
                                                planData.hubProvenance
                                            }{" "}
                                            (
                                            {
                                                planData
                                                    ?.startingPoint
                                                    ?.name ||
                                                "Campus"
                                            }
                                            )
                                        </div>
                                    )}

                                </div>

                                <span className="ai-plan-badge">
                                    🤖 AI PLAN
                                </span>

                            </div>

                            {/* Optimization Checklist */}
                            <div className="optimization-checklist">

                                <div className="check-item">
                                    ✓{" "}
                                    <b>
                                        {
                                            aiPlan.comingUsers
                                        }
                                    </b>{" "}
                                    coming users allocated
                                    (0 unallocated, 0
                                    duplicates)
                                </div>

                                <div className="check-item">
                                    ✓{" "}
                                    <b>
                                        {aiPlan.uniqueStoppingAreas ||
                                            summary.stoppingAreas}
                                    </b>{" "}
                                    unique stopping areas
                                    mapped (
                                    <b>
                                        {totalAIStops}
                                    </b>{" "}
                                    route stop visits)
                                </div>

                                <div className="check-item">
                                    ✓{" "}
                                    <b>
                                        {
                                            aiPlan.availableVehicleCount
                                        }
                                    </b>{" "}
                                    available vehicles
                                    evaluated
                                </div>

                                <div className="check-item">
                                    ✓ 2-Opt road continuity
                                    &amp; directional
                                    progress verified
                                </div>

                                <div className="check-item">
                                    ✓ Low-utilization routes
                                    evaluated &amp;
                                    consolidated
                                </div>

                                <div className="check-item">
                                    ✓ Vehicle seat
                                    capacities &amp;
                                    schedule availability
                                    enforced
                                </div>

                            </div>

                            {/* AI Metrics */}
                            <div className="ai-metrics">

                                <div>
                                    <span>👥</span>
                                    <strong>
                                        {formatNumber(
                                            aiPlan.comingUsers
                                        )}
                                    </strong>
                                    <small>
                                        Coming Users
                                    </small>
                                </div>

                                <div>
                                    <span>💺</span>

                                    <strong>
                                        {formatNumber(
                                            aiAssigned
                                        )}{" "}
                                        /{" "}
                                        {formatNumber(
                                            aiCapacity
                                        )}
                                    </strong>

                                    <small>
                                        Passengers /
                                        Allocated Seats
                                    </small>

                                    {aiAvailableCapacity >
                                        aiCapacity && (
                                            <span
                                                style={{
                                                    display:
                                                        "block",
                                                    fontSize:
                                                        "10px",
                                                    color:
                                                        "#94a3b8",
                                                    marginTop:
                                                        "2px"
                                                }}
                                            >
                                                Fleet:{" "}
                                                {formatNumber(
                                                    aiAvailableCapacity
                                                )}{" "}
                                                available
                                            </span>
                                        )}
                                </div>

                                <div>
                                    <span>📊</span>

                                    <strong>
                                        {
                                            aiUtilization
                                        }
                                        %
                                    </strong>

                                    <small>
                                        Seat Utilization
                                    </small>

                                    {aiPlan.utilizationNote && (
                                        <span
                                            style={{
                                                display:
                                                    "block",
                                                fontSize:
                                                    "10px",
                                                color:
                                                    "#94a3b8",
                                                marginTop:
                                                    "2px"
                                            }}
                                        >
                                            {
                                                aiPlan.utilizationNote
                                            }
                                        </span>
                                    )}
                                </div>

                                <div>
                                    <span>🚌</span>

                                    <strong>
                                        {
                                            aiBuses.length
                                        }
                                    </strong>

                                    <small>
                                        Buses Allocated
                                    </small>
                                </div>

                                <div>
                                    <span>📍</span>

                                    <strong>
                                        {aiPlan.uniqueStoppingAreas ||
                                            summary.stoppingAreas}
                                    </strong>

                                    <small>
                                        Unique Stopping
                                        Areas
                                    </small>
                                </div>

                                <div>
                                    <span>🚏</span>

                                    <strong>
                                        {totalAIStops}
                                    </strong>

                                    <small>
                                        Route Stop Visits
                                    </small>
                                </div>

                            </div>

                            {/* Stop Count Explanation */}
                            {summary?.stopCountExplanation && (
                                <div
                                    style={{
                                        background:
                                            "#f1f5f9",
                                        padding:
                                            "10px 14px",
                                        borderRadius:
                                            "8px",
                                        fontSize:
                                            "12px",
                                        color:
                                            "#334155",
                                        margin:
                                            "12px 0"
                                    }}
                                >
                                    ℹ️{" "}
                                    <b>
                                        Stop Breakdown:
                                    </b>{" "}
                                    {
                                        summary.stopCountExplanation
                                    }
                                </div>
                            )}

                            {/* Capacity Shortage */}
                            {aiUnassigned > 0 && (
                                <div className="capacity-shortage-alert">

                                    <div className="alert-header">
                                        <span>⚠</span>

                                        <strong>
                                            INSUFFICIENT
                                            VEHICLE CAPACITY
                                            DETECTED
                                        </strong>
                                    </div>

                                    <p>
                                        {aiPlan.comingUsers >
                                            aiAvailableCapacity ? (
                                            <>
                                                Passenger demand
                                                exceeds available
                                                fleet capacity:{" "}
                                                <b>
                                                    {
                                                        aiPlan.comingUsers
                                                    }
                                                </b>{" "}
                                                coming users vs{" "}
                                                <b>
                                                    {
                                                        aiAvailableCapacity
                                                    }
                                                </b>{" "}
                                                total available
                                                seats.
                                                <b>
                                                    {" "}
                                                    {
                                                        aiUnassigned
                                                    }
                                                </b>{" "}
                                                users could not
                                                be assigned
                                                without
                                                overbooking.
                                            </>
                                        ) : (
                                            <>
                                                <b>
                                                    {
                                                        aiUnassigned
                                                    }
                                                </b>{" "}
                                                passengers could
                                                not be assigned
                                                to available
                                                routes due to
                                                corridor
                                                capacity
                                                constraints.
                                                Fleet capacity
                                                is{" "}
                                                <b>
                                                    {
                                                        aiAvailableCapacity
                                                    }
                                                </b>{" "}
                                                seats for{" "}
                                                <b>
                                                    {
                                                        aiPlan.comingUsers
                                                    }
                                                </b>{" "}
                                                coming users.
                                            </>
                                        )}
                                    </p>

                                    <div className="shortage-recommendations">
                                        <strong>
                                            AI Recommendations:
                                        </strong>

                                        <ul>
                                            <li>
                                                Mark another bus
                                                as "Available"
                                                in Schedule
                                                Management.
                                            </li>

                                            <li>
                                                Add an additional
                                                vehicle to the
                                                fleet in Vehicle
                                                Management.
                                            </li>

                                            <li>
                                                Schedule a second
                                                trip for
                                                high-capacity
                                                corridors.
                                            </li>
                                        </ul>
                                    </div>

                                </div>
                            )}

                            {aiUnassigned === 0 && (
                                <div className="success-box">
                                    ✓ All{" "}
                                    {
                                        aiPlan.comingUsers
                                    }{" "}
                                    confirmed passengers
                                    successfully
                                    accommodated within
                                    vehicle seat limits
                                    with road continuity
                                    verified.
                                </div>
                            )}

                            {/* AI Recommendations */}
                            {Array.isArray(
                                aiPlan.recommendationsList
                            ) &&
                                aiPlan
                                    .recommendationsList
                                    .length > 0 && (
                                    <div className="ai-insights-box">

                                        <strong>
                                            🧠 AI Route
                                            Consolidation
                                            &amp; Insights:
                                        </strong>

                                        <ul>
                                            {aiPlan.recommendationsList.map(
                                                (
                                                    rec,
                                                    idx
                                                ) => (
                                                    <li
                                                        key={
                                                            idx
                                                        }
                                                    >
                                                        {rec}
                                                    </li>
                                                )
                                            )}
                                        </ul>

                                    </div>
                                )}

                            {/* Corridor Overlap */}
                            {Array.isArray(
                                aiPlan.overlapAlerts
                            ) &&
                                aiPlan.overlapAlerts
                                    .length > 0 && (
                                    <div
                                        className="ai-insights-box"
                                        style={{
                                            borderLeft:
                                                "3px solid #f59e0b",
                                            background:
                                                "#fffbeb"
                                        }}
                                    >

                                        <strong>
                                            🔀 Shared Corridor
                                            Overlap Analysis:
                                        </strong>

                                        <ul>
                                            {aiPlan.overlapAlerts.map(
                                                (
                                                    alert,
                                                    idx
                                                ) => (
                                                    <li
                                                        key={
                                                            idx
                                                        }
                                                    >
                                                        {
                                                            alert
                                                        }
                                                    </li>
                                                )
                                            )}
                                        </ul>

                                    </div>
                                )}

                            {/* Bus Routes */}
                            <div className="ai-bus-list">

                                {aiBuses.map(
                                    (
                                        bus,
                                        busIndex
                                    ) => {
                                        const capacity =
                                            getBusCapacity(
                                                bus
                                            );

                                        const assigned =
                                            Number(
                                                bus.assignedUsers ||
                                                0
                                            );

                                        const remaining =
                                            Number(
                                                bus.remainingSeats ??
                                                Math.max(
                                                    0,
                                                    capacity -
                                                    assigned
                                                )
                                            );

                                        return (
                                            <div
                                                className="ai-bus-card"
                                                key={
                                                    bus.vehicleId ||
                                                    `bus-card-${busIndex}`
                                                }
                                            >

                                                <div className="bus-header">

                                                    <div>
                                                        <span className="bus-number">
                                                            {bus.routeCode ||
                                                                `R-${busIndex + 1}`}
                                                        </span>

                                                        <div>
                                                            <small>
                                                                {bus.sectorName ||
                                                                    "INSTITUTIONAL TRANSIT LINE"}
                                                            </small>

                                                            <h3>
                                                                {bus.routeName ||
                                                                    getBusName(
                                                                        bus,
                                                                        busIndex
                                                                    )}
                                                            </h3>
                                                        </div>
                                                    </div>

                                                    <span className="seat-capacity">
                                                        🚌{" "}
                                                        {
                                                            bus.vehicleName
                                                        }{" "}
                                                        •{" "}
                                                        {
                                                            assigned
                                                        }{" "}
                                                        /{" "}
                                                        {
                                                            capacity
                                                        }{" "}
                                                        seats (
                                                        {
                                                            remaining
                                                        }{" "}
                                                        standby)
                                                    </span>

                                                </div>

                                                <div className="bus-stats">

                                                    <span>
                                                        👥{" "}
                                                        <b>
                                                            {
                                                                assigned
                                                            }
                                                        </b>{" "}
                                                        students
                                                        boarding
                                                    </span>

                                                    <span>
                                                        📍{" "}
                                                        <b>
                                                            {Array.isArray(
                                                                bus.stops
                                                            )
                                                                ? bus
                                                                    .stops
                                                                    .length
                                                                : 0}
                                                        </b>{" "}
                                                        pickup stops
                                                    </span>

                                                    {bus.routeDistanceKm && (
                                                        <span>
                                                            🛣️{" "}
                                                            <b>
                                                                {
                                                                    bus.routeDistanceKm
                                                                }{" "}
                                                                km
                                                            </b>{" "}
                                                            total
                                                            route
                                                        </span>
                                                    )}

                                                    <span
                                                        className={`status-pill ${bus.isContinuous
                                                                ? "continuous"
                                                                : "warning"
                                                            }`}
                                                    >
                                                        {bus.roadRouteStatus ||
                                                            "Road Optimized (Continuous)"}
                                                    </span>

                                                    {bus.isConsolidated && (
                                                        <span
                                                            style={{
                                                                background:
                                                                    "#e0e7ff",
                                                                color:
                                                                    "#3730a3",
                                                                fontSize:
                                                                    "11px",
                                                                fontWeight:
                                                                    "700",
                                                                padding:
                                                                    "3px 8px",
                                                                borderRadius:
                                                                    "12px"
                                                            }}
                                                        >
                                                            ✨
                                                            Consolidated
                                                            Line
                                                        </span>
                                                    )}

                                                </div>

                                                {bus.consolidationNote && (
                                                    <div
                                                        style={{
                                                            margin:
                                                                "6px 0 10px",
                                                            fontSize:
                                                                "12px",
                                                            color:
                                                                "#1e40af",
                                                            background:
                                                                "#eff6ff",
                                                            padding:
                                                                "6px 10px",
                                                            borderRadius:
                                                                "6px"
                                                        }}
                                                    >
                                                        💡{" "}
                                                        {
                                                            bus.consolidationNote
                                                        }
                                                    </div>
                                                )}

                                                {bus.lowUtilizationNote && (
                                                    <div
                                                        style={{
                                                            margin:
                                                                "6px 0 10px",
                                                            fontSize:
                                                                "12px",
                                                            color:
                                                                "#854d0e",
                                                            background:
                                                                "#fefce8",
                                                            padding:
                                                                "6px 10px",
                                                            borderRadius:
                                                                "6px"
                                                        }}
                                                    >
                                                        ℹ️{" "}
                                                        {
                                                            bus.lowUtilizationNote
                                                        }
                                                    </div>
                                                )}

                                                {bus.corridorOverlapNote && (
                                                    <div
                                                        style={{
                                                            margin:
                                                                "6px 0 10px",
                                                            fontSize:
                                                                "12px",
                                                            color:
                                                                "#b45309",
                                                            background:
                                                                "#fffbeb",
                                                            padding:
                                                                "6px 10px",
                                                            borderRadius:
                                                                "6px",
                                                            borderLeft:
                                                                "3px solid #f59e0b"
                                                        }}
                                                    >
                                                        🔀{" "}
                                                        {
                                                            bus.corridorOverlapNote
                                                        }
                                                    </div>
                                                )}

                                                {bus.detourRatio !=
                                                    null && (
                                                        <div
                                                            style={{
                                                                margin:
                                                                    "4px 0 8px",
                                                                fontSize:
                                                                    "11px",
                                                                color:
                                                                    bus.isDetour
                                                                        ? "#b91c1c"
                                                                        : "#15803d",
                                                                background:
                                                                    bus.isDetour
                                                                        ? "#fef2f2"
                                                                        : "#f0fdf4",
                                                                padding:
                                                                    "4px 10px",
                                                                borderRadius:
                                                                    "6px"
                                                            }}
                                                        >
                                                            🛣️ Detour
                                                            ratio:{" "}
                                                            <b>
                                                                {
                                                                    bus.detourRatio
                                                                }
                                                                ×
                                                            </b>{" "}
                                                            road vs
                                                            straight-line{" "}
                                                            <span
                                                                style={{
                                                                    color:
                                                                        "#64748b"
                                                                }}
                                                            >
                                                                (
                                                                {bus.isDetour
                                                                    ? `Exceeds ${bus.detourThreshold}× threshold`
                                                                    : `Within ${bus.detourThreshold}× threshold — acceptable`}
                                                                )
                                                            </span>
                                                        </div>
                                                    )}

                                                {/* Route Timeline */}
                                                <div className="route-timeline">

                                                    {(bus.tripMode ===
                                                        "OUTWARD" ||
                                                        bus.tripMode ===
                                                        "SOURCE_TO_DESTINATION" ||
                                                        planData?.tripMode ===
                                                        "OUTWARD") && (
                                                            <div className="timeline-start source-terminal-hub">

                                                                <span className="timeline-dot source-dot"></span>

                                                                <div>
                                                                    <strong>
                                                                        🚩{" "}
                                                                        {bus.sourceHub?.name ||
                                                                            planData
                                                                                ?.source
                                                                                ?.name ||
                                                                            sourceLocation?.name ||
                                                                            "Trip Departure Source"}
                                                                    </strong>

                                                                    <small>
                                                                        Departure
                                                                        point ·{" "}
                                                                        {
                                                                            assigned
                                                                        }{" "}
                                                                        passengers
                                                                        board
                                                                        here
                                                                    </small>
                                                                </div>

                                                            </div>
                                                        )}

                                                    {Array.isArray(
                                                        bus.stops
                                                    ) &&
                                                        bus.stops.map(
                                                            (
                                                                stop,
                                                                stopIndex
                                                            ) => {
                                                                const isOutward =
                                                                    bus.tripMode ===
                                                                    "OUTWARD" ||
                                                                    planData?.tripMode ===
                                                                    "OUTWARD";

                                                                const userCount =
                                                                    getAIStopUsers(
                                                                        stop
                                                                    );

                                                                return (
                                                                    <div
                                                                        className="timeline-stop"
                                                                        key={`${stop.name}-${stopIndex}`}
                                                                    >

                                                                        <span className="timeline-number">
                                                                            {stopIndex +
                                                                                1}
                                                                        </span>

                                                                        <div className="timeline-stop-content">

                                                                            <div className="stop-title-row">

                                                                                <strong>
                                                                                    {
                                                                                        stop.name
                                                                                    }
                                                                                </strong>

                                                                                {stop.legDistanceKm !==
                                                                                    undefined &&
                                                                                    stop.legDistanceKm >
                                                                                    0 && (
                                                                                        <span className="leg-distance-badge">
                                                                                            +
                                                                                            {
                                                                                                stop.legDistanceKm
                                                                                            }{" "}
                                                                                            km
                                                                                        </span>
                                                                                    )}

                                                                                {stop.isSharedCorridor && (
                                                                                    <span className="shared-badge">
                                                                                        🔀
                                                                                        Shared
                                                                                        Corridor
                                                                                    </span>
                                                                                )}

                                                                            </div>

                                                                            <div>
                                                                                {isOutward ? (
                                                                                    <>
                                                                                        <span>
                                                                                            👥{" "}
                                                                                            <b>
                                                                                                {stop.passengersDropped ||
                                                                                                    userCount}
                                                                                            </b>{" "}
                                                                                            alighted
                                                                                        </span>

                                                                                        {stop.passengersRemaining !==
                                                                                            undefined && (
                                                                                                <span>
                                                                                                    {" "}
                                                                                                    ·{" "}
                                                                                                    <b>
                                                                                                        {
                                                                                                            stop.passengersRemaining
                                                                                                        }
                                                                                                    </b>{" "}
                                                                                                    still
                                                                                                    on
                                                                                                    bus
                                                                                                </span>
                                                                                            )}
                                                                                    </>
                                                                                ) : (
                                                                                    <>
                                                                                        <span>
                                                                                            👥{" "}
                                                                                            <b>
                                                                                                {
                                                                                                    userCount
                                                                                                }
                                                                                            </b>{" "}
                                                                                            boarding
                                                                                            ·{" "}
                                                                                            <b>
                                                                                                {stop.cumulativePassengers ||
                                                                                                    userCount}
                                                                                            </b>{" "}
                                                                                            on
                                                                                            bus
                                                                                        </span>

                                                                                        {stop.standbySeatsAtStop !==
                                                                                            undefined &&
                                                                                            stop.standbySeatsAtStop >
                                                                                            0 && (
                                                                                                <span>
                                                                                                    {" "}
                                                                                                    ·{" "}
                                                                                                    {
                                                                                                        stop.standbySeatsAtStop
                                                                                                    }{" "}
                                                                                                    seats
                                                                                                    free
                                                                                                </span>
                                                                                            )}
                                                                                    </>
                                                                                )}
                                                                            </div>

                                                                            {stop.selectionReason && (
                                                                                <div
                                                                                    style={{
                                                                                        fontSize:
                                                                                            "11px",
                                                                                        color:
                                                                                            "#475569",
                                                                                        marginTop:
                                                                                            "3px",
                                                                                        fontStyle:
                                                                                            "italic",
                                                                                        background:
                                                                                            "#f8fafc",
                                                                                        padding:
                                                                                            "2px 6px",
                                                                                        borderRadius:
                                                                                            "4px"
                                                                                    }}
                                                                                >
                                                                                    💡{" "}
                                                                                    {
                                                                                        stop.selectionReason
                                                                                    }
                                                                                </div>
                                                                            )}

                                                                        </div>
                                                                    </div>
                                                                );
                                                            }
                                                        )}

                                                    {(bus.tripMode !==
                                                        "OUTWARD" &&
                                                        planData?.tripMode !==
                                                        "OUTWARD") && (
                                                            <div className="timeline-start terminal-hub">

                                                                <span className="timeline-dot terminal-dot"></span>

                                                                <div>
                                                                    <strong>
                                                                        🏁{" "}
                                                                        {bus.destinationHub?.name ||
                                                                            planData
                                                                                ?.destination
                                                                                ?.name ||
                                                                            destinationLocation?.name ||
                                                                            planData
                                                                                ?.startingPoint
                                                                                ?.name ||
                                                                            "Campus Main Terminal"}
                                                                    </strong>

                                                                    <small>
                                                                        Final
                                                                        destination
                                                                        · All{" "}
                                                                        {
                                                                            assigned
                                                                        }{" "}
                                                                        students
                                                                        arrive
                                                                    </small>
                                                                </div>

                                                            </div>
                                                        )}

                                                </div>

                                            </div>
                                        );
                                    }
                                )}

                            </div>

                            <button
                                className={`select-plan-btn ${selectedPlanType ===
                                        "AI"
                                        ? "selected"
                                        : ""
                                    }`}
                                onClick={
                                    handleSelectAIPlan
                                }
                            >
                                {selectedPlanType ===
                                    "AI"
                                    ? "✓ AI Plan Selected"
                                    : "🤖 Select AI Plan"}
                            </button>

                        </div>
                    )}

                </div>
            </section>

            {/* Section 3: Admin Manual Plan */}
            <section className="ai-section">

                <div className="section-number">
                    03
                </div>

                <div className="section-content">

                    <div className="section-heading">
                        <h2>
                            Admin Manual Plan
                        </h2>

                        <p>
                            Routes manually created and
                            saved by the administrator
                            in Route Management. This
                            plan is completely separate
                            from AI generation.
                        </p>
                    </div>

                    <div className="manual-plan-card">

                        <div className="manual-plan-header">

                            <div>
                                <span className="option-label">
                                    OPTION 2
                                </span>

                                <h2>
                                    Admin Manual Plan
                                </h2>

                                <p>
                                    Saved routes from
                                    Route Management
                                    database.
                                </p>
                            </div>

                            <span className="admin-badge">
                                👨‍💼 ADMIN
                            </span>

                        </div>

                        {manualRoutesLoading ? (
                            <div className="manual-info-box">
                                Loading saved admin
                                routes from database...
                            </div>
                        ) : manualRoutes.length ===
                            0 ? (
                            <div className="empty-manual">
                                <span>🛣️</span>

                                <h3>
                                    No saved routes
                                </h3>

                                <p>
                                    Create and save manual
                                    routes in Route
                                    Management first.
                                </p>
                            </div>
                        ) : (
                            <div className="manual-route-list">

                                {manualRoutes.map(
                                    (
                                        route,
                                        routeIndex
                                    ) => {
                                        const points =
                                            getManualRoutePoints(
                                                route
                                            );

                                        const vehicleName =
                                            route.vehicleName ||
                                            route
                                                .assignedVehicle
                                                ?.vehicleName ||
                                            "Bus";

                                        const capacity =
                                            route.capacity ||
                                            route
                                                .assignedVehicle
                                                ?.capacity ||
                                            0;

                                        return (
                                            <div
                                                className="manual-route-card"
                                                key={
                                                    route._id ||
                                                    route.routeId ||
                                                    routeIndex
                                                }
                                            >

                                                <div className="manual-route-top">

                                                    <span className="manual-route-number">
                                                        {routeIndex +
                                                            1}
                                                    </span>

                                                    <div>
                                                        <small>
                                                            ADMIN
                                                            MANUAL
                                                            ROUTE
                                                        </small>

                                                        <h3>
                                                            {route.routeName ||
                                                                `Route ${routeIndex + 1}`}
                                                        </h3>
                                                    </div>

                                                    <div className="manual-bus">
                                                        🚌

                                                        <div>
                                                            <strong>
                                                                {
                                                                    vehicleName
                                                                }
                                                            </strong>

                                                            <span>
                                                                {
                                                                    capacity
                                                                }{" "}
                                                                seats
                                                            </span>
                                                        </div>
                                                    </div>

                                                </div>

                                                <div className="manual-route-path">

                                                    {points.length ===
                                                        0 ? (
                                                        <span>
                                                            Route
                                                            stops not
                                                            configured
                                                        </span>
                                                    ) : (
                                                        points.map(
                                                            (
                                                                point,
                                                                pointIndex
                                                            ) => (
                                                                <span
                                                                    key={`${point.name}-${pointIndex}`}
                                                                >
                                                                    {point.name ||
                                                                        "Stop"}

                                                                    {pointIndex <
                                                                        points.length -
                                                                        1 && (
                                                                            <b>
                                                                                →
                                                                            </b>
                                                                        )}
                                                                </span>
                                                            )
                                                        )
                                                    )}

                                                </div>

                                            </div>
                                        );
                                    }
                                )}

                            </div>
                        )}

                        <button
                            className={`select-plan-btn admin ${selectedPlanType ===
                                    "ADMIN"
                                    ? "selected"
                                    : ""
                                }`}
                            onClick={
                                handleSelectAdminPlan
                            }
                            disabled={
                                manualRoutesLoading ||
                                manualRoutes.length ===
                                0
                            }
                        >
                            {selectedPlanType ===
                                "ADMIN"
                                ? "✓ Admin Plan Selected"
                                : "👨‍💼 Select Admin Plan"}
                        </button>

                    </div>
                </div>
            </section>

            {/* Section 4: Final Decision */}
            <section className="final-decision">

                <div className="final-heading">

                    <span>
                        FINAL DECISION
                    </span>

                    <h2>
                        Administrator Confirmation
                    </h2>

                    <p>
                        The AI only recommends. The
                        administrator makes the final
                        transportation plan choice.
                    </p>

                </div>

                <div className="decision-options">

                    <div
                        className={`decision-option ${selectedPlanType ===
                                "AI"
                                ? "active"
                                : ""
                            }`}
                        onClick={
                            aiPlan
                                ? handleSelectAIPlan
                                : undefined
                        }
                    >

                        <span className="decision-icon">
                            🤖
                        </span>

                        <div>
                            <small>
                                OPTION 1
                            </small>

                            <h3>
                                AI Recommended Plan
                            </h3>

                            <p>
                                {aiPlan
                                    ? `${aiBuses.length} continuous bus corridors`
                                    : "Generate AI plan above first"}
                            </p>
                        </div>

                        {selectedPlanType ===
                            "AI" && (
                                <strong className="selected-check">
                                    ✓
                                </strong>
                            )}

                    </div>

                    <div className="decision-or">
                        OR
                    </div>

                    <div
                        className={`decision-option ${selectedPlanType ===
                                "ADMIN"
                                ? "active admin-active"
                                : ""
                            }`}
                        onClick={
                            manualRoutes.length
                                ? handleSelectAdminPlan
                                : undefined
                        }
                    >

                        <span className="decision-icon">
                            👨‍💼
                        </span>

                        <div>
                            <small>
                                OPTION 2
                            </small>

                            <h3>
                                Admin Manual Plan
                            </h3>

                            <p>
                                {
                                    manualRoutes.length
                                }{" "}
                                saved manual routes
                            </p>
                        </div>

                        {selectedPlanType ===
                            "ADMIN" && (
                                <strong className="selected-check">
                                    ✓
                                </strong>
                            )}

                    </div>

                </div>

                <div className="final-save">

                    <div className="selected-final-plan">

                        <span>
                            Selected Plan for
                            Execution:
                        </span>

                        <strong>
                            {selectedPlanType ===
                                "AI"
                                ? "🤖 AI Recommended Plan"
                                : selectedPlanType ===
                                    "ADMIN"
                                    ? "👨‍💼 Admin Manual Plan"
                                    : "No plan selected"}
                        </strong>

                    </div>

                    <button
                        className="save-final-btn"
                        onClick={
                            handleSaveFinalPlan
                        }
                        disabled={
                            !selectedPlanType ||
                            savingSelection
                        }
                    >
                        {savingSelection
                            ? "Saving Selection..."
                            : "✓ Confirm Final Transportation Plan"}
                    </button>

                </div>

                {selectionMessage && (
                    <div
                        className={`final-message ${selectionMessage.includes(
                            "successfully"
                        )
                                ? "success"
                                : "error"
                            }`}
                    >
                        {selectionMessage}
                    </div>
                )}

                {lastSelection && (
                    <div className="last-selection">

                        Current active confirmed plan:{" "}

                        <strong>
                            {lastSelection.planType ===
                                "AI"
                                ? "🤖 AI Recommended Plan"
                                : "👨‍💼 Admin Manual Plan"}
                        </strong>{" "}

                        (Selected on{" "}
                        {new Date(
                            lastSelection.selectedAt ||
                            lastSelection.createdAt
                        ).toLocaleString()}
                        )

                    </div>
                )}

            </section>

            {/* Reset Confirmation Modal */}
            {showResetModal && (
                <div
                    className="ai-modal-overlay"
                    onClick={() =>
                        !resetting &&
                        setShowResetModal(false)
                    }
                >

                    <div
                        className="ai-modal-card"
                        onClick={(e) =>
                            e.stopPropagation()
                        }
                    >

                        <div className="ai-modal-header">

                            <span className="ai-modal-icon">
                                ⚠️
                            </span>

                            <h2>
                                Reset AI Generated
                                Route?
                            </h2>

                        </div>

                        <div className="ai-modal-body">

                            <p>
                                This will remove the
                                currently generated AI
                                transportation route and
                                reset all student travel
                                responses.
                            </p>

                            <p>
                                Students will return to{" "}
                                <strong>
                                    Pending
                                </strong>{" "}
                                and will need to confirm
                                whether they are{" "}
                                <strong>
                                    Coming
                                </strong>{" "}
                                or{" "}
                                <strong>
                                    Not Coming
                                </strong>{" "}
                                for the next trip.
                            </p>

                        </div>

                        <div className="ai-modal-actions">

                            <button
                                type="button"
                                className="ai-modal-btn cancel-btn"
                                onClick={() =>
                                    setShowResetModal(
                                        false
                                    )
                                }
                                disabled={resetting}
                            >
                                Cancel
                            </button>

                            <button
                                type="button"
                                className="ai-modal-btn reset-btn"
                                onClick={
                                    handleConfirmReset
                                }
                                disabled={resetting}
                            >
                                {resetting
                                    ? "Resetting..."
                                    : "Reset"}
                            </button>

                        </div>

                    </div>

                </div>
            )}

        </div>
    );
}