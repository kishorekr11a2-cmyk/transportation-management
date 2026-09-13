import express from "express";

import authMiddleware from "../middleware/authMiddleware.js";
import adminMiddleware from "../middleware/adminMiddleware.js";

import {
    getRoutes,
    addRoute,
    getRouteById,
    updateRoute,
    deleteRoute,
    getManualPlan,
    getManualPlanRecommendations,
    confirmManualPlan,
    approveManualPlan,
    resetManualPlan
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
    confirmManualPlan
);

router.post(
    "/approve-plan",
    authMiddleware,
    adminMiddleware,
    approveManualPlan
);

router.post(
    "/reset-plan",
    authMiddleware,
    adminMiddleware,
    resetManualPlan
);

router.post(
    "/",
    authMiddleware,
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
    updateRoute
);

router.delete(
    "/:id",
    authMiddleware,
    deleteRoute
);

export default router;