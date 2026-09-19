import dotenv from "dotenv";
dotenv.config();
import connectDB from "../config/db.js";
import User from "../models/User.js";
import { generateAgentRecommendations } from "../services/aiAgentService.js";

async function compare() {
    await connectDB();

    // 1. All distinct stopping areas in the User collection
    const rawStoppings = await User.distinct("stoppings");
    const all30Stoppings = rawStoppings.map(s => (s || "").trim()).filter(Boolean).sort();

    // Counts per stopping area for Coming, Not Coming, Pending, Total
    const stopStats = {};
    for (const stop of all30Stoppings) {
        const total = await User.countDocuments({ stoppings: stop });
        const coming = await User.countDocuments({ stoppings: stop, travelStatus: "Coming" });
        const notComing = await User.countDocuments({ stoppings: stop, travelStatus: "Not Coming" });
        const pending = await User.countDocuments({ stoppings: stop, travelStatus: { $nin: ["Coming", "Not Coming"] } });
        stopStats[stop] = { total, coming, notComing, pending };
    }

    // 2. Run outward plan generation to inspect which stops are in the outward routes
    const outwardResult = await generateAgentRecommendations({
        tripMode: "FROM_SOURCE",
        direction: "OUTWARD",
        source: {
            name: "KLN College of Engineering",
            address: "Pottapalayam, Sivagangai / Madurai - 630612",
            latitude: 9.8515,
            longitude: 78.1882
        }
    });

    const aiPlan = outwardResult?.aiPlan || outwardResult?.plan;
    const buses = aiPlan?.buses || [];

    const stopsInOutwardPlan = new Set();
    const stopDropCountsInOutwardPlan = {};

    buses.forEach(b => {
        (b.stops || []).forEach(s => {
            const name = (s.name || s.stopName || "").trim();
            if (name) {
                stopsInOutwardPlan.add(name);
                stopDropCountsInOutwardPlan[name] = (stopDropCountsInOutwardPlan[name] || 0) + (s.passengersDropped ?? s.userCount ?? 0);
            }
        });
    });

    const includedList = Array.from(stopsInOutwardPlan).sort();
    const missingList = all30Stoppings.filter(s => !stopsInOutwardPlan.has(s));

    console.log("=== COMPARISON RESULTS ===");
    console.log(`Total Dataset Stopping Areas: ${all30Stoppings.length}`);
    console.log(`Stops in Outward Plan: ${includedList.length}`);
    console.log(`Missing Stops Count: ${missingList.length}`);
    console.log("\nALL 30 STOPPING AREAS AND DB STATS:");
    all30Stoppings.forEach((s, idx) => {
        const stats = stopStats[s];
        const inPlan = stopsInOutwardPlan.has(s) ? "INCLUDED" : "MISSING";
        console.log(`${idx + 1}. [${inPlan}] ${s}: Total=${stats.total}, Coming=${stats.coming}, NotComing=${stats.notComing}, Pending=${stats.pending}`);
    });

    console.log("\nINCLUDED 28 STOPS IN OUTWARD PLAN:");
    includedList.forEach((s, idx) => {
        console.log(`${idx + 1}. ${s} (Dropped in plan: ${stopDropCountsInOutwardPlan[s]})`);
    });

    console.log("\nMISSING STOPPING AREAS:");
    missingList.forEach((s, idx) => {
        const stats = stopStats[s];
        console.log(`${idx + 1}. ${s}: Total=${stats.total}, Coming=${stats.coming}`);
    });

    process.exit(0);
}

compare().catch(e => {
    console.error(e);
    process.exit(1);
});
