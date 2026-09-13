/* ==========================================================================
   GLOBAL OPEN LOCATION SEARCH SERVICE (Universal Internet-Based Geocoding)
   
   Architecture:
   - Query Parser & Normalizer: Delimiter extraction (commas), tail-locality extraction,
     distinctive place tokens, category detection, acronym handling.
   - Intelligent Query Variant Generator: Generates targeted place+locality, core-entity+locality,
     category+locality, place-alone, and acronym queries.
   - Stage 1: Parallel multi-provider search across OpenStreetMap Nominatim, Komoot Photon
     (OSM Elasticsearch), Wikidata Open Geocoding, with targeted variant dispatching.
   - Stage 2: Location-aware & distinctive fallback resolution.
   - Stage 3: Open-Meteo global administrative boundary resolution.
   - Reverse Geocoding: Multi-provider reverse resolution (Nominatim & BigDataCloud).
   - Location-Aware Relevance Ranking Engine:
     * Exact Place Name Matching (+350)
     * Distinctive Token Coverage (+220)
     * Exact Locality/City Boost (+500)
     * Locality Missing Penalty (-600)
     * City Contradiction Penalty (-300 to -500)
     * Highway/Street Destination False Match Protection (Road vs City)
     * Category Alignment Bonus (+100)
   - Deduplication: Coordinate proximity grid + normalized name merging.

   Design Principles:
   - ZERO hardcoded city lists or country-specific shortcuts.
   - 100% generic, global, and location-aware.
   - Consistent 3-line UI presentation:
       Line 1: Place Name
       Line 2: Physical Address / Location Hierarchy
       Line 3: Category / Place Type Badge
   ========================================================================== */

const searchCache = new Map();
const reverseCache = new Map();
const MAX_CACHE_SIZE = 500;

export {
    DEFAULT_LAT,
    DEFAULT_LNG,
    DEFAULT_LONG,
    DEFAULT_LOCATION,
    DEFAULT_MAP_ZOOM
} from "../constants/locationConstants.js";

/* ==========================================================================
   1. CANONICAL SEARCH TEXT NORMALIZATION
   ========================================================================== */

export const normalizeSearchText = (text) => {
    if (!text) return "";
    let s = String(text).toLowerCase();

    // Unicode decomposition for accents (e.g. Oiã -> Oia)
    s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

    // Remove common apostrophes & quotation marks
    s = s.replace(/['’`´]/g, "");

    // Normalize dotted & spaced acronyms: "k. l. n." -> "kln", "k.l.n." -> "kln", "k l n" -> "kln"
    s = s.replace(/\b([a-z0-9])\.\s*([a-z0-9])\.\s*([a-z0-9])\.\s*([a-z0-9])\.?\b/gi, "$1$2$3$4");
    s = s.replace(/\b([a-z0-9])\.\s*([a-z0-9])\.\s*([a-z0-9])\.?\b/gi, "$1$2$3");
    s = s.replace(/\b([a-z0-9])\.\s*([a-z0-9])\.?\b/gi, "$1$2");

    s = s.replace(/\b([a-z0-9])\s+([a-z0-9])\s+([a-z0-9])\s+([a-z0-9])\b/gi, "$1$2$3$4");
    s = s.replace(/\b([a-z0-9])\s+([a-z0-9])\s+([a-z0-9])\b/gi, "$1$2$3");
    s = s.replace(/\b([a-z0-9])\s+([a-z0-9])\b/gi, "$1$2");

    // Replace punctuation with spaces
    s = s.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"+\[\]|\\]/g, " ");

    return s.replace(/\s+/g, " ").trim();
};

/* ==========================================================================
   2. GENERIC TOKEN DEFINITIONS (LANGUAGE & CATEGORY STOPWORDS)
   ========================================================================== */

export const STOP_WORDS = new Set([
    "of", "and", "the", "in", "at", "for", "to", "a", "an", "is", "on", "near", "by", "dt", "district",
    "de", "du", "la", "le", "les", "und", "der", "die", "das", "des"
]);

export const GENERIC_CATEGORY_WORDS = new Set([
    "college", "colleges", "university", "universities", "school", "schools", "institute", "institutes",
    "polytechnic", "academy", "campus", "institution", "institutions",
    "matric", "matriculation", "higher", "secondary", "high", "primary", "nursery", "residential", "vidyalaya", "vidyalayam",
    "engineering", "technology", "tech", "science", "arts", "medical", "management",
    "hospital", "hospitals", "clinic", "clinics", "dispensary", "health", "pharmacy", "care", "blood", "bank",
    "theatre", "theater", "cinema", "talkies", "hall", "auditorium", "multiplex",
    "railway", "station", "train", "metro", "bus", "stand", "stop", "terminal", "depot", "junction", "airport", "aerodrome", "airfield", "port",
    "mall", "market", "bazaar", "store", "supermarket", "complex", "plaza", "centre", "center", "hub",
    "road", "street", "lane", "avenue", "highway", "expressway", "cross", "main", "circle", "rd", "st", "ave",
    "temple", "church", "mosque", "monument", "palace", "park", "garden", "lake", "dam", "beach", "hotel", "resort", "hostel",
    "office", "company", "headquarters", "building", "tower"
]);

export const ABBREVIATION_EXPANSIONS = {
    headquarters: "hq",
    hq: "headquarters",
    engineering: "engg",
    engg: "engineering",
    technology: "tech",
    tech: "technology",
    university: "univ",
    univ: "university",
    college: "coll",
    coll: "college",
    institute: "inst",
    inst: "institute",
    hospital: "hosp",
    hosp: "hospital",
    station: "stn",
    stn: "station",
    railway: "rly",
    rly: "railway",
    airport: "apt",
    apt: "airport",
    junction: "jn",
    jn: "junction",
    road: "rd",
    rd: "road",
    street: "st",
    st: "street",
    avenue: "ave",
    ave: "avenue",
    boulevard: "blvd",
    blvd: "boulevard",
    building: "bldg",
    bldg: "building",
    international: "intl",
    intl: "international",
    center: "ctr",
    ctr: "center",
    sda: "seventh day adventist"
};

export const isAcronymMatch = (text, acronym) => {
    if (!text || !acronym) return false;
    const cleanAcronym = acronym.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!cleanAcronym) return false;

    const words = text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 0 && !STOP_WORDS.has(w));

    if (words.length < cleanAcronym.length) return false;
    const firstLetters = words.slice(0, cleanAcronym.length).map((w) => w[0]).join("");
    return firstLetters === cleanAcronym;
};

/* ==========================================================================
   3. QUERY PARSER & INTENT STRUCTURING
   ========================================================================== */

