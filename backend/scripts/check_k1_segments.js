import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";
import { buildConsecutiveSegmentRoadGeometry } from "../services/roadMatrixService.js";

async function testK1() {
    await connectDB();
    const waypoints = [
        { name: "KLN College of Engineering", latitude: 9.8515, longitude: 78.1882 },
        { name: "Vandiyur", latitude: 9.92, longitude: 78.165 },
        { name: "K.K. Nagar West", latitude: 9.925, longitude: 78.146 },
        { name: "Narimedu", latitude: 9.938, longitude: 78.132 },
        { name: "Sellur", latitude: 9.941, longitude: 78.118 },
        { name: "Vilangudi", latitude: 9.951, longitude: 78.092 },
        { name: "Koodal Nagar", latitude: 9.967663, longitude: 78.096438 }
    ];

    console.log("Testing consecutive segments for k1...");
    const res = await buildConsecutiveSegmentRoadGeometry(waypoints, { useOnlineOsrm: true });
    console.log("Distance:", res?.distanceKm, "Duration:", res?.durationMin);
    console.log("Legs count:", res?.legs?.length);
    res?.legs?.forEach((l, idx) => {
        console.log(`Leg ${idx+1}: ${waypoints[idx].name} -> ${waypoints[idx+1].name}: ${l.distanceKm} km, ${l.durationMin} min (failed: ${l.failed})`);
    });

    process.exit(0);
}

testK1().catch(e => {
    console.error(e);
    process.exit(1);
});
