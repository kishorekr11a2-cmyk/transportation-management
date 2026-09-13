import express from "express";
import multer from "multer";
import { uploadExcel } from "../controllers/excelController.js";

const router = express.Router();

// Use fast in-memory buffer storage (avoids disk I/O, missing folder crashes, and file lockups)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 20 * 1024 * 1024 // 20MB
    }
});

// Upload Excel with error handling wrapper to ensure requests never hang
router.post(
    "/upload",
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