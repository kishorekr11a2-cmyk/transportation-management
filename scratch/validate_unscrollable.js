const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  console.log('Logging in to admin...');
  await page.goto('http://localhost:5173/admin-login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.fill('#admin-userId', 'admin');
  await page.fill('input[name="password"]', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);

  console.log('Navigating to /users...');
  await page.goto('http://localhost:5173/users', { waitUntil: 'networkidle' });
  await page.waitForSelector('.modern-user-table tbody tr', { timeout: 10000 });
  await page.waitForTimeout(1000);

  // 1. Capture initial desktop view
  await page.screenshot({ path: 'scratch/unscrollable_desktop_initial.png' });
  console.log('Captured scratch/unscrollable_desktop_initial.png');

  // Check page scrollability vs table scrollability
  const scrollInfo = await page.evaluate(() => {
    const pageEl = document.querySelector('.user-page-container');
    const tableContainer = document.querySelector('.table-responsive-container');
    
    // Attempt to scroll the window
    window.scrollTo(0, 500);
    const windowScrollY = window.scrollY;

    return {
      windowScrollY,
      pageScrollHeight: pageEl.scrollHeight,
      pageClientHeight: pageEl.clientHeight,
      pageIsUnscrollable: pageEl.scrollHeight <= pageEl.clientHeight + 2,
      tableScrollHeight: tableContainer.scrollHeight,
      tableClientHeight: tableContainer.clientHeight,
      tableCanScroll: tableContainer.scrollHeight > tableContainer.clientHeight
    };
  });
  console.log('Scroll Info (10 rows):', scrollInfo);

  // 2. Change rows per page to 20 to test internal scrolling
  console.log('Switching to 20 rows per page...');
  await page.selectOption('#rows-per-page-select', '20');
  await page.waitForTimeout(600);

  const scrollInfo20 = await page.evaluate(() => {
    const pageEl = document.querySelector('.user-page-container');
    const tableContainer = document.querySelector('.table-responsive-container');
    
    // Attempt window scroll
    window.scrollTo(0, 500);
    const windowScrollY = window.scrollY;

    // Perform internal table scroll
    tableContainer.scrollTop = 250;

    return {
      windowScrollY,
      pageScrollHeight: pageEl.scrollHeight,
      pageClientHeight: pageEl.clientHeight,
      pageIsUnscrollable: pageEl.scrollHeight <= pageEl.clientHeight + 2,
      tableScrollHeight: tableContainer.scrollHeight,
      tableClientHeight: tableContainer.clientHeight,
      tableScrollTop: tableContainer.scrollTop,
      tableCanScroll: tableContainer.scrollHeight > tableContainer.clientHeight
    };
  });
  console.log('Scroll Info (20 rows, internally scrolled):', scrollInfo20);

  // Capture screenshot of table internally scrolled
  await page.screenshot({ path: 'scratch/unscrollable_desktop_scrolled_internal.png' });
  console.log('Captured scratch/unscrollable_desktop_scrolled_internal.png');

  // 3. Tablet view (1024x768)
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'scratch/unscrollable_tablet_1024.png' });
  console.log('Captured scratch/unscrollable_tablet_1024.png');

  // 4. Mobile view (425x900)
  await page.setViewportSize({ width: 425, height: 900 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'scratch/unscrollable_mobile_425.png' });
  console.log('Captured scratch/unscrollable_mobile_425.png');

  await browser.close();
  console.log('Validation complete!');
})();
