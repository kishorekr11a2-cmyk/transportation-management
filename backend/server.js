import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import connectDB, { isDbConnected, getDbStatus } from "./config/db.js";

import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import vehicleRoutes from "./routes/vehicleRoutes.js";
import routeRoutes from "./routes/routeRoutes.js";
import scheduleRoutes from "./routes/scheduleRoutes.js";
import excelRoutes from "./routes/excelRoutes.js";
import stopRoutes from "./routes/stopRoutes.js";
import mapLocationRoutes from "./routes/mapLocationRoutes.js";
import aiAgentRoutes from "./routes/aiAgentRoutes.js";
import locationRoutes from "./routes/locationRoutes.js";

import { getAIMetrics } from "./services/aiAgentService.js";

dotenv.config();

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(
    cors({
        origin: [
            "http://localhost:5173",
            "http://localhost:5174",
            "http://localhost:5175",
            "http://localhost:5176"
        ],
        credentials: true
    })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Performance Timing Middleware for Key Admin & Data APIs
app.use((req, res, next) => {
    const isTargetEndpoint =
        req.path.startsWith("/api/admin/dashboard") ||
        req.path.startsWith("/api/users") ||
        req.path.startsWith("/api/vehicles") ||
        req.path.startsWith("/api/routes") ||
        req.path.startsWith("/api/ai-agent") ||
        req.path.startsWith("/api/schedules");

    if (isTargetEndpoint) {
        const start = Date.now();
        res.on("finish", () => {
            console.log(`[PERFORMANCE] ${req.method} ${req.originalUrl}: ${Date.now() - start} ms`);
        });
    }
    next();
});

app.use(
    "/uploads",
    express.static(path.join(__dirname, "uploads"))
);

connectDB();

app.get("/api/admin/dashboard/metrics", async (req, res) => {
    try {
        const metrics = await getAIMetrics();
        res.json(metrics);
    } catch (error) {
        console.error("Dashboard metrics error:", error);
        res.status(500).json({
            success: false,
            message: "Unable to load dashboard metrics."
        });
    }
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/vehicles", vehicleRoutes);
app.use("/api/routes", routeRoutes);
app.use("/api/schedules", scheduleRoutes);
app.use("/api/excel", excelRoutes);
app.use("/api/stops", stopRoutes);
app.use("/api/map-locations", mapLocationRoutes);
app.use("/api/ai-agent", aiAgentRoutes);
app.use("/api/location", locationRoutes);
app.use("/api/locations", locationRoutes);

app.get("/", (req, res) => {
    res.json({
        success: true,
        message:
            "AI Transportation Management System API is running"
    });
});

app.get("/api/health", (req, res) => {
    const dbConnected = isDbConnected();
    res.status(dbConnected ? 200 : 503).json({
        success: dbConnected,
        app: "ok",
        database: dbConnected ? "ok" : "unavailable",
        timestamp: new Date().toISOString()
    });
});

app.get("/api/health/db", (req, res) => {
    const dbStatus = getDbStatus();
    res.status(dbStatus.connected ? 200 : 503).json({
        success: dbStatus.connected,
        database: dbStatus.connected ? "ok" : "unavailable",
        details: {
            state: dbStatus.state,
            host: dbStatus.host,
            name: dbStatus.name
        },
        timestamp: new Date().toISOString()
    });
});

app.use((req, res) => {
    res.status(404).json({
        success: false,
        message:
            `Route not found: ${req.method} ${req.originalUrl}`
    });
});

app.use((err, req, res, next) => {
    console.error("Server Error:", err);

    res.status(500).json({
        success: false,
        message: "Internal server error",
        error:
            process.env.NODE_ENV === "development"
                ? err.message
                : undefined
    });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`[SERVER] Running on port ${PORT}`);
    console.log(
        `🚀 Server running on port ${PORT}`
    );
});