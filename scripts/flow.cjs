// End-to-end smoke test with deterministic stepping:
// open a pack, tear it, extract the cards, flip and toss every card, then show the summary.
const { chromium } = require('playwright');
const out = process.argv[2] || '.';
const base = process.argv[3] || 'http://localhost:5173/';
const force = process.argv[4] || '';
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  const logs = [];
  page.on('console', m => { if (m.type() !== 'debug' && !/ERR_TUNNEL|Failed to load resource/.test(m.text())) logs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => logs.push('pageerror: ' + e.message));
  await page.goto(base + '?paused=1&force=' + encodeURIComponent(force));
  await page.waitForFunction(() => window.__app && window.__app.state === 'menu', null, { timeout: 120000 });
  const step = (n, dt = 1 / 30) => page.evaluate(([n, dt]) => window.__app.step(n, dt), [n, dt]);
  const state = () => page.evaluate(() => window.__app.state);
  const shot = async n => { await step(1); await page.screenshot({ path: `${out}/f_${n}.png` }); console.log('shot', n, await state()); };
  await step(30);
  await shot('0menu');
  await page.click('#openBtn');
  await page.waitForFunction(() => window.__app.state === 'pack', null, { timeout: 60000 });
  await step(60);
  await shot('1pack');
  await page.evaluate(() => window.__app.pack.setTear(0.55));
  await step(10);
  await shot('2tear');
  await page.evaluate(() => window.__app.autoTear());
  for (let i = 0; i < 60 && (await state()) !== 'extract'; i++) await step(5);
  await page.evaluate(() => { window.__app.extractT = 0.5; });
  await step(10);
  await shot('3extract');
  await page.evaluate(() => { window.__app.extractAuto = true; });
  for (let i = 0; i < 40 && (await state()) !== 'reveal'; i++) await step(5);
  await step(45);
  await shot('4stack');
  for (let i = 0; i < 12; i++) {
    if ((await state()) !== 'reveal') break;
    await page.evaluate(() => window.__app.primaryAction()); // flip
    await step(8);
    const info = await page.evaluate(() => { const a = window.__app; const c = a.cards[a.topIdx]; return c ? c.info.code + ' ' + c.data.n + ' tier' + c.info.tier : ''; });
    await step(25); for (let k = 0; k < 20 && (await page.evaluate(() => { const a = window.__app; const c = a.cards[a.topIdx]; return c && c.mode !== "display"; })); k++) await step(10);
    console.log('card', i, info);
    if (/tier[3-6]/.test(info) || i === 0) await shot('5card' + i);
    await page.evaluate(() => window.__app.primaryAction()); // toss
    await step(6);
    if (i === 3) await shot('5fly');
  }
  for (let i = 0; i < 30 && (await state()) !== 'summary'; i++) { await step(10); await page.waitForTimeout(200); }
  await step(60);
  await shot('6summary');
  console.log(logs.slice(0, 30).join('\n'));
  await browser.close();
})();
