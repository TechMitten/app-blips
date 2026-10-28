// /api/pixabay/*: the Pixabay connector. The user pastes their own Pixabay API
// key, searches free photos and adds the ones they pick to the open project's
// My images gallery. Used by every host (electron/main.js, server.js, the
// Vite dev server, android.js), so Fetch primitives only, like
// pollinationsApi.js.
//
// The key is personal (Pixabay rate-limits per key and asks that it isn't
// published), so it stays here like the Pollinations key: the page only sees
// its last four characters. The AI never calls Pixabay; photos reach it as
// gallery images.
//
//   GET    /api/pixabay          -> { connected, hint }
//   DELETE /api/pixabay          -> forget the key
//   POST   /api/pixabay/key      { key }        -> { connected, hint } | { error }
//   POST   /api/pixabay/search   { q, page }    -> { totalHits, hits: [...] } | { error }
//   POST   /api/pixabay/download { id }         -> the image bytes | { error }
//
// Download takes a photo id, never a URL, and looks the photo up again with
// the saved key, so it can only ever fetch Pixabay's own image files.
//
// `tokens` is { describe, keyFor, save, clear }: keyFile.js in the browser
// version, electron/surgeStore.js (OS keychain) on desktop.
import { isForeignOrigin } from './chatProxy.js';

const PIXABAY_API = 'https://pixabay.com/api/';
const KEY_RE = /^\d{1,12}-[0-9a-f]{16,64}$/i;
const MAX_QUERY = 100;
const MAX_PAGE = 16;
const PER_PAGE = 30;
// The gallery refuses bigger uploads (MAX_GALLERY_UPLOAD_BYTES), so there is
// no point fetching more.
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const IMAGE_TYPE_RE = /^image\/(jpeg|png|webp)\b/i;
// Pixabay's API terms ask for responses to be cached for 24 hours.
const CACHE_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE = 200;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

const UNREACHABLE = 'Couldn’t reach Pixabay. Check your internet connection and try again.';
const BUSY = 'Pixabay is busy (too many searches in a short time). Try again in a minute.';
const NO_KEY = 'Add your Pixabay API key first, in Settings → Connectors → Pixabay.';

// API responses per token store (one per host), keyed by the query string
// without the key. Cleared whenever the key changes.
const caches = new WeakMap();

const cacheFor = (tokens) => {
  if (!caches.has(tokens)) caches.set(tokens, new Map());
  return caches.get(tokens);
};

const savedKey = (tokens) => {
  const { id, hasKey } = tokens.describe();
  return hasKey ? tokens.keyFor(id) : '';
};

// Only https addresses on pixabay.com or one of its subdomains (cdn.pixabay.com).
function pixabayUrl(value) {
  if (typeof value !== 'string' || !value) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    if (url.hostname !== 'pixabay.com' && !url.hostname.endsWith('.pixabay.com')) return '';
    return url.href;
  } catch {
    return '';
  }
}

const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
const number = (value) => (Number.isFinite(value) && value > 0 ? Math.round(value) : 0);

