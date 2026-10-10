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
    consolidateCandidateRoutes,
    balanceCandidateRoutesToFleetCapacities,
    optimizeTour2OptRoad,
    assignVehiclesToOptimizedRoutes,
    consolidateAndRebalanceLowOccupancyOutwardRoutes,
    balanceRoutesToGuaranteedSeating,
    sequenceOutwardRouteStops
} from "../services/routeOptimizationService.js";

async function main() {
    await connectDB();
    const rawUsers = await User.find({ travelStatus: "Coming" }).lean();
    const confirmed = getConfirmedUsers(rawUsers);
    const { uniqueUsers } = deduplicateUsers(confirmed);
    const totalComingDemand = uniqueUsers.length;
    console.log("Total Coming Demand:", totalComingDemand);

    const stoppingGroups = calculateStoppingGroups(uniqueUsers);
    const anchorHub = { name: "K. L. N. College of Engineering", latitude: 9.8515, longitude: 78.1882 };
    const resolvedStops = await resolveStopCoordinates(stoppingGroups, anchorHub);

    const availableVehicles = await Vehicle.find({ isActive: { $ne: false } }).sort({ capacity: -1 }).lean();
    const sortedFleetDesc = [...availableVehicles].sort((a,b) => Number(b.capacity||0) - Number(a.capacity||0));
    console.log(`Available Vehicles (${availableVehicles.length}):`, sortedFleetDesc.map(v => `${v.vehicleName}:${v.capacity}`).join(", "));

    // Calculate theoretical capacity minimum
    let accCap = 0;
    let minCapacityBuses = 0;
    for (const v of sortedFleetDesc) {
        accCap += Number(v.capacity || 0);
        minCapacityBuses++;
        if (accCap >= totalComingDemand) break;
    }
    console.log(`Theoretical Capacity Minimum: ${minCapacityBuses} buses (${accCap} seats for ${totalComingDemand} demand)`);

    const matrix = await buildGlobalOptimizationMatrix({ depot: anchorHub, stops: resolvedStops });
    const maxBusCapacity = Number(sortedFleetDesc[0]?.capacity || 70);

    // Initial candidates
    const rawCandidates = generateGlobalCandidateRoutes({
        stops: resolvedStops,
        matrix,
        maxBusCapacity,
        fleetCapacities: sortedFleetDesc.map(v => Number(v.capacity || 0)),
        tripMode: "FROM_SOURCE"
    });
    console.log(`Generated ${rawCandidates.length} initial candidate routes.`);

    // Test loop from K = minCapacityBuses to availableVehicles.length
    for (let K = minCapacityBuses; K <= availableVehicles.length; K++) {
        console.log(`\n======================================================`);
        console.log(`[AI-FLEET] TESTING FLEET SIZE: ${K} BUSES`);
        console.log(`======================================================`);

        const candidateFleet = sortedFleetDesc.slice(0, K);
        const candidateFleetCap = candidateFleet.reduce((sum, v) => sum + Number(v.capacity || 0), 0);
        console.log(`Candidate Fleet Capacity: ${candidateFleetCap} seats across ${K} buses.`);

        if (candidateFleetCap < totalComingDemand) {
            console.log(`[AI-FLEET] K=${K} INFEASIBLE: Insufficient fleet capacity (${candidateFleetCap} < ${totalComingDemand})`);
            continue;
        }

        // Deep copy candidate routes
        let currentRoutes = rawCandidates.map(r => ({
            ...r,
            stops: [...r.stops],
            users: [...(r.users || [])]
        }));

        // Consolidate candidate routes towards K
        if (currentRoutes.length > K) {
            currentRoutes = consolidateCandidateRoutes({
                routes: currentRoutes,
                targetRouteCount: K,
                maxBusCapacity,
                matrix,
                tripMode: "FROM_SOURCE"
            });
        }
        console.log(`After consolidation towards ${K}: ${currentRoutes.length} candidate routes.`);

        // Balance candidate routes to fleet capacities
        currentRoutes = balanceCandidateRoutesToFleetCapacities({
            routes: currentRoutes,
            fleet: candidateFleet,
            matrix,
            tripMode: "FROM_SOURCE",
            sourceHub: anchorHub,
            destinationHub: anchorHub
        });

        // 2-opt tour refinement
        currentRoutes = currentRoutes.map(route => {
            const opt = optimizeTour2OptRoad({
                tour: route.stops,
                matrix,
                tripMode: "FROM_SOURCE"
            });
            return {
                ...route,
                stops: opt.tour,
                routeDistanceKm: opt.roadDistanceKm
            };
        });

        // Assign vehicles from candidateFleet
        const { assignedRoutes } = assignVehiclesToOptimizedRoutes({
            routes: currentRoutes,
            availableVehicles: candidateFleet,
            tripMode: "FROM_SOURCE"
        });

        let testRoutes = assignedRoutes;

        // Consolidate low-occupancy routes
        if (testRoutes.length > 1) {
            testRoutes = consolidateAndRebalanceLowOccupancyOutwardRoutes({
                routes: testRoutes,
                availableVehicles: candidateFleet,
                sourceHub: anchorHub,
                matrix,
                tripMode: "FROM_SOURCE"
            });
        }

        // Guaranteed seating balancing
        const seatingRes = balanceRoutesToGuaranteedSeating({
            routes: testRoutes,
            availableVehicles: candidateFleet,
            matrix,
            hub: anchorHub,
            tripMode: "FROM_SOURCE"
        });
        testRoutes = seatingRes.balanced;

        const totalAssigned = testRoutes.reduce((sum, r) => sum + (r.assignedUsers || 0), 0);
        const totalStanding = seatingRes.totalStanding || 0;
        const overCapCount = seatingRes.overCapacityCount || 0;

        // Sequence and validate road progression for each route
        let allContinuity = true;
        let reversalCount = 0;
        for (const route of testRoutes) {
            const seq = sequenceOutwardRouteStops({
                departureHub: anchorHub,
                stops: route.stops,
                matrix,
                tripMode: "FROM_SOURCE"
            });
            route.stops = seq.stops;
            route.routeDistanceKm = seq.routeDistanceKm;
            route.totalRouteDuration = seq.totalRouteDuration;
            route.longestPassengerTravelTime = seq.longestPassengerTravelTime;
            route.averagePassengerTravelTime = seq.averagePassengerTravelTime;
            route.passengersWithin60 = seq.passengersWithin60;
            route.passengersAbove60 = seq.passengersAbove60;
            route.qualityValidation = seq.qualityValidation;

            const qv = seq.qualityValidation || {};
            if ((qv.directionalReversals || 0) > 0) reversalCount += qv.directionalReversals;
        }

        const isFeasible = (totalAssigned === totalComingDemand) && (totalStanding === 0) && (overCapCount === 0);
        console.log(`[AI-FLEET] Evaluation for K=${K}:`);
        console.log(`  Routes: ${testRoutes.length}`);
        console.log(`  Assigned: ${totalAssigned} / ${totalComingDemand} (Standing: ${totalStanding}, OverCapacity: ${overCapCount})`);
        console.log(`  Directional Reversals: ${reversalCount}`);
        console.log(`  Feasible: ${isFeasible ? "YES" : "NO"}`);

        testRoutes.forEach((r, idx) => {
            console.log(`    Route ${idx+1} [${r.vehicleName}]: ${r.assignedUsers}/${r.capacity} pax, ${r.stops.length} stops (${r.stops.map(s => s.name).join(" -> ")}) | Dist=${r.routeDistanceKm}km, LongestPax=${r.longestPassengerTravelTime}m`);
        });

        if (isFeasible) {
            console.log(`\n>>> [AI-FLEET] SUCCESS! Lowest Feasible Fleet Selected: ${testRoutes.length} buses (K=${K}) <<<`);
            break;
        }
    }

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
