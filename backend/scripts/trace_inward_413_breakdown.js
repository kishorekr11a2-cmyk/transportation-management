import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import InwardStartingPlace from "../models/InwardStartingPlace.js";
import {
    getManagedUsers,
    getConfirmedUsers,
    deduplicateUsers,
    calculateStoppingGroups,
    resolveStopCoordinates,
    buildAIPlan
} from "../services/aiAgentService.js";
import { DEFAULT_SOURCE_HUB } from "../services/mapGeocodingService.js";

async function main() {
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

    console.log(`Confirmed Users: ${confirmedUsers.length}, Resolved Stops: ${resolvedStops.length}`);
    console.log(`Available Vehicles: ${rawVehicles.length}, Starting Places: ${startingPlaces.length}`);

    const plan = await buildAIPlan({
        sourceHub: DEFAULT_SOURCE_HUB,
        destinationHub: DEFAULT_SOURCE_HUB,
        tripMode: "TO_DESTINATION",
        resolvedStops,
        availableVehicles: rawVehicles,
        rawVehicles,
        totalComingUsers: confirmedUsers.length,
        allUsersCount: confirmedUsers.length,
        totalAvailableCapacity: 435,
        physicalFleetCapacity: 435,
        confirmedUsers,
        activeInwardStartingPlaces: startingPlaces
    });

    console.log("\n=======================================================");
    console.log(`Plan Status: ${plan.status}`);
    console.log(`Allocated: ${plan.assignedUsers}/${confirmedUsers.length}`);
    console.log(`Unallocated: ${plan.unassignedUsers || 0}`);
    console.log(`Buses count: ${plan.buses?.length}`);
    (plan.buses || []).forEach((b, idx) => {
        const spare = b.capacity - b.assignedUsers;
        console.log(`[R-${String(idx+1).padStart(2,'0')}] ${b.vehicleName} (${b.capacity} seats, ${b.assignedUsers} pax, ${b.standingPassengers || 0} standing, ${spare} spare):`);
        console.log(`      Stops (${b.stops?.length}): ${(b.stops || []).map(s => `${s.name}(${s.userCount || s.passengerCount || 0}p)`).join(" -> ")}`);
        console.log(`      Starting Place: ${b.startLocation?.name || b.startingHub?.name || "none"}`);
    });

    if (plan.unallocatedPassengers && plan.unallocatedPassengers.length > 0) {
        console.log("\nUnallocated Passengers Breakdown:");
        const byStop = {};
        plan.unallocatedPassengers.forEach(u => {
            byStop[u.stoppingArea] = (byStop[u.stoppingArea] || 0) + 1;
        });
        console.log(byStop);
    }

    process.exit(0);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
