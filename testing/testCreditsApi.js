// AppBlips AI Credits (electron/server/creditsApi.js and chatProxy.js integration).
// Run: node testing/testCreditsApi.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  handleCreditsApi,
  handleCreditsChat,
  calculateCreditsFromUsage,
  createCreditToken,
  verifyCreditToken,
  CREDIT_PACKS,
  FREE_TRIAL_PACK,
  TRIAL_BENEFIT_ID,
} from '../electron/server/creditsApi.js';

const ORIGIN = 'http://localhost:5175';

const memoryTokens = (id = '', key = '') => {
  let state = { id, key };
  return {
    describe: () => ({ id: state.id, hasKey: Boolean(state.key) }),
    keyFor: (wanted) => (wanted && wanted === state.id ? state.key : ''),
    save: async (nextId, nextKey) => { state = { id: nextId, key: nextKey }; },
    clear: async () => { state = { id: '', key: '' }; },
  };
};

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

const req = (path, { method = 'GET', body, origin = ORIGIN } = {}) => new Request(`${ORIGIN}${path}`, {
  method,
  headers: {
    ...(body ? { 'content-type': 'application/json' } : {}),
    ...(origin ? { origin } : {}),
  },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

test('createCreditToken and verifyCreditToken sign and validate customer sessions', async () => {
  const token = await createCreditToken('polar_secret', 'cust_123', 'Builder@Example.com');
  assert.ok(token.startsWith('ab_cred_'));
  const verified = await verifyCreditToken('polar_secret', token);
  assert.equal(verified.customerId, 'cust_123');
  assert.equal(verified.email, 'builder@example.com');
  assert.equal(await verifyCreditToken('wrong_secret', token), null);
  assert.equal(await verifyCreditToken('polar_secret', `${token}tampered`), null);
});

test('calculateCreditsFromUsage scales token usage with a minimum of 1 credit', () => {
  assert.equal(calculateCreditsFromUsage(null), 1);
  assert.equal(calculateCreditsFromUsage({ prompt_tokens: 500, completion_tokens: 200 }), 1);
  assert.equal(calculateCreditsFromUsage({ prompt_tokens: 4000, completion_tokens: 2000 }), 3);
});

test('connect, status, chat deduction, and sign-out work end to end against Polar and DeepSeek', async () => {
  const tokens = memoryTokens();
  const env = { POLAR_TOKEN: 'polar_test_token', DEEPSEEK_API_KEY: 'ds_test_key' };
  const ingestedEvents = [];
  let usedSoFar = 150;

  const mockFetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/v1/benefit-grants')) {
      return jsonResponse({
        items: [
          {
            id: 'grant_1',
            customer_id: 'cust_abc',
            benefit_id: CREDIT_PACKS[0].benefitId,
            is_revoked: false,
            properties: { units: 1000 },
            customer: { id: 'cust_abc', email: 'alice@example.com' },
          },
        ],
      });
    }
    if (u.includes('/v1/meters/') && u.includes('/quantities')) {
      return jsonResponse({ total: usedSoFar });
    }
    if (u.includes('/v1/events/ingest')) {
      const payload = JSON.parse(init.body);
      ingestedEvents.push(...payload.events);
      usedSoFar += payload.events[0].metadata.credits;
      return jsonResponse({ inserted: 1 });
    }
    if (u.includes('api.deepseek.com/chat/completions')) {
      return jsonResponse({
        choices: [{ message: { role: 'assistant', content: ' OK' } }],
        usage: { prompt_tokens: 2000, completion_tokens: 1000 },
      });
    }
    return assert.fail(`Unexpected fetch URL: ${u}`);
  };

  // 1. Connect by checkout email
  const connectRes = await handleCreditsApi(
    req('/api/credits/connect', { method: 'POST', body: { email: 'Alice@Example.com' } }),
    env,
    tokens,
    { fetch: mockFetch },
  );
  assert.equal(connectRes.status, 200);
  const connected = await connectRes.json();
  assert.equal(connected.signedIn, true);
  assert.equal(connected.email, 'alice@example.com');
  assert.equal(connected.totalGranted, 1000);
  assert.equal(connected.totalUsed, 150);
  assert.equal(connected.remaining, 850);
  assert.equal(tokens.describe().hasKey, true);

  // 2. Chat completion uses DeepSeek and deducts credits in Polar
  const chatRes = await handleCreditsChat(
    { messages: [{ role: 'user', content: 'Build an app' }], stream: false },
    env,
    tokens,
    { fetch: mockFetch },
  );
  assert.equal(chatRes.status, 200);
  assert.equal(ingestedEvents.length, 1);
  assert.equal(ingestedEvents[0].name, 'ai_usage');
  assert.equal(ingestedEvents[0].customer_id, 'cust_abc');
  assert.equal(ingestedEvents[0].metadata.credits, 2);

  // 3. Status reflects the deducted credits
  const statusRes = await handleCreditsApi(req('/api/credits'), env, tokens, { fetch: mockFetch });
  const statusBody = await statusRes.json();
  assert.equal(statusBody.remaining, 848);

  // 4. Exhausted balance returns 429
  usedSoFar = 1000;
  const exhaustedRes = await handleCreditsChat(
    { messages: [{ role: 'user', content: 'More' }], stream: false },
    env,
    tokens,
    { fetch: mockFetch },
  );
  assert.equal(exhaustedRes.status, 429);
  const exhaustedBody = await exhaustedRes.json();
  assert.match(exhaustedBody.error, /0 AppBlips AI Credits remaining/);

  // 5. Sign out clears the token
  const outRes = await handleCreditsApi(req('/api/credits', { method: 'DELETE' }), env, tokens, { fetch: mockFetch });
  assert.equal((await outRes.json()).signedIn, false);
  assert.equal(tokens.describe().hasKey, false);
});

