import https from 'https';

async function queryOverpass(q) {
  const query = `[out:json][timeout:15];
  (
    node["name"~"${q}",i](9.7,78.0,10.2,78.3);
    way["name"~"${q}",i](9.7,78.0,10.2,78.3);
  );
  out center 5;`;
  
  return new Promise(resolve => {
    const postData = 'data=' + encodeURIComponent(query);
    const req = https.request('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'AITransportationManagement/6.0'
      }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch(e) { resolve({ error: e.message, d }); }
      });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.write(postData);
    req.end();
  });
}

async function run() {
  console.log('Overpass Keelavasal:');
  const res1 = await queryOverpass('Keelavasal');
  console.log(JSON.stringify(res1.elements || res1, null, 2));

  console.log('Overpass Moonandipatti:');
  const res2 = await queryOverpass('Moonandipatti');
  console.log(JSON.stringify(res2.elements || res2, null, 2));

  console.log('Overpass Keezhavasal:');
  const res3 = await queryOverpass('Keezhavasal');
  console.log(JSON.stringify(res3.elements || res3, null, 2));
}

run();
