import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve("backend", ".env") });
dotenv.config();

import mongoose from "mongoose";
import Route from "../models/Route.js";
import Vehicle from "../models/Vehicle.js";
import Schedule from "../models/Schedule.js";
import { addRoute, getRoutes, updateRoute, deleteRoute } from "../controllers/routeController.js";

describe("Comprehensive BOTH Route Behavior & Parity Verification", () => {
    let mongoConnected = false;
    let vehicleA = null;
    let vehicleB = null;
    let vehicleC = null;
    let routeOutwardId = null;
    let routeInwardId = null;
    let routeBothId = null;

    before(async () => {
        const mongoUri = process.env.MONGO_URI;
        if (mongoUri && mongoose.connection.readyState === 0) {
            try {
                await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 8000 });
                mongoConnected = mongoose.connection.readyState === 1;
            } catch (err) {
                console.warn("[TEST_SETUP] Mongo connection warning:", err.message);
            }
        } else if (mongoose.connection.readyState === 1) {
            mongoConnected = true;
        }

        if (mongoConnected) {
            // Clean up any stale test vehicles / routes
            await Route.deleteMany({ routeName: /^VERIFY_TEST_/ });
            await Vehicle.deleteMany({ vehicleName: /^VERIFY_BUS_/ });

            // Create test vehicles
            vehicleA = await Vehicle.create({ vehicleNumber: "V-TEST-A", vehicleName: "VERIFY_BUS_A", capacity: 40 });
            vehicleB = await Vehicle.create({ vehicleNumber: "V-TEST-B", vehicleName: "VERIFY_BUS_B", capacity: 50 });
            vehicleC = await Vehicle.create({ vehicleNumber: "V-TEST-C", vehicleName: "VERIFY_BUS_C", capacity: 60 });

            // Make schedules available
            for (const v of [vehicleA, vehicleB, vehicleC]) {
                await Schedule.create({
                    vehicle: v._id,
                    date: new Date().toISOString().split("T")[0],
                    availability: "Available"
                });
            }
        }
    });

    after(async () => {
        if (mongoConnected) {
            await Route.deleteMany({ routeName: /^VERIFY_TEST_/ });
            if (vehicleA) await Schedule.deleteMany({ vehicle: vehicleA._id });
            if (vehicleB) await Schedule.deleteMany({ vehicle: vehicleB._id });
            if (vehicleC) await Schedule.deleteMany({ vehicle: vehicleC._id });
            await Vehicle.deleteMany({ vehicleName: /^VERIFY_BUS_/ });

            if (mongoose.connection.readyState !== 0) {
                await mongoose.disconnect();
            }
        }
    });

    function mockReqRes(body = {}, query = {}, params = {}) {
        let statusCode = 200;
        let responseData = null;
        const req = { body, query, params };
        const res = {
            status: (code) => { statusCode = code; return res; },
            json: (data) => { responseData = data; }
        };
        return { req, res, getStatus: () => statusCode, getData: () => responseData };
    }

    it("1. Creates an OUTWARD route and verifies it appears only under OUTWARD", async (t) => {
        if (!mongoConnected) { t.skip("MongoDB required"); return; }

        const { req, res, getStatus, getData } = mockReqRes({
            routeName: "VERIFY_TEST_OUTWARD_ROUTE",
            direction: "OUTWARD",
            source: { name: "College Hub", latitude: 9.92, longitude: 78.11 },
            stops: [{ name: "Stop 1", latitude: 9.93, longitude: 78.12 }],
            destination: { name: "Residential Hub A", latitude: 9.94, longitude: 78.13 },
            assignedVehicle: vehicleA._id
        });

        await addRoute(req, res);
        assert.equal(getStatus(), 201);
        assert.equal(getData().success, true);
        routeOutwardId = getData().route._id;

        // Query OUTWARD
        const qOut = mockReqRes({}, { direction: "OUTWARD" });
        await getRoutes(qOut.req, qOut.res);
        const outList = qOut.getData()?.routes || [];
        assert.ok(outList.some(r => String(r._id) === String(routeOutwardId)), "Must appear under Outward");

        // Query INWARD
        const qIn = mockReqRes({}, { direction: "INWARD" });
        await getRoutes(qIn.req, qIn.res);
        const inList = qIn.getData()?.routes || [];
        assert.ok(!inList.some(r => String(r._id) === String(routeOutwardId)), "Must NOT appear under Inward");
    });

    it("2. Creates an INWARD route and verifies it appears only under INWARD", async (t) => {
        if (!mongoConnected) { t.skip("MongoDB required"); return; }

        const { req, res, getStatus, getData } = mockReqRes({
            routeName: "VERIFY_TEST_INWARD_ROUTE",
            direction: "INWARD",
            source: { name: "Residential Hub B", latitude: 9.95, longitude: 78.14 },
            stops: [{ name: "Stop 2", latitude: 9.96, longitude: 78.15 }],
            destination: { name: "College Hub", latitude: 9.92, longitude: 78.11 },
            assignedVehicle: vehicleB._id
        });

        await addRoute(req, res);
        assert.equal(getStatus(), 201);
        assert.equal(getData().success, true);
        routeInwardId = getData().route._id;

        // Query INWARD
        const qIn = mockReqRes({}, { direction: "INWARD" });
        await getRoutes(qIn.req, qIn.res);
        const inList = qIn.getData()?.routes || [];
        assert.ok(inList.some(r => String(r._id) === String(routeInwardId)), "Must appear under Inward");

        // Query OUTWARD
        const qOut = mockReqRes({}, { direction: "OUTWARD" });
        await getRoutes(qOut.req, qOut.res);
        const outList = qOut.getData()?.routes || [];
        assert.ok(!outList.some(r => String(r._id) === String(routeInwardId)), "Must NOT appear under Outward");
    });

    it("3. Creates a BOTH route and verifies it appears in BOTH Outward and Inward lists", async (t) => {
        if (!mongoConnected) { t.skip("MongoDB required"); return; }

        const { req, res, getStatus, getData } = mockReqRes({
            routeName: "VERIFY_TEST_BOTH_ROUTE",
            direction: "BOTH",
            source: { name: "College Hub", latitude: 9.92, longitude: 78.11 },
            stops: [{ name: "Transit Stop C", latitude: 9.97, longitude: 78.16 }],
            destination: { name: "City Center C", latitude: 9.98, longitude: 78.17 },
            assignedVehicle: vehicleC._id
        });

        await addRoute(req, res);
        assert.equal(getStatus(), 201);
        assert.equal(getData().success, true);
        routeBothId = getData().route._id;

        // Verify only ONE database record was created
        const dbRoutes = await Route.find({ routeName: "VERIFY_TEST_BOTH_ROUTE" });
        assert.equal(dbRoutes.length, 1, "Must create exactly ONE database record");
        assert.equal(dbRoutes[0].direction, "BOTH");

        // Verify appears when querying OUTWARD
        const qOut = mockReqRes({}, { direction: "OUTWARD" });
        await getRoutes(qOut.req, qOut.res);
        const outList = qOut.getData()?.routes || [];
        const outFound = outList.find(r => String(r._id) === String(routeBothId));
        assert.ok(outFound, "BOTH route must appear in Outward query");
        assert.equal(outFound.assignedVehicle?.vehicleName, "VERIFY_BUS_C");

        // Verify appears when querying INWARD
        const qIn = mockReqRes({}, { direction: "INWARD" });
        await getRoutes(qIn.req, qIn.res);
        const inList = qIn.getData()?.routes || [];
        const inFound = inList.find(r => String(r._id) === String(routeBothId));
        assert.ok(inFound, "BOTH route must appear in Inward query");
        assert.equal(inFound.assignedVehicle?.vehicleName, "VERIFY_BUS_C");
    });

    it("4. Verifies total route counts and direction counts logic", async (t) => {
        if (!mongoConnected) { t.skip("MongoDB required"); return; }

        // Fetch all routes
        const qAll = mockReqRes({}, {});
        await getRoutes(qAll.req, qAll.res);
        const allRoutes = qAll.getData()?.routes || [];

        const testRoutes = allRoutes.filter(r => String(r.routeName).startsWith("VERIFY_TEST_"));
        assert.equal(testRoutes.length, 3, "Exactly 3 distinct route documents exist");

        // Outward routes: OUTWARD + BOTH => 2 routes
        const outwardRoutes = testRoutes.filter(r => {
            const d = String(r.direction || "").toUpperCase().trim();
            return d === "OUTWARD" || d === "BOTH";
        });
        assert.equal(outwardRoutes.length, 2, "Outward list must have 2 routes (OUTWARD + BOTH)");

        // Inward routes: INWARD + BOTH => 2 routes
        const inwardRoutes = testRoutes.filter(r => {
            const d = String(r.direction || "").toUpperCase().trim();
            return d === "INWARD" || d === "BOTH";
        });
        assert.equal(inwardRoutes.length, 2, "Inward list must have 2 routes (INWARD + BOTH)");

        // Frontend summary formatting contract
        const summaryText = `${testRoutes.length} total saved routes (${outwardRoutes.length} Outward · ${inwardRoutes.length} Inward)`;
        assert.equal(summaryText, "3 total saved routes (2 Outward · 2 Inward)");
        assert.ok(!summaryText.includes("BOTH"), "Summary count string must not contain 'BOTH'");
    });

    it("5. Verifies updating the BOTH route maintains single-record integrity", async (t) => {
        if (!mongoConnected) { t.skip("MongoDB required"); return; }

        const { req, res, getStatus, getData } = mockReqRes({
            routeName: "VERIFY_TEST_BOTH_ROUTE_UPDATED",
            direction: "BOTH",
            source: { name: "College Hub Updated", latitude: 9.921, longitude: 78.111 },
            stops: [{ name: "Transit Stop C Updated", latitude: 9.971, longitude: 78.161 }],
            destination: { name: "City Center C Updated", latitude: 9.981, longitude: 78.171 },
            assignedVehicle: vehicleC._id
        }, {}, { id: routeBothId });

        await updateRoute(req, res);
        assert.equal(getStatus(), 200);
        assert.equal(getData().success, true);

        // Verify still exactly 1 record in database
        const dbRoutes = await Route.find({ routeName: /^VERIFY_TEST_BOTH_ROUTE/ });
        assert.equal(dbRoutes.length, 1);
        assert.equal(dbRoutes[0].routeName, "VERIFY_TEST_BOTH_ROUTE_UPDATED");
        assert.equal(dbRoutes[0].direction, "BOTH");
    });

    it("6. Verifies deleting the BOTH route cleanly removes it from both Outward and Inward views", async (t) => {
        if (!mongoConnected) { t.skip("MongoDB required"); return; }

        const { req, res, getStatus, getData } = mockReqRes({}, {}, { id: routeBothId });
        await deleteRoute(req, res);
        assert.equal(getStatus(), 200);
        assert.equal(getData().success, true);

        // Verify removed from DB
        const dbRoute = await Route.findById(routeBothId);
        assert.equal(dbRoute, null);

        // Verify removed from OUTWARD
        const qOut = mockReqRes({}, { direction: "OUTWARD" });
        await getRoutes(qOut.req, qOut.res);
        const outList = qOut.getData()?.routes || [];
        assert.ok(!outList.some(r => String(r._id) === String(routeBothId)));

        // Verify removed from INWARD
        const qIn = mockReqRes({}, { direction: "INWARD" });
        await getRoutes(qIn.req, qIn.res);
        const inList = qIn.getData()?.routes || [];
        assert.ok(!inList.some(r => String(r._id) === String(routeBothId)));
    });
});
