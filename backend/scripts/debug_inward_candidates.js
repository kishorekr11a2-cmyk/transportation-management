import dotenv from 'dotenv';
dotenv.config();
import connectDB from '../config/db.js';
import User from '../models/User.js';
import AiPlan from '../models/AiPlan.js';
import { getConfirmedUsers, calculateStoppingGroups, resolveStopCoordinates, MADURAI_REGIONAL_STOPS, getAvailableVehicles } from '../services/aiAgentService.js';
import InwardStartingPlace from '../models/InwardStartingPlace.js';
import { buildGlobalOptimizationMatrix } from '../services/routeOptimizationService.js';

MADURAI_REGIONAL_STOPS['thiruparankundram'] = { latitude: 9.8820, longitude: 78.0720, displayName: 'Thiruparankundram, Madurai' };

async function debugInward() {
  await connectDB();
  const allUsers = await User.find({ travelStatus: 'Coming' }).lean();
  const rawGroups = calculateStoppingGroups(allUsers);
  const destHub = {
    name: 'KLN College of Engineering',
    address: 'Pottapalayam, Sivagangai / Madurai - 630612',
    latitude: 9.8515,
    longitude: 78.1882
  };
  const resolved = await resolveStopCoordinates(rawGroups, destHub);
  const availableVehicles = await getAvailableVehicles();
  const activePlaces = await InwardStartingPlace.find({ active: true }).lean();
  const latestOutward = await AiPlan.findOne({
    active: true,
    $or: [{ direction: 'OUTWARD' }, { tripMode: 'OUTWARD' }, { tripMode: 'FROM_SOURCE' }]
  }).sort({ generatedAt: -1 }).lean();
  const oppositePlan = latestOutward?.aiPlan || null;

  console.log('OppositePlan buses count:', oppositePlan?.buses?.length);
  (oppositePlan?.buses || []).forEach(b => {
    console.log(`Opp bus ${b.vehicleName}: ${b.stops.map(s => s.name).join(' -> ')}`);
  });

  const matrix = await buildGlobalOptimizationMatrix({ depot: destHub, stops: resolved, options: {} });
  const { generateGlobalCandidateRoutes } = await import('../services/routeOptimizationService.js');
  const candidates = generateGlobalCandidateRoutes({
    stops: resolved,
    matrix,
    maxBusCapacity: 70,
    fleetCapacities: [65, 60, 55, 55, 50, 50, 50, 50, 50],
    tripMode: 'TO_DESTINATION',
    options: {
      destinationHub: destHub,
      activeInwardStartingPlaces: activePlaces,
      oppositePlan,
      availableVehicles
    }
  });

  console.log('\nGenerated Candidates count:', candidates.length);
  candidates.forEach(c => {
    const hasThiru = c.stops.some(s => /thiruparankundram/i.test(s.name));
    console.log(`Candidate ${c.routeCode || c.vehicleName} (${c.assignedUsers} pax): stops=[${c.stops.map(s => s.name).join(', ')}] hasThiru=${hasThiru}`);
  });

  process.exit(0);
}
debugInward().catch(e => { console.error(e); process.exit(1); });
