import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkAllowance, limitMessage, BUILD_OVERDRAFT_TOKENS, PLANS } from '../functions/_lib/plans.js';
import { verifyStripeSignature, handleStripeWebhook, handleBillingStatus } from '../functions/_lib/billing.js';
import { handleChatProxy } from '../functions/_lib/chatProxy.js';
import { wrapWithTokenTracking } from '../functions/_lib/trackTokens.js';
import { usageDocPath } from '../functions/_lib/usageTracking.js';
import { installFirebaseFake, firebaseEnv, signIdToken } from './firebaseFake.js';

const NOW = Date.UTC(2026, 9, 3, 18, 0, 0);
const FREE = PLANS.free;

const env = {
  OPENAI_BASE_URL: 'https://llm.example/v1',
  OPENAI_API_KEY: 'test-key',
  OPENAI_LLM_MODEL: 'build-model',
  OPENAI_LLM_VISION_MODEL: 'vision-model',
  OPENAI_LLM_ASK_MODEL: 'ask-model',
  APPBLIPS_CHAT_RATE_LIMIT_MAX: '1000',
  ...firebaseEnv(),
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_test',
};

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

// --- plans.js ---------------------------------------------------------------

test('free is held to its daily cap, with the overdraft only for a build already running', () => {
  const atCap = { plan: 'free', today_tokens: FREE.dailyTokens, period_tokens: FREE.dailyTokens };
  const blocked = checkAllowance(atCap, { now: NOW });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.scope, 'day');
  assert.equal(blocked.resetsAt.toISOString(), '2026-10-04T00:00:00.000Z');
  assert.equal(checkAllowance(atCap, { continuing: true, now: NOW }).allowed, true);
  const pastOverdraft = { ...atCap, today_tokens: FREE.dailyTokens + BUILD_OVERDRAFT_TOKENS };
  assert.equal(checkAllowance(pastOverdraft, { continuing: true, now: NOW }).allowed, false);
});

test('free monthly ceiling resets on the 1st; paid plans reset at the period end', () => {
  const free = checkAllowance({ plan: 'free', today_tokens: 0, period_tokens: FREE.periodTokens }, { now: NOW });
  assert.equal(free.scope, 'period');
  assert.equal(free.resetsAt.toISOString(), '2026-11-01T00:00:00.000Z');

  const end = '2026-10-20T12:00:00.000Z';
  const plus = checkAllowance({ plan: 'plus', today_tokens: 30_000_000, period_tokens: PLANS.plus.periodTokens, period_end: end }, { now: NOW });
  assert.equal(plus.scope, 'period');
  assert.equal(plus.resetsAt.toISOString(), end);
  // Paid plans have no daily cap.
  assert.equal(checkAllowance({ plan: 'plus', today_tokens: 30_000_000, period_tokens: 30_000_000 }, { now: NOW }).allowed, true);
  // An unknown plan is treated as free.
  assert.equal(checkAllowance({ plan: 'gold', today_tokens: FREE.dailyTokens, period_tokens: 0 }, { now: NOW }).allowed, false);
});

test('limit messages say when it resets and what to upgrade to', () => {
  const check = checkAllowance({ plan: 'free', today_tokens: FREE.dailyTokens, period_tokens: 0 }, { now: NOW });
  assert.equal(limitMessage('free', check, NOW), "You've used today's Free allowance. It resets in 6h. Upgrade to Plus for more.");
  const pro = { allowed: false, scope: 'period', resetsAt: new Date(NOW + 3 * 86400000) };
  assert.equal(limitMessage('pro', pro, NOW), "You've used this billing period's Pro allowance. It resets in 3 days.");
});

// --- webhook signature ------------------------------------------------------

const sign = async (payload, secret, timestamp) => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

