import express from "express";

import authMiddleware from "../middleware/authMiddleware.js";
import adminMiddleware from "../middleware/adminMiddleware.js";
import { sensitiveActionLimiter } from "../middleware/rateLimiter.js";

import {
    getRoutes,
    addRoute,
    getRouteById,
    updateRoute,
    deleteRoute,
    getManualPlan,
    getManualPlanRecommendations,
    confirmManualPlan,
    regenerateManualPlan,
    approveManualPlan,
    resetManualPlan,
    resetManualAllocations
} from "../controllers/routeController.js";

const router = express.Router();

router.get(
    "/",
    getRoutes
);

// Manual Transportation Plan Endpoints (Must be above /:id routes)
router.get(
    "/manual-plan",
    authMiddleware,
    getManualPlan
);

router.get(
    "/manual-plan/recommendations",
    authMiddleware,
    getManualPlanRecommendations
);

router.post(
    "/confirm-plan",
    authMiddleware,
    adminMiddleware,
    sensitiveActionLimiter,
    confirmManualPlan
);

router.post(
    "/regenerate-plan",
    authMiddleware,
    adminMiddleware,
    sensitiveActionLimiter,
    regenerateManualPlan
);

router.post(
    "/approve-plan",
    authMiddleware,
    adminMiddleware,
    sensitiveActionLimiter,
    approveManualPlan
);

router.post(
    "/reset-plan",
    authMiddleware,
    adminMiddleware,
    sensitiveActionLimiter,
    resetManualPlan
);

router.post(
    "/reset-manual-allocations",
    authMiddleware,
    adminMiddleware,
    sensitiveActionLimiter,
    resetManualAllocations
);

router.post(
    "/",
    authMiddleware,
    adminMiddleware,
    sensitiveActionLimiter,
    addRoute
);

router.get(
    "/:id",
    authMiddleware,
    getRouteById
);

router.put(
    "/:id",
    authMiddleware,
    adminMiddleware,
    sensitiveActionLimiter,
    updateRoute
);

router.delete(
    "/:id",
    authMiddleware,
    adminMiddleware,
    sensitiveActionLimiter,
    deleteRoute
);

export default router;