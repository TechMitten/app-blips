// The agent computer relay (electron/server/computerApi.js) against a stubbed
// Worker. No network. Run: node testing/testComputerApi.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleComputerApi } from '../electron/server/computerApi.js';

const ORIGIN = 'http://localhost:5175';

const memoryTokens = () => {
  let state = { id: '', key: '' };
  return {
    describe: () => ({ id: state.id, hasKey: Boolean(state.key) }),
    keyFor: (wanted) => (wanted && wanted === state.id ? state.key : ''),
    save: async (id, key) => { state = { id, key }; },
    clear: async () => { state = { id: '', key: '' }; },
  };
};

const request = (path, { method = 'GET', body, origin = ORIGIN, type = 'application/json' } = {}) => new Request(`${ORIGIN}${path}`, {
  method,
  headers: { ...(body ? { 'content-type': type } : {}), ...(origin ? { origin } : {}) },
  ...(body ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
});

const call = async (path, options, { tokens = memoryTokens(), env = {}, fetch } = {}) => {
  const response = await handleComputerApi(request(path, options), env, tokens, { fetch });
  return { status: response.status, body: await response.json() };
};

const worker = (status, body) => {
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, seen };
};

test('status says whether the host has the computer on', async () => {
  assert.deepEqual((await call('/api/computer')).body, { available: true });
  assert.deepEqual((await call('/api/computer', {}, { env: { APPBLIPS_COMPUTER: 'off' } })).body, { available: false });
});

test('a foreign origin is refused', async () => {
  const { status } = await call('/api/computer/npm/inspect', { method: 'POST', body: { name: 'react' }, origin: 'https://evil.example' }, { fetch: worker(200, {}).fetch });
  assert.equal(status, 403);
});

test('the install ID is made once, sent as a header, and never returned', async () => {
  const tokens = memoryTokens();
  const stub = worker(200, { package: { name: 'react' } });
  const first = await call('/api/computer/npm/inspect', { method: 'POST', body: { name: 'react', version: null } }, { tokens, fetch: stub.fetch });
  await call('/api/computer/npm/inspect', { method: 'POST', body: { name: 'zod', version: null } }, { tokens, fetch: stub.fetch });
  assert.deepEqual(first.body, { package: { name: 'react' } });
  const [a, b] = stub.seen.map((s) => s.headers['x-appblips-install']);
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.equal(a, b);
  assert.equal(stub.seen[0].url, 'https://computer.appblips.com/v1/npm/inspect');
  assert.ok(!JSON.stringify(first.body).includes(a));
});

test('APPBLIPS_COMPUTER_ORIGIN redirects the relay and APPBLIPS_COMPUTER=off blocks it', async () => {
  const stub = worker(200, { ok: true });
  await call('/api/computer/npm/build', { method: 'POST', body: { projectId: 'p', files: {} } }, { env: { APPBLIPS_COMPUTER_ORIGIN: 'http://localhost:8787/' }, fetch: stub.fetch });
  assert.equal(stub.seen[0].url, 'http://localhost:8787/v1/npm/build');
  const off = await call('/api/computer/npm/build', { method: 'POST', body: { projectId: 'p', files: {} } }, { env: { APPBLIPS_COMPUTER: 'off' }, fetch: stub.fetch });
  assert.equal(off.status, 503);
  assert.equal(stub.seen.length, 1);
});

test('429 passes retryAfter through; 503 and 5xx become "unavailable"', async () => {
  const limited = await call('/api/computer/npm/install', { method: 'POST', body: { projectId: 'p' } }, { fetch: worker(429, { error: 'limit_reached', retryAfter: 2400 }).fetch });
  assert.equal(limited.status, 429);
  assert.deepEqual([limited.body.limited, limited.body.retryAfter], [true, 2400]);
  const off = await call('/api/computer/npm/install', { method: 'POST', body: { projectId: 'p' } }, { fetch: worker(503, { error: 'disabled' }).fetch });
  assert.equal(off.body.unavailable, true);
  const broken = await call('/api/computer/npm/install', { method: 'POST', body: { projectId: 'p' } }, { fetch: worker(500, { error: 'boom' }).fetch });
  assert.equal(broken.body.unavailable, true);
  assert.ok(!JSON.stringify(broken.body).includes('boom'));
});

test('a 4xx from the Worker keeps its message; an unreachable Worker is "unavailable"', async () => {
  const bad = await call('/api/computer/npm/inspect', { method: 'POST', body: { name: 'x' } }, { fetch: worker(400, { error: 'Not a valid npm package name.' }).fetch });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'Not a valid npm package name.');
  const down = await call('/api/computer/npm/inspect', { method: 'POST', body: { name: 'x' } }, { fetch: async () => { throw new Error('offline'); } });
  assert.equal(down.status, 502);
  assert.equal(down.body.unavailable, true);
});

test('bad requests are rejected before reaching the Worker', async () => {
  const stub = worker(200, {});
  assert.equal((await call('/api/computer/npm/install', { method: 'GET' }, { fetch: stub.fetch })).status, 405);
  assert.equal((await call('/api/computer/npm/install', { method: 'POST', body: '[]' }, { fetch: stub.fetch })).status, 400);
  assert.equal((await call('/api/computer/npm/install', { method: 'POST', body: 'x', type: 'text/plain' }, { fetch: stub.fetch })).status, 400);
  assert.equal((await call('/api/computer/shell', { method: 'POST', body: { cmd: 'ls' } }, { fetch: stub.fetch })).status, 404);
  assert.equal(stub.seen.length, 0);
});