test('Stripe signatures are checked, including timestamp replay', async () => {
  const payload = '{"id":"evt_1"}';
  const t = Math.floor(NOW / 1000);
  const good = await sign(payload, 'whsec_test', t);
  assert.equal(await verifyStripeSignature(payload, `t=${t},v1=${good}`, 'whsec_test', NOW), true);
  assert.equal(await verifyStripeSignature(payload, `t=${t},v1=deadbeef,v1=${good}`, 'whsec_test', NOW), true);
  assert.equal(await verifyStripeSignature(payload, `t=${t},v1=${good}`, 'whsec_other', NOW), false);
  assert.equal(await verifyStripeSignature(`${payload} `, `t=${t},v1=${good}`, 'whsec_test', NOW), false);
  assert.equal(await verifyStripeSignature(payload, `t=${t},v1=${good}`, 'whsec_test', NOW + 10 * 60 * 1000), false);
  assert.equal(await verifyStripeSignature(payload, null, 'whsec_test', NOW), false);
});

// --- chatProxy plan enforcement ----------------------------------------------

const sse = 'data: {"choices":[{"delta":{"content":"Done"}}]}\n\ndata: [DONE]\n\n';

// Seeds Firestore for user-1 from a billing_status-shaped row, and fakes the
// LLM. `promptsLeft` sets how many of the Free daily prompts remain;
// `upstreamStatus` lets a test make the provider fail and `upstreamBody`
// replaces the stream. Returns what was seen plus `usage()`, today's usage doc.
const mockServices = (t, billingRow, { promptsLeft, upstreamStatus = 200, upstreamBody = sse } = {}) => {
  const seen = { upstream: null, upstreamCalls: 0 };
  t.after(settleWrites);
  const { firestore, calls } = installFirebaseFake(t, {
    fallback: async (href, options = {}) => {
      if (href !== 'https://llm.example/v1/chat/completions') throw new Error(`unexpected fetch ${href}`);
      seen.upstream = JSON.parse(options.body);
      seen.upstreamCalls += 1;
      if (upstreamStatus !== 200) return Response.json({ error: { message: 'boom' } }, { status: upstreamStatus });
      return new Response(upstreamBody, { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  if (billingRow.plan !== 'free') {
    firestore.set('subscriptions/user-1', {
      user_id: 'user-1', plan: billingRow.plan, status: billingRow.status,
      current_period_start: `${daysAgo(10)}T00:00:00.000Z`, current_period_end: `${daysAgo(-20)}T00:00:00.000Z`,
    });
  }
  const todayTokens = Number(billingRow.today_tokens) || 0;
  const prompts = promptsLeft === undefined ? Number(billingRow.today_prompts) || 0 : PLANS.free.dailyPrompts - promptsLeft;
  firestore.set(usageDocPath('user-1', today()), {
    user_id: 'user-1', date: today(), builder_tokens: todayTokens, builder_prompts: prompts, builder_requests: 0,
  });
  const earlier = (Number(billingRow.period_tokens) || 0) - todayTokens;
  if (earlier > 0) {
    firestore.set(usageDocPath('user-1', daysAgo(1)), { user_id: 'user-1', date: daysAgo(1), builder_tokens: earlier });
  }
  Object.defineProperty(seen, 'statusCalls', {
    get: () => calls.filter((call) => call.method === 'GET' && /documents\/subscriptions\/user-1$/.test(call.url)).length,
  });
  seen.usage = () => firestore.getData(usageDocPath('user-1', today()));
  return seen;
};

// Background usage writes (waitUntil) are collected so tests can wait for
// them -- and so none outlive the test's fetch mock and reach the network.
const pendingWrites = [];
const waitUntil = (promise) => pendingWrites.push(promise);
const settleWrites = async () => {
  await new Promise((resolve) => setTimeout(resolve, 10));
  while (pendingWrites.length) await Promise.all(pendingWrites.splice(0));
};

const chat = async (payload, settings = {}) => handleChatProxy(new Request('https://app.example/api/chat', {
  method: 'POST',
  headers: { authorization: `Bearer ${await signIdToken('user-1', { claims: { email: 'a@example.com' } })}` },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'Build a todo app' }], stream: true, ...payload }),
}), { ...env, ...settings }, waitUntil);

const imageMessage = { role: 'user', content: [{ type: 'text', text: 'Like this' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] };

test('a free user over the daily cap is refused before the LLM is called', async (t) => {
  const seen = mockServices(t, { plan: 'free', status: 'none', today_tokens: FREE.dailyTokens, period_tokens: FREE.dailyTokens });
  const response = await chat({});
  assert.equal(response.status, 402);
  const body = await response.json();
  assert.equal(body.code, 'limit_reached');
  assert.equal(body.scope, 'day');
  assert.equal(seen.upstream, null);
});

test('a build already running may finish past the cap', async (t) => {
  const seen = mockServices(t, { plan: 'free', status: 'none', today_tokens: FREE.dailyTokens, period_tokens: FREE.dailyTokens });
  const response = await chat({ continuing: true });
  assert.equal(response.status, 200);
  await response.text();
  assert.equal(seen.upstream.model, 'build-model');
});

test('free users cannot send images; paid users get the vision model', async (t) => {
  let seen = mockServices(t, { plan: 'free', status: 'none', today_tokens: 0, period_tokens: 0 });
  let response = await chat({ messages: [imageMessage] });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'upgrade_required');
  assert.equal(seen.upstream, null);

  await settleWrites();
  t.mock.restoreAll();
  seen = mockServices(t, { plan: 'plus', status: 'active', today_tokens: 0, period_tokens: 0 });
  response = await chat({ messages: [imageMessage] });
  assert.equal(response.status, 200);
  await response.text();
  assert.equal(seen.upstream.model, 'vision-model');
});

test('Ask mode uses the chat model only on paid plans', async (t) => {
  let seen = mockServices(t, { plan: 'free', status: 'none', today_tokens: 0, period_tokens: 0 });
  await (await chat({ ask: true })).text();
  assert.equal(seen.upstream.model, 'build-model');

  await settleWrites();
  t.mock.restoreAll();
  seen = mockServices(t, { plan: 'pro', status: 'active', today_tokens: 0, period_tokens: 0 });
  await (await chat({ ask: true })).text();
  assert.equal(seen.upstream.model, 'ask-model');
});

test('billing is skipped without a Stripe key and for the user\'s own provider key', async (t) => {
  const seen = mockServices(t, { plan: 'free', status: 'none', today_tokens: FREE.dailyTokens * 10, period_tokens: 0 });
  let response = await chat({}, { STRIPE_SECRET_KEY: '' });
  assert.equal(response.status, 200);
  await response.text();
  assert.equal(seen.statusCalls, 0);

  await settleWrites();
  t.mock.restoreAll();
  let upstreamUrl = null;
  const { calls } = installFirebaseFake(t, {
    fallback: async (href) => {
      upstreamUrl = href;
      return new Response(sse, { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  response = await chat({ user_provider: { id: 'openrouter', apiKey: 'sk-or-user', model: 'their/model' } });
  assert.equal(response.status, 200);
  await response.text();
  assert.equal(upstreamUrl, 'https://openrouter.ai/api/v1/chat/completions');
  assert.ok(!calls.some((call) => call.url.includes('/subscriptions/')), 'billing must not be read for the user\'s own key');
});

// --- usage refund on provider errors ----------------------------------------

test('a response the provider ended with an error is not charged to the allowance', async (t) => {
  const { firestore } = installFirebaseFake(t);
  const pending = [];
  const stream = (body) => new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  const failed = stream('data: {"choices":[{"delta":{"content":"<html>"},"finish_reason":"error"}],"error":{"message":"boom"},"usage":{"total_tokens":5000}}\n\ndata: [DONE]\n\n');
  await (await wrapWithTokenTracking(env, failed, { stream: true }, { uid: 'user-1', kind: 'builder' }, (p) => pending.push(p))).text();
  await Promise.all(pending);
  assert.equal(firestore.getData(usageDocPath('user-1', today())).builder_tokens, 0);
  const ok = stream('data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}],"usage":{"total_tokens":700}}\n\ndata: [DONE]\n\n');
  await (await wrapWithTokenTracking(env, ok, { stream: true }, { uid: 'user-1', kind: 'builder' }, (p) => pending.push(p))).text();
  await Promise.all(pending);
  const usage = firestore.getData(usageDocPath('user-1', today()));
  assert.equal(usage.builder_tokens, 700);
  assert.equal(usage.builder_requests, 2);
});

// --- webhook -> subscriptions ------------------------------------------------

const stripeSubscription = (fields = {}) => ({
  id: 'sub_1', status: 'active', customer: 'cus_1', cancel_at_period_end: false,
  metadata: { user_id: 'user-1' },
  items: { data: [{ price: { lookup_key: 'appblips_pro_monthly' }, current_period_start: 1790000000, current_period_end: 1792592000 }] },
  ...fields,
});

const webhook = async (type, object) => {
  const payload = JSON.stringify({ type, data: { object } });
  const timestamp = Math.floor(Date.now() / 1000);
  return handleStripeWebhook(new Request('https://app.example/api/billing/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': `t=${timestamp},v1=${await sign(payload, 'whsec_test', timestamp)}` },
    body: payload,
  }), env);
};

test('a subscription event re-reads Stripe and stores the plan by lookup key', async (t) => {
  let live = stripeSubscription();
  const { firestore } = installFirebaseFake(t, {
    fallback: async (href, options = {}) => {
      if (href === `https://api.stripe.com/v1/subscriptions/${live.id}`) {
        assert.equal(options.headers.Authorization, 'Bearer sk_test_x');
        return Response.json(live);
      }
      throw new Error(`unexpected fetch ${href}`);
    },
  });
  const response = await webhook('customer.subscription.updated', { id: 'sub_1', status: 'incomplete' });
  assert.equal(response.status, 200);
  const stored = firestore.getData('subscriptions/user-1');
  assert.equal(stored.plan, 'pro');
  assert.equal(stored.status, 'active');
  assert.equal(stored.stripe_customer_id, 'cus_1');
  assert.equal(stored.current_period_start, new Date(1790000000 * 1000).toISOString());

  // A late event for an old, cancelled subscription can't replace the live one.
  live = stripeSubscription({ id: 'sub_old', status: 'canceled', customer: null });
  await webhook('customer.subscription.deleted', { id: 'sub_old' });
  assert.equal(firestore.getData('subscriptions/user-1').stripe_subscription_id, 'sub_1');
  assert.equal(firestore.getData('subscriptions/user-1').status, 'active');

  // Its own cancellation does land, and keeps the customer id.
  live = stripeSubscription({ status: 'canceled', customer: null });
  await webhook('customer.subscription.deleted', { id: 'sub_1' });
  assert.equal(firestore.getData('subscriptions/user-1').status, 'canceled');
  assert.equal(firestore.getData('subscriptions/user-1').stripe_customer_id, 'cus_1');

  const payload = JSON.stringify({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1' } } });
  const forged = await handleStripeWebhook(new Request('https://app.example/api/billing/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': `t=${Math.floor(Date.now() / 1000)},v1=00` },
    body: payload,
  }), env);
  assert.equal(forged.status, 400);
});

test('a subscription without metadata is matched to its user by Stripe customer', async (t) => {
  const { firestore } = installFirebaseFake(t, {
    fallback: async () => Response.json(stripeSubscription({ metadata: {}, status: 'past_due' })),
  });
  firestore.set('subscriptions/user-7', { user_id: 'user-7', plan: 'plus', status: 'active', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1' });
  assert.equal((await webhook('customer.subscription.updated', { id: 'sub_1' })).status, 200);
  assert.equal(firestore.getData('subscriptions/user-7').status, 'past_due');
});

test('status reports billing off when there is no Stripe key', async () => {
  const response = await handleBillingStatus(new Request('https://app.example/api/billing/status'), { ...env, STRIPE_SECRET_KEY: '' });
  assert.deepEqual(await response.json(), { enabled: false });
});

test('APPBLIPS_BILLING_TESTERS limits billing to the listed accounts', async (t) => {
  // user-1 (a@example.com, see chat) is not on the list: no limits.
  let seen = mockServices(t, { plan: 'free', status: 'none', today_tokens: FREE.dailyTokens * 10, period_tokens: 0 });
  let response = await chat({}, { APPBLIPS_BILLING_TESTERS: 'someone@else.com' });
  assert.equal(response.status, 200);
  await response.text();
  assert.equal(seen.statusCalls, 0);

  // Listed by email (any case): the plan applies.
  await settleWrites();
  t.mock.restoreAll();
  seen = mockServices(t, { plan: 'free', status: 'none', today_tokens: FREE.dailyTokens * 10, period_tokens: 0 });
  response = await chat({}, { APPBLIPS_BILLING_TESTERS: 'someone@else.com, A@Example.com' });
  assert.equal(response.status, 402);
  assert.equal(seen.statusCalls, 1);

  // Off the list, the status endpoint reports billing off.
  await settleWrites();
  t.mock.restoreAll();
  mockServices(t, { plan: 'free', status: 'none', today_tokens: 0, period_tokens: 0 });
  response = await handleBillingStatus(new Request('https://app.example/api/billing/status', { headers: { authorization: `Bearer ${await signIdToken('user-1')}` } }), { ...env, APPBLIPS_BILLING_TESTERS: 'user-2' });
  assert.deepEqual(await response.json(), { enabled: false });
});

// --- Free daily prompt limit --------------------------------------------------

const withSecret = { APPBLIPS_SESSION_SECRET: 'test-secret' };
const freeRow = { plan: 'free', status: 'none', today_tokens: 0, period_tokens: 0, today_prompts: 0 };

test('a Free prompt is claimed once and its follow-ups ride on the signed pass', async (t) => {
  const seen = mockServices(t, freeRow);
  let response = await chat({}, withSecret);
  assert.equal(response.status, 200);
  await response.text();
  const pass = response.headers.get('x-appblips-prompt-pass');
  assert.ok(pass, 'first request returns a pass');
  assert.equal(seen.usage().builder_prompts, 1);

  response = await chat({ continuing: true, prompt_pass: pass }, withSecret);
  assert.equal(response.status, 200);
  await response.text();
  assert.equal(seen.usage().builder_prompts, 1, 'a follow-up with a valid pass is not a new prompt');
  assert.ok(response.headers.get('x-appblips-prompt-pass'), 'the pass is renewed');

  // Marking a request as a follow-up without a valid pass doesn't dodge the count.
  await (await chat({ continuing: true }, withSecret)).text();
  await (await chat({ continuing: true, prompt_pass: `${pass}x` }, withSecret)).text();
  assert.equal(seen.usage().builder_prompts, 3);
});

test('a pass is bound to its user and expires', async () => {
  const { signPromptPass, verifyPromptPass } = await import('../functions/_lib/promptPass.js');
  const env2 = { APPBLIPS_SESSION_SECRET: 's' };
  const pass = await signPromptPass('user-1', env2, NOW);
  assert.equal(await verifyPromptPass(pass, 'user-1', env2, NOW), true);
  assert.equal(await verifyPromptPass(pass, 'user-2', env2, NOW), false);
  assert.equal(await verifyPromptPass(pass, 'user-1', env2, NOW + 31 * 60 * 1000), false);
  assert.equal(await verifyPromptPass(pass, 'user-1', { APPBLIPS_SESSION_SECRET: 'other' }, NOW), false);
});

test('the 6th Free prompt of the day is refused with an upgrade message', async (t) => {
  const seen = mockServices(t, freeRow, { promptsLeft: 0 });
  const response = await chat({}, withSecret);
  assert.equal(response.status, 402);
  const body = await response.json();
  assert.equal(body.code, 'limit_reached');
  assert.equal(body.scope, 'prompts');
  assert.match(body.error, /today's free prompts/);
  assert.equal(seen.upstream, null);
});

test('automatic repairs and provider failures do not cost a prompt', async (t) => {
  let seen = mockServices(t, freeRow);
  await (await chat({ auto_fix: true }, withSecret)).text();
  assert.equal(seen.usage().builder_prompts, 0);

  await settleWrites();
  t.mock.restoreAll();
  seen = mockServices(t, freeRow, { upstreamStatus: 500 });
  const response = await chat({}, withSecret);
  assert.equal(response.status, 500);
  await response.text();
  await settleWrites();
  assert.equal(seen.upstreamCalls, 1);
  assert.equal(seen.usage().builder_prompts, 0, 'the prompt was claimed, then handed back');
  assert.equal(response.headers.get('x-appblips-prompt-pass'), null);
});

test('paid plans have no prompt limit', async (t) => {
  const seen = mockServices(t, { ...freeRow, plan: 'plus', status: 'active', today_prompts: 500 });
  const response = await chat({}, withSecret);
  assert.equal(response.status, 200);
  await response.text();
  assert.equal(seen.usage().builder_prompts, 500);
});

// --- token reservations -------------------------------------------------------


test('requests sent at the same moment cannot all slip under the limit', async (t) => {
  const seen = mockServices(t, { ...freeRow, today_tokens: FREE.dailyTokens - 10_000, period_tokens: FREE.dailyTokens - 10_000 });
  const responses = await Promise.all(Array.from({ length: 10 }, () => chat({ auto_fix: true }, withSecret)));
  const statuses = responses.map((r) => r.status);
  await Promise.all(responses.map((r) => r.text()));
  assert.equal(statuses.filter((s) => s === 200).length, 1, `one request reserves, the rest are refused: ${statuses}`);
  assert.equal(seen.upstreamCalls, 1);
});

test('a reservation is settled to the reported usage', async (t) => {
  const usage = 'data: {"choices":[{"delta":{"content":"Done"},"finish_reason":"stop"}],"usage":{"total_tokens":1234}}\n\ndata: [DONE]\n\n';
  const seen = mockServices(t, freeRow, { upstreamBody: usage });
  await (await chat({}, withSecret)).text();
  await settleWrites();
  assert.equal(seen.usage().builder_tokens, 1234, 'the estimate held up front is replaced by the real count');
  assert.equal(seen.usage().builder_requests, 1);
});

test('a stream cut off before its usage arrives is charged an estimate, not nothing', async (t) => {
  // The provider sends some output and is still going when the client stops
  // reading, so its usage block never arrives.
  const encoder = new TextEncoder();
  const upstreamBody = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: {"choices":[{"delta":{"content":"${'x'.repeat(3000)}"}}]}\n\n`));
    },
  });
  const seen = mockServices(t, freeRow, { upstreamBody });
  const reader = (await chat({}, withSecret)).body.getReader();
  await reader.read();
  await reader.cancel();
  await settleWrites();
  const charged = seen.usage().builder_tokens;
  assert.ok(charged >= 1000, `charged ${charged}`);
  assert.ok(charged < 32768, 'less than the full reservation');
  assert.equal(seen.usage().builder_requests, 1);
});

test('a provider failure hands the reservation back', async (t) => {
  const seen = mockServices(t, freeRow, { upstreamStatus: 500 });
  await (await chat({}, withSecret)).text();
  await settleWrites();
  assert.equal(seen.usage().builder_tokens, 0);
});

test('the build overdraft needs a valid pass from the build', async (t) => {
  const atCap = { ...freeRow, plan: 'plus', status: 'active', today_tokens: 0, period_tokens: PLANS.plus.periodTokens };
  let seen = mockServices(t, atCap);
  // Claiming to be mid-build without a pass is refused like a new request.
  let response = await chat({ continuing: true }, withSecret);
  assert.equal(response.status, 402);
  response = await chat({ continuing: true, prompt_pass: 'forged.pass' }, withSecret);
  assert.equal(response.status, 402);
  assert.equal(seen.upstreamCalls, 0);

  // A build that started under the limit carries on into the overdraft.
  await settleWrites();
  t.mock.restoreAll();
  seen = mockServices(t, { ...atCap, period_tokens: PLANS.plus.periodTokens - 1 });
  response = await chat({}, withSecret);
  assert.equal(response.status, 200);
  await response.text();
  const pass = response.headers.get('x-appblips-prompt-pass');
  assert.ok(pass, 'paid plans get a pass too');
  await settleWrites();
  // The first request's reservation took the period past its allowance; only
  // the overdraft lets the build's next request through.
  response = await chat({ continuing: true, prompt_pass: pass }, withSecret);
  assert.equal(response.status, 200);
  await response.text();
  assert.equal(seen.upstreamCalls, 2);
});
