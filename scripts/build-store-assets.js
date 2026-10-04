/**
 * Builds the composed Chrome Web Store graphic assets:
 *   store/tiles/promo-small-440x280.png
 *   store/tiles/promo-marquee-1400x560.png
 *
 * Screenshots are deliberately not generated here: they would capture real
 * signed-in pages. Take the listing screenshots by hand when ready.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const STORE = path.join(ROOT, 'store');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tileHtml(size, iconPx, titlePx, subPx, padPx) {
  const icon = fs.readFileSync(path.join(ROOT, 'icons', 'icon128.png')).toString('base64');
  return `<html><body style="margin:0"><div style="width:${size[0]}px;height:${size[1]}px;background:#1b1c23;display:flex;align-items:center;gap:${Math.round(padPx / 1.6)}px;padding:0 ${padPx}px;box-sizing:border-box;">` +
    `<img src="data:image/png;base64,${icon}" style="width:${iconPx}px;height:${iconPx}px">` +
    `<div><div style="font:700 ${titlePx}px system-ui,-apple-system,sans-serif;color:#f2f2f5;line-height:1.1">Chat Export</div>` +
    `<div style="font:${subPx}px system-ui,-apple-system,sans-serif;color:#b9bbc5;margin-top:${Math.round(subPx / 3)}px">Claude &middot; ChatGPT &middot; Grok &rarr; Markdown</div></div></div></body></html>`;
}

(async () => {
  fs.mkdirSync(path.join(STORE, 'tiles'), { recursive: true });
  const browser = await chromium.launch();
  try {
    const specs = [
      { file: path.join(STORE, 'tiles', 'promo-small-440x280.png'), size: [440, 280], html: tileHtml([440, 280], 104, 40, 19, 36) },
      { file: path.join(STORE, 'tiles', 'promo-marquee-1400x560.png'), size: [1400, 560], html: tileHtml([1400, 560], 220, 92, 40, 110) }
    ];
    for (const spec of specs) {
      const page = await browser.newPage({ viewport: { width: spec.size[0], height: spec.size[1] } });
      await page.setContent(spec.html);
      await page.waitForTimeout(300);
      await page.screenshot({ path: spec.file, clip: { x: 0, y: 0, width: spec.size[0], height: spec.size[1] } });
      await page.close();
      console.log(`PASS tile ${spec.file}`);
    }
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(String(error.message || error)); process.exitCode = 1; });
