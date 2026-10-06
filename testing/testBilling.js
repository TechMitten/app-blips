import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkAllowance, limitMessage, BUILD_OVERDRAFT_TOKENS, PLANS } from '../functions/_lib/plans.js';
import { verifyStripeSignature, handleStripeWebhook, handleBillingStatus } from '../functions/_lib/billing.js';
import { handleChatProxy } from '../functions/_lib/chatProxy.js';
import { wrapWithTokenTracking } from '../functions/_lib/trackTokens.js';

const NOW = Date.UTC(2026, 9, 3, 18, 0, 0);
const FREE = PLANS.free;

const env = {
  OPENAI_BASE_URL: 'https://llm.example/v1',
  OPENAI_API_KEY: 'test-key',
  OPENAI_LLM_MODEL: 'build-model',
  OPENAI_LLM_VISION_MODEL: 'vision-model',
  OPENAI_LLM_ASK_MODEL: 'ask-model',
  APPBLIPS_CHAT_RATE_LIMIT_MAX: '1000',
  SUPABASE_URL: 'https://db.example',
  SUPABASE_PUBLISHABLE_KEY: 'pub',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_test',
};

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

// Mocks Supabase auth, billing_status and the LLM. Returns what was seen.
// `prompts` simulates the claim_prompt counter; reserve_tokens and
// settle_usage keep the row's token totals like the SQL does; `upstreamStatus`
// lets a test make the provider fail and `upstreamBody` replaces the stream.
const mockServices = (t, billingRow, { promptsLeft = 99, upstreamStatus = 200, upstreamBody = sse } = {}) => {
  const seen = { statusCalls: 0, upstream: null, upstreamCalls: 0, claims: 0, releases: 0, promptsLeft, reservations: [], settles: [] };
  const totals = { today: Number(billingRow.today_tokens) || 0, period: Number(billingRow.period_tokens) || 0 };
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const href = String(url);
    if (href.endsWith('/auth/v1/user')) return Response.json({ id: 'user-1', email: 'a@example.com' });
    if (href.endsWith('/rpc/billing_status')) {
      seen.statusCalls += 1;
      return Response.json([billingRow]);
    }
    if (href.endsWith('/rpc/record_usage')) return new Response(null, { status: 204 });
    if (href.endsWith('/rpc/reserve_tokens')) {
      const args = JSON.parse(options.body);
      const over = (args.daily_limit != null && totals.today >= args.daily_limit)
        || (args.period_limit != null && totals.period >= args.period_limit);
      if (!over) {
        totals.today += args.amount;
        totals.period += args.amount;
      }
      seen.reservations.push({ ...args, reserved: !over });
      return Response.json([{ reserved: !over, today_tokens: totals.today, period_tokens: totals.period }]);
    }
    if (href.endsWith('/rpc/settle_usage')) {
      const args = JSON.parse(options.body);
      totals.today += args.token_count - args.reserved;
      totals.period += args.token_count - args.reserved;
      seen.settles.push(args);
      return new Response(null, { status: 204 });
    }
    if (href.endsWith('/rpc/claim_prompt')) {
      seen.claims += 1;
      if (seen.promptsLeft <= 0) return Response.json(false);
      seen.promptsLeft -= 1;
      return Response.json(true);
    }
    if (href.endsWith('/rpc/release_prompt')) {
      seen.releases += 1;
      seen.promptsLeft += 1;
      return new Response(null, { status: 204 });
    }
    if (href === 'https://llm.example/v1/chat/completions') {
      seen.upstream = JSON.parse(options.body);
      seen.upstreamCalls += 1;
      if (upstreamStatus !== 200) return Response.json({ error: { message: 'boom' } }, { status: upstreamStatus });
      return new Response(upstreamBody, { headers: { 'content-type': 'text/event-stream' } });
    }
    throw new Error(`unexpected fetch ${href}`);
  });
  return seen;
};

const chat = (payload, settings = {}) => handleChatProxy(new Request('https://app.example/api/chat', {
  method: 'POST',
  headers: { authorization: 'Bearer token' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'Build a todo app' }], stream: true, ...payload }),
}), { ...env, ...settings });

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

  t.mock.restoreAll();
  let upstreamUrl = null;
  t.mock.method(globalThis, 'fetch', async (url) => {
    const href = String(url);
    if (href.endsWith('/auth/v1/user')) return Response.json({ id: 'user-1' });
    if (href.endsWith('/rpc/billing_status')) throw new Error('billing must not be read for the user\'s own key');
    if (href.endsWith('/rpc/record_usage')) return new Response(null, { status: 204 });
    upstreamUrl = href;
    return new Response(sse, { headers: { 'content-type': 'text/event-stream' } });
  });
  response = await chat({ user_provider: { id: 'openrouter', apiKey: 'sk-or-user', model: 'their/model' } });
  assert.equal(response.status, 200);
  await response.text();
  assert.equal(upstreamUrl, 'https://openrouter.ai/api/v1/chat/completions');
});

