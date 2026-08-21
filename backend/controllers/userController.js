import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { isDbConnected } from "../config/db.js";

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

        res.json({
            success: true,
            message: "Student Login Successful",
            token,
            user: {
                userId: student.userId,
                name: student.name,
                stoppings: student.stoppings,
                travelStatus: student.travelStatus,
                role: student.role
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

        res.status(200).json({
            success: true,
            user
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
// UPDATE TRAVEL STATUS
// =====================================================

export const updateTravelStatus = async (req, res) => {
    if (!isDbConnected()) {
        return dbUnavailableResponse(res);
    }

    try {
        const { travelStatus } = req.body;
        const allowedStatuses = ["Coming", "Not Coming", "Pending"];

        if (!allowedStatuses.includes(travelStatus)) {
            return res.status(400).json({
                success: false,
                message: "Invalid travel status"
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