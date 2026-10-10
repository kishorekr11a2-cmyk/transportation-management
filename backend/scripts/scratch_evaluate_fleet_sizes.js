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
    computeClarkeWrightSavings,
    sequenceOutwardRouteStops,
    balanceRoutesToGuaranteedSeating
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

    console.log(`Demand: ${uniqueUsers.length} passengers across ${resolvedStops.length} stops.`);
    console.log(`Available Fleet: ${availableVehicles.length} vehicles with capacities: ${fleetCaps.join(", ")}`);

    for (let k = 7; k <= 12; k++) {
        const subFleet = availableVehicles.slice(0, k);
        const subCaps = subFleet.map(v => Number(v.capacity || 0)).sort((a,b) => b-a);
        const totalCap = subCaps.reduce((a,b) => a+b, 0);

        console.log(`\n=================== TESTING FLEET SIZE: ${k} BUSES (Capacity: ${totalCap}) ===================`);
        if (totalCap < uniqueUsers.length) {
            console.log(`Result: INFEASIBLE (Capacity Shortfall: ${uniqueUsers.length} demand > ${totalCap} seats, shortfall of ${uniqueUsers.length - totalCap} seats)`);
            continue;
        }

        // Test if k candidate routes can be formed
        // Let's run Clarke-Wright savings targeting k routes
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
            assignedUsers: st.passengerCount,
            users: Array.isArray(st.userIds) ? [...st.userIds] : []
        }));

        for (const saving of savingsList) {
            if (routes.length <= k) break;
            const idxA = saving.stopIIndex;
            const idxB = saving.stopJIndex;

            const routeA = routes.find((r) => r.stops.some((s) => s.matrixIndex === idxA + 1));
            const routeB = routes.find((r) => r.stops.some((s) => s.matrixIndex === idxB + 1));

            if (!routeA || !routeB || routeA.routeId === routeB.routeId) continue;

            const combinedPax = routeA.assignedUsers + routeB.assignedUsers;
            if (combinedPax > subCaps[0]) continue; // Cannot exceed max vehicle in sub-fleet

            // Prospective check against sub-fleet
            const prospective = routes.map(r => {
                if (r.routeId === routeA.routeId) return combinedPax;
                if (r.routeId === routeB.routeId) return 0;
                return r.assignedUsers;
            }).filter(d => d > 0).sort((a,b) => b-a);

            if (prospective.length <= subCaps.length) {
                let fits = true;
                for (let i = 0; i < prospective.length; i++) {
                    if (prospective[i] > subCaps[i]) { fits = false; break; }
                }
                if (!fits) continue;
            }

            routeA.stops.push(...routeB.stops);
            routeA.assignedUsers = combinedPax;
            routeA.users.push(...routeB.users);
            routes = routes.filter(r => r.routeId !== routeB.routeId);
        }

        console.log(`Routes after CW: ${routes.length} (Target: <= ${k})`);
        routes.forEach((r, idx) => {
            console.log(`  Route ${idx+1}: ${r.assignedUsers} pax, ${r.stops.length} stops`);
        });

        // Check if any route exceeds capacity or if any route violates continuity
        let allContinuity = true;
        let maxPaxTime = 0;
        let anyReversals = 0;

        routes.forEach(r => {
            const seq = sequenceOutwardRouteStops({ departureHub: anchorHub, stops: r.stops, matrix, tripMode: "FROM_SOURCE" });
            const qv = seq.qualityValidation || {};
            if ((qv.directionalReversals || 0) > 0) anyReversals++;
            if ((qv.longestPassengerTravelTime || 0) > maxPaxTime) maxPaxTime = qv.longestPassengerTravelTime;
        });

        console.log(`Metrics for ${k} buses: Reversals=${anyReversals}, MaxPaxTime=${maxPaxTime}m`);
    }

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
