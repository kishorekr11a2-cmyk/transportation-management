const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  
  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
  page.on('response', res => {
    if (res.url().includes('/api/')) {
      console.log('API RESPONSE:', res.status(), res.url());
    }
  });

  try {
    await page.goto('http://localhost:5173/admin-login', { waitUntil: 'domcontentloaded' });
    await page.fill('#admin-userId', 'admin');
    await page.fill('input[name="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1000);
    await page.goto('http://localhost:5173/routes', { waitUntil: 'domcontentloaded' });
    await page.waitForResponse(res => res.url().includes('/api/routes') && res.status() === 200, { timeout: 20000 });
    await page.waitForTimeout(2000);
    
    await page.evaluate(() => {
      window.scrollTo(0, 750);
    });
    await page.waitForTimeout(1000);

    await page.screenshot({ path: path.join(__dirname, 'diag_outward_routes.png'), fullPage: false });
    console.log('Captured diag Outward screenshot');

    // Scroll to North route (V1)
    await page.evaluate(() => {
      window.scrollTo(0, 1800);
    });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(__dirname, 'diag_outward_v1.png'), fullPage: false });
    console.log('Captured diag Outward V1 screenshot');

    const inwardTab = await page.$('button.dir-filter-tab:has-text("INWARD")');
    if (inwardTab) {
      await inwardTab.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(__dirname, 'diag_inward_routes.png'), fullPage: false });
      console.log('Captured diag Inward screenshot');
    }
  } catch (err) {
    console.error(err);
  } finally {
    await browser.close();
  }
})();
