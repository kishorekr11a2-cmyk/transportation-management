import dotenv from "dotenv";
dotenv.config();
import { MADURAI_REGIONAL_GAZETTEER } from "../services/mapGeocodingService.js";
import { fetchPairwiseRoadSegment, buildConsecutiveSegmentRoadGeometry } from "../services/roadMatrixService.js";

const hub = { id: "HUB_01", name: "K. L. N. College of Engineering", latitude: 9.8821, longitude: 78.1963 };

const stopsData = {
  "Othakadai": 15,
  "Thiruppalai": 14,
  "Iyer Bungalow": 13,
  "Koodal Nagar": 12,
  "Vilangudi": 11,
  "Mattuthavani": 15,
  "K.Pudur": 13,
  "Bibikulam": 6,
  "Sellur": 7,
  "Arappalayam": 24,
  "Simmakkal": 22,
  "Goripalayam": 20,
  "Tallakulam": 21,
  "Narimedu": 7,
  "Anuppanadi": 8,
  "Vandiyur": 17,
  "KK Nagar": 19,
  "K.K. Nagar West": 18,
  "Periyar": 8,
  "Villapuram": 9,
  "Teppakulam": 16,
  "Anna Nagar": 27,
  "Viraganoor": 12,
  "Avaniyapuram": 9,
  "Jaihindpuram": 10,
  "Kochadai": 11,
  "Kalavasal": 10,
  "Palanganatham": 10,
  "Alagappan Nagar": 9,
  "Thirunagar": 7
};

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

// 6 Consolidated Routes:
const plannedRoutes = [
  {
    routeId: "R-01",
    vehicleId: "BUS_01",
    vehicleName: "k1",
    capacity: 70,
    stops: ["Avaniyapuram", "Villapuram", "Jaihindpuram", "Palanganatham", "Alagappan Nagar", "Kalavasal", "Thirunagar"]
  },
  {
    routeId: "R-02",
    vehicleId: "BUS_02",
    vehicleName: "V1",
    capacity: 70,
    stops: ["K.Pudur", "Iyer Bungalow", "Thiruppalai", "Koodal Nagar", "Vilangudi", "Sellur"]
  },
  {
    routeId: "R-03",
    vehicleId: "BUS_03",
    vehicleName: "D1",
    capacity: 70,
    stops: ["Anuppanadi", "Periyar", "Arappalayam", "Kochadai"]
  },
  {
    routeId: "R-04",
    vehicleId: "BUS_04",
    vehicleName: "AS@",
    capacity: 70,
    stops: ["Simmakkal", "Goripalayam", "Tallakulam", "Narimedu"]
  },
  {
    routeId: "R-05",
    vehicleId: "BUS_07",
    vehicleName: "A2",
    capacity: 70,
    stops: ["Anna Nagar", "K.K. Nagar West", "KK Nagar", "Bibikulam"]
  },
  {
    routeId: "R-06",
    vehicleId: "BUS_05",
    vehicleName: "w1",
    capacity: 60,
    stops: ["Viraganoor", "Teppakulam", "Vandiyur", "Mattuthavani", "Othakadai"]
  }
];

// Let's verify stop counts:
// R-01: 9 + 9 + 10 + 10 + 9 + 10 + 7 = 64 pax (capacity 70)
// R-02: 13 + 13 + 14 + 12 + 11 + 7 = 70 pax (capacity 70)
// R-03: 8 + 8 + 24 + 11 = 51 pax (capacity 70)
// R-04: 22 + 20 + 21 + 7 = 70 pax (capacity 70)
// R-05: 27 + 18 + 19 + 6 = 70 pax (capacity 70)
// R-06: 12 + 16 + 17 + 15 + 15 = 75 pax (capacity 60 -> over by 15!)

// Wait! Mattuthavani is 15. If Mattuthavani moves to R-03 (D1: 51 + 15 = 66 / 70):
// R-03: Anuppanadi (8), Periyar (8), Arappalayam (24), Kochadai (11), Mattuthavani (15) -> Mattuthavani is North-East, Kochadai is West! That would cross the city!
// What if R-03 takes: Anuppanadi (8), Simmakkal (22), Arappalayam (24), Kochadai (11) = 65 / 70!
// Then R-04 (AS@) takes: Goripalayam (20), Tallakulam (21), Narimedu (7), Bibikulam (6), Mattuthavani (15) = 69 / 70!
// Then R-05 (A2) takes: Anna Nagar (27), K.K. Nagar West (18), KK Nagar (19) = 64 / 70!
// Then R-06 (w1: 60) takes: Viraganoor (12), Teppakulam (16), Vandiyur (17), Othakadai (15) = 60 / 60!
// Then Periyar (8) and Kalavasal (10) need to be placed!
// k1 (70): Avaniyapuram (9), Villapuram (9), Jaihindpuram (10), Palanganatham (10), Alagappan Nagar (9), Thirunagar (7) = 54.
// If k1 takes Periyar (8) and Kalavasal (10): 54 + 8 + 10 = 72 (over by 2).
// BUT LOOK:
// A2 has 64 / 70 (6 seats remaining).
// D1 has 65 / 70 (5 seats remaining).
// AS@ has 69 / 70 (1 seat remaining).
// k1 has 54 / 70 (16 seats remaining).
// Total spare seats across all buses = 410 - 400 = 10 spare seats!

// What if Kalavasal (10) goes to D1 instead of Kochadai (11)?
// Kochadai is right next to Kalavasal!
// What if Anuppanadi (8) + Periyar (8) + Simmakkal (22) + Arappalayam (24) = 62 / 70 on D1?
// Then Kalavasal (10) + Kochadai (11) + Palanganatham (10) + Alagappan Nagar (9) + Thirunagar (7) = 47.
// Where do Avaniyapuram (9), Villapuram (9), Jaihindpuram (10) go?
// Avaniyapuram (9) + Villapuram (9) = 18!
// In the 7-vehicle fleet:
// Avaniyapuram (9) + Villapuram (9) were on F (BUS_06: 45)!
// That was 18 / 45 = 40.0% utilization!
// If BUS_06 (F: 45) is utilized:
// Total fleet capacity = 455.
// Overall utilization = 400 / 455 = 87.91%.

async function evaluate() {
  console.log("Evaluating...");
}

evaluate();
