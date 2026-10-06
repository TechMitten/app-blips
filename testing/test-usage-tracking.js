// Tests for functions/_lib/usageTracking.js:
//   1. recordApiUsage adds one request plus its tokens/cost to today's
//      usage/{uid}_{date} doc, and settles a reservation instead of adding twice
//   2. it no-ops in single-user mode / without a uid / for unknown kinds / without a service account
//   3. failures are swallowed -- a Firestore hiccup must never throw
//   4. handleChatProxy records exactly one 'builder' request per successful
//      upstream call, and none on upstream failure or in single-user mode
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordApiUsage, trackApiUsage, usageDocPath } from '../functions/_lib/usageTracking.js';
import { handleChatProxy } from '../functions/_lib/chatProxy.js';
import { installFirebaseFake, firebaseEnv, signIdToken, PROJECT_ID } from './firebaseFake.js';

const today = () => new Date().toISOString().slice(0, 10);
const multiUserEnv = firebaseEnv();

test('recordApiUsage adds the request to today\'s usage doc', async (t) => {
  const { firestore } = installFirebaseFake(t);
  await recordApiUsage(multiUserEnv, { uid: 'user-1', kind: 'builder', tokens: 42, costMicros: 1500, cachedTokens: 30 });
  await recordApiUsage(multiUserEnv, { uid: 'user-1', kind: 'builder', tokens: 8 });
  const usage = firestore.getData(usageDocPath('user-1', today()));
  assert.equal(usage.user_id, 'user-1');
  assert.equal(usage.date, today());
  assert.equal(usage.builder_requests, 2);
  assert.equal(usage.builder_tokens, 50);
  assert.equal(usage.cost_micros, 1500);
  assert.equal(usage.cached_tokens, 30);
});

test('recordApiUsage settles a reservation on the day it was made, floored at zero', async (t) => {
  const { firestore } = installFirebaseFake(t);
  firestore.set(usageDocPath('user-2', '2026-01-01'), { user_id: 'user-2', date: '2026-01-01', builder_tokens: 1000, builder_requests: 0 });
  await recordApiUsage(multiUserEnv, { uid: 'user-2', kind: 'builder', tokens: 120, reservation: { date: '2026-01-01', tokens: 900 } });
  const usage = firestore.getData(usageDocPath('user-2', '2026-01-01'));
  assert.equal(usage.builder_tokens, 220, 'the 900 held is replaced by the 120 used');
  assert.equal(usage.builder_requests, 1);
  assert.equal(firestore.getData(usageDocPath('user-2', today())), null, 'nothing lands on today');

  await recordApiUsage(multiUserEnv, { uid: 'user-2', kind: 'builder', tokens: 0, reservation: { date: '2026-01-01', tokens: 5000 } });
  assert.equal(firestore.getData(usageDocPath('user-2', '2026-01-01')).builder_tokens, 0);
});

test('recordApiUsage no-ops in single-user mode, without a uid, for an unknown kind, or without a service account', async (t) => {
  const { calls } = installFirebaseFake(t);
  await recordApiUsage({}, { uid: 'user-4', kind: 'builder' });
  await recordApiUsage(multiUserEnv, { kind: 'builder' });
  await recordApiUsage(multiUserEnv, { uid: 'user-4', kind: 'tokens' });
  await recordApiUsage({ FIREBASE_PROJECT_ID: PROJECT_ID }, { uid: 'user-4', kind: 'builder' });
  assert.equal(calls.length, 0);
});

test('recordApiUsage never throws on Firestore failures', async (t) => {
  t.mock.method(console, 'error', () => {});
  installFirebaseFake(t, {});
  t.mock.method(globalThis, 'fetch', async () => new Response('boom', { status: 500 }));
  await assert.doesNotReject(() => recordApiUsage(multiUserEnv, { uid: 'user-5', kind: 'builder' }));

  t.mock.method(globalThis, 'fetch', () => { throw new Error('network down'); });
  await assert.doesNotReject(() => recordApiUsage(multiUserEnv, { uid: 'user-5', kind: 'builder' }));
});

test('trackApiUsage hands the write to waitUntil when one exists', async (t) => {
  const { firestore } = installFirebaseFake(t);
  const waited = [];
  trackApiUsage(multiUserEnv, { uid: 'user-6', kind: 'builder' }, (p) => waited.push(p));
  assert.equal(waited.length, 1, 'promise must be kept alive via waitUntil');
  await waited[0];
  assert.equal(firestore.getData(usageDocPath('user-6', today())).builder_requests, 1);
});

// --- Integration through handleChatProxy ---------------------------------

const proxyEnv = {
  ...multiUserEnv,
  OPENAI_BASE_URL: 'https://llm.example/v1',
  OPENAI_API_KEY: 'llm-key',
  OPENAI_LLM_MODEL: 'test-model',
  APPBLIPS_CHAT_RATE_LIMIT_MAX: '1000',
};

const SSE_WITH_USAGE =
  'data: {"choices":[{"delta":{"content":"Done"}}],"usage":{"total_tokens":7}}\n\ndata: [DONE]\n\n';

const fakeUpstream = (status = 200) => async () => (status !== 200
  ? new Response('upstream down', { status })
  : new Response(SSE_WITH_USAGE, { headers: { 'content-type': 'text/event-stream' } }));

const postChat = async (env, waitUntil, uid = 'user-proxy') => handleChatProxy(new Request('https://app.example/api/chat', {
  method: 'POST',
  headers: { authorization: `Bearer ${await signIdToken(uid)}` },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'Build a todo app' }], stream: true }),
}), env, waitUntil);

test('a successful multi-user builder call records exactly one request', async (t) => {
  const { firestore } = installFirebaseFake(t, { fallback: fakeUpstream() });
  const waited = [];
  const response = await postChat(proxyEnv, (p) => waited.push(p));
  assert.equal(response.status, 200);
  await response.text(); // drain the stream so the token-tracking flush runs
  await Promise.all(waited);
  const usage = firestore.getData(usageDocPath('user-proxy', today()));
  assert.equal(usage.builder_requests, 1);
  assert.equal(usage.builder_tokens, 7);
});

test('a failed upstream call records nothing', async (t) => {
  const { firestore } = installFirebaseFake(t, { fallback: fakeUpstream(502) });
  const waited = [];
  const response = await postChat(proxyEnv, (p) => waited.push(p));
  assert.equal(response.status, 502);
  await Promise.all(waited);
  assert.equal(firestore.getData(usageDocPath('user-proxy', today())), null);
});

test('single-user builder calls record nothing', async (t) => {
  const { calls } = installFirebaseFake(t, { fallback: fakeUpstream() });
  const waited = [];
  const singleUser = { ...proxyEnv, FIREBASE_PROJECT_ID: undefined, FIREBASE_SERVICE_ACCOUNT: undefined };
  const response = await postChat(singleUser, (p) => waited.push(p));
  assert.equal(response.status, 200);
  await response.text();
  await Promise.all(waited);
  assert.ok(calls.every((call) => !call.url.includes('firestore')), 'no Firestore traffic');
});
