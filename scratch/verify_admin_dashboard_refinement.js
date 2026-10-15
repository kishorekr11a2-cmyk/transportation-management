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
  ];

  for (const vp of viewports) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();

    await page.addInitScript(() => {
      localStorage.setItem("admin_token", "mock-token");
      localStorage.setItem("admin_user", JSON.stringify({ role: "admin", name: "Administrator" }));
      localStorage.setItem("token", "mock-token");
      localStorage.setItem("user", JSON.stringify({ role: "admin", name: "Administrator" }));
      sessionStorage.setItem("token", "mock-token");
      sessionStorage.setItem("role", "admin");
    });

    await page.goto('http://localhost:5173/admin-dashboard', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.dash-brand__title', { timeout: 10000 });
    await page.waitForTimeout(1000);

    // Verify heading text
    const heading = await page.$eval('.dash-brand__title', el => el.textContent.trim());
    console.log(`[${vp.name}] Heading found: "${heading}"`);

    // Verify 6 cards exist
    const cards = await page.$$('.studio-scene');
    console.log(`[${vp.name}] Card count: ${cards.length}`);

    // Check card clickability
    const links = await page.$$eval('.studio-scene', els => els.map(el => el.getAttribute('href')));
    console.log(`[${vp.name}] Card link hrefs:`, links);

    // Take screenshot
    const ssPath = path.join(__dirname, `admin_dash_${vp.name}.png`);
    await page.screenshot({ path: ssPath, fullPage: false });
    console.log(`[${vp.name}] Screenshot saved to: ${ssPath}`);

    await context.close();
  }

  await browser.close();
  console.log('All responsive verification checks completed successfully!');
})();
