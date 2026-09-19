import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";
import { generateAgentRecommendations } from "../services/aiAgentService.js";

async function run() {
    await connectDB();
    const res = await generateAgentRecommendations({
        tripMode: "FROM_SOURCE",
        direction: "OUTWARD",
        source: {
            name: "KLN College of Engineering",
            address: "Pottapalayam, Sivagangai / Madurai - 630612",
            latitude: 9.8515,
            longitude: 78.1882
        }
    });

    console.log("Success:", res.success);
    if (!res.success) {
        console.error("Error:", res.message || res.errors);
        process.exit(1);
    }
    console.log("Coming Users:", res.summary?.comingUsers);
    console.log("Allocated Passengers:", res.summary?.allocatedPassengers);
    console.log("Unallocated Users:", res.summary?.unallocatedUsers);
    console.log("Number of Buses:", res.aiPlan?.buses?.length);

    res.aiPlan?.buses?.forEach((b, i) => {
        console.log(`\n======================================================`);
        console.log(`Route ${i + 1}: ${b.vehicleName} (${b.routeCode || b.routeNumber || "Outward Route"})`);
        console.log(`Corridor/Sector: ${b.sectorName || b.corridorName}`);
        console.log(`Vehicle Number: ${b.vehicleName}, Capacity: ${b.capacity}`);
        console.log(`Allocated Passengers: ${b.assignedUsers || b.allocatedSeats}, Remaining Seats: ${b.remainingSeats}`);
        console.log(`Total Distance: ${b.routeDistanceKm} km, Duration: ${b.routeDurationMin} mins`);
        console.log(`Continuous Status: ${b.isContinuous ? "Continuous" : "Discontinuous"}`);
        console.log(`OSRM Road Status: ${b.roadRouteStatus}`);
        console.log(`Road Geometry Points: ${b.roadGeometry?.length || 0}`);
        console.log(`Ordered Stopping Areas:`);
        console.log(`  KLN College of Engineering (Source Depot)`);
        (b.stops || []).forEach((s, sIdx) => {
            const drop = s.passengersDropped ?? s.userCount ?? 0;
            console.log(`    ↓`);
            console.log(`  ${s.name} [Drop: ${drop} passengers | Leg Dist: ${s.legDistanceKm} km | Leg Time: ${s.legDurationMin} mins]`);
        });
    });

    process.exit(0);
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
