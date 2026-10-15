const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  
  try {
    // 1. Log in
    console.log('Logging in as admin...');
    await page.goto('http://localhost:5173/admin-login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    await page.fill('#admin-userId', 'admin');
    await page.fill('input[name="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1000);

    const getCardState = async () => {
      await page.waitForSelector('.selected-plan-card', { timeout: 40000 });
      await page.waitForTimeout(500);
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
      const badge = await page.evaluate(() => {
        return document.querySelector('.plan-status-badge')?.textContent?.trim() || 'NO BADGE';
      });
      const title = await page.evaluate(() => {
        return document.querySelector('.selected-card-title')?.textContent?.trim() || '';
      });
      return { title, metrics, badge };
    };

    // SCENARIO 1: Inward · Manual Plan — No inward submission
    console.log('\n--- SCENARIO 1: Inward · Manual Plan (No inward submission) ---');
    await page.goto('http://localhost:5173/admin/plan-confirmation?direction=INWARD&type=ADMIN', { waitUntil: 'domcontentloaded' });
    const s1 = await getCardState();
    console.log('Scenario 1 State:', JSON.stringify(s1, null, 2));
    if (s1.metrics['Allocated'] !== 'Not Approved') {
      throw new Error(`Scenario 1 Failed: Expected Allocated to be "Not Approved", got "${s1.metrics['Allocated']}"`);
    }
    if (s1.badge !== 'NO BADGE') {
      throw new Error(`Scenario 1 Failed: Expected NO BADGE, got "${s1.badge}"`);
    }
    if (s1.metrics['Students'] !== '422') {
      throw new Error(`Scenario 1 Failed: Expected Students to be "422", got "${s1.metrics['Students']}"`);
    }
    if (s1.metrics['Routes'] !== '9' || s1.metrics['Vehicles'] !== '9' || s1.metrics['Seats'] !== '475') {
      throw new Error(`Scenario 1 Failed: Routes/Vehicles/Seats data changed unexpectedly!`);
    }
    console.log('✓ SCENARIO 1 PASSED: Students: 422, Routes: 9, Vehicles: 9, Seats: 475, Allocated: "Not Approved", No badge.');

    // SCENARIO 2: Inward · AI Plan — No generated inward plan
    console.log('\n--- SCENARIO 2: Inward · AI Plan (No generated inward AI plan) ---');
    await page.goto('http://localhost:5173/admin/plan-confirmation?direction=INWARD&type=AI', { waitUntil: 'domcontentloaded' });
    const s2 = await getCardState();
    console.log('Scenario 2 State:', JSON.stringify(s2, null, 2));
    if (s2.metrics['Allocated'] !== 'Not Allocated') {
      throw new Error(`Scenario 2 Failed: Expected Allocated to be "Not Allocated", got "${s2.metrics['Allocated']}"`);
    }
    if (s2.badge !== 'NO BADGE') {
      throw new Error(`Scenario 2 Failed: Expected NO BADGE, got "${s2.badge}"`);
    }
    console.log('✓ SCENARIO 2 PASSED: Preserved existing behavior displaying "Not Allocated", no badge.');

    // Extract auth token
    const token = await page.evaluate(() => localStorage.getItem('token') || localStorage.getItem('admin_token'));

    // SCENARIO 3: Submit Outward Manual Plan & Approve it -> Verify Outward is ACTIVE, Inward remains Not Approved
    console.log('\n--- SCENARIO 3: Outward Manual Plan submitted & approved ---');
    const cOut = await page.request.post('http://localhost:5000/api/routes/confirm-plan', {
      headers: { 'Authorization': `Bearer ${token}` },
      data: { direction: 'OUTWARD' },
      timeout: 90000
    });
    console.log('Confirm Outward HTTP status:', cOut.status());

    const aOut = await page.request.post('http://localhost:5000/api/routes/approve-plan', {
      headers: { 'Authorization': `Bearer ${token}` },
      data: { direction: 'OUTWARD' },
      timeout: 90000
    });
    console.log('Approve Outward HTTP status:', aOut.status());

    // Verify Outward state is active
    await page.goto('http://localhost:5173/admin/plan-confirmation?direction=OUTWARD&type=ADMIN', { waitUntil: 'domcontentloaded' });
    const s3Out = await getCardState();
    console.log('Outward Manual State:', JSON.stringify(s3Out, null, 2));
    if (!s3Out.metrics['Allocated']?.includes('422')) {
      throw new Error(`Scenario 3 Failed: Expected Outward Allocated to be "422 / 422", got "${s3Out.metrics['Allocated']}"`);
    }
    if (!s3Out.badge?.includes('ACTIVE')) {
      throw new Error(`Scenario 3 Failed: Expected Outward badge to be ACTIVE, got "${s3Out.badge}"`);
    }
    console.log('✓ Outward is successfully active with allocation and ACTIVE badge.');

    // SCENARIO 4: Check Inward again while Outward is active -> Inward MUST STILL BE "Not Approved"!
    console.log('\n--- SCENARIO 4: Direction independence — Inward Manual with Outward Active ---');
    await page.goto('http://localhost:5173/admin/plan-confirmation?direction=INWARD&type=ADMIN', { waitUntil: 'domcontentloaded' });
    const s4In = await getCardState();
    console.log('Inward State while Outward is active:', JSON.stringify(s4In, null, 2));
    if (s4In.metrics['Allocated'] !== 'Not Approved') {
      throw new Error(`Scenario 4 Failed: Inward Allocated must be "Not Approved", got "${s4In.metrics['Allocated']}"`);
    }
    if (s4In.badge !== 'NO BADGE') {
      throw new Error(`Scenario 4 Failed: Inward must have NO BADGE, got "${s4In.badge}"`);
    }
    console.log('✓ SCENARIO 4 PASSED: Outward active plan did NOT leak into Inward! Inward remains "Not Approved" with NO BADGE.');

    // SCENARIO 5: Submit Inward Manual Plan -> Displays "Pending Approval"
    console.log('\n--- SCENARIO 5: Inward Manual Plan submitted -> "Pending Approval" ---');
    const cIn = await page.request.post('http://localhost:5000/api/routes/confirm-plan', {
      headers: { 'Authorization': `Bearer ${token}` },
      data: { direction: 'INWARD' },
      timeout: 90000
    });
    console.log('Confirm Inward HTTP status:', cIn.status());

    await page.goto('http://localhost:5173/admin/plan-confirmation?direction=INWARD&type=ADMIN', { waitUntil: 'domcontentloaded' });
    const s5In = await getCardState();
    console.log('Inward State after submission:', JSON.stringify(s5In, null, 2));
    if (s5In.metrics['Allocated'] !== 'Pending Approval') {
      throw new Error(`Scenario 5 Failed: Expected Inward Allocated to be "Pending Approval", got "${s5In.metrics['Allocated']}"`);
    }
    if (!s5In.badge?.includes('PENDING APPROVAL')) {
      throw new Error(`Scenario 5 Failed: Expected PENDING APPROVAL badge, got "${s5In.badge}"`);
    }
    console.log('✓ SCENARIO 5 PASSED: Submitted Inward Manual displays "Pending Approval" and PENDING APPROVAL badge.');

    // CLEANUP: Reset Inward manual plan so DB is clean (no inward submission)
    console.log('\n--- CLEANUP: Reset Inward manual plan ---');
    await page.request.post('http://localhost:5000/api/routes/reset-manual-plan', {
      headers: { 'Authorization': `Bearer ${token}` },
      data: { direction: 'INWARD' },
      timeout: 90000
    });

    // Final verification that Inward is back to Not Approved
    await page.goto('http://localhost:5173/admin/plan-confirmation?direction=INWARD&type=ADMIN', { waitUntil: 'domcontentloaded' });
    const finalIn = await getCardState();
    console.log('Final Post-Cleanup Inward State:', JSON.stringify(finalIn, null, 2));
    if (finalIn.metrics['Allocated'] !== 'Not Approved') {
      throw new Error(`Final Verification Failed: Expected Allocated to be "Not Approved", got "${finalIn.metrics['Allocated']}"`);
    }
    if (finalIn.badge !== 'NO BADGE') {
      throw new Error(`Final Verification Failed: Expected NO BADGE, got "${finalIn.badge}"`);
    }
    console.log('✓ POST-CLEANUP VERIFICATION PASSED: Inward is confirmed back to "Not Approved" with NO BADGE.');

    console.log('\n======================================================');
    console.log('ALL ACCEPTANCE TESTS & SCENARIOS PASSED WITH 100% SUCCESS!');
    console.log('======================================================');
  } catch (err) {
    console.error('\n❌ TEST FAILED:', err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
