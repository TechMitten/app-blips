// /api/credits/*: AppBlips AI Credits (Polar.sh meter credits + DeepSeek).
// Written with only Fetch and Web Crypto primitives, like chatProxy.js,
// surgeApi.js and pollinationsApi.js, so the exact same handler runs in
// Electron (electron/main.js), server.js, the Vite dev server and Android.
//
// Two operating modes:
// 1. Direct mode (when POLAR_TOKEN is present in `env`, e.g. local .env or
//    self-hosted server): talks directly to api.polar.sh and api.deepseek.com.
// 2. Cloud relay mode (packaged desktop app with no local POLAR_TOKEN):
//    forwards requests to https://appblips.com/api/credits/* using the token
//    stored in `tokens` (OS keychain on desktop, keyFile.js in browser mode).
//
//   GET    /api/credits          -> { signedIn, email, remaining, totalGranted, totalUsed, packs }
//   DELETE /api/credits          -> sign out (forget the saved credit token)
//   POST   /api/credits/connect  -> { email } -> { codeSent, email } (a sign-in code is emailed)
//   POST   /api/credits/verify   -> { email, code } -> { signedIn, email, remaining, totalGranted, totalUsed }
//   POST   /api/credits/checkout -> { packId, email? } -> { checkoutUrl, pack }

import { isForeignOrigin } from './chatProxy.js';
import { applyProviderSettings, DEFAULT_BUILD_MAX_TOKENS } from './providers.js';

export const POLAR_API_BASE = 'https://api.polar.sh/v1';
export const DEEPSEEK_API_BASE = 'https://api.deepseek.com';
export const DEFAULT_CREDITS_ORIGIN = 'https://appblips.com';
export const POLAR_METER_ID = '4a375eb5-d47f-4160-89d9-c3b19be1e13e';
export const DEFAULT_CREDITS_MODEL = 'deepseek-v4-pro';

// A $10/month subscription with a 3-day trial period, so checkout takes a card
// and nothing is charged until the trial ends. Customers who don't cancel are
// billed monthly; each paid month adds SUBSCRIPTION_MONTHLY_CREDITS (counted
// from Polar orders in lookupPolarBalance).
export const TRIAL_PRODUCT_ID = '785150d6-39ca-45da-8cf2-f60aebcb8ee9';
export const TRIAL_BENEFIT_ID = '3ceded01-ad19-4ec0-a544-f97d7f66572f';
export const TRIAL_CREDITS = 100;
export const TRIAL_DURATION_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
export const SUBSCRIPTION_MONTHLY_CREDITS = 1000;

export const FREE_TRIAL_PACK = {
  id: 'trial',
  name: '3-Day Free Trial — 100 AI Credits',
  shortName: '3-Day Free Trial',
  priceUsd: 0,
  credits: TRIAL_CREDITS,
  bonusCredits: 0,
  badge: 'Free · 3 Days',
  isTrial: true,
  trialDays: 3,
  productId: TRIAL_PRODUCT_ID,
  benefitId: TRIAL_BENEFIT_ID,
  description: '100 free AI Credits valid for 3 days—enough to build and edit your first 1–2 apps or websites. Then $10/month for 1,000 AI Credits a month. Cancel before the 3 days are up and you are never charged.',
};

export const CREDIT_PACKS = [
  {
    id: 'starter',
    name: 'Starter Pack — 1,000 AI Credits',
    shortName: 'Starter Pack',
    priceUsd: 10,
    credits: 1000,
    bonusCredits: 0,
    productId: '9fe7f339-3526-4673-b009-e8a5caacf831',
    benefitId: '5b523124-e43c-4917-88cb-6d64625b829c',
    description: 'Great for building 3–5 complete websites, games, or apps. Credits never expire.',
  },
  {
    id: 'builder',
    name: 'Builder Pack — 2,750 AI Credits',
    shortName: 'Builder Pack',
    priceUsd: 25,
    credits: 2750,
    bonusCredits: 250,
    badge: 'Most Popular',
    productId: '90eb1d08-01bb-44a8-abb1-96c5cf7a4c10',
    benefitId: 'cd0ea202-c732-448e-9311-cefc1b16c2a7',
    description: 'Includes 250 bonus credits (10% extra). Enough for 10–15 full apps or websites.',
  },
  {
    id: 'studio',
    name: 'Studio Pack — 6,000 AI Credits',
    shortName: 'Studio Pack',
    priceUsd: 50,
    credits: 6000,
    bonusCredits: 1000,
    badge: 'Best Value',
    productId: '35305dc4-7378-44c7-a4bd-c0f43e475f06',
    benefitId: '3de567a6-9234-4c39-8161-15b4d438a30d',
    description: 'Includes 1,000 bonus credits (20% extra). Built for power users and agencies.',
  },
];

