// Stripe billing: Checkout to subscribe, the Customer Portal to manage or
// cancel, a webhook that mirrors each subscription into Supabase's
// `subscriptions` table, and a status endpoint for the usage meter. Fetch
// primitives only (no Stripe SDK), like every handler in functions/_lib.
//
// Stripe decides who pays; AppBlips counts usage itself (usage table) and the
// LLM proxy compares the two before each build (see chatProxy.js). Billing is
// on only in a multi-user instance with STRIPE_SECRET_KEY set -- without it
// nobody has limits, which keeps self-hosted and single-user installs as they
// were.
import { supabaseUrl, supabaseHeaders, supabaseServiceKey, supabaseConfigured } from './supabaseServer.js';
import { PLANS, PAID_PLAN_IDS, planById, planByLookupKey, checkAllowance, checkPrompts, allowanceLimits } from './plans.js';
// chatProxy.js imports this module too; the cycle is safe because neither
// side uses the other at load time.
import { authorize } from './chatProxy.js';

const STRIPE_API = 'https://api.stripe.com/v1';
const WEBHOOK_TOLERANCE_SECONDS = 300;

const stripeKey = (env) => String(env?.STRIPE_SECRET_KEY || '').trim();

export const billingEnabled = (env) => Boolean(supabaseConfigured(env) && supabaseServiceKey(env) && stripeKey(env));

// APPBLIPS_BILLING_TESTERS: comma-separated emails or account ids. When set,
// billing (limits, plans, checkout) applies only to those accounts and
// everyone else carries on as if billing were off -- so the live site can
// run sandbox keys for testing without anyone getting Plus with a test card.
const billingTesters = (env) => String(env?.APPBLIPS_BILLING_TESTERS || '')
  .split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);

export const billingAppliesTo = (env, user) => {
  if (!billingEnabled(env)) return false;
  const testers = billingTesters(env);
  if (!testers.length) return true;
  return testers.includes(String(user?.id || '').toLowerCase())
    || Boolean(user?.email && testers.includes(String(user.email).toLowerCase()));
};