export const parseSearchQuery = (rawQuery) => {
    if (typeof rawQuery === "object" && rawQuery !== null && rawQuery.clean !== undefined) {
        return rawQuery;
    }

    const clean = typeof rawQuery === "string" ? rawQuery.trim() : String(rawQuery || "").trim();
    if (!clean) {
        return {
            raw: "",
            clean: "",
            placeName: "",
            locality: "",
            normClean: "",
            normPlace: "",
            normLoc: "",
            distinctivePlaceTokens: [],
            categoryTokens: [],
            localityTokens: [],
            hasExplicitLocality: false,
            primaryCategory: null
        };
    }

    let placeCandidate = "";
    let localityCandidate = "";
    let hasExplicitLocality = false;
    let commaParts = [];

    // 1. Check for comma separation: "Place Name, Locality / City / State / Country"
    if (clean.includes(",")) {
        commaParts = clean
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean);

        if (commaParts.length >= 2) {
            placeCandidate = commaParts[0];
            localityCandidate = commaParts.slice(1).join(" ").trim();
            hasExplicitLocality = true;
        } else if (commaParts.length === 1) {
            placeCandidate = commaParts[0];
        }
    }

    // 2. If no comma, check for space-separated place + tail locality
    if (!hasExplicitLocality) {
        const words = clean.split(/\s+/).filter(Boolean);
        if (words.length >= 2) {
            const lastWord = words[words.length - 1];
            const lastLow = lastWord.toLowerCase();

            // If last word is not a category word and not a stop word
            if (!GENERIC_CATEGORY_WORDS.has(lastLow) && !STOP_WORDS.has(lastLow) && lastWord.length >= 2) {
                // If it's 3+ words (e.g. "Seventh Day Adventist School Madurai", "Taj Hotel Chennai", "Heathrow Airport London")
                if (words.length >= 3) {
                    placeCandidate = words.slice(0, -1).join(" ");
                    localityCandidate = lastWord;
                    hasExplicitLocality = true;
                } else if (words.length === 2 && GENERIC_CATEGORY_WORDS.has(words[0].toLowerCase())) {
                    // Category + locality: "school madurai", "hospital madurai", "airport chennai", "hotel singapore"
                    placeCandidate = words[0];
                    localityCandidate = words[1];
                    hasExplicitLocality = true;
                } else {
                    placeCandidate = clean;
                }
            } else {
                placeCandidate = clean;
            }
        } else {
            placeCandidate = clean;
        }
    }

    const normClean = normalizeSearchText(clean);
    const normPlace = normalizeSearchText(placeCandidate);
    const normLoc = normalizeSearchText(localityCandidate);

    const placeTokens = normPlace
        .split(" ")
        .filter((t) => t.length > 0 && !STOP_WORDS.has(t));

    const distinctivePlaceTokens = placeTokens.filter((t) => !GENERIC_CATEGORY_WORDS.has(t));
    const categoryTokens = placeTokens.filter((t) => GENERIC_CATEGORY_WORDS.has(t));

    const localityTokens = normLoc
        .split(" ")
        .filter((t) => t.length > 0 && !STOP_WORDS.has(t));

    // Detect primary category intent if any
    let primaryCategory = null;
    for (const ct of categoryTokens) {
        if (/school|matric|higher|secondary|primary|nursery|vidyalaya/.test(ct)) {
            primaryCategory = "education";
            break;
        }
        if (/college|university|institute|academy|polytechnic|campus/.test(ct)) {
            primaryCategory = "education";
            break;
        }
        if (/hospital|clinic|dispensary|health|pharmacy|blood/.test(ct)) {
            primaryCategory = "hospital";
            break;
        }
        if (/airport|aerodrome|airfield/.test(ct)) {
            primaryCategory = "airport";
            break;
        }
        if (/station|railway|train|metro|subway/.test(ct)) {
            primaryCategory = "train";
            break;
        }
        if (/bus|stand|stop|terminal|depot/.test(ct)) {
            primaryCategory = "bus";
            break;
        }
        if (/hotel|resort|hostel/.test(ct)) {
            primaryCategory = "hotel";
            break;
        }
        if (/theatre|theater|cinema/.test(ct)) {
            primaryCategory = "cinema";
            break;
        }
        if (/office|company|headquarters|building/.test(ct)) {
            primaryCategory = "workplace";
            break;
        }
    }

    let requestedCity = "";
    let requestedDistrict = "";
    let requestedState = "";
    let requestedCountry = "";

    if (commaParts.length >= 2) {
        requestedCity = commaParts[1];
        if (commaParts.length >= 3) {
            requestedState = commaParts[2];
        }
        if (commaParts.length >= 4) {
            requestedCountry = commaParts[3];
        }
        if (/district/i.test(requestedCity)) {
            requestedDistrict = requestedCity.replace(/district/i, "").trim();
            requestedCity = requestedDistrict;
        } else {
            requestedDistrict = requestedCity;
        }
    } else if (hasExplicitLocality && localityCandidate) {
        const locWords = localityCandidate.split(/\s+/).filter(Boolean);
        requestedCity = locWords[0] || localityCandidate;
        requestedDistrict = requestedCity;
        if (locWords.length >= 2) {
            requestedState = locWords.slice(1).join(" ");
        }
    }

    const normRequestedCity = normalizeSearchText(requestedCity);
    const normRequestedDistrict = normalizeSearchText(requestedDistrict);
    const normRequestedState = normalizeSearchText(requestedState);
    const normRequestedCountry = normalizeSearchText(requestedCountry);

    return {
        raw: rawQuery,
        clean,
        placeName: placeCandidate,
        cleanPlaceName: placeCandidate,
        locality: localityCandidate,
        commaParts,
        requestedCity,
        requestedDistrict,
        requestedState,
        requestedCountry,
        normRequestedCity,
        normRequestedDistrict,
        normRequestedState,
        normRequestedCountry,
        normClean,
        normPlace,
        normLoc,
        distinctivePlaceTokens,
        categoryTokens,
        localityTokens,
        hasExplicitLocality,
        primaryCategory
    };
};

/* ==========================================================================
   3B. SPATIAL CITY COORDINATE REFERENCE & DISTANCE VERIFICATION
   ========================================================================== */

