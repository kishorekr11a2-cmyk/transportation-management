import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import connectDB from "./config/db.js";

async function main() {
    await connectDB();
    const doc = await mongoose.connection.db.collection('ai_selected_plans').findOne({
        _id: new mongoose.Types.ObjectId("6ace432525b48c84cecb475f")
    });
    console.log("6ace432525b48c84cecb475f:", {
        id: doc?._id,
        direction: doc?.direction,
        tripMode: doc?.tripMode,
        active: doc?.active,
        status: doc?.status,
        approved: doc?.approved,
        isApproved: doc?.isApproved,
        isSubmitted: doc?.isSubmitted,
        planType: doc?.planType,
        planDirection: doc?.plan?.direction,
        planTripMode: doc?.plan?.tripMode
    });
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
