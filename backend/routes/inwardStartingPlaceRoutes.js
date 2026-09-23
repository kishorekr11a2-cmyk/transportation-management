import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import {
    getInwardStartingPlaces,
    addInwardStartingPlace,
    updateInwardStartingPlace,
    deleteInwardStartingPlace,
    toggleInwardStartingPlaceStatus
} from "../controllers/inwardStartingPlaceController.js";

const router = express.Router();

router.get("/", authMiddleware, getInwardStartingPlaces);
router.post("/", authMiddleware, addInwardStartingPlace);
router.put("/:id", authMiddleware, updateInwardStartingPlace);
router.delete("/:id", authMiddleware, deleteInwardStartingPlace);
router.patch("/:id/toggle", authMiddleware, toggleInwardStartingPlaceStatus);

export default router;
