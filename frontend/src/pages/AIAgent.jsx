import { useEffect, useState, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import { HiArrowLeft } from "react-icons/hi";
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
    saveSelectedPlan,
    confirmAIPlan,
    approveAIPlan,
    getSelectedPlan,
    getPlanStatus,
    fetchLateResponses,
    getLateResponseDraft,
    getInwardStartingPlaces
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
    const isGeneratingRef = useRef(false);

    const [generationError, setGenerationError] =
        useState("");

    const [planData, setPlanData] = useState(() => {
        try {
            const initialDir = (() => {
                const storedDir = localStorage.getItem("active_plan_direction");
                if (storedDir === "INWARD" || storedDir === "OUTWARD") return storedDir;
                return "OUTWARD";
            })();
            const targetStorageKey = initialDir === "INWARD" ? "active_inward_plan" : "active_outward_plan";
            const dirCached = localStorage.getItem(targetStorageKey);
            if (dirCached) {
                const p = JSON.parse(dirCached);
                if (p && p.status !== "ZERO_DEMAND" && (p.aiPlan || (Array.isArray(p.buses) && p.buses.length > 0))) {
                    return p;
                }
            }
            const cached = localStorage.getItem("active_ai_plan");
            if (cached) {
                const p = JSON.parse(cached);
                const pDir = p.direction || (p.tripMode === "FROM_SOURCE" || p.tripMode === "OUTWARD" ? "OUTWARD" : (p.tripMode === "TO_DESTINATION" || p.tripMode === "INWARD" ? "INWARD" : null));
                if (pDir === initialDir && p && p.status !== "ZERO_DEMAND" && (p.aiPlan || (Array.isArray(p.buses) && p.buses.length > 0))) {
                    return p;
                }
            }
        } catch {
            // fallback
        }
        return null;
    });
    const [outwardPlan, setOutwardPlan] = useState(() => {
        try {
            const cached = localStorage.getItem("active_outward_plan");
            const parsed = cached ? JSON.parse(cached) : null;
            const count = (parsed?.buses || parsed?.routes || parsed?.aiPlan?.buses)?.length || 0;
            const dir = parsed?.direction || parsed?.tripMode;
            const isDirMatch = dir === "OUTWARD" || dir === "FROM_SOURCE" || !dir;
            return (count > 0 && isDirMatch && parsed?.status !== "ZERO_DEMAND") ? parsed : null;
        } catch {
            return null;
        }
    });
    const [inwardPlan, setInwardPlan] = useState(() => {
        try {
            const cached = localStorage.getItem("active_inward_plan");
            const parsed = cached ? JSON.parse(cached) : null;
            const count = (parsed?.buses || parsed?.routes || parsed?.aiPlan?.buses)?.length || 0;
            const dir = parsed?.direction || parsed?.tripMode;
            const isDirMatch = dir === "INWARD" || dir === "TO_DESTINATION";
            return (count > 0 && isDirMatch && parsed?.status !== "ZERO_DEMAND") ? parsed : null;
        } catch {
            return null;
        }
    });
    const [stalePlanInfo, setStalePlanInfo] = useState(null);
    const [lateResponsesData, setLateResponsesData] = useState(null);
    const [planStatusData, setPlanStatusData] = useState(null);

    const [planDirectionTab, setPlanDirectionTab] = useState(() => {
        try {
            const storedDir = localStorage.getItem("active_plan_direction");
            if (storedDir === "INWARD" || storedDir === "OUTWARD") return storedDir;
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
    const planDirectionTabRef = useRef(planDirectionTab);
    useEffect(() => {
        planDirectionTabRef.current = planDirectionTab;
    }, [planDirectionTab]);

    const [selectedPlanType, setSelectedPlanType] = useState("");

    const [savingSelection, setSavingSelection] =
        useState(false);
    const isSavingSelectionRef = useRef(false);

    const [selectionMessage, setSelectionMessage] =
        useState("");

    const navigate = useNavigate();

    const [lastSelection, setLastSelection] = useState(null);

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
        try {
            const stored = localStorage.getItem("active_manual_plan_direction");
            if (stored === "INWARD" || stored === "OUTWARD") return stored;
        } catch (e) { }
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



    const [loading, setLoading] = useState(true);
    const [planChecking, setPlanChecking] = useState(() => !planData);
    const activePlanFetchIdRef = useRef(0);

    // Inward Bus Starting Places State (for dynamic fleet readiness & route generation)
    const [inwardStartingPlaces, setInwardStartingPlaces] = useState(() => {
        try {
            const cached = localStorage.getItem("cached_inward_starting_places");
            if (cached) {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            }
        } catch { }
        return [];
    });
    const [inwardStartingPlacesLoading, setInwardStartingPlacesLoading] = useState(false);

    // Ensure document body is always scrollable on page mount and unmount
    useEffect(() => {
        document.body.style.overflow = "";
        return () => {
            document.body.style.overflow = "";
        };
    }, []);

    // Lock page background scrolling when any modal is open
    useEffect(() => {
        const hasOpenModal = Boolean(showResetModal || showSelectRouteModal || isMapModalOpen);
        if (hasOpenModal) {
            document.body.style.overflow = "hidden";
            return () => {
                document.body.style.overflow = "";
            };
        } else {
            document.body.style.overflow = "";
        }
    }, [showResetModal, showSelectRouteModal, isMapModalOpen]);

    const loadInwardStartingPlaces = async () => {
        try {
            setInwardStartingPlacesLoading(true);
            const res = await getInwardStartingPlaces();
            if (res?.success && Array.isArray(res.startingPlaces)) {
                setInwardStartingPlaces(res.startingPlaces);
                try {
                    localStorage.setItem("cached_inward_starting_places", JSON.stringify(res.startingPlaces));
                } catch { }
            }
        } catch (err) {
            console.warn("Unable to load inward starting places:", err);
        } finally {
            setInwardStartingPlacesLoading(false);
        }
    };

    const handleSelectAiRouteToView = (route) => {
        setShowSelectRouteModal(false);
        document.body.style.overflow = "";
        if (!route) {
            toast.error("Unable to load the selected AI route.");
            return;
        }
        try {
            const routeId = route.routeId || route.routeCode || route.busNumber || route.vehicleName || route.vehicleNumber || route.busId || route.vehicleId || route._id || route.id;
            if (routeId) {
                sessionStorage.setItem("activeAiViewRouteId", String(routeId).trim());
            }
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
            if (document.visibilityState === "visible" && !isGeneratingRef.current && !isSavingSelectionRef.current && !resetting) {
                loadAIData(false, isMounted);
                loadActivePlan(false);
                loadLastSelection();
                loadManualRoutes();
                loadInwardStartingPlaces();
                refreshPlanStatusAndLateResponses();
            }
        };

        window.addEventListener("focus", handleSync);
        document.addEventListener("visibilitychange", handleSync);

        // Cross-tab background polling to sync resets and live updates (only when tab is visible)
        const pollInterval = setInterval(() => {
            if (document.visibilityState === "visible" && !isGeneratingRef.current && !isSavingSelectionRef.current && !resetting) {
                loadAIData(false, isMounted);
                loadActivePlan(false);
                loadLastSelection();
                loadInwardStartingPlaces();
                refreshPlanStatusAndLateResponses();
            }
        }, 15000);

        return () => {
            isMounted = false;
            window.removeEventListener("focus", handleSync);
            document.removeEventListener("visibilitychange", handleSync);
            clearInterval(pollInterval);
        };
    }, []);

    const refreshPlanStatusAndLateResponses = async () => {
        try {
            const [statusRes, lateRes] = await Promise.allSettled([
                getPlanStatus(),
                fetchLateResponses()
            ]);
            if (statusRes.status === "fulfilled" && statusRes.value?.success) {
                setPlanStatusData(statusRes.value);
            }
            if (lateRes.status === "fulfilled" && lateRes.value?.success) {
                setLateResponsesData(lateRes.value);
            }
        } catch (err) {
            console.warn("Unable to refresh plan status & late responses:", err?.message || err);
        }
    };

    const loadPageData = async (isMounted = true) => {
        await Promise.all([
            loadAIData(true, isMounted),
            loadActivePlan(true),
            loadLastSelection(),
            loadManualRoutes(),
            loadInwardStartingPlaces(),
            refreshPlanStatusAndLateResponses()
        ]);

        if (isMounted) {
            initialHydratedRef.current = true;
            setLoading(false);
            setPlanChecking(false);
        }
    };

    const loadAIData = async (isInitial = false, isMounted = true) => {
        try {
            if (isInitial && isMounted) {
                setMetricsLoading(true);
            }
            const response = await getAIData();
            if (isMounted) {
                setData(response);
                setMetricsLoading(false);
            }
            // NOTE: Do NOT clear the AI plan here based on comingCount.
            // Student headcount from metrics is a live snapshot and may be 0 due to DB lag,
            // a race condition, or students not yet having responded — none of which mean the
            // plan was reset. Only an explicit "Reset AI Generated Route" action must clear the plan.
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

    const loadActivePlan = async (isInitial = false, overrideDir = null, forceRefresh = false) => {
        if (isGeneratingRef.current) {
            return;
        }

        const fetchId = ++activePlanFetchIdRef.current;
        const currentDir = overrideDir || planDirectionTabRef.current || planDirectionTab || (tripMode === "FROM_SOURCE" ? "OUTWARD" : "INWARD");

        try {
            // Keep existing route cards visible during background refresh — do not clear planData here
            const response = await getActivePlan({ direction: currentDir, planType: "AI", forceRefresh });

            // Discard stale in-flight response if direction changed or newer fetch dispatched
            if (fetchId !== activePlanFetchIdRef.current || isGeneratingRef.current) {
                return;
            }

            if (isGeneratingRef.current) {
                return;
            }

            if (response?.wasReset === true) {
                const isOutwardReset = response.wasOutwardReset === true || response.resetDirection === "OUTWARD" || response.resetDirection === "BOTH";
                const isInwardReset = response.wasInwardReset === true || response.resetDirection === "INWARD" || response.resetDirection === "BOTH";
                const activeTab = overrideDir || planDirectionTabRef.current || planDirectionTab;

                if (isInwardReset && !response.inwardPlan) {
                    try {
                        localStorage.removeItem("active_inward_plan");
                        sessionStorage.removeItem("active_inward_plan");
                        if (activeTab === "INWARD") {
                            localStorage.removeItem("active_ai_plan");
                            localStorage.removeItem("active_ai_selection");
                            sessionStorage.removeItem("active_ai_plan");
                            sessionStorage.removeItem("active_ai_selection");
                            setPlanData(null);
                        }
                    } catch { }
                    setInwardPlan(null);
                }

                if (isOutwardReset && !response.outwardPlan) {
                    try {
                        localStorage.removeItem("active_outward_plan");
                        sessionStorage.removeItem("active_outward_plan");
                        if (activeTab === "OUTWARD") {
                            localStorage.removeItem("active_ai_plan");
                            localStorage.removeItem("active_ai_selection");
                            sessionStorage.removeItem("active_ai_plan");
                            sessionStorage.removeItem("active_ai_selection");
                            setPlanData(null);
                        }
                    } catch { }
                    setOutwardPlan(null);
                }

                setStalePlanInfo(null);
                if ((isOutwardReset && activeTab === "OUTWARD") || (isInwardReset && activeTab === "INWARD")) {
                    setSelectedPlanType((prev) => (prev === "AI" ? "" : prev));
                }
            }

            if (!response?.success) {
                console.warn("loadActivePlan: non-success response from server", response);
                return;
            }

            // Sync Outward Plan: authoritative from server
            const outHasBuses = Boolean((response.outwardPlan?.buses || response.outwardPlan?.routes || response.outwardPlan?.aiPlan?.buses)?.length > 0);
            const outP = outHasBuses ? response.outwardPlan : null;
            setOutwardPlan(outP);
            if (outP) {
                try {
                    localStorage.setItem("active_outward_plan", JSON.stringify(outP));
                } catch { }
            } else {
                try {
                    localStorage.removeItem("active_outward_plan");
                    sessionStorage.removeItem("active_outward_plan");
                } catch { }
            }

            // Sync Inward Plan: authoritative from server
            const inHasBuses = Boolean((response.inwardPlan?.buses || response.inwardPlan?.routes || response.inwardPlan?.aiPlan?.buses)?.length > 0);
            const inP = inHasBuses ? response.inwardPlan : null;
            setInwardPlan(inP);
            if (inP) {
                try {
                    localStorage.setItem("active_inward_plan", JSON.stringify(inP));
                } catch { }
            } else {
                try {
                    localStorage.removeItem("active_inward_plan");
                    sessionStorage.removeItem("active_inward_plan");
                } catch { }
            }

            // Capture stale plan metadata for user warning display
            if (response.staleInwardPlan || response.staleOutwardPlan) {
                setStalePlanInfo({
                    inward: response.staleInwardPlan || null,
                    outward: response.staleOutwardPlan || null,
                    reason: response.staleReason || null
                });
            } else {
                setStalePlanInfo(null);
            }

            // Determine active plan to display (authoritative server response)
            let activePlan = null;
            const effectiveDir = overrideDir || planDirectionTabRef.current || planDirectionTab || (tripMode === "FROM_SOURCE" ? "OUTWARD" : "INWARD");

            if (effectiveDir === "OUTWARD") {
                if (outP) {
                    activePlan = outP;
                } else if (isInitial && inP) {
                    // On initial hydration: if OUTWARD has no plan but INWARD has an active plan, auto-switch to INWARD!
                    activePlan = inP;
                    setPlanDirectionTab("INWARD");
                    planDirectionTabRef.current = "INWARD";
                    setTripMode("TO_DESTINATION");
                    setActiveEndpointField("destination");
                }
            } else { // INWARD
                if (inP) {
                    activePlan = inP;
                } else if (isInitial && outP) {
                    // On initial hydration: if INWARD has no plan but OUTWARD has an active plan, auto-switch to OUTWARD!
                    activePlan = outP;
                    setPlanDirectionTab("OUTWARD");
                    planDirectionTabRef.current = "OUTWARD";
                    setTripMode("FROM_SOURCE");
                    setActiveEndpointField("source");
                }
            }

            if (activePlan) {
                setPlanData(activePlan);
                const activeDir = activePlan.direction || (activePlan.tripMode === "FROM_SOURCE" || activePlan.tripMode === "OUTWARD" ? "OUTWARD" : "INWARD");
                if (activeDir && !planDirectionTab) {
                    setPlanDirectionTab(activeDir);
                    planDirectionTabRef.current = activeDir;
                }

                try {
                    localStorage.setItem("active_ai_plan", JSON.stringify(activePlan));
                } catch { }

                // Restore endpoint ONLY on initial hydration if user has not yet interacted
                if (isInitial && !userInteractedRef.current) {
                    if (outP?.source && hasValidCoordinates(outP.source)) {
                        setSourceLocation(outP.source);
                    }
                    if (inP?.destination && hasValidCoordinates(inP.destination)) {
                        setDestinationLocation(inP.destination);
                    } else if (inP?.startingPoint && hasValidCoordinates(inP.startingPoint)) {
                        setDestinationLocation(inP.startingPoint);
                    }
                }
            } else {
                // Backend reports no current valid plan for this direction!
                setPlanData(null);
                setSelectedPlanType((prev) => (prev === "AI" ? "" : prev));
                try {
                    localStorage.removeItem("active_ai_plan");
                    localStorage.removeItem("active_ai_selection");
                    sessionStorage.removeItem("active_ai_plan");
                    sessionStorage.removeItem("active_ai_selection");
                } catch { }
            }
        } catch (error) {
            console.error("Unable to load active AI plan:", error);
        } finally {
            if (fetchId === activePlanFetchIdRef.current) {
                setPlanChecking(false);
            }
        }
    };

    const loadManualRoutes = async (targetDirection = null) => {
        try {
            setManualRoutesLoading(true);
            let storedDir = null;
            try {
                storedDir = localStorage.getItem("active_manual_plan_direction");
            } catch (e) { }
            const currentDir = targetDirection || manualPlanDirection || storedDir || planDirectionTab || "INWARD";

            const [routesRes, planRes] = await Promise.allSettled([
                getManualRoutes(),
                getManualPlan({ direction: currentDir })
            ]);

            if (routesRes.status === "fulfilled") {
                const allRoutes = normalizeManualRoutes(routesRes.value);
                const filtered = allRoutes.filter((r) => {
                    const d = String(r.direction || "").toUpperCase().trim();
                    return (d === currentDir || d === "BOTH") && Boolean(r.assignedVehicle || r.vehicleName);
                });
                setManualRoutes(filtered);
            }
            if (planRes.status === "fulfilled" && planRes.value?.success) {
                const p = planRes.value.plan;
                setManualPlanData(p);
                if (p?.direction) {
                    setManualPlanDirection(p.direction);
                }
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
        try {
            localStorage.setItem("active_manual_plan_direction", newDir);
        } catch (e) { }
        loadManualRoutes(newDir);
        loadLastSelection(newDir);
    };

    const loadLateResponseDraft = async (targetDirection = null) => {
        try {
            const currentDir = targetDirection || manualPlanDirection || planDirectionTab || (tripMode === "FROM_SOURCE" ? "OUTWARD" : "INWARD");
            const draftRes = await getLateResponseDraft({ direction: currentDir });
            if (draftRes?.success && draftRes?.draft) {
                return draftRes.draft;
            }
            return null;
        } catch (error) {
            console.warn("Unable to load late response draft:", error?.message || error);
            return null;
        }
    };

    // Automatically synchronize manual plan, late response draft, and active AI plan whenever selected direction changes
    useEffect(() => {
        if (initialHydratedRef.current) {
            loadManualRoutes(planDirectionTab);
            loadLateResponseDraft(planDirectionTab);
            loadActivePlan(false, planDirectionTab);
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
                } catch (e) { }

                await Promise.all([
                    loadManualRoutes(currentDir),
                    loadLastSelection(currentDir),
                    loadActivePlan(false),
                    refreshPlanStatusAndLateResponses()
                ]);
            }
        } catch (err) {
            console.error("Approve manual plan error:", err);
            toast.error(err.response?.data?.message || err.message || "Failed to approve manual plan.");
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
        setActiveEndpointField("source");
        setTripMode("FROM_SOURCE");
        setPlanDirectionTab("OUTWARD");
        planDirectionTabRef.current = "OUTWARD";
        setGenerationError("");
        if (outwardPlan) {
            setPlanData(outwardPlan);
        }
    };

    const handleDestinationSelect = (location) => {
        userInteractedRef.current = true;
        setDestinationLocation(location);
        setActiveEndpointField("destination");
        setTripMode("TO_DESTINATION");
        setPlanDirectionTab("INWARD");
        planDirectionTabRef.current = "INWARD";
        setGenerationError("");
        if (inwardPlan) {
            setPlanData(inwardPlan);
        }
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
            isGeneratingRef.current = true;
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
                planDirectionTabRef.current = "OUTWARD";
                setStalePlanInfo((prev) => (prev ? { ...prev, outward: null } : null));
                setPlanStatusData((prev) => prev ? {
                    ...prev,
                    outward: { ...(prev.outward || {}), requiresReset: false, requiresReview: false, hasLateResponses: false, isStale: false, status: "GENERATED" }
                } : null);
            } else {
                setInwardPlan(response);
                setPlanDirectionTab("INWARD");
                planDirectionTabRef.current = "INWARD";
                setStalePlanInfo((prev) => (prev ? { ...prev, inward: null } : null));
                setPlanStatusData((prev) => prev ? {
                    ...prev,
                    inward: { ...(prev.inward || {}), requiresReset: false, requiresReview: false, hasLateResponses: false, isStale: false, status: "GENERATED" }
                } : null);
            }

            try {
                localStorage.setItem("active_ai_plan", JSON.stringify(response));
                localStorage.setItem("active_plan_direction", isOutward ? "OUTWARD" : "INWARD");
                if (isOutward) {
                    localStorage.setItem("active_outward_plan", JSON.stringify(response));
                } else {
                    localStorage.setItem("active_inward_plan", JSON.stringify(response));
                }
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

            await loadActivePlan(false, isOutward ? "OUTWARD" : "INWARD", true);
            await loadAIData();
            await refreshPlanStatusAndLateResponses();
            await loadInwardStartingPlaces();
        } catch (error) {
            console.error(
                "AI plan generation error:",
                error
            );

            stageTimersRef.current.forEach(clearTimeout);
            stageTimersRef.current = [];

            // Do not clear setPlanData(null); preserve previously visible valid plan on generation error

            setGenerationError(
                error?.response?.data?.message ||
                error?.message ||
                "Unable to generate AI route plan."
            );
        } finally {
            stageTimersRef.current.forEach(clearTimeout);
            stageTimersRef.current = [];
            isGeneratingRef.current = false;
            setGenerating(false);
        }
    };

    const handleConfirmReset = async () => {
        try {
            setResetting(true);

            const targetDirection = planDirectionTab || (tripMode === "FROM_SOURCE" ? "OUTWARD" : "INWARD");
            const response = await resetAIPlan({ direction: targetDirection, resetAll: false });

            if (response?.success) {
                userInteractedRef.current = true;
                setShowResetModal(false);

                // Direction-specific cleanup of AI plan state from frontend memory
                if (targetDirection === "INWARD") {
                    setInwardPlan(null);
                    if (planDirectionTab === "INWARD") {
                        setPlanData(null);
                        setSelectedPlanType("");
                        setLastSelection(null);
                    }
                    try {
                        localStorage.removeItem("active_inward_plan");
                        sessionStorage.removeItem("active_inward_plan");
                        if (planDirectionTab === "INWARD") {
                            localStorage.removeItem("active_ai_plan");
                            localStorage.removeItem("active_ai_selection");
                            sessionStorage.removeItem("active_ai_plan");
                            sessionStorage.removeItem("active_ai_selection");
                        }
                    } catch {
                        // Ignore storage errors
                    }
                } else if (targetDirection === "OUTWARD") {
                    setOutwardPlan(null);
                    if (planDirectionTab === "OUTWARD") {
                        setPlanData(null);
                        setSelectedPlanType("");
                        setLastSelection(null);
                    }
                    try {
                        localStorage.removeItem("active_outward_plan");
                        sessionStorage.removeItem("active_outward_plan");
                        if (planDirectionTab === "OUTWARD") {
                            localStorage.removeItem("active_ai_plan");
                            localStorage.removeItem("active_ai_selection");
                            sessionStorage.removeItem("active_ai_plan");
                            sessionStorage.removeItem("active_ai_selection");
                        }
                    } catch {
                        // Ignore storage errors
                    }
                } else {
                    setPlanData(null);
                    setInwardPlan(null);
                    setOutwardPlan(null);
                    setSelectedPlanType("");
                    setLastSelection(null);
                    try {
                        localStorage.removeItem("active_ai_plan");
                        localStorage.removeItem("active_ai_selection");
                        localStorage.removeItem("active_outward_plan");
                        localStorage.removeItem("active_inward_plan");
                        sessionStorage.removeItem("active_ai_plan");
                        sessionStorage.removeItem("active_ai_selection");
                        sessionStorage.removeItem("active_outward_plan");
                        sessionStorage.removeItem("active_inward_plan");
                    } catch {
                        // Ignore storage errors
                    }
                }

                setStalePlanInfo(null);
                setGenerationError("");
                setSelectionMessage("");

                const dirName = targetDirection === "INWARD" ? "Inward" : targetDirection === "OUTWARD" ? "Outward" : "AI";
                const msg = `${dirName} transportation plan has been reset successfully. Student travel responses remain preserved.`;

                setResetSuccessMessage(msg);
                toast.success(`${dirName} transportation plan has been reset successfully.`);
                await loadActivePlan(false, targetDirection, true);
                loadAIData(); // Refresh counts in background
                await refreshPlanStatusAndLateResponses();
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
        if (isSavingSelectionRef.current || savingSelection) {
            return;
        }

        const effectivePlanType = selectedPlanType || (isPlanSaved ? (lastSelection?.planType || "AI") : "AI");
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

        if (isPlanInvalidated) {
            toast.error("This plan is invalidated due to demand changes. Please regenerate the plan before confirming.");
            return;
        }

        const planDirection =
            planDirectionTab ||
            planData?.direction ||
            (tripMode === "FROM_SOURCE" ? "OUTWARD" : "INWARD");

        try {
            // Stage the pending plan in sessionStorage — instantaneous, ZERO database/allocation overhead!
            const pendingPayload = {
                planType: effectivePlanType,
                direction: planDirection,
                tripMode: tripMode,
                plan: selectedPlan,
                startingPoint:
                    planData?.startingPoint ||
                    sourceLocation ||
                    destinationLocation ||
                    null,
                stagedAt: new Date().toISOString()
            };

            sessionStorage.setItem("pending_confirmation_plan", JSON.stringify(pendingPayload));

            try {
                localStorage.setItem("active_confirmation_direction", planDirection);
                localStorage.setItem("active_confirmation_plan_type", effectivePlanType);
            } catch (e) {
                // Ignore storage quota
            }

            // Navigate immediately to Final Confirmation page
            navigate(`/admin/plan-confirmation?direction=${planDirection}&type=${effectivePlanType}&pending=1`);
        } catch (error) {
            console.error("Failed to stage pending plan:", error);
            toast.error("Unable to prepare plan confirmation. Please try again.");
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
    const hasActivePlan = Boolean(aiPlan || planData?.buses?.length > 0 || (planData?.summary && planData.summary.allocatedSeats > 0));

    const theoreticalMinBuses = Number(
        data?.requiredBusesCount ??
        summary?.requiredBusesCount ??
        aiPlan?.theoreticalMinimum ??
        aiPlan?.minimumCapacityBuses ??
        (summary?.confirmedUsers > 0
            ? Math.max(1, Math.ceil(summary.confirmedUsers / (data?.vehicles?.[0]?.capacity || 65)))
            : 1)
    );

    const feasibleBusesCount = Number(
        aiPlan?.feasibleBusCount ??
        aiPlan?.buses?.length ??
        theoreticalMinBuses
    );

    const activeStartingPlacesCount = inwardStartingPlaces.filter((sp) => sp.active).length;
    const hasSufficientStartingPlaces = activeStartingPlacesCount >= (hasActivePlan ? feasibleBusesCount : theoreticalMinBuses);

    const aiAssigned =
        Number(aiPlan?.assignedUsers || 0);

    const aiUnassigned =
        Number(aiPlan?.unassignedUsers || 0);

    const aiCapacity =
        Number(aiPlan?.allocatedSeats || aiPlan?.totalCapacity || 0);

    const aiAvailableCapacity =
        Number(
            aiPlan?.totalAvailableCapacity || aiPlan?.availableTotalCapacity || summary?.totalAvailableCapacity || 0
        );

    const aiPhysicalCapacity =
        Number(
            aiPlan?.physicalFleetCapacity || aiPlan?.totalPhysicalCapacity || aiPlan?.totalFleetCapacity || summary?.totalPhysicalCapacity || summary?.totalAvailableCapacity || aiAvailableCapacity || aiCapacity || 0
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
    const stalePlanForCurrentDir = planDirectionTab === "OUTWARD" ? stalePlanInfo?.outward : stalePlanInfo?.inward;
    const planDemandCount = planData?.summary?.confirmedUsers ?? planData?.comingUsers ?? stalePlanForCurrentDir?.planDemandCount ?? null;

    // Directional late response checks
    const inwardLateCount = Number(
        lateResponsesData?.inwardCount ??
        (Array.isArray(lateResponsesData?.affectedDirections) && lateResponsesData.affectedDirections.includes("INWARD")
            ? (lateResponsesData?.count || 0)
            : (lateResponsesData?.lateComingResponsesCount || 0)) ??
        0
    );
    const outwardLateCount = Number(
        lateResponsesData?.outwardCount ??
        (Array.isArray(lateResponsesData?.affectedDirections) && lateResponsesData.affectedDirections.includes("OUTWARD")
            ? (lateResponsesData?.count || 0)
            : (lateResponsesData?.lateComingResponsesCount || 0)) ??
        0
    );

    const isInwardLateAffected = Boolean(
        inwardLateCount > 0 ||
        (Array.isArray(lateResponsesData?.affectedDirections) && lateResponsesData.affectedDirections.includes("INWARD")) ||
        ((lateResponsesData?.count || 0) > 0 && (!lateResponsesData?.affectedDirections?.length || lateResponsesData?.affectedDirections?.includes("INWARD"))) ||
        inwardPlan?.requiresReview ||
        inwardPlan?.hasLateResponses ||
        inwardPlan?.pendingReallocation ||
        planStatusData?.inward?.requiresReview ||
        planStatusData?.inward?.hasLateResponses ||
        (planDirectionTab === "INWARD" && (manualPlanData?.requiresReview || manualPlanData?.hasLateResponses))
    );

    const isOutwardLateAffected = Boolean(
        outwardLateCount > 0 ||
        (Array.isArray(lateResponsesData?.affectedDirections) && lateResponsesData.affectedDirections.includes("OUTWARD")) ||
        ((lateResponsesData?.count || 0) > 0 && (!lateResponsesData?.affectedDirections?.length || lateResponsesData?.affectedDirections?.includes("OUTWARD"))) ||
        outwardPlan?.requiresReview ||
        outwardPlan?.hasLateResponses ||
        outwardPlan?.pendingReallocation ||
        planStatusData?.outward?.requiresReview ||
        planStatusData?.outward?.hasLateResponses ||
        (planDirectionTab === "OUTWARD" && (manualPlanData?.requiresReview || manualPlanData?.hasLateResponses))
    );

    const isInwardDemandMismatch = Boolean(
        (inwardPlan?.planDemandCount !== undefined && inwardPlan?.planDemandCount !== null && currentDemandCount > 0 && Number(inwardPlan.planDemandCount) !== Number(currentDemandCount)) ||
        (stalePlanInfo?.inward?.planDemandCount && Number(stalePlanInfo.inward.planDemandCount) !== Number(currentDemandCount)) ||
        planStatusData?.inward?.isStale
    );

    const isOutwardDemandMismatch = Boolean(
        (outwardPlan?.planDemandCount !== undefined && outwardPlan?.planDemandCount !== null && currentDemandCount > 0 && Number(outwardPlan.planDemandCount) !== Number(currentDemandCount)) ||
        (stalePlanInfo?.outward?.planDemandCount && Number(stalePlanInfo.outward.planDemandCount) !== Number(currentDemandCount)) ||
        planStatusData?.outward?.isStale
    );

    const hasInwardPlan = useMemo(() => {
        // When currently on Inward tab, the visible AI plan on screen is the authoritative source:
        if (planDirectionTab === "INWARD") {
            return Boolean(
                aiPlan &&
                aiPlan.status !== "ZERO_DEMAND" &&
                Array.isArray(aiPlan.buses) &&
                aiPlan.buses.length > 0 &&
                (aiPlan.direction === "INWARD" || aiPlan.tripMode === "TO_DESTINATION" || !aiPlan.direction)
            );
        }

        // When currently on Outward tab, check if a valid Inward AI plan was generated and stored:
        if (!inwardPlan || inwardPlan.status === "ZERO_DEMAND") return false;
        const dir = inwardPlan.direction || inwardPlan.tripMode;
        if (dir && dir !== "INWARD" && dir !== "TO_DESTINATION") return false;
        const buses = inwardPlan.buses || inwardPlan.routes || inwardPlan.aiPlan?.buses;
        return Boolean(Array.isArray(buses) && buses.length > 0);
    }, [planDirectionTab, aiPlan, inwardPlan]);

    const hasOutwardPlan = useMemo(() => {
        // When currently on Outward tab, the visible AI plan on screen is the authoritative source:
        if (planDirectionTab === "OUTWARD") {
            return Boolean(
                aiPlan &&
                aiPlan.status !== "ZERO_DEMAND" &&
                Array.isArray(aiPlan.buses) &&
                aiPlan.buses.length > 0 &&
                (aiPlan.direction === "OUTWARD" || aiPlan.tripMode === "FROM_SOURCE" || !aiPlan.direction)
            );
        }

        // When currently on Inward tab, check if a valid Outward AI plan was generated and stored:
        if (!outwardPlan || outwardPlan.status === "ZERO_DEMAND") return false;
        const dir = outwardPlan.direction || outwardPlan.tripMode;
        if (dir && dir !== "OUTWARD" && dir !== "FROM_SOURCE") return false;
        const buses = outwardPlan.buses || outwardPlan.routes || outwardPlan.aiPlan?.buses;
        return Boolean(Array.isArray(buses) && buses.length > 0);
    }, [planDirectionTab, aiPlan, outwardPlan]);

    const isInwardResetRequired = Boolean(
        hasInwardPlan && (
            isInwardLateAffected ||
            isInwardDemandMismatch ||
            inwardPlan?.requiresReset ||
            inwardPlan?.isStale ||
            stalePlanInfo?.inward ||
            planStatusData?.inward?.requiresReset
        )
    );

    const isOutwardResetRequired = Boolean(
        hasOutwardPlan && (
            isOutwardLateAffected ||
            isOutwardDemandMismatch ||
            outwardPlan?.requiresReset ||
            outwardPlan?.isStale ||
            stalePlanInfo?.outward ||
            planStatusData?.outward?.requiresReset
        )
    );

    const isCurrentResetRequired = planDirectionTab === "OUTWARD" ? isOutwardResetRequired : isInwardResetRequired;
    const hasCurrentActivePlan = Boolean(
        hasActivePlan ||
        (planDirectionTab === "OUTWARD" ? hasOutwardPlan : hasInwardPlan) ||
        displayedManualRoutes.length > 0 ||
        manualPlanData?.isApproved
    );

    const isPlanInvalidated = isCurrentResetRequired;

    const resetReasonText = (() => {
        const isOut = planDirectionTab === "OUTWARD";
        const isLate = isOut ? isOutwardLateAffected : isInwardLateAffected;
        const lateCount = isOut ? outwardLateCount : inwardLateCount;
        const dirName = isOut ? "Outward" : "Inward";
        const staleReason = (isOut ? outwardPlan?.staleReason : inwardPlan?.staleReason) || stalePlanInfo?.reason;

        if (isLate) {
            return `A student has submitted a late Coming response after the ${dirName} transportation plan was approved and allocated (${lateCount > 0 ? `${lateCount} student(s)` : "pending student reallocation"}). The plan requires a reset or re-generation so that all confirmed passengers can be accommodated.`;
        }
        if (staleReason) {
            return staleReason;
        }
        if (planDemandCount !== null && currentDemandCount > 0 && planDemandCount !== currentDemandCount) {
            return `Current Coming Users: ${currentDemandCount}. The previous plan was generated for ${planDemandCount} passengers and cannot be used as current operational data. Please reset the ${dirName} plan or regenerate to calculate a valid plan for all ${currentDemandCount} passengers.`;
        }
        return `The current ${dirName} plan state requires a reset to synchronize with updated passenger demand and allocations.`;
    })();

    return (
        <div className="ai-page">

            {/* Campus & Bus Background Illustration */}
            <div className="ai-hero-bg" aria-hidden="true">
                <div className="ai-hero-illustration"></div>
            </div>

            {/* Header */}
            <div className="ai-header">
                <div className="ai-header-left">
                    <button
                        type="button"
                        className="ai-back-btn"
                        onClick={() => navigate("/admin-dashboard")}
                        aria-label="Go back"
                    >
                        <HiArrowLeft size={16} />
                        Back
                    </button>
                    <h1 className="ai-page-title">AI ROUTE OPTIMIZATION</h1>
                    <p className="ai-page-subtitle">
                        The AI Agent independently generates optimized transportation routes using confirmed student demand, stopping areas, vehicle capacities, and availability.
                    </p>
                </div>

                <div className="ai-header-actions">
                    <div className={`ai-ready ${generating
                        ? "generating"
                        : generationError
                            ? "error"
                            : isCurrentResetRequired
                                ? "invalidated reset-required"
                                : hasCurrentActivePlan
                                    ? "generated"
                                    : "ready"
                        }`}>
                        <span className="ready-dot"></span>
                        {generating
                            ? "Generating optimized route..."
                            : generationError
                                ? "Route generation failed"
                                : isCurrentResetRequired
                                    ? "Reset Required"
                                    : hasCurrentActivePlan
                                        ? "AI Route Generated"
                                        : "AI Engine Ready"}
                    </div>

                    <button
                        type="button"
                        className="reset-ai-route-btn"
                        onClick={() =>
                            setShowResetModal(true)
                        }
                        title={`Reset ${planDirectionTab === "OUTWARD" ? "Outward" : "Inward"} AI Transportation Plan`}
                    >
                        🔄 Reset {planDirectionTab === "OUTWARD" ? "Outward" : "Inward"} AI Plan
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
                            {planDirectionTab === "INWARD" ? "Inward" : planDirectionTab === "OUTWARD" ? "Outward" : "Transportation"} Plan Reset Complete
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

            {/* State Invalidation / Reset Required Alert Banner */}
            {isCurrentResetRequired && (
                <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "14px",
                    background: "#fef2f2",
                    border: "1.5px solid #fecaca",
                    borderRadius: "12px",
                    padding: "16px 20px",
                    marginBottom: "24px",
                    color: "#991b1b"
                }}>
                    <span style={{ fontSize: "28px" }}>⚠️</span>
                    <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                            <span style={{
                                background: "#dc2626",
                                color: "#fff",
                                fontSize: "11px",
                                fontWeight: "800",
                                padding: "2px 8px",
                                borderRadius: "4px",
                                letterSpacing: "0.5px"
                            }}>
                                RESET REQUIRED
                            </span>
                            <strong style={{ fontSize: "14px", color: "#7f1d1d" }}>
                                {planDirectionTab === "OUTWARD" ? "Outward" : "Inward"} Plan Reset Required
                            </strong>
                        </div>
                        <p style={{ margin: 0, fontSize: "13.5px", color: "#991b1b", lineHeight: "1.5" }}>
                            {resetReasonText}
                        </p>
                    </div>
                    {planDirectionTab === "OUTWARD" && (
                        <button
                            type="button"
                            className="reset-ai-route-btn"
                            onClick={() => setShowResetModal(true)}
                            style={{
                                background: "#dc2626",
                                color: "#fff",
                                border: "none",
                                padding: "8px 14px",
                                borderRadius: "6px",
                                fontWeight: "700",
                                cursor: "pointer",
                                fontSize: "12px",
                                whiteSpace: "nowrap"
                            }}
                        >
                            🔄 Reset Outward Plan
                        </button>
                    )}
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
            <section className="ai-section endpoint-section">

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

                    {/* LIVE INWARD FLEET REQUIREMENTS */}
                    <div className="inward-live-requirements-banner">
                        <div className="live-req-item">
                            <span className="live-req-icon">🟢</span>
                            <div>
                                <small>Confirmed Coming Students</small>
                                <strong>{formatNumber(data?.confirmedUserCount ?? data?.comingUsers ?? summary?.confirmedUsers ?? 0)}</strong>
                            </div>
                        </div>
                        <div className="live-req-item">
                            <span className="live-req-icon">🚌</span>
                            <div>
                                <small>Required Fleet Capacity</small>
                                <strong>{formatNumber(data?.requiredCapacity ?? summary?.requiredCapacity ?? (data?.confirmedUserCount ?? data?.comingUsers ?? 0))}+</strong>
                            </div>
                        </div>
                        <div className="live-req-item">
                            <span className="live-req-icon">🚍</span>
                            <div>
                                <small>Theoretical Min Buses (Capacity)</small>
                                <strong>{theoreticalMinBuses}</strong>
                            </div>
                        </div>
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

                    {/* COMPACT INWARD BUS STARTING PLACES NAVIGATION CARD */}
                    <div
                        className="inward-starting-nav-card"
                        onClick={() => navigate("/admin/inward-starting-places")}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                                navigate("/admin/inward-starting-places");
                            }
                        }}
                    >
                        <div className="inward-nav-card-left">
                            <div className="inward-nav-icon-box">
                                <span className="inward-nav-icon">📍</span>
                            </div>
                            <div className="inward-nav-body">
                                <div className="inward-nav-title-row">
                                    <h3 className="inward-nav-title">Inward Bus Starting Places</h3>
                                    <span
                                        className={`inward-nav-status-badge ${
                                            hasSufficientStartingPlaces ? "ready" : "warning"
                                        }`}
                                    >
                                        {hasSufficientStartingPlaces
                                            ? "✓ Ready to Generate"
                                            : "⚠️ Configuration Required"}
                                    </span>
                                </div>
                                <p className="inward-nav-desc">
                                    Configure and manage the starting hub/location for each inward bus.
                                </p>
                                <div className="inward-nav-readiness-row">
                                    <span className="inward-nav-metric-text">
                                        <strong>{feasibleBusesCount || theoreticalMinBuses}</strong>{" "}
                                        {(feasibleBusesCount || theoreticalMinBuses) === 1
                                            ? "bus"
                                            : "buses"}{" "}
                                        operationally required for{" "}
                                        <strong>
                                            {summary?.confirmedUsers ?? (data?.confirmedUserCount ?? 0)}
                                        </strong>{" "}
                                        passengers.
                                    </span>
                                    <span className="inward-nav-dot">•</span>
                                    <span className="inward-nav-metric-text">
                                        Theoretical minimum: <strong>{theoreticalMinBuses}</strong>{" "}
                                        {theoreticalMinBuses === 1 ? "bus" : "buses"}.
                                    </span>
                                    <span className="inward-nav-dot">•</span>
                                    <span className="inward-nav-metric-text">
                                        Configured active hubs:{" "}
                                        <strong>{activeStartingPlacesCount}</strong>.
                                    </span>
                                    {hasSufficientStartingPlaces && (
                                        <>
                                            <span className="inward-nav-dot">•</span>
                                            <span className="inward-nav-ready-text">
                                                All selected inward buses have configured starting places.
                                            </span>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="inward-nav-card-right">
                            <span className="inward-nav-link-btn">
                                View &amp; Manage Starting Places{" "}
                                <span className="inward-nav-arrow">→</span>
                            </span>
                        </div>
                    </div>

                </div>
            </section>

            {/* Section 2 */}
            <section className="ai-section plan-section">

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
                        <div className="error-box" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                            <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                                <strong>⚠</strong>
                                <span style={{ whiteSpace: "pre-line" }}>
                                    {generationError}
                                </span>
                            </div>
                            {generationError.toLowerCase().includes("inward starting place") && (
                                <button
                                    onClick={() => navigate("/admin/inward-starting-places")}
                                    style={{
                                        alignSelf: "flex-start",
                                        padding: "8px 16px",
                                        background: "linear-gradient(135deg, #059669 0%, #10b981 100%)",
                                        color: "#ffffff",
                                        border: "none",
                                        borderRadius: "6px",
                                        fontWeight: "600",
                                        fontSize: "13px",
                                        cursor: "pointer",
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: "6px"
                                    }}
                                >
                                    ➔ Configure Inward Starting Places
                                </button>
                            )}
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
                    {!aiPlan && !generating && (loading || planChecking) && (
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
                        !planChecking &&
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
                        !loading &&
                        !planChecking &&
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
                            alignItems: "center",
                            justifyContent: "space-between",
                            flexWrap: "wrap",
                            gap: "12px",
                            margin: "20px 0 16px 0",
                            padding: "6px 10px",
                            background: "#f1f5f9",
                            borderRadius: "10px",
                            width: "100%",
                            maxWidth: "760px"
                        }} id="plan-direction-tab-bar">
                            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                <button
                                    type="button"
                                    id="btn-tab-inward-plan"
                                    onClick={() => {
                                        if (planDirectionTab === "INWARD") return;
                                        let targetPlan = (inwardPlan && (inwardPlan.direction === "INWARD" || inwardPlan.tripMode === "TO_DESTINATION" || !inwardPlan.direction) && inwardPlan.status !== "ZERO_DEMAND" && Array.isArray(inwardPlan.buses) && inwardPlan.buses.length > 0) ? inwardPlan : null;
                                        if (!targetPlan) {
                                            try {
                                                const cached = localStorage.getItem("active_inward_plan");
                                                if (cached) {
                                                    const parsed = JSON.parse(cached);
                                                    if (parsed && parsed.status !== "ZERO_DEMAND" && (parsed.aiPlan || (Array.isArray(parsed.buses) && parsed.buses.length > 0))) {
                                                        targetPlan = parsed;
                                                    }
                                                }
                                            } catch { }
                                        }
                                        if (targetPlan) {
                                            setPlanData(targetPlan);
                                            setPlanChecking(false);
                                        } else {
                                            setPlanChecking(true);
                                        }
                                        setPlanDirectionTab("INWARD");
                                        planDirectionTabRef.current = "INWARD";
                                        setActiveEndpointField("destination");
                                        setTripMode("TO_DESTINATION");
                                        try {
                                            localStorage.setItem("active_plan_direction", "INWARD");
                                        } catch { }
                                        loadLastSelection("INWARD");
                                    }}
                                    style={{
                                        padding: "8px 18px",
                                        borderRadius: "8px",
                                        border: "none",
                                        fontWeight: "700",
                                        fontSize: "13px",
                                        cursor: "pointer",
                                        background: planDirectionTab === "INWARD" ? "#0284c7" : "transparent",
                                        color: planDirectionTab === "INWARD" ? "#ffffff" : (isInwardResetRequired ? "#b45309" : (hasInwardPlan ? "#334155" : "#64748b")),
                                        boxShadow: planDirectionTab === "INWARD" ? "0 2px 4px rgba(0,0,0,0.1)" : "none",
                                        transition: "all 0.2s"
                                    }}
                                >
                                    Inward Plan {isInwardResetRequired ? "⚠️ (Reset Required)" : (hasInwardPlan ? "✓" : "(Not Generated)")}
                                </button>
                                <button
                                    type="button"
                                    id="btn-tab-outward-plan"
                                    onClick={() => {
                                        if (planDirectionTab === "OUTWARD") return;
                                        let targetPlan = (outwardPlan && (outwardPlan.direction === "OUTWARD" || outwardPlan.tripMode === "FROM_SOURCE" || !outwardPlan.direction) && outwardPlan.status !== "ZERO_DEMAND" && Array.isArray(outwardPlan.buses) && outwardPlan.buses.length > 0) ? outwardPlan : null;
                                        if (!targetPlan) {
                                            try {
                                                const cached = localStorage.getItem("active_outward_plan");
                                                if (cached) {
                                                    const parsed = JSON.parse(cached);
                                                    if (parsed && parsed.status !== "ZERO_DEMAND" && (parsed.aiPlan || (Array.isArray(parsed.buses) && parsed.buses.length > 0))) {
                                                        targetPlan = parsed;
                                                    }
                                                }
                                            } catch { }
                                        }
                                        if (targetPlan) {
                                            setPlanData(targetPlan);
                                            setPlanChecking(false);
                                        } else {
                                            setPlanChecking(true);
                                        }
                                        setPlanDirectionTab("OUTWARD");
                                        planDirectionTabRef.current = "OUTWARD";
                                        setActiveEndpointField("source");
                                        setTripMode("FROM_SOURCE");
                                        try {
                                            localStorage.setItem("active_plan_direction", "OUTWARD");
                                        } catch { }
                                        loadLastSelection("OUTWARD");
                                    }}
                                    style={{
                                        padding: "8px 18px",
                                        borderRadius: "8px",
                                        border: "none",
                                        fontWeight: "700",
                                        fontSize: "13px",
                                        cursor: "pointer",
                                        background: planDirectionTab === "OUTWARD" ? "#7c3aed" : "transparent",
                                        color: planDirectionTab === "OUTWARD" ? "#ffffff" : (isOutwardResetRequired ? "#b45309" : (hasOutwardPlan ? "#334155" : "#64748b")),
                                        boxShadow: planDirectionTab === "OUTWARD" ? "0 2px 4px rgba(0,0,0,0.1)" : "none",
                                        transition: "all 0.2s"
                                    }}
                                >
                                    Outward Plan {isOutwardResetRequired ? "⚠️ (Reset Required)" : (hasOutwardPlan ? "✓" : "(Not Generated)")}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Plan Result Summary & Details */}
                    {aiPlan && !generating && (
                        <>
                            <OptimizationResultSummary
                                plan={planData}
                                summary={summary}
                                direction={planDirectionTab || (tripMode === "FROM_SOURCE" ? "OUTWARD" : "INWARD")}
                                onViewRoute={() => setShowSelectRouteModal(true)}
                            />

                            <div className="ai-plan-result" id="ai-plan-result-section">

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
                                                    Passenger demand exceeds total fleet capacity: <b>{aiPlan.comingUsers}</b> coming users vs <b>{aiPhysicalCapacity || aiAvailableCapacity}</b> total physical fleet seats. <b>{aiUnassigned}</b> users could not be allocated.
                                                </>
                                            ) : aiPlan.unallocatedReason === "SCHEDULE_CAPACITY" ? (
                                                <>
                                                    Active schedule limits available fleet capacity to <b>{aiAvailableCapacity || aiCapacity}</b> seats for <b>{aiPlan.comingUsers}</b> coming users. <b>{aiUnassigned}</b> users could not be scheduled.
                                                </>
                                            ) : (
                                                <>
                                                    <b>{aiUnassigned}</b> passengers could not be assigned to available routes due to corridor/bus capacity constraints. Total fleet capacity is <b>{aiPhysicalCapacity || aiAvailableCapacity}</b> seats (<b>{aiAvailableCapacity || aiCapacity}</b> scheduled) for <b>{aiPlan.comingUsers}</b> coming users.
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

                                {/* Standing Passengers Notice: shown when any bus is over-capacity */}
                                {aiPlan.hasOverCapacity && (
                                    <div className="overcapacity-plan-alert">
                                        <div className="alert-header">
                                            <span>🧍</span>
                                            <strong>OVER-CAPACITY: STANDING PASSENGERS ALLOCATED</strong>
                                        </div>
                                        <p>
                                            <b>{aiPlan.totalStandingPassengers}</b> passenger{aiPlan.totalStandingPassengers !== 1 ? "s" : ""} will travel as <b>standing passengers</b> across <b>{aiPlan.totalOverCapacityBuses}</b> bus{aiPlan.totalOverCapacityBuses !== 1 ? "es" : ""}.
                                            No suitable nearby alternative bus was available for these students — they are allocated to their original route and will travel standing.
                                        </p>
                                        <p style={{ marginTop: "6px", fontSize: "12px", opacity: 0.85 }}>
                                            ✅ All passengers are <b>allocated</b>. Individual bus cards below show the seated / standing breakdown per bus.
                                        </p>
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

                                            const isOutward =
                                                bus.direction === "OUTWARD" ||
                                                bus.tripMode === "OUTWARD" ||
                                                bus.tripMode === "FROM_SOURCE" ||
                                                planDirectionTab === "OUTWARD";

                                            const firstStop = Array.isArray(bus.stops) && bus.stops.length > 0 ? bus.stops[0] : null;
                                            const lastStop = Array.isArray(bus.stops) && bus.stops.length > 0 ? bus.stops[bus.stops.length - 1] : null;

                                            const inwardStartName =
                                                bus.inwardStartLocation?.name ||
                                                bus.inwardStartLocation?.locationName ||
                                                bus.startLocation?.name ||
                                                bus.startLocation?.locationName ||
                                                firstStop?.name ||
                                                "Starting Hub (Vehicle Depot Origin)";
                                            const inwardStartCoords =
                                                (firstStop?.latitude || bus.inwardStartLocation?.latitude || bus.startLocation?.latitude)
                                                    ? `${Number(firstStop?.latitude || bus.inwardStartLocation?.latitude || bus.startLocation?.latitude).toFixed(4)}, ${Number(firstStop?.longitude || bus.inwardStartLocation?.longitude || bus.startLocation?.longitude).toFixed(4)}`
                                                    : null;

                                            const outwardStartName =
                                                bus.sourceHub?.name ||
                                                planData?.source?.name ||
                                                sourceLocation?.name ||
                                                "K. L. N. College of Engineering (Campus Departure Terminal)";
                                            const outwardStartCoords =
                                                (sourceLocation?.latitude || planData?.source?.latitude || bus.sourceHub?.latitude)
                                                    ? `${Number(sourceLocation?.latitude || planData?.source?.latitude || bus.sourceHub?.latitude).toFixed(4)}, ${Number(sourceLocation?.longitude || planData?.source?.longitude || bus.sourceHub?.longitude).toFixed(4)}`
                                                    : null;

                                            const startingHubName = isOutward ? outwardStartName : inwardStartName;
                                            const startingHubCoords = isOutward ? outwardStartCoords : inwardStartCoords;

                                            const outwardEndName =
                                                bus.destinationHub?.name ||
                                                lastStop?.name ||
                                                "Outward Terminus (Final Drop-off Stop)";
                                            const outwardEndCoords =
                                                (lastStop?.latitude || bus.destinationHub?.latitude)
                                                    ? `${Number(lastStop?.latitude || bus.destinationHub?.latitude).toFixed(4)}, ${Number(lastStop?.longitude || bus.destinationHub?.longitude).toFixed(4)}`
                                                    : null;

                                            const inwardEndName =
                                                bus.destinationHub?.name ||
                                                planData?.destination?.name ||
                                                destinationLocation?.name ||
                                                planData?.startingPoint?.name ||
                                                "K. L. N. College of Engineering (Campus Terminal)";
                                            const inwardEndCoords =
                                                (destinationLocation?.latitude || planData?.destination?.latitude || bus.destinationHub?.latitude)
                                                    ? `${Number(destinationLocation?.latitude || planData?.destination?.latitude || bus.destinationHub?.latitude).toFixed(4)}, ${Number(destinationLocation?.longitude || planData?.destination?.longitude || bus.destinationHub?.longitude).toFixed(4)}`
                                                    : null;

                                            const tripEndPointName = isOutward ? outwardEndName : inwardEndName;
                                            const tripEndPointCoords = isOutward ? outwardEndCoords : inwardEndCoords;

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
                                                                {bus.vehicleName ||
                                                                    getBusName(bus, busIndex)}
                                                            </span>

                                                            <div>
                                                                <small className="bus-sector-label">
                                                                    {(bus.sectorName || "INSTITUTIONAL TRANSIT LINE")
                                                                        .replace(/\s*\((North|South|East|West|North-East|North-West|South-East|South-West|NE|NW|SE|SW)[^)]*\)\s*$/i, "")
                                                                        .trim()}
                                                                </small>

                                                                <h3>
                                                                    {(bus.routeName || getBusName(bus, busIndex))
                                                                        .replace(/\s*\((North|South|East|West|North-East|North-West|South-East|South-West|NE|NW|SE|SW)[^)]*\)\s*$/i, "")
                                                                        .trim()}
                                                                </h3>
                                                            </div>
                                                        </div>

                                                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                                            {bus.vehicleNumber && (
                                                                <span className="bus-plate-badge" title="Vehicle Registration Number">
                                                                    📋 {bus.vehicleNumber}
                                                                </span>
                                                            )}
                                                            <span
                                                                className={`seat-capacity${bus.isOverCapacity ? " over-capacity" : ""}`}
                                                            >
                                                                🚌{" "}
                                                                {
                                                                    bus.vehicleName || getBusName(bus, busIndex)
                                                                }{" "}
                                                                •{" "}
                                                                {
                                                                    assigned
                                                                }{" "}
                                                                /{" "}
                                                                {
                                                                    capacity
                                                                }{" "}
                                                                passengers
                                                                {Boolean(bus.isOverCapacity || (bus.standingPassengers && bus.standingPassengers > 0)) ? (
                                                                    ` ⚠️ (+${bus.standingPassengers ?? bus.overCapacityCount ?? Math.max(0, assigned - capacity)} standing)`
                                                                ) : null}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    <div className="bus-stats">

                                                        {remaining > 0 ? (
                                                            <span className="bus-stat-pill" style={{ color: "#15803d", background: "#f0fdf4", borderColor: "#bbf7d0" }}>
                                                                💺 <b>{remaining}</b> {remaining === 1 ? "seat available" : "seats available"}
                                                            </span>
                                                        ) : (!bus.isOverCapacity && (
                                                            <span className="bus-stat-pill" style={{ color: "#334155", background: "#f8fafc", borderColor: "#cbd5e1" }}>
                                                                💺 <b>Full capacity ({capacity} seats)</b>
                                                            </span>
                                                        ))}

                                                        {bus.standingPassengers > 0 && (
                                                            <span className="bus-stat-pill" style={{ color: "#b91c1c", background: "#fef2f2", borderColor: "#fecaca" }}>
                                                                🚶 <b>{bus.standingPassengers}</b> standing passengers
                                                            </span>
                                                        )}

                                                        <span className="bus-stat-pill">
                                                            📍 <b>{Array.isArray(bus.stops) ? bus.stops.length : 0}</b>{" "}
                                                            {(bus.direction === "OUTWARD" || bus.tripMode === "OUTWARD" || bus.tripMode === "FROM_SOURCE" || planDirectionTab === "OUTWARD")
                                                                ? "drop-off stops"
                                                                : "pickup stops"}
                                                        </span>

                                                        {bus.routeDistanceKm && (
                                                            <span className="bus-stat-pill">
                                                                🛣️ <b>{bus.routeDistanceKm} km</b> total route
                                                            </span>
                                                        )}

                                                        {(() => {
                                                            const totalDuration = bus.routeDurationMin ?? bus.totalRouteDurationMin ?? bus.totalRouteDuration;
                                                            if (totalDuration != null && totalDuration > 0) {
                                                                return (
                                                                    <span className="bus-stat-pill">
                                                                        ⏱️ <b>~{Math.round(totalDuration)} min</b> total travel time
                                                                    </span>
                                                                );
                                                            }
                                                            return null;
                                                        })()}

                                                        {bus.longestPassengerTravelTime != null && bus.longestPassengerTravelTime > 0 && (
                                                            <span className="bus-stat-pill">
                                                                ⏳ Max passenger commute: <b>~{Math.round(bus.longestPassengerTravelTime)} min</b>
                                                            </span>
                                                        )}

                                                        {bus.averagePassengerTravelTime != null && bus.averagePassengerTravelTime > 0 && (
                                                            <span className="bus-stat-pill">
                                                                📊 Avg commute: <b>~{Math.round(bus.averagePassengerTravelTime)} min</b>
                                                            </span>
                                                        )}

                                                        {bus.driverName && (
                                                            <span className="bus-stat-pill">
                                                                👨‍✈️ Driver: <b>{bus.driverName}</b>
                                                            </span>
                                                        )}

                                                    </div>

                                                    {/* Over-Capacity Breakdown: shown for any over-capacity bus (Inward or Outward) */}
                                                    {Boolean(bus.isOverCapacity || (bus.standingPassengers && bus.standingPassengers > 0)) ? (
                                                        <div className="overcapacity-breakdown">
                                                            <span className="overcapacity-row">
                                                                🪑 <b>Seated:</b>{" "}
                                                                {bus.seatedPassengers ?? capacity}
                                                            </span>
                                                            <span className="overcapacity-row">
                                                                🧍 <b>Standing:</b>{" "}
                                                                {bus.standingPassengers ?? bus.overCapacityCount ?? Math.max(0, assigned - capacity)}
                                                            </span>
                                                            <span className="overcapacity-row overcapacity-badge">
                                                                ⚠️ <b>Over Capacity:</b>{" "}
                                                                {bus.overCapacityCount ?? bus.standingPassengers ?? Math.max(0, assigned - capacity)} extra passengers will travel standing
                                                            </span>
                                                        </div>
                                                    ) : null}

                                                    {/* Route Timeline */}
                                                    <div className="route-timeline">

                                                        {/* Timeline Starting Hub (Origin) */}
                                                        <div className="timeline-start source-terminal-hub corridor-timeline-hub">
                                                            <span className="timeline-dot source-dot"></span>
                                                            <span className="timeline-number">0</span>
                                                            <div className="timeline-stop-content">
                                                                <div className="timeline-hub-header" style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                                                    <span className="corridor-hub-tag origin-tag">
                                                                        🚩 STARTING HUB
                                                                    </span>
                                                                    <strong style={{ fontSize: "14px", color: "#065f46" }}>
                                                                        {startingHubName}
                                                                    </strong>
                                                                </div>
                                                                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", marginTop: "3px" }}>
                                                                    <small style={{ color: "#059669", fontWeight: "700" }}>
                                                                        {isOutward
                                                                            ? "Campus Departure Terminal · All students board here"
                                                                            : "Vehicle Starting Hub · Depot Origin (Bus Departs Here)"}
                                                                    </small>
                                                                    
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {Array.isArray(
                                                            bus.stops
                                                        ) &&
                                                            bus.stops.map((stop, stopIndex) => {
                                                                    const isOutward =
                                                                        bus.direction === "OUTWARD" ||
                                                                        bus.tripMode === "OUTWARD" ||
                                                                        bus.tripMode === "FROM_SOURCE" ||
                                                                        planDirectionTab === "OUTWARD";

                                                                    // Combine stop name with any merged / represented stops (e.g., "Pudur, K.Pudur")
                                                                    const rawNames = [
                                                                        stop.name,
                                                                        ...(Array.isArray(stop.representedStops) ? stop.representedStops : []),
                                                                        ...(Array.isArray(stop.originalStopNames) ? stop.originalStopNames : [])
                                                                    ]
                                                                        .map((n) => String(n || "").trim())
                                                                        .filter(Boolean);

                                                                    const uniqueNames = [];
                                                                    rawNames.forEach((n) => {
                                                                        if (!uniqueNames.some((existing) => existing.toLowerCase() === n.toLowerCase())) {
                                                                            uniqueNames.push(n);
                                                                        }
                                                                    });
                                                                    const stopDisplayName = uniqueNames.length > 0 ? uniqueNames.join(", ") : (stop.name || "Stop");

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

                                                                                <div className="stop-title-row" style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>

                                                                                    <strong>
                                                                                        👥 {stopDisplayName}
                                                                                    </strong>

                                                                                    {(isOutward || stopIndex > 0) &&
                                                                                        stop.legDistanceKm !==
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

                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                }
                                                            )}

                                                        {/* Timeline Trip End Point (Destination) */}
                                                        <div className="timeline-start terminal-hub corridor-timeline-hub" style={{ borderLeftColor: isOutward ? "#7c3aed" : "#2563eb", background: isOutward ? "rgba(124, 58, 237, 0.08)" : "rgba(37, 99, 235, 0.08)", padding: "10px 14px", borderRadius: "10px", marginTop: "8px", border: `1px solid ${isOutward ? "rgba(124, 58, 237, 0.3)" : "rgba(37, 99, 235, 0.3)"}` }}>
                                                            <span className="timeline-dot terminal-dot" style={{ background: isOutward ? "#7c3aed" : "#2563eb", boxShadow: `0 0 8px ${isOutward ? "rgba(124, 58, 237, 0.5)" : "rgba(37, 99, 235, 0.5)"}` }}></span>
                                                            <span className="timeline-number" style={{ background: isOutward ? "#f5f3ff" : "#eff6ff", color: isOutward ? "#6d28d9" : "#1d4ed8" }}>🏁</span>
                                                            <div className="timeline-stop-content">
                                                                <div className="timeline-hub-header" style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                                                    <span className="corridor-hub-tag destination-tag">
                                                                        🏁 TRIP END POINT
                                                                    </span>
                                                                    <strong style={{ fontSize: "14px", color: isOutward ? "#581c87" : "#1e3a8a" }}>
                                                                        {tripEndPointName}
                                                                    </strong>
                                                                </div>
                                                                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", marginTop: "3px" }}>
                                                                    <small style={{ color: isOutward ? "#7c3aed" : "#2563eb", fontWeight: "700" }}>
                                                                        {isOutward
                                                                            ? "Outward Terminus · Final Drop-off Destination"
                                                                            : "Institutional Campus Terminal · Final Destination Arrival"}
                                                                    </small>
                                                                    
                                                                </div>
                                                            </div>
                                                        </div>

                                                    </div>


                                                </div>
                                            );
                                        }
                                    )}

                                </div>

                                <div style={{ display: "flex", gap: "10px", marginTop: "16px", flexWrap: "wrap", alignItems: "center" }}>
                                    {(() => {
                                        const isCurrentApproved = Boolean(planData?.isApproved === true || (planData?.status === "active" && planData?.approvedAt));
                                        const isCurrentPending = Boolean(!isCurrentApproved && (planData?.isSubmitted === true || planData?.status === "pending_approval" || planData?.status === "generated"));

                                        if (isCurrentApproved) {
                                            if (isCurrentResetRequired) {
                                                if (planDirectionTab === "INWARD") {
                                                    return (
                                                        <div
                                                            style={{
                                                                flex: "1 1 auto",
                                                                padding: "10px 18px",
                                                                borderRadius: "8px",
                                                                background: "#fef3c7",
                                                                color: "#92400e",
                                                                border: "1.5px solid #fcd34d",
                                                                fontWeight: "700",
                                                                fontSize: "13px",
                                                                textAlign: "center"
                                                            }}
                                                        >
                                                            ⚠️ Reset Required (Demand / Late Response Changed)
                                                        </div>
                                                    );
                                                }
                                                return (
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowResetModal(true)}
                                                        style={{
                                                            flex: "1 1 auto",
                                                            padding: "10px 18px",
                                                            borderRadius: "8px",
                                                            background: "#fef3c7",
                                                            color: "#92400e",
                                                            border: "1.5px solid #fcd34d",
                                                            fontWeight: "700",
                                                            fontSize: "13px",
                                                            cursor: "pointer"
                                                        }}
                                                    >
                                                        ⚠️ Reset Required (Demand / Late Response Changed)
                                                    </button>
                                                );
                                            }
                                            return (
                                                <button
                                                    type="button"
                                                    disabled
                                                    style={{
                                                        flex: "1 1 auto",
                                                        padding: "10px 18px",
                                                        borderRadius: "8px",
                                                        background: "#dcfce7",
                                                        color: "#166534",
                                                        border: "1.5px solid #86efac",
                                                        fontWeight: "700",
                                                        fontSize: "13px",
                                                        cursor: "default"
                                                    }}
                                                >
                                                    ✓ AI Plan Approved &amp; Active in Database (Students Allocated)
                                                </button>
                                            );
                                        }

                                        if (isCurrentPending) {
                                            return (
                                                <button
                                                    type="button"
                                                    className="select-plan-btn"
                                                    onClick={async () => {
                                                        try {
                                                            setSavingSelection(true);
                                                            const planPayload = planData?.aiPlan || planData;
                                                            const currentDir = planDirectionTab || (tripMode === "FROM_SOURCE" ? "OUTWARD" : "INWARD");
                                                            await approveAIPlan({
                                                                planType: "AI",
                                                                direction: currentDir,
                                                                tripMode: tripMode,
                                                                plan: planPayload,
                                                                planId: planData?._id || planData?.planId,
                                                                startingPoint: planData?.startingPoint || sourceLocation || destinationLocation || null
                                                            });
                                                            toast.success("✓ AI Plan approved & students allocated in database!");
                                                            await loadActivePlan();
                                                            await refreshPlanStatusAndLateResponses();
                                                        } catch (err) {
                                                            console.error("Approve AI plan error:", err);
                                                            toast.error(err?.response?.data?.message || err?.message || "Failed to approve AI plan.");
                                                        } finally {
                                                            setSavingSelection(false);
                                                        }
                                                    }}
                                                    disabled={savingSelection || isPlanInvalidated}
                                                    title={isPlanInvalidated ? "Plan is invalidated due to demand changes. Please regenerate." : ""}
                                                    style={{
                                                        flex: "1 1 auto",
                                                        padding: "10px 18px",
                                                        borderRadius: "8px",
                                                        background: "#16a34a",
                                                        color: "#ffffff",
                                                        border: "none",
                                                        fontWeight: "700",
                                                        fontSize: "13px",
                                                        cursor: isPlanInvalidated ? "not-allowed" : "pointer"
                                                    }}
                                                >
                                                    {savingSelection ? "⏳ Approving & Allocating..." : "✓ Approve & Activate AI Plan"}
                                                </button>
                                            );
                                        }

                                        // Default / Generated Preview: Confirm (Submit for Approval)
                                        return (
                                            <button
                                                type="button"
                                                className="select-plan-btn"
                                                onClick={async () => {
                                                    try {
                                                        setSavingSelection(true);
                                                        const planPayload = planData?.aiPlan || planData;
                                                        const currentDir = planDirectionTab || (tripMode === "FROM_SOURCE" ? "OUTWARD" : "INWARD");
                                                        await confirmAIPlan({
                                                            planType: "AI",
                                                            direction: currentDir,
                                                            tripMode: tripMode,
                                                            plan: planPayload,
                                                            planId: planData?._id || planData?.planId,
                                                            startingPoint: planData?.startingPoint || sourceLocation || destinationLocation || null
                                                        });
                                                        toast.success("✓ AI Plan confirmed & submitted for approval! Students are NOT allocated yet.");
                                                        await loadActivePlan();
                                                    } catch (err) {
                                                        console.error("Confirm AI plan error:", err);
                                                        toast.error(err?.response?.data?.message || err?.message || "Failed to confirm AI plan.");
                                                    } finally {
                                                        setSavingSelection(false);
                                                    }
                                                }}
                                                disabled={savingSelection || isPlanInvalidated}
                                                title={isPlanInvalidated ? "Plan is invalidated due to demand changes. Please regenerate." : ""}
                                                style={{
                                                    flex: "1 1 auto",
                                                    padding: "10px 18px",
                                                    borderRadius: "8px",
                                                    background: "#0284c7",
                                                    color: "#ffffff",
                                                    border: "none",
                                                    fontWeight: "700",
                                                    fontSize: "13px",
                                                    cursor: isPlanInvalidated ? "not-allowed" : "pointer"
                                                }}
                                            >
                                                {savingSelection ? "⏳ Submitting..." : "✓ Confirm AI Plan (Submit for Approval)"}
                                            </button>
                                        );
                                    })()}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const hasOut = Boolean((outwardPlan?.buses || outwardPlan?.routes)?.length);
                                            const hasIn = Boolean((inwardPlan?.buses || inwardPlan?.routes)?.length);
                                            const targetDir = (hasOut && hasIn) ? "BOTH" : (planDirectionTab || "INWARD");
                                            navigate(`/admin/plan-confirmation?direction=${targetDir}&type=AI`);
                                        }}
                                        style={{
                                            padding: "10px 18px",
                                            borderRadius: "8px",
                                            background: "#eff6ff",
                                            color: "#2563eb",
                                            border: "1px solid #bfdbfe",
                                            fontWeight: "700",
                                            fontSize: "13px",
                                            cursor: "pointer"
                                        }}
                                    >
                                        🏁 Final Confirmation Page →
                                    </button>
                                </div>

                            </div>
                        </>
                    )}

                    {!aiPlan && !generating && (
                        <div className="ai-empty-state" style={{ textAlign: "center", padding: "48px 24px", background: "#f8fafc", borderRadius: "12px", border: "1px dashed #cbd5e1", marginTop: "16px" }}>
                            <div style={{ fontSize: "2.8rem", marginBottom: "12px" }}>🚌</div>
                            <h3 style={{ fontSize: "1.2rem", fontWeight: "700", color: "#1e293b", marginBottom: "8px" }}>
                                No AI route generated.
                            </h3>
                            <p style={{ color: "#64748b", fontSize: "0.95rem", margin: 0 }}>
                                Set a Source or Destination and click Generate AI Route.
                            </p>
                        </div>
                    )}

                </div>
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



        </div>
    );
}