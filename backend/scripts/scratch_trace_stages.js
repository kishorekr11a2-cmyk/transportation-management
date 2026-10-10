import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";
import User from "../models/User.js";
import Vehicle from "../models/Vehicle.js";
import {
    getConfirmedUsers,
    deduplicateUsers,
    calculateStoppingGroups,
    resolveStopCoordinates
} from "../services/aiAgentService.js";
import {
    buildGlobalOptimizationMatrix,
    generateGlobalCandidateRoutes,
    consolidateSmallPassengerRoutes,
    isCandidateDemandCompatibleWithFleetProfile
} from "../services/routeOptimizationService.js";

async function main() {
    await connectDB();
    const rawUsers = await User.find({ travelStatus: "Coming" }).lean();
    const confirmed = getConfirmedUsers(rawUsers);
    const { uniqueUsers } = deduplicateUsers(confirmed);
    const stoppingGroups = calculateStoppingGroups(uniqueUsers);
    const anchorHub = { name: "K. L. N. College of Engineering", latitude: 9.8515, longitude: 78.1882 };
    const resolvedStops = await resolveStopCoordinates(stoppingGroups, anchorHub);
    const availableVehicles = await Vehicle.find({ isActive: { $ne: false } }).sort({ capacity: -1 }).lean();
    const fleetCaps = availableVehicles.map(v => Number(v.capacity || 0)).sort((a,b) => b-a);

    const matrix = await buildGlobalOptimizationMatrix({ depot: anchorHub, stops: resolvedStops });

    console.log("=== STAGE 1: generateGlobalCandidateRoutes ===");
    const candidates = generateGlobalCandidateRoutes({
        stops: resolvedStops,
        matrix,
        maxBusCapacity: fleetCaps[0],
        fleetCapacities: fleetCaps,
        tripMode: "FROM_SOURCE"
    });
    console.log(`Generated ${candidates.length} candidate routes:`);
    candidates.forEach((r, idx) => {
        console.log(`  Candidate ${idx+1}: ${r.assignedUsers} pax, ${r.stops.length} stops (${r.stops.map(s => s.name).join(", ")})`);
    });

    console.log("\n=== STAGE 2: consolidateSmallPassengerRoutes ===");
    const consolidatedSmall = consolidateSmallPassengerRoutes({
        routes: candidates,
        matrix,
        maxBusCapacity: fleetCaps[0],
        tripMode: "FROM_SOURCE",
        smallRouteThreshold: 15,
        anchorHub,
        fleetCapacities: fleetCaps
    });
    console.log(`After consolidateSmallPassengerRoutes: ${consolidatedSmall.length} routes:`);
    consolidatedSmall.forEach((r, idx) => {
        console.log(`  Route ${idx+1}: ${r.assignedUsers} pax, ${r.stops.length} stops (${r.stops.map(s => s.name).join(", ")})`);
    });

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
