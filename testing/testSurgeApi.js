// Publish to Surge (electron/server/surgeApi.js, tar.js): the tar layout, the
// address rules and the replies the page sees, against a stubbed Surge.
// No network. Run: node testing/testSurgeApi.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { createTar, gzip } from '../electron/server/tar.js';
import { handleSurgeApi, normalizeSurgeDomain } from '../electron/server/surgeApi.js';

const ORIGIN = 'http://localhost:5175';

// The same shape as keyFile.js, in memory.
const memoryTokens = (email = '', token = '') => {
  let state = { id: email, key: token };
  return {
    describe: () => ({ id: state.id, hasKey: Boolean(state.key) }),
    keyFor: (id) => (id && id === state.id ? state.key : ''),
    save: async (id, key) => { state = { id, key }; },
    clear: async () => { state = { id: '', key: '' }; },
  };
};

const request = (path, { method = 'GET', body, origin = ORIGIN } = {}) => new Request(`${ORIGIN}${path}`, {
  method,
  headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(origin ? { origin } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

// Reads a ustar archive back into [{ name, text }], checking each checksum.
const readTar = (bytes) => {
  const files = [];
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const field = (start, length) => new TextDecoder().decode(header.subarray(start, start + length)).replace(/\0.*$/s, '');
    const size = parseInt(field(124, 12), 8);
    const copy = Uint8Array.from(header);
    copy.fill(0x20, 148, 156);
    assert.equal(parseInt(field(148, 8), 8), copy.reduce((a, b) => a + b, 0), 'checksum');
    assert.equal(field(257, 6), 'ustar');
    files.push({ name: field(0, 100), text: new TextDecoder().decode(bytes.subarray(offset + 512, offset + 512 + size)) });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
};

test('tar round-trips names and contents, gzip is real gzip', async () => {
  const entries = [
    { name: 'site/index.html', data: '<h1>Héllo</h1>' },
    { name: 'site/about.html', data: 'x'.repeat(1300) },
  ];
  const files = readTar(gunzipSync(await gzip(createTar(entries))));
  assert.deepEqual(files, entries.map(({ name, data }) => ({ name, text: data })));
});

test('addresses: names become <name>.surge.sh, anything else is refused', () => {
  assert.equal(normalizeSurgeDomain('my-site'), 'my-site.surge.sh');
  assert.equal(normalizeSurgeDomain(' My-Site.surge.sh '), 'my-site.surge.sh');
  assert.equal(normalizeSurgeDomain('https://my-site.surge.sh/'), 'my-site.surge.sh');
  for (const bad of ['', '-site', 'site-', 'my_site', 'a.b', 'example.com', 'x'.repeat(64)]) {
    assert.equal(normalizeSurgeDomain(bad), null, bad);
  }
});

test('other sites may not use the saved sign-in', async () => {
  const response = await handleSurgeApi(request('/api/surge', { origin: 'https://evil.example' }), {}, memoryTokens('a@b.co', 't'));
  assert.equal(response.status, 403);
});

test('status shows the email, never the token', async () => {
  const body = await (await handleSurgeApi(request('/api/surge'), {}, memoryTokens('a@b.co', 'secret'))).json();
  assert.deepEqual(body, { email: 'a@b.co', signedIn: true });
});

test('login keeps only the token Surge returns', async () => {
  const tokens = memoryTokens();
  let seen;
  const fetch = async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify({ email: 'a@b.co', token: 'tok123' }), { status: 201 });
  };
  const body = await (await handleSurgeApi(request('/api/surge/login', { method: 'POST', body: { email: 'a@b.co', password: 'pw' } }), {}, tokens, { fetch })).json();
  assert.deepEqual(body, { email: 'a@b.co', signedIn: true });
  assert.equal(seen.url, 'https://surge.surge.sh/token');
  assert.equal(seen.init.headers.authorization, 'Basic ' + btoa('a@b.co:pw'));
  assert.equal(tokens.keyFor('a@b.co'), 'tok123');
});

test('a wrong password is explained and nothing is saved', async () => {
  const tokens = memoryTokens();
  const fetch = async () => new Response('', { status: 401 });
  const response = await handleSurgeApi(request('/api/surge/login', { method: 'POST', body: { email: 'a@b.co', password: 'pw' } }), {}, tokens, { fetch });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /password/);
  assert.equal(tokens.describe().hasKey, false);
});

const publishRequest = (files = { 'index.html': '<p>hi</p>', 'about.html': '<p>about</p>' }) => (
  request('/api/surge/publish', { method: 'POST', body: { domain: 'my-site', files } })
);