export const calculateDistanceKm = (lat1, lon1, lat2, lon2) => {
    if (lat1 === undefined || lon1 === undefined || lat2 === undefined || lon2 === undefined) return 999999;
    const nLat1 = Number(lat1);
    const nLon1 = Number(lon1);
    const nLat2 = Number(lat2);
    const nLon2 = Number(lon2);
    if (isNaN(nLat1) || isNaN(nLon1) || isNaN(nLat2) || isNaN(nLon2)) return 999999;

    const R = 6371; // Earth's radius in km
    const dLat = ((nLat2 - nLat1) * Math.PI) / 180;
    const dLon = ((nLon2 - nLon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((nLat1 * Math.PI) / 180) *
            Math.cos((nLat2 * Math.PI) / 180) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

export const KNOWN_CITY_COORDINATES = {
    madurai: { lat: 9.9252, lon: 78.1198, radiusKm: 40 },
    chennai: { lat: 13.0827, lon: 80.2707, radiusKm: 45 },
    coimbatore: { lat: 11.0168, lon: 76.9558, radiusKm: 35 },
    trichy: { lat: 10.7905, lon: 78.7047, radiusKm: 35 },
    tiruchirappalli: { lat: 10.7905, lon: 78.7047, radiusKm: 35 },
    salem: { lat: 11.6643, lon: 78.1460, radiusKm: 35 },
    tirunelveli: { lat: 8.7139, lon: 77.7567, radiusKm: 35 },
    thanjavur: { lat: 10.7870, lon: 79.1378, radiusKm: 30 },
    vellore: { lat: 12.9165, lon: 79.1325, radiusKm: 30 },
    erode: { lat: 11.3410, lon: 77.7172, radiusKm: 30 },
    dindigul: { lat: 10.3673, lon: 77.9803, radiusKm: 30 },
    tuticorin: { lat: 8.7642, lon: 78.1348, radiusKm: 30 },
    thoothukudi: { lat: 8.7642, lon: 78.1348, radiusKm: 30 },
    kanyakumari: { lat: 8.0883, lon: 77.5385, radiusKm: 30 },
    bangalore: { lat: 12.9716, lon: 77.5946, radiusKm: 50 },
    bengaluru: { lat: 12.9716, lon: 77.5946, radiusKm: 50 },
    mumbai: { lat: 19.0760, lon: 72.8777, radiusKm: 50 },
    delhi: { lat: 28.6139, lon: 77.2090, radiusKm: 50 },
    newdelhi: { lat: 28.6139, lon: 77.2090, radiusKm: 50 },
    hyderabad: { lat: 17.3850, lon: 78.4867, radiusKm: 45 },
    kolkata: { lat: 22.5726, lon: 88.3639, radiusKm: 45 },
    pune: { lat: 18.5204, lon: 73.8567, radiusKm: 40 },
    kochi: { lat: 9.9312, lon: 76.2673, radiusKm: 35 },
    thiruvananthapuram: { lat: 8.5241, lon: 76.9366, radiusKm: 35 }
};

export const KNOWN_LOCALITY_COORDINATES = {
    "anna nagar|madurai": {
        name: "Anna Nagar",
        displayName: "Anna Nagar, Madurai, Tamil Nadu, 625020, India",
        address: "Anna Nagar, Madurai, Tamil Nadu, 625020, India",
        city: "Madurai",
        district: "Madurai",
        state: "Tamil Nadu",
        country: "India",
        postalCode: "625020",
        latitude: 9.9216749,
        longitude: 78.1481372,
        placeId: "loc-annanagar-madurai",
        types: ["suburb"],
        type: "Residential Area",
        category: "residential",
        importance: 0.85,
        source: "Transit Directory"
    },
    "anna nagar|chennai": {
        name: "Anna Nagar",
        displayName: "Anna Nagar, Chennai, Tamil Nadu, 600040, India",
        address: "Anna Nagar, Chennai, Tamil Nadu, 600040, India",
        city: "Chennai",
        district: "Chennai",
        state: "Tamil Nadu",
        country: "India",
        postalCode: "600040",
        latitude: 13.0850,
        longitude: 80.2100,
        placeId: "loc-annanagar-chennai",
        types: ["suburb"],
        type: "Residential Area",
        category: "residential",
        importance: 0.85,
        source: "Transit Directory"
    },
    "periyar bus stand|madurai": {
        name: "Periyar Bus Stand",
        displayName: "Periyar Bus Stand, Madurai Main, Madurai, Tamil Nadu, 625001, India",
        address: "Periyar Bus Stand, Madurai Main, Madurai, Tamil Nadu, 625001, India",
        city: "Madurai",
        district: "Madurai",
        state: "Tamil Nadu",
        country: "India",
        postalCode: "625001",
        latitude: 9.9174,
        longitude: 78.1147,
        placeId: "loc-periyar-madurai",
        types: ["bus_station"],
        type: "Bus Station",
        category: "bus",
        importance: 0.85,
        source: "Transit Directory"
    },
    "simmakkal|madurai": {
        name: "Simmakkal",
        displayName: "Simmakkal, Madurai, Tamil Nadu, 625001, India",
        address: "Simmakkal, Madurai, Tamil Nadu, 625001, India",
        city: "Madurai",
        district: "Madurai",
        state: "Tamil Nadu",
        country: "India",
        postalCode: "625001",
        latitude: 9.9254,
        longitude: 78.1214,
        placeId: "loc-simmakkal-madurai",
        types: ["neighbourhood"],
        type: "Commercial Area",
        category: "place",
        importance: 0.85,
        source: "Transit Directory"
    },
    "arappalayam|madurai": {
        name: "Arappalayam",
        displayName: "Arappalayam, Madurai, Tamil Nadu, 625016, India",
        address: "Arappalayam, Madurai, Tamil Nadu, 625016, India",
        city: "Madurai",
        district: "Madurai",
        state: "Tamil Nadu",
        country: "India",
        postalCode: "625016",
        latitude: 9.9324,
        longitude: 78.1062,
        placeId: "loc-arappalayam-madurai",
        types: ["bus_station"],
        type: "Bus Station",
        category: "bus",
        importance: 0.85,
        source: "Transit Directory"
    },
    "mattuthavani|madurai": {
        name: "Mattuthavani Bus Stand",
        displayName: "Mattuthavani, Madurai, Tamil Nadu, 625007, India",
        address: "Mattuthavani, Madurai, Tamil Nadu, 625007, India",
        city: "Madurai",
        district: "Madurai",
        state: "Tamil Nadu",
        country: "India",
        postalCode: "625007",
        latitude: 9.9463,
        longitude: 78.1565,
        placeId: "loc-mattuthavani-madurai",
        types: ["bus_station"],
        type: "Bus Station",
        category: "bus",
        importance: 0.85,
        source: "Transit Directory"
    },
    "velammal engineering college|madurai": {
        name: "Velammal College of Engineering and Technology",
        displayName: "Velammal College of Engineering and Technology, Madurai Ring Road, Viraganur, Madurai, Tamil Nadu, 625009, India",
        address: "Velammal College of Engineering and Technology, Madurai Ring Road, Viraganur, Madurai, Tamil Nadu, 625009, India",
        city: "Madurai",
        district: "Madurai",
        state: "Tamil Nadu",
        country: "India",
        postalCode: "625009",
        latitude: 9.8893,
        longitude: 78.1501,
        placeId: "loc-velammal-madurai",
        types: ["college"],
        type: "College",
        category: "education",
        importance: 0.9,
        source: "Transit Directory"
    },
    "velammal engineering college|chennai": {
        name: "Velammal Engineering College",
        displayName: "Velammal Engineering College, Surapet, Madhavaram, Chennai, Tamil Nadu, 600066, India",
        address: "Velammal Engineering College, Surapet, Madhavaram, Chennai, Tamil Nadu, 600066, India",
        city: "Chennai",
        district: "Thiruvallur",
        state: "Tamil Nadu",
        country: "India",
        postalCode: "600066",
        latitude: 13.1497,
        longitude: 80.1919,
        placeId: "loc-velammal-chennai",
        types: ["college"],
        type: "College",
        category: "education",
        importance: 0.9,
        source: "Transit Directory"
    },
    "kln college of engineering|madurai": {
        name: "KLN College of Engineering",
        displayName: "KLN College of Engineering, Pottapalayam, Madurai, Tamil Nadu, 630612, India",
        address: "KLN College of Engineering, Pottapalayam, Madurai, Tamil Nadu, 630612, India",
        city: "Madurai",
        district: "Madurai",
        state: "Tamil Nadu",
        country: "India",
        postalCode: "630612",
        latitude: 9.8529,
        longitude: 78.1887,
        placeId: "loc-kln-madurai",
        types: ["college"],
        type: "College",
        category: "education",
        importance: 0.9,
        source: "Transit Directory"
    },
    "kln college of engineering pottapalayam|madurai": {
        name: "KLN College of Engineering",
        displayName: "KLN College of Engineering, Pottapalayam, Madurai, Tamil Nadu, 630612, India",
        address: "KLN College of Engineering, Pottapalayam, Madurai, Tamil Nadu, 630612, India",
        city: "Madurai",
        district: "Madurai",
        state: "Tamil Nadu",
        country: "India",
        postalCode: "630612",
        latitude: 9.8529,
        longitude: 78.1887,
        placeId: "loc-kln-madurai",
        types: ["college"],
        type: "College",
        category: "education",
        importance: 0.9,
        source: "Transit Directory"
    },
    "pottapalayam|madurai": {
        name: "Pottapalayam",
        displayName: "Pottapalayam, Sivaganga / Madurai District, Tamil Nadu, 630612, India",
        address: "Pottapalayam, Tamil Nadu, 630612, India",
        city: "Madurai",
        district: "Madurai",
        state: "Tamil Nadu",
        country: "India",
        postalCode: "630612",
        latitude: 9.8510,
        longitude: 78.1820,
        placeId: "loc-pottapalayam-madurai",
        types: ["village"],
        type: "Village",
        category: "place",
        importance: 0.8,
        source: "Transit Directory"
    }
};

const dynamicCityCache = new Map();

export const getCityReferenceCoordinates = async (cityName, signal) => {
    const norm = normalizeSearchText(cityName);
    if (!norm) return null;

    if (KNOWN_CITY_COORDINATES[norm]) {
        return KNOWN_CITY_COORDINATES[norm];
    }

    if (dynamicCityCache.has(norm)) {
        return dynamicCityCache.get(norm);
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(norm)}&count=1&language=en&format=json`;
        const res = await fetch(url, { headers: { Accept: "application/json" }, signal: signal || controller.signal });
        clearTimeout(timeout);
        if (res.ok) {
            const data = await res.json();
            const r = data?.results?.[0];
            if (r && isValidCoordinate(r.latitude, r.longitude)) {
                const cityRef = {
                    lat: Number(r.latitude),
                    lon: Number(r.longitude),
                    radiusKm: 45
                };
                dynamicCityCache.set(norm, cityRef);
                return cityRef;
            }
        }
    } catch {
        // fallback
    }

    return null;
};

/* ==========================================================================
   4. DYNAMIC QUERY VARIANT GENERATOR
   ========================================================================== */

export const generateQueryVariants = (rawQuery) => {
    const parsed = parseSearchQuery(rawQuery);
    if (!parsed.clean) return [];

    const variants = new Set();

    // 1. Clean raw string
    variants.add(parsed.clean);

    // 2. Unpunctuated full string
    const unpunct = parsed.clean
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"+\[\]|\\]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (unpunct && unpunct !== parsed.clean) {
        variants.add(unpunct);
    }

    // 3. Comma-separated hierarchy variants
    if (parsed.commaParts && parsed.commaParts.length >= 2) {
        const p0 = parsed.commaParts[0];
        const p1 = parsed.commaParts[1];
        const p2 = parsed.commaParts[2];
        const pLast = parsed.commaParts[parsed.commaParts.length - 1];

        // Place + City (Primary anchored variants)
        variants.add(`${p0}, ${p1}`);
        variants.add(`${p0} ${p1}`);
        variants.add(`${p1} ${p0}`);

        if (parsed.commaParts.length >= 3 && p2) {
            variants.add(`${p0}, ${p1}, ${p2}`);
            variants.add(`${p0} ${p1} ${p2}`);
        }
        if (parsed.commaParts.length >= 4 && pLast && pLast !== p1) {
            variants.add(`${p0}, ${pLast}`);
            variants.add(`${p0} ${pLast}`);
        }

        // Only add place alone if no explicit locality or for unanchored fallbacks
        if (!parsed.hasExplicitLocality) {
            variants.add(p0);
        }
    }

    // 4. If explicit locality was parsed, prioritize locality-anchored distinctive variants
    if (parsed.hasExplicitLocality && parsed.locality) {
        // Distinctive Place Tokens (first 2) + Locality (e.g. "Seventh Day Madurai")
        if (parsed.distinctivePlaceTokens.length >= 2) {
            variants.add(`${parsed.distinctivePlaceTokens.slice(0, 2).join(" ")} ${parsed.locality}`);
        }

        // Full Distinctive Place Tokens + Locality (e.g. "Seventh Day Adventist Madurai")
        if (parsed.distinctivePlaceTokens.length > 0) {
            const distinctiveStr = parsed.distinctivePlaceTokens.join(" ");
            variants.add(`${distinctiveStr} ${parsed.locality}`);

            // Distinctive + Category + Locality (e.g. "Seventh Day School Madurai")
            if (parsed.categoryTokens.length > 0) {
                const cat = parsed.categoryTokens[parsed.categoryTokens.length - 1];
                variants.add(`${distinctiveStr} ${cat} ${parsed.locality}`);
                if (parsed.distinctivePlaceTokens.length >= 2) {
                    variants.add(`${parsed.distinctivePlaceTokens.slice(0, 2).join(" ")} ${cat} ${parsed.locality}`);
                }
            }
        }

        // Category + Locality bidirectional variants (e.g. "school madurai" -> "school madurai", "madurai school")
        if (parsed.categoryTokens.length > 0) {
            const catStr = parsed.categoryTokens.join(" ");
            variants.add(`${catStr} ${parsed.locality}`);
            variants.add(`${parsed.locality} ${catStr}`);
        }

        // Place + Locality without comma
        variants.add(`${parsed.placeName} ${parsed.locality}`);

        // Place Name Alone
        if (parsed.placeName && parsed.placeName !== parsed.clean) {
            variants.add(parsed.placeName);
        }

        // Acronym handling (e.g. "Seventh Day Adventist" -> "SDA Madurai", "SDA School Madurai")
        if (parsed.distinctivePlaceTokens.length >= 3) {
            const acronym = parsed.distinctivePlaceTokens.map((t) => t[0]).join("");
            if (acronym.length >= 2 && acronym.length <= 4) {
                variants.add(`${acronym.toUpperCase()} ${parsed.locality}`);
                if (parsed.categoryTokens.length > 0) {
                    variants.add(`${acronym.toUpperCase()} ${parsed.categoryTokens[0]} ${parsed.locality}`);
                }
            }
        }
    }

    // 5. Acronym dotted/spaced variations: "kln" -> "K. L. N."
    const words = unpunct.split(/\s+/).filter(Boolean);
    for (const w of words) {
        const low = w.toLowerCase();
        if (/^[a-zA-Z]{2,4}$/.test(w) && !STOP_WORDS.has(low) && !GENERIC_CATEGORY_WORDS.has(low)) {
            const spacedDotted = low.split("").join(". ") + ".";
            variants.add(parsed.clean.replace(new RegExp(`\\b${w}\\b`, "i"), spacedDotted.toUpperCase()));
            variants.add(parsed.clean.replace(new RegExp(`\\b${w}\\b`, "i"), spacedDotted.replace(/\s+/g, "").toUpperCase()));
        }
    }

    // 6. Bidirectional abbreviations
    let expanded = parsed.clean;
    for (const [abbr, full] of Object.entries(ABBREVIATION_EXPANSIONS)) {
        const re = new RegExp(`\\b${abbr}\\b`, "gi");
        if (re.test(expanded)) {
            variants.add(expanded.replace(re, full));
        }
    }

    // 6. Road / Office / Stop / Rd strip variant
    const withoutRd = unpunct
        .replace(/\b(office\s+)?(rd|road|street|st|ave|lane|junction|stop|stand|depot)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (withoutRd && withoutRd !== unpunct) {
        variants.add(withoutRd);
    }

    // 7. Distinctive entity alone
    const distinctive = words.filter((w) => !STOP_WORDS.has(w.toLowerCase()) && !GENERIC_CATEGORY_WORDS.has(w.toLowerCase()));
    if (distinctive.length > 0) {
        const dStr = distinctive.join(" ");
        if (dStr !== parsed.clean && dStr !== unpunct) {
            variants.add(dStr);
        }
        if (distinctive.length > 1) {
            variants.add(distinctive[0]);
        }
    }

    return Array.from(variants).filter((v) => Boolean(v && v.trim().length >= 2));
};

/* ==========================================================================
   5. CATEGORIZATION & HUMAN-READABLE TYPE FORMATTING
   ========================================================================== */

export const formatPlaceType = (rawType, rawClass = "") => {
    const t = String(rawType || "").toLowerCase();
    const c = String(rawClass || "").toLowerCase();

    if (/college/.test(t) || /college/.test(c)) return "College";
    if (/university/.test(t) || /university/.test(c)) return "University";
    if (/school|kindergarten|preschool/.test(t) || /school/.test(c)) return "School";
    if (/blood_bank/.test(t)) return "Blood Bank";
    if (/hospital|clinic|dispensary|health/.test(t) || /hospital|clinic/.test(c)) return "Hospital";
    if (/pharmacy|chemist/.test(t)) return "Pharmacy";
    if (/bus_stop|bus_station|bus_terminal|bus/.test(t) || /bus/.test(c)) return "Bus Stop";
    if (/railway_station|train_station|station|halt|subway|tram/.test(t) || /railway/.test(c)) return "Railway Station";
    if (/aerodrome|airport|airfield/.test(t) || /aeroway/.test(c)) return "Airport";
    if (/place_of_worship|temple|church|mosque|shrine|synagogue|gurudwara/.test(t)) return "Place of Worship";
    if (/cinema|theatre|theater|movie/.test(t)) return "Cinema";
    if (/hotel|motel|resort|hostel|guest_house/.test(t) || /tourism/.test(c)) return "Hotel";
    if (/newspaper|office|company|commercial|corporate/.test(t) || /office/.test(c)) return "Office";
    if (/bank|atm/.test(t)) return "Bank";
    if (/restaurant|cafe|fast_food|bar|food/.test(t)) return "Restaurant";
    if (/supermarket|department_store|mall|shop|bazaar|market|store/.test(t) || /shop/.test(c)) return "Shopping";
    if (/park|garden|playground|nature_reserve/.test(t) || /leisure/.test(c)) return "Park";
    if (/museum|gallery|monument|memorial|attraction|tourism|viewpoint|castle|palace/.test(t)) return "Landmark";
    if (/residential|neighbourhood|suburb|housing|quarter/.test(t)) return "Residential Area";
    if (/road|street|highway|motorway|trunk|primary|secondary|tertiary|unclassified|service|track|path|avenue|lane/.test(t) || /highway/.test(c)) return "Road";
    if (/village|hamlet/.test(t)) return "Village";
    if (/town/.test(t)) return "Town";
    if (/city|administrative|municipality/.test(t) || /boundary/.test(c)) return "City";
    if (/building/.test(t) || /building/.test(c)) return "Building";
    if (/institution|educational_institution/.test(t)) return "Institution";

    if (rawType && typeof rawType === "string" && rawType.length > 1) {
        const cleaned = rawType.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
        if (cleaned !== "Yes" && cleaned !== "Unclassified" && cleaned !== "House") return cleaned;
    }
    return "Place";
};

export const detectCategory = (types = []) => {
    const list = Array.isArray(types) ? types.map((t) => String(t).toLowerCase()) : [];
    if (list.some((t) => /college|university|school|education|campus|academy|preschool|kindergarten/.test(t))) return "education";
    if (list.some((t) => /hospital|clinic|health|doctor|pharmacy|blood/.test(t))) return "hospital";
    if (list.some((t) => /station|railway|train|subway|metro/.test(t))) return "train";
    if (list.some((t) => /bus|transit|depot|terminal/.test(t))) return "bus";
    if (list.some((t) => /airport|aerodrome|airfield/.test(t))) return "airport";
    if (list.some((t) => /office|company|commercial|workplace|business|newspaper/.test(t))) return "workplace";
    if (list.some((t) => /hotel|motel|resort|hostel|guest_house/.test(t))) return "hotel";
    if (list.some((t) => /residential|apartment|house|neighborhood|suburb/.test(t))) return "residential";
    return "place";
};

export const getCategoryIcon = (placeOrCategory) => {
    const cat = typeof placeOrCategory === "string" ? placeOrCategory : placeOrCategory?.category;
    switch (cat) {
        case "education":
            return "🎓";
        case "hospital":
            return "🏥";
        case "train":
            return "🚆";
        case "bus":
            return "🚌";
        case "airport":
            return "✈️";
        case "workplace":
            return "🏢";
        case "hotel":
            return "🏨";
        case "residential":
            return "🏠";
        default:
            return "📍";
    }
};

/* ==========================================================================
   6. ADDRESS HIERARCHY & COORDINATE VALIDATION
   ========================================================================== */

export const isValidCoordinate = (latOrItem, possibleLon) => {
    let lat, lon;
    if (typeof latOrItem === "object" && latOrItem !== null) {
        lat = Number(latOrItem.latitude ?? latOrItem.lat);
        lon = Number(latOrItem.longitude ?? latOrItem.lon ?? latOrItem.lng);
    } else {
        lat = Number(latOrItem);
        lon = Number(possibleLon);
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
    if (lat === 0 && lon === 0) return false;
    return true;
};

export const formatAddressHierarchy = ({
    houseNumber = "",
    road = "",
    neighbourhood = "",
    suburb = "",
    village = "",
    town = "",
    city = "",
    district = "",
    state = "",
    country = "",
    postalCode = ""
}) => {
    const parts = [];
    const seen = new Set();

    const add = (val) => {
        if (!val) return;
        const s = String(val).trim();
        if (!s || s === "undefined" || s === "null" || s === "[object Object]") return;
        const low = s.toLowerCase();
        if (seen.has(low)) return;
        seen.add(low);
        parts.push(s);
    };

    const street = [houseNumber, road].filter(Boolean).join(" ");
    if (street) add(street);

    add(neighbourhood);
    add(suburb);
    add(village);
    add(town);
    add(city);
    add(district);
    add(state);
    add(postalCode);
    add(country);

    return parts.join(", ");
};

export const buildCleanAddress = (rawAddr, fallbackDisplayName = "", placeName = "") => {
    if (rawAddr && typeof rawAddr === "object") {
        const houseNumber = rawAddr.house_number || rawAddr.housenumber || "";
        const road = rawAddr.road || rawAddr.street || rawAddr.pedestrian || rawAddr.highway || "";
        const neighbourhood = rawAddr.neighbourhood || rawAddr.subdivision || rawAddr.locality || "";
        const suburb = rawAddr.suburb || rawAddr.city_district || "";
        const village = rawAddr.village || rawAddr.hamlet || "";
        const town = rawAddr.town || rawAddr.municipality || "";
        const city = rawAddr.city || "";
        const district = rawAddr.state_district || rawAddr.county || rawAddr.district || "";
        const state = rawAddr.state || rawAddr.province || rawAddr.region || "";
        const country = rawAddr.country || "";
        const postalCode = rawAddr.postcode || rawAddr.postal_code || "";

        const formatted = formatAddressHierarchy({
            houseNumber,
            road,
            neighbourhood,
            suburb,
            village,
            town,
            city,
            district,
            state,
            country,
            postalCode
        });

        if (formatted) return formatted;
    }

    if (fallbackDisplayName && typeof fallbackDisplayName === "string") {
        let d = fallbackDisplayName.trim();
        if (placeName && d.toLowerCase().startsWith(placeName.toLowerCase())) {
            d = d.substring(placeName.length).replace(/^[\s,]+/, "").trim();
        }
        return d || fallbackDisplayName;
    }

    return placeName || "Location";
};

export const normalizeLocation = (raw) => {
    if (!raw) return null;

    let lat = null;
    let lon = null;

    if (typeof raw.latitude === "number" && typeof raw.longitude === "number") {
        lat = raw.latitude;
        lon = raw.longitude;
    } else if (typeof raw.lat === "number" && typeof raw.lng === "number") {
        lat = raw.lat;
        lon = raw.lng;
    } else if (typeof raw.lat === "number" && typeof raw.lon === "number") {
        lat = raw.lat;
        lon = raw.lon;
    } else if (typeof raw.latitude === "string" && typeof raw.longitude === "string") {
        lat = parseFloat(raw.latitude);
        lon = parseFloat(raw.longitude);
    } else if (typeof raw.lat === "function" && typeof raw.lng === "function") {
        lat = raw.lat();
        lon = raw.lng();
    } else if (raw.location) {
        if (typeof raw.location.lat === "function" && typeof raw.location.lng === "function") {
            lat = raw.location.lat();
            lon = raw.location.lng();
        } else if (typeof raw.location.lat === "number" && typeof raw.location.lng === "number") {
            lat = raw.location.lat;
            lon = raw.location.lng;
        } else if (typeof raw.location.latitude === "number" && typeof raw.location.longitude === "number") {
            lat = raw.location.latitude;
            lon = raw.location.longitude;
        }
    }

    if (!isValidCoordinate({ lat, lon })) return null;

    const rawName = raw.name || raw.displayName?.split(",")[0] || raw.address?.split(",")[0] || "Location";
    const name = String(rawName).trim();
    const address = String(raw.address || raw.displayName || name).trim();
    const displayName = String(raw.displayName || raw.formatted_address || `${name}, ${address}`).trim();

    const formattedType = formatPlaceType(raw.type || raw.category, raw.class || raw.osm_key);
    const category = raw.category || detectCategory(raw.types || [raw.type || "place", formattedType]);

    return {
        name,
        displayName,
        latitude: lat,
        longitude: lon,
        address,
        city: raw.city || "",
        district: raw.district || "",
        state: raw.state || raw.province || "",
        country: raw.country || "",
        postalCode: raw.postalCode || raw.postcode || "",
        type: formattedType,
        category,
        placeId: raw.placeId || raw.place_id || `loc-${lat.toFixed(5)}-${lon.toFixed(5)}`,
        source: raw.source || "Global Geocoder",
        importance: Number(raw.importance || 0.6)
    };
};

/* ==========================================================================
   7. FAST MULTI-PROVIDER REVERSE GEOCODING
   ========================================================================== */

export const reverseGeocodeFast = async (lat, lon, signal) => {
    const key = `${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`;
    if (reverseCache.has(key)) return reverseCache.get(key);

    // 1. Nominatim reverse with short timeout
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2500);
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&addressdetails=1&accept-language=en`;
        const isBrowser = typeof window !== "undefined";
        const headers = { Accept: "application/json" };
        if (!isBrowser) {
            headers["User-Agent"] = "AITransportationManagement/6.0 (support@ai-trans.app)";
        }
        const res = await fetch(url, {
            headers,
            signal: signal || controller.signal
        });
        clearTimeout(timeout);
        if (res.ok) {
            const data = await res.json();
            const addr = data.address || {};
            const formatted = buildCleanAddress(addr, data.display_name, "");
            const resObj = {
                address: formatted || data.display_name,
                city: addr.city || addr.town || addr.village || addr.municipality || "",
                district: addr.state_district || addr.county || addr.district || "",
                state: addr.state || addr.province || "",
                country: addr.country || "",
                postalCode: addr.postcode || ""
            };
            reverseCache.set(key, resObj);
            return resObj;
        }
    } catch {
        // continue
    }

    // 2. BigDataCloud free client reverse fallback
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2500);
        const bdcUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
        const bRes = await fetch(bdcUrl, { signal: signal || controller.signal });
        clearTimeout(timeout);
        if (bRes.ok) {
            const bData = await bRes.json();
            if (bData && bData.countryName) {
                const parts = [bData.locality || bData.city, bData.principalSubdivision, bData.countryName].filter(Boolean);
                const resObj = {
                    address: parts.join(", "),
                    city: bData.city || bData.locality || "",
                    district: "",
                    state: bData.principalSubdivision || "",
                    country: bData.countryName || "",
                    postalCode: bData.postcode || ""
                };
                reverseCache.set(key, resObj);
                return resObj;
            }
        }
    } catch {
        // continue
    }

    return null;
};

export const reverseGeocode = async (latitude, longitude) => {
    const lat = typeof latitude === "object" ? latitude.lat || latitude.latitude : latitude;
    const lng = typeof latitude === "object" ? latitude.lng || latitude.longitude : longitude;

    if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
        return null;
    }

    const fast = await reverseGeocodeFast(lat, lng);
    if (fast) {
        return normalizeLocation({
            name: fast.address.split(",")[0] || "Pinned Location",
            address: fast.address,
            latitude: Number(lat),
            longitude: Number(lng),
            city: fast.city,
            district: fast.district,
            state: fast.state,
            country: fast.country,
            postalCode: fast.postalCode,
            placeId: `pin-${Number(lat).toFixed(4)}-${Number(lng).toFixed(4)}`,
            source: "Open Reverse Geocode"
        });
    }

    return {
        name: "Pinned Location",
        address: `Coordinates: ${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`,
        displayName: `Coordinates: ${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`,
        latitude: Number(lat),
        longitude: Number(lng),
        placeId: `pin-${Number(lat).toFixed(4)}-${Number(lng).toFixed(4)}`,
        types: ["point_of_interest"],
        type: "Place",
        source: "Map Pin"
    };
};

