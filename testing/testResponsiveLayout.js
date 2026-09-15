// Run against Vite: RESPONSIVE_TEST_URL=http://127.0.0.1:5176 node testing/testResponsiveLayout.js
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const viewports = [[320, 568], [360, 640], [390, 844], [430, 932], [667, 375], [844, 390], [768, 1024], [820, 1180], [1024, 768], [1280, 800], [1440, 900]];
const url = process.env.RESPONSIVE_TEST_URL || 'http://127.0.0.1:5175';

async function assertFits(locator, viewport, label) {
  await locator.evaluate(async el => { await Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => {}))); });
  const box = await locator.boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, label + ' is visible');
  assert.ok(box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, label + ' fits: ' + JSON.stringify(box));
}

async function assertNoOverflow(page, label) {
  const overflow = await page.evaluate(() => [...document.querySelectorAll('button, summary, input:not([type=checkbox]):not([type=radio]), textarea')].filter(el => {
    if (!el.checkVisibility() || el.closest('[inert], [aria-hidden="true"], .starter-row, .starter-carousel')) return false;
    const rect = el.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > innerHeight) return false;
    // Help section tabs intentionally scroll horizontally within their rail.
    if (el.closest('[role="tablist"]')) return false;
    return rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1);
  }).map(el => el.getAttribute('aria-label') || el.textContent.trim()));
  assert.deepEqual(overflow, [], label + ' has no overflowing controls');
}

async function openNavigation(page, width, name) {
  if (width < 1024) {
    await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    await page.getByRole('dialog', { name: 'Navigation menu' }).getByRole('button', { name, exact: true }).click();
  } else {
    const labels = { Settings: 'Settings', Help: 'Help', Apps: 'My saved apps', History: 'Show history panel' };
    if (name === 'History') await page.locator('.app-header [data-tour="history"]').click();
    else await page.locator('.app-header').getByRole('button', { name: labels[name], exact: true }).click();
  }
}

try {
  for (const [width, height] of viewports) {
    if (process.env.RESPONSIVE_MIN_WIDTH && width < Number(process.env.RESPONSIVE_MIN_WIDTH)) continue;
    const viewport = { width, height };
    const context = await browser.newContext({ viewport, hasTouch: width < 1024 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      if (window !== window.top) return;
      localStorage.setItem('orion-skip-splash', 'true');
      localStorage.setItem('appblips-tour-v1', 'dismissed');
      localStorage.setItem('orion-show-code-view', 'true');
      const code = '<!doctype html><html><body style="margin:0;background:#e0f2fe"><h1>Responsive fixture</h1><button onclick="this.textContent=123">Try it</button></body></html>';
      localStorage.setItem('orion-projects', JSON.stringify([{ id: 'responsive-fixture', name: 'A very long project name for mobile layout verification', updatedAt: new Date().toISOString(), data: { versions: [0, 1].map(id => ({ id: String(id), code, prompt: 'A long unbroken string: ' + 'example'.repeat(40), reply: 'Ready to preview.', timestamp: '12:00', chatSessionId: 'fixture' })), currentVersionIndex: 1 } }]));
      localStorage.setItem('orion-current-project-id', 'responsive-fixture');
    });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator('#prompt').waitFor();
    await page.locator('#prompt').fill('Keep this draft');
    await assertFits(page.locator('.prompt-input-footer'), viewport, 'Composer');
    await assertNoOverflow(page, 'Chat ' + width);
    if (width < 1024) {
      await page.locator('#prompt').press('Enter');
      assert.equal(await page.locator('#prompt').inputValue(), 'Keep this draft\n');
    }
    await openNavigation(page, width, 'Settings');
    await assertFits(page.locator('.modal-card'), viewport, 'Settings');
    await assertNoOverflow(page, 'Settings ' + width);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await openNavigation(page, width, 'Apps');
    await assertFits(page.locator('.modal-card'), viewport, 'Saved apps');
    await assertNoOverflow(page, 'Saved apps ' + width);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await openNavigation(page, width, 'Help');
    await assertFits(page.locator('.modal-card'), viewport, 'Help');
    await assertNoOverflow(page, 'Help ' + width);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await openNavigation(page, width, 'History');
    await assertFits(page.locator('.history-sidebar'), viewport, 'History');
    await page.getByRole('button', { name: 'Restore version 1 and close history', exact: true }).click();
    if (width < 1024) await page.getByRole('group', { name: 'Workspace view' }).getByRole('button', { name: 'Preview', exact: true }).click();
    await assertNoOverflow(page, 'Preview ' + width);
    const tools = page.getByRole('button', { name: 'Preview tools', exact: true });
    if (await tools.isVisible()) {
      await tools.click();
      await assertFits(page.locator('.preview-tools-menu'), viewport, 'Preview tools');
      await page.locator('.preview-tools-menu').getByRole('button', { name: 'Next version', exact: true }).click();
      for (const mode of ['Desktop', 'Tablet', 'Mobile']) {
        await page.locator('.preview-tools-menu').getByRole('button', { name: mode, exact: true }).click();
        await page.waitForTimeout(600);
        const fits = await page.locator('.preview-canvas').evaluate(el => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1);
        assert.ok(fits, mode + ' auto-fits at ' + width);
      }
      await page.keyboard.press('Escape');
    }
    await page.screenshot({ path: '/tmp/appblips-responsive-' + width + '.png' });
    await page.locator('.preview-tabs').getByRole('button', { name: 'Code', exact: true }).click();
    await assertFits(page.locator('.code-view'), viewport, 'Code view');
    assert.deepEqual(errors, [], 'No runtime errors');
    console.log('Responsive workflows passed at ' + width + 'x' + height);
    await context.close();
  }
} finally {
  await browser.close();
}
