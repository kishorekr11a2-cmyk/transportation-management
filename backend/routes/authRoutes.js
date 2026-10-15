import express from "express";
import { authRateLimiter } from "../middleware/rateLimiter.js";
import {
    adminLogin,
    studentLogin
} from "../controllers/userController.js";

const router = express.Router();

// Admin Login (Protected by auth rate limiter against brute-force attacks)
router.post(
    "/admin/login",
    authRateLimiter,
    adminLogin
);

// Student Login (Protected by auth rate limiter against brute-force attacks)
router.post(
    "/student/login",
    authRateLimiter,
    studentLogin
);

export default router;