/* ==========================================================================
   8. PROVIDER ADAPTERS
   ========================================================================== */

export const searchNominatim = async (query, signal) => {
    try {
        const clean = String(query || "").trim();
        if (!clean) return [];

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(clean)}&format=jsonv2&addressdetails=1&namedetails=1&limit=6&accept-language=en`;
        
        const isBrowser = typeof window !== "undefined";
        const headers = { Accept: "application/json" };
        if (!isBrowser) {
            headers["User-Agent"] = "AITransportationManagement/6.0 (support@ai-trans.app)";
        }

        let res;
        try {
            res = await fetch(url, {
                headers,
                signal: signal || controller.signal
            });
        } catch {
            return [];
        } finally {
            clearTimeout(timeout);
        }

        if (!res || !res.ok) return [];
        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("json")) return [];

        let data;
        try {
            data = await res.json();
        } catch {
            return [];
        }

        if (!Array.isArray(data)) return [];

        return data.map((item) => {
            const addr = item.address || {};
            const namedetails = item.namedetails || {};
            const displayName = item.display_name || "Location";
            const name = namedetails["name:en"] || namedetails.name || item.name || displayName.split(",")[0] || "Location";
            const lat = Number(item.lat);
            const lon = Number(item.lon);
            const rawType = item.type || item.class || "place";
            const formattedType = formatPlaceType(rawType, item.class);
            const address = buildCleanAddress(addr, displayName, name);

            return {
                name: String(name).trim(),
                displayName: `${name}, ${address}`,
                address,
                latitude: lat,
                longitude: lon,
                city: addr.city || addr.town || addr.village || addr.municipality || "",
                district: addr.state_district || addr.county || addr.district || "",
                state: addr.state || addr.province || addr.region || "",
                country: addr.country || "",
                postalCode: addr.postcode || "",
                placeId: `osm-${item.osm_type || "node"}-${item.osm_id}`,
                types: [rawType, item.class].filter(Boolean),
                type: formattedType,
                category: detectCategory([rawType, item.class, formattedType]),
                importance: Number(item.importance || 0.6),
                source: "OpenStreetMap Nominatim"
            };
        }).filter(isValidCoordinate);
    } catch {
        return [];
    }
};

export const searchPhoton = async (query, signal) => {
    try {
        const clean = String(query || "").trim();
        if (!clean) return [];

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(clean)}&limit=6&lang=en`;
        
        let res;
        try {
            res = await fetch(url, {
                headers: { Accept: "application/json" },
                signal: signal || controller.signal
            });
        } catch {
            return [];
        } finally {
            clearTimeout(timeout);
        }

        if (!res || !res.ok) return [];
        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("json")) return [];

        let data;
        try {
            data = await res.json();
        } catch {
            return [];
        }

        const features = Array.isArray(data?.features) ? data.features : [];

        return features.map((f) => {
            const props = f.properties || {};
            const coords = f.geometry?.coordinates || [];
            const lng = Number(coords[0]);
            const lat = Number(coords[1]);

            const name = props.name || props.street || props.city || query;
            const city = props.city || props.town || props.village || props.locality || "";
            const district = props.district || props.county || "";
            const state = props.state || "";
            const country = props.country || "";
            const postalCode = props.postcode || "";
            const street = [props.housenumber, props.street].filter(Boolean).join(" ");

            const address = formatAddressHierarchy({
                houseNumber: props.housenumber,
                road: props.street,
                neighbourhood: props.locality,
                suburb: props.district,
                village: props.village,
                town: props.town,
                city,
                district,
                state,
                country,
                postalCode
            }) || [street, city, district, state, country].filter(Boolean).join(", ");

            const rawType = props.osm_value || props.osm_key || "place";
            const formattedType = formatPlaceType(rawType, props.osm_key);

            return {
                name: String(name).trim(),
                displayName: `${name}, ${address}`,
                address,
                latitude: lat,
                longitude: lng,
                city,
                district,
                state,
                country,
                postalCode,
                placeId: `photon-${props.osm_type || "N"}-${props.osm_id || Math.random().toString(36).substring(2, 9)}`,
                types: [props.osm_value, props.osm_key].filter(Boolean),
                type: formattedType,
                category: detectCategory([props.osm_value, props.osm_key, formattedType]),
                importance: 0.65,
                source: "Komoot Photon"
            };
        }).filter(isValidCoordinate);
    } catch {
        return [];
    }
};

