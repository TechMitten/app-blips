import { chromium } from 'playwright';
const b = await chromium.launch();
for (const w of [320, 375, 414, 1280]) {
  const p = await b.newPage({ viewport: { width: w, height: 760 } });
  await p.goto('http://localhost:5231/');
  await p.waitForSelector('.studio-footer');
  const r = await p.evaluate(() => {
    const f = document.querySelector('.studio-footer');
    const items = [...f.querySelectorAll('nav > *')].map(e => e.getBoundingClientRect().right);
    return { vw: innerWidth, docW: document.documentElement.scrollWidth, footerScroll: f.scrollWidth, maxRight: Math.max(...items), h: f.offsetHeight };
  });
  console.log(w, JSON.stringify(r));
  if (w === 375) await p.screenshot({ path: process.argv[2] + '/footer375.png' });
}
await b.close();
