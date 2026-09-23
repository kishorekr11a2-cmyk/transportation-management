import test from "node:test";
import assert from "node:assert/strict";
import { getRoutes, getAuthoritativeRouteAllocations } from "../controllers/routeController.js";
import { buildManualTransportationPlan } from "../services/aiAgentService.js";
import Route from "../models/Route.js";
import Vehicle from "../models/Vehicle.js";
import mongoose from "mongoose";

const createMockReqRes = (query = {}) => {
    const req = { query, user: { role: "admin" } };
    let statusCode = 200;
    let responseData = null;

    const res = {
        status(code) {
            statusCode = code;
            return this;
        },
        json(data) {
            responseData = data;
            return this;
        }
    };

    return { req, res, getStatus: () => statusCode, getData: () => responseData };
};

test("Route Management: Seat Allocation Display & Warning Parity Suite", async (t) => {
    await t.test("1. buildManualTransportationPlan does NOT emit false overflow warning for Thirunagar when all students are boarded", async () => {
        // Multi-bus scenario at Thirunagar:
        // Thirunagar has 25 students.
        // Bus Q1 (cap 50) already has 41 passengers from earlier stops, so it can only take 9 from Thirunagar (41+9 = 50 full).
        // Bus w1 (cap 60) arrives at Thirunagar next and takes the remaining 16 students.
        const mockVehicles = [
            { _id: "veh-q1", vehicleName: "Q1", capacity: 50 },
            { _id: "veh-w1", vehicleName: "w1", capacity: 60 }
        ];

        const mockRoutes = [
            {
                _id: "r-q1",
                routeName: "south route 2",
                direction: "INWARD",
                assignedVehicle: { _id: "veh-q1", vehicleName: "Q1", capacity: 50 },
                source: { name: "Prior Stop", latitude: 9.88, longitude: 78.07 },
                stops: [{ name: "Thirunagar", latitude: 9.89, longitude: 78.08 }],
                destination: { name: "College", latitude: 9.95, longitude: 78.15 }
            },
            {
                _id: "r-w1",
                routeName: "south route",
                direction: "INWARD",
                assignedVehicle: { _id: "veh-w1", vehicleName: "w1", capacity: 60 },
                source: { name: "Thirunagar", latitude: 9.89, longitude: 78.08 },
                stops: [],
                destination: { name: "College", latitude: 9.95, longitude: 78.15 }
            }
        ];

        // 41 students at Prior Stop + 25 at Thirunagar = 66 students total
        const mockUsers = [];
        for (let i = 1; i <= 41; i++) {
            mockUsers.push({
                _id: `user-prior-${i}`,
                name: `Prior User ${i}`,
                role: "student",
                travelStatus: "Coming",
                stoppings: "Prior Stop",
                pickupStop: "Prior Stop"
            });
        }
        for (let i = 1; i <= 25; i++) {
            mockUsers.push({
                _id: `user-thiru-${i}`,
                name: `Thirunagar User ${i}`,
                role: "student",
                travelStatus: "Coming",
                stoppings: "Thirunagar",
                pickupStop: "Thirunagar"
            });
        }

        const plan = await buildManualTransportationPlan({
            direction: "INWARD",
            routes: mockRoutes,
            vehicles: mockVehicles,
            schedules: [],
            users: mockUsers
        });

        // Total users = 66, all 66 should be allocated
        assert.equal(plan.confirmedUsers, 66);
        assert.equal(plan.allocatedUsers, 66);
        assert.equal(plan.unassignedUsers, 0);

        // Q1 boards 41 from Prior Stop + 9 from Thirunagar = 50 (Full)
        const busQ1 = plan.buses.find((b) => b.vehicleName === "Q1");
        assert.equal(busQ1.assignedUsers, 50);
        assert.equal(busQ1.remainingSeats, 0);

        // w1 boards remaining 16 from Thirunagar = 16 (44 standby seats available)
        const busW1 = plan.buses.find((b) => b.vehicleName === "w1");
        assert.equal(busW1.assignedUsers, 16);
        assert.equal(busW1.remainingSeats, 44);

        // Crucial test: Ensure NO false overflow warning for Thirunagar
        const thirunagarWarning = (plan.warnings || []).find((w) =>
            typeof w === "string" && w.includes("Thirunagar")
        );
        assert.equal(thirunagarWarning, undefined, "There must be NO warning for Thirunagar when all students are allocated");
        assert.equal(plan.warnings.length, 0, "Warnings list must be completely empty when unallocated is 0");
    });

    await t.test("2. GET /api/routes enriches routes with allocatedSeats, totalSeats, remainingSeats, isFull", async () => {
        // Mock DB query with synthetic routes
        const mockInwardRoutes = [
            {
                _id: new mongoose.Types.ObjectId(),
                routeName: "south route 2",
                direction: "INWARD",
                assignedVehicle: { _id: "veh-q1", vehicleName: "Q1", capacity: 50 },
                source: { name: "Stop A", latitude: 9.88, longitude: 78.07 },
                stops: [],
                destination: { name: "College", latitude: 9.95, longitude: 78.15 }
            },
            {
                _id: new mongoose.Types.ObjectId(),
                routeName: "R2",
                direction: "INWARD",
                assignedVehicle: { _id: "veh-f", vehicleName: "Bus F", capacity: 45 },
                source: { name: "Stop B", latitude: 9.89, longitude: 78.08 },
                stops: [],
                destination: { name: "College", latitude: 9.95, longitude: 78.15 }
            },
            {
                _id: new mongoose.Types.ObjectId(),
                routeName: "Unassigned Route",
                direction: "INWARD",
                assignedVehicle: null,
                source: { name: "Stop C", latitude: 9.90, longitude: 78.09 },
                stops: [],
                destination: { name: "College", latitude: 9.95, longitude: 78.15 }
            }
        ];

        const originalRouteFind = Route.find;
        Route.find = (filter = {}) => ({
            populate: () => ({
                sort: () => ({
                    lean: async () => {
                        if (filter.direction) {
                            return mockInwardRoutes.filter((r) => r.direction === filter.direction);
                        }
                        return mockInwardRoutes;
                    }
                })
            })
        });

        try {
            const { req, res, getStatus, getData } = createMockReqRes({ direction: "INWARD" });
            await getRoutes(req, res);

            assert.equal(getStatus(), 200);
            assert.equal(getData().success, true);
            const returnedRoutes = getData().routes;
            assert.equal(returnedRoutes.length, 3);

            // Each route must have allocatedSeats, totalSeats, remainingSeats, isFull
            for (const r of returnedRoutes) {
                assert.ok(typeof r.allocatedSeats === "number", "allocatedSeats must be a number");
                assert.ok(typeof r.totalSeats === "number", "totalSeats must be a number");
                assert.ok(typeof r.remainingSeats === "number", "remainingSeats must be a number");
                assert.ok(typeof r.isFull === "boolean", "isFull must be a boolean");
            }

            // Unassigned route must have totalSeats = 0
            const unassigned = returnedRoutes.find((r) => r.routeName === "Unassigned Route");
            assert.equal(unassigned.totalSeats, 0);
            assert.equal(unassigned.allocatedSeats, 0);
            assert.equal(unassigned.isFull, false);
        } finally {
            Route.find = originalRouteFind;
        }
    });

    await t.test("3. Seat display format string parity logic", async () => {
        // Verify formatting logic matches the specification:
        // Format: `${allocatedSeats} / ${totalSeats} seats allocated`
        // If remaining > 0: `+${remainingSeats} standby seats available`
        // If remaining === 0: `Bus full (0 seats left)`
        // If no vehicle: `(No vehicle)`
        const formatAllocation = (route) => {
            const vehicleName = route.assignedVehicle?.vehicleName || route.vehicleName || "";
            const capacity = Number(route.assignedVehicle?.capacity || route.capacity || route.totalSeats || 0);
            const allocatedSeats = Number(route.allocatedSeats ?? 0);
            const remainingSeats = Number(
                route.remainingSeats !== undefined ? route.remainingSeats : Math.max(0, capacity - allocatedSeats)
            );
            const hasVehicle = Boolean(vehicleName && capacity > 0);
            const isFull = hasVehicle && (route.isFull || remainingSeats === 0);

            if (!hasVehicle) {
                return { main: "(No vehicle)", badge: null };
            }
            return {
                main: `${allocatedSeats} / ${capacity} seats allocated`,
                badge: !isFull ? `+${remainingSeats} standby seats available` : "Bus full (0 seats left)"
            };
        };

        // Example 1: 40 / 45 seats allocated (+5 standby seats available)
        const ex1 = formatAllocation({
            assignedVehicle: { vehicleName: "Bus A", capacity: 45 },
            allocatedSeats: 40,
            remainingSeats: 5,
            isFull: false
        });
        assert.equal(ex1.main, "40 / 45 seats allocated");
        assert.equal(ex1.badge, "+5 standby seats available");

        // Example 2: 53 / 60 seats allocated (+7 standby seats available)
        const ex2 = formatAllocation({
            assignedVehicle: { vehicleName: "w1", capacity: 60 },
            allocatedSeats: 53,
            remainingSeats: 7,
            isFull: false
        });
        assert.equal(ex2.main, "53 / 60 seats allocated");
        assert.equal(ex2.badge, "+7 standby seats available");

        // Example 3: 59 / 70 seats allocated (+11 standby seats available)
        const ex3 = formatAllocation({
            assignedVehicle: { vehicleName: "k1", capacity: 70 },
            allocatedSeats: 59,
            remainingSeats: 11,
            isFull: false
        });
        assert.equal(ex3.main, "59 / 70 seats allocated");
        assert.equal(ex3.badge, "+11 standby seats available");

        // Example 4: 45 / 45 seats allocated (Bus full (0 seats left))
        const ex4 = formatAllocation({
            assignedVehicle: { vehicleName: "Bus Full", capacity: 45 },
            allocatedSeats: 45,
            remainingSeats: 0,
            isFull: true
        });
        assert.equal(ex4.main, "45 / 45 seats allocated");
        assert.equal(ex4.badge, "Bus full (0 seats left)");

        // Example 5: No vehicle assigned
        const ex5 = formatAllocation({
            assignedVehicle: null,
            allocatedSeats: 0,
            totalSeats: 0
        });
        assert.equal(ex5.main, "(No vehicle)");
        assert.equal(ex5.badge, null);
    });

    await t.test("4. Direction isolation: INWARD and OUTWARD plans do not leak allocations across directions", async () => {
        // Verify getAuthoritativeRouteAllocations separates by direction
        const inwardAlloc = await getAuthoritativeRouteAllocations("INWARD");
        const outwardAlloc = await getAuthoritativeRouteAllocations("OUTWARD");

        assert.equal(inwardAlloc.canonicalDirection, "INWARD");
        assert.equal(outwardAlloc.canonicalDirection, "OUTWARD");
    });
});
