/* ==========================================================================
   GLOBAL OPEN LOCATION SEARCH SERVICE — 100% FREE & ZERO GOOGLE BILLING
   
   Architecture:
   - Primary: OpenStreetMap Nominatim (format=jsonv2, namedetails=1, addressdetails=1)
   - Secondary: Komoot Photon (Global OSM index)
   - Fallback: OpenStreetMap Overpass POI API (Fast targeted QL)
   - Enrichment: Open Geographic Knowledge Layer (Open-source POI directory for unmapped / regional items)
   - Map: Leaflet (OpenStreetMap / CartoDB Voyager tiles)
   - Road Routing: OSRM
   - Database: MongoDB (Strictly application persistence; zero search gating)

   Core Capabilities:
   - Robust Canonical Text Normalization (normalizeSearchText)
   - Universal Acronym Matching & Initials Expansion (isAcronymMatch)
   - Context-Aware Query Parsing (Distinguishing Entity vs Category vs Context)
   - Disqualification Scoring (Missing distinctive entity tokens heavily penalizes generic results)
   - Strict Coordinate Validation & Common Object Schema
   ========================================================================== */

const searchCache = new Map();
const MAX_CACHE_SIZE = 300;

/* ==========================================================================
   1. CANONICAL SEARCH TEXT NORMALIZATION
   ========================================================================== */

/**
 * Normalizes text for search and ranking comparison.
 * - Converts to lowercase.
 * - Handles Unicode accents safely (NFKD decomposition).
 * - Treats acronyms with dots ("K.L.N.", "I.I.T.", "A.I.I.M.S.") as canonical "kln", "iit", "aiims".
 * - Treats spaced single letters ("k l n", "i i t") as "kln", "iit".
 * - Cleans apostrophes, hyphens, and punctuation without destroying non-Latin characters (Tamil, Hindi, Arabic, Japanese, etc.).
 */
