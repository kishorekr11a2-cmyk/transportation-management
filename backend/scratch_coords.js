import mongoose from "mongoose";
import dotenv from "dotenv";
import connectDB from "./config/db.js";
import InwardStartingPlace from "./models/InwardStartingPlace.js";
import User from "./models/User.js";
import { resolveStopCoordinates, calculateStoppingGroups } from "./services/aiAgentService.js";

dotenv.config();

async function inspectCoordinates() {
    await connectDB();
    const startingPlaces = await InwardStartingPlace.find({}).lean();
    console.log("--- INWARD STARTING PLACES ---");
    startingPlaces.forEach(sp => {
        console.log(`Bus: ${sp.busName}, Location: ${sp.locationName}, Lat: ${sp.latitude}, Lng: ${sp.longitude}, Address: ${sp.address}`);
    });

    const comingUsers = await User.find({ role: "student", travelStatus: "Coming" }).lean();
    const rawGroups = calculateStoppingGroups(comingUsers);
    const resolvedGroups = await resolveStopCoordinates(rawGroups, null);

    console.log("\n--- RESOLVED STOPPING GROUPS FOR MATCHING HUBS ---");
    resolvedGroups.forEach(rg => {
        if (["melur", "koodal nagar", "thiruppalai"].includes(String(rg.name).toLowerCase().trim())) {
            console.log(`Stop: ${rg.name}, Lat: ${rg.latitude}, Lng: ${rg.longitude}, Users: ${rg.userCount}`);
        }
    });

    process.exit(0);
}

inspectCoordinates();
