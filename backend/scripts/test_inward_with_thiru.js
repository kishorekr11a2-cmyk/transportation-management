import dotenv from 'dotenv';
dotenv.config();
import connectDB from '../config/db.js';
import { generateAgentRecommendations, MADURAI_REGIONAL_STOPS } from '../services/aiAgentService.js';

MADURAI_REGIONAL_STOPS['thiruparankundram'] = { latitude: 9.8820, longitude: 78.0720, displayName: 'Thiruparankundram, Madurai' };

async function test() {
  await connectDB();
  const destHub = {
    name: 'KLN College of Engineering',
    address: 'Pottapalayam, Sivagangai / Madurai - 630612',
    latitude: 9.8515,
    longitude: 78.1882
  };
  const res = await generateAgentRecommendations({ tripMode: 'INWARD', destination: destHub });
  console.log('Success:', res.success);
  console.log('Code:', res.code);
  const plan = res.aiPlan || res.plan || res;
  console.log('Certification:', plan.certification);
  (plan.buses || []).forEach(b => {
    console.log(`Bus ${b.vehicleName} [${b.assignedUsers}/${b.capacity}]: ${b.stops.map(s => s.name + ' (' + s.userCount + ')').join(' -> ')} | Detour=${b.detourRatio} | Continuous=${b.isContinuous}`);
  });
  process.exit(0);
}
test().catch(err => { console.error(err); process.exit(1); });
