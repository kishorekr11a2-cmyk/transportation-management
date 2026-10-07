import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config({ path: "backend/.env" });

import { generateAgentRecommendations } from "../services/aiAgentService.js";
import InwardStartingPlace from "../models/InwardStartingPlace.js";
import Vehicle from "../models/Vehicle.js";
import User from "../models/User.js";

async function run() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB");

    const destHub = {
        name: "KLN College of Engineering",
        latitude: 9.795,
        longitude: 78.192,
        address: "Pottapalayam, Sivagangai District, Tamil Nadu 630612"
    };

    const result = await generateAgentRecommendations({ tripMode: "INWARD", destination: destHub });
    if (!result.success) {
        console.log("FAILED:", result.message, result.errors);
        process.exit(1);
    }

    const plan = result.plan || result.aiPlan;
    console.log(`\nBuses generated: ${plan.buses.length}`);
    plan.buses.forEach((b, i) => {
        console.log(`Bus ${i + 1}: ${b.vehicleName} (${b.assignedUsers}/${b.capacity} pax) - stops: ${b.stops.map(s => `${s.name}(${s.userCount}p)`).join(" -> ")}`);
    });

    process.exit(0);
}

run().catch(e => {
    console.error(e);
    process.exit(1);
});
