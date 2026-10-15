const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto('http://localhost:5173/admin-login', { waitUntil: 'networkidle' });
    await page.fill('#admin-userId', 'admin');
    await page.fill('input[name="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1000);

    await page.goto('http://localhost:5173/ai-agent', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const overlayInfo = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('*'))
        .filter(el => {
          const s = window.getComputedStyle(el);
          return (s.position === 'fixed' || s.position === 'absolute') && parseInt(s.zIndex || '0', 10) >= 1000;
        })
        .map(el => ({
          tag: el.tagName,
          id: el.id,
          className: el.className,
          zIndex: window.getComputedStyle(el).zIndex,
          outerHTML: el.outerHTML.substring(0, 150)
        }));
    });
    console.log('Fixed/Absolute elements with zIndex >= 1000:', overlayInfo);
  } catch (err) {
    console.error(err);
  } finally {
    await browser.close();
  }
})();
