// Minimal Creem REST client for the hosted server: checkouts, the customer
// credit ledger (the source of truth for paid-tier balances), and webhook
// signature verification. Plain fetch, so it bundles like the other server
// handlers.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const creemBaseUrl = (env) => (String(env?.CREEM_SERVER || 'test').toLowerCase() === 'prod'
  ? 'https://api.creem.io/v1'
  : 'https://test-api.creem.io/v1');

// Test and production are isolated, including credentials, so each
// environment gets its own key/secret/product ids. CREEM_SERVER picks which.
const isTestServer = (env) => String(env?.CREEM_SERVER || 'test').toLowerCase() !== 'prod';

export const creemApiKey = (env) => String(
  (isTestServer(env) ? env?.CREEM_TEST_API_KEY : env?.CREEM_API_KEY) || '',
).trim();

export const creemWebhookSecret = (env) => String(
  (isTestServer(env) ? env?.CREEM_TEST_WEBHOOK_SECRET : env?.CREEM_WEBHOOK_SECRET) || '',
).trim();

export const creemConfigured = (env) => Boolean(creemApiKey(env));

export async function creemRequest(env, method, path, body) {
  const apiKey = creemApiKey(env);
  if (!apiKey) throw new Error(`CREEM_API_KEY is not set on this server for ${isTestServer(env) ? 'test' : 'production'} mode.`);
  const res = await fetch(`${creemBaseUrl(env)}${path}`, {
    method,
    headers: {
      'x-api-key': apiKey,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
  return { ok: res.ok, status: res.status, data, text };
}

export async function createCheckout(env, { productId, clerkUserId, email, successUrl }) {
  return creemRequest(env, 'POST', '/checkouts', {
    product_id: productId,
    success_url: successUrl,
    // The only link back to Clerk: checkout and the events that follow
    // carry this metadata, and the webhook stores the customer mapping.
    metadata: { clerk_user_id: clerkUserId },
    ...(email ? { customer: { email } } : {}),
  });
}

// The customer's default credit wallet (where plan credit grants land).
export async function findCreditAccount(env, customerId) {
  const res = await creemRequest(env, 'GET', `/customer-credits/accounts?customer_id=${encodeURIComponent(customerId)}`);
  if (!res.ok) return null;
  const accounts = Array.isArray(res.data?.data) ? res.data.data
    : Array.isArray(res.data?.items) ? res.data.items
      : Array.isArray(res.data) ? res.data : [];
  const usable = accounts.filter((account) => account && account.status !== 'closed');
  const wallet = usable.find((account) => account.name === 'default') || usable[0];
  return wallet ? { id: wallet.id, name: wallet.name, unitLabel: wallet.unitLabel } : null;
}

export async function getCreditBalance(env, accountId) {
  const res = await creemRequest(env, 'GET', `/customer-credits/accounts/${encodeURIComponent(accountId)}/balance`);
  if (!res.ok) return null;
  const raw = res.data?.balance ?? res.data?.data?.balance;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

// Deducts credits. `reference` is our own id (e.g. the build id) and
// `idempotencyKey` makes retries of the same build safe.
export async function debitCredits(env, accountId, { amount, reference, idempotencyKey }) {
  return creemRequest(env, 'POST', `/customer-credits/accounts/${encodeURIComponent(accountId)}/debit`, {
    amount: String(amount),
    reference,
    idempotency_key: idempotencyKey,
  });
}

export async function creditCredits(env, accountId, { amount, reference, idempotencyKey }) {
  return creemRequest(env, 'POST', `/customer-credits/accounts/${encodeURIComponent(accountId)}/credit`, {
    amount: String(amount),
    reference,
    idempotency_key: idempotencyKey,
  });
}

// Creem signs webhook bodies with HMAC-SHA256 in the `creem-signature`
// header. Accepts the raw hex digest, a `sha256=` prefix, or base64.
export function verifyCreemSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody));
  const expected = createHmac('sha256', String(secret)).update(raw).digest();
  const provided = String(signatureHeader).trim().replace(/^sha256=/i, '');

  const candidates = [];
  if (/^[0-9a-f]{64}$/i.test(provided)) candidates.push(Buffer.from(provided, 'hex'));
  try { candidates.push(Buffer.from(provided, 'base64')); } catch { /* not base64 */ }

  return candidates.some((candidate) => candidate.length === expected.length && timingSafeEqual(candidate, expected));
}
