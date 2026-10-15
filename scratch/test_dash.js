const { chromium } = require('playwright');

(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage();
  p.on('console', m => console.log('LOG:', m.text()));
  p.on('pageerror', e => console.log('ERR:', e.message));

  await p.addInitScript(() => {
    localStorage.setItem("admin_token", "mock-token");
    localStorage.setItem("admin_user", JSON.stringify({ role: "admin", name: "Administrator" }));
    localStorage.setItem("token", "mock-token");
    localStorage.setItem("user", JSON.stringify({ role: "admin", name: "Administrator" }));
    sessionStorage.setItem("token", "mock-token");
    sessionStorage.setItem("role", "admin");
  });

  await p.goto('http://localhost:5173/admin-dashboard');
  await p.waitForTimeout(3000);
  console.log('Current URL:', p.url());
  const h1 = await p.$('.dash-brand__title');
  console.log('H1 found:', !!h1);
  if (h1) {
    console.log('H1 text:', await h1.textContent());
  }
  const cards = await p.$$('.studio-scene');
  console.log('Cards count:', cards.length);

  await p.screenshot({ path: 'scratch/test_dash.png' });
  console.log('Screenshot saved to scratch/test_dash.png');
  await b.close();
})();
