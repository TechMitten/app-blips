// Run: node --test testing/testCodebaseTools.js
// The AI's codebase tools (src/lib/codebase/tools.js), version packing for
// the blob store (versions.js) and the edit loop (codebase/llm.js) against a
// scripted model, with the real esbuild build check.
import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import * as esbuild from 'esbuild-wasm';
import { createServer } from 'vite';
import { CODEBASE_TOOLS, executeCodebaseTool } from '../src/lib/codebase/tools.js';
import { packVersions, referencedTextHashes, unpackVersions } from '../src/lib/codebase/versions.js';
import { checkCodebaseBuild } from '../src/lib/codebase/preview.js';
import { formatCodebaseContext, findRoutesFile } from '../src/lib/codebase/prompts.js';
import { importCodebaseZip } from '../src/lib/codebase/import.js';
import { zipFixture } from './helpers/codebaseFixture.js';

// codebase/llm.js imports ../llm.js, whose extensionless imports only Vite
// resolves (same approach as testCodeReviewPipeline.js).
let server;
let generateCodebaseEdit;
let MAX_CODEBASE_TURNS;
const savedFetch = globalThis.fetch;
before(async () => {
  server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  ({ generateCodebaseEdit, MAX_CODEBASE_TURNS } = await server.ssrLoadModule('/src/lib/codebase/llm.js'));
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

const block = (search, replace, extra = {}) => ({ search, replace, occurrence: null, replace_all: null, ...extra });
const change = (action, path, value) => ({ action, path, edits: action === 'edit' ? value : null, content: action === 'create' ? value : null });
const batch = (changes) => call('apply_file_changes', { changes });
const editCall = (file, search, replace) => call('apply_surgical_edits', { file, edits: [block(search, replace)] });

test('multi-file batches stage edits, creates and asset deletes atomically', () => {
  const original = state0();
  const result = executeCodebaseTool(original, batch([
    change('edit', 'src/App.tsx', [block('Hello', 'Hi')]),
    change('create', 'src/Banner.tsx', 'export default () => <aside>Hi</aside>'),
    change('delete', 'src/assets/logo.png'),
  ]));
  assert.equal(result.applied, true);
  assert.equal(result.state.files['src/App.tsx'].includes('Hi'), true);
  assert.ok(result.state.files['src/Banner.tsx']);
  assert.equal(result.state.assets['src/assets/logo.png'], undefined);
  assert.deepEqual(original, state0());
  assert.deepEqual(result.result.files.sort(), ['src/App.tsx', 'src/Banner.tsx', 'src/assets/logo.png']);

  const failed = executeCodebaseTool(original, batch([
    change('edit', 'src/App.tsx', [block('Hello', 'Hi')]),
    change('create', 'src/Banner.tsx', 'export default 1'),
    change('edit', 'src/App.tsx', [block('missing', 'Bye')]),
  ]));
  assert.equal(failed.state, original);
  assert.equal(failed.applied, false);
  assert.equal(failed.result.rolledBack, true);
  assert.equal(failed.result.failedChange, 3);
  assert.equal(failed.result.failedEdit, 1);
  assert.match(failed.result.instruction, /complete batch/);
});

test('batches retain file protections and validate the final project limits', () => {
  const original = state0();
  for (const bad of [change('edit', 'package-lock.json', [block('{}', '[]')]), change('delete', 'index.html'), change('create', '../bad.ts', 'x'), change('create', 'src/app.tsx', 'x'), change('create', 'src/assets/logo.png', 'x'), change('create', 'src/App.tsx', 'x')]) {
    const result = executeCodebaseTool(original, batch([change('edit', 'src/App.tsx', [block('Hello', 'Hi')]), bad]));
    assert.equal(result.state, original);
    assert.equal(result.applied, false);
    assert.equal(result.result.failedChange, 2);
  }
  const oversized = executeCodebaseTool(original, batch([change('create', 'src/huge.ts', 'x'.repeat(1024 * 1024 + 1))]));
  assert.equal(oversized.state, original);
  assert.equal(oversized.result.rolledBack, true);
  const full = { files: Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`src/file${i}.ts`, 'x'])), assets: {} };
  const replaced = executeCodebaseTool(full, batch([change('create', 'src/new.ts', 'y'), change('delete', 'src/file0.ts')]));
  assert.equal(replaced.applied, true, 'intermediate file count may exceed the limit');
  assert.equal(Object.keys(replaced.state.files).length, 1000);
});

