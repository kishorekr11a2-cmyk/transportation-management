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

async function findMissingStudent() {
    await connectDB();

    const comingStudents = await User.find({ role: "student", travelStatus: "Coming" }).lean();
    console.log("Total Coming students in DB:", comingStudents.length);

    const inward = await generateAgentRecommendations({
        tripMode: "TO_DESTINATION",
        destination: klnce
    });

    const inwardAssignedUserIds = new Set();
    inward.aiPlan.buses.forEach(b => {
        b.users.forEach(u => inwardAssignedUserIds.add(String(u).toLowerCase().trim()));
        b.stops.forEach(s => {
            (s.userIds || []).forEach(uid => inwardAssignedUserIds.add(String(uid).toLowerCase().trim()));
        });
    });

    console.log("Inward assigned user IDs count:", inwardAssignedUserIds.size);

    const unassignedInward = comingStudents.filter(s => {
        const id1 = String(s._id).toLowerCase().trim();
        const id2 = String(s.userId || "").toLowerCase().trim();
        return !inwardAssignedUserIds.has(id1) && !inwardAssignedUserIds.has(id2);
    });

    console.log("Unassigned students in Inward:", unassignedInward.map(s => ({
        id: s._id,
        userId: s.userId,
        name: s.name,
        stoppings: s.stoppings,
        city: s.city,
        state: s.state,
        country: s.country
    })));

    const outward = await generateAgentRecommendations({
        tripMode: "FROM_SOURCE",
        source: klnce
    });

    const outwardAssignedUserIds = new Set();
    outward.aiPlan.buses.forEach(b => {
        b.users.forEach(u => outwardAssignedUserIds.add(String(u).toLowerCase().trim()));
        b.stops.forEach(s => {
            (s.userIds || []).forEach(uid => outwardAssignedUserIds.add(String(uid).toLowerCase().trim()));
        });
    });

    console.log("Outward assigned user IDs count:", outwardAssignedUserIds.size);

    const unassignedOutward = comingStudents.filter(s => {
        const id1 = String(s._id).toLowerCase().trim();
        const id2 = String(s.userId || "").toLowerCase().trim();
        return !outwardAssignedUserIds.has(id1) && !outwardAssignedUserIds.has(id2);
    });

    console.log("Unassigned students in Outward:", unassignedOutward.map(s => ({
        id: s._id,
        userId: s.userId,
        name: s.name,
        stoppings: s.stoppings,
        city: s.city,
        state: s.state,
        country: s.country
    })));

    process.exit(0);
}

findMissingStudent();
