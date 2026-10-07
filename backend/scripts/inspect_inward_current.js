import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import User from "../models/User.js";
import AiPlan from "../models/AiPlan.js";
import InwardStartingPlace from "../models/InwardStartingPlace.js";
import { generateAgentRecommendations, getConfirmedUsers } from "../services/aiAgentService.js";

async function run() {
    await connectDB();
    const rawUsers = await mongoose.connection.db.collection("users").find({}).toArray();
    const confirmed = getConfirmedUsers(rawUsers);
    console.log(`Raw users count: ${rawUsers.length}, Confirmed coming users: ${confirmed.length}`);

    const destHub = {
        name: "KLN College of Engineering",
        address: "Pottapalayam, Sivagangai / Madurai - 630612",
        latitude: 9.8515,
        longitude: 78.1882
    };

    const { calculateStoppingGroups, resolveStopCoordinates, isValidCoordinate } = await import("../services/aiAgentService.js");
    const rawGroups = calculateStoppingGroups(confirmed);
    console.log(`Raw stopping groups count: ${rawGroups.length}`);
    const resolvedStops = await resolveStopCoordinates(rawGroups, destHub);
    console.log(`Resolved stops count: ${resolvedStops.length}`);
    resolvedStops.forEach(s => {
        if (/kk|k\.k\.|west/i.test(s.name)) {
            console.log(`  Resolved Stop: '${s.name}', users: ${s.userCount}, lat: ${s.latitude}, lng: ${s.longitude}`);
        }
    });

    const inwardPlaces = await InwardStartingPlace.find({ active: true }).lean();
    console.log(`\nActive inward starting places count: ${inwardPlaces.length}`);
    inwardPlaces.forEach(p => {
        console.log(`  ${p.busName} (${p.vehicleId}) -> ${p.locationName || p.name} (${p.latitude}, ${p.longitude})`);
    });

    // Check ai_selected_plans and AiPlan
    const activeSelectedPlans = await mongoose.connection.db.collection("ai_selected_plans").find({ active: true }).toArray();
    console.log(`\nActive ai_selected_plans count: ${activeSelectedPlans.length}`);
    activeSelectedPlans.forEach(p => {
        console.log(`  SelectedPlan: dir=${p.direction || p.tripMode}, approved=${p.approved}, status=${p.status}, buses=${p.plan?.buses?.length || p.buses?.length}`);
    });

    const activeAiPlans = await AiPlan.find({ active: true }).sort({ generatedAt: -1 }).limit(5).lean();
    console.log(`\nActive AiPlans count: ${activeAiPlans.length}`);
    activeAiPlans.forEach(p => {
        console.log(`  AiPlan: dir=${p.direction || p.tripMode}, active=${p.active}, buses=${p.aiPlan?.buses?.length || p.buses?.length}`);
    });


    console.log("\n========================================================");
    console.log("Calling generateAgentRecommendations({ tripMode: 'INWARD', destination: destHub })");
    console.log("========================================================");
    const result = await generateAgentRecommendations({ tripMode: "INWARD", destination: destHub });
    console.log("\nResult status:", result?.success ? "SUCCESS" : "FAILED");
    if (!result?.success) {
        console.log("Error code:", result?.code);
        console.log("Error message:", result?.message);
        console.log("Errors array:", result?.errors);
        console.log("Diagnostic:", JSON.stringify(result?.diagnostic, null, 2));
    } else {
        const plan = result.plan || result.aiPlan;
        const buses = plan.buses || [];
        console.log(`Total buses: ${buses.length}, total allocated: ${buses.reduce((s, b) => s + (b.assignedUsers || 0), 0)}`);
        buses.forEach((b, idx) => {
            console.log(`Bus ${idx + 1} (${b.vehicleName || b.routeCode}): ${b.assignedUsers}/${b.capacity} passengers`);
            console.log(`  Stops (${b.stops?.length}): ${b.stops?.map(s => `${s.name} (${s.userCount || 0}p)`).join(" -> ")}`);
        });
    }

    process.exit(0);
}

run().catch(err => {
    console.error("Error running test:", err);
    process.exit(1);
});
