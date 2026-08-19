import express from "express";
import multer from "multer";
import { uploadExcel } from "../controllers/excelController.js";

const router = express.Router();

// Store uploaded files inside uploads folder
const storage = multer.diskStorage({

    destination: function (req, file, cb) {
        cb(null, "uploads/");
    },

    filename: function (req, file, cb) {
        cb(null, Date.now() + "-" + file.originalname);
    }

});

const upload = multer({ storage });

// Upload Excel
router.post(
    "/upload",
    upload.single("file"),
    uploadExcel
);

export default router;