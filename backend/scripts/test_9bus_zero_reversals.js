import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";
import User from "../models/User.js";
import Vehicle from "../models/Vehicle.js";
import Schedule from "../models/Schedule.js";
import {
    getConfirmedUsers,
    deduplicateUsers,
    calculateStoppingGroups,
    resolveStopCoordinates,
    getAvailableVehicles
} from "../services/aiAgentService.js";
import { DEFAULT_SOURCE_HUB } from "../services/mapGeocodingService.js";
import {
    buildGlobalOptimizationMatrix,
    sequenceOutwardRouteStops,
    optimizeTour2OptRoad
} from "../services/routeOptimizationService.js";

async function main() {
    await connectDB();
    const [rawUsers, rawVehicles, schedules] = await Promise.all([
        User.find({ travelStatus: "Coming" }).lean(),
        Vehicle.find({}).lean(),
        Schedule.find({}).lean()
    ]);
    const confirmed = getConfirmedUsers(rawUsers);
    const { uniqueUsers } = deduplicateUsers(confirmed);
    const availableVehicles = getAvailableVehicles(rawVehicles, schedules, null);
    const anchorHub = { name: "KLN", latitude: 9.8515, longitude: 78.1882 };
    const rawStops = calculateStoppingGroups(uniqueUsers);
    const resolvedStops = await resolveStopCoordinates(rawStops, anchorHub);
    const matrix = await buildGlobalOptimizationMatrix({ depot: anchorHub, stops: resolvedStops });

    const stopMap = new Map();
    resolvedStops.forEach(s => stopMap.set(s.name.toLowerCase().trim(), s));

    const getStop = (name, paxOverride) => {
        const s = stopMap.get(name.toLowerCase().trim());
        if (!s) throw new Error("Stop not found: " + name);
        const pax = paxOverride !== undefined ? paxOverride : (s.userCount || 0);
        return { ...s, userCount: pax, passengerCount: pax };
    };

    // Candidate 9 routes with optimal vehicle matching:
    // Available fleet top 9: V1(65), w1(60), h1(55), z1(55), k1(50), D1(50), I1(50), A2(50), Q1(50)
    // 1. Bus 1 (V1, 65 seats): K.Pudur(8), Iyer Bungalow(13), Thiruppalai(14), Othakadai(15), Melur(2) -> 52 pax
    // 2. Bus 2 (w1, 60 seats): viraganur(12), Anuppanadi(3), Vandiyur(18), Mattuthavani(3), K.Pudur(5) -> 41 pax
    // 3. Bus 3 (h1, 55 seats): Goripalayam(20), Sellur(7), Arappalayam(5), Vilangudi(11), Koodal Nagar(12) -> 55 pax
    // 4. Bus 4 (z1, 55 seats): Villapuram(11), Periyar(9), Simmakkal(23), Arappalayam(10) -> 53 pax
    // 5. Bus 5 (k1, 50 seats): Tallakulam(21), Narimedu(7), Bibikulam(6), Mattuthavani(14) -> 48 pax
    // 6. Bus 6 (D1, 50 seats): Mahal(1), Palanganatham(12), Kalavasal(10), Kochadai(14), Arappalayam(11), Koodal Nagar(2) -> 50 pax
    // 7. Bus 7 (I1, 50 seats): Anna Nagar(30), Teppakulam(16) -> 46 pax
    // 8. Bus 8 (A2, 50 seats): K.K. Nagar West(18), KK Nagar(25) -> 43 pax
    // 9. Bus 9 (Q1, 50 seats): Avaniyapuram(9), Jaihindpuram(10), Alagappan Nagar(9), Thirunagar(7) -> 35 pax

    const routes = [
        { name: "V1", cap: 65, stops: [getStop("Mattuthavani", 17), getStop("Othakadai", 15), getStop("Melur", 2)] },
        { name: "w1", cap: 60, stops: [getStop("K.Pudur", 13), getStop("Iyer Bungalow", 13), getStop("Thiruppalai", 14)] },
        { name: "h1", cap: 55, stops: [getStop("viraganur", 12), getStop("Anuppanadi", 3), getStop("Vandiyur", 18), getStop("KK Nagar", 17)] },
        { name: "z1", cap: 55, stops: [getStop("Villapuram", 11), getStop("Periyar", 9), getStop("Simmakkal", 23), getStop("Arappalayam", 10)] },
        { name: "k1", cap: 50, stops: [getStop("Tallakulam", 21), getStop("Narimedu", 7), getStop("Bibikulam", 6), getStop("Goripalayam", 16)] },
        { name: "D1", cap: 50, stops: [getStop("Goripalayam", 4), getStop("Sellur", 7), getStop("Arappalayam", 16), getStop("Vilangudi", 11), getStop("Koodal Nagar", 12)] },
        { name: "I1", cap: 50, stops: [getStop("Anna Nagar", 30), getStop("Teppakulam", 16)] },
        { name: "A2", cap: 50, stops: [getStop("KK Nagar", 8), getStop("K.K. Nagar West", 18), getStop("Mahal", 1), getStop("Palanganatham", 12), getStop("Kalavasal", 10)] },
        { name: "Q1", cap: 50, stops: [getStop("Avaniyapuram", 9), getStop("Jaihindpuram", 10), getStop("Alagappan Nagar", 9), getStop("Thirunagar", 7), getStop("Kochadai", 14), getStop("Koodal Nagar", 2)] }
    ];

    let totalAlloc = 0;
    let allValid = true;
    console.log("=== EVALUATING 9-BUS CANDIDATE PLAN ===");
    routes.forEach((r, idx) => {
        const pCount = r.stops.reduce((s, st) => s + st.userCount, 0);
        totalAlloc += pCount;
        const opt = optimizeTour2OptRoad({ tour: r.stops, matrix, tripMode: "FROM_SOURCE" });
        const seq = sequenceOutwardRouteStops({ departureHub: anchorHub, stops: opt.tour, matrix, tripMode: "FROM_SOURCE" });
        const qv = seq.qualityValidation || {};
        const rev = qv.directionalReversals || 0;
        const detour = qv.detourRatio || 1.0;
        const back = qv.backtrackingDistanceKm || 0;
        const pass = rev === 0 && detour <= 2.25 && pCount <= r.cap;
        if (!pass) allValid = false;
        console.log(`Bus ${idx + 1} (${r.name}, ${pCount}/${r.cap} seats): ${seq.stops.map(s => `${s.name}(${s.userCount}p)`).join(" -> ")}`);
        console.log(`    Dist: ${seq.routeDistanceKm}km, Detour: ${detour}x, Rev: ${rev}, Back: ${back}km, Status: ${pass ? "PASS" : "FAIL"}`);
    });

    console.log(`\nTotal Allocated: ${totalAlloc} / ${uniqueUsers.length}`);
    console.log(`All routes pass continuous quality: ${allValid}`);
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
