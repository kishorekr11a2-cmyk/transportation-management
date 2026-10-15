const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  const imgPath = 'C:\\Users\\R Deepa Rathi\\.gemini\\antigravity-ide\\brain\\20ff7234-a47e-44d3-849c-a29a85d9facb\\.user_uploaded\\media_1791654001022.png';
  const imgBase64 = fs.readFileSync(imgPath).toString('base64');
  
  await page.setContent(`
    <html><body>
      <img id="srcImg" src="data:image/png;base64,${imgBase64}" />
      <canvas id="cvs"></canvas>
    </body></html>
  `);
  
  const result = await page.evaluate(async () => {
    const img = document.getElementById('srcImg');
    await img.decode();
    const cvs = document.getElementById('cvs');
    const ctx = cvs.getContext('2d');
    
    // Top illustration: width 1024, height ~180
    cvs.width = img.naturalWidth;
    cvs.height = 190;
    ctx.drawImage(img, 0, 0);
    return {
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      dataUrl: cvs.toDataURL('image/png')
    };
  });
  
  const base64Data = result.dataUrl.replace(/^data:image\/png;base64,/, '');
  fs.writeFileSync('scratch/cropped_top.png', Buffer.from(base64Data, 'base64'));
  console.log('Saved scratch/cropped_top.png, dims:', result.naturalWidth, result.naturalHeight);
  await browser.close();
})();
