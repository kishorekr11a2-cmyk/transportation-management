const headers = {
    "User-Agent": "AI-Transportation-System-Diagnosis/1.0",
    "Accept": "application/json"
};

async function testOverpass() {
    console.log("=== Querying Overpass API for all institutions in Tamil Nadu / Sivaganga ===");
    
    // Fast targeted Overpass QL
    const ql = `[out:json][timeout:15];
    (
      nwr["name"~"K.*L.*N|KLN|Pottapalayam",i];
    );
    out center tags 20;`;

    const mirrors = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
        "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
    ];

    for (const m of mirrors) {
        try {
            console.log("Trying Overpass mirror:", m);
            const res = await fetch(m, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: "data=" + encodeURIComponent(ql)
            });
            if (res.ok) {
                const json = await res.json();
                console.log("Overpass found elements count:", json.elements?.length);
                json.elements?.forEach(el => {
                    const name = el.tags?.name || el.tags?.["name:en"];
                    const lat = el.lat ?? el.center?.lat;
                    const lon = el.lon ?? el.center?.lon;
                    console.log(`  -> ID: ${el.id}, Type: ${el.type}, Name: "${name}", Lat: ${lat}, Lon: ${lon}`);
                    console.log("     Tags:", JSON.stringify(el.tags));
                });
                return;
            }
        } catch (e) {
            console.log("Mirror error:", e.message);
        }
    }
}

async function testPhotonQueries() {
    console.log("\n=== Querying Photon for variations ===");
    const queries = [
        "KLN",
        "K.L.N",
        "K.L.N.",
        "K L N",
        "KLNCE",
        "Pottapalayam",
        "Sivagangai",
        "Madurai KLN",
        "Pottapalayam Madurai",
        "K.L.N. Vidyalaya",
        "K.L.N. College",
        "KLN College"
    ];

    for (const q of queries) {
        try {
            const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5&lang=en`;
            const res = await fetch(url, { headers });
            if (res.ok) {
                const json = await res.json();
                console.log(`Photon for "${q}": (${json.features?.length} results)`);
                json.features?.forEach(f => {
                    const p = f.properties;
                    const c = f.geometry.coordinates;
                    console.log(`   * "${p.name}", ${p.city || p.district || ""}, ${p.state || ""}, Lat: ${c[1]}, Lon: ${c[0]}`);
                });
            }
        } catch (e) {
            console.log(`Photon error for "${q}":`, e.message);
        }
    }
}

async function run() {
    await testOverpass();
    await testPhotonQueries();
}

run();
