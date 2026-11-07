// Run with: node testing/testHostedBilling.mjs
// Covers the hosted billing core without network calls: SQLite store, plan
// mapping, Creem webhook verification/idempotency, Clerk token verification
// (against a locally signed token), and the chat gate's model override +
// credit debit.
import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync, sign as signJwt } from 'node:crypto';
import { openStore } from '../electron/server/hosted/store.js';
import { PLANS, planModel, planForProductId, publicCatalog } from '../electron/server/hosted/plans.js';
import { verifyCreemSignature } from '../electron/server/hosted/creem.js';
import { verifyClerkToken } from '../electron/server/hosted/clerk.js';
import { handleBilling } from '../electron/server/hosted/billing.js';
import { gateChat } from '../electron/server/hosted/chat.js';

const env = {
  VITE_CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from('clerk.test$').toString('base64')}`,
  CREEM_SERVER: 'test',
  CREEM_TEST_API_KEY: 'creem_test_placeholder',
  CREEM_TEST_WEBHOOK_SECRET: 'whsec_test',
  CREEM_TEST_PRODUCT_SILVER: 'prod_silver',
  CREEM_TEST_PRODUCT_MAX: 'prod_max',
  APPBLIPS_MODEL_BASIC: 'basic-model',
  APPBLIPS_MODEL_SILVER: 'silver-model',
  APPBLIPS_MODEL_MAX: 'max-model',
};

const realFetch = globalThis.fetch;
let creemDebitStatus = 200;
const cancelCalls = [];

// ---- fake JWKS + Creem API ------------------------------------------------
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
globalThis.fetch = async (url, init = {}) => {
  const href = String(url);
  if (href === 'https://clerk.test/.well-known/jwks.json') {
    return new Response(JSON.stringify({ keys: [publicJwk] }), { headers: { 'content-type': 'application/json' } });
  }
  if (href.includes('/customer-credits/accounts?customer_id=')) {
    return new Response(JSON.stringify({ data: [{ id: 'acct_default', name: 'default', status: 'active' }] }), {
      headers: { 'content-type': 'application/json' },
    });
  }
  if (href.includes('/customer-credits/accounts/acct_default/debit')) {
    return new Response(JSON.stringify(creemDebitStatus === 200 ? { id: 'txn_1' } : { error: 'Insufficient balance' }), {
      status: creemDebitStatus,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (href.includes('/customer-credits/accounts/acct_default/credit')) {
    return new Response(JSON.stringify({ id: 'txn_2' }), { headers: { 'content-type': 'application/json' } });
  }
  // Subscription cancel (Settings → Plan): search has no customer filter, so
  // the fake lists another customer's subscription first.
  if (href.includes('/subscriptions/search')) {
    return new Response(JSON.stringify({
      items: [
        { id: 'sub_other', status: 'active', customer: { id: 'cust_someone_else' } },
        { id: 'sub_cancel', status: 'active', customer: { id: 'cust_cancel' } },
      ],
      pagination: { next_page: null },
    }), { headers: { 'content-type': 'application/json' } });
  }
  const cancelMatch = href.match(/\/subscriptions\/([^/]+)\/cancel$/);
  if (cancelMatch) {
    cancelCalls.push({ id: cancelMatch[1], body: JSON.parse(init.body || '{}') });
    return new Response(JSON.stringify({ id: cancelMatch[1], status: 'scheduled_cancel', current_period_end_date: '2026-12-07T00:00:00.000Z' }), {
      headers: { 'content-type': 'application/json' },
    });
  }
  throw new Error(`Unexpected fetch in test: ${href}`);
};

const b64url = (value) => Buffer.from(value).toString('base64url');
const makeToken = (claims) => {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test-key' }));
  const payload = b64url(JSON.stringify({ iss: 'https://clerk.test', sub: 'user_1', iat: now, nbf: now - 5, exp: now + 3600, ...claims }));
  const signature = signJwt('sha256', Buffer.from(`${header}.${payload}`), privateKey);
  return `${header}.${payload}.${b64url(signature)}`;
};

const store = openStore(':memory:');

try {
  // ---- plans ----------------------------------------------------------------
  assert.equal(planModel(env, 'silver'), 'silver-model');
  assert.equal(planModel(env, 'basic'), 'basic-model');
  assert.equal(planForProductId(env, 'prod_max'), 'max');
  assert.equal(planForProductId(env, 'prod_unknown'), null);
  assert.equal(PLANS.basic.monthlyCredits, null, 'Basic stays unlimited');
  const catalog = publicCatalog();
  assert.ok(catalog.every((plan) => !('modelEnv' in plan) && !('productId' in plan)), 'catalog leaks internals');

  // ---- store ----------------------------------------------------------------
  store.saveAccount({ userId: 'user_1', customerId: 'cust_1', plan: 'silver', active: true });
  assert.equal(store.getAccount('user_1').plan, 'silver');
  assert.equal(store.getAccountByCustomer('cust_1').user_id, 'user_1');
  store.setPlanByCustomer('cust_1', 'max', true);
  assert.equal(store.getAccount('user_1').plan, 'max');
  assert.equal(store.claimEvent('evt_1'), true);
  assert.equal(store.claimEvent('evt_1'), false, 'duplicate event id was not deduped');

  // ---- webhook signature ----------------------------------------------------
  const raw = JSON.stringify({ id: 'evt_sig' });
  const good = createHmac('sha256', env.CREEM_TEST_WEBHOOK_SECRET).update(raw).digest('hex');
  assert.equal(verifyCreemSignature(raw, good, env.CREEM_TEST_WEBHOOK_SECRET), true);
  assert.equal(verifyCreemSignature(raw, `${good.slice(0, -2)}00`, env.CREEM_TEST_WEBHOOK_SECRET), false);
  assert.equal(verifyCreemSignature(raw, good, 'wrong-secret'), false);

  // ---- Clerk token ----------------------------------------------------------
  const token = makeToken();
  assert.equal((await verifyClerkToken(token, env)).sub, 'user_1');
  await assert.rejects(() => verifyClerkToken(`${token}tampered`, env));
  await assert.rejects(() => verifyClerkToken(makeToken({ exp: Math.floor(Date.now() / 1000) - 10 }), env));

  // ---- billing routes -------------------------------------------------------
  const configRes = await handleBilling(new Request('http://localhost/api/billing/config'), env, store);
  assert.equal(configRes.status, 200);
  const configBody = await configRes.json();
  assert.deepEqual(configBody.plans.map((plan) => plan.id), ['basic', 'silver', 'max']);
  assert.ok(!JSON.stringify(configBody).includes('model'), 'config leaks model ids');
  // Only Basic is sold for now; Silver and Max show as coming soon.
  assert.deepEqual(configBody.plans.map((plan) => [plan.id, plan.comingSoon]), [['basic', false], ['silver', true], ['max', true]]);
  // Basic's $1 price and unlimited builds are beta terms the app must label.
  assert.deepEqual(configBody.plans.map((plan) => [plan.id, plan.betaPricing]), [['basic', true], ['silver', false], ['max', false]]);

  // Checkout refuses a coming-soon plan before ever contacting Creem, so the
  // tag in the app is not the only thing stopping a purchase.
  for (const plan of ['silver', 'max']) {
    const soon = await handleBilling(new Request('http://localhost/api/billing/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ plan }),
    }), env, store);
    assert.equal(soon.status, 409, `${plan} checkout`);
    assert.equal((await soon.json()).code, 'plan_coming_soon');
  }

  const unauth = await handleBilling(new Request('http://localhost/api/billing/me'), env, store);
  assert.equal(unauth.status, 401);

  const me = await handleBilling(new Request('http://localhost/api/billing/me', {
    headers: { authorization: `Bearer ${token}` },
  }), env, store);
  assert.equal(me.status, 200);
  assert.equal((await me.json()).plan, 'max');

  const webhook = (event, signature) => new Request('http://localhost/api/webhooks/creem', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'creem-signature': signature },
    body: JSON.stringify(event),
  });

  const checkoutEvent = {
    id: 'evt_checkout_1',
    eventType: 'checkout.completed',
    object: { customer: { id: 'cust_checkout' }, product: { id: 'prod_silver' }, metadata: { clerk_user_id: 'user_checkout' } },
  };
  const checkoutBody = JSON.stringify(checkoutEvent);
  const checkoutSig = createHmac('sha256', env.CREEM_TEST_WEBHOOK_SECRET).update(checkoutBody).digest('hex');
  const checkoutRes = await handleBilling(webhook(checkoutEvent, checkoutSig), env, store);
  assert.equal(checkoutRes.status, 200);
  assert.equal(store.getAccount('user_checkout').plan, 'silver');
  assert.equal(store.getAccount('user_checkout').active, 1, 'checkout did not activate the subscription');
  assert.equal(store.getAccount('user_checkout').creem_customer_id, 'cust_checkout');

  const replay = await handleBilling(webhook(checkoutEvent, checkoutSig), env, store);
  assert.equal((await replay.json()).duplicate, true, 'replayed webhook was not treated as duplicate');

  const canceled = {
    id: 'evt_cancel_1',
    eventType: 'subscription.canceled',
    object: { customer: { id: 'cust_checkout' }, product: { id: 'prod_silver' } },
  };
  const canceledBody = JSON.stringify(canceled);
  await handleBilling(webhook(canceled, createHmac('sha256', env.CREEM_TEST_WEBHOOK_SECRET).update(canceledBody).digest('hex')), env, store);
  assert.equal(store.getAccount('user_checkout').plan, 'basic');
  assert.equal(store.getAccount('user_checkout').active, 0, 'cancellation did not revoke access');

  const badSig = await handleBilling(webhook({ id: 'evt_bad' }, 'deadbeef'), env, store);
  assert.equal(badSig.status, 401);

  // ---- chat gate ------------------------------------------------------------
  const buildRequest = () => new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'build me a site' }], user_provider: { id: 'x', model: 'y', apiKey: 'z' } }),
  });

  // user_1 is on Max with a linked customer.
  assert.equal(store.getAccount('user_1').plan, 'max');
  store.saveAccount({ userId: 'user_1', customerId: 'cust_1', plan: 'max', active: true });

  const gated = await gateChat(buildRequest(), env, store);
  assert.ok(gated.request, 'gate rejected a valid build');
  const gatedBody = JSON.parse(await gated.request.text());
  assert.equal(gatedBody.hosted_model_override, 'max-model', 'plan model was not applied');
  assert.equal(gatedBody.user_provider, undefined, 'client provider survived the gate');
  assert.ok(gated.charge, 'paid build was not charged');

  // Ask-mode and repairs are free.
  const askGate = await gateChat(new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ ask: true, messages: [] }),
  }), env, store);
  assert.equal(askGate.charge, null);

  // Out of credits -> 402 with a stable code.
  creemDebitStatus = 402;
  const broke = await gateChat(buildRequest(), env, store);
  assert.equal(broke.response.status, 402);
  assert.equal((await broke.response.json()).code, 'credits_exhausted');
  creemDebitStatus = 200;

  // No active subscription -> 402, even for Basic.
  const noSubToken = makeToken({ sub: 'user_no_sub' });
  const noSub = await gateChat(new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${noSubToken}` },
    body: JSON.stringify({ messages: [] }),
  }), env, store);
  assert.equal(noSub.response.status, 402);
  assert.equal((await noSub.response.json()).code, 'subscription_required');

  // No session -> 401.
  const anon = await gateChat(new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }), env, store);
  assert.equal(anon.response.status, 401);

  // ---- build cooldown (Basic: 50 builds per 5-hour window) -----------------
  const basic = configBody.plans.find((plan) => plan.id === 'basic');
  assert.deepEqual([basic.priceCents, basic.windowBuilds, basic.windowHours], [500, 50, 5]);
  store.saveAccount({ userId: 'user_window', customerId: 'cust_window', plan: 'basic', active: true });
  const windowMs = 5 * 60 * 60 * 1000;
  const t0 = Date.UTC(2026, 10, 7, 9, 0, 0);
  for (let i = 0; i < 50; i += 1) {
    assert.equal(store.takeBuild('user_window', { limit: 50, windowMs, at: t0 + i * 1000 }).allowed, true, `build ${i + 1}`);
  }
  const blocked = store.takeBuild('user_window', { limit: 50, windowMs, at: t0 + 3600000 });
  assert.equal(blocked.allowed, false, 'the 51st build in the window is refused');
  assert.equal(blocked.resetAt, t0 + windowMs, 'unlocks 5 hours after the first build');
  // A build the provider rejected is given back, so it doesn't use the window.
  store.releaseBuild('user_window');
  assert.equal(store.takeBuild('user_window', { limit: 50, windowMs, at: t0 + 3600001 }).allowed, true);
  assert.equal(store.takeBuild('user_window', { limit: 50, windowMs, at: t0 + 3600002 }).allowed, false);
  // Once the window has passed, a new one starts with this build.
  assert.equal(store.takeBuild('user_window', { limit: 50, windowMs, at: t0 + windowMs }).allowed, true);
  assert.equal(store.getAccount('user_window').build_window_count, 1);

  // Through the chat gate: the refusal says when building unlocks again.
  store.saveAccount({ userId: 'user_cool', customerId: 'cust_cool', plan: 'basic', active: true });
  for (let i = 0; i < 50; i += 1) store.takeBuild('user_cool', { limit: 50, windowMs });
  const coolToken = makeToken({ sub: 'user_cool' });
  const cooled = await gateChat(new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${coolToken}` },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'build' }] }),
  }), env, store);
  assert.equal(cooled.response.status, 429);
  const cooledBody = await cooled.response.json();
  assert.equal(cooledBody.code, 'build_cooldown');
  assert.match(cooledBody.error, /50 builds for this 5-hour window\. Building unlocks again in \d+ h \d+ min\./);
  assert.ok(Number(cooled.response.headers.get('retry-after')) > 0);

  // ---- cancel subscription (Settings → Plan) ---------------------------------
  const cancelReq = (sub) => handleBilling(new Request('http://localhost/api/billing/cancel', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${makeToken({ sub })}` },
    body: '{}',
  }), env, store);
  const meFor = async (sub) => (await handleBilling(new Request('http://localhost/api/billing/me', {
    headers: { authorization: `Bearer ${makeToken({ sub })}` },
  }), env, store)).json();

  // No active plan: nothing to cancel, and Creem is never called.
  store.saveAccount({ userId: 'user_noplan', customerId: 'cust_noplan', plan: 'basic', active: false });
  assert.equal((await cancelReq('user_noplan')).status, 409);
  assert.equal(cancelCalls.length, 0);

  // Subscribed before ids were stored: found by customer, cancelled for the
  // end of the period (never immediately), and still active until then.
  store.saveAccount({ userId: 'user_cancel', customerId: 'cust_cancel', plan: 'basic', active: true });
  const cancelled = await cancelReq('user_cancel');
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).cancelAt, '2026-12-07T00:00:00.000Z');
  assert.deepEqual(cancelCalls, [{ id: 'sub_cancel', body: { mode: 'scheduled', onExecute: 'cancel' } }]);
  assert.equal(store.getAccount('user_cancel').subscription_id, 'sub_cancel');
  const meCancelled = await meFor('user_cancel');
  assert.equal(meCancelled.active, true, 'still active until the period ends');
  assert.equal(meCancelled.cancelAt, '2026-12-07T00:00:00.000Z');
  // Cancelling again just reports the date.
  assert.equal((await cancelReq('user_cancel')).status, 200);
  assert.equal(cancelCalls.length, 1);

  // When the period ends Creem sends subscription.canceled: access stops.
  const endEvent = { id: 'evt_sub_end', eventType: 'subscription.canceled', object: { id: 'sub_cancel', status: 'canceled', customer: { id: 'cust_cancel' }, product: { id: 'prod_basic' } } };
  const endBody = JSON.stringify(endEvent);
  const endRes = await handleBilling(webhook(endEvent, createHmac('sha256', env.CREEM_TEST_WEBHOOK_SECRET).update(endBody).digest('hex')), env, store);
  assert.equal(endRes.status, 200);
  assert.equal(store.getAccount('user_cancel').active, 0);
  assert.equal((await meFor('user_cancel')).cancelAt, null);

  // Cancelled in Creem's own portal for the period end: the webhook records it.
  store.saveAccount({ userId: 'user_portal', customerId: 'cust_portal', plan: 'basic', active: true });
  const schedEvent = { id: 'evt_sched', eventType: 'subscription.scheduled_cancel', object: { id: 'sub_portal', status: 'scheduled_cancel', current_period_end_date: '2026-12-20T00:00:00.000Z', customer: { id: 'cust_portal' } } };
  const schedBody = JSON.stringify(schedEvent);
  await handleBilling(webhook(schedEvent, createHmac('sha256', env.CREEM_TEST_WEBHOOK_SECRET).update(schedBody).digest('hex')), env, store);
  assert.equal(store.getAccount('user_portal').active, 1);
  assert.equal(store.getAccount('user_portal').cancel_at, '2026-12-20T00:00:00.000Z');
  assert.equal(store.getAccount('user_portal').subscription_id, 'sub_portal');

  console.log('Hosted billing checks passed: plans, store, webhooks, Clerk tokens, the chat gate, the build cooldown and cancelling.');
} finally {
  store.close();
  globalThis.fetch = realFetch;
}
