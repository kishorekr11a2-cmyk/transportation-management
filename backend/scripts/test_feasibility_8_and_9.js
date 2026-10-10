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
import { DEFAULT_SOURCE_HUB, calculateDistanceKm } from "../services/mapGeocodingService.js";
import {
    calculateBearing,
    getBearingDifference
} from "../services/mapAwareRouteEngine.js";
import {
    buildGlobalOptimizationMatrix,
    generateGlobalCandidateRoutes,
    sequenceOutwardRouteStops,
    optimizeTour2OptRoad,
    isRouteCorridorCoherent
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

    console.log("Total stops:", resolvedStops.length);
    console.log("Total demand:", resolvedStops.reduce((s, st) => s + (st.userCount || 0), 0));

    // Natural corridors from KLN College:
    // 1. Southeast / Ring Road: Viraganur (12), Vandiyur (18), Anuppanadi (3)
    // 2. East-Central: Anna Nagar (30), KK Nagar (25), K.K. Nagar West (18)
    // 3. Northeast Radial (NH38): Mattuthavani (17), Othakadai (15), Melur (2)
    // 4. North Radial: K.Pudur (13), Iyer Bungalow (13), Thiruppalai (14)
    // 5. North-Central: Tallakulam (21), Narimedu (7), Bibikulam (6), Goripalayam (20)
    // 6. Northwest Radial: Sellur (7), Vilangudi (11), Koodal Nagar (14)
    // 7. Central-West: Simmakkal (23), Periyar (9), Arappalayam (26)
    // 8. West Radial: Kalavasal (10), Kochadai (14), Mahal (1)
    // 9. South-Southwest: Teppakulam (16), Villapuram (11), Avaniyapuram (9), Jaihindpuram (10), Palanganatham (12), Alagappan Nagar (9), Thirunagar (7)

    // Let's print each natural corridor demand
    const corridors = [
        { name: "SE Ring", stops: ["viraganur", "Vandiyur", "Anuppanadi"] },
        { name: "East KK", stops: ["Anna Nagar", "KK Nagar", "K.K. Nagar West"] },
        { name: "NE Melur Highway", stops: ["Mattuthavani", "Othakadai", "Melur"] },
        { name: "North Iyer", stops: ["K.Pudur", "Iyer Bungalow", "Thiruppalai"] },
        { name: "NC Tallakulam", stops: ["Tallakulam", "Narimedu", "Bibikulam", "Goripalayam"] },
        { name: "NW Vilangudi", stops: ["Sellur", "Vilangudi", "Koodal Nagar"] },
        { name: "Central Simmakkal", stops: ["Simmakkal", "Periyar", "Arappalayam"] },
        { name: "West Kochadai", stops: ["Mahal", "Palanganatham", "Kalavasal", "Kochadai"] },
        { name: "SSW Thirunagar", stops: ["Villapuram", "Avaniyapuram", "Jaihindpuram", "Alagappan Nagar", "Thirunagar"] },
        { name: "Central Teppakulam", stops: ["Teppakulam"] }
    ];

    corridors.forEach(c => {
        const pTotal = c.stops.reduce((sum, name) => {
            const st = resolvedStops.find(s => s.name.toLowerCase() === name.toLowerCase());
            return sum + (st ? (st.userCount || 0) : 0);
        }, 0);
        console.log(`Corridor ${c.name}: ${pTotal} pax [${c.stops.join(", ")}]`);
    });

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
