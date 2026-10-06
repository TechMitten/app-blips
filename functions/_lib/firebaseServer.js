// Server-side Firebase: ID-token verification, a service-account access token,
// and a small Firestore REST client. Fetch and WebCrypto only (no Admin SDK,
// which needs Node), so it runs unchanged on Pages Functions, the Worker, Vite
// dev middleware and Node.
//
// Two separate trust paths:
// - Users prove who they are with a Firebase ID token, verified here locally
//   against Google's published signing keys -- no network call per request.
// - The server itself reads and writes the server-only collections (usage,
//   subscriptions, deployments) as the service account in
//   FIREBASE_SERVICE_ACCOUNT. Firestore security rules don't apply to that
//   identity, so every caller of these helpers must do its own ownership checks.
import { toBase64Url, fromBase64Url } from './promptPass.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FIRESTORE_ORIGIN = 'https://firestore.googleapis.com';
const IDENTITY_ORIGIN = 'https://identitytoolkit.googleapis.com';
// Tolerance for clock drift between Google and this host when checking
// exp/iat/auth_time.
const CLOCK_SKEW_SECONDS = 60;
// An unknown `kid` refetches the key set (Google rotates keys), but no more
// often than this, so junk tokens can't make every request hit Google.
const JWKS_REFETCH_COOLDOWN_MS = 60 * 1000;
const TRANSACTION_ATTEMPTS = 5;

export const firebaseProjectId = (env = {}) =>
  String(env.FIREBASE_PROJECT_ID || env.VITE_FIREBASE_PROJECT_ID || '').trim();

// True when the operator has configured a Firebase project: the server-side
// counterpart of `firebaseEnabled` in src/firebase.js. Multi-user features
// (sign-in, the authenticated relay, billing, deploys) turn on only then;
// without it AppBlips is a single local user with no cloud backend.
export const firebaseConfigured = (env = {}) => Boolean(firebaseProjectId(env));

