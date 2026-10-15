const { chromium } = require('playwright');
const path = require('path');

(async () => {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  try {
    console.log('Logging in as admin at /admin-login...');
    await page.goto('http://localhost:5173/admin-login', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.fill('#admin-userId', 'admin');
    await page.fill('input[name="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);

    console.log('Navigating to /users...');
    await page.goto('http://localhost:5173/users', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);

    const outPath = path.join(__dirname, '..', 'current_user_management_real.png');
    await page.screenshot({ path: outPath, fullPage: true });
    console.log('Captured screenshot to:', outPath);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
})();
