// Short-lived, HMAC-signed session tokens for deployed-app AI.
//
// The deployed page never carries a durable credential. It asks /ai/session
// for a short-lived token, then sends that token to /ai/chat. Because the token
// is server-signed and expires, a leaked/copied token stops working on its own;
// bumping the deployment's `aiTokenGeneration` invalidates every outstanding
// token immediately. This only helps because minting is gated (see turnstile.js
// and the origin check in aiRelay.js) -- an ungated mint endpoint would just
// hand attackers a fresh token.
//
// Token shape: base64url(payload) + "." + base64url(HMAC-SHA256(payload)).
// Payload keys are short to keep the token small:
//   s = deployment slug, g = aiTokenGeneration, e = expiry (unix seconds).
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toBase64Url = (bytes) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (value) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

let cachedKey = null;
let cachedSecret = null;
const hmacKey = async (secret) => {
  if (cachedKey && cachedSecret === secret) return cachedKey;
  cachedKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  cachedSecret = secret;
  return cachedKey;
};

export const sessionTtlSeconds = (env) => {
  const raw = parseInt(env?.APPBLIPS_AI_SESSION_TTL_SECONDS, 10);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 3600) : 900;
};

// Returns { token, ttl } or null when APPBLIPS_SESSION_SECRET is not configured.
export const signSessionToken = async ({ slug, gen }, env) => {
  const secret = env?.APPBLIPS_SESSION_SECRET;
  if (!secret) return null;
  const ttl = sessionTtlSeconds(env);
  const payload = toBase64Url(encoder.encode(JSON.stringify({
    s: String(slug),
    g: Number(gen) || 0,
    e: Math.floor(Date.now() / 1000) + ttl,
  })));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(payload));
  return { token: `${payload}.${toBase64Url(new Uint8Array(signature))}`, ttl };
};

// Returns { slug, gen, exp } for a valid, unexpired token; null otherwise.
export const verifySessionToken = async (token, env) => {
  const secret = env?.APPBLIPS_SESSION_SECRET;
  if (!secret || typeof token !== 'string' || token.length > 2048) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const payload = token.slice(0, dot);

  let valid = false;
  try {
    const signature = fromBase64Url(token.slice(dot + 1));
    valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), signature, encoder.encode(payload));
  } catch {
    valid = false;
  }
  if (!valid) return null;

  let data;
  try {
    data = JSON.parse(decoder.decode(fromBase64Url(payload)));
  } catch {
    return null;
  }
  if (!data || typeof data.s !== 'string' || !data.s || typeof data.e !== 'number') return null;
  if (data.e <= Math.floor(Date.now() / 1000)) return null;
  return { slug: data.s, gen: Number(data.g) || 0, exp: data.e };
};
