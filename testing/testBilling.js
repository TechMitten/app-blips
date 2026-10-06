import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkAllowance, limitMessage, BUILD_OVERDRAFT_TOKENS, PLANS, TRIAL, FREE_BUILDS } from '../functions/_lib/plans.js';
import { verifyStripeSignature, handleStripeWebhook, handleBillingStatus, handleBillingCheckout, handleBillingEndTrial } from '../functions/_lib/billing.js';
import { handleChatProxy } from '../functions/_lib/chatProxy.js';
import { wrapWithTokenTracking } from '../functions/_lib/trackTokens.js';
import { usageDocPath } from '../functions/_lib/usageTracking.js';
import { installFirebaseFake, firebaseEnv, signIdToken } from './firebaseFake.js';

const NOW = Date.UTC(2026, 9, 3, 18, 0, 0);

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

test('no plan allows nothing; the trial has its own smaller allowance', () => {
  const none = checkAllowance({ plan: 'none', period_tokens: 0 }, { now: NOW });
  assert.equal(none.allowed, false);
  assert.equal(none.scope, 'none');
  // A free prompt is held to the free cap (plus the overdraft for a follow-up).
  assert.equal(checkAllowance({ plan: 'none', period_tokens: 0 }, { freeBuild: true, now: NOW }).allowed, true);
  assert.equal(checkAllowance({ plan: 'none', period_tokens: FREE_BUILDS.periodTokens }, { freeBuild: true, now: NOW }).scope, 'none');
  assert.equal(checkAllowance({ plan: 'none', period_tokens: FREE_BUILDS.periodTokens }, { freeBuild: true, continuing: true, now: NOW }).allowed, true);
  // An unknown plan is treated as no plan.
  assert.equal(checkAllowance({ plan: 'gold', period_tokens: 0 }, { now: NOW }).allowed, false);

  const trialEnd = '2026-10-06T18:00:00.000Z';
  const trial = { plan: 'plus', trialing: true, trial_end: trialEnd, period_tokens: TRIAL.periodTokens };
  const blocked = checkAllowance(trial, { now: NOW });
  assert.equal(blocked.scope, 'trial');
  assert.equal(blocked.resetsAt.toISOString(), trialEnd);
  assert.equal(checkAllowance(trial, { continuing: true, now: NOW }).allowed, true);
  assert.equal(checkAllowance({ ...trial, period_tokens: TRIAL.periodTokens + BUILD_OVERDRAFT_TOKENS }, { continuing: true, now: NOW }).allowed, false);
  // The same usage is fine once Plus is paid for.
  assert.equal(checkAllowance({ ...trial, trialing: false }, { now: NOW }).allowed, true);
});

test('paid plans reset at the period end', () => {
  const end = '2026-10-20T12:00:00.000Z';
  const plus = checkAllowance({ plan: 'plus', period_tokens: PLANS.plus.periodTokens, period_end: end }, { now: NOW });
  assert.equal(plus.scope, 'period');
  assert.equal(plus.resetsAt.toISOString(), end);
  assert.equal(checkAllowance({ plan: 'plus', today_tokens: 30_000_000, period_tokens: 30_000_000 }, { now: NOW }).allowed, true);
});

