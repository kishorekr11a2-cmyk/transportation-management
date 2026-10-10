import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import dotenv from "dotenv";
dotenv.config({ path: path.join(__dirname, "../.env") });
import connectDB from "../config/db.js";
import MapLocation from "../models/mapLocation.js";
import { sequenceOutwardRouteStops, buildGlobalOptimizationMatrix } from "../services/routeOptimizationService.js";

async function testMerge() {
    await connectDB();
    const college = {
        name: "K. L. N. College of Engineering",
        latitude: 9.8515,
        longitude: 78.1882
    };

    const stopNames = ["Avaniyapuram", "Jaihindpuram", "Palanganatham", "Alagappan Nagar", "Thirunagar", "Villapuram"];
    const locs = await MapLocation.find({ name: { $in: stopNames } }).lean();
    console.log("Found locations:", locs.map(l => `${l.name} (${l.latitude}, ${l.longitude})`));

    const stopMap = new Map();
    locs.forEach(l => stopMap.set(l.name, {
        name: l.name,
        latitude: l.latitude,
        longitude: l.longitude,
        userCount: l.name === "Villapuram" ? 11 : 9,
        passengerCount: l.name === "Villapuram" ? 11 : 9
    }));

    const bus2Stops = ["Avaniyapuram", "Jaihindpuram", "Palanganatham", "Alagappan Nagar", "Thirunagar"].map(n => stopMap.get(n));
    const villaStop = stopMap.get("Villapuram");

    const matrix = await buildGlobalOptimizationMatrix({
        depot: college,
        stops: [...bus2Stops, villaStop]
    });

    console.log("\n--- Testing Insertion of Villapuram at each position in Bus 2 ---");
    for (let pos = 0; pos <= bus2Stops.length; pos++) {
        const testStops = [...bus2Stops.slice(0, pos), villaStop, ...bus2Stops.slice(pos)];
        const seq = sequenceOutwardRouteStops({
            departureHub: college,
            stops: testStops,
            matrix,
            tripMode: "FROM_SOURCE"
        });

        console.log(`\nPosition ${pos}: ${seq.stops.map(s => s.name).join(" -> ")}`);
        console.log(`  Distance: ${seq.routeDistanceKm} km | Duration: ${seq.totalRouteDuration} min`);
        console.log(`  Max Pax Time: ${seq.longestPassengerTravelTime} min | All <= 60: ${seq.allPassengersWithin60}`);
        console.log(`  Detour Ratio: ${seq.qualityValidation?.detourRatio} | Reversals: ${seq.qualityValidation?.directionalReversals} | Backtracking: ${seq.qualityValidation?.backtrackingDistanceKm}`);
        console.log(`  Continuity Verified: ${seq.qualityValidation?.operationalContinuityVerified}`);
    }

    process.exit(0);
}

testMerge().catch(e => {
    console.error(e);
    process.exit(1);
});
