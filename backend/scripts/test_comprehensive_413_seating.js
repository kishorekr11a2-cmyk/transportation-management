import dotenv from "dotenv";
dotenv.config();
import assert from "node:assert/strict";
import {
    buildAIPlan,
    validateTransportationPlan
} from "../services/aiAgentService.js";
import { DEFAULT_SOURCE_HUB } from "../services/mapGeocodingService.js";

const stopsData = {
    Vandiyur: { name: "Vandiyur", latitude: 9.92, longitude: 78.165, userCount: 18, userIds: Array.from({length: 18}, (_, i) => `u_v_${i}`) },
    "K.K. Nagar West": { name: "K.K. Nagar West", latitude: 9.925, longitude: 78.146, userCount: 18, userIds: Array.from({length: 18}, (_, i) => `u_kw_${i}`) },
    Narimedu: { name: "Narimedu", latitude: 9.938, longitude: 78.132, userCount: 7, userIds: Array.from({length: 7}, (_, i) => `u_n_${i}`) },
    Sellur: { name: "Sellur", latitude: 9.941, longitude: 78.118, userCount: 7, userIds: Array.from({length: 7}, (_, i) => `u_s_${i}`) },
    Vilangudi: { name: "Vilangudi", latitude: 9.951, longitude: 78.092, userCount: 11, userIds: Array.from({length: 11}, (_, i) => `u_vg_${i}`) },
    "Koodal Nagar": { name: "Koodal Nagar", latitude: 9.967663, longitude: 78.096438, userCount: 12, userIds: Array.from({length: 12}, (_, i) => `u_kn_${i}`) },

    viraganur: { name: "viraganur", latitude: 9.9005203, longitude: 78.162842, userCount: 12, userIds: Array.from({length: 12}, (_, i) => `u_vr_${i}`) },
    Anuppanadi: { name: "Anuppanadi", latitude: 9.907, longitude: 78.151, userCount: 3, userIds: Array.from({length: 3}, (_, i) => `u_an_${i}`) },
    Othakadai: { name: "Othakadai", latitude: 9.97, longitude: 78.18, userCount: 15, userIds: Array.from({length: 15}, (_, i) => `u_ot_${i}`) },
    Thiruppalai: { name: "Thiruppalai", latitude: 9.9825, longitude: 78.143, userCount: 14, userIds: Array.from({length: 14}, (_, i) => `u_tp_${i}`) },
    "Iyer Bungalow": { name: "Iyer Bungalow", latitude: 9.965, longitude: 78.141, userCount: 13, userIds: Array.from({length: 13}, (_, i) => `u_ib_${i}`) },
    "K.Pudur": { name: "K.Pudur", latitude: 9.952, longitude: 78.146, userCount: 13, userIds: Array.from({length: 13}, (_, i) => `u_kp_${i}`) },

    Villapuram: { name: "Villapuram", latitude: 9.895, longitude: 78.132, userCount: 10, userIds: Array.from({length: 10}, (_, i) => `u_vp_${i}`) },
    Mahal: { name: "Mahal", latitude: 9.915006, longitude: 78.1220546, userCount: 1, userIds: Array.from({length: 1}, (_, i) => `u_mh_${i}`) },
    Periyar: { name: "Periyar", latitude: 9.9175, longitude: 78.114, userCount: 9, userIds: Array.from({length: 9}, (_, i) => `u_pr_${i}`) },
    Arappalayam: { name: "Arappalayam", latitude: 9.9322, longitude: 78.1025, userCount: 26, userIds: Array.from({length: 26}, (_, i) => `u_ar_${i}`) },
    Kalavasal: { name: "Kalavasal", latitude: 9.930305555555554, longitude: 78.0955, userCount: 10, userIds: Array.from({length: 10}, (_, i) => `u_kl_${i}`) },
    Kochadai: { name: "Kochadai", latitude: 9.936, longitude: 78.085, userCount: 14, userIds: Array.from({length: 14}, (_, i) => `u_kc_${i}`) },

    Simmakkal: { name: "Simmakkal", latitude: 9.9255, longitude: 78.1192, userCount: 22, userIds: Array.from({length: 22}, (_, i) => `u_sm_${i}`) },
    Goripalayam: { name: "Goripalayam", latitude: 9.9315, longitude: 78.1275, userCount: 20, userIds: Array.from({length: 20}, (_, i) => `u_gp_${i}`) },
    Tallakulam: { name: "Tallakulam", latitude: 9.936, longitude: 78.135, userCount: 21, userIds: Array.from({length: 21}, (_, i) => `u_tk_${i}`) },
    Bibikulam: { name: "Bibikulam", latitude: 9.942, longitude: 78.136, userCount: 6, userIds: Array.from({length: 6}, (_, i) => `u_bk_${i}`) },

    "Anna Nagar": { name: "Anna Nagar", latitude: 9.918, longitude: 78.1467, userCount: 30, userIds: Array.from({length: 30}, (_, i) => `u_an2_${i}`) },
    "KK Nagar": { name: "KK Nagar", latitude: 9.927, longitude: 78.151, userCount: 21, userIds: Array.from({length: 21}, (_, i) => `u_kn2_${i}`) },
    Mattuthavani: { name: "Mattuthavani", latitude: 9.945, longitude: 78.158, userCount: 17, userIds: Array.from({length: 17}, (_, i) => `u_mt_${i}`) },

    Teppakulam: { name: "Teppakulam", latitude: 9.914, longitude: 78.147, userCount: 16, userIds: Array.from({length: 16}, (_, i) => `u_tp2_${i}`) },
    Avaniyapuram: { name: "Avaniyapuram", latitude: 9.878, longitude: 78.124, userCount: 9, userIds: Array.from({length: 9}, (_, i) => `u_av_${i}`) },
    Jaihindpuram: { name: "Jaihindpuram", latitude: 9.902, longitude: 78.112, userCount: 10, userIds: Array.from({length: 10}, (_, i) => `u_jh_${i}`) },
    Palanganatham: { name: "Palanganatham", latitude: 9.905, longitude: 78.098, userCount: 12, userIds: Array.from({length: 12}, (_, i) => `u_pl_${i}`) },
    "Alagappan Nagar": { name: "Alagappan Nagar", latitude: 9.892, longitude: 78.099, userCount: 9, userIds: Array.from({length: 9}, (_, i) => `u_al_${i}`) },
    Thirunagar: { name: "Thirunagar", latitude: 9.869, longitude: 78.069, userCount: 7, userIds: Array.from({length: 7}, (_, i) => `u_tn_${i}`) }
};

