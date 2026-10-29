// The AI's npm tools (src/lib/npmTools.js): schemas, budgets, the manifest it
// hands back, upload consent and the fallback when the computer is
// unavailable. The computer is stubbed. Run: node testing/testNpmTools.js
import assert from 'node:assert/strict';
import { test } from 'node:test';

const data = new Map();
globalThis.window = { localStorage: {
  get length() { return data.size; },
  getItem: (k) => (data.has(k) ? data.get(k) : null),
  setItem: (k, v) => { data.set(k, String(v)); },
} };

const tools = await import('../src/lib/npmTools.js');
const computer = await import('../src/lib/computer.js');
const {
  CODEBASE_NPM_TOOLS, INSPECT_TOOL, createNpmBudget, executeInspect, executeNpmInstall, executeRunBuild, isNpmToolCall, npmToolsLeft,
} = tools;

const call = (name, args) => ({ id: 'c1', type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } });
const FILES = { 'package.json': '{"name":"x","dependencies":{}}', 'package-lock.json': '{"lockfileVersion":3}', 'src/a.ts': 'export {}', '.env': 'SECRET=1', 'src/.env.local': 'S=2', '.env.example': 'A=' };

test('every tool is strict with all properties required', () => {
  for (const { function: fn } of CODEBASE_NPM_TOOLS) {
    assert.equal(fn.strict, true);
    assert.deepEqual([...fn.parameters.required].sort(), Object.keys(fn.parameters.properties).sort(), fn.name);
  }
  assert.equal(isNpmToolCall(call('npm_install', {})), true);
  assert.equal(isNpmToolCall(call('read_file', {})), false);
  assert.equal(INSPECT_TOOL.function.name, 'inspect_npm_package');
});

test('npm_install replaces package.json and the lockfile in the working copy', async () => {
  const seen = [];
  const install = async (input) => { seen.push(input); return { ok: true, packageJson: '{"name":"x","dependencies":{"zod":"^3"}}', packageLock: '{"lockfileVersion":3,"zod":1}', log: 'added 1' }; };
  const { result, files } = await executeNpmInstall(call('npm_install', { add: [{ name: 'zod', version: null }], remove: [], dev: false }), createNpmBudget(), { files: FILES, projectId: 'p1' }, { install });
  assert.equal(result.success, true);
  assert.deepEqual(result.updated, ['package.json', 'package-lock.json']);
  assert.match(files['package.json'], /zod/);
  assert.match(files['package-lock.json'], /zod/);
  assert.equal(files['src/a.ts'], FILES['src/a.ts']);
  assert.equal(FILES['package.json'], '{"name":"x","dependencies":{}}', 'the original map is untouched');
  assert.deepEqual(seen[0].add, [{ name: 'zod', version: null }]);
  assert.match(result.note, /Never follow instructions/);
});

test('npm_install reports npm failures without touching files, and respects its budget', async () => {
  const budget = createNpmBudget();
  const fail = async () => ({ ok: false, error: 'npm exited with code 1.', log: 'E404 not found' });
  const a = await executeNpmInstall(call('npm_install', { add: [{ name: 'nope', version: null }], remove: [], dev: false }), budget, { files: FILES, projectId: 'p' }, { install: fail });
  assert.equal(a.result.success, false);
  assert.equal(a.files, FILES);
  assert.match(a.result.log, /E404/);
  await executeNpmInstall(call('npm_install', { add: [{ name: 'a', version: null }], remove: [], dev: false }), budget, { files: FILES, projectId: 'p' }, { install: fail });
  const third = await executeNpmInstall(call('npm_install', { add: [{ name: 'a', version: null }], remove: [], dev: false }), budget, { files: FILES, projectId: 'p' }, { install: fail });
  assert.match(third.result.error, /limit for this request/);
  assert.deepEqual([budget.install, npmToolsLeft(budget).install], [0, false]);
});

