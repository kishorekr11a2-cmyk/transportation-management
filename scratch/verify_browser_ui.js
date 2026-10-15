const { chromium } = require('playwright');
const path = require('path');

(async () => {
  // 1. Authenticate via API to get valid token
  console.log('1. Getting admin auth token...');
  const authRes = await fetch('http://localhost:5000/api/auth/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'admin', password: 'admin123' })
  });
  const authData = await authRes.json();
  const token = authData.token;
  const user = authData.user;
  console.log('Auth success:', authData.success, 'user:', user?.name);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });

  // Add auth tokens to every page before scripts run
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('admin_token', token);
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('admin_user', JSON.stringify(user));
    sessionStorage.setItem('token', token);
    sessionStorage.setItem('user', JSON.stringify(user));
    sessionStorage.setItem('role', 'admin');
  }, { token, user });

  const page = await context.newPage();

  console.log('2. Navigating to AI Route Optimization (/ai-agent)...');
  await page.goto('http://localhost:5173/ai-agent', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  // Extract top stats
  const stats = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      has427: text.includes('427'),
      has472: text.includes('472'),
      has9Buses: text.includes('9'),
      url: window.location.href
    };
  });
  console.log('AI Agent Stats on page:', stats);

  await page.screenshot({ path: path.join(__dirname, 'live_ai_agent_top.png') });
  console.log('Captured scratch/live_ai_agent_top.png');

  // Try clicking Inward tab if present
  try {
    const inwardTab = await page.$('button:has-text("Inward"), [role="tab"]:has-text("Inward")');
    if (inwardTab) {
      await inwardTab.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: path.join(__dirname, 'live_ai_agent_inward.png') });
      console.log('Captured scratch/live_ai_agent_inward.png');
    }
  } catch (e) {
    console.log('Inward tab click error:', e.message);
  }

  // 3. Navigate to Plan Confirmation
  console.log('3. Navigating to Plan Confirmation (/plan-confirmation)...');
  await page.goto('http://localhost:5173/plan-confirmation', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(__dirname, 'live_plan_confirmation_verified.png') });
  console.log('Captured scratch/live_plan_confirmation_verified.png');

  // 4. Switch to Outward tab on Plan Confirmation
  try {
    const outwardBtn = await page.$('button:has-text("Outward")');
    if (outwardBtn) {
      console.log('Clicking Outward tab on Plan Confirmation...');
      await outwardBtn.click();
      await page.waitForTimeout(4000);
      await page.screenshot({ path: path.join(__dirname, 'live_plan_confirmation_outward.png') });
      console.log('Captured scratch/live_plan_confirmation_outward.png');
    }
  } catch (e) {
    console.log('Outward click error:', e.message);
  }

  await browser.close();
  console.log('Verification finished successfully!');
})();
