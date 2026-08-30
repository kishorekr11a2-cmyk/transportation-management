import xlsx from "xlsx";
import bcrypt from "bcryptjs";
import User from "../models/User.js";

// Helper to look up key case-insensitively with alias support
const getFieldValue = (row, ...keys) => {
    for (const key of keys) {
        if (row[key] !== undefined && row[key] !== null) {
            return row[key].toString().trim();
        }
        const lowerKey = key.toLowerCase().replace(/[\s_-]/g, "");
        const matched = Object.keys(row).find(
            (k) => k.toLowerCase().replace(/[\s_-]/g, "") === lowerKey
        );
        if (matched && row[matched] !== undefined && row[matched] !== null) {
            return row[matched].toString().trim();
        }
    }
    return "";
};

export const uploadExcel = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "Please upload an Excel file."
            });
        }

        const workbook = xlsx.readFile(req.file.path);
        const sheetNames = workbook.SheetNames;
        if (!sheetNames || sheetNames.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Excel workbook contains no sheets."
            });
        }

        const sheet = workbook.Sheets[sheetNames[0]];
        const data = xlsx.utils.sheet_to_json(sheet);

        if (!data || data.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Excel file is empty."
            });
        }

        // ==========================================
        // 6 REQUIRED COLUMNS VALIDATION
        // ==========================================
        const sampleRow = data[0];
        const rowKeys = Object.keys(sampleRow).map((k) =>
            k.toLowerCase().replace(/[\s_-]/g, "")
        );

        const REQUIRED_COLUMNS = [
            { field: "userId", aliases: ["userid", "user_id", "id"] },
            { field: "name", aliases: ["name", "studentname", "username"] },
            { field: "stoppings", aliases: ["stoppings", "stopping", "stop", "stoppingarea"] },
            { field: "city", aliases: ["city"] },
            { field: "state", aliases: ["state"] },
            { field: "country", aliases: ["country"] }
        ];

        for (const reqCol of REQUIRED_COLUMNS) {
            const hasCol = reqCol.aliases.some((alias) => rowKeys.includes(alias));
            if (!hasCol) {
                return res.status(400).json({
                    success: false,
                    message: `Missing required column: ${reqCol.field}. Required columns: userId, name, stoppings, city, state, country.`
                });
            }
        }

        const validRows = data.filter((row) => {
            const userId = getFieldValue(row, "userId", "user_id", "id");
            const name = getFieldValue(row, "name", "studentName", "userName");
            const stoppings = getFieldValue(row, "stoppings", "stopping", "stop", "stoppingArea");
            return Boolean(userId && name && stoppings);
        });

        if (validRows.length === 0) {
            return res.status(400).json({
                success: false,
                message: "No valid user records found in Excel. Each row must have userId, name, and stoppings."
            });
        }

        const users = [];

        for (const row of validRows) {
            const userId = getFieldValue(row, "userId", "user_id", "id");
            const name = getFieldValue(row, "name", "studentName", "userName");
            const stoppings = getFieldValue(row, "stoppings", "stopping", "stop", "stoppingArea");
            const city = getFieldValue(row, "city");
            const state = getFieldValue(row, "state");
            const country = getFieldValue(row, "country");

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
                city,
                state,
                country,
                password,
                role: "student",
                travelStatus: "Coming"
            });
        }

        // Remove only old student users. Admin users are preserved.
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
            message: `Excel data synchronized successfully. ${users.length} users imported.`,
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