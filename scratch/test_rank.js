/**
 * Test script to verify external search queries against Nominatim and Photon
 */
const queries = [
    "KLN College of Engineering",
    "KLN College of Engineering, Sivagangai",
    "Burj Khalifa",
    "Arappalayam, Madurai",
    "Chennai Central Railway Station",
    "Chennai International Airport",
    "IIT Madras",
    "Eiffel Tower",
    "Times Square",
    "London"
];

const normalizeStr = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();

const ALIASES = {
    "sivagangai": ["sivaganga", "sivagangai"],
    "sivaganga": ["sivaganga", "sivagangai"],
    "bengaluru": ["bangalore", "bengaluru"],
    "bangalore": ["bangalore", "bengaluru"],
    "chennai": ["madras", "chennai"],
    "madras": ["madras", "chennai"],
    "kln": ["k.l.n", "kln", "k l n"],
    "iit": ["i.i.t", "iit", "indian institute of technology"],
    "engg": ["engineering", "engg"],
    "rly": ["railway", "rly"],
    "apt": ["airport", "apt"]
};

function getExpandedTokens(text) {
    const rawTokens = normalizeStr(text).split(" ").filter(t => t.length > 0 && !["of", "and", "the", "in", "at", "for", "to", "a", "an"].includes(t));
    const expanded = new Set();
    for (const t of rawTokens) {
        expanded.add(t);
        if (ALIASES[t]) {
            ALIASES[t].forEach(a => expanded.add(normalizeStr(a)));
        }
    }
    return { rawTokens, expandedTokens: Array.from(expanded) };
}

function scoreCandidate(item, query) {
    const normQuery = normalizeStr(query);
    const normName = normalizeStr(item.name);
    const normAddr = normalizeStr(item.address || item.displayName || "");
    const { rawTokens, expandedTokens } = getExpandedTokens(query);

    let score = 0;

    // 1. Exact name match
    if (normName === normQuery) {
        score += 15000;
    } else if (normName.startsWith(normQuery)) {
        score += 8000;
    } else if (normName.includes(normQuery)) {
        score += 5000;
    }

    // 2. Token matches in Name vs Address
    let nameTokenMatches = 0;
    let addrTokenMatches = 0;
    let missingSignificantTokens = 0;

    for (const token of rawTokens) {
        const tokenAliases = ALIASES[token] ? ALIASES[token].map(normalizeStr) : [token];
        const inName = tokenAliases.some(a => normName.includes(a));
        const inAddr = tokenAliases.some(a => normAddr.includes(a));

        if (inName) {
            nameTokenMatches++;
            score += 3000; // Strong weight for match in name
        } else if (inAddr) {
            addrTokenMatches++;
            score += 1000; // Weight for match in address
        } else {
            missingSignificantTokens++;
            // If token has length >= 3 and is not found, penalty
            if (token.length >= 3) {
                score -= 1500;
            }
        }
    }

    // All query tokens present bonus
    if (missingSignificantTokens === 0 && rawTokens.length > 0) {
        score += 6000;
    }

    // Specific entity identification bonus:
    // If query has distinctive tokens (like "kln", "burj", "eiffel", "iit", "arappalayam")
    for (const distinctive of ["kln", "burj", "eiffel", "iit", "arappalayam", "khalifa", "madras"]) {
        if (rawTokens.includes(distinctive)) {
            const hasDistinctive = normName.includes(distinctive) || normAddr.includes(distinctive);
            if (hasDistinctive) {
                score += 5000;
            } else {
                score -= 10000; // Heavily penalize results missing distinctive identifier
            }
        }
    }

    // POI importance boost
    if (item.importance) {
        score += Number(item.importance) * 2000;
    }

    return score;
}

async function testSearch(q) {
    console.log(`\n========================================\nTesting query: "${q}"`);
    try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&namedetails=1&limit=10&accept-language=en`;
        const res = await fetch(url, {
            headers: {
                "User-Agent": "AI-Transportation-Management-System-Test/1.0",
                "Accept": "application/json"
            }
        });
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) {
            console.log("No Nominatim results, testing Photon...");
            const pUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=10`;
            const pRes = await fetch(pUrl);
            const pData = await pRes.json();
            console.log(`Photon returned ${(pData.features || []).length} results`);
            return;
        }

        const candidates = data.map(item => {
            const addr = item.address || {};
            const displayName = item.display_name || "";
            const name = item.namedetails?.name || item.namedetails?.["name:en"] || item.name || displayName.split(",")[0] || "Location";
            return {
                name,
                address: displayName,
                displayName,
                latitude: Number(item.lat),
                longitude: Number(item.lon),
                importance: item.importance
            };
        });

        const scored = candidates.map(c => ({
            ...c,
            score: scoreCandidate(c, q)
        })).sort((a, b) => b.score - a.score);

        console.log(`TOP 3 RESULTS:`);
        scored.slice(0, 3).forEach((r, idx) => {
            console.log(`  #${idx + 1} (Score: ${r.score}): ${r.name}`);
            console.log(`      Address: ${r.address}`);
            console.log(`      Coordinates: ${r.latitude}, ${r.longitude}`);
        });
    } catch (err) {
        console.error("Search error:", err.message);
    }
}

async function runAll() {
    for (const q of queries) {
        await testSearch(q);
        // Small delay to respect Nominatim rate limit
        await new Promise(r => setTimeout(r, 600));
    }
}

runAll();
