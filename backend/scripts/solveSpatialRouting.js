import dotenv from "dotenv";
dotenv.config();
import { MADURAI_REGIONAL_GAZETTEER } from "../services/mapGeocodingService.js";
import { getRoadSegment } from "../services/roadMatrixService.js";

const hub = { id: "HUB_01", name: "K. L. N. College of Engineering", latitude: 9.8821, longitude: 78.1963 };

function getLoc(name) {
  const k = name.toLowerCase().trim();
  if (k === "viraganoor" || k === "viraganur") return { latitude: 9.88924, longitude: 78.15562, name };
  if (k === "kalavasal") return { latitude: 9.92837, longitude: 78.09941, name };
  if (k === "k.pudur" || k === "kpudur") return { ...MADURAI_REGIONAL_GAZETTEER["k pudur"], name };
  if (k === "k.k. nagar west" || k === "kk nagar west") return { ...MADURAI_REGIONAL_GAZETTEER["k k nagar west"], name };
  return { ...MADURAI_REGIONAL_GAZETTEER[k], name };
}

function haversineDist(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculateBearing(lat1, lon1, lat2, lon2) {
  const y = Math.sin((lon2 - lon1) * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
            Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos((lon2 - lon1) * Math.PI / 180);
  let brg = Math.atan2(y, x) * 180 / Math.PI;
  return (brg + 360) % 360;
}

function getCorridorLabel(bearing) {
  if (bearing >= 315 || bearing < 45) return "North";
  if (bearing >= 45 && bearing < 135) return "East";
  if (bearing >= 135 && bearing < 225) return "South";
  return "West";
}

const passengerCounts = {
  "Othakadai": 15, "Thiruppalai": 14, "Iyer Bungalow": 13, "Koodal Nagar": 12, "Vilangudi": 11,
  "Mattuthavani": 15, "K.Pudur": 13, "Bibikulam": 6, "Sellur": 7, "Arappalayam": 24,
  "Simmakkal": 22, "Goripalayam": 20, "Tallakulam": 21, "Narimedu": 7, "Anuppanadi": 8,
  "Vandiyur": 17, "KK Nagar": 19, "K.K. Nagar West": 18, "Periyar": 8, "Villapuram": 9,
  "Teppakulam": 16, "Anna Nagar": 27, "Viraganoor": 12, "Avaniyapuram": 9, "Jaihindpuram": 10,
  "Kochadai": 11, "Kalavasal": 10, "Palanganatham": 10, "Alagappan Nagar": 9, "Thirunagar": 7
};

const routes = [
  {
    routeId: "R-01",
    vehicleId: "BUS_01",
    vehicleName: "k1",
    capacity: 70,
    stops: ["Alagappan Nagar", "Palanganatham", "Jaihindpuram", "Periyar", "Kalavasal", "Kochadai", "Thirunagar"]
  },
  {
    routeId: "R-02",
    vehicleId: "BUS_06",
    vehicleName: "F",
    capacity: 45,
    stops: ["Avaniyapuram", "Villapuram"]
  },
  {
    routeId: "R-03",
    vehicleId: "BUS_02",
    vehicleName: "V1",
    capacity: 70,
    stops: ["K.Pudur", "Iyer Bungalow", "Thiruppalai", "Koodal Nagar", "Vilangudi", "Sellur"]
  },
  {
    routeId: "R-04",
    vehicleId: "BUS_03",
    vehicleName: "D1",
    capacity: 70,
    stops: ["Anuppanadi", "Simmakkal", "Arappalayam", "Narimedu", "Bibikulam"]
  },
  {
    routeId: "R-05",
    vehicleId: "BUS_04",
    vehicleName: "AS@",
    capacity: 70,
    stops: ["Viraganoor", "Goripalayam", "Tallakulam", "Mattuthavani"]
  },
  {
    routeId: "R-06",
    vehicleId: "BUS_07",
    vehicleName: "A2",
    capacity: 70,
    stops: ["Anna Nagar", "K.K. Nagar West", "KK Nagar"]
  },
  {
    routeId: "R-07",
    vehicleId: "BUS_05",
    vehicleName: "w1",
    capacity: 60,
    stops: ["Teppakulam", "Vandiyur", "Othakadai"]
  }
];

async function analyzeRoute(r) {
  const waypoints = [hub, ...r.stops.map(s => getLoc(s))];
  let totalRoadKm = 0;
  let totalDurMin = 0;
  const segments = [];
  let totalPax = 0;

  for (let i = 0; i < waypoints.length - 1; i++) {
    const from = waypoints[i];
    const to = waypoints[i + 1];
    const seg = await getRoadSegment(from, to);
    const hDist = haversineDist(from.latitude, from.longitude, to.latitude, to.longitude);
    const detour = hDist > 0 ? Number((seg.distanceKm / hDist).toFixed(2)) : 1.0;
    const brgFromHub = calculateBearing(hub.latitude, hub.longitude, to.latitude, to.longitude);
    const distFromHub = haversineDist(hub.latitude, hub.longitude, to.latitude, to.longitude);
    const pax = passengerCounts[to.name] || 0;
    totalPax += pax;
    totalRoadKm += seg.distanceKm;
    totalDurMin += seg.durationMin;

    segments.push({
      from: from.name,
      to: to.name,
      pax,
      roadKm: Number(seg.distanceKm.toFixed(2)),
      durMin: Number(seg.durationMin.toFixed(1)),
      haversineKm: Number(hDist.toFixed(2)),
      detourRatio: detour,
      detourCompliant: detour <= 1.4,
      bearingFromHub: Number(brgFromHub.toFixed(1)),
      distFromHubKm: Number(distFromHub.toFixed(2))
    });
  }

  const finalStop = waypoints[waypoints.length - 1];
  const terminalBearing = calculateBearing(hub.latitude, hub.longitude, finalStop.latitude, finalStop.longitude);
  const corridor = getCorridorLabel(terminalBearing);

  return {
    routeId: r.routeId,
    vehicleId: r.vehicleId,
    vehicleName: r.vehicleName,
    capacity: r.capacity,
    assignedPassengers: totalPax,
    utilization: Number(((totalPax / r.capacity) * 100).toFixed(1)),
    totalRoadKm: Number(totalRoadKm.toFixed(2)),
    totalDurMin: Number(totalDurMin.toFixed(1)),
    terminalStop: finalStop.name,
    terminalBearing: Number(terminalBearing.toFixed(1)),
    corridor,
    segments
  };
}

async function run() {
  console.log("Analyzing all routes against GIS spatial rules...");
  for (const r of routes) {
    const res = await analyzeRoute(r);
    console.log(`\n======================================================`);
    console.log(`ROUTE ${res.routeId} | Vehicle: ${res.vehicleName} (${res.capacity} seats) | Pax: ${res.assignedPassengers} (${res.utilization}% util)`);
    console.log(`Corridor: ${res.corridor} (Terminal Bearing: ${res.terminalBearing}° to ${res.terminalStop})`);
    console.log(`Total Road Distance: ${res.totalRoadKm} km | Duration: ${res.totalDurMin} mins`);
    console.log(`Segments:`);
    res.segments.forEach((s, idx) => {
      console.log(`  ${idx + 1}. ${s.from} -> ${s.to} [Pax: ${s.pax}] | Road: ${s.roadKm}km | Haversine: ${s.haversineKm}km | Detour: ${s.detourRatio}x (${s.detourCompliant ? '✓ PASS' : '⚠ HIGH'}) | Hub Brg: ${s.bearingFromHub}° | Hub Dist: ${s.distFromHubKm}km`);
    });
  }
  process.exit(0);
}

run().catch(console.error);