// billingAppliesTo for an account known only by id (the deployed-app AI
// relay knows the app's owner, not their session). A tester list naming
// emails needs the owner's email, read with the service key.
export const billingAppliesToAccount = async (env, uid) => {
  if (!billingEnabled(env) || !uid) return false;
  const testers = billingTesters(env);
  if (!testers.length || testers.includes(String(uid).toLowerCase())) return true;
  if (!testers.some((entry) => entry.includes('@'))) return false;
  try {
    const res = await fetch(`${supabaseUrl(env)}/auth/v1/admin/users/${encodeURIComponent(uid)}`, {
      headers: supabaseHeaders(env, { service: true }),
    });
    if (!res.ok) return false;
    return billingAppliesTo(env, { id: uid, email: (await res.json())?.email });
  } catch {
    return false;
  }
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

// --- Supabase (service role) ---------------------------------------------

// The plan in effect and tokens used (public.billing_status). null when the
// read fails, so callers can decide how to degrade.
export const fetchBillingStatus = async (env, uid) => {
  try {
    const res = await fetch(`${supabaseUrl(env)}/rest/v1/rpc/billing_status`, {
      method: 'POST',
      headers: supabaseHeaders(env, { service: true }),
      body: JSON.stringify({ target_user_id: uid }),
    });
    if (!res.ok) {
      console.error('[billing] status read failed:', res.status, (await res.text().catch(() => '')).slice(0, 200));
      return null;
    }
    const rows = await res.json();
    return Array.isArray(rows) ? rows[0] || null : rows;
  } catch (err) {
    console.error('[billing] status read failed:', err?.message || err);
    return null;
  }
};

const todayUtc = () => new Date().toISOString().slice(0, 10);

const usageRpc = async (env, name, args) => {
  const res = await fetch(`${supabaseUrl(env)}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: supabaseHeaders(env, { service: true }),
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${name} failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
};

// Takes one of today's prompts (public.claim_prompt, atomic). true = claimed,
// false = the daily limit is reached, null = the read failed (callers let the
// request through, as with fetchBillingStatus).
export const claimPrompt = async (env, uid, limit) => {
  try {
    return (await usageRpc(env, 'claim_prompt', { target_user_id: uid, usage_date: todayUtc(), prompt_limit: limit })) === true;
  } catch (err) {
    console.error('[billing] prompt claim failed:', err?.message || err);
    return null;
  }
};

// Reserves `amount` tokens against the allowance before a request goes out
// (public.reserve_tokens: checks and adds in one locked step, so requests
// sent at the same moment can't all slip under the limit). Returns
// { reserved, today_tokens, period_tokens, date }, or null when the call
// failed. The reservation is settled to the real count by usageTracking.js.
export const reserveTokens = async (env, uid, { periodStart, limits, amount, kind }) => {
  const date = todayUtc();
  try {
    const rows = await usageRpc(env, 'reserve_tokens', {
      target_user_id: uid, usage_date: date, period_start: periodStart,
      daily_limit: limits.daily, period_limit: limits.period, amount, usage_kind: kind,
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    return row ? { ...row, date } : null;
  } catch (err) {
    console.error('[billing] token reservation failed:', err?.message || err);
    return null;
  }
};

// Checks `status` (from fetchBillingStatus) against the plan and holds
// `amount` tokens for a request of `kind` ('builder' | 'deployed'). Returns
// { refused: check } when the allowance is used up, otherwise { reservation }
// to hand to wrapWithTokenTracking -- null when the reservation call failed,
// which lets the request through like a failed status read does.
export const holdAllowance = async (env, uid, status, { continuing = false, input, amount, kind }) => {
  const check = checkAllowance(status, { continuing });
  if (!check.allowed) return { refused: check };
  const held = await reserveTokens(env, uid, {
    periodStart: status.period_start,
    limits: allowanceLimits(status.plan, { continuing }),
    amount,
    kind,
  });
  if (held && !held.reserved) {
    const over = checkAllowance({ ...status, ...held }, { continuing });
    if (!over.allowed) return { refused: over };
  }
  return { reservation: held?.reserved ? { date: held.date, tokens: amount, input } : null };
};

// Hands a prompt back when it never got going; best effort.
export const releasePrompt = async (env, uid) => {
  try {
    await usageRpc(env, 'release_prompt', { target_user_id: uid, usage_date: todayUtc() });
  } catch (err) {
    console.error('[billing] prompt release failed:', err?.message || err);
  }
};

const selectSubscriptions = async (env, filter) => {
  const res = await fetch(`${supabaseUrl(env)}/rest/v1/subscriptions?${filter}&select=user_id,plan,status,stripe_customer_id,stripe_subscription_id`, {
    headers: supabaseHeaders(env, { service: true }),
  });
  if (!res.ok) throw new Error(`subscriptions read failed: ${res.status}`);
  return res.json();
};

const subscriptionRow = async (env, uid) => (await selectSubscriptions(env, `user_id=eq.${encodeURIComponent(uid)}`))[0] || null;

const userIdForCustomer = async (env, customerId) =>
  (await selectSubscriptions(env, `stripe_customer_id=eq.${encodeURIComponent(customerId)}`))[0]?.user_id || null;

const upsertSubscription = async (env, fields) => {
  const res = await fetch(`${supabaseUrl(env)}/rest/v1/rpc/upsert_subscription`, {
    method: 'POST',
    headers: supabaseHeaders(env, { service: true }),
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error(`upsert_subscription failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
};

// --- Stripe REST ---------------------------------------------------------

// Stripe takes form-encoded bodies with bracketed keys for nesting
// (line_items[0][price]=...).
const formEncode = (params, prefix = '', out = new URLSearchParams()) => {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object') formEncode(value, name, out);
    else out.append(name, String(value));
  }
  return out;
};

const stripe = async (env, method, path, params) => {
  const init = { method, headers: { Authorization: `Bearer ${stripeKey(env)}` } };
  let url = `${STRIPE_API}${path}`;
  if (params && method === 'GET') url += `?${formEncode(params)}`;
  else if (params) {
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = formEncode(params);
  }
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Stripe ${method} ${path}: ${res.status} ${body?.error?.message || ''}`.trim());
  return body;
};

// Price ids looked up by lookup key, cached per isolate: the key stays the
// same when a price is replaced, and between sandbox and live mode.
const priceCache = new Map();
const priceIdFor = async (env, lookupKey) => {
  if (priceCache.has(lookupKey)) return priceCache.get(lookupKey);
  const list = await stripe(env, 'GET', '/prices', { lookup_keys: [lookupKey], active: 'true', limit: 1 });
  const id = list?.data?.[0]?.id;
  if (!id) throw new Error(`No active Stripe price with lookup key "${lookupKey}".`);
  priceCache.set(lookupKey, id);
  return id;
};

// Where Stripe sends the user back to. The site calls /api/* on its own
// origin, so the request's origin is the app; APPBLIPS_APP_URL overrides it.
const appUrl = (request, env) => {
  const configured = String(env?.APPBLIPS_APP_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
};

// --- Webhook signature ---------------------------------------------------

const encoder = new TextEncoder();
const toHex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

const equalStrings = (a, b) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

// Stripe-Signature: t=<unix seconds>,v1=<hex hmac>[,v1=...]. The signed
// payload is "<t>.<raw body>", HMAC-SHA256 with the endpoint's signing
// secret. Old timestamps are refused so a captured event can't be replayed.
export const verifyStripeSignature = async (payload, header, secret, now = Date.now()) => {
  if (!header || !secret) return false;
  let timestamp = null;
  const signatures = [];
  for (const part of header.split(',')) {
    const [key, value] = part.split('=');
    if (key === 't') timestamp = Number(value);
    else if (key === 'v1' && value) signatures.push(value);
  }
  if (!Number.isFinite(timestamp) || !signatures.length) return false;
  if (Math.abs(now / 1000 - timestamp) > WEBHOOK_TOLERANCE_SECONDS) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${payload}`)));
  return signatures.some((signature) => equalStrings(signature, expected));
};

