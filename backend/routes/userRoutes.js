import express from "express";

import authMiddleware
    from "../middleware/authMiddleware.js";

import {
    getUsers,
    getCurrentUser,
    updateTravelStatus,
    addUser,
    deleteUser
} from "../controllers/userController.js";


const router = express.Router();


// ===============================
// Get All Students
// ===============================

router.get(
    "/",
    authMiddleware,
    getUsers
);


// ===============================
// Get Logged-In User
// ===============================

router.get(
    "/me",
    authMiddleware,
    getCurrentUser
);


// ===============================
// Update Travel Status
// ===============================

router.put(
    "/travel-status",
    authMiddleware,
    updateTravelStatus
);


// ===============================
// Add User
// ===============================

router.post(
    "/",
    authMiddleware,
    addUser
);


// ===============================
// Delete User
// ===============================

router.delete(
    "/:id",
    authMiddleware,
    deleteUser
);


export default router;