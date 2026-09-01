import { chromium } from 'playwright';

const url = process.env.URL || 'http://localhost:5174';
const out = process.env.OUT || '/tmp/opencode/shot.png';
const width = parseInt(process.env.W || '1600', 10);
const height = parseInt(process.env.H || '1000', 10);
const dark = process.env.DARK === '1';
const scrolled = process.env.SCROLL === '1';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height } });
if (dark) {
  await page.addInitScript(() => {
    localStorage.setItem('orion-theme', 'dark');
  });
}
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
if (scrolled) {
  await page.evaluate(() => {
    const el = document.querySelector('.chat-scrollbar');
    if (el) el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(500);
}
await page.screenshot({ path: out });
await browser.close();
console.log('saved', out);
