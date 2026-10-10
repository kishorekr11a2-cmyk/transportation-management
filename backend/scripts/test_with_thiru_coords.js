import dotenv from 'dotenv';
dotenv.config();
import connectDB from '../config/db.js';
import User from '../models/User.js';
import { generateAgentRecommendations, MADURAI_REGIONAL_STOPS } from '../services/aiAgentService.js';

MADURAI_REGIONAL_STOPS['thiruparankundram'] = { latitude: 9.8820, longitude: 78.0720, displayName: 'Thiruparankundram, Madurai' };

async function test() {
  await connectDB();
  const sourceHub = {
    name: 'KLN College of Engineering',
    address: 'Pottapalayam, Sivagangai / Madurai - 630612',
    latitude: 9.8515,
    longitude: 78.1882
  };
  const res = await generateAgentRecommendations({ tripMode: 'OUTWARD', source: sourceHub });
  console.log('Success:', res.success);
  console.log('Code:', res.code);
  console.log('Message:', res.message);
  const plan = res.aiPlan || res.plan || res;
  console.log('Buses count:', plan.buses?.length);
  (plan.buses || []).forEach(b => {
    console.log(`Bus ${b.vehicleName} [${b.assignedUsers}/${b.capacity}]: ${b.stops.map(s => s.name + ' (' + s.userCount + ')').join(' -> ')}`);
  });
  
  const u = await User.findOne({ name: 'I AM' });
  const busWithU = (plan.buses || []).find(b => (b.users || []).some(bu => String(bu._id || bu.id || bu) === String(u._id)));
  console.log('\nUser I AM assigned bus:', busWithU?.vehicleName);
  const stopWithU = (busWithU?.stops || []).find(s => (s.users || s.userIds || []).some(su => String(su._id || su.id || su) === String(u._id)));
  console.log('User I AM assigned stop:', stopWithU?.name);
  process.exit(0);
}
test().catch(err => { console.error(err); process.exit(1); });
