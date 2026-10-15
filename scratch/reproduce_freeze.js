const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto('http://localhost:5173/admin-login', { waitUntil: 'domcontentloaded' });
    await page.fill('#admin-userId', 'admin');
    await page.fill('input[name="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1000);

    await page.goto('http://localhost:5173/ai-agent', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    console.log('1. Page loaded. Generating AI route...');
    // Click Generate AI Route
    const genBtn = await page.$('button:has-text("Generate AI Route")');
    if (!genBtn) {
      console.log('Generate AI Route button not found');
      return;
    }
    await genBtn.click();
    console.log('Clicked Generate AI Route. Waiting for plan to generate...');

    // Wait until btn-view-generated-route appears (timeout 60s)
    await page.waitForSelector('#btn-view-generated-route', { timeout: 60000 });
    console.log('Plan generated successfully! Found #btn-view-generated-route.');

    const initialOverflow = await page.evaluate(() => document.body.style.overflow);
    console.log('Initial document.body.style.overflow:', JSON.stringify(initialOverflow));

    // Click "View Generated Route"
    await page.click('#btn-view-generated-route');
    await page.waitForTimeout(600);

    const modalOverflow = await page.evaluate(() => document.body.style.overflow);
    console.log('While SelectRouteModal is OPEN, document.body.style.overflow:', JSON.stringify(modalOverflow));

    // Confirm selection
    console.log('Selecting route and clicking View on Map / confirm...');
    const confirmBtn = await page.$('.select-route-modal-card button.btn-confirm-select, .select-route-modal-card button:has-text("View on Map"), .select-route-modal-card button.primary-btn');
    if (confirmBtn) {
      await confirmBtn.click();
    } else {
      await page.click('.select-route-modal-card button:last-child');
    }

    await page.waitForTimeout(2500);
    console.log('Current URL in Route Management:', page.url());

    const rmOverflow = await page.evaluate(() => document.body.style.overflow);
    console.log('In Route Management, document.body.style.overflow:', JSON.stringify(rmOverflow));

    const rmScrollResult = await page.evaluate(() => {
      const start = window.scrollY;
      window.scrollTo(0, 400);
      const end = window.scrollY;
      return { start, end, scrollHeight: document.body.scrollHeight, innerHeight: window.innerHeight };
    });
    console.log('Route Management scroll result:', rmScrollResult);

    // Click Back to return to AI Route Optimization
    console.log('Clicking Back button in Route Management...');
    await page.click('.route-back-btn');
    await page.waitForTimeout(2000);

    console.log('Current URL after Back:', page.url());
    // If it went to admin-dashboard, let's also test navigating to /ai-agent or history back
    if (page.url().includes('admin-dashboard')) {
      console.log('Route Management back button navigated to /admin-dashboard. Going back into /ai-agent...');
      await page.goto('http://localhost:5173/ai-agent', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
    }

    const aiBackOverflow = await page.evaluate(() => document.body.style.overflow);
    console.log('Back in AI Agent, document.body.style.overflow:', JSON.stringify(aiBackOverflow));

    const aiScrollResult = await page.evaluate(() => {
      const start = window.scrollY;
      window.scrollTo(0, 400);
      const end = window.scrollY;
      return { start, end, scrollHeight: document.body.scrollHeight, innerHeight: window.innerHeight };
    });
    console.log('AI Agent scroll result:', aiScrollResult);

    // Also test browser back (History Back from Route Management to AI Agent)
    console.log('Testing History Back flow...');
    await page.goto('http://localhost:5173/ai-agent', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    await page.click('#btn-view-generated-route');
    await page.waitForTimeout(500);
    const cBtn = await page.$('.select-route-modal-card button.btn-confirm-select, .select-route-modal-card button:has-text("View on Map"), .select-route-modal-card button.primary-btn');
    if (cBtn) await cBtn.click();
    await page.waitForTimeout(2000);
    console.log('In Route Management via modal. Now pressing browser Back...');
    await page.goBack();
    await page.waitForTimeout(2000);
    console.log('URL after browser Back:', page.url());

    const historyBackOverflow = await page.evaluate(() => document.body.style.overflow);
    console.log('After history back, document.body.style.overflow:', JSON.stringify(historyBackOverflow));

    const historyBackScroll = await page.evaluate(() => {
      const start = window.scrollY;
      window.scrollTo(0, 400);
      const end = window.scrollY;
      return { start, end, scrollHeight: document.body.scrollHeight, innerHeight: window.innerHeight };
    });
    console.log('After history back, AI Agent scroll result:', historyBackScroll);

    // Check if any invisible overlays remain
    const activeModals = await page.evaluate(() => {
      const overlays = Array.from(document.querySelectorAll('.ai-modal-overlay, .select-route-modal-card, [class*="modal-overlay"]'));
      return overlays.map(o => ({
        className: o.className,
        display: window.getComputedStyle(o).display,
        visibility: window.getComputedStyle(o).visibility,
        opacity: window.getComputedStyle(o).opacity,
        zIndex: window.getComputedStyle(o).zIndex
      }));
    });
    console.log('Active modal overlays in DOM after history back:', activeModals);

  } catch (err) {
    console.error('Test error:', err);
  } finally {
    await browser.close();
  }
})();