// FIREBASE_SERVICE_ACCOUNT holds the service account key JSON, raw or
// base64-encoded (some secret stores mangle multi-line values).
let parsedAccount = { raw: null, value: null };
export const serviceAccount = (env = {}) => {
  const raw = String(env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (!raw) return null;
  if (parsedAccount.raw === raw) return parsedAccount.value;
  let value = null;
  try {
    value = JSON.parse(raw.startsWith('{') ? raw : decoder.decode(fromBase64Url(raw)));
    if (!value?.client_email || !value?.private_key) value = null;
  } catch {
    value = null;
  }
  if (!value) console.error('[firebase] FIREBASE_SERVICE_ACCOUNT is not a valid service account key.');
  parsedAccount = { raw, value };
  return value;
};

export const serviceAccountConfigured = (env) => Boolean(firebaseConfigured(env) && serviceAccount(env));

const decodeJson = (segment) => JSON.parse(decoder.decode(fromBase64Url(segment)));

// --- ID token verification -----------------------------------------------

let jwks = { keys: new Map(), expiresAt: 0, fetchedAt: 0 };

// Lets tests start from an empty key cache.
export const resetFirebaseServerCaches = () => {
  jwks = { keys: new Map(), expiresAt: 0, fetchedAt: 0 };
  accessToken = { email: null, token: null, expiresAt: 0, pending: null };
};

const maxAge = (header) => {
  const match = /max-age=(\d+)/i.exec(header || '');
  return match ? Number(match[1]) : 3600;
};

const loadSigningKeys = async () => {
  const now = Date.now();
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error(`Could not fetch Firebase signing keys: ${res.status}`);
  const body = await res.json();
  const keys = new Map();
  for (const jwk of body?.keys || []) {
    if (!jwk?.kid || jwk.kty !== 'RSA') continue;
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    keys.set(jwk.kid, key);
  }
  jwks = { keys, expiresAt: now + maxAge(res.headers.get('cache-control')) * 1000, fetchedAt: now };
};

const signingKey = async (kid) => {
  const now = Date.now();
  if (now >= jwks.expiresAt) await loadSigningKeys();
  else if (!jwks.keys.has(kid) && now - jwks.fetchedAt > JWKS_REFETCH_COOLDOWN_MS) await loadSigningKeys();
  return jwks.keys.get(kid) || null;
};

// Verifies a Firebase Auth ID token the way the Admin SDK does: RS256 signed by
// one of Google's current securetoken keys, issued for this project, unexpired,
// and naming a user. Returns { id, email, authTime, identities } or null.
// `email` is only passed on when Firebase has verified it, because things key
// off it (billing testers, Stripe's customer_email). `identities` are the
// sign-in provider's own account ids ("google.com:123"), which outlive the
// Firebase account: deleting it and signing in again gives a new `id` but the
// same identities, so per-person limits (free prompts) key off them.
const IDENTITY_PROVIDERS = ['google.com', 'github.com'];
const tokenIdentities = (payload) => {
  const found = payload.firebase?.identities || {};
  return IDENTITY_PROVIDERS.flatMap((provider) => (Array.isArray(found[provider]) ? found[provider] : [])
    .filter((id) => typeof id === 'string' && id)
    .map((id) => `${provider}:${id}`));
};

export const verifyIdToken = async (token, env, now = Date.now()) => {
  const projectId = firebaseProjectId(env);
  if (!projectId || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = decodeJson(parts[0]);
    const payload = decodeJson(parts[1]);
    if (header?.alg !== 'RS256' || typeof header.kid !== 'string') return null;

    const seconds = Math.floor(now / 1000);
    if (payload.aud !== projectId) return null;
    if (payload.iss !== `https://securetoken.google.com/${projectId}`) return null;
    if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128) return null;
    if (!Number.isFinite(payload.exp) || payload.exp <= seconds - CLOCK_SKEW_SECONDS) return null;
    if (!Number.isFinite(payload.iat) || payload.iat > seconds + CLOCK_SKEW_SECONDS) return null;
    if (!Number.isFinite(payload.auth_time) || payload.auth_time > seconds + CLOCK_SKEW_SECONDS) return null;

    const key = await signingKey(header.kid);
    if (!key) return null;
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      fromBase64Url(parts[2]),
      encoder.encode(`${parts[0]}.${parts[1]}`),
    );
    if (!valid) return null;

    return {
      id: payload.sub,
      email: payload.email_verified === true && typeof payload.email === 'string' ? payload.email : null,
      authTime: payload.auth_time,
      identities: tokenIdentities(payload),
    };
  } catch (err) {
    console.error('[firebase] token verification failed:', err?.message || err);
    return null;
  }
};

// --- Service account access token ---------------------------------------

let accessToken = { email: null, token: null, expiresAt: 0, pending: null };

const pemToPkcs8 = (pem) => {
  const body = String(pem).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
};

const mintAccessToken = async (account) => {
  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = toBase64Url(encoder.encode(JSON.stringify({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  })));
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(account.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = toBase64Url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(`${header}.${claims}`))));
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`Service account sign-in failed: ${res.status} ${body.error_description || body.error || ''}`.trim());
  }
  return { token: body.access_token, expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000 };
};

// A Google OAuth token for the service account, cached per isolate until five
// minutes before it expires. Concurrent callers share one in-flight mint.
export const serviceAccessToken = async (env) => {
  const account = serviceAccount(env);
  if (!account) throw new Error('FIREBASE_SERVICE_ACCOUNT is not configured.');
  if (accessToken.email === account.client_email && accessToken.token && Date.now() < accessToken.expiresAt - 5 * 60 * 1000) {
    return accessToken.token;
  }
  if (accessToken.pending && accessToken.email === account.client_email) return accessToken.pending;
  const pending = mintAccessToken(account).then((minted) => {
    accessToken = { email: account.client_email, ...minted, pending: null };
    return minted.token;
  }, (err) => {
    accessToken = { email: null, token: null, expiresAt: 0, pending: null };
    throw err;
  });
  accessToken = { email: account.client_email, token: null, expiresAt: 0, pending };
  return pending;
};

// --- Firestore values ----------------------------------------------------

export const toValue = (value) => {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toValue) } };
  if (typeof value === 'object') return { mapValue: { fields: toFields(value) } };
  throw new Error(`Unsupported Firestore value: ${typeof value}`);
};

