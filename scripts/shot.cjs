// usage: node scripts/shot.cjs <url> <out.png> [waitMs] [w] [h]
const { chromium } = require('playwright');
(async () => {
  const [url, out, wait = '6000', w = '1280', h = '800'] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: +w, height: +h } });
  const logs = [];
  page.on('console', m => logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', e => logs.push('pageerror: ' + e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__done, null, { timeout: +wait }).catch(()=>logs.push('not done'));
  await page.screenshot({ path: out });
  console.log(logs.slice(0, 40).join('\n'));
  await browser.close();
})();
