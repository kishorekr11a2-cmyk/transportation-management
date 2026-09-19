"""
prepare_dataset.py
Extracts and normalizes historical route datasets for tabular ML training.
Outputs structured JSON/CSV records for Stop Compatibility and Route Quality modeling.
"""

import json
import math
import os

# Standard baseline historical routes (19.09.2026 & 21.09.2026 - Outgoing)
HISTORICAL_ROUTES = [
    {
        "route_id": "HIST-19-R01",
        "bus_id": "BUS-01",
        "direction": "OUTWARD",
        "vehicle_capacity": 70,
        "passenger_count": 65,
        "stops": ["Avaniyapuram", "Villapuram", "Jaihindpuram", "Palanganatham", "Alagappan Nagar", "Kalavasal", "Thirunagar"]
    },
    {
        "route_id": "HIST-19-R02",
        "bus_id": "BUS-02",
        "direction": "OUTWARD",
        "vehicle_capacity": 70,
        "passenger_count": 70,
        "stops": ["K.Pudur", "Iyer Bungalow", "Thiruppalai", "Koodal Nagar", "Vilangudi", "Sellur"]
    },
    {
        "route_id": "HIST-19-R03",
        "bus_id": "BUS-03",
        "direction": "OUTWARD",
        "vehicle_capacity": 70,
        "passenger_count": 51,
        "stops": ["Anuppanadi", "Periyar", "Arappalayam", "Kochadai"]
    },
    {
        "route_id": "HIST-19-R04",
        "bus_id": "BUS-04",
        "direction": "OUTWARD",
        "vehicle_capacity": 70,
        "passenger_count": 70,
        "stops": ["Simmakkal", "Goripalayam", "Tallakulam", "Narimedu"]
    },
    {
        "route_id": "HIST-19-R05",
        "bus_id": "BUS-07",
        "direction": "OUTWARD",
        "vehicle_capacity": 70,
        "passenger_count": 70,
        "stops": ["Anna Nagar", "K.K. Nagar West", "KK Nagar", "Bibikulam"]
    },
    {
        "route_id": "HIST-19-R06",
        "bus_id": "BUS-05",
        "direction": "OUTWARD",
        "vehicle_capacity": 60,
        "passenger_count": 60,
        "stops": ["Viraganoor", "Teppakulam", "Vandiyur", "Mattuthavani", "Othakadai"]
    },
    {
        "route_id": "HIST-21-R01",
        "bus_id": "BUS-01",
        "direction": "OUTWARD",
        "vehicle_capacity": 70,
        "passenger_count": 65,
        "stops": ["Alagappan Nagar", "Palanganatham", "Jaihindpuram", "Periyar", "Kalavasal", "Kochadai", "Thirunagar"]
    },
    {
        "route_id": "HIST-21-R02",
        "bus_id": "BUS-06",
        "direction": "OUTWARD",
        "vehicle_capacity": 45,
        "passenger_count": 18,
        "stops": ["Avaniyapuram", "Villapuram"]
    },
    {
        "route_id": "HIST-21-R03",
        "bus_id": "BUS-02",
        "direction": "OUTWARD",
        "vehicle_capacity": 70,
        "passenger_count": 70,
        "stops": ["K.Pudur", "Iyer Bungalow", "Thiruppalai", "Koodal Nagar", "Vilangudi", "Sellur"]
    },
    {
        "route_id": "HIST-21-R04",
        "bus_id": "BUS-03",
        "direction": "OUTWARD",
        "vehicle_capacity": 70,
        "passenger_count": 64,
        "stops": ["Anuppanadi", "Simmakkal", "Arappalayam", "Narimedu", "Bibikulam"]
    },
    {
        "route_id": "HIST-21-R05",
        "bus_id": "BUS-04",
        "direction": "OUTWARD",
        "vehicle_capacity": 70,
        "passenger_count": 68,
        "stops": ["Viraganoor", "Goripalayam", "Tallakulam", "Mattuthavani"]
    },
    {
        "route_id": "HIST-21-R06",
        "bus_id": "BUS-07",
        "direction": "OUTWARD",
        "vehicle_capacity": 70,
        "passenger_count": 64,
        "stops": ["Anna Nagar", "K.K. Nagar West", "KK Nagar"]
    },
    {
        "route_id": "HIST-21-R07",
        "bus_id": "BUS-05",
        "direction": "OUTWARD",
        "vehicle_capacity": 60,
        "passenger_count": 48,
        "stops": ["Teppakulam", "Vandiyur", "Othakadai"]
    }
]

def prepare_dataset():
    output_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(os.path.dirname(output_dir), "data")
    os.makedirs(data_dir, exist_ok=True)

    # 1. Co-occurrence extraction
    cooccur = {}
    distinct_stops = set()

    for r in HISTORICAL_ROUTES:
        stops = r["stops"]
        for s in stops:
            distinct_stops.add(s)
        for i in range(len(stops)):
            for j in range(i + 1, len(stops)):
                pair = tuple(sorted([stops[i], stops[j]]))
                cooccur[pair] = cooccur.get(pair, 0) + 1

    stop_pairs = []
    stop_list = sorted(list(distinct_stops))

    for i in range(len(stop_list)):
        for j in range(i + 1, len(stop_list)):
            sA = stop_list[i]
            sB = stop_list[j]
            pair = tuple(sorted([sA, sB]))
            freq = cooccur.get(pair, 0)
            label = 1 if freq > 0 else 0
            score = min(1.0, 0.4 + freq * 0.3) if freq > 0 else 0.15

            stop_pairs.append({
                "stop_a": sA,
                "stop_b": sB,
                "cooccurrence_count": freq,
                "compatibility_label": label,
                "compatibility_score": round(score, 3)
            })

    # Save stop pairs
    with open(os.path.join(data_dir, "stop_pairs.json"), "w") as f:
        json.dump(stop_pairs, f, indent=2)

    # 2. Route quality records
    route_records = []
    for r in HISTORICAL_ROUTES:
        n_stops = len(r["stops"])
        cap = r["vehicle_capacity"]
        pax = r["passenger_count"]
        util = round((pax / cap) * 100, 1)
        est_dist = round(n_stops * 4.2, 1)
        est_time = round((est_dist / 32.0) * 60 + n_stops * 1.5, 1)
        quality = round(min(1.0, (util / 100.0) * 0.6 + 0.35), 3)

        route_records.append({
            "route_id": r["route_id"],
            "bus_id": r["bus_id"],
            "number_of_stops": n_stops,
            "vehicle_capacity": cap,
            "passenger_count": pax,
            "utilization": util,
            "road_distance_km": est_dist,
            "travel_time_min": est_time,
            "quality_score": quality
        })

    with open(os.path.join(data_dir, "route_records.json"), "w") as f:
        json.dump(route_records, f, indent=2)

    print(f"Dataset prepared successfully: {len(stop_pairs)} stop pairs, {len(route_records)} route records.")

if __name__ == "__main__":
    prepare_dataset()
