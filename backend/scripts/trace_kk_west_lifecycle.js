import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import {
    getConfirmedUsers,
    calculateStoppingGroups,
    resolveStopCoordinates,
    normalizeCanonicalStopName
} from "../services/aiAgentService.js";
import {
    executeGlobalRouteOptimization,
    buildGlobalOptimizationMatrix,
    generateCandidateRoutes,
    consolidateCandidateRoutes,
    balanceCandidateRoutesToFleetCapacities,
    optimizeCandidateRoutesRoad2Opt,
    evaluateInwardCorridorConsolidation,
    consolidateSmallPassengerRoutes,
    evaluateAndConsolidateRepeatedPhysicalStops,
    validateAndRepairRouteContinuity,
    evaluateFleetBalancingDecision,
    getVehicleCapacity
} from "../services/routeOptimizationService.js";

function hasKKWest(stopsOrRoutes) {
    if (!Array.isArray(stopsOrRoutes)) return false;
    for (const item of stopsOrRoutes) {
        if (item.stops && Array.isArray(item.stops)) {
            if (item.stops.some(s => normalizeCanonicalStopName(s.name) === "kk nagar west")) return true;
        } else if (item.name) {
            if (normalizeCanonicalStopName(item.name) === "kk nagar west") return true;
        }
    }
    return false;
}

function findKKWestDetails(routes) {
    const found = [];
    routes.forEach((r, idx) => {
        (r.stops || []).forEach(s => {
            if (normalizeCanonicalStopName(s.name) === "kk nagar west") {
                found.push({
                    routeIndex: idx,
                    routeCode: r.routeCode || r.routeId || r.vehicleName,
                    stopName: s.name,
                    userCount: s.userCount || s.passengerCount || s.userIds?.length || 0,
                    tour: (r.stops || []).map(x => x.name).join(" -> ")
                });
            }
        });
    });
    return found;
}

