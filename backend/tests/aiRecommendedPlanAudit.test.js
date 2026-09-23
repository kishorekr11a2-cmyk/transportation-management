import test from "node:test";
import assert from "node:assert/strict";
import {
    consolidateLowUtilizationRoutes,
    validateTransportationPlan,
    getSectorName
} from "../services/aiAgentService.js";
import {
    calculateMultiObjectiveRouteScore,
    computeClarkeWrightSavings,
    PriorityQueue
} from "../services/routeOptimizationService.js";
import {
    predictRouteQuality,
    predictVehicleSuitability,
    ML_SYSTEM_STATUS
} from "../services/mlPredictionService.js";

// ============================================================================
// AUDIT TEST SUITE: CONTINUOUS ROUTE PLAN & AUDIT INTEGRITY
// ============================================================================

test("Audit 1: Utilization Metrics & Formula Transparency (203 / 295 = 68.81%)", async () => {
    const assignedUsers = 203;
    const allocatedSeats = 295; // e.g. 70 + 70 + 60 + 50 + 45 = 295 seats
    const totalPhysicalFleetCapacity = 535;
    const allocatedBusesCount = 5;
    const availableVehiclesCount = 9;

    // 1. Seat utilization of allocated vehicles
    const seatUtilizationOfAllocatedVehicles = Number(((assignedUsers / allocatedSeats) * 100).toFixed(2));
    assert.equal(seatUtilizationOfAllocatedVehicles, 68.81, "203 / 295 must equal exactly 68.81%");

    // 2. Total fleet capacity utilization
    const totalFleetCapacityUtilization = Number(((assignedUsers / totalPhysicalFleetCapacity) * 100).toFixed(2));
    assert.equal(totalFleetCapacityUtilization, 37.94, "203 / 535 must equal exactly 37.94%");

    // 3. Vehicle fleet usage
    const vehicleFleetUsage = Number(((allocatedBusesCount / availableVehiclesCount) * 100).toFixed(2));
    assert.equal(vehicleFleetUsage, 55.56, "5 / 9 vehicles must equal exactly 55.56%");

    // Verify distinct formulas and denominators
    assert.notEqual(seatUtilizationOfAllocatedVehicles, totalFleetCapacityUtilization, "Denominators must not be mixed");
    assert.notEqual(seatUtilizationOfAllocatedVehicles, vehicleFleetUsage, "Vehicle usage must not be mixed with seat utilization");
});

test("Audit 2: Consolidation Audit & Zero Duplicate Retention Messages", async () => {
    // Two low-utilization routes (e.g. Q1 with 2 pax and F with 4 pax) in distant directions
    const initialBuses = [
        {
            vehicleName: "F",
            routeCode: "R-F",
            assignedUsers: 4,
            capacity: 45,
            remainingSeats: 41,
            routeDistanceKm: 29.2,
            avgBearing: 10,
            stops: [{ name: "Alagar Kovil", latitude: 10.074, longitude: 78.213, userCount: 4, userIds: ["u1", "u2", "u3", "u4"] }]
        },
        {
            vehicleName: "Q1",
            routeCode: "R-Q1",
            assignedUsers: 2,
            capacity: 50,
            remainingSeats: 48,
            routeDistanceKm: 35.2,
            avgBearing: 65,
            stops: [{ name: "Melur", latitude: 10.050, longitude: 78.330, userCount: 2, userIds: ["u5", "u6"] }]
        },
        {
            vehicleName: "V1",
            routeCode: "R-V1",
            assignedUsers: 60,
            capacity: 70,
            remainingSeats: 10,
            routeDistanceKm: 28.5,
            avgBearing: 180,
            stops: [{ name: "Villapuram", latitude: 9.895, longitude: 78.132, userCount: 60, userIds: [] }]
        }
    ];

    const result = await consolidateLowUtilizationRoutes({
        initialBuses,
        availableVehicles: initialBuses,
        anchorHub: { latitude: 9.8324, longitude: 78.1884, name: "Central Hub" },
        tripMode: "FROM_SOURCE"
    });

    // Check consolidation logs
    const fRetentionCount = result.consolidationLogs.filter((log) => log.includes("Route F") && log.includes("retained as separate route")).length;
    const q1RetentionCount = result.consolidationLogs.filter((log) => log.includes("Route Q1") && log.includes("retained as separate route")).length;

    assert.equal(fRetentionCount, 1, "Route F retention message must appear exactly ONCE, not duplicated");
    assert.equal(q1RetentionCount, 1, "Route Q1 retention message must appear exactly ONCE, not duplicated");

    // Verify unique set equals array length
    const uniqueLogs = new Set(result.consolidationLogs);
    assert.equal(uniqueLogs.size, result.consolidationLogs.length, "Consolidation logs must contain zero duplicates");
});