test('foreign origins cannot access /api/credits', async () => {
  const tokens = memoryTokens('alice@example.com', 'secret');
  for (const origin of ['https://evil.example', 'null']) {
    const res = await handleCreditsApi(req('/api/credits', { origin }), {}, tokens);
    assert.equal(res.status, 403);
  }
});

test('3-day free trial grants 100 credits while active and expires after 3 days', async () => {
  const tokens = memoryTokens();
  const env = { POLAR_TOKEN: 'polar_test_token', DEEPSEEK_API_KEY: 'ds_test_key' };
  let grantCreatedAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(); // 1 day ago (active)

  const mockFetch = async (url) => {
    const u = String(url);
    if (u.includes('/v1/benefit-grants')) {
      return jsonResponse({
        items: [
          {
            id: 'grant_trial_1',
            customer_id: 'cust_trial',
            benefit_id: TRIAL_BENEFIT_ID,
            created_at: grantCreatedAt,
            is_revoked: false,
            properties: { units: FREE_TRIAL_PACK.credits },
            customer: { id: 'cust_trial', email: 'trial@example.com' },
          },
        ],
      });
    }
    if (u.includes('/v1/meters/') && u.includes('/quantities')) {
      return jsonResponse({ total: 10 });
    }
    return assert.fail(`Unexpected fetch URL: ${u}`);
  };

  // Active trial (1 day old): 100 granted, 10 used -> 90 remaining
  const activeRes = await handleCreditsApi(
    req('/api/credits/connect', { method: 'POST', body: { email: 'trial@example.com' } }),
    env,
    tokens,
    { fetch: mockFetch },
  );
  assert.equal(activeRes.status, 200);
  const activeBody = await activeRes.json();
  assert.equal(activeBody.trialActive, true);
  assert.equal(activeBody.trialExpired, false);
  assert.equal(activeBody.totalGranted, 100);
  assert.equal(activeBody.remaining, 90);

  // Duplicate trial checkout for the same email is blocked
  const dupCheckout = await handleCreditsApi(
    req('/api/credits/checkout', { method: 'POST', body: { packId: 'trial', email: 'trial@example.com' } }),
    env,
    tokens,
    { fetch: mockFetch },
  );
  assert.equal(dupCheckout.status, 400);

  // Expired trial (4 days old): 0 granted, 0 remaining, chat returns 429 mentioning expired trial
  grantCreatedAt = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
  const expiredStatus = await handleCreditsApi(req('/api/credits'), env, tokens, { fetch: mockFetch });
  const expiredBody = await expiredStatus.json();
  assert.equal(expiredBody.trialActive, false);
  assert.equal(expiredBody.trialExpired, true);
  assert.equal(expiredBody.totalGranted, 0);
  assert.equal(expiredBody.remaining, 0);

  const expiredChat = await handleCreditsChat(
    { messages: [{ role: 'user', content: 'Hi' }], stream: false },
    env,
    tokens,
    { fetch: mockFetch },
  );
  assert.equal(expiredChat.status, 429);
  const expiredChatBody = await expiredChat.json();
  assert.match(expiredChatBody.error, /3-day free trial has expired/);
});
