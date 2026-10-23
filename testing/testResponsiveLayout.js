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

// Below lg every control is a thumb target. 44px is the WCAG 2.2 / iOS
// minimum; the app's own mobile CSS is written to hit it.
async function assertTapTargets(page, width, label) {
  if (width >= 1024) return;
  const small = await page.evaluate(() => [...document.querySelectorAll('button, a[href], input:not([type=checkbox]):not([type=radio]), select, summary, [role="button"]')].filter(el => {
    if (!el.checkVisibility() || el.closest('[inert], [aria-hidden="true"]')) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44);
  }).map(el => (el.getAttribute('aria-label') || el.textContent.trim()).slice(0, 40) + ' ' + Math.round(el.getBoundingClientRect().width) + 'x' + Math.round(el.getBoundingClientRect().height)));
  assert.deepEqual(small, [], label + ' has no sub-44px tap targets');
}

// The phone layout budget: below lg the Chat/Preview switch and the new-chat
// key live in the app header, so the header is the ONLY chrome band above the
// content. Regressing to a second band costs ~20% of the screen.
async function assertChromeBudget(page, width) {
  if (width >= 1024) return;
  const used = await page.evaluate(() => ['.app-header', '.mobile-view-switch', '.build-panel-header']
    .reduce((total, sel) => {
      const el = document.querySelector(sel);
      return total + (el && el.checkVisibility() ? el.getBoundingClientRect().height : 0);
    }, 0));
  assert.ok(used <= 72, 'chrome above the chat stage is ' + Math.round(used) + 'px at ' + width + ' (budget 72)');
}

// On a phone the default preset renders bare, so the sandboxed frame should
// span the pane instead of being letterboxed inside a simulated handset.
async function assertPreviewFills(page, width) {
  if (width >= 1024) return;
  // The device shell animates its width/height over 500ms when it switches
  // into fill mode, so poll until the measurement stops moving.
  const gap = await page.evaluate(async () => {
    const pane = document.querySelector('.preview-canvas');
    if (!pane) return null;
    const read = () => {
      const frame = document.querySelector('.preview-canvas iframe');
      return frame ? Math.round(pane.getBoundingClientRect().width - frame.getBoundingClientRect().width) : null;
    };
    let last = read();
    for (let i = 0; i < 40; i += 1) {
      await new Promise(r => setTimeout(r, 50));
      const next = read();
      if (next !== null && next === last) return next;
      last = next;
    }
    return last;
  });
  if (gap === null) return;
  assert.ok(gap <= 16, 'bare preview fills the pane at ' + width + ' (gap ' + gap + 'px)');
}

// Help points at the docs in a new tab. Clicking it would navigate away, so
// this only checks that it is on screen and has an href.
async function assertHelpLink(page, width, viewport) {
  if (width < 1024) {
    await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Navigation menu' });
    // The drawer slides in via a transform on the dialog itself, so waiting on
    // the link's own animations would measure it mid-slide.
    await dialog.evaluate(async el => { await Promise.all(el.getAnimations().map(a => a.finished.catch(() => {}))); });
    const link = dialog.getByRole('link', { name: 'Help', exact: true });
    await assertFits(link, viewport, 'Help link');
    assert.ok(await link.getAttribute('href'), 'Help link has an href');
    await dialog.getByRole('button', { name: 'Close menu', exact: true }).click();
    await page.waitForTimeout(350);
  } else {
    const link = page.locator('.app-header').getByRole('link', { name: 'Help', exact: true });
    await assertFits(link, viewport, 'Help link');
    assert.ok(await link.getAttribute('href'), 'Help link has an href');
  }
}

async function openNavigation(page, width, name) {
  if (width < 1024) {
    await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    const menu = page.getByRole('dialog', { name: 'Navigation menu' });
    // Match on the accessible name, not text: Apps/History carry a count badge.
    await menu.getByRole('button', { name, exact: true }).click();
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
    await assertTapTargets(page, width, 'Chat ' + width);
    await assertChromeBudget(page, width);
    if (width < 1024) {
      await page.locator('#prompt').press('Enter');
      assert.equal(await page.locator('#prompt').inputValue(), 'Keep this draft\n');
    }
    await openNavigation(page, width, 'Settings');
    await assertFits(page.locator('.modal-card'), viewport, 'Settings');
    await assertNoOverflow(page, 'Settings ' + width);
    // All four category tabs have to be reachable without a hidden
    // horizontal scroll: below sm the rail is a 2x2 grid for that reason.
    const strayTabs = await page.evaluate(() => {
      const card = document.querySelector('.modal-card');
      const box = card.getBoundingClientRect();
      return [...card.querySelectorAll('[role="tab"]')]
        .filter(tab => { const r = tab.getBoundingClientRect(); return r.left < box.left - 1 || r.right > box.right + 1; })
        .map(tab => tab.textContent.trim());
    });
    assert.deepEqual(strayTabs, [], 'Settings tabs all fit the card at ' + width);
    await assertTapTargets(page, width, 'Settings ' + width);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await openNavigation(page, width, 'Apps');
    await assertFits(page.locator('.modal-card'), viewport, 'Saved apps');
    await assertNoOverflow(page, 'Saved apps ' + width);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    // Help is no longer a modal -- it is an external docs link that opens in a
    // new tab, so assert it is present and reachable rather than clicking it.
    await assertHelpLink(page, width, viewport);
    await openNavigation(page, width, 'History');
    await assertFits(page.locator('.history-sidebar'), viewport, 'History');
    await page.getByRole('button', { name: 'Restore version 1 and close history', exact: true }).click();
    if (width < 1024) await page.getByRole('group', { name: 'Workspace view' }).getByRole('button', { name: 'Preview', exact: true }).click();
    await assertNoOverflow(page, 'Preview ' + width);
    await assertTapTargets(page, width, 'Preview ' + width);
    await assertPreviewFills(page, width);
    const tools = page.getByRole('button', { name: 'Preview tools', exact: true });
    if (await tools.isVisible()) {
      await tools.click();
      await assertFits(page.locator('.preview-tools-menu'), viewport, 'Preview tools');
      await page.locator('.preview-tools-menu').getByRole('button', { name: 'Next version', exact: true }).click();
      for (const mode of ['Desktop', 'Tablet', 'Smartphone']) {
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
