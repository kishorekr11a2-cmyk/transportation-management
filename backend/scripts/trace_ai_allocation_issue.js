import dotenv from 'dotenv';
dotenv.config();
import connectDB from '../config/db.js';
import { getAIData, generateAgentRecommendations, buildAIPlan, getAvailableVehicles, resolveStopCoordinates } from '../services/aiAgentService.js';
import { executeGlobalRouteOptimization } from '../services/routeOptimizationService.js';

async function main() {
    await connectDB();
    console.log('--- 1. Getting AI Data ---');
    const aiData = await getAIData({ forceRefresh: true });
    console.log('Confirmed users:', aiData.confirmedUserCount);
    console.log('Available vehicles count:', aiData.availableVehicles.length);
    console.log('Available vehicles:', aiData.availableVehicles.map(v => ({ name: v.vehicleName, cap: v.capacity })));

    console.log('\n--- 2. Testing OUTWARD executeGlobalRouteOptimization ---');
    const resolvedStops = await resolveStopCoordinates(aiData.stops);
    console.log('Resolved stops count:', resolvedStops.length);
    const totalPax = resolvedStops.reduce((s, st) => s + (st.userIds?.length || st.userCount || 0), 0);
    console.log('Total pax in resolved stops:', totalPax);

    const outOpt = await executeGlobalRouteOptimization({
        resolvedStops,
        availableVehicles: aiData.availableVehicles,
        tripMode: 'FROM_SOURCE'
    });
    console.log('OUTWARD globalOpt routes count:', outOpt?.routes?.length);
    console.log('OUTWARD globalOpt assigned users:', outOpt?.routes?.reduce((s, r) => s + r.assignedUsers, 0));
    console.log('OUTWARD routes detail:');
    outOpt?.routes?.forEach(r => {
        console.log(`  Route ${r.routeId || r.routeCode}: bus=${r.vehicle?.vehicleName || r.vehicleName} cap=${r.vehicle?.capacity || r.capacity} pax=${r.assignedUsers} stops=${r.stops?.length}`);
    });

    console.log('\n--- 3. Testing INWARD executeGlobalRouteOptimization ---');
    const inOpt = await executeGlobalRouteOptimization({
        resolvedStops,
        availableVehicles: aiData.availableVehicles,
        tripMode: 'TO_DESTINATION'
    });
    console.log('INWARD globalOpt routes count:', inOpt?.routes?.length);
    console.log('INWARD globalOpt assigned users:', inOpt?.routes?.reduce((s, r) => s + r.assignedUsers, 0));
    console.log('INWARD routes detail:');
    inOpt?.routes?.forEach(r => {
        console.log(`  Route ${r.routeId || r.routeCode}: bus=${r.vehicle?.vehicleName || r.vehicleName} cap=${r.vehicle?.capacity || r.capacity} pax=${r.assignedUsers} stops=${r.stops?.length}`);
    });

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