test('limit messages say when it resets and what to do next', () => {
  assert.match(limitMessage('none', { scope: 'none' }, NOW), /^Start your free 7-day trial to build/);
  assert.equal(limitMessage('none', { scope: 'none' }, NOW, { trialEligible: false }), 'Subscribe to Plus or Pro to build.');
  assert.match(limitMessage('none', { scope: 'none' }, NOW, { freeBuildsUsed: true }), /^You've used your free prompts\. Start your free 7-day trial/);
  const trial = { allowed: false, scope: 'trial', resetsAt: new Date(NOW + 6 * 3600000) };
  assert.match(limitMessage('plus', trial, NOW), /Plus starts in 6h .* or start it now/);
  const plus = { allowed: false, scope: 'period', resetsAt: new Date(NOW + 3 * 86400000) };
  assert.equal(limitMessage('plus', plus, NOW), "You've used this billing period's Plus allowance. It resets in 3 days. Upgrade to Pro for 2x the usage.");
  assert.equal(limitMessage('pro', plus, NOW), "You've used this billing period's Pro allowance. It resets in 3 days.");
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

// Seeds Firestore for user-1 from a billing-status-shaped row, and fakes the
// LLM. `upstreamStatus` lets a test make the provider fail and `upstreamBody`
// replaces the stream. Returns what was seen plus `usage()`, today's usage doc.
const mockServices = (t, billingRow, { upstreamStatus = 200, upstreamBody = sse, freeBuildsUsed = 0 } = {}) => {
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
  if (billingRow.plan !== 'none') {
    firestore.set('subscriptions/user-1', {
      user_id: 'user-1', plan: billingRow.plan, status: billingRow.status,
      current_period_start: `${daysAgo(10)}T00:00:00.000Z`, current_period_end: `${daysAgo(-20)}T00:00:00.000Z`,
      ...(billingRow.status === 'trialing' ? { trial_end: `${daysAgo(-2)}T00:00:00.000Z`, trial_used: true } : {}),
    });
  }
  if (freeBuildsUsed) firestore.set('free_builds/user-1', { user_id: 'user-1', used: freeBuildsUsed });
  const todayTokens = Number(billingRow.today_tokens) || 0;
  firestore.set(usageDocPath('user-1', today()), {
    user_id: 'user-1', date: today(), builder_tokens: todayTokens, builder_requests: 0,
  });
  const earlier = (Number(billingRow.period_tokens) || 0) - todayTokens;
  if (earlier > 0) {
    firestore.set(usageDocPath('user-1', daysAgo(1)), { user_id: 'user-1', date: daysAgo(1), builder_tokens: earlier });
  }
  Object.defineProperty(seen, 'statusCalls', {
    get: () => calls.filter((call) => call.method === 'GET' && /documents\/subscriptions\/user-1$/.test(call.url)).length,
  });
  seen.usage = () => firestore.getData(usageDocPath('user-1', today()));
  seen.freeBuilds = () => firestore.getData('free_builds/user-1');
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

const noPlan = { plan: 'none', status: 'none', today_tokens: 0, period_tokens: 0 };
const plusRow = { plan: 'plus', status: 'active', today_tokens: 0, period_tokens: 0 };

test('an account with no plan gets its free prompts, Build or Ask, then nothing', async (t) => {
  const withSecret = { APPBLIPS_SESSION_SECRET: 'pass-secret' };
  const seen = mockServices(t, noPlan);
  // A repair outside a build never spends a free prompt.
  let response = await chat({ auto_fix: true }, withSecret);
  assert.equal(response.status, 402);
  await response.json();
  assert.equal(seen.freeBuilds(), null);

  response = await chat({}, withSecret);
  assert.equal(response.status, 200);
  await response.text();
  const pass = response.headers.get('x-appblips-prompt-pass');
  assert.ok(pass);
  await settleWrites();
  // The prompt's follow-ups don't use another.
  response = await chat({ continuing: true, prompt_pass: pass }, withSecret);
  assert.equal(response.status, 200);
  await response.text();
  await settleWrites();
  assert.equal(seen.freeBuilds().used, 1);

  for (const payload of [{ ask: true }, {}]) {
    response = await chat(payload, withSecret);
    assert.equal(response.status, 200);
    await response.text();
    await settleWrites();
  }
  assert.equal(seen.freeBuilds().used, FREE_BUILDS.prompts);
  assert.equal(seen.upstreamCalls, 4);

  for (const payload of [{}, { ask: true }]) {
    response = await chat(payload, withSecret);
    assert.equal(response.status, 402);
    const body = await response.json();
    assert.equal(body.code, 'subscription_required');
    assert.match(body.error, /^You've used your free prompts/);
  }
  assert.equal(seen.upstreamCalls, 4);
});

test('free prompts follow the person, not the account: a re-created account gets none', async (t) => {
  const withSecret = { APPBLIPS_SESSION_SECRET: 'pass-secret' };
  const seen = mockServices(t, noPlan);
  const chatAs = async (uid, claims) => handleChatProxy(new Request('https://app.example/api/chat', {
    method: 'POST',
    headers: { authorization: `Bearer ${await signIdToken(uid, { claims })}` },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Build a todo app' }], stream: true }),
  }), { ...env, ...withSecret }, waitUntil);
  const google = { email: 'Person@Example.com', firebase: { identities: { 'google.com': ['g-1'] } } };
  for (let i = 0; i < FREE_BUILDS.prompts; i += 1) {
    const response = await chatAs('user-1', google);
    assert.equal(response.status, 200);
    await response.text();
    await settleWrites();
  }
  // Deleted and signed in again: a new account id, the same Google account.
  let response = await chatAs('user-9', google);
  assert.equal(response.status, 402);
  assert.match((await response.json()).error, /^You've used your free prompts/);
  // Or a GitHub account with the same verified email.
  response = await chatAs('user-8', { email: 'person@example.com', firebase: { identities: { 'github.com': ['h-1'] } } });
  assert.equal(response.status, 402);
  await response.json();
  assert.equal(seen.upstreamCalls, FREE_BUILDS.prompts);
});

test('an account with no plan and no free prompts is refused everything, repairs included', async (t) => {
  const seen = mockServices(t, noPlan, { freeBuildsUsed: FREE_BUILDS.prompts });
  for (const payload of [{}, { ask: true }, { auto_fix: true }, { continuing: true }]) {
    const response = await chat(payload);
    assert.equal(response.status, 402);
    const body = await response.json();
    assert.equal(body.code, 'subscription_required');
    assert.match(body.error, /free 7-day trial/);
  }
  assert.equal(seen.upstream, null);
});

test('a trial is held to the trial allowance, and a build already running may finish', async (t) => {
  const atCap = { plan: 'plus', status: 'trialing', today_tokens: TRIAL.periodTokens, period_tokens: TRIAL.periodTokens };
  const seen = mockServices(t, atCap);
  const response = await chat({});
  assert.equal(response.status, 402);
  const body = await response.json();
  assert.equal(body.code, 'limit_reached');
  assert.equal(body.scope, 'trial');
  assert.equal(seen.upstream, null);

  await settleWrites();
  t.mock.restoreAll();
  const running = mockServices(t, atCap);
  const ok = await chat({ continuing: true });
  assert.equal(ok.status, 200);
  await ok.text();
  assert.equal(running.upstream.model, 'build-model');
});

test('trial and paid plans get images and the Ask model', async (t) => {
  let seen = mockServices(t, { ...plusRow, status: 'trialing' });
  let response = await chat({ messages: [imageMessage] });
  assert.equal(response.status, 200);
  await response.text();
  assert.equal(seen.upstream.model, 'vision-model');

  await settleWrites();
  t.mock.restoreAll();
  seen = mockServices(t, { ...plusRow, plan: 'pro' });
  await (await chat({ ask: true })).text();
  assert.equal(seen.upstream.model, 'ask-model');
});

test('billing is skipped without a Stripe key and for the user\'s own provider key', async (t) => {
  const seen = mockServices(t, noPlan);
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
      if (href.startsWith(`https://api.stripe.com/v1/subscriptions/${live.id}?`)) {
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

test('status reports the trial, its end and its allowance', async (t) => {
  mockServices(t, { ...plusRow, status: 'trialing', today_tokens: 1000, period_tokens: 1000 });
  const response = await handleBillingStatus(new Request('https://app.example/api/billing/status', { headers: { authorization: `Bearer ${await signIdToken('user-1')}` } }), env);
  const body = await response.json();
  assert.equal(body.plan, 'plus');
  assert.equal(body.trialing, true);
  assert.equal(body.trialEligible, false);
  assert.equal(body.trialEnd, `${daysAgo(-2)}T00:00:00.000Z`);
  assert.equal(body.limits.periodTokens, TRIAL.periodTokens);
  assert.equal(body.blocked, null);
});

test('APPBLIPS_BILLING_TESTERS limits billing to the listed accounts', async (t) => {
  // user-1 (a@example.com, see chat) is not on the list: no limits.
  let seen = mockServices(t, noPlan);
  let response = await chat({}, { APPBLIPS_BILLING_TESTERS: 'someone@else.com' });
  assert.equal(response.status, 200);
  await response.text();
  assert.equal(seen.statusCalls, 0);

  // Listed by email (any case): the plan applies.
  await settleWrites();
  t.mock.restoreAll();
  seen = mockServices(t, noPlan, { freeBuildsUsed: FREE_BUILDS.prompts });
  response = await chat({}, { APPBLIPS_BILLING_TESTERS: 'someone@else.com, A@Example.com' });
  assert.equal(response.status, 402);
  assert.equal(seen.statusCalls, 1);

  // Off the list, the status endpoint reports billing off.
  await settleWrites();
  t.mock.restoreAll();
  mockServices(t, noPlan);
  response = await handleBillingStatus(new Request('https://app.example/api/billing/status', { headers: { authorization: `Bearer ${await signIdToken('user-1')}` } }), { ...env, APPBLIPS_BILLING_TESTERS: 'user-2' });
  assert.deepEqual(await response.json(), { enabled: false });
});

// --- free trial: Checkout, repeat trials, ending early ------------------------

const authed = async (path, body) => new Request(`https://app.example${path}`, {
  method: 'POST',
  headers: { authorization: `Bearer ${await signIdToken('user-1', { claims: { email: 'a@example.com' } })}` },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

// Fakes Stripe for Checkout and returns the form fields each session was
// created with.
const mockCheckout = (t) => {
  const sessions = [];
  const { firestore } = installFirebaseFake(t, {
    fallback: async (href, options = {}) => {
      if (href.startsWith('https://api.stripe.com/v1/prices?')) return Response.json({ data: [{ id: 'price_x' }] });
      if (href === 'https://api.stripe.com/v1/checkout/sessions') {
        sessions.push(new URLSearchParams(options.body));
        return Response.json({ url: 'https://checkout.stripe.test/s' });
      }
      throw new Error(`unexpected fetch ${href}`);
    },
  });
  return { firestore, sessions };
};

test('Checkout offers the card-required trial on Plus, once per account', async (t) => {
  const { firestore, sessions } = mockCheckout(t);
  assert.equal((await handleBillingCheckout(await authed('/api/billing/checkout', { plan: 'plus', requestTrial: true }), env)).status, 200);
  assert.equal(sessions[0].get('subscription_data[trial_period_days]'), String(TRIAL.days));
  assert.equal(sessions[0].get('subscription_data[trial_settings][end_behavior][missing_payment_method]'), 'cancel');
  assert.equal(sessions[0].get('payment_method_collection'), 'always');
  assert.equal(sessions[0].get('payment_method_types[0]'), 'card');
  assert.match(sessions[0].get('custom_text[submit][message]'), /won't be charged today/);

  // Pro never has a trial.
  await handleBillingCheckout(await authed('/api/billing/checkout', { plan: 'pro', requestTrial: true }), env);
  assert.equal(sessions[1].get('subscription_data[trial_period_days]'), null);

  // An account that already had its trial pays from the start.
  firestore.set('subscriptions/user-1', { user_id: 'user-1', plan: 'plus', status: 'canceled', stripe_customer_id: 'cus_1', trial_used: true });
  await handleBillingCheckout(await authed('/api/billing/checkout', { plan: 'plus', requestTrial: true }), env);
  assert.equal(sessions[2].get('subscription_data[trial_period_days]'), null);
  assert.equal(sessions[2].get('customer'), 'cus_1');
});

const trialSubscription = (fields = {}) => stripeSubscription({
  status: 'trialing', trial_start: 1790000000, trial_end: 1790259200,
  default_payment_method: { id: 'pm_1', card: { fingerprint: 'fp_card' } },
  items: { data: [{ price: { lookup_key: 'appblips_plus_monthly' }, current_period_start: 1790000000, current_period_end: 1790259200 }] },
  ...fields,
});

// Fakes Stripe's subscription endpoints over `subs` (by id) and records
// every trial ended early and every subscription cancelled.
const mockStripeSubscriptions = (t, subs) => {
  const ended = [];
  const cancelled = [];
  const { firestore } = installFirebaseFake(t, {
    fallback: async (href, options = {}) => {
      const match = href.match(/^https:\/\/api\.stripe\.com\/v1\/subscriptions\/([^?]+)/);
      if (!match || !subs[match[1]]) throw new Error(`unexpected fetch ${href}`);
      if (options.method === 'POST') {
        assert.equal(new URLSearchParams(options.body).get('trial_end'), 'now');
        ended.push(match[1]);
        subs[match[1]] = { ...subs[match[1]], status: 'active' };
      }
      if (options.method === 'DELETE') {
        cancelled.push(match[1]);
        subs[match[1]] = { ...subs[match[1]], status: 'canceled' };
      }
      return Response.json(subs[match[1]]);
    },
  });
  return { firestore, ended, cancelled };
};

test('the webhook records the trial, and it survives later updates', async (t) => {
  const subs = { sub_1: trialSubscription() };
  const { firestore, ended } = mockStripeSubscriptions(t, subs);
  await webhook('customer.subscription.created', { id: 'sub_1' });
  let stored = firestore.getData('subscriptions/user-1');
  assert.equal(stored.status, 'trialing');
  assert.equal(stored.plan, 'plus');
  assert.equal(stored.trial_used, true);
  assert.equal(stored.trial_end, new Date(1790259200 * 1000).toISOString());
  assert.equal(firestore.getData('trial_cards/fp_card').subscription_id, 'sub_1');

  // Converting to paid, then cancelling, never forgets the trial.
  subs.sub_1 = { ...subs.sub_1, status: 'active' };
  await webhook('customer.subscription.updated', { id: 'sub_1' });
  subs.sub_1 = { ...subs.sub_1, status: 'canceled' };
  await webhook('customer.subscription.deleted', { id: 'sub_1' });
  stored = firestore.getData('subscriptions/user-1');
  assert.equal(stored.trial_used, true);
  assert.equal(stored.trial_subscription_id, 'sub_1');
  assert.equal(stored.trial_end, null);
  assert.deepEqual(ended, []);
});

// Checkout promised "You won't be charged today", so a repeat trial is
// cancelled uncharged (never ended into a charge) and the account is told why.
test('a second trial on the same card, or the same account, is cancelled uncharged', async (t) => {
  const subs = { sub_2: trialSubscription({ id: 'sub_2', metadata: { user_id: 'user-2' } }) };
  let { firestore, ended, cancelled } = mockStripeSubscriptions(t, subs);
  firestore.set('trial_cards/fp_card', { user_id: 'user-1', subscription_id: 'sub_1' });
  await webhook('customer.subscription.created', { id: 'sub_2' });
  assert.deepEqual(ended, []);
  assert.deepEqual(cancelled, ['sub_2']);
  let stored = firestore.getData('subscriptions/user-2');
  assert.equal(stored.plan, 'none');
  assert.equal(stored.status, 'canceled');
  assert.equal(stored.trial_used, true);
  assert.equal(stored.trial_refused_subscription_id, 'sub_2');
  assert.notEqual(stored.trial_subscription_id, 'sub_2');

  // Stripe's cancellation event keeps it refused, never the account's trial.
  await webhook('customer.subscription.deleted', { id: 'sub_2' });
  stored = firestore.getData('subscriptions/user-2');
  assert.equal(stored.trial_refused_subscription_id, 'sub_2');
  assert.equal(stored.trial_subscription_id, null);
  assert.deepEqual(cancelled, ['sub_2']);

  t.mock.restoreAll();
  const other = { sub_3: trialSubscription({ id: 'sub_3', default_payment_method: { id: 'pm_2', card: { fingerprint: 'fp_new' } } }) };
  ({ firestore, ended, cancelled } = mockStripeSubscriptions(t, other));
  firestore.set('subscriptions/user-1', { user_id: 'user-1', plan: 'none', status: 'canceled', trial_used: true, trial_subscription_id: 'sub_1' });
  await webhook('customer.subscription.created', { id: 'sub_3' });
  assert.deepEqual(ended, []);
  assert.deepEqual(cancelled, ['sub_3']);
  assert.equal(firestore.getData('subscriptions/user-1').trial_subscription_id, 'sub_1');
});

test('Start Plus now ends only the caller\'s own trial', async (t) => {
  const subs = { sub_1: trialSubscription() };
  const { firestore, ended } = mockStripeSubscriptions(t, subs);
  firestore.set('subscriptions/user-1', { user_id: 'user-1', plan: 'plus', status: 'active', stripe_subscription_id: 'sub_1' });
  let response = await handleBillingEndTrial(await authed('/api/billing/end-trial'), env);
  assert.equal(response.status, 400, 'nothing to end when not trialing');

  firestore.set('subscriptions/user-1', { user_id: 'user-1', plan: 'plus', status: 'trialing', stripe_subscription_id: 'sub_1' });
  response = await handleBillingEndTrial(await authed('/api/billing/end-trial'), env);
  assert.equal(response.status, 200);
  assert.deepEqual(ended, ['sub_1']);
  assert.equal(firestore.getData('subscriptions/user-1').status, 'active');
});

// --- token reservations -------------------------------------------------------

const withSecret = { APPBLIPS_SESSION_SECRET: 'test-secret' };

test('a pass is bound to its user and expires', async () => {
  const { signPromptPass, verifyPromptPass } = await import('../functions/_lib/promptPass.js');
  const env2 = { APPBLIPS_SESSION_SECRET: 's' };
  const pass = await signPromptPass('user-1', env2, NOW);
  assert.equal(await verifyPromptPass(pass, 'user-1', env2, NOW), true);
  assert.equal(await verifyPromptPass(pass, 'user-2', env2, NOW), false);
  assert.equal(await verifyPromptPass(pass, 'user-1', env2, NOW + 31 * 60 * 1000), false);
  assert.equal(await verifyPromptPass(pass, 'user-1', { APPBLIPS_SESSION_SECRET: 'other' }, NOW), false);
});

test('requests sent at the same moment cannot all slip under the limit', async (t) => {
  const nearCap = PLANS.plus.periodTokens - 10_000;
  const seen = mockServices(t, { ...plusRow, today_tokens: nearCap, period_tokens: nearCap });
  const responses = await Promise.all(Array.from({ length: 10 }, () => chat({ auto_fix: true }, withSecret)));
  const statuses = responses.map((r) => r.status);
  await Promise.all(responses.map((r) => r.text()));
  assert.equal(statuses.filter((s) => s === 200).length, 1, `one request reserves, the rest are refused: ${statuses}`);
  assert.equal(seen.upstreamCalls, 1);
});

test('a reservation is settled to the reported usage', async (t) => {
  const usage = 'data: {"choices":[{"delta":{"content":"Done"},"finish_reason":"stop"}],"usage":{"total_tokens":1234}}\n\ndata: [DONE]\n\n';
  const seen = mockServices(t, plusRow, { upstreamBody: usage });
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
  const seen = mockServices(t, plusRow, { upstreamBody });
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
  const seen = mockServices(t, plusRow, { upstreamStatus: 500 });
  await (await chat({}, withSecret)).text();
  await settleWrites();
  assert.equal(seen.usage().builder_tokens, 0);
});

test('the build overdraft needs a valid pass from the build', async (t) => {
  const atCap = { ...plusRow, period_tokens: PLANS.plus.periodTokens };
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
