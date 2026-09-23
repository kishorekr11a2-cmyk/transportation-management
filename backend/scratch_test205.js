import mongoose from "mongoose";
import dotenv from "dotenv";
import connectDB from "./config/db.js";
import { generateAgentRecommendations } from "./services/aiAgentService.js";
import User from "./models/User.js";

dotenv.config();

const klnce = {
    name: "K. L. N. College of Engineering",
    address: "Pottapalayam, Sivagangai / Madurai - 630612",
    latitude: 9.8515,
    longitude: 78.1882
};

async function testWithStop() {
    await connectDB();

    // Give Dual Direction Student a stopping area
    await User.updateOne(
        { userId: 'OUT_RST_1789920720262_STU' },
        {
            $set: {
                stoppings: "Mattuthavani",
                city: "Madurai",
                district: "Madurai",
                state: "Tamil Nadu",
                country: "India"
            }
        }
    );

    console.log("\n==================== INWARD ====================");
    const inward = await generateAgentRecommendations({
        tripMode: "TO_DESTINATION",
        destination: klnce
    });

    console.log("Inward assigned:", inward.aiPlan.assignedUsers, "unassigned:", inward.aiPlan.unassignedUsers);
    inward.aiPlan.buses.forEach(b => {
        console.log(`Bus ${b.vehicleName}: cap=${b.capacity}, assigned=${b.assignedUsers}, remaining=${b.remainingSeats}, stops=${b.stops.map(s => `${s.name} (${s.userCount})`).join(", ")}`);
    });

    console.log("\n==================== OUTWARD ====================");
    const outward = await generateAgentRecommendations({
        tripMode: "FROM_SOURCE",
        source: klnce
    });

    console.log("Outward assigned:", outward.aiPlan.assignedUsers, "unassigned:", outward.aiPlan.unassignedUsers);
    outward.aiPlan.buses.forEach(b => {
        console.log(`Bus ${b.vehicleName}: cap=${b.capacity}, assigned=${b.assignedUsers}, remaining=${b.remainingSeats}, stops=${b.stops.map(s => `${s.name} (${s.userCount})`).join(", ")}`);
    });

    process.exit(0);
}

testWithStop();
