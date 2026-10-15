const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const viewports = [
    { name: '320px', width: 320, height: 600 },
    { name: '360px', width: 360, height: 740 },
    { name: '375px', width: 375, height: 812 },
    { name: '430px', width: 430, height: 932 },
    { name: '600px', width: 600, height: 900 },
    { name: '768px', width: 768, height: 1024 },
    { name: '1024px', width: 1024, height: 768 },
    { name: '1366px', width: 1366, height: 768 },
    { name: '1440px', width: 1440, height: 900 },
    { name: '1920px', width: 1920, height: 1080 }
  ];

  for (const vp of viewports) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('admin_token', 'mock-token');
      localStorage.setItem('admin_user', JSON.stringify({ role: 'admin', name: 'Administrator' }));
      sessionStorage.setItem('token', 'mock-token');
      sessionStorage.setItem('role', 'admin');
    });

    await page.goto('http://localhost:5173/admin-dashboard', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.dash-header', { timeout: 10000 });
    await page.waitForTimeout(400);

    const pos = await page.evaluate(() => {
      const h = document.querySelector('.dash-header').getBoundingClientRect();
      const g = (document.querySelector('.studio-scenes-grid') || document.querySelector('.bento-grid')).getBoundingClientRect();
      const cards = document.querySelectorAll('.studio-scene');
      const firstCard = cards[0] ? cards[0].getBoundingClientRect() : null;
      const lastCard = cards[cards.length - 1] ? cards[cards.length - 1].getBoundingClientRect() : null;
      const logout = document.querySelector('.dash-logout-btn') ? document.querySelector('.dash-logout-btn').getBoundingClientRect() : null;
      const badge = document.querySelector('.dash-admin-badge') ? document.querySelector('.dash-admin-badge').getBoundingClientRect() : null;
      const brand = document.querySelector('.dash-brand') ? document.querySelector('.dash-brand').getBoundingClientRect() : null;

      // Find max right among cards in the first row
      let maxCardRight = 0;
      cards.forEach(c => {
        const r = c.getBoundingClientRect();
        if (r.right > maxCardRight) maxCardRight = r.right;
      });

      return {
        vpWidth: window.innerWidth,
        header: {
          left: Math.round(h.left),
          right: Math.round(h.right),
          width: Math.round(h.width),
          leftMargin: Math.round(h.left),
          rightMargin: Math.round(window.innerWidth - h.right)
        },
        firstCardLeft: firstCard ? Math.round(firstCard.left) : null,
        cardsRight: Math.round(maxCardRight),
        cardsRightMargin: Math.round(window.innerWidth - maxCardRight),
        logout: logout ? {
          left: Math.round(logout.left),
          right: Math.round(logout.right),
          distFromHeaderRight: Math.round(h.right - logout.right),
          distFromScreenRight: Math.round(window.innerWidth - logout.right)
        } : null,
        overlap: brand && badge ? (brand.right > badge.left ? Math.round(brand.right - badge.left) : 0) : 0
      };
    });

    console.log(`[${vp.name}] header: L=${pos.header.left} R=${pos.header.right} W=${pos.header.width} | marginL=${pos.header.leftMargin} marginR=${pos.header.rightMargin} | cards: L=${pos.firstCardLeft} Rmargin=${pos.cardsRightMargin} | logoutFromScreen=${pos.logout.distFromScreenRight} fromHeader=${pos.logout.distFromHeaderRight} | overlap=${pos.overlap}`);
    await context.close();
  }

  await browser.close();
})();
