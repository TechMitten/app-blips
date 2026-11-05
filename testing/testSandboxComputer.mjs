// Run with: node testing/testSandboxComputer.mjs
// Covers the 1-user-to-1-sandbox computer lifecycle, Clerk + subscription
// gating, auto-sleep wake-up, filesystem snapshot recovery + old snapshot
// cleanup, single-request POSIX tar archive upload, plan-tiered compute +
// egress policies, SSE command streaming, terminal log store, and syncing
// modified files back into the app preview.

import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as signJwt } from 'node:crypto';
import { openStore } from '../electron/server/hosted/store.js';
import {
  DEFAULT_IDLE_TIMEOUT_SECONDS,
  DEFAULT_TIMEOUT_SECONDS,
  ensureUserSandbox,
  handleSandbox,
  packTarArchive,
  sandboxNetworkPolicy,
  sandboxPlanForTier,
} from '../electron/server/hosted/sandbox.js';
import {
  clearSandboxTerminalLog,
  createSandboxBudget,
  executeSandboxToolCall,
  execInSandboxComputer,
  fetchSandboxStatus,
  getSandboxTerminalLog,
  isSandboxComputerEnabled,
  snapshotSandboxComputer,
  subscribeSandboxTerminal,
} from '../src/lib/sandboxComputer.js';
import { setAuthTokenGetter } from '../src/lib/authToken.js';

