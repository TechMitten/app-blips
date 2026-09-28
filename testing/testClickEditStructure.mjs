// Headless-browser test for click-to-edit's structure edits, locator and
// shortcuts, end to end: real element snapshots from the preview bridge are
// fed to the deterministic engine (src/lib/directEdits.js), and each result
// is rendered again to prove it is valid and did what it says.
//
//   npx playwright install chromium   # once
//   node testing/testClickEditStructure.mjs
//
// Same sandboxed-iframe shape as the app (sandbox without
// allow-same-origin); the parent page only uses postMessage.

import { chromium } from '@playwright/test';
import { injectPreviewBridge } from '../src/previewBridge.js';
import { applyDirectEdit, locateElement } from '../src/lib/directEdits.js';

const FIXTURE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Structure probe</title>
  <style>
    body { margin: 0; font-family: sans-serif; }
    section { padding: 2rem; }
    .cards { display: flex; gap: 1rem; }
    .card { padding: 1rem; border: 1px solid #ccc; width: 10rem; }
    .reveal { opacity: 0; }
    .reveal.shown { opacity: 1; }
    img { display: block; width: 120px; height: 80px; }
  </style>
</head>
<body>
  <!-- @section: features -->
  <section id="features" class="features">
    <h2>Features</h2>
    <div class="cards">
      <div class="card"><h3>Fast</h3><p>Loads in a blink.</p></div>
      <div class="card"><h3>Safe</h3><p>Nothing leaves your device.</p></div>
      <div class="card"><h3>Free</h3><p>No account needed.</p></div>
    </div>
    <img src="https://example.test/photo.jpg" class="shot">
    <a id="cta" href="#contact" style="background:#f59e0b;padding:0.5rem 1rem">Get started</a>
  </section>

  <!-- @section: pricing -->
  <section class="pricing reveal">
    <h2>Pricing</h2>
    <p>One plan, all features &amp; updates.</p>
  </section>

  <script>
    // Scroll-reveal style drift: the live DOM gains a class the source lacks.
    document.querySelector('.pricing').classList.add('shown');
  </script>
</body>
</html>`;

const { srcDoc, token } = injectPreviewBridge(FIXTURE, { touchEnabled: false, aiEnabled: false });

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.setContent(`<!DOCTYPE html><html><body style="margin:0">
<iframe id="f" sandbox="allow-scripts allow-forms allow-popups" style="width:1000px;height:900px;border:0"></iframe>
<script>
  window.__token = null;
  window.__selections = [];
  window.__shortcuts = [];
  window.addEventListener('message', (e) => {
    if (!e.data) return;
    if (e.data.type === 'element-selected') window.__selections.push(e.data.payload);
    if (e.data.type === 'element-shortcut') window.__shortcuts.push(e.data.payload.action);
  });
  window.__send = (type, payload) => document.getElementById('f').contentWindow.postMessage(
    { __orion: 'orion-preview-bridge', v: 1, token: window.__token, type, payload }, '*');
  window.__setSrc = (html) => { document.getElementById('f').srcdoc = html; };
</script>
</body></html>`);

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`);
};

let frame;
const load = async (html, tok) => {
  await page.evaluate((t) => { window.__token = t; window.__selections = []; window.__shortcuts = []; }, tok);
  await page.evaluate((h) => window.__setSrc(h), html);
  await page.waitForTimeout(50);
  frame = page.frames().find((x) => x !== page.mainFrame());
  await frame.waitForSelector('#features', { timeout: 10000 });
  await page.evaluate(() => window.__send('set-editing', { enabled: true }));
  await page.waitForTimeout(50);
};
const fresh = () => load(srcDoc, token);

// Click a spot inside an element (padding for containers) and return the
// bridge's element-selected payload.
const select = async (selector, position = { x: 3, y: 3 }) => {
  await page.evaluate(() => { window.__selections = []; });
  await frame.locator(selector).first().click({ position });
  await page.waitForFunction(() => window.__selections.length > 0, null, { timeout: 3000 });
  return page.evaluate(() => window.__selections[window.__selections.length - 1]);
};

// Render an edited source and read something back from it.
const renderAndRead = async (html, fn) => {
  const injected = injectPreviewBridge(html, { touchEnabled: false, aiEnabled: false });
  await load(injected.srcDoc, injected.token);
  return frame.evaluate(fn);
};

// --- snapshot fields -------------------------------------------------------
await fresh();
const card = await select('.card >> nth=1');
check('snapshot carries tag rank', card.tagOrdinal >= 0 && card.tagCount > 0, `div ${card.tagOrdinal}/${card.tagCount}`);
check('snapshot carries both siblings', card.prevSibling?.text === 'Fast Loads in a blink.' && card.nextSibling?.text === 'Free No account needed.');
check('snapshot carries scroll', card.scroll && typeof card.scroll.y === 'number');
check('no outline paint leaks into reported markup', ![card.outerHTML, card.prevSibling.outerHTML, card.nextSibling.outerHTML].some((h) => /outline/.test(h)));

