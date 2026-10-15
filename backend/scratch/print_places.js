import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";
import InwardStartingPlace from "../models/InwardStartingPlace.js";
import Vehicle from "../models/Vehicle.js";

async function main() {
    await connectDB();
    const places = await InwardStartingPlace.find({ active: true }).lean();
    console.log("Active Inward Starting Places:");
    places.forEach(p => {
        console.log(`  busName: ${p.busName}, location: ${p.locationName || p.name}, cap: ${p.capacity}`);
    });

    const vehicles = await Vehicle.find({ isActive: true }).lean();
    console.log("\nActive Vehicles:");
    vehicles.forEach(v => {
        console.log(`  name: ${v.vehicleName || v.name}, capacity: ${v.capacity}`);
    });

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
