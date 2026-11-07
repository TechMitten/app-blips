// Run with: node testing/testHostedBilling.mjs
// Covers the hosted billing core without network calls: SQLite store, plan
// mapping, Polar webhook signatures, Clerk token verification (against a
// locally signed token), checkout, cancelling, the webhook's plan updates,
// the chat gate, build usage and deleting an account. Polar's and Clerk's
// APIs are faked.
import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync, randomBytes, sign as signJwt } from 'node:crypto';
import { openStore } from '../electron/server/hosted/store.js';
import { PLANS, planModel, planForProductId, publicCatalog } from '../electron/server/hosted/plans.js';
import { verifyPolarWebhook } from '../electron/server/hosted/polar.js';
import { verifyClerkToken } from '../electron/server/hosted/clerk.js';
import { handleBilling } from '../electron/server/hosted/billing.js';
import { gateChat } from '../electron/server/hosted/chat.js';

const webhookKey = randomBytes(24);
const env = {
  VITE_CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from('clerk.test$').toString('base64')}`,
  POLAR_ACCESS_TOKEN: 'polar_oat_placeholder',
  POLAR_WEBHOOK_SECRET: `whsec_${webhookKey.toString('base64')}`,
  POLAR_PRODUCT_BASIC: 'prod_basic',
  POLAR_PRODUCT_SILVER: 'prod_silver',
  POLAR_PRODUCT_MAX: 'prod_max',
  APPBLIPS_MODEL_BASIC: 'basic-model',
  APPBLIPS_MODEL_SILVER: 'silver-model',
  APPBLIPS_MODEL_MAX: 'max-model',
};

const realFetch = globalThis.fetch;
const checkoutCalls = [];
const cancelCalls = [];
const revokeCalls = [];
const clerkDeletes = [];
// Polar's current subscriptions, by id (what GET /subscriptions/{id} returns).
const subscriptions = new Map();
const subscription = (id, userId, fields = {}) => {
  const sub = {
    id,
    status: 'active',
    product_id: 'prod_basic',
    customer_id: `cust_${userId}`,
    customer: { id: `cust_${userId}`, external_id: userId },
    cancel_at_period_end: false,
    current_period_end: '2026-12-07T00:00:00Z',
    ends_at: null,
    ended_at: null,
    ...fields,
  };
  subscriptions.set(id, sub);
  return sub;
};

// ---- fake JWKS + Polar API --------------------------------------------------
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const href = String(url);
  if (href === 'https://clerk.test/.well-known/jwks.json') return jsonResponse({ keys: [publicJwk] });
  if (href.startsWith('https://api.clerk.com/v1/users/')) {
    assert.equal(init.method, 'DELETE');
    assert.equal(init.headers?.authorization, 'Bearer sk_test_placeholder');
    clerkDeletes.push(decodeURIComponent(href.slice('https://api.clerk.com/v1/users/'.length)));
    return jsonResponse({ deleted: true });
  }
  assert.ok(href.startsWith('https://api.polar.sh/v1/'), `unexpected fetch: ${href}`);
  assert.equal(init.headers?.authorization, `Bearer ${env.POLAR_ACCESS_TOKEN}`);
  const path = href.slice('https://api.polar.sh/v1'.length);
  const method = init.method || 'GET';
  if (path === '/checkouts/' && method === 'POST') {
    checkoutCalls.push(JSON.parse(init.body));
    return jsonResponse({ id: 'chk_1', url: 'https://polar.sh/checkout/chk_1' }, 201);
  }
  if (path.startsWith('/subscriptions/?') && method === 'GET') {
    const userId = new URLSearchParams(path.split('?')[1]).get('external_customer_id');
    const items = [...subscriptions.values()].filter((sub) => sub.status === 'active');
    // Polar filters; the fake lists everyone so a wrong filter would show.
    return jsonResponse({ items: [...items.filter((sub) => sub.customer.external_id !== userId), ...items.filter((sub) => sub.customer.external_id === userId)] });
  }
  const subMatch = path.match(/^\/subscriptions\/([^/?]+)$/);
  if (subMatch && method === 'GET') {
    const sub = subscriptions.get(decodeURIComponent(subMatch[1]));
    return sub ? jsonResponse(sub) : jsonResponse({ error: 'NotFound' }, 404);
  }
  if (subMatch && method === 'PATCH') {
    const id = decodeURIComponent(subMatch[1]);
    cancelCalls.push({ id, body: JSON.parse(init.body) });
    const sub = subscriptions.get(id);
    sub.cancel_at_period_end = true;
    sub.ends_at = sub.current_period_end;
    return jsonResponse(sub);
  }
  if (subMatch && method === 'DELETE') {
    const id = decodeURIComponent(subMatch[1]);
    revokeCalls.push(id);
    const sub = subscriptions.get(id);
    if (!sub) return jsonResponse({ error: 'NotFound' }, 404);
    Object.assign(sub, { status: 'canceled', ended_at: new Date().toISOString() });
    return jsonResponse(sub);
  }
  throw new Error(`Unexpected Polar call in test: ${method} ${path}`);
};

const b64url = (value) => Buffer.from(value).toString('base64url');
const makeToken = (claims) => {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test-key' }));
  const payload = b64url(JSON.stringify({ iss: 'https://clerk.test', sub: 'user_1', iat: now, nbf: now - 5, exp: now + 3600, ...claims }));
  const signature = signJwt('sha256', Buffer.from(`${header}.${payload}`), privateKey);
  return `${header}.${payload}.${b64url(signature)}`;
};

// A Standard Webhooks delivery, signed with `key` (the test secret's key by
// default).
let deliveries = 0;
const signedHeaders = (body, { key = webhookKey, at = Math.floor(Date.now() / 1000), id = `msg_${(deliveries += 1)}` } = {}) => {
  const signature = createHmac('sha256', key).update(`${id}.${at}.${body}`).digest('base64');
  return { 'webhook-id': id, 'webhook-timestamp': String(at), 'webhook-signature': `v1,${signature}` };
};
const webhook = (event, headers) => {
  const body = JSON.stringify(event);
  return new Request('http://localhost/api/webhooks/polar', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(headers || signedHeaders(body)) },
    body,
  });
};
const sendEvent = (type, sub) => handleBilling(webhook({ type, timestamp: new Date().toISOString(), data: sub }), env, store);

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
  assert.equal(store.getAccount('user_1').customer_id, 'cust_1');
  store.setPlan('user_1', 'max', true);
  assert.equal(store.getAccount('user_1').plan, 'max');

  // ---- webhook signature ----------------------------------------------------
  const raw = JSON.stringify({ type: 'subscription.active' });
  const good = signedHeaders(raw);
  const asHeaders = (h) => ({ id: h['webhook-id'], timestamp: h['webhook-timestamp'], signature: h['webhook-signature'] });
  assert.equal(verifyPolarWebhook(raw, asHeaders(good), env.POLAR_WEBHOOK_SECRET), true);
  assert.equal(verifyPolarWebhook(`${raw} `, asHeaders(good), env.POLAR_WEBHOOK_SECRET), false, 'changed body accepted');
  assert.equal(verifyPolarWebhook(raw, { ...asHeaders(good), id: 'msg_other' }, env.POLAR_WEBHOOK_SECRET), false, 'changed id accepted');
  assert.equal(verifyPolarWebhook(raw, asHeaders(signedHeaders(raw, { key: randomBytes(24) })), env.POLAR_WEBHOOK_SECRET), false, 'wrong key accepted');
  assert.equal(verifyPolarWebhook(raw, asHeaders(signedHeaders(raw, { at: Math.floor(Date.now() / 1000) - 3600 })), env.POLAR_WEBHOOK_SECRET), false, 'hour-old delivery accepted');
  assert.equal(verifyPolarWebhook(raw, { ...asHeaders(good), signature: '' }, env.POLAR_WEBHOOK_SECRET), false);
  // Several signatures (a secret being rotated): any valid one is enough.
  assert.equal(verifyPolarWebhook(raw, { ...asHeaders(good), signature: `v1,AAAA ${good['webhook-signature']}` }, env.POLAR_WEBHOOK_SECRET), true);
  // Secrets from before September 2026: the key is the whole string's bytes.
  const legacySecret = 'whsec_legacy-secret-string';
  assert.equal(verifyPolarWebhook(raw, asHeaders(signedHeaders(raw, { key: Buffer.from(legacySecret) })), legacySecret), true);

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
  assert.ok(!JSON.stringify(configBody).includes('prod_'), 'config leaks product ids');
  // Only Basic is sold for now; Silver and Max show as coming soon.
  assert.deepEqual(configBody.plans.map((plan) => [plan.id, plan.comingSoon]), [['basic', false], ['silver', true], ['max', true]]);
  assert.deepEqual(configBody.plans.map((plan) => [plan.id, plan.betaPricing]), [['basic', true], ['silver', false], ['max', false]]);

  const checkoutReq = (body, auth = `Bearer ${token}`) => handleBilling(new Request('http://localhost/api/billing/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  }), env, store);

  // Checkout refuses a coming-soon plan before ever contacting Polar.
  for (const plan of ['silver', 'max']) {
    const soon = await checkoutReq({ plan });
    assert.equal(soon.status, 409, `${plan} checkout`);
    assert.equal((await soon.json()).code, 'plan_coming_soon');
  }
  assert.equal((await checkoutReq({ plan: 'basic' }, null)).status, 401, 'checkout without sign-in');
  assert.equal(checkoutCalls.length, 0);

  // The customer is always the signed-in Clerk user: nothing in the body
  // (another user's id, an email) can change who the subscription belongs to.
  const checkout = await checkoutReq({ plan: 'basic', userId: 'user_victim', external_customer_id: 'user_victim', email: 'victim@example.com' });
  assert.equal(checkout.status, 200);
  assert.equal((await checkout.json()).url, 'https://polar.sh/checkout/chk_1');
  assert.equal(checkoutCalls.length, 1);
  assert.deepEqual(checkoutCalls[0].products, ['prod_basic']);
  assert.equal(checkoutCalls[0].external_customer_id, 'user_1');
  assert.deepEqual(checkoutCalls[0].metadata, { clerk_user_id: 'user_1' });
  assert.ok(!JSON.stringify(checkoutCalls[0]).includes('victim'), 'request body reached Polar');
  assert.equal(checkoutCalls[0].success_url, 'http://localhost/?billing=success');

  // Already on the plan (also while a cancelled one runs out): no second
  // subscription, and Polar is never asked.
  store.setPlan('user_1', 'basic', true);
  const twice = await checkoutReq({ plan: 'basic' });
  assert.equal(twice.status, 409, 'second checkout for the same plan');
  assert.equal((await twice.json()).code, 'already_subscribed');
  store.setCancelAt('user_1', '2099-01-01T00:00:00.000Z');
  assert.equal((await checkoutReq({ plan: 'basic' })).status, 409, 'resubscribing while a cancelled plan runs out');
  store.setCancelAt('user_1', null);
  store.setPlan('user_1', 'basic', false);
  assert.equal((await checkoutReq({ plan: 'basic' })).status, 200, 'an ended plan can be bought again');
  assert.equal(checkoutCalls.length, 2);
  checkoutCalls.pop();
  store.setPlan('user_1', 'max', true);

  const unauth = await handleBilling(new Request('http://localhost/api/billing/me'), env, store);
  assert.equal(unauth.status, 401);
  const me = await handleBilling(new Request('http://localhost/api/billing/me', {
    headers: { authorization: `Bearer ${token}` },
  }), env, store);
  assert.equal(me.status, 200);
  assert.equal((await me.json()).plan, 'max');

  // ---- webhooks ---------------------------------------------------------------
  // Paid: the plan turns on for the Clerk user Polar has as external_id.
  const paid = subscription('sub_paid', 'user_paid');
  assert.equal((await sendEvent('subscription.active', paid)).status, 202);
  assert.equal(store.getAccount('user_paid').active, 1, 'payment did not activate the plan');
  assert.equal(store.getAccount('user_paid').plan, 'basic');
  assert.equal(store.getAccount('user_paid').customer_id, 'cust_user_paid');
  assert.equal(store.getAccount('user_paid').subscription_id, 'sub_paid');
  // The same delivery again changes nothing.
  assert.equal((await sendEvent('subscription.active', paid)).status, 202);
  assert.equal(store.getAccount('user_paid').active, 1);

  // Unsigned, badly signed or replayed-late deliveries change nothing.
  const forged = subscription('sub_forged', 'user_forged');
  const forgedBody = JSON.stringify({ type: 'subscription.active', data: forged });
  for (const headers of [
    {},
    { 'webhook-id': 'msg_x', 'webhook-timestamp': String(Math.floor(Date.now() / 1000)), 'webhook-signature': 'v1,AAAA' },
    signedHeaders(forgedBody, { key: randomBytes(24) }),
    signedHeaders(forgedBody, { at: Math.floor(Date.now() / 1000) - 3600 }),
  ]) {
    const res = await handleBilling(new Request('http://localhost/api/webhooks/polar', { method: 'POST', headers, body: forgedBody }), env, store);
    assert.equal(res.status, 403);
  }
  assert.equal(store.getAccount('user_forged'), null, 'unsigned webhook created an account');

  // The event's own copy is not trusted: what Polar says now wins. An event
  // claiming the subscription belongs to someone else changes only the real
  // owner's row.
  subscription('sub_owned', 'user_owner');
  await sendEvent('subscription.active', { id: 'sub_owned', status: 'active', customer: { external_id: 'user_attacker' }, product_id: 'prod_max' });
  assert.equal(store.getAccount('user_attacker'), null, 'event body chose the user');
  assert.equal(store.getAccount('user_owner').active, 1);
  assert.equal(store.getAccount('user_owner').plan, 'basic', 'event body chose the plan');

  // A subscription made outside AppBlips' checkout has no Clerk user: ignored.
  subscription('sub_manual', null, { customer: { id: 'cust_manual', external_id: null } });
  assert.equal((await sendEvent('subscription.active', subscriptions.get('sub_manual'))).status, 202);

  // Polar unreachable: 503, so Polar retries the delivery later.
  assert.equal((await sendEvent('subscription.active', { id: 'sub_missing' })).status, 503);

  // Cancelled for the period end (in Polar's portal): still active, with the date.
  const portal = subscription('sub_portal', 'user_portal');
  await sendEvent('subscription.active', portal);
  portal.cancel_at_period_end = true;
  portal.ends_at = '2026-12-20T00:00:00Z';
  await sendEvent('subscription.canceled', portal);
  assert.equal(store.getAccount('user_portal').active, 1);
  assert.equal(store.getAccount('user_portal').cancel_at, '2026-12-20T00:00:00Z');
  // Uncancelled: renews again.
  portal.cancel_at_period_end = false;
  portal.ends_at = null;
  await sendEvent('subscription.uncanceled', portal);
  assert.equal(store.getAccount('user_portal').cancel_at, null);
  // Period over: revoked, access stops.
  portal.status = 'canceled';
  portal.ended_at = '2026-12-20T00:00:00Z';
  await sendEvent('subscription.revoked', portal);
  assert.equal(store.getAccount('user_portal').active, 0, 'revoked subscription kept access');

  // Resubscribed later: a late delivery about the old, ended subscription
  // must not switch off the new one.
  const renewed = subscription('sub_portal_2', 'user_portal');
  await sendEvent('subscription.active', renewed);
  assert.equal(store.getAccount('user_portal').active, 1);
  await sendEvent('subscription.revoked', portal);
  assert.equal(store.getAccount('user_portal').active, 1, 'old subscription ending switched off the new one');
  assert.equal(store.getAccount('user_portal').subscription_id, 'sub_portal_2');

  // An older "created" delivery arriving after "active" can't undo it, since
  // the current state is read from Polar.
  await sendEvent('subscription.created', { ...renewed, status: 'incomplete' });
  assert.equal(store.getAccount('user_portal').active, 1);

  // Past due: no access until it's paid.
  const late = subscription('sub_late', 'user_late');
  await sendEvent('subscription.active', late);
  late.status = 'past_due';
  await sendEvent('subscription.past_due', late);
  assert.equal(store.getAccount('user_late').active, 0);

  // ---- chat gate ------------------------------------------------------------
  const buildRequest = (bearer = token) => new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'build me a site' }], user_provider: { id: 'x', model: 'y', apiKey: 'z' } }),
  });

  // A paid Basic user builds with Basic's model; the client's provider is dropped.
  const paidGate = await gateChat(buildRequest(makeToken({ sub: 'user_paid' })), env, store);
  assert.ok(paidGate.request, 'gate rejected a valid build');
  const gatedBody = JSON.parse(await paidGate.request.text());
  assert.equal(gatedBody.hosted_model_override, 'basic-model', 'plan model was not applied');
  assert.equal(gatedBody.user_provider, undefined, 'client provider survived the gate');
  assert.equal(paidGate.windowed, true, 'build was not counted against the cooldown');

  // Ask-mode and repairs don't count as builds.
  const askGate = await gateChat(new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${makeToken({ sub: 'user_paid' })}` },
    body: JSON.stringify({ ask: true, messages: [] }),
  }), env, store);
  assert.ok(askGate.request);
  assert.equal(askGate.windowed, false);

  // A plan with a monthly credit allowance (not sold yet) can't build for free.
  assert.equal(store.getAccount('user_1').plan, 'max');
  const capped = await gateChat(buildRequest(), env, store);
  assert.equal(capped.response.status, 402);
  assert.equal((await capped.response.json()).code, 'plan_unavailable');

  // No active subscription -> 402, even for Basic.
  for (const sub of ['user_no_sub', 'user_late']) {
    const noSub = await gateChat(buildRequest(makeToken({ sub })), env, store);
    assert.equal(noSub.response.status, 402, sub);
    assert.equal((await noSub.response.json()).code, 'subscription_required');
  }

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
  store.releaseBuild('user_window');
  assert.equal(store.takeBuild('user_window', { limit: 50, windowMs, at: t0 + 3600001 }).allowed, true);
  assert.equal(store.takeBuild('user_window', { limit: 50, windowMs, at: t0 + 3600002 }).allowed, false);
  assert.equal(store.takeBuild('user_window', { limit: 50, windowMs, at: t0 + windowMs }).allowed, true);
  assert.equal(store.getAccount('user_window').build_window_count, 1);

  store.saveAccount({ userId: 'user_cool', customerId: 'cust_cool', plan: 'basic', active: true });
  for (let i = 0; i < 50; i += 1) store.takeBuild('user_cool', { limit: 50, windowMs });
  const cooled = await gateChat(buildRequest(makeToken({ sub: 'user_cool' })), env, store);
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

  // No active plan: nothing to cancel, and Polar is never called.
  assert.equal((await cancelReq('user_no_sub')).status, 409);
  assert.equal(cancelCalls.length, 0);

  // Cancels the user's own subscription for the end of the period (never
  // immediately); still active until then.
  const cancelled = await cancelReq('user_paid');
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).cancelAt, '2026-12-07T00:00:00Z');
  assert.deepEqual(cancelCalls, [{ id: 'sub_paid', body: { cancel_at_period_end: true } }]);
  const meCancelled = await meFor('user_paid');
  assert.equal(meCancelled.active, true, 'still active until the period ends');
  assert.equal(meCancelled.cancelAt, '2026-12-07T00:00:00Z');
  // Cancelling again just reports the date.
  assert.equal((await cancelReq('user_paid')).status, 200);
  assert.equal(cancelCalls.length, 1);

  // No stored subscription id: found by the user's own Clerk id, never
  // someone else's.
  subscription('sub_lookup', 'user_lookup');
  store.saveAccount({ userId: 'user_lookup', plan: 'basic', active: true });
  assert.equal((await cancelReq('user_lookup')).status, 200);
  assert.equal(cancelCalls.at(-1).id, 'sub_lookup');

  // ---- build usage (Settings → Account) --------------------------------------
  const usageOf = async (sub) => (await meFor(sub)).usage;
  store.saveAccount({ userId: 'user_usage', plan: 'basic', active: true });
  assert.deepEqual(await usageOf('user_usage'), { used: 0, limit: 50, resetAt: null, windowHours: 5 }, 'no window yet');
  const usageStart = Date.now() - 60 * 60 * 1000;
  for (let i = 0; i < 3; i += 1) store.takeBuild('user_usage', { limit: 50, windowMs, at: usageStart + i });
  assert.deepEqual(await usageOf('user_usage'), {
    used: 3, limit: 50, resetAt: new Date(usageStart + windowMs).toISOString(), windowHours: 5,
  });
  // A window that has ended shows as unused: the next build starts a new one.
  store.saveAccount({ userId: 'user_old_window', plan: 'basic', active: true });
  store.takeBuild('user_old_window', { limit: 50, windowMs, at: Date.now() - windowMs - 1 });
  assert.deepEqual(await usageOf('user_old_window'), { used: 0, limit: 50, resetAt: null, windowHours: 5 });

  // ---- delete account (Settings → Account) -----------------------------------
  const deleteReq = (claims, envFor = env) => handleBilling(new Request('http://localhost/api/billing/account', {
    method: 'DELETE',
    headers: { authorization: `Bearer ${makeToken(claims)}` },
  }), envFor, store);
  const fresh = { fva: [2, -1] };

  // Not verified recently (or no claim at all): Clerk's reverification hint,
  // and nothing is touched.
  subscription('sub_delete', 'user_delete');
  store.saveAccount({ userId: 'user_delete', plan: 'basic', active: true });
  store.setSubscriptionId('user_delete', 'sub_delete');
  for (const claims of [{ sub: 'user_delete', fva: [45, -1] }, { sub: 'user_delete' }, { sub: 'user_delete', fva: [-1, -1] }]) {
    const stale = await deleteReq(claims);
    assert.equal(stale.status, 403);
    const hint = await stale.json();
    assert.equal(hint.clerk_error.reason, 'reverification-error');
    assert.deepEqual(hint.clerk_error.metadata.reverification, { level: 'first_factor', afterMinutes: 10 });
  }
  assert.equal(revokeCalls.length, 0);
  assert.ok(store.getAccount('user_delete'));
  assert.equal((await handleBilling(new Request('http://localhost/api/billing/account', { method: 'POST' }), env, store)).status, 405);

  // Verified: the plan is revoked now, the row goes, and without
  // CLERK_SECRET_KEY the app is told to delete the Clerk user itself.
  const deleted = await deleteReq({ sub: 'user_delete', ...fresh });
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { deleted: true, clerkDeleted: false });
  assert.deepEqual(revokeCalls, ['sub_delete']);
  assert.equal(store.getAccount('user_delete'), null);
  assert.equal(clerkDeletes.length, 0);
  // Polar's revoked notice for it doesn't bring the row back.
  assert.equal((await sendEvent('subscription.revoked', subscriptions.get('sub_delete'))).status, 202);
  assert.equal(store.getAccount('user_delete'), null);

  // With the secret key (the Worker), the server deletes the Clerk user too.
  // No plan: nothing to revoke.
  store.saveAccount({ userId: 'user_free', plan: 'basic', active: false });
  const withSecret = { ...env, CLERK_SECRET_KEY: 'sk_test_placeholder' };
  const freeDeleted = await deleteReq({ sub: 'user_free', ...fresh }, withSecret);
  assert.deepEqual(await freeDeleted.json(), { deleted: true, clerkDeleted: true });
  assert.deepEqual(clerkDeletes, ['user_free']);
  assert.deepEqual(revokeCalls, ['sub_delete']);
  assert.equal(store.getAccount('user_free'), null);

  console.log('Hosted billing checks passed: plans, store, Polar webhooks and signatures, Clerk tokens, checkout, the chat gate, the build cooldown, cancelling, build usage and deleting an account.');
} finally {
  store.close();
  globalThis.fetch = realFetch;
}
