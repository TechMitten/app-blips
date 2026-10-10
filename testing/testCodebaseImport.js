// Run: node --test testing/testCodebaseImport.js
// Importing a customer's React + Vite + TS project zip (src/lib/codebase/import.js)
// and the shared path rules (src/lib/codebase/paths.js).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zipSync } from 'fflate';
import { importCodebaseZip, inspectProject, commonTopFolder, CodebaseImportError } from '../src/lib/codebase/import.js';
import { validateProjectPath, skipReason, isTextFile, normalizeProjectPath, checkCodebaseLimits } from '../src/lib/codebase/paths.js';
import { readFixture, zipFixture } from './helpers/codebaseFixture.js';
import { sha256Hex } from '../src/lib/codebase/hash.js';

const enc = (s) => new TextEncoder().encode(s);

test('path validation blocks traversal and names Windows refuses', () => {
  assert.equal(validateProjectPath('src/components/ui/button.tsx'), null);
  assert.equal(validateProjectPath('.env.example'), null);
  for (const bad of ['', '/etc/passwd', 'C:/x', '../x', 'src/../x', 'a//b', 'src/./x', 'a\\b', 'con.txt', 'src/aux/x.ts', 'a:b', 'trailing./x', 'x'.repeat(241)]) {
    assert.ok(validateProjectPath(bad), `rejects ${JSON.stringify(bad)}`);
  }
  assert.equal(normalizeProjectPath('.\\src\\App.tsx'), 'src/App.tsx');
});

test('skip rules: packages and secrets anywhere, build output only at the root', () => {
  assert.ok(skipReason('node_modules/react/index.js'));
  assert.ok(skipReason('packages/x/node_modules/a.js'));
  assert.ok(skipReason('.git/HEAD'));
  assert.ok(skipReason('dist/index.html'));
  assert.equal(skipReason('src/build/steps.ts'), null);
  assert.ok(skipReason('.env'));
  assert.ok(skipReason('.env.production.local'));
  assert.equal(skipReason('.env.example'), null);
  assert.ok(skipReason('src/.DS_Store'));
  assert.ok(skipReason('npm-debug.log'));
});

test('text vs binary', () => {
  assert.ok(isTextFile('src/App.tsx'));
  assert.ok(isTextFile('public/logo.svg'));
  assert.ok(!isTextFile('src/assets/hero.png'));
  assert.ok(isTextFile('LICENSE', enc('MIT License')));
  assert.ok(!isTextFile('blob', new Uint8Array([1, 0, 2])));
});

test('top folder is stripped only when everything shares it', () => {
  assert.equal(commonTopFolder(['acme/package.json', 'acme/src/a.ts']), 'acme/');
  assert.equal(commonTopFolder(['package.json', 'src/a.ts']), '');
  assert.equal(commonTopFolder(['a/x', 'b/y']), '');
});

test('fixture zip imports with real paths, assets hashed, lockfile kept', async () => {
  const fixture = readFixture('vite-ts-tw3');
  const zip = zipFixture('vite-ts-tw3', {
    top: 'acme-bakery/',
    extra: {
      'node_modules/react/index.js': 'module.exports = {}',
      'dist/index.html': '<html></html>',
      '.env': 'VITE_SECRET=1',
      '.DS_Store': 'x',
      '.npmrc': '//registry.npmjs.org/:_authToken=abc',
      'src/build/steps.ts': 'export const steps = 1',
    },
  });
  const result = await importCodebaseZip(zip, { sourceName: 'acme-bakery.zip' });
  assert.equal(result.files['src/App.tsx'], new TextDecoder().decode(fixture['src/App.tsx']));
  assert.equal(result.files['package-lock.json'].length, fixture['package-lock.json'].length);
  assert.equal(result.files['src/build/steps.ts'], 'export const steps = 1');
  assert.ok(result.files['public/logo.svg'].startsWith('<svg'));
  for (const gone of ['node_modules/react/index.js', 'dist/index.html', '.env', '.DS_Store', '.npmrc']) {
    assert.ok(!(gone in result.files) && !(gone in result.assets), `${gone} skipped`);
  }
  const skippedPaths = result.skipped.map((s) => s.path);
  assert.ok(skippedPaths.includes('node_modules/'));
  assert.ok(skippedPaths.includes('.env'));
  assert.ok(skippedPaths.includes('.npmrc'));
  const heroHash = await sha256Hex(fixture['src/assets/hero.png']);
  assert.equal(result.assets['src/assets/hero.png'], heroHash);
  assert.deepEqual(result.blobs.get(heroHash), fixture['src/assets/hero.png']);
  assert.deepEqual(
    { entry: result.meta.entry, tailwind: result.meta.tailwind, pm: result.meta.packageManager, name: result.meta.name },
    { entry: 'src/main.tsx', tailwind: 3, pm: 'npm', name: 'acme-bakery' },
  );
  assert.equal(result.meta.sourceName, 'acme-bakery.zip');
  assert.deepEqual(result.warnings, []);
});

