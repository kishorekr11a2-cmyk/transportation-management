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
import { executeGlobalRouteOptimization } from "../services/routeOptimizationService.js";

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

    const result = await executeGlobalRouteOptimization({
        resolvedStops,
        anchorHub,
        availableVehicles: data.availableVehicles,
        tripMode: "TO_DESTINATION",
        options: {
            destinationHub: anchorHub,
            activeInwardStartingPlaces
        }
    });

    console.log("Inward progressive evaluations:");
    console.log(JSON.stringify(result.fleetBalancing.candidateFleetEvaluations, null, 2));

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
