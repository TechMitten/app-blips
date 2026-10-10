// Run: node --test testing/testCodebaseConfig.js
// How an imported project's config is read without running it
// (src/lib/codebase/config.js), module resolution (resolve.js), the esm.sh
// import map (importMap.js) and the Tailwind preview helpers (tailwind.js).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appTsconfig, envValues, joinPath, packageVersions, parseJsonc, readAliases, strictnessFlags, viteAliases,
} from '../src/lib/codebase/config.js';
import { isBareSpecifier, packageName, resolveImport, splitQuery } from '../src/lib/codebase/resolve.js';
import { buildImportMap, esmUrl } from '../src/lib/codebase/importMap.js';
import { browserSafeV4Css, esmifyConfig, tailwindScriptUrl } from '../src/lib/codebase/tailwind.js';
import { readFixture } from './helpers/codebaseFixture.js';

const textFiles = (name) => Object.fromEntries(
  Object.entries(readFixture(name)).filter(([p]) => !/\.(png|woff2)$/.test(p)).map(([p, b]) => [p, new TextDecoder().decode(b)]),
);

test('JSONC: comments and trailing commas, strings left intact', () => {
  assert.deepEqual(parseJsonc('{ // c\n "a": "http://x/*y*/", /* b */ "b": [1,2,], }'), { a: 'http://x/*y*/', b: [1, 2] });
});

test('joinPath normalizes and refuses to escape the root', () => {
  assert.equal(joinPath('src/pages', '../lib/utils'), 'src/lib/utils');
  assert.equal(joinPath('', './src'), 'src');
  assert.equal(joinPath('src', '../../x'), null);
});

test('tsconfig references: the app config, strictness flags and @/ alias', () => {
  const files = textFiles('vite-ts-tw3');
  assert.equal(appTsconfig(files).path, 'tsconfig.app.json');
  assert.deepEqual(Object.keys(strictnessFlags(files)).sort(), ['noFallthroughCasesInSwitch', 'noUnusedLocals', 'noUnusedParameters', 'strict']);
  assert.deepEqual(readAliases(files).find((a) => a.find === '@/'), { find: '@/', replace: 'src/' });
});

test('vite.config aliases are pattern-matched, never executed', () => {
  const files = textFiles('vite-ts-tw4');
  assert.ok(viteAliases(files).some((a) => a.find === '~/' && a.replace === 'src/'));
  assert.ok(readAliases(files).some((a) => a.find === '~/' && a.replace === 'src/'));
  const objectForm = { 'vite.config.js': "export default { resolve: { alias: { '@components': path.resolve(__dirname, './src/components') } } }" };
  assert.ok(viteAliases(objectForm).some((a) => a.find === '@components/' && a.replace === 'src/components/'));
  const arrayForm = { 'vite.config.ts': "export default { resolve: { alias: [{ find: '#', replacement: fileURLToPath(new URL('./src', import.meta.url)) }] } }" };
  assert.ok(viteAliases(arrayForm).some((a) => a.find === '#/' && a.replace === 'src/'));
});

test('VITE_* values come from .env.example only', () => {
  assert.deepEqual(envValues({ '.env.example': 'VITE_A=1\nSECRET=x\nVITE_B="two words" # note\nexport VITE_C=3 # c' }), { VITE_A: '1', VITE_B: 'two words', VITE_C: '3' });
  assert.deepEqual(envValues({ '.env': 'VITE_A=1' }), {});
});

test('package versions: lockfile first, then cleaned ranges', () => {
  const files = textFiles('vite-ts-tw3');
  const { versions } = packageVersions(files);
  assert.equal(versions.react, '18.3.1');
  assert.equal(versions['react-router-dom'], '6.30.6');
  const loose = packageVersions({ 'package.json': JSON.stringify({ dependencies: { a: '^1.2.0', b: 'file:../b', c: '*', d: 'npm:other@1' } }) }).versions;
  assert.deepEqual(loose, { a: '^1.2.0', b: 'latest', c: 'latest', d: 'latest' });
});

