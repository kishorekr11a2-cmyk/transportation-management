import express from "express";

import authMiddleware from "../middleware/authMiddleware.js";

import {

    getVehicles,

    addVehicle,

    updateVehicle,

    deleteVehicle

} from "../controllers/vehicleController.js";

const router = express.Router();

router.get("/", authMiddleware, getVehicles);

router.post("/", authMiddleware, addVehicle);

router.put("/:id", authMiddleware, updateVehicle);

router.delete("/:id", authMiddleware, deleteVehicle);

export default router;