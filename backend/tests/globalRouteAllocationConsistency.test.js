import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import connectDB from "../config/db.js";
import User from "../models/User.js";
import {
    buildAIPlan,
    validateTransportationPlan,
    generateAgentRecommendations,
    resolveStopCoordinates,
    normalizeCanonicalStopName
} from "../services/aiAgentService.js";
import {
    isSamePlace
} from "../services/routeOptimizationService.js";

const klnceDepot = {
    name: "K. L. N. College of Engineering",
    address: "Pottapalayam, Sivagangai / Madurai - 630612",
    latitude: 9.8515,
    longitude: 78.1882
};

test("Global Route Allocation and Road-Connectivity Optimization Suite", async (t) => {
    await connectDB();

    // -------------------------------------------------------------------------
    // TEST 1: Passenger assigned to bus but stop missing must FAIL validation
    // -------------------------------------------------------------------------
    await t.test("1. Enforce allocation-to-route consistency: missing stop fails certification", async () => {
        const dummyBus = {
            vehicleId: "v_101",
            vehicleName: "Bus Alpha",
            capacity: 50,
            assignedUsers: 2,
            users: ["pax_1", "pax_2"],
            passengerUserIds: ["pax_1", "pax_2"],
            stops: [
                {
                    name: "Simmakkal",
                    latitude: 9.9255,
                    longitude: 78.1215,
                    userCount: 2,
                    userIds: ["pax_1", "pax_2"]
                }
            ],
            routeDistanceKm: 18.5,
            straightLineBaselineKm: 15.0,
            detourRatio: 1.23,
            isContinuous: true
        };

        const dummyConfirmedUsers = [
            { _id: "pax_1", name: "Student 1", stoppings: "Simmakkal" },
            { _id: "pax_2", name: "Student 2", stoppings: "Thiruparankundram" } // Not in stops!
        ];

        const validation = validateTransportationPlan({
            buses: [dummyBus],
            totalComingUsers: 2,
            totalAvailableCapacity: 50,
            tripMode: "FROM_SOURCE",
            sourceHub: klnceDepot,
            confirmedUsers: dummyConfirmedUsers,
            availableVehicles: [{ _id: "v_101", vehicleName: "Bus Alpha", capacity: 50, status: "Available" }]
        });

        assert.equal(validation.isCertified, false, "Plan must NOT be certified if a passenger's stopping area is missing");
        assert.ok(
            validation.failureReasons.some(r => r.includes("missing from assigned bus route sequence")),
            "Failure reasons must explicitly cite missing passenger stopping area"
        );
        assert.equal(validation.checks.everyPassengerStopRepresentedInAssignedBus, false);
    });

    // -------------------------------------------------------------------------
    // TEST 2: Stop alias normalization preserves passenger association & avoids erasing identity
    // -------------------------------------------------------------------------
    await t.test("2. Stop clustering & alias normalization preserves passenger association without erasing stops", () => {
        const primary = { name: "Thirunagar 3rd Stop", latitude: 9.8847, longitude: 78.0644 };
        const alias = { name: "Thirunagar", latitude: 9.8847, longitude: 78.0644 };
        const distinct = { name: "Simmakkal", latitude: 9.9255, longitude: 78.1215 };

        assert.ok(isSamePlace(primary, alias), "Thirunagar and Thirunagar 3rd Stop should be recognized as same area");
        assert.ok(!isSamePlace(primary, distinct), "Thirunagar and Simmakkal must NEVER be treated as the same place");
        assert.notEqual(
            normalizeCanonicalStopName("Thiruparankundram"),
            normalizeCanonicalStopName("Simmakkal"),
            "Different localities must produce distinct canonical names"
        );
    });

    // -------------------------------------------------------------------------
    // TEST 3: Coordinate resolution selects true locality over city centroid
    // -------------------------------------------------------------------------
    await t.test("3. Coordinate resolution accurately identifies specific locality coordinates", async () => {
        const [coords] = await resolveStopCoordinates([{ name: "Thiruparankundram" }]);
        assert.ok(coords && coords.resolved, "Thiruparankundram must resolve");
        // Thiruparankundram is at approx lat 9.882, lng 78.072 (south-west Madurai)
        // City center is at 9.925, 78.120. Ensure we did NOT pick city center.
        assert.ok(coords.latitude < 9.91, `Expected lat < 9.91 for Thiruparankundram, got ${coords.latitude}`);
        assert.ok(coords.longitude < 78.10, `Expected lng < 78.10 for Thiruparankundram, got ${coords.longitude}`);
    });

    // -------------------------------------------------------------------------
    // TEST 4: Live Outward Generation - 100% Demand Preservation and Stop Representation
    // -------------------------------------------------------------------------
    await t.test("4. Live Outward Optimization: all confirmed passengers have their stopping area on their assigned bus", async () => {
        const result = await generateAgentRecommendations({
            tripMode: "FROM_SOURCE",
            source: klnceDepot
        });

        assert.ok(result.success, "Recommendation generation succeeded");
        const plan = result.aiPlan;
        assert.equal(plan.certification?.isCertified, true, "Plan must be certified");
        assert.equal(plan.certification?.status, "OPTIMIZATION ENGINE SUCCESS");

        const allComingUsers = await User.find({ travelStatus: "Coming" });
        const comingCount = allComingUsers.length;
        assert.equal(plan.assignedUsers, comingCount, `Must assign all ${comingCount} coming users`);
        assert.equal(plan.unassignedUsers, 0, "Zero unassigned users");

        // Verify each user's stopping area appears on their assigned bus
        let missingCount = 0;
        const missingExamples = [];
        allComingUsers.forEach((u) => {
            const assignedBus = (plan.buses || []).find((b) =>
                (b.users || []).some((bu) => String(bu._id || bu.id || bu) === String(u._id))
            );
            assert.ok(assignedBus, `Passenger ${u.name} must be assigned to a bus`);

            const userStopNorm = (u.stoppings || "").toLowerCase().trim();
            const busHasStop = (assignedBus.stops || []).some((st) => {
                const stNorm = (st.name || "").toLowerCase().trim();
                if (stNorm === userStopNorm || isSamePlace(st, { name: u.stoppings })) return true;
                if (Array.isArray(st.representedStops) && st.representedStops.some((rs) => rs.toLowerCase().trim() === userStopNorm || isSamePlace({ name: rs }, { name: u.stoppings }))) return true;
                if (Array.isArray(st.originalStopNames) && st.originalStopNames.some((rs) => rs.toLowerCase().trim() === userStopNorm || isSamePlace({ name: rs }, { name: u.stoppings }))) return true;
                return false;
            });

            if (!busHasStop) {
                missingCount++;
                missingExamples.push({ user: u.name, stop: u.stoppings, bus: assignedBus.vehicleName });
            }
        });

        assert.equal(missingCount, 0, `All passengers must have their stop in their bus. Found ${missingCount} mismatches: ${JSON.stringify(missingExamples)}`);
    });

    // -------------------------------------------------------------------------
    // TEST 5: Thiruparankundram Regression Test
    // -------------------------------------------------------------------------
    await t.test("5. Thiruparankundram Regression: passenger 'I AM' assigned to bus with Thiruparankundram in route", async () => {
        const thiruUser = await User.findOne({ travelStatus: "Coming", stoppings: /thiruparankundram/i });
        if (!thiruUser) {
            console.log("No specific Thiruparankundram user in DB; skipping DB check");
            return;
        }

        const result = await generateAgentRecommendations({
            tripMode: "FROM_SOURCE",
            source: klnceDepot
        });

        const plan = result.aiPlan;
        const assignedBus = (plan.buses || []).find((b) =>
            (b.users || []).some((bu) => String(bu._id || bu.id || bu) === String(thiruUser._id))
        );

        assert.ok(assignedBus, "Thiruparankundram user must be assigned to a bus");
        const hasThiruStop = (assignedBus.stops || []).some((s) => /thiruparankundram/i.test(s.name));
        assert.ok(
            hasThiruStop,
            `Bus ${assignedBus.vehicleName} must contain Thiruparankundram in its stops: [${assignedBus.stops.map(s => s.name).join(", ")}]`
        );
    });

    // -------------------------------------------------------------------------
    // TEST 6: Live Inward Generation - 100% Demand Preservation and Stop Representation
    // -------------------------------------------------------------------------
    await t.test("6. Live Inward Optimization: symmetric demand preservation & certification", async () => {
        const result = await generateAgentRecommendations({
            tripMode: "TO_DESTINATION",
            destination: klnceDepot
        });

        assert.ok(result.success, "Inward generation succeeded");
        const plan = result.aiPlan;
        assert.equal(plan.certification?.isCertified, true, "Inward plan must be certified");
        assert.equal(plan.certification?.status, "OPTIMIZATION ENGINE SUCCESS");
        assert.equal(plan.unassignedUsers, 0, "Zero unassigned users on inward");
        assert.ok(plan.buses.every((b) => b.assignedUsers <= b.capacity), "No bus exceeds capacity");
    });

    await mongoose.disconnect();
});
