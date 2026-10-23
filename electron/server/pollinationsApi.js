// /api/pollinations/*: the Pollinations (pollinations.ai) sign-in behind the
// Pollinations connector, and the image generation it is used for. Used by all
// three hosts (electron/main.js, server.js, the Vite dev server), so Fetch
// primitives only, like chatProxy.js and surgeApi.js.
//
// Sign-in is Pollinations' device flow with AppBlips' App Key: AppBlips asks
// for a code, the user approves it on enter.pollinations.ai in their own
// browser, and AppBlips collects a user key (sk_...) that spends the user's
// Pollen within the budget and expiry they chose there. The device flow needs
// no redirect address, so it works the same from appblips://, localhost and
// Docker. The device code and the key stay here like the Surge token: the page
// sees only the account name.
//
//   GET    /api/pollinations             -> { signedIn, username, balance? }
//   DELETE /api/pollinations             -> sign out (forget the key)
//   POST   /api/pollinations/login       -> { userCode, verificationUrl, expiresIn }
//   POST   /api/pollinations/login/check -> { pending } | { signedIn, username } | { error }
//   POST   /api/pollinations/image       -> { url } (a gen.pollinations.ai/image
//                                           URL) -> { url } of the stored image
//                                           on media.pollinations.ai, or { error, signedOut? }
//
// The stored image's address is public and needs no key, so the pages the AI
// builds never carry the user's key.
//
// `tokens` is { describe, keyFor, save, clear }: keyFile.js in the browser
// version, electron/surgeStore.js (OS keychain) on desktop.
import { isForeignOrigin } from './chatProxy.js';
import {
  POLLINATIONS_API, POLLINATIONS_APP_KEY, POLLINATIONS_AUTH, POLLINATIONS_MEDIA,
} from '../../src/lib/pollinationsApp.js';

const MAX_IMAGE_URL = 2000;
const MEDIA_ID_RE = /^[A-Za-z0-9._-]{1,200}$/;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

const UNREACHABLE = 'Couldn’t reach Pollinations. Check your internet connection and try again.';

// The sign-in waiting for approval, per token store (one per host):
// { deviceCode, expiresAt, intervalMs, nextPollAt }.
const pendingLogins = new WeakMap();

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function startLogin(_body, tokens, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(`${POLLINATIONS_AUTH}/api/device/code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ client_id: POLLINATIONS_APP_KEY }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return json({ error: UNREACHABLE }, 502);
  }
  const body = response.ok ? await readJson(response) : null;
  const { device_code: deviceCode, user_code: userCode, verification_uri_complete: complete, verification_uri: plain } = body || {};
  const verificationUrl = typeof complete === 'string' ? complete : plain;
  if (typeof deviceCode !== 'string' || typeof userCode !== 'string' || typeof verificationUrl !== 'string'
    || !verificationUrl.startsWith(`${POLLINATIONS_AUTH}/`)) {
    return json({ error: `Pollinations couldn’t start the sign-in (error ${response.status}). Try again in a minute.` }, 502);
  }
  const expiresIn = Number(body.expires_in) > 0 ? Number(body.expires_in) : 1800;
  const intervalMs = (Number(body.interval) > 0 ? Number(body.interval) : 5) * 1000;
  pendingLogins.set(tokens, { deviceCode, expiresAt: Date.now() + expiresIn * 1000, intervalMs, nextPollAt: Date.now() + intervalMs });
  return json({ userCode, verificationUrl, expiresIn });
}

// The account name for the key, or '' when Pollinations doesn't say.
async function accountName(key, fetchImpl) {
  try {
    const response = await fetchImpl(`${POLLINATIONS_AUTH}/api/device/userinfo`, {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    const body = response.ok ? await readJson(response) : null;
    const name = body?.preferred_username || body?.name;
    return typeof name === 'string' ? name.slice(0, 100) : '';
  } catch {
    return '';
  }
}

// One poll of the token endpoint. The page asks every few seconds; asking
// Pollinations faster than the interval it gave would get a slow_down.
async function checkLogin(_body, tokens, fetchImpl) {
  const pending = pendingLogins.get(tokens);
  if (!pending) return json({ error: 'The sign-in was cancelled. Start again.' }, 400);
  if (Date.now() > pending.expiresAt) {
    pendingLogins.delete(tokens);
    return json({ error: 'The sign-in code expired. Start again.' }, 400);
  }
  if (Date.now() < pending.nextPollAt) return json({ pending: true });
  pending.nextPollAt = Date.now() + pending.intervalMs;

  let response;
  try {
    response = await fetchImpl(`${POLLINATIONS_AUTH}/api/device/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ device_code: pending.deviceCode, client_id: POLLINATIONS_APP_KEY }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    // A dropped connection isn't a refusal: keep waiting.
    return json({ pending: true });
  }
  const body = await readJson(response);
  if (typeof body?.access_token === 'string' && body.access_token) {
    pendingLogins.delete(tokens);
    const username = await accountName(body.access_token, fetchImpl);
    await tokens.save(username || 'Pollinations account', body.access_token);
    return json({ signedIn: true, username });
  }
  if (body?.error === 'authorization_pending') return json({ pending: true });
  if (body?.error === 'slow_down') {
    pending.intervalMs += 5000;
    return json({ pending: true });
  }
  pendingLogins.delete(tokens);
  if (body?.error === 'access_denied') return json({ error: 'The sign-in was declined on Pollinations.' }, 400);
  if (body?.error === 'expired_token') return json({ error: 'The sign-in code expired. Start again.' }, 400);
  return json({ error: `Pollinations couldn’t finish the sign-in (error ${response.status}). Try again.` }, 502);
}

