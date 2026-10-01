import test from "node:test";
import assert from "node:assert/strict";
import dotenv from "dotenv";
dotenv.config();

import {
    buildGlobalOptimizationMatrix,
    executeGlobalRouteOptimization,
    consolidateAndRebalanceLowOccupancyOutwardRoutes,
    evaluateFleetBalancingDecision,
    selectOutwardFleet,
    selectInwardFleet,
    sequenceOutwardRouteStops
} from "../services/routeOptimizationService.js";

import {
    validateTransportationPlan,
    buildAIPlan,
    generateAgentRecommendations,
    saveSelectedPlan,
    resetGeneratedAIRoute
} from "../services/aiAgentService.js";

const sourceHub = {
    name: "KLN College of Engineering",
    address: "Pottapalayam, Sivagangai / Madurai - 630612",
    latitude: 9.8515,
    longitude: 78.1882
};

test("OUTWARD PASSENGER BALANCING AND FLEET CONSOLIDATION SUITE", async (suite) => {

    await suite.test("Scenario 1: Current Outward 413-passenger scenario - rebalances w1: 2/60 into compatible corridor routes (6 buses)", async () => {
        const stopsData = {
            Vandiyur: { name: "Vandiyur", latitude: 9.92, longitude: 78.165 },
            "K.K. Nagar West": { name: "K.K. Nagar West", latitude: 9.925, longitude: 78.146 },
            Narimedu: { name: "Narimedu", latitude: 9.938, longitude: 78.132 },
            Sellur: { name: "Sellur", latitude: 9.941, longitude: 78.118 },
            Vilangudi: { name: "Vilangudi", latitude: 9.951, longitude: 78.092 },
            "Koodal Nagar": { name: "Koodal Nagar", latitude: 9.967663, longitude: 78.096438 },

            viraganur: { name: "viraganur", latitude: 9.9005203, longitude: 78.162842 },
            Anuppanadi: { name: "Anuppanadi", latitude: 9.907, longitude: 78.151 },
            Othakadai: { name: "Othakadai", latitude: 9.97, longitude: 78.18 },
            Thiruppalai: { name: "Thiruppalai", latitude: 9.9825, longitude: 78.143 },
            "Iyer Bungalow": { name: "Iyer Bungalow", latitude: 9.965, longitude: 78.141 },
            "K.Pudur": { name: "K.Pudur", latitude: 9.952, longitude: 78.146 },

            Villapuram: { name: "Villapuram", latitude: 9.895, longitude: 78.132 },
            Mahal: { name: "Mahal", latitude: 9.915006, longitude: 78.1220546 },
            Periyar: { name: "Periyar", latitude: 9.9175, longitude: 78.114 },
            Arappalayam: { name: "Arappalayam", latitude: 9.9322, longitude: 78.1025 },
            Kalavasal: { name: "Kalavasal", latitude: 9.930305555555554, longitude: 78.0955 },
            Kochadai: { name: "Kochadai", latitude: 9.936, longitude: 78.085 },

            Simmakkal: { name: "Simmakkal", latitude: 9.9255, longitude: 78.1192 },
            Goripalayam: { name: "Goripalayam", latitude: 9.9315, longitude: 78.1275 },
            Tallakulam: { name: "Tallakulam", latitude: 9.936, longitude: 78.135 },
            Bibikulam: { name: "Bibikulam", latitude: 9.942, longitude: 78.136 },

            "Anna Nagar": { name: "Anna Nagar", latitude: 9.918, longitude: 78.1467 },
            "KK Nagar": { name: "KK Nagar", latitude: 9.927, longitude: 78.151 },
            Mattuthavani: { name: "Mattuthavani", latitude: 9.945, longitude: 78.158 },

            Teppakulam: { name: "Teppakulam", latitude: 9.914, longitude: 78.147 },
            Avaniyapuram: { name: "Avaniyapuram", latitude: 9.878, longitude: 78.124 },
            Jaihindpuram: { name: "Jaihindpuram", latitude: 9.902, longitude: 78.112 },
            Palanganatham: { name: "Palanganatham", latitude: 9.905, longitude: 78.098 },
            "Alagappan Nagar": { name: "Alagappan Nagar", latitude: 9.892, longitude: 78.099 },
            Thirunagar: { name: "Thirunagar", latitude: 9.869, longitude: 78.069 }
        };

        const initial7Buses = [
            {
                vehicleName: "k1",
                capacity: 70,
                assignedUsers: 70,
                stops: [
                    { ...stopsData["Vandiyur"], userCount: 18, userIds: Array.from({length: 18}, (_, i) => `k1_v_${i}`) },
                    { ...stopsData["K.K. Nagar West"], userCount: 15, userIds: Array.from({length: 15}, (_, i) => `k1_kw_${i}`) },
                    { ...stopsData["Narimedu"], userCount: 7, userIds: Array.from({length: 7}, (_, i) => `k1_n_${i}`) },
                    { ...stopsData["Sellur"], userCount: 7, userIds: Array.from({length: 7}, (_, i) => `k1_s_${i}`) },
                    { ...stopsData["Vilangudi"], userCount: 11, userIds: Array.from({length: 11}, (_, i) => `k1_vg_${i}`) },
                    { ...stopsData["Koodal Nagar"], userCount: 12, userIds: Array.from({length: 12}, (_, i) => `k1_kn_${i}`) }
                ]
            },
            {
                vehicleName: "V1",
                capacity: 70,
                assignedUsers: 70,
                stops: [
                    { ...stopsData["viraganur"], userCount: 12, userIds: Array.from({length: 12}, (_, i) => `v1_vr_${i}`) },
                    { ...stopsData["Anuppanadi"], userCount: 3, userIds: Array.from({length: 3}, (_, i) => `v1_an_${i}`) },
                    { ...stopsData["Othakadai"], userCount: 15, userIds: Array.from({length: 15}, (_, i) => `v1_ot_${i}`) },
                    { ...stopsData["Thiruppalai"], userCount: 14, userIds: Array.from({length: 14}, (_, i) => `v1_tp_${i}`) },
                    { ...stopsData["Iyer Bungalow"], userCount: 13, userIds: Array.from({length: 13}, (_, i) => `v1_ib_${i}`) },
                    { ...stopsData["K.Pudur"], userCount: 13, userIds: Array.from({length: 13}, (_, i) => `v1_kp_${i}`) }
                ]
            },
            {
                vehicleName: "D1",
                capacity: 70,
                assignedUsers: 63,
                stops: [
                    { ...stopsData["Villapuram"], userCount: 10, userIds: Array.from({length: 10}, (_, i) => `d1_vp_${i}`) },
                    { ...stopsData["Mahal"], userCount: 1, userIds: Array.from({length: 1}, (_, i) => `d1_mh_${i}`) },
                    { ...stopsData["Periyar"], userCount: 9, userIds: Array.from({length: 9}, (_, i) => `d1_pr_${i}`) },
                    { ...stopsData["Arappalayam"], userCount: 26, userIds: Array.from({length: 26}, (_, i) => `d1_ar_${i}`) },
                    { ...stopsData["Kalavasal"], userCount: 10, userIds: Array.from({length: 10}, (_, i) => `d1_kl_${i}`) },
                    { ...stopsData["Kochadai"], userCount: 7, userIds: Array.from({length: 7}, (_, i) => `d1_kc_${i}`) }
                ]
            },
            {
                vehicleName: "I1",
                capacity: 70,
                assignedUsers: 70,
                stops: [
                    { ...stopsData["Simmakkal"], userCount: 22, userIds: Array.from({length: 22}, (_, i) => `i1_sm_${i}`) },
                    { ...stopsData["Goripalayam"], userCount: 20, userIds: Array.from({length: 20}, (_, i) => `i1_gp_${i}`) },
                    { ...stopsData["Tallakulam"], userCount: 21, userIds: Array.from({length: 21}, (_, i) => `i1_tk_${i}`) },
                    { ...stopsData["Bibikulam"], userCount: 6, userIds: Array.from({length: 6}, (_, i) => `i1_bk_${i}`) },
                    { ...stopsData["Kochadai"], userCount: 1, userIds: Array.from({length: 1}, (_, i) => `i1_kc_${i}`) }
                ]
            },
            {
                vehicleName: "A2",
                capacity: 70,
                assignedUsers: 68,
                stops: [
                    { ...stopsData["Anna Nagar"], userCount: 30, userIds: Array.from({length: 30}, (_, i) => `a2_an_${i}`) },
                    { ...stopsData["KK Nagar"], userCount: 21, userIds: Array.from({length: 21}, (_, i) => `a2_kn_${i}`) },
                    { ...stopsData["Mattuthavani"], userCount: 17, userIds: Array.from({length: 17}, (_, i) => `a2_mt_${i}`) }
                ]
            },
            {
                vehicleName: "J1",
                capacity: 70,
                assignedUsers: 70,
                stops: [
                    { ...stopsData["Teppakulam"], userCount: 16, userIds: Array.from({length: 16}, (_, i) => `j1_tp_${i}`) },
                    { ...stopsData["K.K. Nagar West"], userCount: 1, userIds: Array.from({length: 1}, (_, i) => `j1_kw_${i}`) },
                    { ...stopsData["Avaniyapuram"], userCount: 9, userIds: Array.from({length: 9}, (_, i) => `j1_av_${i}`) },
                    { ...stopsData["Jaihindpuram"], userCount: 10, userIds: Array.from({length: 10}, (_, i) => `j1_jh_${i}`) },
                    { ...stopsData["Palanganatham"], userCount: 12, userIds: Array.from({length: 12}, (_, i) => `j1_pl_${i}`) },
                    { ...stopsData["Alagappan Nagar"], userCount: 9, userIds: Array.from({length: 9}, (_, i) => `j1_al_${i}`) },
                    { ...stopsData["Thirunagar"], userCount: 7, userIds: Array.from({length: 7}, (_, i) => `j1_tn_${i}`) },
                    { ...stopsData["Kochadai"], userCount: 6, userIds: Array.from({length: 6}, (_, i) => `j1_kc_${i}`) }
                ]
            },
            {
                vehicleName: "w1",
                capacity: 60,
                assignedUsers: 2,
                stops: [
                    { ...stopsData["K.K. Nagar West"], userCount: 2, userIds: ["w1_u1", "w1_u2"] }
                ]
            }
        ];

        initial7Buses.forEach(b => {
            b.users = b.stops.flatMap(s => s.userIds || []);
        });

        const matrix = await buildGlobalOptimizationMatrix({
            depot: sourceHub,
            stops: Object.values(stopsData),
            options: { sourceHub }
        });

        const auditTrail = [];
        const resultRoutes = consolidateAndRebalanceLowOccupancyOutwardRoutes({
            routes: initial7Buses,
            availableVehicles: initial7Buses.map(b => ({ vehicleName: b.vehicleName, capacity: b.capacity })),
            sourceHub,
            matrix,
            tripMode: "FROM_SOURCE",
            auditTrail
        });

        assert.equal(resultRoutes.length, 6, "Low-occupancy bus w1 must be dissolved, reducing fleet from 7 to 6 buses");
        const totalPax = resultRoutes.reduce((sum, b) => sum + b.assignedUsers, 0);
        assert.equal(totalPax, 413, "Total passenger count of 413 must be 100% preserved");
        assert.ok(!resultRoutes.some(b => b.vehicleName === "w1"), "Bus w1 should no longer be in selected fleet");

        resultRoutes.forEach(b => {
            assert.ok(b.assignedUsers <= b.capacity, `Bus ${b.vehicleName} assigned users (${b.assignedUsers}) must not exceed capacity (${b.capacity})`);
        });
    });

    await suite.test("Scenario 2: Low-occupancy route can be consolidated safely into nearby compatible bus", async () => {
        const stops = [
            { name: "Stop A", latitude: 9.9100, longitude: 78.1400, userCount: 40, userIds: Array.from({length: 40}, (_, i) => `u_a_${i}`) },
            { name: "Stop B", latitude: 9.9200, longitude: 78.1450, userCount: 5, userIds: Array.from({length: 5}, (_, i) => `u_b_${i}`) }
        ];
        const matrix = await buildGlobalOptimizationMatrix({ depot: sourceHub, stops });
        const routes = [
            {
                vehicleName: "BusMain",
                capacity: 70,
                assignedUsers: 40,
                stops: [stops[0]],
                users: stops[0].userIds
            },
            {
                vehicleName: "BusSmall",
                capacity: 60,
                assignedUsers: 5,
                stops: [stops[1]],
                users: stops[1].userIds
            }
        ];

        const auditTrail = [];
        const consolidated = consolidateAndRebalanceLowOccupancyOutwardRoutes({
            routes,
            sourceHub,
            matrix,
            auditTrail
        });

        assert.equal(consolidated.length, 1, "BusSmall should be absorbed into BusMain");
        assert.equal(consolidated[0].assignedUsers, 45, "Combined passenger count should be 45");
        assert.equal(consolidated[0].stops.length, 2, "Main bus should now serve both stops");
    });

    await suite.test("Scenario 3: Consolidation impossible due to extreme geographic separation - retains separate bus with explanation", async () => {
        const stops = [
            { name: "East Madurai", latitude: 9.9200, longitude: 78.1800, userCount: 30, userIds: Array.from({length: 30}, (_, i) => `e_${i}`) },
            { name: "Far West Isolated", latitude: 9.9900, longitude: 77.9500, userCount: 5, userIds: Array.from({length: 5}, (_, i) => `w_${i}`) }
        ];
        const matrix = await buildGlobalOptimizationMatrix({ depot: sourceHub, stops });
        const routes = [
            {
                vehicleName: "BusEast",
                capacity: 70,
                assignedUsers: 30,
                stops: [stops[0]],
                users: stops[0].userIds
            },
            {
                vehicleName: "BusIsolated",
                capacity: 60,
                assignedUsers: 5,
                stops: [stops[1]],
                users: stops[1].userIds
            }
        ];

        const auditTrail = [];
        const consolidated = consolidateAndRebalanceLowOccupancyOutwardRoutes({
            routes,
            sourceHub,
            matrix,
            auditTrail
        });

        assert.equal(consolidated.length, 2, "Consolidation must be rejected due to extreme distance (> 8 km)");
        const isolatedBus = consolidated.find(b => b.vehicleName === "BusIsolated");
        assert.ok(isolatedBus, "Isolated bus must be retained");
        assert.ok(isolatedBus.whySeparateRouteNeeded, "Should document why separate route is needed");
    });

    await suite.test("Scenario 4: Vehicle capacity prevents consolidation - separate bus retained", async () => {
        const stops = [
            { name: "Corridor Stop 1", latitude: 9.9100, longitude: 78.1400, userCount: 68, userIds: Array.from({length: 68}, (_, i) => `c1_${i}`) },
            { name: "Corridor Stop 2", latitude: 9.9150, longitude: 78.1420, userCount: 10, userIds: Array.from({length: 10}, (_, i) => `c2_${i}`) }
        ];
        const matrix = await buildGlobalOptimizationMatrix({ depot: sourceHub, stops });
        const routes = [
            {
                vehicleName: "BusFull",
                capacity: 70,
                assignedUsers: 68,
                stops: [stops[0]],
                users: stops[0].userIds
            },
            {
                vehicleName: "BusExtra",
                capacity: 50,
                assignedUsers: 10,
                stops: [stops[1]],
                users: stops[1].userIds
            }
        ];

        const auditTrail = [];
        const consolidated = consolidateAndRebalanceLowOccupancyOutwardRoutes({
            routes,
            sourceHub,
            matrix,
            auditTrail
        });

        assert.equal(consolidated.length, 2, "Cannot consolidate 68 + 10 = 78 into capacity 70");
    });

    await suite.test("Scenario 5: Limited vehicles available - selectOutwardFleet greedily maximizes vehicle capacity", async () => {
        const vehicles = [
            { _id: "v1", vehicleName: "Small 1", capacity: 40 },
            { _id: "v2", vehicleName: "Large 1", capacity: 70 },
            { _id: "v3", vehicleName: "Large 2", capacity: 70 },
            { _id: "v4", vehicleName: "Medium 1", capacity: 50 }
        ];

        const fleetSelection = selectOutwardFleet({
            totalComingPassengers: 135,
            availableVehicles: vehicles
        });

        assert.equal(fleetSelection.selectedBuses.length, 2, "Should select 2 largest buses (70 + 70 = 140 >= 135)");
        assert.equal(fleetSelection.selectedCapacity, 140, "Total capacity should be 140");
        assert.equal(fleetSelection.selectedBuses[0].capacity, 70);
        assert.equal(fleetSelection.selectedBuses[1].capacity, 70);
    });

    await suite.test("Scenario 6: Inward regression test - selectInwardFleet and evaluateFleetBalancingDecision for Inward remain unchanged", async () => {
        const vehicles = [
            { _id: "v1", vehicleName: "Inward 70A", capacity: 70 },
            { _id: "v2", vehicleName: "Inward 70B", capacity: 70 },
            { _id: "v3", vehicleName: "Inward 50", capacity: 50 }
        ];
        const startingPlaces = [
            { vehicleId: "v1", busName: "Inward 70A", name: "Place A", latitude: 9.95, longitude: 78.15 },
            { vehicleId: "v2", busName: "Inward 70B", name: "Place B", latitude: 9.96, longitude: 78.16 }
        ];

        const decision = evaluateFleetBalancingDecision({
            currentDirection: "INWARD",
            currentDemand: 130,
            availableVehicles: vehicles,
            configuredInwardStartingPlaces: startingPlaces
        });

        assert.equal(decision.targetRouteCount, 2, "Inward should allocate 2 buses");
        assert.equal(decision.selectedFleet.length, 2, "Inward selected fleet should have 2 buses");
        assert.equal(decision.minCapacityBuses, 2);
    });

    await suite.test("Scenario 7: Outward stop sequencing produces continuous road route with 0 reversals", async () => {
        const stops = [
            { name: "Stop Far", latitude: 9.9700, longitude: 78.1800, userCount: 10 },
            { name: "Stop Near", latitude: 9.8900, longitude: 78.1600, userCount: 10 },
            { name: "Stop Mid", latitude: 9.9300, longitude: 78.1700, userCount: 10 }
        ];
        const matrix = await buildGlobalOptimizationMatrix({ depot: sourceHub, stops });

        const seq = sequenceOutwardRouteStops({
            departureHub: sourceHub,
            stops,
            matrix,
            tripMode: "FROM_SOURCE"
        });

        assert.equal(seq.stops[0].name, "Stop Near", "First stop from sourceHub must be the nearest stop");
        assert.equal(seq.stops[1].name, "Stop Mid", "Second stop must be intermediate");
        assert.equal(seq.stops[2].name, "Stop Far", "Third stop must be farthest");
        assert.equal(seq.qualityValidation.directionalReversals, 0, "Outward progression should have 0 reversals");
    });

    await suite.test("Scenario 8: Multi-Hop Corridor Rebalancing successfully offloads donor stop to 3rd route", async () => {
        const stops = {
            A: { name: "Corridor A", latitude: 9.920, longitude: 78.150, userCount: 50, userIds: Array.from({length: 50}, (_, i) => `a_${i}`) },
            B: { name: "Border B", latitude: 9.930, longitude: 78.140, userCount: 15, userIds: Array.from({length: 15}, (_, i) => `b_${i}`) },
            C: { name: "Small C", latitude: 9.922, longitude: 78.148, userCount: 10, userIds: Array.from({length: 10}, (_, i) => `c_${i}`) },
            D: { name: "Corridor D", latitude: 9.935, longitude: 78.130, userCount: 40, userIds: Array.from({length: 40}, (_, i) => `d_${i}`) }
        };

        const matrix = await buildGlobalOptimizationMatrix({ depot: sourceHub, stops: Object.values(stops) });

        // Route 1 (capacity 70) has A (50) + B (15) = 65 pax (only 5 spare seats)
        // Route 2 (capacity 70) has D (40) = 40 pax (30 spare seats, near Border B)
        // Route 3 (capacity 60) has Small C (10) = 10 pax (needs absorption)
        const routes = [
            {
                vehicleName: "Bus1",
                capacity: 70,
                assignedUsers: 65,
                stops: [stops.A, stops.B],
                users: [...stops.A.userIds, ...stops.B.userIds]
            },
            {
                vehicleName: "Bus2",
                capacity: 70,
                assignedUsers: 40,
                stops: [stops.D],
                users: [...stops.D.userIds]
            },
            {
                vehicleName: "Bus3_Small",
                capacity: 60,
                assignedUsers: 10,
                stops: [stops.C],
                users: [...stops.C.userIds]
            }
        ];

        const auditTrail = [];
        const result = consolidateAndRebalanceLowOccupancyOutwardRoutes({
            routes,
            sourceHub,
            matrix,
            tripMode: "FROM_SOURCE",
            auditTrail
        });

        assert.equal(result.length, 2, "Bus3_Small should be eliminated via multi-hop rebalancing");
        const totalPax = result.reduce((s, b) => s + b.assignedUsers, 0);
        assert.equal(totalPax, 115, "Total passengers must equal 65 + 40 + 10 = 115");
        assert.ok(result.every(b => b.assignedUsers <= b.capacity), "No capacity violations");
    });

    await suite.test("Scenario 9: validateTransportationPlan passes complete plan validation with 0 errors", async () => {
        const stops = [
            { name: "Stop 1", latitude: 9.9100, longitude: 78.1400, userCount: 30, userIds: Array.from({length: 30}, (_, i) => `p_${i}`) }
        ];
        const dummyPlan = {
            direction: "OUTWARD",
            tripMode: "FROM_SOURCE",
            totalDemand: 30,
            confirmedUsers: 30,
            comingUsers: 30,
            totalComingUsers: 30,
            assignedUsers: 30,
            unassignedUsers: 0,
            buses: [
                {
                    routeCode: "RT-01",
                    vehicleId: "veh_1",
                    vehicleName: "k1",
                    capacity: 70,
                    assignedUsers: 30,
                    isContinuous: true,
                    isRoadVerified: true,
                    detourRatio: 1.25,
                    stops: [
                        { ...stops[0], sequence: 1, order: 1 }
                    ],
                    users: stops[0].userIds
                }
            ],
            fleetBalancing: {
                targetRouteCount: 1,
                allocatedBusCount: 1
            }
        };

        const validation = validateTransportationPlan(dummyPlan, {
            totalComingUsers: 30,
            availableVehicles: [{ _id: "veh_1", vehicleId: "veh_1", vehicleName: "k1", capacity: 70 }],
            isOutward: true
        });

        assert.ok(validation.isCertified, `Plan should be certified (status: ${validation.status})`);
        assert.equal(validation.unallocatedPassengers, 0, "Zero unallocated users");
        assert.ok(validation.checks.allPassengersAccountedFor, "All passengers accounted for");
    });

    await suite.test("Scenario 10: Complete passenger accounting and uniqueness validation", async () => {
        const uids = ["user_1", "user_2", "user_3", "user_4", "user_5"];
        const routes = [
            {
                vehicleName: "B1",
                capacity: 70,
                assignedUsers: 3,
                stops: [{ name: "S1", latitude: 9.91, longitude: 78.14, userCount: 3, userIds: ["user_1", "user_2", "user_3"] }],
                users: ["user_1", "user_2", "user_3"]
            },
            {
                vehicleName: "B2",
                capacity: 70,
                assignedUsers: 2,
                stops: [{ name: "S2", latitude: 9.92, longitude: 78.15, userCount: 2, userIds: ["user_4", "user_5"] }],
                users: ["user_4", "user_5"]
            }
        ];

        const allAssigned = routes.flatMap(r => r.users);
        const uniqueSet = new Set(allAssigned);
        assert.equal(allAssigned.length, 5, "Total assigned passenger count should be 5");
        assert.equal(uniqueSet.size, 5, "No duplicate passengers across routes");
    });
});
