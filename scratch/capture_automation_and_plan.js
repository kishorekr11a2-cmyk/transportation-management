const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Login
  await page.goto('http://localhost:5173/admin-login', { waitUntil: 'networkidle' });
  await page.fill('#admin-userId', 'admin');
  await page.fill('input[name="password"]', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);

  // Navigate to Automation
  await page.goto('http://localhost:5173/automation', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'scratch/live_automation.png' });
  console.log('Captured scratch/live_automation.png');

  // Navigate to Plan Confirmation
  await page.goto('http://localhost:5173/plan-confirmation', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'scratch/live_plan_confirmation.png' });
  console.log('Captured scratch/live_plan_confirmation.png');

  await browser.close();
})();
