// Run: node --test testing/testCodebaseTools.js
// The AI's codebase tools (src/lib/codebase/tools.js), version packing for
// the blob store (versions.js) and the edit loop (codebase/llm.js) against a
// scripted model, with the real esbuild build check.
import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import * as esbuild from 'esbuild-wasm';
import { createServer } from 'vite';
import { executeCodebaseTool } from '../src/lib/codebase/tools.js';
import { packVersions, referencedTextHashes, unpackVersions } from '../src/lib/codebase/versions.js';
import { checkCodebaseBuild } from '../src/lib/codebase/preview.js';
import { formatCodebaseContext, findRoutesFile } from '../src/lib/codebase/prompts.js';
import { importCodebaseZip } from '../src/lib/codebase/import.js';
import { zipFixture } from './helpers/codebaseFixture.js';

// codebase/llm.js imports ../llm.js, whose extensionless imports only Vite
// resolves (same approach as testCodeReviewPipeline.js).
let server;
let generateCodebaseEdit;
const savedFetch = globalThis.fetch;
before(async () => {
  server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  ({ generateCodebaseEdit } = await server.ssrLoadModule('/src/lib/codebase/llm.js'));
});
after(async () => {
  globalThis.fetch = savedFetch;
  await server?.close();
  await esbuild.stop?.();
});