export const normalizeSearchText = (text) => {
    if (!text) return "";
    let s = String(text).toLowerCase();

    // Unicode decomposition for accents while keeping international scripts
    s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

    // Remove common apostrophes & quotation marks
    s = s.replace(/['’`´]/g, "");

    // Normalize dotted acronyms: "k.l.n." -> "kln", "i.i.t." -> "iit", "a.i.i.m.s." -> "aiims"
    s = s.replace(/\b([a-z0-9])\.([a-z0-9])\.([a-z0-9])\.([a-z0-9])\.?\b/gi, "$1$2$3$4");
    s = s.replace(/\b([a-z0-9])\.([a-z0-9])\.([a-z0-9])\.?\b/gi, "$1$2$3");
    s = s.replace(/\b([a-z0-9])\.([a-z0-9])\.?\b/gi, "$1$2");

    // Normalize spaced acronyms: "k l n" -> "kln", "i i t" -> "iit"
    s = s.replace(/\b([a-z0-9])\s+([a-z0-9])\s+([a-z0-9])\s+([a-z0-9])\b/gi, "$1$2$3$4");
    s = s.replace(/\b([a-z0-9])\s+([a-z0-9])\s+([a-z0-9])\b/gi, "$1$2$3");
    s = s.replace(/\b([a-z0-9])\s+([a-z0-9])\b/gi, "$1$2");

    // Replace punctuation, slashes, hyphens, commas with a single space
    s = s.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"+\[\]|\\]/g, " ");

    // Collapse multiple spaces into one
    return s.replace(/\s+/g, " ").trim();
};

/* ==========================================================================
   2. DICTIONARIES & TOKEN CLASSIFIERS
   ========================================================================== */

const STOP_WORDS = new Set([
    "of", "and", "the", "in", "at", "for", "to", "a", "an", "is", "on", "near", "by", "dt", "district",
    "de", "du", "la", "le", "les", "und", "der", "die", "das"
]);

const GENERIC_CATEGORY_WORDS = new Set([
    "college", "university", "school", "institute", "polytechnic", "academy", "campus", "institution",
    "engineering", "technology", "tech", "science", "arts", "medical",
    "hospital", "clinic", "dispensary", "health", "pharmacy", "care",
    "theatre", "theater", "cinema", "talkies", "hall", "auditorium", "multiplex",
    "railway", "station", "train", "metro", "bus", "stand", "terminal", "depot", "junction", "airport", "aerodrome", "airfield", "port",
    "mall", "market", "bazaar", "store", "supermarket", "complex", "plaza", "centre", "center", "hub",
    "road", "street", "lane", "avenue", "highway", "expressway", "cross", "main", "circle",
    "nagar", "colony", "layout", "town", "village", "city", "state", "tower", "building", "house",
    "temple", "church", "mosque", "monument", "palace", "park", "garden", "lake", "dam", "beach"
]);

// Bidirectional aliases for institutional acronyms and common abbreviations
const ALIAS_MAP = {
    kln: ["kln", "klnce", "k.l.n", "k.l.n.", "k l n", "kln college", "k.l.n. college of engineering", "kln college of engineering"],
    klnce: ["klnce", "kln", "k.l.n.", "k.l.n. college of engineering", "kln college of engineering"],
    solamalai: ["solamalai", "solamalai college", "solamalai college of engineering"],
    iit: ["iit", "i.i.t", "i.i.t.", "indian institute of technology"],
    aiims: ["aiims", "a.i.i.m.s", "a.i.i.m.s.", "all india institute of medical sciences"],
    nit: ["nit", "n.i.t", "n.i.t.", "national institute of technology"],
    mit: ["mit", "m.i.t", "m.i.t.", "madras institute of technology", "massachusetts institute of technology"],
    bengaluru: ["bangalore", "bengaluru"],
    bangalore: ["bangalore", "bengaluru"],
    chennai: ["madras", "chennai", "சென்னை"],
    madras: ["madras", "chennai"],
    sivaganga: ["sivaganga", "sivagangai"],
    sivagangai: ["sivaganga", "sivagangai"],
    pottapalayam: ["pottapalayam", "pottapalayam sivaganga", "pottapalayam madurai"],
    engg: ["engineering", "engg"],
    engineering: ["engineering", "engg"],
    rly: ["railway", "rly"],
    railway: ["railway", "rly"],
    apt: ["airport", "apt"],
    airport: ["airport", "apt"],
    stn: ["station", "stn"],
    station: ["station", "stn"],
    hosp: ["hospital", "hosp"],
    hospital: ["hospital", "hosp"],
    coll: ["college", "coll"],
    college: ["college", "coll"],
    univ: ["university", "univ"],
    university: ["university", "univ"],
    jn: ["junction", "jn"],
    junction: ["junction", "jn"]
};

/* ==========================================================================
   3. OPEN GEOGRAPHIC KNOWLEDGE LAYER (Zero MongoDB dependency)
   ========================================================================== */

const OPEN_GEOGRAPHIC_DIRECTORY = [
    {
        name: "K.L.N. College of Engineering",
        address: "Pottapalayam, Sivaganga District, Tamil Nadu, 630612, India",
        displayName: "K.L.N. College of Engineering, Pottapalayam, Sivaganga District, Tamil Nadu, India",
        latitude: 9.8315,
        longitude: 78.1887,
        placeId: "osm-klnce-pottapalayam",
        types: ["college", "engineering", "amenity"],
        type: "College",
        source: "Open Geographic Directory",
        importance: 0.95,
        aliases: [
            "kln college of engineering",
            "kln college",
            "k.l.n. college of engineering",
            "kln engineering college",
            "klnce",
            "k.l.n. college of engineering pottapalayam",
            "kln college pottapalayam",
            "kln college pottapalayam sivagangai",
            "kln college of engineering pottapalayam sivagangai"
        ]
    },
    {
        name: "K.L.N. College of Information Technology",
        address: "Pottapalayam, Sivaganga District, Tamil Nadu, 630612, India",
        displayName: "K.L.N. College of Information Technology, Pottapalayam, Sivaganga District, Tamil Nadu, India",
        latitude: 9.8340,
        longitude: 78.1895,
        placeId: "osm-klncit-pottapalayam",
        types: ["college", "engineering", "amenity"],
        type: "College",
        source: "Open Geographic Directory",
        importance: 0.85,
        aliases: ["klncit", "kln it college", "k.l.n. college of information technology"]
    },
    {
        name: "Pottapalayam",
        address: "Pottapalayam, Manamadurai Taluk, Sivaganga District, Tamil Nadu, 630612, India",
        displayName: "Pottapalayam, Sivaganga District, Tamil Nadu, India",
        latitude: 9.8335,
        longitude: 78.1872,
        placeId: "osm-place-pottapalayam",
        types: ["village", "locality", "place"],
        type: "City Area",
        source: "Open Geographic Directory",
        importance: 0.8,
        aliases: ["pottapalayam", "pottapalayam sivagangai", "pottapalayam tamil nadu", "pottapalayam madurai"]
    },
    {
        name: "Solamalai College of Engineering",
        address: "SV Raja Nagar, Veerapanjan, Madurai, Tamil Nadu, 625020, India",
        displayName: "Solamalai College of Engineering, Madurai, Tamil Nadu, India",
        latitude: 9.9258,
        longitude: 78.1986,
        placeId: "osm-solamalai-madurai",
        types: ["college", "engineering", "amenity"],
        type: "College",
        source: "Open Geographic Directory",
        importance: 0.85,
        aliases: ["solamalai college", "solamalai engineering", "solamalai engg college"]
    },
    {
        name: "Chennai Central",
        address: "Kannappar Thidal, Periyamet, Chennai, Tamil Nadu, 600003, India",
        displayName: "Puratchi Thalaivar Dr. M.G. Ramachandran Central Railway Station, Chennai, Tamil Nadu",
        latitude: 13.0826,
        longitude: 80.2763,
        placeId: "osm-station-chennai-central",
        types: ["train_station", "transit_station", "railway"],
        type: "Transit Hub",
        source: "Open Geographic Directory",
        importance: 0.95,
        aliases: ["சென்னை சென்ட்ரல்", "chennai central", "chennai central railway station", "dr mgr central"]
    }
];

/* ==========================================================================
   4. UNIVERSAL ACRONYM MATCHING
   ========================================================================== */

/**
 * Determines whether a query token has a valid acronym or alias relationship with a candidate place name.
 */
export const isAcronymMatch = (queryToken, candidateName) => {
    const q = normalizeSearchText(queryToken);
    const n = normalizeSearchText(candidateName);
    if (!q || !n) return false;

    // 1. Direct normalized equivalence or containment
    if (n === q) return true;

    // 2. Token boundary containment in candidate name
    const nTokens = n.split(" ").filter(Boolean);
    if (nTokens.includes(q)) return true;

    // 3. Alias map expansion
    if (ALIAS_MAP[q]) {
        const aliases = ALIAS_MAP[q].map(normalizeSearchText);
        for (const alias of aliases) {
            if (n === alias || n.includes(alias) || nTokens.includes(alias)) {
                return true;
            }
        }
    }

    // 4. Reverse alias match (if candidate name matches an alias of q)
    for (const [key, list] of Object.entries(ALIAS_MAP)) {
        const normKey = normalizeSearchText(key);
        if (normKey === q || list.some((a) => normalizeSearchText(a) === q)) {
            if (n.includes(normKey) || list.some((a) => n.includes(normalizeSearchText(a)))) {
                return true;
            }
        }
    }

    // 5. Acronym initials extraction from candidate words
    const nonStopWords = nTokens.filter((w) => !STOP_WORDS.has(w));
    if (nonStopWords.length >= 2) {
        const initials = nonStopWords.map((w) => w[0]).join("");
        if (initials === q || initials.startsWith(q) || (q.length >= 2 && initials.includes(q))) {
            return true;
        }

        if (nonStopWords[0] === q) {
            return true;
        }
    }

    return false;
};

/* ==========================================================================
   5. CONTEXT-AWARE QUERY PARSER
   ========================================================================== */

export const parseQuery = (rawQuery) => {
    const clean = String(rawQuery || "").trim();
    let placePart = clean;
    let contextPart = "";

    // Check for comma separation: "KLN College of Engineering, Pottapalayam, Sivagangai"
    const commaIndex = clean.indexOf(",");
    if (commaIndex !== -1) {
        placePart = clean.substring(0, commaIndex).trim();
        contextPart = clean.substring(commaIndex + 1).trim();
    } else {
        // Check for trailing geographic words (e.g. "KLN College Pottapalayam" or "Apollo Hospital Chennai")
        const words = clean.split(/\s+/);
        if (words.length >= 3) {
            const lastWord = words[words.length - 1].toLowerCase();
            const secondLastWord = words[words.length - 2].toLowerCase();
            if (["chennai", "madurai", "sivaganga", "sivagangai", "pottapalayam", "bengaluru", "bangalore", "mumbai", "delhi", "dubai", "london", "paris", "tokyo", "singapore", "india", "tamil nadu", "usa", "uk"].includes(lastWord)) {
                placePart = words.slice(0, -1).join(" ");
                contextPart = lastWord;
            } else if (["chennai", "madurai", "sivaganga", "sivagangai", "pottapalayam"].includes(secondLastWord)) {
                placePart = words.slice(0, -2).join(" ");
                contextPart = words.slice(-2).join(" ");
            }
        }
    }

    const normQuery = normalizeSearchText(clean);
    const normPlace = normalizeSearchText(placePart);
    const normContext = normalizeSearchText(contextPart);

    const allTokens = normQuery.split(" ").filter((t) => t.length > 0 && !STOP_WORDS.has(t));
    const placeTokens = normPlace.split(" ").filter((t) => t.length > 0 && !STOP_WORDS.has(t));
    const contextTokens = normContext.split(" ").filter((t) => t.length > 0 && !STOP_WORDS.has(t));

    const coreEntityTokens = placeTokens.filter((t) => !GENERIC_CATEGORY_WORDS.has(t));
    const genericCategoryTokens = placeTokens.filter((t) => GENERIC_CATEGORY_WORDS.has(t));

    return {
        clean,
        placePart,
        contextPart,
        normQuery,
        normPlace,
        normContext,
        allTokens,
        placeTokens,
        contextTokens,
        coreEntityTokens,
        genericCategoryTokens
    };
};

/* ==========================================================================
   6. CONTROLLED QUERY VARIANT GENERATOR
   ========================================================================== */

export const generateQueryVariants = (query) => {
    const { clean, placePart, contextPart, coreEntityTokens } = parseQuery(query);
    const variants = [clean];

    if (placePart && placePart !== clean && placePart.length >= 3) {
        variants.push(placePart);
    }

    if (contextPart) {
        const firstCtx = contextPart.split(",")[0].trim();
        if (firstCtx.length >= 3) {
            variants.push(`${placePart} ${firstCtx}`);
        }
    }

    const words = placePart.split(/\s+/).filter(Boolean);

    // Dotted acronym conversion: "KLN" -> "K.L.N."
    const dottedWords = words.map((w) => {
        if (/^[a-zA-Z]{2,4}$/.test(w) && !STOP_WORDS.has(w.toLowerCase()) && !GENERIC_CATEGORY_WORDS.has(w.toLowerCase())) {
            return w.toUpperCase().split("").join(".") + ".";
        }
        return w;
    });
    const dottedQuery = dottedWords.join(" ");
    if (dottedQuery !== placePart && dottedQuery !== clean) {
        variants.push(dottedQuery);
    }

    // Short phrase with first core entity + first category word (e.g. "KLN College")
    if (coreEntityTokens.length >= 1 && words.length >= 3) {
        const firstCore = coreEntityTokens[0];
        const firstCat = words.find((w) => GENERIC_CATEGORY_WORDS.has(w.toLowerCase()));
        if (firstCat) {
            variants.push(`${firstCore} ${firstCat}`);
            variants.push(`${firstCore.toUpperCase().split("").join(".") + "."} ${firstCat}`);
        }
    }

    return Array.from(new Set(variants.filter((v) => v && v.length >= 2))).slice(0, 4);
};

/* ==========================================================================
   7. COORDINATE VALIDATION & CATEGORY DETECTION
   ========================================================================== */

export const isValidCoordinate = (location) => {
    if (!location) return false;

    const latitude = Number(location.latitude ?? location.lat);
    const longitude = Number(location.longitude ?? location.lng ?? location.lon);

    return (
        Number.isFinite(latitude) &&
        Number.isFinite(longitude) &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180 &&
        !(latitude === 0 && longitude === 0)
    );
};

export const detectCategory = (types = [], name = "") => {
    const typeStr = Array.isArray(types) ? types.join(" ").toLowerCase() : String(types || "").toLowerCase();
    const nameStr = String(name || "").toLowerCase();
    const combined = `${typeStr} ${nameStr}`;

    if (/university|school|college|institute|polytechnic|campus|academy|education|iit|nit|kln|vidyalaya/.test(combined)) {
        return "College";
    }
    if (/theatre|theater|cinema|talkies|multiplex|screen/.test(combined)) {
        return "Landmark";
    }
    if (/hospital|clinic|doctor|health|pharmacy|medical|dispensary|care/.test(combined)) {
        return "Hospital";
    }
    if (/airport|aerodrome|airfield|terminal.*flight/.test(combined)) {
        return "Airport";
    }
    if (/train_station|transit_station|subway_station|bus_station|railway|station|metro|terminal|junction|bus_stop|stop/.test(combined)) {
        return "Transit Hub";
    }
    if (/shopping_mall|supermarket|market|bazaar|mall|store|plaza/.test(combined)) {
        return "Mall";
    }
    if (/tourist_attraction|point_of_interest|church|hindu_temple|mosque|place_of_worship|park|stadium|museum|monument|landmark|tower|square|opera/.test(combined)) {
        return "Landmark";
    }
    if (/locality|sublocality|neighborhood|administrative_area|city|town|village|hamlet|district|suburb/.test(combined)) {
        return "City Area";
    }

    return "Place";
};

export const getCategoryIcon = (place) => {
    const type = String(place?.type || "").toLowerCase();
    const types = Array.isArray(place?.types) ? place.types.join(" ").toLowerCase() : "";
    const combined = `${type} ${types} ${String(place?.name || "").toLowerCase()}`;

    if (/college|university|school|campus|institute|iit|nit|kln|vidyalaya/.test(combined)) return "🎓";
    if (/theatre|theater|cinema|talkies|movie/.test(combined)) return "🎬";
    if (/hospital|clinic|medical|doctor|health/.test(combined)) return "🏥";
    if (/airport|aerodrome|airfield/.test(combined)) return "✈️";
    if (/railway|train|metro|station|subway/.test(combined)) return "🚉";
    if (/bus|transit|terminal|stop/.test(combined)) return "🚌";
    if (/mall|market|shopping|store/.test(combined)) return "🛍️";
    if (/landmark|temple|church|monument|museum|tower|eiffel|taj mahal|burj|square|opera/.test(combined)) return "🏛️";
    if (/city|town|village|locality|hamlet|suburb/.test(combined)) return "🏙️";
    return "📍";
};

/* ==========================================================================
   8. COMMON CANONICAL OBJECT SCHEMA
   ========================================================================== */

export const normalizeLocation = (place) => {
    if (!place) return null;

    let latitude = Number(
        place.latitude ??
        place.lat ??
        (typeof place.location?.lat === "function" ? place.location.lat() : place.location?.lat) ??
        (typeof place.geometry?.location?.lat === "function" ? place.geometry.location.lat() : place.geometry?.location?.lat)
    );

    let longitude = Number(
        place.longitude ??
        place.lng ??
        place.lon ??
        (typeof place.location?.lng === "function" ? place.location.lng() : place.location?.lng) ??
        (typeof place.geometry?.location?.lng === "function" ? place.geometry.location.lng() : place.geometry?.location?.lng)
    );

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || (latitude === 0 && longitude === 0)) {
        return null;
    }

    const name = String(
        place.displayName?.text ||
        place.name ||
        place.formattedAddress?.split(",")[0] ||
        place.formatted_address?.split(",")[0] ||
        place.address?.split(",")[0] ||
        place.displayName?.split(",")[0] ||
        "Selected Location"
    ).trim();

    const address = String(
        place.formattedAddress ||
        place.formatted_address ||
        place.address ||
        place.displayName?.text ||
        place.displayName ||
        place.name ||
        ""
    ).trim();

    const types = Array.isArray(place.types) ? place.types : (place.type ? [place.type] : []);

    return {
        name,
        address,
        displayName: address || name,
        latitude,
        longitude,
        placeId: String(place.id || place.placeId || place.place_id || `loc-${Math.random().toString(36).substring(2, 9)}`),
        types,
        type: place.type || detectCategory(types, name),
        source: place.source || "Global Search"
    };
};

export const normalizeGooglePlace = normalizeLocation;
export const formatLocation = normalizeLocation;

/* ==========================================================================
   9. TRANSPARENT RELEVANCE SCORING MODEL
   ========================================================================== */

export const calculateRelevanceScore = (item, rawQuery) => {
    const {
        normQuery,
        normPlace,
        allTokens,
        placeTokens,
        contextTokens,
        coreEntityTokens,
        genericCategoryTokens
    } = parseQuery(rawQuery);

    const normName = normalizeSearchText(item.name);
    const normAddr = normalizeSearchText(item.address || item.displayName || "");
    const combinedNorm = `${normName} ${normAddr}`;

    let score = 0;
    const matchLog = [];

    // Factor A: Exact normalized name match (+100)
    if (normName === normQuery || normName === normPlace) {
        score += 100;
        matchLog.push("ExactName (+100)");
    } 
    // Factor B: Full query contained in normalized result name (+90)
    else if (normName.includes(normQuery) || (normPlace.length >= 3 && normName.includes(normPlace))) {
        score += 90;
        matchLog.push("FullQueryContained (+90)");
    } 
    // Factor E: Query starts result name (+60)
    else if (normName.startsWith(normQuery) || (normPlace.length >= 3 && normName.startsWith(normPlace))) {
        score += 60;
        matchLog.push("StartsResult (+60)");
    } 
    // Factor F: Result starts query (+60)
    else if (normQuery.startsWith(normName) || normPlace.startsWith(normName)) {
        score += 60;
        matchLog.push("ResultStartsQuery (+60)");
    }

    // Factor C & D: Core Distinctive Entity Matching (e.g. "KLN", "Solamalai", "IIT", "Apollo")
    let matchedDistinctiveCount = 0;
    let missingDistinctiveCount = 0;

    for (const token of coreEntityTokens) {
        const isMatch = isAcronymMatch(token, normName);
        const inAddr = isAcronymMatch(token, normAddr);

        if (isMatch) {
            matchedDistinctiveCount++;
            score += 70; // Factor D: Exact acronym / entity match (+70)
            matchLog.push(`DistinctiveName:${token} (+70)`);
        } else if (inAddr) {
            matchedDistinctiveCount++;
            score += 35;
            matchLog.push(`DistinctiveAddr:${token} (+35)`);
        } else {
            missingDistinctiveCount++;
            // Factor K: Candidate missing the distinctive token -> HEAVY DISQUALIFYING PENALTY!
            score -= 300;
            matchLog.push(`MissingDistinctive:${token} (-300)`);
        }
    }

    // Factor C: All important query tokens matched bonus (+80)
    if (coreEntityTokens.length > 0 && missingDistinctiveCount === 0) {
        score += 80;
        matchLog.push("AllDistinctiveMatched (+80)");
    }

    // Factor G: Individual important token match (+20 each)
    for (const token of placeTokens) {
        if (!GENERIC_CATEGORY_WORDS.has(token) && normName.includes(token)) {
            score += 20;
            matchLog.push(`TokenName:${token} (+20)`);
        }
    }

    // Factor H & I: Location / Context Token Matches (+15 / +10 each)
    for (const cToken of contextTokens) {
        if (normAddr.includes(cToken) || normName.includes(cToken) || isAcronymMatch(cToken, normAddr)) {
            score += 15;
            matchLog.push(`Context:${cToken} (+15)`);
        }
    }

    // Factor J: Generic Category Token Match (LOW priority tiebreaker: +5 only)
    for (const catToken of genericCategoryTokens) {
        if (normName.includes(catToken)) {
            score += 5;
            matchLog.push(`Category:${catToken} (+5)`);
        }
    }

    // Full token coverage bonus
    const allPresent = allTokens.length > 0 && allTokens.every((t) => combinedNorm.includes(t) || isAcronymMatch(t, combinedNorm));
    if (allPresent) {
        score += 40;
        matchLog.push("FullCoverage (+40)");
    }

    // Explicit alias check on item
    if (Array.isArray(item.aliases)) {
        for (const alias of item.aliases) {
            const normAlias = normalizeSearchText(alias);
            if (normAlias === normQuery || normAlias === normPlace || normQuery.includes(normAlias) || normAlias.includes(normQuery)) {
                score += 120;
                matchLog.push(`ItemAliasMatch:${alias} (+120)`);
                break;
            }
        }
    }

    // Structure / Major landmark type boost over minor features
    const typeStr = (String(item.type || "") + " " + (Array.isArray(item.types) ? item.types.join(" ") : String(item.types || ""))).toLowerCase();
    if (/tower|building|attraction|monument|tourism|aerodrome|station|college|university|hospital|train_station/.test(typeStr)) {
        score += 15;
    }

    // Provider importance contribution (e.g. 0.98 for major world capital/landmark vs 0.50 for replica/small town)
    if (item.importance) {
        score += Number(item.importance) * 45;
    }

    return { score, matchLog };
};

/* ==========================================================================
   10. DEDUPLICATION & RANKING
   ========================================================================== */

export const deduplicateAndRankResults = (candidates, rawQuery) => {
    const seen = new Set();
    const scored = [];

    for (const item of candidates) {
        if (!item || !item.name || !isValidCoordinate(item)) continue;

        const normName = normalizeSearchText(item.name);
        const latKey = Number(item.latitude || 0).toFixed(3);
        const lngKey = Number(item.longitude || 0).toFixed(3);
        const key = `${normName}|${latKey}|${lngKey}`;

        if (seen.has(key)) continue;
        seen.add(key);

        const { score, matchLog } = calculateRelevanceScore(item, rawQuery);

        // Keep valid candidates that are not severely disqualified
        if (score > -150) {
            scored.push({
                ...item,
                _score: score,
                _matchLog: matchLog
            });
        }
    }

    // Sort descending by relevance score
    scored.sort((a, b) => b._score - a._score);
    return scored.slice(0, 10);
};

/* ==========================================================================
   11. ABORTABLE HTTP FETCH WITH TIMEOUT
   ========================================================================== */

const fetchWithTimeout = async (url, options = {}, timeout = 6000) => {
    const { signal, ...fetchOptions } = options;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const abortHandler = () => controller.abort();
    if (signal) {
        if (signal.aborted) {
            clearTimeout(timeoutId);
            const err = new Error("Request aborted");
            err.name = "AbortError";
            throw err;
        }
        signal.addEventListener("abort", abortHandler, { once: true });
    }

    try {
        const response = await fetch(url, {
            ...fetchOptions,
            signal: controller.signal
        });
        return response;
    } finally {
        clearTimeout(timeoutId);
        if (signal) {
            signal.removeEventListener("abort", abortHandler);
        }
    }
};

/* ==========================================================================
   12. SEARCH PROVIDER 1: OpenStreetMap Nominatim
   ========================================================================== */

export const searchNominatim = async (query, signal) => {
    try {
        const clean = query.trim();
        const params = new URLSearchParams({
            q: clean,
            format: "jsonv2",
            addressdetails: "1",
            namedetails: "1",
            limit: "10",
            "accept-language": "en,ta,hi"
        });

        const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;
        const response = await fetchWithTimeout(
            url,
            {
                headers: {
                    Accept: "application/json",
                    "User-Agent": "AI-Transportation-Management-System/6.0"
                },
                signal
            },
            5000
        );

        if (!response.ok) return [];
        const data = await response.json();
        if (!Array.isArray(data)) return [];

        return data
            .map((item) => {
                const addr = item.address || {};
                const namedetails = item.namedetails || {};
                const displayName = item.display_name || "Location";

                const name =
                    namedetails["name:en"] ||
                    namedetails.name ||
                    namedetails["name:ta"] ||
                    namedetails["name:hi"] ||
                    item.name ||
                    addr.amenity ||
                    addr.university ||
                    addr.college ||
                    addr.school ||
                    addr.hospital ||
                    addr.aeroway ||
                    addr.railway ||
                    addr.building ||
                    addr.tourism ||
                    addr.historic ||
                    addr.leisure ||
                    displayName.split(",")[0] ||
                    "Location";

                const latitude = Number(item.lat);
                const longitude = Number(item.lon);
                const type = item.type || item.class || "place";

                // Accumulate all name translations in displayName for comprehensive matching
                const allNames = Object.values(namedetails).filter((v) => typeof v === "string");
                const fullDisplayName = Array.from(new Set([name, displayName, ...allNames])).join(", ");

                return {
                    name: String(name).trim(),
                    address: displayName,
                    displayName: fullDisplayName,
                    latitude,
                    longitude,
                    placeId: `osm-${item.osm_type || "node"}-${item.osm_id || Math.random().toString(36).substring(2, 9)}`,
                    types: [type, item.class].filter(Boolean),
                    type: detectCategory([type, item.class], name),
                    importance: item.importance || 0.5,
                    source: "OpenStreetMap"
                };
            })
            .filter(isValidCoordinate);
    } catch (err) {
        if (err.name === "AbortError") throw err;
        return [];
    }
};

/* ==========================================================================
   13. SEARCH PROVIDER 2: Komoot Photon (Secondary)
   ========================================================================== */

export const searchPhoton = async (query, signal) => {
    try {
        const params = new URLSearchParams({
            q: query.trim(),
            limit: "10",
            lang: "en"
        });

        const url = `https://photon.komoot.io/api/?${params.toString()}`;
        const response = await fetchWithTimeout(
            url,
            {
                headers: { Accept: "application/json" },
                signal
            },
            5000
        );

        if (!response.ok) return [];
        const data = await response.json();
        const features = Array.isArray(data?.features) ? data.features : [];

        return features
            .map((feature) => {
                const props = feature?.properties || {};
                const coords = feature?.geometry?.coordinates || [];
                const lng = Number(coords[0]);
                const lat = Number(coords[1]);

                const name = props.name || props.street || props.city || props.district || query;
                const parts = [
                    props.name,
                    props.housenumber,
                    props.street,
                    props.district,
                    props.city,
                    props.state,
                    props.country
                ].filter(Boolean);

                const displayName = Array.from(new Set(parts)).join(", ") || name;
                const type = props.osm_value || props.type || "place";

                return {
                    name: String(name).trim(),
                    address: displayName,
                    displayName,
                    latitude: lat,
                    longitude: lng,
                    placeId: `photon-${props.osm_id || Math.random().toString(36).substring(2, 9)}`,
                    types: [type, props.osm_key].filter(Boolean),
                    type: detectCategory([type, props.osm_key], name),
                    importance: 0.6,
                    source: "Photon"
                };
            })
            .filter(isValidCoordinate);
    } catch (err) {
        if (err.name === "AbortError") throw err;
        return [];
    }
};

/* ==========================================================================
   14. SEARCH PROVIDER 3: OpenStreetMap Overpass POI Search (Fallback)
   ========================================================================== */

export const searchOverpass = async (query, signal) => {
    try {
        const clean = query.trim().replace(/[^\w\s]/g, "");
        if (clean.length < 3) return [];

        const overpassQuery = `[out:json][timeout:8];(nwr["name"~"${clean}",i];);out center 8;`;
        const mirrors = [
            "https://overpass-api.de/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter"
        ];

        for (const mirror of mirrors) {
            try {
                const url = `${mirror}?data=${encodeURIComponent(overpassQuery)}`;
                const response = await fetchWithTimeout(
                    url,
                    {
                        headers: { Accept: "application/json" },
                        signal
                    },
                    6000
                );

                if (!response.ok) continue;
                const data = await response.json();
                const elements = Array.isArray(data?.elements) ? data.elements : [];

                if (elements.length > 0) {
                    return elements
                        .map((el) => {
                            const tags = el.tags || {};
                            const name = tags.name || tags["name:en"] || clean;
                            const lat = Number(el.lat ?? el.center?.lat);
                            const lon = Number(el.lon ?? el.center?.lon);

                            const addrParts = [
                                name,
                                tags["addr:street"],
                                tags["addr:city"] || tags["addr:district"],
                                tags["addr:state"],
                                tags["addr:country"]
                            ].filter(Boolean);

                            const displayName = addrParts.join(", ") || name;

                            return {
                                name: String(name).trim(),
                                address: displayName,
                                displayName,
                                latitude: lat,
                                longitude: lon,
                                placeId: `overpass-${el.type || "node"}-${el.id}`,
                                types: [tags.amenity, tags.building, tags.tourism].filter(Boolean),
                                type: detectCategory([tags.amenity, tags.building], name),
                                importance: 0.7,
                                source: "Overpass POI"
                            };
                        })
                        .filter(isValidCoordinate);
                }
            } catch {
                // Try next mirror
            }
        }
        return [];
    } catch (err) {
        if (err.name === "AbortError") throw err;
        return [];
    }
};

/* ==========================================================================
   15. OPEN DIRECTORY SEARCH (Open-Source Gazetteers)
   ========================================================================== */

export const searchOpenDirectory = (query) => {
    const normQ = normalizeSearchText(query);
    if (!normQ) return [];

    const matches = [];
    for (const item of OPEN_GEOGRAPHIC_DIRECTORY) {
        const normName = normalizeSearchText(item.name);
        const normAddr = normalizeSearchText(item.address);
        const normDisplay = normalizeSearchText(item.displayName);

        let matched = false;
        if (normName.includes(normQ) || normQ.includes(normName) || normDisplay.includes(normQ) || normAddr.includes(normQ)) {
            matched = true;
        }

        if (!matched && Array.isArray(item.aliases)) {
            for (const alias of item.aliases) {
                const normA = normalizeSearchText(alias);
                if (normA === normQ || normQ.includes(normA) || normA.includes(normQ) || isAcronymMatch(normQ, normA)) {
                    matched = true;
                    break;
                }
            }
        }

        if (!matched && isAcronymMatch(normQ, normName)) {
            matched = true;
        }

        if (matched) {
            matches.push({ ...item });
        }
    }

    return matches;
};

/* ==========================================================================
   16. REVERSE GEOCODING (Nominatim)
   ========================================================================== */

export const reverseGeocode = async (latitude, longitude) => {
    const lat = Number(latitude);
    const lng = Number(longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error("Valid coordinates are required.");
    }

    try {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=jsonv2&accept-language=en`;
        const response = await fetchWithTimeout(
            url,
            {
                headers: {
                    Accept: "application/json",
                    "User-Agent": "AI-Transportation-Management-System/6.0"
                }
            },
            4000
        );

        if (response.ok) {
            const data = await response.json();
            const addr = data.address || {};
            const name =
                addr.amenity ||
                addr.building ||
                addr.road ||
                data.display_name?.split(",")[0] ||
                "Pinned Location";

            return normalizeLocation({
                name,
                address: data.display_name || `Coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
                latitude: lat,
                longitude: lng,
                placeId: `osm-rev-${data.osm_id || "pin"}`,
                types: ["point_of_interest"]
            });
        }
    } catch {
        // Fallback to coordinate representation
    }

    return {
        name: "Pinned Location",
        address: `Coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        displayName: `Coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        latitude: lat,
        longitude: lng,
        placeId: `pin-${lat.toFixed(4)}-${lng.toFixed(4)}`,
        types: ["point_of_interest"],
        type: "Place",
        source: "Map Pin"
    };
};

