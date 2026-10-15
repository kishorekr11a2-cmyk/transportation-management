import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";
import InwardStartingPlace from "../models/InwardStartingPlace.js";
import {
    getAIData,
    calculateStoppingGroups,
    resolveStopCoordinates,
    canonicalizeCollegeHub
} from "../services/aiAgentService.js";
import {
    buildGlobalOptimizationMatrix,
    generateGlobalCandidateRoutes
} from "../services/routeOptimizationService.js";

const klnce = {
    name: "K. L. N. College of Engineering",
    address: "Pottapalayam, Sivagangai / Madurai - 630612",
    latitude: 9.8515,
    longitude: 78.1882
};

async function main() {
    await connectDB();
    const data = await getAIData({ forceRefresh: true });
    const anchorHub = canonicalizeCollegeHub(klnce);
    const confirmedUsers = data.users.filter(u => u.travelStatus === "Coming");
    const rawStoppingGroups = calculateStoppingGroups(confirmedUsers);
    const stoppingGroups = await resolveStopCoordinates(rawStoppingGroups, anchorHub);
    const resolvedStops = stoppingGroups.filter(s => typeof s.latitude === "number" && typeof s.longitude === "number");
    const activeInwardStartingPlaces = await InwardStartingPlace.find({ active: true }).lean();

    const matrix = await buildGlobalOptimizationMatrix({
        depot: anchorHub,
        stops: resolvedStops,
        options: { destinationHub: anchorHub }
    });

    const fleetCaps = data.availableVehicles
        .map((v) => Number(v.capacity || v.seatCapacity || 0))
        .filter((c) => c > 0)
        .sort((a, b) => b - a);

    console.log("Calling generateGlobalCandidateRoutes for INWARD...");
    let candidateRoutes = generateGlobalCandidateRoutes({
        stops: resolvedStops,
        matrix,
        maxBusCapacity: fleetCaps[0],
        fleetCapacities: fleetCaps,
        tripMode: "TO_DESTINATION",
        options: {
            destinationHub: anchorHub,
            activeInwardStartingPlaces,
            availableVehicles: data.availableVehicles
        }
    });

    console.log("Candidate routes count:", candidateRoutes.length);
    let totalCandPax = 0;
    candidateRoutes.forEach((r, idx) => {
        console.log(`Cand ${idx + 1} (${r.vehicleName || 'no-bus'}): assignedUsers=${r.assignedUsers}, stops=${r.stops.map(s => `${s.name}(${s.passengerCount||s.userCount})`).join(", ")}`);
        totalCandPax += r.assignedUsers;
    });
    console.log("Total cand pax:", totalCandPax);

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