const env = {
  VITE_CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from('clerk.test$').toString('base64')}`,
  APPBLIPS_HOSTED: '1',
  RENDER_API_KEY: 'rnd_test_secret',
  RENDER_WORKSPACE_ID: 'tea-workspace123',
  RENDER_API_BASE_URL: 'https://api.render.test/v1',
  RENDER_SANDBOX_PLAN_SILVER: 'pro-4gb',
  RENDER_SANDBOX_ALLOW_DOMAINS: 'registry.npmjs.org, *.npmjs.org, esm.sh',
};

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };

const b64url = (value) => Buffer.from(value).toString('base64url');
const makeToken = (claims = {}) => {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test-key' }));
  const payload = b64url(JSON.stringify({
    iss: 'https://clerk.test',
    sub: 'user_1',
    iat: now,
    nbf: now - 5,
    exp: now + 3600,
    ...claims,
  }));
  const signature = signJwt('sha256', Buffer.from(`${header}.${payload}`), privateKey);
  return `${header}.${payload}.${b64url(signature)}`;
};

// Minimal POSIX ustar reader for the mock Render server
function unpackTarArchive(buf) {
  const out = new Map();
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const fullName = prefix ? `${prefix}/${name}` : name;
    const sizeOctal = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
    const size = parseInt(sizeOctal || '0', 8);
    offset += 512;
    const content = buf.subarray(offset, offset + size).toString('utf8');
    out.set(fullName, content);
    offset += size + ((512 - (size % 512)) % 512);
  }
  return out;
}

const realFetch = globalThis.fetch;
const store = openStore(':memory:');

// In-memory fake Render Sandboxes state
let sandboxCounter = 100;
let snapshotCounter = 1;
const sandboxes = new Map(); // id -> { id, status, createBody, files: Map }
const createCalls = [];
const deletedSnapshots = [];

globalThis.fetch = async (url, init = {}) => {
  const href = String(url);

  if (href === 'https://clerk.test/.well-known/jwks.json') {
    return new Response(JSON.stringify({ keys: [publicJwk] }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  if (href === 'https://api.render.test/v1/owners?limit=20') {
    return new Response(JSON.stringify([{ owner: { id: 'tea-autodiscovered', type: 'team' } }]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Route local /api/sandbox/* calls from client helpers into handleSandbox
  if (href.startsWith('/api/sandbox') || href.startsWith('http://localhost/api/sandbox')) {
    const fullUrl = href.startsWith('/') ? `http://localhost${href}` : href;
    return handleSandbox(new Request(fullUrl, init), env, store);
  }

  // Fake Render API: POST /v1/sandboxes
  if (href === 'https://api.render.test/v1/sandboxes' && init.method === 'POST') {
    const body = JSON.parse(init.body);
    createCalls.push(body);
    const id = `sbx-${++sandboxCounter}`;
    const sbx = {
      id,
      status: 'running',
      createBody: body,
      files: new Map(),
    };
    sandboxes.set(id, sbx);
    return new Response(JSON.stringify({ id, status: 'running' }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Fake Render API: GET /v1/sandboxes/{id}
  const getMatch = /^https:\/\/api\.render\.test\/v1\/sandboxes\/(sbx-[^/?]+)\?ownerId=/.exec(href);
  if (getMatch && (!init.method || init.method === 'GET')) {
    const sbx = sandboxes.get(getMatch[1]);
    if (!sbx) return new Response(JSON.stringify({ message: 'Not found' }), { status: 404 });
    return new Response(JSON.stringify({ id: sbx.id, status: sbx.status }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Fake Render API: POST /v1/sandboxes/{id}/snapshots
  const snapMatch = /^https:\/\/api\.render\.test\/v1\/sandboxes\/(sbx-[^/?]+)\/snapshots\?ownerId=/.exec(href);
  if (snapMatch && init.method === 'POST') {
    const body = JSON.parse(init.body);
    const snapId = `sbs-snap${snapshotCounter++}`;
    return new Response(JSON.stringify({
      id: snapId,
      sandboxGroupId: 'sbg-default',
      status: 'available',
      kind: body.kind,
    }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Fake Render API: DELETE /v1/sandbox-groups/{groupId}/snapshots/{snapId}
  const delSnapMatch = /^https:\/\/api\.render\.test\/v1\/sandbox-groups\/([^/?]+)\/snapshots\/(sbs-[^/?]+)\?ownerId=/.exec(href);
  if (delSnapMatch && init.method === 'DELETE') {
    deletedSnapshots.push({ groupId: delSnapMatch[1], snapshotId: delSnapMatch[2] });
    return new Response(null, { status: 204 });
  }

  // Fake Render API: POST /v1/sandboxes/{id}/runs/stream/token
  const runTokenMatch = /^https:\/\/api\.render\.test\/v1\/sandboxes\/(sbx-[^/?]+)\/runs\/stream\/token\?ownerId=/.exec(href);
  if (runTokenMatch && init.method === 'POST') {
    const sbx = sandboxes.get(runTokenMatch[1]);
    if (sbx && sbx.status === 'suspended') {
      sbx.status = 'running';
    }
    return new Response(JSON.stringify({
      uri: `https://stream.render.test/exec/${runTokenMatch[1]}`,
      method: 'POST',
      token: `tok_exec_${runTokenMatch[1]}`,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Fake Render stream endpoint: POST https://stream.render.test/exec/{id}
  const execStreamMatch = /^https:\/\/stream\.render\.test\/exec\/(sbx-[^/?]+)$/.exec(href);
  if (execStreamMatch && init.method === 'POST') {
    const sbxId = execStreamMatch[1];
    const sbx = sandboxes.get(sbxId);
    const { command } = JSON.parse(init.body);

    // Sync-from-workspace helper script
    if (command.includes('process.stdout.write(JSON.stringify(out))')) {
      const obj = Object.fromEntries(sbx.files.entries());
      const sse = [
        `event: output\ndata: ${JSON.stringify({ stream: 'stdout', data: JSON.stringify(obj) })}\n\n`,
        `event: exit\ndata: ${JSON.stringify({ exit_code: 0 })}\n\n`,
      ].join('');
      return new Response(sse, { headers: { 'content-type': 'text/event-stream' } });
    }

    // Simulate a command modifying index.html inside /workspace
    if (command.includes('modify-index')) {
      const current = sbx.files.get('index.html') || '';
      sbx.files.set('index.html', current.replace('Hello', 'Updated by Sandbox'));
    }

    const sse = [
      `event: output\ndata: ${JSON.stringify({ stream: 'stdout', data: `ran on ${sbxId}\n` })}\n\n`,
      `event: exit\ndata: ${JSON.stringify({ exit_code: 0 })}\n\n`,
    ].join('');
    return new Response(sse, { headers: { 'content-type': 'text/event-stream' } });
  }

  // Fake Render API: file upload/download token
  const fileTokenMatch = /^https:\/\/api\.render\.test\/v1\/sandboxes\/(sbx-[^/?]+)\/files\/(upload|download)\/token\?ownerId=([^&]+)&path=(.+)$/.exec(href);
  if (fileTokenMatch && init.method === 'POST') {
    const [, sbxId, op, , encodedPath] = fileTokenMatch;
    return new Response(JSON.stringify({
      uri: `https://files.render.test/${op}/${sbxId}?path=${encodedPath}`,
      method: op === 'upload' ? 'PUT' : 'GET',
      token: `tok_file_${sbxId}`,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const fileOpMatch = /^https:\/\/files\.render\.test\/(upload|download)\/(sbx-[^/?]+)\?path=(.+)$/.exec(href);
  if (fileOpMatch) {
    const [, op, sbxId, encodedPath] = fileOpMatch;
    const sbx = sandboxes.get(sbxId);
    const fullPath = decodeURIComponent(encodedPath);
    if (op === 'upload') {
      const contentType = init.headers?.['content-type'] || init.headers?.['Content-Type'] || '';
      if (contentType === 'application/x-tar') {
        const unpacked = unpackTarArchive(Buffer.from(init.body));
        for (const [relPath, text] of unpacked.entries()) {
          sbx.files.set(relPath, text);
        }
        return new Response(null, { status: 204 });
      }
      const relPath = fullPath.replace(/^\/workspace\//, '');
      const text = Buffer.isBuffer(init.body) ? init.body.toString('utf8') : String(init.body ?? '');
      sbx.files.set(relPath, text);
      return new Response('', { status: 200 });
    }
    const relPath = fullPath.replace(/^\/workspace\//, '');
    const content = sbx.files.get(relPath);
    if (content === undefined) return new Response('Not found', { status: 404 });
    return new Response(content, { status: 200 });
  }

  throw new Error(`Unexpected fetch in testSandboxComputer: ${href}`);
};

try {
  // ---- 0. Plan-tiered compute, network policy, and tar packing --------------
  assert.equal(sandboxPlanForTier(env, 'silver'), 'pro-4gb');
  assert.equal(sandboxPlanForTier(env, 'basic'), '');
  assert.deepEqual(sandboxNetworkPolicy(env), {
    type: 'allow-list',
    rules: [
      { domain: 'registry.npmjs.org' },
      { domain: '*.npmjs.org' },
      { domain: 'esm.sh' },
    ],
  });

  const longPath = 'src/components/deeply/nested/feature/subfeature/super/long/directory/structure/ComponentNameWithLotsOfCharacters.tsx';
  const tarRoundtrip = unpackTarArchive(packTarArchive({
    'index.html': '<!doctype html>',
    [longPath]: 'export const ok = true;',
  }));
  assert.equal(tarRoundtrip.get('index.html'), '<!doctype html>');
  assert.equal(tarRoundtrip.get(longPath), 'export const ok = true;');

  // ---- 1. Active subscription & Clerk auth gate -----------------------------
  store.saveAccount({ userId: 'user_1', customerId: 'cust_1', plan: 'basic', active: true });
  store.saveAccount({ userId: 'user_2', customerId: 'cust_2', plan: 'silver', active: true });
  store.saveAccount({ userId: 'user_inactive', customerId: 'cust_3', plan: 'basic', active: false });

  const unauthRes = await handleSandbox(new Request('http://localhost/api/sandbox/exec', {
    method: 'POST',
    body: JSON.stringify({ command: 'echo hi' }),
  }), env, store);
  assert.equal(unauthRes.status, 401);

  const inactiveToken = makeToken({ sub: 'user_inactive' });
  const inactiveRes = await handleSandbox(new Request('http://localhost/api/sandbox/exec', {
    method: 'POST',
    headers: { authorization: `Bearer ${inactiveToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ command: 'echo hi' }),
  }), env, store);
  assert.equal(inactiveRes.status, 402);
  assert.equal((await inactiveRes.json()).code, 'subscription_required');

  // ---- 2. 1:1 User <-> Computer provisioning & isolation -------------------
  const [ensured1a, ensured1b] = await Promise.all([
    ensureUserSandbox('user_1', env, store),
    ensureUserSandbox('user_1', env, store),
  ]);
  assert.equal(ensured1a.sandboxId, 'sbx-101');
  assert.equal(ensured1b.sandboxId, 'sbx-101', 'concurrent calls for user_1 must share one sandbox');
  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0].timeoutSeconds, DEFAULT_TIMEOUT_SECONDS);
  assert.equal(createCalls[0].idleTimeoutSeconds, DEFAULT_IDLE_TIMEOUT_SECONDS);
  assert.equal(createCalls[0].networkPolicy.type, 'allow-list');
  assert.equal(store.getAccount('user_1').sandbox_id, 'sbx-101');

  const ensured2 = await ensureUserSandbox('user_2', env, store);
  assert.equal(ensured2.sandboxId, 'sbx-102', 'user_2 must get their own isolated sandbox');
  assert.equal(createCalls[1].plan, 'pro-4gb', 'silver user gets silver tier compute plan');
  assert.notEqual(ensured1a.sandboxId, ensured2.sandboxId);

  // ---- 3. Auto-wake, snapshot rotation, & recovery when terminated ---------
  sandboxes.get('sbx-101').status = 'suspended';
  const woken = await ensureUserSandbox('user_1', env, store);
  assert.equal(woken.sandboxId, 'sbx-101');
  assert.equal(woken.created, false);
  assert.equal(sandboxes.get('sbx-101').status, 'running');

  const token1 = makeToken({ sub: 'user_1' });
  setAuthTokenGetter(async () => token1);

  const statusInfo = await fetchSandboxStatus();
  assert.equal(statusInfo.configured, true);
  assert.equal(statusInfo.sandboxId, 'sbx-101');
  assert.equal(isSandboxComputerEnabled(), true);

  const snap1 = await snapshotSandboxComputer();
  assert.equal(snap1.snapshotId, 'sbs-snap1');
  assert.equal(store.getAccount('user_1').sandbox_snapshot_id, 'sbs-snap1');
  assert.equal(deletedSnapshots.length, 0);

  // Second snapshot replaces sbs-snap1 and deletes sbs-snap1 on Render
  const snap2 = await snapshotSandboxComputer();
  assert.equal(snap2.snapshotId, 'sbs-snap2');
  assert.equal(snap2.replacedSnapshotId, 'sbs-snap1');
  assert.equal(store.getAccount('user_1').sandbox_snapshot_id, 'sbs-snap2');
  assert.deepEqual(deletedSnapshots, [{ groupId: 'sbg-default', snapshotId: 'sbs-snap1' }]);

  // Simulate sbx-101 terminating; next ensure must restore from sbs-snap2
  sandboxes.get('sbx-101').status = 'terminated';
  const recovered = await ensureUserSandbox('user_1', env, store);
  assert.equal(recovered.sandboxId, 'sbx-103');
  assert.equal(recovered.created, true);
  assert.equal(recovered.restoredFromSnapshot, true);
  assert.equal(createCalls.at(-1).snapshotId, 'sbs-snap2');
  assert.equal(store.getAccount('user_1').sandbox_id, 'sbx-103');

  // ---- 4. Live SSE exec, terminal log store, & tar file sync ---------------
  clearSandboxTerminalLog();
  let notifiedCount = 0;
  const unsubscribe = subscribeSandboxTerminal(() => { notifiedCount++; });

  const chunks = [];
  const execResult = await execInSandboxComputer({
    command: 'echo test',
    onOutput: (chunk) => chunks.push(chunk),
  });
  assert.equal(execResult.exitCode, 0);
  assert.equal(execResult.stdout, 'ran on sbx-103\n');
  assert.equal(chunks.length, 1);
  assert.ok(notifiedCount >= 2, 'terminal subscriber was notified');
  assert.equal(getSandboxTerminalLog().length, 1);
  assert.equal(getSandboxTerminalLog()[0].command, 'echo test');
  assert.equal(getSandboxTerminalLog()[0].running, false);
  unsubscribe();

  // Test the AI tool `run_sandbox_command` syncing files via tar to /workspace and back
  const budget = createSandboxBudget(2);
  const initialState = { files: { 'index.html': '<h1>Hello</h1>' }, assets: {} };
  const toolOutcome = await executeSandboxToolCall(initialState, {
    function: {
      name: 'run_sandbox_command',
      arguments: JSON.stringify({ command: 'modify-index', sync_files_back: true }),
    },
  }, budget);

  assert.equal(toolOutcome.applied, true, 'modified file in sandbox should mark applied: true');
  assert.equal(toolOutcome.state.files['index.html'], '<h1>Updated by Sandbox</h1>');
  assert.deepEqual(toolOutcome.result.changedFiles, ['index.html']);
  assert.equal(budget.left, 1);
  assert.equal(budget.used, 1);

  // Path traversal on upload is rejected
  const badUpload = await handleSandbox(new Request('http://localhost/api/sandbox/upload', {
    method: 'POST',
    headers: { authorization: `Bearer ${token1}`, 'content-type': 'application/json' },
    body: JSON.stringify({ path: '../etc/passwd', content: 'nope' }),
  }), env, store);
  assert.equal(badUpload.status, 502);

  // Auto-discovers workspace ID from /v1/owners when RENDER_WORKSPACE_ID is omitted
  const keyOnlyEnv = { ...env, RENDER_WORKSPACE_ID: '' };
  const autoDiscovered = await ensureUserSandbox('user_autodiscover', keyOnlyEnv, store);
  assert.ok(autoDiscovered.sandboxId);
  assert.equal(createCalls.at(-1).ownerId, 'tea-autodiscovered');

  console.log('Sandbox computer checks passed: tar bulk upload, snapshot cleanup, plan tiers, egress rules, terminal log, and preview file sync.');
} finally {
  clearSandboxTerminalLog();
  setAuthTokenGetter(null);
  store.close();
  globalThis.fetch = realFetch;
}