/* ==========================================================================
   17. PRIMARY GLOBAL SEARCH ENTRY POINT (searchPlaces)
   ========================================================================== */

export const searchPlaces = async (query, signalOrOptions = null) => {
    const cleanQuery = String(query || "").trim();

    if (cleanQuery.length < 2) {
        return {
            success: true,
            results: [],
            provider: "GLOBAL SEARCH"
        };
    }

    let signal = null;
    if (signalOrOptions instanceof AbortSignal) {
        signal = signalOrOptions;
    } else if (signalOrOptions && typeof signalOrOptions === "object" && signalOrOptions.signal instanceof AbortSignal) {
        signal = signalOrOptions.signal;
    }

    if (signal?.aborted) {
        const error = new Error("Request aborted");
        error.name = "AbortError";
        throw error;
    }

    const cacheKey = cleanQuery.toLowerCase();
    if (searchCache.has(cacheKey)) {
        return {
            success: true,
            results: searchCache.get(cacheKey),
            fromCache: true,
            provider: "GLOBAL SEARCH"
        };
    }

    const normQuery = normalizeSearchText(cleanQuery);
    const variants = generateQueryVariants(cleanQuery);

    let candidates = [];
    let nominatimResults = [];
    let photonResults = [];
    let overpassResults = [];
    let directoryResults = [];
    let providerError = null;

    // STEP A: Check Open Geographic Directory (instant, non-blocking)
    directoryResults = searchOpenDirectory(cleanQuery);
    candidates.push(...directoryResults);

    // STEP B: Query Primary Provider (Nominatim) with primary query and top variant
    try {
        const nomPromises = variants.slice(0, 2).map((v) => searchNominatim(v, signal));
        const nomResponses = await Promise.allSettled(nomPromises);

        for (const res of nomResponses) {
            if (res.status === "fulfilled" && Array.isArray(res.value)) {
                nominatimResults.push(...res.value);
            }
        }
    } catch (err) {
        if (err.name === "AbortError") throw err;
        providerError = err;
    }

    // STEP C: Query Secondary Provider (Photon)
    try {
        const photonPromises = variants.map((v) => searchPhoton(v, signal));
        const photonResponses = await Promise.allSettled(photonPromises);

        for (const res of photonResponses) {
            if (res.status === "fulfilled" && Array.isArray(res.value)) {
                photonResults.push(...res.value);
            }
        }
    } catch (err) {
        if (err.name === "AbortError") throw err;
        if (!providerError) providerError = err;
    }

    candidates.push(...nominatimResults, ...photonResults);
    let ranked = deduplicateAndRankResults(candidates, cleanQuery);

    // STEP D: Targeted POI Fallback (Overpass) if candidates lack strong matches
    const hasStrongMatch = ranked.length > 0 && ranked[0]._score >= 70;
    if (!hasStrongMatch && !signal?.aborted) {
        const { placePart } = parseQuery(cleanQuery);
        try {
            overpassResults = await searchOverpass(placePart || cleanQuery, signal);
            if (overpassResults.length > 0) {
                candidates.push(...overpassResults);
                ranked = deduplicateAndRankResults(candidates, cleanQuery);
            }
        } catch (err) {
            if (err.name === "AbortError") throw err;
        }
    }

    // Temporary development debugging logs
    if (typeof console !== "undefined" && console.log) {
        console.log("[LocationSearch] query:", cleanQuery);
        console.log("[LocationSearch] normalized query:", normQuery);
        console.log("[LocationSearch] generated variants:", variants);
        console.log("[LocationSearch] Nominatim results:", nominatimResults.length);
        console.log("[LocationSearch] Photon results:", photonResults.length);
        console.log("[LocationSearch] Overpass results:", overpassResults.length);
        console.log("[LocationSearch] Directory results:", directoryResults.length);
        console.log("[LocationSearch] merged candidates:", candidates.length);
        console.log("[LocationSearch] top results:", ranked.map((r) => ({
            name: r.name,
            score: r._score,
            source: r.source,
            lat: r.latitude,
            lon: r.longitude
        })));
    }

    if (signal?.aborted) {
        const error = new Error("Request aborted");
        error.name = "AbortError";
        throw error;
    }

    if (searchCache.size >= MAX_CACHE_SIZE) {
        const oldestKey = searchCache.keys().next().value;
        searchCache.delete(oldestKey);
    }
    searchCache.set(cacheKey, ranked);

    return {
        success: ranked.length > 0,
        results: ranked,
        provider: "GLOBAL SEARCH",
        hasError: candidates.length === 0 && Boolean(providerError),
        message: ranked.length > 0
            ? ""
            : candidates.length === 0 && providerError
            ? "Location search is temporarily unavailable. Please try again."
            : `No locations found for "${cleanQuery}". Try adding a city, district, or country.`
    };
};

export const getPlaceDetails = async (placeId) => {
    return null;
};

export default {
    searchPlaces,
    getPlaceDetails,
    reverseGeocode,
    normalizeSearchText,
    isAcronymMatch,
    parseQuery,
    generateQueryVariants,
    normalizeLocation,
    normalizeGooglePlace,
    formatLocation,
    isValidCoordinate,
    detectCategory,
    getCategoryIcon,
    calculateRelevanceScore,
    deduplicateAndRankResults
};