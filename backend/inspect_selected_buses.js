import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import connectDB from "./config/db.js";

async function main() {
    await connectDB();
    const doc = await mongoose.connection.db.collection('ai_selected_plans').findOne({
        _id: new mongoose.Types.ObjectId('6ace432525b48c84cecb475f')
    });
    console.log("Plan in ai_selected_plans:", doc._id);
    const buses = doc.plan?.buses || [];
    buses.forEach(b => {
        console.log({
            routeId: b.routeId,
            routeName: b.routeName,
            vehicleId: b.vehicleId,
            vehicleName: b.vehicleName,
            capacity: b.capacity,
            assignedUsers: b.assignedUsers,
            usersCount: b.users?.length
        });
    });
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
