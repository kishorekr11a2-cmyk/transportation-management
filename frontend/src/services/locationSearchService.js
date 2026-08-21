/* ==========================================================================
   GLOBAL OPEN LOCATION SEARCH SERVICE (Universal Internet-Based Geocoding)
   
   Architecture:
   - Stage 1: Parallel multi-provider search across Wikidata, Komoot Photon (OSM Elasticsearch),
              and OpenStreetMap Nominatim with live query variants.
   - Stage 2: Location-aware and distinctive fallback resolution.
   - Stage 3: Open-Meteo global administrative boundary resolution.
   - Reverse Geocoding: Multi-provider reverse resolution (Nominatim & BigDataCloud) to always
                        extract and display true physical street/neighbourhood/city addresses.

   Design Principles:
   - ZERO hardcoded dictionaries, institution lists, or country-specific fallbacks.
   - Full global coverage across all cities, villages, institutions, roads, and landmarks.
   - Location-aware scoring ensuring specific city/locality intent (e.g. Madurai vs Chennai)
     is strictly preserved and prioritized.
   - Consistent 3-line UI presentation:
       Line 1: Place Name
       Line 2: Physical Address / Location Hierarchy
       Line 3: Category / Place Type Badge
   ========================================================================== */

const searchCache = new Map();
const reverseCache = new Map();
const MAX_CACHE_SIZE = 400;

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

const STOP_WORDS = new Set([
    "of", "and", "the", "in", "at", "for", "to", "a", "an", "is", "on", "near", "by", "dt", "district",
    "de", "du", "la", "le", "les", "und", "der", "die", "das"
]);

const GENERIC_CATEGORY_WORDS = new Set([
    "college", "university", "school", "institute", "polytechnic", "academy", "campus", "institution",
    "engineering", "technology", "tech", "science", "arts", "medical",
    "hospital", "clinic", "dispensary", "health", "pharmacy", "care", "blood", "bank",
    "theatre", "theater", "cinema", "talkies", "hall", "auditorium", "multiplex",
    "railway", "station", "train", "metro", "bus", "stand", "stop", "terminal", "depot", "junction", "airport", "aerodrome", "airfield", "port",
    "mall", "market", "bazaar", "store", "supermarket", "complex", "plaza", "centre", "center", "hub",
    "road", "street", "lane", "avenue", "highway", "expressway", "cross", "main", "circle", "rd", "st", "ave",
    "temple", "church", "mosque", "monument", "palace", "park", "garden", "lake", "dam", "beach", "hotel", "resort", "hostel",
    "office", "company", "headquarters", "building", "tower"
]);

const ABBREVIATION_EXPANSIONS = {
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
    ctr: "center"
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
   3. CATEGORIZATION & HUMAN-READABLE TYPE FORMATTING
   ========================================================================== */

export const formatPlaceType = (rawType, rawClass = "") => {
    const t = String(rawType || "").toLowerCase();
    const c = String(rawClass || "").toLowerCase();

    if (/college/.test(t) || /college/.test(c)) return "College";
    if (/university/.test(t) || /university/.test(c)) return "University";
    if (/school/.test(t) || /school/.test(c)) return "School";
    if (/kindergarten|preschool/.test(t)) return "Preschool";
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
    if (list.some((t) => /college|university|school|education|campus|academy/.test(t))) return "education";
    if (list.some((t) => /hospital|clinic|health|doctor|pharmacy|blood/.test(t))) return "hospital";
    if (list.some((t) => /station|railway|train|subway|metro/.test(t))) return "train";
    if (list.some((t) => /bus|transit|depot|terminal/.test(t))) return "bus";
    if (list.some((t) => /airport|aerodrome|airfield/.test(t))) return "airport";
    if (list.some((t) => /office|company|commercial|workplace|business|newspaper/.test(t))) return "workplace";
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
        case "residential":
            return "🏠";
        default:
            return "📍";
    }
};

/* ==========================================================================
   4. ADDRESS HIERARCHY & NORMALIZATION
   ========================================================================== */

export const isValidCoordinate = (item) => {
    const lat = Number(item?.latitude ?? item?.lat);
    const lon = Number(item?.longitude ?? item?.lon ?? item?.lng);
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
        source: raw.source || "Global Geocoder"
    };
};

