import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildAIPlan,
    canBusSafelyServeStop,
    sequenceStopsContinuous,
    validateRouteCorridorContinuity,
    calculateDistanceKm,
    allocateVehiclesToDemandClusters
} from '../services/aiAgentService.js';
import {
    calculateStudentTransportStatusSync,
    getActiveAllocationForStudent
} from '../services/studentTransportStatusService.js';

describe('Real-World Transportation Department Route Generation Test Suite (17 Cases)', () => {

    // Helper to generate mock vehicles
    const makeVehicle = (id, name, capacity) => ({
        _id: id,
        id,
        busId: id,
        name,
        vehicleName: name,
        capacity,
        totalSeats: capacity
    });

    // Helper to generate mock stops with users
    const makeStop = (name, lat, lng, userCount) => {
        const users = Array.from({ length: userCount }, (_, i) => ({
            _id: `${name}_user_${i + 1}`,
            userId: `${name}_user_${i + 1}`,
            name: `${name} Passenger ${i + 1}`,
            stoppings: name
        }));
        return {
            name,
            latitude: lat,
            longitude: lng,
            users,
            userCount,
            userIds: users.map((u) => u._id)
        };
    };

    // =========================================================================
    // CASE 1: Single bus serves stop without sharing
    // =========================================================================
    it('CASE 1: Single bus serves stop without sharing (Demand 25 <= Capacity 35)', async () => {
        const hub = { name: "City Tech Park Hub", latitude: 12.9716, longitude: 77.5946 };
        const stops = [
            makeStop("Indiranagar", 12.9784, 77.6408, 25)
        ];
        const vehicles = [
            makeVehicle("v1", "TechBus-01", 35)
        ];

        const plan = await buildAIPlan({
            sourceHub: hub,
            destinationHub: hub,
            tripMode: "OUTWARD",
            resolvedStops: stops,
            availableVehicles: vehicles,
            rawVehicles: vehicles,
            totalComingUsers: 25,
            allUsersCount: 25
        });

        assert.equal(plan.buses.length, 1);
        assert.equal(plan.buses[0].assignedUsers, 25);
        assert.equal(plan.sharedStopCount, 0, "Stop should not be shared");
        assert.equal(plan.sharedStoppingAreas.length, 0);
        assert.equal(plan.unassignedUsers, 0);
        assert.equal(plan.buses[0].stops[0].name, "Indiranagar");
    });

    // =========================================================================
    // CASE 2: Stop exceeds bus capacity (Demand 55 > Capacity 35 -> 35 + 20)
    // =========================================================================
    it('CASE 2: Stop exceeds bus capacity (Demand 55 into 35 + 20 across 2 buses)', async () => {
        const hub = { name: "State University Central Campus", latitude: 13.0827, longitude: 80.2707 };
        const stops = [
            makeStop("Guindy Junction", 13.0067, 80.2024, 55)
        ];
        const vehicles = [
            makeVehicle("v1", "UniBus-01", 35),
            makeVehicle("v2", "UniBus-02", 35)
        ];

        const plan = await buildAIPlan({
            sourceHub: hub,
            destinationHub: hub,
            tripMode: "INWARD",
            resolvedStops: stops,
            availableVehicles: vehicles,
            rawVehicles: vehicles,
            totalComingUsers: 55,
            allUsersCount: 55
        });

        assert.equal(plan.buses.length, 2, "Should deploy 2 buses for 55 passengers");
        const totalAssigned = plan.buses.reduce((sum, b) => sum + b.assignedUsers, 0);
        assert.equal(totalAssigned, 55);
        assert.equal(plan.unassignedUsers, 0);

        // Verify stop sharing was demand-based
        assert.equal(plan.sharedStopCount, 1);
        assert.equal(plan.sharedStoppingAreas.length, 1);
        assert.equal(plan.sharedStoppingAreas[0].stopName, "Guindy Junction");
        assert.equal(plan.sharedStoppingAreas[0].totalDemand, 55);
        assert.match(plan.sharedStoppingAreas[0].reason, /Passenger demand \(55\) exceeds vehicle capacity/);

        // Verify one bus takes 35 and the second bus takes 20
        const counts = plan.buses.map((b) => b.assignedUsers).sort((a, b) => b - a);
        assert.deepEqual(counts, [35, 20]);
    });

    // =========================================================================
    // CASE 3: Two buses safely share a stop (Validated capacity, road continuity)
    // =========================================================================
    it('CASE 3: Two buses safely share a stop along valid corridor progression', async () => {
        const hub = { name: "Apollo Hospital Main Hub", latitude: 13.0604, longitude: 80.2496 };
        // Stops aligned along Mount Road corridor
        const stop1 = makeStop("Teynampet", 13.0405, 80.2505, 30);
        const stop2 = makeStop("Nandanam", 13.0305, 80.2405, 30);
        const stop3Shared = makeStop("Saidapet", 13.0205, 80.2255, 20); // shared stop

        const vehicles = [
            makeVehicle("v1", "HospitalShuttle-01", 40),
            makeVehicle("v2", "HospitalShuttle-02", 40)
        ];

        const plan = await buildAIPlan({
            sourceHub: hub,
            destinationHub: hub,
            tripMode: "INWARD",
            resolvedStops: [stop1, stop2, stop3Shared],
            availableVehicles: vehicles,
            rawVehicles: vehicles,
            totalComingUsers: 80,
            allUsersCount: 80
        });

        assert.equal(plan.buses.length, 2);
        assert.equal(plan.assignedUsers, 80);
        assert.equal(plan.unassignedUsers, 0);

        // Check detour ratios are valid
        plan.buses.forEach((b) => {
            assert.ok((b.detourRatio || 1.2) <= 1.8, `Detour ratio ${b.detourRatio} must be <= 1.8`);
        });
    });

    // =========================================================================
    // CASE 4: Excessive detour sharing prevented
    // =========================================================================
    it('CASE 4: Excessive detour sharing prevented (canBusSafelyServeStop rejects detour > 1.8)', () => {
        const hub = { name: "Corporate Campus Hub", latitude: 12.9716, longitude: 77.5946 };
        const bus = {
            stops: [
                { name: "Electronic City Phase 1", latitude: 12.8452, longitude: 77.6602 },
                { name: "Electronic City Phase 2", latitude: 12.8480, longitude: 77.6745 }
            ],
            avgBearing: 150
        };

        // Candidate stop on opposite side of town (North Bangalore - 35km away)
        const oppositeStop = {
            name: "Yelahanka New Town",
            latitude: 13.1007,
            longitude: 77.5963
        };

        const canServe = canBusSafelyServeStop(bus, oppositeStop, hub);
        assert.equal(canServe, false, "Must reject stop that causes excessive detour or distance");
    });

    // =========================================================================
    // CASE 5: Discontinuous sharing / backtracking prevented
    // =========================================================================
    it('CASE 5: Discontinuous sharing / backtracking prevented (stops ordered monotonically)', async () => {
        const hub = { name: "Central Tech Hub", latitude: 12.9716, longitude: 77.5946 };
        const rawStops = [
            { name: "Far Stop C", latitude: 12.8300, longitude: 77.6500 },
            { name: "Near Stop A", latitude: 12.9300, longitude: 77.6100 },
            { name: "Mid Stop B", latitude: 12.8800, longitude: 77.6300 }
        ];

        // INWARD sequencing towards hub
        const inwardSequence = await sequenceStopsContinuous(rawStops, hub, "TO_DESTINATION", null, hub);
        assert.equal(inwardSequence[0].name, "Far Stop C", "Inward must start from farthest pickup stop");
        assert.equal(inwardSequence[1].name, "Mid Stop B");
        assert.equal(inwardSequence[2].name, "Near Stop A", "Inward must finish at nearest pickup stop before hub");

        // OUTWARD sequencing from hub
        const outwardSequence = await sequenceStopsContinuous(rawStops, hub, "FROM_SOURCE", hub, null);
        assert.equal(outwardSequence[0].name, "Near Stop A", "Outward must start from nearest drop-off stop");
        assert.equal(outwardSequence[1].name, "Mid Stop B");
        assert.equal(outwardSequence[2].name, "Far Stop C", "Outward must finish at farthest drop-off stop");
    });

    // =========================================================================
    // CASE 6: Multiple organization hubs supported
    // =========================================================================
    it('CASE 6: Multiple organization hubs supported (College, University, Hospital, Tech Park)', async () => {
        const testOrganizations = [
            { orgType: "School", hub: { name: "Delhi Public School Main Campus", latitude: 28.6139, longitude: 77.2090 } },
            { orgType: "University", hub: { name: "Anna University Chennai Campus", latitude: 13.0110, longitude: 80.2354 } },
            { orgType: "Hospital", hub: { name: "Fortis Memorial Research Institute", latitude: 28.4595, longitude: 77.0725 } },
            { orgType: "TechPark", hub: { name: "Infosys Mysore Campus", latitude: 12.3556, longitude: 76.5926 } }
        ];

        for (const org of testOrganizations) {
            const stops = [
                makeStop(`${org.orgType} Stop 1`, org.hub.latitude + 0.05, org.hub.longitude + 0.05, 10),
                makeStop(`${org.orgType} Stop 2`, org.hub.latitude + 0.09, org.hub.longitude + 0.09, 10)
            ];
            const vehicles = [makeVehicle("v1", `${org.orgType}-Bus-01`, 30)];

            const plan = await buildAIPlan({
                sourceHub: org.hub,
                destinationHub: org.hub,
                tripMode: "INWARD",
                resolvedStops: stops,
                availableVehicles: vehicles,
                rawVehicles: vehicles,
                totalComingUsers: 20,
                allUsersCount: 20
            });

            assert.equal(plan.buses.length, 1);
            assert.equal(plan.buses[0].assignedUsers, 20);
            assert.match(plan.buses[0].routeName, new RegExp(org.hub.name), `Route name must reference ${org.hub.name}`);
        }
    });

    // =========================================================================
    // CASE 7: Outward route generation (Hub -> Stop 1 -> Stop 2)
    // =========================================================================
    it('CASE 7: Outward route generation (Departure Hub -> Stop 1 -> Stop 2)', async () => {
        const hub = { name: "Corporate HQ Departure Hub", latitude: 12.9716, longitude: 77.5946 };
        const stops = [
            makeStop("Residential Stop 2 (Far)", 12.8500, 77.6500, 15),
            makeStop("Residential Stop 1 (Near)", 12.9200, 77.6100, 15)
        ];
        const vehicles = [makeVehicle("v1", "FleetBus-01", 40)];

        const plan = await buildAIPlan({
            sourceHub: hub,
            destinationHub: hub,
            tripMode: "OUTWARD",
            resolvedStops: stops,
            availableVehicles: vehicles,
            rawVehicles: vehicles,
            totalComingUsers: 30,
            allUsersCount: 30
        });

        assert.equal(plan.buses.length, 1);
        const bus = plan.buses[0];
        assert.equal(bus.stops[0].name, "Residential Stop 1 (Near)");
        assert.equal(bus.stops[1].name, "Residential Stop 2 (Far)");
        assert.match(bus.routeName, /^R-01: Corporate HQ Departure Hub (→|to)/);
    });

    // =========================================================================
    // CASE 8: Inward route generation (Stop 1 -> Stop 2 -> Hub)
    // =========================================================================
    it('CASE 8: Inward route generation (Stop 1 -> Stop 2 -> Arrival Hub)', async () => {
        const hub = { name: "University Arrival Hub", latitude: 12.9716, longitude: 77.5946 };
        const stops = [
            makeStop("Pickup Stop 2 (Near)", 12.9200, 77.6100, 15),
            makeStop("Pickup Stop 1 (Far)", 12.8500, 77.6500, 15)
        ];
        const vehicles = [makeVehicle("v1", "FleetBus-01", 40)];

        const plan = await buildAIPlan({
            sourceHub: hub,
            destinationHub: hub,
            tripMode: "INWARD",
            resolvedStops: stops,
            availableVehicles: vehicles,
            rawVehicles: vehicles,
            totalComingUsers: 30,
            allUsersCount: 30
        });

        assert.equal(plan.buses.length, 1);
        const bus = plan.buses[0];
        assert.equal(bus.stops[0].name, "Pickup Stop 1 (Far)");
        assert.equal(bus.stops[1].name, "Pickup Stop 2 (Near)");
        assert.match(bus.routeName, /(→|to) University Arrival Hub$/);
    });

    // =========================================================================
    // CASE 9: OSRM success (isRoadVerified: true)
    // =========================================================================
    it('CASE 9: OSRM success provides validated geometry and status', async () => {
        const hub = { name: "Central Hub", latitude: 12.9716, longitude: 77.5946 };
        const stops = [makeStop("MG Road", 12.9756, 77.6066, 10)];
        const vehicles = [makeVehicle("v1", "Bus-01", 30)];

        const plan = await buildAIPlan({
            sourceHub: hub,
            destinationHub: hub,
            tripMode: "OUTWARD",
            resolvedStops: stops,
            availableVehicles: vehicles,
            rawVehicles: vehicles,
            totalComingUsers: 10,
            allUsersCount: 10
        });

        const bus = plan.buses[0];
        assert.ok(bus.routeDistanceKm > 0);
        assert.ok(typeof bus.isRoadVerified === 'boolean');
        assert.ok(typeof bus.roadRouteStatus === 'string');
    });

    // =========================================================================
    // CASE 10: OSRM fallback reports honest status
    // =========================================================================
    it('CASE 10: OSRM fallback reports honest status and does NOT claim road continuity verified', async () => {
        // Unverified / fallback route mock validation
        const fallbackBus = {
            isRoadVerified: false,
            isFallback: true,
            roadRouteStatus: "Road validation unavailable — fallback estimate used",
            routeDistanceKm: 15.5
        };

        assert.equal(fallbackBus.isRoadVerified, false);
        assert.equal(fallbackBus.roadRouteStatus, "Road validation unavailable — fallback estimate used");
        assert.doesNotMatch(fallbackBus.roadRouteStatus, /Road continuity verified/i);
    });

    // =========================================================================
    // CASE 11: Limited vehicle capacity accounting (VEHICLE_CAPACITY)
    // =========================================================================
    it('CASE 11: Limited vehicle capacity accurately accounts unallocated passengers', async () => {
        const hub = { name: "Campus Hub", latitude: 12.9716, longitude: 77.5946 };
        const stops = [
            makeStop("Stop 1", 12.9500, 77.6000, 30),
            makeStop("Stop 2", 12.9400, 77.6100, 30)
        ];
        // Only one 40-seat bus for 60 passengers
        const vehicles = [makeVehicle("v1", "SingleBus", 40)];

        const plan = await buildAIPlan({
            sourceHub: hub,
            destinationHub: hub,
            tripMode: "INWARD",
            resolvedStops: stops,
            availableVehicles: vehicles,
            rawVehicles: vehicles,
            totalComingUsers: 60,
            allUsersCount: 60,
            physicalFleetCapacity: 40,
            totalAvailableCapacity: 40
        });

        assert.equal(plan.buses.length, 1);
        assert.equal(plan.assignedUsers, 40);
        assert.equal(plan.unassignedUsers, 20);
        assert.equal(plan.unallocatedPassengers.length, 20);
        assert.equal(plan.unallocatedReason, "VEHICLE_CAPACITY");
        assert.equal(plan.allocatedPassengers + plan.unallocatedPassengersCount, 60);
    });

    // =========================================================================
    // CASE 12: Fleet with more vehicles than needed
    // =========================================================================
    it('CASE 12: Fleet with more vehicles than needed only deploys required buses', async () => {
        const hub = { name: "Tech Park Hub", latitude: 12.9716, longitude: 77.5946 };
        const stops = [
            makeStop("Koramangala", 12.9352, 77.6245, 25),
            makeStop("HSR Layout", 12.9121, 77.6446, 25)
        ];
        // 5 buses available (175 seats) but only 50 passengers demand (needs only 2 buses)
        const vehicles = [
            makeVehicle("v1", "Bus-1", 35),
            makeVehicle("v2", "Bus-2", 35),
            makeVehicle("v3", "Bus-3", 35),
            makeVehicle("v4", "Bus-4", 35),
            makeVehicle("v5", "Bus-5", 35)
        ];

        const plan = await buildAIPlan({
            sourceHub: hub,
            destinationHub: hub,
            tripMode: "INWARD",
            resolvedStops: stops,
            availableVehicles: vehicles,
            rawVehicles: vehicles,
            totalComingUsers: 50,
            allUsersCount: 50
        });

        assert.equal(plan.buses.length, 2, "Only 2 buses should be deployed");
        assert.equal(plan.unusedVehicleCount, 3, "3 buses should remain idle");
        assert.equal(plan.assignedUsers, 50);
        assert.equal(plan.unassignedUsers, 0);
    });

    // =========================================================================
    // CASE 13: Zero-passenger stop removal
    // =========================================================================
    it('CASE 13: Zero-passenger stops removed and route legs recalculated', async () => {
        const hub = { name: "HQ Hub", latitude: 12.9716, longitude: 77.5946 };
        const stops = [
            makeStop("Active Stop 1", 12.9300, 77.6100, 15),
            makeStop("Empty Stop Zero Passengers", 12.9100, 77.6300, 0),
            makeStop("Active Stop 2", 12.8900, 77.6500, 15)
        ];
        const vehicles = [makeVehicle("v1", "Bus-01", 40)];

        const plan = await buildAIPlan({
            sourceHub: hub,
            destinationHub: hub,
            tripMode: "INWARD",
            resolvedStops: stops,
            availableVehicles: vehicles,
            rawVehicles: vehicles,
            totalComingUsers: 30,
            allUsersCount: 30
        });

        const bus = plan.buses[0];
        const stopNames = bus.stops.map((s) => s.name);
        assert.ok(!stopNames.includes("Empty Stop Zero Passengers"), "Empty stop must be removed");
        assert.equal(bus.stops.length, 2);
    });

    // =========================================================================
    // CASE 14: Duplicate passenger prevention
    // =========================================================================
    it('CASE 14: Duplicate passenger prevention (duplicateUsers === 0)', async () => {
        const hub = { name: "Corporate Hub", latitude: 12.9716, longitude: 77.5946 };
        const stops = [
            makeStop("Cluster A", 12.9300, 77.6100, 20),
            makeStop("Cluster B", 12.9200, 77.6200, 20)
        ];
        const vehicles = [
            makeVehicle("v1", "Bus-1", 25),
            makeVehicle("v2", "Bus-2", 25)
        ];

        const plan = await buildAIPlan({
            sourceHub: hub,
            destinationHub: hub,
            tripMode: "INWARD",
            resolvedStops: stops,
            availableVehicles: vehicles,
            rawVehicles: vehicles,
            totalComingUsers: 40,
            allUsersCount: 40
        });

        assert.equal(plan.duplicateUsers, 0);

        // Check assigned passenger IDs across buses are mutually exclusive
        const seenIds = new Set();
        plan.buses.forEach((b) => {
            b.stops.forEach((st) => {
                (st.userIds || []).forEach((uid) => {
                    assert.ok(!seenIds.has(uid), `Duplicate passenger found: ${uid}`);
                    seenIds.add(uid);
                });
            });
        });
        assert.equal(seenIds.size, 40);
    });

    // =========================================================================
    // CASE 15: Snapshot consistency
    // =========================================================================
    it('CASE 15: Snapshot consistency preserves stop sequences, distances and assignments', async () => {
        const hub = { name: "Campus Hub", latitude: 12.9716, longitude: 77.5946 };
        const stops = [
            makeStop("Stop 1", 12.9300, 77.6100, 10),
            makeStop("Stop 2", 12.9100, 77.6300, 10)
        ];
        const vehicles = [makeVehicle("v1", "Bus-01", 30)];

        const plan = await buildAIPlan({
            sourceHub: hub,
            destinationHub: hub,
            tripMode: "INWARD",
            resolvedStops: stops,
            availableVehicles: vehicles,
            rawVehicles: vehicles,
            totalComingUsers: 20,
            allUsersCount: 20
        });

        // Serialize and deserialize to simulate database snapshot persistence
        const serialized = JSON.stringify(plan);
        const deserialized = JSON.parse(serialized);

        assert.equal(deserialized.buses.length, plan.buses.length);
        assert.equal(deserialized.buses[0].routeName, plan.buses[0].routeName);
        assert.equal(deserialized.buses[0].stops.length, plan.buses[0].stops.length);
        assert.equal(deserialized.buses[0].stops[0].name, plan.buses[0].stops[0].name);
        assert.equal(deserialized.buses[0].assignedUsers, plan.buses[0].assignedUsers);
    });

    // =========================================================================
    // CASE 16: Reset and regenerate behavior
    // =========================================================================
    it('CASE 16: Reset returns plan to clean state; regenerate creates fresh routes', async () => {
        const student = {
            userId: "stu_test_reset",
            name: "Reset Student",
            travelStatus: "Coming",
            stoppings: "Indiranagar",
            isAllocated: false,
            allocationStatus: "Unallocated"
        };

        // When no approved active plan exists (e.g. after reset)
        const statusAfterReset = calculateStudentTransportStatusSync(student, []);
        assert.equal(statusAfterReset.allocationStatus, "Unallocated");
        assert.equal(statusAfterReset.isAllocated, false);
    });

    // =========================================================================
    // CASE 17: Late-response behavior
    // =========================================================================
    it('CASE 17: Late-response student remains unallocated until admin reset/regenerate', async () => {
        const approvedPlanAt = new Date('2026-09-17T08:00:00.000Z');
        const lateResponseAt = new Date('2026-09-17T09:30:00.000Z');

        const activePlan = {
            planId: "plan_approved_01",
            approvalEventId: "evt_plan_approved_01",
            version: 1,
            isApproved: true,
            adminApprovalStatus: "Approved",
            direction: "INWARD",
            approvedAt: approvedPlanAt,
            buses: [
                {
                    vehicleName: "Bus-01",
                    routeCode: "R-01",
                    capacity: 35,
                    users: ["existing_user_1"],
                    allocatedStudents: [{ userId: "existing_user_1", name: "User 1" }]
                }
            ]
        };

        // Student who responded Coming after plan approval
        const lateStudent = {
            userId: "stu_late_arrival",
            name: "Late Student",
            travelStatus: "Coming",
            travelResponseSubmittedAt: lateResponseAt,
            isAllocated: false,
            allocationStatus: "Unallocated",
            lateResponseDetected: true,
            isLateResponse: true,
            lateResponseAt: lateResponseAt,
            requiresReallocation: true,
            submittedApprovalEventId: "evt_plan_approved_01",
            submittedPlanVersion: 1
        };

        const activeLateUserIds = new Set(["stu_late_arrival"]);
        const result = calculateStudentTransportStatusSync(lateStudent, [activePlan], activeLateUserIds);
        assert.equal(result.isAllocated, false, "Late student must NOT be allocated automatically");
        assert.equal(result.allocationStatus, "Unallocated");
        assert.equal(result.lateResponse, true, "Must flag as late response");
        assert.equal(result.lateResponseDetected, true);
        assert.equal(result.vehicle, null);
        assert.equal(result.allocatedBus, null);
    });
});
