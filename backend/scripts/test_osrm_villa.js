import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import dotenv from "dotenv";
dotenv.config({ path: path.join(__dirname, "../.env") });
import connectDB from "../config/db.js";
import { getRoadRouteGeometry } from "../services/roadMatrixService.js";
import MapLocation from "../models/mapLocation.js";

async function run() {
    await connectDB();
    const names = ['K. L. N. College of Engineering', 'Avaniyapuram', 'Villapuram', 'Jaihindpuram', 'Palanganatham', 'Alagappan Nagar', 'Thirunagar'];
    const locs = await MapLocation.find({ name: { $in: names } }).lean();
    const map = new Map(locs.map(l => [l.name, l]));
    const college = { latitude: 9.8515, longitude: 78.1882 };

    const pts1 = [college, map.get('Avaniyapuram'), map.get('Villapuram'), map.get('Jaihindpuram'), map.get('Palanganatham'), map.get('Alagappan Nagar'), map.get('Thirunagar')];
    const r1 = await getRoadRouteGeometry(pts1);
    console.log('Order 1 (College -> Avaniyapuram -> Villapuram -> Jaihindpuram -> Palanganatham -> Alagappan Nagar -> Thirunagar):');
    console.log(r1 ? `  ${r1.distanceKm} km, ${r1.durationMin} min` : '  FAILED');

    const pts2 = [college, map.get('Villapuram'), map.get('Avaniyapuram'), map.get('Jaihindpuram'), map.get('Palanganatham'), map.get('Alagappan Nagar'), map.get('Thirunagar')];
    const r2 = await getRoadRouteGeometry(pts2);
    console.log('Order 2 (College -> Villapuram -> Avaniyapuram -> Jaihindpuram -> Palanganatham -> Alagappan Nagar -> Thirunagar):');
    console.log(r2 ? `  ${r2.distanceKm} km, ${r2.durationMin} min` : '  FAILED');

    process.exit(0);
}

run().catch(e => {
    console.error(e);
    process.exit(1);
});
