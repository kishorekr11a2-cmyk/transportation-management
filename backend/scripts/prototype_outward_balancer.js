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
    calculateDistanceKm,
    getBearingDifference,
    calculateBearing,
    validateTransportationPlan
} from "../services/aiAgentService.js";
import {
    buildGlobalOptimizationMatrix,
    generateGlobalCandidateRoutes,
    applyInterRouteRelocate,
    applyInterRouteExchange,
    consolidateSmallPassengerRoutes,
    evaluateFleetBalancingDecision,
    consolidateCandidateRoutes,
    assignVehiclesToOptimizedRoutes,
    validateAndRepairRouteContinuity,
    sequenceOutwardRouteStops,
    optimizeTour2OptRoad,
    insertStopNearestCost
} from "../services/routeOptimizationService.js";

/**
 * Prototype of consolidateAndRebalanceLowOccupancyOutwardRoutes
 */
function consolidateAndRebalanceLowOccupancyOutwardRoutes({
    routes = [],
    availableVehicles = [],
    sourceHub,
    matrix,
    auditTrail = []
}) {
    if (!Array.isArray(routes) || routes.length <= 1) return routes;

    let currentRoutes = routes.map(r => ({
        ...r,
        stops: (r.stops || []).map(s => ({
            ...s,
            userIds: Array.isArray(s.userIds) ? [...s.userIds] : []
        })),
        users: Array.isArray(r.users) ? [...r.users] : []
    }));

    // Find any low occupancy route: <= 15 pax or utilization < 0.35
    const LOW_OCCUPANCY_THRESHOLD = 15;
    let changed = true;
    let passes = 0;

    while (changed && passes < 3 && currentRoutes.length > 1) {
        changed = false;
        passes++;

        const lowRoutes = currentRoutes
            .filter(r => r.assignedUsers > 0 && (r.assignedUsers <= LOW_OCCUPANCY_THRESHOLD || (r.assignedUsers / r.capacity) < 0.35))
            .sort((a, b) => a.assignedUsers - b.assignedUsers);

        for (const lowRoute of lowRoutes) {
            console.log(`\n[LowOccAudit] Found low-occupancy route '${lowRoute.vehicleName || lowRoute.routeCode}' with ${lowRoute.assignedUsers}/${lowRoute.capacity} passengers across ${lowRoute.stops.length} stops.`);

            let allStopsAbsorbed = true;
            const otherRoutes = currentRoutes.filter(r => r !== lowRoute);

            // Copy other routes to simulate absorption
            let trialOtherRoutes = otherRoutes.map(r => ({
                ...r,
                stops: r.stops.map(s => ({ ...s, userIds: [...(s.userIds || [])] })),
                users: [...(r.users || [])]
            }));

            for (const stop of lowRoute.stops) {
                const stopPax = stop.passengerCount || stop.userCount || stop.userIds?.length || 0;
                let stopAbsorbed = false;

                // Priority 1: Direct insertion into a compatible route with available capacity
                const viableRoutes = trialOtherRoutes.filter(r => (r.capacity - r.assignedUsers) >= stopPax);

                // Sort viable routes by geographic proximity to stop
                viableRoutes.sort((rA, rB) => {
                    const distA = Math.min(...rA.stops.map(s => calculateDistanceKm(s.latitude, s.longitude, stop.latitude, stop.longitude)));
                    const distB = Math.min(...rB.stops.map(s => calculateDistanceKm(s.latitude, s.longitude, stop.latitude, stop.longitude)));
                    return distA - distB;
                });

                for (const targetRoute of viableRoutes) {
                    const nearestDist = Math.min(...targetRoute.stops.map(s => calculateDistanceKm(s.latitude, s.longitude, stop.latitude, stop.longitude)));
                    if (nearestDist > 8.0) continue; // Corridor proximity guard

                    // Test insertion
                    const testTour = [...targetRoute.stops, stop];
                    const seq = sequenceOutwardRouteStops({
                        departureHub: sourceHub,
                        stops: testTour,
                        matrix,
                        tripMode: "FROM_SOURCE"
                    });
                    const qv = seq.qualityValidation || {};

                    if (qv.operationalContinuityVerified !== false && (qv.directionalReversals || 0) === 0 && (qv.detourRatio || 1.0) <= 2.25) {
                        targetRoute.stops = seq.stops;
                        targetRoute.assignedUsers += stopPax;
                        targetRoute.users.push(...(stop.userIds || []));
                        stopAbsorbed = true;
                        console.log(`  [AbsorbDirect] Stop '${stop.name}' (${stopPax} pax) absorbed directly into '${targetRoute.vehicleName}' (detour: ${qv.detourRatio}x).`);
                        break;
                    }
                }

                if (stopAbsorbed) continue;

                // Priority 2: Corridor Multi-Hop Rebalancing
                // If the most compatible corridor route is full, can that route offload some of its other stops/passengers
                // to a third route that has spare capacity?
                const compatibleFullRoutes = trialOtherRoutes.filter(r => {
                    if ((r.capacity - r.assignedUsers) >= stopPax) return false;
                    const nearestDist = Math.min(...r.stops.map(s => calculateDistanceKm(s.latitude, s.longitude, stop.latitude, stop.longitude)));
                    return nearestDist <= 4.0; // Very close to corridor
                });

                for (const corridorRoute of compatibleFullRoutes) {
                    const neededSeats = stopPax - (corridorRoute.capacity - corridorRoute.assignedUsers);

                    // Look for a third route that has spare capacity >= neededSeats
                    const donorCandidates = corridorRoute.stops.filter(s => {
                        const sCount = s.passengerCount || s.userCount || s.userIds?.length || 0;
                        return sCount >= neededSeats;
                    });

                    for (const donorStop of donorCandidates) {
                        const shiftPax = neededSeats;
                        const thirdRoutes = trialOtherRoutes.filter(r => r !== corridorRoute && (r.capacity - r.assignedUsers) >= shiftPax);

                        for (const thirdRoute of thirdRoutes) {
                            const thirdDist = Math.min(...thirdRoute.stops.map(s => calculateDistanceKm(s.latitude, s.longitude, donorStop.latitude, donorStop.longitude)));
                            if (thirdDist > 5.0) continue;

                            // Test shifting donorStop to thirdRoute
                            const shiftIds = Array.isArray(donorStop.userIds) ? donorStop.userIds.slice(0, shiftPax) : [];
                            const testDonorStop = { ...donorStop, userCount: shiftPax, passengerCount: shiftPax, userIds: shiftIds };
                            const thirdTour = [...thirdRoute.stops, testDonorStop];
                            const thirdSeq = sequenceOutwardRouteStops({ departureHub: sourceHub, stops: thirdTour, matrix, tripMode: "FROM_SOURCE" });
                            const thirdQv = thirdSeq.qualityValidation || {};

                            if (thirdQv.operationalContinuityVerified !== false && (thirdQv.directionalReversals || 0) === 0 && (thirdQv.detourRatio || 1.0) <= 2.25) {
                                // Donor shift is valid! Now test inserting original stop into corridorRoute
                                const remainingDonorPax = (donorStop.userCount || 0) - shiftPax;
                                const updatedCorridorStops = corridorRoute.stops.map(s => {
                                    if (s.name === donorStop.name) {
                                        return { ...s, userCount: remainingDonorPax, passengerCount: remainingDonorPax, userIds: s.userIds.slice(shiftPax) };
                                    }
                                    return s;
                                }).filter(s => s.userCount > 0);
                                updatedCorridorStops.push(stop);

                                const corrSeq = sequenceOutwardRouteStops({ departureHub: sourceHub, stops: updatedCorridorStops, matrix, tripMode: "FROM_SOURCE" });
                                const corrQv = corrSeq.qualityValidation || {};

                                if (corrQv.operationalContinuityVerified !== false && (corrQv.directionalReversals || 0) === 0 && (corrQv.detourRatio || 1.0) <= 2.25) {
                                    // Apply multi-hop transfer!
                                    donorStop.userCount = remainingDonorPax;
                                    donorStop.passengerCount = remainingDonorPax;
                                    donorStop.userIds = donorStop.userIds.slice(shiftPax);
                                    corridorRoute.stops = corrSeq.stops;
                                    corridorRoute.assignedUsers = corridorRoute.assignedUsers - shiftPax + stopPax;
                                    corridorRoute.users = corridorRoute.stops.flatMap(s => s.userIds || []);

                                    thirdRoute.stops = thirdSeq.stops;
                                    thirdRoute.assignedUsers += shiftPax;
                                    thirdRoute.users.push(...shiftIds);

                                    stopAbsorbed = true;
                                    console.log(`  [AbsorbMultiHop] Rebalanced ${shiftPax} pax of '${donorStop.name}' from '${corridorRoute.vehicleName}' to '${thirdRoute.vehicleName}', enabling '${corridorRoute.vehicleName}' to absorb '${stop.name}' (${stopPax} pax).`);
                                    break;
                                }
                            }
                        }
                        if (stopAbsorbed) break;
                    }
                    if (stopAbsorbed) break;
                }

                if (!stopAbsorbed) {
                    allStopsAbsorbed = false;
                    console.log(`  [AbsorbFailed] Stop '${stop.name}' (${stopPax} pax) could not be absorbed without violating detour or capacity constraints.`);
                    break;
                }
            }

            if (allStopsAbsorbed) {
                console.log(`[LowOccAudit] SUCCESS: All stops of low-occupancy bus '${lowRoute.vehicleName}' absorbed! Removing bus.`);
                currentRoutes = trialOtherRoutes;
                changed = true;
                auditTrail.push({
                    action: "CONSOLIDATE_LOW_OCCUPANCY_BUS",
                    vehicleName: lowRoute.vehicleName,
                    passengersMoved: lowRoute.assignedUsers,
                    reason: `Consolidated low-occupancy bus '${lowRoute.vehicleName}' (${lowRoute.assignedUsers} pax) into compatible corridor routes. Reduced fleet from ${currentRoutes.length + 1} to ${currentRoutes.length} buses.`
                });
                break;
            }
        }
    }

    return currentRoutes;
}

