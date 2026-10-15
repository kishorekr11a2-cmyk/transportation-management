const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  try {
    await page.goto('http://localhost:5173/admin-login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    await page.fill('#admin-userId', 'admin');
    await page.fill('input[name="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1000);
    await page.goto('http://localhost:5173/admin/plan-confirmation?direction=INWARD&type=ADMIN', { waitUntil: 'domcontentloaded' });
    
    console.log('Waiting for .selected-plan-card...');
    await page.waitForSelector('.selected-plan-card', { timeout: 35000 });
    console.log('Found .selected-plan-card!');
    await page.waitForTimeout(1000);

    const values = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('.plan-metric-row'));
        return rows.map(r => ({
            label: r.querySelector('.metric-label')?.textContent?.trim(),
            value: r.querySelector('.metric-value')?.textContent?.trim()
        }));
    });
    console.log('METRIC ROWS:', JSON.stringify(values, null, 2));

    const badge = await page.evaluate(() => {
        return document.querySelector('.plan-status-badge')?.textContent?.trim() || 'NO BADGE';
    });
    console.log('STATUS BADGE:', badge);

    const screenshotPath = path.join(__dirname, 'inward_manual_current.png');
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log('SUCCESS screenshot saved to', screenshotPath);
  } catch (err) {
    console.error(err);
  } finally {
    await browser.close();
  }
})();
