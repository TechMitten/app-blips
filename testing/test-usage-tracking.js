// Tests for functions/_lib/usageTracking.js:
//   1. recordApiUsage posts one increment to the Supabase `record_usage` RPC
//   2. it no-ops in single-user mode / without a uid / for unknown kinds / without a service key
//   3. failures are swallowed -- a Supabase hiccup must never throw
//   4. handleChatProxy records exactly one 'builder' increment per successful
//      upstream call, and none on upstream failure or in single-user mode
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordApiUsage, trackApiUsage } from '../functions/_lib/usageTracking.js';
import { handleChatProxy } from '../functions/_lib/chatProxy.js';

const today = () => new Date().toISOString().slice(0, 10);

const multiUserEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'pk',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
};

const isIncrementCall = (url) => String(url).includes('/rest/v1/rpc/record_usage');

test('recordApiUsage posts an increment to the Supabase RPC', async (t) => {
  let called;
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    called = { url: String(url), headers: options.headers, body: JSON.parse(options.body) };
    return Response.json({});
  });
  await recordApiUsage(multiUserEnv, { uid: 'user-1', kind: 'builder', tokens: 42, costMicros: 1500, cachedTokens: 30 });
  assert.ok(called.url.includes('/rest/v1/rpc/record_usage'), 'targets the record_usage RPC');
  assert.equal(called.headers.authorization, 'Bearer service-key');
  assert.equal(called.headers.apikey, 'service-key');
  assert.deepEqual(called.body, {
    target_user_id: 'user-1',
    usage_date: today(),
    usage_kind: 'builder',
    token_count: 42,
    cost: 1500,
    cached: 30,
  });
});

test('recordApiUsage no-ops in single-user mode, without a uid, for an unknown kind, or without a service key', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => { calls.push(String(url)); return Response.json({}); });
  await recordApiUsage({}, { uid: 'user-4', kind: 'builder' });
  await recordApiUsage(multiUserEnv, { kind: 'builder' });
  await recordApiUsage(multiUserEnv, { uid: 'user-4', kind: 'tokens' });
  await recordApiUsage(
    { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'pk' },
    { uid: 'user-4', kind: 'builder' },
  );
  assert.equal(calls.length, 0);
});

test('recordApiUsage never throws on Supabase failures', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async () => new Response('boom', { status: 500 }));
  await assert.doesNotReject(() => recordApiUsage(multiUserEnv, { uid: 'user-5', kind: 'builder' }));

  t.mock.method(globalThis, 'fetch', () => { throw new Error('network down'); });
  await assert.doesNotReject(() => recordApiUsage(multiUserEnv, { uid: 'user-5', kind: 'builder' }));
});

test('trackApiUsage hands the write to waitUntil when one exists', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => { calls.push(String(url)); return Response.json({}); });
  const waited = [];
  trackApiUsage(multiUserEnv, { uid: 'user-6', kind: 'builder' }, (p) => waited.push(p));
  assert.equal(waited.length, 1, 'promise must be kept alive via waitUntil');
  await waited[0];
  assert.equal(calls.length, 1);
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

const captureProxyFetch = (t, { lookupUser = 'user-proxy', upstreamStatus = 200 } = {}) => {
  const increments = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const target = String(url);
    if (target.includes('/auth/v1/user')) {
      return Response.json(lookupUser ? { id: lookupUser } : null);
    }
    if (isIncrementCall(target)) {
      increments.push({ url: target, options });
      return Response.json({});
    }
    if (upstreamStatus !== 200) return new Response('upstream down', { status: upstreamStatus });
    return new Response(SSE_WITH_USAGE, { headers: { 'content-type': 'text/event-stream' } });
  });
  return increments;
};

const postChat = (env, waitUntil) => handleChatProxy(new Request('https://app.example/api/chat', {
  method: 'POST',
  headers: { authorization: 'Bearer test-id-token' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'Build a todo app' }], stream: true }),
}), env, waitUntil);

test('a successful multi-user builder call records exactly one increment', async (t) => {
  const increments = captureProxyFetch(t, { lookupUser: 'user-proxy' });
  const waited = [];
  const response = await postChat(proxyEnv, (p) => waited.push(p));
  assert.equal(response.status, 200);
  await response.text(); // drain the stream so the token-tracking flush runs
  await Promise.all(waited);
  assert.equal(increments.length, 1);
  assert.deepEqual(JSON.parse(increments[0].options.body), {
    target_user_id: 'user-proxy',
    usage_date: today(),
    usage_kind: 'builder',
    token_count: 7,
    cost: 0,
    cached: 0,
  });
});

test('a failed upstream call records nothing', async (t) => {
  const increments = captureProxyFetch(t, { upstreamStatus: 502 });
  const waited = [];
  const response = await postChat(proxyEnv, (p) => waited.push(p));
  assert.equal(response.status, 502);
  await Promise.all(waited);
  assert.equal(increments.length, 0);
});

test('single-user builder calls record nothing', async (t) => {
  const increments = captureProxyFetch(t);
  const waited = [];
  const singleUser = { ...proxyEnv, SUPABASE_URL: undefined, SUPABASE_PUBLISHABLE_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined };
  const response = await postChat(singleUser, (p) => waited.push(p));
  assert.equal(response.status, 200);
  await response.text();
  await Promise.all(waited);
  assert.equal(increments.length, 0);
});
