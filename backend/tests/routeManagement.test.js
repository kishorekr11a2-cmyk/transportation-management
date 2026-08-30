import test from "node:test";
import assert from "node:assert/strict";
import { addRoute, updateRoute, deleteRoute, getRoutes } from "../controllers/routeController.js";
import Route from "../models/Route.js";
import Vehicle from "../models/Vehicle.js";
import Schedule from "../models/Schedule.js";

// Mock helper to create synthetic request/response
const createMockReqRes = (body = {}, params = {}) => {
    const req = { body, params, user: { role: "admin" } };
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

test("Route Management: Single Builder, Schedule Availability & Allocation Suite", async (t) => {
    // Setup synthetic mock DB state for Route, Vehicle and Schedule
    const mockVehicles = [
        { _id: "veh_001", vehicleName: "A1", capacity: 70 },
        { _id: "veh_002", vehicleName: "J1", capacity: 70 },
        { _id: "veh_003", vehicleName: "Q1", capacity: 50 },
        { _id: "veh_004", vehicleName: "K1", capacity: 70 } // Unscheduled
    ];

    const mockSchedules = [
        { _id: "sch_001", vehicle: "veh_001", availability: "Available" },
        { _id: "sch_002", vehicle: "veh_002", availability: "Available" },
        { _id: "sch_003", vehicle: "veh_003", availability: "Not Available" }
    ];

    let mockRoutes = [];

    // Monkey-patch Vehicle.findById
    const originalVehicleFindById = Vehicle.findById;
    Vehicle.findById = async (id) => mockVehicles.find((v) => String(v._id) === String(id)) || null;

    // Monkey-patch Schedule.findOne
    const originalScheduleFindOne = Schedule.findOne;
    Schedule.findOne = async (query) => {
        return mockSchedules.find((s) => {
            if (query.vehicle && String(s.vehicle) === String(query.vehicle)) {
                return true;
            }
            return false;
        }) || null;
    };

    // Monkey-patch Route methods
    const originalRouteFind = Route.find;
    const originalRouteFindOne = Route.findOne;
    const originalRouteFindById = Route.findById;
    const originalRouteCreate = Route.create;
    const originalRouteFindByIdAndUpdate = Route.findByIdAndUpdate;
    const originalRouteFindByIdAndDelete = Route.findByIdAndDelete;

    Route.find = () => ({
        populate: () => ({
            sort: () => mockRoutes.map((r) => {
                const v = mockVehicles.find((vh) => String(vh._id) === String(r.assignedVehicle));
                return { ...r, assignedVehicle: v || null };
            })
        })
    });

    Route.findOne = async (query) => {
        return mockRoutes.find((r) => {
            if (query.assignedVehicle && String(r.assignedVehicle) === String(query.assignedVehicle)) {
                if (query._id && query._id.$ne && String(r._id) === String(query._id.$ne)) {
                    return false;
                }
                return true;
            }
            if (query.routeName) {
                if (query.routeName instanceof RegExp && query.routeName.test(r.routeName)) {
                    if (query._id && query._id.$ne && String(r._id) === String(query._id.$ne)) {
                        return false;
                    }
                    return true;
                }
            }
            return false;
        }) || null;
    };

    Route.findById = (id) => ({
        populate: async () => {
            const r = mockRoutes.find((rt) => String(rt._id) === String(id));
            if (!r) return null;
            const v = mockVehicles.find((vh) => String(vh._id) === String(r.assignedVehicle));
            return { ...r, assignedVehicle: v || null };
        }
    });

    Route.create = async (doc) => {
        const newRoute = { _id: `route_${mockRoutes.length + 1}`, ...doc, createdAt: new Date() };
        mockRoutes.push(newRoute);
        return newRoute;
    };

    Route.findByIdAndUpdate = (id, update) => ({
        populate: async () => {
            const index = mockRoutes.findIndex((r) => String(r._id) === String(id));
            if (index === -1) return null;
            mockRoutes[index] = { ...mockRoutes[index], ...update };
            const updated = mockRoutes[index];
            const v = mockVehicles.find((vh) => String(vh._id) === String(updated.assignedVehicle));
            return { ...updated, assignedVehicle: v || null };
        }
    });

    Route.findByIdAndDelete = async (id) => {
        const index = mockRoutes.findIndex((r) => String(r._id) === String(id));
        if (index === -1) return null;
        const deleted = mockRoutes.splice(index, 1)[0];
        return deleted;
    };

    t.after(() => {
        Vehicle.findById = originalVehicleFindById;
        Schedule.findOne = originalScheduleFindOne;
        Route.find = originalRouteFind;
        Route.findOne = originalRouteFindOne;
        Route.findById = originalRouteFindById;
        Route.create = originalRouteCreate;
        Route.findByIdAndUpdate = originalRouteFindByIdAndUpdate;
        Route.findByIdAndDelete = originalRouteFindByIdAndDelete;
    });

    await t.test("1. Create Route 1 with Scheduled & Available Vehicle A1, Source, Stops, and Destination", async () => {
        const payload = {
            routeName: "Route 1",
            source: { name: "Periyar Bus Stand", latitude: 9.919, longitude: 78.118 },
            stops: [
                { name: "SIMMAKKAL", latitude: 9.927, longitude: 78.121 },
                { name: "Goripalayam", latitude: 9.931, longitude: 78.129 }
            ],
            destination: { name: "Arappalayam", latitude: 9.935, longitude: 78.104 },
            assignedVehicle: "veh_001"
        };

        const { req, res, getStatus, getData } = createMockReqRes(payload);
        await addRoute(req, res);

        assert.equal(getStatus(), 201);
        assert.equal(getData().success, true);
        assert.equal(getData().route.routeName, "Route 1");
        assert.equal(getData().route.assignedVehicle?.vehicleName, "A1");
        assert.equal(getData().route.stops.length, 2);
        assert.equal(getData().route.stops[0].name, "SIMMAKKAL");
        assert.equal(getData().route.stops[1].name, "Goripalayam");
    });

    await t.test("2. Reject creating Route 2 with already-assigned Vehicle A1", async () => {
        const payload = {
            routeName: "Route 2",
            source: { name: "Mattuthavani", latitude: 9.944, longitude: 78.156 },
            stops: [{ name: "Anna Nagar", latitude: 9.922, longitude: 78.148 }],
            destination: { name: "Teppakulam", latitude: 9.916, longitude: 78.147 },
            assignedVehicle: "veh_001" // A1 already assigned to Route 1!
        };

        const { req, res, getStatus, getData } = createMockReqRes(payload);
        await addRoute(req, res);

        assert.equal(getStatus(), 400);
        assert.equal(getData().success, false);
        assert.match(getData().message, /already allocated to route "Route 1"/i);
    });

    await t.test("3. Reject assigning unscheduled vehicle (K1) to a route", async () => {
        const payload = {
            routeName: "Route Unscheduled",
            source: { name: "Mattuthavani", latitude: 9.944, longitude: 78.156 },
            stops: [],
            destination: { name: "Teppakulam", latitude: 9.916, longitude: 78.147 },
            assignedVehicle: "veh_004" // K1 has no schedule
        };

        const { req, res, getStatus, getData } = createMockReqRes(payload);
        await addRoute(req, res);

        assert.equal(getStatus(), 400);
        assert.equal(getData().success, false);
        assert.match(getData().message, /not currently scheduled as Available/i);
    });

    await t.test("4. Reject assigning scheduled but unavailable vehicle (Q1) to a route", async () => {
        const payload = {
            routeName: "Route Unavailable",
            source: { name: "Mattuthavani", latitude: 9.944, longitude: 78.156 },
            stops: [],
            destination: { name: "Teppakulam", latitude: 9.916, longitude: 78.147 },
            assignedVehicle: "veh_003" // Q1 is Not Available
        };

        const { req, res, getStatus, getData } = createMockReqRes(payload);
        await addRoute(req, res);

        assert.equal(getStatus(), 400);
        assert.equal(getData().success, false);
        assert.match(getData().message, /not currently scheduled as Available/i);
    });

    await t.test("5. Successfully create Route 2 with scheduled & available Vehicle J1", async () => {
        const payload = {
            routeName: "Route 2",
            source: { name: "Mattuthavani", latitude: 9.944, longitude: 78.156 },
            stops: [{ name: "Anna Nagar", latitude: 9.922, longitude: 78.148 }],
            destination: { name: "Teppakulam", latitude: 9.916, longitude: 78.147 },
            assignedVehicle: "veh_002" // J1
        };

        const { req, res, getStatus, getData } = createMockReqRes(payload);
        await addRoute(req, res);

        assert.equal(getStatus(), 201);
        assert.equal(getData().success, true);
        assert.equal(getData().route.assignedVehicle?.vehicleName, "J1");
    });

    await t.test("6. Reject updating Route 2 to use Vehicle A1 (which belongs to Route 1)", async () => {
        const payload = {
            routeName: "Route 2 Updated",
            source: { name: "Mattuthavani", latitude: 9.944, longitude: 78.156 },
            stops: [{ name: "Anna Nagar", latitude: 9.922, longitude: 78.148 }],
            destination: { name: "Teppakulam", latitude: 9.916, longitude: 78.147 },
            assignedVehicle: "veh_001" // A1 belongs to Route 1!
        };

        const { req, res, getStatus, getData } = createMockReqRes(payload, { id: "route_2" });
        await updateRoute(req, res);

        assert.equal(getStatus(), 400);
        assert.equal(getData().success, false);
        assert.match(getData().message, /already allocated to route "Route 1"/i);
    });

    await t.test("7. Allow Route 1 to retain its own Vehicle A1 upon update", async () => {
        const payload = {
            routeName: "Route 1 - Extended",
            source: { name: "Periyar Bus Stand", latitude: 9.919, longitude: 78.118 },
            stops: [
                { name: "SIMMAKKAL", latitude: 9.927, longitude: 78.121 },
                { name: "Goripalayam", latitude: 9.931, longitude: 78.129 },
                { name: "Bibikulam", latitude: 9.938, longitude: 78.134 }
            ],
            destination: { name: "Arappalayam", latitude: 9.935, longitude: 78.104 },
            assignedVehicle: "veh_001" // Self vehicle
        };

        const { req, res, getStatus, getData } = createMockReqRes(payload, { id: "route_1" });
        await updateRoute(req, res);

        assert.equal(getStatus(), 200);
        assert.equal(getData().success, true);
        assert.equal(getData().route.routeName, "Route 1 - Extended");
        assert.equal(getData().route.stops.length, 3);
        assert.equal(getData().route.assignedVehicle?.vehicleName, "A1");
    });

    await t.test("8. Delete Route 1 and verify Vehicle A1 becomes available for Route 2", async () => {
        const { req: delReq, res: delRes, getStatus: getDelStatus } = createMockReqRes({}, { id: "route_1" });
        await deleteRoute(delReq, delRes);
        assert.equal(getDelStatus(), 200);

        // Now Route 2 can claim Vehicle A1 without conflict
        const updatePayload = {
            routeName: "Route 2",
            source: { name: "Mattuthavani", latitude: 9.944, longitude: 78.156 },
            stops: [{ name: "Anna Nagar", latitude: 9.922, longitude: 78.148 }],
            destination: { name: "Teppakulam", latitude: 9.916, longitude: 78.147 },
            assignedVehicle: "veh_001" // A1 is now free!
        };

        const { req, res, getStatus, getData } = createMockReqRes(updatePayload, { id: "route_2" });
        await updateRoute(req, res);

        assert.equal(getStatus(), 200);
        assert.equal(getData().success, true);
        assert.equal(getData().route.assignedVehicle?.vehicleName, "A1");
    });

    await t.test("9. Reject invalid routes (missing source, missing destination, invalid coords)", async () => {
        // Missing source
        const { req: req1, res: res1, getStatus: s1, getData: d1 } = createMockReqRes({
            routeName: "Invalid Route",
            destination: { name: "Dest", latitude: 9.9, longitude: 78.1 }
        });
        await addRoute(req1, res1);
        assert.equal(s1(), 400);
        assert.match(d1().message, /valid stops/i);

        // Missing destination
        const { req: req2, res: res2, getStatus: s2, getData: d2 } = createMockReqRes({
            routeName: "Invalid Route",
            source: { name: "Src", latitude: 9.9, longitude: 78.1 }
        });
        await addRoute(req2, res2);
        assert.equal(s2(), 400);
        assert.match(d2().message, /valid stops/i);

        // Invalid stop coordinates
        const { req: req3, res: res3, getStatus: s3, getData: d3 } = createMockReqRes({
            routeName: "Invalid Stop Route",
            source: { name: "Src", latitude: 9.9, longitude: 78.1 },
            stops: [{ name: "Bad Stop", latitude: "NaN", longitude: 78.1 }],
            destination: { name: "Dest", latitude: 9.9, longitude: 78.1 }
        });
        await addRoute(req3, res3);
        assert.equal(s3(), 400);
        assert.match(d3().message, /invalid coordinates/i);
    });
});
