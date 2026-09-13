import axios from "axios";
import { getActiveToken } from "./api";
import {
    searchPlaces as globalSearchPlaces,
    normalizeLocation,
    isValidCoordinate
} from "./googleMapsService";

const API_BASE_URL =
    import.meta.env.VITE_API_URL ||
    "http://localhost:5000/api";

const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        "Content-Type": "application/json"
    }
});

// Automatically attach JWT Token
api.interceptors.request.use(
    (config) => {
        const token = getActiveToken();
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

/* -------------------------------------------------------
   GET AI METRICS (Fast Counts & Capacities)
------------------------------------------------------- */

export const getAIMetrics = async () => {
    const response = await api.get("/ai-agent/metrics");
    return response.data;
};

/* -------------------------------------------------------
   GET AI DATA
------------------------------------------------------- */

export const getAIData = async (params = {}) => {
    const response = await api.get("/ai-agent/data", { params });
    return response.data;
};

/* -------------------------------------------------------
   GET MANUAL ROUTES
------------------------------------------------------- */

export const getManualRoutes = async () => {
    const response = await api.get("/routes");
    return response.data;
};

/* -------------------------------------------------------
   UNIFIED SEARCH PLACES (Delegates to googleMapsService)
------------------------------------------------------- */

export const searchPlaces = async (query, signal = null) => {
    return await globalSearchPlaces(query, signal);
};

/* -------------------------------------------------------
   RESOLVE LOCATION
------------------------------------------------------- */

export const resolveLocation = async (query) => {
    const searchResponse = await searchPlaces(query);

    if (!searchResponse?.results?.length) {
        return {
            success: false,
            message: `No matching locations found for "${query}".`
        };
    }

    return {
        success: true,
        location: searchResponse.results[0]
    };
};

/* -------------------------------------------------------
   GENERATE AI RECOMMENDATIONS
------------------------------------------------------- */

export const generateRecommendations = async (payload) => {
    const response = await api.post("/ai-agent/recommendations", payload);
    return response.data;
};

/* -------------------------------------------------------
   GET ACTIVE SAVED AI PLAN
------------------------------------------------------- */

export const getActivePlan = async (params = {}) => {
    const response = await api.get("/ai-agent/active-plan", { params });
    return response.data;
};

/* -------------------------------------------------------
   RESET AI PLAN & STUDENT TRAVEL STATUSES
------------------------------------------------------- */

export const resetAIPlan = async (payload = {}) => {
    const response = await api.post("/ai-agent/reset", payload);
    return response.data;
};

/* -------------------------------------------------------
   SAVE FINAL PLAN
------------------------------------------------------- */

export const saveSelectedPlan = async (payload) => {
    const response = await api.post("/ai-agent/select-plan", payload);
    return response.data;
};

/* -------------------------------------------------------
   GET LAST SELECTED PLAN
------------------------------------------------------- */

export const getSelectedPlan = async (params = {}) => {
    const response = await api.get("/ai-agent/selected-plan", { params });
    return response.data;
};

/* -------------------------------------------------------
   MANUAL TRANSPORTATION PLAN METHODS
------------------------------------------------------- */

export const getManualPlan = async (params = {}) => {
    const response = await api.get("/routes/manual-plan", { params });
    return response.data;
};

export const confirmManualPlan = async (payload = {}) => {
    const response = await api.post("/routes/confirm-plan", payload);
    return response.data;
};

export const approveManualPlan = async (payload = {}) => {
    const response = await api.post("/routes/approve-plan", payload);
    return response.data;
};

export const resetManualPlan = async (payload = {}) => {
    const response = await api.post("/routes/reset-plan", payload);
    return response.data;
};

export const getManualPlanRecommendations = async (params = {}) => {
    const response = await api.get("/routes/manual-plan/recommendations", { params });
    return response.data;
};

/* -------------------------------------------------------
   LATE TRAVEL RESPONSE REGENERATION & APPROVAL METHODS
------------------------------------------------------- */

export const regenerateLateResponsePlan = async (payload = {}) => {
    const response = await api.post("/ai-agent/regenerate-late-response-plan", payload);
    return response.data;
};

export const getLateResponseDraft = async (params = {}) => {
    const response = await api.get("/ai-agent/late-response-draft", { params });
    return response.data;
};

export const approveLateResponsePlan = async (payload = {}) => {
    const response = await api.post("/ai-agent/approve-late-response-plan", payload);
    return response.data;
};

export const discardLateResponseDraft = async (payload = {}) => {
    const response = await api.post("/ai-agent/discard-late-response-draft", payload);
    return response.data;
};

/* -------------------------------------------------------
   FETCH LATE TRAVEL RESPONSES
------------------------------------------------------- */

export const fetchLateResponses = async () => {
    try {
        const response = await api.get("/users/late-responses");
        return response.data;
    } catch (error) {
        console.error("Failed to fetch late responses in aiAgentService:", error);
        return {
            success: false,
            count: 0,
            lateComingResponsesCount: 0,
            pendingReallocationUsersCount: 0,
            affectedDirections: [],
            lateResponses: [],
            message: error?.response?.data?.message || error.message || "Failed to fetch late responses."
        };
    }
};

export const getLateResponses = fetchLateResponses;

export default {
    getAIMetrics,
    getAIData,
    getManualRoutes,
    getManualPlan,
    getManualPlanRecommendations,
    confirmManualPlan,
    approveManualPlan,
    resetManualPlan,
    searchPlaces,
    resolveLocation,
    generateRecommendations,
    getActivePlan,
    resetAIPlan,
    saveSelectedPlan,
    getSelectedPlan,
    isValidCoordinate,
    normalizeLocation,
    regenerateLateResponsePlan,
    getLateResponseDraft,
    approveLateResponsePlan,
    discardLateResponseDraft,
    fetchLateResponses,
    getLateResponses
};