// Headless-browser check: with part of the text highlighted in a click-to-edit
// session, a toolbar format applies to that part only, and the commit carries
// the styled markup (innerHtml) for the source.
//
//   npx playwright install chromium   # once
//   node testing/testInlinePartialFormat.mjs

import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { injectPreviewBridge } from '../src/previewBridge.js';

const FIXTURE = `<!DOCTYPE html><html><body style="margin:0">
<h1 id="h" style="color:#fff;background:#222">Born in the <span id="o" style="color:#f60">dark</span>, played loud.</h1>
<p id="p">Hello big world</p>
</body></html>`;

const { srcDoc, token } = injectPreviewBridge(FIXTURE, { touchEnabled: false, aiEnabled: false });
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent(`<!DOCTYPE html><html><body style="margin:0">
<iframe id="f" sandbox="allow-scripts allow-forms allow-popups" style="width:900px;height:400px;border:0"></iframe>
<script>
  window.__token = null; window.__commits = [];
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'element-text-committed') {
      window.__commits.push(e.data.payload);
      e.source.postMessage({ __orion: 'orion-preview-bridge', v: 1, token: window.__token, type: 'inline-edit-result', payload: { ok: true, editId: e.data.payload.editId } }, '*');
    }
  });
</script></body></html>`);
  await page.evaluate((t) => { window.__token = t; }, token);
  await page.evaluate((html) => { document.getElementById('f').srcdoc = html; }, srcDoc);
  const frame = page.frames().find((x) => x !== page.mainFrame());
  await frame.waitForSelector('#p');
  const send = (type, payload) => page.evaluate(([t, p]) => document.getElementById('f').contentWindow.postMessage({ __orion: 'orion-preview-bridge', v: 1, token: window.__token, type: t, payload: p }, '*'), [type, payload]);
  await send('set-editing', { enabled: true });

  await frame.locator('#p').click();
  await page.waitForTimeout(150);
  // Highlight "big" only.
  await frame.evaluate(() => {
    const t = document.querySelector('#p').firstChild;
    const r = document.createRange();
    r.setStart(t, 6); r.setEnd(t, 9);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.waitForTimeout(100);
  await send('inline-format', { styles: { color: '#ff0000' } });
  await page.waitForTimeout(150);
  const live = await frame.evaluate(() => ({ elColor: getComputedStyle(document.querySelector('#p')).color, html: document.querySelector('#p').innerHTML }));
  assert.match(live.html, /<span[^>]*style="[^"]*color: rgb\(255, 0, 0\)[^"]*"[^>]*>big<\/span>/);
  assert.notEqual(live.elColor, 'rgb(255, 0, 0)', 'the whole paragraph must not change color');

  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => window.__commits.length > 0, null, { timeout: 4000 });
  const commit = await page.evaluate(() => window.__commits[0]);
  assert.equal(commit.innerHtml, 'Hello <span style="color: rgb(255, 0, 0);">big</span> world');
  assert.deepEqual(commit.styles, {});
  console.log('ok - partial selection formats only the highlighted text');
} finally {
  await browser.close();
}
