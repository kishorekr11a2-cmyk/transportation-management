import axios from "axios";
import {
    searchPlaces as globalSearchPlaces,
    normalizeLocation,
    isValidCoordinate
} from "./locationSearchService";

const API_BASE_URL =
    import.meta.env.VITE_API_URL ||
    "http://localhost:5000/api";

const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        "Content-Type": "application/json"
    }
});

/* -------------------------------------------------------
   GET AI DATA
------------------------------------------------------- */

export const getAIData = async () => {
    const response = await api.get("/ai-agent/data");
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
   UNIFIED SEARCH PLACES (Delegates to locationSearchService)
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
   SAVE FINAL PLAN
------------------------------------------------------- */

export const saveSelectedPlan = async (payload) => {
    const response = await api.post("/ai-agent/select-plan", payload);
    return response.data;
};

/* -------------------------------------------------------
   GET LAST SELECTED PLAN
------------------------------------------------------- */

export const getSelectedPlan = async () => {
    const response = await api.get("/ai-agent/selected-plan");
    return response.data;
};

export default {
    getAIData,
    getManualRoutes,
    searchPlaces,
    resolveLocation,
    generateRecommendations,
    saveSelectedPlan,
    getSelectedPlan,
    isValidCoordinate,
    normalizeLocation
};