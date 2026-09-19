async function test() {
    const url = "https://router.project-osrm.org/route/v1/driving/78.1882,9.8515;78.1198,9.9252?overview=full&geometries=geojson";
    const start = Date.now();
    const res = await fetch(url);
    const data = await res.json();
    console.log("Status:", data.code, "Coords:", data.routes?.[0]?.geometry?.coordinates?.length, "Time:", Date.now() - start, "ms");
}
test().catch(console.error);
