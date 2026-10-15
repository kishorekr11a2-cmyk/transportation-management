import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import connectDB from "./config/db.js";
import User from "./models/User.js";
import { getAIData, calculateStoppingGroups, resolveStopCoordinates } from "./services/aiAgentService.js";

async function main() {
    await connectDB();
    
    // Find the plan with 422 assigned users
    const planDoc = await mongoose.connection.db.collection("ai_selected_plans").findOne({
        "plan.assignedUsers": 422
    });
    
    const comingUsers = await User.find({ role: "student", travelStatus: "Coming" }).lean();
    console.log("Total coming students in DB:", comingUsers.length);
    
    if (planDoc) {
        console.log("Found 422-plan in ai_selected_plans:", planDoc._id);
        const buses = planDoc.plan?.buses || [];
        console.log(`Plan has ${buses.length} buses:`);
        
        const allAssignedUsersInPlan = [];
        const assignedIdsSet = new Set();
        
        buses.forEach((b, i) => {
            console.log(`\nBus ${i+1}: ${b.routeName || b.routeCode} | Vehicle: ${b.vehicleName} | Cap: ${b.capacity} | Assigned: ${b.assignedUsers} | Users array len: ${b.users?.length}`);
            (b.stops || []).forEach(st => {
                console.log(`   Stop: "${st.name}" -> userCount: ${st.userCount}, userIds: ${(st.userIds || []).length}`);
            });
            (b.users || []).forEach(u => {
                const uid = String(u._id || u.id || u.userId || u);
                allAssignedUsersInPlan.push(u);
                assignedIdsSet.add(uid);
                assignedIdsSet.add(String(u.userId || ""));
                assignedIdsSet.add(String(u.name || ""));
            });
        });
        
        console.log(`\nTotal users in buses arrays: ${allAssignedUsersInPlan.length}`);
        
        // Find the 5 unassigned users!
        const unassigned = comingUsers.filter(u => {
            const id1 = String(u._id);
            const id2 = String(u.userId);
            const id3 = String(u.name);
            return !assignedIdsSet.has(id1) && !assignedIdsSet.has(id2) && !assignedIdsSet.has(id3);
        });
        
        console.log(`\n=== EXACT UNASSIGNED USERS (${unassigned.length}) ===`);
        unassigned.forEach(u => {
            console.log(JSON.stringify({
                _id: u._id,
                userId: u.userId,
                name: u.name,
                stoppings: u.stoppings,
                city: u.city,
                district: u.district,
                state: u.state,
                country: u.country
            }, null, 2));
        });
    }

    // Now let's check calculateStoppingGroups on all 427 coming users
    const groups = calculateStoppingGroups(comingUsers);
    console.log(`\nStopping groups from calculateStoppingGroups (${groups.length} groups):`);
    let totalGroupPax = 0;
    groups.forEach(g => {
        totalGroupPax += g.userCount;
        console.log(` - Group "${g.name}" (key: "${g.locationKey}"): userCount=${g.userCount}, userIds=${g.userIds.length}`);
    });
    console.log(`Total passengers in groups: ${totalGroupPax} (expected: ${comingUsers.length})`);

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
