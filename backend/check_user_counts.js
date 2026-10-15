import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import connectDB from "./config/db.js";
import User from "./models/User.js";

async function main() {
    await connectDB();
    const total = await User.countDocuments();
    const coming = await User.countDocuments({ travelStatus: "Coming" });
    const students = await User.countDocuments({ role: "student" });
    const studentsComing = await User.countDocuments({ role: "student", travelStatus: "Coming" });
    console.log({ total, coming, students, studentsComing });

    // Check seed or excel
    const sample = await User.find({ role: "student" }).limit(5).lean();
    console.log("Sample student:", sample.map(s => ({ name: s.name, travelStatus: s.travelStatus, isComing: s.isComing })));
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
