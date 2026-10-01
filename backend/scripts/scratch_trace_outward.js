import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";
import { getCollectionData, getManagedUsers, getConfirmedUsers, deduplicateUsers, getAvailableVehicles, getVehicleCapacity, calculateStoppingGroups, resolveStopCoordinates } from "../services/aiAgentService.js";
import { executeGlobalRouteOptimization, buildGlobalOptimizationMatrix } from "../services/routeOptimizationService.js";

async function trace() {
    await connectDB();
    const sourceHub = {
        name: "KLN College of Engineering",
        address: "Pottapalayam, Sivagangai / Madurai - 630612",
        latitude: 9.8515,
        longitude: 78.1882
    };

    const [allUsers, rawVehicles, schedules] = await Promise.all([
        getCollectionData("users"),
        getCollectionData("vehicles"),
        getCollectionData("schedules")
    ]);

    const users = getManagedUsers(allUsers);
    const rawConfirmed = getConfirmedUsers(users);
    const { uniqueUsers: confirmedUsers } = deduplicateUsers(rawConfirmed);
    const availableVehicles = getAvailableVehicles(rawVehicles, schedules, new Date());

    const rawStoppingGroups = calculateStoppingGroups(confirmedUsers);
    const stoppingGroups = await resolveStopCoordinates(rawStoppingGroups, sourceHub);
    const resolvedStops = stoppingGroups.filter((s) => s.latitude && s.longitude);

    console.log("Confirmed Users:", confirmedUsers.length);
    console.log("Resolved Stops:", resolvedStops.length);
    console.log("Available Vehicles:", availableVehicles.length);
    availableVehicles.forEach(v => console.log(`  - ${v.vehicleName || v.name} (${v.capacity || v.seatCapacity})`));

    const globalOpt = await executeGlobalRouteOptimization({
        resolvedStops,
        anchorHub: sourceHub,
        availableVehicles,
        tripMode: "FROM_SOURCE",
        options: {
            sourceHub,
            destinationHub: sourceHub
        }
    });

    console.log("\nGlobalOpt Routes Count:", globalOpt?.routes?.length);
    (globalOpt?.routes || []).forEach((r, idx) => {
        console.log(`Route ${idx+1}: Bus ${r.vehicleName} (${r.capacity} cap) -> ${r.assignedUsers} pax, ${r.stops?.length} stops: ${r.stops.map(s => `${s.name}(${s.userCount})`).join(" -> ")}`);
    });

    console.log("\nAudit trail events:");
    (globalOpt?.auditTrail || []).forEach(a => {
        console.log(`  [${a.action}] ${a.reason || ""}`);
    });

    process.exit(0);
}

trace().catch(e => {
    console.error(e);
    process.exit(1);
});
