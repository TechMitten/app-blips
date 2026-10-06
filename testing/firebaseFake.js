// In-memory stand-ins for the Google and Cloudflare endpoints the server
// handlers call, for tests: Firebase ID tokens signed with a test key (served
// as Google's JWKS), the OAuth token endpoint, the Firestore REST API (docs,
// queries, sums, transactions that abort on conflicting writes) and an R2
// bucket. installFirebaseFake(t) mocks fetch; anything it doesn't recognise
// goes to `fallback` (e.g. a fake LLM upstream).
import { fromFields, fromValue, toFields, resetFirebaseServerCaches } from '../functions/_lib/firebaseServer.js';

export const PROJECT_ID = 'appblips-test';

const encoder = new TextEncoder();
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
const jsonB64 = (value) => b64url(encoder.encode(JSON.stringify(value)));

const rsa = () => crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
);

const signingKeys = await rsa();
const accountKeys = await rsa();
const KID = 'test-kid';
const jwk = await crypto.subtle.exportKey('jwk', signingKeys.publicKey);
const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', accountKeys.privateKey)).toString('base64');

export const SERVICE_ACCOUNT = JSON.stringify({
  type: 'service_account',
  project_id: PROJECT_ID,
  client_email: `server@${PROJECT_ID}.iam.gserviceaccount.com`,
  private_key: `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`,
});

export const R2_ENV = {
  R2_ACCOUNT_ID: 'acct',
  R2_ACCESS_KEY_ID: 'r2-key',
  R2_SECRET_ACCESS_KEY: 'r2-secret',
  R2_BUCKET: 'orion-deploys',
};

// Multi-user env with the server-side credentials.
export const firebaseEnv = (extra = {}) => ({
  FIREBASE_PROJECT_ID: PROJECT_ID,
  FIREBASE_SERVICE_ACCOUNT: SERVICE_ACCOUNT,
  ...extra,
});

