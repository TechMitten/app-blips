// Run: node testing/testEmbeddedScreenshot.js
// A screenshot covers the whole page: the embedded browser scrolls a screen at
// a time from the top to the bottom, captures each, then scrolls back to where
// the page was. The first screenshot of a page covers every screen size, and
// one of a page and size that hasn't changed takes no new images.
import assert from 'node:assert/strict';
import { createEmbeddedBrowser, MAX_SCREENS_PER_SIZE } from '../src/lib/embeddedBrowser.js';

const fakePage = (heights, { visibleHeight = 600, screen = 'desktop' } = {}) => {
  let scrollY = 0;
  let size = screen;
  let page = 'index.html';
  const shots = [];
  const viewports = [];
  const pageHeight = () => heights[size];
  const viewport = () => ({ width: size === 'mobile' ? 390 : 1280, height: 800, scrollY, pageHeight: pageHeight(), visibleHeight,
    atBottom: scrollY + visibleHeight >= pageHeight() - 1 });
  const browser = createEmbeddedBrowser({
    mount() {},
    inspect: async () => ({ readyState: 'complete', errors: [], viewport: viewport() }),
    request: async (args) => {
      if (args.action !== 'scroll') return { success: true };
      assert.ok(Math.abs(args.y) <= 5000);
      const before = scrollY;
      scrollY = Math.max(0, Math.min(Math.max(0, pageHeight() - visibleHeight), scrollY + args.y));
      return { success: true, scrolledBy: scrollY - before };
    },
    screenshot: async () => { shots.push(`${size}@${scrollY}`); return { dataUrl: `data:image/png;base64,${size}${scrollY}` }; },
    setViewport: (next) => { viewports.push(next); size = next; },
    navigate: (next) => { page = next; scrollY = 0; },
    getPage: () => page,
    screen,
  });
  return { browser, shots, viewports, scrollTo: (y) => { scrollY = y; }, get scrollY() { return scrollY; }, get size() { return size; } };
};
const files = { 'index.html': '', 'about.html': '' };

// The first look at a page: every size, top to bottom, back to the user's size.
let page = fakePage({ mobile: 1500, tablet: 500, desktop: 2000 });
await page.browser.open(files);
let result = await page.browser.capturePage();
assert.deepEqual(page.shots, ['mobile@0', 'mobile@560', 'mobile@900', 'tablet@0', 'desktop@0', 'desktop@560', 'desktop@1120', 'desktop@1400']);
assert.deepEqual(result.shots.map((shot) => shot.screen), ['mobile', 'mobile', 'mobile', 'tablet', 'desktop', 'desktop', 'desktop', 'desktop']);
assert.equal(result.shots[2].repeatsPx, 260, 'the last screen says how much it repeats');
assert.equal(result.shots[1].repeatsPx, undefined, 'the normal overlap is not reported');
assert.equal(page.size, 'desktop');
assert.equal(result.screen, 'desktop');
assert.equal(page.scrollY, 0);

// Unchanged page and size: no new images, even after scrolling.
page.shots.length = 0;
await page.browser.execute({ action: 'scroll', y: 500 });
result = await page.browser.execute({ action: 'screenshot' });
assert.deepEqual(result.shots, []);
assert.match(result.alreadyCaptured, /Nothing has changed/);
assert.deepEqual(page.shots, []);

// After a click, only the current size, from the top, and scrolled back.
page.scrollTo(700);
await page.browser.execute({ action: 'click', target: 'e1' });
result = await page.browser.execute({ action: 'screenshot' });
assert.deepEqual(page.shots, ['desktop@0', 'desktop@560', 'desktop@1120', 'desktop@1400']);
assert.equal(page.scrollY, 700, 'scrolled back to where it was');

// A new page gets every size again.
page.shots.length = 0;
await page.browser.execute({ action: 'navigate', text: 'about.html' });
result = await page.browser.execute({ action: 'screenshot' });
assert.deepEqual([...new Set(result.shots.map((shot) => shot.screen))], ['mobile', 'tablet', 'desktop']);

// A very long page stops at the cap and says the page goes on.
page = fakePage({ mobile: 100000, tablet: 100000, desktop: 100000 });
await page.browser.open(files);
result = await page.browser.execute({ action: 'screenshot' });
assert.equal(result.shots.filter((shot) => shot.screen === 'desktop').length, MAX_SCREENS_PER_SIZE);
assert.equal(result.shots.at(-1).pageContinues, true);

console.log('testEmbeddedScreenshot: ok');
