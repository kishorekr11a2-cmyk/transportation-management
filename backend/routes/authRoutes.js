import express from "express";

import {
    adminLogin,
    studentLogin
} from "../controllers/userController.js";


const router = express.Router();


// Admin Login
router.post(
    "/admin/login",
    adminLogin
);


// Student Login
router.post(
    "/student/login",
    studentLogin
);


export default router;