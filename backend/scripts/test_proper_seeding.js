import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";
import AiPlan from "../models/AiPlan.js";
import InwardStartingPlace from "../models/InwardStartingPlace.js";
import mongoose from "mongoose";
import { getConfirmedUsers, calculateStoppingGroups, resolveStopCoordinates, isValidCoordinate, findStartingPlaceForBus } from "../services/aiAgentService.js";
import { buildGlobalOptimizationMatrix, sequenceInwardRouteStops } from "../services/routeOptimizationService.js";

async function main() {
    await connectDB();
    const destHub = {
        name: "KLN College of Engineering",
        address: "Pottapalayam, Sivagangai / Madurai - 630612",
        latitude: 9.8515,
        longitude: 78.1882
    };

    const rawUsers = await mongoose.connection.db.collection("users").find({}).toArray();
    const confirmed = getConfirmedUsers(rawUsers);
    const rawGroups = calculateStoppingGroups(confirmed);
    const resolvedStops = (await resolveStopCoordinates(rawGroups, destHub)).filter(s => isValidCoordinate(s.latitude, s.longitude));

    const latestOutwardDoc = await AiPlan.findOne({
        active: true,
        $or: [{ direction: "OUTWARD" }, { tripMode: "OUTWARD" }, { tripMode: "FROM_SOURCE" }]
    }).sort({ generatedAt: -1, createdAt: -1 }).lean();

    const oppositePlan = latestOutwardDoc?.aiPlan || latestOutwardDoc;
    const oppBuses = oppositePlan?.buses || [];
    const activeInwardStartingPlaces = await InwardStartingPlace.find({ active: true }).lean();

    const matrix = await buildGlobalOptimizationMatrix({
        depot: destHub,
        stops: resolvedStops,
        options: { destinationHub: destHub }
    });

    const stopMap = new Map();
    resolvedStops.forEach((st) => {
        const k = (st.name || st.stopping || "").toLowerCase().trim();
        stopMap.set(k, st);
    });

    console.log("=== SIMULATING PROPER SEEDING FROM OUTWARD PLAN ===");
    let grandTotalPax = 0;
    const seededRoutes = [];

    for (let bIdx = 0; bIdx < oppBuses.length; bIdx++) {
        const ob = oppBuses[bIdx];
        const vName = ob.vehicleName;
        const vId = ob.vehicleId;
        const assignedVeh = ob.vehicle || { vehicleName: vName, _id: vId, capacity: ob.capacity };
        const sp = findStartingPlaceForBus(assignedVeh, activeInwardStartingPlaces);

        const bStops = [];
        let bPax = 0;
        const bUserIds = [];

        for (const ost of (ob.stops || [])) {
            const k = (ost.name || ost.stopping || "").toLowerCase().trim();
            const matched = stopMap.get(k);
            if (!matched) {
                console.log(`Unmatched stop: ${ost.name}`);
                continue;
            }
            // Use outward bus's specific allocation for this stop!
            const pCount = Number(ost.passengerCount ?? ost.userCount ?? ost.userIds?.length ?? 0);
            const userIds = Array.isArray(ost.userIds) ? ost.userIds : [];
            bStops.push({
                ...matched,
                passengerCount: pCount,
                userCount: pCount,
                userIds
            });
            bPax += pCount;
            bUserIds.push(...userIds);
        }

        grandTotalPax += bPax;

        // Sequence using inward starting hub -> destination
        const seq = sequenceInwardRouteStops({
            startingHub: sp,
            destinationHub: destHub,
            stops: bStops,
            matrix,
            tripMode: "TO_DESTINATION"
        });

        seededRoutes.push({
            routeId: `cand_seed_${bIdx + 1}`,
            routeCode: ob.routeCode || `R-${String(bIdx + 1).padStart(2, "0")}`,
            vehicleId: vId,
            vehicleName: vName,
            vehicle: assignedVeh,
            capacity: ob.capacity,
            startingHub: sp,
            startLocation: sp,
            stops: seq.stops,
            assignedUsers: bPax,
            users: bUserIds,
            routeDistanceKm: seq.routeDistanceKm,
            quality: seq.qualityValidation
        });
    }

    console.log(`\nGrand Total Seeded Passengers: ${grandTotalPax} (expected: 421)`);
    seededRoutes.forEach((r, idx) => {
        console.log(`\nRoute ${idx + 1} (${r.vehicleName}): ${r.assignedUsers}/${r.capacity} seats, Starting: ${r.startingHub?.name || r.startingHub?.locationName}, Distance: ${r.routeDistanceKm} km`);
        console.log(`  Stops: ${r.stops.map(s => `${s.name} (${s.userCount}p)`).join(" -> ")}`);
        console.log(`  Reversals: ${r.quality?.directionalReversals}, Backtracking: ${r.quality?.backtrackingDistanceKm}km, Detour: ${r.quality?.detourRatio}x`);
    });

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
