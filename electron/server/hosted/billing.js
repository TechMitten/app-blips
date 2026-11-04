// Hosted billing endpoints: plan/credit status, Creem checkout, and the
// Creem webhook that keeps each user's plan current.
//
// Everything is driven by Creem: its customer-credit ledger is the source of
// truth for paid-tier balances, and its webhooks are the source of truth for
// subscriptions. The local store only keeps the Clerk-user <-> Creem-customer
// link and a webhook idempotency set.

import { PLANS, isPlanId, planForProductId, planProductId, publicCatalog } from './plans.js';
import { verifyClerkToken } from './clerk.js';
import { createCheckout, findCreditAccount, getCreditBalance, verifyCreemSignature, creemWebhookSecret } from './creem.js';

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

const idOf = (value) => (typeof value === 'string' ? value : value?.id || null);

async function requireUser(request, env) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return { response: json(401, { error: 'Sign in to continue.' }) };
  try {
    const claims = await verifyClerkToken(token, env);
    return { userId: claims.sub };
  } catch {
    return { response: json(401, { error: 'Your session has expired. Sign in again.' }) };
  }
}

const planOf = (account) => (account?.plan && isPlanId(account.plan) ? account.plan : 'basic');

async function handleMe(request, env, store) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;

  const account = store.getAccount(auth.userId);
  const planId = planOf(account);
  const plan = PLANS[planId];
  const unlimited = plan.monthlyCredits == null;

  let credits = null;
  if (!unlimited && account?.creem_customer_id) {
    let walletId = account.credit_account_id;
    if (!walletId) {
      const wallet = await findCreditAccount(env, account.creem_customer_id).catch(() => null);
      if (wallet) {
        walletId = wallet.id;
        store.saveAccount({ userId: auth.userId, customerId: account.creem_customer_id, creditAccountId: walletId, plan: planId });
      }
    }
    if (walletId) credits = await getCreditBalance(env, walletId).catch(() => null);
  }

  return json(200, {
    plan: planId,
    planName: plan.name,
    active: Boolean(account?.active),
    unlimited,
    credits,
    monthlyCredits: plan.monthlyCredits,
    sandboxId: account?.sandbox_id || null,
    sandboxSnapshotId: account?.sandbox_snapshot_id || null,
    plans: publicCatalog(),
  });
}

async function handleCheckout(request, env) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const planId = body?.plan;
  if (!isPlanId(planId)) {
    return json(400, { error: 'Choose a plan to subscribe to.' });
  }
  const productId = planProductId(env, planId);
  if (!productId) return json(503, { error: 'That plan is not available yet.' });

  const origin = new URL(request.url).origin;
  const successUrl = String(env?.APPBLIPS_BILLING_SUCCESS_URL || '').trim() || `${origin}/?billing=success`;

  const result = await createCheckout(env, {
    productId,
    clerkUserId: auth.userId,
    successUrl,
  }).catch(() => null);
  if (!result?.ok) return json(502, { error: 'Could not start checkout. Please try again.' });

  const url = result.data?.checkout_url || result.data?.checkoutUrl;
  if (!url) return json(502, { error: 'Checkout did not return a URL.' });
  return json(200, { url });
}

function applyCheckoutCompleted(object, env, store) {
  const customerId = idOf(object.customer);
  const userId = object.metadata?.clerk_user_id || object.metadata?.clerkUserId;
  const productId = idOf(object.product) || object.product_id || object.subscription?.product;
  const planId = planForProductId(env, productId) || 'basic';
  if (!userId || !customerId) return;
  store.saveAccount({ userId, customerId, plan: planId, active: true });
}

function applySubscription(object, type, env, store) {
  const customerId = idOf(object.customer);
  if (!customerId) return;
  const productId = idOf(object.product) || object.product_id;
  const planId = planForProductId(env, productId);

  const ended = ['subscription.canceled', 'subscription.expired', 'subscription.unpaid', 'subscription.paused'].includes(type);
  if (ended) {
    store.setPlanByCustomer(customerId, 'basic', false);
    return;
  }
  if (['subscription.active', 'subscription.paid', 'subscription.trialing', 'subscription.update'].includes(type)) {
    store.setPlanByCustomer(customerId, planId || 'basic', true);
  }
}

async function handleWebhook(request, env, store) {
  const secret = creemWebhookSecret(env);
  if (!secret) return json(503, { error: 'Webhooks are not configured.' });

  const raw = Buffer.from(await request.arrayBuffer());
  if (!verifyCreemSignature(raw, request.headers.get('creem-signature'), secret)) {
    return json(401, { error: 'Invalid webhook signature.' });
  }

  let event;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch {
    return json(400, { error: 'Invalid webhook body.' });
  }

  const eventId = event?.id || event?.event_id || event?.data?.id;
  if (eventId && !store.claimEvent(eventId)) {
    return json(200, { received: true, duplicate: true });
  }

  const type = event?.eventType || event?.type || '';
  const object = event?.object || event?.data?.object || event?.data || {};
  if (type === 'checkout.completed') applyCheckoutCompleted(object, env, store);
  else if (type.startsWith('subscription.')) applySubscription(object, type, env, store);

  return json(200, { received: true });
}

export async function handleBilling(request, env, store) {
  const { pathname } = new URL(request.url);
  if (pathname === '/api/webhooks/creem') {
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    return handleWebhook(request, env, store);
  }
  if (pathname === '/api/billing/config') {
    if (request.method !== 'GET') return json(405, { error: 'Method not allowed.' });
    return json(200, { hosted: true, plans: publicCatalog() });
  }
  if (pathname === '/api/billing/me') {
    if (request.method !== 'GET') return json(405, { error: 'Method not allowed.' });
    return handleMe(request, env, store);
  }
  if (pathname === '/api/billing/checkout') {
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    return handleCheckout(request, env);
  }
  return json(404, { error: 'Not found.' });
}
