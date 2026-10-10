import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import dotenv from "dotenv";
dotenv.config({ path: path.join(__dirname, "../.env") });
import connectDB from "../config/db.js";
import User from "../models/User.js";
import Vehicle from "../models/Vehicle.js";
import { calculateStoppingGroups, canonicalizeCollegeHub } from "../services/aiAgentService.js";
import { resolveStopCoordinates } from "../services/mapGeocodingService.js";
import { buildGlobalOptimizationMatrix, generateGlobalCandidateRoutes, consolidateSmallPassengerRoutes, consolidateAndRebalanceLowOccupancyOutwardRoutes } from "../services/routeOptimizationService.js";

async function trace() {
    await connectDB();
    const confirmedUsers = await User.find({
        $or: [{ travelStatus: "Coming" }, { isComing: true }, { coming: true }]
    }).lean();

    console.log(`Found ${confirmedUsers.length} coming users.`);
    const rawStoppingGroups = calculateStoppingGroups(confirmedUsers);
    const anchorHub = canonicalizeCollegeHub({
        name: "K. L. N. College of Engineering",
        latitude: 9.8515,
        longitude: 78.1882
    });
    const stoppingGroups = await resolveStopCoordinates(rawStoppingGroups, anchorHub);
    const resolvedStops = stoppingGroups.filter(s => s.latitude && s.longitude);

    const vehicles = await Vehicle.find({ isActive: { $ne: false } }).lean();
    const matrix = await buildGlobalOptimizationMatrix({ depot: anchorHub, stops: resolvedStops });
    const maxBusCapacity = 70;

    let candidateRoutes = generateGlobalCandidateRoutes({
        stops: resolvedStops,
        matrix,
        maxBusCapacity,
        tripMode: "FROM_SOURCE"
    });

    console.log(`Initial candidate routes count: ${candidateRoutes.length}`);
    candidateRoutes.forEach((r, idx) => {
        console.log(`  Candidate ${idx + 1}: ${r.stops.map(s => s.name).join(' -> ')} (${r.assignedUsers} pax)`);
    });

    const auditTrail = [];
    const consolidated = consolidateSmallPassengerRoutes({
        routes: candidateRoutes,
        matrix,
        maxBusCapacity,
        tripMode: "FROM_SOURCE",
        smallRouteThreshold: 15,
        anchorHub,
        sourceHub: anchorHub,
        auditTrail
    });

    console.log(`\nAfter consolidateSmallPassengerRoutes: ${consolidated.length} routes`);
    consolidated.forEach((r, idx) => {
        console.log(`  Route ${idx + 1}: ${r.stops.map(s => s.name).join(' -> ')} (${r.assignedUsers} pax)`);
    });
    console.log("Audit trail:", auditTrail);

    process.exit(0);
}

trace().catch(e => {
    console.error(e);
    process.exit(1);
});
