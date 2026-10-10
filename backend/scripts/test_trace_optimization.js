import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";
import User from "../models/User.js";
import Vehicle from "../models/Vehicle.js";
import {
    selectOutwardFleet,
    evaluateCandidateFleetFeasibility
} from "../services/routeOptimizationService.js";

async function main() {
    await connectDB();
    const users = await User.find({ travelStatus: "Coming" }).lean();
    const vehicles = await Vehicle.find({ isActive: { $ne: false } }).lean();
    console.log("Confirmed users:", users.length);
    console.log("Active vehicles:", vehicles.length);

    const sel = selectOutwardFleet({
        totalComingPassengers: users.length,
        availableVehicles: vehicles,
        oppositePlan: null
    });
    console.log("selectOutwardFleet (no oppPlan): minimumBusCount=", sel.minimumBusCount, "selectedBuses=", sel.selectedBuses.length, "cap=", sel.selectedCapacity);
    console.log("Selected bus names:", sel.selectedBuses.map(b => `${b.vehicleName}(${b.capacity})`).join(", "));

    // Opposite plan with 9 buses
    const oppPlan = {
        buses: vehicles.slice(0, 9).map(v => ({ vehicleName: v.vehicleName, capacity: v.capacity }))
    };
    const selWithOpp = selectOutwardFleet({
        totalComingPassengers: users.length,
        availableVehicles: vehicles,
        oppositePlan: oppPlan
    });
    console.log("selectOutwardFleet (with 9 opp): minimumBusCount=", selWithOpp.minimumBusCount, "selectedBuses=", selWithOpp.selectedBuses.length, "cap=", selWithOpp.selectedCapacity);

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
