import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import { startWhatsApp } from "./services/whatsappService.js";
import { connectDB, getDBHealth } from "./config/db.js";

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
import inwardStartingPlaceRoutes from "./routes/inwardStartingPlaceRoutes.js";
import whatsappRoutes from "./routes/whatsappRoutes.js";
import secureRoutes from "./routes/secureRoutes.js";

import { apiRateLimiter } from "./middleware/rateLimiter.js";
import { getAIMetrics } from "./services/aiAgentService.js";
import { seedHistoricalRoutesIfEmpty } from "./services/historicalRouteService.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const allowedOrigins = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://localhost:5176",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:5175",
    "http://127.0.0.1:5176",
    "https://transportation-management-38b1.onrender.com"
];

app.use(
    cors({
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) {
                return callback(null, true);
            }

            console.warn(`[CORS] Blocked origin: ${origin}`);
            return callback(new Error("Origin not allowed by CORS"));
        },
        credentials: true,
        methods: [
            "GET",
            "POST",
            "PUT",
            "PATCH",
            "DELETE",
            "OPTIONS"
        ],
        allowedHeaders: [
            "Content-Type",
            "Authorization",
            "Cache-Control",
            "Pragma",
            "Expires"
        ]
    })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", apiRateLimiter);

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/vehicles", vehicleRoutes);
app.use("/api/routes", routeRoutes);
app.use("/api/schedules", scheduleRoutes);
app.use("/api/excel", excelRoutes);
app.use("/api/stops", stopRoutes);
app.use("/api/map-location", mapLocationRoutes);
app.use("/api/ai-agent", aiAgentRoutes);
app.use("/api/location", locationRoutes);
app.use("/api/inward-starting-places", inwardStartingPlaceRoutes);
app.use("/api/whatsapp", whatsappRoutes);
app.use("/api/secure", secureRoutes);

app.get("/api/health", (req, res) => {
    res.status(200).json({
        success: true,
        message: "Transportation Management API is running",
        timestamp: new Date().toISOString()
    });
});

app.get("/api/health/db", async (req, res) => {
    try {
        const health = await getDBHealth();
        res.status(200).json(health);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Database health check failed",
            error: error.message
        });
    }
});

app.get("/api/ai-agent/metrics", async (req, res, next) => {
    try {
        const metrics = await getAIMetrics();
        res.status(200).json(metrics);
    } catch (error) {
        next(error);
    }
});

app.use((err, req, res, next) => {
    console.error("[Server Error]", err);

    if (res.headersSent) {
        return next(err);
    }

    res.status(err.status || 500).json({
        success: false,
        message: err.message || "Internal server error"
    });
});

const startServer = async () => {
    try {
        await connectDB();

        await seedHistoricalRoutesIfEmpty();

        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);

            if (process.env.NODE_ENV === "production") {
                console.log("Production CORS enabled for the deployed frontend");
            }
        });

        startWhatsApp();
    } catch (error) {
        console.error("Failed to start server:", error);
        process.exit(1);
    }
};

startServer();