// --- Subscription sync ---------------------------------------------------

const isoFromUnix = (seconds) => (Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null);

// Re-reads the subscription from Stripe and stores its current state. Events
// can arrive out of order or be retried, so the event's own copy is never
// trusted as the latest.
const syncSubscription = async (env, subscriptionId) => {
  const sub = await stripe(env, 'GET', `/subscriptions/${encodeURIComponent(subscriptionId)}`);
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  const uid = sub.metadata?.user_id || (customerId ? await userIdForCustomer(env, customerId) : null);
  if (!uid) {
    // Made outside AppBlips' Checkout (e.g. in the Stripe dashboard) for a
    // customer we've never seen: nothing to attach it to.
    console.warn(`[billing] subscription ${sub.id} has no AppBlips user; ignored.`);
    return;
  }
  const item = sub.items?.data?.[0];
  const plan = planByLookupKey(item?.price?.lookup_key);
  if (!plan) console.warn(`[billing] subscription ${sub.id} uses an unknown price (${item?.price?.lookup_key || item?.price?.id}); treated as free.`);
  // Newer Stripe API versions moved the period onto the subscription item.
  const periodStart = sub.current_period_start ?? item?.current_period_start;
  const periodEnd = sub.current_period_end ?? item?.current_period_end;
  await upsertSubscription(env, {
    target_user_id: uid,
    new_plan: plan?.id || 'free',
    new_status: sub.status,
    customer_id: customerId || null,
    subscription_id: sub.id,
    period_start: isoFromUnix(periodStart),
    period_end: isoFromUnix(periodEnd),
    cancels_at_period_end: Boolean(sub.cancel_at_period_end),
  });
};

// --- Handlers ------------------------------------------------------------

// GET /api/billing/status -> the signed-in user's plan and usage, or
// { enabled: false } when this instance doesn't bill.
export async function handleBillingStatus(request, env) {
  if (!billingEnabled(env)) return json({ enabled: false });
  const user = await authorize(request, env);
  if (!user) return json({ error: 'Sign in required.' }, 401);
  if (!billingAppliesTo(env, user)) return json({ enabled: false });
  const status = await fetchBillingStatus(env, user.id);
  if (!status) return json({ error: 'Billing is temporarily unavailable.' }, 503);
  const plan = planById(status.plan);
  const prompts = checkPrompts(status);
  const check = prompts.allowed ? checkAllowance(status) : prompts;
  return json({
    enabled: true,
    plan: plan.id,
    status: status.status,
    periodEnd: status.period_end,
    cancelAtPeriodEnd: Boolean(status.cancel_at_period_end),
    todayTokens: Number(status.today_tokens) || 0,
    periodTokens: Number(status.period_tokens) || 0,
    todayPrompts: Number(status.today_prompts) || 0,
    limits: { dailyPrompts: plan.dailyPrompts, dailyTokens: plan.dailyTokens, periodTokens: plan.periodTokens },
    blocked: check.allowed ? null : { scope: check.scope, resetsAt: check.resetsAt.toISOString() },
  });
}

