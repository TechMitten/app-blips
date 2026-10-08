// Run with Vite running: node testing/testStartup.mjs
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

const url = process.env.STARTUP_TEST_URL || 'http://127.0.0.1:5175';
const browser = await chromium.launch({ headless: true });
const project = {
  id: 'startup-project',
  name: 'Saved startup project',
  updatedAt: new Date().toISOString(),
  data: {
    studioMode: 'website',
    currentVersionIndex: 0,
    versions: [{ prompt: 'A saved site', files: { 'index.html': '<!doctype html><html><body>Saved site</body></html>' } }],
  },
};

try {
  for (const pendingProjectId of [project.id, null]) {
    const context = await browser.newContext();
    await context.addInitScript(({ project, pendingProjectId }) => {
      if (localStorage.getItem('startup-test-seeded')) return;
      localStorage.setItem('startup-test-seeded', 'true');
      localStorage.setItem('appblips-web-provider', JSON.stringify({ onboardingComplete: true }));
      localStorage.setItem('orion-projects', JSON.stringify([project]));
      localStorage.setItem('orion-current-project-id', project.id);
      // Even a second launch on the same day should show the video.
      localStorage.setItem('orion-splash-last-shown', String(Date.now()));
      localStorage.setItem('orion-pending-job', JSON.stringify({
        projectId: pendingProjectId, prompt: 'Interrupted startup build', studioMode: 'website',
      }));
    }, { project, pendingProjectId });

    let page = await context.newPage();
    await page.goto(url);
    await expect(page.getByRole('button', { name: 'Skip video' })).toBeVisible();
    await expect(page.locator('.studio-choice')).toBeVisible();
    assert.equal(await page.locator('.studio-choice').evaluate(el => {
      const { x, y, width, height } = el.getBoundingClientRect();
      return Boolean(document.elementFromPoint(x + width / 2, y + height / 2)?.closest('.studio-choice'));
    }), false, 'Splash covers the picker until the video finishes');
    // Exercise the same completion event as natural video playback.
    await page.locator('video').dispatchEvent('ended');
    await expect(page.locator('video')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'What will you build?' })).toBeVisible();
    assert.ok(await page.evaluate(() => localStorage.getItem('orion-pending-job')), 'Cold start preserves interrupted work');

    if (pendingProjectId) {
      await page.reload();
      await expect(page.getByRole('heading', { name: 'What will you build?' })).toBeVisible();
      await expect(page.locator('video')).toHaveCount(0);
    }

    await page.getByRole('button', { name: 'My projects', exact: true }).click();
    await page.getByRole('button', { name: /^Saved startup project/ }).click();
    await expect(page.locator('.studio-choice')).toHaveCount(0);
    await expect(page.locator('#prompt')).toBeVisible();
    if (pendingProjectId) {
      await expect(page.getByText('Build interrupted', { exact: true }).first()).toBeVisible();
    } else {
      await expect(page.getByText('Build interrupted', { exact: true })).toHaveCount(0);
    }
    await page.reload();
    await expect(page.locator('#prompt')).toBeVisible();
    await expect(page.locator('.studio-choice')).toHaveCount(0);

    await page.close();
    page = await context.newPage();
    await page.goto(url);
    await expect(page.getByRole('button', { name: 'Skip video' })).toBeVisible();
    await page.getByRole('button', { name: 'Skip video' }).click();
    await expect(page.locator('video')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'What will you build?' })).toBeVisible();
    if (!pendingProjectId) {
      // A reload while a draft build was interrupted still recovers its studio.
      await page.evaluate(() => {
        localStorage.removeItem('orion-current-project-id');
        localStorage.removeItem('orion-start-fresh');
      });
      await page.reload();
      await expect(page.locator('#prompt')).toBeVisible();
      await expect(page.locator('.studio-choice')).toHaveCount(0);
    }
    await context.close();
  }
  console.log('Startup checks passed: splash → picker, saved and draft jobs, reload recovery, and relaunch.');
} finally {
  await browser.close();
}