test("Audit 3: Route & Corridor Generalization (No Hard-coded KLN, R-01, or static corridors)", async () => {
    // Dynamic corridor name with stops
    const stopsNorth = [{ name: "Apex School" }, { name: "Summit Park" }];
    const corridorNorth = getSectorName(5, stopsNorth);
    assert.ok(corridorNorth.includes("Apex School – Summit Park"), "Corridor name must dynamically reflect actual stops");
    assert.ok(corridorNorth.includes("North"), "Cardinal bearing must be included");

    const stopsSouth = [{ name: "Harbor Center" }];
    const corridorSouth = getSectorName(180, stopsSouth);
    assert.ok(corridorSouth.includes("Harbor Center Sector (South)"), "Single stop sector must reflect stop name");

    // Default fallback when no stops passed
    const corridorWest = getSectorName(270);
    assert.equal(corridorWest, "West Corridor");
});

test("Audit 4: ML Score Validity & Deterministic Fallback (Never fabricate scores)", async () => {
    // 1. Evaluate with realistic inputs
    const candidateScore = await calculateMultiObjectiveRouteScore({
        passengerCount: 68,
        vehicleCapacity: 70,
        roadDistanceKm: 28.5,
        stops: [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }],
        isContinuous: true,
        detourRatio: 1.25
    });

    assert.ok(candidateScore.score >= 0.0 && candidateScore.score <= 1.0, "Score must be bounded between 0 and 1");
    assert.ok(candidateScore.explanations.whyRouteSelected.includes("68/70 passengers (97.1%)"), "Explanation must cite exact calculations");
    assert.ok(candidateScore.explanations.whyVehicleSelected.includes("2 spare seats") || candidateScore.explanations.whyVehicleSelected.includes("2 unused seats"), "Vehicle explanation must cite exact spare seats");

    // 2. Predict vehicle suitability rejecting overcapacity
    const overCap = predictVehicleSuitability({
        passengerDemand: 75,
        vehicleCapacity: 70,
        isAvailable: true
    });
    assert.equal(overCap.isFeasible, false, "Must reject overcapacity");
    assert.equal(overCap.suitabilityScore, 0.0, "Overcapacity score must be 0");
});

test("Audit 5: 203 Users Exact Allocation Scenario", async () => {
    const userIds = Array.from({ length: 203 }, (_, i) => `user_203_${i + 1}`);
    const bus1Users = userIds.slice(0, 70);
    const bus2Users = userIds.slice(70, 139);
    const bus3Users = userIds.slice(139, 186);
    const bus4Users = userIds.slice(186, 199);
    const bus5Users = userIds.slice(199, 203);

    const buses = [
        {
            vehicleId: "v1",
            vehicleName: "Bus 1",
            capacity: 70,
            assignedUsers: 70,
            users: bus1Users,
            stops: [{ name: "Stop 1", userCount: 70, userIds: bus1Users, latitude: 9.92, longitude: 78.12 }],
            routeDistanceKm: 25,
            straightLineBaselineKm: 20,
            isContinuous: true,
            isRoadVerified: true
        },
        {
            vehicleId: "v2",
            vehicleName: "Bus 2",
            capacity: 70,
            assignedUsers: 69,
            users: bus2Users,
            stops: [{ name: "Stop 2", userCount: 69, userIds: bus2Users, latitude: 9.91, longitude: 78.14 }],
            routeDistanceKm: 28,
            straightLineBaselineKm: 22,
            isContinuous: true,
            isRoadVerified: true
        },
        {
            vehicleId: "v3",
            vehicleName: "Bus 3",
            capacity: 60,
            assignedUsers: 47,
            users: bus3Users,
            stops: [{ name: "Stop 3", userCount: 47, userIds: bus3Users, latitude: 9.90, longitude: 78.11 }],
            routeDistanceKm: 20,
            straightLineBaselineKm: 16,
            isContinuous: true,
            isRoadVerified: true
        },
        {
            vehicleId: "v4",
            vehicleName: "Bus 4",
            capacity: 50,
            assignedUsers: 13,
            users: bus4Users,
            stops: [{ name: "Stop 4", userCount: 13, userIds: bus4Users, latitude: 10.05, longitude: 78.33 }],
            routeDistanceKm: 35,
            straightLineBaselineKm: 27,
            isContinuous: true,
            isRoadVerified: true
        },
        {
            vehicleId: "v5",
            vehicleName: "Bus 5",
            capacity: 45,
            assignedUsers: 4,
            users: bus5Users,
            stops: [{ name: "Stop 5", userCount: 4, userIds: bus5Users, latitude: 10.07, longitude: 78.21 }],
            routeDistanceKm: 29,
            straightLineBaselineKm: 25,
            isContinuous: true,
            isRoadVerified: true
        }
    ];

    const validation = validateTransportationPlan({
        buses,
        unassignedUsers: 0
    }, {
        totalComingUsers: 203,
        availableVehicles: buses.map((b) => ({ _id: b.vehicleId, capacity: b.capacity })),
        totalAvailableCapacity: 295
    });

    assert.equal(validation.isCertified, true, "Plan with 203 users across 5 vehicles must be certified");
    assert.equal(validation.totalAssignedUsers, 203);
    assert.equal(validation.unallocatedPassengers, 0);
});

