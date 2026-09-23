import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

async function inspectDb() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  await mongoose.connect(uri);
  
  const maplocs = await mongoose.connection.db.collection('maplocations').find({}).toArray();
  console.log('MapLocations count:', maplocs.length);
  console.log('MapLocations names:', maplocs.map(m => m.name || m.displayName));
  
  const users = await mongoose.connection.db.collection('users').find({}).toArray();
  const stopsFromUsers = new Set(users.map(u => u.stopName || u.stoppingPlace || u.assignedStop).filter(Boolean));
  console.log('Stops from users count:', stopsFromUsers.size);
  console.log('Stops from users:', Array.from(stopsFromUsers));

  const routes = await mongoose.connection.db.collection('routes').find({}).toArray();
  const stopsFromRoutes = new Set();
  routes.forEach(r => {
    if (r.source?.name) stopsFromRoutes.add(r.source.name);
    if (r.destination?.name) stopsFromRoutes.add(r.destination.name);
    if (Array.isArray(r.stops)) r.stops.forEach(s => stopsFromRoutes.add(typeof s === 'string' ? s : s.name));
  });
  console.log('Stops from routes:', Array.from(stopsFromRoutes));

  await mongoose.disconnect();
}

inspectDb().catch(e => { console.error(e); process.exit(1); });
