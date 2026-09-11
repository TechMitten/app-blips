// Server-side proxy for per-deployment Umami analytics. Written with only
// Fetch API primitives, same as chatProxy.js, so it runs unmodified as a
// Cloudflare Pages Function in production and as Vite dev-server middleware
// locally.
//
// This is a SEPARATE, additive tracking mechanism from the always-on
// umami.techmitten.com injection in src/lib/analytics.js (the author's own
// platform telemetry) -- that code path is untouched. This one talks to a
// dedicated self-hosted Umami instance (UMAMI_API_URL) and gives each opted-in
// deployment its own Umami "website" record, so a user's dashboard can show
// clean per-app stats instead of everything mixed into one site.
//
// Self-hosted Umami has no long-lived API key -- only username/password login
// returning a JWT -- so the admin token is fetched here and cached in memory,
// never sent to the browser. UMAMI_ADMIN_USERNAME/UMAMI_ADMIN_PASSWORD must
// stay server-side only.

import { authorize } from './chatProxy.js';
import { getAppCheckToken } from '../[[path]].js';

let adminTokenCache = { token: null, expiry: 0 };

const base64UrlDecode = (base64Url) => {
  let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  return atob(base64);
};

const decodeJwtExpiry = (token) => {
  try {
    const payload = JSON.parse(base64UrlDecode(token.split('.')[1]));
    if (payload.exp) return payload.exp * 1000;
  } catch {
    // fall through to default
  }
  return Date.now() + 55 * 60 * 1000;
};

const loginToUmami = async (env) => {
  const res = await fetch(`${env.UMAMI_API_URL.replace(/\/+$/, '')}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: env.UMAMI_ADMIN_USERNAME, password: env.UMAMI_ADMIN_PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`Umami login failed: ${res.status}`);
  }
  const data = await res.json();
  if (!data.token) {
    throw new Error('Umami login did not return a token.');
  }
  return data.token;
};

const getUmamiAdminToken = async (env) => {
  const now = Date.now();
  if (adminTokenCache.token && now < adminTokenCache.expiry) {
    return adminTokenCache.token;
  }
  const token = await loginToUmami(env);
  adminTokenCache = { token, expiry: decodeJwtExpiry(token) - 60 * 1000 };
  return token;
};

// Wraps fetch to a self-hosted Umami instance with the cached admin bearer
// token, retrying once with a fresh login on a 401 (expired/revoked token).
const umamiFetch = async (env, path, init = {}) => {
  const base = env.UMAMI_API_URL.replace(/\/+$/, '');
  const doFetch = async (token) => fetch(`${base}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
  });

  let token = await getUmamiAdminToken(env);
  let res = await doFetch(token);
  if (res.status === 401) {
    adminTokenCache = { token: null, expiry: 0 };
    token = await getUmamiAdminToken(env);
    res = await doFetch(token);
  }
  return res;
};

const validateEnv = (env) => {
  const missing = [];
  if (!env.UMAMI_API_URL) missing.push('UMAMI_API_URL');
  if (!env.UMAMI_ADMIN_USERNAME) missing.push('UMAMI_ADMIN_USERNAME');
  if (!env.UMAMI_ADMIN_PASSWORD) missing.push('UMAMI_ADMIN_PASSWORD');
  return missing;
};

const DEFAULT_FIREBASE_PROJECT_ID = 'appbips-f46e2';