const BENEFIT_UNITS = {
  [TRIAL_BENEFIT_ID]: TRIAL_CREDITS,
  '5b523124-e43c-4917-88cb-6d64625b829c': 1000,
  'cd0ea202-c732-448e-9311-cefc1b16c2a7': 2750,
  '3de567a6-9234-4c39-8161-15b4d438a30d': 6000,
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

const savedToken = (tokens) => {
  if (!tokens) return { email: '', token: '' };
  const { id, hasKey } = tokens.describe();
  return { email: id || '', token: hasKey ? tokens.keyFor(id) : '' };
};

export const hasSavedCredits = (tokens) => Boolean(tokens && tokens.describe().hasKey);

const toBase64Url = (bytes) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (str) => {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

async function hmacSign(secret, data) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(`appblips-credits:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return toBase64Url(new Uint8Array(sig));
}

export async function createCreditToken(secret, customerId, email) {
  const payload = {
    customerId,
    email: String(email || '').trim().toLowerCase(),
    iat: Math.floor(Date.now() / 1000),
  };
  const encoded = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacSign(secret, encoded);
  return `ab_cred_${encoded}.${sig}`;
}

export async function verifyCreditToken(secret, token) {
  if (typeof token !== 'string' || !token.startsWith('ab_cred_')) return null;
  const rest = token.slice('ab_cred_'.length);
  const dot = rest.indexOf('.');
  if (dot <= 0) return null;
  const encoded = rest.slice(0, dot);
  const sig = rest.slice(dot + 1);
  const expected = await hmacSign(secret, encoded);
  if (sig !== expected) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded)));
    if (typeof parsed?.customerId === 'string' && typeof parsed?.email === 'string') return parsed;
  } catch { /* invalid payload */ }
  return null;
}

export function calculateCreditsFromUsage(usage) {
  if (!usage) return 1;
  const promptTokens = Number(usage.prompt_tokens) || 0;
  const completionTokens = Number(usage.completion_tokens) || 0;
  const weighted = promptTokens + completionTokens * 3;
  if (weighted <= 0) return 1;
  return Math.max(1, Math.ceil(weighted / 4000));
}

// Credits from the monthly plan: SUBSCRIPTION_MONTHLY_CREDITS per paid order of
// the trial subscription. The $0 order that starts the trial doesn't count, and
// paid months stay after a cancel, like packs. Needs a Polar token with
// orders:read; without it this counts none, so pack balances keep working.
async function paidSubscriptionCredits(customerId, headers, fetchImpl) {
  let paidMonths = 0;
  try {
    for (let page = 1; page <= 10; page += 1) {
      const url = new URL(`${POLAR_API_BASE}/orders/`);
      url.searchParams.set('customer_id', customerId);
      url.searchParams.set('product_id', TRIAL_PRODUCT_ID);
      url.searchParams.set('limit', '100');
      url.searchParams.set('page', String(page));
      const res = await fetchImpl(url.toString(), { headers, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      for (const order of Array.isArray(data?.items) ? data.items : []) {
        if (order.status === 'paid' && (order.total_amount || 0) > 0) paidMonths += 1;
      }
      if (page >= (data?.pagination?.max_page ?? 1)) break;
    }
  } catch (err) {
    console.warn('[credits] could not read subscription orders (does POLAR_TOKEN have orders:read?):', err);
  }
  return paidMonths * SUBSCRIPTION_MONTHLY_CREDITS;
}

export async function lookupPolarBalance(polarToken, { email = '', customerId = '' }, fetchImpl = globalThis.fetch) {
  const targetEmail = String(email || '').trim().toLowerCase();
  const targetCustomerId = String(customerId || '').trim();
  const headers = { Authorization: `Bearer ${polarToken}`, Accept: 'application/json' };

  const grantsUrl = new URL(`${POLAR_API_BASE}/benefit-grants`);
  grantsUrl.searchParams.set('limit', '100');
  if (targetCustomerId) grantsUrl.searchParams.set('customer_id', targetCustomerId);

  const grantsRes = await fetchImpl(grantsUrl.toString(), { headers, signal: AbortSignal.timeout(15_000) });
  if (!grantsRes.ok) {
    throw new Error(`Could not check Polar credit grants (HTTP ${grantsRes.status}).`);
  }
  const grantsData = await grantsRes.json();
  const items = Array.isArray(grantsData?.items) ? grantsData.items : [];

  let matchedCustomerId = targetCustomerId;
  let matchedEmail = targetEmail;
  let paidGranted = 0;
  let activeTrialGranted = 0;
  let hasTrial = false;
  let trialActive = false;
  let trialExpired = false;
  let trialExpiresAt = null;
  const nowMs = Date.now();

  for (const grant of items) {
    const grantEmail = String(grant.customer?.email || '').trim().toLowerCase();
    const matches = (targetCustomerId && grant.customer_id === targetCustomerId)
      || (targetEmail && grantEmail === targetEmail);
    if (!matches) continue;
    // Polar revokes the trial grant when the cancelled trial subscription
    // ends. That still means the trial was used, so it blocks a second one.
    if (grant.is_revoked) {
      if (grant.benefit_id === TRIAL_BENEFIT_ID) {
        matchedCustomerId = matchedCustomerId || grant.customer_id;
        matchedEmail = matchedEmail || grantEmail;
        hasTrial = true;
        trialExpired = true;
      }
      continue;
    }
    matchedCustomerId = matchedCustomerId || grant.customer_id;
    matchedEmail = matchedEmail || grantEmail;
    const units = typeof grant.properties?.units === 'number'
      ? grant.properties.units
      : BENEFIT_UNITS[grant.benefit_id] || 0;

    if (grant.benefit_id === TRIAL_BENEFIT_ID) {
      hasTrial = true;
      const tsStr = grant.granted_at || grant.created_at || '';
      const grantedMs = tsStr ? Date.parse(tsStr) : nowMs;
      const expiresMs = (Number.isFinite(grantedMs) ? grantedMs : nowMs) + TRIAL_DURATION_MS;
      trialExpiresAt = new Date(expiresMs).toISOString();
      if (nowMs <= expiresMs) {
        trialActive = true;
        if (units > 0) activeTrialGranted = Math.max(activeTrialGranted, units);
      } else {
        trialExpired = true;
      }
    } else if (units > 0) {
      paidGranted += units;
    }
  }

  const totalGranted = paidGranted + activeTrialGranted
    + (matchedCustomerId ? await paidSubscriptionCredits(matchedCustomerId, headers, fetchImpl) : 0);

  if (!matchedCustomerId || (totalGranted <= 0 && !hasTrial)) {
    return {
      found: false,
      customerId: matchedCustomerId || '',
      email: matchedEmail || targetEmail,
      totalGranted: 0,
      totalUsed: 0,
      remaining: 0,
      hasTrial: false,
      trialActive: false,
      trialExpired: false,
      trialExpiresAt: null,
    };
  }

  const quantitiesUrl = new URL(`${POLAR_API_BASE}/meters/${POLAR_METER_ID}/quantities`);
  quantitiesUrl.searchParams.set('customer_id', matchedCustomerId);
  quantitiesUrl.searchParams.set('start_timestamp', '2025-01-01T00:00:00Z');
  quantitiesUrl.searchParams.set('end_timestamp', '2030-01-01T00:00:00Z');
  quantitiesUrl.searchParams.set('interval', 'year');

  let totalUsed = 0;
  try {
    const qRes = await fetchImpl(quantitiesUrl.toString(), { headers, signal: AbortSignal.timeout(15_000) });
    if (qRes.ok) {
      const qData = await qRes.json();
      if (typeof qData?.total === 'number' && qData.total > 0) totalUsed = Math.round(qData.total);
    }
  } catch { /* ignore transient meter read error */ }

  return {
    found: true,
    customerId: matchedCustomerId,
    email: matchedEmail,
    totalGranted,
    totalUsed,
    remaining: Math.max(0, totalGranted - totalUsed),
    hasTrial,
    trialActive,
    trialExpired: trialExpired && !trialActive,
    trialExpiresAt,
  };
}

export async function recordPolarUsage(polarToken, customerId, credits, model, usage, fetchImpl = globalThis.fetch) {
  if (!polarToken || !customerId || credits <= 0) return;
  try {
    await fetchImpl(`${POLAR_API_BASE}/events/ingest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${polarToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        events: [{
          name: 'ai_usage',
          customer_id: customerId,
          metadata: {
            credits,
            model,
            prompt_tokens: Number(usage?.prompt_tokens) || 0,
            completion_tokens: Number(usage?.completion_tokens) || 0,
          },
        }],
      }),
    });
  } catch (err) {
    console.warn('[credits] could not record usage event in Polar:', err);
  }
}

