// Run: node --test testing/testCodebaseEnvironment.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unzipSync } from 'fflate';
import { completeEnvironment, environmentDraft, environmentRemovalPrompt, inspectEnvironment, parseEnv } from '../src/lib/codebase/environment.js';
import { importCodebaseZip } from '../src/lib/codebase/import.js';
import { envValues } from '../src/lib/codebase/config.js';
import { exportCodebaseZip } from '../src/lib/codebase/export.js';
import { executeCodebaseTool } from '../src/lib/codebase/tools.js';
import { formatCodebaseContext } from '../src/lib/codebase/prompts.js';
import { zipFixture } from './helpers/codebaseFixture.js';

test('detects TS/JS settings, computed access, destructuring, dynamic names and HTML placeholders', () => {
  const inspection = inspectEnvironment({
    'src/App.tsx': `// import.meta.env.VITE_COMMENT\nconst text = "import.meta.env.VITE_STRING";\nconst url: string = import.meta.env.VITE_URL;\nconst key = import.meta.env['VITE_KEY'];\nconst { VITE_TITLE: title, DEV } = import.meta.env;\nconst dynamic = import.meta.env[name];\nconst secret = process.env['SERVER_SECRET'];\nexport default function App() { return <h1>{title}</h1>; }`,
    'src/vite-env.d.ts': 'interface ImportMetaEnv { VITE_TYPE: string }',
    'index.html': '<!-- %VITE_COMMENT% --><title>%VITE_TITLE%</title>',
  });
  assert.equal(inspection.detected, true);
  assert.deepEqual(inspection.variables.map((v) => v.name), ['SERVER_SECRET', 'VITE_KEY', 'VITE_TITLE', 'VITE_URL']);
  assert.equal(inspection.variables[0].public, false);
  assert.deepEqual(inspection.dynamicFiles, ['src/App.tsx']);
  assert.deepEqual(inspection.variables.find((v) => v.name === 'VITE_TITLE').files, ['src/App.tsx', 'index.html']);
});

test('built-ins, comments, string literals and types do not trigger the prompt', () => {
  assert.equal(inspectEnvironment({
    'src/App.jsx': `/* import.meta.env.VITE_SECRET */\nconst help = "import.meta.env.VITE_SECRET";\nconsole.log(import.meta.env.DEV, import.meta.env['MODE'], process.env.NODE_ENV);`,
    'index.html': '<title>%MODE%</title>',
    'src/vite-env.d.ts': 'const env: typeof import.meta.env',
  }).detected, false);
});

test('HTML inspection skips comments without joining source fragments', () => {
  const cases = [
    ['%VITE_<!-- ignored -->FAKE%', []],
    ['%<!-- ignored -->VITE_FAKE%', []],
    ['%VITE_FAKE<!-- ignored -->%', []],
    ['<!-- %VITE_HIDDEN%\n<!-- nested opener -->%VITE_VISIBLE%', ['VITE_VISIBLE']],
    ['<!<!-- ignored -->-- %VITE_VISIBLE% -->', ['VITE_VISIBLE']],
    ['<!-- %VITE_HIDDEN% -->\n<title>%VITE_TITLE%</title><!-- %VITE_OTHER% -->', ['VITE_TITLE']],
    ['<!-- unterminated\n%VITE_HIDDEN%', []],
  ];
  for (const [html, expected] of cases) {
    const inspection = inspectEnvironment({ 'index.html': html });
    assert.deepEqual(inspection.variables.map((v) => v.name), expected, html);
    assert.equal(inspection.detected, expected.length > 0, html);
  }
});

test('detects aliases and Vite/dotenv configuration loading', () => {
  for (const code of ['const env = import.meta.env; console.log(env.VITE_URL);', 'import { loadEnv } from "vite"; loadEnv(mode, process.cwd());', 'import "dotenv/config";', 'require("dotenv").config();']) {
    assert.deepEqual(inspectEnvironment({ 'vite.config.ts': code }).dynamicFiles, ['vite.config.ts']);
  }
  assert.deepEqual(inspectEnvironment({ 'package.json': JSON.stringify({ scripts: { build: 'dotenv -e .env.production -- vite build' } }) }).dynamicFiles, ['package.json']);
});

test('ZIP dependencies are reported even when the real .env was omitted; secrets are never opened', async () => {
  const imported = await importCodebaseZip(zipFixture('vite-ts-tw4', { top: 'site/', extra: { '.env.production': 'VITE_HIDDEN=do-not-import' } }));
  assert.equal(imported.environment.detected, true);
  assert.deepEqual(imported.environment.envFiles, ['.env.production']);
  assert.deepEqual(imported.environment.variables, []);
  assert.ok(!JSON.stringify(imported).includes('do-not-import'));
  assert.equal((await importCodebaseZip(zipFixture('vite-ts-tw4'))).environment.detected, false);
});