// One API call: -> { body } | { status, error }. `params` excludes the key.
async function apiCall(key, params, tokens, fetchImpl) {
  const query = new URLSearchParams(params).toString();
  const cache = cacheFor(tokens);
  const hit = cache.get(query);
  if (hit && hit.expires > Date.now()) {
    // Re-inserted so the most recently used entries survive the cap.
    cache.delete(query);
    cache.set(query, hit);
    return { body: hit.body };
  }
  let response;
  try {
    response = await fetchImpl(`${PIXABAY_API}?key=${encodeURIComponent(key)}&${query}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { status: 502, error: UNREACHABLE };
  }
  if (response.status === 429) return { status: 429, error: BUSY };
  if (!response.ok) {
    // Pixabay answers a bad key with a plain-text 400: [ERROR 400] "key" is invalid.
    const message = await response.text().catch(() => '');
    if (/key/i.test(message)) return { status: 401, error: 'Pixabay didn’t accept your API key. Check it in Settings → Connectors → Pixabay.', badKey: true };
    return { status: 502, error: `Pixabay couldn’t answer (error ${response.status}). Try again.` };
  }
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!body || !Array.isArray(body.hits)) return { status: 502, error: 'Pixabay sent an answer AppBlips couldn’t read. Try again.' };
  cache.set(query, { body, expires: Date.now() + CACHE_MS });
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  return { body };
}

// What the page may see of a search hit. Hits with no usable thumbnail are dropped.
function cleanHit(hit) {
  const previewURL = pixabayUrl(hit?.previewURL);
  const webformatURL = pixabayUrl(hit?.webformatURL);
  if (!Number.isSafeInteger(hit?.id) || hit.id <= 0 || !(previewURL || webformatURL)) return null;
  return {
    id: hit.id,
    tags: text(hit.tags, 200),
    user: text(hit.user, 100),
    pageURL: pixabayUrl(hit.pageURL),
    previewURL,
    previewWidth: number(hit.previewWidth),
    previewHeight: number(hit.previewHeight),
    webformatURL,
    width: number(hit.imageWidth),
    height: number(hit.imageHeight),
  };
}

async function saveKey({ key }, tokens, fetchImpl) {
  const trimmed = typeof key === 'string' ? key.trim() : '';
  if (!KEY_RE.test(trimmed)) {
    return json({ error: 'That doesn’t look like a Pixabay API key. It is a number, a dash and a long string of letters and digits, like 12345678-0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d.' }, 400);
  }
  // A separate cache, so checking the key can't serve an answer cached for the old one.
  const scratch = {};
  const result = await apiCall(trimmed, { per_page: '3', image_type: 'photo' }, scratch, fetchImpl);
  if (result.error) return json({ error: result.badKey ? 'Pixabay didn’t accept that key. Copy it again from the Pixabay API page.' : result.error }, result.status);
  const hint = trimmed.slice(-4);
  await tokens.save(hint, trimmed);
  caches.delete(tokens);
  return json({ connected: true, hint });
}

async function search({ q, page }, tokens, fetchImpl) {
  const key = savedKey(tokens);
  if (!key) return json({ error: NO_KEY, signedOut: true }, 401);
  const params = {
    q: typeof q === 'string' ? q.trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY) : '',
    image_type: 'photo',
    safesearch: 'true',
    per_page: String(PER_PAGE),
    page: String(Math.min(MAX_PAGE, Math.max(1, Number.isSafeInteger(page) ? page : 1))),
  };
  const result = await apiCall(key, params, tokens, fetchImpl);
  if (result.error) return json({ error: result.error, ...(result.badKey ? { signedOut: true } : {}) }, result.status);
  return json({
    totalHits: number(result.body.totalHits),
    hits: result.body.hits.map(cleanHit).filter(Boolean),
  });
}

async function download({ id }, tokens, fetchImpl) {
  const key = savedKey(tokens);
  if (!key) return json({ error: NO_KEY, signedOut: true }, 401);
  if (!Number.isSafeInteger(id) || id <= 0) return json({ error: 'Invalid request.' }, 400);
  const result = await apiCall(key, { id: String(id) }, tokens, fetchImpl);
  if (result.error) return json({ error: result.error, ...(result.badKey ? { signedOut: true } : {}) }, result.status);
  const hit = result.body.hits.find((item) => item?.id === id);
  const target = pixabayUrl(hit?.largeImageURL) || pixabayUrl(hit?.webformatURL);
  if (!target) return json({ error: 'That photo is no longer on Pixabay.' }, 404);

  let response;
  try {
    response = await fetchImpl(target, { headers: { accept: 'image/*' }, signal: AbortSignal.timeout(60_000) });
  } catch {
    return json({ error: UNREACHABLE }, 502);
  }
  const type = response.headers.get('content-type') || '';
  const length = Number(response.headers.get('content-length')) || 0;
  if (!response.ok || !IMAGE_TYPE_RE.test(type) || length > MAX_IMAGE_BYTES) {
    response.body?.cancel().catch(() => {});
    return json({ error: `Pixabay couldn’t send that photo (error ${response.status}). Try another one.` }, 502);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) return json({ error: 'That photo is too large to add.' }, 413);
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': type.split(';')[0].toLowerCase(),
      'cache-control': 'no-store',
      // Used by the page to name the file and write the AI's note.
      'x-pixabay-tags': encodeURIComponent(text(hit.tags, 200)),
      'x-pixabay-user': encodeURIComponent(text(hit.user, 100)),
    },
  });
}

export async function handlePixabayApi(request, env, tokens, { fetch: fetchImpl = globalThis.fetch } = {}) {
  // Only AppBlips' own page may spend the saved key. A JSON body also forces
  // a CORS preflight, which other sites can't pass.
  if (isForeignOrigin(request, env)) return json({ error: 'Not allowed.' }, 403);
  const path = new URL(request.url).pathname.replace(/\/+$/, '');

  if (path === '/api/pixabay') {
    if (request.method === 'GET') {
      const { id, hasKey } = tokens.describe();
      return json({ connected: hasKey, hint: hasKey ? id : '' });
    }
    if (request.method === 'DELETE') {
      await tokens.clear();
      caches.delete(tokens);
      return json({ connected: false, hint: '' });
    }
    return json({ error: 'Method not allowed.' }, 405);
  }
  const actions = {
    '/api/pixabay/key': saveKey,
    '/api/pixabay/search': search,
    '/api/pixabay/download': download,
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
