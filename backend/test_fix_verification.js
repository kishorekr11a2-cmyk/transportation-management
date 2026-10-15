import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import connectDB from "./config/db.js";
import { getAuthoritativeRouteAllocations, invalidateRouteAllocationCache } from "./controllers/routeController.js";
import { getActiveAIPlan, clearActiveAIPlanCache } from "./services/aiAgentService.js";
import Route from "./models/Route.js";

async function main() {
    await connectDB();
    console.log("Connected to DB");

    clearActiveAIPlanCache();
    invalidateRouteAllocationCache();

    console.log("\n--- Checking getActiveAIPlan ---");
    const activeOut = await getActiveAIPlan({ direction: "OUTWARD", forceRefresh: true });
    console.log("OUTWARD Plan:", {
        success: activeOut.success,
        planType: activeOut.plan?.planType,
        isApproved: activeOut.plan?.isApproved,
        isSubmitted: activeOut.plan?.isSubmitted,
        assignedUsers: activeOut.plan?.assignedUsers,
        totalCapacity: activeOut.plan?.totalCapacity,
        busesCount: activeOut.plan?.buses?.length,
        busSummary: activeOut.plan?.buses?.map(b => `${b.routeName} (${b.vehicleName}): ${b.assignedUsers}/${b.capacity}`)
    });

    const activeIn = await getActiveAIPlan({ direction: "INWARD", forceRefresh: true });
    console.log("\nINWARD Plan:", {
        success: activeIn.success,
        planType: activeIn.plan?.planType,
        isApproved: activeIn.plan?.isApproved,
        isSubmitted: activeIn.plan?.isSubmitted,
        assignedUsers: activeIn.plan?.assignedUsers,
        totalCapacity: activeIn.plan?.totalCapacity,
        busesCount: activeIn.plan?.buses?.length
    });

    console.log("\n--- Checking getAuthoritativeRouteAllocations ---");
    const outAlloc = await getAuthoritativeRouteAllocations("OUTWARD");
    console.log("OUTWARD hasPlan:", outAlloc.hasPlan, "allocationMap keys:", Array.from(outAlloc.allocationMap.keys()));

    const inAlloc = await getAuthoritativeRouteAllocations("INWARD");
    console.log("INWARD hasPlan:", inAlloc.hasPlan, "allocationMap keys:", Array.from(inAlloc.allocationMap.keys()));

    console.log("\n--- Checking 9 Routes with Allocations ---");
    const routes = await Route.find().populate("assignedVehicle", "vehicleName capacity").lean();
    let sumOutwardAlloc = 0;
    let sumOutwardCap = 0;
    let sumInwardAlloc = 0;
    let sumInwardCap = 0;

    routes.forEach(r => {
        const routeId = String(r._id);
        const routeName = String(r.routeName || "").toLowerCase().trim();
        const vehicleId = String(r.assignedVehicle?._id || "");
        const vehicleName = String(r.assignedVehicle?.vehicleName || "").toLowerCase().trim();

        const outMatch = outAlloc.allocationMap.get(routeId) ||
            outAlloc.allocationMap.get(routeName) ||
            (vehicleId ? outAlloc.allocationMap.get(vehicleId) : null) ||
            (vehicleName ? outAlloc.allocationMap.get(vehicleName) : null);

        const inMatch = inAlloc.allocationMap.get(routeId) ||
            inAlloc.allocationMap.get(routeName) ||
            (vehicleId ? inAlloc.allocationMap.get(vehicleId) : null) ||
            (vehicleName ? inAlloc.allocationMap.get(vehicleName) : null);

        const cap = Number(r.assignedVehicle?.capacity || 0);
        const outAllocated = outMatch ? outMatch.assignedUsers : 0;
        const inAllocated = inMatch ? inMatch.assignedUsers : 0;
        const outRem = Math.max(0, cap - outAllocated);
        const inRem = Math.max(0, cap - inAllocated);

        sumOutwardAlloc += outAllocated;
        sumOutwardCap += cap;
        sumInwardAlloc += inAllocated;
        sumInwardCap += cap;

        console.log(`Route "${r.routeName}" (${r.assignedVehicle?.vehicleName}, cap ${cap}):`);
        console.log(`  OUTWARD: allocated=${outAllocated}, remaining=${outRem}, isFull=${outAlloc.hasPlan && cap > 0 && outAllocated >= cap}`);
        console.log(`  INWARD:  allocated=${inAllocated}, remaining=${inRem}, isFull=${inAlloc.hasPlan && cap > 0 && inAllocated >= cap}`);
    });

    console.log("\n=== TOTALS ===");
    console.log(`OUTWARD: ${sumOutwardAlloc} / ${sumOutwardCap} allocated, remaining: ${sumOutwardCap - sumOutwardAlloc}`);
    console.log(`INWARD:  ${sumInwardAlloc} / ${sumInwardCap} allocated, remaining: ${sumInwardCap - sumInwardAlloc}`);

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