/* ==========================================================================
   5. FAST MULTI-PROVIDER REVERSE GEOCODING
   ========================================================================== */

export const reverseGeocodeFast = async (lat, lon, signal) => {
    const key = `${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`;
    if (reverseCache.has(key)) return reverseCache.get(key);

    // 1. Nominatim reverse with short timeout
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2500);
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&addressdetails=1&accept-language=en`;
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
   6. DYNAMIC QUERY VARIANT GENERATOR
   ========================================================================== */

export const generateQueryVariants = (rawQuery) => {
    const clean = String(rawQuery || "").trim();
    if (!clean) return [];

    const variants = new Set();
    variants.add(clean);

    const unpunct = clean.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"+\[\]|\\]/g, " ").replace(/\s+/g, " ").trim();
    if (unpunct && unpunct !== clean) variants.add(unpunct);

    const words = unpunct.split(/\s+/).filter(Boolean);

    // Acronym dotted/spaced variations: "kln" -> "K. L. N."
    for (const w of words) {
        const low = w.toLowerCase();
        if (/^[a-zA-Z]{2,4}$/.test(w) && !STOP_WORDS.has(low) && !GENERIC_CATEGORY_WORDS.has(low)) {
            const spacedDotted = low.split("").join(". ") + ".";
            variants.add(clean.replace(new RegExp(`\\b${w}\\b`, "i"), spacedDotted.toUpperCase()));
            variants.add(clean.replace(new RegExp(`\\b${w}\\b`, "i"), spacedDotted.replace(/\s+/g, "").toUpperCase()));
        }
    }

    // Bidirectional abbreviations
    let expanded = clean;
    for (const [abbr, full] of Object.entries(ABBREVIATION_EXPANSIONS)) {
        const re = new RegExp(`\\b${abbr}\\b`, "gi");
        if (re.test(expanded)) {
            variants.add(expanded.replace(re, full));
        }
    }

    // Road / Office / Stop / Rd strip variant (e.g. "Theekathir Office Rd, Madurai" -> "Theekathir Madurai", "Theekathir")
    const withoutRd = unpunct.replace(/\b(office\s+)?(rd|road|street|st|ave|lane|junction|stop|stand|depot)\b/gi, " ").replace(/\s+/g, " ").trim();
    if (withoutRd && withoutRd !== unpunct) {
        variants.add(withoutRd);
    }

    // If query has 3+ words: generate (all words except last), and (first word + last word)
    if (words.length >= 3) {
        variants.add(words.slice(0, -1).join(" "));
        variants.add(`${words[0]} ${words[words.length - 1]}`);
        if (/^[a-zA-Z]{2,4}$/.test(words[0])) {
            const spacedFirst = words[0].split("").join(". ") + ".";
            variants.add(`${spacedFirst} ${words.slice(1, -1).join(" ")}`);
        }
    }

    // Distinctive entity alone (e.g. "Theekathir", "Velammal", "KLN", "Meenakshi")
    const distinctive = words.filter((w) => !STOP_WORDS.has(w.toLowerCase()) && !GENERIC_CATEGORY_WORDS.has(w.toLowerCase()));
    if (distinctive.length > 0) {
        const dStr = distinctive.join(" ");
        if (dStr !== clean && dStr !== unpunct) {
            variants.add(dStr);
        }
        if (distinctive.length > 1) {
            variants.add(distinctive[0]);
        }
    }

    return Array.from(variants).filter(Boolean);
};

/* ==========================================================================
   7. PROVIDER ADAPTERS
   ========================================================================== */

export const searchNominatim = async (query, signal) => {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query.trim())}&format=jsonv2&addressdetails=1&namedetails=1&limit=6&accept-language=en`;
        const res = await fetch(url, {
            headers: {
                Accept: "application/json",
                "User-Agent": "AITransportationManagement/6.0 (support@ai-trans.app)"
            },
            signal: signal || controller.signal
        });
        clearTimeout(timeout);
        if (!res.ok) return [];
        const data = await res.json();
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
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query.trim())}&limit=6&lang=en`;
        const res = await fetch(url, {
            headers: { Accept: "application/json" },
            signal: signal || controller.signal
        });
        clearTimeout(timeout);
        if (!res.ok) return [];
        const data = await res.json();
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
                importance: 0.6,
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
                        "User-Agent": "AITransportationManagement/6.0 (https://ai-trans.app; support@ai-trans.app)"
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
                "User-Agent": "AITransportationManagement/6.0 (https://ai-trans.app; support@ai-trans.app)"
            },
            signal
        });
        if (!cRes.ok) return [];
        const cData = await cRes.json();

        const results = [];
        for (const item of searchResults) {
            const entity = cData.entities?.[item.id];
            const p625 = entity?.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
            if (p625 && isValidCoordinate({ lat: p625.latitude, lon: p625.longitude })) {
                const name = item.label || clean;
                const lat = Number(p625.latitude);
                const lon = Number(p625.longitude);

                let rev = null;
                try {
                    rev = await reverseGeocodeFast(lat, lon, signal);
                } catch {
                    // ignore
                }

                const address = rev?.address || (item.description ? `${item.description}` : name);
                const formattedType = formatPlaceType(item.description || "institution", "landmark");

                results.push({
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
                });
            }
        }
        return results;
    } catch {
        return [];
    }
};

export const searchOpenMeteo = async (query, signal) => {
    try {
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query.trim())}&count=5&language=en&format=json`;
        const res = await fetch(url, { headers: { Accept: "application/json" }, signal });
        if (!res.ok) return [];
        const data = await res.json();
        if (!Array.isArray(data?.results)) return [];

        return data.results.map((r) => {
            const name = r.name || query;
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

/* ==========================================================================
   8. LOCATION-AWARE RELEVANCE RANKING & DEDUPLICATION
   ========================================================================== */

export const calculateRelevanceScore = (item, rawQuery) => {
    const normQuery = normalizeSearchText(rawQuery);
    const normName = normalizeSearchText(item.name);
    const normAddr = normalizeSearchText(item.address || item.displayName || "");

    let score = 0;
    const queryTokens = normQuery.split(" ").filter((t) => t.length > 0 && !STOP_WORDS.has(t));
    const distinctiveTokens = queryTokens.filter((t) => !GENERIC_CATEGORY_WORDS.has(t));

    // 1. Exact Name Match
    if (normName === normQuery) {
        score += 260;
    } else if (normName.startsWith(normQuery)) {
        score += 190;
    } else if (normName.includes(normQuery)) {
        score += 140;
    } else if (normQuery.includes(normName)) {
        score += 120;
    }

    // 2. Location-Aware Matching (e.g. "madurai", "chennai", "pottapalayam", "london")
    for (const token of queryTokens) {
        if (normAddr.includes(token)) {
            score += 80;
            const itemCity = normalizeSearchText(item.city);
            const itemDist = normalizeSearchText(item.district);
            const itemState = normalizeSearchText(item.state);
            const itemCountry = normalizeSearchText(item.country);
            if (itemCity.includes(token) || itemDist.includes(token)) {
                score += 130;
            } else if (itemState.includes(token) || itemCountry.includes(token)) {
                score += 60;
            }
        }
    }

    // 3. Distinctive Entity Token Matching
    let matchedDistinctive = 0;
    for (const dt of distinctiveTokens) {
        if (normName.includes(dt)) {
            matchedDistinctive++;
            score += 100;
        } else if (normAddr.includes(dt)) {
            matchedDistinctive++;
            score += 60;
        }
    }

    if (distinctiveTokens.length > 0 && matchedDistinctive === distinctiveTokens.length) {
        score += 130;
    } else if (distinctiveTokens.length > 0 && matchedDistinctive === 0) {
        score -= 100;
    }

    // 4. Category / Type Alignment
    for (const catToken of queryTokens.filter((t) => GENERIC_CATEGORY_WORDS.has(t))) {
        if (normName.includes(catToken)) {
            score += 30;
        } else if (normAddr.includes(catToken) || normalizeSearchText(item.type).includes(catToken)) {
            score += 20;
        }
    }

    // 5. Geocoder Importance
    if (item.importance) {
        score += Number(item.importance) * 30;
    }

    return score;
};

export const deduplicateAndRankResults = (candidates, rawQuery) => {
    const seen = new Map();
    const scored = [];

    for (const item of candidates) {
        if (!item || !item.name || !isValidCoordinate(item)) continue;

        const score = calculateRelevanceScore(item, rawQuery);
        const geoKey = `${Number(item.latitude).toFixed(3)}|${Number(item.longitude).toFixed(3)}`;

        if (seen.has(geoKey)) {
            const existing = seen.get(geoKey);
            if (score > existing._score) {
                existing.name = item.name;
                existing.displayName = item.displayName;
                existing.address = item.address;
                existing.type = item.type;
                existing._score = score;
            }
            continue;
        }

        const candidateScored = {
            ...item,
            _score: score
        };
        seen.set(geoKey, candidateScored);
        scored.push(candidateScored);
    }

    scored.sort((a, b) => b._score - a._score);

    const hasStrongMatch = scored.some((s) => s._score >= 100);
    const filtered = hasStrongMatch ? scored.filter((s) => s._score > 0) : scored;

    return filtered.slice(0, 10);
};

/* ==========================================================================
   9. ENTRY POINT: searchPlaces
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

    const variants = generateQueryVariants(clean);
    const candidates = [];
    let providerError = null;

    try {
        // Stage 1: Parallel search on non-rate-limited providers (Wikidata, Photon + variants, and 1 main Nominatim call)
        const fastPromises = [
            searchWikidata(clean, signal),
            searchPhoton(clean, signal),
            searchNominatim(clean, signal)
        ];

        for (const v of variants.slice(1)) {
            if (signal?.aborted) break;
            fastPromises.push(searchPhoton(v, signal));
        }

        const responses = await Promise.allSettled(fastPromises);
        for (const res of responses) {
            if (res.status === "fulfilled" && Array.isArray(res.value)) {
                candidates.push(...res.value);
            }
        }

        // Stage 2: If candidates empty OR candidates do not match all distinctive query tokens (e.g. location "Madurai")
        const normClean = normalizeSearchText(clean);
        const cleanTokens = normClean.split(" ").filter((t) => t.length > 0 && !STOP_WORDS.has(t));
        const distinctiveTokens = cleanTokens.filter((t) => !GENERIC_CATEGORY_WORDS.has(t));

        const hasFullMatch = candidates.some((c) => {
            const cNorm = normalizeSearchText(`${c.name} ${c.address} ${c.city} ${c.district} ${c.state}`);
            return distinctiveTokens.every((dt) => cNorm.includes(dt));
        });

        if (!hasFullMatch && variants.length > 1) {
            const fallbackVariants = [...variants.slice(1)].reverse();
            for (const v of fallbackVariants) {
                if (signal?.aborted) break;
                const nomRes = await searchNominatim(v, signal);
                if (Array.isArray(nomRes) && nomRes.length > 0) {
                    candidates.push(...nomRes);
                    const nowHasMatch = candidates.some((c) => {
                        const cNorm = normalizeSearchText(`${c.name} ${c.address} ${c.city} ${c.district} ${c.state}`);
                        return distinctiveTokens.every((dt) => cNorm.includes(dt));
                    });
                    if (nowHasMatch) break;
                }
            }
        }

        // Stage 3: If still empty, try Open-Meteo
        if (candidates.length === 0) {
            try {
                const meteo = await searchOpenMeteo(clean, signal);
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

    const ranked = deduplicateAndRankResults(candidates, clean);

    if (ranked.length > 0) {
        if (searchCache.size >= MAX_CACHE_SIZE) {
            const oldestKey = searchCache.keys().next().value;
            searchCache.delete(oldestKey);
        }
        searchCache.set(cacheKey, ranked);
    }

    const hasError = candidates.length === 0 && Boolean(providerError);

    return {
        success: ranked.length > 0,
        results: ranked,
        provider: "GLOBAL SEARCH",
        hasError,
        errorType: hasError ? "GEOCODING_SERVICE_UNAVAILABLE" : ranked.length === 0 ? "NO_RESULTS" : null,
        message: ranked.length > 0
            ? ""
            : hasError
            ? "Location search service is temporarily unavailable. Please try again."
            : `No locations found for "${clean}". Try adding a city, district, or country.`
    };
};

export const getPlaceDetails = async () => null;

export default {
    searchPlaces,
    getPlaceDetails,
    reverseGeocode,
    reverseGeocodeFast,
    normalizeSearchText,
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
    deduplicateAndRankResults
};