const savedKey = (tokens) => {
  const { id, hasKey } = tokens.describe();
  return hasKey ? tokens.keyFor(id) : '';
};

// The URL the AI wrote, cleaned for fetching: only Pollinations' image
// endpoint, and never a key someone else put in it.
function imageRequestUrl(value) {
  if (typeof value !== 'string' || !value || value.length > MAX_IMAGE_URL) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.origin !== POLLINATIONS_API || !url.pathname.startsWith('/image/') || url.pathname.length <= '/image/'.length
    || url.username || url.password) return null;
  url.searchParams.delete('key');
  url.hash = '';
  return url.href;
}

// The stored copy Pollinations links from every generated image:
// Link: <https://media.pollinations.ai/{id}>; rel="enclosure".
function mediaUrl(response) {
  const link = response.headers.get('link') || '';
  const match = link.match(/<https:\/\/media\.pollinations\.ai\/([^>/?#]+)>\s*;\s*rel="?enclosure"?/i);
  const id = match?.[1] || response.headers.get('x-content-id') || '';
  return MEDIA_ID_RE.test(id) ? `${POLLINATIONS_MEDIA}/${id}` : null;
}

async function generateImage({ url }, tokens, fetchImpl) {
  const key = savedKey(tokens);
  if (!key) return json({ error: 'Sign in to Pollinations first.', signedOut: true }, 401);
  const target = imageRequestUrl(url);
  if (!target) return json({ error: 'That isn’t a Pollinations image address.' }, 400);
  let response;
  try {
    response = await fetchImpl(target, {
      headers: { authorization: `Bearer ${key}`, accept: 'image/*' },
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    return json({ error: UNREACHABLE }, 502);
  }
  // Only the headers are needed; the image itself is fetched by the page later.
  const stored = response.ok && /^image\//i.test(response.headers.get('content-type') || '') ? mediaUrl(response) : null;
  response.body?.cancel().catch(() => {});
  if (response.status === 401) {
    // Expired (after the days chosen at sign-in) or revoked: forget it so
    // Settings asks to sign in again.
    await tokens.clear();
    return json({ error: 'Your Pollinations sign-in has expired. Sign in again in Settings → Connectors.', signedOut: true }, 401);
  }
  if (response.status === 402) {
    return json({ error: 'Your Pollinations sign-in has used up its Pollen budget, or your account is out of Pollen.' }, 402);
  }
  if (response.status === 429) return json({ error: 'Pollinations is busy. Try again in a minute.' }, 429);
  if (!stored) return json({ error: `Pollinations couldn’t make the image (error ${response.status}).` }, 502);
  return json({ url: stored });
}

// The remaining budget of the key (a budgeted key sees its own budget), or
// null. A 401 means the key expired or was revoked.
async function keyBalance(key, fetchImpl) {
  try {
    const response = await fetchImpl(`${POLLINATIONS_API}/account/balance`, {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401) return { expired: true };
    const body = response.ok ? await readJson(response) : null;
    return { balance: typeof body?.balance === 'number' ? body.balance : null };
  } catch {
    return { balance: null };
  }
}

export async function handlePollinationsApi(request, env, tokens, { fetch: fetchImpl = globalThis.fetch } = {}) {
  // Only AppBlips' own page may spend the saved key. A JSON body also forces
  // a CORS preflight, which other sites can't pass.
  if (isForeignOrigin(request, env)) return json({ error: 'Not allowed.' }, 403);
  const path = new URL(request.url).pathname.replace(/\/+$/, '');

  if (path === '/api/pollinations') {
    if (request.method === 'GET') {
      const key = savedKey(tokens);
      if (!key) return json({ signedIn: false, username: '' });
      const { expired, balance } = await keyBalance(key, fetchImpl);
      if (expired) {
        await tokens.clear();
        return json({ signedIn: false, username: '', expired: true });
      }
      return json({ signedIn: true, username: tokens.describe().id, balance });
    }
    if (request.method === 'DELETE') {
      pendingLogins.delete(tokens);
      await tokens.clear();
      return json({ signedIn: false, username: '' });
    }
    return json({ error: 'Method not allowed.' }, 405);
  }
  const actions = {
    '/api/pollinations/login': startLogin,
    '/api/pollinations/login/check': checkLogin,
    '/api/pollinations/image': generateImage,
  };
  if (actions[path]) {
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    if (!/^application\/json\b/i.test(request.headers.get('content-type') || '')) return json({ error: 'Invalid request.' }, 400);
    let body;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid request.' }, 400);
    return actions[path](body, tokens, fetchImpl);
  }
  return json({ error: 'Not found.' }, 404);
}
