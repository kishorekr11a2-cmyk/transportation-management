const { chromium } = require('playwright');
const path = require('path');

(async () => {
  console.log('Launching browser for User Management validation...');
  const browser = await chromium.launch({ headless: true });

  try {
    // 1. Desktop Validation (1440x900)
    console.log('Testing Desktop 1440x900...');
    const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await desktopContext.newPage();

    // Login as admin
    await page.goto('http://localhost:5173/admin-login', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.fill('#admin-userId', 'admin');
    await page.fill('input[name="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1500);

    // Navigate to /users
    await page.goto('http://localhost:5173/users', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const p1Path = path.join(__dirname, '..', 'redesign_desktop_page1.png');
    await page.screenshot({ path: p1Path, fullPage: true });
    console.log('Captured Page 1 to:', p1Path);

    // Click Next button or Page 2
    console.log('Testing Page 2 pagination click...');
    const page2Btn = await page.$('button.pagination-number:has-text("2")');
    if (page2Btn) {
      await page2Btn.click();
      await page.waitForTimeout(600);
      const p2Path = path.join(__dirname, '..', 'redesign_desktop_page2.png');
      await page.screenshot({ path: p2Path, fullPage: true });
      console.log('Captured Page 2 to:', p2Path);
    }

    // Test Rows Per Page dropdown (20)
    console.log('Testing Rows per page selector (20)...');
    await page.selectOption('#rows-per-page-select', '20');
    await page.waitForTimeout(600);
    const p20Path = path.join(__dirname, '..', 'redesign_desktop_20rows.png');
    await page.screenshot({ path: p20Path, fullPage: true });
    console.log('Captured 20 rows per page to:', p20Path);

    await desktopContext.close();

    // 2. Tablet Validation (1024x768)
    console.log('Testing Tablet 1024x768...');
    const tabletContext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const tabletPage = await tabletContext.newPage();
    await tabletPage.goto('http://localhost:5173/admin-login', { waitUntil: 'networkidle' });
    await tabletPage.fill('#admin-userId', 'admin');
    await tabletPage.fill('input[name="password"]', 'admin123');
    await tabletPage.click('button[type="submit"]');
    await tabletPage.waitForTimeout(1500);
    await tabletPage.goto('http://localhost:5173/users', { waitUntil: 'networkidle' });
    await tabletPage.waitForTimeout(2000);

    const tabletPath = path.join(__dirname, '..', 'redesign_tablet_1024.png');
    await tabletPage.screenshot({ path: tabletPath, fullPage: true });
    console.log('Captured Tablet to:', tabletPath);
    await tabletContext.close();

    // 3. Mobile Validation (425x850)
    console.log('Testing Mobile 425x850...');
    const mobileContext = await browser.newContext({ viewport: { width: 425, height: 850 } });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto('http://localhost:5173/admin-login', { waitUntil: 'networkidle' });
    await mobilePage.fill('#admin-userId', 'admin');
    await mobilePage.fill('input[name="password"]', 'admin123');
    await mobilePage.click('button[type="submit"]');
    await mobilePage.waitForTimeout(1500);
    await mobilePage.goto('http://localhost:5173/users', { waitUntil: 'networkidle' });
    await mobilePage.waitForTimeout(2000);

    const mobilePath = path.join(__dirname, '..', 'redesign_mobile_425.png');
    await mobilePage.screenshot({ path: mobilePath, fullPage: true });
    console.log('Captured Mobile to:', mobilePath);
    await mobileContext.close();

    console.log('All validation screenshots completed successfully!');
  } catch (err) {
    console.error('Validation error:', err);
  } finally {
    await browser.close();
  }
})();