const call = (name, args) => ({ id: `call_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const state0 = () => ({
  files: { 'src/App.tsx': 'export default function App() {\n  return <h1>Hello</h1>\n}\n', 'package.json': '{}', 'package-lock.json': '{}', 'index.html': '<div></div>' },
  assets: { 'src/assets/logo.png': 'a'.repeat(64) },
});

test('read, list and search never change anything', () => {
  const state = state0();
  const list = executeCodebaseTool(state, call('list_files', { prefix: 'src/' }));
  assert.deepEqual(list.result.files, ['src/App.tsx (58 chars)', 'src/assets/logo.png (binary)']);
  const read = executeCodebaseTool(state, call('read_file', { path: 'src/App.tsx', start_line: null, end_line: null }));
  assert.ok(read.result.success && read.result.code.includes('Hello'));
  assert.equal(executeCodebaseTool(state, call('read_file', { path: 'src/assets/logo.png', start_line: null, end_line: null })).result.success, false);
  const search = executeCodebaseTool(state, call('search_files', { query: 'hello', prefix: null }));
  assert.deepEqual(search.result.matches, ['src/App.tsx:2: return <h1>Hello</h1>']);
  for (const r of [list, read, search]) assert.equal(r.applied, false);
});

test('edits, creates and deletes return a new state and leave the old one alone', () => {
  const state = state0();
  const edit = executeCodebaseTool(state, call('apply_surgical_edits', { file: 'src/App.tsx', edits: [{ search: 'Hello', replace: 'Hi there', occurrence: null, replace_all: null }] }));
  assert.ok(edit.applied);
  assert.ok(edit.state.files['src/App.tsx'].includes('Hi there'));
  assert.ok(state.files['src/App.tsx'].includes('Hello'), 'previous version untouched');
  const create = executeCodebaseTool(edit.state, call('create_file', { path: 'src/pages/Pricing.tsx', content: 'export default 1', overwrite: null }));
  assert.ok(create.applied && create.state.files['src/pages/Pricing.tsx']);
  assert.equal(executeCodebaseTool(create.state, call('create_file', { path: 'src/pages/Pricing.tsx', content: 'x', overwrite: null })).applied, false, 'no silent overwrite');
  assert.equal(executeCodebaseTool(create.state, call('create_file', { path: 'src/app.tsx', content: 'x', overwrite: null })).applied, false, 'case clash refused');
  const del = executeCodebaseTool(create.state, call('delete_file', { path: 'src/assets/logo.png' }));
  assert.ok(del.applied && !del.state.assets['src/assets/logo.png']);
});

test('tools refuse unsafe paths, lockfiles and required files', () => {
  const state = state0();
  for (const path of ['../evil.ts', '/etc/passwd', 'src/../../x', 'C:/x', 'con.ts']) {
    assert.equal(executeCodebaseTool(state, call('create_file', { path, content: 'x', overwrite: true })).applied, false, path);
  }
  assert.equal(executeCodebaseTool(state, call('apply_surgical_edits', { file: 'package-lock.json', edits: [{ search: '{', replace: '[', occurrence: null, replace_all: null }] })).applied, false);
  assert.equal(executeCodebaseTool(state, call('delete_file', { path: 'package.json' })).applied, false);
  assert.equal(executeCodebaseTool(state, call('delete_file', { path: 'index.html' })).applied, false);
  assert.equal(executeCodebaseTool(state, { id: 'x', function: { name: 'read_file', arguments: '{nope' } }).result.success, false);
});

test('versions pack to hash trees and unpack to shared strings', async () => {
  const a = { 'src/App.tsx': 'one', 'src/b.ts': 'same' };
  const b = { ...a, 'src/App.tsx': 'two' };
  const { versions, texts } = await packVersions([
    { id: 1, files: a, assets: { 'x.png': 'h' } },
    { id: 2, files: b },
    { id: 3, code: '<html></html>' },
  ]);
  assert.equal(texts.size, 3, 'unchanged files stored once');
  assert.ok(!('files' in versions[0]) && versions[0].tree['src/b.ts'] === versions[1].tree['src/b.ts']);
  assert.deepEqual(versions[0].assets, { 'x.png': 'h' });
  assert.equal(referencedTextHashes(versions).size, 3);
  const { versions: back, missing } = unpackVersions(versions, (h) => texts.get(h));
  assert.deepEqual(missing, []);
  assert.deepEqual(back[0].files, a);
  assert.deepEqual(back[1].files, b);
  assert.equal(back[2].code, '<html></html>');
  const { versions: partial, missing: gone } = unpackVersions(versions, (h) => (h === versions[0].tree['src/b.ts'] ? 'same' : undefined));
  assert.equal(gone.length, 2);
  assert.deepEqual(partial[0].files, { 'src/b.ts': 'same' });
});

test('starting context: tree, strictness, dependencies and the routes file', async () => {
  const { files, assets, meta } = await importCodebaseZip(zipFixture('vite-ts-tw4'));
  assert.equal(findRoutesFile(files, meta.entry), null, 'routes live in the entry file here');
  const context = formatCodebaseContext(files, assets, meta);
  assert.ok(context.includes('src/assets/photo.png (binary)'));
  assert.ok(context.includes('noUnusedLocals'));
  assert.ok(context.includes('"react-router"'));
  assert.ok(context.includes('### src/main.tsx'));
  assert.ok(!context.includes('"lockfileVersion"'), 'lockfile contents are never sent');
});

// A fake /api/chat: tool-calling turns are scripted; plain replies stream text.
function mockModel(turns) {
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    const sse = (deltas) => new Response(new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        for (const delta of deltas) controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`));
        controller.enqueue(enc.encode('data: [DONE]\n\n'));
        controller.close();
      },
    }), { status: 200 });
    if (!body.tools) {
      if (body.stream) return sse([{ content: 'On it.' }]);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Changed the headline.' } }] }), { status: 200 });
    }
    const turn = turns.shift();
    if (!turn) return sse([{ content: 'Done.' }]);
    if (typeof turn === 'string') return sse([{ content: turn }]);
    return sse(turn.map((tc, index) => ({ tool_calls: [{ index, id: tc.id, type: 'function', function: { name: tc.function.name, arguments: tc.function.arguments } }] })));
  };
  return requests;
}

