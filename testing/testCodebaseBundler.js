// Run: node --test testing/testCodebaseBundler.js
// The imported-codebase preview bundler (src/lib/codebase/bundler.js) with
// esbuild-wasm under Node, the preview document (previewHtml.js/preview.js),
// source-map line mapping and the export round trip (export.js).
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import * as esbuild from 'esbuild-wasm';
import { unzipSync } from 'fflate';
import { importCodebaseZip } from '../src/lib/codebase/import.js';
import { bundleCodebase, rewritePublicPaths } from '../src/lib/codebase/bundler.js';
import { buildCodebasePreview, checkCodebaseBuild, mapPreviewLine } from '../src/lib/codebase/preview.js';
import { exportCodebaseZip, dependencyChanges } from '../src/lib/codebase/export.js';
import { injectPreviewBridge } from '../src/previewBridge.js';
import { readFixture, zipFixture } from './helpers/codebaseFixture.js';

after(() => esbuild.stop?.());

const assetUrl = (path, hash) => `appblips://assets/p1/${hash}.png`;
const load = async (name) => importCodebaseZip(zipFixture(name));

test('fixture projects bundle: TSX, aliases, assets, env, router shim', async () => {
  for (const name of ['vite-ts-tw3', 'vite-ts-tw4']) {
    const { files, assets, meta } = await load(name);
    const result = await bundleCodebase(esbuild, { files, assets, meta, assetUrl });
    assert.ok(result.ok, `${name}: ${JSON.stringify(result.errors)}`);
    assert.deepEqual(result.undeclared, []);
    assert.ok(result.js.includes('appblips://assets/p1/'), `${name}: imported image becomes an asset URL`);
    assert.ok(result.js.includes('__appblipsReportRoute'), `${name}: router shim is bundled`);
    assert.ok(!/from "\.\//.test(result.js), `${name}: no unresolved relative imports left`);
    assert.ok(result.tailwindCss.length > 0, `${name}: Tailwind entry CSS collected`);
    assert.ok(result.importMap.imports.react.startsWith('https://esm.sh/react@'));
    assert.ok(result.map?.sources?.some((s) => s.endsWith('src/main.tsx')));
  }
  const { files, assets, meta } = await load('vite-ts-tw3');
  const result = await bundleCodebase(esbuild, { files, assets, meta, assetUrl });
  assert.ok(result.js.includes('"hello@acme.test"'), '.env.example values are defined');
  assert.ok(result.js.includes('data:image/svg+xml'), 'public/logo.svg literal rewritten');
  assert.ok(result.tailwindConfigJs.includes('tailwindcss-animate'), 'tailwind.config bundled for the Play CDN');
  const tw4 = await load('vite-ts-tw4');
  const tw4Result = await bundleCodebase(esbuild, { ...tw4, assetUrl });
  assert.ok(/_header_\w+/.test(tw4Result.css) || tw4Result.css.includes('header'), 'CSS modules are scoped');
});

test('build errors name the file and line', async () => {
  const { files, assets, meta } = await load('vite-ts-tw3');
  const broken = { ...files, 'src/pages/About.tsx': 'export default function About() {\n  return <main>\n}\n' };
  const result = await bundleCodebase(esbuild, { files: broken, assets, meta, assetUrl });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].file, 'src/pages/About.tsx');
  assert.ok(result.errors[0].line >= 2);
  const missing = { ...files, 'src/App.tsx': files['src/App.tsx'].replace('@/pages/About', '@/pages/Missing') };
  const missingResult = await checkCodebaseBuild(esbuild, { files: missing, assets, meta });
  assert.match(missingResult.errors[0].message, /src\/App\.tsx:\d+:\d+: Could not find "@\/pages\/Missing"/);
});

test('imports missing from package.json fail the build check but still preview', async () => {
  const { files, assets, meta } = await load('vite-ts-tw3');
  const edited = { ...files, 'src/pages/About.tsx': `import confetti from "canvas-confetti"\n${files['src/pages/About.tsx']}\nconfetti()\n` };
  const check = await checkCodebaseBuild(esbuild, { files: edited, assets, meta });
  assert.equal(check.errors.length, 1);
  assert.match(check.errors[0].message, /canvas-confetti/);
  const preview = await buildCodebasePreview(esbuild, { files: edited, assets, meta, assetUrl });
  assert.ok(preview.ok);
  assert.ok(preview.html.includes('https://esm.sh/canvas-confetti'));
});

