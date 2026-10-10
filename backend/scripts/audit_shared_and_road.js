import dotenv from 'dotenv';
dotenv.config();
import connectDB from '../config/db.js';
import { generateAgentRecommendations } from '../services/aiAgentService.js';

const klnce = {
  name: 'K. L. N. College of Engineering',
  address: 'Pottapalayam, Sivagangai / Madurai - 630612',
  latitude: 9.8515,
  longitude: 78.1882
};

async function auditSharedAndRoad() {
  await connectDB();

  console.log('=== AUDITING OUTWARD PLAN ===');
  const outRes = await generateAgentRecommendations({ tripMode: 'FROM_SOURCE', source: klnce });
  const outPlan = outRes.aiPlan;

  console.log('\n--- Outward Shared Stops ---');
  console.log(`Unique stopping areas: ${outPlan.uniqueStoppingAreas}`);
  console.log(`Total route stop visits: ${outPlan.totalRouteStopVisits}`);
  console.log(`Shared stop count: ${outPlan.sharedStopCount}`);
  console.log('Shared stopping areas list:', JSON.stringify(outPlan.sharedStoppingAreas, null, 2));

  console.log('\n--- Outward Road Validation ---');
  outPlan.buses.forEach(b => {
    console.log(`Bus ${b.vehicleName} (${b.routeCode}):`);
    console.log(`  isRoadVerified: ${b.isRoadVerified}`);
    console.log(`  isContinuous: ${b.isContinuous}`);
    console.log(`  routeDistanceKm: ${b.routeDistanceKm}`);
    console.log(`  routeDurationMin: ${b.routeDurationMin}`);
    console.log(`  stops count: ${b.stops.length}`);
    console.log(`  stops names: ${b.stops.map(s => s.name).join(' -> ')}`);
    console.log(`  roadRouteStatus: ${b.roadRouteStatus}`);
    console.log(`  roadValidation:`, b.roadValidation ? {
      isRoadVerified: b.roadValidation.isRoadVerified,
      allLegsValid: b.roadValidation.allLegsValid,
      segmentCount: b.roadValidation.segmentCount,
      failedSegments: b.roadValidation.failedSegments
    } : 'None');
  });

  console.log('\n=== AUDITING INWARD PLAN ===');
  const inRes = await generateAgentRecommendations({ tripMode: 'TO_DESTINATION', destination: klnce });
  const inPlan = inRes.aiPlan;

  console.log('\n--- Inward Shared Stops ---');
  console.log(`Unique stopping areas: ${inPlan.uniqueStoppingAreas}`);
  console.log(`Total route stop visits: ${inPlan.totalRouteStopVisits}`);
  console.log(`Shared stop count: ${inPlan.sharedStopCount}`);
  console.log('Shared stopping areas list:', JSON.stringify(inPlan.sharedStoppingAreas, null, 2));

  console.log('\n--- Inward Road Validation ---');
  inPlan.buses.forEach(b => {
    console.log(`Bus ${b.vehicleName} (${b.routeCode}):`);
    console.log(`  isRoadVerified: ${b.isRoadVerified}`);
    console.log(`  isContinuous: ${b.isContinuous}`);
    console.log(`  routeDistanceKm: ${b.routeDistanceKm}`);
    console.log(`  routeDurationMin: ${b.routeDurationMin}`);
    console.log(`  stops count: ${b.stops.length}`);
    console.log(`  stops names: ${b.stops.map(s => s.name).join(' -> ')}`);
    console.log(`  roadRouteStatus: ${b.roadRouteStatus}`);
    console.log(`  roadValidation:`, b.roadValidation ? {
      isRoadVerified: b.roadValidation.isRoadVerified,
      allLegsValid: b.roadValidation.allLegsValid,
      segmentCount: b.roadValidation.segmentCount,
      failedSegments: b.roadValidation.failedSegments
    } : 'None');
  });

  process.exit(0);
}

auditSharedAndRoad().catch(err => {
  console.error(err);
  process.exit(1);
});
