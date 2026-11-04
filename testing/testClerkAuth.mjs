// Run with Vite running: node testing/testClerkAuth.mjs
// Verifies the mandatory sign-in modal: it waits for the launch splash
// video, then opens over the app and cannot be closed (no close button,
// Escape and backdrop clicks ignored). The app behind stays inert, and
// sign-up hands off to the hosted page which returns with a session.
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

const url = process.env.STARTUP_TEST_URL || 'http://127.0.0.1:5175';
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    // Skip first-run onboarding so the studio picker is what sits behind
    // the modal, which makes the inert-wrapper assertions deterministic.
    localStorage.setItem('appblips-web-provider', JSON.stringify({ onboardingComplete: true }));
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto(url);

  // While the splash video is up the sign-in modal must stay away.
  const splash = page.locator('video[aria-label="AppBlips"]');
  await splash.waitFor({ state: 'attached', timeout: 15000 });
  assert.equal(await page.locator('[data-localization-key]').count(), 0, 'Modal showed during the splash');
  assert.equal(
    await page.locator('.studio-choice').evaluate((el) => Boolean(el.closest('[inert]'))),
    false,
    'App was inert during the splash (Skip would be dead)',
  );

  // End the splash the way natural playback does; the modal should take
  // over immediately once the overlay unmounts.
  await splash.dispatchEvent('ended');
  await splash.waitFor({ state: 'detached', timeout: 15000 });
  await expect(page.locator('[data-clerk-component="SignIn"]')).toBeAttached({ timeout: 20000 });
  await expect(page.locator('[data-localization-key]').first()).toBeVisible({ timeout: 20000 });
  await page.screenshot({ path: '/tmp/opencode/clerk-auth-modal.png' });

  // The app still renders behind the modal (this is a modal, not a
  // replacement page), but inside the inert wrapper.
  await expect(page.locator('[inert] .studio-choice')).toHaveCount(1);

  // There is no close affordance on the card.
  assert.equal(await page.getByRole('button', { name: /close/i }).count(), 0, 'Modal has a close button');

  // Escape, a backdrop click, and a click where the app sits behind all
  // leave the modal up and the app untouched.
  await page.keyboard.press('Escape');
  await page.mouse.click(10, 10);
  const box = await page.locator('[inert] .studio-choice').first().boundingBox();
  if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(1000);
  await expect(page.locator('[data-localization-key]').first()).toBeVisible();
  await expect(page.locator('[inert] .studio-choice')).toHaveCount(1);

  // The card's "Sign up" link hands off to the instance's hosted page
  // (accounts.dev in dev), which returns here with a session on success.
  await page.getByRole('link', { name: 'Sign up' }).first().click();
  await expect(page).toHaveURL(/accounts\.dev\/sign-up/, { timeout: 15000 });
  await expect(page.getByRole('heading', { name: /create your account/i })).toBeVisible({ timeout: 15000 });

  const fatal = consoleErrors.filter((text) => /clerk/i.test(text) && !/unique "key" prop/.test(text));
  assert.deepEqual(fatal, [], 'Unexpected Clerk console errors');

  console.log('Clerk auth modal checks passed: waits for splash, opens over the app, no close affordance, Escape/backdrop ignored, app inert behind.');
  await context.close();
} finally {
  await browser.close();
}
