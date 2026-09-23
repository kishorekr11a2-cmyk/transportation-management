import test from "node:test";
import assert from "node:assert/strict";
import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import User from "../models/User.js";
import AiPlan from "../models/AiPlan.js";
import Vehicle from "../models/Vehicle.js";
import InwardStartingPlace from "../models/InwardStartingPlace.js";
import connectDB from "../config/db.js";
import {
    getActiveAIPlan,
    saveSelectedPlan,
    resetGeneratedAIRoute,
    clearActiveAIPlanCache
} from "../services/aiAgentService.js";
import { uploadExcel } from "../controllers/excelController.js";
import xlsx from "xlsx";

test("STALE PLAN AND RESET SAFETY TEST SUITE", async (t) => {
    await connectDB();

    // Setup master data needed for testing
    let sampleVehicle = await Vehicle.findOne({ status: "Available" }) || await Vehicle.findOne({ vehicleName: "Test Bus 1" });
    if (!sampleVehicle) {
        sampleVehicle = await Vehicle.create({
            vehicleNumber: `TEST-BUS-${Date.now()}`,
            vehicleName: `Test Bus ${Date.now()}`,
            busNumber: `TB-${Date.now()}`,
            capacity: 50,
            status: "Available"
        });
    }

    let sampleStartingPlace = await InwardStartingPlace.findOne();
    if (!sampleStartingPlace) {
        sampleStartingPlace = await InwardStartingPlace.create({
            name: "Central Bus Stand",
            latitude: 9.9252,
            longitude: 78.1198,
            order: 1
        });
    }

    await t.test("1. Demand Mismatch: Plan for 205 users is detected as STALE when demand is 400", async () => {
        clearActiveAIPlanCache();

        // Step A: Seed 205 Coming users
        await User.deleteMany({ role: "student" });
        const students205 = [];
        for (let i = 1; i <= 205; i++) {
            students205.push({
                userId: `STU-205-${i}`,
                name: `Student 205 ${i}`,
                stoppings: "Central Bus Stand",
                role: "student",
                travelStatus: "Coming"
            });
        }
        await User.insertMany(students205);

        const count205 = await User.countDocuments({ role: "student", travelStatus: "Coming" });
        assert.equal(count205, 205, "Should have 205 Coming students");

        // Step B: Create an active AI plan generated for 205 users
        await AiPlan.deleteMany({ direction: "INWARD" });
        if (mongoose.connection?.db) {
            await mongoose.connection.db.collection("ai_selected_plans").deleteMany({ direction: "INWARD" });
        }

        const plan205 = await AiPlan.create({
            planType: "AI",
            direction: "INWARD",
            tripMode: "TO_DESTINATION",
            active: true,
            status: "active",
            summary: {
                confirmedUsers: 205,
                allocatedSeats: 205,
                assignedUsers: 205,
                totalBuses: 4
            },
            aiPlan: {
                comingUsers: 205,
                allocatedUsers: 205,
                direction: "INWARD",
                buses: [
                    {
                        busId: sampleVehicle._id,
                        busNumber: "TB-01",
                        capacity: 55,
                        users: students205.slice(0, 50).map(s => ({ userId: s.userId }))
                    }
                ]
            }
        });

        // Step C: Verify that getActiveAIPlan returns this plan when demand is 205
        clearActiveAIPlanCache();
        const activeResInitial = await getActiveAIPlan({ direction: "INWARD", forceRefresh: true });
        assert.equal(activeResInitial.success, true);
        assert.ok(activeResInitial.inwardPlan, "Inward plan should be active when demand matches 205");
        assert.equal(activeResInitial.inwardPlan.isStale, false);

        // Step D: Change current demand to 400
        const extraStudents = [];
        for (let i = 206; i <= 400; i++) {
            extraStudents.push({
                userId: `STU-400-${i}`,
                name: `Student 400 ${i}`,
                stoppings: "Central Bus Stand",
                role: "student",
                travelStatus: "Coming"
            });
        }
        await User.insertMany(extraStudents);

        const count400 = await User.countDocuments({ role: "student", travelStatus: "Coming" });
        assert.equal(count400, 400, "Should have 400 Coming students now");

        // Step E: Query getActiveAIPlan again — the old 205-user plan must NOT be returned as active!
        clearActiveAIPlanCache();
        const activeResDemand400 = await getActiveAIPlan({ direction: "INWARD", forceRefresh: true });
        assert.equal(activeResDemand400.inwardPlan, null, "Operational inwardPlan MUST be null because plan is stale");
        assert.ok(activeResDemand400.staleInwardPlan, "staleInwardPlan must be returned with metadata");
        assert.equal(activeResDemand400.staleInwardPlan.isStale, true);

        // Step F: Verify MongoDB record was marked stale in database
        const dbPlan = await AiPlan.findById(plan205._id);
        assert.equal(dbPlan.status, "stale");
        assert.equal(dbPlan.active, false);

        // Step G: Attempting to activate this stale plan in saveSelectedPlan MUST be rejected!
        const activateRes = await saveSelectedPlan({
            planType: "AI",
            direction: "INWARD",
            plan: plan205.aiPlan,
            planId: String(plan205._id)
        });
        assert.equal(activateRes.success, false, "Activating stale plan must fail");
        assert.ok(
            activateRes.code === "STALE_PLAN_DEMAND_MISMATCH" || activateRes.code === "STALE_PLAN" || activateRes.code === "STALE_PLAN_NOT_ACTIVE",
            `Should return STALE error code, got: ${activateRes.code}`
        );
    });

    await t.test("2. Reset Safety & Superseded Resurrection Prevention", async () => {
        clearActiveAIPlanCache();

        // Seed older superseded plan and active plan
        const supersededPlan = await AiPlan.create({
            planType: "AI",
            direction: "INWARD",
            tripMode: "TO_DESTINATION",
            active: false,
            status: "superseded",
            summary: { confirmedUsers: 200, allocatedSeats: 200, assignedUsers: 200 },
            aiPlan: { comingUsers: 200, allocatedUsers: 200, direction: "INWARD", buses: [] }
        });

        // Also seed an active Outward plan to test direction isolation
        const outwardPlan = await AiPlan.create({
            planType: "AI",
            direction: "OUTWARD",
            tripMode: "FROM_SOURCE",
            active: true,
            status: "active",
            summary: { confirmedUsers: 400, allocatedSeats: 400, assignedUsers: 400 },
            aiPlan: { comingUsers: 400, allocatedUsers: 400, direction: "OUTWARD", buses: [] }
        });

        // Reset INWARD
        const resetRes = await resetGeneratedAIRoute({ direction: "INWARD" });
        assert.equal(resetRes.success, true);

        // Verify Inward plan is empty/null and wasReset is true
        clearActiveAIPlanCache();
        const getInwardRes = await getActiveAIPlan({ direction: "INWARD", forceRefresh: true });
        assert.equal(getInwardRes.inwardPlan, null, "Current Inward plan must be null after reset");
        assert.equal(getInwardRes.wasReset, true);

        // Verify the older superseded plan was NOT resurrected
        const dbSuperseded = await AiPlan.findById(supersededPlan._id);
        assert.notEqual(dbSuperseded.status, "active", "Superseded plan must not become active");

        // Verify Direction Isolation: Outward plan MUST remain active and untouched
        const getOutwardRes = await getActiveAIPlan({ direction: "OUTWARD", forceRefresh: true });
        assert.ok(getOutwardRes.outwardPlan, "Outward plan must remain active after Inward reset");
        assert.equal(getOutwardRes.outwardPlan.direction, "OUTWARD");

        // Verify master data not deleted
        const vehicleCount = await Vehicle.countDocuments();
        assert.ok(vehicleCount > 0, "Vehicles must be preserved");
        const startingPlaceCount = await InwardStartingPlace.countDocuments();
        assert.ok(startingPlaceCount > 0, "Inward starting places must be preserved");
    });

    await t.test("3. Excel Replacement & Failure Rollback Safety", async () => {
        // Ensure database has 400 students with dummy allocations
        await User.updateMany(
            { role: "student" },
            {
                $set: {
                    allocatedBus: { routeCode: "R1", vehicleName: "Bus 1", isAllocated: true },
                    assignedVehicle: "Bus 1",
                    assignedRoute: "R1",
                    allocationStatus: "Assigned"
                }
            }
        );

        const allocatedCountBefore = await User.countDocuments({ role: "student", "allocatedBus.isAllocated": true });
        assert.ok(allocatedCountBefore > 0, "Should have allocated students before Excel import");

        // Build valid Excel buffer for 250 students
        const validRows = [];
        for (let i = 1; i <= 250; i++) {
            validRows.push({
                userId: `NEW-STU-${i}`,
                name: `New Student ${i}`,
                stoppings: "Central Bus Stand",
                city: "Madurai",
                state: "Tamil Nadu",
                country: "India"
            });
        }
        const ws = xlsx.utils.json_to_sheet(validRows);
        const wb = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(wb, ws, "Students");
        const validBuffer = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });

        // Mock req & res for valid Excel upload
        let jsonResponse = null;
        let statusCode = null;
        const mockReq = { file: { buffer: validBuffer } };
        const mockRes = {
            status: (c) => {
                statusCode = c;
                return {
                    json: (data) => {
                        jsonResponse = data;
                    }
                };
            }
        };

        await uploadExcel(mockReq, mockRes);
        assert.equal(statusCode, 200);
        assert.equal(jsonResponse.success, true);
        assert.equal(jsonResponse.totalUsers, 250);

        // Verify dataset completely replaced: exactly 250 users
        const totalStudentsAfter = await User.countDocuments({ role: "student" });
        assert.equal(totalStudentsAfter, 250, "Should have exactly 250 students after replacement");

        // Verify old allocations are invalidated (allocatedBus is null)
        const allocatedAfter = await User.countDocuments({ role: "student", "allocatedBus.isAllocated": true });
        assert.equal(allocatedAfter, 0, "All old student allocations must be cleared");

        // Verify old users from 400 batch were deleted
        const oldUsersExist = await User.exists({ userId: "STU-205-1" });
        assert.equal(oldUsersExist, null, "Old students must be removed from database");

        // Test invalid Excel import: missing required fields
        const invalidRows = [
            { userId: "BAD-1", name: "Bad Student 1" }, // missing stoppings, city, state, country
            { userId: "BAD-2", name: "", stoppings: "Central" }
        ];
        const wsBad = xlsx.utils.json_to_sheet(invalidRows);
        const wbBad = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(wbBad, wsBad, "Students");
        const invalidBuffer = xlsx.write(wbBad, { type: "buffer", bookType: "xlsx" });

        let badJsonResponse = null;
        let badStatusCode = null;
        const mockBadReq = { file: { buffer: invalidBuffer } };
        const mockBadRes = {
            status: (c) => {
                badStatusCode = c;
                return {
                    json: (data) => {
                        badJsonResponse = data;
                    }
                };
            }
        };

        await uploadExcel(mockBadReq, mockBadRes);
        assert.equal(badStatusCode, 400, "Invalid Excel import must be rejected with 400");
        assert.equal(badJsonResponse.success, false);

        // Verify existing 250 students remain unchanged and not partially deleted
        const studentsAfterBadUpload = await User.countDocuments({ role: "student" });
        assert.equal(studentsAfterBadUpload, 250, "Existing 250 students must remain unchanged on import failure");
    });
});
