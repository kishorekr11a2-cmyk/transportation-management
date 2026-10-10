import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";
import User from "../models/User.js";
import Vehicle from "../models/Vehicle.js";
import {
    buildGlobalOptimizationMatrix,
    generateGlobalCandidateRoutes,
    selectOutwardFleet,
    evaluateFleetBalancingDecision,
    assignVehiclesToOptimizedRoutes,
    consolidateAndRebalanceLowOccupancyOutwardRoutes
} from "../services/routeOptimizationService.js";
import { DEFAULT_SOURCE_HUB } from "../services/mapGeocodingService.js";

async function main() {
    await connectDB();
    const users = await User.find({ travelStatus: "Coming" }).lean();
    const vehicles = await Vehicle.find({ isActive: { $ne: false } }).lean();

    // Group users by stopping area
    const stopMap = new Map();
    users.forEach(u => {
        const stopName = u.pickupLocation || u.stopping || u.assignedStop || "Unknown";
        if (!stopMap.has(stopName)) {
            stopMap.set(stopName, {
                name: stopName,
                latitude: u.latitude || u.location?.coordinates?.[1] || 9.9252,
                longitude: u.longitude || u.location?.coordinates?.[0] || 78.1198,
                userCount: 0,
                userIds: []
            });
        }
        const s = stopMap.get(stopName);
        s.userCount++;
        s.userIds.push(u._id);
    });
    const stops = Array.from(stopMap.values());
    console.log(`Resolved stops count: ${stops.length}, total pax: ${users.length}`);

    const matrix = await buildGlobalOptimizationMatrix({ depot: DEFAULT_SOURCE_HUB, stops });
    const maxBusCap = Math.max(...vehicles.map(v => Number(v.capacity || v.seatCapacity || 70)));
    console.log(`Max bus cap: ${maxBusCap}`);

    const candidateRoutes = generateGlobalCandidateRoutes({
        stops,
        matrix,
        maxBusCapacity: maxBusCap,
        tripMode: "FROM_SOURCE"
    });
    console.log(`Generated candidate routes: ${candidateRoutes.length}`);
    candidateRoutes.forEach((r, i) => {
        console.log(`  Candidate ${i+1}: ${r.assignedUsers} pax, ${r.stops.length} stops: ${r.stops.map(s => s.name).join(" -> ")}`);
    });

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