export const toFields = (object) => {
  const fields = {};
  for (const [key, value] of Object.entries(object)) {
    if (value !== undefined) fields[key] = toValue(value);
  }
  return fields;
};

export const fromValue = (value = {}) => {
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromValue);
  if ('mapValue' in value) return fromFields(value.mapValue.fields);
  return null;
};

export const fromFields = (fields = {}) => {
  const object = {};
  for (const [key, value] of Object.entries(fields || {})) object[key] = fromValue(value);
  return object;
};

// --- Firestore REST ------------------------------------------------------

export class FirestoreError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const databasePath = (env) => `projects/${firebaseProjectId(env)}/databases/(default)`;
export const documentName = (env, path) => `${databasePath(env)}/documents/${path}`;
const documentsUrl = (env) => `${FIRESTORE_ORIGIN}/v1/${databasePath(env)}/documents`;

const firestoreFetch = async (env, url, init = {}) => {
  const token = await serviceAccessToken(env);
  const res = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) },
  });
  if (res.ok) return res;
  const body = await res.json().catch(() => ({}));
  const error = Array.isArray(body) ? body[0]?.error : body?.error;
  throw new FirestoreError(`Firestore ${res.status}: ${error?.message || res.statusText || ''}`.trim(), res.status, error?.status || null);
};

// Document ids used in paths: anything URL-special is encoded, '/' is not
// allowed in a single id anyway.
const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

// One document as { id, data, updateTime }, or null when it doesn't exist.
export const getDoc = async (env, path, { transaction } = {}) => {
  const query = transaction ? `?transaction=${encodeURIComponent(transaction)}` : '';
  try {
    const res = await firestoreFetch(env, `${documentsUrl(env)}/${encodePath(path)}${query}`);
    const doc = await res.json();
    return { id: path.split('/').pop(), data: fromFields(doc.fields), updateTime: doc.updateTime };
  } catch (err) {
    if (err instanceof FirestoreError && err.status === 404) return null;
    throw err;
  }
};

// Builds a structured query: runQuery(env, 'usage', { where: [['user_id', '==', uid]] }).
const OPERATORS = { '==': 'EQUAL', '>=': 'GREATER_THAN_OR_EQUAL', '>': 'GREATER_THAN', '<': 'LESS_THAN', '<=': 'LESS_THAN_OR_EQUAL' };
const structuredQuery = (collection, { where = [], orderBy = [], limit, select } = {}) => {  const filters = where.map(([field, op, value]) => ({
    fieldFilter: { field: { fieldPath: field }, op: OPERATORS[op], value: toValue(value) },
  }));
  return {
    from: [{ collectionId: collection }],
    ...(filters.length === 1 ? { where: filters[0] } : filters.length ? { where: { compositeFilter: { op: 'AND', filters } } } : {}),
    ...(orderBy.length ? { orderBy: orderBy.map(([field, direction = 'ASCENDING']) => ({ field: { fieldPath: field }, direction })) } : {}),
    ...(select ? { select: { fields: select.map((fieldPath) => ({ fieldPath })) } } : {}),
    ...(limit ? { limit } : {}),
  };
};

// Documents of a collection matching `options`, as [{ id, data }]. Top-level
// unless `options.parent` names a document (e.g. 'projects/<id>').
export const runQuery = async (env, collection, options = {}) => {
  const parent = options.parent ? `/${encodePath(options.parent)}` : '';
  const res = await firestoreFetch(env, `${documentsUrl(env)}${parent}:runQuery`, {
    method: 'POST',
    body: JSON.stringify({ structuredQuery: structuredQuery(collection, options) }),
  });
  const rows = await res.json();
  return (rows || []).filter((row) => row.document).map((row) => ({
    id: row.document.name.split('/').pop(),
    data: fromFields(row.document.fields),
  }));
};

