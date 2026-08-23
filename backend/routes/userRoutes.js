import express from "express";

import authMiddleware
    from "../middleware/authMiddleware.js";

import {
    getUsers,
    getCurrentUser,
    getUserAllocation,
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
// Get User Bus Allocation
// ===============================

router.get(
    "/allocated-bus",
    authMiddleware,
    getUserAllocation
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