test('unsupported projects are rejected with a plain explanation', async () => {
  const base = { 'index.html': '<script type="module" src="/src/main.tsx"></script>', 'src/main.tsx': '' };
  const pkg = (deps) => JSON.stringify({ dependencies: deps });
  const expectFail = (files, pattern) => assert.throws(() => inspectProject(files), (err) => err instanceof CodebaseImportError && pattern.test(err.message));
  expectFail({ ...base }, /no package\.json/);
  expectFail({ ...base, 'package.json': pkg({ next: '14', react: '18', 'react-dom': '18' }) }, /Next\.js/);
  expectFail({ ...base, 'package.json': pkg({ 'react-scripts': '5', react: '18', 'react-dom': '18' }) }, /Create React App/);
  expectFail({ ...base, 'package.json': pkg({ react: '18', 'react-dom': '18' }) }, /Vite/);
  expectFail({ ...base, 'package.json': pkg({ vue: '3', vite: '5' }) }, /Vue/);
  expectFail({ ...base, 'package.json': JSON.stringify({ workspaces: ['a'], dependencies: { vite: '5', react: '18', 'react-dom': '18' } }) }, /monorepo/);
  expectFail({ 'package.json': pkg({ vite: '5', react: '18', 'react-dom': '18' }), 'index.html': '<div></div>' }, /entry script/);
  expectFail({ 'package.json': pkg({ vite: '5', react: '18', 'react-dom': '18' }), 'index.html': base['index.html'] }, /not in the zip/);
  await assert.rejects(importCodebaseZip(enc('not a zip')), /could not be opened/);
});

test('tailwind v4 and warnings are detected', () => {
  const files = {
    'package.json': JSON.stringify({ dependencies: { vite: '6', react: '19', 'react-dom': '19', tailwindcss: '^4.0.0', '@tailwindcss/vite': '^4', 'vite-plugin-svgr': '4' } }),
    'index.html': '<script src="/src/main.jsx" type="module"></script>',
    'src/main.jsx': 'const pages = import.meta.glob("./pages/*.jsx")',
    'src/a.scss': '',
    'pnpm-lock.yaml': '',
  };
  const { meta, warnings } = inspectProject(files);
  assert.equal(meta.tailwind, 4);
  assert.equal(meta.entry, 'src/main.jsx');
  assert.equal(meta.packageManager, 'pnpm');
  assert.equal(warnings.length, 4);
});

test('zip bombs and oversized projects are refused', async () => {
  const many = {};
  for (let i = 0; i < 2100; i++) many[`src/f${i}.ts`] = enc('x');
  await assert.rejects(importCodebaseZip(zipSync(many)), /more than 1000 files/);
  assert.match(checkCodebaseLimits({ 'src/a.ts': 'x'.repeat(1024 * 1024 + 1) }), /larger than/);
  assert.equal(checkCodebaseLimits({ 'package-lock.json': 'x'.repeat(2 * 1024 * 1024) }), null);
});

test('case-insensitive duplicates keep the first file only', async () => {
  const zip = zipFixture('vite-ts-tw3', { extra: { 'src/app.tsx': 'dup' } });
  const result = await importCodebaseZip(zip);
  const appFiles = Object.keys(result.files).filter((p) => p.toLowerCase() === 'src/app.tsx');
  assert.equal(appFiles.length, 1);
  assert.ok(result.skipped.some((s) => /upper\/lower case/.test(s.reason)));
});
