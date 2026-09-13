import test from "node:test";
import assert from "node:assert/strict";
import { buildManualTransportationPlan } from "../services/aiAgentService.js";
import { confirmManualPlan } from "../controllers/routeController.js";

test("Manual Plan OK Confirmation and Assigned Routes Filtering Test Suite", async (t) => {
    await t.test("1. Unassigned routes are excluded from buildManualTransportationPlan", async () => {
        const mockVehicles = [
            { _id: "veh-1", vehicleName: "Bus Alpha", capacity: 40 }
        ];

        const mockRoutes = [
            {
                _id: "r-assigned-1",
                routeName: "Main Street Line",
                direction: "INWARD",
                assignedVehicle: { _id: "veh-1", vehicleName: "Bus Alpha", capacity: 40 },
                source: { name: "City Center", latitude: 9.92, longitude: 78.11 },
                stops: [{ name: "Stop A", latitude: 9.93, longitude: 78.12 }],
                destination: { name: "College Campus", latitude: 9.95, longitude: 78.15 }
            },
            {
                _id: "r-unassigned-2",
                routeName: "Unassigned Draft Line",
                direction: "INWARD",
                assignedVehicle: null, // Unassigned!
                source: { name: "North Terminal", latitude: 9.96, longitude: 78.11 },
                stops: [],
                destination: { name: "College Campus", latitude: 9.95, longitude: 78.15 }
            }
        ];

        const mockUsers = [
            { _id: "u1", role: "student", travelStatus: "Coming", stoppings: "Stop A" }
        ];

        const plan = await buildManualTransportationPlan({
            direction: "INWARD",
            routes: mockRoutes,
            vehicles: mockVehicles,
            schedules: [],
            users: mockUsers
        });

        // Only the route with an assigned bus should be in the plan
        assert.equal(plan.buses.length, 1);
        assert.equal(plan.buses[0].routeName, "Main Street Line");
        assert.equal(plan.buses[0].vehicleName, "Bus Alpha");
        assert.equal(plan.totalRoutes, 1);
    });

    await t.test("2. Direction separation: INWARD vs OUTWARD in buildManualTransportationPlan", async () => {
        const mockRoutes = [
            {
                _id: "r-in-1",
                routeName: "Morning Inward Route",
                direction: "INWARD",
                assignedVehicle: { _id: "v-1", vehicleName: "Bus 1", capacity: 50 },
                source: { name: "A", latitude: 9.91, longitude: 78.11 },
                stops: [{ name: "B", latitude: 9.92, longitude: 78.12 }],
                destination: { name: "College", latitude: 9.95, longitude: 78.15 }
            },
            {
                _id: "r-out-1",
                routeName: "Evening Outward Route",
                direction: "OUTWARD",
                assignedVehicle: { _id: "v-2", vehicleName: "Bus 2", capacity: 50 },
                source: { name: "College", latitude: 9.95, longitude: 78.15 },
                stops: [{ name: "B", latitude: 9.92, longitude: 78.12 }],
                destination: { name: "A", latitude: 9.91, longitude: 78.11 }
            }
        ];

        const inwardPlan = await buildManualTransportationPlan({
            direction: "INWARD",
            routes: mockRoutes,
            vehicles: [],
            schedules: [],
            users: []
        });
        assert.equal(inwardPlan.buses.length, 1);
        assert.equal(inwardPlan.buses[0].routeName, "Morning Inward Route");

        const outwardPlan = await buildManualTransportationPlan({
            direction: "OUTWARD",
            routes: mockRoutes,
            vehicles: [],
            schedules: [],
            users: []
        });
        assert.equal(outwardPlan.buses.length, 1);
        assert.equal(outwardPlan.buses[0].routeName, "Evening Outward Route");
    });
});