test('publish uploads site/<page> to the address and returns the https link', async () => {
  let seen;
  const fetch = async (url, init) => {
    seen = { url, init };
    return new Response('{"type":"progress","id":"upload"}\n{"type":"info","domain":"my-site.surge.sh"}\n', { status: 200 });
  };
  const body = await (await handleSurgeApi(publishRequest(), {}, memoryTokens('a@b.co', 'tok'), { fetch })).json();
  assert.deepEqual(body, { url: 'https://my-site.surge.sh', domain: 'my-site.surge.sh' });
  assert.equal(seen.url, 'https://surge.surge.sh/my-site.surge.sh');
  assert.equal(seen.init.method, 'PUT');
  assert.equal(seen.init.headers.authorization, 'Basic ' + btoa('token:tok'));
  assert.equal(seen.init.headers['file-count'], '2');
  const names = readTar(gunzipSync(seen.init.body)).map((f) => f.name).sort();
  assert.deepEqual(names, ['site/about.html', 'site/index.html']);
});

test('publish without signing in asks for a sign-in', async () => {
  const response = await handleSurgeApi(publishRequest(), {}, memoryTokens(), { fetch: () => assert.fail('no upload') });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).signedOut, true);
});

test('bad page names and missing index.html are refused before uploading', async () => {
  const fetch = () => assert.fail('no upload');
  for (const files of [{ 'about.html': 'x' }, { 'index.html': 'x', '../evil.html': 'x' }]) {
    const response = await handleSurgeApi(publishRequest(files), {}, memoryTokens('a@b.co', 'tok'), { fetch });
    assert.equal(response.status, 400);
  }
});

test('an expired token is forgotten', async () => {
  const tokens = memoryTokens('a@b.co', 'tok');
  const response = await handleSurgeApi(publishRequest(), {}, tokens, { fetch: async () => new Response('', { status: 401 }) });
  assert.equal((await response.json()).signedOut, true);
  assert.equal(tokens.describe().hasKey, false);
});

test('a taken address passes on Surge’s reason, or explains it', async () => {
  const withReason = async () => new Response('', { status: 403, headers: { reason: 'Rate limited' } });
  assert.equal((await (await handleSurgeApi(publishRequest(), {}, memoryTokens('a@b.co', 'tok'), { fetch: withReason })).json()).error, 'Rate limited');
  const bare = async () => new Response('', { status: 403 });
  assert.match((await (await handleSurgeApi(publishRequest(), {}, memoryTokens('a@b.co', 'tok'), { fetch: bare })).json()).error, /another Surge account/);
});

test('a stream with no info line is a failure', async () => {
  const fetch = async () => new Response('{"type":"progress","id":"upload"}\n', { status: 200 });
  const response = await handleSurgeApi(publishRequest(), {}, memoryTokens('a@b.co', 'tok'), { fetch });
  assert.equal(response.status, 502);
});

const unpublishRequest = (domain = 'my-site') => request('/api/surge/unpublish', { method: 'POST', body: { domain } });

test('unpublish deletes the address with the saved token', async () => {
  let seen;
  const fetch = async (url, init) => {
    seen = { url, init };
    return new Response('{"msg":"project removed"}', { status: 200 });
  };
  const body = await (await handleSurgeApi(unpublishRequest(), {}, memoryTokens('a@b.co', 'tok'), { fetch })).json();
  assert.deepEqual(body, { removed: true });
  assert.equal(seen.url, 'https://surge.surge.sh/my-site.surge.sh');
  assert.equal(seen.init.method, 'DELETE');
  assert.equal(seen.init.headers.authorization, 'Basic ' + btoa('token:tok'));
});

test('unpublishing a site that is already gone counts as done', async () => {
  const fetch = async () => new Response('', { status: 404 });
  assert.deepEqual(await (await handleSurgeApi(unpublishRequest(), {}, memoryTokens('a@b.co', 'tok'), { fetch })).json(), { removed: true });
});

test('unpublish refuses bad addresses, someone else’s site and a missing sign-in', async () => {
  const noFetch = () => assert.fail('no request');
  assert.equal((await handleSurgeApi(unpublishRequest('example.com'), {}, memoryTokens('a@b.co', 'tok'), { fetch: noFetch })).status, 400);
  assert.equal((await (await handleSurgeApi(unpublishRequest(), {}, memoryTokens(), { fetch: noFetch })).json()).signedOut, true);
  const taken = async () => new Response('', { status: 403 });
  assert.match((await (await handleSurgeApi(unpublishRequest(), {}, memoryTokens('a@b.co', 'tok'), { fetch: taken })).json()).error, /another Surge account/);
});
