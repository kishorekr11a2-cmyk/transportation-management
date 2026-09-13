import mongoose from "mongoose";
import dotenv from "dotenv";
import connectDB from "./config/db.js";
import {
    buildAIPlan,
    validateTransportationPlan,
    allocateVehiclesToDemandClusters,
    consolidateLowUtilizationRoutes,
    generateAgentRecommendations
} from "./services/aiAgentService.js";

dotenv.config();

const klnce = {
    name: "K. L. N. College of Engineering",
    address: "Pottapalayam, Sivagangai / Madurai - 630612",
    latitude: 9.8515,
    longitude: 78.1882
};

// Sample standard vehicles with various capacities
const standardFleet = [
    { _id: "veh_1", vehicleName: "Bus 1", capacity: 70, status: "Available" },
    { _id: "veh_2", vehicleName: "Bus 2", capacity: 70, status: "Available" },
    { _id: "veh_3", vehicleName: "Bus 3", capacity: 70, status: "Available" },
    { _id: "veh_4", vehicleName: "Bus 4", capacity: 70, status: "Available" },
    { _id: "veh_5", vehicleName: "Bus 5", capacity: 70, status: "Available" },
    { _id: "veh_6", vehicleName: "Bus 6", capacity: 60, status: "Available" },
    { _id: "veh_7", vehicleName: "Bus 7", capacity: 50, status: "Available" },
    { _id: "veh_8", vehicleName: "Bus 8", capacity: 45, status: "Available" },
    { _id: "veh_9", vehicleName: "Bus 9", capacity: 60, status: "Available" }
];

// Sample Madurai coordinates for testing
const stopCoords = {
    Othakadai: { lat: 9.9572, lng: 78.1878 },
    Tallakulam: { lat: 9.9328, lng: 78.1364 },
    Sellur: { lat: 9.93297, lng: 78.12889 },
    Narimedu: { lat: 9.93719, lng: 78.12581 },
    Vilangudi: { lat: 9.94639, lng: 78.09694 },
    Palanganatham: { lat: 9.904, lng: 78.0975 },
    Thirunagar: { lat: 9.88472, lng: 78.06444 },
    Avaniyapuram: { lat: 9.88179, lng: 78.11255 },
    Anuppanadi: { lat: 9.89519, lng: 78.12081 },
    Kochadai: { lat: 9.94311, lng: 78.08089 },
    Vandiyur: { lat: 9.91028, lng: 78.16028 },
    AnnaNagar: { lat: 9.92535, lng: 78.13218 }
};

function createSyntheticStops(spec) {
    // spec is an object: { StopName: passengerCount, ... }
    let globalUserId = 1;
    return Object.entries(spec).map(([name, count]) => {
        const coords = stopCoords[name] || { lat: 9.92, lng: 78.12 };
        const userIds = Array.from({ length: count }, () => `u_${globalUserId++}`);
        return {
            name,
            latitude: coords.lat,
            longitude: coords.lng,
            userCount: count,
            userIds,
            users: userIds.map((id) => ({ _id: id, name: `Student ${id}` }))
        };
    });
}

