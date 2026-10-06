// Cloudflare R2 through its S3-compatible API, signed with AWS SigV4 using
// WebCrypto. A Workers R2 binding would only exist on Cloudflare; this works
// on every host (Pages, the Worker, Vite dev), so deploys can be tested
// locally against the real bucket.
//
// The bucket is private. Objects reach the public only through
// functions/[[path]].js on the apps hostname, which serves them as text/html
// under its own CSP.
const encoder = new TextEncoder();

export const r2Bucket = (env = {}) => String(env.R2_BUCKET || 'orion-deploys').trim();

export const r2Configured = (env = {}) =>
  Boolean(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY);

const toHex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256Hex = async (data) => toHex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? encoder.encode(data) : data));
const hmac = async (key, data) => {
  const cryptoKey = await crypto.subtle.importKey('raw', typeof key === 'string' ? encoder.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
};

// RFC 3986 encoding, as SigV4 requires (encodeURIComponent leaves !'()* alone).
const uriEncode = (value) => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// Object keys are always built server-side from validated parts, but keep a
// last check so nothing can climb out of the bucket or hit the root.
const assertKey = (key) => {
  if (typeof key !== 'string' || !key || key.length > 512 || key.startsWith('/') || key.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid storage key: ${key}`);
  }
};

// The SigV4 Authorization header for a request. `headers` are the signed
// headers (lowercase names, must include host); pure, so it can be checked
// against AWS's published test vectors.
export const sigV4Authorization = async ({ method, path, queryString, headers, payloadHash, amzDate, region, service, accessKeyId, secret }) => {
  const day = amzDate.slice(0, 8);
  const names = Object.keys(headers).sort();
  const canonicalRequest = [
    method,
    path,
    queryString,
    names.map((name) => `${name}:${String(headers[name]).trim()}\n`).join(''),
    names.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n');
  let signingKey = await hmac(`AWS4${secret}`, day);
  for (const part of [region, service, 'aws4_request']) signingKey = await hmac(signingKey, part);
  const signature = toHex(await hmac(signingKey, stringToSign));
  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
};

const signedFetch = async (env, method, key, { query = {}, body, headers = {} } = {}) => {
  const host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const path = `/${uriEncode(r2Bucket(env))}${key ? `/${key.split('/').map(uriEncode).join('/')}` : ''}`;
  const queryString = Object.keys(query).sort().map((name) => `${uriEncode(name)}=${uriEncode(String(query[name]))}`).join('&');
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const payloadHash = await sha256Hex(body === undefined ? '' : body);

  const signed = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  for (const [name, value] of Object.entries(headers)) signed[name.toLowerCase()] = String(value).trim();
  const authorization = await sigV4Authorization({
    method, path, queryString, headers: signed, payloadHash, amzDate,
    region: 'auto', service: 's3', accessKeyId: env.R2_ACCESS_KEY_ID, secret: env.R2_SECRET_ACCESS_KEY,
  });

  // fetch sets Host itself (it's a forbidden header); the rest go as signed.
  const sendHeaders = { ...signed };
  delete sendHeaders.host;
  return fetch(`https://${host}${path}${queryString ? `?${queryString}` : ''}`, {
    method,
    headers: { ...sendHeaders, authorization },
    ...(body === undefined ? {} : { body }),
  });
};

export const putObject = async (env, key, body, { contentType = 'text/html; charset=utf-8' } = {}) => {
  assertKey(key);
  const bytes = typeof body === 'string' ? encoder.encode(body) : body;
  const res = await signedFetch(env, 'PUT', key, { body: bytes, headers: { 'content-type': contentType } });
  if (!res.ok) throw new Error(`Storage upload failed: ${res.status}`);
};

// The object's body as text, or null when it doesn't exist.
export const getObjectText = async (env, key) => {
  assertKey(key);
  const res = await signedFetch(env, 'GET', key);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Storage read failed: ${res.status}`);
  return res.text();
};

// Deletes each key; a missing object counts as deleted (S3 answers 204 either way).
export const deleteObjects = async (env, keys) => {
  for (let i = 0; i < keys.length; i += 10) {
    await Promise.all(keys.slice(i, i + 10).map(async (key) => {
      assertKey(key);
      const res = await signedFetch(env, 'DELETE', key);
      if (!res.ok && res.status !== 404) throw new Error(`Storage delete failed: ${res.status}`);
    }));
  }
};

const decodeXml = (value) => value
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// Every key under `prefix` (ListObjectsV2, following continuation tokens).
export const listKeys = async (env, prefix) => {
  if (!prefix || !prefix.endsWith('/')) throw new Error('listKeys needs a folder prefix ending in /');
  const keys = [];
  let continuation = '';
  do {
    const query = { 'list-type': '2', prefix, ...(continuation ? { 'continuation-token': continuation } : {}) };
    const res = await signedFetch(env, 'GET', '', { query });
    if (!res.ok) throw new Error(`Storage list failed: ${res.status}`);
    const xml = await res.text();
    for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push(decodeXml(match[1]));
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    continuation = truncated ? decodeXml(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1] || '') : '';
  } while (continuation);
  return keys;
};
