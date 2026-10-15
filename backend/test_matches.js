import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import connectDB from "./config/db.js";
import { getAuthoritativeRouteAllocations } from "./controllers/routeController.js";
import Route from "./models/Route.js";

async function main() {
    await connectDB();
    console.log("Connected to DB");

    const outAlloc = await getAuthoritativeRouteAllocations("OUTWARD");
    console.log("OUTWARD hasPlan:", outAlloc.hasPlan);
    console.log("AllocationMap keys:", Array.from(outAlloc.allocationMap.keys()));

    const inAlloc = await getAuthoritativeRouteAllocations("INWARD");
    console.log("INWARD hasPlan:", inAlloc.hasPlan);
    console.log("AllocationMap keys:", Array.from(inAlloc.allocationMap.keys()));

    // Let's check routes
    const routes = await Route.find().populate("assignedVehicle", "vehicleName capacity").lean();
    console.log("\nRoutes check against outAlloc:");
    routes.forEach(r => {
        const routeId = String(r._id);
        const routeName = String(r.routeName || "").toLowerCase().trim();
        const vehicleId = String(r.assignedVehicle?._id || "");
        const vehicleName = String(r.assignedVehicle?.vehicleName || "").toLowerCase().trim();

        const matchId = outAlloc.allocationMap.get(routeId);
        const matchName = outAlloc.allocationMap.get(routeName);
        const matchVehId = outAlloc.allocationMap.get(vehicleId);
        const matchVehName = outAlloc.allocationMap.get(vehicleName);

        console.log(`Route "${r.routeName}" (id: ${routeId}, veh: ${vehicleName}, cap: ${r.assignedVehicle?.capacity}):`);
        console.log(`  matchId:`, matchId);
        console.log(`  matchName:`, matchName);
        console.log(`  matchVehId:`, matchVehId);
        console.log(`  matchVehName:`, matchVehName);
    });

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
