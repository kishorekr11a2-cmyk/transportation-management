import express from "express";
import multer from "multer";
import authMiddleware from "../middleware/authMiddleware.js";
import { requireAdmin } from "../middleware/authorizeMiddleware.js";
import { sensitiveActionLimiter } from "../middleware/rateLimiter.js";
import { uploadExcel } from "../controllers/excelController.js";

const router = express.Router();

// Use fast in-memory buffer storage (avoids disk I/O, missing folder crashes, and file lockups)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 20 * 1024 * 1024 // 20MB
    }
});

// Upload Excel: JWT Auth -> Admin Authorization -> Rate Limiter -> Multer -> Controller
router.post(
    "/upload",
    authMiddleware,
    requireAdmin,
    sensitiveActionLimiter,
    (req, res, next) => {
        upload.single("file")(req, res, (err) => {
            if (err) {
                console.error("Multer file upload error:", err);
                return res.status(400).json({
                    success: false,
                    message: err.message || "Failed to parse uploaded file."
                });
            }
            next();
        });
    },
    uploadExcel
);

export default router;