// --- move / duplicate / remove a card ---------------------------------------
{
  const up = applyDirectEdit(FIXTURE, card, { move: -1 });
  check('move up applies', up.ok, up.reason || up.summary);
  const order = await renderAndRead(up.code, () => [...document.querySelectorAll('.card h3')].map((h) => h.textContent).join(','));
  check('move up renders reordered', order === 'Safe,Fast,Free', order);

  const dup = applyDirectEdit(FIXTURE, card, { duplicate: true });
  check('duplicate applies', dup.ok, dup.reason || dup.summary);
  const dupOrder = await renderAndRead(dup.code, () => [...document.querySelectorAll('.card h3')].map((h) => h.textContent).join(','));
  check('duplicate renders a copy right after', dupOrder === 'Fast,Safe,Safe,Free', dupOrder);

  const del = applyDirectEdit(FIXTURE, card, { remove: true });
  check('remove applies', del.ok, del.reason || del.summary);
  const delOrder = await renderAndRead(del.code, () => [...document.querySelectorAll('.card h3')].map((h) => h.textContent).join(','));
  check('remove renders without it', delOrder === 'Fast,Free', delOrder);
}

// --- move a whole section past its neighbour --------------------------------
await fresh();
{
  const features = await select('#features');
  check('section has a next sibling', features.nextSibling?.tag === 'section');
  const down = applyDirectEdit(FIXTURE, features, { move: 1 });
  check('section move down applies', down.ok, down.reason || down.summary);
  check('landmarks travel with their sections',
    down.ok && down.code.indexOf('@section: pricing') < down.code.indexOf('@section: features')
      && /<!-- @section: features -->\n {2}<section id="features"/.test(down.code));
  const firstH2 = await renderAndRead(down.code, () => document.querySelector('h2').textContent);
  check('moved section renders first', firstH2 === 'Pricing', firstH2);
}

// --- locator: class drift from a script, wallpaper on a plain section --------
await fresh();
{
  const pricing = await select('.pricing');
  check('live class drifted from source', /shown/.test(pricing.attributes.class || ''));
  const loc = locateElement(FIXTURE, pricing);
  check('pricing section located despite drift', loc.ok, loc.strategy || loc.reason);
  const wall = applyDirectEdit(FIXTURE, pricing, { backgroundImage: 'data:image/png;base64,iVBORw0KGgo=' });
  check('wallpaper added to a section with none', wall.ok, wall.reason || wall.summary);
  const bg = await renderAndRead(wall.code, () => getComputedStyle(document.querySelector('.pricing')).backgroundImage);
  check('wallpaper renders (data: URI intact)', /^url\("data:image\/png;base64,iVBORw0KGgo="\)$/.test(bg), bg);
}

// --- image alt, link target/href/fill ---------------------------------------
await fresh();
{
  const img = await select('img.shot', { x: 10, y: 10 });
  const alt = applyDirectEdit(FIXTURE, img, { alt: 'Product screenshot' });
  check('alt added to an image without one', alt.ok && /<img src="https:\/\/example\.test\/photo\.jpg" class="shot" alt="Product screenshot">/.test(alt.code), alt.reason || '');

  const cta = await select('#cta');
  check('link snapshot role', cta.role === 'link');
  const link = applyDirectEdit(FIXTURE, cta, { href: 'about.html', target: '_blank', backgroundColor: '#123456' });
  check('href + new tab + fill apply together', link.ok, link.reason || link.summary);
  const attrs = await renderAndRead(link.code, () => {
    const a = document.querySelector('#cta');
    return { href: a.getAttribute('href'), target: a.target, rel: a.rel, bg: getComputedStyle(a).backgroundColor };
  });
  check('link renders with new href/target/rel/fill',
    attrs.href === 'about.html' && attrs.target === '_blank' && attrs.rel === 'noopener noreferrer' && attrs.bg === 'rgb(18, 52, 86)',
    JSON.stringify(attrs));
}

// --- keyboard shortcuts inside the frame ------------------------------------
await fresh();
{
  await select('.card >> nth=1');
  const keys = ['Delete', 'Control+d', 'Alt+ArrowUp', 'Alt+ArrowDown', 'Control+z', 'Control+Shift+z'];
  for (const k of keys) await page.keyboard.press(k);
  await page.waitForTimeout(100);
  const got = await page.evaluate(() => window.__shortcuts.slice());
  check('selection shortcuts are reported', got.join(',') === 'delete,duplicate,move-up,move-down,undo,redo', got.join(','));

  // No selection: structure keys do nothing, undo still forwards.
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.__shortcuts = []; });
  await page.keyboard.press('Delete');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  const idle = await page.evaluate(() => window.__shortcuts.slice());
  check('without a selection only undo is forwarded', idle.join(',') === 'undo', idle.join(','));

  // In-place text editing owns its keys: Backspace deletes a character.
  await page.evaluate(() => { window.__shortcuts = []; });
  await frame.locator('.card >> nth=0 >> p').click();
  await page.waitForTimeout(100);
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(100);
  const typing = await page.evaluate(() => window.__shortcuts.slice());
  const text = await frame.evaluate(() => document.querySelectorAll('.card p')[0].innerText);
  check('Backspace while typing edits text, not the element', typing.length === 0 && text === 'Loads in a blink', `${typing.join(',')} "${text}"`);
  await page.keyboard.press('Escape');
}

await browser.close();
console.log(failures ? `\n${failures} failure(s)` : '\nall click-edit structure checks passed');
process.exit(failures ? 1 : 0);
