// Hosted billing endpoints: plan status, Polar checkout, cancelling, and the
// Polar webhook that keeps each user's plan current.
//
// Polar's webhooks are the source of truth for subscriptions. The local
// store keeps each Clerk user's plan and their Polar customer and
// subscription ids. Every row is keyed by the Clerk user
// id, which only a verified Clerk token (requests) or a signed Polar webhook
// (external_customer_id, set by checkout below) can supply. Nothing is ever
// looked up by email.

import { PLANS, isPlanId, isPlanOnSale, planForProductId, planProductId, publicCatalog } from './plans.js';
import { verifyClerkToken } from './clerk.js';
import { cancelSubscription, createCheckout, findUserSubscription, getSubscription, polarWebhookSecret, verifyPolarWebhook } from './polar.js';

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

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

  return json(200, {
    plan: planId,
    planName: plan.name,
    active: Boolean(account?.active),
    unlimited: plan.monthlyCredits == null,
    // Monthly build credits (Silver, Max) aren't sold yet, so none to report.
    credits: null,
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
  if (!result?.ok) {
    console.error('[billing] checkout failed:', result?.status, String(result?.text || '').slice(0, 300));
    return json(502, { error: 'Could not start checkout. Please try again.' });
  }

  const url = result.data?.url;
  if (!url) return json(502, { error: 'Checkout did not return a URL.' });
  return json(200, { url });
}

// Settings → Plan → Cancel subscription. Cancels at the end of the paid
// period (polar.js cancelSubscription): the plan stays active until then and
// is switched off by the subscription.revoked webhook when it ends.
async function handleCancel(request, env, store) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;
  const account = await store.getAccount(auth.userId);
  if (!account?.active) {
    return json(409, { error: 'You don’t have an active plan to cancel.' });
  }
  if (account.cancel_at) return json(200, { cancelAt: account.cancel_at });

  let subscriptionId = account.subscription_id;
  if (!subscriptionId) {
    const found = await findUserSubscription(env, auth.userId).catch(() => null);
    subscriptionId = found?.id || null;
  }
  if (!subscriptionId) {
    return json(404, { error: 'We couldn’t find your subscription. Contact support@appblips.com and we’ll cancel it for you.' });
  }

  const result = await cancelSubscription(env, subscriptionId).catch(() => null);
  if (!result?.ok) {
    return json(502, { error: 'Could not cancel your subscription. Please try again, or contact support@appblips.com.' });
  }
  const cancelAt = result.data?.ends_at || result.data?.current_period_end || null;
  await store.setSubscriptionId(auth.userId, subscriptionId);
  // Unknown end date: still mark it, so Settings shows it as cancelled.
  await store.setCancelAt(auth.userId, cancelAt || new Date().toISOString());
  return json(200, { cancelAt });
}

// Polar statuses that still give access. A subscription cancelled for the
// period end stays "active" (cancel_at_period_end) until it's revoked.
const LIVE_STATUSES = new Set(['active', 'trialing']);

// Returns false when the event couldn't be applied yet (Polar retries it).
async function applySubscription(eventSub, env, store) {
  if (!eventSub?.id) return true;
  // Deliveries can arrive late or out of order (retries), so the event only
  // says which subscription changed: its current state comes from Polar.
  const fresh = await getSubscription(env, eventSub.id).catch(() => null);
  if (!fresh?.ok || !fresh.data?.id) return false;
  const sub = fresh.data;

  // Set by our own checkout (createCheckout); a subscription made any other
  // way (for example by hand in Polar's dashboard) has no Clerk user to
  // attach to and is ignored.
  const userId = sub.customer?.external_id || null;
  if (!userId) return true;

  const active = LIVE_STATUSES.has(sub.status) && !sub.ended_at;
  const account = await store.getAccount(userId);
  // An older subscription ending must not switch off a newer one.
  if (!active && account?.active && account.subscription_id && account.subscription_id !== sub.id) return true;

  const planId = planForProductId(env, sub.product_id) || 'basic';
  await store.saveAccount({ userId, customerId: sub.customer_id || sub.customer?.id || null, plan: planId, active });
  await store.setSubscriptionId(userId, sub.id);
  const cancelAt = active && sub.cancel_at_period_end ? (sub.ends_at || sub.current_period_end || null) : null;
  await store.setCancelAt(userId, cancelAt);
  return true;
}

async function handleWebhook(request, env, store) {
  const secret = polarWebhookSecret(env);
  if (!secret) return json(503, { error: 'Webhooks are not configured.' });

  const raw = Buffer.from(await request.arrayBuffer());
  const headers = {
    id: request.headers.get('webhook-id'),
    timestamp: request.headers.get('webhook-timestamp'),
    signature: request.headers.get('webhook-signature'),
  };
  if (!verifyPolarWebhook(raw, headers, secret)) {
    return json(403, { error: 'Invalid webhook signature.' });
  }

  let event;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch {
    return json(400, { error: 'Invalid webhook body.' });
  }

  // Applying an event re-reads the subscription's current state, so a
  // repeated delivery is harmless; no idempotency record is needed.
  const type = String(event?.type || '');
  if (type.startsWith('subscription.') && !(await applySubscription(event.data, env, store))) {
    return json(503, { error: 'Could not read the subscription from Polar. Retry later.' });
  }

  return json(202, { received: true });
}

export async function handleBilling(request, env, store) {
  const { pathname } = new URL(request.url);
  if (pathname === '/api/webhooks/polar') {
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
