import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import connectDB from "./config/db.js";
import AiPlan from "./models/AiPlan.js";

async function main() {
    await connectDB();
    const res = await AiPlan.updateMany(
        {
            _id: new mongoose.Types.ObjectId("6acdca7a1f5f78549f59a329")
        },
        {
            $set: {
                active: false,
                status: "superseded"
            }
        }
    );
    console.log("Superseded stale AiPlan doc:", res);
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
