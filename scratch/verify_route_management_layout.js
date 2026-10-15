const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  
  const viewports = [
    { name: '1920x1080_desktop', width: 1920, height: 1080 },
    { name: '1366x768_laptop', width: 1366, height: 768 },
    { name: '1024px_tablet', width: 1024, height: 768 },
    { name: '768px_tablet', width: 768, height: 1024 },
    { name: '430px_mobile', width: 430, height: 932 },
    { name: '375px_mobile', width: 375, height: 812 },
    { name: '320px_mobile', width: 320, height: 568 },
  ];

  for (const vp of viewports) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();

    // Login as admin
    await page.goto('http://localhost:5173/admin-login', { waitUntil: 'networkidle' });
    await page.fill('#admin-userId', 'admin');
    await page.fill('input[name="password"]', 'admin123');
    await page.click('button[type="submit"]');
    
    // Navigate to /routes
    await page.waitForSelector('.dash-brand__title', { timeout: 15000 });
    await page.goto('http://localhost:5173/routes', { waitUntil: 'networkidle' });

    // Wait for route layout and map to initialize
    await page.waitForSelector('.route-layout', { timeout: 15000 });
    await page.waitForSelector('.map-section', { timeout: 15000 });
    await page.waitForSelector('.route-panel', { timeout: 15000 });
    await page.waitForSelector('.saved-routes-fullwidth', { timeout: 15000 });
    await page.waitForTimeout(2000);

    // Measure bounding boxes
    const mapBox = await page.$eval('.map-section', el => {
      const rect = el.getBoundingClientRect();
      return { width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom };
    });

    const panelBox = await page.$eval('.route-panel', el => {
      const rect = el.getBoundingClientRect();
      return { width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom };
    });

    const layoutBox = await page.$eval('.route-layout', el => {
      const rect = el.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });

    const savedRoutesBox = await page.$eval('.saved-routes-fullwidth', el => {
      const rect = el.getBoundingClientRect();
      return { width: rect.width, height: rect.height, top: rect.top };
    });

    console.log(`\n=================== [${vp.name}] ===================`);
    console.log(`Layout total width: ${layoutBox.width.toFixed(1)}px, height: ${layoutBox.height.toFixed(1)}px`);
    console.log(`Map: ${mapBox.width.toFixed(1)}px x ${mapBox.height.toFixed(1)}px (Top: ${mapBox.top.toFixed(1)}px, ${(mapBox.width / layoutBox.width * 100).toFixed(1)}% width)`);
    console.log(`Panel: ${panelBox.width.toFixed(1)}px x ${panelBox.height.toFixed(1)}px (Top: ${panelBox.top.toFixed(1)}px, ${(panelBox.width / layoutBox.width * 100).toFixed(1)}% width)`);
    console.log(`Saved Routes width: ${savedRoutesBox.width.toFixed(1)}px (Top: ${savedRoutesBox.top.toFixed(1)}px)`);

    // Verify Equal heights on desktop
    if (vp.width >= 1200) {
      const heightDiff = Math.abs(mapBox.height - panelBox.height);
      console.log(`Desktop equal height check: Diff is ${heightDiff.toFixed(1)}px -> ${heightDiff <= 2 ? "PASSED (EQUAL)" : "FAILED"}`);
      const mapWidthRatio = mapBox.width / layoutBox.width;
      console.log(`Desktop ~65% map width check: ${(mapWidthRatio * 100).toFixed(1)}% -> ${mapWidthRatio >= 0.60 && mapWidthRatio <= 0.70 ? "PASSED" : "NOTICE"}`);
    }

    // Verify Saved routes is below both panels
    const isBelow = savedRoutesBox.top >= mapBox.bottom - 5;
    console.log(`Saved routes below panels check: ${isBelow ? "PASSED (BELOW)" : "FAILED"}`);

    // Verify direction radios: OUTWARD, INWARD, BOTH
    const radios = await page.$$eval('input[name="routeDirection"]', els => els.map(e => e.value));
    console.log(`Direction radio values:`, radios);

    // Verify bus allocation select
    const busOptions = await page.$$eval('select option', els => els.length);
    console.log(`Bus allocation options count:`, busOptions);

    // Take screenshot
    const ssPath = path.join(__dirname, `route_management_${vp.name}.png`);
    await page.screenshot({ path: ssPath, fullPage: true });
    console.log(`Screenshot saved to: ${ssPath}`);

    await context.close();
  }

  await browser.close();
  console.log('\nAll Route Management layout verification checks completed!');
})();
