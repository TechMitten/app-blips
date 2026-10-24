// Run: node testing/testEmbeddedScreenshot.js
// A screenshot is one image of the current screen size. With an element ID
// as target it scrolls that element into view first, then scrolls back to
// where the page was. It never switches screen size or captures the whole page.
import assert from 'node:assert/strict';
import { createEmbeddedBrowser } from '../src/lib/embeddedBrowser.js';

const fakePage = ({ pageHeight = 2000, visibleHeight = 600, screen = 'desktop', elements = { e1: 1500 } } = {}) => {
  let scrollY = 0;
  const shots = [];
  const viewports = [];
  const scrollTo = (y) => { scrollY = Math.max(0, Math.min(pageHeight - visibleHeight, y)); };
  const viewport = () => ({ width: 1280, height: 800, scrollY, pageHeight, visibleHeight, atBottom: scrollY + visibleHeight >= pageHeight - 1 });
  const browser = createEmbeddedBrowser({
    mount() {},
    inspect: async () => ({ readyState: 'complete', errors: [], viewport: viewport() }),
    request: async (args) => {
      if (args.action === 'target') {
        if (!(args.target in elements)) throw new Error('Element is no longer available. Inspect the page again.');
        // Like the runtime: scrolled into view before the covered check.
        scrollTo(elements[args.target] - visibleHeight / 2);
        if (args.target === 'covered') throw new Error('Element is covered by another element.');
        return { success: true };
      }
      if (args.action !== 'scroll') return { success: true };
      const before = scrollY;
      scrollTo(scrollY + args.y);
      return { success: true, scrolledBy: scrollY - before };
    },
    screenshot: async () => { shots.push(scrollY); return { dataUrl: `data:image/png;base64,${scrollY}` }; },
    setViewport: (next) => viewports.push(next),
    navigate() {},
    getPage: () => 'index.html',
    screen,
  });
  return { browser, shots, viewports, scrollTo, get scrollY() { return scrollY; } };
};
const files = { 'index.html': '' };

// No target: what is on screen now, and nothing else.
let page = fakePage();
await page.browser.open(files);
page.scrollTo(300);
let result = await page.browser.execute({ action: 'screenshot', target: null });
assert.deepEqual(page.shots, [300]);
assert.equal(result.shots.length, 1);
assert.equal(result.shots[0].screen, 'desktop');
assert.equal(result.shots[0].scrollY, 300);
assert.deepEqual(page.viewports, [], 'never switches screen size');

// A target is brought into view for the image, then the page scrolls back.
result = await page.browser.execute({ action: 'screenshot', target: 'e1' });
assert.deepEqual(page.shots, [300, 1200]);
assert.equal(result.shots[0].scrollY, 1200);
assert.equal(page.scrollY, 300, 'scrolled back to where it was');

// A covered element can be the problem itself, so it is still photographed;
// an element that no longer exists is an error.
page = fakePage({ elements: { covered: 1000 } });
await page.browser.open(files);
result = await page.browser.execute({ action: 'screenshot', target: 'covered' });
assert.deepEqual(page.shots, [700]);
await assert.rejects(page.browser.execute({ action: 'screenshot', target: 'gone' }), /no longer available/);

console.log('testEmbeddedScreenshot: ok');
