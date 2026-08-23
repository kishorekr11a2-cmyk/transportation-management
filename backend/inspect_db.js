import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/college_bus_management";

async function inspect() {
    try {
        await mongoose.connect(mongoUri);
        console.log("Connected to MongoDB:", mongoUri);

        const db = mongoose.connection.db;
        const users = await db.collection("users").find({}).toArray();
        const vehicles = await db.collection("vehicles").find({}).toArray();
        const schedules = await db.collection("schedules").find({}).toArray();
        const stops = await db.collection("stops").find({}).toArray();
        const routes = await db.collection("routes").find({}).toArray();

        console.log("\n=== USERS SUMMARY ===");
        console.log("Total users:", users.length);
        const statusCounts = {};
        const stoppingCounts = {};
        users.forEach(u => {
            if (u.role === "admin") return;
            const st = u.travelStatus || "undefined";
            statusCounts[st] = (statusCounts[st] || 0) + 1;

            if (u.travelStatus === "Coming") {
                const stopName = typeof u.stoppings === "string" ? u.stoppings : (Array.isArray(u.stoppings) ? u.stoppings.map(s => typeof s === "string" ? s : s.name).join(",") : "None");
                stoppingCounts[stopName] = (stoppingCounts[stopName] || 0) + 1;
            }
        });
        console.log("Status distribution:", statusCounts);
        console.log("Coming Users stopping distribution (sample):", Object.entries(stoppingCounts).slice(0, 15));

        console.log("\n=== VEHICLES SUMMARY ===");
        console.log("Total vehicles:", vehicles.length);
        vehicles.forEach(v => {
            console.log(`- ${v.vehicleName || v.name} (${v._id}): capacity=${v.capacity || v.seatCapacity || v.totalSeats}`);
        });

        console.log("\n=== SCHEDULES SUMMARY ===");
        console.log("Total schedules:", schedules.length);
        schedules.forEach(s => {
            console.log(`- Vehicle ID: ${s.vehicle?._id || s.vehicle}, Availability: ${s.availability || s.status}`);
        });

        await mongoose.disconnect();
    } catch (err) {
        console.error("DB inspection error:", err);
    }
}

inspect();
