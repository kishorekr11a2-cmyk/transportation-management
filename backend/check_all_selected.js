import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import connectDB from "./config/db.js";

async function main() {
    await connectDB();
    const all = await mongoose.connection.db.collection('ai_selected_plans').find({}).toArray();
    console.log("Total in ai_selected_plans:", all.length);
    all.slice(-5).forEach(doc => {
        console.log({
            id: doc._id,
            dir: doc.direction,
            tripMode: doc.tripMode,
            active: doc.active,
            status: doc.status,
            approved: doc.approved,
            planDir: doc.plan?.direction,
            planTripMode: doc.plan?.tripMode,
            selectedAt: doc.selectedAt,
            createdAt: doc.createdAt
        });
    });
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