// `deployments/{slug}` is publicly readable per firestore.rules, but this
// Firebase project also enforces App Check at the Firestore level, which
// applies before security rules are even evaluated -- an unauthenticated
// call gets a flat 403 regardless of what the rules allow. functions/[[path]].js
// already solves this for its own Firestore reads via a debug-token exchange
// (there's no real App Check attestation provider in a server environment);
// reuse that instead of duplicating it.
const getDeploymentDoc = async (slug, env) => {
  const projectId = env?.FIREBASE_PROJECT_ID || env?.VITE_FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_PROJECT_ID;
  const firestoreApiUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  const headers = {};
  const appCheckToken = await getAppCheckToken(env);
  if (appCheckToken) headers['X-Firebase-AppCheck'] = appCheckToken;
  const res = await fetch(`${firestoreApiUrl}/deployments/${encodeURIComponent(slug)}`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to look up deployment: ${res.status}`);
  const doc = await res.json();
  return {
    user_id: doc.fields?.user_id?.stringValue || null,
    analyticsEnabled: doc.fields?.analyticsEnabled?.booleanValue || false,
    analyticsWebsiteId: doc.fields?.analyticsWebsiteId?.stringValue || null,
  };
};

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

export async function handleAnalyticsWebsiteCreate(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const missingEnv = validateEnv(env);
  if (missingEnv.length) {
    return jsonResponse({ error: `Server is missing required configuration: ${missingEnv.join(', ')}.` }, 500);
  }

  const user = await authorize(request, env);
  if (!user) {
    return jsonResponse({ error: 'Sign in required.' }, 401);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400);
  }

  const slug = (payload?.slug || '').trim();
  if (!slug) {
    return jsonResponse({ error: 'A deployment slug is required.' }, 400);
  }

  let deployment;
  try {
    deployment = await getDeploymentDoc(slug, env);
  } catch (err) {
    return jsonResponse({ error: err.message || 'Failed to look up deployment.' }, 502);
  }

  if (deployment) {
    if (deployment.user_id !== user.id) {
      return jsonResponse({ error: 'You do not own this deployment.' }, 403);
    }
    if (deployment.analyticsWebsiteId) {
      // Idempotent: reuse the existing website instead of creating a second
      // one, so redeploys and toggle-off/toggle-on cycles never orphan stats.
      return jsonResponse({ websiteId: deployment.analyticsWebsiteId });
    }
  }

  try {
    const domain = `${slug.replace(/[^a-z0-9-]+/gi, '-')}.appblips.app`;
    const res = await umamiFetch(env, '/api/websites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: slug, domain }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Umami website creation failed: ${res.status} ${text}`);
    }
    const data = await res.json();
    if (!data.id) {
      throw new Error('Umami did not return a website id.');
    }
    return jsonResponse({ websiteId: data.id });
  } catch (err) {
    return jsonResponse({ error: err.message || 'Failed to create analytics website.' }, 502);
  }
}

const STATS_ENDPOINTS = {
  summary: (id) => `/api/websites/${id}/stats`,
  pageviews: (id) => `/api/websites/${id}/pageviews`,
  // Confirmed against the live instance: Umami's metrics dimension enum uses
  // "path" for pages, not "url".
  urls: (id) => `/api/websites/${id}/metrics?type=path`,
  referrers: (id) => `/api/websites/${id}/metrics?type=referrer`,
  // Visitors with a pageview/event in the last 5 minutes -- {"visitors": n}.
  // Doesn't take a date range, but forwarding startAt/endAt is harmless (Umami
  // ignores unused query params on this endpoint).
  active: (id) => `/api/websites/${id}/active`,
  // ISO 3166-1 alpha-2 codes (e.g. "US") -- the client turns these into flag
  // emoji + display names, so no geo/flag data needs to live server-side.
  countries: (id) => `/api/websites/${id}/metrics?type=country`,
  // First page of the session, as opposed to `urls` which counts every
  // pageview regardless of position.
  entryPages: (id) => `/api/websites/${id}/metrics?type=entry`,
};

// Query params forwarded verbatim to Umami; anything else on the incoming
// request is dropped rather than passed through blind.
const ALLOWED_QUERY_PARAMS = ['startAt', 'endAt', 'unit', 'timezone'];

export async function handleAnalyticsStats(request, env) {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  const missingEnv = validateEnv(env);
  if (missingEnv.length) {
    return jsonResponse({ error: `Server is missing required configuration: ${missingEnv.join(', ')}.` }, 500);
  }

  const user = await authorize(request, env);
  if (!user) {
    return jsonResponse({ error: 'Sign in required.' }, 401);
  }

  const url = new URL(request.url);
  const slug = (url.searchParams.get('slug') || '').trim();
  const type = url.searchParams.get('type') || 'summary';
  const endpointBuilder = STATS_ENDPOINTS[type];
  if (!slug || !endpointBuilder) {
    return jsonResponse({ error: 'A valid slug and type are required.' }, 400);
  }

  let deployment;
  try {
    deployment = await getDeploymentDoc(slug, env);
  } catch (err) {
    return jsonResponse({ error: err.message || 'Failed to look up deployment.' }, 502);
  }

  if (!deployment || deployment.user_id !== user.id) {
    return jsonResponse({ error: 'Deployment not found.' }, 404);
  }
  if (!deployment.analyticsWebsiteId) {
    return jsonResponse({ error: 'Analytics is not enabled for this app.' }, 404);
  }

  const forwardedParams = new URLSearchParams();
  for (const key of ALLOWED_QUERY_PARAMS) {
    const value = url.searchParams.get(key);
    if (value) forwardedParams.set(key, value);
  }
  const query = forwardedParams.toString();
  const path = endpointBuilder(deployment.analyticsWebsiteId);
  const separator = path.includes('?') ? '&' : '?';

  try {
    const res = await umamiFetch(env, query ? `${path}${separator}${query}` : path);
    const data = await res.text();
    return new Response(data, {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') || 'application/json' },
    });
  } catch (err) {
    return jsonResponse({ error: err.message || 'Failed to fetch analytics.' }, 502);
  }
}