async function testPrototype() {
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

    console.log(`Confirmed Users: ${confirmedUsers.length}, Available Vehicles: ${availableVehicles.length}`);

    // Create a scenario matching the 7-bus outward issue:
    // k1: 70/70, V1: 70/70, D1: 63/70, I1: 70/70, A2: 68/70, J1: 70/70, w1: 2/60!
    // Total 413 pax.
    const stopsData = {
        Vandiyur: { name: "Vandiyur", latitude: 9.92, longitude: 78.165 },
        "K.K. Nagar West": { name: "K.K. Nagar West", latitude: 9.925, longitude: 78.146 },
        Narimedu: { name: "Narimedu", latitude: 9.938, longitude: 78.132 },
        Sellur: { name: "Sellur", latitude: 9.941, longitude: 78.118 },
        Vilangudi: { name: "Vilangudi", latitude: 9.951, longitude: 78.092 },
        "Koodal Nagar": { name: "Koodal Nagar", latitude: 9.967663, longitude: 78.096438 },

        viraganur: { name: "viraganur", latitude: 9.9005203, longitude: 78.162842 },
        Anuppanadi: { name: "Anuppanadi", latitude: 9.907, longitude: 78.151 },
        Othakadai: { name: "Othakadai", latitude: 9.97, longitude: 78.18 },
        Thiruppalai: { name: "Thiruppalai", latitude: 9.9825, longitude: 78.143 },
        "Iyer Bungalow": { name: "Iyer Bungalow", latitude: 9.965, longitude: 78.141 },
        "K.Pudur": { name: "K.Pudur", latitude: 9.952, longitude: 78.146 },

        Villapuram: { name: "Villapuram", latitude: 9.895, longitude: 78.132 },
        Mahal: { name: "Mahal", latitude: 9.915006, longitude: 78.1220546 },
        Periyar: { name: "Periyar", latitude: 9.9175, longitude: 78.114 },
        Arappalayam: { name: "Arappalayam", latitude: 9.9322, longitude: 78.1025 },
        Kalavasal: { name: "Kalavasal", latitude: 9.930305555555554, longitude: 78.0955 },
        Kochadai: { name: "Kochadai", latitude: 9.936, longitude: 78.085 },

        Simmakkal: { name: "Simmakkal", latitude: 9.9255, longitude: 78.1192 },
        Goripalayam: { name: "Goripalayam", latitude: 9.9315, longitude: 78.1275 },
        Tallakulam: { name: "Tallakulam", latitude: 9.936, longitude: 78.135 },
        Bibikulam: { name: "Bibikulam", latitude: 9.942, longitude: 78.136 },

        "Anna Nagar": { name: "Anna Nagar", latitude: 9.918, longitude: 78.1467 },
        "KK Nagar": { name: "KK Nagar", latitude: 9.927, longitude: 78.151 },
        Mattuthavani: { name: "Mattuthavani", latitude: 9.945, longitude: 78.158 },

        Teppakulam: { name: "Teppakulam", latitude: 9.914, longitude: 78.147 },
        Avaniyapuram: { name: "Avaniyapuram", latitude: 9.878, longitude: 78.124 },
        Jaihindpuram: { name: "Jaihindpuram", latitude: 9.902, longitude: 78.112 },
        Palanganatham: { name: "Palanganatham", latitude: 9.905, longitude: 78.098 },
        "Alagappan Nagar": { name: "Alagappan Nagar", latitude: 9.892, longitude: 78.099 },
        Thirunagar: { name: "Thirunagar", latitude: 9.869, longitude: 78.069 }
    };

    const initial7Buses = [
        {
            vehicleName: "k1",
            capacity: 70,
            assignedUsers: 70,
            stops: [
                { ...stopsData["Vandiyur"], userCount: 18, userIds: Array.from({length: 18}, (_, i) => `k1_v_${i}`) },
                { ...stopsData["K.K. Nagar West"], userCount: 15, userIds: Array.from({length: 15}, (_, i) => `k1_kw_${i}`) },
                { ...stopsData["Narimedu"], userCount: 7, userIds: Array.from({length: 7}, (_, i) => `k1_n_${i}`) },
                { ...stopsData["Sellur"], userCount: 7, userIds: Array.from({length: 7}, (_, i) => `k1_s_${i}`) },
                { ...stopsData["Vilangudi"], userCount: 11, userIds: Array.from({length: 11}, (_, i) => `k1_vg_${i}`) },
                { ...stopsData["Koodal Nagar"], userCount: 12, userIds: Array.from({length: 12}, (_, i) => `k1_kn_${i}`) }
            ]
        },
        {
            vehicleName: "V1",
            capacity: 70,
            assignedUsers: 70,
            stops: [
                { ...stopsData["viraganur"], userCount: 12, userIds: Array.from({length: 12}, (_, i) => `v1_vr_${i}`) },
                { ...stopsData["Anuppanadi"], userCount: 3, userIds: Array.from({length: 3}, (_, i) => `v1_an_${i}`) },
                { ...stopsData["Othakadai"], userCount: 15, userIds: Array.from({length: 15}, (_, i) => `v1_ot_${i}`) },
                { ...stopsData["Thiruppalai"], userCount: 14, userIds: Array.from({length: 14}, (_, i) => `v1_tp_${i}`) },
                { ...stopsData["Iyer Bungalow"], userCount: 13, userIds: Array.from({length: 13}, (_, i) => `v1_ib_${i}`) },
                { ...stopsData["K.Pudur"], userCount: 13, userIds: Array.from({length: 13}, (_, i) => `v1_kp_${i}`) }
            ]
        },
        {
            vehicleName: "D1",
            capacity: 70,
            assignedUsers: 63,
            stops: [
                { ...stopsData["Villapuram"], userCount: 10, userIds: Array.from({length: 10}, (_, i) => `d1_vp_${i}`) },
                { ...stopsData["Mahal"], userCount: 1, userIds: Array.from({length: 1}, (_, i) => `d1_mh_${i}`) },
                { ...stopsData["Periyar"], userCount: 9, userIds: Array.from({length: 9}, (_, i) => `d1_pr_${i}`) },
                { ...stopsData["Arappalayam"], userCount: 26, userIds: Array.from({length: 26}, (_, i) => `d1_ar_${i}`) },
                { ...stopsData["Kalavasal"], userCount: 10, userIds: Array.from({length: 10}, (_, i) => `d1_kl_${i}`) },
                { ...stopsData["Kochadai"], userCount: 7, userIds: Array.from({length: 7}, (_, i) => `d1_kc_${i}`) }
            ]
        },
        {
            vehicleName: "I1",
            capacity: 70,
            assignedUsers: 70,
            stops: [
                { ...stopsData["Simmakkal"], userCount: 22, userIds: Array.from({length: 22}, (_, i) => `i1_sm_${i}`) },
                { ...stopsData["Goripalayam"], userCount: 20, userIds: Array.from({length: 20}, (_, i) => `i1_gp_${i}`) },
                { ...stopsData["Tallakulam"], userCount: 21, userIds: Array.from({length: 21}, (_, i) => `i1_tk_${i}`) },
                { ...stopsData["Bibikulam"], userCount: 6, userIds: Array.from({length: 6}, (_, i) => `i1_bk_${i}`) },
                { ...stopsData["Kochadai"], userCount: 1, userIds: Array.from({length: 1}, (_, i) => `i1_kc_${i}`) }
            ]
        },
        {
            vehicleName: "A2",
            capacity: 70,
            assignedUsers: 68,
            stops: [
                { ...stopsData["Anna Nagar"], userCount: 30, userIds: Array.from({length: 30}, (_, i) => `a2_an_${i}`) },
                { ...stopsData["KK Nagar"], userCount: 21, userIds: Array.from({length: 21}, (_, i) => `a2_kn_${i}`) },
                { ...stopsData["Mattuthavani"], userCount: 17, userIds: Array.from({length: 17}, (_, i) => `a2_mt_${i}`) }
            ]
        },
        {
            vehicleName: "J1",
            capacity: 70,
            assignedUsers: 70,
            stops: [
                { ...stopsData["Teppakulam"], userCount: 16, userIds: Array.from({length: 16}, (_, i) => `j1_tp_${i}`) },
                { ...stopsData["K.K. Nagar West"], userCount: 1, userIds: Array.from({length: 1}, (_, i) => `j1_kw_${i}`) },
                { ...stopsData["Avaniyapuram"], userCount: 9, userIds: Array.from({length: 9}, (_, i) => `j1_av_${i}`) },
                { ...stopsData["Jaihindpuram"], userCount: 10, userIds: Array.from({length: 10}, (_, i) => `j1_jh_${i}`) },
                { ...stopsData["Palanganatham"], userCount: 12, userIds: Array.from({length: 12}, (_, i) => `j1_pl_${i}`) },
                { ...stopsData["Alagappan Nagar"], userCount: 9, userIds: Array.from({length: 9}, (_, i) => `j1_al_${i}`) },
                { ...stopsData["Thirunagar"], userCount: 7, userIds: Array.from({length: 7}, (_, i) => `j1_tn_${i}`) },
                { ...stopsData["Kochadai"], userCount: 6, userIds: Array.from({length: 6}, (_, i) => `j1_kc_${i}`) }
            ]
        },
        {
            vehicleName: "w1",
            capacity: 60,
            assignedUsers: 2,
            stops: [
                { ...stopsData["K.K. Nagar West"], userCount: 2, userIds: ["w1_u1", "w1_u2"] }
            ]
        }
    ];

    console.log("\n=== BEFORE REBALANCING ===");
    console.log(`Total buses: ${initial7Buses.length}`);
    initial7Buses.forEach(b => {
        console.log(`  - Bus ${b.vehicleName}: ${b.assignedUsers}/${b.capacity} (${b.stops.map(s => `${s.name}(${s.userCount})`).join(", ")})`);
    });

    const allStops = Object.values(stopsData);
    const matrix = await buildGlobalOptimizationMatrix({
        depot: sourceHub,
        stops: allStops,
        options: { sourceHub, destinationHub: sourceHub }
    });

    const auditTrail = [];
    const consolidatedRoutes = consolidateAndRebalanceLowOccupancyOutwardRoutes({
        routes: initial7Buses,
        availableVehicles,
        sourceHub,
        matrix,
        auditTrail
    });

    console.log("\n=== AFTER REBALANCING ===");
    console.log(`Total buses: ${consolidatedRoutes.length}`);
    consolidatedRoutes.forEach(b => {
        console.log(`  - Bus ${b.vehicleName}: ${b.assignedUsers}/${b.capacity} (${b.stops.map(s => `${s.name}(${s.userCount})`).join(", ")})`);
    });

    console.log("\nAudit Trail:");
    auditTrail.forEach(a => console.log(`  [${a.action}] ${a.reason}`));

    process.exit(0);
}

testPrototype().catch(e => {
    console.error(e);
    process.exit(1);
});
