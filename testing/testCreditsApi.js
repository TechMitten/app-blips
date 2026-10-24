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

// Polar's emailed sign-in code (customer-portal sessions). `sent` collects
// each code request; the only valid code is GOOD42.
const polarSignIn = (customer, sent = []) => (u, init = {}) => {
  if (u.includes('/v1/products/')) return jsonResponse({ organization_id: 'org_1' });
  if (u.endsWith('/customer-portal/customer-session/request')) {
    sent.push(JSON.parse(init.body));
    return new Response(null, { status: 202 });
  }
  if (u.endsWith('/customer-portal/customer-session/authenticate')) {
    return JSON.parse(init.body).code === 'GOOD42'
      ? jsonResponse({ token: 'polar_cst_test' })
      : jsonResponse({ detail: 'This customer session code is invalid or has expired.' }, 401);
  }
  if (u.endsWith('/customer-portal/customer-session/user')) {
    assert.equal(init.headers.Authorization, 'Bearer polar_cst_test');
    return jsonResponse({ type: 'customer', customer_id: customer.id, email: customer.email });
  }
  return null;
};

const connectWithCode = async (email, env, tokens, mockFetch) => {
  const sendRes = await handleCreditsApi(req('/api/credits/connect', { method: 'POST', body: { email } }), env, tokens, { fetch: mockFetch });
  assert.equal(sendRes.status, 200);
  assert.equal((await sendRes.json()).codeSent, true);
  assert.equal(tokens.describe().hasKey, false, 'an email alone must not connect');
  return handleCreditsApi(req('/api/credits/verify', { method: 'POST', body: { email, code: ' good42 ' } }), env, tokens, { fetch: mockFetch });
};

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
  const codeRequests = [];
  const signIn = polarSignIn({ id: 'cust_abc', email: 'alice@example.com' }, codeRequests);

  const mockFetch = async (url, init = {}) => {
    const u = String(url);
    const signInRes = signIn(u, init);
    if (signInRes) return signInRes;
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

  // 1. Connect: checkout email, then the code Polar emailed to it
  const wrongRes = await handleCreditsApi(
    req('/api/credits/verify', { method: 'POST', body: { email: 'alice@example.com', code: 'NOPE00' } }),
    env,
    tokens,
    { fetch: mockFetch },
  );
  assert.equal(wrongRes.status, 401);
  assert.equal((await wrongRes.json()).invalidCode, true);
  assert.equal(tokens.describe().hasKey, false);

  const connectRes = await connectWithCode('Alice@Example.com', env, tokens, mockFetch);
  assert.equal(connectRes.status, 200);
  assert.deepEqual(codeRequests, [{ email: 'alice@example.com', organization_id: 'org_1', customer_id: 'cust_abc' }]);
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

  const signIn = polarSignIn({ id: 'cust_trial', email: 'trial@example.com' });
  const mockFetch = async (url, init) => {
    const u = String(url);
    const signInRes = signIn(u, init);
    if (signInRes) return signInRes;
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
  const activeRes = await connectWithCode('trial@example.com', env, tokens, mockFetch);
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

test('connecting through the AppBlips credits server needs the emailed code', async () => {
  const tokens = memoryTokens();
  const calls = [];
  const mockFetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, body: init.body ? JSON.parse(init.body) : null });
    if (u === 'https://appblips.com/api/credits/connect') return jsonResponse({ ok: true, codeSent: true, email: 'bob@example.com' });
    if (u === 'https://appblips.com/api/credits/verify') {
      return JSON.parse(init.body).code === 'GOOD42'
        ? jsonResponse({ ok: true, token: 'ab_cred_relay', email: 'bob@example.com', remaining: 500, totalGranted: 1000, totalUsed: 500 })
        : jsonResponse({ ok: false, error: 'bad code' }, 401);
    }
    return assert.fail(`Unexpected fetch URL: ${u}`);
  };

  const sendRes = await handleCreditsApi(req('/api/credits/connect', { method: 'POST', body: { email: 'bob@example.com' } }), {}, tokens, { fetch: mockFetch });
  assert.deepEqual(await sendRes.json(), { codeSent: true, email: 'bob@example.com' });
  assert.equal(tokens.describe().hasKey, false);

  const wrongRes = await handleCreditsApi(req('/api/credits/verify', { method: 'POST', body: { email: 'bob@example.com', code: 'bad' } }), {}, tokens, { fetch: mockFetch });
  assert.equal(wrongRes.status, 401);
  assert.equal(tokens.describe().hasKey, false);

  const okRes = await handleCreditsApi(req('/api/credits/verify', { method: 'POST', body: { email: 'bob@example.com', code: 'good-42' } }), {}, tokens, { fetch: mockFetch });
  assert.equal(okRes.status, 200);
  assert.equal((await okRes.json()).remaining, 500);
  assert.equal(tokens.keyFor('bob@example.com'), 'ab_cred_relay');
  assert.equal(calls.at(-1).body.code, 'GOOD42', 'the code is sent cleaned up');
});

test('a credits server without sign-in codes still connects (until it is updated)', async () => {
  const tokens = memoryTokens();
  const mockFetch = async () => jsonResponse({ ok: true, token: 'ab_cred_legacy', email: 'carol@example.com', remaining: 10 });
  const res = await handleCreditsApi(req('/api/credits/connect', { method: 'POST', body: { email: 'carol@example.com' } }), {}, tokens, { fetch: mockFetch });
  const body = await res.json();
  assert.equal(body.signedIn, true);
  assert.equal(tokens.keyFor('carol@example.com'), 'ab_cred_legacy');
});
