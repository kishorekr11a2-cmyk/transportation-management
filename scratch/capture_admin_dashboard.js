const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto('http://localhost:5173/admin-login', { waitUntil: 'networkidle' });
  await page.fill('#admin-userId', 'admin');
  await page.fill('input[name="password"]', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'scratch/live_admin_dashboard.png' });
  await browser.close();
  console.log('Captured live admin dashboard!');
})();
