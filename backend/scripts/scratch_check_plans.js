import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/college_bus_management";

async function check() {
    try {
        await mongoose.connect(mongoUri);
        const db = mongoose.connection.db;
        const selectedPlans = await db.collection("ai_selected_plans").find({}).toArray();
        console.log("=== ai_selected_plans ===", selectedPlans.length);
        selectedPlans.forEach((p, i) => {
            console.log(`Plan ${i+1}: id=${p._id}, active=${p.active}, direction=${p.direction}, tripMode=${p.tripMode}, buses=${(p.plan?.buses || p.buses || []).length}`);
            (p.plan?.buses || p.buses || []).forEach(b => {
                console.log(`   Bus ${b.vehicleName || b.vehicleId}: ${b.assignedUsers || b.allocatedSeats}/${b.capacity}`);
            });
        });

        const aiPlans = await db.collection("ai_plans").find({}).toArray();
        console.log("\n=== ai_plans ===", aiPlans.length);
        aiPlans.forEach((p, i) => {
            console.log(`AiPlan ${i+1}: id=${p._id}, active=${p.active}, direction=${p.direction}, tripMode=${p.tripMode}, buses=${(p.aiPlan?.buses || p.buses || []).length}`);
            (p.aiPlan?.buses || p.buses || []).forEach(b => {
                console.log(`   Bus ${b.vehicleName || b.vehicleId}: ${b.assignedUsers || b.allocatedSeats}/${b.capacity}`);
            });
        });

        const inwardStartingPlaces = await db.collection("inwardstartingplaces").find({}).toArray();
        console.log("\n=== inwardstartingplaces ===", inwardStartingPlaces.length);
        inwardStartingPlaces.forEach(sp => {
            console.log(`- ${sp.busName || sp.vehicleId}: ${sp.locationName || sp.name} (active=${sp.active})`);
        });

        await mongoose.disconnect();
    } catch (e) {
        console.error(e);
    }
}
check();
