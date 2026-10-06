// Stripe billing: Checkout to subscribe, the Customer Portal to manage or
// cancel, a webhook that mirrors each subscription into the Firestore
// `subscriptions` collection, and a status endpoint for the usage meter. Fetch
// primitives only (no Stripe SDK), like every handler in functions/_lib.
//
// Stripe decides who pays; AppBlips counts usage itself (usage collection) and the
// LLM proxy compares the two before each build (see chatProxy.js). Billing is
// on only in a multi-user instance with STRIPE_SECRET_KEY set -- without it
// nobody has limits, which keeps self-hosted and single-user installs as they
// were.
import { serviceAccountConfigured, getDoc, runQuery, runTransaction, setWrite } from './firebaseServer.js';
import { usageDocPath, emptyUsage, sumPeriodTokens, todayUtc } from './usageTracking.js';
import { PLANS, PAID_PLAN_IDS, TRIAL, planById, planByLookupKey, checkAllowance, allowanceLimits } from './plans.js';
// chatProxy.js imports this module too; the cycle is safe because neither
// side uses the other at load time.
import { authorize, maintenanceOn } from './chatProxy.js';

const STRIPE_API = 'https://api.stripe.com/v1';
const WEBHOOK_TOLERANCE_SECONDS = 300;

const stripeKey = (env) => String(env?.STRIPE_SECRET_KEY || '').trim();

export const billingEnabled = (env) => Boolean(serviceAccountConfigured(env) && stripeKey(env));

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

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

// --- Firestore (service account) -----------------------------------------
//
// usage/{uid}_{date} holds one account's counters for one UTC day;
// subscriptions/{uid} mirrors their Stripe subscription; trial_cards/{fp}
// records which subscription each card (by Stripe fingerprint) had its free
// trial on. Clients can't read or write any of them (firestore.rules);
// everything goes through here.

const ACTIVE_STATUSES = ['active', 'trialing', 'past_due'];

// The plan in effect and tokens used:
// { plan, status, trialing, trial_end, trial_eligible, period_start,
//   period_end, cancel_at_period_end, today_tokens, period_tokens }.
// plan is 'none' without a live subscription. null when the read fails, so
// callers can decide how to degrade.
export const fetchBillingStatus = async (env, uid) => {
  try {
    const today = todayUtc();
    const [subDoc, usageDoc] = await Promise.all([
      getDoc(env, `subscriptions/${uid}`),
      getDoc(env, usageDocPath(uid, today)),
    ]);
    const sub = subDoc?.data || null;
    // past_due keeps the plan while Stripe retries the card; anything else
    // (canceled, unpaid, incomplete) means no plan.
    const paid = Boolean(sub && ACTIVE_STATUSES.includes(sub.status) && PAID_PLAN_IDS.includes(sub.plan));
    const periodStart = paid && sub.current_period_start
      ? String(sub.current_period_start).slice(0, 10)
      : `${today.slice(0, 7)}-01`;
    const usage = { ...emptyUsage(), ...(usageDoc?.data || {}) };
    const todayTokens = usage.builder_tokens + usage.deployed_tokens;
    const earlier = await sumPeriodTokens(env, uid, periodStart, today);
    return {
      plan: paid ? sub.plan : 'none',
      status: sub?.status || 'none',
      trialing: paid && sub.status === 'trialing',
      trial_end: paid && sub.status === 'trialing' ? sub.trial_end || sub.current_period_end || null : null,
      trial_eligible: !sub?.trial_used,
      // The last Checkout's trial was refused as a repeat and the
      // subscription cancelled before any charge (syncSubscription).
      trial_refused: Boolean(!paid && sub?.trial_refused_subscription_id && sub.trial_refused_subscription_id === sub.stripe_subscription_id),
      period_start: periodStart,
      period_end: paid ? sub.current_period_end || null : null,
      cancel_at_period_end: Boolean(sub?.cancel_at_period_end),
      // A Stripe customer exists, so the Customer Portal (invoices, card)
      // opens even after the plan has ended.
      has_billing_account: Boolean(sub?.stripe_customer_id),
      today_tokens: todayTokens,
      period_tokens: earlier + todayTokens,
    };
  } catch (err) {
    console.error('[billing] status read failed:', err?.message || err);
    return null;
  }
};

// Runs `change(usage)` on today's usage doc in a transaction: it returns the
// fields to write (or null to write nothing) and the result. The doc read
// locks it until commit, so concurrent requests for one account serialize.
const withUsageDoc = (env, uid, date, change) => runTransaction(env, async (tx) => {
  const path = usageDocPath(uid, date);
  const doc = await getDoc(env, path, { transaction: tx });
  const current = { ...emptyUsage(), ...(doc?.data || {}), user_id: uid, date };
  const { fields, result } = await change(current);
  return {
    writes: fields ? [setWrite(env, path, { ...current, ...fields, updated_at: new Date() })] : [],
    result,
  };
});

