// Headless-browser regression test for in-place (click-to-edit) text editing.
//
//   npx playwright install chromium   # once
//   node testing/testInlineEditVisual.mjs
//
// Reproduces the bug where entering in-place edit mode shifted the text:
// Blink renders a contenteditable host with pre-wrap semantics, so the
// pretty-printed whitespace in generated HTML (normally collapsed away)
// suddenly took up space. This asserts that the element's bounding box and
// innerText are unchanged after entering edit mode, that preformatted
// content is left alone, and that the commit/cancel/revert paths behave.
//
// Uses only the sandboxed-iframe shape the app uses (sandbox without
// allow-same-origin); Playwright reaches the frame over CDP, the parent
// page only ever uses postMessage.

import { chromium } from 'playwright';
import { injectPreviewBridge } from '../src/previewBridge.js';

const FIXTURE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Probe</title>
  <style>
    body { margin: 0; font-family: sans-serif; }
    header { min-height: 200px; display: flex; align-items: center; justify-content: center; background: #1c1917; }
    h1 { font-size: 2.25rem; font-weight: 900; color: #fff; text-align: center; margin: 0; }
    section { padding: 2.5rem 0; display: flex; align-items: center; justify-content: center; gap: 1rem; }
    a { border-radius: 9999px; background: #f59e0b; padding: 0.75rem 1.5rem; font-weight: 700; }
    .wrap { padding: 1.5rem; max-width: 36rem; margin: 0 auto; display: grid; gap: 1rem; }
    pre { background: #f1f5f9; padding: 0.75rem; font-size: 0.875rem; margin: 0; }
    .preserve { white-space: pre; margin: 0; }
  </style>
</head>
<body>
  <header>
    <h1 id="hero">
      Fresh bread, every morning
    </h1>
  </header>

  <section>
    <a id="cta" href="#x">
      Order Now
    </a>
    <p id="para">
      Baked in Bend since 2012 and loved daily.
    </p>
  </section>

  <div class="wrap">
    <p id="nested">
      Hello <strong>world</strong>, welcome <em>back</em>!
    </p>
    <button id="iconbtn" style="display:inline-flex;align-items:center;gap:8px;border:0;border-radius:6px;background:#1e293b;color:#fff;padding:8px 16px">
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="currentColor"/></svg>
      Download
    </button>
    <ul style="margin:0;padding-left:24px">
      <li id="li">
        First item in the list
      </li>
    </ul>
    <p id="wraptext" style="line-height:1.6;margin:0">
      This paragraph is deliberately long so that it wraps onto more than one line inside its container and any layout change becomes obvious.
    </p>
    <pre id="preblock">
  keep   this
    spacing
    </pre>
    <p id="preserve" class="preserve">  spaced   out  </p>
    <span id="outer"> <span id="innerspan">Nested span text</span> </span>
  </div>
</body>
</html>`;

const { srcDoc, token } = injectPreviewBridge(FIXTURE, { touchEnabled: false, aiEnabled: false });

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.setContent(`<!DOCTYPE html><html><body style="margin:0">
<iframe id="f" sandbox="allow-scripts allow-forms allow-popups" style="width:900px;height:800px;border:0"></iframe>
<script>
  window.__token = null;
  window.__commits = [];
  window.__selections = [];
  window.__replyOk = true;
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'element-text-committed') {
      window.__commits.push(e.data.payload);
      e.source.postMessage({ __orion: 'orion-preview-bridge', v: 1, token: window.__token, type: 'inline-edit-result', payload: { ok: window.__replyOk, editId: e.data.payload.editId } }, '*');
    }
    if (e.data && e.data.type === 'element-selected') window.__selections.push(e.data.payload);
  });
  window.__setSrc = (html) => { document.getElementById('f').srcdoc = html; };
</script>
</body></html>`);
await page.evaluate((t) => { window.__token = t; }, token);

let failures = 0;
const fresh = async () => {
  await page.evaluate((html) => window.__setSrc(html), srcDoc);
  const f = page.frames().find((x) => x !== page.mainFrame());
  await f.waitForSelector('#hero', { timeout: 10000 });
  return f;
};
let frame = await fresh();

const rect = (sel) => frame.evaluate((s) => {
  const el = document.querySelector(s);
  const r = el.getBoundingClientRect();
  return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2), html: el.innerHTML, text: el.innerText };
}, sel);

const enable = () => page.evaluate(() => {
  document.getElementById('f').contentWindow.postMessage({ __orion: 'orion-preview-bridge', v: 1, token: window.__token, type: 'set-editing', payload: { enabled: true } }, '*');
});
const disable = () => page.evaluate(() => {
  document.getElementById('f').contentWindow.postMessage({ __orion: 'orion-preview-bridge', v: 1, token: window.__token, type: 'set-editing', payload: { enabled: false } }, '*');
});

const sameBox = (a, b) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
const editState = (sel) => frame.evaluate((s) => {
  const e = document.querySelector(s);
  return { editable: e.hasAttribute('contenteditable'), html: e.innerHTML, text: e.innerText };
}, sel);

// --- in-place stability across element shapes ---
console.log('--- single-click (in-place) stability ---');
for (const sel of ['#hero', '#para', '#nested', '#li', '#wraptext', '#innerspan']) {
  frame = await fresh();
  await enable();
  const before = await rect(sel);
  await frame.locator(sel).click();
  await page.waitForTimeout(120);
  const after = await rect(sel);
  const ok = sameBox(before, after) && before.text === after.text;
  if (!ok) failures++;
  console.log(`${sel.padEnd(12)} ${ok ? 'stable' : 'MOVED/CHANGED'}  htmlAfter=${JSON.stringify(after.html)}`);
}

// --- preformatted content must not be normalized ---
console.log('\n--- preformatted must be left alone ---');
for (const sel of ['#preblock', '#preserve']) {
  frame = await fresh();
  await enable();
  const before = await rect(sel);
  await frame.locator(sel).click();
  await page.waitForTimeout(120);
  const after = await rect(sel);
  const ok = sameBox(before, after) && before.html === after.html;
  if (!ok) failures++;
  console.log(`${sel.padEnd(12)} ${ok ? 'stable/untouched' : 'MOVED/CHANGED'}`);
}

// --- links edit in place on double-click ---
console.log('\n--- double-click link (in-place) stability ---');
frame = await fresh();
await enable();
{
  const before = await rect('#cta');
  await frame.locator('#cta').dblclick();
  await page.waitForTimeout(120);
  const after = await rect('#cta');
  const ok = sameBox(before, after) && before.text === after.text;
  if (!ok) failures++;
  console.log(`#cta         ${ok ? 'stable' : 'MOVED/CHANGED'}  htmlAfter=${JSON.stringify(after.html)}`);
}

