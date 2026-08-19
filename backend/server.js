import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import connectDB from "./config/db.js";

import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import vehicleRoutes from "./routes/vehicleRoutes.js";
import routeRoutes from "./routes/routeRoutes.js";
import scheduleRoutes from "./routes/scheduleRoutes.js";
import excelRoutes from "./routes/excelRoutes.js";
import stopRoutes from "./routes/stopRoutes.js";
import mapLocationRoutes from "./routes/mapLocationRoutes.js";
import aiAgentRoutes from "./routes/aiAgentRoutes.js";

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

app.use(
    "/uploads",
    express.static(path.join(__dirname, "uploads"))
);

connectDB();

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/vehicles", vehicleRoutes);
app.use("/api/routes", routeRoutes);
app.use("/api/schedules", scheduleRoutes);
app.use("/api/excel", excelRoutes);
app.use("/api/stops", stopRoutes);
app.use("/api/map-locations", mapLocationRoutes);
app.use("/api/ai-agent", aiAgentRoutes);

app.get("/", (req, res) => {
    res.json({
        success: true,
        message:
            "AI Transportation Management System API is running"
    });
});

app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        message: "Server is healthy"
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
    console.log(
        `🚀 Server running on port ${PORT}`
    );
});