test('failed block diagnostics survive tool execution and the file stays untouched', () => {
  const original = state0();
  const result = executeCodebaseTool(original, call('apply_surgical_edits', { file: 'src/App.tsx', edits: [block('Hello', 'Hi'), block('App', 'Thing', { occurrence: 2 })] }));
  assert.equal(result.state, original);
  assert.equal(result.result.failedEdit, 2);
  assert.equal(result.result.matchCount, 1);
  assert.deepEqual(result.result.matchLines, [1]);
  assert.match(result.result.context, /Hello/);
  assert.match(result.result.instruction, /None.*applied/);
});

test('no-op mutations return the original state; malformed arguments do not throw', () => {
  const original = state0();
  for (const tool of [editCall('src/App.tsx', 'Hello', 'Hello'), call('create_file', { path: 'src/App.tsx', content: original.files['src/App.tsx'], overwrite: true }), batch([change('edit', 'src/App.tsx', [block('Hello', 'Hi'), block('Hi', 'Hello')])])]) {
    const result = executeCodebaseTool(original, tool);
    assert.equal(result.state, original);
    assert.equal(result.applied, false);
    assert.equal(result.result.changed, false);
  }
  for (const argumentsText of ['null', '[]', '42']) {
    assert.equal(executeCodebaseTool(original, { function: { name: 'read_file', arguments: argumentsText } }).result.success, false);
  }
  for (const changes of [[], [null], [{ action: 'bogus', path: 'src/App.tsx' }]]) {
    assert.equal(executeCodebaseTool(original, batch(changes)).result.success, false);
  }
});

test('file reads show remaining lines and enforce the advertised 400-line cap', () => {
  const state = { files: { 'src/long.ts': Array.from({ length: 450 }, (_, i) => `line${i + 1}`).join('\n') }, assets: {} };
  const read = executeCodebaseTool(state, call('read_file', { path: 'src/long.ts', start_line: 1, end_line: 450 })).result;
  assert.equal(read.totalLines, 450);
  assert.equal(read.endLine, 400);
  assert.equal(read.code.split('\n').length, 400);
  assert.equal(read.truncated, true);
  assert.equal(executeCodebaseTool(state, call('read_file', { path: 'src/long.ts', start_line: 500 })).result.success, false);
});

test('tool schemas remain strict, including nested multi-file changes', () => {
  function check(schema) {
    if (schema.properties) {
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual(Object.keys(schema.properties).sort(), [...schema.required].sort());
      Object.values(schema.properties).forEach(check);
    }
    if (schema.items) check(schema.items);
  }
  CODEBASE_TOOLS.forEach((tool) => check(tool.function.parameters));
});

test('edit loop retries an atomic batch and checks the complete multi-file change once', async () => {
  const { files, assets, meta } = await importCodebaseZip(zipFixture('vite-ts-tw3'));
  const edits = [
    block('import hero from "@/assets/hero.png"', 'import hero from "@/assets/hero.png"\nimport Banner from "@/components/Banner"'),
    block('<main className="p-8">', '<main className="p-8">\n      <Banner />'),
  ];
  const changes = [change('edit', 'src/pages/Home.tsx', edits), change('create', 'src/components/Banner.tsx', 'export default function Banner() { return <aside>Welcome</aside> }')];
  const requests = mockModel([
    [batch([changes[0], change('edit', 'src/components/Banner.tsx', [block('missing', 'x')])])],
    'Done already.',
    [call('read_file', { path: 'src/pages/Home.tsx', start_line: null, end_line: null })],
    [batch(changes)],
    'Added a welcome banner.',
  ]);
  let checks = 0;
  const result = await generateCodebaseEdit({ prompt: 'Add a welcome banner', files, assets, meta, buildCheck: async (f, a) => {
    checks++;
    assert.ok(f['src/components/Banner.tsx'], 'checks see all files in the batch');
    return checkCodebaseBuild(esbuild, { files: f, assets: a, meta, baseline: files });
  } });
  assert.equal(checks, 1);
  assert.match(result.files['src/pages/Home.tsx'], /<Banner \/>/);
  assert.ok(result.files['src/components/Banner.tsx']);
  assert.ok(!files['src/pages/Home.tsx'].includes('Banner'));
  assert.ok(!result.reply.includes('Done already.'));
  const feedback = requests.flatMap((request) => request.messages || []).filter((message) => message.role === 'tool').map((message) => JSON.parse(message.content));
  assert.ok(feedback.some((r) => r.failedChange === 2 && r.rolledBack));
  assert.ok(requests.some((request) => request.messages.some((m) => m.role === 'user' && /changes failed/.test(m.content))));
});

