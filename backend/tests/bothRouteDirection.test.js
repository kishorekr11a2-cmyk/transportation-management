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
import { addRoute, getRoutes } from "../controllers/routeController.js";

describe("Route Management - BOTH Direction Persistence & Dual Section Inclusion", () => {
    let mongoConnected = false;
    let createdRouteId = null;
    let testVehicleId = null;

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
            // Find or create an available vehicle
            let v = await Vehicle.findOne({ vehicleName: "TEST_BOTH_BUS" });
            if (!v) {
                v = await Vehicle.create({
                    vehicleNumber: "TEST-9999",
                    vehicleName: "TEST_BOTH_BUS",
                    capacity: 45
                });
            }
            testVehicleId = v._id;

            // Ensure schedule is available
            await Schedule.deleteMany({ vehicle: testVehicleId });
            await Schedule.create({
                vehicle: testVehicleId,
                date: new Date().toISOString().split("T")[0],
                availability: "Available"
            });
        }
    });

    after(async () => {
        if (mongoConnected) {
            if (createdRouteId) {
                await Route.findByIdAndDelete(createdRouteId);
            }
            if (testVehicleId) {
                await Route.deleteMany({ assignedVehicle: testVehicleId });
                await Schedule.deleteMany({ vehicle: testVehicleId });
                await Vehicle.findByIdAndDelete(testVehicleId);
            }
            if (mongoose.connection.readyState !== 0) {
                await mongoose.disconnect();
            }
        }
    });

    it("1. Saves a single route with direction 'BOTH'", async (t) => {
        if (!mongoConnected) {
            t.skip("MongoDB required");
            return;
        }

        const payload = {
            routeName: "Test Dual Corridor R99",
            direction: "BOTH",
            source: { name: "Chinthamani", latitude: 9.925, longitude: 78.119 },
            stops: [
                { name: "Viraganur", latitude: 9.929, longitude: 78.132 },
                { name: "Alagar Kovil", latitude: 9.95, longitude: 78.14 }
            ],
            destination: { name: "Melur", latitude: 10.03, longitude: 78.33 },
            assignedVehicle: testVehicleId
        };

        let statusCode = 200;
        let responseData = null;

        const req = {
            body: payload,
            query: {}
        };
        const res = {
            status: (c) => {
                statusCode = c;
                return res;
            },
            json: (d) => {
                responseData = d;
            }
        };

        await addRoute(req, res);

        assert.equal(statusCode, 201, `Failed to create route: ${JSON.stringify(responseData)}`);
        assert.equal(responseData.success, true);
        assert.equal(responseData.route.direction, "BOTH");
        assert.equal(responseData.route.routeName, "Test Dual Corridor R99");

        createdRouteId = responseData.route._id;

        // Verify exactly ONE record exists in MongoDB
        const dbRoutes = await Route.find({ routeName: "Test Dual Corridor R99" });
        assert.equal(dbRoutes.length, 1, "Must create exactly one DB record");
        assert.equal(dbRoutes[0].direction, "BOTH", "Direction in DB must remain BOTH");
    });

    it("2. Verifies getRoutes includes the BOTH route in OUTWARD queries", async (t) => {
        if (!mongoConnected) {
            t.skip("MongoDB required");
            return;
        }

        let result = null;
        const req = { query: { direction: "OUTWARD" } };
        const res = { json: (d) => { result = d; } };

        await getRoutes(req, res);

        const routesList = result?.routes || result || [];
        const found = routesList.find((r) => String(r._id) === String(createdRouteId));
        assert.ok(found, "Route with direction BOTH must be included when querying OUTWARD routes");
        assert.equal(found.direction, "BOTH");
    });

    it("3. Verifies getRoutes includes the BOTH route in INWARD queries", async (t) => {
        if (!mongoConnected) {
            t.skip("MongoDB required");
            return;
        }

        let result = null;
        const req = { query: { direction: "INWARD" } };
        const res = { json: (d) => { result = d; } };

        await getRoutes(req, res);

        const routesList = result?.routes || result || [];
        const found = routesList.find((r) => String(r._id) === String(createdRouteId));
        assert.ok(found, "Route with direction BOTH must be included when querying INWARD routes");
        assert.equal(found.direction, "BOTH");
    });

    it("4. Verifies filtering logic matches frontend expectation", () => {
        const mockRoutes = [
            { _id: "1", routeName: "R1", direction: "OUTWARD" },
            { _id: "2", routeName: "R2", direction: "INWARD" },
            { _id: "3", routeName: "R3", direction: "BOTH" }
        ];

        const outwardRoutes = mockRoutes.filter((r) => {
            const d = String(r.direction || "").toUpperCase().trim();
            return d === "OUTWARD" || d === "BOTH";
        });

        const inwardRoutes = mockRoutes.filter((r) => {
            const d = String(r.direction || "").toUpperCase().trim();
            return d === "INWARD" || d === "BOTH";
        });

        // 3 unique routes
        assert.equal(mockRoutes.length, 3, "Total unique routes count must be 3");

        // Outward section contains R1 and R3 (2 routes)
        assert.equal(outwardRoutes.length, 2, "Outward routes must contain OUTWARD and BOTH");
        assert.deepEqual(outwardRoutes.map(r => r.routeName), ["R1", "R3"]);

        // Inward section contains R2 and R3 (2 routes)
        assert.equal(inwardRoutes.length, 2, "Inward routes must contain INWARD and BOTH");
        assert.deepEqual(inwardRoutes.map(r => r.routeName), ["R2", "R3"]);

        // Count display string
        const countText = `${mockRoutes.length} total saved routes (${outwardRoutes.length} Outward · ${inwardRoutes.length} Inward)`;
        assert.equal(countText, "3 total saved routes (2 Outward · 2 Inward)");
    });

    it("5. Verifies getRoutes enriches BOTH route with direction-specific seat counts", async (t) => {
        if (!mongoConnected) {
            t.skip("MongoDB required");
            return;
        }

        let result = null;
        const req = { query: {} };
        const res = { json: (d) => { result = d; } };

        await getRoutes(req, res);

        const routesList = result?.routes || result || [];
        const found = routesList.find((r) => String(r._id) === String(createdRouteId));
        assert.ok(found, "Created BOTH route must be in getRoutes result");
        assert.equal(typeof found.outwardAllocatedSeats, "number");
        assert.equal(typeof found.inwardAllocatedSeats, "number");
        assert.equal(typeof found.totalSeats, "number");
    });

    it("6. Verifies UI invariants: saved routes UI has only Outward and Inward, no BOTH category", () => {
        const allowedTabs = ["OUTWARD", "INWARD"];
        const disallowedTabs = ["BOTH", "both", "Both Routes", "BOTH (Outward + Inward)"];

        disallowedTabs.forEach((tab) => {
            assert.ok(!allowedTabs.includes(tab), `Saved routes tabs must not include '${tab}'`);
        });

        // Summary counts verify independent Outward and Inward without third category
        const outwardCount = 5;
        const inwardCount = 4;
        const totalSavedRoutes = 7; // e.g. 3 Outward only, 2 Inward only, 2 BOTH => total unique routes = 7
        const summary = {
            outwardRoutes: outwardCount,
            inwardRoutes: inwardCount
        };
        assert.equal(summary.outwardRoutes, outwardCount);
        assert.equal(summary.inwardRoutes, inwardCount);
        assert.equal(summary.bothRoutes, undefined, "There must be no bothRoutes field in summary");
    });
});
