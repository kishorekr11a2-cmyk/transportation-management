import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    const User = mongoose.model("User", new mongoose.Schema({}, { strict: false }));
    
    const allUsers = await User.find({}).lean();
    console.log("Total users:", allUsers.length);

    const travelStatusCounts = {};
    const allocationStatusCounts = {};
    const lateUsers = [];

    for (const u of allUsers) {
        travelStatusCounts[u.travelStatus] = (travelStatusCounts[u.travelStatus] || 0) + 1;
        allocationStatusCounts[u.allocationStatus] = (allocationStatusCounts[u.allocationStatus] || 0) + 1;
        if (u.lateResponse || u.isLateResponse || u.lateResponseDetected) {
            lateUsers.push({
                userId: u.userId,
                name: u.name,
                travelStatus: u.travelStatus,
                allocationStatus: u.allocationStatus,
                isAllocated: u.isAllocated,
                lateResponse: u.lateResponse,
                isLateResponse: u.isLateResponse,
                lateResponseDetected: u.lateResponseDetected,
                travelResponseSubmittedAt: u.travelResponseSubmittedAt,
                lateResponseAt: u.lateResponseAt,
                lateResponseNotifiedEventKeys: u.lateResponseNotifiedEventKeys,
                hasVehicle: Boolean(u.assignedVehicle || u.allocatedBus?.vehicleName)
            });
        }
    }

    console.log("Travel Statuses:", travelStatusCounts);
    console.log("Allocation Statuses:", allocationStatusCounts);
    console.log("Late users count:", lateUsers.length);
    console.log("Late users detail:", JSON.stringify(lateUsers, null, 2));

    const events = await mongoose.connection.db.collection("late_response_events").find({}).toArray();
    console.log("Late response events count:", events.length);
    console.log("Events:", JSON.stringify(events, null, 2));

    const activePlans = await mongoose.connection.db.collection("ai_selected_plans").find({}).toArray();
    console.log("Approved plans count:", activePlans.length);
    for (const p of activePlans) {
        console.log("Plan:", p.planType, p.direction, p.selectedAt);
    }

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
