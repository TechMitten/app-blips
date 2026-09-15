import assert from 'node:assert/strict';
import { handleAiChat } from '../functions/_lib/aiRelay.js';
import { clearRateLimitsForTesting } from '../functions/_lib/rateLimit.js';

const secret = 'server-only-test-key';
const baseEnv = {
  FIREBASE_PROJECT_ID: 'test-project',
  APPBLIPS_APP_LLM_BASE_URL: 'https://provider.invalid/v1',
  APPBLIPS_APP_LLM_API_KEY: secret,
  APPBLIPS_APP_LLM_MODEL: 'forced-model',
  APPBLIPS_APP_LLM_MAX_TOKENS: '100',
  APPBLIPS_AI_RATE_LIMIT_MAX: '20',
  APPBLIPS_AI_RATE_LIMIT_WINDOW_SECONDS: '60',
};

const request = (body) => new Request('https://my.appblips.com/ai/chat', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'https://my.appblips.com' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const installFetch = ({ validToken, inspectUpstream, upstreamStatus = 200 }) => {
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('firebaseappcheck.googleapis.com')) {
      return Response.json({ token: 'server-app-check', ttl: '3600s' });
    }
    if (String(url).includes('firestore.googleapis.com')) {
      assert.equal(options.headers['X-Firebase-AppCheck'], 'server-app-check');
      const query = JSON.parse(options.body);
      assert.equal(query.structuredQuery.where.fieldFilter.value.stringValue, validToken);
      return Response.json([{ document: { fields: {
        aiEnabled: { booleanValue: true },
        aiToken: { stringValue: validToken },
      } } }]);
    }
    const body = JSON.parse(options.body);
    inspectUpstream?.(url, options, body);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
      status: upstreamStatus,
      headers: { 'content-type': 'application/json' },
    });
  };
};

const assertNoSecret = async (response) => {
  const body = await response.clone().text();
  assert.equal(body.includes(secret), false, 'server key leaked in response');
};

clearRateLimitsForTesting();
let response = await handleAiChat(request({ messages: [{ role: 'user', content: 'hi' }] }), baseEnv);
assert.equal(response.status, 403);
await assertNoSecret(response);

// Missing/foreign Origin is rejected (no durable non-browser clients allowed).
const noOrigin = new Request('https://my.appblips.com/ai/chat', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
});
response = await handleAiChat(noOrigin, baseEnv);
assert.equal(response.status, 403);
await assertNoSecret(response);

const foreignOrigin = new Request('https://my.appblips.com/ai/chat', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'https://attacker.invalid' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
});
response = await handleAiChat(foreignOrigin, baseEnv);
assert.equal(response.status, 403);
await assertNoSecret(response);

const forcedToken = `force-${Date.now()}`;
installFetch({
  validToken: forcedToken,
  inspectUpstream(url, options, body) {
    assert.equal(url, 'https://provider.invalid/v1/chat/completions');
    assert.equal(options.headers.authorization, `Bearer ${secret}`);
    assert.equal(body.model, 'forced-model');
    assert.equal(body.reasoning_effort, 'none');
    assert.equal(body.max_tokens, 100);
    assert.equal(body.base_url, undefined);
    assert.equal(body.tools, undefined);
    assert.deepEqual(body.messages, [{ role: 'user', content: 'hello' }]);
  },
});
response = await handleAiChat(request({
  token: forcedToken,
  messages: [{ role: 'user', content: 'hello', tools: ['discard'] }],
  model: 'attacker-model',
  base_url: 'https://attacker.invalid',
  tools: ['discard'],
  max_tokens: 99999,
}), baseEnv);
assert.equal(response.status, 200);
await assertNoSecret(response);

response = await handleAiChat(request('x'.repeat((256 * 1024) + 1)), baseEnv);
assert.equal(response.status, 413);
await assertNoSecret(response);

clearRateLimitsForTesting();
const limitedToken = `limited-${Date.now()}`;
installFetch({ validToken: limitedToken });
const limitedEnv = { ...baseEnv, APPBLIPS_AI_RATE_LIMIT_MAX: '1' };
assert.equal((await handleAiChat(request({ token: limitedToken, messages: [{ role: 'user', content: 'one' }] }), limitedEnv)).status, 200);
response = await handleAiChat(request({ token: limitedToken, messages: [{ role: 'user', content: 'two' }] }), limitedEnv);
assert.equal(response.status, 429);
assert.ok(response.headers.get('Retry-After'));
await assertNoSecret(response);

const failureToken = `failure-${Date.now()}`;
installFetch({ validToken: failureToken, upstreamStatus: 500 });
clearRateLimitsForTesting();
response = await handleAiChat(request({ token: failureToken, messages: [{ role: 'user', content: 'fail' }] }), baseEnv);
assert.equal(response.status, 502);
await assertNoSecret(response);

console.log('AI relay security checks passed.');

// Published Functions may lack the build-time VITE_FIREBASE_* variables.
// AI must use the same project and App Check identity as the app-serving route.
const fallbackToken = 'production-defaults-regression';
const originalMock = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (String(url).includes('firebaseappcheck.googleapis.com')) {
    assert.ok(String(url).includes('/projects/appbips-f46e2/apps/'));
    return Response.json({ token: 'server-app-check', ttl: '3600s' });
  }
  if (String(url).includes('firestore.googleapis.com')) {
    assert.ok(String(url).includes('/projects/appbips-f46e2/'));
    assert.equal(options.headers['X-Firebase-AppCheck'], 'server-app-check');
    return Response.json([{ document: { fields: {
      aiEnabled: { booleanValue: true },
      aiToken: { stringValue: fallbackToken },
    } } }]);
  }
  if (String(url).includes('provider.invalid')) return Response.json({ choices: [{ message: { content: 'ok' } }] });
  return originalMock(url, options);
};
const productionEnv = { ...baseEnv };
delete productionEnv.FIREBASE_PROJECT_ID;
response = await handleAiChat(request({ token: fallbackToken, messages: [{ role: 'user', content: 'hi' }] }), productionEnv);
assert.equal(response.status, 200);
assert.equal((await response.json()).choices[0].message.content, 'ok');
console.log('Published Firebase configuration regression passed.');
