import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";
import MapLocation from "../models/mapLocation.js";

const input = {
  hub: { id: "HUB_01", name: "K. L. N. College of Engineering", lat: 9.8821, lng: 78.1963 },
  vehicles: [
    { id: "BUS_01", name: "k1", capacity: 70 },
    { id: "BUS_02", name: "V1", capacity: 70 },
    { id: "BUS_03", name: "D1", capacity: 70 },
    { id: "BUS_04", name: "AS@", capacity: 70 },
    { id: "BUS_05", name: "w1", capacity: 60 },
    { id: "BUS_06", name: "F", capacity: 45 },
    { id: "BUS_07", name: "A2", capacity: 70 }
  ],
  passenger_drops: [
    { stop_name: "Othakadai", passenger_count: 15 },
    { stop_name: "Thiruppalai", passenger_count: 14 },
    { stop_name: "Iyer Bungalow", passenger_count: 13 },
    { stop_name: "Koodal Nagar", passenger_count: 12 },
    { stop_name: "Vilangudi", passenger_count: 11 },
    { stop_name: "Mattuthavani", passenger_count: 15 },
    { stop_name: "K.Pudur", passenger_count: 13 },
    { stop_name: "Bibikulam", passenger_count: 6 },
    { stop_name: "Sellur", passenger_count: 7 },
    { stop_name: "Arappalayam", passenger_count: 24 },
    { stop_name: "Simmakkal", passenger_count: 22 },
    { stop_name: "Goripalayam", passenger_count: 20 },
    { stop_name: "Tallakulam", passenger_count: 21 },
    { stop_name: "Narimedu", passenger_count: 7 },
    { stop_name: "Anuppanadi", passenger_count: 8 },
    { stop_name: "Vandiyur", passenger_count: 17 },
    { stop_name: "KK Nagar", passenger_count: 19 },
    { stop_name: "K.K. Nagar West", passenger_count: 18 },
    { stop_name: "Periyar", passenger_count: 8 },
    { stop_name: "Villapuram", passenger_count: 9 },
    { stop_name: "Teppakulam", passenger_count: 16 },
    { stop_name: "Anna Nagar", passenger_count: 27 },
    { stop_name: "Viraganoor", passenger_count: 12 },
    { stop_name: "Avaniyapuram", passenger_count: 9 },
    { stop_name: "Jaihindpuram", passenger_count: 10 },
    { stop_name: "Kochadai", passenger_count: 11 },
    { stop_name: "Kalavasal", passenger_count: 10 },
    { stop_name: "Palanganatham", passenger_count: 10 },
    { stop_name: "Alagappan Nagar", passenger_count: 9 },
    { stop_name: "Thirunagar", passenger_count: 7 }
  ]
};

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

import { MADURAI_REGIONAL_GAZETTEER } from "../services/mapGeocodingService.js";

async function run() {
  const hub = input.hub;
  const resolvedStops = [];

  for (const p of input.passenger_drops) {
    const key = p.stop_name.toLowerCase().trim();
    let loc = MADURAI_REGIONAL_GAZETTEER[key];
    if (!loc) {
      if (key === "viraganoor" || key === "viraganur") {
        loc = { latitude: 9.88924, longitude: 78.15562, displayName: "Viraganoor, Madurai, Tamil Nadu" };
      } else if (key === "kalavasal") {
        loc = { latitude: 9.92837, longitude: 78.09941, displayName: "Kalavasal, Madurai, Tamil Nadu" };
      } else if (key === "k.pudur" || key === "kpudur") {
        loc = MADURAI_REGIONAL_GAZETTEER["k pudur"];
      } else if (key === "k.k. nagar west" || key === "kk nagar west") {
        loc = MADURAI_REGIONAL_GAZETTEER["k k nagar west"];
      }
    }
    if (!loc) {
      console.log('Location not found in GAZETTEER:', p.stop_name);
      continue;
    }
    const brg = calculateBearing(hub.lat, hub.lng, loc.latitude, loc.longitude);
    const dist = haversineDist(hub.lat, hub.lng, loc.latitude, loc.longitude);
    resolvedStops.push({
      name: p.stop_name,
      lat: loc.latitude,
      lng: loc.longitude,
      passenger_count: p.passenger_count,
      bearing: Number(brg.toFixed(1)),
      distFromHubKm: Number(dist.toFixed(2)),
      cardinal: getCorridorLabel(brg)
    });
  }

  // Sort by bearing and distance
  resolvedStops.sort((a, b) => a.bearing - b.bearing || a.distFromHubKm - b.distFromHubKm);
  console.log("Resolved 30 stops:");
  resolvedStops.forEach(s => {
    console.log(`${s.name.padEnd(16)} | Brg: ${s.bearing.toString().padStart(5)}° | Dist: ${s.distFromHubKm.toString().padStart(5)} km | Cardinal: ${s.cardinal.padEnd(5)} | Passengers: ${s.passenger_count}`);
  });

  process.exit(0);
}

run().catch(console.error);
