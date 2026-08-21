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

// ===============================
// Admin Login
// ===============================
export const adminLogin = async (req, res) => {
    if (!isDbConnected()) {
        return dbUnavailableResponse(res);
    }

    try {
        const { userId, password } = req.body;

        if (!userId || !password) {
            return res.status(400).json({
                success: false,
                message: "All fields are required."
            });
        }

        const admin = await User.findOne({
            userId,
            role: "admin"
        });

        if (!admin) {
            return res.status(404).json({
                success: false,
                message: "Admin not found."
            });
        }

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
                message: "Invalid credentials."
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

        res.status(200).json({
            success: true,
            message: "Admin Login Successful",
            token,
            user: {
                id: admin._id,
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

// ===============================
// Student Login
// ===============================
export const studentLogin = async (req, res) => {
    if (!isDbConnected()) {
        return dbUnavailableResponse(res);
    }

    try {
        const { userId, password } = req.body;

        if (!userId || !password) {
            return res.status(400).json({
                success: false,
                message: "All fields are required."
            });
        }

        const student = await User.findOne({
            userId,
            role: "student"
        });

        if (!student) {
            return res.status(404).json({
                success: false,
                message: "Student not found."
            });
        }

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
                message: "Invalid credentials."
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

        res.status(200).json({
            success: true,
            message: "Student Login Successful",
            token,
            user: {
                id: student._id,
                userId: student.userId,
                name: student.name,
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