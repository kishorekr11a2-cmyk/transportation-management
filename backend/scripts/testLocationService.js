import { searchPlaces } from '../../frontend/src/services/locationSearchService.js';

async function run() {
  const queries = [
    "Keelavasal, Madurai",
    "moonandipatti, madurai",
    "Moonandipatti Madurai",
    "keelavasal madurai",
    "Teppakulam, Madurai",
    "Vandiyur, Madurai",
    "Thirunagar, Madurai",
    "Othakadai, Madurai",
    "Alangulam, Madurai",
    "xyz99887766randomlocation123"
  ];

  for (const q of queries) {
    console.log(`\n=== QUERY: "${q}" ===`);
    try {
      const res = await searchPlaces(q);
      console.log(`Success: ${res.success}, Results: ${res.results?.length || 0}`);
      if (res.emptyMessage) console.log(`EmptyMessage: ${res.emptyMessage}`);
      if (res.message) console.log(`Message: ${res.message}`);
      if (res.results && res.results.length > 0) {
        console.log(`Top result:`, {
          name: res.results[0].name,
          displayName: res.results[0].displayName,
          address: res.results[0].address,
          city: res.results[0].city,
          district: res.results[0].district,
          state: res.results[0].state,
          lat: res.results[0].latitude,
          lon: res.results[0].longitude,
          score: res.results[0]._score
        });
      }
    } catch (e) {
      console.error(`Error for "${q}":`, e);
    }
  }
}

run();
