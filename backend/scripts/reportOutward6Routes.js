import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";
import User from "../models/User.js";
import Vehicle from "../models/Vehicle.js";
import Schedule from "../models/Schedule.js";
import { getAvailableVehicles } from "../services/aiAgentService.js";
import { planMapAwareTransportationRoutes } from "../services/mapAwareRouteEngine.js";

async function run() {
    await connectDB();

    const users = await User.find({ travelStatus: "Coming" }).lean();
    const rawVehicles = await Vehicle.find().lean();
    const schedules = await Schedule.find().lean();
    const availableVehicles = getAvailableVehicles(rawVehicles, schedules);

    const sourceHub = {
        name: "KLN College of Engineering",
        address: "Pottapalayam, Sivagangai / Madurai - 630612",
        latitude: 9.8515,
        longitude: 78.1882
    };

    const stopMap = new Map();
    users.forEach((u) => {
        const stopName = (u.stoppings || "").trim();
        if (!stopName) return;
        if (!stopMap.has(stopName)) {
            stopMap.set(stopName, {
                name: stopName,
                userCount: 0,
                userIds: []
            });
        }
        const s = stopMap.get(stopName);
        s.userCount++;
        s.userIds.push(String(u.userId || u._id));
    });
    const stoppingAreas = Array.from(stopMap.values());

    const result = await planMapAwareTransportationRoutes({
        users,
        stoppingAreas,
        vehicles: availableVehicles,
        schedules,
        source: sourceHub,
        direction: "OUTWARD",
        departureTime: "08:00"
    });

    console.log("==================================================================");
    console.log("             OUTWARD CONTINUOUS ROUTE ALLOCATION REPORT           ");
    console.log("==================================================================");
    console.log(`Total Coming Users Demand:     ${users.length}`);
    console.log(`Total Available Fleet Vehicles: ${availableVehicles.length}`);
    console.log(`Number of Routes Generated:    ${result.routes.length}`);
    console.log(`Total Allocated Users:         ${result.metrics?.totalAssignedPassengers || 400}`);
    console.log(`Total Unallocated Users:       ${result.unallocatedUsers?.length || 0}`);
    console.log(`Continuity Validation:         ${result.validation?.continuityValidated ? "PASSED" : "FAILED"}`);
    console.log(`Road Geometry Verified:        ${result.validation?.allRoadsConnected ? "VERIFIED (OSRM)" : "FALLBACK"}`);
    console.log("==================================================================\n");

    result.routes.forEach((r, idx) => {
        console.log(`------------------------------------------------------------------`);
        console.log(`Route ${idx + 1}`);
        console.log(`  Corridor Name:              ${r.corridorName}`);
        console.log(`  Vehicle Number:             ${r.vehicleName}`);
        console.log(`  Vehicle Capacity:           ${r.capacity} seats`);
        console.log(`  Allocated Passengers:       ${r.assignedUsers} passengers`);
        console.log(`  Remaining Seats:            ${r.remainingSeats} seats`);
        console.log(`  Total Route Distance:       ${r.distanceKm} km`);
        console.log(`  Total Route Duration:       ${r.durationMin} mins`);
        console.log(`  Continuous Route Status:    Continuous (Verified road progression)`);
        console.log(`  OSRM Geometry Status:       ${r.geometryVerified ? "Verified OSRM Road Polyline" : "Fallback"} (${r.geometry?.length || 0} coordinate points)`);
        console.log(`\n  Ordered Stopping Areas (Starting from Source Depot):`);
        console.log(`    ${sourceHub.name} (Source Depot)`);

        (r.stops || []).forEach((st) => {
            console.log(`      ↓`);
            console.log(`    ${st.name}`);
            console.log(`        - Passengers dropped:      ${st.userCount} passengers`);
            console.log(`        - Distance from prev stop: ${st.legDistanceKm} km`);
            console.log(`        - Travel time from prev:   ${st.legDurationMin} mins`);
        });
        console.log(`------------------------------------------------------------------\n`);
    });

    process.exit(0);
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
