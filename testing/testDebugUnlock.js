import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { handleDebugUnlock } from '../functions/_lib/debugUnlock.js';
import { clearRateLimitsForTesting } from '../functions/_lib/rateLimit.js';

const env = { APPBLIPS_DEBUG_PIN: '4821' };

const post = (body, headers = {}) =>
  new Request('https://app.example/api/debug-unlock', {
    method: 'POST',
    headers: { 'x-forwarded-for': '203.0.113.7', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

beforeEach(() => clearRateLimitsForTesting());

test('feature is invisible (404) when no PIN is configured', async () => {
  const response = await handleDebugUnlock(post({ pin: '4821' }), {});
  assert.equal(response.status, 404);
});

test('rejects non-POST', async () => {
  const response = await handleDebugUnlock(new Request('https://app.example/api/debug-unlock'), env);
  assert.equal(response.status, 405);
});

test('correct PIN unlocks, wrong PIN does not', async () => {
  assert.deepEqual(await (await handleDebugUnlock(post({ pin: '4821' }), env)).json(), { ok: true });
  assert.deepEqual(await (await handleDebugUnlock(post({ pin: '4822' }), env)).json(), { ok: false });
  assert.deepEqual(await (await handleDebugUnlock(post({ pin: '48210' }), env)).json(), { ok: false });
  assert.deepEqual(await (await handleDebugUnlock(post({ pin: 4821 }), env)).json(), { ok: false });
  assert.deepEqual(await (await handleDebugUnlock(post({}), env)).json(), { ok: false });
});

test('malformed JSON is a 400 and oversize bodies are a 413', async () => {
  assert.equal((await handleDebugUnlock(post('not json'), env)).status, 400);
  assert.equal((await handleDebugUnlock(post({ pin: 'x'.repeat(2000) }), env)).status, 413);
});

test('rate limit trips after repeated attempts, per client IP', async () => {
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await handleDebugUnlock(post({ pin: 'nope' }), env)).status, 200);
  }
  const blocked = await handleDebugUnlock(post({ pin: '4821' }), env);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) >= 1);

  const otherIp = await handleDebugUnlock(post({ pin: '4821' }, { 'x-forwarded-for': '198.51.100.9' }), env);
  assert.deepEqual(await otherIp.json(), { ok: true });
});

test('responses are never cacheable and never echo the PIN', async () => {
  const response = await handleDebugUnlock(post({ pin: '4821' }), env);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(!(await response.text()).includes('4821'));
});