// Sums `fields` over the documents matching `options`: { [field]: total }.
export const sumQuery = async (env, collection, fields, options = {}) => {
  const res = await firestoreFetch(env, `${documentsUrl(env)}:runAggregationQuery`, {
    method: 'POST',
    body: JSON.stringify({
      structuredAggregationQuery: {
        structuredQuery: structuredQuery(collection, options),
        aggregations: fields.map((field, i) => ({ alias: `s${i}`, sum: { field: { fieldPath: field } } })),
      },
    }),
  });
  const rows = await res.json();
  const result = (rows || []).find((row) => row.result)?.result?.aggregateFields || {};
  return Object.fromEntries(fields.map((field, i) => [field, Number(fromValue(result[`s${i}`])) || 0]));
};

// Write builders for commit(). `set` replaces the whole document; `update`
// only touches the named fields; `create` fails if the document exists.
export const setWrite = (env, path, data) => ({ update: { name: documentName(env, path), fields: toFields(data) } });
export const createWrite = (env, path, data) => ({ ...setWrite(env, path, data), currentDocument: { exists: false } });
export const updateWrite = (env, path, data) => ({
  update: { name: documentName(env, path), fields: toFields(data) },
  updateMask: { fieldPaths: Object.keys(data).filter((key) => data[key] !== undefined) },
});
export const deleteWrite = (env, path) => ({ delete: documentName(env, path) });

export const commit = async (env, writes, transaction) => {
  if (!writes.length && !transaction) return;
  await firestoreFetch(env, `${documentsUrl(env)}:commit`, {
    method: 'POST',
    body: JSON.stringify({ writes, ...(transaction ? { transaction } : {}) }),
  });
};

// Commits in chunks of 500 writes (Firestore's per-commit limit). Not atomic
// across chunks; for cleanup work only.
export const commitAll = async (env, writes) => {
  for (let i = 0; i < writes.length; i += 500) await commit(env, writes.slice(i, i + 500));
};

const isContention = (err) => err instanceof FirestoreError && (err.status === 409 || err.code === 'ABORTED');

// Runs `fn(tx)` in a read-write transaction and commits the writes it returns:
// fn resolves to { writes, result }. Reads inside go through
// getDoc(env, path, { transaction: tx }), which locks those documents until
// commit -- so two transactions on the same doc serialize, and the loser is
// retried with fresh reads.
export const runTransaction = async (env, fn) => {
  let lastError;
  for (let attempt = 0; attempt < TRANSACTION_ATTEMPTS; attempt += 1) {
    const res = await firestoreFetch(env, `${documentsUrl(env)}:beginTransaction`, {
      method: 'POST',
      body: JSON.stringify({ options: { readWrite: {} } }),
    });
    const { transaction } = await res.json();
    try {
      const { writes = [], result } = await fn(transaction);
      await commit(env, writes, transaction);
      return result;
    } catch (err) {
      lastError = err;
      await firestoreFetch(env, `${documentsUrl(env)}:rollback`, {
        method: 'POST',
        body: JSON.stringify({ transaction }),
      }).catch(() => {});
      if (!isContention(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt + Math.random() * 50));
    }
  }
  throw lastError;
};

// --- Firebase Auth admin -------------------------------------------------

// Deletes a Firebase Auth account. A user that is already gone counts as deleted.
export const deleteAuthUser = async (env, uid) => {
  const token = await serviceAccessToken(env);
  const res = await fetch(`${IDENTITY_ORIGIN}/v1/projects/${firebaseProjectId(env)}/accounts:delete`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ localId: uid }),
  });
  if (res.ok) return;
  const body = await res.json().catch(() => ({}));
  if (/USER_NOT_FOUND/.test(body?.error?.message || '')) return;
  throw new Error(`Could not delete the account: ${res.status} ${body?.error?.message || ''}`.trim());
};

// Every Auth account as [{ localId, email, displayName, ... }], for the
// operator dashboard.
export const listAuthUsers = async (env) => {
  const token = await serviceAccessToken(env);
  const users = [];
  let pageToken = '';
  do {
    const query = new URLSearchParams({ maxResults: '1000', ...(pageToken ? { nextPageToken: pageToken } : {}) });
    const res = await fetch(`${IDENTITY_ORIGIN}/v1/projects/${firebaseProjectId(env)}/accounts:batchGet?${query}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Could not list accounts: ${res.status}`);
    const body = await res.json();
    users.push(...(body.users || []));
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return users;
};

// The bearer token of a request, or ''.
export const bearerToken = (request) =>
  (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
