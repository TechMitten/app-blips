// The Pixabay connector: the key, search and download endpoints
// (electron/server/pixabayApi.js) against a stubbed Pixabay, and the file
// name and note the page gives a downloaded photo (src/lib/pixabay.js).
// No network. Run: node testing/testPixabayApi.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handlePixabayApi } from '../electron/server/pixabayApi.js';
import { pixabayFileName, pixabayNote } from '../src/lib/pixabay.js';

const ORIGIN = 'http://localhost:5175';
const KEY = '12345678-0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d';

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
  const response = await handlePixabayApi(request(path, options), {}, tokens, { fetch });
  const type = response.headers.get('content-type') || '';
  return {
    status: response.status,
    headers: response.headers,
    body: type.startsWith('application/json') ? await response.json() : new Uint8Array(await response.arrayBuffer()),
  };
};

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const HIT = {
  id: 42,
  pageURL: 'https://pixabay.com/photos/lake-42/',
  tags: 'mountain, lake, sunset',
  previewURL: 'https://cdn.pixabay.com/photo/42_150.jpg',
  previewWidth: 150,
  previewHeight: 100,
  webformatURL: 'https://pixabay.com/get/42_640.jpg',
  largeImageURL: 'https://pixabay.com/get/42_1280.jpg',
  imageWidth: 4000,
  imageHeight: 3000,
  user: 'alice',
  userImageURL: 'https://cdn.pixabay.com/user/alice.jpg',
  views: 999,
};

// A stub Pixabay: the API answers with `hits` for a valid key, and image
// URLs answer with JPEG bytes. Every URL asked for is recorded.
const stubPixabay = ({ hits = [HIT], image = () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }) } = {}) => {
  const seen = [];
  const fetch = async (url) => {
    seen.push(url);
    const parsed = new URL(url);
    if (parsed.origin === 'https://pixabay.com' && parsed.pathname === '/api/') {
      if (parsed.searchParams.get('key') !== KEY) return new Response('[ERROR 400] "key" is invalid.', { status: 400 });
      const id = parsed.searchParams.get('id');
      const found = id ? hits.filter((hit) => String(hit.id) === id) : hits;
      return jsonResponse({ total: found.length, totalHits: found.length, hits: found });
    }
    return image(url);
  };
  return { fetch, seen };
};

test('other sites can’t use the saved key', async () => {
  const { fetch, seen } = stubPixabay();
  const result = await call('/api/pixabay/search', { method: 'POST', body: { q: 'x' }, origin: 'https://evil.example' }, memoryTokens('2b3c', KEY), fetch);
  assert.equal(result.status, 403);
  assert.equal(seen.length, 0);
});

test('a key is only saved once Pixabay accepts it; the page sees its last four characters', async () => {
  const tokens = memoryTokens();
  const { fetch } = stubPixabay();

  const malformed = await call('/api/pixabay/key', { method: 'POST', body: { key: 'not a key' } }, tokens, fetch);
  assert.equal(malformed.status, 400);
  assert.equal(tokens.describe().hasKey, false);

  const rejected = await call('/api/pixabay/key', { method: 'POST', body: { key: '99999999-ffffffffffffffffffffffffffffffff' } }, tokens, fetch);
  assert.equal(rejected.status, 401);
  assert.match(rejected.body.error, /didn’t accept/);
  assert.equal(tokens.describe().hasKey, false);

  const saved = await call('/api/pixabay/key', { method: 'POST', body: { key: ` ${KEY} ` } }, tokens, fetch);
  assert.deepEqual(saved.body, { connected: true, hint: '4c5d' });
  assert.equal(tokens.keyFor('4c5d'), KEY);

  const status = await call('/api/pixabay', {}, tokens, fetch);
  assert.deepEqual(status.body, { connected: true, hint: '4c5d' });
  assert.ok(!JSON.stringify(status.body).includes(KEY));

  const forgotten = await call('/api/pixabay', { method: 'DELETE' }, tokens, fetch);
  assert.deepEqual(forgotten.body, { connected: false, hint: '' });
  assert.equal(tokens.describe().hasKey, false);
});