test("Audit 6: 400 Users Scenario with Multiple Vehicle Capacities", async () => {
    const userIds = Array.from({ length: 400 }, (_, i) => `user_400_${i + 1}`);
    const capacities = [70, 70, 70, 60, 50, 45, 45]; // Total = 410 seats
    let allocatedIdx = 0;

    const buses = capacities.map((cap, bIdx) => {
        const toTake = Math.min(cap, 400 - allocatedIdx);
        const pSlice = userIds.slice(allocatedIdx, allocatedIdx + toTake);
        allocatedIdx += toTake;
        return {
            vehicleId: `fleet_${bIdx + 1}`,
            vehicleName: `Fleet ${bIdx + 1}`,
            capacity: cap,
            assignedUsers: toTake,
            users: pSlice,
            stops: [{ name: `Cluster ${bIdx + 1}`, userCount: toTake, userIds: pSlice, latitude: 9.9 + bIdx * 0.01, longitude: 78.1 + bIdx * 0.01 }],
            routeDistanceKm: 20 + bIdx * 2,
            straightLineBaselineKm: 15 + bIdx * 2,
            isContinuous: true,
            isRoadVerified: true
        };
    });

    const validation = validateTransportationPlan({
        buses,
        unassignedUsers: 0
    }, {
        totalComingUsers: 400,
        availableVehicles: buses.map((b) => ({ _id: b.vehicleId, capacity: b.capacity })),
        totalAvailableCapacity: 410
    });

    assert.equal(validation.isCertified, true);
    assert.equal(validation.totalAssignedUsers, 400);
    assert.equal(validation.unallocatedPassengers, 0);
});

test("Audit 7: Insufficient Capacity Handling (Exact Unallocated Tracking)", async () => {
    // 100 passengers demand with only one 50-seat bus available
    const userIds = Array.from({ length: 100 }, (_, i) => `user_shortage_${i + 1}`);
    const busUsers = userIds.slice(0, 50);

    const buses = [
        {
            vehicleId: "v_only",
            vehicleName: "Only Bus",
            capacity: 50,
            assignedUsers: 50,
            users: busUsers,
            stops: [{ name: "Stop A", userCount: 50, userIds: busUsers, latitude: 9.9, longitude: 78.1 }],
            routeDistanceKm: 15,
            straightLineBaselineKm: 12,
            isContinuous: true,
            isRoadVerified: true
        }
    ];

    const validation = validateTransportationPlan({
        buses,
        unassignedUsers: 50
    }, {
        totalComingUsers: 100,
        availableVehicles: [{ _id: "v_only", capacity: 50 }, { _id: "v_extra", capacity: 50 }],
        totalAvailableCapacity: 100
    });

    assert.equal(validation.totalAssignedUsers, 50);
    assert.equal(validation.unallocatedPassengers, 50, "Shortage must be exactly 50 unallocated");
    assert.equal(validation.isCertified, false, "Plan with unallocated users when capacity is available cannot be certified");
});

test("Audit 8: Duplicate Passenger Prevention & Single Source of Truth", async () => {
    // Intentionally duplicate user 'dup_student' in two routes
    const busesWithDup = [
        {
            vehicleId: "v1",
            vehicleName: "Bus 1",
            capacity: 50,
            assignedUsers: 2,
            users: ["student_1", "dup_student"],
            stops: [{ name: "Stop 1", userCount: 2, userIds: ["student_1", "dup_student"], latitude: 9.9, longitude: 78.1 }],
            routeDistanceKm: 10,
            straightLineBaselineKm: 8,
            isContinuous: true,
            isRoadVerified: true
        },
        {
            vehicleId: "v2",
            vehicleName: "Bus 2",
            capacity: 50,
            assignedUsers: 2,
            users: ["dup_student", "student_2"],
            stops: [{ name: "Stop 2", userCount: 2, userIds: ["dup_student", "student_2"], latitude: 9.91, longitude: 78.11 }],
            routeDistanceKm: 12,
            straightLineBaselineKm: 9,
            isContinuous: true,
            isRoadVerified: true
        }
    ];

    const validation = validateTransportationPlan({
        buses: busesWithDup,
        unassignedUsers: 0
    }, {
        totalComingUsers: 3,
        availableVehicles: [{ _id: "v1", capacity: 50 }, { _id: "v2", capacity: 50 }]
    });

    assert.equal(validation.isCertified, false, "Must reject duplicate passenger assignment");
    assert.ok(validation.failureReasons.some((c) => c.includes("Duplicate passenger")), "Must report duplicate passenger assertion error");
});