test('edit loop preserves the previous version when a requested edit remains failed', async () => {
  const { files, assets } = state0();
  const before = { ...files };
  mockModel([[editCall('src/App.tsx', 'Hello', 'Hi'), editCall('index.html', 'missing', 'x')], 'Done.']);
  await assert.rejects(generateCodebaseEdit({ prompt: 'Update two files', files, assets, isAutoFix: true, buildCheck: async () => ({ errors: [] }) }), /requested edits.*previous version has been kept/);
  assert.deepEqual(files, before);
});

test('edit loop rejects unrepaired build errors without emitting a success reply', async () => {
  const { files, assets } = state0();
  const before = { ...files };
  mockModel([[editCall('src/App.tsx', 'Hello', 'Hi')], 'All done.']);
  const chunks = [];
  let checks = 0;
  await assert.rejects(generateCodebaseEdit({ prompt: 'Change the greeting', files, assets, isAutoFix: true, onChunk: (chunk, kind) => chunks.push({ chunk, kind }), buildCheck: async () => {
    checks++;
    return { errors: [{ message: 'src/App.tsx:2: build is broken' }] };
  } }), /previous version has been kept[\s\S]*build is broken/);
  assert.equal(checks, 1, 'the same tree is not rebuilt for confirmation turns');
  assert.ok(!chunks.some((chunk) => chunk.kind === 'reply'));
  assert.deepEqual(files, before);
});

test('no-op and fully reverted changes do not create a successful edit result', async () => {
  const { files, assets } = state0();
  let checks = 0;
  mockModel([[editCall('src/App.tsx', 'Hello', 'Hello')], 'Done.']);
  await assert.rejects(generateCodebaseEdit({ prompt: 'Change the greeting', files, assets, isAutoFix: true, buildCheck: async () => { checks++; return { errors: [] }; } }), /did not make any change/);
  assert.equal(checks, 0);
  mockModel([[editCall('src/App.tsx', 'Hello', 'Hi')], [editCall('src/App.tsx', 'Hi', 'Hello')], 'Done.']);
  await assert.rejects(generateCodebaseEdit({ prompt: 'Change the greeting', files, assets, isAutoFix: true, buildCheck: async () => ({ errors: [] }) }), /did not make any change/);
});

test('ask mode refuses multi-file mutations as well as single-file mutations', async () => {
  const { files, assets } = state0();
  const requests = mockModel([[batch([change('delete', 'src/App.tsx')])], 'The greeting says Hello.']);
  const result = await generateCodebaseEdit({ prompt: 'What is the greeting?', files, assets, isAsk: true });
  assert.equal(result.files, files);
  assert.match(result.reply, /Hello/);
  assert.ok(requests.some((r) => r.messages.some((m) => m.role === 'tool' && /Read-only/.test(m.content))));
});


test('turn exhaustion preserves the previous version even when the partial edits build', async () => {
  const { files, assets } = state0();
  const before = { ...files };
  const read = call('read_file', { path: 'src/App.tsx', start_line: null, end_line: null });
  mockModel([[editCall('src/App.tsx', 'Hello', 'Hi')], ...Array.from({ length: MAX_CODEBASE_TURNS - 1 }, () => [read])]);
  await assert.rejects(generateCodebaseEdit({ prompt: 'Update the site', files, assets, isAutoFix: true, buildCheck: async () => ({ errors: [] }) }), /could not finish.*previous version has been kept/);
  assert.deepEqual(files, before);
});

test('a no-op retry does not hide a failed edit on an already changed file', async () => {
  const { files, assets } = state0();
  mockModel([
    [editCall('src/App.tsx', 'Hello', 'Hi')],
    [editCall('src/App.tsx', 'missing', 'replacement')],
    [editCall('src/App.tsx', 'Hi', 'Hi')],
    'Done.',
  ]);
  await assert.rejects(generateCodebaseEdit({ prompt: 'Update the greeting and title', files, assets, isAutoFix: true, buildCheck: async () => ({ errors: [] }) }), /requested edits.*previous version has been kept/);
  assert.match(files['src/App.tsx'], /Hello/);
});

test('cancellation during a build check propagates without returning edited files', async () => {
  const { files, assets } = state0();
  const controller = new AbortController();
  mockModel([[editCall('src/App.tsx', 'Hello', 'Hi')]]);
  await assert.rejects(generateCodebaseEdit({ prompt: 'Update the greeting', files, assets, isAutoFix: true, signal: controller.signal, buildCheck: async () => {
    controller.abort();
    return { errors: [] };
  } }), { name: 'AbortError' });
  assert.match(files['src/App.tsx'], /Hello/);
});
