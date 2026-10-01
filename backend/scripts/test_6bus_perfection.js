import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";
import {
    sequenceOutwardRouteStops,
    optimizeTour2OptRoad,
    buildGlobalOptimizationMatrix
} from "../services/routeOptimizationService.js";
import {
    buildConsecutiveSegmentRoadGeometry
} from "../services/roadMatrixService.js";
import { validateTransportationPlan } from "../services/aiAgentService.js";

async function test6Bus() {
    await connectDB();
    const sourceHub = {
        name: "KLN College of Engineering",
        address: "Pottapalayam, Sivagangai / Madurai - 630612",
        latitude: 9.8515,
        longitude: 78.1882
    };

    // Define the 6 candidate bus routes without the K.K. Nagar West detour on J1:
    // Route 1 (k1, 70 pax): Vandiyur(18) -> K.K. Nagar West(15) -> Narimedu(7) -> Sellur(7) -> Vilangudi(11) -> Koodal Nagar(12) = 70
    // Route 2 (V1, 70 pax): viraganur(12) -> Anuppanadi(3) -> Othakadai(15) -> Thiruppalai(14) -> Iyer Bungalow(13) -> K.Pudur(13) = 70
    // Route 3 (D1, 70 pax): Villapuram(10) -> Mahal(1) -> Periyar(9) -> Arappalayam(26) -> Kalavasal(10) -> Kochadai(14) = 70
    // Route 4 (I1, 70 pax): Simmakkal(22) -> Goripalayam(20) -> Tallakulam(21) -> Bibikulam(6) -> K.K. Nagar West(1) = 70
    // Route 5 (A2, 70 pax): Anna Nagar(30) -> KK Nagar(21) -> K.K. Nagar West(2) -> Mattuthavani(17) = 70
    // Route 6 (J1, 63 pax): Teppakulam(16) -> Avaniyapuram(9) -> Jaihindpuram(10) -> Palanganatham(12) -> Alagappan Nagar(9) -> Thirunagar(7) = 63
    // Total = 70 + 70 + 70 + 70 + 70 + 63 = 413 pax!

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

    const routesSpec = [
        {
            vehicleName: "k1",
            capacity: 70,
            stops: [
                { ...stopsData["Vandiyur"], userCount: 18 },
                { ...stopsData["K.K. Nagar West"], userCount: 15 },
                { ...stopsData["Narimedu"], userCount: 7 },
                { ...stopsData["Sellur"], userCount: 7 },
                { ...stopsData["Vilangudi"], userCount: 11 },
                { ...stopsData["Koodal Nagar"], userCount: 12 }
            ]
        },
        {
            vehicleName: "V1",
            capacity: 70,
            stops: [
                { ...stopsData["viraganur"], userCount: 12 },
                { ...stopsData["Anuppanadi"], userCount: 3 },
                { ...stopsData["Othakadai"], userCount: 15 },
                { ...stopsData["Thiruppalai"], userCount: 14 },
                { ...stopsData["Iyer Bungalow"], userCount: 13 },
                { ...stopsData["K.Pudur"], userCount: 13 }
            ]
        },
        {
            vehicleName: "D1",
            capacity: 70,
            stops: [
                { ...stopsData["Villapuram"], userCount: 10 },
                { ...stopsData["Mahal"], userCount: 1 },
                { ...stopsData["Periyar"], userCount: 9 },
                { ...stopsData["Arappalayam"], userCount: 26 },
                { ...stopsData["Kalavasal"], userCount: 10 },
                { ...stopsData["Kochadai"], userCount: 14 }
            ]
        },
        {
            vehicleName: "I1",
            capacity: 70,
            stops: [
                { ...stopsData["Simmakkal"], userCount: 22 },
                { ...stopsData["Goripalayam"], userCount: 20 },
                { ...stopsData["Tallakulam"], userCount: 21 },
                { ...stopsData["Bibikulam"], userCount: 6 },
                { ...stopsData["K.K. Nagar West"], userCount: 1 }
            ]
        },
        {
            vehicleName: "A2",
            capacity: 70,
            stops: [
                { ...stopsData["Anna Nagar"], userCount: 30 },
                { ...stopsData["KK Nagar"], userCount: 21 },
                { ...stopsData["K.K. Nagar West"], userCount: 2 },
                { ...stopsData["Mattuthavani"], userCount: 17 }
            ]
        },
        {
            vehicleName: "J1",
            capacity: 70,
            stops: [
                { ...stopsData["Teppakulam"], userCount: 16 },
                { ...stopsData["Avaniyapuram"], userCount: 9 },
                { ...stopsData["Jaihindpuram"], userCount: 10 },
                { ...stopsData["Palanganatham"], userCount: 12 },
                { ...stopsData["Alagappan Nagar"], userCount: 9 },
                { ...stopsData["Thirunagar"], userCount: 7 }
            ]
        }
    ];

    const allStops = Object.values(stopsData);
    const matrix = await buildGlobalOptimizationMatrix({
        depot: sourceHub,
        stops: allStops,
        options: { sourceHub, destinationHub: sourceHub }
    });

    console.log("=== EVALUATING 6 REBALANCED OUTWARD ROUTES ===");
    const evaluatedBuses = [];

    for (let rIdx = 0; rIdx < routesSpec.length; rIdx++) {
        const spec = routesSpec[rIdx];
        const assignedPax = spec.stops.reduce((sum, s) => sum + s.userCount, 0);

        const seq = sequenceOutwardRouteStops({
            departureHub: sourceHub,
            stops: spec.stops,
            matrix,
            tripMode: "FROM_SOURCE"
        });

        const qv = seq.qualityValidation || {};
        console.log(`\nRoute ${rIdx+1}: Bus ${spec.vehicleName} (${assignedPax}/${spec.capacity})`);
        console.log(`  Stops (${seq.stops.length}): ${seq.stops.map(s => `${s.name}(${s.userCount})`).join(" -> ")}`);
        console.log(`  Road Distance: ${seq.routeDistanceKm} km`);
        console.log(`  Detour Ratio: ${qv.detourRatio}x`);
        console.log(`  Directional Reversals: ${qv.directionalReversals}`);
        console.log(`  Backtracking: ${qv.backtrackingDistanceKm} km`);
        console.log(`  Operational Continuity: ${qv.operationalContinuityVerified}`);

        evaluatedBuses.push({
            routeCode: spec.vehicleName,
            vehicleName: spec.vehicleName,
            capacity: spec.capacity,
            assignedUsers: assignedPax,
            allocatedSeats: assignedPax,
            remainingSeats: spec.capacity - assignedPax,
            routeDistanceKm: seq.routeDistanceKm,
            detourRatio: qv.detourRatio,
            isContinuous: qv.operationalContinuityVerified !== false && (qv.directionalReversals || 0) === 0,
            stops: seq.stops,
            sourceHub,
            users: Array.from({ length: assignedPax }, (_, i) => `${spec.vehicleName}_user_${i+1}`)
        });
    }

    const plan = {
        direction: "OUTWARD",
        tripMode: "FROM_SOURCE",
        buses: evaluatedBuses,
        assignedUsers: 413,
        unassignedUsers: 0
    };

    const cert = validateTransportationPlan(plan, { sourceHub, totalComingUsers: 413, totalAvailableCapacity: 420 });
    console.log("\n=======================================================");
    console.log("6-BUS PLAN VALIDATION RESULT:");
    console.log("Is Certified:", cert.isCertified);
    console.log("Status:", cert.status);
    console.log("Failure Reasons:", cert.failureReasons);
    console.log("Checks:", cert.checks);
    console.log("=======================================================");

    process.exit(0);
}

test6Bus().catch(e => {
    console.error(e);
    process.exit(1);
});
