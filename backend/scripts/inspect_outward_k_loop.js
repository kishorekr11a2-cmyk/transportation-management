import dotenv from 'dotenv';
dotenv.config();
import connectDB from '../config/db.js';
import { getAIData, resolveStopCoordinates } from '../services/aiAgentService.js';
import { executeGlobalRouteOptimization } from '../services/routeOptimizationService.js';

async function main() {
    await connectDB();
    const aiData = await getAIData({ forceRefresh: true });
    const resolvedStops = await resolveStopCoordinates(aiData.stops);
    const availableVehicles = aiData.availableVehicles;
    const anchorHub = { name: "K.L.N. College of Engineering", latitude: 9.8324, longitude: 78.1884 };

    const globalOpt = await executeGlobalRouteOptimization({
        resolvedStops,
        anchorHub,
        availableVehicles,
        tripMode: 'FROM_SOURCE',
        options: {
            sourceHub: anchorHub,
            destinationHub: anchorHub
        }
    });

    console.log('--- executeGlobalRouteOptimization Summary ---');
    console.log('Routes count:', globalOpt.routes?.length);
    console.log('Assigned users:', globalOpt.routes?.reduce((s, r) => s + r.assignedUsers, 0));
    console.log('Unassigned routes count:', globalOpt.unassignedRoutes?.length);
    console.log('Unassigned routes pax:', globalOpt.unassignedRoutes?.reduce((s, r) => s + r.assignedUsers, 0));
    console.log('Fleet balancing:', JSON.stringify(globalOpt.fleetBalancing, null, 2));

    process.exit(0);
}

main().catch(console.error);
