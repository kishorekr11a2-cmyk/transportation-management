import express from "express";

import authMiddleware
    from "../middleware/authMiddleware.js";
import adminMiddleware
    from "../middleware/adminMiddleware.js";

import {
    getUsers,
    getCurrentUser,
    getUserAllocation,
    updateTravelStatus,
    resetAllUsersTravelStatus,
    resetUserTravelStatus,
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
// Get User Bus Allocation
// ===============================

router.get(
    "/allocated-bus",
    authMiddleware,
    getUserAllocation
);


// ===============================
// Update Travel Status (Student)
// ===============================

router.put(
    "/travel-status",
    authMiddleware,
    updateTravelStatus
);


// ===============================
// Global Reset All Users Travel Status (Admin)
// ===============================

router.put(
    "/reset-travel-status",
    authMiddleware,
    adminMiddleware,
    resetAllUsersTravelStatus
);


// ===============================
// Reset Individual User Travel Status (Admin)
// ===============================

router.put(
    "/:userId/reset-travel-status",
    authMiddleware,
    adminMiddleware,
    resetUserTravelStatus
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