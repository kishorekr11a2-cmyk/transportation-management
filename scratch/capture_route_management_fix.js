const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  try {
    await page.goto('http://localhost:5173/admin-login', { waitUntil: 'domcontentloaded' });
    await page.fill('#admin-userId', 'admin');
    await page.fill('input[name="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1000);
    await page.goto('http://localhost:5173/routes', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.saved-route', { timeout: 15000 });
    await page.waitForTimeout(1000);
    
    // Scroll window down to reveal the Route Management saved routes section
    await page.evaluate(() => {
      window.scrollTo(0, 750);
    });
    await page.waitForTimeout(1000);

    // Capture Outward view
    await page.screenshot({ path: path.join(__dirname, 'fix_outward_routes.png'), fullPage: false });
    console.log('Captured Outward view');

    // Click on INWARD tab
    const inwardTab = await page.$('button.dir-filter-tab:has-text("INWARD")');
    if (inwardTab) {
      await inwardTab.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(__dirname, 'fix_inward_routes.png'), fullPage: false });
      console.log('Captured Inward view');
    }

    console.log('SUCCESS');
  } catch (err) {
    console.error(err);
  } finally {
    await browser.close();
  }
})();
