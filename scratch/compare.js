const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  
  const files = [
    'gemini_test.jpg',
    'frontend/public/images/transit-hero.jpg',
    'frontend/public/images/admin-campus-bus.jpg',
    'C:\\Users\\R Deepa Rathi\\.gemini\\antigravity-ide\\brain\\20ff7234-a47e-44d3-849c-a29a85d9facb\\.user_uploaded\\media_1791654001022.png'
  ];
  
  let html = '<html><body style="background:#333; color:white; font-family:sans-serif;">';
  for (const f of files) {
    const data = fs.readFileSync(f).toString('base64');
    const mime = f.endsWith('.png') ? 'image/png' : 'image/jpeg';
    html += `<h3>${f}</h3><img src="data:${mime};base64,${data}" style="max-width:800px; display:block; margin-bottom:20px;">`;
  }
  html += '</body></html>';
  await page.setContent(html);
  await page.screenshot({ path: 'scratch/compare_images.png', fullPage: true });
  await browser.close();
  console.log('compare_images.png saved');
})();