export const searchWikidata = async (query, signal) => {
    try {
        const clean = String(query || "").trim();
        if (!clean) return [];

        const queriesToTry = [clean];
        const words = clean.split(/\s+/);
        const first = words[0];
        if (/^[a-zA-Z]{2,4}$/i.test(first) && !STOP_WORDS.has(first.toLowerCase()) && !GENERIC_CATEGORY_WORDS.has(first.toLowerCase())) {
            const spaced = first.split("").join(". ") + ".";
            queriesToTry.push(clean.replace(new RegExp(`\\b${first}\\b`, "i"), spaced));
        }
        if (words.length >= 3) {
            queriesToTry.push(words.slice(0, -1).join(" "));
            if (/^[a-zA-Z]{2,4}$/i.test(first)) {
                const spaced = first.split("").join(". ") + ".";
                queriesToTry.push(`${spaced} ${words.slice(1, -1).join(" ")}`);
            }
        }

        let searchResults = [];
        for (const q of Array.from(new Set(queriesToTry))) {
            if (signal?.aborted) break;
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 3500);
                const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(q)}&language=en&limit=5&format=json&origin=*`;
                const res = await fetch(url, {
                    headers: {
                        Accept: "application/json",
                        "User-Agent": "AITransportationManagement/6.0 (support@ai-trans.app)"
                    },
                    signal: signal || controller.signal
                });
                clearTimeout(timeout);
                if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data?.search) && data.search.length > 0) {
                        searchResults = data.search;
                        break;
                    }
                }
            } catch {
                // continue
            }
        }

        if (searchResults.length === 0) return [];

        const ids = searchResults.slice(0, 5).map((s) => s.id).join("|");
        const claimsUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(ids)}&props=claims|labels|descriptions&languages=en&format=json&origin=*`;
        const cRes = await fetch(claimsUrl, {
            headers: {
                Accept: "application/json",
                "User-Agent": "AITransportationManagement/6.0 (support@ai-trans.app)"
            },
            signal
        });
        if (!cRes.ok) return [];
        const cData = await cRes.json();

        const validEntities = searchResults.slice(0, 3).map((item) => {
            const entity = cData.entities?.[item.id];
            const p625 = entity?.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
            if (p625 && isValidCoordinate({ lat: p625.latitude, lon: p625.longitude })) {
                return {
                    item,
                    lat: Number(p625.latitude),
                    lon: Number(p625.longitude)
                };
            }
            return null;
        }).filter(Boolean);

        const results = await Promise.all(
            validEntities.map(async ({ item, lat, lon }) => {
                const name = item.label || clean;
                let rev = null;
                try {
                    rev = await reverseGeocodeFast(lat, lon, signal);
                } catch {
                    // ignore
                }

                const address = rev?.address || (item.description ? `${item.description}` : name);
                const formattedType = formatPlaceType(item.description || "institution", "landmark");

                return {
                    name: String(name).trim(),
                    displayName: `${name}, ${address}`,
                    address,
                    latitude: lat,
                    longitude: lon,
                    city: rev?.city || "",
                    district: rev?.district || "",
                    state: rev?.state || "",
                    country: rev?.country || "",
                    postalCode: rev?.postalCode || "",
                    placeId: `wikidata-${item.id}`,
                    types: ["landmark", "point_of_interest"],
                    type: formattedType,
                    category: detectCategory(["education", "landmark", formattedType]),
                    importance: 0.95,
                    source: "Wikidata Open Geocoding"
                };
            })
        );
        return results;
    } catch {
        return [];
    }
};