const totalDemand = Object.values(stopsData).reduce((s, st) => s + st.userCount, 0);
console.log(`Demand dataset loaded: ${totalDemand} confirmed passengers.`);
assert.equal(totalDemand, 413, "Demand must equal exactly 413 users");

// Real fleet capacities as configured in schedule
const availableVehicles = [
    { _id: "veh_V1", id: "veh_V1", vehicleName: "V1", capacity: 65, seatCapacity: 65, isActive: true },
    { _id: "veh_w1", id: "veh_w1", vehicleName: "w1", capacity: 60, seatCapacity: 60, isActive: true },
    { _id: "veh_z1", id: "veh_z1", vehicleName: "z1", capacity: 55, seatCapacity: 55, isActive: true },
    { _id: "veh_h1", id: "veh_h1", vehicleName: "h1", capacity: 55, seatCapacity: 55, isActive: true },
    { _id: "veh_k1", id: "veh_k1", vehicleName: "k1", capacity: 50, seatCapacity: 50, isActive: true },
    { _id: "veh_D1", id: "veh_D1", vehicleName: "D1", capacity: 50, seatCapacity: 50, isActive: true },
    { _id: "veh_I1", id: "veh_I1", vehicleName: "I1", capacity: 50, seatCapacity: 50, isActive: true },
    { _id: "veh_A2", id: "veh_A2", vehicleName: "A2", capacity: 50, seatCapacity: 50, isActive: true },
    { _id: "veh_Q1", id: "veh_Q1", vehicleName: "Q1", capacity: 50, seatCapacity: 50, isActive: true }
];

const inwardStartingPlaces = [
    { busName: "V1", stoppingArea: "Othakadai", latitude: 9.97, longitude: 78.18, active: true },
    { busName: "w1", stoppingArea: "Thiruppalai", latitude: 9.9825, longitude: 78.143, active: true },
    { busName: "h1", stoppingArea: "Goripalayam", latitude: 9.9315, longitude: 78.1275, active: true },
    { busName: "k1", stoppingArea: "Arappalayam", latitude: 9.9322, longitude: 78.1025, active: true },
    { busName: "z1", stoppingArea: "Koodal Nagar", latitude: 9.967663, longitude: 78.096438, active: true },
    { busName: "D1", stoppingArea: "Thirunagar", latitude: 9.869, longitude: 78.069, active: true },
    { busName: "I1", stoppingArea: "Sellur", latitude: 9.941, longitude: 78.118, active: true },
    { busName: "A2", stoppingArea: "Mattuthavani", latitude: 9.945, longitude: 78.158, active: true },
    { busName: "Q1", stoppingArea: "Villapuram", latitude: 9.895, longitude: 78.132, active: true }
];

