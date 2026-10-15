import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import connectDB from "./config/db.js";

async function main() {
    await connectDB();
    const now = new Date();
    const res = await mongoose.connection.db.collection('ai_selected_plans').updateOne(
        { _id: new mongoose.Types.ObjectId("6ace432525b48c84cecb475f") },
        {
            $set: {
                active: true,
                status: "active",
                approved: true,
                isApproved: true,
                isSubmitted: true,
                createdAt: now,
                approvedAt: now,
                selectedAt: now
            }
        }
    );
    console.log("Updated 6ace432525b48c84cecb475f timestamps:", res);
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