test('search returns only the fields the page needs, drops foreign URLs and is cached', async () => {
  const tokens = memoryTokens('4c5d', KEY);
  const foreign = { ...HIT, id: 7, previewURL: 'https://evil.example/x.jpg', webformatURL: 'http://pixabay.com/x.jpg' };
  const { fetch, seen } = stubPixabay({ hits: [HIT, foreign, { id: 'nope' }] });

  const first = await call('/api/pixabay/search', { method: 'POST', body: { q: '  mountain   lake ', page: 1 } }, tokens, fetch);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.hits, [{
    id: 42,
    tags: 'mountain, lake, sunset',
    user: 'alice',
    pageURL: HIT.pageURL,
    previewURL: HIT.previewURL,
    previewWidth: 150,
    previewHeight: 100,
    webformatURL: HIT.webformatURL,
    width: 4000,
    height: 3000,
  }]);
  const asked = new URL(seen[0]);
  assert.equal(asked.searchParams.get('q'), 'mountain lake');
  // No safesearch filter: only the AI model's own safeguards apply.
  assert.equal(asked.searchParams.get('safesearch'), null);
  assert.equal(asked.searchParams.get('image_type'), 'photo');

  await call('/api/pixabay/search', { method: 'POST', body: { q: 'mountain lake', page: 1 } }, tokens, fetch);
  assert.equal(seen.length, 1, 'the same search is answered from the cache');

  const far = await call('/api/pixabay/search', { method: 'POST', body: { q: 'mountain lake', page: 9999 } }, tokens, fetch);
  assert.equal(far.status, 200);
  assert.equal(new URL(seen.at(-1)).searchParams.get('page'), '16');
});

test('search and download need a saved key', async () => {
  const { fetch, seen } = stubPixabay();
  const search = await call('/api/pixabay/search', { method: 'POST', body: { q: 'x' } }, memoryTokens(), fetch);
  assert.equal(search.status, 401);
  assert.equal(search.body.signedOut, true);
  const download = await call('/api/pixabay/download', { method: 'POST', body: { id: 42 } }, memoryTokens(), fetch);
  assert.equal(download.status, 401);
  assert.equal(seen.length, 0);
});

test('a busy Pixabay is reported, not cached', async () => {
  let calls = 0;
  const fetch = async () => {
    calls += 1;
    return new Response('', { status: 429 });
  };
  const tokens = memoryTokens('4c5d', KEY);
  const first = await call('/api/pixabay/search', { method: 'POST', body: { q: 'busy' } }, tokens, fetch);
  assert.equal(first.status, 429);
  assert.match(first.body.error, /busy/);
  await call('/api/pixabay/search', { method: 'POST', body: { q: 'busy' } }, tokens, fetch);
  assert.equal(calls, 2);
});

test('download takes an id, looks the photo up again and returns its bytes', async () => {
  const tokens = memoryTokens('4c5d', KEY);
  const { fetch, seen } = stubPixabay();

  for (const id of ['42', 'https://evil.example/x.jpg', -1, 1.5]) {
    const bad = await call('/api/pixabay/download', { method: 'POST', body: { id } }, tokens, fetch);
    assert.equal(bad.status, 400, String(id));
  }
  assert.equal(seen.length, 0);

  const ok = await call('/api/pixabay/download', { method: 'POST', body: { id: 42 } }, tokens, fetch);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual([...ok.body], [1, 2, 3]);
  assert.equal(decodeURIComponent(ok.headers.get('x-pixabay-tags')), 'mountain, lake, sunset');
  assert.equal(decodeURIComponent(ok.headers.get('x-pixabay-user')), 'alice');
  assert.equal(new URL(seen[0]).searchParams.get('id'), '42');
  assert.equal(seen[1], HIT.largeImageURL);

  const missing = await call('/api/pixabay/download', { method: 'POST', body: { id: 43 } }, tokens, fetch);
  assert.equal(missing.status, 404);
});

test('download refuses non-image answers, oversized files and images off Pixabay', async () => {
  const tokens = memoryTokens('4c5d', KEY);
  const html = stubPixabay({ image: () => new Response('<html>', { headers: { 'content-type': 'text/html' } }) });
  assert.equal((await call('/api/pixabay/download', { method: 'POST', body: { id: 42 } }, tokens, html.fetch)).status, 502);

  const huge = stubPixabay({ image: () => new Response(new Uint8Array(1), { headers: { 'content-type': 'image/jpeg', 'content-length': String(16 * 1024 * 1024) } }) });
  assert.equal((await call('/api/pixabay/download', { method: 'POST', body: { id: 42 } }, memoryTokens('4c5d', KEY), huge.fetch)).status, 502);

  const offsite = stubPixabay({ hits: [{ ...HIT, largeImageURL: 'https://evil.example/x.jpg', webformatURL: 'https://evil.example/y.jpg' }] });
  const result = await call('/api/pixabay/download', { method: 'POST', body: { id: 42 } }, memoryTokens('4c5d', KEY), offsite.fetch);
  assert.equal(result.status, 404);
  assert.ok(!offsite.seen.some((url) => url.includes('evil.example')));
});

test('a downloaded photo is named from its tags and noted for the AI', () => {
  assert.equal(pixabayFileName('mountain, lake, sunset, nature', 42, 'image/jpeg'), 'mountain lake sunset.jpg');
  assert.equal(pixabayFileName('', 42, 'image/png'), 'pixabay 42.png');
  assert.equal(pixabayNote('mountain, lake', 'alice'), 'Pixabay photo by alice: mountain, lake');
  assert.equal(pixabayNote('', ''), 'Pixabay photo');
  assert.ok(pixabayNote('x'.repeat(500), 'alice').length <= 200);
});
