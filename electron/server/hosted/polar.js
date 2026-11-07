// Minimal Polar REST client for the hosted server: checkouts, cancelling a
// subscription at the end of its period, and webhook signature checks. Plain
// fetch, so it bundles like the other server handlers.
//
// Who paid is never worked out from an email address. Checkout is created
// here for a verified Clerk user, with that user's id as Polar's
// external_customer_id; Polar sends it back on every subscription event
// (customer.external_id), and only signed webhooks can change a plan.

import { createHmac, timingSafeEqual } from 'node:crypto';

// POLAR_SERVER=sandbox points everything at Polar's sandbox, which has its
// own token, products and webhook secret (set the same variable names).
const isSandbox = (env) => String(env?.POLAR_SERVER || 'production').toLowerCase() === 'sandbox';

export const polarBaseUrl = (env) => (isSandbox(env) ? 'https://sandbox-api.polar.sh/v1' : 'https://api.polar.sh/v1');

export const polarAccessToken = (env) => String(env?.POLAR_ACCESS_TOKEN || '').trim();
export const polarWebhookSecret = (env) => String(env?.POLAR_WEBHOOK_SECRET || '').trim();

export async function polarRequest(env, method, path, body) {
  const token = polarAccessToken(env);
  if (!token) throw new Error('POLAR_ACCESS_TOKEN is not set on this server.');
  const res = await fetch(`${polarBaseUrl(env)}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
  return { ok: res.ok, status: res.status, data, text };
}

export async function createCheckout(env, { productId, clerkUserId, successUrl }) {
  return polarRequest(env, 'POST', '/checkouts/', {
    products: [productId],
    success_url: successUrl,
    // The only link back to Clerk. Polar reuses the customer with this id,
    // or creates one carrying it, and every subscription event includes it.
    external_customer_id: clerkUserId,
    metadata: { clerk_user_id: clerkUserId },
  });
}

// Cancels at the end of the paid period: the person keeps the plan they paid
// for and isn't charged again. Polar sends subscription.canceled now (still
// active, cancel_at_period_end) and subscription.revoked when it ends.
export async function cancelSubscription(env, subscriptionId) {
  return polarRequest(env, 'PATCH', `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    cancel_at_period_end: true,
  });
}

export async function getSubscription(env, subscriptionId) {
  return polarRequest(env, 'GET', `/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

// The user's live subscription, looked up by their Clerk id, for when the
// webhook's copy of the id is missing.
export async function findUserSubscription(env, clerkUserId) {
  const query = new URLSearchParams({ external_customer_id: clerkUserId, active: 'true', limit: '10' });
  const res = await polarRequest(env, 'GET', `/subscriptions/?${query}`);
  if (!res.ok) return null;
  const items = Array.isArray(res.data?.items) ? res.data.items : [];
  return items.find((sub) => sub?.customer?.external_id === clerkUserId) || null;
}

// Webhook signatures (Standard Webhooks): HMAC-SHA256 over
// "<webhook-id>.<webhook-timestamp>.<body>", sent as "v1,<base64>" (several,
// space-separated, while a secret rotates). Secrets made since September 2026
// are "whsec_<base64 key>"; older ones use the UTF-8 bytes of the whole
// string as the key, so both are tried, as Polar's SDKs do.
const TOLERANCE_SECONDS = 5 * 60;

function signingKeys(secret) {
  const keys = [Buffer.from(secret, 'utf8')];
  if (secret.startsWith('whsec_')) {
    const decoded = Buffer.from(secret.slice(6), 'base64');
    if (decoded.length) keys.unshift(decoded);
  }
  return keys;
}

export function verifyPolarWebhook(rawBody, headers, secret, { now = Date.now() } = {}) {
  const id = headers?.id || '';
  const timestamp = headers?.timestamp || '';
  const signatures = String(headers?.signature || '').split(' ')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('v1,'))
    .map((part) => Buffer.from(part.slice(3), 'base64'));
  if (!id || !timestamp || !signatures.length || !secret) return false;

  // Replayed old deliveries are refused.
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(now / 1000 - seconds) > TOLERANCE_SECONDS) return false;

  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody));
  const signed = Buffer.concat([Buffer.from(`${id}.${timestamp}.`, 'utf8'), raw]);
  return signingKeys(String(secret)).some((key) => {
    const expected = createHmac('sha256', key).update(signed).digest();
    return signatures.some((candidate) => candidate.length === expected.length && timingSafeEqual(candidate, expected));
  });
}
