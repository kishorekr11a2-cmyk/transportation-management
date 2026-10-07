import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";
import mongoose from "mongoose";
import {
    getManagedUsers,
    getConfirmedUsers,
    deduplicateUsers,
    getAvailableVehicles,
    calculateStoppingGroups,
    resolveStopCoordinates,
    calculateDistanceKm
} from "../services/aiAgentService.js";
import {
    buildGlobalOptimizationMatrix,
    generateGlobalCandidateRoutes,
    assignVehiclesToOptimizedRoutes,
    sequenceInwardRouteStops,
    isRouteCorridorCoherent
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

    console.log("Confirmed coming users:", confirmedUsers.length);
    console.log("Resolved stops:", resolvedStops.length);

    const matrix = await buildGlobalOptimizationMatrix({
        depot: DEFAULT_SOURCE_HUB,
        stops: resolvedStops
    });

    const candRoutes = generateGlobalCandidateRoutes({
        stops: resolvedStops,
        matrix,
        maxBusCapacity: 65,
        tripMode: "TO_DESTINATION"
    });

    console.log(`Generated ${candRoutes.length} inward candidate routes:`);
    candRoutes.forEach((r, i) => {
        console.log(`  Cand ${i+1}: ${r.assignedUsers} pax [${r.stops.map(s => s.name).join(" -> ")}]`);
    });

    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
