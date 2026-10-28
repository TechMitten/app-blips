// The Tavily connector: the key and search endpoints
// (electron/server/tavilyApi.js) against a stubbed Tavily.
// No network. Run: node testing/testTavilyApi.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleTavilyApi } from '../electron/server/tavilyApi.js';

const ORIGIN = 'http://localhost:5175';
const KEY = 'tvly-dev-0a1b2c3d4e5f6a7b8c9d0e1f';

const memoryTokens = (id = '', key = '') => {
  let state = { id, key };
  return {
    describe: () => ({ id: state.id, hasKey: Boolean(state.key) }),
    keyFor: (wanted) => (wanted && wanted === state.id ? state.key : ''),
    save: async (nextId, nextKey) => { state = { id: nextId, key: nextKey }; },
    clear: async () => { state = { id: '', key: '' }; },
  };
};

const request = (path, { method = 'GET', body, origin = ORIGIN } = {}) => new Request(`${ORIGIN}${path}`, {
  method,
  headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(origin ? { origin } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

const call = async (path, options, tokens, fetch) => {
  const response = await handleTavilyApi(request(path, options), {}, tokens, { fetch });
  return { status: response.status, body: await response.json() };
};

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const RESULTS = [
  { title: 'Blue Door Café', url: 'https://bluedoor.example/', content: 'Open 8am to 4pm.\n\nTuesday to Sunday.', score: 0.9, published_date: '2026-10-01', raw_content: 'x' },
  { title: 'Bad', url: 'javascript:alert(1)', content: 'nope' },
  { title: 'Long', url: 'http://long.example/page', content: 'y'.repeat(5000) },
];

// A stub Tavily: answers for KEY, 401 for any other key, `status` overrides.
const stubTavily = ({ status = 200, results = RESULTS } = {}) => {
  const seen = [];
  const fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    seen.push({ url: parsed.href, method: init.method || 'GET', headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    if (init.headers?.authorization !== `Bearer ${KEY}`) return jsonResponse({ detail: { error: 'Unauthorized: missing or invalid API key.' } }, 401);
    if (status !== 200) return jsonResponse({ detail: { error: 'nope' } }, status);
    if (parsed.pathname === '/usage') return jsonResponse({ key: { usage: 3, limit: 1000 } });
    if (parsed.pathname === '/search') return jsonResponse({ query: 'x', results, response_time: 0.5 });
    return jsonResponse({}, 404);
  };
  return { fetch, seen };
};

test('only the app’s own page may use the key', async () => {
  const { fetch, seen } = stubTavily();
  const result = await call('/api/tavily/search', { method: 'POST', body: { query: 'x' }, origin: 'https://evil.example' }, memoryTokens('0e1f', KEY), fetch);
  assert.equal(result.status, 403);
  assert.equal(seen.length, 0);
});

test('a key is only saved once Tavily accepts it; the page sees its last four characters', async () => {
  const tokens = memoryTokens();
  const { fetch, seen } = stubTavily();
  const malformed = await call('/api/tavily/key', { method: 'POST', body: { key: 'sk-not-tavily' } }, tokens, fetch);
  assert.equal(malformed.status, 400);
  assert.equal(seen.length, 0, 'a malformed key never reaches Tavily');

  const rejected = await call('/api/tavily/key', { method: 'POST', body: { key: 'tvly-dev-ffffffffffffffffffffffff' } }, tokens, fetch);
  assert.equal(rejected.status, 401);
  assert.match(rejected.body.error, /didn’t accept/);
  assert.equal(tokens.describe().hasKey, false);

  const saved = await call('/api/tavily/key', { method: 'POST', body: { key: ` ${KEY} ` } }, tokens, fetch);
  assert.deepEqual(saved.body, { connected: true, hint: '0e1f' });
  assert.equal(seen.at(-1).url, 'https://api.tavily.com/usage', 'checked with /usage, which runs no search');

  assert.deepEqual((await call('/api/tavily', {}, tokens, fetch)).body, { connected: true, hint: '0e1f' });
  assert.deepEqual((await call('/api/tavily', { method: 'DELETE' }, tokens, fetch)).body, { connected: false, hint: '' });
  assert.equal(tokens.describe().hasKey, false);
});

test('search uses the cheapest shape and returns cleaned results', async () => {
  const { fetch, seen } = stubTavily();
  const result = await call('/api/tavily/search', {
    method: 'POST',
    body: { query: '  blue   door café hours ', topic: 'finance', time_range: 'decade', max_results: 20, search_depth: 'advanced' },
  }, memoryTokens('0e1f', KEY), fetch);
  assert.equal(result.status, 200);
  const sent = seen[0];
  assert.equal(sent.url, 'https://api.tavily.com/search');
  assert.equal(sent.method, 'POST');
  assert.equal(sent.headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(sent.body, {
    query: 'blue door café hours', search_depth: 'basic', max_results: 5, topic: 'general',
    include_answer: false, include_raw_content: false, include_images: false,
  }, 'the page can’t raise depth or results, and bad topic/time_range fall back');

  assert.equal(result.body.results.length, 2, 'the javascript: result is dropped');
  assert.deepEqual(result.body.results[0], {
    title: 'Blue Door Café', url: 'https://bluedoor.example/', content: 'Open 8am to 4pm. Tuesday to Sunday.', published_date: '2026-10-01',
  });
  assert.equal(result.body.results[1].content.length, 1200);

  await call('/api/tavily/search', { method: 'POST', body: { query: 'news', topic: 'news', time_range: 'week' } }, memoryTokens('0e1f', KEY), fetch);
  assert.equal(seen[1].body.topic, 'news');
  assert.equal(seen[1].body.time_range, 'week');
});

test('no key, empty query and Tavily errors are reported in plain language', async () => {
  const { fetch, seen } = stubTavily();
  const noKey = await call('/api/tavily/search', { method: 'POST', body: { query: 'x' } }, memoryTokens(), fetch);
  assert.equal(noKey.status, 401);
  assert.equal(noKey.body.signedOut, true);
  const empty = await call('/api/tavily/search', { method: 'POST', body: { query: '   ' } }, memoryTokens('0e1f', KEY), fetch);
  assert.equal(empty.status, 400);
  assert.equal(seen.length, 0);

  const badKey = await call('/api/tavily/search', { method: 'POST', body: { query: 'x' } }, memoryTokens('ffff', 'tvly-dev-ffffffffffffffffffffffff'), fetch);
  assert.equal(badKey.status, 401);
  assert.equal(badKey.body.signedOut, true);

  for (const [status, pattern, expected] of [[429, /busy/, 429], [432, /credits/, 402], [433, /credits/, 402], [500, /error 500/, 502]]) {
    const result = await call('/api/tavily/search', { method: 'POST', body: { query: 'x' } }, memoryTokens('0e1f', KEY), stubTavily({ status }).fetch);
    assert.equal(result.status, expected, `Tavily ${status}`);
    assert.match(result.body.error, pattern);
    assert.equal(result.body.signedOut, undefined);
  }

  const offline = await call('/api/tavily/search', { method: 'POST', body: { query: 'x' } }, memoryTokens('0e1f', KEY), async () => { throw new TypeError('fetch failed'); });
  assert.equal(offline.status, 502);
  assert.match(offline.body.error, /Couldn’t reach Tavily/);
});

test('wrong methods and bodies are refused', async () => {
  const { fetch } = stubTavily();
  const tokens = memoryTokens('0e1f', KEY);
  assert.equal((await call('/api/tavily/search', {}, tokens, fetch)).status, 405);
  assert.equal((await call('/api/tavily', { method: 'POST', body: {} }, tokens, fetch)).status, 405);
  assert.equal((await call('/api/tavily/search', { method: 'POST', body: ['x'] }, tokens, fetch)).status, 400);
  assert.equal((await call('/api/tavily/nope', {}, tokens, fetch)).status, 404);
});
