// Run: node testing/testCodebasePreview.mjs  (needs network for esm.sh and the Tailwind CDNs)
// Renders both fixture codebases through the real preview pipeline (esbuild
// bundle + preview document + bridge in project mode) in a sandboxed srcdoc
// frame, like testReactPreview.mjs. Proves one working React per page (hooks
// work), the Tailwind theme applies, router links navigate and are reported
// to the parent, imported and public images load, and nothing logs an error.
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild-wasm';
import { chromium } from '@playwright/test';
import { importCodebaseZip } from '../src/lib/codebase/import.js';
import { buildCodebasePreview } from '../src/lib/codebase/preview.js';
import { injectPreviewBridge } from '../src/previewBridge.js';
import { zipFixture } from './helpers/codebaseFixture.js';

const CASES = [
  {
    fixture: 'vite-ts-tw3',
    // React 18 + react-router-dom 6 BrowserRouter + shadcn Button + Tailwind v3 config
    check: async (frame) => {
      await frame.locator('#like').click();
      await frame.locator('#like').click();
      assert.equal((await frame.locator('#like').innerText()).trim(), '2', 'useState works (single React)');
      assert.equal(await frame.locator('#email').innerText(), 'hello@acme.test', '.env.example value');
      assert.ok(await frame.locator('#hero').evaluate((el) => el.naturalWidth) > 0, 'imported image loads');
      assert.ok(await frame.locator('#logo').evaluate((el) => el.naturalWidth) > 0, 'public/ image loads');
      const bg = await frame.locator('header').evaluate((el) => getComputedStyle(el).borderBottomColor);
      assert.notEqual(bg, 'rgb(0, 0, 0)', 'Tailwind theme colour applied (border-border)');
      await frame.locator('#nav-about').click();
      await frame.locator('#about-title').waitFor({ timeout: 5000 });
    },
    route: '/about',
  },
  {
    fixture: 'vite-ts-tw4',
    // React 19 + react-router 7 createBrowserRouter + Tailwind v4 @theme + CSS modules
    check: async (frame) => {
      await frame.locator('#toggle').click();
      assert.equal(await frame.locator('#details').count(), 1, 'useState works (single React)');
      const color = await frame.locator('#headline').evaluate((el) => getComputedStyle(el).color);
      assert.notEqual(color, 'rgb(0, 0, 0)', 'Tailwind v4 @theme colour applied (text-brand)');
      const border = await frame.locator('header').evaluate((el) => getComputedStyle(el).borderBottomWidth);
      assert.equal(border, '3px', 'CSS module applied');
      assert.ok(await frame.locator('#photo').evaluate((el) => el.naturalWidth) > 0, 'imported image loads');
      await frame.locator('#plain-contact').click();
      await frame.locator('#contact-title').waitFor({ timeout: 5000 });
    },
    route: '/contact',
  },
];

const browser = await chromium.launch();
try {
  for (const { fixture, check, route } of CASES) {
    const imported = await importCodebaseZip(zipFixture(fixture));
    const assetUrl = (path, hash) => `data:image/png;base64,${Buffer.from(imported.blobs.get(hash)).toString('base64')}`;
    const preview = await buildCodebasePreview(esbuild, { ...imported, assetUrl });
    assert.ok(preview.ok, `${fixture} builds: ${JSON.stringify(preview.errors)}`);
    const { srcDoc } = injectPreviewBridge(preview.html, { projectMode: true });

    const page = await browser.newPage();
    const errors = [];
    const routes = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.exposeFunction('noteRoute', (path) => routes.push(path));
    await page.setContent('<script>addEventListener("message", (e) => { if (e.data && e.data.type === "route-changed") noteRoute(e.data.payload.path); });</script><iframe sandbox="allow-scripts allow-forms" style="width:1000px;height:700px"></iframe>');
    await page.$eval('iframe', (el, doc) => { el.srcdoc = doc; }, srcDoc);
    const frame = page.frameLocator('iframe');
    await frame.locator('#headline').waitFor({ timeout: 30000 });
    await page.waitForTimeout(500);
    await check(frame);
    await page.waitForTimeout(300);
    assert.deepEqual(routes, ['/', route], `${fixture}: routes reported to the parent`);
    // Fonts in the tw4 fixture are deliberately fake bytes; only real errors count.
    assert.deepEqual(errors.filter((e) => !/favicon|font|OTS/i.test(e)), [], `${fixture}: no console errors`);
    await page.close();
    console.log(`testCodebasePreview: ${fixture} ok`);
  }
} finally {
  await browser.close();
  await esbuild.stop?.();
}
console.log('testCodebasePreview: ok');
