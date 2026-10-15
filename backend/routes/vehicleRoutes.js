import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { requireAdmin } from "../middleware/authorizeMiddleware.js";
import { sensitiveActionLimiter } from "../middleware/rateLimiter.js";
import {
    getVehicles,
    addVehicle,
    updateVehicle,
    deleteVehicle
} from "../controllers/vehicleController.js";

const router = express.Router();

// Read operations: authenticated users
router.get("/", authMiddleware, getVehicles);

// Mutating operations: JWT auth -> Admin authorization -> Rate limiter -> Controller
router.post("/", authMiddleware, requireAdmin, sensitiveActionLimiter, addVehicle);
router.put("/:id", authMiddleware, requireAdmin, sensitiveActionLimiter, updateVehicle);
router.delete("/:id", authMiddleware, requireAdmin, sensitiveActionLimiter, deleteVehicle);

export default router;