// Run (Linux needs a display: xvfb-run -a node testing/testCodebaseDesktop.mjs)
// after `npm run build && node scripts/build-electron.js`. Needs network.
// Imports a fixture zip into the real desktop app and checks what only
// Electron does: esbuild-wasm loading from appblips://app, images served from
// appblips://assets/<id>/<hash>, blobs and the project tree written to disk,
// and the project surviving a restart. HOME/XDG_CONFIG_HOME point at a temp
// folder, so the user's real projects and settings are never touched.
import assert from 'node:assert/strict';
import { _electron as electron } from '@playwright/test';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipFixture } from './helpers/codebaseFixture.js';

const home = await mkdtemp(join(tmpdir(), 'appblips-desktop-'));
const zipPath = join(home, 'acme-bakery.zip');
await writeFile(zipPath, zipFixture('vite-ts-tw3', { top: 'acme-bakery/' }));
const env = {
  ...process.env,
  // Set when this runs from an Electron-based terminal (e.g. VS Code); it
  // would start Electron as plain Node.
  ELECTRON_RUN_AS_NODE: '',
  HOME: home,
  XDG_CONFIG_HOME: join(home, '.config'),
};
// An existing provider file marks first-run onboarding as done (no AI
// provider is needed: this test never sends a prompt).
await mkdir(join(home, '.config', 'appblips'), { recursive: true });
// Projects go in the temp folder too (the app's own projects-folder setting).
await writeFile(join(home, '.config', 'appblips', 'settings.json'), JSON.stringify({ projectsRoot: join(home, 'Projects') }));
await writeFile(join(home, '.config', 'appblips', 'provider.json'), '{}');
const launch = () => electron.launch({ args: ['.'], env });
const projectsRoot = join(home, 'Projects');

let app = await launch();
try {
  let page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('button', { name: 'Skip video' }).click({ timeout: 5000 }).catch(() => {});
  await page.getByRole('button', { name: /Import a site/ }).first().click({ timeout: 20000 });
  await page.locator('input[type=file][accept*=zip]').setInputFiles(zipPath);
  await page.getByRole('button', { name: 'Open site' }).click({ timeout: 15000 });
  const frame = page.frameLocator('iframe').first();
  await frame.locator('#headline').waitFor({ timeout: 60000 });
  const heroSrc = await frame.locator('#hero').getAttribute('src');
  assert.match(heroSrc, /^appblips:\/\/assets\/\d+\/[a-f0-9]{64}\.png$/, 'image served from the asset host');
  assert.ok(await frame.locator('#hero').evaluate((el) => el.naturalWidth) > 0, 'asset host answers the sandboxed frame');
  await frame.locator('#nav-about').click();
  await frame.locator('#about-title').waitFor({ timeout: 5000 });

  // On disk: hashed blobs, a small project.json and the real project tree.
  await page.waitForTimeout(1500);
  const folders = await readdir(projectsRoot);
  assert.deepEqual(folders, ['Acme Bakery']);
  const folder = join(projectsRoot, 'Acme Bakery');
  const row = JSON.parse(await readFile(join(folder, 'project.json'), 'utf8'));
  assert.equal(row.data.studioMode, 'codebase');
  assert.ok(row.data.versions[0].tree['src/App.tsx'], 'versions saved as hash trees');
  assert.ok(!JSON.stringify(row).includes('Fresh bread every morning'), 'no file contents in project.json');
  assert.ok((await readdir(join(folder, 'blobs'))).length >= 20);
  assert.equal(
    await readFile(join(folder, 'site', 'src', 'pages', 'About.tsx'), 'utf8'),
    (await import('node:fs')).readFileSync(new URL('./fixtures/vite-ts-tw3/src/pages/About.tsx', import.meta.url), 'utf8'),
  );
  assert.ok(existsSync(join(folder, 'site', 'src', 'assets', 'hero.png')));
  assert.deepEqual(errors, []);

  // Restart: a fresh launch opens on the studio picker; reopening the site
  // from My projects rehydrates its files from blobs. (The route is saved
  // with the next save, not on every click, so it opens on the home page.)
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.getByRole('button', { name: 'Skip video' }).click({ timeout: 5000 }).catch(() => {});
  await page.getByRole('button', { name: 'My projects' }).click({ timeout: 20000 });
  await page.getByText('Acme Bakery').first().click();
  const frame2 = page.frameLocator('iframe').first();
  page.on('console', (m) => { if (m.type() === 'error') console.log('restart console error:', m.text().slice(0, 300)); });
  try {
    await frame2.locator('#headline').waitFor({ timeout: 60000 });
  } catch (err) {
    if (process.env.DESKTOP_TEST_SHOT) await page.screenshot({ path: process.env.DESKTOP_TEST_SHOT });
    throw err;
  }
  assert.ok(await frame2.locator('img[alt="Acme"]').evaluate((el) => el.naturalWidth) > 0);
  console.log('testCodebaseDesktop: ok');
} finally {
  await app.close().catch(() => {});
  await rm(home, { recursive: true, force: true });
}
