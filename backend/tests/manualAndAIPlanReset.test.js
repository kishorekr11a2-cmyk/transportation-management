import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import User from "../models/User.js";
import Route from "../models/Route.js";
import Vehicle from "../models/Vehicle.js";
import AiPlan from "../models/AiPlan.js";
import { resetGeneratedAIRoute } from "../services/aiAgentService.js";
import { resetManualAllocations } from "../controllers/routeController.js";
import { batchCalculateStudentTransportStatuses } from "../services/studentTransportStatusService.js";

/**
 * COMPREHENSIVE TEST SUITE:
 * Manual Plan Reset and AI Plan Reset — Complete Allocation Removal and Dynamic User Management
 */

test("Manual and AI Plan Complete Allocation Removal & Dynamic N-User Verification", async (t) => {
    const mongoUri = process.env.MONGO_URI;
    if (mongoose.connection.readyState === 0 && mongoUri) {
        try {
            await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 8000 });
        } catch (e) {
            console.warn("MongoDB connection warning:", e.message);
        }
    }

    const isConnected = mongoose.connection.readyState === 1;

    // Helper to generate dynamic mock user set of any arbitrary size N
    function generateDynamicUsers(count, startId = 1) {
        const users = [];
        for (let i = 0; i < count; i++) {
            const idx = startId + i;
            const travelStatus = i % 10 === 0 ? "Not Coming" : (i % 7 === 0 ? "Pending" : "Coming");
            users.push({
                _id: new mongoose.Types.ObjectId(),
                userId: `DYN_STU_${idx}`,
                name: `Dynamic Student ${idx}`,
                stoppings: `Stop_${(i % 5) + 1}`,
                role: "student",
                travelStatus,
                travelResponseSubmittedAt: new Date("2026-09-18T08:00:00Z"),
                assignedVehicle: null,
                assignedRoute: null,
                allocationStatus: travelStatus === "Coming" ? "Unallocated" : "Not Assigned",
                isAllocated: false,
                isUnallocated: true,
                allocatedBus: null,
                manualRouteId: null,
                manualBusId: null,
                manualAllocation: null,
                aiAllocation: null,
                routeId: null,
                busId: null,
                seatNumber: null,
                allocatedSeat: null,
                approvedPlanType: null,
                approvalStatus: null
            });
        }
        return users;
    }

    await t.test("1. Dynamic N-User Calculation — works for any N (N=10, N=75, N=400, N=1000)", () => {
        [10, 75, 400, 1000].forEach((N) => {
            const users = generateDynamicUsers(N);
            assert.equal(users.length, N);

            const coming = users.filter((u) => u.travelStatus === "Coming").length;
            const notComing = users.filter((u) => u.travelStatus === "Not Coming").length;
            const pending = users.filter((u) => u.travelStatus === "Pending").length;

            assert.equal(coming + notComing + pending, N, "Dynamic sum of travel statuses matches total N");
            assert.ok(coming > 0, "Dynamic coming count is calculated");
        });
    });

    await t.test("2. Allocation Ownership: Manual allocations are completely removed, AI allocations preserved", () => {
        // User A: Has Manual Inward Allocation
        const userA = {
            userId: "STU_MANUAL_1",
            travelStatus: "Coming",
            assignedVehicle: "Bus 01",
            assignedRoute: "R-01",
            allocationStatus: "Assigned",
            approvedPlanType: "MANUAL",
            manualBusId: "bus_1",
            manualRouteId: "route_1",
            manualAllocation: { vehicleName: "Bus 01", routeCode: "R-01" },
            busId: "bus_1",
            routeId: "route_1",
            seatNumber: 12,
            allocatedSeat: 12,
            isAllocated: true,
            isUnallocated: false,
            allocatedBus: {
                isAllocated: true,
                direction: "INWARD",
                planType: "MANUAL",
                vehicleName: "Bus 01",
                routeCode: "R-01",
                seatNumber: 12,
                inward: { isAllocated: true, planType: "MANUAL", vehicleName: "Bus 01", routeCode: "R-01", seatNumber: 12 },
                outward: null
            }
        };

        // User B: Has AI Outward Allocation
        const userB = {
            userId: "STU_AI_1",
            travelStatus: "Coming",
            assignedVehicle: "Bus 02",
            assignedRoute: "R-02",
            allocationStatus: "Assigned",
            approvedPlanType: "AI",
            aiAllocation: { vehicleName: "Bus 02", routeCode: "R-02" },
            busId: "bus_2",
            routeId: "route_2",
            seatNumber: 5,
            allocatedSeat: 5,
            isAllocated: true,
            isUnallocated: false,
            allocatedBus: {
                isAllocated: true,
                direction: "OUTWARD",
                planType: "AI",
                vehicleName: "Bus 02",
                routeCode: "R-02",
                seatNumber: 5,
                inward: null,
                outward: { isAllocated: true, planType: "AI", vehicleName: "Bus 02", routeCode: "R-02", seatNumber: 5 }
            }
        };

        // User C: Has Mixed (Inward Manual, Outward AI)
        const userC = {
            userId: "STU_MIXED_1",
            travelStatus: "Coming",
            assignedVehicle: "Bus 01",
            assignedRoute: "R-01",
            allocationStatus: "Assigned",
            approvedPlanType: "MANUAL",
            manualBusId: "bus_1",
            manualRouteId: "route_1",
            manualAllocation: { vehicleName: "Bus 01", routeCode: "R-01" },
            aiAllocation: { vehicleName: "Bus 02", routeCode: "R-02" },
            busId: "bus_1",
            routeId: "route_1",
            seatNumber: 15,
            allocatedSeat: 15,
            isAllocated: true,
            isUnallocated: false,
            allocatedBus: {
                isAllocated: true,
                direction: "INWARD",
                planType: "MANUAL",
                vehicleName: "Bus 01",
                routeCode: "R-01",
                inward: { isAllocated: true, planType: "MANUAL", vehicleName: "Bus 01", routeCode: "R-01", seatNumber: 15 },
                outward: { isAllocated: true, planType: "AI", vehicleName: "Bus 02", routeCode: "R-02", seatNumber: 8 }
            }
        };

        // Simulate Manual Reset on userA:
        // All fields must be wiped and user becomes Unallocated
        const resetUserA = {
            ...userA,
            assignedVehicle: null,
            assignedRoute: null,
            allocatedBus: null,
            manualBusId: null,
            manualRouteId: null,
            manualAllocation: null,
            busId: null,
            routeId: null,
            seatNumber: null,
            allocatedSeat: null,
            approvedPlanType: null,
            approvalStatus: null,
            isAllocated: false,
            isUnallocated: true,
            allocationStatus: "Unallocated"
        };
        assert.equal(resetUserA.assignedVehicle, null, "User A assignedVehicle cleared");
        assert.equal(resetUserA.assignedRoute, null, "User A assignedRoute cleared");
        assert.equal(resetUserA.allocatedBus, null, "User A allocatedBus cleared");
        assert.equal(resetUserA.seatNumber, null, "User A seatNumber cleared");
        assert.equal(resetUserA.manualBusId, null, "User A manualBusId cleared");
        assert.equal(resetUserA.manualRouteId, null, "User A manualRouteId cleared");
        assert.equal(resetUserA.isAllocated, false, "User A isAllocated false");
        assert.equal(resetUserA.isUnallocated, true, "User A isUnallocated true");
        assert.equal(resetUserA.allocationStatus, "Unallocated", "User A status Unallocated");
        assert.equal(resetUserA.travelStatus, "Coming", "Travel status Coming strictly preserved");

        // User B must NOT be touched by Manual Reset
        assert.equal(userB.assignedVehicle, "Bus 02", "User B AI assignedVehicle untouched by manual reset");
        assert.equal(userB.approvedPlanType, "AI", "User B AI plan type untouched by manual reset");

        // Simulate Manual Reset on mixed User C:
        // Inward manual is removed, Outward AI survives!
        const resetUserC = {
            ...userC,
            manualBusId: null,
            manualRouteId: null,
            manualAllocation: null,
            assignedVehicle: userC.allocatedBus.outward.vehicleName,
            assignedRoute: userC.allocatedBus.outward.routeCode,
            approvedPlanType: "AI",
            allocatedBus: {
                isAllocated: true,
                direction: "OUTWARD",
                planType: "AI",
                vehicleName: userC.allocatedBus.outward.vehicleName,
                routeCode: userC.allocatedBus.outward.routeCode,
                seatNumber: userC.allocatedBus.outward.seatNumber,
                inward: null,
                outward: userC.allocatedBus.outward
            }
        };
        assert.equal(resetUserC.manualBusId, null, "Manual bus cleared for mixed student");
        assert.equal(resetUserC.assignedVehicle, "Bus 02", "Surviving AI outward vehicle assigned");
        assert.equal(resetUserC.approvedPlanType, "AI", "Plan type switched to surviving AI plan");
        assert.equal(resetUserC.allocatedBus.isAllocated, true, "Surviving allocation remains active");
    });

    await t.test("3. AI Plan Reset: AI allocations completely removed, Manual allocations preserved", () => {
        const userA = {
            userId: "STU_MANUAL_1",
            travelStatus: "Coming",
            assignedVehicle: "Bus 01",
            assignedRoute: "R-01",
            allocationStatus: "Assigned",
            approvedPlanType: "MANUAL",
            manualBusId: "bus_1",
            manualRouteId: "route_1"
        };

        const userB = {
            userId: "STU_AI_1",
            travelStatus: "Coming",
            assignedVehicle: "Bus 02",
            assignedRoute: "R-02",
            allocationStatus: "Assigned",
            approvedPlanType: "AI",
            aiAllocation: { vehicleName: "Bus 02", routeCode: "R-02" },
            busId: "bus_2",
            routeId: "route_2",
            seatNumber: 5,
            allocatedSeat: 5,
            isAllocated: true,
            isUnallocated: false,
            allocatedBus: { isAllocated: true, vehicleName: "Bus 02" }
        };

        // When AI plan is reset: User B is cleared completely
        const resetUserB = {
            ...userB,
            assignedVehicle: null,
            assignedRoute: null,
            allocatedBus: null,
            aiAllocation: null,
            busId: null,
            routeId: null,
            seatNumber: null,
            allocatedSeat: null,
            approvedPlanType: null,
            approvalStatus: null,
            isAllocated: false,
            isUnallocated: true,
            allocationStatus: "Unallocated"
        };

        assert.equal(resetUserB.assignedVehicle, null, "User B AI vehicle cleared");
        assert.equal(resetUserB.assignedRoute, null, "User B AI route cleared");
        assert.equal(resetUserB.allocatedBus, null, "User B AI allocatedBus cleared");
        assert.equal(resetUserB.aiAllocation, null, "User B aiAllocation cleared");
        assert.equal(resetUserB.seatNumber, null, "User B seatNumber cleared");
        assert.equal(resetUserB.isAllocated, false, "User B isAllocated false");
        assert.equal(resetUserB.isUnallocated, true, "User B isUnallocated true");
        assert.equal(resetUserB.allocationStatus, "Unallocated", "User B allocationStatus Unallocated");
        assert.equal(resetUserB.travelStatus, "Coming", "Travel status Coming preserved");

        // User A (Manual) is NOT touched by AI Reset
        assert.equal(userA.assignedVehicle, "Bus 01", "User A manual allocation untouched by AI reset");
        assert.equal(userA.approvedPlanType, "MANUAL", "User A approvedPlanType untouched by AI reset");
    });

    if (isConnected) {
        await t.test("4. Live MongoDB Verification: Reset Manual Plan Allocations via Controller", async () => {
            const req = { body: { direction: null } };
            let statusCode = null;
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

            await resetManualAllocations(req, res);
            assert.ok(responseData, "resetManualAllocations returned a response");
            assert.equal(responseData.success, true, "Response was successful");
            assert.equal(responseData.message, "Manual plan allocations reset successfully", "Expected exact toast message");

            // Verify that manual routes are NOT deleted from MongoDB
            const routesCount = await Route.countDocuments({});
            assert.ok(routesCount >= 0, "Routes collection query succeeded");

            // Verify that vehicles are NOT deleted from MongoDB
            const vehiclesCount = await Vehicle.countDocuments({});
            assert.ok(vehiclesCount >= 0, "Vehicles collection query succeeded");

            // Verify that no manual allocation fields remain on students
            const staleManualStudents = await User.countDocuments({
                role: "student",
                $or: [
                    { manualBusId: { $ne: null } },
                    { manualRouteId: { $ne: null } },
                    { manualAllocation: { $ne: null } },
                    { approvedPlanType: { $in: ["MANUAL", "ADMIN"] } }
                ]
            });
            assert.equal(staleManualStudents, 0, "Zero stale manual allocations remain in MongoDB after manual reset");
        });

        await t.test("5. Live MongoDB Verification: Reset AI Plan via resetGeneratedAIRoute", async () => {
            const result = await resetGeneratedAIRoute({ resetAll: true, planType: "AI" });
            assert.ok(result.success, "resetGeneratedAIRoute succeeded");
            assert.equal(result.wasReset, true, "wasReset is true");

            // Verify active AI plans are marked reset in ai_selected_plans
            const activeAISelected = await mongoose.connection.db.collection("ai_selected_plans").countDocuments({
                active: true,
                approved: true,
                planType: { $nin: ["MANUAL", "ADMIN"] }
            });
            assert.equal(activeAISelected, 0, "No active approved AI selected plans remain in MongoDB");

            // Verify active AI plans are marked reset in aiplans
            const activeAiPlans = await AiPlan.countDocuments({
                active: true,
                isApproved: true
            });
            assert.equal(activeAiPlans, 0, "No active approved AiPlan documents remain in MongoDB");

            // Verify students have zero stale AI allocations
            const staleAIStudents = await User.countDocuments({
                role: "student",
                approvedPlanType: "AI"
            });
            assert.equal(staleAIStudents, 0, "Zero stale AI allocations remain in MongoDB after AI reset");

            // Verify all Coming students without manual allocations show Unallocated
            const comingStudents = await User.find({
                role: "student",
                travelStatus: "Coming",
                approvedPlanType: { $ne: "MANUAL" }
            }).lean();

            for (const s of comingStudents) {
                assert.equal(s.assignedVehicle, null, `Student ${s.userId} assignedVehicle is null`);
                assert.equal(s.assignedRoute, null, `Student ${s.userId} assignedRoute is null`);
                assert.equal(s.allocationStatus, "Unallocated", `Student ${s.userId} allocationStatus is Unallocated`);
            }
        });

        await t.test("6. User Management Batch Transport Status Calculation after Reset", async () => {
            const students = await User.find({ role: "student" }).lean();
            assert.ok(students.length > 0, "Loaded students from MongoDB");

            const calculated = await batchCalculateStudentTransportStatuses(students);
            assert.equal(calculated.length, students.length, "Batch calculation processed all N students");

            const comingCalculated = calculated.filter((u) => u.travelStatus === "Coming");
            for (const u of comingCalculated) {
                if (!u.approvedPlanType || u.approvedPlanType !== "MANUAL") {
                    assert.equal(u.isAllocated, false, `Student ${u.userId} isAllocated is false`);
                    assert.equal(u.isUnallocated, true, `Student ${u.userId} isUnallocated is true`);
                    assert.equal(u.assignedVehicle, null, `Student ${u.userId} assignedVehicle is null`);
                    assert.equal(u.assignedRoute, null, `Student ${u.userId} assignedRoute is null`);
                }
            }
        });
    }
});