// Proving the email is the customer's: Polar emails a one-time code (its
// customer-portal sign-in, which also handles expiry and single use), and
// only someone who can read that inbox gets a credit token. An email alone
// used to be enough, so anyone who knew a customer's address could spend
// their credits. These endpoints are the ones Polar's own portal uses.
let cachedOrganizationId = '';
async function polarOrganizationId(polarToken, env, fetchImpl) {
  const fromEnv = String(env?.POLAR_ORGANIZATION_ID || '').trim();
  if (fromEnv) return fromEnv;
  if (cachedOrganizationId) return cachedOrganizationId;
  const res = await fetchImpl(`${POLAR_API_BASE}/products/${TRIAL_PRODUCT_ID}`, {
    headers: { Authorization: `Bearer ${polarToken}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  const data = res.ok ? await res.json().catch(() => null) : null;
  if (!data?.organization_id) throw new Error(`Could not look up the Polar organization (HTTP ${res.status}).`);
  cachedOrganizationId = data.organization_id;
  return cachedOrganizationId;
}

export async function requestPolarSignInCode(organizationId, email, customerId, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(`${POLAR_API_BASE}/customer-portal/customer-session/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, organization_id: organizationId, ...(customerId ? { customer_id: customerId } : {}) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Could not send the sign-in code (HTTP ${res.status}). Try again in a moment.`);
}

// Returns the customer the code was sent to, or null for a wrong, used or
// expired code.
export async function verifyPolarSignInCode(code, fetchImpl = globalThis.fetch) {
  const authRes = await fetchImpl(`${POLAR_API_BASE}/customer-portal/customer-session/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ code }),
    signal: AbortSignal.timeout(15_000),
  });
  if (authRes.status === 401 || authRes.status === 422) return null;
  const auth = authRes.ok ? await authRes.json().catch(() => null) : null;
  if (!auth?.token) throw new Error(`Could not check the sign-in code (HTTP ${authRes.status}). Try again in a moment.`);
  const userRes = await fetchImpl(`${POLAR_API_BASE}/customer-portal/customer-session/user`, {
    headers: { Authorization: `Bearer ${auth.token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  const user = userRes.ok ? await userRes.json().catch(() => null) : null;
  if (!user?.customer_id) throw new Error(`Could not read your Polar account (HTTP ${userRes.status}). Try again in a moment.`);
  return { customerId: user.customer_id, email: String(user.email || '').trim().toLowerCase() };
}

// Codes are letters and digits; people paste them with spaces or in lower case.
const cleanCode = (code) => String(code || '').replace(/[\s-]/g, '').toUpperCase().slice(0, 32);

const signedInBody = (email, balance) => ({
  signedIn: true,
  email,
  remaining: balance.remaining,
  totalGranted: balance.totalGranted,
  totalUsed: balance.totalUsed,
  hasTrial: Boolean(balance.hasTrial),
  trialActive: Boolean(balance.trialActive),
  trialExpired: Boolean(balance.trialExpired),
  trialExpiresAt: balance.trialExpiresAt || null,
  packs: CREDIT_PACKS,
});

const creditsOrigin = (env) => String(env?.APPBLIPS_CREDITS_ORIGIN || DEFAULT_CREDITS_ORIGIN).trim().replace(/\/+$/, '');

export async function handleCreditsApi(request, env, tokens, { fetch: fetchImpl = globalThis.fetch } = {}) {
  if (isForeignOrigin(request, env)) return json({ error: 'Not allowed.' }, 403);
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  const polarToken = String(env?.POLAR_TOKEN || '').trim();
  const origin = creditsOrigin(env);

  if (path === '/api/credits') {
    if (request.method === 'DELETE') {
      await tokens.clear();
      return json({ signedIn: false, email: '', packs: CREDIT_PACKS });
    }
    if (request.method === 'GET') {
      const { email, token } = savedToken(tokens);
      if (!token) return json({ signedIn: false, email: '', packs: CREDIT_PACKS });

      try {
        if (polarToken) {
          const verified = await verifyCreditToken(polarToken, token);
          const balance = await lookupPolarBalance(
            polarToken,
            verified ? { customerId: verified.customerId, email: verified.email } : { email },
            fetchImpl,
          );
          if (!balance.found) {
            return json({ signedIn: true, email, remaining: 0, totalGranted: 0, totalUsed: 0, packs: CREDIT_PACKS });
          }
          return json({
            signedIn: true,
            email: balance.email || email,
            remaining: balance.remaining,
            totalGranted: balance.totalGranted,
            totalUsed: balance.totalUsed,
            hasTrial: balance.hasTrial,
            trialActive: balance.trialActive,
            trialExpired: balance.trialExpired,
            trialExpiresAt: balance.trialExpiresAt,
            packs: CREDIT_PACKS,
          });
        }

        // Cloud relay lookup
        const res = await fetchImpl(`${origin}/api/credits/balance`, {
          headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
          signal: AbortSignal.timeout(15_000),
        });
        if (res.status === 401) {
          await tokens.clear();
          return json({ signedIn: false, email: '', expired: true, packs: CREDIT_PACKS });
        }
        const data = await res.json().catch(() => null);
        return json({
          signedIn: true,
          email: data?.email || email,
          remaining: typeof data?.remaining === 'number' ? data.remaining : null,
          totalGranted: typeof data?.totalGranted === 'number' ? data.totalGranted : null,
          totalUsed: typeof data?.totalUsed === 'number' ? data.totalUsed : null,
          hasTrial: Boolean(data?.hasTrial),
          trialActive: Boolean(data?.trialActive),
          trialExpired: Boolean(data?.trialExpired),
          trialExpiresAt: data?.trialExpiresAt || null,
          packs: CREDIT_PACKS,
        });
      } catch {
        return json({ signedIn: true, email, remaining: null, packs: CREDIT_PACKS });
      }
    }
    return json({ error: 'Method not allowed.' }, 405);
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  let body = null;
  try { body = await request.json(); } catch { body = null; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid request.' }, 400);

  if (path === '/api/credits/connect') {
    const email = String(body.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return json({ error: 'Enter the email address you used at checkout.' }, 400);
    }

    try {
      if (polarToken) {
        const balance = await lookupPolarBalance(polarToken, { email }, fetchImpl);
        if (!balance.found) {
          return json({
            error: `No AppBlips AI Credits were found for ${email}. Make sure you entered the same email used at checkout, or choose a credit pack below.`,
            notFound: true,
          }, 404);
        }
        const organizationId = await polarOrganizationId(polarToken, env, fetchImpl);
        await requestPolarSignInCode(organizationId, balance.email || email, balance.customerId, fetchImpl);
        return json({ codeSent: true, email: balance.email || email });
      }

      const res = await fetchImpl(`${origin}/api/credits/connect`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ email }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.codeSent) return json({ codeSent: true, email: data.email || email });
      // A credits server that predates sign-in codes still answers with a
      // token straight away; accept it so connecting keeps working until
      // that server is updated.
      if (res.ok && data?.ok && data?.token) {
        await tokens.save(data.email || email, data.token);
        return json(signedInBody(data.email || email, data));
      }
      return json({
        error: data?.error || `No AppBlips AI Credits were found for ${email}.`,
        notFound: res.status === 404,
      }, res.status === 404 ? 404 : 400);
    } catch (err) {
      return json({ error: err?.message || 'Could not verify your credits right now. Try again in a moment.' }, 502);
    }
  }

  if (path === '/api/credits/verify') {
    const email = String(body.email || '').trim().toLowerCase();
    const code = cleanCode(body.code);
    if (!code) return json({ error: 'Enter the code from the email.' }, 400);
    const wrongCode = () => json({ error: 'That code is wrong or has expired. Check the email, or send a new code.', invalidCode: true }, 401);

    try {
      if (polarToken) {
        const customer = await verifyPolarSignInCode(code, fetchImpl);
        if (!customer) return wrongCode();
        // The token is for whoever the code was sent to, even if a different
        // email was typed: holding the code is what proves the account.
        const balance = await lookupPolarBalance(polarToken, { customerId: customer.customerId }, fetchImpl);
        const signedEmail = customer.email || balance.email || email;
        const token = await createCreditToken(polarToken, customer.customerId, signedEmail);
        await tokens.save(signedEmail, token);
        return json(signedInBody(signedEmail, balance));
      }

      const res = await fetchImpl(`${origin}/api/credits/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ email, code }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 401) return wrongCode();
      if (!res.ok || !data?.ok || !data?.token) {
        return json({ error: data?.error || 'Could not check the code right now. Try again in a moment.' }, 502);
      }
      await tokens.save(data.email || email, data.token);
      return json(signedInBody(data.email || email, data));
    } catch (err) {
      return json({ error: err?.message || 'Could not check the code right now. Try again in a moment.' }, 502);
    }
  }

  if (path === '/api/credits/checkout') {
    const pack = body.packId === 'trial'
      ? FREE_TRIAL_PACK
      : (CREDIT_PACKS.find((p) => p.id === body.packId) || CREDIT_PACKS[0]);
    const email = String(body.email || '').trim();

    try {
      if (polarToken) {
        if (pack.id === 'trial' && email && email.includes('@')) {
          try {
            const existing = await lookupPolarBalance(polarToken, { email }, fetchImpl);
            if (existing.hasTrial) {
              return json({
                error: existing.trialActive
                  ? `Your 3-day free trial is already active for ${email} (${existing.remaining} credits remaining). Click Connect Credits to use it.`
                  : `The 3-day free trial has already been used for ${email}. Pick a credit pack to continue building.`,
              }, 400);
            }
          } catch { /* proceed if balance check fails */ }
        }

        const envCheckoutUrl = pack.id === 'trial'
          ? ''
          : pack.id === 'starter'
            ? env.POLAR_CHECKOUT_URL_STARTER
            : pack.id === 'builder'
              ? env.POLAR_CHECKOUT_URL_BUILDER
              : env.POLAR_CHECKOUT_URL_STUDIO;
        if (envCheckoutUrl) {
          const target = new URL(envCheckoutUrl);
          if (email && email.includes('@')) target.searchParams.set('customer_email', email);
          return json({ ok: true, checkoutUrl: target.toString(), pack });
        }

        const polarRes = await fetchImpl(`${POLAR_API_BASE}/checkouts/`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${polarToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            products: [pack.productId],
            success_url: `${DEFAULT_CREDITS_ORIGIN}/?credits_purchased=${pack.id}#pricing`,
            ...(email && email.includes('@') ? { customer_email: email } : {}),
          }),
          signal: AbortSignal.timeout(15_000),
        });

        if (!polarRes.ok) {
          if (polarRes.status === 403) {
            return json({
              error: 'To open Polar checkout directly, enable the "checkouts:write" permission on your Polar token in Polar Settings → Developers.',
            }, 502);
          }
          return json({ error: `Polar could not start checkout (HTTP ${polarRes.status}).` }, 502);
        }
        const data = await polarRes.json().catch(() => null);
        if (!data?.url) return json({ error: 'Polar did not return a checkout link.' }, 502);
        return json({ ok: true, checkoutUrl: data.url, pack });
      }

      const res = await fetchImpl(`${origin}/api/credits/checkout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ packId: pack.id, email }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.checkoutUrl) {
        return json({ error: data?.error || 'Could not start checkout right now.' }, 502);
      }
      return json({ ok: true, checkoutUrl: data.checkoutUrl, pack });
    } catch {
      return json({ error: 'Could not reach the checkout service. Check your internet connection.' }, 502);
    }
  }

  return json({ error: 'Not found.' }, 404);
}

/**
 * Handles an /api/chat request using the user's connected AppBlips Credits.
 */
export async function handleCreditsChat(payload, env, tokens, { fetch: fetchImpl = globalThis.fetch } = {}) {
  const { email, token } = savedToken(tokens);
  if (!token) {
    return json({ error: 'Connect your AppBlips AI Credits in Settings → Credits first.' }, 401);
  }

  const polarToken = String(env?.POLAR_TOKEN || '').trim();
  const deepseekKey = String(env?.DEEPSEEK_API_KEY || env?.OPENAI_API_KEY || '').trim();
  const origin = creditsOrigin(env);

  const { messages, tools, tool_choice, stream, reasoning_effort, auto_fix, max_tokens, ask } = payload || {};
  let temperature = auto_fix === true ? 0 : 0.2;
  const bodyObj = {
    model: DEFAULT_CREDITS_MODEL,
    stream: Boolean(stream),
    messages,
    temperature,
  };
  if (bodyObj.stream) bodyObj.stream_options = { include_usage: true };
  if (max_tokens != null) bodyObj.max_tokens = max_tokens;
  else if (ask !== true) bodyObj.max_tokens = DEFAULT_BUILD_MAX_TOKENS;
  if (tools) bodyObj.tools = tools;
  if (tool_choice) bodyObj.tool_choice = tool_choice;

  applyProviderSettings(
    bodyObj,
    { id: 'deepseek', local: false, forcedToolChoice: true, streamUsage: true },
    { effort: reasoning_effort ?? 'none' },
  );

  // Mode 1: Direct Polar + DeepSeek (when POLAR_TOKEN and DEEPSEEK_API_KEY are in local env)
  if (polarToken && deepseekKey) {
    const verified = await verifyCreditToken(polarToken, token);
    let balance;
    try {
      balance = await lookupPolarBalance(
        polarToken,
        verified ? { customerId: verified.customerId, email: verified.email } : { email },
        fetchImpl,
      );
    } catch {
      return json({ error: 'Could not verify your AppBlips credit balance. Try again in a moment.' }, 502);
    }

    if (!balance.found || balance.remaining <= 0) {
      const expiredTrialNote = balance.trialExpired && balance.totalGranted === 0
        ? 'Your 3-day free trial has expired. '
        : '';
      return json({
        error: `${expiredTrialNote}You have 0 AppBlips AI Credits remaining (${balance.totalUsed} of ${balance.totalGranted} used). Top up your credits in Settings → Credits to keep building.`,
        source: 'provider',
      }, 429);
    }

    let upstream;
    try {
      upstream = await fetchImpl(`${DEEPSEEK_API_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${deepseekKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bodyObj),
      });
    } catch (err) {
      return json({ error: `Failed to reach DeepSeek: ${err.message}` }, 502);
    }

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      return json({ error: `AppBlips AI returned HTTP ${upstream.status}${text ? `: ${text.slice(0, 200)}` : '.'}` }, upstream.status);
    }

    if (!bodyObj.stream || !upstream.body) {
      const data = await upstream.json();
      const creditsUsed = calculateCreditsFromUsage(data?.usage);
      await recordPolarUsage(polarToken, balance.customerId, creditsUsed, bodyObj.model, data?.usage, fetchImpl);
      return json(data, 200);
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let capturedUsage = null;

    const readable = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            const creditsUsed = calculateCreditsFromUsage(capturedUsage);
            await recordPolarUsage(polarToken, balance.customerId, creditsUsed, bodyObj.model, capturedUsage, fetchImpl);
            controller.close();
            return;
          }
          controller.enqueue(value);
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const jsonStr = trimmed.slice(5).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;
            try {
              const parsed = JSON.parse(jsonStr);
              if (parsed?.usage && (parsed.usage.prompt_tokens || parsed.usage.completion_tokens)) {
                capturedUsage = parsed.usage;
              }
            } catch { /* partial line */ }
          }
        } catch (err) {
          controller.error(err);
        }
      },
      cancel() {
        reader.cancel().catch(() => {});
      },
    });

    return new Response(readable, {
      status: 200,
      headers: {
        'content-type': upstream.headers.get('content-type') || 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  }

  // Mode 2: Cloud relay to https://appblips.com/api/credits/v1/chat/completions
  let upstream;
  try {
    upstream = await fetchImpl(`${origin}/api/credits/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bodyObj),
    });
  } catch (err) {
    return json({ error: `Could not reach AppBlips Credits service: ${err.message}` }, 502);
  }

  if (!upstream.ok) {
    const errBody = await upstream.json().catch(() => null);
    const msg = errBody?.error?.message || errBody?.error || `AppBlips Credits error (HTTP ${upstream.status}).`;
    return json({ error: msg }, upstream.status);
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': upstream.headers.get('content-type') || 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