test('resolver: relative, aliases, root paths, public, extensions, .js -> .ts, queries', () => {
  const ctx = {
    files: { 'src/App.tsx': '', 'src/lib/utils.ts': '', 'src/components/index.ts': '', 'src/data.json': '', 'public/logo.svg': '' },
    assets: { 'src/assets/hero.png': 'h' },
    aliases: [{ find: '@/', replace: 'src/' }],
  };
  assert.deepEqual(resolveImport('./lib/utils', 'src/App.tsx', ctx), { path: 'src/lib/utils.ts', query: null });
  assert.deepEqual(resolveImport('./lib/utils.js', 'src/App.tsx', ctx), { path: 'src/lib/utils.ts', query: null });
  assert.deepEqual(resolveImport('@/components', 'src/App.tsx', ctx), { path: 'src/components/index.ts', query: null });
  assert.deepEqual(resolveImport('/src/data.json', 'src/App.tsx', ctx), { path: 'src/data.json', query: null });
  assert.deepEqual(resolveImport('/logo.svg', 'src/App.tsx', ctx), { public: 'public/logo.svg', query: null });
  assert.deepEqual(resolveImport('@/assets/hero.png?url', 'src/App.tsx', ctx), { path: 'src/assets/hero.png', query: 'url' });
  assert.equal(resolveImport('./missing', 'src/App.tsx', ctx), null);
  assert.deepEqual(resolveImport('@radix-ui/react-slot', 'src/App.tsx', ctx), { bare: '@radix-ui/react-slot', spec: '@radix-ui/react-slot' });
  assert.ok(isBareSpecifier('@radix-ui/react-slot', ctx.aliases));
  assert.ok(!isBareSpecifier('@/lib/utils', ctx.aliases));
  assert.equal(packageName('react-dom/client'), 'react-dom');
  assert.deepEqual(splitQuery('./a.svg?raw'), { spec: './a.svg', query: 'raw' });
});

test('import map: one shared copy of every direct dependency, undeclared flagged', () => {
  const { importMap, undeclared } = buildImportMap(
    ['react', 'react/jsx-runtime', 'react-dom/client', 'react-router-dom', 'left-pad'],
    { versions: { react: '18.3.1', 'react-dom': '18.3.1', 'react-router-dom': '6.30.6' }, declared: { react: '', 'react-dom': '', 'react-router-dom': '' } },
  );
  assert.deepEqual(undeclared, ['left-pad']);
  assert.equal(importMap.imports.react, 'https://esm.sh/react@18.3.1?external=react-dom,react-router-dom');
  assert.equal(importMap.imports['react-dom/client'], 'https://esm.sh/react-dom@18.3.1/client?external=react,react-router-dom');
  assert.equal(importMap.imports['react-router-dom/'], 'https://esm.sh/react-router-dom@6.30.6&external=react,react-dom/');
  assert.equal(esmUrl('clsx', '^2.1.0', '', ['clsx']), 'https://esm.sh/clsx@^2.1.0');
  // esm.sh 404s on a scoped name inside the prefix form's path
  assert.equal(esmUrl('tailwindcss', '4.3.3', '/', ['tailwindcss', '@tailwindcss/typography', 'react']), 'https://esm.sh/tailwindcss@4.3.3&external=react/');
  assert.equal(esmUrl('tailwindcss', '4.3.3', '/colors', ['@tailwindcss/typography', 'react']), 'https://esm.sh/tailwindcss@4.3.3/colors?external=@tailwindcss/typography,react');
});

test('tailwind helpers: CDN versions, CommonJS configs, v4 browser-safe CSS', () => {
  assert.equal(tailwindScriptUrl(3, '3.4.19'), 'https://cdn.tailwindcss.com/3.4.17');
  assert.equal(tailwindScriptUrl(3, '3.3.2'), 'https://cdn.tailwindcss.com/3.3.2');
  assert.equal(tailwindScriptUrl(4, '4.3.3'), 'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.3.3');
  const esm = esmifyConfig("const animate = require('tailwindcss-animate')\nmodule.exports = { plugins: [animate, require(\"x\")] }");
  assert.match(esm, /^import \* as __appblips_ns0 from "tailwindcss-animate";/);
  assert.match(esm, /export default \{ plugins: \[animate, __appblips_req1\] \}/);
  assert.equal(esm.split('\n').length, 2, 'config line numbers are kept');
  const { css, removed } = browserSafeV4Css('@import "tailwindcss";\n@import "tw-animate-css";\n@plugin "@tailwindcss/typography";\n@theme { --x: 1 }');
  assert.ok(css.includes('@import "tailwindcss";') && css.includes('@theme'));
  assert.equal(removed.length, 2);
});