// --- usage refund on provider errors ----------------------------------------

test('a response the provider ended with an error is not charged to the allowance', async (t) => {
  const recorded = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    recorded.push(JSON.parse(options.body));
    return new Response(null, { status: 204 });
  });
  const pending = [];
  const stream = (body) => new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  const failed = stream('data: {"choices":[{"delta":{"content":"<html>"},"finish_reason":"error"}],"error":{"message":"boom"},"usage":{"total_tokens":5000}}\n\ndata: [DONE]\n\n');
  await (await wrapWithTokenTracking(env, failed, { stream: true }, { uid: 'user-1', kind: 'builder' }, (p) => pending.push(p))).text();
  const ok = stream('data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}],"usage":{"total_tokens":700}}\n\ndata: [DONE]\n\n');
  await (await wrapWithTokenTracking(env, ok, { stream: true }, { uid: 'user-1', kind: 'builder' }, (p) => pending.push(p))).text();
  await Promise.all(pending);
  assert.deepEqual(recorded.map((r) => r.token_count), [0, 700]);
});

// --- webhook -> subscriptions ------------------------------------------------

test('a subscription event re-reads Stripe and stores the plan by lookup key', async (t) => {
  const upserts = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const href = String(url);
    if (href === 'https://api.stripe.com/v1/subscriptions/sub_1') {
      assert.equal(options.headers.Authorization, 'Bearer sk_test_x');
      return Response.json({
        id: 'sub_1', status: 'active', customer: 'cus_1', cancel_at_period_end: false,
        metadata: { user_id: 'user-1' },
        items: { data: [{ price: { lookup_key: 'appblips_pro_monthly' }, current_period_start: 1790000000, current_period_end: 1792592000 }] },
      });
    }
    if (href.endsWith('/rpc/upsert_subscription')) {
      upserts.push(JSON.parse(options.body));
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected fetch ${href}`);
  });
  const payload = JSON.stringify({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status: 'incomplete' } } });
  const timestamp = Math.floor(Date.now() / 1000);
  const response = await handleStripeWebhook(new Request('https://app.example/api/billing/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': `t=${timestamp},v1=${await sign(payload, 'whsec_test', timestamp)}` },
    body: payload,
  }), env);
  assert.equal(response.status, 200);
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].target_user_id, 'user-1');
  assert.equal(upserts[0].new_plan, 'pro');
  assert.equal(upserts[0].new_status, 'active');
  assert.equal(upserts[0].period_start, new Date(1790000000 * 1000).toISOString());

  const forged = await handleStripeWebhook(new Request('https://app.example/api/billing/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': `t=${timestamp},v1=00` },
    body: payload,
  }), env);
  assert.equal(forged.status, 400);
  assert.equal(upserts.length, 1);
});

test('status reports billing off when there is no Stripe key', async () => {
  const response = await handleBillingStatus(new Request('https://app.example/api/billing/status'), { ...env, STRIPE_SECRET_KEY: '' });
  assert.deepEqual(await response.json(), { enabled: false });
});

test('APPBLIPS_BILLING_TESTERS limits billing to the listed accounts', async (t) => {
  // user-1 (a@example.com, see mockServices) is not on the list: no limits.
  let seen = mockServices(t, { plan: 'free', status: 'none', today_tokens: FREE.dailyTokens * 10, period_tokens: 0 });
  let response = await chat({}, { APPBLIPS_BILLING_TESTERS: 'someone@else.com' });
  assert.equal(response.status, 200);
  await response.text();
  assert.equal(seen.statusCalls, 0);

  // Listed by email (any case): the plan applies.
  t.mock.restoreAll();
  seen = mockServices(t, { plan: 'free', status: 'none', today_tokens: FREE.dailyTokens * 10, period_tokens: 0 });
  response = await chat({}, { APPBLIPS_BILLING_TESTERS: 'someone@else.com, A@Example.com' });
  assert.equal(response.status, 402);
  assert.equal(seen.statusCalls, 1);

  // Off the list, the status endpoint reports billing off.
  t.mock.restoreAll();
  mockServices(t, { plan: 'free', status: 'none', today_tokens: 0, period_tokens: 0 });
  response = await handleBillingStatus(new Request('https://app.example/api/billing/status', { headers: { authorization: 'Bearer token' } }), { ...env, APPBLIPS_BILLING_TESTERS: 'user-2' });
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
  assert.equal(seen.claims, 1);

  response = await chat({ continuing: true, prompt_pass: pass }, withSecret);
  assert.equal(response.status, 200);
  await response.text();
  assert.equal(seen.claims, 1, 'a follow-up with a valid pass is not a new prompt');
  assert.ok(response.headers.get('x-appblips-prompt-pass'), 'the pass is renewed');

  // Marking a request as a follow-up without a valid pass doesn't dodge the count.
  await (await chat({ continuing: true }, withSecret)).text();
  await (await chat({ continuing: true, prompt_pass: `${pass}x` }, withSecret)).text();
  assert.equal(seen.claims, 3);
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
  assert.equal(seen.claims, 0);

  t.mock.restoreAll();
  seen = mockServices(t, freeRow, { upstreamStatus: 500 });
  const response = await chat({}, withSecret);
  assert.equal(response.status, 500);
  await response.text();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(seen.claims, 1);
  assert.equal(seen.releases, 1);
  assert.equal(response.headers.get('x-appblips-prompt-pass'), null);
});

test('paid plans have no prompt limit', async (t) => {
  const seen = mockServices(t, { ...freeRow, plan: 'plus', status: 'active', today_prompts: 500 });
  const response = await chat({}, withSecret);
  assert.equal(response.status, 200);
  await response.text();
  assert.equal(seen.claims, 0);
});

// --- token reservations -------------------------------------------------------

// Lets the waitUntil'd usage writes land before a test reads them.
const settleWrites = () => new Promise((resolve) => setTimeout(resolve, 10));

test('requests sent at the same moment cannot all slip under the limit', async (t) => {
  const seen = mockServices(t, { ...freeRow, today_tokens: FREE.dailyTokens - 10_000, period_tokens: FREE.dailyTokens - 10_000 });
  const responses = await Promise.all(Array.from({ length: 10 }, () => chat({ auto_fix: true }, withSecret)));
  const statuses = responses.map((r) => r.status);
  await Promise.all(responses.map((r) => r.text()));
  assert.equal(statuses.filter((s) => s === 200).length, 1, `one request reserves, the rest are refused: ${statuses}`);
  assert.equal(seen.upstreamCalls, 1);
});

test('a reservation is settled to the reported usage on the day it was made', async (t) => {
  const usage = 'data: {"choices":[{"delta":{"content":"Done"},"finish_reason":"stop"}],"usage":{"total_tokens":1234}}\n\ndata: [DONE]\n\n';
  const seen = mockServices(t, freeRow, { upstreamBody: usage });
  await (await chat({}, withSecret)).text();
  await settleWrites();
  assert.equal(seen.reservations.length, 1);
  const [held] = seen.reservations;
  assert.equal(held.daily_limit, FREE.dailyTokens, 'a new request gets no overdraft');
  assert.equal(seen.settles.length, 1);
  assert.equal(seen.settles[0].reserved, held.amount);
  assert.equal(seen.settles[0].usage_date, held.usage_date);
  assert.equal(seen.settles[0].token_count, 1234);
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
  assert.equal(seen.settles.length, 1);
  assert.ok(seen.settles[0].token_count >= 1000, `charged ${seen.settles[0].token_count}`);
  assert.ok(seen.settles[0].token_count < seen.settles[0].reserved);
});

test('a provider failure hands the reservation back', async (t) => {
  const seen = mockServices(t, freeRow, { upstreamStatus: 500 });
  await (await chat({}, withSecret)).text();
  await settleWrites();
  assert.equal(seen.settles.length, 1);
  assert.equal(seen.settles[0].token_count, 0);
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
  t.mock.restoreAll();
  seen = mockServices(t, { ...atCap, period_tokens: PLANS.plus.periodTokens - 1 });
  response = await chat({}, withSecret);
  assert.equal(response.status, 200);
  await response.text();
  const pass = response.headers.get('x-appblips-prompt-pass');
  assert.ok(pass, 'paid plans get a pass too');
  response = await chat({ continuing: true, prompt_pass: pass }, withSecret);
  assert.equal(response.status, 200);
  await response.text();
  assert.equal(seen.reservations[1].period_limit, PLANS.plus.periodTokens + BUILD_OVERDRAFT_TOKENS);
});
