import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";

async function run() {
    await connectDB();
    const cols = await mongoose.connection.db.collections();
    for (const c of cols) {
        const docs = await c.find({}).toArray();
        for (const doc of docs) {
            const str = JSON.stringify(doc);
            if (str.toLowerCase().includes("information technology")) {
                console.log(`Found in collection ${c.collectionName}:`, doc._id, doc.name || doc.destination || doc.title);
            }
        }
    }
    process.exit(0);
}
run();
