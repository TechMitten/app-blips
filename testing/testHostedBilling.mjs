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

  console.log('Hosted billing checks passed: plans, store, webhooks, Clerk tokens, and the chat gate.');
} finally {
  store.close();
  globalThis.fetch = realFetch;
}