// POST /api/billing/checkout { plan: 'plus' | 'pro' } -> { url } of a Stripe
// Checkout page. Someone who already subscribes gets the Customer Portal
// instead (where Stripe handles switching plans), so nobody pays twice.
export async function handleBillingCheckout(request, env) {
  if (!billingEnabled(env)) return json({ error: 'Billing is not enabled.' }, 404);
  const user = await authorize(request, env);
  if (!user) return json({ error: 'Sign in required.' }, 401);
  if (!billingAppliesTo(env, user)) return json({ error: 'Billing is not enabled.' }, 404);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body.' }, 400); }
  const planId = typeof body?.plan === 'string' ? body.plan : '';
  if (!PAID_PLAN_IDS.includes(planId)) return json({ error: 'Choose a paid plan.' }, 400);

  try {
    const base = appUrl(request, env);
    const row = await subscriptionRow(env, user.id);
    if (row?.stripe_customer_id && row.stripe_subscription_id && ['active', 'trialing', 'past_due'].includes(row.status)) {
      const portal = await stripe(env, 'POST', '/billing_portal/sessions', { customer: row.stripe_customer_id, return_url: `${base}/` });
      return json({ url: portal.url, portal: true });
    }
    const session = await stripe(env, 'POST', '/checkout/sessions', {
      mode: 'subscription',
      line_items: [{ price: await priceIdFor(env, PLANS[planId].lookupKey), quantity: 1 }],
      client_reference_id: user.id,
      // Carried on every subscription event, so the webhook always knows the
      // account without depending on event order.
      subscription_data: { metadata: { user_id: user.id } },
      metadata: { user_id: user.id },
      ...(row?.stripe_customer_id ? { customer: row.stripe_customer_id } : user.email ? { customer_email: user.email } : {}),
      allow_promotion_codes: 'true',
      success_url: `${base}/?billing=success`,
      cancel_url: `${base}/?billing=cancelled`,
    });
    return json({ url: session.url });
  } catch (err) {
    console.error('[billing] checkout failed:', err?.message || err);
    return json({ error: 'Could not start checkout. Please try again.' }, 502);
  }
}

// POST /api/billing/portal -> { url } of the Stripe Customer Portal, where the
// user changes plan, updates their card or cancels.
export async function handleBillingPortal(request, env) {
  if (!billingEnabled(env)) return json({ error: 'Billing is not enabled.' }, 404);
  const user = await authorize(request, env);
  if (!user) return json({ error: 'Sign in required.' }, 401);
  if (!billingAppliesTo(env, user)) return json({ error: 'Billing is not enabled.' }, 404);
  try {
    const row = await subscriptionRow(env, user.id);
    if (!row?.stripe_customer_id) return json({ error: 'There is no subscription to manage yet.' }, 400);
    const portal = await stripe(env, 'POST', '/billing_portal/sessions', { customer: row.stripe_customer_id, return_url: `${appUrl(request, env)}/` });
    return json({ url: portal.url });
  } catch (err) {
    console.error('[billing] portal failed:', err?.message || err);
    return json({ error: 'Could not open billing. Please try again.' }, 502);
  }
}

const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
]);

// POST /api/billing/webhook (called by Stripe). The signature is the only
// authentication, so nothing is read from the event until it checks out.
// Errors return 500 so Stripe retries; ignored event types return 200.
export async function handleStripeWebhook(request, env) {
  if (!billingEnabled(env)) return json({ error: 'Billing is not enabled.' }, 404);
  const secret = String(env?.STRIPE_WEBHOOK_SECRET || '').trim();
  if (!secret) {
    console.error('[billing] STRIPE_WEBHOOK_SECRET is not set; webhook refused.');
    return json({ error: 'Webhook not configured.' }, 500);
  }
  const payload = await request.text();
  if (!await verifyStripeSignature(payload, request.headers.get('stripe-signature'), secret)) {
    return json({ error: 'Invalid signature.' }, 400);
  }
  let event;
  try { event = JSON.parse(payload); } catch { return json({ error: 'Invalid JSON body.' }, 400); }

  try {
    const object = event?.data?.object || {};
    if (event.type === 'checkout.session.completed' && object.mode === 'subscription' && object.subscription) {
      await syncSubscription(env, typeof object.subscription === 'string' ? object.subscription : object.subscription.id);
    } else if (SUBSCRIPTION_EVENTS.has(event.type) && object.id) {
      await syncSubscription(env, object.id);
    }
    return json({ received: true });
  } catch (err) {
    console.error(`[billing] webhook ${event?.type} failed:`, err?.message || err);
    return json({ error: 'Webhook processing failed.' }, 500);
  }
}
