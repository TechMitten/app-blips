// Run against the local dev server: TOUR_TEST_URL=http://127.0.0.1:5176 node testing/testGuidedTour.js
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 667, height: 375 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.addInitScript(() => { if (window === window.top) localStorage.setItem('orion-skip-splash', 'true'); });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.TOUR_TEST_URL || 'http://127.0.0.1:5175');
    await page.locator('#prompt').fill('Keep my draft unchanged');
    await page.getByRole('button', { name: 'Take a quick tour', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Start with an idea', exact: true });
    await dialog.waitFor();
    await page.waitForFunction(() => document.activeElement?.classList.contains('tour-card'));
    assert.equal(await page.locator('#root').evaluate(el => el.inert), true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Next');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Close tour');
    for (let index = 0; index < 8; index++) {
      const card = page.locator('.tour-card');
      await page.getByText(`Step ${index + 1} of 8`, { exact: true }).waitFor();
      await page.locator('.tour-spotlight').waitFor();
      const box = await card.boundingBox();
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `Card fits ${viewport.width} at step ${index + 1}`);
      assert.ok(await page.locator('.tour-spotlight').count(), 'Visible target has a spotlight');
      if (index === 3) await card.getByRole('heading', { name: /Take your app with you|Share a live app/ }).waitFor();
      await card.getByRole('button', { name: index === 7 ? 'Finish' : 'Next', exact: true }).click();
    }
    await page.locator('.tour-card').waitFor({ state: 'detached' });
    assert.equal(await page.locator('#root').evaluate(el => el.inert), false);
    assert.equal(await page.locator('#prompt').inputValue(), 'Keep my draft unchanged');
    assert.equal(await page.locator('#prompt').isVisible(), true);
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    await page.getByRole('button', { name: 'Start guided tour', exact: true }).click();
    await page.getByRole('button', { name: 'Go to step 7: Make the workspace yours' }).click();
    await page.getByText('Step 7 of 8', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByText('Step 6 of 8', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.tour-card').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Help');
    await page.reload();
    await page.getByRole('button', { name: 'Help', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Take a quick tour', exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log(`Tour passed at ${viewport.width} × ${viewport.height}`);
    await context.close();
  }
} finally {
  await browser.close();
}
