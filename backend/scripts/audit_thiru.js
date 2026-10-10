import dotenv from 'dotenv';
dotenv.config();
import connectDB from '../config/db.js';
import User from '../models/User.js';
import { generateAgentRecommendations } from '../services/aiAgentService.js';

async function check() {
  await connectDB();
  const thiruUsers = await User.find({
    travelStatus: 'Coming',
    stoppings: { $regex: /thiru|tiruparankundram/i }
  });
  console.log('Confirmed users matching thiru in DB:', thiruUsers.length);
  thiruUsers.forEach(u => console.log('User:', u._id, u.name, 'stoppings:', u.stoppings, 'assignedVehicle:', u.assignedVehicle));

  const sourceHub = {
    name: 'KLN College of Engineering',
    address: 'Pottapalayam, Sivagangai / Madurai - 630612',
    latitude: 9.8515,
    longitude: 78.1882
  };
  const res = await generateAgentRecommendations({ tripMode: 'OUTWARD', source: sourceHub });
  const plan = res.aiPlan || res.plan || res;
  
  // Find where thiruUsers are in plan.passengerAssignments or bus.users
  thiruUsers.forEach(u => {
    let assignedBus = null;
    let assignedStop = null;
    (plan.buses || []).forEach(b => {
      const foundInBus = (b.users || []).find(bu => String(bu._id || bu.id || bu) === String(u._id));
      if (foundInBus) assignedBus = b;
      (b.stops || []).forEach(s => {
        const foundInStop = (s.users || s.userIds || []).find(su => String(su._id || su.id || su) === String(u._id));
        if (foundInStop) assignedStop = { bus: b.vehicleName, stop: s.name };
      });
    });
    console.log('Passenger:', u.name, 'stoppings:', u.stoppings, '-> Assigned to Bus:', assignedBus?.vehicleName, 'stops in bus:', (assignedBus?.stops || []).map(s => s.name).join(', '), 'Assigned Stop:', assignedStop);
  });

  // Check all coming users
  const allComing = await User.find({ travelStatus: 'Coming' });
  console.log('\n--- Checking all coming users consistency ---');
  let missingStopCount = 0;
  const mismatches = [];
  allComing.forEach(u => {
    const bus = (plan.buses || []).find(b => (b.users || []).some(bu => String(bu._id || bu.id || bu) === String(u._id)));
    if (!bus) {
      console.log('User not in any bus:', u.name, u.stoppings);
    } else {
      const hasStopInBus = (bus.stops || []).some(s => s.name?.toLowerCase().trim() === u.stoppings?.toLowerCase().trim());
      if (!hasStopInBus) {
        missingStopCount++;
        mismatches.push({
          userName: u.name,
          userStop: u.stoppings,
          bus: bus.vehicleName,
          busStops: bus.stops.map(s => s.name)
        });
      }
    }
  });
  console.log(`Total mismatches where passenger's stoppings is missing from bus stops: ${missingStopCount} / ${allComing.length}`);
  if (mismatches.length > 0) {
    console.log('\nSample mismatches:');
    mismatches.slice(0, 15).forEach(m => {
      console.log(`User: ${m.userName} | Stop: "${m.userStop}" | Assigned Bus: ${m.bus} | Bus stops: [${m.busStops.join(', ')}]`);
    });
  }

  process.exit(0);
}
check().catch(err => {
  console.error(err);
  process.exit(1);
});
