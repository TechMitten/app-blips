// Touch regression: with click-to-edit on a phone, a second tap inside the
// text being edited must move the caret, not end the session.
//   node testing/testInlineEditTouch.mjs
import { chromium } from '@playwright/test';
import { injectPreviewBridge } from '../src/previewBridge.js';

const FIXTURE = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;font:18px sans-serif}p{margin:20px;line-height:1.6}</style></head><body>
<p id="long">This paragraph is deliberately long so that it wraps onto several lines on a phone and the user can tap different places inside it.</p>
<p id="nest">Hello <strong id="st">bold words here</strong> and <a id="lk" href="#x">a link inside</a> then plain tail text.</p>
<p id="other">A second paragraph further down the page.</p></body></html>`;

const { srcDoc, token } = injectPreviewBridge(FIXTURE, { touchEnabled: true, aiEnabled: false });
const browser = await chromium.launch();
let failures = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.setContent(`<!DOCTYPE html><html><body style="margin:0">
<iframe id="f" sandbox="allow-scripts allow-forms allow-popups" style="width:390px;height:700px;border:0"></iframe>
<script>window.__token=null;window.__ended=0;
window.addEventListener('message',e=>{if(e.data&&e.data.type==='inline-edit-ended')window.__ended++;
if(e.data&&e.data.type==='element-text-committed')e.source.postMessage({__orion:'orion-preview-bridge',v:1,token:window.__token,type:'inline-edit-result',payload:{ok:true,editId:e.data.payload.editId}},'*');});
window.__setSrc=h=>{document.getElementById('f').srcdoc=h};</script></body></html>`);
  await page.evaluate((t) => { window.__token = t; }, token);
  await page.evaluate((h) => window.__setSrc(h), srcDoc);
  const frame = page.frames().find((x) => x !== page.mainFrame());
  await frame.waitForSelector('#long');
  await page.evaluate(() => document.getElementById('f').contentWindow.postMessage({ __orion: 'orion-preview-bridge', v: 1, token: window.__token, type: 'set-editing', payload: { enabled: true } }, '*'));
  const box = await frame.locator('#long').boundingBox();
  const state = () => frame.evaluate(() => {
    const e = document.querySelector('#long'); const s = getSelection();
    return { editable: e.hasAttribute('contenteditable'), off: s.anchorNode ? s.anchorOffset : -1, focus: document.activeElement === e };
  });
  await page.touchscreen.tap(box.x + 60, box.y + 12);
  await page.waitForTimeout(500);
  const a = await state();
  await page.touchscreen.tap(box.x + 250, box.y + 45);
  await page.waitForTimeout(600);
  const b = await state();
  console.log('after tap 1', a, '\nafter tap 2', b);
  const ok = a.editable && b.editable && b.off !== a.off;
  if (!ok) failures++;
  // typed text, then a second tap in the same paragraph
  await page.evaluate((h) => window.__setSrc(h), srcDoc);
  await frame.waitForTimeout(600);
  await page.evaluate(() => document.getElementById('f').contentWindow.postMessage({ __orion: 'orion-preview-bridge', v: 1, token: window.__token, type: 'set-editing', payload: { enabled: true } }, '*'));
  const tb = await frame.locator('#long').boundingBox();
  await page.touchscreen.tap(tb.x + 60, tb.y + 12);
  await page.waitForTimeout(400);
  await page.keyboard.type('XYZ');
  await page.waitForTimeout(500);
  await page.touchscreen.tap(tb.x + 250, tb.y + 45);
  await page.waitForTimeout(700);
  const ts = await state();
  const tok = ts.editable && ts.focus;
  if (!tok) failures++;
  console.log('typed then tap', JSON.stringify(ts), tok ? 'ok' : 'FAIL');
  // tap on a child inline element, then on a different paragraph
  for (const [first, second] of [['#nest', '#st'], ['#nest', '#lk'], ['#long', '#other']]) {
    await page.evaluate((h) => window.__setSrc(h), srcDoc);
    await frame.waitForTimeout(600);
    await page.evaluate(() => document.getElementById('f').contentWindow.postMessage({ __orion: 'orion-preview-bridge', v: 1, token: window.__token, type: 'set-editing', payload: { enabled: true } }, '*'));
    const b1 = await frame.locator(first).boundingBox();
    await page.touchscreen.tap(b1.x + 20, b1.y + 12);
    await page.waitForTimeout(500);
    const b2 = await frame.locator(second).boundingBox();
    await page.touchscreen.tap(b2.x + b2.width / 2, b2.y + b2.height / 2);
    await page.waitForTimeout(700);
    const st = await frame.evaluate(() => ({ editing: [...document.querySelectorAll('[contenteditable]')].map((e) => e.id) }));
    const want = first === '#long' ? second.slice(1) : first.slice(1);
    const good = st.editing.length === 1 && st.editing[0] === want;
    if (!good) failures++;
    console.log(first, '->', second, JSON.stringify(st), good ? 'ok' : 'FAIL');
  }
  console.log(ok ? 'caret moved, still editing' : 'FAIL: edit ended or caret did not move');
} finally {
  await browser.close();
}
process.exit(failures ? 1 : 0);
