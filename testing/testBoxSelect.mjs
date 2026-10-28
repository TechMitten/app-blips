// Headless-browser test for click-to-edit's group selection: dragging a box
// over the page and Shift+click in the sandboxed preview bridge, then the
// group delete (removeElements) and the group AI prompt
// (buildElementsEditPrompt) on what the bridge reported.
//
//   npx playwright install chromium   # once
//   node testing/testBoxSelect.mjs
//
// Same sandboxed-iframe shape as the app (sandbox without
// allow-same-origin); the parent page only uses postMessage.

import { chromium } from '@playwright/test';
import { injectPreviewBridge } from '../src/previewBridge.js';
import { removeElements, buildElementsEditPrompt } from '../src/lib/directEdits.js';

const FIXTURE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Box select probe</title>
  <style>
    body { margin: 0; font-family: sans-serif; }
    section { padding: 2rem; }
    .cards { display: flex; gap: 2rem; }
    .card { padding: 1rem; border: 1px solid #ccc; width: 10rem; }
    .tall { height: 1600px; }
  </style>
</head>
<body>
  <!-- @section: features -->
  <section id="features">
    <h2>Features</h2>
    <div class="cards">
      <div class="card"><h3>Fast</h3><p>Loads in a blink.</p></div>
      <div class="card"><h3>Safe</h3><p>Nothing leaves your device.</p></div>
      <div class="card"><h3>Free</h3><p>No account needed.</p></div>
    </div>
    <svg class="logo" width="40" height="40"><circle cx="20" cy="20" r="10"/></svg>
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
  window.__msgs = [];
  window.addEventListener('message', (e) => {
    if (!e.data || !e.data.type) return;
    if (/^element|^inline-edit-started/.test(e.data.type)) window.__msgs.push({ type: e.data.type, payload: e.data.payload });
  });
  window.__send = (type, payload) => document.getElementById('f').contentWindow.postMessage(
    { __orion: 'orion-preview-bridge', v: 1, token: window.__token, type, payload }, '*');
  window.__setSrc = (html) => { document.getElementById('f').srcdoc = html; };
</script>
</body></html>`);

  let frame;
  const load = async ({ drag = false, touch = false } = {}) => {
    const injected = injectPreviewBridge(FIXTURE, { touchEnabled: touch });
    await page.evaluate((t) => { window.__token = t; window.__msgs = []; }, injected.token);
    await page.evaluate((h) => window.__setSrc(h), injected.srcDoc);
    await page.waitForTimeout(50);
    frame = page.frames().find((x) => x !== page.mainFrame());
    await frame.waitForSelector('#features', { timeout: 10000 });
    await page.evaluate((p) => window.__send('set-editing', p), { enabled: true, drag });
    await page.waitForTimeout(50);
  };

  const rectOf = (selector) => frame.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }, selector);
  const boxChrome = () => frame.evaluate(() => document.querySelectorAll('[data-orion-drag="marquee"]').length);
  const outlined = () => frame.evaluate(() => [...document.querySelectorAll('[style*="outline"]')].map((n) => n.className || n.tagName));
  const takeMsgs = async () => {
    const msgs = await page.evaluate(() => window.__msgs.splice(0));
    return msgs;
  };

  // Press at `from`, move in steps to `to`, inspect mid-drag, release.
  const boxDrag = async (from, to, { shift = false, during, release = true } = {}) => {
    await takeMsgs();
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.waitForTimeout(50);
    const seen = during ? await during() : null;
    if (release) await page.mouse.up();
    if (shift) await page.keyboard.up('Shift');
    await page.waitForTimeout(100);
    return { seen, msgs: await takeMsgs() };
  };

  // --- a box around the three cards selects the cards, not their contents --
  await load();
  {
    const first = await rectOf('.card:nth-child(1)');
    const last = await rectOf('.card:nth-child(3)');
    const { seen, msgs } = await boxDrag(
      { x: first.left - 8, y: first.top - 8 },
      { x: last.right + 8, y: last.bottom + 8 },
      { during: async () => ({ chrome: await boxChrome(), outlined: await outlined() }) },
    );
    check('dragging draws the selection box', seen?.chrome === 1, JSON.stringify(seen));
    check('the box previews the cards it will select', seen?.outlined.filter((c) => c === 'card').length === 3, JSON.stringify(seen?.outlined));
    const group = msgs.find((m) => m.type === 'elements-selected');
    check('one elements-selected message, nothing else', msgs.length === 1 && !!group, JSON.stringify(msgs.map((m) => m.type)));
    const els = group?.payload.elements || [];
    check('outermost elements only: the three cards', els.length === 3 && els.every((e) => e.attributes?.class === 'card'),
      els.map((e) => `${e.tag}.${e.attributes?.class}`).join(','));
    check('in page order', els.map((e) => e.text.split(' ')[0]).join(',') === 'Fast,Safe,Free');
    check('no outline paint leaks into the payloads', els.every((e) => !/outline/.test(e.outerHTML)));
    check('the box is cleaned up', (await boxChrome()) === 0);
    check('the selected cards wear the selection outline', (await outlined()).filter((c) => c === 'card').length === 3);
    check('no text selection left behind', (await frame.evaluate(() => String(window.getSelection()))) === '');

    const removed = removeElements(FIXTURE, els);
    check('group delete applies', removed.ok, removed.reason || removed.summary);
    check('all three cards are gone, the rest stays',
      removed.ok && !/class="card"/.test(removed.code) && /<div class="cards">\n {4}<\/div>/.test(removed.code) && /<h2>Features<\/h2>/.test(removed.code),
      removed.ok ? removed.code.slice(removed.code.indexOf('<section'), removed.code.indexOf('</section>')) : '');

    const prompt = buildElementsEditPrompt(els, 'make them blue', { code: FIXTURE });
    check('group prompt quotes every element', (prompt.match(/```html/g) || []).length === 3 && /Directly edit all 3 of these elements: make them blue/.test(prompt), prompt);

    // Escape clears the group.
    await frame.focus('body');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);
    const after = await takeMsgs();
    check('Escape clears the group', after.some((m) => m.type === 'element-deselected') && (await outlined()).length === 0,
      JSON.stringify(after.map((m) => m.type)));
  }

  // --- an SVG is one picture; a box around nothing selects nothing ----------
  await load();
  {
    const logo = await rectOf('svg.logo');
    const { msgs } = await boxDrag({ x: logo.left - 6, y: logo.top - 6 }, { x: logo.right + 6, y: logo.bottom + 6 });
    const sel = msgs.find((m) => m.type === 'element-selected');
    check('a box around one element selects just it', msgs.length === 1 && sel?.payload.tag === 'svg', JSON.stringify(msgs.map((m) => m.type + ':' + m.payload?.tag)));

    const tall = await rectOf('.tall');
    const empty = await boxDrag({ x: tall.left + 100, y: tall.top + 20 }, { x: tall.left + 300, y: tall.top + 120 });
    check('an empty box deselects', empty.msgs.length === 1 && empty.msgs[0].type === 'element-deselected', JSON.stringify(empty.msgs.map((m) => m.type)));
  }

  // --- Escape mid-drag cancels and keeps the old selection -----------------
  await load();
  {
    const logo = await rectOf('svg.logo');
    await boxDrag({ x: logo.left - 6, y: logo.top - 6 }, { x: logo.right + 6, y: logo.bottom + 6 });
    const first = await rectOf('.card:nth-child(1)');
    await takeMsgs();
    await page.mouse.move(first.left - 8, first.top - 8);
    await page.mouse.down();
    await page.mouse.move(first.right + 8, first.bottom + 8, { steps: 6 });
    await page.waitForTimeout(50);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.waitForTimeout(100);
    const msgs = await takeMsgs();
    check('Escape cancels the box without a message', msgs.length === 0 && (await boxChrome()) === 0, JSON.stringify(msgs.map((m) => m.type)));
    check('the previous selection is painted back', (await outlined()).includes('logo'), JSON.stringify(await outlined()));
  }

  // --- Shift+click builds a group one element at a time --------------------
  await load();
  {
    const shiftClick = async (selector) => {
      const r = await rectOf(selector);
      await page.keyboard.down('Shift');
      await page.mouse.click(r.left + 5, r.top + 5);
      await page.keyboard.up('Shift');
      await page.waitForTimeout(60);
      return takeMsgs();
    };
    const one = await shiftClick('.card:nth-child(1)');
    check('Shift+click on nothing selected selects one element (no text editing)',
      one.length === 1 && one[0].type === 'element-selected', JSON.stringify(one.map((m) => m.type)));
    const two = await shiftClick('.card:nth-child(2) h3');
    const g = two.find((m) => m.type === 'elements-selected');
    check('a second Shift+click makes a group of two', two.length === 1 && g?.payload.elements.length === 2,
      JSON.stringify(two.map((m) => m.type)));
    const back = await shiftClick('.card:nth-child(2) h3');
    check('Shift+clicking a member again takes it out', back.length === 1 && back[0].type === 'element-selected', JSON.stringify(back.map((m) => m.type)));

    // Shift+drag adds the box's elements to the selection.
    const second = await rectOf('.card:nth-child(2)');
    const third = await rectOf('.card:nth-child(3)');
    const added = await boxDrag({ x: second.left - 8, y: second.top - 8 }, { x: third.right + 8, y: third.bottom + 8 }, { shift: true });
    const ag = added.msgs.find((m) => m.type === 'elements-selected');
    check('Shift+drag adds to the selection', ag?.payload.elements.length === 3, JSON.stringify(added.msgs.map((m) => m.type)));

    // A plain click starts over.
    const logo = await rectOf('svg.logo');
    await page.mouse.click(logo.left + 20, logo.top + 20);
    await page.waitForTimeout(60);
    const plain = await takeMsgs();
    check('a plain click replaces the group with one element',
      plain.length === 1 && plain[0].payload.tag === 'svg' && (await outlined()).filter((c) => c === 'card').length === 0,
      JSON.stringify(plain.map((m) => m.type)));
  }

  // --- a short press on text still edits it in place -----------------------
  await load();
  {
    const h2 = await rectOf('#features h2');
    await page.mouse.click(h2.left + 10, h2.top + 5);
    await page.waitForTimeout(80);
    const msgs = await takeMsgs();
    check('a click on a heading still starts in-place editing', msgs.some((m) => m.type === 'inline-edit-started'), JSON.stringify(msgs.map((m) => m.type)));
  }

  // --- drag mode moves elements: no box ------------------------------------
  await load({ drag: true });
  {
    const tall = await rectOf('.tall');
    const { seen } = await boxDrag({ x: tall.left + 100, y: tall.top + 20 }, { x: tall.left + 300, y: tall.top + 120 },
      { during: boxChrome });
    check('drag mode never draws a box', seen === 0);
  }

  // --- phone/tablet previews: a plain drag scrolls, Shift+drag boxes --------
  await load({ touch: true });
  {
    const first = await rectOf('.card:nth-child(1)');
    const plain = await boxDrag({ x: first.left + 20, y: first.top + 60 }, { x: first.left + 20, y: first.top - 40 }, { during: boxChrome });
    check('touch simulation: a plain drag draws no box', plain.seen === 0);
    await frame.evaluate(() => window.scrollTo(0, 0));
    const f = await rectOf('.card:nth-child(1)');
    const l = await rectOf('.card:nth-child(3)');
    const shifted = await boxDrag({ x: f.left - 8, y: f.top - 8 }, { x: l.right + 8, y: l.bottom + 8 }, { shift: true, during: boxChrome });
    const g = shifted.msgs.find((m) => m.type === 'elements-selected');
    check('touch simulation: Shift+drag draws the box and selects', shifted.seen === 1 && g?.payload.elements.length === 3,
      JSON.stringify(shifted.msgs.map((m) => m.type)));
  }
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
if (failures) process.exitCode = 1;
