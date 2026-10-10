import dotenv from 'dotenv';
dotenv.config();
import connectDB from '../config/db.js';
import User from '../models/User.js';
import { generateAgentRecommendations } from '../services/aiAgentService.js';

async function audit() {
  await connectDB();

  console.log('--- 1. AUDITING KOCHADAI & VIRATTIPATHU PASSENGERS ---');
  const kvUsers = await User.find({
    travelStatus: 'Coming',
    stoppings: { $regex: new RegExp('kochadai|virattipathu', 'i') }
  });
  console.log(`Found ${kvUsers.length} passengers matching kochadai/virattipathu:`);
  kvUsers.forEach(u => console.log(`  Passenger: "${u.name}" | Stop: "${u.stoppings}" | AssignedVehicle: "${u.assignedVehicle}"`));

  console.log('\n--- 2. ALL CONFIRMED PASSENGERS DEMAND BY STOP ---');
  const allComing = await User.find({ travelStatus: 'Coming' });
  console.log(`Total confirmed Coming passengers: ${allComing.length}`);
  const stopDemand = {};
  allComing.forEach(u => {
    const s = (u.stoppings || 'Unknown').trim();
    stopDemand[s] = (stopDemand[s] || 0) + 1;
  });
  console.log('Stop demand counts:', stopDemand);

  const klnce = {
    name: 'K. L. N. College of Engineering',
    address: 'Pottapalayam, Sivagangai / Madurai - 630612',
    latitude: 9.8515,
    longitude: 78.1882
  };

  console.log('\n--- 3. AUDITING OUTWARD PLAN GENERATION ---');
  const outwardRes = await generateAgentRecommendations({ tripMode: 'FROM_SOURCE', source: klnce });
  const outPlan = outwardRes.aiPlan;
  
  console.log('Outward buses:');
  outPlan.buses.forEach(b => {
    console.log(`  Bus ${b.vehicleName} (${b.routeCode}) [${b.assignedUsers}/${b.capacity}]:`);
    b.stops.forEach(s => {
      console.log(`    - Stop "${s.name}": userCount=${s.userCount}, usersLength=${(s.userIds || []).length}, cumulative=${s.cumulativePassengers}, remaining=${s.passengersRemaining}`);
    });
  });

  // Check stops with 0 passengers in Outward
  const outEmptyStops = [];
  outPlan.buses.forEach(b => {
    b.stops.forEach(s => {
      if ((s.userCount || 0) === 0) {
        outEmptyStops.push({ bus: b.vehicleName, stop: s.name });
      }
    });
  });
  console.log(`Outward stops with 0 passengers: ${outEmptyStops.length}`, outEmptyStops);

  console.log('\n--- 4. AUDITING INWARD PLAN GENERATION ---');
  const inwardRes = await generateAgentRecommendations({ tripMode: 'TO_DESTINATION', destination: klnce });
  const inPlan = inwardRes.aiPlan;

  console.log('Inward buses:');
  inPlan.buses.forEach(b => {
    console.log(`  Bus ${b.vehicleName} (${b.routeCode}) [${b.assignedUsers}/${b.capacity}]:`);
    b.stops.forEach(s => {
      console.log(`    - Stop "${s.name}": userCount=${s.userCount}, usersLength=${(s.userIds || []).length}, cumulative=${s.cumulativePassengers}, remaining=${s.passengersRemaining}`);
    });
  });

  // Check stops with 0 passengers in Inward
  const inEmptyStops = [];
  inPlan.buses.forEach(b => {
    b.stops.forEach(s => {
      if ((s.userCount || 0) === 0) {
        inEmptyStops.push({ bus: b.vehicleName, stop: s.name });
      }
    });
  });
  console.log(`Inward stops with 0 passengers: ${inEmptyStops.length}`, inEmptyStops);

  console.log('\n--- 5. CHECKING PASSENGER-TO-ROUTE COVERAGE FOR BOTH DIRECTIONS ---');
  ['OUTWARD', 'INWARD'].forEach(dir => {
    const plan = dir === 'OUTWARD' ? outPlan : inPlan;
    let missingStopPax = [];
    allComing.forEach(u => {
      const bus = plan.buses.find(b => (b.users || []).some(bu => String(bu._id || bu.id || bu) === String(u._id)));
      if (!bus) {
        missingStopPax.push({ user: u.name, stop: u.stoppings, reason: 'NOT_ASSIGNED_TO_ANY_BUS' });
      } else {
        const uStop = (u.stoppings || '').toLowerCase().trim();
        const hasStop = (bus.stops || []).some(s => {
          const sName = (s.name || '').toLowerCase().trim();
          if (sName === uStop) return true;
          if (Array.isArray(s.representedStops) && s.representedStops.some(rs => rs.toLowerCase().trim() === uStop)) return true;
          if (Array.isArray(s.originalStopNames) && s.originalStopNames.some(rs => rs.toLowerCase().trim() === uStop)) return true;
          return false;
        });
        if (!hasStop) {
          missingStopPax.push({ user: u.name, stop: u.stoppings, bus: b.vehicleName, reason: 'STOP_NOT_ON_BUS' });
        }
      }
    });
    console.log(`Direction ${dir}: ${missingStopPax.length} passengers missing from route.`);
  });

  process.exit(0);
}

audit().catch(err => {
  console.error(err);
  process.exit(1);
});
