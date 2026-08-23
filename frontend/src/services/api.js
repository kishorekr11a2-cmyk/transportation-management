import axios from "axios";

const API_BASE_URL =
    import.meta.env?.VITE_API_URL ||
    "http://localhost:5000/api";

const api = axios.create({
    baseURL: API_BASE_URL
});

// Helper to get active JWT token with multi-tab isolation
export const getActiveToken = () => {
    // 1. Per-tab isolated session token
    const sessionToken = sessionStorage.getItem("token");
    if (sessionToken) {
        return sessionToken;
    }

    // 2. Context-aware fallback from localStorage
    const path = typeof window !== "undefined" ? window.location.pathname.toLowerCase() : "";
    if (path.includes("student")) {
        const studentToken = localStorage.getItem("student_token") || localStorage.getItem("token");
        if (studentToken) {
            try { sessionStorage.setItem("token", studentToken); } catch {}
            return studentToken;
        }
    } else if (path.includes("admin") || path.includes("ai-agent") || path.includes("routes") || path.includes("users") || path.includes("schedule") || path.includes("vehicles") || path.includes("excel")) {
        const adminToken = localStorage.getItem("admin_token") || localStorage.getItem("token");
        if (adminToken) {
            try { sessionStorage.setItem("token", adminToken); } catch {}
            return adminToken;
        }
    }

    // 3. General fallback
    return localStorage.getItem("token");
};

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

export default api;