async function run() {
    await connectDB();
    const destHub = {
        name: "KLN College of Engineering",
        latitude: 9.8515,
        longitude: 78.1882
    };

    const rawUsers = await mongoose.connection.db.collection("users").find({}).toArray();
    const confirmed = getConfirmedUsers(rawUsers);
    console.log(`[Stage 1: Confirmed Users] Total: ${confirmed.length}`);

    const rawGroups = calculateStoppingGroups(confirmed);
    console.log(`[Stage 2: Raw Stopping Groups] Count: ${rawGroups.length}, hasKKWest: ${hasKKWest(rawGroups)}`);

    const resolvedStops = await resolveStopCoordinates(rawGroups, destHub);
    console.log(`[Stage 3: Resolved Stops] Count: ${resolvedStops.length}, hasKKWest: ${hasKKWest(resolvedStops)}`);

    const rawVehicles = await mongoose.connection.db.collection("vehicles").find({}).toArray();
    const schedules = await mongoose.connection.db.collection("schedules").find({}).toArray();
    const { getAvailableVehicles } = await import("../services/aiAgentService.js");
    const availableVehicles = getAvailableVehicles(rawVehicles, schedules, null);
    const inwardPlaces = await mongoose.connection.db.collection("inwardstartingplaces").find({ active: true }).toArray();

    const oppositePlanDoc = await mongoose.connection.db.collection("ai_selected_plans").findOne({
        active: true,
        $or: [{ direction: "OUTWARD" }, { tripMode: "OUTWARD" }]
    });
    const AiPlan = (await import("../models/AiPlan.js")).default;
    const latestGeneratedOpposite = await AiPlan.findOne({
        active: true,
        $or: [{ direction: "OUTWARD" }, { tripMode: "OUTWARD" }]
    }).sort({ generatedAt: -1, createdAt: -1 }).lean();
    const oppositePlan = oppositePlanDoc?.plan || oppositePlanDoc || latestGeneratedOpposite?.aiPlan || null;

    console.log(`[Setup] Available vehicles: ${availableVehicles.length}, Inward starting places: ${inwardPlaces.length}, hasOppositePlan: ${Boolean(oppositePlan)}`);

    // Let's trace executeGlobalRouteOptimization internal steps:
    console.log("\n--- TRACING INSIDE executeGlobalRouteOptimization ---");
    const matrix = await buildGlobalOptimizationMatrix(resolvedStops, destHub, "TO_DESTINATION");
    console.log(`[Matrix] Size: ${matrix.points?.length}`);

    let candidates = generateCandidateRoutes({
        resolvedStops,
        matrix,
        tripMode: "TO_DESTINATION",
        sourceHub: null,
        destinationHub: destHub
    });
    console.log(`[Candidates Initial] Routes: ${candidates.length}, hasKKWest: ${hasKKWest(candidates)}`);
    console.log("  KKWest details:", findKKWestDetails(candidates));

    const fleetBalancing = evaluateFleetBalancingDecision({
        currentDirection: "INWARD",
        currentDemand: 413,
        candidateRoutes: candidates,
        availableVehicles,
        configuredInwardStartingPlaces: inwardPlaces,
        oppositePlan
    });
    console.log(`[Fleet Balancing] Selected fleet: ${fleetBalancing.selectedFleet?.map(v => v.vehicleName || v.name).join(", ")}, targetRouteCount: ${fleetBalancing.targetRouteCount}`);

    const targetRouteCount = fleetBalancing.targetRouteCount || 7;
    let consolidated = candidates;
    if (candidates.length > targetRouteCount) {
        consolidated = consolidateCandidateRoutes({
            routes: candidates,
            targetRouteCount,
            maxBusCapacity: 70,
            matrix,
            tripMode: "TO_DESTINATION",
            auditTrail: []
        });
        console.log(`[Consolidate Candidate Routes] Routes: ${consolidated.length}, hasKKWest: ${hasKKWest(consolidated)}`);
        console.log("  KKWest details:", findKKWestDetails(consolidated));
    }

    let balancedRoutes = balanceCandidateRoutesToFleetCapacities({
        routes: consolidated,
        selectedFleet: fleetBalancing.selectedFleet || [],
        matrix,
        tripMode: "TO_DESTINATION",
        destinationHub: destHub,
        auditTrail: []
    });
    console.log(`[Balance Candidate Routes to Fleet Capacities] Routes: ${balancedRoutes.length}, hasKKWest: ${hasKKWest(balancedRoutes)}`);
    console.log("  KKWest details:", findKKWestDetails(balancedRoutes));

    let optRoutes = optimizeCandidateRoutesRoad2Opt({
        routes: balancedRoutes,
        matrix,
        tripMode: "TO_DESTINATION"
    });
    console.log(`[Optimize 2-Opt] Routes: ${optRoutes.length}, hasKKWest: ${hasKKWest(optRoutes)}`);
    console.log("  KKWest details:", findKKWestDetails(optRoutes));

    let inwardCorridorConsol = evaluateInwardCorridorConsolidation({
        routes: optRoutes,
        availableVehicles,
        configuredInwardStartingPlaces: inwardPlaces,
        destinationHub: destHub,
        maxBusCapacity: 70,
        matrix,
        tripMode: "TO_DESTINATION",
        auditTrail: []
    });
    const afterInwardConsol = inwardCorridorConsol.routes || optRoutes;
    console.log(`[Evaluate Inward Corridor Consolidation] Routes: ${afterInwardConsol.length}, hasKKWest: ${hasKKWest(afterInwardConsol)}`);
    console.log("  KKWest details:", findKKWestDetails(afterInwardConsol));

    // Now test post-globalOpt steps from buildAIPlan:
    console.log("\n--- TRACING POST-GLOBAL OPTIMIZATION (buildAIPlan) ---");
    let chosenBuses = afterInwardConsol.map((r, idx) => ({
        ...r,
        routeCode: r.routeCode || `R-${String(idx + 1).padStart(2, "0")}`,
        stops: r.stops || []
    }));

    let smallConsol = consolidateSmallPassengerRoutes({
        routes: chosenBuses,
        matrix,
        tripMode: "TO_DESTINATION",
        smallRouteThreshold: 15,
        activeInwardStartingPlaces: inwardPlaces,
        anchorHub: destHub,
        sourceHub: null,
        destinationHub: destHub,
        auditTrail: []
    });
    console.log(`[consolidateSmallPassengerRoutes] Routes: ${smallConsol.length}, hasKKWest: ${hasKKWest(smallConsol)}`);
    console.log("  KKWest details:", findKKWestDetails(smallConsol));

    evaluateAndConsolidateRepeatedPhysicalStops({
        routes: smallConsol,
        tripMode: "TO_DESTINATION",
        matrix,
        activeInwardStartingPlaces: inwardPlaces,
        anchorHub: destHub,
        sourceHub: null,
        destinationHub: destHub,
        auditTrail: []
    });
    console.log(`[evaluateAndConsolidateRepeatedPhysicalStops] Routes: ${smallConsol.length}, hasKKWest: ${hasKKWest(smallConsol)}`);
    console.log("  KKWest details:", findKKWestDetails(smallConsol));

    const continuityRepairResult = await validateAndRepairRouteContinuity({
        chosenBuses: smallConsol,
        availableVehicles,
        anchorHub: destHub,
        sourceHub: null,
        destinationHub: destHub,
        tripMode: "TO_DESTINATION",
        activeInwardStartingPlaces: inwardPlaces,
        matrix
    });
    console.log(`[validateAndRepairRouteContinuity] Buses: ${continuityRepairResult.buses?.length}, hasKKWest: ${hasKKWest(continuityRepairResult.buses)}`);
    console.log("  KKWest details:", findKKWestDetails(continuityRepairResult.buses));

    process.exit(0);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
