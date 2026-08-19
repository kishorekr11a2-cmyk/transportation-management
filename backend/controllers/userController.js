import jwt from "jsonwebtoken";
import User from "../models/User.js";


// =====================================================
// ADMIN LOGIN
// =====================================================

export const adminLogin = async (req, res) => {

    try {

        const {
            userId,
            password
        } = req.body;


        const admin = await User.findOne({
            userId,
            role: "admin"
        });


        if (!admin) {

            return res.status(404).json({
                message: "Admin not found"
            });

        }


        // Plain password check
        if (password !== admin.password) {

            return res.status(401).json({
                message: "Invalid password"
            });

        }


        const token = jwt.sign(
            {
                id: admin._id,
                role: admin.role
            },
            process.env.JWT_SECRET,
            {
                expiresIn: "1d"
            }
        );


        res.json({

            token,

            user: {
                userId: admin.userId,
                name: admin.name,
                role: admin.role
            }

        });


    } catch (error) {

        console.error(
            "Admin Login Error:",
            error
        );


        res.status(500).json({
            message: error.message
        });

    }

};


// =====================================================
// STUDENT / USER LOGIN
// =====================================================

export const studentLogin = async (req, res) => {

    try {

        const {
            userId,
            password
        } = req.body;


        const student = await User.findOne({
            userId,
            role: "student"
        });


        if (!student) {

            return res.status(404).json({
                message: "Student not found"
            });

        }


        // Excel name is used as password
        if (password !== student.name) {

            return res.status(401).json({
                message: "Invalid password"
            });

        }


        const token = jwt.sign(
            {
                id: student._id,
                role: student.role
            },
            process.env.JWT_SECRET,
            {
                expiresIn: "1d"
            }
        );


        res.json({

            token,

            user: {

                userId: student.userId,

                name: student.name,

                stoppings: student.stoppings,

                travelStatus:
                    student.travelStatus,

                role: student.role

            }

        });


    } catch (error) {

        console.error(
            "Student Login Error:",
            error
        );


        res.status(500).json({
            message: error.message
        });

    }

};


// =====================================================
// GET ALL STUDENTS
// =====================================================

export const getUsers = async (req, res) => {

    try {

        const users = await User.find({
            role: "student"
        }).select("-password");


        res.status(200).json(users);


    } catch (error) {

        console.error(
            "Get Users Error:",
            error
        );


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

    try {

        const user = await User.findById(
            req.user.id
        ).select("-password");


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

        console.error(
            "Get Current User Error:",
            error
        );


        res.status(500).json({

            success: false,

            message: error.message

        });

    }

};


// =====================================================
// UPDATE TRAVEL STATUS
// =====================================================

export const updateTravelStatus = async (
    req,
    res
) => {

    try {

        const {
            travelStatus
        } = req.body;


        const allowedStatuses = [
            "Coming",
            "Not Coming",
            "Pending"
        ];


        // Validate status
        if (
            !allowedStatuses.includes(
                travelStatus
            )
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Invalid travel status"

            });

        }


        // Find logged-in user
        const user = await User.findById(
            req.user.id
        );


        if (!user) {

            return res.status(404).json({

                success: false,

                message: "User not found"

            });

        }


        // Only students/users can
        // update travel status
        if (user.role !== "student") {

            return res.status(403).json({

                success: false,

                message:
                    "Only users can update travel status"

            });

        }


        // Update status
        user.travelStatus =
            travelStatus;


        await user.save();


        res.status(200).json({

            success: true,

            message:
                "Travel status updated successfully",

            travelStatus:
                user.travelStatus

        });


    } catch (error) {

        console.error(
            "Update Travel Status Error:",
            error
        );


        res.status(500).json({

            success: false,

            message: error.message

        });

    }

};


// =====================================================
// ADD USER
// =====================================================

export const addUser = async (
    req,
    res
) => {

    try {

        const user = new User(
            req.body
        );


        await user.save();


        res.status(201).json({

            success: true,

            message:
                "User added successfully",

            user

        });


    } catch (error) {

        console.error(
            "Add User Error:",
            error
        );


        res.status(500).json({

            success: false,

            message: error.message

        });

    }

};


// =====================================================
// DELETE USER
// =====================================================

export const deleteUser = async (
    req,
    res
) => {

    try {

        const user =
            await User.findByIdAndDelete(
                req.params.id
            );


        if (!user) {

            return res.status(404).json({

                success: false,

                message:
                    "User not found"

            });

        }


        res.status(200).json({

            success: true,

            message:
                "User deleted successfully"

        });


    } catch (error) {

        console.error(
            "Delete User Error:",
            error
        );


        res.status(500).json({

            success: false,

            message: error.message

        });

    }

};