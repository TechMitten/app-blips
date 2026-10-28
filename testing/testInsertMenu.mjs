// Headless-browser test for click-to-edit's right-click insert menu: a real
// right-click in the sandboxed preview bridge reports where the menu opens,
// the spot a new element goes beside (marked with an insertion line) and the
// text or image under the pointer (outlined, for cut / copy / delete),
// that spot is fed to the deterministic engine (applyDirectEdit's `insert`),
// and using the page again dismisses the menu.
//
//   npx playwright install chromium   # once
//   node testing/testInsertMenu.mjs
//
// Same sandboxed-iframe shape as the app (sandbox without
// allow-same-origin); the parent page only uses postMessage.

import { chromium } from '@playwright/test';
import { injectPreviewBridge } from '../src/previewBridge.js';
import { applyDirectEdit, buildSpotEditPrompt, copyElementSource } from '../src/lib/directEdits.js';

const FIXTURE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Insert probe</title>
  <style>
    body { margin: 0; font-family: sans-serif; }
    section { padding: 2rem; }
    .cards { display: flex; gap: 2rem; }
    .card { padding: 1rem; border: 1px solid #ccc; width: 10rem; }
    ul { margin: 1rem 0; }
    .tall { height: 1600px; }
  </style>
</head>
<body>
  <!-- @section: features -->
  <section id="features">
    <h2>Features</h2>
    <p class="lede">We are <strong>really</strong> fast.</p>
    <div class="cards">
      <div class="card"><h3>Fast</h3><p>Loads in a blink.</p></div>
      <div class="card"><h3>Safe</h3><p>Nothing leaves your device.</p></div>
    </div>
    <ul class="steps">
      <li>Sign up</li>
      <li>Build</li>
    </ul>
  </section>
  <div class="tall"></div>
</body>
</html>`;

const browser = await chromium.launch();
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`);
};

