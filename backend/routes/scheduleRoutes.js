import express from "express";

import authMiddleware from "../middleware/authMiddleware.js";

import {
    getSchedules,
    addSchedule,
    updateSchedule,
    deleteSchedule
} from "../controllers/scheduleController.js";

const router = express.Router();

router.use(authMiddleware);

router.get(
    "/",
    getSchedules
);

router.post(
    "/",
    addSchedule
);

router.put(
    "/:id",
    updateSchedule
);

router.delete(
    "/:id",
    deleteSchedule
);

export default router;