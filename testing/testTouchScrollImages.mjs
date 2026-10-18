// Run: node testing/testTouchScrollImages.mjs  (npx playwright install chromium once)
// In phone/tablet preview the bridge turns mouse drags into touch-style
// scrolling. Pressing on an image used to start the browser's native image
// drag instead, which cancels the pointer and stalls the scroll. Checks that a
// drag starting on an image (and on a linked image) scrolls the page, while an
// element the app marked draggable="true" keeps its own drag and drop.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { injectPreviewBridge } from '../src/previewBridge.js';

const pic = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="teal"/></svg>'
);

const app = `<!DOCTYPE html>
<html><head><style>body{margin:0} img{display:block;width:300px;height:300px}</style></head>
<body>
  <img id="plain" src="${pic}" alt="">
  <a href="#x"><img id="linked" src="${pic}" alt=""></a>
  <div id="dnd" draggable="true" style="height:100px;background:#ccc">drag me</div>
  <div style="height:3000px"></div>
</body></html>`;

const { srcDoc } = injectPreviewBridge(app, { touchEnabled: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent('<iframe sandbox="allow-scripts allow-forms" style="width:360px;height:640px;border:0"></iframe>');
  await page.$eval('iframe', (el, doc) => { el.srcdoc = doc; }, srcDoc);
  const frame = page.frames()[1] || (await page.waitForEvent('frameattached'));
  await page.frameLocator('iframe').locator('#plain').waitFor();
  await frame.waitForFunction(() => document.documentElement.style.cursor === 'grab');

  const scrollY = () => frame.evaluate(() => window.scrollY);
  const swipeUp = async (x, y) => {
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(x, y - i * 20);
    await page.mouse.up();
  };

  await swipeUp(150, 250);
  const afterPlain = await scrollY();
  assert.ok(afterPlain >= 150, `drag on an image scrolls the page (scrollY ${afterPlain})`);

  await frame.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(800); // let momentum from the first swipe die out
  await frame.evaluate(() => window.scrollTo(0, 0));
  await swipeUp(150, 450);
  const afterLinked = await scrollY();
  assert.ok(afterLinked >= 150, `drag on a linked image scrolls the page (scrollY ${afterLinked})`);

  const dndCancelled = await frame.evaluate(() => {
    const ev = new DragEvent('dragstart', { bubbles: true, cancelable: true });
    document.getElementById('dnd').dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  assert.equal(dndCancelled, false, 'draggable="true" elements keep native drag and drop');
} finally {
  await browser.close();
}
console.log('testTouchScrollImages: ok');
