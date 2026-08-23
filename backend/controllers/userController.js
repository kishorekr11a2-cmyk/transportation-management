import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import AiPlan from "../models/AiPlan.js";
import { isDbConnected } from "../config/db.js";
import { getUserAllocatedBus } from "../services/aiAgentService.js";

const dbUnavailableResponse = (res) => {
    return res.status(503).json({
        success: false,
        code: "DATABASE_UNAVAILABLE",
        message: "Database is currently unavailable."
    });
};

// =====================================================
// ADMIN LOGIN
// =====================================================

export const adminLogin = async (req, res) => {
    if (!isDbConnected()) {
        return dbUnavailableResponse(res);
    }

    try {
        const { userId, password } = req.body;

        if (!userId || !password) {
            return res.status(400).json({
                success: false,
                message: "All fields are required"
            });
        }

        const admin = await User.findOne({
            userId,
            role: "admin"
        });

        if (!admin) {
            return res.status(404).json({
                success: false,
                message: "Admin not found"
            });
        }

        // Check password (bcrypt compare or plain text fallback)
        let isMatch = password === admin.password;
        if (!isMatch && admin.password) {
            try {
                isMatch = await bcrypt.compare(password, admin.password);
            } catch {
                isMatch = false;
            }
        }

        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: "Invalid password"
            });
        }

        const token = jwt.sign(
            {
                id: admin._id,
                role: admin.role
            },
            process.env.JWT_SECRET || "default_jwt_secret",
            {
                expiresIn: "1d"
            }
        );

        res.json({
            success: true,
            message: "Admin Login Successful",
            token,
            user: {
                userId: admin.userId,
                name: admin.name,
                role: admin.role
            }
        });
    } catch (error) {
        console.error("Admin Login Error:", error.message);
        if (error.name === "MongooseError" || error.message?.includes("buffering") || !isDbConnected()) {
            return dbUnavailableResponse(res);
        }
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// =====================================================
// STUDENT / USER LOGIN
// =====================================================

export const studentLogin = async (req, res) => {
    if (!isDbConnected()) {
        return dbUnavailableResponse(res);
    }

    try {
        const { userId, password } = req.body;

        if (!userId || !password) {
            return res.status(400).json({
                success: false,
                message: "All fields are required"
            });
        }

        const student = await User.findOne({
            userId,
            role: "student"
        });

        if (!student) {
            return res.status(404).json({
                success: false,
                message: "Student not found"
            });
        }

        // Student password can be student.password or student.name (from Excel import)
        let isMatch = password === student.password || password === student.name;
        if (!isMatch && student.password) {
            try {
                isMatch = await bcrypt.compare(password, student.password);
            } catch {
                isMatch = false;
            }
        }

        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: "Invalid password"
            });
        }

        const token = jwt.sign(
            {
                id: student._id,
                role: student.role
            },
            process.env.JWT_SECRET || "default_jwt_secret",
            {
                expiresIn: "1d"
            }
        );

        const allocatedBus = await getUserAllocatedBus(student);

        res.json({
            success: true,
            message: "Student Login Successful",
            token,
            user: {
                userId: student.userId,
                name: student.name,
                stoppings: student.stoppings,
                travelStatus: student.travelStatus,
                role: student.role,
                allocatedBus
            }
        });
    } catch (error) {
        console.error("Student Login Error:", error.message);
        if (error.name === "MongooseError" || error.message?.includes("buffering") || !isDbConnected()) {
            return dbUnavailableResponse(res);
        }
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// =====================================================
// GET ALL STUDENTS
// =====================================================

export const getUsers = async (req, res) => {
    if (!isDbConnected()) {
        return dbUnavailableResponse(res);
    }

    try {
        const users = await User.find({
            role: "student"
        }).select("-password");

        res.status(200).json(users);
    } catch (error) {
        console.error("Get Users Error:", error.message);
        if (!isDbConnected()) return dbUnavailableResponse(res);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// =====================================================
// GET LOGGED-IN USER
// =====================================================

export const getCurrentUser = async (req, res) => {
    if (!isDbConnected()) {
        return dbUnavailableResponse(res);
    }

    try {
        const user = await User.findById(req.user.id).select("-password");

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        const allocatedBus = await getUserAllocatedBus(user);
        const userObj = user.toObject ? user.toObject() : { ...user };
        userObj.allocatedBus = allocatedBus;

        res.status(200).json({
            success: true,
            user: userObj
        });
    } catch (error) {
        console.error("Get Current User Error:", error.message);
        if (!isDbConnected()) return dbUnavailableResponse(res);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// =====================================================
// GET USER ALLOCATED BUS DIRECTLY
// =====================================================

export const getUserAllocation = async (req, res) => {
    if (!isDbConnected()) {
        return dbUnavailableResponse(res);
    }

    try {
        const user = await User.findById(req.user.id).select("-password");

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        const allocatedBus = await getUserAllocatedBus(user);

        res.status(200).json({
            success: true,
            allocatedBus,
            user: {
                userId: user.userId,
                name: user.name,
                stoppings: user.stoppings,
                travelStatus: user.travelStatus
            }
        });
    } catch (error) {
        console.error("Get User Allocation Error:", error.message);
        if (!isDbConnected()) return dbUnavailableResponse(res);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// =====================================================
// UPDATE TRAVEL STATUS (STUDENT / USER ONLY)
// =====================================================

export const updateTravelStatus = async (req, res) => {
    if (!isDbConnected()) {
        return dbUnavailableResponse(res);
    }

    try {
        const { travelStatus } = req.body;
        const allowedStatuses = ["Coming", "Not Coming"];

        if (!allowedStatuses.includes(travelStatus)) {
            return res.status(400).json({
                success: false,
                message: "Invalid travel status. Only 'Coming' or 'Not Coming' can be submitted."
            });
        }

        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        if (user.role !== "student") {
            return res.status(403).json({
                success: false,
                message: "Only users can update travel status"
            });
        }

        // Check if user has already submitted a response in the current cycle
        if (user.travelStatus && user.travelStatus !== "Pending") {
            return res.status(400).json({
                success: false,
                message: "Travel status already submitted. Please contact the administrator to reset your response before submitting again."
            });
        }

        user.travelStatus = travelStatus;
        await user.save();

        res.status(200).json({
            success: true,
            message: "Travel status updated successfully",
            travelStatus: user.travelStatus
        });
    } catch (error) {
        console.error("Update Travel Status Error:", error.message);
        if (!isDbConnected()) return dbUnavailableResponse(res);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// =====================================================
// GLOBAL RESET ALL USERS TRAVEL STATUS (ADMIN ONLY)
// =====================================================

export const resetAllUsersTravelStatus = async (req, res) => {
    if (!isDbConnected()) {
        return dbUnavailableResponse(res);
    }

    try {
        // Count affected students
        const usersToReset = await User.countDocuments({
            role: "student",
            travelStatus: { $in: ["Coming", "Not Coming"] }
        });

        const allocationsToRemove = await User.countDocuments({
            role: "student",
            $or: [
                { "allocatedBus.isAllocated": true },
                { allocatedBus: { $ne: null } }
            ]
        });

        // Reset travel status to Pending and remove all transportation allocations
        await User.updateMany(
            { role: "student" },
            {
                $set: {
                    travelStatus: "Pending",
                    allocatedBus: null
                }
            }
        );

        // Deactivate active generated AI plan recommendation in AiPlan
        await AiPlan.updateMany(
            { active: true },
            {
                $set: {
                    active: false,
                    status: "reset",
                    resetAt: new Date()
                }
            }
        );

        // Deactivate active approved plan in ai_selected_plans
        if (mongoose.connection.db) {
            await mongoose.connection.db.collection("ai_selected_plans").updateMany(
                { active: true },
                {
                    $set: {
                        active: false,
                        status: "reset",
                        resetAt: new Date()
                    }
                }
            );
        }

        res.status(200).json({
            success: true,
            message: "Travel status cycle reset successfully. Generated AI routes and bus allocations cleared.",
            usersReset: usersToReset,
            allocationsRemoved: allocationsToRemove
        });
    } catch (error) {
        console.error("Global Reset Users Travel Status Error:", error.message);
        if (!isDbConnected()) return dbUnavailableResponse(res);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// =====================================================
// RESET INDIVIDUAL USER TRAVEL STATUS (ADMIN ONLY)
// =====================================================

export const resetUserTravelStatus = async (req, res) => {
    if (!isDbConnected()) {
        return dbUnavailableResponse(res);
    }

    try {
        const { userId } = req.params;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "User ID is required"
            });
        }

        // Find user by userId string or MongoDB _id
        const user = await User.findOne({
            $or: [
                { userId: userId },
                { _id: mongoose.Types.ObjectId.isValid(userId) ? userId : null }
            ].filter(Boolean)
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        // If user is already in Pending state and has no allocation, notify administrator
        if (user.travelStatus === "Pending" && (!user.allocatedBus || !user.allocatedBus.isAllocated)) {
            return res.status(400).json({
                success: false,
                message: "User travel status is already Pending."
            });
        }

        // Reset travel status to initial Pending state and clear allocation
        user.travelStatus = "Pending";
        user.allocatedBus = null;
        await user.save();

        res.status(200).json({
            success: true,
            message: "Travel status reset successfully. The user can now submit a new response.",
            user: {
                userId: user.userId,
                name: user.name,
                stoppings: user.stoppings,
                travelStatus: user.travelStatus,
                allocatedBus: null,
                role: user.role
            }
        });
    } catch (error) {
        console.error("Reset User Travel Status Error:", error.message);
        if (!isDbConnected()) return dbUnavailableResponse(res);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// =====================================================
// ADD USER
// =====================================================

export const addUser = async (req, res) => {
    if (!isDbConnected()) {
        return dbUnavailableResponse(res);
    }

    try {
        const user = new User(req.body);
        await user.save();

        res.status(201).json({
            success: true,
            message: "User added successfully",
            user
        });
    } catch (error) {
        console.error("Add User Error:", error.message);
        if (!isDbConnected()) return dbUnavailableResponse(res);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// =====================================================
// DELETE USER
// =====================================================

export const deleteUser = async (req, res) => {
    if (!isDbConnected()) {
        return dbUnavailableResponse(res);
    }

    try {
        const user = await User.findByIdAndDelete(req.params.id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        res.status(200).json({
            success: true,
            message: "User deleted successfully"
        });
    } catch (error) {
        console.error("Delete User Error:", error.message);
        if (!isDbConnected()) return dbUnavailableResponse(res);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};