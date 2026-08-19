import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

import connectDB from "./config/db.js";
import User from "./models/User.js";

dotenv.config();

const seedAdmin = async () => {
    try {

        await connectDB();

        const adminExists = await User.findOne({
            role: "admin"
        });

        if (adminExists) {
            console.log("✅ Admin already exists.");
            process.exit();
        }

        const hashedPassword = await bcrypt.hash("admin123", 10);

        await User.create({
            userId: "admin",
            name: "Administrator",
            password: hashedPassword,
            role: "admin"
        });

        console.log("✅ Default Admin Created");

        process.exit();

    } catch (error) {

        console.log(error);

        process.exit(1);

    }
};

seedAdmin();