test('edit loop: search, edit, build error fed back, repaired, finished', async () => {
  const { files, assets, meta } = await importCodebaseZip(zipFixture('vite-ts-tw3'));
  const requests = mockModel([
    [call('search_files', { query: 'Fresh bread', prefix: null })],
    // Breaks the build: the import does not exist.
    [call('apply_surgical_edits', { file: 'src/pages/Home.tsx', edits: [
      { search: 'Fresh bread every morning', replace: 'Warm bread, baked daily', occurrence: null, replace_all: null },
      { search: 'import hero from "@/assets/hero.png"', replace: 'import hero from "@/assets/hero.png"\nimport Banner from "@/components/Banner"', occurrence: null, replace_all: null },
    ] })],
    [call('apply_surgical_edits', { file: 'src/pages/Home.tsx', edits: [
      { search: '\nimport Banner from "@/components/Banner"', replace: '', occurrence: null, replace_all: null },
    ] })],
    'I updated the headline on the home page.',
  ]);
  const statuses = [];
  const result = await generateCodebaseEdit({
    prompt: 'Change the headline to "Warm bread, baked daily"',
    files, assets, meta,
    onChunk: (chunk, kind) => { if (kind === 'status') statuses.push(chunk); },
    buildCheck: (f, a) => checkCodebaseBuild(esbuild, { files: f, assets: a, meta, baseline: files }),
  });
  assert.equal(result.editMode, 'surgical');
  assert.ok(result.files['src/pages/Home.tsx'].includes('Warm bread, baked daily'));
  assert.ok(!result.files['src/pages/Home.tsx'].includes('Banner'));
  assert.deepEqual(result.buildErrors, []);
  assert.equal(files['src/pages/Home.tsx'].includes('Fresh bread'), true, 'input files untouched');
  const repairPrompt = requests.flatMap((r) => r.messages || []).find((m) => m.role === 'user' && /no longer builds/.test(m.content));
  assert.match(repairPrompt.content, /src\/pages\/Home\.tsx:\d+: Could not find "@\/components\/Banner"/);
  assert.ok(statuses.some((s) => /Checking that the project still builds/.test(s)));
  assert.match(result.reply, /On it\.[\s\S]*I updated the headline/);
  const firstToolRequest = requests.find((r) => r.tools);
  assert.ok(firstToolRequest.messages[0].content.includes('React + Vite + TypeScript'));
  assert.ok(firstToolRequest.tools.some((t) => t.function.name === 'search_files'));
});

test('ask mode only reads', async () => {
  const { files, assets, meta } = await importCodebaseZip(zipFixture('vite-ts-tw3'));
  const requests = mockModel([
    [call('create_file', { path: 'src/x.ts', content: 'x', overwrite: null })],
    'Your contact email is hello@acme.test.',
  ]);
  const result = await generateCodebaseEdit({ prompt: 'What email is on the site?', files, assets, meta, isAsk: true });
  assert.equal(result.editMode, 'ask');
  assert.equal(result.files, files, 'nothing changed');
  assert.match(result.reply, /hello@acme\.test/);
  assert.ok(requests.find((r) => r.tools).tools.every((t) => ['list_files', 'read_file', 'search_files'].includes(t.function.name)));
});

test('import check: missing files, undeclared packages and unused imports in changed files', async () => {
  const { checkImports } = await import('../src/lib/codebase/importCheck.js');
  const files = {
    'src/a.tsx': [
      'import { useState, type ReactNode } from "react"',
      'import Missing from "./Missing"',
      'import confetti from "canvas-confetti"',
      'import * as Icons from "lucide-react"',
      'import Thing, { Other as Renamed } from "./thing"',
      '// import Ghost from "./ghost"',
      'export function A({ children }: { children: ReactNode }) {',
      '  const [n] = useState(0)',
      '  return <Icons.Star>{n}{children}<Renamed /></Icons.Star>',
      '}',
    ].join('\n'),
    'src/thing.ts': 'export default 1; export const Other = 2',
  };
  const errors = checkImports(files, {}, { paths: ['src/a.tsx'], declared: { react: '', 'lucide-react': '' }, noUnusedLocals: true });
  const texts = errors.map((e) => `${e.line}: ${e.text}`);
  assert.equal(errors.length, 4, texts.join('\n'));
  assert.ok(texts.some((t) => t.startsWith('3: "confetti" is imported but never used')));
  assert.ok(texts.some((t) => t.startsWith('2: Could not find "./Missing"')));
  assert.ok(texts.some((t) => t.startsWith('3: "canvas-confetti" is imported but not listed')));
  assert.ok(texts.some((t) => t.startsWith('5: "Thing" is imported but never used')));
  assert.deepEqual(checkImports(files, {}, { paths: ['src/thing.ts'], declared: {}, noUnusedLocals: true }), []);
});
