import dotenv from 'dotenv';
dotenv.config();
import connectDB from '../config/db.js';
import User from '../models/User.js';
import { getConfirmedUsers, calculateStoppingGroups, resolveStopCoordinates, MADURAI_REGIONAL_STOPS } from '../services/aiAgentService.js';
import { executeGlobalRouteOptimization } from '../services/routeOptimizationService.js';

MADURAI_REGIONAL_STOPS['thiruparankundram'] = { latitude: 9.8820, longitude: 78.0720, displayName: 'Thiruparankundram, Madurai' };

async function trace() {
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
  const thiru = resolved.find(s => /thiruparankundram/i.test(s.name));
  console.log('Resolved thiru stop:', thiru ? { name: thiru.name, lat: thiru.latitude, lng: thiru.longitude, userCount: thiru.userCount } : 'NOT FOUND');

  const { getAvailableVehicles } = await import('../services/aiAgentService.js');
  const availableVehicles = await getAvailableVehicles();
  const InwardStartingPlace = (await import('../models/InwardStartingPlace.js')).default;
  const activePlaces = await InwardStartingPlace.find({ active: true }).lean();

  const opt = await executeGlobalRouteOptimization({
    resolvedStops: resolved,
    anchorHub: destHub,
    availableVehicles,
    tripMode: 'TO_DESTINATION',
    options: {
      destinationHub: destHub,
      activeInwardStartingPlaces: activePlaces,
      oppositePlan: null
    }
  });

  console.log('Opt routes count:', opt.routes?.length);
  (opt.routes || []).forEach(r => {
    const hasThiru = (r.stops || []).some(s => /thiruparankundram/i.test(s.name));
    console.log(`Route ${r.vehicleName || r.routeCode} (${r.assignedUsers} pax): stops=[${r.stops.map(s => s.name).join(', ')}] hasThiru=${hasThiru}`);
  });
  process.exit(0);
}
trace().catch(e => { console.error(e); process.exit(1); });