// Reserves `amount` tokens against the allowance before a request goes out:
// checks and adds in one transaction on today's doc, so requests sent at the
// same moment can't all slip under the limit. Earlier days of the period are
// summed first, outside the transaction -- they no longer change, except for
// a reservation from yesterday settling, which is no worse than before.
// Returns { reserved, today_tokens, period_tokens, date }, or null when the
// call failed. The reservation is settled to the real count by usageTracking.js.
export const reserveTokens = async (env, uid, { periodStart, limits, amount, kind }) => {
  const date = todayUtc();
  if (kind !== 'builder') return null;
  try {
    const earlier = await sumPeriodTokens(env, uid, periodStart, date);
    const hold = Math.max(Number(amount) || 0, 0);
    const result = await withUsageDoc(env, uid, date, (usage) => {
      const todayUsed = usage.builder_tokens + usage.deployed_tokens;
      const periodUsed = earlier + todayUsed;
      if (periodUsed >= limits.period) {
        return { fields: null, result: { reserved: false, today_tokens: todayUsed, period_tokens: periodUsed } };
      }
      return {
        fields: { builder_tokens: usage.builder_tokens + hold },
        result: { reserved: true, today_tokens: todayUsed + hold, period_tokens: periodUsed + hold },
      };
    });
    return { ...result, date };
  } catch (err) {
    console.error('[billing] token reservation failed:', err?.message || err);
    return null;
  }
};

// Checks `status` (from fetchBillingStatus) against the plan and holds
// `amount` tokens for a request of `kind` ('builder'). Returns
// { refused: check } when the allowance is used up, otherwise { reservation }
// to hand to wrapWithTokenTracking -- null when the reservation call failed,
// which lets the request through like a failed status read does.
export const holdAllowance = async (env, uid, status, { continuing = false, input, amount, kind }) => {
  const check = checkAllowance(status, { continuing });
  if (!check.allowed) return { refused: check };
  const held = await reserveTokens(env, uid, {
    periodStart: status.period_start,
    limits: allowanceLimits(status.plan, { continuing, trialing: Boolean(status.trialing) }),
    amount,
    kind,
  });
  if (held && !held.reserved) {
    const over = checkAllowance({ ...status, ...held }, { continuing });
    if (!over.allowed) return { refused: over };
  }
  return { reservation: held?.reserved ? { date: held.date, tokens: amount, input } : null };
};

const subscriptionRow = async (env, uid) => (await getDoc(env, `subscriptions/${uid}`))?.data || null;

const userIdForCustomer = async (env, customerId) => {
  const [row] = await runQuery(env, 'subscriptions', { where: [['stripe_customer_id', '==', customerId]], limit: 1 });
  return row?.id || null;
};

// Stores a subscription's current state. Stripe can send events for an old,
// cancelled subscription after a new one is active (resubscribing,
// out-of-order retries), so the stored one is only replaced by the same
// subscription, by an active one, or when it isn't active anyway. The
// customer id is kept when Stripe sends none, and so is the record of the
// account's one free trial (trial_subscription_id), once it has had one.
const upsertSubscription = (env, fields) => runTransaction(env, async (tx) => {
  const path = `subscriptions/${fields.target_user_id}`;
  const current = (await getDoc(env, path, { transaction: tx }))?.data || null;
  const replace = !current
    || current.stripe_subscription_id === fields.subscription_id
    || ACTIVE_STATUSES.includes(fields.new_status)
    || !ACTIVE_STATUSES.includes(current.status);
  if (!replace) return { writes: [] };
  const trialSubscription = current?.trial_subscription_id || fields.trial_subscription_id || null;
  const trialRefused = fields.trial_refused_subscription_id || current?.trial_refused_subscription_id || null;
  return {
    writes: [setWrite(env, path, {
      user_id: fields.target_user_id,
      plan: fields.new_plan,
      status: fields.new_status,
      stripe_customer_id: fields.customer_id || current?.stripe_customer_id || null,
      stripe_subscription_id: fields.subscription_id,
      current_period_start: fields.period_start,
      current_period_end: fields.period_end,
      cancel_at_period_end: Boolean(fields.cancels_at_period_end),
      trial_end: fields.trial_end || null,
      trial_used: Boolean(current?.trial_used || trialSubscription || trialRefused),
      trial_subscription_id: trialSubscription,
      trial_refused_subscription_id: trialRefused,
      updated_at: new Date(),
    })],
  };
});