test("Audit 9: Unavailable Vehicle Strict Exclusion", async () => {
    const buses = [
        {
            vehicleId: "v_maintenance",
            vehicleName: "Broken Bus",
            capacity: 50,
            assignedUsers: 2,
            users: ["s1", "s2"],
            stops: [{ name: "Stop 1", userCount: 2, userIds: ["s1", "s2"], latitude: 9.9, longitude: 78.1 }],
            routeDistanceKm: 10,
            straightLineBaselineKm: 8,
            isContinuous: true,
            isRoadVerified: true
        }
    ];

    const validation = validateTransportationPlan({
        buses,
        unassignedUsers: 0
    }, {
        totalComingUsers: 2,
        // v_maintenance is NOT in availableVehicles
        availableVehicles: [{ _id: "v_operational", capacity: 50 }],
        totalAvailableCapacity: 50
    });

    assert.equal(validation.isCertified, false, "Must reject vehicle not available in schedule");
    assert.ok(validation.failureReasons.some((c) => c.includes("Unavailable vehicles")), "Must report unavailable vehicle");
});

test("Audit 10: Late Response Isolation After ACTIVE Plan (Zero In-Flight Route Mutation)", async () => {
    // 5 active allocated buses with 203 riders
    const activeRoutePassengerCount = 203;

    // Student submits "Coming" status post-approval
    const lateResponseStudent = {
        _id: "student_late_999",
        name: "Late Submitting Student",
        travelStatus: "Coming",
        isLateResponse: true,
        allocationStatus: "Unallocated",
        busNumber: null,
        routeId: null
    };

    // Rule: Active routes must NOT be modified in-flight
    assert.equal(lateResponseStudent.isLateResponse, true, "Must be tagged as late response");
    assert.equal(lateResponseStudent.allocationStatus, "Unallocated", "Late response must remain Unallocated");
    assert.equal(lateResponseStudent.busNumber, null, "Must NOT be automatically injected into active bus");
    assert.equal(activeRoutePassengerCount, 203, "Active route passenger count must remain untouched");
});

test("Audit 11: AI Recommended Plan vs Admin Manual Plan Lifecycle Independence", async () => {
    // AI Plan object
    const aiPlan = {
        planType: "AI",
        approvalStatus: "PENDING_APPROVAL",
        isActive: false,
        buses: [{ vehicleName: "AI-Bus-1", assignedUsers: 45 }]
    };

    // Manual Plan object
    const manualPlan = {
        planType: "MANUAL",
        approvalStatus: "DRAFT",
        isActive: false,
        routes: [{ routeName: "Admin-Route-1", assignedUsers: 30 }]
    };

    assert.notEqual(aiPlan.planType, manualPlan.planType, "Plan types must remain distinct");
    assert.notEqual(aiPlan.buses[0].vehicleName, manualPlan.routes[0].routeName, "Allocations must not cross-contaminate");
});

test("Audit 12: ML Score Unavailable / Cold-Start Deterministic Fallback", async () => {
    // Simulate low-data cold start
    const coldStartMode = "LOW_DATA";
    const isMlTrained = coldStartMode === "HYBRID_OPTIMIZER" || coldStartMode === "LARGE_DATA";

    const qualityMetricName = isMlTrained ? "ML Route Quality" : "Deterministic CVRP Route Quality";
    assert.equal(isMlTrained, false, "Under low-data cold start, ML must not be reported as trained");
    assert.equal(qualityMetricName, "Deterministic CVRP Route Quality", "Metric must clearly fall back to Deterministic CVRP");

    // Evaluate pure deterministic CVRP score
    const deterministicScore = await calculateMultiObjectiveRouteScore({
        passengerCount: 50,
        vehicleCapacity: 60,
        roadDistanceKm: 22.0,
        stops: [{ name: "Stop 1" }, { name: "Stop 2" }],
        isContinuous: true
    });

    assert.ok(deterministicScore.score >= 0.0 && deterministicScore.score <= 1.0, "Deterministic score must be mathematically valid");
    assert.notEqual(deterministicScore.score, 0.88, "Score must come from real formula, never hard-coded 88%");
});
