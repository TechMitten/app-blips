// Browser-version server (server.js): static files, the Host allow-list and
// the /api/chat route. Needs a build first.
// Run: npm run build && node --test testing/testServer.js
import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 3000 + Math.floor(Math.random() * 1000) + 1000;
let server;

// Raw http.request so tests can send any Host header and paths fetch would
// normalize (../).
const get = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port: PORT, path, method, headers: { host: `localhost:${PORT}`, ...headers } }, (res) => {
    let text = '';
    res.on('data', (c) => { text += c; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
  });
  req.on('error', reject);
  req.end(body);
});

before(async () => {
  // A temp cwd, so a developer's own .env isn't loaded into the test.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('OPENAI_') && !k.startsWith('APPBLIPS_')));
  server = spawn(process.execPath, [`${ROOT}server.js`], { cwd: tmpdir(), env: { ...env, PORT: String(PORT), HOST: '127.0.0.1' } });
  let output = '';
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (c) => { output += c; if (output.includes('AppBlips is running')) resolve(); });
    server.stderr.on('data', (c) => { output += c; });
    server.on('exit', (code) => reject(new Error(`server exited (${code}): ${output}`)));
  });
});

after(() => server?.kill());

test('serves the app with security headers, and falls back to index.html', async () => {
  const index = await get('/');
  assert.equal(index.status, 200);
  assert.match(index.headers['content-type'], /text\/html/);
  assert.equal(index.headers['cache-control'], 'no-cache');
  assert.equal(index.headers['content-security-policy'], "frame-ancestors 'none'");
  assert.equal(index.headers['x-content-type-options'], 'nosniff');
  const route = await get('/some/client/route');
  assert.equal(route.status, 200);
  assert.equal(route.text, index.text);
});

test('hashed assets are immutable, and wasm has the type instantiateStreaming needs', async () => {
  const wasm = readdirSync(`${ROOT}dist/assets`).find((f) => f.endsWith('.wasm'));
  assert.ok(wasm, 'build has a .wasm asset');
  const res = await get(`/assets/${wasm}`, { method: 'HEAD' });
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/wasm');
  assert.match(res.headers['cache-control'], /immutable/);
  assert.equal(res.text, '');
});

test('never serves files outside dist/', async () => {
  for (const path of ['/../package.json', '/%2e%2e/package.json', '/..%2fpackage.json', '/assets/..%2f..%2fserver.js']) {
    const res = await get(path);
    assert.ok(!res.text.includes('"devDependencies"') && !res.text.includes('createServer'), `${path} leaked a file`);
  }
});

test('rejects Host names that are not this computer (DNS rebinding)', async () => {
  for (const host of [`evil.example:${PORT}`, `192.168.1.5:${PORT}`, 'localhost.evil.example']) {
    assert.equal((await get('/', { headers: { host } })).status, 403, host);
  }
  for (const host of [`127.0.0.1:${PORT}`, `[::1]:${PORT}`, `app.localhost:${PORT}`]) {
    assert.equal((await get('/', { headers: { host } })).status, 200, host);
  }
});

test('/api/chat: POST only, foreign origins refused, unconfigured provider explained', async () => {
  assert.equal((await get('/api/chat')).status, 405);
  const foreign = await get('/api/chat', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(foreign.status, 403);
  const sandboxed = await get('/api/chat', { method: 'POST', headers: { origin: 'null', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(sandboxed.status, 403);
  const own = await get('/api/chat', { method: 'POST', headers: { origin: `http://localhost:${PORT}`, 'content-type': 'application/json' }, body: '{"messages":[]}' });
  assert.equal(own.status, 500);
  assert.match(JSON.parse(own.text).error, /Settings → AI/);
  assert.equal(own.headers['x-content-type-options'], 'nosniff');
});

test('other methods are refused', async () => {
  assert.equal((await get('/', { method: 'DELETE' })).status, 405);
});