// --- commit: payload carries the PRE-edit anchor and the typed text ---
console.log('\n--- commit round trip (type + Enter) ---');
frame = await fresh();
await enable();
await page.evaluate(() => { window.__commits = []; });
await frame.locator('#hero').click();
await page.keyboard.type('Warm rolls');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
{
  const commits = await page.evaluate(() => window.__commits);
  const c = commits[0];
  const ok = c && c.text === 'Fresh bread, every morning' && c.newText === 'Warm rolls' && typeof c.editId === 'number';
  if (!ok) failures++;
  console.log(ok ? `anchor/newText/editId ok: ${JSON.stringify(c.text)} -> ${JSON.stringify(c.newText)}` : `BAD payload: ${JSON.stringify(c)}`);
}

// --- failed apply reverts to the exact original markup ---
console.log('\n--- failed apply reverts to the exact original markup ---');
frame = await fresh();
await enable();
await page.evaluate(() => { window.__commits = []; window.__replyOk = false; });
{
  const before = await rect('#hero');
  await frame.locator('#hero').click();
  await page.keyboard.type('Should revert');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  const after = await rect('#hero');
  const st = await editState('#hero');
  const ok = before.html === after.html && !st.editable && before.text === after.text;
  if (!ok) failures++;
  console.log(`restored=${ok} editable=${st.editable} html=${JSON.stringify(after.html)}`);
}
await page.evaluate(() => { window.__replyOk = true; });

// --- Escape cancels and reports the element as selected (panel escape hatch) ---
console.log('\n--- Escape cancels and reports the element as selected ---');
frame = await fresh();
await enable();
await page.evaluate(() => { window.__selections = []; });
{
  const before = await rect('#para');
  await frame.locator('#para').click();
  await page.keyboard.type('Discard me');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const after = await rect('#para');
  const st = await editState('#para');
  const sels = await page.evaluate(() => window.__selections);
  const ok = before.html === after.html && !st.editable && sels.length === 1 && sels[0].text === 'Baked in Bend since 2012 and loved daily.';
  if (!ok) failures++;
  console.log(`restored=${before.html === after.html && !st.editable} reportedSelection=${sels.length === 1} html=${JSON.stringify(after.html)}`);
}

// --- toggling edit mode off reverts a live edit ---
console.log('\n--- toggling edit mode off reverts a live edit ---');
frame = await fresh();
await enable();
{
  const before = await rect('#hero');
  await frame.locator('#hero').click();
  await page.keyboard.type('Never committed');
  await disable();
  await page.waitForTimeout(200);
  const after = await rect('#hero');
  const st = await editState('#hero');
  const ok = before.html === after.html && !st.editable && before.text === after.text;
  if (!ok) failures++;
  console.log(`restored=${ok} editable=${st.editable} html=${JSON.stringify(after.html)}`);
}

console.log(`\n${failures ? failures + ' FAILURES' : 'ALL CHECKS PASSED'}`);
await browser.close();
process.exitCode = failures ? 1 : 0;