test('preview document: entry replaced, import map first, nothing stored in files', async () => {
  const { files, assets, meta } = await load('vite-ts-tw3');
  const original = JSON.stringify(files);
  const preview = await buildCodebasePreview(esbuild, { files, assets, meta, assetUrl, route: '/about' });
  assert.ok(preview.ok);
  assert.ok(!preview.html.includes('src="/src/main.tsx"'), 'Vite entry script removed');
  assert.ok(preview.html.includes('<title>Acme Bakery</title>'), '%VITE_*% replaced');
  assert.ok(preview.html.includes('window.__APPBLIPS_INITIAL_ROUTE__="/about"'));
  assert.ok(preview.html.indexOf('type="importmap"') < preview.html.indexOf('<script type="module">'));
  assert.ok(!preview.html.includes('data-orion-bridge'), 'bridge is added later, at render time');
  assert.equal(JSON.stringify(files), original, 'files are never modified');
  // The bridge + loop guards go on top like any page, in project mode.
  const { srcDoc } = injectPreviewBridge(preview.html, { projectMode: true });
  assert.ok(srcDoc.includes('var PROJECT_MODE = true;'));
  assert.ok(srcDoc.includes('__orion_loop_check'));
});

test('a preview line maps back to the project file through the source map', async () => {
  const { files, assets, meta } = await load('vite-ts-tw3');
  const preview = await buildCodebasePreview(esbuild, { files, assets, meta, assetUrl });
  const lines = preview.html.split('\n');
  const at = lines.findIndex((l) => l.includes('Family bakers since 1987.'));
  assert.ok(at > 0);
  const where = mapPreviewLine(preview, at + 1, lines[at].indexOf('Family') + 1);
  assert.equal(where.file, 'src/pages/About.tsx');
  assert.equal(where.line, 5);
});

test('public paths: exact literals only, line count unchanged', () => {
  const map = new Map([['/logo.svg', 'data:x']]);
  const src = 'const a = "/logo.svg";\nconst b = "/logo.svg?v=1";\nconst c = "/logo.svgz";\n.x{background:url(/logo.svg)}';
  const out = rewritePublicPaths(src, map);
  assert.equal(out, 'const a = "data:x";\nconst b = "data:x";\nconst c = "/logo.svgz";\n.x{background:url("data:x")}');
});

test('export round trip is byte-identical; dependency changes are reported', async () => {
  const fixture = readFixture('vite-ts-tw3');
  const imported = await load('vite-ts-tw3');
  const { zip, missing } = exportCodebaseZip({ files: imported.files, assets: imported.assets, bytesOf: (h) => imported.blobs.get(h), folder: 'acme-bakery' });
  assert.deepEqual(missing, []);
  const unzipped = unzipSync(zip);
  assert.deepEqual(Object.keys(unzipped).sort(), Object.keys(fixture).map((p) => `acme-bakery/${p}`).sort());
  for (const [path, bytes] of Object.entries(fixture)) {
    assert.deepEqual(unzipped[`acme-bakery/${path}`], bytes, `${path} is unchanged`);
  }
  const pkg = JSON.parse(imported.files['package.json']);
  pkg.dependencies['canvas-confetti'] = '^1.9.0';
  delete pkg.dependencies.clsx;
  assert.deepEqual(dependencyChanges(imported.files['package.json'], { 'package.json': JSON.stringify(pkg) }), { added: ['canvas-confetti'], removed: ['clsx'] });
});

// Ground truth, opt-in (slow, needs network): an edited export must pass the
// project's own `tsc -b && vite build`.
// Run: CODEBASE_REAL_BUILD=1 node --test testing/testCodebaseBundler.js
test('exported project builds with npm (CODEBASE_REAL_BUILD=1)', { skip: !process.env.CODEBASE_REAL_BUILD, timeout: 600000 }, async () => {
  const { execSync } = await import('node:child_process');
  const { mkdtemp, writeFile, mkdir, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join, dirname } = await import('node:path');
  for (const name of ['vite-ts-tw3', 'vite-ts-tw4']) {
    const imported = await load(name);
    const home = 'src/pages/Home.tsx';
    const files = { ...imported.files, [home]: imported.files[home].replace(/(id="headline"[^>]*>)[^<]+/, '$1Edited headline') };
    const { zip } = exportCodebaseZip({ files, assets: imported.assets, bytesOf: (h) => imported.blobs.get(h), folder: name });
    const dir = await mkdtemp(join(tmpdir(), 'appblips-build-'));
    try {
      for (const [path, bytes] of Object.entries(unzipSync(zip))) {
        await mkdir(dirname(join(dir, path)), { recursive: true });
        await writeFile(join(dir, path), bytes);
      }
      const cwd = join(dir, name);
      execSync('npm install --no-audit --no-fund && npm run build', { cwd, stdio: 'pipe' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});