test('templates provide an editable draft, including missing values', async () => {
  const imported = await importCodebaseZip(zipFixture('vite-ts-tw3', { extra: { 'src/settings.ts': 'export const url = import.meta.env.VITE_API_URL' } }));
  const draft = environmentDraft(imported.files, imported.environment);
  assert.ok(draft.includes('VITE_CONTACT_EMAIL="hello@acme.test"'));
  assert.ok(draft.includes('VITE_API_URL=""'));
  assert.throws(() => completeEnvironment(imported, draft), /Add a value for VITE_API_URL/);
});

test('completed settings override template values, export as .env.local and leave the upload untouched', async () => {
  const imported = await importCodebaseZip(zipFixture('vite-ts-tw3'));
  const original = JSON.stringify(imported.files);
  const prepared = completeEnvironment(imported, 'VITE_SITE_NAME="Custom site"\nVITE_CONTACT_EMAIL="hello@new.test"');
  assert.deepEqual(envValues(prepared.files), { VITE_SITE_NAME: 'Custom site', VITE_CONTACT_EMAIL: 'hello@new.test' });
  assert.equal(prepared.meta.environmentResolution, 'manual');
  const { zip } = exportCodebaseZip({ files: prepared.files });
  assert.match(new TextDecoder().decode(unzipSync(zip)['site/.env.local']), /hello@new.test/);
  assert.equal(JSON.stringify(imported.files), original);
});

test('invalid, missing, server-only and oversized settings stay in the dialog', () => {
  const imported = { files: {}, assets: {}, meta: {}, environment: inspectEnvironment({ 'src/a.js': 'console.log(import.meta.env.VITE_URL)' }) };
  assert.throws(() => completeEnvironment(imported, 'broken line'), /Check line 1/);
  assert.throws(() => completeEnvironment(imported, 'VITE_URL="unclosed'), /Check line 1/);
  assert.throws(() => completeEnvironment(imported, 'VITE_URL='), /Add a value/);
  assert.throws(() => completeEnvironment(imported, 'SECRET=password\nVITE_URL=ok'), /server setting/);
  assert.throws(() => completeEnvironment(imported, `VITE_URL=${'x'.repeat(1024 * 1024)}`), /larger than/);
  const serverSite = { ...imported, environment: inspectEnvironment({ 'src/a.js': 'console.log(process.env.SECRET)' }) };
  assert.throws(() => completeEnvironment(serverSite, 'VITE_URL=ok'), /needs a server/);
});

test('dotenv parsing keeps quoted hashes and URLs and reports malformed lines', () => {
  const parsed = parseEnv('# settings\nexport VITE_A="a # b" # comment\nVITE_URL=https://example.test/path\nVITE_EMPTY=\nVITE_B=hello # note\nbad');
  assert.deepEqual(parsed.values, { VITE_A: 'a # b', VITE_URL: 'https://example.test/path', VITE_EMPTY: '', VITE_B: 'hello' });
  assert.deepEqual(parsed.invalidLines, [6]);
});

test('AI can neither read/search local settings nor mutate them, including in atomic batches', () => {
  const state = { files: { '.env.local': 'VITE_KEY=private-to-user', 'src/App.jsx': 'export default 1' }, assets: {} };
  const call = (name, args) => ({ function: { name, arguments: JSON.stringify(args) } });
  for (const [name, args] of [
    ['read_file', { path: './.env.local' }],
    ['apply_surgical_edits', { file: '.env.local', edits: [] }],
    ['create_file', { path: '.env.local', content: 'overwritten', overwrite: true }],
    ['delete_file', { path: '.env.local' }],
    ['apply_file_changes', { changes: [{ action: 'delete', path: '.env.local', content: null, edits: null }] }],
  ]) {
    const outcome = executeCodebaseTool(state, call(name, args));
    assert.equal(outcome.applied, false);
    assert.equal(outcome.result.success, false);
    assert.ok(!JSON.stringify(outcome.result).includes('private-to-user'));
  }
  assert.deepEqual(executeCodebaseTool(state, call('search_files', { query: 'private-to-user' })).result.matches, []);
  assert.ok(!formatCodebaseContext(state.files, state.assets, {}).includes('private-to-user'));
});

test('environment repair context includes service source but excludes private values and respects its size limit', () => {
  const files = {
    'src/services/client.ts': 'export const url = import.meta.env.VITE_URL;',
    'src/large.ts': 'const url = import.meta.env.VITE_OTHER;\n' + '// very large\n'.repeat(2000),
    '.env.local': 'VITE_URL=user-private-value',
    '.env.example': 'VITE_URL=template-value',
  };
  const prompt = environmentRemovalPrompt(inspectEnvironment(files), files);
  assert.ok(prompt.includes(files['src/services/client.ts']));
  assert.ok(prompt.includes('### src/large.ts'));
  assert.ok(!prompt.includes(files['src/large.ts']));
  assert.ok(!prompt.includes('user-private-value'));
  assert.ok(!prompt.includes('template-value'));
});
