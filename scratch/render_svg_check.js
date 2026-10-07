const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
    console.log('Launching browser to test SVG...');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 2600, height: 1650 } });

    page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
    page.on('pageerror', err => console.error('BROWSER ERROR:', err.message));

    const svgUrl = 'file:///' + path.resolve(__dirname, '../docs/system-architecture.svg').replace(/\\/g, '/');
    console.log('Opening:', svgUrl);

    await page.goto(svgUrl, { waitUntil: 'load' });
    await page.waitForTimeout(1000);

    // In a standalone SVG, document.documentElement is <svg> unless an XML parsing error occurred
    const rootTag = await page.evaluate(() => document.documentElement?.tagName || '');
    console.log('Root element tag:', rootTag);
    if (rootTag.toLowerCase() === 'parsererror' || rootTag.toLowerCase() === 'html') {
        const text = await page.evaluate(() => document.documentElement.textContent);
        if (text.includes('error') || text.includes('Parsing')) {
            console.error('❌ XML Parsing error detected in SVG:', text);
            process.exit(1);
        }
    }

    const svgEl = await page.$('svg');
    if (!svgEl) {
        console.error('❌ No <svg> element found on page!');
        process.exit(1);
    }

    const bbox = await page.evaluate(() => {
        const svg = document.querySelector('svg');
        return {
            width: svg.clientWidth || svg.getAttribute('width'),
            height: svg.clientHeight || svg.getAttribute('height')
        };
    });
    console.log('SVG dimensions on page:', bbox);

    const screenshotPath = path.resolve('scratch/system-architecture-rendered.png');
    await svgEl.screenshot({ path: screenshotPath });
    console.log('✅ Screenshot successfully captured at:', screenshotPath);

    await browser.close();
    console.log('Validation complete: SVG renders cleanly without errors!');
})();
