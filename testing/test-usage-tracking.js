// Tests for functions/_lib/usageTracking.js:
//   1. recordApiUsage builds the Firestore commit the usage/{docId} rules
//      expect (known fields only, counter +1 per call, server timestamp)
//   2. it no-ops in self-hosted mode / without a uid / for unknown kinds
//   3. failures are swallowed -- a Firestore hiccup must never throw
//   4. handleChatProxy records exactly one 'builder' commit per successful
//      upstream call, and none on upstream failure or in self-hosted mode
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordApiUsage, trackApiUsage } from '../functions/_lib/usageTracking.js';
import { handleChatProxy } from '../functions/_lib/chatProxy.js';

const today = () => new Date().toISOString().slice(0, 10);
const isUsageCommit = (url) => String(url).includes('firestore.googleapis.com') && String(url).includes('documents:commit');

const captureUsageCommits = (t, { appCheckOk = true } = {}) => {
  const commits = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const target = String(url);
    if (target.includes('firebaseappcheck.googleapis.com')) {
      if (!appCheckOk) return new Response('denied', { status: 403 });
      return Response.json({ token: 'appcheck-test', ttl: '3600s' });
    }
    if (isUsageCommit(target)) {
      commits.push({ url: target, options });
      return Response.json({});
    }
    throw new Error(`unexpected fetch in usageTracking test: ${target}`);
  });
  return commits;
};

const parseCommit = (commit) => {
  const write = JSON.parse(commit.options.body).writes[0];
  const incrementField = write.updateTransforms.find((tr) => tr.increment)?.fieldPath;
  return {
    docId: write.update.name.split('/documents/usage/')[1],
    maskedFields: write.updateMask.fieldPaths,
    writtenFields: Object.keys(write.update.fields),
    incrementField,
    incrementValue: write.updateTransforms.find((tr) => tr.increment)?.increment.integerValue,
    serverTimestamp: write.updateTransforms.some((tr) => tr.setToServerValue === 'REQUEST_TIME'),
    transforms: write.updateTransforms.map((tr) => tr.fieldPath),
  };
};

test('records a builder increment in the shape the usage rules allow', async (t) => {
  const commits = captureUsageCommits(t);
  await recordApiUsage(
    { SELF_HOSTED_MODE: 'false', FIREBASE_PROJECT_ID: 'usage-test-proj', FIREBASE_API_KEY: 'test-key', FIREBASE_APPCHECK_DEBUG_TOKEN: 'debug-1' },
    { uid: 'user-1', kind: 'builder' },
  );
  assert.equal(commits.length, 1);
  const commit = commits[0];
  assert.ok(commit.url.includes('/projects/usage-test-proj/'), 'commit targets the env project');
  assert.equal(commit.options.headers['X-Firebase-AppCheck'], 'appcheck-test');

  const parsed = parseCommit(commit);
  assert.equal(parsed.docId, `user-1_${today()}`);
  assert.deepEqual(parsed.maskedFields, ['user_id', 'date'], 'update mask must not touch counters');
  assert.deepEqual(parsed.writtenFields, ['user_id', 'date']);
  assert.equal(parsed.incrementField, 'builderRequests');
  assert.equal(parsed.incrementValue, '1');
  assert.ok(parsed.serverTimestamp, 'updatedAt must be a server timestamp');
  assert.deepEqual(
    parsed.transforms.sort(),
    ['builderRequests', 'updatedAt'],
    'write must produce only rules-known fields',
  );
});

test('records a deployed increment for the deploying account', async (t) => {
  const commits = captureUsageCommits(t);
  await recordApiUsage(
    { SELF_HOSTED_MODE: 'false', FIREBASE_PROJECT_ID: 'usage-test-proj', FIREBASE_API_KEY: 'test-key', FIREBASE_APPCHECK_DEBUG_TOKEN: 'debug-2' },
    { uid: 'user-2', kind: 'deployed' },
  );
  assert.equal(parseCommit(commits[0]).incrementField, 'deployedRequests');
});

test('omits the App Check header when the debug token exchange fails', async (t) => {
  const commits = captureUsageCommits(t, { appCheckOk: false });
  await recordApiUsage(
    { SELF_HOSTED_MODE: 'false', FIREBASE_PROJECT_ID: 'usage-test-proj', FIREBASE_API_KEY: 'test-key', FIREBASE_APPCHECK_DEBUG_TOKEN: 'debug-3' },
    { uid: 'user-3', kind: 'builder' },
  );
  assert.equal(commits.length, 1, 'commit still attempted without an App Check token');
  assert.equal(commits[0].options.headers['X-Firebase-AppCheck'], undefined);
});

