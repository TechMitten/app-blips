// Signed "prompt pass": proof that a request belongs to a prompt the server
// already counted. A Build or Ask prompt is many model requests (writing,
// edits, repairs, the summary); the plan check counts the first and hands
// back a pass, and the rest of that prompt carry it. Without a signature the
// client could mark every request as a follow-up and never be counted.
//
// Same token shape as aiSession.js (base64url(payload).base64url(HMAC)) and
// the same APPBLIPS_SESSION_SECRET, but a separately derived key and a typed
// payload, so a pass can never be replayed as a deployed-app AI session
// token or the other way round.
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Long enough for any real build; the pass is re-issued on every request of
// the prompt, so this is idle time, not total time.
const PASS_TTL_SECONDS = 30 * 60;

const toBase64Url = (bytes) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (value) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

let cachedKey = null;
let cachedSecret = null;
const passKey = async (secret) => {
  if (cachedKey && cachedSecret === secret) return cachedKey;
  cachedKey = await crypto.subtle.importKey('raw', encoder.encode(`prompt-pass:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  cachedSecret = secret;
  return cachedKey;
};

export const promptPassesEnabled = (env) => Boolean(env?.APPBLIPS_SESSION_SECRET);

// A pass for `uid`, or null when no signing secret is configured.
export const signPromptPass = async (uid, env, now = Date.now()) => {
  const secret = env?.APPBLIPS_SESSION_SECRET;
  if (!secret) return null;
  const payload = toBase64Url(encoder.encode(JSON.stringify({ t: 'prompt', u: String(uid), e: Math.floor(now / 1000) + PASS_TTL_SECONDS })));
  const signature = await crypto.subtle.sign('HMAC', await passKey(secret), encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
};

// True when `pass` is a valid, unexpired pass issued to `uid`.
export const verifyPromptPass = async (pass, uid, env, now = Date.now()) => {
  const secret = env?.APPBLIPS_SESSION_SECRET;
  if (!secret || typeof pass !== 'string' || pass.length > 1024) return false;
  const dot = pass.indexOf('.');
  if (dot <= 0 || dot === pass.length - 1) return false;
  const payload = pass.slice(0, dot);
  try {
    const ok = await crypto.subtle.verify('HMAC', await passKey(secret), fromBase64Url(pass.slice(dot + 1)), encoder.encode(payload));
    if (!ok) return false;
    const data = JSON.parse(decoder.decode(fromBase64Url(payload)));
    return data?.t === 'prompt' && data.u === String(uid) && typeof data.e === 'number' && data.e > Math.floor(now / 1000);
  } catch {
    return false;
  }
};
