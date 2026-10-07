import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";
import mongoose from "mongoose";
import {
    getManagedUsers,
    getConfirmedUsers,
    deduplicateUsers,
    calculateStoppingGroups,
    resolveStopCoordinates,
    calculateDistanceKm
} from "../services/aiAgentService.js";
import {
    buildGlobalOptimizationMatrix,
    generateGlobalCandidateRoutes,
    assignVehiclesToOptimizedRoutes,
    sequenceInwardRouteStops,
    isRouteCorridorCoherent,
    expandCandidateRoutesToTarget
} from "../services/routeOptimizationService.js";
import { DEFAULT_SOURCE_HUB } from "../services/mapGeocodingService.js";
import InwardStartingPlace from "../models/InwardStartingPlace.js";

async function run() {
    await connectDB();
    const [allUsers, rawVehicles, schedules, startingPlaces] = await Promise.all([
        mongoose.connection.db.collection("users").find({}).toArray(),
        mongoose.connection.db.collection("vehicles").find({}).toArray(),
        mongoose.connection.db.collection("schedules").find({}).toArray(),
        InwardStartingPlace.find({ active: true }).lean()
    ]);
    const users = getManagedUsers(allUsers);
    const { uniqueUsers: confirmedUsers } = deduplicateUsers(getConfirmedUsers(users));
    const rawGroups = calculateStoppingGroups(confirmedUsers);
    const groups = await resolveStopCoordinates(rawGroups, DEFAULT_SOURCE_HUB);
    const resolvedStops = groups.filter(s => s.latitude && s.longitude);

    const matrix = await buildGlobalOptimizationMatrix({
        depot: DEFAULT_SOURCE_HUB,
        stops: resolvedStops
    });

    let candRoutes = generateGlobalCandidateRoutes({
        stops: resolvedStops,
        matrix,
        maxBusCapacity: 65,
        tripMode: "TO_DESTINATION"
    });

    console.log(`Initial candRoutes: ${candRoutes.length}`);

    // If candidate routes < 8, expand to 8
    if (candRoutes.length < 8) {
        candRoutes = expandCandidateRoutesToTarget({
            routes: candRoutes,
            targetRouteCount: 8,
            matrix,
            tripMode: "TO_DESTINATION",
            auditTrail: []
        });
        console.log(`Expanded to 8 routes: ${candRoutes.length}`);
    }

    candRoutes.forEach((r, i) => {
        console.log(`  Cand ${i+1}: ${r.assignedUsers} pax [${r.stops.map(s => `${s.name}(${s.userCount}p)`).join(" -> ")}]`);
    });

    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