// A Firebase ID token for `sub`, valid now unless `claims` override it.
// `key: 'other'` signs with a key the JWKS doesn't list.
export const signIdToken = async (sub, { claims = {}, header = {}, key } = {}) => {
  const now = Math.floor(Date.now() / 1000);
  const head = jsonB64({ alg: 'RS256', kid: KID, typ: 'JWT', ...header });
  const body = jsonB64({
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    aud: PROJECT_ID,
    sub,
    iat: now - 10,
    exp: now + 3600,
    auth_time: now - 10,
    email: `${sub}@example.com`,
    email_verified: true,
    ...claims,
  });
  const privateKey = key === 'other' ? (await rsa()).privateKey : signingKeys.privateKey;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, encoder.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(signature))}`;
};

// --- Firestore -----------------------------------------------------------

const DOCS_PREFIX = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const NAME_PREFIX = `projects/${PROJECT_ID}/databases/(default)/documents/`;

const OPS = {
  EQUAL: (a, b) => a === b,
  GREATER_THAN_OR_EQUAL: (a, b) => a >= b,
  GREATER_THAN: (a, b) => a > b,
  LESS_THAN: (a, b) => a < b,
  LESS_THAN_OR_EQUAL: (a, b) => a <= b,
};

const errorResponse = (status, statusText, message) =>
  Response.json({ error: { code: status, status: statusText, message } }, { status });

export const createFirestore = () => {
  // path -> { fields (Firestore-encoded), version }
  const docs = new Map();
  // transaction id -> Map(path -> version read)
  const transactions = new Map();
  let clock = 0;
  let txCounter = 0;

  const getData = (path) => (docs.has(path) ? fromFields(docs.get(path).fields) : null);
  const setData = (path, fields) => docs.set(path, { fields, version: ++clock });

  const matches = (data, filter) => {
    if (!filter) return true;
    if (filter.compositeFilter) return filter.compositeFilter.filters.every((f) => matches(data, f));
    const { field, op, value } = filter.fieldFilter;
    return field.fieldPath in data && OPS[op](data[field.fieldPath], fromValue(value));
  };

  const query = (parent, structured) => {
    const collection = structured.from[0].collectionId;
    const prefix = parent ? `${parent}/${collection}/` : `${collection}/`;
    let rows = [...docs.keys()]
      .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .map((path) => ({ path, data: getData(path) }))
      .filter((row) => matches(row.data, structured.where));
    for (const order of [...(structured.orderBy || [])].reverse()) {
      const field = order.field.fieldPath;
      const dir = order.direction === 'DESCENDING' ? -1 : 1;
      rows.sort((a, b) => (a.data[field] > b.data[field] ? dir : a.data[field] < b.data[field] ? -dir : 0));
    }
    if (structured.limit) rows = rows.slice(0, structured.limit);
    return rows;
  };

  const applyWrite = (write) => {
    if (write.delete) {
      docs.delete(write.delete.slice(NAME_PREFIX.length));
      return null;
    }
    const path = write.update.name.slice(NAME_PREFIX.length);
    if (write.currentDocument?.exists === false && docs.has(path)) return errorResponse(409, 'ALREADY_EXISTS', 'exists');
    if (write.updateMask) {
      const fields = { ...(docs.get(path)?.fields || {}) };
      for (const key of write.updateMask.fieldPaths) {
        if (key in write.update.fields) fields[key] = write.update.fields[key];
        else delete fields[key];
      }
      setData(path, fields);
    } else {
      setData(path, write.update.fields);
    }
    return null;
  };

  const handle = async (url, init = {}) => {
    const method = init.method || 'GET';
    const rest = url.slice(DOCS_PREFIX.length);
    const [pathPart, verb] = rest.split(':');
    const parent = decodeURIComponent(pathPart.replace(/^\//, '').split('?')[0]) || '';
    const body = init.body ? JSON.parse(init.body) : {};

    if (method === 'GET' && !verb) {
      const [rawPath, search] = rest.slice(1).split('?');
      const path = rawPath.split('/').map(decodeURIComponent).join('/');
      const tx = new URLSearchParams(search || '').get('transaction');
      if (tx) transactions.get(tx)?.set(path, docs.get(path)?.version || 0);
      if (!docs.has(path)) return errorResponse(404, 'NOT_FOUND', 'missing');
      return Response.json({ name: NAME_PREFIX + path, fields: docs.get(path).fields, updateTime: new Date().toISOString() });
    }
    if (verb === 'beginTransaction') {
      const id = `tx-${++txCounter}`;
      transactions.set(id, new Map());
      return Response.json({ transaction: id });
    }
    if (verb === 'rollback') {
      transactions.delete(body.transaction);
      return Response.json({});
    }
    if (verb === 'commit') {
      if (body.transaction) {
        const reads = transactions.get(body.transaction);
        transactions.delete(body.transaction);
        if (!reads) return errorResponse(400, 'INVALID_ARGUMENT', 'unknown transaction');
        for (const [path, version] of reads) {
          if ((docs.get(path)?.version || 0) !== version) return errorResponse(409, 'ABORTED', 'contention');
        }
      }
      for (const write of body.writes || []) {
        const failed = applyWrite(write);
        if (failed) return failed;
      }
      return Response.json({ commitTime: new Date().toISOString() });
    }
    if (verb === 'runQuery') {
      const rows = query(parent, body.structuredQuery);
      if (!rows.length) return Response.json([{ readTime: new Date().toISOString() }]);
      return Response.json(rows.map((row) => ({ document: { name: NAME_PREFIX + row.path, fields: docs.get(row.path).fields } })));
    }
    if (verb === 'runAggregationQuery') {
      const { structuredQuery, aggregations } = body.structuredAggregationQuery;
      const rows = query(parent, structuredQuery);
      const aggregateFields = {};
      for (const { alias, sum } of aggregations) {
        aggregateFields[alias] = { integerValue: String(rows.reduce((total, row) => total + (Number(row.data[sum.field.fieldPath]) || 0), 0)) };
      }
      return Response.json([{ result: { aggregateFields } }]);
    }
    return errorResponse(400, 'INVALID_ARGUMENT', `unhandled ${method} ${url}`);
  };

  return { handle, docs, getData, set: (path, data) => setData(path, toFields(data)) };
};

// --- R2 ------------------------------------------------------------------

export const createR2 = (bucket = R2_ENV.R2_BUCKET) => {
  const objects = new Map();
  const prefix = `https://${R2_ENV.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${bucket}`;
  const handle = async (url, init = {}) => {
    const method = init.method || 'GET';
    if (!String(init.headers?.authorization || '').startsWith('AWS4-HMAC-SHA256 Credential=r2-key/')) {
      return new Response('unsigned', { status: 403 });
    }
    const parsed = new URL(url);
    const key = decodeURIComponent(parsed.pathname.slice(`/${bucket}/`.length));
    if (method === 'PUT') {
      objects.set(key, Buffer.from(init.body).toString('utf8'));
      return new Response(null, { status: 200 });
    }
    if (method === 'DELETE') {
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    if (method === 'GET' && parsed.searchParams.get('list-type') === '2') {
      const listPrefix = parsed.searchParams.get('prefix') || '';
      const keys = [...objects.keys()].filter((k) => k.startsWith(listPrefix));
      return new Response(`<ListBucketResult>${keys.map((k) => `<Contents><Key>${k}</Key></Contents>`).join('')}<IsTruncated>false</IsTruncated></ListBucketResult>`);
    }
    if (method === 'GET') {
      return objects.has(key) ? new Response(objects.get(key)) : new Response('missing', { status: 404 });
    }
    return new Response('unsupported', { status: 400 });
  };
  return { handle, objects, prefix };
};

// Mocks fetch with all of the above. Returns { firestore, r2, calls }.
export const installFirebaseFake = (t, { fallback } = {}) => {
  resetFirebaseServerCaches();
  const firestore = createFirestore();
  const r2 = createR2();
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method || 'GET' });
    if (url.startsWith('https://www.googleapis.com/service_accounts/v1/jwk/securetoken')) {
      return Response.json({ keys: [{ ...jwk, kid: KID, alg: 'RS256', use: 'sig' }] }, { headers: { 'cache-control': 'public, max-age=3600' } });
    }
    if (url === 'https://oauth2.googleapis.com/token') {
      return Response.json({ access_token: 'service-token', expires_in: 3600, token_type: 'Bearer' });
    }
    if (url.startsWith(DOCS_PREFIX)) {
      if (init.headers?.authorization !== 'Bearer service-token') return errorResponse(401, 'UNAUTHENTICATED', 'no token');
      return firestore.handle(url, init);
    }
    if (url.startsWith(r2.prefix)) return r2.handle(url, init);
    if (url.startsWith('https://identitytoolkit.googleapis.com/')) return Response.json({});
    if (fallback) return fallback(url, init);
    throw new Error(`Unexpected fetch in test: ${init.method || 'GET'} ${url}`);
  });
  return { firestore, r2, calls };
};
