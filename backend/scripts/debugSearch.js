import { searchNominatim, searchPhoton, searchBackend, searchWikidata, parseSearchQuery, calculateRelevanceScore } from '../../frontend/src/services/locationSearchService.js';

async function testDebug() {
  for (const q of ["Keelavasal, Madurai", "Moonandipatti, Madurai"]) {
    console.log(`\n=================== ${q} ===================`);
    const parsed = parseSearchQuery(q);
    console.log("Parsed:", parsed);

    const nom = await searchNominatim(q);
    console.log("searchNominatim(q) count:", nom.length);

    const phot = await searchPhoton(q);
    console.log("searchPhoton(q) count:", phot.length, phot.map(p => ({ name: p.name, city: p.city, district: p.district, address: p.address, lat: p.latitude, lon: p.longitude })));

    const backend = await searchBackend(q);
    console.log("searchBackend(q) count:", backend.length, JSON.stringify(backend, null, 2));

    // Also check what variants are searched
    const placeWithCityComma = `${parsed.placeName}, ${parsed.requestedCity}`;
    const placeWithCitySpace = `${parsed.placeName} ${parsed.requestedCity}`;
    console.log("placeWithCityComma:", placeWithCityComma);
    console.log("placeWithCitySpace:", placeWithCitySpace);

    const photSpace = await searchPhoton(placeWithCitySpace);
    console.log("searchPhoton(placeWithCitySpace) count:", photSpace.length, photSpace.map(p => ({ name: p.name, city: p.city, district: p.district, address: p.address, lat: p.latitude, lon: p.longitude })));

    // Score these photon items
    for (const item of photSpace) {
      const score = calculateRelevanceScore(item, q, parsed);
      console.log(`Candidate ${item.name} (${item.address}): score=${score}, isRequestedCityMatch=${item._isRequestedCityMatch}, isDifferentCity=${item._isDifferentCity}`);
    }
  }
}

testDebug();
