import { useEffect, useState, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import {
    getAIData,
    getAIMetrics,
    generateRecommendations,
    getActivePlan,
    resetAIPlan,
    getManualRoutes,
    getManualPlan,
    getManualPlanRecommendations,
    approveManualPlan,
    resetManualPlan,
    saveSelectedPlan,
    getSelectedPlan,
    fetchLateResponses
} from "../services/aiAgentService";
import LocationSearchBox from "../components/LocationSearchBox";
import OptimizationWorkspace from "../components/OptimizationWorkspace";
import OptimizationResultSummary from "../components/OptimizationResultSummary";
import ResetRouteModal from "../components/ResetRouteModal";
import SelectGeneratedRouteModal from "../components/SelectGeneratedRouteModal";
import RecommendedRouteMapModal from "../components/RecommendedRouteMapModal";
import api from "../services/api";
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
    const [metricsLoading, setMetricsLoading] = useState(true);

    // Trip direction mode: "FROM_SOURCE" (Outward) or "TO_DESTINATION" (Inward)
    const [tripMode, setTripMode] = useState(() => {
        try {
            const cached = localStorage.getItem("active_ai_plan");
            if (cached) {
                const p = JSON.parse(cached);
                if (p?.tripMode) return p.tripMode;
                if (p?.direction === "OUTWARD") return "FROM_SOURCE";
                if (p?.direction === "INWARD") return "TO_DESTINATION";
            }
        } catch {
            // fallback
        }
        return "FROM_SOURCE";
    });

    // Active endpoint tracker: "source" | "destination"
    const [activeEndpointField, setActiveEndpointField] = useState("source");

    // Source = buses leave from here (for Outward Plan)
    const [sourceLocation, setSourceLocation] =
        useState(null);

    // Destination = buses arrive here (for Inward Plan)
    const [destinationLocation, setDestinationLocation] =
        useState(null);

    // Track user interaction and initial hydration to protect endpoint state
    const userInteractedRef = useRef(false);
    const initialHydratedRef = useRef(false);

    // Legacy alias for backward compatibility
    const selectedLocation =
        destinationLocation || sourceLocation;

    const [generating, setGenerating] =
        useState(false);

    const [generationError, setGenerationError] =
        useState("");

    const [planData, setPlanData] = useState(() => {
        try {
            const cached = localStorage.getItem("active_ai_plan");
            return cached ? JSON.parse(cached) : null;
        } catch {
            return null;
        }
    });

    const [outwardPlan, setOutwardPlan] = useState(() => {
        try {
            const cached = localStorage.getItem("active_outward_plan");
            if (cached) return JSON.parse(cached);
            const active = localStorage.getItem("active_ai_plan");
            if (active) {
                const p = JSON.parse(active);
                if (p?.direction === "OUTWARD" || p?.tripMode === "FROM_SOURCE" || p?.tripMode === "OUTWARD") return p;
            }
        } catch {
            // fallback
        }
        return null;
    });

    const [inwardPlan, setInwardPlan] = useState(() => {
        try {
            const cached = localStorage.getItem("active_inward_plan");
            if (cached) return JSON.parse(cached);
            const active = localStorage.getItem("active_ai_plan");
            if (active) {
                const p = JSON.parse(active);
                if (p?.direction === "INWARD" || p?.tripMode === "TO_DESTINATION" || p?.tripMode === "INWARD") return p;
            }
        } catch {
            // fallback
        }
        return null;
    });

    const [planDirectionTab, setPlanDirectionTab] = useState(() => {
        try {
            const cachedSel = localStorage.getItem("active_ai_selection");
            if (cachedSel) {
                const s = JSON.parse(cachedSel);
                if (s?.direction) return s.direction;
            }
            const cached = localStorage.getItem("active_ai_plan");
            if (cached) {
                const p = JSON.parse(cached);
                const dir = p.direction || (p.tripMode === "FROM_SOURCE" || p.tripMode === "OUTWARD" ? "OUTWARD" : "INWARD");
                if (dir) return dir;
            }
        } catch {
            // fallback
        }
        return "OUTWARD";
    });

    const [selectedPlanType, setSelectedPlanType] = useState(() => {
        try {
            const cachedSel = localStorage.getItem("active_ai_selection");
            if (cachedSel) {
                const s = JSON.parse(cachedSel);
                return s?.planType || "AI";
            }
            const cached = localStorage.getItem("active_ai_plan");
            if (cached) {
                const p = JSON.parse(cached);
                if (p?.isApproved) return "AI";
            }
        } catch {
            // fallback
        }
        return "";
    });

    const [savingSelection, setSavingSelection] =
        useState(false);

    const [selectionMessage, setSelectionMessage] =
        useState("");

    const navigate = useNavigate();

    const [lastSelection, setLastSelection] = useState(() => {
        try {
            const cached = localStorage.getItem("active_ai_selection");
            return cached ? JSON.parse(cached) : null;
        } catch {
            return null;
        }
    });

    const isPlanSaved = useMemo(() => {
        const currentDir = planDirectionTab || (tripMode === "FROM_SOURCE" ? "OUTWARD" : "INWARD");
        if (currentDir === "OUTWARD") {
            return Boolean(outwardPlan?.isApproved || lastSelection?.direction === "OUTWARD");
        }
        return Boolean(inwardPlan?.isApproved || lastSelection?.direction === "INWARD");
    }, [planDirectionTab, tripMode, outwardPlan, inwardPlan, lastSelection]);

    const [showResetModal, setShowResetModal] =
        useState(false);

    const [showSelectRouteModal, setShowSelectRouteModal] =
        useState(false);

    const [resetting, setResetting] =
        useState(false);

    const [resetSuccessMessage, setResetSuccessMessage] =
        useState("");

    const [manualRoutes, setManualRoutes] =
        useState([]);

    const [manualPlanData, setManualPlanData] =
        useState(null);

    const [manualPlanDirection, setManualPlanDirection] = useState(() => {
        return planDirectionTab || "INWARD";
    });

    const displayedManualRoutes = useMemo(() => {
        const rawList = manualPlanData?.buses || manualPlanData?.routes || manualRoutes || [];
        return rawList.filter((r) => Boolean(r.assignedVehicle || r.vehicleName));
    }, [manualPlanData, manualRoutes]);

    useEffect(() => {
        if (planDirectionTab) {
            setManualPlanDirection(planDirectionTab);
            setManualRecommendations(null);
            setShowRecommendationsPanel(false);
        }
    }, [planDirectionTab]);

    const [manualRoutesLoading, setManualRoutesLoading] =
        useState(true);
    const [manualPlanApproving, setManualPlanApproving] =
        useState(false);
    const [recommendationsLoading, setRecommendationsLoading] =
        useState(false);
    const [manualRecommendations, setManualRecommendations] =
        useState(null);
    const [showRecommendationsPanel, setShowRecommendationsPanel] =
        useState(false);
    const [selectedMapRec, setSelectedMapRec] =
        useState(null);
    const [isMapModalOpen, setIsMapModalOpen] =
        useState(false);



    const [loading, setLoading] = useState(() => {
        try {
            return !localStorage.getItem("active_ai_plan");
        } catch {
            return true;
        }
    });

    const handleSelectAiRouteToView = (route) => {
        setShowSelectRouteModal(false);
        if (!route) {
            toast.error("Unable to load the selected AI route.");
            return;
        }
        try {
            sessionStorage.setItem("activeAiViewRoute", JSON.stringify(route));
            if (planData?.aiPlan || planData) {
                sessionStorage.setItem("activeAiPlan", JSON.stringify(planData?.aiPlan || planData));
            }
        } catch (e) {
            console.warn("Could not cache activeAiViewRoute", e);
        }
        navigate("/routes", {
            state: {
                fromAiAgent: true,
                selectedAiRoute: route,
                aiPlan: planData?.aiPlan || planData
            }
        });
    };

    useEffect(() => {
        let isMounted = true;

        loadPageData(isMounted);

        const handleSync = () => {
            if (document.visibilityState === "visible" && !generating && !savingSelection && !resetting) {
                loadAIData(false, isMounted);
                loadActivePlan(false);
                loadLastSelection();
                loadManualRoutes();
            }
        };

        window.addEventListener("focus", handleSync);
        document.addEventListener("visibilitychange", handleSync);

        // Cross-tab background polling to sync resets and live updates (only when tab is visible)
        const pollInterval = setInterval(() => {
            if (document.visibilityState === "visible" && !generating && !savingSelection && !resetting) {
                loadAIData(false, isMounted);
                loadActivePlan(false);
                loadLastSelection();
            }
        }, 15000);

        return () => {
            isMounted = false;
            window.removeEventListener("focus", handleSync);
            document.removeEventListener("visibilitychange", handleSync);
            clearInterval(pollInterval);
        };
    }, []);

    const loadPageData = async (isMounted = true) => {
        await Promise.all([
            loadAIData(true, isMounted),
            loadActivePlan(true),
            loadLastSelection(),
            loadManualRoutes()
        ]);

        if (isMounted) {
            initialHydratedRef.current = true;
            setLoading(false);
        }
    };

    const loadAIData = async (isInitial = false, isMounted = true) => {
        try {
            if (isInitial && isMounted) {
                setMetricsLoading(true);
            }
            const response = await getAIMetrics();
            if (isMounted) {
                setData(response);
                setMetricsLoading(false);
            }

            // If travel status has been reset and there are 0 confirmed passengers, clear generated routes
            const comingCount = Number(response?.confirmedUserCount ?? response?.comingUsers ?? 0);
            if (comingCount === 0) {
                localStorage.removeItem("active_ai_plan");
                localStorage.removeItem("active_ai_selection");
                localStorage.removeItem("active_outward_plan");
                localStorage.removeItem("active_inward_plan");
                if (isMounted) {
                    setPlanData(null);
                    setSelectedPlanType("");
                    setLastSelection(null);
                }
            }
        } catch (error) {
            console.error(
                "Unable to load AI data:",
                error
            );
        } finally {
            if (isMounted) {
                setMetricsLoading(false);
            }
        }
    };

    const loadActivePlan = async (isInitial = false) => {
        try {
            const response = await getActivePlan();

            if (response?.success) {
                const outP = response.outwardPlan || null;
                const inP = response.inwardPlan || null;
                setOutwardPlan(outP);
                setInwardPlan(inP);

                try {
                    if (outP) localStorage.setItem("active_outward_plan", JSON.stringify(outP));
                    else localStorage.removeItem("active_outward_plan");
                    if (inP) localStorage.setItem("active_inward_plan", JSON.stringify(inP));
                    else localStorage.removeItem("active_inward_plan");
                } catch {
                    // Ignore quota error
                }

                const activePlan = response.plan || inP || outP || null;

                if (activePlan) {
                    setPlanData(activePlan);
                    const activeDir = activePlan.direction || (activePlan.tripMode === "FROM_SOURCE" || activePlan.tripMode === "OUTWARD" ? "OUTWARD" : "INWARD");
                    setPlanDirectionTab(activeDir);

                    try {
                        localStorage.setItem("active_ai_plan", JSON.stringify(activePlan));
                    } catch {
                        // Ignore quota error
                    }

                    // Restore endpoint ONLY on initial hydration if user has not yet interacted
                    if (isInitial && !userInteractedRef.current) {
                        const hasPlanSource = activePlan.source && hasValidCoordinates(activePlan.source);
                        const hasPlanDest = activePlan.destination && hasValidCoordinates(activePlan.destination);
                        const hasPlanStart = activePlan.startingPoint && hasValidCoordinates(activePlan.startingPoint);

                        if (activePlan.tripMode === "FROM_SOURCE" || (hasPlanSource && !hasPlanDest)) {
                            if (hasPlanSource) {
                                setSourceLocation(activePlan.source);
                                setDestinationLocation(null);
                                setActiveEndpointField("source");
                                setTripMode("FROM_SOURCE");
                            }
                        } else if (activePlan.tripMode === "TO_DESTINATION" || hasPlanDest || hasPlanStart) {
                            const dest = hasPlanDest ? activePlan.destination : (hasPlanStart ? activePlan.startingPoint : null);
                            if (dest) {
                                setDestinationLocation(dest);
                                setSourceLocation(null);
                                setActiveEndpointField("destination");
                                setTripMode("TO_DESTINATION");
                            }
                        } else if (hasPlanSource) {
                            setSourceLocation(activePlan.source);
                            setDestinationLocation(null);
                            setActiveEndpointField("source");
                            setTripMode("FROM_SOURCE");
                        }
                    }
                } else {
                    localStorage.removeItem("active_ai_plan");
                    localStorage.removeItem("active_ai_selection");
                    setPlanData(null);
                    setSelectedPlanType((prev) => (prev === "AI" ? "" : prev));
                }
            } else {
                localStorage.removeItem("active_ai_plan");
                localStorage.removeItem("active_ai_selection");
                localStorage.removeItem("active_outward_plan");
                localStorage.removeItem("active_inward_plan");
                setPlanData(null);
                setOutwardPlan(null);
                setInwardPlan(null);
                setSelectedPlanType((prev) => (prev === "AI" ? "" : prev));
            }
        } catch (error) {
            console.error(
                "Unable to load active AI plan:",
                error
            );
        }
    };

    const loadManualRoutes = async (targetDirection = null) => {
        try {
            setManualRoutesLoading(true);
            const currentDir = targetDirection || manualPlanDirection || planDirectionTab || (tripMode === "FROM_SOURCE" ? "OUTWARD" : "INWARD");

            const [routesRes, planRes] = await Promise.allSettled([
                getManualRoutes(),
                getManualPlan({ direction: currentDir })
            ]);

            if (routesRes.status === "fulfilled") {
                const allRoutes = normalizeManualRoutes(routesRes.value);
                const filtered = allRoutes.filter((r) => {
                    const d = (String(r.direction || "").toUpperCase().trim() === "OUTWARD") ? "OUTWARD" : "INWARD";
                    return d === currentDir && Boolean(r.assignedVehicle || r.vehicleName);
                });
                setManualRoutes(filtered);
            }
            if (planRes.status === "fulfilled" && planRes.value?.success) {
                setManualPlanData(planRes.value.plan);
            }
        } catch (error) {
            console.error(
                "Unable to load manual routes:",
                error
            );

            setManualRoutes([]);
            setManualPlanData(null);
        } finally {
            setManualRoutesLoading(false);
        }
    };

    const handleManualDirectionChange = (newDir) => {
        setManualPlanDirection(newDir);
        setPlanDirectionTab(newDir);
        setTripMode(newDir === "OUTWARD" ? "FROM_SOURCE" : "TO_DESTINATION");
        loadManualRoutes(newDir);
        loadLastSelection(newDir);
    };

    // Automatically synchronize manual plan and late response draft whenever selected direction changes
    useEffect(() => {
        if (initialHydratedRef.current) {
            loadManualRoutes(planDirectionTab);
            loadLateResponseDraft(planDirectionTab);
        }
    }, [planDirectionTab]);

    const handleApproveAdminManualPlan = async () => {
        const currentDir = manualPlanDirection || planDirectionTab || (tripMode === "FROM_SOURCE" ? "OUTWARD" : "INWARD");
        try {
            setManualPlanApproving(true);
            const res = await approveManualPlan({ direction: currentDir });
            if (res?.success) {
                toast.success(res.message || `Admin manual ${currentDir} transportation plan approved and allocations published!`);
                const updatedPlan = res.plan || { ...manualPlanData, isApproved: true };
                setManualPlanData(updatedPlan);

                const selObj = {
                    planType: "ADMIN",
                    direction: currentDir,
                    selectedAt: new Date()
                };
                setLastSelection(selObj);
                setSelectedPlanType("ADMIN");

                try {
                    localStorage.setItem("active_ai_selection", JSON.stringify(selObj));
                    const approvedPlan = { ...updatedPlan, isApproved: true, direction: currentDir };
                    localStorage.setItem("active_ai_plan", JSON.stringify(approvedPlan));
                    if (currentDir === "OUTWARD") {
                        localStorage.setItem("active_outward_plan", JSON.stringify(approvedPlan));
                        setOutwardPlan(approvedPlan);
                    } else {
                        localStorage.setItem("active_inward_plan", JSON.stringify(approvedPlan));
                        setInwardPlan(approvedPlan);
                    }
                } catch (e) {}

                await Promise.all([
                    loadManualRoutes(currentDir),
                    loadLastSelection(currentDir),
                    loadActivePlan(false),
                    fetchLateResponses()
                ]);
            }
        } catch (err) {
            console.error("Approve manual plan error:", err);
            toast.error(err.response?.data?.message || err.message || "Failed to approve manual plan.");
        } finally {
            setManualPlanApproving(false);
        }
    };

    const handleResetAdminManualPlan = async () => {
        const currentDir = manualPlanDirection || planDirectionTab || (tripMode === "FROM_SOURCE" ? "OUTWARD" : "INWARD");
        const confirmReset = window.confirm(
            `Are you sure you want to reset the ${currentDir} manual transportation plan?\n\n` +
            `• Only the ${currentDir} manual plan and its student bus allocations will be reset.\n` +
            `• The opposite direction will remain intact and approved.\n` +
            `• Affected students will return to 'Not Assigned' until you approve again.\n` +
            `• Student locked travel responses ('Coming') will remain preserved.`
        );
        if (!confirmReset) return;

        try {
            setManualPlanApproving(true);
            const res = await resetManualPlan({ direction: currentDir });
            if (res?.success) {
                toast.success(res.message || `${currentDir} manual plan reset successfully.`);
                await Promise.all([
                    loadManualRoutes(currentDir),
                    loadLastSelection(currentDir),
                    loadActivePlan(false)
                ]);
            }
        } catch (err) {
            console.error("Reset manual plan error:", err);
            toast.error(err.response?.data?.message || err.message || "Failed to reset manual plan.");
        } finally {
            setManualPlanApproving(false);
        }
    };

    const handleFetchManualRecommendations = async () => {
        const currentDir = manualPlanDirection || planDirectionTab || (tripMode === "FROM_SOURCE" ? "OUTWARD" : "INWARD");
        try {
            setRecommendationsLoading(true);
            const res = await getManualPlanRecommendations({ direction: currentDir });
            if (res?.success) {
                setManualRecommendations(res);
                setShowRecommendationsPanel(true);
                if (res.recommendations?.length > 0) {
                    toast.success(`Generated ${res.recommendations.length} AI recommendation(s) for ${currentDir} manual plan (Review Only).`);
                } else {
                    toast.success(`Analysis complete! 0 issues found for ${currentDir} manual plan.`);
                }
            } else {
                toast.error(res?.message || "Failed to generate AI recommendations.");
            }
        } catch (err) {
            console.error("AI Recommendation error:", err);
            toast.error(err.response?.data?.message || err.message || "Failed to generate AI recommendations.");
        } finally {
            setRecommendationsLoading(false);
        }
    };

    const loadLastSelection = async (targetDirection = null) => {
        try {
            const currentDir = targetDirection || planDirectionTab || (tripMode === "FROM_SOURCE" ? "OUTWARD" : "INWARD");
            const response = await getSelectedPlan({ direction: currentDir });

            if (response?.success) {
                const dirSelection = (currentDir === "OUTWARD" ? response.outwardSelection : response.inwardSelection) || response.selection;
                const activeApproved = Boolean(currentDir === "OUTWARD" ? outwardPlan?.isApproved : inwardPlan?.isApproved);

                if (dirSelection) {
                    setLastSelection(dirSelection);
                    setSelectedPlanType(dirSelection.planType || "AI");
                    try {
                        localStorage.setItem("active_ai_selection", JSON.stringify(dirSelection));
                    } catch {
                        // Ignore quota error
                    }
                } else if (activeApproved) {
                    setSelectedPlanType("AI");
                }
            }
        } catch (error) {
            console.error(
                "Unable to load selected plan:",
                error
            );
        }
    };

    const [optStage, setOptStage] = useState(1);
    const [optStatusMessage, setOptStatusMessage] =
        useState("Analyzing confirmed demand...");
    const stageTimersRef = useRef([]);

    const handleSourceSelect = (location) => {
        userInteractedRef.current = true;
        setSourceLocation(location);
        setDestinationLocation(null);
        setActiveEndpointField("source");
        setTripMode("FROM_SOURCE");
        setPlanDirectionTab("OUTWARD");
        setGenerationError("");
    };

    const handleDestinationSelect = (location) => {
        userInteractedRef.current = true;
        setDestinationLocation(location);
        setSourceLocation(null);
        setActiveEndpointField("destination");
        setTripMode("TO_DESTINATION");
        setPlanDirectionTab("INWARD");
        setGenerationError("");
    };

    const handleSourceClear = () => {
        userInteractedRef.current = true;
        setSourceLocation(null);
        setActiveEndpointField(destinationLocation ? "destination" : null);
        setGenerationError("");
    };

    const handleDestinationClear = () => {
        userInteractedRef.current = true;
        setDestinationLocation(null);
        setActiveEndpointField(sourceLocation ? "source" : null);
        setGenerationError("");
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
                "No confirmed travel demand available. Students must confirm their travel status before an AI route can be generated.";

            setGenerationError(
                zeroDemandMsg
            );

            toast.error(
                "No confirmed travel demand available."
            );

            return;
        }

        const hasSource = hasValidCoordinates(sourceLocation);
        const hasDestination = hasValidCoordinates(destinationLocation);
        const endpointCount = Number(hasSource) + Number(hasDestination);

        if (endpointCount === 0) {
            const msg = "Set a Source or Destination before generating an AI route.";
            setGenerationError(msg);
            toast.error(msg);
            return;
        }

        // When both Source and Destination are set, determine direction from active selection tab
        let effectiveTripMode = "TO_DESTINATION";
        if (hasSource && !hasDestination) {
            effectiveTripMode = "FROM_SOURCE";
        } else if (hasDestination && !hasSource) {
            effectiveTripMode = "TO_DESTINATION";
        } else if (activeEndpointField === "source" || planDirectionTab === "OUTWARD") {
            effectiveTripMode = "FROM_SOURCE";
        } else {
            effectiveTripMode = "TO_DESTINATION";
        }

        setTripMode(effectiveTripMode);
        setActiveEndpointField(effectiveTripMode === "FROM_SOURCE" ? "source" : "destination");
        const isOutward = effectiveTripMode === "FROM_SOURCE";

        try {
            setGenerating(true);
            setOptStage(1);
            setOptStatusMessage("Analyzing confirmed passenger demand...");
            setGenerationError("");
            setSelectionMessage("");
            setResetSuccessMessage("");

            // Clear previous timers
            stageTimersRef.current.forEach(clearTimeout);
            stageTimersRef.current = [];

            if (isOutward) {
                const sourceName = sourceLocation?.name || "Source";
                const t1 = setTimeout(() => {
                    setOptStage(2);
                    setOptStatusMessage("Mapping residential stopping areas & density clusters...");
                }, 350);

                const t2 = setTimeout(() => {
                    setOptStage(3);
                    setOptStatusMessage(`Building outward route from ${sourceName}...`);
                }, 750);

                const t3 = setTimeout(() => {
                    setOptStage(4);
                    setOptStatusMessage("Ordering residential drop-off stops & 2-Opt road sequence...");
                }, 1200);

                const t4 = setTimeout(() => {
                    setOptStage(5);
                    setOptStatusMessage("Optimizing continuous road progression & capacity balancing...");
                }, 1700);

                stageTimersRef.current.push(t1, t2, t3, t4);
            } else {
                const destName = destinationLocation?.name || "Destination";
                const t1 = setTimeout(() => {
                    setOptStage(2);
                    setOptStatusMessage("Mapping residential stopping areas & density clusters...");
                }, 350);

                const t2 = setTimeout(() => {
                    setOptStage(3);
                    setOptStatusMessage(`Building inward route toward ${destName}...`);
                }, 750);

                const t3 = setTimeout(() => {
                    setOptStage(4);
                    setOptStatusMessage("Ordering residential pickup stops & 2-Opt sequence...");
                }, 1200);

                const t4 = setTimeout(() => {
                    setOptStage(5);
                    setOptStatusMessage("Optimizing continuous road progression & capacity balancing...");
                }, 1700);

                stageTimersRef.current.push(t1, t2, t3, t4);
            }

            const payload = {
                direction: isOutward ? "OUTWARD" : "INWARD",
                tripMode: effectiveTripMode,
                activeEndpoint: isOutward ? "source" : "destination",
                source: hasSource ? sourceLocation : null,
                destination: hasDestination ? destinationLocation : null
            };

            const response = await generateRecommendations(payload);

            if (!response?.success) {
                throw new Error(
                    response?.message || "Unable to generate AI plan."
                );
            }

            // Stage 6 validation
            setOptStage(6);
            setOptStatusMessage(
                isOutward
                    ? "Validating 100% demand coverage and outward continuity..."
                    : "Validating 100% demand coverage and inward continuity..."
            );

            // Brief validation transition
            await new Promise((r) => setTimeout(r, 400));

            userInteractedRef.current = true;
            setPlanData(response);
            if (isOutward) {
                setOutwardPlan(response);
                setPlanDirectionTab("OUTWARD");
            } else {
                setInwardPlan(response);
                setPlanDirectionTab("INWARD");
            }

            try {
                localStorage.setItem("active_ai_plan", JSON.stringify(response));
            } catch {
                // Ignore storage quota errors
            }
            setSelectedPlanType("");

            if (response?.status === "ZERO_DEMAND" || response?.comingUsers === 0) {
                toast("No confirmed passengers available for route generation.", {
                    icon: "ℹ️"
                });
            } else {
                toast.success(
                    "AI route plan generated and validated successfully."
                );
            }

            await loadAIData();
        } catch (error) {
            console.error(
                "AI plan generation error:",
                error
            );

            stageTimersRef.current.forEach(clearTimeout);
            stageTimersRef.current = [];

            setPlanData(null);

            setGenerationError(
                error?.response?.data?.message ||
                error?.message ||
                "Unable to generate AI route plan."
            );
        } finally {
            stageTimersRef.current.forEach(clearTimeout);
            stageTimersRef.current = [];
            setGenerating(false);
        }
    };

    const handleConfirmReset = async () => {
        try {
            setResetting(true);

            const targetDirection = planDirectionTab || (tripMode === "FROM_SOURCE" ? "OUTWARD" : "INWARD");
            const response =
                await resetAIPlan({ direction: targetDirection });

            if (response?.success) {
                userInteractedRef.current = true;
                setShowResetModal(false);

                if (targetDirection === "INWARD") {
                    setInwardPlan(null);
                    try { localStorage.removeItem("active_inward_plan"); } catch {}
                    if (outwardPlan) {
                        setPlanData(outwardPlan);
                        setPlanDirectionTab("OUTWARD");
                        setActiveEndpointField("source");
                        setTripMode("FROM_SOURCE");
                    } else {
                        localStorage.removeItem("active_ai_plan");
                        localStorage.removeItem("active_ai_selection");
                        setPlanData(null);
                        setSelectedPlanType("");
                        setLastSelection(null);
                    }
                } else if (targetDirection === "OUTWARD") {
                    setOutwardPlan(null);
                    try { localStorage.removeItem("active_outward_plan"); } catch {}
                    if (inwardPlan) {
                        setPlanData(inwardPlan);
                        setPlanDirectionTab("INWARD");
                        setActiveEndpointField("destination");
                        setTripMode("TO_DESTINATION");
                    } else {
                        localStorage.removeItem("active_ai_plan");
                        localStorage.removeItem("active_ai_selection");
                        setPlanData(null);
                        setSelectedPlanType("");
                        setLastSelection(null);
                    }
                } else {
                    localStorage.removeItem("active_ai_plan");
                    localStorage.removeItem("active_ai_selection");
                    localStorage.removeItem("active_outward_plan");
                    localStorage.removeItem("active_inward_plan");
                    setPlanData(null);
                    setOutwardPlan(null);
                    setInwardPlan(null);
                    setSelectedPlanType("");
                    setLastSelection(null);
                }

                setGenerationError("");
                setSelectionMessage("");

                const dirName = targetDirection === "INWARD" ? "Inward" : targetDirection === "OUTWARD" ? "Outward" : "AI";
                const msg =
                    `${dirName} route recommendation reset successfully. Student travel responses remain preserved.`;

                setResetSuccessMessage(msg);

                toast.success(msg);
                setResetting(false);
                loadAIData(); // Refresh in background without delaying reset feedback
                fetchLateResponses(); // Update late response counts immediately
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
        const selectedPlan = planData?.aiPlan || (Array.isArray(planData?.buses) ? planData : null);
        if (!selectedPlan) {
            toast.error("Please generate an AI plan first.");
            return;
        }

        setSelectedPlanType("AI");
        setSelectionMessage("");
    };

    const handleSelectAdminPlan = () => {
        const availableCount = displayedManualRoutes.length || manualRoutes.length;
        if (!availableCount) {
            toast.error("No assigned manual routes available to select.");
            return;
        }

        setSelectedPlanType("ADMIN");
        setSelectionMessage("");
    };

    const handleSaveFinalPlan = async () => {
        if (savingSelection) {
            return;
        }

        const effectivePlanType = selectedPlanType || (isPlanSaved ? (lastSelection?.planType || "AI") : null);
        if (!effectivePlanType) {
            toast.error("Please select a transportation plan (Option 1 or Option 2) first.");
            return;
        }

        const selectedPlan =
            effectivePlanType === "AI"
                ? planData?.aiPlan || (Array.isArray(planData?.buses) ? planData : null)
                : (manualPlanData || { routes: manualRoutes });


        if (!selectedPlan) {
            toast.error("Please generate or select a valid plan first.");
            return;
        }

        try {
            setSavingSelection(true);
            setSelectionMessage("Publishing transportation plan & assigning confirmed passengers...");

            const planDirection =
                planDirectionTab ||
                planData?.direction ||
                (tripMode === "FROM_SOURCE" ? "OUTWARD" : "INWARD");

            const response = await saveSelectedPlan({
                planType: effectivePlanType,
                direction: planDirection,
                tripMode: tripMode,
                plan: selectedPlan,
                startingPoint:
                    planData?.startingPoint ||
                    sourceLocation ||
                    destinationLocation ||
                    null
            });

            if (response?.success) {
                const selObj = response.selection || {
                    planType: effectivePlanType,
                    direction: planDirection,
                    selectedAt: new Date()
                };
                setLastSelection(selObj);
                setSelectedPlanType(effectivePlanType);

                try {
                    localStorage.setItem("active_ai_selection", JSON.stringify(selObj));
                    const currentPlan = (effectivePlanType === "ADMIN" || effectivePlanType === "MANUAL")
                        ? (response?.plan || selectedPlan)
                        : (planData || (effectivePlanType === "AI" ? selectedPlan : null));
                    if (currentPlan) {
                        const approvedPlan = { ...currentPlan, isApproved: true, direction: planDirection };
                        localStorage.setItem("active_ai_plan", JSON.stringify(approvedPlan));
                        if (planDirection === "OUTWARD") {
                            localStorage.setItem("active_outward_plan", JSON.stringify(approvedPlan));
                            setOutwardPlan(approvedPlan);
                        } else {
                            localStorage.setItem("active_inward_plan", JSON.stringify(approvedPlan));
                            setInwardPlan(approvedPlan);
                        }
                    }
                } catch {
                    // Ignore quota errors
                }

                const msg = `${effectivePlanType === "AI" ? "AI Recommended" : "Admin Manual"} transportation plan confirmed and saved until reset!`;
                setSelectionMessage(msg);
                toast.success(msg);
                await Promise.all([loadAIData(), loadActivePlan(false), loadLastSelection(planDirection), fetchLateResponses(), loadManualRoutes(planDirection)]);
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

            const err = error?.response?.data?.message || error?.message || "Unable to save final plan.";
            setSelectionMessage(err);
            toast.error(err);
        } finally {
            setSavingSelection(false);
        }
    };

    const summary = {
        totalUsers:
            data?.userCount ||
            data?.totalUsers ||
            0,

        confirmedUsers:
            data?.confirmedUserCount ??
            data?.comingUsers ??
            data?.confirmedUsers ??
            0,

        vehicles:
            data?.vehicleCount ||
            data?.vehicles?.length ||
            0,

        availableVehicles:
            data?.availableVehicleCount ||
            data?.availableVehicles?.length ||
            0,

        totalAvailableCapacity:
            data?.totalAvailableCapacity ||
            0,

        totalPhysicalCapacity:
            data?.totalPhysicalCapacity ||
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
            0,

        uniqueStoppingAreas:
            data?.stopCount ||
            data?.stops?.length ||
            0
    };

    const availableVehiclesCount = Number(
        summary?.availableVehicles ??
        summary?.availableVehicleCount ??
        data?.availableVehicleCount ??
        data?.availableVehicles?.length ??
        summary?.vehicles ??
        0
    );

    const aiPlan = planData?.aiPlan || (Array.isArray(planData?.buses) ? planData : null);

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

    const currentDemandCount = Number(
        data?.confirmedUserCount ?? data?.comingUsers ?? 0
    );
    const planDemandCount = planData?.summary?.confirmedUsers ?? planData?.comingUsers ?? null;
    const hasActivePlan = Boolean(aiPlan || planData?.buses?.length > 0 || (planData?.summary && planData.summary.allocatedSeats > 0));
    const isPlanInvalidated = Boolean(
        hasActivePlan &&
        planDemandCount !== null &&
        currentDemandCount > 0 &&
        planDemandCount !== currentDemandCount
    );

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
                    <div className={`ai-ready ${
                        generating
                            ? "generating"
                            : generationError
                            ? "error"
                            : isPlanInvalidated
                            ? "invalidated"
                            : hasActivePlan
                            ? "generated"
                            : "ready"
                    }`}>
                        <span className="ready-dot"></span>
                        {generating
                            ? "Generating optimized route..."
                            : generationError
                            ? "Route generation failed"
                            : isPlanInvalidated
                            ? "Route requires regeneration"
                            : hasActivePlan
                            ? "AI Route Generated"
                            : "AI Engine Ready"}
                    </div>

                    <button
                        type="button"
                        className="reset-ai-route-btn"
                        onClick={() =>
                            setShowResetModal(true)
                        }
                        title="Reset AI Generated Route recommendation"
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

            {/* State Invalidation Alert Banner */}
            {isPlanInvalidated && (
                <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    background: "#fffbeb",
                    border: "1.5px solid #fde68a",
                    borderRadius: "12px",
                    padding: "14px 18px",
                    marginBottom: "24px",
                    color: "#92400e"
                }}>
                    <span style={{ fontSize: "22px" }}>⚠️</span>
                    <div style={{ flex: 1 }}>
                        <strong style={{ fontSize: "14px", display: "block", marginBottom: "2px" }}>Route Data Has Changed — Regeneration Recommended</strong>
                        <p style={{ margin: 0, fontSize: "13px", color: "#78350f" }}>
                            Student travel responses or demand changed from <b>{planDemandCount}</b> to <b>{currentDemandCount}</b> confirmed passengers since this plan was generated. Click <b>⚡ Generate AI Plan</b> below to update vehicle allocation and routes.
                        </p>
                    </div>
                </div>
            )}

            {/* Top Statistics */}
            <section className="summary-grid">

                <div className="summary-card">
                    <span>👥</span>
                    <div>
                        {metricsLoading || !data ? (
                            <span className="metric-loading-text">Loading...</span>
                        ) : (
                            <strong>
                                {formatNumber(
                                    summary.totalUsers
                                )}
                            </strong>
                        )}
                        <small>
                            Total Users
                        </small>
                    </div>
                </div>

                <div className="summary-card coming">
                    <span>🟢</span>
                    <div>
                        {metricsLoading || !data ? (
                            <span className="metric-loading-text">Loading...</span>
                        ) : (
                            <strong>
                                {formatNumber(
                                    summary.confirmedUsers
                                )}
                            </strong>
                        )}
                        <small>
                            Coming Users (Demand)
                        </small>
                    </div>
                </div>

                <div className="summary-card">
                    <span>🚌</span>
                    <div>
                        {metricsLoading || !data ? (
                            <span className="metric-loading-text">Loading...</span>
                        ) : (
                            <strong>
                                {formatNumber(
                                    summary.vehicles
                                )}
                            </strong>
                        )}
                        <small>
                            Vehicles
                        </small>
                    </div>
                </div>

                <div className="summary-card available">
                    <span>🚍</span>
                    <div>
                        {metricsLoading || !data ? (
                            <span className="metric-loading-text">Loading...</span>
                        ) : (
                            <strong>
                                {formatNumber(
                                    availableVehiclesCount
                                )}
                            </strong>
                        )}
                        <small>
                            Available Vehicles
                        </small>
                    </div>
                </div>

                <div className="summary-card">
                    <span>🛣️</span>
                    <div>
                        {metricsLoading || !data ? (
                            <span className="metric-loading-text">Loading...</span>
                        ) : (
                            <strong>
                                {formatNumber(
                                    summary.routes
                                )}
                            </strong>
                        )}
                        <small>
                            Stored Routes
                        </small>
                    </div>
                </div>

                <div className="summary-card">
                    <span>📍</span>
                    <div>
                        {metricsLoading || !data ? (
                            <span className="metric-loading-text">Loading...</span>
                        ) : (
                            <strong>
                                {formatNumber(
                                    summary.uniqueStoppingAreas ||
                                    summary.stoppingAreas
                                )}
                            </strong>
                        )}
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
                            Trip Endpoint
                        </h2>

                        <p>
                            Provide the location where the transportation route is anchored. Setting a <strong>Source</strong> generates an <strong>Outward route</strong> departing to residential drop-offs; setting a <strong>Destination</strong> generates an <strong>Inward route</strong> collecting from residential pickups.
                        </p>
                    </div>

                    {/* SOURCE */}
                    <div className={`trip-endpoint-card source-card ${sourceLocation ? "active-endpoint" : ""}`}>

                        <div className="endpoint-label">
                            <span className="endpoint-icon source-icon">
                                🚌
                            </span>

                            <div>
                                <strong>
                                    Source / Departure Point
                                </strong>

                                <small>
                                    Used when buses begin the journey and travel outward through residential drop-off areas. (e.g. college, school, company, depot, station, city)
                                </small>
                            </div>

                            {sourceLocation && (
                                <span className="endpoint-badge source-badge">
                                    Set (Outward Route)
                                </span>
                            )}
                        </div>

                        <div className="search-box-row">
                            <LocationSearchBox
                                placeholder="Search departure: campus, office, depot, station, street, city..."
                                selectedLocation={
                                    sourceLocation
                                }
                                onSelectLocation={handleSourceSelect}
                                onClear={handleSourceClear}
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

                                <span className="selected-badge">
                                    Outward Departure Hub
                                </span>
                            </div>
                        )}

                    </div>

                    {/* DESTINATION */}
                    <div className={`trip-endpoint-card destination-card ${destinationLocation ? "active-endpoint" : ""}`}>

                        <div className="endpoint-label">
                            <span className="endpoint-icon destination-icon">
                                🏛️
                            </span>

                            <div>
                                <strong>
                                    Destination / Arrival Hub
                                </strong>

                                <small>
                                    Used when buses travel inward from residential pickup areas toward the destination. (e.g. college, school, company, hospital, landmark)
                                </small>
                            </div>

                            {destinationLocation && (
                                <span className="endpoint-badge destination-badge">
                                    Set (Inward Route)
                                </span>
                            )}
                        </div>

                        <div className="search-box-row">
                            <LocationSearchBox
                                placeholder="Search arrival: college, university, company, hospital, office, landmark, city..."
                                selectedLocation={
                                    destinationLocation
                                }
                                onSelectLocation={handleDestinationSelect}
                                onClear={handleDestinationClear}
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
                                    Inward Arrival Hub
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
                                    {sourceLocation && !destinationLocation
                                        ? `OUTWARD ROUTE: Source (${sourceLocation.name}) → Residential Drop-off Network`
                                        : destinationLocation && !sourceLocation
                                            ? `INWARD ROUTE: Residential Pickup Network → Destination (${destinationLocation.name})`
                                            : "Set a Source (departure point) or Destination (arrival hub) to generate continuous bus routes."}
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
                                (!hasValidCoordinates(sourceLocation) && !hasValidCoordinates(destinationLocation)) ||
                                summary.confirmedUsers === 0
                            }
                        >
                            {generating
                                ? "⚡ Optimizing Transportation Network..."
                                : summary.confirmedUsers ===
                                    0
                                    ? "⚠️ No Confirmed Students (Demand: 0)"
                                    : "⚡ Generate AI Route"}
                        </button>

                        <div className="generation-steps">

                            <div>
                                <b>1</b>
                                <span>
                                    Demand Analysis &amp;
                                    passenger counts
                                </span>
                            </div>

                            <div>
                                <b>2</b>
                                <span>
                                    Stopping Area Mapping
                                    &amp; density clusters
                                </span>
                            </div>

                            <div>
                                <b>3</b>
                                <span>
                                    Vehicle Capacity &amp;
                                    schedule availability
                                </span>
                            </div>

                            <div>
                                <b>4</b>
                                <span>
                                    Road Network 2-Opt
                                    continuity optimization
                                </span>
                            </div>

                            <div>
                                <b>5</b>
                                <span>
                                    Route Consolidation
                                    &amp; capacity balancing
                                </span>
                            </div>

                            <div>
                                <b>6</b>
                                <span>
                                    Final Validation &amp;
                                    100% demand coverage
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

                    {/* Dedicated Optimization Workspace */}
                    {generating && (
                        <OptimizationWorkspace
                            currentStage={optStage}
                            statusMessage={optStatusMessage}
                            summary={{
                                ...summary,
                                availableVehicles: availableVehiclesCount
                            }}
                            sourceName={sourceLocation?.name}
                            destinationName={destinationLocation?.name}
                            tripMode={tripMode}
                        />
                    )}

                    {/* Section-Level Saved AI Plan Loader */}
                    {!aiPlan && !generating && loading && (
                        <div className="empty-ai-box">
                            <span className="spinner" style={{ width: 28, height: 28 }}></span>
                            <div className="empty-ai-text">
                                <h3>Loading saved AI plan...</h3>
                                <p>Retrieving optimized routes and vehicle allocations from database.</p>
                            </div>
                        </div>
                    )}

                    {/* Zero Demand State */}
                    {!aiPlan &&
                        !generating &&
                        !loading &&
                        summary.confirmedUsers ===
                        0 && (
                            <div className="empty-ai-box zero-demand-box">

                                <span className="empty-ai-icon">
                                    ⚠️
                                </span>

                                <div className="empty-ai-text">

                                    <h3>
                                        No confirmed travel demand available.
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

                    {/* Ready to Generate State */}
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
                                        plan generated yet.
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
                                            ⚡ Generate AI Route
                                        </strong>{" "}
                                        to calculate, optimize, and validate a continuous route recommendation for{" "}
                                        <strong>
                                            {
                                                summary.confirmedUsers
                                            }{" "}
                                            confirmed passengers
                                        </strong>.
                                    </p>

                                </div>

                            </div>
                        )}

                    {/* Zero Demand Payload Box */}
                    {planData?.status === "ZERO_DEMAND" && !generating && (
                        <div
                            style={{
                                padding: "36px 20px",
                                textAlign: "center",
                                background: "#f8fafc",
                                borderRadius: "12px",
                                border: "1.5px dashed #cbd5e1",
                                margin: "20px 0"
                            }}
                        >
                            <div style={{ fontSize: "36px", marginBottom: "10px" }}>👥</div>
                            <h4 style={{ color: "#334155", fontWeight: "700", marginBottom: "6px" }}>No Confirmed Passengers</h4>
                            <p style={{ color: "#64748b", maxWidth: "520px", margin: "0 auto", fontSize: "14px" }}>
                                No confirmed travel demand available. Students must confirm their travel status ("Coming") before AI routes can be generated.
                            </p>
                        </div>
                    )}

                    {/* Independent Outward & Inward Plan Switcher */}
                    {(outwardPlan || inwardPlan) && !generating && (
                        <div style={{
                            display: "flex",
                            gap: "12px",
                            margin: "20px 0 16px 0",
                            padding: "6px",
                            background: "#f1f5f9",
                            borderRadius: "10px",
                            width: "fit-content"
                        }} id="plan-direction-tab-bar">
                            <button
                                type="button"
                                id="btn-tab-inward-plan"
                                onClick={() => {
                                    if (inwardPlan) {
                                        setPlanData(inwardPlan);
                                        setPlanDirectionTab("INWARD");
                                        setActiveEndpointField("destination");
                                        setTripMode("TO_DESTINATION");
                                        loadLastSelection("INWARD");
                                    }
                                }}
                                style={{
                                    padding: "8px 18px",
                                    borderRadius: "8px",
                                    border: "none",
                                    fontWeight: "700",
                                    fontSize: "13px",
                                    cursor: inwardPlan ? "pointer" : "not-allowed",
                                    background: planDirectionTab === "INWARD" ? "#0284c7" : "transparent",
                                    color: planDirectionTab === "INWARD" ? "#ffffff" : (inwardPlan ? "#334155" : "#94a3b8"),
                                    boxShadow: planDirectionTab === "INWARD" ? "0 2px 4px rgba(0,0,0,0.1)" : "none",
                                    transition: "all 0.2s"
                                }}
                            >
                                Inward Plan {inwardPlan ? "✓" : "(Not Generated)"}
                            </button>
                            <button
                                type="button"
                                id="btn-tab-outward-plan"
                                onClick={() => {
                                    if (outwardPlan) {
                                        setPlanData(outwardPlan);
                                        setPlanDirectionTab("OUTWARD");
                                        setActiveEndpointField("source");
                                        setTripMode("FROM_SOURCE");
                                        loadLastSelection("OUTWARD");
                                    }
                                }}
                                style={{
                                    padding: "8px 18px",
                                    borderRadius: "8px",
                                    border: "none",
                                    fontWeight: "700",
                                    fontSize: "13px",
                                    cursor: outwardPlan ? "pointer" : "not-allowed",
                                    background: planDirectionTab === "OUTWARD" ? "#7c3aed" : "transparent",
                                    color: planDirectionTab === "OUTWARD" ? "#ffffff" : (outwardPlan ? "#334155" : "#94a3b8"),
                                    boxShadow: planDirectionTab === "OUTWARD" ? "0 2px 4px rgba(0,0,0,0.1)" : "none",
                                    transition: "all 0.2s"
                                }}
                            >
                                Outward Plan {outwardPlan ? "✓" : "(Not Generated)"}
                            </button>
                        </div>
                    )}

                    {/* Plan Result Summary & Details */}
                    {aiPlan && !generating && (
                        <>
                            <OptimizationResultSummary
                                plan={planData}
                                summary={summary}
                                onViewRoute={() => setShowSelectRouteModal(true)}
                            />

                            <div className="ai-plan-result" id="ai-plan-result-section">

                                {/* Plan Meta */}
                            <div className="plan-meta-bar">

                                <div className="plan-title-col">
                                    <h3>
                                        {aiPlan.title ||
                                            "AI Recommended Continuous Route Plan"}
                                    </h3>


                                </div>

                                <span className="timestamp-badge">
                                    Generated:{" "}
                                    {aiPlan.createdAt
                                        ? new Date(
                                            aiPlan.createdAt
                                        ).toLocaleTimeString(
                                            [],
                                            {
                                                hour: "2-digit",
                                                minute: "2-digit"
                                            }
                                        )
                                        : "Just now"}
                                </span>

                            </div>

                            {/* Optimization Checklist */}
                            <div className="optimization-checklist">

                                <div className="check-item">
                                    ✓{" "}
                                    <b>
                                        {aiPlan.allocatedUsers ?? aiPlan.assignedUsers ?? aiAssigned}
                                    </b>{" "}
                                    coming users allocated
                                    {(aiPlan.unassignedUsers ?? aiUnassigned) > 0
                                        ? ` (${aiPlan.unassignedUsers ?? aiUnassigned} unallocated, ${aiPlan.duplicateUsers || 0} duplicates)`
                                        : ` (0 unallocated, 0 duplicates)`}
                                </div>

                                <div className="check-item">
                                    ✓{" "}
                                    <b>
                                        {
                                            aiPlan.availableVehicleCount ||
                                            summary.availableVehicles
                                        }
                                    </b>{" "}
                                    available vehicles
                                    evaluated (
                                    <b>
                                        {aiBuses.length}
                                    </b>{" "}
                                    allocated)
                                </div>

                                <div className="check-item">
                                    {aiBuses.every((b) => b.isRoadVerified)
                                        ? "✓ Road continuity & directional progress verified (OSRM)"
                                        : "⚠ Road network routing unavailable (Straight-line estimate)"}
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
                                    <span
                                        style={{
                                            display: "block",
                                            fontSize: "10px",
                                            color: (aiPlan.unassignedUsers ?? aiUnassigned) > 0 ? "#ef4444" : "#22c55e",
                                            marginTop: "2px"
                                        }}
                                    >
                                        {(aiPlan.allocatedUsers ?? aiPlan.assignedUsers ?? aiAssigned)} Allocated • {(aiPlan.unassignedUsers ?? aiUnassigned)} Unallocated
                                    </span>
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
                                        Seats Occupied
                                    </small>

                                    <span
                                        style={{
                                            display: "block",
                                            fontSize: "10px",
                                            color: "#94a3b8",
                                            marginTop: "2px"
                                        }}
                                    >
                                        {Math.max(0, aiCapacity - aiAssigned)} unused seats
                                    </span>
                                </div>

                                <div>
                                    <span>📊</span>

                                    <strong>
                                        {aiPlan.routeAllocationUtilization ?? aiUtilization}%
                                    </strong>

                                    <small>
                                        Route Seat Utilization
                                    </small>

                                    {(aiPlan.physicalFleetUtilization !== undefined || aiPlan.fleetUtilization !== undefined) && (
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
                                            Fleet Seat: {aiPlan.physicalFleetUtilization ?? aiPlan.fleetUtilization}%
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
                                    <span
                                        style={{
                                            display: "block",
                                            fontSize: "10px",
                                            color: "#94a3b8",
                                            marginTop: "2px"
                                        }}
                                    >
                                        {aiPlan.fleetVehicleUtilization !== undefined
                                            ? `${aiPlan.fleetVehicleUtilization}% fleet used (${aiBuses.length}/${aiPlan.availableVehicleCount || summary.availableVehicles})`
                                            : `of ${aiPlan.availableVehicleCount || summary.availableVehicles} available`}
                                    </span>
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
                                        background: "#f1f5f9",
                                        padding: "10px 14px",
                                        borderRadius: "8px",
                                        fontSize: "12px",
                                        color: "#334155",
                                        margin: "12px 0"
                                    }}
                                >
                                    ℹ️ <b>Stop Breakdown:</b> {summary.stopCountExplanation}
                                </div>
                            )}

                            {/* Capacity Shortage / Allocation Alerts */}
                            {aiUnassigned > 0 && (
                                <div className="capacity-shortage-alert">
                                    <div className="alert-header">
                                        <span>⚠</span>
                                        <strong>
                                            {aiPlan.unallocatedReason === "VEHICLE_CAPACITY"
                                                ? "TOTAL PHYSICAL FLEET CAPACITY EXCEEDED"
                                                : aiPlan.unallocatedReason === "SCHEDULE_CAPACITY"
                                                    ? "SCHEDULED FLEET CAPACITY RESTRICTION"
                                                    : aiPlan.unallocatedReason === "CORRIDOR_CAPACITY"
                                                        ? "CORRIDOR SEAT ALLOCATION RESTRICTION"
                                                        : "PASSENGER ALLOCATION RESTRICTION"}
                                        </strong>
                                    </div>

                                    <p>
                                        {aiPlan.unallocatedReason === "VEHICLE_CAPACITY" ? (
                                            <>
                                                Passenger demand exceeds total fleet capacity: <b>{aiPlan.comingUsers}</b> coming users vs <b>{aiPlan.physicalFleetCapacity || aiAvailableCapacity}</b> total physical fleet seats. <b>{aiUnassigned}</b> users could not be allocated.
                                            </>
                                        ) : aiPlan.unallocatedReason === "SCHEDULE_CAPACITY" ? (
                                            <>
                                                Active schedule limits available fleet capacity to <b>{aiAvailableCapacity}</b> seats for <b>{aiPlan.comingUsers}</b> coming users. <b>{aiUnassigned}</b> users could not be scheduled.
                                            </>
                                        ) : (
                                            <>
                                                <b>{aiUnassigned}</b> passengers could not be assigned to available routes due to corridor/bus capacity constraints. Total fleet capacity is <b>{aiPlan.physicalFleetCapacity || aiAvailableCapacity}</b> seats (<b>{aiAvailableCapacity}</b> scheduled) for <b>{aiPlan.comingUsers}</b> coming users.
                                            </>
                                        )}
                                    </p>

                                    <div className="shortage-recommendations">
                                        <strong>AI Recommendations:</strong>
                                        <ul>
                                            <li>Mark another bus as "Available" in Schedule Management.</li>
                                            <li>Add an additional vehicle to the fleet in Vehicle Management.</li>
                                            <li>Schedule a second trip for high-capacity corridors.</li>
                                        </ul>
                                    </div>
                                </div>
                            )}

                            {aiUnassigned === 0 && (
                                <div className="success-box">
                                    ✓ All {aiPlan.comingUsers} confirmed passengers successfully accommodated within vehicle seat limits
                                    {aiBuses.every((b) => b.isRoadVerified) ? " with road continuity verified." : " (road network offline, straight-line distance computed)."}
                                </div>
                            )}

                            {/* AI Recommendations */}
                            {Array.isArray(aiPlan.recommendationsList) &&
                                aiPlan.recommendationsList.length > 0 && (
                                    <div className="ai-insights-box">
                                        <strong>🧠 AI Route Consolidation &amp; Insights:</strong>
                                        <ul>
                                            {aiPlan.recommendationsList.map((rec, idx) => (
                                                <li key={idx}>{rec}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                            {/* Route Consolidation Audit Trail */}
                            {Array.isArray(aiPlan.consolidationAudit) &&
                                aiPlan.consolidationAudit.length > 0 && (
                                    <div className="ai-insights-box" style={{ borderLeft: "3px solid #6366f1", background: "#f8fafc", marginTop: "12px" }}>
                                        <strong>📋 Route Consolidation Audit Trail:</strong>
                                        <div style={{ overflowX: "auto", marginTop: "8px" }}>
                                            <table style={{ width: "100%", fontSize: "12px", borderCollapse: "collapse" }}>
                                                <thead>
                                                    <tr style={{ borderBottom: "1px solid #cbd5e1", textAlign: "left", color: "#475569" }}>
                                                        <th style={{ padding: "6px 8px" }}>Source</th>
                                                        <th style={{ padding: "6px 8px" }}>Destination</th>
                                                        <th style={{ padding: "6px 8px" }}>Pax Moved</th>
                                                        <th style={{ padding: "6px 8px" }}>Before / After Seats</th>
                                                        <th style={{ padding: "6px 8px" }}>Reason</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {aiPlan.consolidationAudit.map((audit, idx) => (
                                                        <tr key={idx} style={{ borderBottom: "1px solid #e2e8f0" }}>
                                                            <td style={{ padding: "6px 8px" }}>{audit.sourceRoute} ({audit.sourceVehicle})</td>
                                                            <td style={{ padding: "6px 8px" }}>{audit.destinationRoute} ({audit.destinationVehicle})</td>
                                                            <td style={{ padding: "6px 8px", fontWeight: "bold", color: "#0284c7" }}>+{audit.passengersMoved}</td>
                                                            <td style={{ padding: "6px 8px" }}>{audit.beforeCapacity} → {audit.afterCapacity}</td>
                                                            <td style={{ padding: "6px 8px", color: "#64748b" }}>{audit.reason}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
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
                            <div className="ai-bus-list" id="ai-bus-list-section">

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
                                                        <b>{assigned}</b>{" "}
                                                        {(bus.tripMode === "OUTWARD" || bus.tripMode === "FROM_SOURCE" || planData?.tripMode === "OUTWARD" || planData?.tripMode === "FROM_SOURCE")
                                                            ? "passengers boarding"
                                                            : "passengers dropped"}
                                                    </span>

                                                    <span>
                                                        📍{" "}
                                                        <b>
                                                            {Array.isArray(bus.stops) ? bus.stops.length : 0}
                                                        </b>{" "}
                                                        {(bus.tripMode === "OUTWARD" || bus.tripMode === "FROM_SOURCE" || planData?.tripMode === "OUTWARD" || planData?.tripMode === "FROM_SOURCE")
                                                            ? "drop-off stops"
                                                            : "pickup stops"}
                                                    </span>

                                                    {bus.routeDistanceKm && (
                                                        <span>
                                                            🛣️{" "}
                                                            <b>{bus.routeDistanceKm} km</b>{" "}
                                                            total route
                                                        </span>
                                                    )}

                                                    <span
                                                        className={`status-pill ${bus.isContinuous && !bus.continuityValidation?.directionalInversionDetected
                                                            ? "continuous"
                                                            : "warning"
                                                            }`}
                                                    >
                                                        {bus.isContinuous && !bus.continuityValidation?.directionalInversionDetected
                                                            ? "✓ Road Optimized (Continuous)"
                                                            : (bus.roadRouteStatus || "Discontinuous Corridor / Review Needed")}
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
                                                                    ? `Exceeds ${bus.detourThreshold || "2.2"}× threshold`
                                                                    : `Within ${bus.detourThreshold || "2.2"}× threshold — acceptable`}
                                                                )
                                                            </span>
                                                        </div>
                                                    )}

                                                {/* Route Timeline */}
                                                <div className="route-timeline">

                                                    {(bus.tripMode === "OUTWARD" ||
                                                        bus.tripMode === "FROM_SOURCE" ||
                                                        planData?.tripMode === "OUTWARD" ||
                                                        planData?.tripMode === "FROM_SOURCE") && (
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
                                                                        Departure point ·{" "}
                                                                        {
                                                                            assigned
                                                                        }{" "}
                                                                        passengers board here
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
                                                                    bus.tripMode === "OUTWARD" ||
                                                                    bus.tripMode === "FROM_SOURCE" ||
                                                                    planData?.tripMode === "OUTWARD" ||
                                                                    planData?.tripMode === "FROM_SOURCE";

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
                                                                                            {stop.legDurationMin !==
                                                                                                undefined &&
                                                                                                stop.legDurationMin >
                                                                                                0
                                                                                                ? ` · ~${stop.legDurationMin}m`
                                                                                                : ""}
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
                                                                                            passengers dropped off
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
                                                                                                    remaining on bus
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
                                                                                            passengers boarding
                                                                                            ·{" "}
                                                                                            <b>
                                                                                                {stop.cumulativePassengers ||
                                                                                                    userCount}
                                                                                            </b>{" "}
                                                                                            on board
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
                                                                                                    seats free
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

                                                    {(bus.tripMode !== "OUTWARD" &&
                                                        bus.tripMode !== "FROM_SOURCE" &&
                                                        planData?.tripMode !== "OUTWARD" &&
                                                        planData?.tripMode !== "FROM_SOURCE") && (
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
                                onClick={() => {
                                    handleSelectAIPlan();
                                    const el = document.querySelector(".final-decision");
                                    if (el) el.scrollIntoView({ behavior: "smooth" });
                                }}
                            >
                                {selectedPlanType ===
                                    "AI"
                                    ? "✓ AI Plan Selected (Click Save Below)"
                                    : "🤖 Select AI Plan"}
                            </button>

                        </div>
                        </>
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
                                    Unified manual routes &amp; passenger seat allocation engine from Route Management.
                                </p>
                            </div>

                            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                                <span className="admin-badge">
                                    👨‍💼 ADMIN MANUAL
                                </span>
                                <span style={{
                                    padding: "4px 10px",
                                    borderRadius: "20px",
                                    fontSize: "12px",
                                    fontWeight: "700",
                                    background: "#f1f5f9",
                                    color: "#334155",
                                    border: "1px solid #cbd5e1"
                                }}>
                                    Plan Type: Manual
                                </span>
                                <span style={{
                                    padding: "4px 10px",
                                    borderRadius: "20px",
                                    fontSize: "12px",
                                    fontWeight: "700",
                                    background: manualPlanData?.isApproved ? "#dcfce7" : (manualPlanData?.isSubmitted ? "#eff6ff" : "#fef3c7"),
                                    color: manualPlanData?.isApproved ? "#15803d" : (manualPlanData?.isSubmitted ? "#1d4ed8" : "#b45309"),
                                    border: `1px solid ${manualPlanData?.isApproved ? "#bbf7d0" : (manualPlanData?.isSubmitted ? "#bfdbfe" : "#fde68a")}`
                                }}>
                                    {manualPlanData?.isApproved
                                        ? `✓ ${manualPlanDirection} Approved & Active in MongoDB`
                                        : (manualPlanData?.isSubmitted
                                            ? `✓ ${manualPlanDirection} Confirmed via OK (Ready for Approval)`
                                            : `⏳ ${manualPlanDirection} Not Submitted (Click OK in Route Management)`)}
                                </span>
                            </div>

                        </div>

                        {manualPlanData && displayedManualRoutes.length > 0 && (
                            <div style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                                gap: "12px",
                                margin: "16px 0",
                                padding: "14px",
                                background: "#f8fafc",
                                borderRadius: "10px",
                                border: "1px solid #e2e8f0"
                            }}>
                                <div>
                                    <div style={{ fontSize: "11px", color: "#64748b", fontWeight: "600", textTransform: "uppercase" }}>Coming Students</div>
                                    <div style={{ fontSize: "20px", fontWeight: "800", color: "#0f172a" }}>{manualPlanData.totalComingUsers ?? (data?.confirmedUserCount || 0)}</div>
                                </div>
                                <div>
                                    <div style={{ fontSize: "11px", color: "#64748b", fontWeight: "600", textTransform: "uppercase" }}>Fleet Capacity</div>
                                    <div style={{ fontSize: "20px", fontWeight: "800", color: "#0f172a" }}>{manualPlanData.totalCapacity ?? 0} seats</div>
                                </div>
                                <div>
                                    <div style={{ fontSize: "11px", color: "#64748b", fontWeight: "600", textTransform: "uppercase" }}>Allocated Seats</div>
                                    <div style={{ fontSize: "20px", fontWeight: "800", color: "#16a34a" }}>{manualPlanData.assignedUsers ?? 0}</div>
                                </div>
                                <div>
                                    <div style={{ fontSize: "11px", color: "#64748b", fontWeight: "600", textTransform: "uppercase" }}>Standby Users</div>
                                    <div style={{ fontSize: "20px", fontWeight: "800", color: (manualPlanData.unassignedUsers > 0 ? "#dc2626" : "#0f172a") }}>{manualPlanData.unassignedUsers ?? 0}</div>
                                </div>
                                <div>
                                    <div style={{ fontSize: "11px", color: "#64748b", fontWeight: "600", textTransform: "uppercase" }}>Active Assigned Routes</div>
                                    <div style={{ fontSize: "20px", fontWeight: "800", color: "#0f172a" }}>{displayedManualRoutes.length}</div>
                                </div>
                            </div>
                        )}

                        {manualPlanData?.warnings && manualPlanData.warnings.length > 0 && displayedManualRoutes.length > 0 && (
                            <div style={{
                                padding: "12px 16px",
                                background: "#fffbeb",
                                border: "1px solid #fef3c7",
                                borderRadius: "8px",
                                marginBottom: "16px",
                                color: "#92400e",
                                fontSize: "13px"
                            }}>
                                <strong style={{ display: "block", marginBottom: "6px" }}>⚠️ Manual Plan Capacity &amp; Route Warnings:</strong>
                                <ul style={{ margin: "0 0 0 16px", padding: 0 }}>
                                    {manualPlanData.warnings.map((w, i) => (
                                        <li key={i}>{w}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {manualRoutesLoading ? (
                            <div className="manual-info-box">
                                Loading saved admin routes &amp; calculating seat allocations...
                            </div>
                        ) : (!manualPlanData?.isSubmitted && !manualPlanData?.isApproved && displayedManualRoutes.length === 0) ? (
                            <div className="empty-manual" style={{ padding: "36px 20px", textAlign: "center", background: "#f8fafc", borderRadius: "12px", border: "1px dashed #cbd5e1", margin: "16px 0" }}>
                                <span style={{ fontSize: "42px", display: "block", marginBottom: "10px" }}>📋</span>

                                <h3 style={{ color: "#0f172a", fontSize: "18px", fontWeight: "700", margin: "8px 0" }}>
                                    No Confirmed {manualPlanDirection} Manual Plan Submitted Yet
                                </h3>

                                <p style={{ color: "#64748b", fontSize: "14px", maxWidth: "520px", margin: "0 auto 18px", lineHeight: "1.5" }}>
                                    In <strong>Route Management</strong>, create your {manualPlanDirection} routes, allocate buses to them, and click <strong>"✓ OK"</strong>. Once confirmed, only the assigned routes will appear here for admin review and final approval.
                                </p>

                                <button
                                    type="button"
                                    onClick={() => navigate("/routes")}
                                    style={{
                                        padding: "10px 22px",
                                        background: "#2563eb",
                                        color: "#ffffff",
                                        border: "none",
                                        borderRadius: "8px",
                                        fontSize: "13px",
                                        fontWeight: "700",
                                        cursor: "pointer",
                                        boxShadow: "0 2px 8px rgba(37, 99, 235, 0.25)"
                                    }}
                                >
                                    Go to Route Management →
                                </button>
                            </div>
                        ) : displayedManualRoutes.length === 0 ? (
                            <div className="empty-manual">
                                <span>🛣️</span>

                                <h3>
                                    No routes with assigned buses found for {manualPlanDirection}
                                </h3>

                                <p>
                                    Create and assign buses to your {manualPlanDirection} routes in Route Management, then click "✓ OK" to submit.
                                </p>

                                <button
                                    type="button"
                                    onClick={() => navigate("/routes")}
                                    style={{
                                        marginTop: "12px",
                                        padding: "8px 16px",
                                        background: "#2563eb",
                                        color: "#ffffff",
                                        border: "none",
                                        borderRadius: "8px",
                                        fontSize: "13px",
                                        fontWeight: "600",
                                        cursor: "pointer"
                                    }}
                                >
                                    Go to Route Management →
                                </button>
                            </div>
                        ) : (
                            <div className="manual-route-list">

                                {displayedManualRoutes.map(
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

                                        const assignedUsers = route.assignedUsers ?? 0;
                                        const remainingSeats = route.remainingSeats ?? Math.max(0, capacity - assignedUsers);

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
                                                            ADMIN MANUAL ROUTE • {route.routeCode || `R-${String(routeIndex + 1).padStart(2, "0")}`}
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
                                                                {assignedUsers} / {capacity} seats allocated
                                                            </span>
                                                        </div>
                                                    </div>

                                                </div>

                                                <div style={{
                                                    display: "flex",
                                                    gap: "12px",
                                                    alignItems: "center",
                                                    margin: "8px 0 12px",
                                                    fontSize: "12px",
                                                    color: "#475569"
                                                }}>
                                                    <span style={{
                                                        padding: "2px 8px",
                                                        borderRadius: "6px",
                                                        background: remainingSeats > 0 ? "#f0fdf4" : "#fef2f2",
                                                        color: remainingSeats > 0 ? "#15803d" : "#b91c1c",
                                                        fontWeight: "700"
                                                    }}>
                                                        {remainingSeats} standby seats left
                                                    </span>
                                                    <span>Direction: <strong>{route.direction || manualPlanDirection || "INWARD"}</strong></span>
                                                </div>

                                                <div className="manual-route-path">

                                                    {points.length ===
                                                        0 ? (
                                                        <span>
                                                            Route stops not configured
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
                                                                    {point.name || "Stop"}
                                                                    {point.userCount > 0 && (
                                                                        <b style={{ color: "#2563eb", marginLeft: "4px" }}>
                                                                            ({point.userCount} boarding)
                                                                        </b>
                                                                    )}

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

                        <div style={{ marginTop: "18px", display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                            <button
                                type="button"
                                className={`approve-manual-plan-btn ${manualPlanData?.isApproved ? "is-approved" : ""}`}
                                onClick={handleApproveAdminManualPlan}
                                disabled={
                                    manualRoutesLoading ||
                                    manualPlanApproving ||
                                    manualPlanData?.isApproved ||
                                    displayedManualRoutes.length === 0
                                }
                                style={{
                                    flex: "1",
                                    minWidth: "240px",
                                    padding: "12px 20px",
                                    background: manualPlanData?.isApproved ? "#ecfdf5" : "#059669",
                                    color: manualPlanData?.isApproved ? "#047857" : "#ffffff",
                                    border: manualPlanData?.isApproved ? "1px solid #a7f3d0" : "none",
                                    borderRadius: "10px",
                                    fontWeight: "700",
                                    fontSize: "14px",
                                    cursor: (manualPlanData?.isApproved || displayedManualRoutes.length === 0) ? "default" : "pointer",
                                    boxShadow: manualPlanData?.isApproved ? "none" : "0 4px 14px rgba(5, 150, 105, 0.3)",
                                    transition: "all 0.2s ease"
                                }}
                            >
                                {manualPlanApproving
                                    ? `⏳ Publishing & Allocating ${manualPlanDirection} Plan...`
                                    : manualPlanData?.isApproved
                                    ? `✓ ${manualPlanDirection} Manual Plan Approved & Active in MongoDB`
                                    : `✓ Approve ${manualPlanDirection} Manual Transportation Plan`}
                            </button>

                            {/* PROMINENT REVIEW-ONLY AI RECOMMENDATION BUTTON */}
                            <button
                                type="button"
                                className="ai-rec-trigger-btn"
                                onClick={handleFetchManualRecommendations}
                                disabled={recommendationsLoading || manualRoutesLoading || displayedManualRoutes.length === 0}
                                title="AI Agent analyzes your saved manual routes for coverage, fleet utilization, and seat optimization without modifying anything"
                            >
                                {recommendationsLoading ? "⏳ Analyzing Routes..." : "✨ AI Recommendation"}
                            </button>

                            {manualPlanData?.isApproved && (
                                <button
                                    type="button"
                                    className="reset-manual-plan-btn"
                                    onClick={handleResetAdminManualPlan}
                                    disabled={manualPlanApproving}
                                    style={{
                                        padding: "12px 18px",
                                        background: "#ffffff",
                                        color: "#dc2626",
                                        border: "1px solid #fca5a5",
                                        borderRadius: "10px",
                                        fontWeight: "700",
                                        fontSize: "13px",
                                        cursor: "pointer"
                                    }}
                                >
                                    🔄 Reset {manualPlanDirection} Plan
                                </button>
                            )}

                            <button
                                type="button"
                                className={`select-plan-btn admin ${selectedPlanType === "ADMIN" ? "selected" : ""}`}
                                onClick={() => {
                                    handleSelectAdminPlan();
                                    const el = document.querySelector(".final-decision");
                                    if (el) el.scrollIntoView({ behavior: "smooth" });
                                }}
                                disabled={
                                    manualRoutesLoading ||
                                    displayedManualRoutes.length === 0
                                }
                                style={{
                                    padding: "12px 18px",
                                    borderRadius: "10px",
                                    fontSize: "13px",
                                    fontWeight: "700"
                                }}
                            >
                                {selectedPlanType === "ADMIN"
                                    ? "✓ Admin Plan Selected"
                                    : "👨‍💼 Select in Decision Options"}
                            </button>
                        </div>

                        {/* AI RECOMMENDATION REVIEW-ONLY PANEL */}
                        {showRecommendationsPanel && manualRecommendations && (
                            <div className="manual-rec-panel">
                                <div className="manual-rec-header">
                                    <div className="manual-rec-title-wrap">
                                        <span className="manual-rec-sparkle">✨</span>
                                        <div>
                                            <h3>AI Recommendations for {manualPlanDirection} Manual Plan</h3>
                                            <p className="manual-rec-subtitle">
                                                Intelligent review of stopping coverage, fleet sizing, passenger allocation &amp; route flow.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="manual-rec-header-actions">
                                        <span className="rec-review-only-badge">
                                            🛡️ Review-Only • Advisory
                                        </span>
                                        <button
                                            type="button"
                                            className="rec-close-btn"
                                            onClick={() => setShowRecommendationsPanel(false)}
                                            title="Hide recommendations panel"
                                        >
                                            ✕ Hide
                                        </button>
                                    </div>
                                </div>

                                <div className="rec-advisory-notice">
                                    <span className="rec-advisory-icon">ℹ️</span>
                                    <div>
                                        <strong>Non-Destructive Review Notice:</strong> These recommendations are for administrator review only.
                                        No routes, stops, bus assignments, or student allocations have been altered.
                                        Manual routes remain securely saved in MongoDB. Approval and allocation remain explicit actions in AI Route Management.
                                    </div>
                                </div>

                                {manualRecommendations.summary && (
                                    <div className="rec-summary-bar">
                                        <div className="rec-summary-item">
                                            <span className="rec-summary-val">{manualRecommendations.summary.totalRecommendations ?? 0}</span>
                                            <span className="rec-summary-lbl">Recommendations</span>
                                        </div>
                                        <div className="rec-summary-item">
                                            <span className="rec-summary-val high-count">{manualRecommendations.summary.highPriority ?? 0}</span>
                                            <span className="rec-summary-lbl">High Priority</span>
                                        </div>
                                        <div className="rec-summary-item">
                                            <span className="rec-summary-val med-count">{manualRecommendations.summary.mediumPriority ?? 0}</span>
                                            <span className="rec-summary-lbl">Medium Priority</span>
                                        </div>
                                        <div className="rec-summary-item">
                                            <span className="rec-summary-val">{manualRecommendations.summary.affectedStudents ?? 0}</span>
                                            <span className="rec-summary-lbl">Affected Students</span>
                                        </div>
                                        <div className="rec-summary-item">
                                            <span className="rec-summary-val" style={{ color: "#d97706" }}>
                                                {manualRecommendations.summary.currentStandbyStudents ?? manualRecommendations.summary.currentUnallocatedStudents ?? 0}
                                            </span>
                                            <span className="rec-summary-lbl">Current Standby</span>
                                        </div>
                                        <div className="rec-summary-item" style={{ background: (manualRecommendations.summary.projectedStandbyStudents ?? 0) === 0 ? "#ecfdf5" : "#fef2f2" }}>
                                            <span className="rec-summary-val" style={{ color: (manualRecommendations.summary.projectedStandbyStudents ?? 0) === 0 ? "#16a34a" : "#dc2626" }}>
                                                {manualRecommendations.summary.projectedStandbyStudents ?? manualRecommendations.summary.projectedUnallocatedStudents ?? 0}
                                            </span>
                                            <span className="rec-summary-lbl">Projected Standby</span>
                                        </div>
                                        <div className="rec-summary-item">
                                            <span className="rec-summary-val">
                                                {manualRecommendations.summary.currentFleetUtilization ?? manualRecommendations.summary.fleetUtilization ?? 0}%
                                                {manualRecommendations.summary.projectedFleetUtilization ? ` → ${manualRecommendations.summary.projectedFleetUtilization}%` : ""}
                                            </span>
                                            <span className="rec-summary-lbl">Fleet Utilization</span>
                                        </div>
                                        <div className="rec-summary-item">
                                            <span className="rec-summary-val" style={{ color: "#059669" }}>
                                                {manualRecommendations.summary.roadVerifiedRoutesCount ?? 0}
                                            </span>
                                            <span className="rec-summary-lbl">Road Verified</span>
                                        </div>
                                        {manualRecommendations.summary.potentialCapacityImprovement && (
                                            <div className="rec-summary-item highlight" style={{ gridColumn: "span 2" }}>
                                                <span className="rec-summary-val cap-imp">{manualRecommendations.summary.potentialCapacityImprovement}</span>
                                                <span className="rec-summary-lbl">Plan-Level Impact</span>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {manualRecommendations.recommendations?.length === 0 ? (
                                    <div className="rec-empty-box">
                                        <span style={{ fontSize: "28px" }}>✅</span>
                                        <div>
                                            <h4>No Route or Capacity Bottlenecks Detected</h4>
                                            <p>All confirmed students have viable stopping coverage, fleet capacity is well balanced, and no vehicle conflicts were detected for the {manualPlanDirection} manual plan.</p>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="rec-cards-list">
                                        {manualRecommendations.recommendations.map((rec, rIdx) => {
                                            const priorityClass = rec.priority === "HIGH" ? "priority-high" : (rec.priority === "MEDIUM" ? "priority-med" : "priority-low");
                                            const categoryIcon = {
                                                COVERAGE: "📍",
                                                CAPACITY: "🚌",
                                                SHARED_STOP: "🔄",
                                                ALLOCATION: "👥",
                                                FLEET_CONFLICT: "⚠️",
                                                ROUTE_FLOW: "🛣️",
                                                ROUTE_MODIFICATION: "🛣️",
                                                NEW_ROUTE: "🌟",
                                                BUS_SWAP: "🚌",
                                                ROUTE_SPLIT: "✂️"
                                            }[rec.type || rec.category] || "💡";

                                            const roadVal = rec.roadValidation || {};
                                            const capAnalysis = rec.capacityAnalysis || {};
                                            const bus = rec.bus || {};

                                            return (
                                                <div key={rec.id || rIdx} className={`rec-card ${priorityClass}`}>
                                                    <div className="rec-card-header">
                                                        <div className="rec-card-title-group">
                                                            <span className="rec-category-tag">
                                                                {categoryIcon} {rec.category?.replace(/_/g, " ") || rec.type}
                                                            </span>
                                                            <span className="rec-complete-route-badge">
                                                                🛡️ Complete Route Recommendation
                                                            </span>
                                                            <h4 className="rec-title">{rec.title}</h4>
                                                        </div>
                                                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                                            {roadVal.roadRouteStatus && (
                                                                <span className={`rec-road-badge ${roadVal.isRoadVerified ? "verified" : "fallback"}`}>
                                                                    {roadVal.isRoadVerified ? "✓ OSRM Road Verified" : "⚠️ Admin Verification Required"}
                                                                    {roadVal.distanceKm ? ` (${roadVal.distanceKm} km • ~${roadVal.durationMin || 0} min)` : ""}
                                                                </span>
                                                            )}
                                                            <span className="rec-continuity-badge">
                                                                ✓ Continuous Sequence
                                                            </span>
                                                            <span className={`rec-priority-badge ${priorityClass}`}>
                                                                {rec.priority} PRIORITY
                                                            </span>
                                                        </div>
                                                    </div>

                                                    <div className="rec-meta-tags">
                                                        {rec.affectedRoute && (
                                                            <span className="rec-meta-chip route-chip">
                                                                🛣️ Route: {rec.affectedRoute}
                                                            </span>
                                                        )}
                                                        {(bus.suggestedVehicleName || rec.affectedBus) && (
                                                            <span className="rec-meta-chip" style={{ background: "#f1f5f9", color: "#1e293b", fontWeight: "700" }}>
                                                                🚌 Bus: {bus.suggestedVehicleName && bus.currentVehicleName && bus.suggestedVehicleName !== bus.currentVehicleName
                                                                    ? `${bus.currentVehicleName} → ${bus.suggestedVehicleName} (${bus.capacity} seats)`
                                                                    : `${bus.suggestedVehicleName || rec.affectedBus} (${bus.capacity || 0} seats)`}
                                                            </span>
                                                        )}
                                                        {rec.affectedArea && (
                                                            <span className="rec-meta-chip area-chip">
                                                                📍 Area: {rec.affectedArea}
                                                            </span>
                                                        )}
                                                        {rec.affectedStudents > 0 && (
                                                            <span className="rec-meta-chip warning-chip">
                                                                👥 {rec.affectedStudents} Affected Students
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* Exact Student-to-Stop Matching Breakdown (for PASSENGER_REALLOCATION) */}
                                                    {Array.isArray(rec.studentBreakdown) && rec.studentBreakdown.length > 0 && (
                                                        <div className="rec-student-breakdown-card">
                                                            <div className="rec-breakdown-header">
                                                                👥 Exact Verified Student-to-Stop Matches ({rec.affectedStudents} Students):
                                                            </div>
                                                            <div className="rec-breakdown-list">
                                                                {rec.studentBreakdown.map((item, bIdx) => (
                                                                    <span key={bIdx} className="rec-breakdown-chip">
                                                                        📍 <strong>{item.stopName}</strong>: {item.studentCount} student{item.studentCount !== 1 ? "s" : ""}
                                                                        {item.matchedRouteStop && item.matchedRouteStop.toLowerCase() !== item.stopName.toLowerCase() && (
                                                                            <span className="rec-matched-stop-tag"> (board at {item.matchedRouteStop})</span>
                                                                        )}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Dual Route Display for Route Splits */}
                                                    {rec.splitRoute1 && rec.splitRoute2 && (
                                                        <div className="rec-split-routes-container">
                                                            <div className="rec-split-box">
                                                                <div className="rec-split-title">
                                                                    🚌 {rec.splitRoute1.routeName} • {rec.splitRoute1.vehicleName} ({rec.splitRoute1.capacity} seats)
                                                                </div>
                                                                <div className="rec-split-metrics">
                                                                    Demand: {rec.splitRoute1.demand} • Remaining: +{rec.splitRoute1.remainingSeats} free
                                                                    {rec.splitRoute1.roadValidation?.distanceKm ? ` • ${rec.splitRoute1.roadValidation.distanceKm} km (~${rec.splitRoute1.roadValidation.durationMin || 0} min)` : ""}
                                                                </div>
                                                                <div className="rec-route-flow">
                                                                    {rec.splitRoute1.stops.map((pt, pIdx) => (
                                                                        <span key={`s1-${pIdx}`} style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                                                                            <span className={`rec-stop-badge mini ${pt.isHub ? "hub" : ""}`}>
                                                                                {pt.isHub ? "🏛️" : `#${pIdx + 1}`} {pt.name}
                                                                            </span>
                                                                            {pIdx < rec.splitRoute1.stops.length - 1 && <span className="rec-stop-arrow">→</span>}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                            <div className="rec-split-box">
                                                                <div className="rec-split-title">
                                                                    🚌 {rec.splitRoute2.routeName} • {rec.splitRoute2.vehicleName} ({rec.splitRoute2.capacity} seats)
                                                                </div>
                                                                <div className="rec-split-metrics">
                                                                    Demand: {rec.splitRoute2.demand} • Remaining: +{rec.splitRoute2.remainingSeats} free
                                                                    {rec.splitRoute2.roadValidation?.distanceKm ? ` • ${rec.splitRoute2.roadValidation.distanceKm} km (~${rec.splitRoute2.roadValidation.durationMin || 0} min)` : ""}
                                                                </div>
                                                                <div className="rec-route-flow">
                                                                    {rec.splitRoute2.stops.map((pt, pIdx) => (
                                                                        <span key={`s2-${pIdx}`} style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                                                                            <span className={`rec-stop-badge mini ${pt.isHub ? "hub" : ""}`}>
                                                                                {pt.isHub ? "🏛️" : `#${pIdx + 1}`} {pt.name}
                                                                            </span>
                                                                            {pIdx < rec.splitRoute2.stops.length - 1 && <span className="rec-stop-arrow">→</span>}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Dual Route Display for Shared Stops */}
                                                    {rec.routeA && rec.routeB && (
                                                        <div className="rec-shared-routes-container">
                                                            <div className="rec-split-box">
                                                                <div className="rec-split-title">
                                                                    Route A: {rec.routeA.routeName} • {rec.routeA.vehicleName} ({rec.routeA.capacity} seats)
                                                                </div>
                                                                <div className="rec-split-metrics">
                                                                    Demand: {rec.routeA.demand} • Remaining: +{rec.routeA.remainingSeats} free
                                                                </div>
                                                                <div className="rec-route-flow">
                                                                    {rec.routeA.currentRoute.map((pt, pIdx) => {
                                                                        const isShared = normalizeStopName(pt.name) === normalizeStopName(rec.affectedArea);
                                                                        return (
                                                                            <span key={`ra-${pIdx}`} style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                                                                                <span className={`rec-stop-badge mini ${pt.isHub ? "hub" : ""} ${isShared ? "shared-highlight" : ""}`}>
                                                                                    {pt.isHub ? "🏛️" : `#${pIdx + 1}`} {pt.name}
                                                                                    {isShared && " 🔄"}
                                                                                </span>
                                                                                {pIdx < rec.routeA.currentRoute.length - 1 && <span className="rec-stop-arrow">→</span>}
                                                                            </span>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                            <div className="rec-split-box">
                                                                <div className="rec-split-title">
                                                                    Route B: {rec.routeB.routeName} • {rec.routeB.vehicleName} ({rec.routeB.capacity} seats)
                                                                </div>
                                                                <div className="rec-split-metrics">
                                                                    Demand: {rec.routeB.demand} • Remaining: +{rec.routeB.remainingSeats} free
                                                                </div>
                                                                <div className="rec-route-flow">
                                                                    {rec.routeB.currentRoute.map((pt, pIdx) => {
                                                                        const isShared = normalizeStopName(pt.name) === normalizeStopName(rec.affectedArea);
                                                                        return (
                                                                            <span key={`rb-${pIdx}`} style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                                                                                <span className={`rec-stop-badge mini ${pt.isHub ? "hub" : ""} ${isShared ? "shared-highlight" : ""}`}>
                                                                                    {pt.isHub ? "🏛️" : `#${pIdx + 1}`} {pt.name}
                                                                                    {isShared && " 🔄"}
                                                                                </span>
                                                                                {pIdx < rec.routeB.currentRoute.length - 1 && <span className="rec-stop-arrow">→</span>}
                                                                            </span>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Continuous Route Sequences: Current vs Proposed */}
                                                    {rec.currentRoute && rec.currentRoute.length > 0 && rec.type !== "NEW_ROUTE" && !rec.splitRoute1 && !rec.routeA && (
                                                        <div className="rec-route-section">
                                                            <div className="rec-route-header">
                                                                <span className="rec-route-label">
                                                                    🛣️ Current Ordered Route:
                                                                </span>
                                                                <span style={{ fontSize: "11px", color: "#64748b" }}>
                                                                    {rec.currentRoute.length} Stops
                                                                </span>
                                                            </div>
                                                            <div className="rec-route-flow">
                                                                {rec.currentRoute.map((pt, pIdx) => (
                                                                    <span key={`curr-${pt.name}-${pIdx}`} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                                                        <span className={`rec-stop-badge ${pt.isHub ? "hub" : "current-stop"}`}>
                                                                            {pt.isHub ? "🏛️" : `#${pIdx + 1}`} {pt.name}
                                                                            {pt.userCount > 0 && (
                                                                                <span style={{ color: "#2563eb", fontWeight: "800", marginLeft: "2px" }}>
                                                                                    ({pt.userCount})
                                                                                </span>
                                                                            )}
                                                                        </span>
                                                                        {pIdx < rec.currentRoute.length - 1 && (
                                                                            <span className="rec-stop-arrow">→</span>
                                                                        )}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {rec.recommendedRoute && rec.recommendedRoute.length > 0 && !rec.splitRoute1 && !rec.routeA && (
                                                        <div className="rec-route-section" style={{ borderLeft: "3px solid #6366f1" }}>
                                                            <div className="rec-route-header">
                                                                <span className="rec-route-label" style={{ color: "#4338ca" }}>
                                                                    ✨ Proposed Continuous Route Sequence:
                                                                </span>
                                                                <span style={{ fontSize: "11px", color: "#64748b" }}>
                                                                    {rec.recommendedRoute.length} Stops
                                                                    {roadVal.distanceKm ? ` • ${roadVal.distanceKm} km` : ""}
                                                                    {roadVal.detourDistanceKm > 0 ? ` (+${roadVal.detourDistanceKm} km detour)` : ""}
                                                                </span>
                                                            </div>
                                                            <div className="rec-route-flow">
                                                                {rec.recommendedRoute.map((pt, pIdx) => {
                                                                    const isNew = Boolean(pt.isNewStop);
                                                                    const isHub = Boolean(pt.isHub || pt.routePointType === "hub");
                                                                    return (
                                                                        <span key={`rec-${pt.name}-${pIdx}`} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                                                            <span className={`rec-stop-badge ${isHub ? "hub" : (isNew ? "new-stop" : "")}`}>
                                                                                {isHub ? "🏛️" : (isNew ? "✨" : `#${pIdx + 1}`)} {pt.name}
                                                                                {isNew && (
                                                                                    <strong style={{ color: "#7e22ce", marginLeft: "2px" }}>[NEW]</strong>
                                                                                )}
                                                                                {pt.userCount > 0 && (
                                                                                    <span style={{ color: "#2563eb", fontWeight: "800", marginLeft: "2px" }}>
                                                                                        ({pt.userCount})
                                                                                    </span>
                                                                                )}
                                                                            </span>
                                                                            {pIdx < rec.recommendedRoute.length - 1 && (
                                                                                <span className="rec-stop-arrow">→</span>
                                                                            )}
                                                                        </span>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Strict Capacity & Demand Analysis Grid */}
                                                    {capAnalysis.capacity > 0 && (
                                                        <div className="rec-capacity-card">
                                                            <div className="rec-capacity-header">
                                                                <span className="rec-capacity-title">
                                                                    🚌 Strict Capacity &amp; Demand Validation
                                                                </span>
                                                                <span className={`rec-capacity-status ${capAnalysis.isFullyAccommodated ? "accommodated" : "shortage"}`}>
                                                                    {capAnalysis.isFullyAccommodated
                                                                        ? "✓ 100% Demand Accommodated"
                                                                        : `⚠️ ${capAnalysis.standbyAfterRecommendation} Students Standby Shortage`}
                                                                </span>
                                                            </div>
                                                            <div className="rec-capacity-grid">
                                                                <div className="rec-capacity-cell">
                                                                    <span className="rec-cap-label">Current Demand</span>
                                                                    <span className="rec-cap-val">{capAnalysis.currentDemand ?? 0}</span>
                                                                </div>
                                                                <div className="rec-capacity-cell">
                                                                    <span className="rec-cap-label">Additional Demand</span>
                                                                    <span className="rec-cap-val positive">+{capAnalysis.additionalDemand ?? 0}</span>
                                                                </div>
                                                                <div className="rec-capacity-cell">
                                                                    <span className="rec-cap-label">Total Demand</span>
                                                                    <span className="rec-cap-val">{capAnalysis.totalExpectedDemand ?? 0}</span>
                                                                </div>
                                                                <div className="rec-capacity-cell">
                                                                    <span className="rec-cap-label">Bus Capacity</span>
                                                                    <span className="rec-cap-val bus-name">
                                                                        {bus.suggestedVehicleName || bus.currentVehicleName || "Bus"} ({capAnalysis.capacity}s)
                                                                    </span>
                                                                </div>
                                                                <div className="rec-capacity-cell">
                                                                    <span className="rec-cap-label">
                                                                        {capAnalysis.remainingSeats > 0 ? "Remaining Seats" : "Standby Shortage"}
                                                                    </span>
                                                                    <span className={`rec-cap-val ${capAnalysis.remainingSeats > 0 ? "positive" : "negative"}`}>
                                                                        {capAnalysis.remainingSeats > 0
                                                                            ? `+${capAnalysis.remainingSeats} free`
                                                                            : `-${capAnalysis.standbyAfterRecommendation} short`}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}

                                                    <div className="rec-card-body">
                                                        <div className="rec-detail-row">
                                                            <span className="rec-detail-label">Current Situation:</span>
                                                            <span className="rec-detail-text">{rec.currentSituation}</span>
                                                        </div>

                                                        <div className="rec-detail-row highlight-row">
                                                            <span className="rec-detail-label">Suggested Improvement:</span>
                                                            <span className="rec-detail-text suggestion">{rec.suggestedImprovement}</span>
                                                        </div>

                                                        <div className="rec-detail-row">
                                                            <span className="rec-detail-label">Reason &amp; Rationale:</span>
                                                            <span className="rec-detail-text">{rec.reason}</span>
                                                        </div>

                                                        <div className="rec-detail-row">
                                                            <span className="rec-detail-label">Expected Benefit:</span>
                                                            <span className="rec-detail-text benefit">✓ {rec.expectedBenefit}</span>
                                                        </div>

                                                        {rec.constraints && (
                                                            <div className="rec-detail-row constraint-row">
                                                                <span className="rec-detail-label">Constraints &amp; Practical Notes:</span>
                                                                <span className="rec-detail-text constraint">⚠️ {rec.constraints}</span>
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Interactive Map Visualizer Trigger & Non-destructive Notice */}
                                                    <div className="rec-card-actions">
                                                        <button
                                                            type="button"
                                                            className="rec-view-map-btn"
                                                            onClick={() => {
                                                                setSelectedMapRec(rec);
                                                                setIsMapModalOpen(true);
                                                            }}
                                                            title="Inspect complete route and stops on interactive Leaflet map"
                                                        >
                                                            🗺️ View Route on Map
                                                        </button>
                                                        <span className="rec-advisory-pill">
                                                            🛡️ Review-Only: Modify route in Route Management to apply.
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}

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
                            displayedManualRoutes.length
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
                                    displayedManualRoutes.length
                                }{" "}
                                assigned manual routes
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
                                    : isPlanSaved
                                    ? `✓ ${lastSelection?.planType === "ADMIN" ? "Admin Manual" : "AI Recommended"} Plan (Saved & Active)`
                                    : "No plan selected"}
                        </strong>

                    </div>

                    <button
                        className={`save-final-btn ${isPlanSaved && !selectedPlanType ? "saved-active" : ""}`}
                        onClick={
                            handleSaveFinalPlan
                        }
                        disabled={
                            (!selectedPlanType && !isPlanSaved) ||
                            savingSelection
                        }
                    >
                        {savingSelection
                            ? "⏳ Saving Plan to Database..."
                            : selectedPlanType === "AI"
                            ? "✓ Save & Confirm AI Transportation Plan"
                            : selectedPlanType === "ADMIN"
                            ? "✓ Save & Confirm Admin Manual Plan"
                            : isPlanSaved
                            ? "✓ Plan Confirmed & Saved (Active Until Reset)"
                            : "✓ Save Final Transportation Plan"}
                    </button>

                </div>

                {selectionMessage && (
                    <div
                        className={`final-message ${
                            selectionMessage.toLowerCase().includes("fail") ||
                            selectionMessage.toLowerCase().includes("error") ||
                            selectionMessage.toLowerCase().includes("unable")
                                ? "error"
                                : "success"
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

            {/* Safe Reset Confirmation Modal */}
            <ResetRouteModal
                isOpen={showResetModal}
                onClose={() => setShowResetModal(false)}
                onConfirm={handleConfirmReset}
                isResetting={resetting}
                direction={planDirectionTab || (tripMode === "FROM_SOURCE" ? "OUTWARD" : "INWARD")}
            />

            {/* Select Generated Route Modal */}
            <SelectGeneratedRouteModal
                isOpen={showSelectRouteModal}
                onClose={() => setShowSelectRouteModal(false)}
                routes={aiBuses || aiPlan?.buses || []}
                onConfirmSelect={handleSelectAiRouteToView}
            />

            {/* Recommended Route Leaflet Map Modal */}
            <RecommendedRouteMapModal
                isOpen={isMapModalOpen}
                onClose={() => setIsMapModalOpen(false)}
                recommendation={selectedMapRec}
                direction={manualPlanDirection}
            />

        </div>
    );
}