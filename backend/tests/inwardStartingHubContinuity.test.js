import test from "node:test";
import assert from "node:assert/strict";
import {
    executeGlobalRouteOptimization,
    assignVehiclesToOptimizedRoutes,
    evaluateInwardCorridorConsolidation,
    rebalanceCrossCorridorStartingHubDuplications,
    solveMinCostBipartiteMatching,
    sequenceInwardRouteStops
} from "../services/routeOptimizationService.js";
import {
    evaluateFleetBalancingDecision
} from "../services/routeOptimizationService.js";
import { isBusHubSuitableForStops } from "../services/aiAgentService.js";
import { calculateDistanceKm } from "../services/mapGeocodingService.js";

test("Inward Starting-Hub and Route-Continuity Optimization Suite", async (t) => {

    // ── 1. Hungarian / Bipartite Matching: Resolves Cross-Town Hopping ──
    await t.test("1. solveMinCostBipartiteMatching: optimally matches starting hubs to corridors", () => {
        // 3 routes: East (0), North-East (1), North-West (2)
        // 3 vehicles: Sellur/NW (0), Melur/NE (1), Kalavasal/NW (2)
        const costMatrix = [
            [14, 374, 20],  // East route: Sellur is 3.5km, Kalavasal 5.8km, Melur 25km
            [350, 5, 380],  // Melur route: Melur is 0km!
            [10, 410, 2]    // Kalavasal route: Kalavasal is 0km!
        ];
        const matching = solveMinCostBipartiteMatching(costMatrix);
        assert.deepEqual(matching, [0, 1, 2], "Route 0 -> Veh 0 (Sellur), Route 1 -> Veh 1 (Melur), Route 2 -> Veh 2 (Kalavasal)");
    });

    // ── 2. Candidate Route Absorption / Consolidation when Feasible ──
    await t.test("2. evaluateInwardCorridorConsolidation: absorbs compatible nearby clusters within capacity", () => {
        const dest = { name: "Destination Hub", latitude: 9.852, longitude: 78.188 };
        const routeA = {
            routeId: "route_nw_1",
            assignedUsers: 25,
            stops: [
                { name: "Sellur", latitude: 9.945, longitude: 78.125, passengerCount: 15 },
                { name: "Arappalayam", latitude: 9.935, longitude: 78.110, passengerCount: 10 }
            ]
        };
        const routeB = {
            routeId: "route_nw_2",
            assignedUsers: 30,
            stops: [
                { name: "Kalavasal", latitude: 9.928, longitude: 78.098, passengerCount: 15 },
                { name: "Simmakkal", latitude: 9.928, longitude: 78.122, passengerCount: 15 }
            ]
        };

        const result = evaluateInwardCorridorConsolidation({
            routes: [routeA, routeB],
            availableVehicles: [{ _id: "v1", capacity: 70 }],
            destinationHub: dest,
            maxBusCapacity: 70
        });

        assert.equal(result.routes.length, 1, "Nearby clusters (total 55 <= 70) must consolidate into 1 route");
        assert.equal(result.routes[0].assignedUsers, 55);
        assert.equal(result.isConsolidated, true);
    });

    // ── 3. Consolidation Rejected when Demand Exceeds Capacity ──
    await t.test("3. evaluateInwardCorridorConsolidation: retains separate routes when combined demand exceeds capacity", () => {
        const dest = { name: "Destination Hub", latitude: 9.852, longitude: 78.188 };
        const routeA = {
            routeId: "route_nw_heavy",
            assignedUsers: 50,
            stops: [{ name: "Sellur", latitude: 9.945, longitude: 78.125, passengerCount: 50 }]
        };
        const routeB = {
            routeId: "route_kalavasal_heavy",
            assignedUsers: 45,
            stops: [{ name: "Kalavasal", latitude: 9.928, longitude: 78.098, passengerCount: 45 }]
        };

        const result = evaluateInwardCorridorConsolidation({
            routes: [routeA, routeB],
            availableVehicles: [{ _id: "v1", capacity: 70 }, { _id: "v2", capacity: 70 }],
            destinationHub: dest,
            maxBusCapacity: 70
        });

        assert.equal(result.routes.length, 2, "Demand of 95 pax exceeds 70-seat bus; must keep 2 separate routes");
        assert.ok(result.consolidationAttempts.some((a) => a.reason.includes("Capacity limit")), "Must document capacity limit rejection reason");
        assert.ok(result.routes[0].whySeparateRouteNeeded.includes("capacity"), "Must provide whySeparateRouteNeeded on route");
    });

    // ── 4. Consolidation Rejected when Corridors are Geographically Separated ──
    await t.test("4. evaluateInwardCorridorConsolidation: rejects merging routes in distant geographic corridors", () => {
        const dest = { name: "Destination Hub", latitude: 9.852, longitude: 78.188 };
        // Route Melur is North-East (~45° bearing from destination)
        const routeMelur = {
            routeId: "route_melur",
            assignedUsers: 25,
            stops: [
                { name: "Melur", latitude: 10.050, longitude: 78.330, passengerCount: 15 },
                { name: "Othakadai", latitude: 9.970, longitude: 78.180, passengerCount: 10 }
            ]
        };
        // Route Kalavasal is North-West (~325° bearing from destination)
        const routeKalavasal = {
            routeId: "route_kalavasal",
            assignedUsers: 25,
            stops: [
                { name: "Kalavasal", latitude: 9.928, longitude: 78.098, passengerCount: 15 },
                { name: "Kochadai", latitude: 9.932, longitude: 78.085, passengerCount: 10 }
            ]
        };

        const result = evaluateInwardCorridorConsolidation({
            routes: [routeMelur, routeKalavasal],
            availableVehicles: [{ _id: "v1", capacity: 70 }],
            destinationHub: dest,
            maxBusCapacity: 70
        });

        assert.equal(result.routes.length, 2, "Even though combined demand is 50 <= 70, cross-city detour must prevent merge");
        assert.ok(result.consolidationAttempts.some((a) => a.reason.includes("Corridor separation")), "Must record corridor separation reason");
    });

    // ── 5. Starting Hub Duplication Removal ──
    await t.test("5. rebalanceCrossCorridorStartingHubDuplications: reassigns stray stops at another bus's hub", () => {
        const hubSellur = { locationName: "Sellur", latitude: 9.945, longitude: 78.125 };
        const hubMelur = { locationName: "Melur", latitude: 10.050, longitude: 78.330 };

        const assignedRoutes = [
            {
                routeId: "rt_sellur",
                vehicleName: "k1",
                capacity: 70,
                assignedUsers: 50,
                startLocation: hubSellur,
                stops: [
                    { name: "Arappalayam", latitude: 9.935, longitude: 78.110, passengerCount: 30, matrixIndex: 1 },
                    { name: "Simmakkal", latitude: 9.928, longitude: 78.122, passengerCount: 20, matrixIndex: 2 }
                ]
            },
            {
                routeId: "rt_melur",
                vehicleName: "D1",
                capacity: 70,
                assignedUsers: 55,
                startLocation: hubMelur,
                stops: [
                    { name: "Melur", latitude: 10.050, longitude: 78.330, passengerCount: 30, matrixIndex: 3 },
                    { name: "Othakadai", latitude: 9.970, longitude: 78.180, passengerCount: 20, matrixIndex: 4 },
                    { name: "Sellur", latitude: 9.945, longitude: 78.125, passengerCount: 5, matrixIndex: 5 } // Stray stop!
                ]
            }
        ];

        const auditTrail = [];
        const result = rebalanceCrossCorridorStartingHubDuplications({
            assignedRoutes,
            activeInwardStartingPlaces: [
                { busName: "k1", ...hubSellur },
                { busName: "D1", ...hubMelur }
            ],
            maxBusCapacity: 70,
            auditTrail
        });

        const melurRoute = result.find((r) => r.vehicleName === "D1");
        const sellurRoute = result.find((r) => r.vehicleName === "k1");

        assert.equal(melurRoute.stops.some((s) => s.name === "Sellur"), false, "D1 (Melur) must NOT visit Sellur");
        assert.equal(sellurRoute.stops.some((s) => s.name === "Sellur"), true, "k1 (Sellur) must absorb Sellur stop");
        assert.equal(sellurRoute.assignedUsers, 55, "k1 demand updated (50 + 5 = 55)");
        assert.equal(melurRoute.assignedUsers, 50, "D1 demand updated (55 - 5 = 50)");
        assert.ok(auditTrail.some((a) => a.action === "RESOLVE_STARTING_HUB_DUPLICATION"), "Must log RESOLVE_STARTING_HUB_DUPLICATION");
    });

    // ── 6. Operational Continuity Certification Check ──
    await t.test("6. sequenceInwardRouteStops: verifies operationalContinuityVerified only on forward progression", () => {
        const dest = { name: "KLN College", latitude: 9.852, longitude: 78.188 };
        const hub = { locationName: "Sellur", latitude: 9.945, longitude: 78.125 };

        // Coherent forward progression: Sellur -> Simmakkal -> Periyar -> College
        const goodStops = [
            { name: "Simmakkal", latitude: 9.928, longitude: 78.122, passengerCount: 15 },
            { name: "Periyar", latitude: 9.915, longitude: 78.118, passengerCount: 20 }
        ];

        const resGood = sequenceInwardRouteStops({
            startingHub: hub,
            destinationHub: dest,
            stops: goodStops
        });

        assert.equal(resGood.qualityValidation.operationalContinuityVerified, true, "Forward progression must be certified");
        assert.equal(resGood.qualityValidation.directionalReversals, 0);
        assert.ok(resGood.qualityValidation.firstPassengerStop !== null, "Must identify firstPassengerStop");
        assert.equal(resGood.qualityValidation.firstPassengerStop.name, "Simmakkal");
    });

    // ── 7. Separate Starting Hubs Genuinely Requiring Separate Routes ──
    await t.test("7. End-to-End Simulation: Sellur (k1), Melur (D1), Kalavasal (AS@) with 202 passengers", async () => {
        const dest = { name: "KLN College", latitude: 9.852, longitude: 78.188 };
        const startingPlaces = [
            { busName: "k1", locationName: "Sellur", latitude: 9.945, longitude: 78.125 },
            { busName: "D1", locationName: "Melur", latitude: 10.050, longitude: 78.330 },
            { busName: "AS@", locationName: "Kalavasal", latitude: 9.928, longitude: 78.098 }
        ];
        const availableVehicles = [
            { _id: "veh_k1", vehicleName: "k1", capacity: 70 },
            { _id: "veh_D1", vehicleName: "D1", capacity: 70 },
            { _id: "veh_AS", vehicleName: "AS@", capacity: 70 }
        ];

        // 202 passengers distributed across Madurai
        const stops = [
            // North-East corridor (Melur)
            { name: "Melur", latitude: 10.050, longitude: 78.330, userCount: 25 },
            { name: "Alagar Kovil", latitude: 10.075, longitude: 78.215, userCount: 15 },
            { name: "Thiruppalai", latitude: 9.972, longitude: 78.142, userCount: 15 },
            { name: "Othakadai", latitude: 9.970, longitude: 78.180, userCount: 15 },
            // North-West corridor (Kalavasal/Sellur)
            { name: "Kalavasal", latitude: 9.928, longitude: 78.098, userCount: 20 },
            { name: "Kochadai", latitude: 9.932, longitude: 78.085, userCount: 15 },
            { name: "Vilangudi", latitude: 9.955, longitude: 78.095, userCount: 15 },
            { name: "Arappalayam", latitude: 9.935, longitude: 78.110, userCount: 15 },
            { name: "Sellur", latitude: 9.945, longitude: 78.125, userCount: 15 },
            // East / South-Central corridor (College approach)
            { name: "KK Nagar", latitude: 9.930, longitude: 78.150, userCount: 18 },
            { name: "Teppakulam", latitude: 9.915, longitude: 78.145, userCount: 18 },
            { name: "Chinthamani", latitude: 9.895, longitude: 78.140, userCount: 16 }
        ];

        const optRes = await executeGlobalRouteOptimization({
            resolvedStops: stops,
            anchorHub: dest,
            availableVehicles,
            tripMode: "TO_DESTINATION",
            options: {
                activeInwardStartingPlaces: startingPlaces,
                destinationHub: dest
            }
        });

        assert.equal(optRes.routes.length, 3, "202 passengers with 70-seat buses require exactly 3 buses");

        // Check vehicle assignments match their geographic hubs
        const melurRoute = optRes.routes.find((r) => r.vehicleName === "D1");
        assert.ok(melurRoute, "D1 (Melur) must be deployed");
        assert.equal(melurRoute.stops.some((s) => s.name === "Sellur"), false, "D1 must NOT detour to Sellur");

        // Verify each route has whySeparateRouteNeeded
        optRes.routes.forEach((r) => {
            assert.ok(r.whySeparateRouteNeeded, `Route ${r.vehicleName} must provide whySeparateRouteNeeded`);
            assert.ok(r.firstPassengerStop, `Route ${r.vehicleName} must have firstPassengerStop`);
            assert.ok(r.startingHub, `Route ${r.vehicleName} must have startingHub`);
        });
    });

    // ── 8. Location-Agnostic Arbitrary City Test (London / Bangalore) ──
    await t.test("8. Location-Agnostic: Works for arbitrary non-Madurai coordinates", async () => {
        // Destination in Bangalore (Electronic City: 12.845, 77.660)
        const bangaloreDest = { name: "Infosys Campus", latitude: 12.845, longitude: 77.660 };
        const bStartPlaces = [
            { busName: "B1", locationName: "Whitefield", latitude: 12.969, longitude: 77.750 },
            { busName: "B2", locationName: "Hebbal", latitude: 13.035, longitude: 77.597 }
        ];
        const bVehicles = [
            { _id: "b1", vehicleName: "B1", capacity: 50 },
            { _id: "b2", vehicleName: "B2", capacity: 50 }
        ];
        const bStops = [
            { name: "Whitefield Stn", latitude: 12.970, longitude: 77.752, userCount: 30 },
            { name: "Hebbal Flyover", latitude: 13.036, longitude: 77.598, userCount: 35 }
        ];

        const optRes = await executeGlobalRouteOptimization({
            resolvedStops: bStops,
            anchorHub: bangaloreDest,
            availableVehicles: bVehicles,
            tripMode: "TO_DESTINATION",
            options: {
                activeInwardStartingPlaces: bStartPlaces,
                destinationHub: bangaloreDest
            }
        });

        assert.equal(optRes.routes.length, 2);
        const rB1 = optRes.routes.find((r) => r.vehicleName === "B1");
        const rB2 = optRes.routes.find((r) => r.vehicleName === "B2");
        assert.ok(rB1, "B1 must be deployed");
        assert.ok(rB2, "B2 must be deployed");
        assert.equal(rB1.stops[0].name, "Whitefield Stn", "B1 starting at Whitefield must serve Whitefield");
        assert.equal(rB2.stops[0].name, "Hebbal Flyover", "B2 starting at Hebbal must serve Hebbal");
    });

    // ── 9. Fleet Symmetry & Vehicle Reuse ──
    await t.test("9. Fleet Symmetry: Preserves opposite direction vehicle count and reuses vehicles", () => {
        const oppositePlan = {
            buses: [
                { vehicleId: "veh_1", vehicleName: "Bus 1" },
                { vehicleId: "veh_2", vehicleName: "Bus 2" },
                { vehicleId: "veh_3", vehicleName: "Bus 3" }
            ],
            assignedUsers: 140
        };

        const decision = evaluateFleetBalancingDecision({
            currentDirection: "INWARD",
            currentDemand: 135,
            candidateRoutes: [{ stops: [] }, { stops: [] }],
            availableVehicles: [
                { _id: "veh_1", vehicleName: "Bus 1", capacity: 70 },
                { _id: "veh_2", vehicleName: "Bus 2", capacity: 70 },
                { _id: "veh_3", vehicleName: "Bus 3", capacity: 70 }
            ],
            configuredInwardStartingPlaces: [
                { vehicleId: "veh_1", name: "Hub 1" },
                { vehicleId: "veh_2", name: "Hub 2" },
                { vehicleId: "veh_3", name: "Hub 3" }
            ],
            oppositePlan
        });

        assert.equal(decision.minCapacityBuses, 2, "Minimum capacity requirement is 2 buses");
        assert.equal(decision.targetRouteCount, 2, "Does not artificially add a bus solely to match opposite direction");
        assert.equal(decision.symmetryStatus, "BALANCED_FLEET");
        assert.equal(decision.oppositeBusCount, 3);
    });
});