try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));

  await page.setContent(`<!DOCTYPE html><html><body style="margin:0">
<iframe id="f" sandbox="allow-scripts allow-forms allow-popups" style="width:1000px;height:700px;border:0;display:block"></iframe>
<script>
  window.__token = null;
  window.__menus = [];
  window.__dismissed = 0;
  window.__selections = [];
  window.addEventListener('message', (e) => {
    if (!e.data) return;
    if (e.data.type === 'insert-menu') window.__menus.push(e.data.payload);
    if (e.data.type === 'insert-menu-dismissed') window.__dismissed++;
    if (e.data.type === 'element-selected') window.__selections.push(e.data.payload);
  });
  window.__send = (type, payload) => document.getElementById('f').contentWindow.postMessage(
    { __orion: 'orion-preview-bridge', v: 1, token: window.__token, type, payload }, '*');
  window.__setSrc = (html) => { document.getElementById('f').srcdoc = html; };
</script>
</body></html>`);

  let frame;
  const setEditing = async (enabled) => {
    await page.evaluate((p) => window.__send('set-editing', p), { enabled, drag: false });
    await page.waitForTimeout(50);
  };
  const fresh = async ({ editing = true } = {}) => {
    const injected = injectPreviewBridge(FIXTURE, { touchEnabled: false });
    await page.evaluate((t) => { window.__token = t; window.__menus = []; window.__dismissed = 0; window.__selections = []; }, injected.token);
    await page.evaluate((h) => window.__setSrc(h), injected.srcDoc);
    await page.waitForTimeout(50);
    frame = page.frames().find((x) => x !== page.mainFrame());
    await frame.waitForSelector('#features', { timeout: 10000 });
    await setEditing(editing);
  };
  // The iframe sits at the page origin, so frame coordinates are page ones.
  const rectOf = (selector) => frame.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  }, selector);
  const lines = () => frame.evaluate(() => [...document.querySelectorAll('div[data-orion-drag="line"]')]
    .map((d) => ({ width: parseFloat(d.style.width), height: parseFloat(d.style.height), top: parseFloat(d.style.top) })));
  const rightClick = async (x, y) => {
    await page.evaluate(() => { window.__menus = []; });
    await page.mouse.click(x, y, { button: 'right' });
    await page.waitForTimeout(80);
    return page.evaluate(() => window.__menus.slice());
  };

  // --- right-click on the lower half of the heading: after it --------------
  await fresh();
  {
    const h2 = await rectOf('#features h2');
    const menus = await rightClick(h2.left + 30, h2.bottom - 3);
    check('one insert-menu is reported', menus.length === 1, `${menus.length}`);
    const menu = menus[0];
    check('menu carries the pointer and viewport width',
      Math.round(menu?.x) === Math.round(h2.left + 30) && menu?.viewportWidth === 1000, JSON.stringify(menu && { x: menu.x, w: menu.viewportWidth }));
    check('spot is after the heading', menu?.spot?.target?.tag === 'h2' && menu?.spot?.position === 'after',
      `${menu?.spot?.target?.tag} ${menu?.spot?.position}`);
    const marks = await lines();
    check('an insertion line marks the spot', marks.length === 1 && marks[0].width > marks[0].height, JSON.stringify(marks));
    check('no area is reported alongside an element', menu?.container === null);
    check('the right-clicked heading is reported for cut / copy / delete',
      menu?.element?.tag === 'h2' && menu?.element?.role === 'heading' && menu?.element?.text === 'Features', `${menu?.element?.tag} ${menu?.element?.role}`);
    check('and outlined while the menu is open',
      await frame.evaluate(() => /dashed/.test(document.querySelector('#features h2').style.outline)));
    check('no outline paint leaks into the reported element', menu?.element && !/outline/.test(menu.element.outerHTML));
    const copied = menu?.element && copyElementSource(FIXTURE, menu.element);
    check('the reported heading is copyable', copied?.ok && copied.html === '<h2>Features</h2>', copied?.reason || copied?.html);
    check('the right-click does not select anything', (await page.evaluate(() => window.__selections.length)) === 0);
    const result = menu?.spot && applyDirectEdit(FIXTURE, menu.spot.target, { insert: { kind: 'text', text: 'Brand new', position: menu.spot.position } });
    check('insert applies', result?.ok, result?.reason || result?.summary);
    check('text lands right after the heading',
      result?.ok && /<h2>Features<\/h2>\n {4}<p>Brand new<\/p>\n {4}<p class="lede">/.test(result.code));

    // A second right-click moves the spot; still one line.
    const card = await rectOf('.card:nth-child(2)');
    const again = await rightClick(card.left + 6, card.top + 6);
    check('the first outline is cleared when the menu moves',
      await frame.evaluate(() => !document.querySelector('#features h2').style.outline));
    check('right-click on a card reports a spot inside it', again[0]?.spot?.target?.tag === 'h3' && again[0]?.spot?.position === 'before',
      `${again[0]?.spot?.target?.tag} ${again[0]?.spot?.position}`);
    check('only one insertion line at a time', (await lines()).length === 1);

    // Using the page closes the menu and removes the line.
    await page.mouse.click(5, 650);
    await page.waitForTimeout(50);
    check('a click in the page dismisses the menu', (await page.evaluate(() => window.__dismissed)) === 1);
    check('the line is gone after dismissing', (await lines()).length === 0);
    check('and so is the outline', await frame.evaluate(() => !document.querySelector('.card:nth-child(2) h3').style.outline));
  }

  // --- list items: the spot stays outside the list ---------------------------
  await fresh();
  {
    const li = await rectOf('.steps li:first-child');
    const [menu] = await rightClick(li.left + 20, li.top + 4);
    check('a list item spot climbs to the list', menu?.spot?.target?.tag === 'ul', `${menu?.spot?.target?.tag}`);
    check('a list item itself is the element (text)', menu?.element?.tag === 'li', `${menu?.element?.tag}`);
    // The gap between the two cards belongs to their row.
    const first = await rectOf('.card:nth-child(1)');
    const [gap] = await rightClick(first.right + 8, first.top + 10);
    check('a container is not offered for cut / copy', gap?.element === null, `${gap?.element?.tag}`);
    check('but is reported as the area for Ask AI', gap?.container?.tag === 'div' && gap?.container?.attributes?.class === 'cards',
      `${gap?.container?.tag} ${gap?.container?.attributes?.class}`);
    const ask = gap && buildSpotEditPrompt(gap, 'add a third card', { code: FIXTURE });
    check('the Ask AI prompt quotes the area and the spot', /<div class="cards">/.test(ask || '') && /Exact spot: directly/.test(ask || ''), ask);
  }

  // --- parent clears the spot; scrolling dismisses -----------------------------
  await fresh();
  {
    const p = await rectOf('p.lede');
    await rightClick(p.left + 10, p.top + 4);
    await page.evaluate(() => window.__send('insert-clear', {}));
    await page.waitForTimeout(50);
    check('insert-clear removes the line', (await lines()).length === 0);
    await page.mouse.click(p.left + 10, p.top + 4, { button: 'right' });
    await page.waitForTimeout(50);
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(150);
    check('scrolling the page dismisses the menu', (await page.evaluate(() => window.__dismissed)) === 1);
    check('and removes the line', (await lines()).length === 0);
  }

  // --- turning editing off: the browser's own menu is back ---------------------
  await fresh({ editing: false });
  {
    const h2 = await rectOf('#features h2');
    await frame.evaluate(() => {
      window.__prevented = null;
      document.addEventListener('contextmenu', (e) => setTimeout(() => { window.__prevented = e.defaultPrevented; }, 0), { once: true });
    });
    const menus = await rightClick(h2.left + 30, h2.top + 4);
    check('no insert menu while editing is off', menus.length === 0, `${menus.length}`);
    check('the browser menu is not blocked', (await frame.evaluate(() => window.__prevented)) === false);
  }
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall insert-menu checks passed');
process.exitCode = failures ? 1 : 0;
