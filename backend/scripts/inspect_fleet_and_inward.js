import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import { getAvailableVehicles, getVehicleCapacity } from "../services/aiAgentService.js";

async function run() {
    await connectDB();
    const rawVehicles = await mongoose.connection.db.collection("vehicles").find({}).toArray();
    console.log("Total vehicles in DB:", rawVehicles.length);
    const schedules = await mongoose.connection.db.collection("schedules").find({}).toArray();
    console.log("Total schedules in DB:", schedules.length);

    const availableVehicles = getAvailableVehicles(rawVehicles, schedules, null);
    console.log("\nAvailable vehicles count:", availableVehicles.length);
    availableVehicles.forEach(v => {
        console.log(`  ${v.vehicleName || v.name} (${v._id}): cap=${getVehicleCapacity(v)}`);
    });

    const inwardPlaces = await mongoose.connection.db.collection("inwardstartingplaces").find({ active: true }).toArray();
    console.log("\nActive Inward Starting Places count:", inwardPlaces.length);
    inwardPlaces.forEach(p => {
        console.log(`  ${p.busName} (${p.vehicleId}) -> ${p.locationName || p.name} (${p.latitude}, ${p.longitude})`);
    });

    process.exit(0);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
