import mongoose from "mongoose";
import dotenv from "dotenv";
import connectDB from "./config/db.js";
import User from "./models/User.js";

dotenv.config();

async function checkAll() {
    await connectDB();
    const users = await User.find({ role: 'student' }).lean();
    console.log('Total students:', users.length);
    const statuses = {};
    users.forEach(u => statuses[u.travelStatus] = (statuses[u.travelStatus] || 0) + 1);
    console.log('Statuses:', statuses);
    const noStop = users.filter(u => !u.stoppings);
    console.log('No stop count:', noStop.length, noStop.map(u => ({ id: u._id, userId: u.userId, name: u.name, status: u.travelStatus })));
    process.exit(0);
}

checkAll();