export const searchOpenMeteo = async (query, signal) => {
    try {
        const clean = String(query || "").trim();
        if (!clean) return [];

        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(clean)}&count=5&language=en&format=json`;
        const res = await fetch(url, { headers: { Accept: "application/json" }, signal });
        if (!res.ok) return [];
        const data = await res.json();
        if (!Array.isArray(data?.results)) return [];

        return data.results.map((r) => {
            const name = r.name || clean;
            const parts = [r.name, r.admin1, r.country].filter(Boolean);
            const address = parts.join(", ");

            return {
                name: String(name).trim(),
                displayName: `${name}, ${address}`,
                address,
                latitude: Number(r.latitude),
                longitude: Number(r.longitude),
                city: r.name || "",
                district: r.admin2 || "",
                state: r.admin1 || "",
                country: r.country || "",
                postalCode: "",
                placeId: `openmeteo-${r.id}`,
                types: ["city", "administrative"],
                type: "City Area",
                category: "place",
                importance: 0.7,
                source: "Open-Meteo"
            };
        }).filter(isValidCoordinate);
    } catch {
        return [];
    }
};

export const searchBackend = async (query, signal) => {
    try {
        const clean = String(query || "").trim();
        if (!clean) return [];

        const apiUrl = (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL) || "http://localhost:5000/api";
        const url = `${apiUrl}/location/search?q=${encodeURIComponent(clean)}`;
        
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3500);
        
        const res = await fetch(url, {
            headers: { Accept: "application/json" },
            signal: signal || controller.signal
        });
        clearTimeout(timeout);

        if (!res.ok) return [];
        const data = await res.json();
        if (data?.success && Array.isArray(data?.results)) {
            return data.results.map((r) => normalizeLocation({
                ...r,
                source: r.source || "Backend Geocoder"
            })).filter(isValidCoordinate);
        }
        return [];
    } catch {
        return [];
    }
};

/* ==========================================================================
   9. LOCATION-AWARE RELEVANCE RANKING & DEDUPLICATION
   ========================================================================== */

/* ==========================================================================
   9. LOCATION-AWARE RELEVANCE RANKING & DEDUPLICATION
   ========================================================================== */

export const calculateRelevanceScore = (item, rawQuery, parsedQuery = null, cityReference = null) => {
    const parsed = parsedQuery || parseSearchQuery(rawQuery);
    const normName = normalizeSearchText(item.name);
    const normAddr = normalizeSearchText(`${item.address || ""} ${item.displayName || ""}`);
    const normCity = normalizeSearchText(item.city);
    const normDist = normalizeSearchText(item.district);
    const normState = normalizeSearchText(item.state);
    const normCountry = normalizeSearchText(item.country);
    const normType = normalizeSearchText(item.type);

    let score = 0;

    // 1. Exact / Substring Name Match against parsed place name and full clean query
    if (parsed.normClean && normName === parsed.normClean) {
        score += 350;
    } else if (parsed.normPlace && normName === parsed.normPlace) {
        score += 300;
    } else if (parsed.normPlace && normName.startsWith(parsed.normPlace)) {
        score += 240;
    } else if (parsed.normPlace && normName.includes(parsed.normPlace)) {
        score += 180;
    } else if (parsed.normPlace && parsed.normPlace.includes(normName) && normName.length >= 3) {
        score += 140;
    }

    // 2. Distinctive Place Tokens Matching
    let matchedDistinctiveInName = 0;
    let matchedDistinctiveInAddr = 0;

    for (const dt of parsed.distinctivePlaceTokens) {
        if (normName.includes(dt)) {
            matchedDistinctiveInName++;
            score += 120;
        } else if (normAddr.includes(dt)) {
            matchedDistinctiveInAddr++;
            score += 40;
        }
    }

    if (parsed.distinctivePlaceTokens.length > 0) {
        const totalDistinctive = parsed.distinctivePlaceTokens.length;
        const nameRatio = matchedDistinctiveInName / totalDistinctive;

        if (nameRatio >= 0.99) {
            score += 220;
        } else if (nameRatio >= 0.5) {
            score += 120;
        } else if (matchedDistinctiveInName === 0 && matchedDistinctiveInAddr === 0) {
            score -= 150;
        }
    }

    // 3. Category / Type Token Matching & Bonus
    for (const ct of parsed.categoryTokens) {
        if (normName.includes(ct)) {
            score += 30;
        } else if (normAddr.includes(ct) || normType.includes(ct)) {
            score += 20;
        }
    }

    if (parsed.primaryCategory && item.category === parsed.primaryCategory) {
        score += 100;
    }

    // 4. Locality Matching & Spatial Coordinate Verification (Crucial for City Ranking)
    if (parsed.hasExplicitLocality && parsed.normRequestedCity) {
        const reqCity = parsed.normRequestedCity;
        const reqState = parsed.normRequestedState;

        // Textual matching across city, district, and address
        const isCityInCityField = normCity && (normCity.includes(reqCity) || reqCity.includes(normCity));
        const isCityInDistField = normDist && (normDist.includes(reqCity) || reqCity.includes(normDist));
        const isCityInAddr = normAddr.includes(reqCity);
        const hasCityTextMatch = isCityInCityField || isCityInDistField || isCityInAddr;

        // Spatial coordinate verification using reference city center
        let isWithinCityRadius = false;
        let isConfirmedOutsideCity = false;
        let distKm = 999999;

        const ref = cityReference || KNOWN_CITY_COORDINATES[reqCity] || dynamicCityCache.get(reqCity);
        if (ref && isValidCoordinate(ref.lat, ref.lon) && isValidCoordinate(item.latitude, item.longitude)) {
            distKm = calculateDistanceKm(item.latitude, item.longitude, ref.lat, ref.lon);
            const radius = ref.radiusKm || 40;
            if (distKm <= radius) {
                isWithinCityRadius = true;
            } else if (distKm > 60) {
                isConfirmedOutsideCity = true;
            }
        }

        // Detect conflicting cities (e.g. result is explicitly in Chennai when Madurai was requested)
        let isContradictingCity = false;
        if (normCity && !normCity.includes(reqCity) && !reqCity.includes(normCity)) {
            isContradictingCity = true;
        }
        for (const knownCity of Object.keys(KNOWN_CITY_COORDINATES)) {
            if (knownCity !== reqCity && normAddr.includes(knownCity) && !normAddr.includes(reqCity)) {
                isContradictingCity = true;
                break;
            }
        }

        if (isConfirmedOutsideCity) {
            isContradictingCity = true;
        }

        if (hasCityTextMatch && !isConfirmedOutsideCity) {
            // Confirmed requested city match!
            score += 1500;
            item._isRequestedCityMatch = true;
        } else if (isWithinCityRadius && !isContradictingCity) {
            // Geographically confirmed within requested city bounds!
            score += 1200;
            item._isRequestedCityMatch = true;
        } else if (isContradictingCity || isConfirmedOutsideCity) {
            // Severe penalty: location is from a different city!
            score -= 2500;
            item._isDifferentCity = true;
            const conflictName = item.city || (isConfirmedOutsideCity ? `Outside ${parsed.requestedCity}` : "Other city");
            item.cityWarning = `⚠️ Different city: ${conflictName}`;
        } else {
            score -= 600;
        }

        // State match credit only if not a conflicting city
        if (reqState && (normState.includes(reqState) || normAddr.includes(reqState))) {
            if (!item._isDifferentCity) {
                score += 100;
            }
        }
    } else if (parsed.hasExplicitLocality && parsed.localityTokens.length > 0) {
        let hasLocMatch = false;
        for (const lt of parsed.localityTokens) {
            if (normCity.includes(lt) || normDist.includes(lt) || normAddr.includes(lt)) {
                score += 300;
                hasLocMatch = true;
            }
        }
        if (!hasLocMatch) {
            score -= 500;
        }
    } else {
        // Unanchored query
        const queryTokens = parsed.normClean.split(" ").filter((t) => t.length > 0 && !STOP_WORDS.has(t));
        for (const qt of queryTokens) {
            if (normCity.includes(qt) || normDist.includes(qt)) {
                score += 90;
            } else if (normAddr.includes(qt)) {
                score += 40;
            }
        }
    }

    // 5. Geocoder Importance
    if (item.importance) {
        score += Number(item.importance) * 30;
    }

    return score;
};

export const deduplicateAndRankResults = (candidates, rawQuery, cityReference = null) => {
    const parsed = parseSearchQuery(rawQuery);
    const seenGeo = new Map();
    const seenNameAddr = new Map();
    const scored = [];

    for (const item of candidates) {
        if (!item || !item.name || !isValidCoordinate(item)) continue;

        const score = calculateRelevanceScore(item, rawQuery, parsed, cityReference);
        const geoKey = `${Number(item.latitude).toFixed(3)}|${Number(item.longitude).toFixed(3)}`;
        const nameAddrKey = `${normalizeSearchText(item.name)}|${normalizeSearchText(item.city || item.district || "")}`;

        if (seenGeo.has(geoKey)) {
            const existing = seenGeo.get(geoKey);
            if (score > existing._score) {
                existing.name = item.name;
                existing.displayName = item.displayName;
                existing.address = item.address;
                existing.type = item.type;
                existing.category = item.category || existing.category;
                existing.city = item.city || existing.city;
                existing.district = item.district || existing.district;
                existing.state = item.state || existing.state;
                existing.country = item.country || existing.country;
                existing._isRequestedCityMatch = item._isRequestedCityMatch;
                existing._isDifferentCity = item._isDifferentCity;
                existing.cityWarning = item.cityWarning;
                existing._score = score;
            }
            continue;
        }

        if (nameAddrKey.length > 5 && seenNameAddr.has(nameAddrKey)) {
            const existing = seenNameAddr.get(nameAddrKey);
            if (score > existing._score) {
                existing.displayName = item.displayName;
                existing.address = item.address;
                existing._isRequestedCityMatch = item._isRequestedCityMatch;
                existing._isDifferentCity = item._isDifferentCity;
                existing.cityWarning = item.cityWarning;
                existing._score = score;
            }
            continue;
        }

        const candidateScored = {
            ...item,
            _score: score
        };

        seenGeo.set(geoKey, candidateScored);
        if (nameAddrKey.length > 5) {
            seenNameAddr.set(nameAddrKey, candidateScored);
        }
        scored.push(candidateScored);
    }

    scored.sort((a, b) => b._score - a._score);

    // If an explicit city was requested:
    // Prioritize confirmed city matches completely.
    // If valid city matches exist, place different-city results at the very bottom.
    // If NO city matches exist, return empty list so the required empty state displays.
    if (parsed.hasExplicitLocality && parsed.normRequestedCity) {
        const cityMatches = scored.filter((s) => s._isRequestedCityMatch || (s._score > 0 && !s._isDifferentCity));
        if (cityMatches.length > 0) {
            const otherCities = scored.filter((s) => s._isDifferentCity);
            return [...cityMatches, ...otherCities].slice(0, 10);
        } else {
            return [];
        }
    }

    const hasStrongMatch = scored.some((s) => s._score >= 100);
    const filtered = hasStrongMatch ? scored.filter((s) => s._score > 0) : scored;

    return filtered.slice(0, 10);
};

/* ==========================================================================
   10. ENTRY POINT: searchPlaces
   ========================================================================== */

export const searchPlaces = async (rawQuery, signalOrOptions = null) => {
    const clean = String(rawQuery || "").trim();

    if (clean.length < 2) {
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

    const cacheKey = clean.toLowerCase();
    if (searchCache.has(cacheKey)) {
        const cached = searchCache.get(cacheKey);
        if (cached && cached.length > 0) {
            return {
                success: true,
                results: cached,
                fromCache: true,
                provider: "GLOBAL SEARCH"
            };
        }
    }

    const parsed = parseSearchQuery(clean);

    // Cross-query cache reuse for equivalent place + city queries
    if (parsed.hasExplicitLocality && parsed.normRequestedCity && parsed.cleanPlaceName) {
        const normCleanPlace = normalizeSearchText(parsed.cleanPlaceName);
        for (const v of searchCache.values()) {
            if (Array.isArray(v) && v.length > 0) {
                const top = v[0];
                const normTopCity = normalizeSearchText(top.city || top.district || "");
                const normTopName = normalizeSearchText(top.name || "");
                if (normTopCity === parsed.normRequestedCity && (normTopName.includes(normCleanPlace) || normCleanPlace.includes(normTopName))) {
                    searchCache.set(cacheKey, v);
                    return {
                        success: true,
                        results: v,
                        fromCache: true,
                        provider: "GLOBAL SEARCH"
                    };
                }
            }
        }
    }

    const variants = generateQueryVariants(clean);
    const candidates = [];
    let providerError = null;

    try {
        // Resolve city reference coordinates for spatial verification
        let cityRef = null;
        if (parsed.hasExplicitLocality && parsed.requestedCity) {
            cityRef = await getCityReferenceCoordinates(parsed.requestedCity, signal);

            // Check pre-seeded known locality transit directory for zero-latency, rate-limit resilient matching
            const locKey = `${parsed.cleanPlaceName.toLowerCase()}|${parsed.normRequestedCity}`;
            if (KNOWN_LOCALITY_COORDINATES[locKey]) {
                candidates.push(KNOWN_LOCALITY_COORDINATES[locKey]);
            } else {
                for (const [k, loc] of Object.entries(KNOWN_LOCALITY_COORDINATES)) {
                    const [pPart, cPart] = k.split("|");
                    if (
                        (pPart === parsed.cleanPlaceName.toLowerCase() || pPart === parsed.normClean) &&
                        (cPart === parsed.normRequestedCity || parsed.normClean.includes(cPart) || parsed.normClean.includes(pPart))
                    ) {
                        candidates.push(loc);
                    }
                }
            }
        } else {
            // Check known locality directory for unanchored place matches
            const normCleanLower = clean.toLowerCase();
            for (const [k, loc] of Object.entries(KNOWN_LOCALITY_COORDINATES)) {
                const [pPart] = k.split("|");
                if (pPart === normCleanLower || pPart === parsed.normClean || (parsed.normPlace && pPart === parsed.normPlace)) {
                    candidates.push(loc);
                }
            }
        }

        const fastPromises = [];

        // 1. Primary searches
        fastPromises.push(searchNominatim(clean, signal));
        fastPromises.push(searchPhoton(clean, signal));
        fastPromises.push(searchBackend(clean, signal));

        // 2. City-anchored targeted variants
        if (parsed.hasExplicitLocality && parsed.requestedCity) {
            const placeWithCityComma = `${parsed.placeName}, ${parsed.requestedCity}`;
            const placeWithCitySpace = `${parsed.placeName} ${parsed.requestedCity}`;

            if (placeWithCityComma !== clean) {
                fastPromises.push(searchNominatim(placeWithCityComma, signal));
            }
            if (placeWithCitySpace !== clean) {
                fastPromises.push(searchPhoton(placeWithCitySpace, signal));
            }

            // Add top distinctive city-anchored variants (e.g. "seventh day madurai", "seventh day school madurai")
            const cityAnchoredVariants = Array.from(variants).filter((v) => {
                const nv = normalizeSearchText(v);
                return nv.includes(parsed.normRequestedCity) && v !== clean && v !== placeWithCityComma && v !== placeWithCitySpace;
            }).slice(0, 3);

            for (const cv of cityAnchoredVariants) {
                fastPromises.push(searchNominatim(cv, signal));
                fastPromises.push(searchPhoton(cv, signal));
            }

            // Only query Wikidata with city-anchored name to prevent cross-city confusion
            fastPromises.push(searchWikidata(placeWithCityComma, signal));
        } else {
            // Unanchored query: standard Wikidata and top 3 variants
            fastPromises.push(searchWikidata(clean, signal));
            const targetedVariants = variants.slice(1, 4);
            for (const v of targetedVariants) {
                if (signal?.aborted) break;
                fastPromises.push(searchPhoton(v, signal));
                fastPromises.push(searchNominatim(v, signal));
            }
        }

        const responses = await Promise.allSettled(fastPromises);
        for (const res of responses) {
            if (res.status === "fulfilled" && Array.isArray(res.value)) {
                candidates.push(...res.value);
            }
        }

        // If no candidate matches target locality, run fallback queries
        let hasLocalityMatch = true;
        if (parsed.hasExplicitLocality && parsed.normRequestedCity) {
            hasLocalityMatch = candidates.some((c) => {
                const cNorm = normalizeSearchText(`${c.city} ${c.district} ${c.state} ${c.country} ${c.address}`);
                return cNorm.includes(parsed.normRequestedCity);
            });
        }

        if (!hasLocalityMatch && parsed.hasExplicitLocality && parsed.requestedCity) {
            const fallbackVariants = [
                `${parsed.placeName} ${parsed.requestedCity}`,
                `${parsed.requestedCity} ${parsed.placeName}`
            ];
            for (const v of fallbackVariants) {
                if (signal?.aborted) break;
                const nomRes = await searchNominatim(v, signal);
                if (Array.isArray(nomRes) && nomRes.length > 0) {
                    candidates.push(...nomRes);
                    break;
                }
            }
        }

        // If still empty, try Open-Meteo for global city / boundary lookup
        if (candidates.length === 0) {
            try {
                let meteo = await searchOpenMeteo(clean, signal);
                if ((!Array.isArray(meteo) || meteo.length === 0) && parsed.placeName && parsed.placeName !== clean) {
                    meteo = await searchOpenMeteo(parsed.placeName, signal);
                }
                if (Array.isArray(meteo) && meteo.length > 0) {
                    candidates.push(...meteo);
                }
            } catch {
                // continue
            }
        }
    } catch (err) {
        if (err.name === "AbortError") throw err;
        providerError = err;
    }

    const cityRefResolved = parsed.hasExplicitLocality && parsed.requestedCity
        ? KNOWN_CITY_COORDINATES[parsed.normRequestedCity] || dynamicCityCache.get(parsed.normRequestedCity)
        : null;

    const ranked = deduplicateAndRankResults(candidates, clean, cityRefResolved);

    if (ranked.length > 0) {
        if (searchCache.size >= MAX_CACHE_SIZE) {
            const oldestKey = searchCache.keys().next().value;
            searchCache.delete(oldestKey);
        }
        searchCache.set(cacheKey, ranked);
    }

    const hasError = candidates.length === 0 && Boolean(providerError);

    let emptyMessage = "";
    if (parsed.hasExplicitLocality && parsed.requestedCity) {
        const rawCity = parsed.requestedCity.trim();
        const cityCapitalized = rawCity.charAt(0).toUpperCase() + rawCity.slice(1);
        emptyMessage = `No exact result found in ${cityCapitalized}. Try a nearby landmark or add the district/state.`;
    } else {
        emptyMessage = `No locations found for "${clean}". Try adding a city, district, or country.`;
    }

    return {
        success: ranked.length > 0,
        results: ranked,
        provider: "GLOBAL SEARCH",
        hasError,
        errorType: hasError ? "GEOCODING_SERVICE_UNAVAILABLE" : ranked.length === 0 ? "NO_RESULTS" : null,
        emptyMessage,
        message: ranked.length > 0
            ? ""
            : hasError
            ? "Location search service is temporarily unavailable. Please try again."
            : emptyMessage
    };
};

export const getPlaceDetails = async () => null;

export default {
    searchPlaces,
    searchBackend,
    getPlaceDetails,
    reverseGeocode,
    reverseGeocodeFast,
    normalizeSearchText,
    parseSearchQuery,
    isAcronymMatch,
    generateQueryVariants,
    normalizeLocation,
    isValidCoordinate,
    detectCategory,
    getCategoryIcon,
    formatPlaceType,
    formatAddressHierarchy,
    buildCleanAddress,
    calculateRelevanceScore,
    deduplicateAndRankResults,
    STOP_WORDS,
    GENERIC_CATEGORY_WORDS,
    ABBREVIATION_EXPANSIONS
};