import { searchPlaces } from '../frontend/src/services/locationSearchService.js';

const testQueries = [
    "kln college of engineering",
    "K.L.N. College of Engineering",
    "kln college",
    "kln college pottapalayam",
    "kln college pottapalayam sivagangai",
    "kln engineering college",
    "solamalai college of engineering",
    "arappalayam madurai",
    "chennai central railway station",
    "chennai airport",
    "iit madras",
    "apollo hospital chennai",
    "burj khalifa",
    "eiffel tower",
    "times square",
    "london",
    "mumbai",
    "bengaluru",
    "tokyo station",
    "sydney opera house",
    "pottapalayam",
    "சென்னை சென்ட்ரல்"
];

async function runTests() {
    console.log("================================================================");
    console.log("   TESTING LOCATION SEARCH ENGINE (ALL 22 TEST QUERIES)");
    console.log("================================================================\n");

    const resultsTable = [];

    for (const q of testQueries) {
        try {
            const start = Date.now();
            const res = await searchPlaces(q);
            const duration = Date.now() - start;

            const top = res.results && res.results.length > 0 ? res.results[0] : null;
            const topName = top ? top.name : "NO RESULTS";
            const topAddr = top ? top.address : "";
            const coords = top ? `${Number(top.latitude).toFixed(4)}, ${Number(top.longitude).toFixed(4)}` : "N/A";
            const provider = top ? top.source : "N/A";
            const score = top ? top._score : 0;

            console.log(`[QUERY] "${q}" (${duration}ms)`);
            if (top) {
                console.log(`  -> Top 1: "${topName}" | Score: ${score} | ${coords} | Provider: ${provider}`);
                console.log(`     Addr: ${topAddr}`);
                if (res.results.length > 1) {
                    console.log(`  -> Top 2: "${res.results[1].name}" | Score: ${res.results[1]._score}`);
                }
            } else {
                console.log(`  -> No results returned.`);
            }
            console.log("");

            resultsTable.push({
                Query: q,
                TopResult: topName,
                Coordinates: coords,
                Provider: provider,
                Score: score,
                Success: Boolean(top)
            });

            // Small pause between queries to be respectful to OSM servers
            await new Promise((r) => setTimeout(r, 600));
        } catch (err) {
            console.error(`Error testing "${q}":`, err);
            resultsTable.push({
                Query: q,
                TopResult: "ERROR: " + err.message,
                Coordinates: "N/A",
                Provider: "ERROR",
                Score: 0,
                Success: false
            });
        }
    }

    console.log("\n================================================================");
    console.log("   FINAL RESULTS SUMMARY TABLE");
    console.log("================================================================");
    console.table(resultsTable);
}

runTests();
