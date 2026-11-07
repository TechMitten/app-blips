// Hosted billing endpoints: plan status, Polar checkout, cancelling, and the
// Polar webhook that keeps each user's plan current.
//
// Polar's webhooks are the source of truth for subscriptions. The local
// store keeps each Clerk user's plan and their Polar customer and
// subscription ids. Every row is keyed by the Clerk user
// id, which only a verified Clerk token (requests) or a signed Polar webhook
// (external_customer_id, set by checkout below) can supply. Nothing is ever
// looked up by email.
//
// Deleting an account (DELETE /api/billing/account, Settings → Account) also
// lives here because it has to stop the Polar subscription first.

import { PLANS, isPlanId, isPlanOnSale, planForProductId, planProductId, publicCatalog } from './plans.js';
import { deleteClerkUser, verifiedRecently, verifyClerkToken } from './clerk.js';
import { windowUsage } from './buildWindow.js';
import {
  cancelSubscription, createCheckout, findUserSubscription, getSubscription, listUserSubscriptions,
  polarWebhookSecret, revokeSubscription, verifyPolarWebhook,
} from './polar.js';

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
    return { userId: claims.sub, claims };
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
    // The build cooldown so far (plans.js windowBuilds / windowHours):
    // { used, limit, windowHours, resetAt }, or null for plans without one.
    usage: plan.windowBuilds && plan.windowHours
      ? { ...windowUsage(account, { limit: plan.windowBuilds, windowMs: plan.windowHours * 60 * 60 * 1000 }), windowHours: plan.windowHours }
      : null,
    plans: publicCatalog(),
  });
}

async function handleCheckout(request, env, store) {
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
  // A second checkout for the plan someone already has would start a second
  // Polar subscription and charge them twice (the app only offers it when it
  // couldn't read the plan). Also while a cancelled plan runs out: it is
  // still paid for until then.
  const account = await store.getAccount(auth.userId);
  if (account?.active && planOf(account) === planId) {
    return json(409, { error: `You already have the ${PLANS[planId].name} plan.`, code: 'already_subscribed' });
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

// Settings → Account → Delete account. In order, stopping at the first
// failure so nobody is left paying for an account that's gone:
//  1. ask Clerk's reverification (the person proves who they are again) if
//     the session last did so over 10 minutes ago: the app's
//     useReverification shows Clerk's prompt on this exact 403 and retries;
//  2. end every live Polar subscription now (revoke, no further charges);
//  3. forget the user's row here;
//  4. delete the Clerk user when this server has CLERK_SECRET_KEY (the
//     Worker does). Otherwise `clerkDeleted: false` and the app deletes the
//     Clerk user itself.
const REVERIFY_MINUTES = 10;

async function handleDeleteAccount(request, env, store) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;
  if (!verifiedRecently(auth.claims, REVERIFY_MINUTES)) {
    // Clerk's reverificationError shape (@clerk/shared/authorization-errors).
    return json(403, {
      clerk_error: {
        type: 'forbidden',
        reason: 'reverification-error',
        metadata: { reverification: { level: 'first_factor', afterMinutes: REVERIFY_MINUTES } },
      },
    });
  }

  const account = await store.getAccount(auth.userId);
  const live = await listUserSubscriptions(env, auth.userId).catch(() => null);
  if (live === null) {
    return json(502, { error: 'Could not reach the payment service to stop your plan, so nothing was deleted. Please try again.' });
  }
  const ids = new Set(live.map((sub) => sub.id));
  if (account?.active && account.subscription_id) ids.add(account.subscription_id);
  for (const id of ids) {
    const result = await revokeSubscription(env, id).catch(() => null);
    // 404: already gone. Anything else leaves the account alone.
    if (!result?.ok && result?.status !== 404) {
      console.error('[billing] revoke failed:', result?.status, String(result?.text || '').slice(0, 300));
      return json(502, { error: 'Could not stop your plan, so nothing was deleted. Please try again, or contact support@appblips.com.' });
    }
  }

  await store.deleteAccount(auth.userId);
  try {
    const { deleted } = await deleteClerkUser(env, auth.userId);
    return json(200, { deleted: true, clerkDeleted: deleted });
  } catch (err) {
    console.error('[billing] Clerk delete failed:', err?.message || err);
    return json(502, { error: 'Your plan was stopped, but your sign-in could not be deleted. Please try again, or contact support@appblips.com.' });
  }
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
  // Nothing to switch off, and the user may have deleted their account
  // (which revokes, and so sends this): don't make a row for them.
  if (!active && !account) return true;
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
    return handleCheckout(request, env, store);
  }
  if (pathname === '/api/billing/account') {
    if (request.method !== 'DELETE') return json(405, { error: 'Method not allowed.' });
    return handleDeleteAccount(request, env, store);
  }
  if (pathname === '/api/billing/cancel') {
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    return handleCancel(request, env, store);
  }
  return json(404, { error: 'Not found.' });
}
