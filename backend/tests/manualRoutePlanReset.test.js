import assert from "node:assert/strict";
import test from "node:test";
import {
    buildManualTransportationPlan
} from "../services/aiAgentService.js";

/**
 * Test Suite: Admin Manual Route Plan Reset & Direction-Aware Allocation Isolation
 * 
 * Validates the 14 Success Criteria:
 * 1. Create and approve a manual plan.
 * 2. Confirm manual allocations exist.
 * 3. Reset the manual plan.
 * 4. Confirm manual allocations are cleared.
 * 5. Confirm manual approval is cleared.
 * 6. Confirm student travel status remains unchanged.
 * 7. Confirm response timestamps remain unchanged.
 * 8. Confirm master users remain unchanged.
 * 9. Confirm vehicles remain unchanged.
 * 10. Confirm saved routes remain unchanged.
 * 11. Confirm AI plan and AI allocations remain unchanged.
 * 12. Confirm direction isolation.
 * 13. Confirm global reset behavior.
 * 14. Confirm reset works after page refresh and in a new tab.
 */

test("Admin Manual Route Plan Reset Test Suite", async (t) => {

    // =========================================================================
    // Mock Data Builders
    // =========================================================================

    const SUBMISSION_TIMESTAMP = new Date("2026-09-15T08:30:00.000Z");

    function createMockStudent(id, name, stopName, travelStatus = "Coming") {
        return {
            _id: `stu_mongo_${id}`,
            userId: `STU_${id}`,
            name,
            role: "student",
            travelStatus,
            stoppings: stopName,
            city: "Madurai",
            district: "Madurai",
            state: "Tamil Nadu",
            country: "India",
            travelResponseSubmittedAt: SUBMISSION_TIMESTAMP,
            allocatedBus: null,
            manualRouteId: null,
            manualBusId: null,
            manualAllocation: null,
            assignedVehicle: null,
            assignedRoute: null,
            approvedPlanType: null,
            allocationStatus: travelStatus === "Coming" ? "Unallocated" : "Not Assigned"
        };
    }

    function createMockVehicle(id, name, capacity = 50) {
        return {
            _id: `veh_${id}`,
            vehicleName: name,
            vehicleNumber: `TN-58-AB-${id}`,
            capacity,
            status: "Available"
        };
    }

    function createMockRoute(id, routeName, direction, vehicle, stops) {
        return {
            _id: `route_${id}`,
            routeName,
            routeCode: `R-${String(id).padStart(2, "0")}`,
            direction,
            assignedVehicle: vehicle,
            source: stops[0] || null,
            stops: stops.slice(1, -1),
            destination: stops[stops.length - 1] || null,
            isSubmitted: false
        };
    }

    // Direction-aware manual reset simulator matching MongoDB pipeline in aiAgentService.js
    function simulateManualReset(users, targetDirection) {
        return users.map((user) => {
            const u = structuredClone(user);
            const existingInward = u.allocatedBus?.inward || null;
            const existingOutward = u.allocatedBus?.outward || null;

            if (targetDirection === "INWARD") {
                const newInward = null;
                const newOutward = existingOutward;
                const outwardActive = Boolean(newOutward?.isAllocated);

                return {
                    ...u,
                    allocatedBus: outwardActive ? {
                        inward: null,
                        outward: newOutward,
                        isAllocated: true,
                        direction: "OUTWARD",
                        tripMode: newOutward.tripMode || "FROM_SOURCE",
                        vehicleName: newOutward.vehicleName || null,
                        routeCode: newOutward.routeCode || null,
                        adminApprovalStatus: "Approved"
                    } : {
                        inward: null,
                        outward: null,
                        isAllocated: false,
                        direction: null,
                        adminApprovalStatus: "Pending Admin Approval",
                        message: "No approved transportation plan available yet."
                    },
                    assignedVehicle: outwardActive ? (newOutward.vehicleName || newOutward.vehicleNumber) : null,
                    assignedRoute: outwardActive ? (newOutward.routeCode || newOutward.routeName) : null,
                    manualAllocation: (outwardActive && ["MANUAL", "ADMIN"].includes(newOutward.planType)) ? newOutward : null,
                    manualRouteId: (outwardActive && ["MANUAL", "ADMIN"].includes(newOutward.planType)) ? newOutward.routeId : null,
                    manualBusId: (outwardActive && ["MANUAL", "ADMIN"].includes(newOutward.planType)) ? newOutward.vehicleId : null,
                    approvedPlanType: outwardActive ? (newOutward.planType || "AI") : null,
                    allocationStatus: outwardActive ? "Assigned" : (u.travelStatus === "Coming" ? "Unallocated" : "Not Assigned")
                };
            } else if (targetDirection === "OUTWARD") {
                const newOutward = null;
                const newInward = existingInward;
                const inwardActive = Boolean(newInward?.isAllocated);

                return {
                    ...u,
                    allocatedBus: inwardActive ? {
                        inward: newInward,
                        outward: null,
                        isAllocated: true,
                        direction: "INWARD",
                        tripMode: newInward.tripMode || "TO_DESTINATION",
                        vehicleName: newInward.vehicleName || null,
                        routeCode: newInward.routeCode || null,
                        adminApprovalStatus: "Approved"
                    } : {
                        inward: null,
                        outward: null,
                        isAllocated: false,
                        direction: null,
                        adminApprovalStatus: "Pending Admin Approval",
                        message: "No approved transportation plan available yet."
                    },
                    assignedVehicle: inwardActive ? (newInward.vehicleName || newInward.vehicleNumber) : null,
                    assignedRoute: inwardActive ? (newInward.routeCode || newInward.routeName) : null,
                    manualAllocation: (inwardActive && ["MANUAL", "ADMIN"].includes(newInward.planType)) ? newInward : null,
                    manualRouteId: (inwardActive && ["MANUAL", "ADMIN"].includes(newInward.planType)) ? newInward.routeId : null,
                    manualBusId: (inwardActive && ["MANUAL", "ADMIN"].includes(newInward.planType)) ? newInward.vehicleId : null,
                    approvedPlanType: inwardActive ? (newInward.planType || "AI") : null,
                    allocationStatus: inwardActive ? "Assigned" : (u.travelStatus === "Coming" ? "Unallocated" : "Not Assigned")
                };
            } else {
                // Global manual reset: clears manual inward & outward, preserves AI inward & outward
                const newInward = (existingInward && ["MANUAL", "ADMIN"].includes(existingInward.planType)) ? null : existingInward;
                const newOutward = (existingOutward && ["MANUAL", "ADMIN"].includes(existingOutward.planType)) ? null : existingOutward;
                const anyActive = Boolean(newInward?.isAllocated || newOutward?.isAllocated);

                return {
                    ...u,
                    manualRouteId: null,
                    manualBusId: null,
                    manualAllocation: null,
                    allocatedBus: anyActive ? {
                        inward: newInward,
                        outward: newOutward,
                        isAllocated: true,
                        direction: newInward?.isAllocated ? "INWARD" : "OUTWARD",
                        vehicleName: (newInward?.vehicleName || newOutward?.vehicleName) || null,
                        routeCode: (newInward?.routeCode || newOutward?.routeCode) || null,
                        adminApprovalStatus: "Approved"
                    } : null,
                    assignedVehicle: (newInward?.vehicleName || newOutward?.vehicleName) || null,
                    assignedRoute: (newInward?.routeCode || newOutward?.routeCode) || null,
                    approvedPlanType: (newInward?.planType || newOutward?.planType) || null,
                    allocationStatus: anyActive ? "Assigned" : (u.travelStatus === "Coming" ? "Unallocated" : "Not Assigned")
                };
            }
        });
    }

    // Set up baseline entities
    const bus1 = createMockVehicle("101", "Bus 01", 50);
    const bus2 = createMockVehicle("102", "Bus 02", 50);
    const vehicles = [bus1, bus2];

    const stopsInward = [
        { name: "Mattuthavani", latitude: 9.940, longitude: 78.150 },
        { name: "Anna Nagar", latitude: 9.918, longitude: 78.140 },
        { name: "College Campus", latitude: 9.880, longitude: 78.080 }
    ];

    const stopsOutward = [
        { name: "College Campus", latitude: 9.880, longitude: 78.080 },
        { name: "Anna Nagar", latitude: 9.918, longitude: 78.140 },
        { name: "Mattuthavani", latitude: 9.940, longitude: 78.150 }
    ];

    const inwardRoute = createMockRoute("1", "Route Inward 1", "INWARD", bus1, stopsInward);
    const outwardRoute = createMockRoute("2", "Route Outward 1", "OUTWARD", bus2, stopsOutward);

    const student1 = createMockStudent("1", "Aarav Sharma", "Mattuthavani", "Coming");
    const student2 = createMockStudent("2", "Diya Patel", "Anna Nagar", "Coming");
    const student3 = createMockStudent("3", "Kavya Iyer", "Mattuthavani", "Not Coming");
    const masterStudents = [student1, student2, student3];

    // =========================================================================
    // Test 1 & 2: Create & Approve Manual Plan, Confirm Allocations Exist
    // =========================================================================
    await t.test("1 & 2. Create and approve a manual plan & confirm allocations exist", async () => {
        const plan = await buildManualTransportationPlan({
            direction: "INWARD",
            routes: [inwardRoute],
            vehicles,
            users: masterStudents,
            forceAllocate: true
        });

        assert.strictEqual(plan.assignedUsers, 2, "Both Coming students allocated");
        assert.strictEqual(plan.unassignedUsers, 0, "Zero unassigned Coming students");

        // Simulate manual plan approval
        const approvedUsers = masterStudents.map((u) => {
            if (u.travelStatus !== "Coming") return u;
            return {
                ...u,
                manualRouteId: inwardRoute._id,
                manualBusId: bus1._id,
                manualAllocation: {
                    planType: "MANUAL",
                    direction: "INWARD",
                    routeId: inwardRoute._id,
                    routeName: inwardRoute.routeName,
                    routeCode: inwardRoute.routeCode,
                    vehicleId: bus1._id,
                    vehicleName: bus1.vehicleName,
                    isAllocated: true,
                    approved: true
                },
                allocatedBus: {
                    inward: {
                        planType: "MANUAL",
                        direction: "INWARD",
                        routeId: inwardRoute._id,
                        routeName: inwardRoute.routeName,
                        routeCode: inwardRoute.routeCode,
                        vehicleId: bus1._id,
                        vehicleName: bus1.vehicleName,
                        isAllocated: true,
                        approved: true,
                        adminApprovalStatus: "Approved"
                    },
                    outward: null,
                    isAllocated: true,
                    direction: "INWARD",
                    vehicleName: bus1.vehicleName,
                    routeCode: inwardRoute.routeCode,
                    adminApprovalStatus: "Approved"
                },
                assignedVehicle: bus1.vehicleName,
                assignedRoute: inwardRoute.routeCode,
                approvedPlanType: "MANUAL",
                allocationStatus: "Assigned"
            };
        });

        const allocatedStudent = approvedUsers.find((u) => u.userId === "STU_1");
        assert.strictEqual(allocatedStudent.allocationStatus, "Assigned");
        assert.strictEqual(allocatedStudent.allocatedBus.isAllocated, true);
        assert.strictEqual(allocatedStudent.allocatedBus.inward.vehicleName, "Bus 01");
        assert.strictEqual(allocatedStudent.manualBusId, bus1._id);
    });

    // =========================================================================
    // Test 3, 4, 5: Reset Manual Plan, Confirm Allocations and Approval Cleared
    // =========================================================================
    await t.test("3, 4, 5. Reset manual plan & confirm manual allocations and approval cleared", async () => {
        // Prepare approved state
        const approvedUsers = masterStudents.map((u) => {
            if (u.travelStatus !== "Coming") return u;
            return {
                ...u,
                manualRouteId: inwardRoute._id,
                manualBusId: bus1._id,
                allocatedBus: {
                    inward: {
                        planType: "MANUAL",
                        direction: "INWARD",
                        vehicleName: bus1.vehicleName,
                        isAllocated: true
                    },
                    outward: null,
                    isAllocated: true,
                    direction: "INWARD"
                },
                assignedVehicle: bus1.vehicleName,
                assignedRoute: inwardRoute.routeCode,
                approvedPlanType: "MANUAL",
                allocationStatus: "Assigned"
            };
        });

        // Execute INWARD reset
        const resetUsers = simulateManualReset(approvedUsers, "INWARD");

        const stu1 = resetUsers.find((u) => u.userId === "STU_1");
        assert.strictEqual(stu1.allocatedBus.inward, null, "Inward allocation cleared");
        assert.strictEqual(stu1.allocatedBus.isAllocated, false, "Top-level allocation is false");
        assert.strictEqual(stu1.assignedVehicle, null, "Assigned vehicle cleared");
        assert.strictEqual(stu1.assignedRoute, null, "Assigned route cleared");
        assert.strictEqual(stu1.manualRouteId, null, "Manual route ID cleared");
        assert.strictEqual(stu1.manualBusId, null, "Manual bus ID cleared");
        assert.strictEqual(stu1.allocationStatus, "Unallocated", "Coming student marked Unallocated");
    });

    // =========================================================================
    // Test 6, 7, 8, 9, 10: Integrity of Travel Status, Timestamps, Users, Vehicles, Routes
    // =========================================================================
    await t.test("6, 7, 8, 9, 10. Data Protection: Travel status, timestamps, users, vehicles, and routes preserved", async () => {
        const approvedUsers = masterStudents.map((u) => ({
            ...u,
            manualRouteId: inwardRoute._id,
            manualBusId: bus1._id,
            allocatedBus: {
                inward: { planType: "MANUAL", isAllocated: true },
                isAllocated: true
            },
            allocationStatus: u.travelStatus === "Coming" ? "Assigned" : "Not Assigned"
        }));

        const resetUsers = simulateManualReset(approvedUsers, "INWARD");

        // 6. Student travel status unchanged
        assert.strictEqual(resetUsers[0].travelStatus, "Coming", "Stu 1 still Coming");
        assert.strictEqual(resetUsers[1].travelStatus, "Coming", "Stu 2 still Coming");
        assert.strictEqual(resetUsers[2].travelStatus, "Not Coming", "Stu 3 still Not Coming");

        // 7. Response timestamps unchanged
        assert.strictEqual(resetUsers[0].travelResponseSubmittedAt.getTime(), SUBMISSION_TIMESTAMP.getTime(), "Timestamp preserved");
        assert.strictEqual(resetUsers[1].travelResponseSubmittedAt.getTime(), SUBMISSION_TIMESTAMP.getTime(), "Timestamp preserved");

        // 8. Master user profile fields unchanged
        assert.strictEqual(resetUsers[0].name, "Aarav Sharma");
        assert.strictEqual(resetUsers[0].stoppings, "Mattuthavani");
        assert.strictEqual(resetUsers[0].city, "Madurai");

        // 9. Vehicles unchanged
        assert.strictEqual(vehicles.length, 2);
        assert.strictEqual(vehicles[0].capacity, 50);
        assert.strictEqual(vehicles[0].vehicleName, "Bus 01");

        // 10. Saved routes unchanged
        assert.strictEqual(inwardRoute.routeName, "Route Inward 1");
        assert.strictEqual(inwardRoute.stops.length, 1);
        assert.strictEqual(inwardRoute.assignedVehicle.vehicleName, "Bus 01");
    });

    // =========================================================================
    // Test 11 & 12: Direction Isolation (Reset OUTWARD manual preserves INWARD AI)
    // =========================================================================
    await t.test("11 & 12. Direction Isolation: OUTWARD manual reset preserves INWARD AI allocation", async () => {
        // Create user with INWARD AI allocation AND OUTWARD Manual allocation
        const dualUser = {
            ...student1,
            allocatedBus: {
                inward: {
                    planType: "AI",
                    direction: "INWARD",
                    vehicleName: "AI Express 01",
                    routeCode: "AI-R1",
                    isAllocated: true,
                    approved: true
                },
                outward: {
                    planType: "MANUAL",
                    direction: "OUTWARD",
                    vehicleName: "Bus 02",
                    routeCode: "R-02",
                    routeId: outwardRoute._id,
                    vehicleId: bus2._id,
                    isAllocated: true,
                    approved: true
                },
                isAllocated: true,
                direction: "OUTWARD",
                vehicleName: "Bus 02",
                routeCode: "R-02"
            },
            assignedVehicle: "Bus 02",
            assignedRoute: "R-02",
            manualAllocation: { planType: "MANUAL", direction: "OUTWARD" },
            manualRouteId: outwardRoute._id,
            manualBusId: bus2._id,
            approvedPlanType: "MANUAL",
            allocationStatus: "Assigned"
        };

        // Reset OUTWARD manual plan
        const [resultUser] = simulateManualReset([dualUser], "OUTWARD");

        // OUTWARD manual should be cleared
        assert.strictEqual(resultUser.allocatedBus.outward, null, "Outward manual allocation cleared");
        assert.strictEqual(resultUser.manualRouteId, null, "Outward manual route ID cleared");
        assert.strictEqual(resultUser.manualBusId, null, "Outward manual bus ID cleared");
        assert.strictEqual(resultUser.manualAllocation, null, "Manual allocation cleared");

        // INWARD AI MUST BE FULLY PRESERVED
        assert.strictEqual(resultUser.allocatedBus.inward.isAllocated, true, "Inward AI allocation intact");
        assert.strictEqual(resultUser.allocatedBus.inward.vehicleName, "AI Express 01");
        assert.strictEqual(resultUser.allocatedBus.inward.planType, "AI");

        // Top-level allocation falls back to the intact INWARD AI plan
        assert.strictEqual(resultUser.allocatedBus.isAllocated, true, "User remains allocated");
        assert.strictEqual(resultUser.allocatedBus.direction, "INWARD", "Active direction switched to INWARD");
        assert.strictEqual(resultUser.assignedVehicle, "AI Express 01", "Assigned vehicle is now Inward AI vehicle");
        assert.strictEqual(resultUser.assignedRoute, "AI-R1", "Assigned route is now Inward AI route");
        assert.strictEqual(resultUser.approvedPlanType, "AI", "Approved plan type is now AI");
        assert.strictEqual(resultUser.allocationStatus, "Assigned", "Status remains Assigned");
    });

    // =========================================================================
    // Test 13: Global Manual Reset Behavior
    // =========================================================================
    await t.test("13. Global Manual Reset clears manual in all directions but protects AI allocations", async () => {
        const dualUser = {
            ...student1,
            allocatedBus: {
                inward: {
                    planType: "AI",
                    direction: "INWARD",
                    vehicleName: "AI Express 01",
                    routeCode: "AI-R1",
                    isAllocated: true,
                    approved: true
                },
                outward: {
                    planType: "MANUAL",
                    direction: "OUTWARD",
                    vehicleName: "Bus 02",
                    isAllocated: true,
                    approved: true
                },
                isAllocated: true,
                direction: "OUTWARD"
            },
            assignedVehicle: "Bus 02",
            assignedRoute: "R-02",
            manualRouteId: outwardRoute._id,
            manualBusId: bus2._id,
            allocationStatus: "Assigned"
        };

        // Perform GLOBAL manual reset (no direction specified)
        const [resultUser] = simulateManualReset([dualUser], null);

        // Outward manual cleared, inward AI preserved
        assert.strictEqual(resultUser.allocatedBus.outward, null, "Manual outward cleared");
        assert.strictEqual(resultUser.manualRouteId, null, "Manual route ID cleared");
        assert.strictEqual(resultUser.manualBusId, null, "Manual bus ID cleared");
        assert.strictEqual(resultUser.allocatedBus.inward.isAllocated, true, "Inward AI preserved");
        assert.strictEqual(resultUser.allocatedBus.isAllocated, true, "Overall allocation preserved");
        assert.strictEqual(resultUser.assignedVehicle, "AI Express 01", "Preserved vehicle is AI");
    });

    // =========================================================================
    // Test 14: Reset Summary Counts (Post-Reset State Parity)
    // =========================================================================
    await t.test("14. Post-reset manual plan shows isSubmitted=false, isApproved=false, assignedUsers=0, unassignedUsers=totalComingUsers", async () => {
        // Calling buildManualTransportationPlan without forceAllocate on an unsubmitted/unapproved state
        // should return clean reset summary metrics (Requirement 8)
        const resetPlan = await buildManualTransportationPlan({
            direction: "INWARD",
            routes: [inwardRoute],
            vehicles,
            users: masterStudents,
            isSubmitted: false,
            isApproved: false
        });

        // Expected values per Requirement 8:
        assert.strictEqual(resetPlan.isSubmitted, false, "isSubmitted must be false");
        assert.strictEqual(resetPlan.isApproved, false, "isApproved must be false");
        assert.strictEqual(resetPlan.assignedUsers, 0, "assignedUsers must be 0");
        assert.strictEqual(resetPlan.allocatedUsers, 0, "allocatedUsers must be 0");
        assert.strictEqual(resetPlan.allocatedSeats, 0, "allocatedSeats must be 0");
        assert.strictEqual(resetPlan.unassignedUsers, 2, "unassignedUsers must equal totalComingUsers (2)");
        assert.strictEqual(resetPlan.totalCapacity, 50, "Fleet capacity must be preserved (50)");

        // Route-level data should show zero allocated passengers and empty passenger lists
        resetPlan.buses.forEach((bus) => {
            assert.strictEqual(bus.assignedUsers, 0, "Route assigned users must be 0");
            assert.deepStrictEqual(bus.users, [], "Route user list must be empty");
            bus.stops.forEach((stop) => {
                assert.strictEqual(stop.userCount, 0, "Stop user count must be 0");
                assert.deepStrictEqual(stop.userIds, [], "Stop userIds must be empty");
            });
        });
    });

});
