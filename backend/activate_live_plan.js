import mongoose from "mongoose";
import dotenv from "dotenv";
import connectDB from "./config/db.js";
import { generateAgentRecommendations, saveSelectedPlan } from "./services/aiAgentService.js";

dotenv.config();

const klnce = {
    name: "K. L. N. College of Engineering",
    address: "Pottapalayam, Sivagangai / Madurai - 630612",
    latitude: 9.8515,
    longitude: 78.1882
};

async function activateLiveCertifiedPlan() {
    await connectDB();
    console.log("1. Generating and activating live INWARD AI plan...");
    const inRec = await generateAgentRecommendations({
        tripMode: "TO_DESTINATION",
        destination: klnce
    });

    if (inRec.success && inRec.aiPlan?.certification?.isCertified) {
        const inSaveRes = await saveSelectedPlan({
            planType: "AI",
            plan: inRec.aiPlan,
            startingPoint: klnce
        });
        console.log("Inward Plan Activation Result:", inSaveRes.success, inSaveRes.message);
    }

    console.log("\n2. Generating and activating live OUTWARD AI plan...");
    const outRec = await generateAgentRecommendations({
        tripMode: "FROM_SOURCE",
        source: klnce
    });

    if (outRec.success && outRec.aiPlan?.certification?.isCertified) {
        const outSaveRes = await saveSelectedPlan({
            planType: "AI",
            plan: outRec.aiPlan,
            startingPoint: klnce
        });
        console.log("Outward Plan Activation Result:", outSaveRes.success, outSaveRes.message);
    }

    await mongoose.disconnect();
    process.exit(0);
}

activateLiveCertifiedPlan().catch((err) => {
    console.error(err);
    process.exit(1);
});
