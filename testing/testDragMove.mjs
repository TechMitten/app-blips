// Headless-browser test for click-to-edit's drag mode, end to end: a real
// mouse drags elements in the sandboxed preview bridge, the bridge's
// element-drop payload is fed to the deterministic engine
// (applyDirectEdit's `moveTo`), and the result is rendered again to prove it
// moved what it says.
//
//   npx playwright install chromium   # once
//   node testing/testDragMove.mjs
//
// Same sandboxed-iframe shape as the app (sandbox without
// allow-same-origin); the parent page only uses postMessage.

import { chromium } from '@playwright/test';
import { injectPreviewBridge } from '../src/previewBridge.js';
import { applyDirectEdit } from '../src/lib/directEdits.js';

const FIXTURE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Drag probe</title>
  <style>
    body { margin: 0; font-family: sans-serif; }
    section { padding: 2rem; }
    .cards { display: flex; gap: 2rem; }
    .card { padding: 1rem; border: 1px solid #ccc; width: 10rem; }
    img { display: block; width: 120px; height: 80px; }
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
      <div class="card"><h3>Free</h3><p>No account needed.</p></div>
    </div>
    <img src="https://example.test/photo.jpg" class="shot" alt="Shot">
    <ul class="steps">
      <li>Sign up</li>
      <li>Build</li>
    </ul>
  </section>

  <!-- @section: pricing -->
  <section id="pricing">
    <h2>Pricing</h2>
    <p>One plan.</p>
  </section>

  <div class="tall"></div>
  <footer id="foot"><p>Footer note</p></footer>
</body>
</html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.setContent(`<!DOCTYPE html><html><body style="margin:0">
<iframe id="f" sandbox="allow-scripts allow-forms allow-popups" style="width:1000px;height:700px;border:0;display:block"></iframe>
<script>
  window.__token = null;
  window.__selections = [];
  window.__drops = [];
  window.addEventListener('message', (e) => {
    if (!e.data) return;
    if (e.data.type === 'element-selected') window.__selections.push(e.data.payload);
    if (e.data.type === 'element-drop') window.__drops.push(e.data.payload);
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
const setModes = async (enabled, drag) => {
  await page.evaluate((p) => window.__send('set-editing', p), { enabled, drag });
  await page.waitForTimeout(50);
};
const load = async (html, { drag = true } = {}) => {
  const injected = injectPreviewBridge(html, { touchEnabled: false });
  await page.evaluate((t) => { window.__token = t; window.__selections = []; window.__drops = []; }, injected.token);
  await page.evaluate((h) => window.__setSrc(h), injected.srcDoc);
  await page.waitForTimeout(50);
  frame = page.frames().find((x) => x !== page.mainFrame());
  await frame.waitForSelector('#features', { timeout: 10000 });
  await setModes(true, drag);
};
const fresh = (opts) => load(FIXTURE, opts);

// The iframe sits at the page origin, so frame coordinates are page ones.
const rectOf = (selector) => frame.evaluate((s) => {
  const r = document.querySelector(s).getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
}, selector);

const chrome = () => frame.evaluate(() => [...document.querySelectorAll('div[data-orion-bridge]')].map((d) => ({
  display: d.style.display, width: parseFloat(d.style.width), height: parseFloat(d.style.height),
})));

// Press at `from`, move in steps to `to`, optionally inspect mid-drag, release.
const dragBetween = async (from, to, { during, release = true } = {}) => {
  await page.evaluate(() => { window.__drops = []; window.__selections = []; });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  const seen = during ? await during() : null;
  if (release) await page.mouse.up();
  await page.waitForTimeout(80);
  const drops = await page.evaluate(() => window.__drops.slice());
  const selections = await page.evaluate(() => window.__selections.slice());
  return { seen, drops, selections };
};

const order = (html, selector) => {
  const texts = [];
  const re = new RegExp(`<${selector}>([^<]*)<`, 'g');
  let m;
  while ((m = re.exec(html))) texts.push(m[1]);
  return texts.join(',');
};

// --- reorder cards in a flex row: vertical insertion line, drop after -------
await fresh();
{
  const fast = await rectOf('.card:nth-child(1)');
  const free = await rectOf('.card:nth-child(3)');
  const { seen, drops } = await dragBetween(
    { x: fast.left + 4, y: fast.top + 4 },
    { x: free.right - 10, y: free.top + free.height / 2 },
    { during: chrome },
  );
  const line = seen?.find((c) => c.display === 'block');
  check('drag shows a ghost and an insertion line', seen?.length === 2 && !!line, JSON.stringify(seen));
  check('row layout gets a vertical line', line && line.height > line.width, JSON.stringify(line));
  check('one drop is reported', drops.length === 1, `${drops.length}`);
  const drop = drops[0];
  check('card drop targets the last card, after it', drop?.target?.text === 'Free No account needed.' && drop?.position === 'after',
    `${drop?.target?.text} / ${drop?.position}`);
  check('dragged snapshot is the card', drop?.element?.tag === 'div' && /^Fast/.test(drop?.element?.text || ''));
  check('no outline paint leaks into the drop payload', drop && !/outline/.test(drop.element.outerHTML + drop.target.outerHTML));
  const result = drop && applyDirectEdit(FIXTURE, drop.element, { moveTo: { target: drop.target, position: drop.position } });
  check('card drop applies', result?.ok, result?.reason || result?.summary);
  check('cards reordered in source', result?.ok && order(result.code, 'h3') === 'Safe,Free,Fast', result?.ok && order(result.code, 'h3'));
  check('drag chrome is cleaned up', (await chrome()).length === 0);
  check('the click after a drag does not select', (await page.evaluate(() => window.__selections.length)) === 0);
}

// --- image to the top of the section: horizontal line, drop before ----------
await fresh();
{
  const img = await rectOf('img.shot');
  const h2 = await rectOf('#features h2');
  const { seen, drops } = await dragBetween(
    { x: img.left + 20, y: img.top + 20 },
    { x: h2.left + 30, y: h2.top + 3 },
    { during: chrome },
  );
  const line = seen?.find((c) => c.display === 'block');
  check('column layout gets a horizontal line', line && line.width > line.height, JSON.stringify(line));
  const drop = drops[0];
  check('image drop targets the heading, before it', drop?.element?.tag === 'img' && drop?.target?.tag === 'h2' && drop?.position === 'before',
    `${drop?.element?.tag} -> ${drop?.target?.tag} ${drop?.position}`);
  const result = drop && applyDirectEdit(FIXTURE, drop.element, { moveTo: { target: drop.target, position: drop.position } });
  check('image drop applies', result?.ok, result?.reason || result?.summary);
  check('image now precedes the heading, re-indented',
    result?.ok && /<section id="features">\n {4}<img src="https:\/\/example\.test\/photo\.jpg" class="shot" alt="Shot">\n {4}<h2>Features<\/h2>/.test(result.code));
}

// --- an image can be dropped into a card nested in its sibling row ---------
await fresh();
{
  const img = await rectOf('img.shot');
  const safeP = await rectOf('.card:nth-child(2) p');
  const { drops } = await dragBetween(
    { x: img.left + 20, y: img.top + 20 },
    { x: safeP.left + 10, y: safeP.bottom - 2 },
  );
  const drop = drops[0];
  check('image targets content inside a sibling row', drop?.target?.tag === 'p' && drop?.position === 'after'
    && /Nothing leaves/.test(drop?.target?.text || ''), `${drop?.target?.tag} ${drop?.position}`);
  const result = drop && applyDirectEdit(FIXTURE, drop.element, { moveTo: { target: drop.target, position: drop.position } });
  check('image lands inside the card', result?.ok
    && /<p>Nothing leaves your device\.<\/p> <img src="https:\/\/example\.test\/photo\.jpg" class="shot" alt="Shot"><\/div>/.test(result.code),
    result?.reason || '');
}

// --- a word inside a paragraph drags its paragraph, into another section ----
await fresh();
{
  const strong = await rectOf('.lede strong');
  const pricingP = await rectOf('#pricing p');
  const { drops } = await dragBetween(
    { x: strong.left + 5, y: strong.top + 5 },
    { x: pricingP.left + 10, y: pricingP.bottom - 3 },
  );
  const drop = drops[0];
  check('inline word promotes to its paragraph', drop?.element?.tag === 'p' && /really/.test(drop?.element?.text || ''), drop?.element?.tag);
  const result = drop && applyDirectEdit(FIXTURE, drop.element, { moveTo: { target: drop.target, position: drop.position } });
  check('paragraph moves into the pricing section',
    result?.ok && /<p>One plan\.<\/p>\n {4}<p class="lede">We are <strong>really<\/strong> fast\.<\/p>\n {2}<\/section>/.test(result.code),
    result?.reason || '');
}

// --- a selected container drags from anywhere inside it ---------------------
await fresh();
{
  const safe = await rectOf('.card:nth-child(2)');
  await frame.locator('.card:nth-child(2)').click({ position: { x: 3, y: 3 } });
  await page.waitForTimeout(50);
  const safeH3 = await rectOf('.card:nth-child(2) h3');
  const fast = await rectOf('.card:nth-child(1)');
  const { drops } = await dragBetween(
    { x: safeH3.left + 5, y: safeH3.top + 5 },
    { x: fast.left + 10, y: fast.top + fast.height / 2 },
  );
  const drop = drops[0];
  check('pressing inside the selection drags the selection', drop?.element?.tag === 'div' && /^Safe/.test(drop?.element?.text || '')
    && /^Fast/.test(drop?.target?.text || '') && drop?.position === 'before', `${drop?.element?.tag} ${drop?.element?.text}`);
  check('selection sanity', safe.width > 0);
}

// --- lists stay valid: a paragraph over a list item drops beside the list ---
await fresh();
{
  const pricingP = await rectOf('#pricing p');
  const li = await rectOf('.steps li:nth-child(1)');
  const { drops } = await dragBetween(
    { x: pricingP.left + 5, y: pricingP.top + 5 },
    { x: li.left + 10, y: li.top + 3 },
  );
  const drop = drops[0];
  check('non-item never lands between list items', drop?.target?.tag === 'ul', drop?.target?.tag);

  const li2 = await rectOf('.steps li:nth-child(2)');
  const { drops: liDrops } = await dragBetween(
    { x: li2.left + 5, y: li2.top + 5 },
    { x: li.left + 10, y: li.top + 2 },
  );
  check('list items reorder among list items', liDrops[0]?.target?.tag === 'li' && liDrops[0]?.position === 'before',
    `${liDrops[0]?.target?.tag} ${liDrops[0]?.position}`);
}

// --- plain clicks, no-op drops, Escape --------------------------------------
await fresh();
{
  const h2 = await rectOf('#pricing h2');
  const { drops, selections } = await dragBetween({ x: h2.left + 5, y: h2.top + 5 }, { x: h2.left + 8, y: h2.top + 6 });
  check('a jitter below the threshold is a click that only selects',
    drops.length === 0 && selections[0]?.tag === 'h2' && !(await frame.evaluate(() => !!document.querySelector('[contenteditable]'))),
    `${drops.length} drops, ${selections.length} selections`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(50);

  const strong = await rectOf('.lede strong');
  const word = await dragBetween({ x: strong.left + 5, y: strong.top + 5 }, { x: strong.left + 5, y: strong.top + 5 });
  check('clicking a word selects its paragraph in drag mode', word.selections[0]?.tag === 'p', word.selections[0]?.tag);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(50);

  const fast = await rectOf('.card:nth-child(1)');
  const safe = await rectOf('.card:nth-child(2)');
  const self = await dragBetween({ x: fast.left + 4, y: fast.top + 4 }, { x: fast.left + 30, y: fast.top + 30 });
  check('dropping on itself reports nothing', self.drops.length === 0);
  const beside = await dragBetween({ x: fast.left + 4, y: fast.top + 4 }, { x: safe.left + 5, y: safe.top + safe.height / 2 });
  check('dropping where it already is reports nothing', beside.drops.length === 0, JSON.stringify(beside.drops[0]?.position));

  const esc = await dragBetween(
    { x: fast.left + 4, y: fast.top + 4 },
    { x: safe.right - 5, y: safe.top + safe.height / 2 },
    { release: false },
  );
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.waitForTimeout(80);
  const afterEsc = await page.evaluate(() => window.__drops.length);
  check('Escape cancels the drag', esc.drops.length === 0 && afterEsc === 0 && (await chrome()).length === 0);
}

// --- auto-scroll near the bottom edge ---------------------------------------
await fresh();
{
  const h2 = await rectOf('#pricing h2');
  await page.mouse.move(h2.left + 5, h2.top + 5);
  await page.mouse.down();
  await page.mouse.move(h2.left + 40, 690, { steps: 8 });
  await page.waitForTimeout(700);
  const scrolled = await frame.evaluate(() => window.scrollY);
  check('holding near the bottom edge scrolls the page', scrolled > 100, `scrollY=${scrolled}`);
  await page.mouse.up();
}

// --- click-to-edit without drag mode never drags ----------------------------
await fresh({ drag: false });
{
  const fast = await rectOf('.card:nth-child(1)');
  const free = await rectOf('.card:nth-child(3)');
  const { drops, seen } = await dragBetween({ x: fast.left + 4, y: fast.top + 4 }, { x: free.right - 10, y: free.top + 20 }, { during: chrome });
  check('no drag outside drag mode', drops.length === 0 && seen.length === 0, `${drops.length} drops`);

  const h2 = await rectOf('#pricing h2');
  await frame.locator('#pricing h2').click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(50);
  check('text still edits in place outside drag mode', await frame.evaluate(() => !!document.querySelector('#pricing h2[contenteditable]')), `${h2.top}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(50);

  // Turning drag mode on keeps the selection, so a picked container drags.
  await page.evaluate(() => { window.__selections = []; });
  await frame.locator('.card:nth-child(3)').click({ position: { x: 3, y: 3 } });
  await page.waitForTimeout(50);
  await setModes(true, true);
  const cursor = await frame.evaluate(() => getComputedStyle(document.querySelector('.card')).cursor);
  check('drag mode shows a grab cursor', cursor === 'grab', cursor);
  const freeH3 = await rectOf('.card:nth-child(3) h3');
  const { drops: kept } = await dragBetween({ x: freeH3.left + 5, y: freeH3.top + 5 }, { x: fast.left + 10, y: fast.top + fast.height / 2 });
  check('selection survives turning drag mode on', kept[0]?.element?.tag === 'div' && /^Free/.test(kept[0]?.element?.text || '')
    && kept[0]?.position === 'before', `${kept[0]?.element?.tag} ${kept[0]?.element?.text}`);

  await setModes(true, false);
  const back = await frame.evaluate(() => getComputedStyle(document.querySelector('.card')).cursor);
  check('turning drag mode off restores the picker cursor', back === 'crosshair', back);
}

// --- turning editing off disables dragging -----------------------------------
await fresh();
{
  await setModes(false, true);
  const fast = await rectOf('.card:nth-child(1)');
  const free = await rectOf('.card:nth-child(3)');
  const { drops } = await dragBetween({ x: fast.left + 4, y: fast.top + 4 }, { x: free.right - 10, y: free.top + 20 });
  check('no drag while editing is off', drops.length === 0);
}

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall drag-to-move checks passed');
process.exitCode = failures ? 1 : 0;