// The account's live Stripe subscription, cancelled immediately. Used when
// an account is deleted, so nobody keeps paying for an account that's gone.
export const cancelSubscriptionFor = async (env, uid) => {
  if (!stripeKey(env)) return;
  const row = await subscriptionRow(env, uid);
  if (!row?.stripe_subscription_id || !ACTIVE_STATUSES.includes(row.status)) return;
  try {
    await stripe(env, 'DELETE', `/subscriptions/${encodeURIComponent(row.stripe_subscription_id)}`);
  } catch (err) {
    console.warn(`[billing] could not cancel Stripe subscription for ${uid}:`, err?.message || err);
  }
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

// Whether `subscriptionId`'s trial is a repeat: this card (by fingerprint,
// which is the same for one card across Stripe customers) already had a
// trial on another subscription. Claims the card for this subscription when
// it hasn't. A payment method without a card fingerprint can't be checked;
// trial Checkout only offers cards (handleBillingCheckout).
const cardHadTrial = async (env, uid, subscriptionId, paymentMethod) => {
  const fingerprint = paymentMethod?.card?.fingerprint;
  if (!fingerprint) return false;
  return runTransaction(env, async (tx) => {
    const path = `trial_cards/${fingerprint}`;
    const doc = await getDoc(env, path, { transaction: tx });
    if (doc?.data) return { writes: [], result: doc.data.subscription_id !== subscriptionId };
    return {
      writes: [setWrite(env, path, { user_id: uid, subscription_id: subscriptionId, created_at: new Date() })],
      result: false,
    };
  });
};

// Ends a trial now, so Stripe charges for the plan straight away. Only on the
// user's own request ("Start Plus now"). Stripe sends a subscription event
// for the change, which syncs it.
const endTrialNow = (env, subscriptionId) => stripe(env, 'POST', `/subscriptions/${encodeURIComponent(subscriptionId)}`, { trial_end: 'now' });

// Cancels a refused trial while it's still trialing, so nothing is charged.
// Checkout told the user "You won't be charged today", so a repeat trial is
// never turned into a charge; the app explains and offers Plus without one.
const cancelRefusedTrial = (env, subscriptionId) => stripe(env, 'DELETE', `/subscriptions/${encodeURIComponent(subscriptionId)}`);

// Re-reads the subscription from Stripe and stores its current state. Events
// can arrive out of order or be retried, so the event's own copy is never
// trusted as the latest.
const syncSubscription = async (env, subscriptionId) => {
  const sub = await stripe(env, 'GET', `/subscriptions/${encodeURIComponent(subscriptionId)}`, { expand: ['default_payment_method'] });
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
  if (!plan) console.warn(`[billing] subscription ${sub.id} uses an unknown price (${item?.price?.lookup_key || item?.price?.id}); treated as no plan.`);
  // Newer Stripe API versions moved the period onto the subscription item.
  const periodStart = sub.current_period_start ?? item?.current_period_start;
  const periodEnd = sub.current_period_end ?? item?.current_period_end;

  // One free trial per account and per card. Checkout only offers a trial
  // to an account that hasn't had one, but two Checkouts opened side by side
  // or a second account with the same card would otherwise get another.
  const row = await subscriptionRow(env, uid);
  // Already refused: later events for it (the cancellation) stay refused.
  let repeatTrial = row?.trial_refused_subscription_id === sub.id;
  if (!repeatTrial && sub.status === 'trialing') {
    repeatTrial = Boolean(row?.trial_subscription_id && row.trial_subscription_id !== sub.id)
      || await cardHadTrial(env, uid, sub.id, typeof sub.default_payment_method === 'object' ? sub.default_payment_method : null);
  }
  const cancelNow = repeatTrial && sub.status === 'trialing';

  // A refused trial is stored as cancelled straight away, so it never grants
  // the plan, even for the moment before Stripe's cancellation event lands.
  await upsertSubscription(env, {
    target_user_id: uid,
    new_plan: repeatTrial ? 'none' : plan?.id || 'none',
    new_status: cancelNow ? 'canceled' : sub.status,
    customer_id: customerId || null,
    subscription_id: sub.id,
    period_start: isoFromUnix(periodStart),
    period_end: isoFromUnix(periodEnd),
    cancels_at_period_end: Boolean(sub.cancel_at_period_end),
    trial_end: sub.status === 'trialing' && !repeatTrial ? isoFromUnix(sub.trial_end) : null,
    trial_subscription_id: sub.trial_start && !repeatTrial ? sub.id : null,
    trial_refused_subscription_id: repeatTrial ? sub.id : null,
  });

  if (cancelNow) {
    console.warn(`[billing] subscription ${sub.id} is a repeat trial; cancelling it uncharged.`);
    await cancelRefusedTrial(env, sub.id);
  }
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
  const check = checkAllowance(status);
  return json({
    enabled: true,
    plan: plan.id,
    status: status.status,
    trialing: status.trialing,
    trialEnd: status.trial_end,
    trialEligible: status.trial_eligible,
    trialRefused: Boolean(status.trial_refused),
    hasBillingAccount: Boolean(status.has_billing_account),
    periodEnd: status.period_end,
    cancelAtPeriodEnd: Boolean(status.cancel_at_period_end),
    periodTokens: Number(status.period_tokens) || 0,
    limits: { periodTokens: allowanceLimits(plan, { trialing: status.trialing }).period },
    blocked: check.allowed ? null : { scope: check.scope, resetsAt: check.resetsAt ? check.resetsAt.toISOString() : null },
  });
}

// POST /api/billing/checkout { plan: 'plus' | 'pro' } -> { url } of a Stripe
// Checkout page. Someone who already subscribes gets the Customer Portal
// instead (where Stripe handles switching plans), so nobody pays twice.
// Plus starts with the free trial for an account that hasn't had one: the
// card is collected and checked now, and charged when the trial ends unless
// it's cancelled first.
export async function handleBillingCheckout(request, env) {
  if (!billingEnabled(env)) return json({ error: 'Billing is not enabled.' }, 404);
  // No new subscriptions while building is paused: nobody should pay for a
  // service they can't use. The webhook and Customer Portal keep working.
  if (maintenanceOn(env)) return json({ error: 'Upgrades are paused during maintenance.', code: 'maintenance' }, 503);
  const user = await authorize(request, env);
  if (!user) return json({ error: 'Sign in required.' }, 401);
  if (!billingAppliesTo(env, user)) return json({ error: 'Billing is not enabled.' }, 404);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body.' }, 400); }
  const planId = typeof body?.plan === 'string' ? body.plan : '';
  const requestTrial = Boolean(body?.requestTrial);
  if (!PAID_PLAN_IDS.includes(planId)) return json({ error: 'Choose a paid plan.' }, 400);

  try {
    const base = appUrl(request, env);
    const row = await subscriptionRow(env, user.id);
    if (row?.stripe_customer_id && row.stripe_subscription_id && ['active', 'trialing', 'past_due'].includes(row.status)) {
      const portal = await stripe(env, 'POST', '/billing_portal/sessions', { customer: row.stripe_customer_id, return_url: `${base}/` });
      return json({ url: portal.url, portal: true });
    }
    // Only offer the trial if the client requested it, it's the trial plan (Plus), and they haven't used it yet.
    // Older clients that don't send requestTrial will default to false, meaning they won't get a trial
    // unless they update, but since we are changing the default to not offer a trial unconditionally,
    // this correctly fixes the bug where paid plan buttons were triggering trials.
    const trial = requestTrial && planId === TRIAL.plan && !row?.trial_used;
    const session = await stripe(env, 'POST', '/checkout/sessions', {
      mode: 'subscription',
      line_items: [{ price: await priceIdFor(env, PLANS[planId].lookupKey), quantity: 1 }],
      client_reference_id: user.id,
      // Carried on every subscription event, so the webhook always knows the
      // account without depending on event order.
      subscription_data: {
        metadata: { user_id: user.id },
        ...(trial ? {
          trial_period_days: TRIAL.days,
          // Belt and braces: Checkout always collects a card here, but a
          // trial that somehow has none ends instead of running on unpaid.
          trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
        } : {}),
      },
      ...(trial ? {
        payment_method_collection: 'always',
        // Cards only, so every trial has a card fingerprint to check for
        // repeat trials (cardHadTrial).
        payment_method_types: ['card'],
        custom_text: {
          submit: {
            message: `You won't be charged today. After your ${TRIAL.days}-day free trial, Plus is $${PLANS[planId].price}/month until you cancel. Cancel before the trial ends and you won't be charged.`,
          },
        },
      } : {}),
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

// POST /api/billing/end-trial -> ends the caller's free trial now, so Plus
// (and its full allowance) starts straight away and is charged today.
export async function handleBillingEndTrial(request, env) {
  if (!billingEnabled(env)) return json({ error: 'Billing is not enabled.' }, 404);
  if (maintenanceOn(env)) return json({ error: 'Billing changes are paused during maintenance.', code: 'maintenance' }, 503);
  const user = await authorize(request, env);
  if (!user) return json({ error: 'Sign in required.' }, 401);
  if (!billingAppliesTo(env, user)) return json({ error: 'Billing is not enabled.' }, 404);
  try {
    const row = await subscriptionRow(env, user.id);
    if (!row?.stripe_subscription_id || row.status !== 'trialing') return json({ error: 'There is no trial to end.' }, 400);
    await endTrialNow(env, row.stripe_subscription_id);
    // Store the result now rather than waiting for the webhook, so the
    // status the client reloads next already shows it.
    await syncSubscription(env, row.stripe_subscription_id);
    return json({ ok: true });
  } catch (err) {
    console.error('[billing] ending trial failed:', err?.message || err);
    return json({ error: 'Could not start Plus. Please try again.' }, 502);
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
