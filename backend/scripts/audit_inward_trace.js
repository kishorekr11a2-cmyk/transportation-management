import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";
import AiPlan from "../models/AiPlan.js";
import InwardStartingPlace from "../models/InwardStartingPlace.js";
import mongoose from "mongoose";
import { getConfirmedUsers, calculateStoppingGroups, resolveStopCoordinates, isValidCoordinate, findStartingPlaceForBus } from "../services/aiAgentService.js";
import { buildGlobalOptimizationMatrix, generateGlobalCandidateRoutes } from "../services/routeOptimizationService.js";

async function main() {
    await connectDB();
    const destHub = {
        name: "KLN College of Engineering",
        address: "Pottapalayam, Sivagangai / Madurai - 630612",
        latitude: 9.8515,
        longitude: 78.1882
    };

    const rawUsers = await mongoose.connection.db.collection("users").find({}).toArray();
    const confirmed = getConfirmedUsers(rawUsers);
    const rawGroups = calculateStoppingGroups(confirmed);
    const resolvedStops = (await resolveStopCoordinates(rawGroups, destHub)).filter(s => isValidCoordinate(s.latitude, s.longitude));

    const latestOutwardDoc = await AiPlan.findOne({
        active: true,
        $or: [{ direction: "OUTWARD" }, { tripMode: "OUTWARD" }, { tripMode: "FROM_SOURCE" }]
    }).sort({ generatedAt: -1, createdAt: -1 }).lean();

    const oppositePlan = latestOutwardDoc?.aiPlan || latestOutwardDoc;
    console.log("Opposite plan found:", Boolean(oppositePlan), "buses:", oppositePlan?.buses?.length);

    const activeInwardStartingPlaces = await InwardStartingPlace.find({ active: true }).lean();

    const matrix = await buildGlobalOptimizationMatrix({
        depot: destHub,
        stops: resolvedStops,
        options: { destinationHub: destHub }
    });

    const oppBuses = oppositePlan?.buses || [];
    const totalInwardPax = resolvedStops.reduce((sum, s) => sum + (Array.isArray(s.userIds) ? s.userIds.length : Number(s.userCount || 0)), 0);
    const totalOutwardPax = oppBuses.reduce((sum, b) => sum + (b.assignedUsers || b.passengerCount || 0), 0);
    console.log(`totalInwardPax: ${totalInwardPax}, totalOutwardPax: ${totalOutwardPax}`);

    // Check each stop in oppBuses
    const stopMap = new Map();
    resolvedStops.forEach((st) => {
        const k = (st.name || st.stopping || "").toLowerCase().trim();
        stopMap.set(k, st);
    });

    let allMatched = true;
    let totalSeededPax = 0;
    oppBuses.forEach((ob, idx) => {
        let bPax = 0;
        ob.stops.forEach(ost => {
            const k = (ost.name || ost.stopping || "").toLowerCase().trim();
            const matched = stopMap.get(k);
            if (!matched) {
                console.log(`Bus ${idx} (${ob.vehicleName}) unmatched stop: '${ost.name}' (key '${k}')`);
                allMatched = false;
            } else {
                const p = Array.isArray(matched.userIds) ? matched.userIds.length : Number(matched.userCount || 0);
                bPax += p;
            }
        });
        totalSeededPax += bPax;
        console.log(`Bus ${idx} (${ob.vehicleName}) ostops: ${ob.stops.length}, bPax: ${bPax}, original ob.assignedUsers: ${ob.assignedUsers}`);
    });

    console.log("Sample ob:", {
        vehicleName: oppBuses[0]?.vehicleName,
        vehicleId: oppBuses[0]?.vehicleId,
        assignedUsers: oppBuses[0]?.assignedUsers,
        capacity: oppBuses[0]?.capacity,
        routeCode: oppBuses[0]?.routeCode,
        stopsCount: oppBuses[0]?.stops?.length,
        firstStop: oppBuses[0]?.stops?.[0]
    });
    console.log(`allMatched: ${allMatched}, totalSeededPax: ${totalSeededPax}, totalInwardPax: ${totalInwardPax}`);
    console.log(`seededPax === totalInwardPax: ${totalSeededPax === totalInwardPax}`);

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
