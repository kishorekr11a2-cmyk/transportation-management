const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.goto('http://localhost:5173/admin-login', { waitUntil: 'networkidle' });
  await page.fill('#admin-userId', 'admin');
  await page.fill('input[name="password"]', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);

  await page.goto('http://localhost:5173/users', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Capture option 1 (current)
  await page.screenshot({ path: 'scratch/opt1_desktop.png' });

  // Test option 2: full page ambient background
  await page.addStyleTag({
    content: `
      .user-hero-bg-container {
        height: 100% !important;
      }
      .user-hero-bg-container::after {
        background: linear-gradient(180deg, rgba(240, 247, 250, 0.05) 0%, rgba(240, 247, 250, 0.25) 300px, rgba(240, 247, 250, 0.75) 600px, rgba(240, 247, 250, 0.92) 100%) !important;
      }
      .user-hero-illustration {
        -webkit-mask-image: none !important;
        mask-image: none !important;
        opacity: 0.88 !important;
      }
      .user-table-card {
        background: rgba(255, 255, 255, 0.95) !important;
        backdrop-filter: blur(12px) !important;
      }
    `
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'scratch/opt2_desktop.png' });

  await page.setViewportSize({ width: 425, height: 900 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'scratch/opt2_mobile.png' });

  await browser.close();
  console.log('Done testing options!');
})();