const confirmedUsers = Object.values(stopsData).flatMap(st => 
    st.userIds.map(uid => ({
        _id: uid,
        id: uid,
        userId: uid,
        stoppingArea: st.name,
        travelStatus: "Coming",
        latitude: st.latitude,
        longitude: st.longitude
    }))
);

async function main() {
    const getFreshStops = () => JSON.parse(JSON.stringify(Object.values(stopsData)));

    console.log("\n=======================================================");
    console.log("1. EXECUTING INWARD OPTIMIZATION (413 USERS)");
    console.log("=======================================================");
    const inwardPlan = await buildAIPlan({
        sourceHub: DEFAULT_SOURCE_HUB,
        destinationHub: DEFAULT_SOURCE_HUB,
        tripMode: "TO_DESTINATION",
        resolvedStops: getFreshStops(),
        availableVehicles,
        rawVehicles: availableVehicles,
        totalComingUsers: 413,
        allUsersCount: 413,
        totalAvailableCapacity: 485,
        physicalFleetCapacity: 485,
        confirmedUsers,
        activeInwardStartingPlaces: inwardStartingPlaces
    });

    console.log(`\nInward Plan Generated: ${inwardPlan.buses.length} buses.`);
    let inwardStanding = 0;
    let inwardOverCapacity = 0;
    inwardPlan.buses.forEach((b, idx) => {
        const excess = Math.max(0, b.assignedUsers - b.capacity);
        const st = b.standingPassengers || 0;
        inwardStanding += st;
        if (b.assignedUsers > b.capacity) inwardOverCapacity++;
        console.log(`  [R-${String(idx+1).padStart(2, '0')}] ${b.vehicleName} (${b.capacity} seats, ${b.assignedUsers} pax, ${st} standing, ${b.routeDistanceKm} km, detour ${b.detourRatio}x): ${b.whySeparateRouteNeeded}`);
        console.log(`      stops: ${(b.stops || []).map(s => s.name).join(' -> ')}`);
        console.log(`      continuity: ${JSON.stringify(b.continuityValidation || {})}`);
        console.log(`      quality: ${JSON.stringify(b.routeQuality || {})}`);
    });
    console.log(`Total Inward Assigned: ${inwardPlan.assignedUsers}/${totalDemand}`);
    console.log(`Total Inward Standing: ${inwardStanding}`);
    console.log(`Over-capacity buses: ${inwardOverCapacity}`);

    assert.equal(inwardPlan.assignedUsers, 413, "Inward assigned must equal 413");
    assert.equal(inwardStanding, 0, "Inward standing passengers MUST BE 0");
    assert.equal(inwardOverCapacity, 0, "No Inward bus may exceed capacity");

    console.log("\n=======================================================");
    console.log("2. EXECUTING OUTWARD OPTIMIZATION (413 USERS, FLEET REUSE)");
    console.log("=======================================================");
    const outwardPlan = await buildAIPlan({
        sourceHub: DEFAULT_SOURCE_HUB,
        destinationHub: DEFAULT_SOURCE_HUB,
        tripMode: "FROM_SOURCE",
        resolvedStops: getFreshStops(),
        availableVehicles,
        rawVehicles: availableVehicles,
        totalComingUsers: 413,
        allUsersCount: 413,
        totalAvailableCapacity: 485,
        physicalFleetCapacity: 485,
        confirmedUsers,
        oppositePlan: inwardPlan
    });

    console.log(`\nOutward Plan Generated: ${outwardPlan.buses.length} buses.`);
    let outwardStanding = 0;
    let outwardOverCapacity = 0;
    outwardPlan.buses.forEach((b, idx) => {
        const excess = Math.max(0, b.assignedUsers - b.capacity);
        const st = b.standingPassengers || 0;
        outwardStanding += st;
        if (b.assignedUsers > b.capacity) outwardOverCapacity++;
        console.log(`  [R-${String(idx+1).padStart(2, '0')}] ${b.vehicleName} (${b.capacity} seats, ${b.assignedUsers} pax, ${st} standing, ${b.routeDistanceKm} km, detour ${b.detourRatio}x): ${b.whySeparateRouteNeeded}`);
    });
    console.log(`Total Outward Assigned: ${outwardPlan.assignedUsers}/${totalDemand}`);
    console.log(`Total Outward Standing: ${outwardStanding}`);
    console.log(`Over-capacity buses: ${outwardOverCapacity}`);

    const assignedUids = new Set((outwardPlan.passengerAssignments || []).map(a => a.userId));
    const missingByStop = {};
    for (const st of getFreshStops()) {
        const missing = (st.userIds || []).filter(uid => !assignedUids.has(uid));
        if (missing.length > 0) {
            missingByStop[st.name] = missing.length;
        }
    }
    console.log("Passenger assignments length:", outwardPlan.passengerAssignments.length);
    outwardPlan.buses.forEach((b, idx) => {
        const stopSum = (b.stops || []).reduce((sum, s) => sum + (s.userIds?.length || s.userCount || 0), 0);
        console.log(`  Bus ${b.vehicleName}: assignedUsers=${b.assignedUsers}, stopSum=${stopSum}`);
    });
    assert.equal(outwardPlan.assignedUsers, 413, "Outward assigned must equal 413");
    assert.equal(outwardStanding, 0, "Outward standing passengers MUST BE 0");
    assert.equal(outwardOverCapacity, 0, "No Outward bus may exceed capacity");

    console.log("\n=======================================================");
    console.log("3. AUDIT & VALIDATION RIGOROUS VERIFICATION");
    console.log("=======================================================");
    console.log("Inward Internal Certification:", inwardPlan.status, inwardPlan.certification?.failureReasons);
    console.log("Outward Internal Certification:", outwardPlan.status, outwardPlan.certification?.failureReasons);

    const inwardCert = validateTransportationPlan(inwardPlan, {
        sourceHub: DEFAULT_SOURCE_HUB,
        destinationHub: DEFAULT_SOURCE_HUB,
        tripMode: "TO_DESTINATION",
        totalComingUsers: 413,
        totalAvailableCapacity: inwardPlan.buses.reduce((s, b) => s + b.capacity, 0),
        availableVehicles,
        activeInwardStartingPlaces: inwardStartingPlaces
    });

    const outwardCert = validateTransportationPlan(outwardPlan, {
        sourceHub: DEFAULT_SOURCE_HUB,
        destinationHub: DEFAULT_SOURCE_HUB,
        tripMode: "FROM_SOURCE",
        totalComingUsers: 413,
        totalAvailableCapacity: outwardPlan.buses.reduce((s, b) => s + b.capacity, 0),
        availableVehicles
    });

    console.log("Inward Re-Validation Result:", inwardCert.isCertified ? "PASS" : "FAIL", inwardCert.status, inwardCert.failureReasons);
    console.log("Outward Re-Validation Result:", outwardCert.isCertified ? "PASS" : "FAIL", outwardCert.status, outwardCert.failureReasons);
    assert.equal(inwardCert.isCertified, true, "Inward plan must pass validation");
    assert.equal(outwardCert.isCertified, true, "Outward plan must pass validation");

    // Check authoritative metrics consistency
    console.log("\n=======================================================");
    console.log("4. AUTHORITATIVE METRICS CONSISTENCY CHECK");
    console.log("=======================================================");
    for (const b of [...inwardPlan.buses, ...outwardPlan.buses]) {
        assert.ok(b.whySeparateRouteNeeded.includes(`${b.routeDistanceKm} km`),
            `whySeparateRouteNeeded for ${b.vehicleName} must include authoritative distance ${b.routeDistanceKm} km`);
        assert.ok(b.whySeparateRouteNeeded.includes(`${b.detourRatio}x`),
            `whySeparateRouteNeeded for ${b.vehicleName} must include authoritative detour ${b.detourRatio}x`);
        assert.ok(!b.whySeparateRouteNeeded.includes("Information Technology"),
            `whySeparateRouteNeeded for ${b.vehicleName} must NOT contain 'Information Technology'`);
    }
    console.log("Authoritative metrics check passed: 100% synchronized across cards and rationales!");

    console.log("\n>>> ALL TESTS PASSED: 0 STANDING PASSENGERS GUARANTEED FOR BOTH INWARD & OUTWARD <<<");
}

main().catch(e => {
    console.error("Test failed:", e);
    process.exit(1);
});
