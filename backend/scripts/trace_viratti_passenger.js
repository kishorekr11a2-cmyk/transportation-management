import dotenv from 'dotenv';
dotenv.config();
import connectDB from '../config/db.js';
import User from '../models/User.js';

async function check() {
  await connectDB();
  const allUsers = await User.find({ travelStatus: 'Coming' });
  const virUsers = allUsers.filter(u => /virattipathu/i.test(u.stoppings));
  console.log('Virattipathu users:');
  virUsers.forEach(u => console.log(JSON.stringify({
    id: u._id,
    userId: u.userId,
    name: u.name,
    stoppings: u.stoppings,
    travelStatus: u.travelStatus,
    assignedVehicle: u.assignedVehicle,
    assignedStop: u.assignedStop
  }, null, 2)));

  const kochUsers = allUsers.filter(u => /kochadai/i.test(u.stoppings));
  console.log(`Kochadai users (${kochUsers.length}):`);
  kochUsers.forEach(u => console.log(`  ${u.name} (id: ${u._id}) -> ${u.stoppings}, veh: ${u.assignedVehicle}`));

  process.exit(0);
}

check().catch(console.error);
