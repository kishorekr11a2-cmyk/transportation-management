import dotenv from "dotenv";
dotenv.config({ path: "./backend/.env" });
import mongoose from "mongoose";
import connectDB from "./backend/config/db.js";
import User from "./backend/models/User.js";
import AiPlan from "./backend/models/AiPlan.js";
import Route from "./backend/models/Route.js";
import Vehicle from "./backend/models/Vehicle.js";
import { getAuthoritativeRouteAllocations } from "./backend/controllers/routeController.js";
import { getActiveAIPlan } from "./backend/services/aiAgentService.js";

async function main() {
    await connectDB();
    console.log("Connected to DB");

    // 1. Vehicles
    const vehicles = await Vehicle.find().lean();
    console.log(`\n=== VEHICLES (${vehicles.length}) ===`);
    vehicles.forEach(v => {
        console.log(`- ${v.vehicleName || v.vehicleNumber} (ID: ${v._id}): capacity=${v.capacity}, status=${v.status}`);
    });

    // 2. Routes in DB
    const routes = await Route.find().populate("assignedVehicle", "vehicleName capacity").lean();
    console.log(`\n=== ROUTES (${routes.length}) ===`);
    routes.forEach(r => {
        console.log(`- "${r.routeName}" (ID: ${r._id}): dir=${r.direction}, vehicle=${r.assignedVehicle?.vehicleName || 'None'} (cap=${r.assignedVehicle?.capacity || r.capacity || 0}), stops=${r.stops?.length}, allocatedSeats=${r.allocatedSeats}`);
    });

    // 3. AiPlan documents
    const aiPlans = await AiPlan.find().lean();
    console.log(`\n=== AIPLAN DOCUMENTS (${aiPlans.length}) ===`);
    aiPlans.forEach(p => {
        console.log(`- Plan ${p._id}: type=${p.planType}, dir=${p.direction}, status=${p.status}, isSubmitted=${p.isSubmitted}, isApproved=${p.isApproved}, assignedUsers=${p.assignedUsers}, totalComingUsers=${p.totalComingUsers}, busesCount=${p.buses?.length}`);
        if (p.buses) {
            p.buses.forEach(b => {
                console.log(`    Bus: routeName=${b.routeName}, vehicleName=${b.vehicleName}, cap=${b.capacity}, assignedUsers=${b.assignedUsers}, usersArr=${b.users?.length}`);
            });
        }
    });

    // 4. ai_selected_plans collection
    const selectedPlans = await mongoose.connection.db.collection("ai_selected_plans").find({}).toArray();
    console.log(`\n=== AI_SELECTED_PLANS (${selectedPlans.length}) ===`);
    selectedPlans.forEach(p => {
        console.log(`- Plan ${p._id}: direction=${p.direction}, tripMode=${p.tripMode}, active=${p.active}, status=${p.status}, approved=${p.approved}, busesCount=${p.plan?.buses?.length || p.buses?.length}`);
        const buses = p.plan?.buses || p.buses || [];
        buses.forEach(b => {
            console.log(`    Bus: routeName=${b.routeName}, vehicleName=${b.vehicleName}, cap=${b.capacity}, assignedUsers=${b.assignedUsers}, usersArr=${b.users?.length}`);
        });
    });

    // 5. manual_plan_submissions collection
    const manualSubmissions = await mongoose.connection.db.collection("manual_plan_submissions").find({}).toArray();
    console.log(`\n=== MANUAL_PLAN_SUBMISSIONS (${manualSubmissions.length}) ===`);
    manualSubmissions.forEach(s => {
        console.log(`- Sub ${s._id}: dir=${s.direction}, isSubmitted=${s.isSubmitted}, status=${s.status}, busesCount=${s.buses?.length || s.plan?.buses?.length}`);
        const buses = s.buses || s.plan?.buses || [];
        buses.forEach(b => {
            console.log(`    Bus: routeName=${b.routeName}, vehicleName=${b.vehicleName}, cap=${b.capacity}, assignedUsers=${b.assignedUsers}, usersArr=${b.users?.length}`);
        });
    });

    // 6. Test getAuthoritativeRouteAllocations for both
    console.log(`\n=== AUTHORITATIVE ALLOCATIONS ===`);
    const outAlloc = await getAuthoritativeRouteAllocations("OUTWARD");
    console.log("OUTWARD hasPlan:", outAlloc.hasPlan, "allocationMap size:", outAlloc.allocationMap.size);
    for (const [k, v] of outAlloc.allocationMap.entries()) {
        console.log(`  key=${k} => assignedUsers=${v.assignedUsers}, cap=${v.capacity}, rem=${v.remainingSeats}, routeName=${v.routeName}, vehicleName=${v.vehicleName}`);
    }

    const inAlloc = await getAuthoritativeRouteAllocations("INWARD");
    console.log("INWARD hasPlan:", inAlloc.hasPlan, "allocationMap size:", inAlloc.allocationMap.size);
    for (const [k, v] of inAlloc.allocationMap.entries()) {
        console.log(`  key=${k} => assignedUsers=${v.assignedUsers}, cap=${v.capacity}, rem=${v.remainingSeats}, routeName=${v.routeName}, vehicleName=${v.vehicleName}`);
    }

    // 7. Test getActiveAIPlan
    console.log(`\n=== GET ACTIVE AI PLAN ===`);
    const activeOut = await getActiveAIPlan({ direction: "OUTWARD" });
    console.log("getActiveAIPlan OUTWARD:", {
        success: activeOut?.success,
        planType: activeOut?.plan?.planType,
        isApproved: activeOut?.plan?.isApproved,
        isSubmitted: activeOut?.plan?.isSubmitted,
        assignedUsers: activeOut?.plan?.assignedUsers,
        totalCapacity: activeOut?.plan?.totalCapacity,
        buses: activeOut?.plan?.buses?.length
    });

    const activeIn = await getActiveAIPlan({ direction: "INWARD" });
    console.log("getActiveAIPlan INWARD:", {
        success: activeIn?.success,
        planType: activeIn?.plan?.planType,
        isApproved: activeIn?.plan?.isApproved,
        isSubmitted: activeIn?.plan?.isSubmitted,
        assignedUsers: activeIn?.plan?.assignedUsers,
        totalCapacity: activeIn?.plan?.totalCapacity,
        buses: activeIn?.plan?.buses?.length
    });

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
