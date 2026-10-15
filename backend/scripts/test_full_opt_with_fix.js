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

    console.log('Testing OUTWARD executeGlobalRouteOptimization...');
    const resultOutward = await executeGlobalRouteOptimization({
        resolvedStops,
        anchorHub,
        availableVehicles,
        tripMode: 'FROM_SOURCE',
        options: {
            sourceHub: anchorHub,
            destinationHub: anchorHub
        }
    });

    console.log('\n=== OUTWARD RESULTS ===');
    console.log('Routes count:', resultOutward.routes?.length);
    console.log('Assigned pax:', resultOutward.routes?.reduce((s, r) => s + r.assignedUsers, 0));
    console.log('Unassigned routes count:', resultOutward.unassignedRoutes?.length);
    console.log('Unassigned routes pax:', resultOutward.unassignedRoutes?.reduce((s, r) => s + (r.assignedUsers || 0), 0));
    console.log('Selected vehicles:', resultOutward.fleetBalancing?.selectedVehicleNames);
    console.log('Allocated bus count:', resultOutward.fleetBalancing?.allocatedBusCount);
    console.log('Theoretical minimum:', resultOutward.fleetBalancing?.theoreticalMinimum);
    console.log('Status:', resultOutward.fleetBalancing?.status);
    console.log('Decision reason:', resultOutward.fleetBalancing?.decisionReason);

    console.log('\nTesting INWARD executeGlobalRouteOptimization...');
    const resultInward = await executeGlobalRouteOptimization({
        resolvedStops,
        anchorHub,
        availableVehicles,
        tripMode: 'TO_DESTINATION',
        options: {
            sourceHub: anchorHub,
            destinationHub: anchorHub
        }
    });

    console.log('\n=== INWARD RESULTS ===');
    console.log('Routes count:', resultInward.routes?.length);
    console.log('Assigned pax:', resultInward.routes?.reduce((s, r) => s + r.assignedUsers, 0));
    console.log('Unassigned routes count:', resultInward.unassignedRoutes?.length);
    console.log('Selected vehicles:', resultInward.fleetBalancing?.selectedVehicleNames);
    console.log('Allocated bus count:', resultInward.fleetBalancing?.allocatedBusCount);
    console.log('Theoretical minimum:', resultInward.fleetBalancing?.theoreticalMinimum);
    console.log('Status:', resultInward.fleetBalancing?.status);

    process.exit(0);
}

main().catch(console.error);