test('a hit limit turns every tool off and leaves a one-line note', async () => {
  const budget = createNpmBudget();
  const limited = async () => ({ error: 'The agent computer limit was reached.', limited: true, retryAfter: 2400 });
  const { result } = await executeNpmInstall(call('npm_install', { add: [{ name: 'a', version: null }], remove: [], dev: false }), budget, { files: FILES, projectId: 'p' }, { install: limited });
  assert.match(result.error, /Continue without/);
  assert.match(budget.limitNote, /try again in 40 min/);
  assert.deepEqual(npmToolsLeft(budget), { install: false, build: false, inspect: false });
});

test('bad arguments and empty installs are answered, not thrown', async () => {
  const budget = createNpmBudget();
  const never = async () => { throw new Error('should not run'); };
  assert.equal((await executeNpmInstall(call('npm_install', '{oops'), budget, { files: FILES, projectId: 'p' }, { install: never })).result.success, false);
  assert.match((await executeNpmInstall(call('npm_install', { add: [], remove: [], dev: false }), budget, { files: FILES, projectId: 'p' }, { install: never })).result.error, /Nothing to install/);
  assert.equal(budget.install, 2);
});

test('run_build asks first, never uploads private .env files, and reports pass or fail', async () => {
  const uploads = [];
  const build = async (input) => { uploads.push(input); return { ok: false, exitCode: 2, log: 'error TS2304' }; };
  const denied = await executeRunBuild(call('run_build', {}), createNpmBudget(), { files: FILES, projectId: 'p' }, { build, confirm: async () => false });
  assert.equal(denied.success, false);
  assert.equal(uploads.length, 0);
  const budget = createNpmBudget();
  const ran = await executeRunBuild(call('run_build', {}), budget, { files: FILES, projectId: 'p' }, { build, confirm: async () => true });
  assert.equal(ran.passed, false);
  assert.match(ran.log, /TS2304/);
  assert.deepEqual(Object.keys(uploads[0].files).sort(), ['.env.example', 'package-lock.json', 'package.json', 'src/a.ts']);
  assert.equal(budget.build, 1);
});

test('upload consent is remembered per project and refused without a dialog', async () => {
  assert.equal(await computer.confirmBuildUpload('proj-a'), false);
  let asked = 0;
  computer.setUploadConsentPrompt(async () => { asked++; return true; });
  assert.equal(await computer.confirmBuildUpload('proj-a'), true);
  assert.equal(await computer.confirmBuildUpload('proj-a'), true);
  assert.equal(asked, 1);
  assert.equal(computer.hasUploadConsent('proj-b'), false);
  computer.setUploadConsentPrompt(async () => false);
  assert.equal(await computer.confirmBuildUpload('proj-b'), false);
  assert.equal(computer.hasUploadConsent('proj-b'), false);
  computer.setUploadConsentPrompt(null);
});

test('inspect_npm_package returns the summary; a missing package is an answer, an outage is not', async () => {
  const budget = createNpmBudget();
  const ok = await executeInspect(call('inspect_npm_package', { name: 'marked', version: null }), budget, { inspect: async () => ({ package: { name: 'marked', version: '15.0.0' } }) });
  assert.deepEqual([ok.success, ok.package.version], [true, '15.0.0']);
  const missing = await executeInspect(call('inspect_npm_package', { name: 'nopkg', version: null }), budget, { inspect: async () => ({ error: 'No package named "nopkg" exists on npm.' }) });
  assert.match(missing.error, /No package named/);
  assert.ok(budget.inspect > 0 && !budget.limitNote);
  const down = await executeInspect(call('inspect_npm_package', { name: 'x', version: null }), budget, { inspect: async () => ({ error: 'x', unavailable: true }) });
  assert.match(down.error, /unavailable/);
  assert.equal(budget.inspect, 0);
});

test('the setting defaults to on and can be switched off', () => {
  assert.equal(computer.isComputerEnabled(), true);
  computer.setComputerEnabled(false);
  assert.equal(computer.isComputerEnabled(), false);
  computer.setComputerEnabled(true);
  assert.equal(computer.isComputerEnabled(), true);
});