test('no-ops in self-hosted mode, without a uid, or for an unknown kind', async (t) => {
  const commits = captureUsageCommits(t);
  const env = { SELF_HOSTED_MODE: 'true', FIREBASE_PROJECT_ID: 'usage-test-proj' };
  await recordApiUsage(env, { uid: 'user-4', kind: 'builder' });
  await recordApiUsage({ SELF_HOSTED_MODE: 'false' }, { kind: 'builder' });
  await recordApiUsage({ SELF_HOSTED_MODE: 'false' }, { uid: 'user-4', kind: 'tokens' });
  assert.equal(commits.length, 0);
});

test('Firestore failures never throw', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async () => new Response('boom', { status: 500 }));
  await assert.doesNotReject(() => recordApiUsage(
    { SELF_HOSTED_MODE: 'false', FIREBASE_PROJECT_ID: 'usage-test-proj', FIREBASE_API_KEY: 'test-key', FIREBASE_APPCHECK_DEBUG_TOKEN: 'debug-5' },
    { uid: 'user-5', kind: 'builder' },
  ));

  t.mock.method(globalThis, 'fetch', () => { throw new Error('network down'); });
  await assert.doesNotReject(() => recordApiUsage(
    { SELF_HOSTED_MODE: 'false', FIREBASE_PROJECT_ID: 'usage-test-proj' },
    { uid: 'user-5', kind: 'builder' },
  ));
});

test('trackApiUsage hands the write to waitUntil when one exists', async (t) => {
  const commits = captureUsageCommits(t);
  const waited = [];
  trackApiUsage(
    { SELF_HOSTED_MODE: 'false', FIREBASE_PROJECT_ID: 'usage-test-proj', FIREBASE_API_KEY: 'test-key', FIREBASE_APPCHECK_DEBUG_TOKEN: 'debug-6' },
    { uid: 'user-6', kind: 'builder' },
    (p) => waited.push(p),
  );
  assert.equal(waited.length, 1, 'promise must be kept alive via waitUntil');
  await waited[0];
  assert.equal(commits.length, 1);
});

// --- Integration through handleChatProxy ---------------------------------
// FIREBASE_APPCHECK_ENFORCE=false bypasses RS256 JWT verification (covered by
// testing/testAppCheck.js); the usage assertion is about upstream outcomes.

const hostedEnv = {
  SELF_HOSTED_MODE: 'false',
  FIREBASE_API_KEY: 'fb-key',
  FIREBASE_APPCHECK_ENFORCE: 'false',
  APPBLIPS_LLM_BASE_URL: 'https://llm.example/v1',
  APPBLIPS_LLM_API_KEY: 'llm-key',
  APPBLIPS_LLM_MODEL: 'test-model',
  APPBLIPS_CHAT_RATE_LIMIT_MAX: '1000',
};

const captureProxyFetch = (t, { lookupUser = 'user-proxy', upstreamStatus = 200 } = {}) => {
  const commits = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const target = String(url);
    if (target.includes('firebaseappcheck.googleapis.com')) {
      return Response.json({ token: 'server-appcheck', ttl: '3600s' });
    }
    if (target.includes('identitytoolkit.googleapis.com')) {
      return Response.json({ users: lookupUser ? [{ localId: lookupUser }] : [] });
    }
    if (isUsageCommit(target)) {
      commits.push({ url: target, options });
      return Response.json({});
    }
    if (upstreamStatus !== 200) return new Response('upstream down', { status: upstreamStatus });
    return new Response(
      'data: {"choices":[{"delta":{"content":"Done"}}]}\n\ndata: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    );
  });
  return commits;
};

const postChat = (env, waitUntil) => handleChatProxy(new Request('https://app.example/api/chat', {
  method: 'POST',
  headers: { authorization: 'Bearer test-id-token' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'Build a todo app' }], stream: true }),
}), env, waitUntil);

test('a successful hosted builder call records exactly one commit', async (t) => {
  const commits = captureProxyFetch(t, { lookupUser: 'user-proxy' });
  const waited = [];
  const response = await postChat(hostedEnv, (p) => waited.push(p));
  assert.equal(response.status, 200);
  await Promise.all(waited);
  assert.equal(commits.length, 1);
  const parsed = parseCommit(commits[0]);
  assert.equal(parsed.docId, `user-proxy_${today()}`);
  assert.equal(parsed.incrementField, 'builderRequests');
});

test('a failed upstream call records nothing', async (t) => {
  const commits = captureProxyFetch(t, { upstreamStatus: 502 });
  const waited = [];
  const response = await postChat(hostedEnv, (p) => waited.push(p));
  assert.equal(response.status, 502);
  await Promise.all(waited);
  assert.equal(commits.length, 0);
});

test('self-hosted builder calls record nothing', async (t) => {
  const commits = captureProxyFetch(t);
  const waited = [];
  const response = await postChat({ ...hostedEnv, SELF_HOSTED_MODE: 'true' }, (p) => waited.push(p));
  assert.equal(response.status, 200);
  await Promise.all(waited);
  assert.equal(commits.length, 0);
});
