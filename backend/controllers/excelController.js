import xlsx from "xlsx";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { isDbConnected } from "../config/db.js";

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
    if (!isDbConnected()) {
        return res.status(503).json({
            success: false,
            message: "Database is currently unavailable. Please verify MongoDB connection."
        });
    }

    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "Please upload an Excel file."
            });
        }

        let workbook;
        if (req.file.buffer) {
            workbook = xlsx.read(req.file.buffer, { type: "buffer" });
        } else if (req.file.path) {
            workbook = xlsx.readFile(req.file.path);
        } else {
            return res.status(400).json({
                success: false,
                message: "No readable file content found."
            });
        }
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

        // Deduplicate Excel rows by userId (keeping latest row)
        const rowMap = new Map();
        for (const row of validRows) {
            const userId = getFieldValue(row, "userId", "user_id", "id");
            const name = getFieldValue(row, "name", "studentName", "userName");
            const stoppings = getFieldValue(row, "stoppings", "stopping", "stop", "stoppingArea");
            const city = getFieldValue(row, "city");
            const state = getFieldValue(row, "state");
            const country = getFieldValue(row, "country");

            rowMap.set(userId, {
                userId,
                name,
                stoppings,
                city,
                state,
                country
            });
        }

        const deduplicatedRows = Array.from(rowMap.values());
        const validUserIds = deduplicatedRows.map((r) => r.userId);

        // Batch fetch existing students in ONE query (avoids N sequential queries)
        const existingStudents = await User.find({
            role: "student"
        }).select("userId password").lean();

        const existingMap = new Map();
        for (const s of existingStudents) {
            existingMap.set(s.userId, s);
        }

        // Collect distinct names needing password hashing to hash in parallel (avoids 400 sequential bcrypt calls)
        const namesToHash = new Set();
        for (const row of deduplicatedRows) {
            const existing = existingMap.get(row.userId);
            if (!existing?.password) {
                namesToHash.add(row.name);
            }
        }

        const hashMap = new Map();
        if (namesToHash.size > 0) {
            const uniqueNames = Array.from(namesToHash);
            const hashedValues = await Promise.all(
                uniqueNames.map((n) => bcrypt.hash(n, 8))
            );
            uniqueNames.forEach((n, i) => hashMap.set(n, hashedValues[i]));
        }

        // Prepare bulk operations for efficient in-place updates and upserts
        const bulkOps = deduplicatedRows.map((row) => {
            const existing = existingMap.get(row.userId);
            const password = existing?.password || hashMap.get(row.name);

            return {
                updateOne: {
                    filter: { userId: row.userId, role: "student" },
                    update: {
                        $set: {
                            userId: row.userId,
                            name: row.name,
                            stoppings: row.stoppings,
                            city: row.city || "",
                            state: row.state || "",
                            country: row.country || "",
                            password,
                            role: "student",
                            travelStatus: "Coming"
                        },
                        $setOnInsert: {
                            allocatedBus: null,
                            assignedVehicle: null,
                            assignedRoute: null,
                            allocationStatus: "Not Assigned",
                            requiresReallocation: false,
                            lateResponseDetected: false,
                            affectedDirections: []
                        }
                    },
                    upsert: true
                }
            };
        });

        if (bulkOps.length > 0) {
            await User.bulkWrite(bulkOps, { ordered: false });
        }

        // Synchronize: remove old student records no longer in the imported Excel file
        await User.deleteMany({
            role: "student",
            userId: { $nin: validUserIds }
        });

        res.status(200).json({
            success: true,
            message: `Excel data synchronized successfully. ${deduplicatedRows.length} users imported.`,
            totalUsers: deduplicatedRows.length
        });

    } catch (error) {
        console.error("Excel Upload Error:", error);

        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};