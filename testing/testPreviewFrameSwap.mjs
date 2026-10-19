// Headless-browser regression test for the preview's double-buffered frames
// (useDoubleBufferedDoc in DeviceMockup.jsx).
//
//   npx playwright install chromium   # once
//   node testing/testPreviewFrameSwap.mjs
//
// Reproduces the bug where the preview lost its scroll bar (and wheel
// scrolling) after a click-to-edit Apply until a device or Code/Preview
// switch: the back frame used to get scrolling="no" while idle and "auto"
// in the same commit that gave it the new srcdoc. Chromium keeps the value
// from when the navigation started, so the new document came up unscrollable.
// The fix keeps `scrolling` fixed across a document swap; this checks both.

import { chromium } from '@playwright/test';

const DOC = (label) => `<!DOCTYPE html><html><body style="margin:0">
<h1 id="label">${label}</h1>
<div style="height:3000px;background:linear-gradient(#fde68a,#1e3a8a)"></div>
</body></html>`;

// Full Chromium, not the headless shell: only it isolates sandboxed frames
// into their own process the way Electron does, which is what loses the
// late `scrolling` change. Headless also hides scroll bars by default, and
// the scroll bar is what this checks.
const browser = await chromium.launch({ channel: 'chromium', ignoreDefaultArgs: ['--hide-scrollbars'] });
let failures = 0;

// Mimics DeviceMockup's update order on an edit: the back frame gets the new
// srcdoc (and, in the old code, its scrolling change) in one commit; after it
// loads, the two swap z-index and the old one is emptied.
async function swapScrolls({ toggleScrolling }) {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.setContent(`<!DOCTYPE html><html><body style="margin:0">
<div style="position:relative;width:600px;height:400px;isolation:isolate">
  <iframe name="a" sandbox="allow-scripts allow-forms allow-popups" scrolling="auto" style="position:absolute;inset:0;width:100%;height:100%;border:0;z-index:1"></iframe>
  <iframe name="b" sandbox="allow-scripts allow-forms allow-popups" scrolling="${toggleScrolling ? 'no' : 'auto'}" srcdoc="" style="position:absolute;inset:0;width:100%;height:100%;border:0;z-index:0;pointer-events:none" inert></iframe>
</div></body></html>`);
  const [a, b] = await page.$$('iframe');
  const loaded = (el) => el.evaluate((f) => new Promise((r) => f.addEventListener('load', () => r(), { once: true })));

  const aLoad = loaded(a);
  await a.evaluate((f, html) => { f.srcdoc = html; }, DOC('first'));
  await aLoad;

  // The edit lands: b becomes live, a covers until b has loaded.
  const bLoad = loaded(b);
  await page.evaluate(({ html, toggleScrolling }) => {
    const [fa, fb] = document.querySelectorAll('iframe');
    fb.srcdoc = html;
    if (toggleScrolling) { fb.setAttribute('scrolling', 'auto'); fa.setAttribute('scrolling', 'no'); }
    fb.removeAttribute('inert');
    fb.style.pointerEvents = '';
    fa.inert = true;
    fa.style.pointerEvents = 'none';
  }, { html: DOC('second'), toggleScrolling });
  await bLoad;
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const [fa, fb] = document.querySelectorAll('iframe');
    fa.style.zIndex = '0';
    fb.style.zIndex = '1';
    fa.srcdoc = '';
  });
  await page.waitForTimeout(150);

  const frame = page.frames().find((f) => f.name() === 'b');
  const scrollbar = await frame.evaluate(() => window.innerWidth - document.documentElement.clientWidth);
  await page.mouse.move(300, 200);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(300);
  const scrollY = await frame.evaluate(() => window.scrollY);
  const label = await frame.evaluate(() => document.getElementById('label')?.textContent);
  await page.close();
  return { scrollbar, scrollY, label };
}

const check = (name, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`, detail);
  if (!ok) failures++;
};

const before = await swapScrolls({ toggleScrolling: true });
console.log('info old behaviour (scrolling no -> auto with the new srcdoc):', before,
  before.scrollbar === 0 && before.scrollY === 0 ? '(reproduces the bug)' : '(does not reproduce here)');

const after = await swapScrolls({ toggleScrolling: false });
check('new document is the one on screen', after.label === 'second', after);
check('new document has a scroll bar after the swap', after.scrollbar > 0, after);
check('mouse wheel scrolls the new document', after.scrollY > 0, after);

await browser.close();
if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll frame-swap checks passed');
