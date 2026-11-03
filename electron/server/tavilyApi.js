// /api/tavily/*: the Tavily connector. The user pastes their own Tavily API
// key, and the AI build agent searches the web with it through the
// web_search tool (src/lib/webSearch.js). Used by every host
// (electron/main.js, server.js, the Vite dev server, android.js), so Fetch
// primitives only, like pixabayApi.js.
//
// The key is personal and each search spends the user's Tavily credits, so it
// stays here like the Pixabay key: the page only sees its last four
// characters. The search itself is fixed to the cheapest useful shape (basic
// depth, 1 credit, a few results); the model only chooses the words, the
// topic and the time range.
//
//   GET    /api/tavily         -> { connected, hint }
//   DELETE /api/tavily         -> forget the key
//   POST   /api/tavily/key     { key }                       -> { connected, hint } | { error }
//   POST   /api/tavily/search  { query, topic, time_range }  -> { results: [...] } | { error }
//
// `tokens` is { describe, keyFor, save, clear }: keyFile.js in the browser
// version, electron/surgeStore.js (OS keychain) on desktop.
import { isForeignOrigin } from './chatProxy.js';

const TAVILY_API = 'https://api.tavily.com';
// Keys look like tvly-<letters and digits>, newer ones tvly-dev-… or tvly-prod-….
const KEY_RE = /^tvly-[A-Za-z0-9_-]{16,128}$/;
const MAX_QUERY = 400;
const MAX_RESULTS = 5;
const MAX_CONTENT = 1200;
const TOPICS = new Set(['general', 'news']);
const TIME_RANGES = new Set(['day', 'week', 'month', 'year']);

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

const UNREACHABLE = 'Couldn’t reach Tavily. Check your internet connection and try again.';
const BUSY = 'Tavily is busy (too many searches in a short time). Try again in a minute.';
const NO_CREDITS = 'Your Tavily key has run out of credits or reached its plan limit. Check your usage at app.tavily.com.';
const NO_KEY = 'Add your Tavily API key first, in Settings → Extensions → Tavily.';
const BAD_KEY = 'Tavily didn’t accept your API key. Check it in Settings → Extensions → Tavily.';

const savedKey = (tokens) => {
  const { id, hasKey } = tokens.describe();
  return hasKey ? tokens.keyFor(id) : '';
};

const text = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

// Only plain web addresses, never javascript: or data: ones, since the AI may
// put a result's address into a page.
function webUrl(value) {
  if (typeof value !== 'string' || !value) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    if (url.username || url.password) return '';
    return url.href;
  } catch {
    return '';
  }
}

// One API call: -> { body } | { status, error, badKey? }.
async function apiCall(key, path, { method = 'GET', body } = {}, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(`${TAVILY_API}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${key}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { status: 502, error: UNREACHABLE };
  }
  if (response.status === 401 || response.status === 403) {
    response.body?.cancel().catch(() => {});
    return { status: 401, error: BAD_KEY, badKey: true };
  }
  if (response.status === 429) {
    response.body?.cancel().catch(() => {});
    return { status: 429, error: BUSY };
  }
  // 432: key or plan limit, 433: pay-as-you-go limit.
  if (response.status === 432 || response.status === 433) {
    response.body?.cancel().catch(() => {});
    return { status: 402, error: NO_CREDITS };
  }
  if (!response.ok) {
    response.body?.cancel().catch(() => {});
    return { status: 502, error: `Tavily couldn’t answer (error ${response.status}). Try again.` };
  }
  try {
    const parsed = await response.json();
    if (parsed && typeof parsed === 'object') return { body: parsed };
  } catch { /* fall through */ }
  return { status: 502, error: 'Tavily sent an answer AppBlips couldn’t read. Try again.' };
}

// What the page (and so the AI) may see of a search result. Results without a
// usable address are dropped.
function cleanResult(result) {
  const url = webUrl(result?.url);
  if (!url) return null;
  const published = text(result.published_date, 40);
  return {
    title: text(result.title, 200),
    url,
    content: text(result.content, MAX_CONTENT),
    ...(published ? { published_date: published } : {}),
  };
}

async function saveKey({ key }, tokens, fetchImpl) {
  const trimmed = typeof key === 'string' ? key.trim() : '';
  if (!KEY_RE.test(trimmed)) {
    return json({ error: 'That doesn’t look like a Tavily API key. It starts with tvly- followed by a long string of letters and digits.' }, 400);
  }
  // /usage answers 401 for a bad key and doesn't run a search.
  const result = await apiCall(trimmed, '/usage', {}, fetchImpl);
  if (result.error) return json({ error: result.badKey ? 'Tavily didn’t accept that key. Copy it again from app.tavily.com.' : result.error }, result.status);
  const hint = trimmed.slice(-4);
  await tokens.save(hint, trimmed);
  return json({ connected: true, hint });
}

async function search({ query, topic, time_range: timeRange }, tokens, fetchImpl) {
  const key = savedKey(tokens);
  if (!key) return json({ error: NO_KEY, signedOut: true }, 401);
  const q = typeof query === 'string' ? query.trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY) : '';
  if (!q) return json({ error: 'The search needs some words to look for.' }, 400);
  const body = {
    query: q,
    search_depth: 'basic',
    max_results: MAX_RESULTS,
    topic: TOPICS.has(topic) ? topic : 'general',
    include_answer: false,
    include_raw_content: false,
    include_images: false,
    ...(TIME_RANGES.has(timeRange) ? { time_range: timeRange } : {}),
  };
  const result = await apiCall(key, '/search', { method: 'POST', body }, fetchImpl);
  if (result.error) return json({ error: result.error, ...(result.badKey ? { signedOut: true } : {}) }, result.status);
  const results = Array.isArray(result.body.results) ? result.body.results : [];
  return json({ results: results.map(cleanResult).filter(Boolean).slice(0, MAX_RESULTS) });
}

export async function handleTavilyApi(request, env, tokens, { fetch: fetchImpl = globalThis.fetch } = {}) {
  // Only AppBlips' own page may spend the saved key. A JSON body also forces
  // a CORS preflight, which other sites can't pass.
  if (isForeignOrigin(request, env)) return json({ error: 'Not allowed.' }, 403);
  const path = new URL(request.url).pathname.replace(/\/+$/, '');

  if (path === '/api/tavily') {
    if (request.method === 'GET') {
      const { id, hasKey } = tokens.describe();
      return json({ connected: hasKey, hint: hasKey ? id : '' });
    }
    if (request.method === 'DELETE') {
      await tokens.clear();
      return json({ connected: false, hint: '' });
    }
    return json({ error: 'Method not allowed.' }, 405);
  }
  const actions = {
    '/api/tavily/key': saveKey,
    '/api/tavily/search': search,
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
