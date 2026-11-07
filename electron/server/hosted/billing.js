// Hosted billing endpoints: plan/credit status, Creem checkout, and the
// Creem webhook that keeps each user's plan current.
//
// Everything is driven by Creem: its customer-credit ledger is the source of
// truth for paid-tier balances, and its webhooks are the source of truth for
// subscriptions. The local store only keeps the Clerk-user <-> Creem-customer
// link and a webhook idempotency set.

import { PLANS, isPlanId, isPlanOnSale, planForProductId, planProductId, publicCatalog } from './plans.js';
import { verifyClerkToken } from './clerk.js';
import { cancelSubscription, createCheckout, findCreditAccount, findCustomerSubscription, getCreditBalance, verifyCreemSignature, creemWebhookSecret } from './creem.js';

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

  const account = await store.getAccount(auth.userId);
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
        await store.saveAccount({ userId: auth.userId, customerId: account.creem_customer_id, creditAccountId: walletId, plan: planId });
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
    // Set after a cancel: the plan stays active until then, with no renewal.
    cancelAt: account?.active ? account?.cancel_at || null : null,
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
  if (!isPlanOnSale(planId)) {
    return json(409, { error: `${PLANS[planId].name} is coming soon. Basic is available now.`, code: 'plan_coming_soon' });
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

// Settings → Plan → Cancel subscription. Cancels at the end of the paid
// period (creem.js cancelSubscription): the plan stays active until then and
// is switched off by the subscription.canceled webhook when it ends.
async function handleCancel(request, env, store) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;
  const account = await store.getAccount(auth.userId);
  if (!account?.active || !account.creem_customer_id) {
    return json(409, { error: 'You don’t have an active plan to cancel.' });
  }
  if (account.cancel_at) return json(200, { cancelAt: account.cancel_at });

  let subscriptionId = account.subscription_id;
  if (!subscriptionId) {
    // Subscribed before subscription ids were stored: look it up once.
    const found = await findCustomerSubscription(env, account.creem_customer_id).catch(() => null);
    subscriptionId = found?.id || null;
  }
  if (!subscriptionId) {
    return json(404, { error: 'We couldn’t find your subscription. Contact support@appblips.com and we’ll cancel it for you.' });
  }

  const result = await cancelSubscription(env, subscriptionId).catch(() => null);
  if (!result?.ok) {
    return json(502, { error: 'Could not cancel your subscription. Please try again, or contact support@appblips.com.' });
  }
  const cancelAt = result.data?.current_period_end_date || null;
  await store.setSubscriptionId(account.creem_customer_id, subscriptionId);
  // Unknown end date: still mark it, so Settings shows it as cancelled.
  await store.setCancelAt(account.creem_customer_id, cancelAt || new Date().toISOString());
  return json(200, { cancelAt });
}

async function applyCheckoutCompleted(object, env, store) {
  const customerId = idOf(object.customer);
  const userId = object.metadata?.clerk_user_id || object.metadata?.clerkUserId;
  const productId = idOf(object.product) || object.product_id || object.subscription?.product;
  const planId = planForProductId(env, productId) || 'basic';
  if (!userId || !customerId) return;
  await store.saveAccount({ userId, customerId, plan: planId, active: true });
  // Kept so Settings can cancel it (Creem can't look it up by customer).
  await store.setSubscriptionId(customerId, idOf(object.subscription));
  await store.setCancelAt(customerId, null);
}

async function applySubscription(object, type, env, store) {
  const customerId = idOf(object.customer);
  if (!customerId) return;
  const productId = idOf(object.product) || object.product_id;
  const planId = planForProductId(env, productId);

  await store.setSubscriptionId(customerId, object.id);

  // subscription.canceled also fires when a scheduled cancel takes effect at
  // the end of the paid period, so access ends exactly then.
  const ended = ['subscription.canceled', 'subscription.expired', 'subscription.unpaid', 'subscription.paused'].includes(type);
  if (ended) {
    await store.setPlanByCustomer(customerId, 'basic', false);
    await store.setCancelAt(customerId, null);
    return;
  }
  // Cancelled for the end of the period: still active until then.
  if (type === 'subscription.scheduled_cancel' || object.status === 'scheduled_cancel') {
    await store.setCancelAt(customerId, object.current_period_end_date || new Date().toISOString());
    return;
  }
  if (['subscription.active', 'subscription.paid', 'subscription.trialing', 'subscription.update'].includes(type)) {
    await store.setPlanByCustomer(customerId, planId || 'basic', true);
    // Renewing (or resumed) again: no end date.
    if (object.status === 'active' || object.status === 'trialing') await store.setCancelAt(customerId, null);
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
  if (eventId && !(await store.claimEvent(eventId))) {
    return json(200, { received: true, duplicate: true });
  }

  const type = event?.eventType || event?.type || '';
  const object = event?.object || event?.data?.object || event?.data || {};
  if (type === 'checkout.completed') await applyCheckoutCompleted(object, env, store);
  else if (type.startsWith('subscription.')) await applySubscription(object, type, env, store);

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
  if (pathname === '/api/billing/cancel') {
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    return handleCancel(request, env, store);
  }
  return json(404, { error: 'Not found.' });
}
