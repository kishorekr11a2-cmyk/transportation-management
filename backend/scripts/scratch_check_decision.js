import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";
import User from "../models/User.js";
import Vehicle from "../models/Vehicle.js";
import { getConfirmedUsers, deduplicateUsers, calculateStoppingGroups, resolveStopCoordinates } from "../services/aiAgentService.js";
import { buildGlobalOptimizationMatrix, generateGlobalCandidateRoutes, isCandidateDemandCompatibleWithFleetProfile } from "../services/routeOptimizationService.js";

async function main() {
    await connectDB();
    const rawUsers = await User.find({ travelStatus: 'Coming' }).lean();
    const confirmed = getConfirmedUsers(rawUsers);
    const { uniqueUsers } = deduplicateUsers(confirmed);
    const stoppingGroups = calculateStoppingGroups(uniqueUsers);
    const anchorHub = { name: "K. L. N. College of Engineering", latitude: 9.8515, longitude: 78.1882 };
    const resolvedStops = await resolveStopCoordinates(stoppingGroups, anchorHub);
    const availableVehicles = await Vehicle.find({ isActive: { $ne: false } }).sort({ capacity: -1 }).lean();
    const matrix = await buildGlobalOptimizationMatrix({ depot: anchorHub, stops: resolvedStops });

    const cand = generateGlobalCandidateRoutes({ stops: resolvedStops, matrix, maxBusCapacity: 65, tripMode: 'FROM_SOURCE' });
    const demands = cand.map(r => r.assignedUsers).sort((a,b) => b-a);
    console.log("Candidate Demands (sorted):", demands);

    const caps = availableVehicles.map(v => Number(v.capacity||0)).sort((a,b) => b-a);
    console.log("Fleet Capacities (sorted):", caps);

    for (let k = 8; k <= caps.length; k++) {
        const subCaps = caps.slice(0, k);
        const compat = isCandidateDemandCompatibleWithFleetProfile(demands, subCaps);
        console.log(`k=${k} (${subCaps.join(",")}): compatible?`, compat);
    }

    process.exit(0);
}
main();
