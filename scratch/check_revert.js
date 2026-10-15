const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  try {
    await page.goto('http://localhost:5173/admin-login', { waitUntil: 'networkidle' });
    await page.fill('#admin-userId', 'admin');
    await page.fill('input[name="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1000);
    await page.goto('http://localhost:5173/routes', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    
    // Scroll right pane down to reveal the Route Management card
    await page.evaluate(() => {
      const rightPane = document.querySelector('.route-controls-panel') || window;
      rightPane.scrollTo ? rightPane.scrollTo(0, 1200) : window.scrollTo(0, 1200);
    });
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(__dirname, 'route_reverted_view_scrolled.png'), fullPage: false });
    console.log('SUCCESS');
  } catch (err) {
    console.error(err);
  } finally {
    await browser.close();
  }
})();
