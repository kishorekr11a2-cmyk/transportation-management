import express from "express";

import authMiddleware from "../middleware/authMiddleware.js";

import {
    getRoutes,
    addRoute,
    getRouteById,
    updateRoute,
    deleteRoute
} from "../controllers/routeController.js";

const router = express.Router();

router.get(
    "/",
    getRoutes
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