const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  
  try {
    console.log('Logging in...');
    await page.goto('http://localhost:5173/admin-login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    await page.fill('#admin-userId', 'admin');
    await page.fill('input[name="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1000);

    const checkPage = async (url, label) => {
      console.log(`\nNavigating to ${label}: ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.selected-plan-card', { timeout: 40000 });
      await page.waitForTimeout(500);

      const title = await page.evaluate(() => document.querySelector('.selected-card-title')?.textContent?.trim());
      const badge = await page.evaluate(() => document.querySelector('.plan-status-badge')?.textContent?.trim() || 'NO BADGE');
      const metrics = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('.plan-metric-row'));
        const obj = {};
        rows.forEach(r => {
          const l = r.querySelector('.metric-label')?.textContent?.trim();
          const v = r.querySelector('.metric-value')?.textContent?.trim();
          if (l) obj[l] = v;
        });
        return obj;
      });
      console.log(`${label} Result:`, JSON.stringify({ title, badge, metrics }, null, 2));
      return { title, badge, metrics };
    };

    // 1. Inward Manual Plan (Unsubmitted)
    const inMan = await checkPage('http://localhost:5173/admin/plan-confirmation?direction=INWARD&type=ADMIN', 'INWARD MANUAL');
    if (inMan.metrics['Allocated'] !== 'Not Approved') {
      throw new Error(`Inward Manual Expected "Not Approved", got "${inMan.metrics['Allocated']}"`);
    }
    if (inMan.badge !== 'NO BADGE') {
      throw new Error(`Inward Manual Expected NO BADGE, got "${inMan.badge}"`);
    }

    // 2. Inward AI Plan (No generated inward AI plan)
    const inAi = await checkPage('http://localhost:5173/admin/plan-confirmation?direction=INWARD&type=AI', 'INWARD AI');
    if (inAi.metrics['Allocated'] !== 'Not Allocated') {
      throw new Error(`Inward AI Expected "Not Allocated", got "${inAi.metrics['Allocated']}"`);
    }
    if (inAi.badge !== 'NO BADGE') {
      throw new Error(`Inward AI Expected NO BADGE, got "${inAi.badge}"`);
    }

    // 3. Outward Manual Plan (Active / Approved)
    const outMan = await checkPage('http://localhost:5173/admin/plan-confirmation?direction=OUTWARD&type=ADMIN', 'OUTWARD MANUAL');
    if (!outMan.metrics['Allocated']?.includes('422')) {
      throw new Error(`Outward Manual Expected active allocation, got "${outMan.metrics['Allocated']}"`);
    }
    if (!outMan.badge?.includes('ACTIVE')) {
      throw new Error(`Outward Manual Expected ACTIVE badge, got "${outMan.badge}"`);
    }

    // 4. Direction toggle check: Go back to Inward Manual and verify it is STILL Not Approved
    const inManAgain = await checkPage('http://localhost:5173/admin/plan-confirmation?direction=INWARD&type=ADMIN', 'INWARD MANUAL (RE-CHECK)');
    if (inManAgain.metrics['Allocated'] !== 'Not Approved') {
      throw new Error(`Inward Manual Re-check Expected "Not Approved", got "${inManAgain.metrics['Allocated']}"`);
    }
    if (inManAgain.badge !== 'NO BADGE') {
      throw new Error(`Inward Manual Re-check Expected NO BADGE, got "${inManAgain.badge}"`);
    }

    console.log('\n=======================================');
    console.log('ALL STATUS VERIFICATIONS PASSED 100%!');
    console.log('=======================================');
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
