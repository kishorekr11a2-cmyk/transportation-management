import xlsx from "xlsx";
import bcrypt from "bcryptjs";
import User from "../models/User.js";

export const uploadExcel = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "Please upload an Excel file."
            });
        }

        const workbook = xlsx.readFile(req.file.path);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = xlsx.utils.sheet_to_json(sheet);

        if (data.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Excel file is empty."
            });
        }

        const validRows = data.filter(
            row => row.userId && row.name && row.stoppings
        );

        if (validRows.length === 0) {
            return res.status(400).json({
                success: false,
                message: "No valid users found in Excel file."
            });
        }

        const users = [];

        for (const row of validRows) {
            const userId = row.userId.toString().trim();
            const name = row.name.toString().trim();
            const stoppings = row.stoppings.toString().trim();

            const existingUser = await User.findOne({
                userId,
                role: "student"
            });

            let password;

            if (existingUser?.password) {
                password = existingUser.password;
            } else {
                password = await bcrypt.hash(name, 8);
            }

            users.push({
                userId,
                name,
                stoppings,
                password,
                role: "student",
                travelStatus: "Pending"
            });
        }

        // Remove only old student users.
        // Admin users are never touched.
        await User.deleteMany({
            role: "student"
        });

        // Store the users from the newly uploaded Excel.
        await User.insertMany(users);

        const totalUsers = await User.countDocuments({
            role: "student"
        });

        res.status(200).json({
            success: true,
            message: "Excel data synchronized successfully.",
            totalUsers
        });

    } catch (error) {
        console.error("Excel Upload Error:", error);

        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};