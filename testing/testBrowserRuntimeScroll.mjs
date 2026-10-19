// Run: node testing/testBrowserRuntimeScroll.mjs  (npx playwright install chromium once)
// The review's embedded browser scrolls with browserRuntime.act({ action: 'scroll' }).
// Checks it moves a normal long page (even with scroll-behavior: smooth), moves
// the inner container of an app layout that locks the window, and reports
// pageHeight/atBottom so the reviewer knows when it has seen the whole page.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { BROWSER_RUNTIME_SOURCE } from '../src/lib/browserRuntime.js';

const longPage = '<html style="scroll-behavior:smooth"><body style="margin:0"><div style="height:3000px">tall</div></body></html>';
const appLayout = '<body style="margin:0;height:100vh;overflow:hidden"><main style="height:100vh;overflow-y:auto"><div style="height:3000px">tall</div></main></body>';
const shortPage = '<body style="margin:0"><p>short</p></body>';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const act = (args) => page.evaluate(`(() => { ${BROWSER_RUNTIME_SOURCE}; return browserRuntime.act(${JSON.stringify(args)}); })()`);
  const viewport = async () => (await act({ action: 'inspect' })).viewport;

  for (const [name, html] of [['long page', longPage], ['inner scroller', appLayout]]) {
    await page.setContent(html);
    let view = await viewport();
    assert.equal(view.scrollY, 0, name);
    assert.equal(view.pageHeight, 3000, name);
    assert.equal(view.atBottom, false, name);
    assert.equal(view.visibleHeight, 600, `${name} reports one screen of the part that scrolls`);
    const result = await act({ action: 'scroll', y: 500 });
    assert.equal(result.scrolledBy, 500, `${name} scrolls right away`);
    view = await viewport();
    assert.equal(view.scrollY, 500, name);
    await act({ action: 'scroll', y: 5000 });
    view = await viewport();
    assert.equal(view.atBottom, true, name);
    assert.equal(view.scrollY, 3000 - 600, name);
    await act({ action: 'scroll', y: -5000 });
    assert.equal((await viewport()).scrollY, 0, `${name} scrolls back up`);
  }

  await page.setContent(shortPage);
  const view = await viewport();
  assert.equal(view.atBottom, true, 'a page that fits is already at its end');
  assert.equal((await act({ action: 'scroll', y: 300 })).scrolledBy, 0);
  console.log('testBrowserRuntimeScroll: ok');
} finally {
  await browser.close();
}
