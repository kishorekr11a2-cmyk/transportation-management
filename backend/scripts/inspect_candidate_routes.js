import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";
import User from "../models/User.js";
import Vehicle from "../models/Vehicle.js";
import Schedule from "../models/Schedule.js";
import {
    getManagedUsers,
    getConfirmedUsers,
    deduplicateUsers,
    getAvailableVehicles,
    calculateStoppingGroups,
    resolveStopCoordinates,
    getSectorName,
    groupStopsIntoCorridors,
    calculateDistanceKm
} from "../services/aiAgentService.js";
import {
    buildGlobalOptimizationMatrix,
    generateGlobalCandidateRoutes,
    applyInterRouteRelocate,
    applyInterRouteExchange,
    consolidateSmallPassengerRoutes,
    evaluateFleetBalancingDecision,
    consolidateCandidateRoutes,
    assignVehiclesToOptimizedRoutes
} from "../services/routeOptimizationService.js";

async function inspect() {
    await connectDB();
    const sourceHub = {
        name: "KLN College of Engineering",
        address: "Pottapalayam, Sivagangai / Madurai - 630612",
        latitude: 9.8515,
        longitude: 78.1882
    };

    const allUsers = await User.find({}).lean();
    const rawVehicles = await Vehicle.find({}).lean();
    const schedules = await Schedule.find({}).lean();

    const users = getManagedUsers(allUsers);
    const rawConfirmed = getConfirmedUsers(users);
    const { uniqueUsers: confirmedUsers } = deduplicateUsers(rawConfirmed);
    const availableVehicles = getAvailableVehicles(rawVehicles, schedules, new Date());

    console.log(`Confirmed users: ${confirmedUsers.length}`);
    console.log(`Available vehicles: ${availableVehicles.length}`);
    availableVehicles.forEach(v => console.log(`  - ${v.vehicleName || v.name}: capacity ${v.capacity || v.seatCapacity}`));

    const rawStoppingGroups = calculateStoppingGroups(confirmedUsers);
    const stoppingGroups = await resolveStopCoordinates(rawStoppingGroups, sourceHub);
    let resolvedStops = stoppingGroups.filter(s => s.latitude && s.longitude);

    // Near-duplicate stop merge
    const NEAR_DUPLICATE_THRESHOLD_KM = 0.25;
    let mergedAny = true;
    while (mergedAny) {
        mergedAny = false;
        const mergedStops = [];
        const absorbed = new Set();
        for (let mi = 0; mi < resolvedStops.length; mi++) {
            if (absorbed.has(mi)) continue;
            let primary = { ...resolvedStops[mi] };
            for (let mj = mi + 1; mj < resolvedStops.length; mj++) {
                if (absorbed.has(mj)) continue;
                const candidate = resolvedStops[mj];
                const distBetween = calculateDistanceKm(
                    primary.latitude, primary.longitude,
                    candidate.latitude, candidate.longitude
                );
                if (distBetween < NEAR_DUPLICATE_THRESHOLD_KM) {
                    const primaryDemand = Array.isArray(primary.userIds) ? primary.userIds.length : (primary.userCount || 0);
                    const candidateDemand = Array.isArray(candidate.userIds) ? candidate.userIds.length : (candidate.userCount || 0);
                    const keepPrimary = primaryDemand >= candidateDemand;
                    const survivor = keepPrimary ? primary : { ...candidate };
                    const other = keepPrimary ? candidate : primary;

                    const survivorIds = Array.isArray(survivor.userIds) ? [...survivor.userIds] : [];
                    const otherIds = Array.isArray(other.userIds) ? other.userIds : [];
                    const mergedIds = Array.from(new Set([...survivorIds, ...otherIds]));

                    survivor.userIds = mergedIds;
                    survivor.userCount = mergedIds.length;
                    primary = survivor;
                    absorbed.add(mj);
                    mergedAny = true;
                }
            }
            mergedStops.push(primary);
        }
        resolvedStops = mergedStops;
    }

    console.log(`Resolved stops: ${resolvedStops.length}`);
    resolvedStops.forEach(s => {
        console.log(`  - ${s.name}: ${s.userCount} pax (lat: ${s.latitude}, lng: ${s.longitude})`);
    });

    const matrix = await buildGlobalOptimizationMatrix({
        depot: sourceHub,
        stops: resolvedStops,
        options: { sourceHub, destinationHub: sourceHub }
    });

    console.log("\n--- STEP 3: generateGlobalCandidateRoutes ---");
    let candidateRoutes = generateGlobalCandidateRoutes({
        stops: resolvedStops,
        matrix,
        maxBusCapacity: 70,
        tripMode: "FROM_SOURCE",
        options: {}
    });
    console.log(`Initial candidates: ${candidateRoutes.length}`);
    candidateRoutes.forEach((r, idx) => {
        console.log(`  Cand ${idx+1}: ${r.assignedUsers} pax, stops: ${r.stops.map(s => `${s.name}(${s.userCount})`).join(" -> ")}`);
    });

    console.log("\n--- STEP 4: Local Search ---");
    let relRes = applyInterRouteRelocate({ routes: candidateRoutes, matrix, maxBusCapacity: 70, tripMode: "FROM_SOURCE" });
    if (relRes.improved) {
        console.log("Relocate improved routes. Count:", relRes.routes.length);
        candidateRoutes = relRes.routes;
    }
    let exRes = applyInterRouteExchange({ routes: candidateRoutes, matrix, maxBusCapacity: 70, tripMode: "FROM_SOURCE" });
    if (exRes.improved) {
        console.log("Exchange improved routes. Count:", exRes.routes.length);
        candidateRoutes = exRes.routes;
    }

    console.log("\n--- STEP 4B: consolidateSmallPassengerRoutes ---");
    candidateRoutes = consolidateSmallPassengerRoutes({
        routes: candidateRoutes,
        matrix,
        maxBusCapacity: 70,
        tripMode: "FROM_SOURCE",
        smallRouteThreshold: 15,
        anchorHub: sourceHub
    });
    console.log(`After small consolidation: ${candidateRoutes.length}`);
    candidateRoutes.forEach((r, idx) => {
        console.log(`  Cand ${idx+1}: ${r.assignedUsers} pax, stops: ${r.stops.map(s => `${s.name}(${s.userCount})`).join(" -> ")}`);
    });

    console.log("\n--- STEP 4C: evaluateFleetBalancingDecision ---");
    const totalComingDemand = resolvedStops.reduce((sum, s) => sum + s.userCount, 0);
    const fleetBalancing = evaluateFleetBalancingDecision({
        currentDirection: "OUTWARD",
        currentDemand: totalComingDemand,
        candidateRoutes,
        availableVehicles
    });
    console.log("Fleet balancing targetRouteCount:", fleetBalancing.targetRouteCount);

    if (candidateRoutes.length > fleetBalancing.targetRouteCount) {
        console.log("Consolidating candidate routes to targetRouteCount:", fleetBalancing.targetRouteCount);
        candidateRoutes = consolidateCandidateRoutes({
            routes: candidateRoutes,
            targetRouteCount: fleetBalancing.targetRouteCount,
            maxBusCapacity: 70,
            matrix,
            tripMode: "FROM_SOURCE"
        });
        console.log(`After candidate consolidation: ${candidateRoutes.length}`);
        candidateRoutes.forEach((r, idx) => {
            console.log(`  Cand ${idx+1}: ${r.assignedUsers} pax, stops: ${r.stops.map(s => `${s.name}(${s.userCount})`).join(" -> ")}`);
        });
    }

    console.log("\n--- STEP 6: assignVehiclesToOptimizedRoutes ---");
    const assigned = assignVehiclesToOptimizedRoutes({
        routes: candidateRoutes,
        availableVehicles,
        tripMode: "FROM_SOURCE"
    });
    console.log(`Assigned routes count: ${assigned.assignedRoutes.length}`);
    assigned.assignedRoutes.forEach(r => {
        console.log(`  - Bus ${r.vehicleName}: ${r.assignedUsers}/${r.capacity} pax (${r.stops?.length} stops)`);
    });

    process.exit(0);
}

inspect().catch(e => {
    console.error(e);
    process.exit(1);
});