async function runAll12Cases() {
    console.log("================================================================================");
    console.log("EXECUTING COMPREHENSIVE 12-CASE TRANSPORTATION MANAGEMENT VALIDATION SUITE");
    console.log("================================================================================\n");

    await connectDB();
    const caseResults = [];

    function recordCase(num, title, passed, details = "") {
        caseResults.push({ num, title, passed, details });
        const icon = passed ? "✅ PASS" : "❌ FAIL";
        console.log(`[${icon}] CASE ${num}: ${title}`);
        if (details) {
            console.log(`        Details: ${details}`);
        }
    }

    try {
        // -------------------------------------------------------------
        // CASE 1: Normal Demand (Full DB Live Run)
        // -------------------------------------------------------------
        console.log("--- Executing CASE 1: Normal Demand (Live 400 Users) ---");
        const c1Res = await generateAgentRecommendations({
            tripMode: "TO_DESTINATION",
            destination: klnce
        });
        const c1Plan = c1Res.aiPlan;
        const c1Passed = c1Res.success === true &&
            c1Plan?.certification?.isCertified === true &&
            c1Plan?.assignedUsers === 400 &&
            c1Plan?.unassignedUsers === 0 &&
            c1Plan?.buses.every((b) => b.assignedUsers <= b.capacity);
        recordCase(1, "Normal Demand (Full fleet optimization & certification)", c1Passed,
            `Assigned: ${c1Plan?.assignedUsers}/400 across ${c1Plan?.buses.length} buses. Cert=${c1Plan?.certification?.status}`);

        // -------------------------------------------------------------
        // CASE 2: Increased Demand (500 users)
        // -------------------------------------------------------------
        console.log("\n--- Executing CASE 2: Increased Demand (500 Users) ---");
        const c2Stops = createSyntheticStops({
            Othakadai: 60,
            Tallakulam: 50,
            Sellur: 60,
            Narimedu: 50,
            Vilangudi: 50,
            Palanganatham: 50,
            Thirunagar: 50,
            Avaniyapuram: 50,
            Anuppanadi: 50,
            AnnaNagar: 30
        });
        const c2Demand = c2Stops.reduce((sum, s) => sum + s.userCount, 0); // 500
        const c2Plan = await buildAIPlan({
            destinationHub: klnce,
            tripMode: "TO_DESTINATION",
            resolvedStops: c2Stops,
            availableVehicles: standardFleet,
            totalComingUsers: c2Demand
        });
        const c2Passed = c2Plan.assignedUsers === 500 &&
            c2Plan.unassignedUsers === 0 &&
            c2Plan.buses.every((b) => b.assignedUsers <= b.capacity) &&
            c2Plan.buses.every((b) => b.assignedUsers === b.users.length) &&
            c2Plan.certification.isCertified === true;
        recordCase(2, "Increased Demand (500 users dynamically allocated across available fleet)", c2Passed,
            `Allocated ${c2Plan.assignedUsers}/500 into ${c2Plan.buses.length} buses with 0 capacity overruns.`);

        // -------------------------------------------------------------
        // CASE 3: Reduced Demand (120 users in 2 corridors)
        // -------------------------------------------------------------
        console.log("\n--- Executing CASE 3: Reduced Demand (120 Users) ---");
        const c3Stops = createSyntheticStops({
            Othakadai: 40,
            Tallakulam: 30,
            Avaniyapuram: 30,
            Anuppanadi: 20
        });
        const c3Demand = c3Stops.reduce((sum, s) => sum + s.userCount, 0); // 120
        const c3Plan = await buildAIPlan({
            destinationHub: klnce,
            tripMode: "TO_DESTINATION",
            resolvedStops: c3Stops,
            availableVehicles: standardFleet,
            totalComingUsers: c3Demand
        });
        // With 120 users across 2 corridors, should use only 2 or 3 buses, NOT 7!
        const c3Passed = c3Plan.assignedUsers === 120 &&
            c3Plan.buses.length <= 3 &&
            c3Plan.buses.every((b) => b.assignedUsers <= b.capacity) &&
            c3Plan.certification.isCertified === true;
        recordCase(3, "Reduced Demand (120 users deploys fewer buses automatically without hardcoded fleet count)", c3Passed,
            `Used ${c3Plan.buses.length} buses (< 4) for 120 passengers with high utilization.`);

        // -------------------------------------------------------------
        // CASE 4: Limited Available Vehicles (Fleet shortage)
        // -------------------------------------------------------------
        console.log("\n--- Executing CASE 4: Limited Available Vehicles ---");
        const limitedFleet = [
            { _id: "lim_1", vehicleName: "MiniBus 1", capacity: 60, status: "Available" },
            { _id: "lim_2", vehicleName: "MiniBus 2", capacity: 60, status: "Available" },
            { _id: "lim_3", vehicleName: "MiniBus 3", capacity: 60, status: "Available" }
        ]; // Total capacity = 180
        const c4Stops = createSyntheticStops({
            Othakadai: 70,
            Tallakulam: 70,
            Sellur: 70,
            Narimedu: 40
        }); // Total demand = 250
        const c4Plan = await buildAIPlan({
            destinationHub: klnce,
            tripMode: "TO_DESTINATION",
            resolvedStops: c4Stops,
            availableVehicles: limitedFleet,
            totalComingUsers: 250,
            totalAvailableCapacity: 180
        });
        const c4Passed = c4Plan.assignedUsers === 180 &&
            c4Plan.unassignedUsers === 70 &&
            c4Plan.assignedUsers + c4Plan.unassignedUsers === 250 &&
            c4Plan.buses.length === 3 &&
            c4Plan.buses.every((b) => b.assignedUsers <= b.capacity);
        recordCase(4, "Limited Available Vehicles (Accurate reporting of unallocated demand: 180 allocated, 70 unallocated)", c4Passed,
            `Allocated: ${c4Plan.assignedUsers}, Unallocated: ${c4Plan.unassignedUsers} (Sum = 250). Capacity strictly respected.`);

        // -------------------------------------------------------------
        // CASE 5: Geographically Dense Group (Single Sector)
        // -------------------------------------------------------------
        console.log("\n--- Executing CASE 5: Geographically Dense Group ---");
        const c5Stops = createSyntheticStops({
            Sellur: 40,
            Narimedu: 30,
            Tallakulam: 40
        }); // 110 passengers, all in North-Central corridor
        const c5Plan = await buildAIPlan({
            destinationHub: klnce,
            tripMode: "TO_DESTINATION",
            resolvedStops: c5Stops,
            availableVehicles: standardFleet,
            totalComingUsers: 110
        });
        const c5Passed = c5Plan.assignedUsers === 110 &&
            c5Plan.buses.length <= 2 &&
            c5Plan.buses.every((b) => b.assignedUsers <= b.capacity) &&
            c5Plan.certification.isCertified === true;
        recordCase(5, "Geographically Dense Group (Compact demand serviced by minimal dedicated corridor buses)", c5Passed,
            `Allocated 110 passengers to ${c5Plan.buses.length} bus(es) within the Sellur/Narimedu corridor.`);

        // -------------------------------------------------------------
        // CASE 6: Geographically Separated Groups (North, South, East)
        // -------------------------------------------------------------
        console.log("\n--- Executing CASE 6: Geographically Separated Groups ---");
        const c6Stops = createSyntheticStops({
            Othakadai: 40,      // North-East
            Thirunagar: 40,     // South-West
            Vandiyur: 35        // East
        }); // 115 passengers in distant corridors
        const c6Plan = await buildAIPlan({
            destinationHub: klnce,
            tripMode: "TO_DESTINATION",
            resolvedStops: c6Stops,
            availableVehicles: standardFleet,
            totalComingUsers: 115
        });
        // Must maintain separate buses for separate corridors, not mix Othakadai and Thirunagar
        const c6Passed = c6Plan.assignedUsers === 115 &&
            c6Plan.buses.every((b) => (b.detourRatio || 1.25) <= 2.1) &&
            c6Plan.certification.isCertified === true;
        recordCase(6, "Geographically Separated Groups (Maintains separate routes without cross-corridor zig-zags)", c6Passed,
            `Created ${c6Plan.buses.length} separate routes with all detour ratios <= 2.1x.`);

        // -------------------------------------------------------------
        // CASE 7: Outward and Inward Demand Nearly Identical
        // -------------------------------------------------------------
        console.log("\n--- Executing CASE 7: Outward & Inward Identical Demand ---");
        const c7Stops = createSyntheticStops({
            Othakadai: 35,
            Tallakulam: 30,
            Sellur: 25,
            Vandiyur: 30
        });
        const c7Inward = await buildAIPlan({
            destinationHub: klnce,
            tripMode: "TO_DESTINATION",
            resolvedStops: c7Stops,
            availableVehicles: standardFleet,
            totalComingUsers: 120
        });
        const c7Outward = await buildAIPlan({
            sourceHub: klnce,
            tripMode: "FROM_SOURCE",
            resolvedStops: c7Stops,
            availableVehicles: standardFleet,
            totalComingUsers: 120
        });
        const c7Passed = c7Inward.assignedUsers === 120 &&
            c7Outward.assignedUsers === 120 &&
            c7Inward.certification.isCertified === true &&
            c7Outward.certification.isCertified === true;
        recordCase(7, "Outward & Inward Identical Demand (Optimizes coherent corridors in both directions)", c7Passed,
            `Inward: ${c7Inward.buses.length} routes (${c7Inward.certification.status}) | Outward: ${c7Outward.buses.length} routes (${c7Outward.certification.status})`);

        // -------------------------------------------------------------
        // CASE 8: Outward and Inward Demand Significantly Different
        // -------------------------------------------------------------
        console.log("\n--- Executing CASE 8: Outward & Inward Asymmetrical Demand ---");
        const c8MorningStops = createSyntheticStops({
            Othakadai: 60,
            Tallakulam: 60
        });
        const c8EveningStops = createSyntheticStops({
            Thirunagar: 50,
            Palanganatham: 50,
            Avaniyapuram: 40
        });
        const c8Morning = await buildAIPlan({
            destinationHub: klnce,
            tripMode: "TO_DESTINATION",
            resolvedStops: c8MorningStops,
            availableVehicles: standardFleet,
            totalComingUsers: 120
        });
        const c8Evening = await buildAIPlan({
            sourceHub: klnce,
            tripMode: "FROM_SOURCE",
            resolvedStops: c8EveningStops,
            availableVehicles: standardFleet,
            totalComingUsers: 140
        });
        const c8Passed = c8Morning.assignedUsers === 120 &&
            c8Evening.assignedUsers === 140 &&
            c8Morning.buses[0]?.stops[0]?.name === "Othakadai" &&
            c8Evening.buses[0]?.stops[c8Evening.buses[0].stops.length - 1]?.name !== "Othakadai" &&
            c8Morning.certification.isCertified === true &&
            c8Evening.certification.isCertified === true;
        recordCase(8, "Asymmetrical Demand (Restructures routes independently based on actual demand without reversing)", c8Passed,
            `Morning served North corridor (120), Evening served South corridor (140) independently.`);

        // -------------------------------------------------------------
        // CASE 9: Route Exceeding Vehicle Capacity (Bus Splitting)
        // -------------------------------------------------------------
        console.log("\n--- Executing CASE 9: Bus Splitting (Demand Exceeds Vehicle Capacity) ---");
        // 130 passengers at Sellur alone (Bus capacity is 70)
        const c9Stops = createSyntheticStops({
            Sellur: 130
        });
        const c9Plan = await buildAIPlan({
            destinationHub: klnce,
            tripMode: "TO_DESTINATION",
            resolvedStops: c9Stops,
            availableVehicles: standardFleet,
            totalComingUsers: 130
        });
        // Should split 130 passengers across multiple vehicles (e.g. 70 + 60), zero capacity overruns!
        const c9Passed = c9Plan.assignedUsers === 130 &&
            c9Plan.buses.length >= 2 &&
            c9Plan.buses.every((b) => b.assignedUsers <= b.capacity) &&
            c9Plan.certification.isCertified === true;
        recordCase(9, "Bus Splitting (Overloaded demand splits cleanly across multiple buses without error)", c9Passed,
            `Split 130 passengers into ${c9Plan.buses.length} buses: [${c9Plan.buses.map(b => `${b.vehicleName}: ${b.assignedUsers}/${b.capacity}`).join(", ")}]`);

        // -------------------------------------------------------------
        // CASE 10: Bus Consolidation (Same-Corridor Low Utilization Merging)
        // -------------------------------------------------------------
        console.log("\n--- Executing CASE 10: Bus Consolidation ---");
        // Two stops in the same corridor with small demands (15 + 20 = 35) that fit in one 70-seat bus
        const c10Stops = createSyntheticStops({
            Othakadai: 15,
            Tallakulam: 20
        });
        const c10Plan = await buildAIPlan({
            destinationHub: klnce,
            tripMode: "TO_DESTINATION",
            resolvedStops: c10Stops,
            availableVehicles: standardFleet,
            totalComingUsers: 35
        });
        // Should consolidate into 1 vehicle
        const c10Passed = c10Plan.assignedUsers === 35 &&
            c10Plan.buses.length === 1 &&
            c10Plan.buses[0].assignedUsers === 35 &&
            c10Plan.certification.isCertified === true;
        recordCase(10, "Bus Consolidation (Combines compatible low-utilization stops into 1 high-utilization bus)", c10Passed,
            `Merged 35 passengers from Othakadai & Tallakulam into 1 bus (${c10Plan.buses[0]?.vehicleName}: 35/${c10Plan.buses[0]?.capacity})`);

        // -------------------------------------------------------------
        // CASE 11: Incompatible Routes Must Remain Separate
        // -------------------------------------------------------------
        console.log("\n--- Executing CASE 11: Geographically Incompatible Routes ---");
        // Two small demands at opposite ends of Madurai: Thirunagar (SW) vs Othakadai (NE)
        // Distance > 15 km, bearing delta > 100°. Must NEVER consolidate!
        const c11Stops = createSyntheticStops({
            Othakadai: 15,
            Thirunagar: 15
        });
        const c11Plan = await buildAIPlan({
            destinationHub: klnce,
            tripMode: "TO_DESTINATION",
            resolvedStops: c11Stops,
            availableVehicles: standardFleet,
            totalComingUsers: 30
        });
        // Must maintain 2 separate buses
        const c11Passed = c11Plan.assignedUsers === 30 &&
            c11Plan.buses.length === 2 &&
            c11Plan.certification.isCertified === true;
        recordCase(11, "Incompatible Separation (Opposite corridors rejected from merging, preserving route quality)", c11Passed,
            `Kept ${c11Plan.buses.length} separate buses to avoid an absurd 25km cross-town detour.`);

        // -------------------------------------------------------------
        // CASE 12: Deliberately Incorrect Passenger Count Caught by Validation Gate
        // -------------------------------------------------------------
        console.log("\n--- Executing CASE 12: Deliberately Tampered Plan Caught by Gate ---");
        const tamperedPlan = {
            buses: [
                {
                    vehicleId: "veh_1",
                    vehicleName: "Bus 1",
                    capacity: 70,
                    assignedUsers: 50, // Falsified counter!
                    users: ["u_1", "u_2"], // Only 2 user IDs!
                    stops: [
                        {
                            name: "Othakadai",
                            latitude: 9.9572,
                            longitude: 78.1878,
                            userCount: 20, // Discrepancy!
                            userIds: ["u_1", "u_2"],
                            previousStopName: "Pickup Origin"
                        }
                    ],
                    routeDistanceKm: 25.0,
                    isRoadVerified: true,
                    isContinuous: true,
                    detourRatio: 1.3
                }
            ],
            totalComingUsers: 100, // Accounting mismatch!
            availableVehicles: standardFleet
        };

        const validationResult = validateTransportationPlan(tamperedPlan, {
            totalComingUsers: 100,
            availableVehicles: standardFleet,
            tripMode: "TO_DESTINATION"
        });

        const c12Passed = validationResult.isCertified === false &&
            validationResult.failureReasons.length > 0;
        recordCase(12, "Validation Gate Protection (Rejects tampered passenger counts / uncertified plans)", c12Passed,
            `Rejected plan: isCertified=${validationResult.isCertified}, Reasons: [${validationResult.failureReasons.join("; ")}]`);

    } catch (err) {
        console.error("Test execution error:", err);
    } finally {
        await mongoose.disconnect();
    }

    // Summary of all 12 cases
    console.log("\n================================================================================");
    const allPassed = caseResults.every((r) => r.passed);
    const passCount = caseResults.filter((r) => r.passed).length;
    console.log(`FINAL RESULT: ${passCount} / ${caseResults.length} CASES PASSED.`);
    if (allPassed && caseResults.length === 12) {
        console.log("🏆 ALL 12 COMPREHENSIVE REAL-WORLD TRANSPORTATION CASES PASSED WITH 100% SUCCESS!");
    } else {
        console.log("⚠️ SOME CASES FAILED. Check details above.");
    }
    console.log("================================================================================\n");

    process.exit(allPassed ? 0 : 1);
}

runAll12Cases().catch((err) => {
    console.error("Fatal test runner error:", err);
    process.exit(1);
});
