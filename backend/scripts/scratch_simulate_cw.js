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
    computeClarkeWrightSavings
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
    const maxBusCapacity = fleetCaps[0];

    const matrix = await buildGlobalOptimizationMatrix({ depot: anchorHub, stops: resolvedStops });

    const enrichedStops = resolvedStops.map((s, idx) => ({
        ...s,
        matrixIndex: idx + 1,
        passengerCount: Array.isArray(s.userIds) ? s.userIds.length : Number(s.userCount || 0)
    }));

    const savingsList = computeClarkeWrightSavings({
        stops: enrichedStops,
        depot: matrix.locations[0],
        distanceMatrix: matrix,
        tripMode: "FROM_SOURCE"
    });

    let routes = enrichedStops.map((st, idx) => ({
        routeId: `cand_${idx + 1}`,
        stops: [st],
        assignedUsers: st.passengerCount
    }));

    console.log(`Initial routes: ${routes.length}`);

    // Simulate Clarke-Wright with capacity check only against fleet profile when routes.length <= fleetCaps.length
    for (const saving of savingsList) {
        const idxA = saving.stopIIndex;
        const idxB = saving.stopJIndex;

        const routeA = routes.find((r) => r.stops.some((s) => s.matrixIndex === idxA + 1));
        const routeB = routes.find((r) => r.stops.some((s) => s.matrixIndex === idxB + 1));

        if (!routeA || !routeB || routeA.routeId === routeB.routeId) continue;

        const combinedPax = routeA.assignedUsers + routeB.assignedUsers;
        if (combinedPax > maxBusCapacity) continue;

        // Check if combined demands can fit in sorted fleet caps when routes <= fleetCaps.length
        const prospectiveDemands = routes.map(r => {
            if (r.routeId === routeA.routeId) return combinedPax;
            if (r.routeId === routeB.routeId) return 0;
            return r.assignedUsers;
        }).filter(d => d > 0).sort((a,b) => b-a);

        if (prospectiveDemands.length <= fleetCaps.length) {
            let fits = true;
            for (let i = 0; i < prospectiveDemands.length; i++) {
                if (prospectiveDemands[i] > fleetCaps[i]) { fits = false; break; }
            }
            if (!fits) continue;
        }

        // Merge routeB into routeA
        routeA.stops.push(...routeB.stops);
        routeA.assignedUsers = combinedPax;
        routes = routes.filter(r => r.routeId !== routeB.routeId);
    }

    console.log(`After Pure Clarke-Wright Savings: ${routes.length} routes!`);
    routes.sort((a, b) => b.assignedUsers - a.assignedUsers);
    routes.forEach((r, idx) => {
        console.log(`  Route ${idx+1}: ${r.assignedUsers} pax, ${r.stops.length} stops (${r.stops.map(s => s.name).join(", ")})`);
    });

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
