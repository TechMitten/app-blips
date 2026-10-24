// Run: node testing/testSeoScan.js
// /api/seo/scan (electron/server/seoScanApi.js): what it reads out of a page,
// and that it only ever goes to public addresses.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractScan, handleSeoScanApi, isPublicHost } from '../electron/server/seoScanApi.js';

const HTML = `<!doctype html><html lang="en-US"><head>
<title> Maple &amp; Street Bakery </title>
<meta name="description" content="Fresh sourdough &quot;daily&quot;">
<meta property="og:site_name" content='Maple Street'>
</head><body><h1>Our <em>bread</em></h1><h2>Visit us</h2><h2>Visit us</h2><h3>Ignored</h3>
<script>alert(1)</script></body></html>`;

const post = (body, fetchImpl, headers = {}) => handleSeoScanApi(
  new Request('http://localhost:3000/api/seo/scan', { method: 'POST', body: JSON.stringify(body), headers }),
  {},
  { fetch: fetchImpl },
);
const page = (html = HTML, init = {}) => new Response(html, { headers: { 'content-type': 'text/html' }, ...init });

test('extracts the title, description, language and headings as plain text', () => {
  assert.deepEqual(extractScan(HTML, 'https://maple.com'), {
    origin: 'https://maple.com',
    title: 'Maple & Street Bakery',
    description: 'Fresh sourdough "daily"',
    siteName: 'Maple Street',
    lang: 'en-US',
    headings: ['Our bread', 'Visit us'],
  });
});

test('only public hosts are scanned', () => {
  for (const host of ['example.com', 'www.maple.co.uk', '8.8.8.8']) assert.equal(isPublicHost(host), true, host);
  for (const host of ['localhost', 'app.localhost', 'nas.local', 'intranet', '127.0.0.1', '10.0.0.5', '192.168.1.1', '172.20.0.1', '169.254.169.254', '100.64.0.1', '[::1]', 'a.internal', '']) {
    assert.equal(isPublicHost(host), false, host);
  }
});

test('a good page comes back as a scan; nothing but the fields is returned', async () => {
  const response = await post({ url: 'maple.com/menu' }, async (url) => {
    assert.equal(url, 'https://maple.com/');
    return page();
  });
  const { scan } = await response.json();
  assert.equal(response.status, 200);
  assert.equal(scan.origin, 'https://maple.com');
  assert.equal(scan.title, 'Maple & Street Bakery');
  assert.deepEqual(Object.keys(scan).sort(), ['description', 'headings', 'lang', 'origin', 'siteName', 'title']);
});

test('private addresses are refused before any request, including through a redirect', async () => {
  let calls = 0;
  const never = async () => { calls++; return page(); };
  assert.equal((await post({ url: 'http://localhost:3000' }, never)).status, 400);
  assert.equal((await post({ url: 'http://192.168.1.10' }, never)).status, 400);
  assert.equal((await post({ url: 'not a url' }, never)).status, 400);
  assert.equal(calls, 0);

  const redirect = await post({ url: 'https://maple.com' }, async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } }));
  assert.equal(redirect.status, 400);
});

test('public redirects are followed, but not forever', async () => {
  const seen = [];
  const ok = await post({ url: 'https://maple.com' }, async (url) => {
    seen.push(url);
    return url === 'https://maple.com/'
      ? new Response(null, { status: 301, headers: { location: 'https://www.maple.com/home' } })
      : page();
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(seen, ['https://maple.com/', 'https://www.maple.com/home']);

  const loop = await post({ url: 'https://maple.com' }, async () => new Response(null, { status: 302, headers: { location: '/again' } }));
  assert.equal(loop.status, 502);
});

test('errors and non-pages give a plain message', async () => {
  assert.equal((await post({ url: 'https://maple.com' }, async () => page('nope', { status: 404 }))).status, 502);
  const pdf = await post({ url: 'https://maple.com' }, async () => new Response('%PDF', { headers: { 'content-type': 'application/pdf' } }));
  assert.match((await pdf.json()).error, /isn’t a web page/);
  const empty = await post({ url: 'https://maple.com' }, async () => page('<html><body></body></html>'));
  assert.match((await empty.json()).error, /no title or text/);
  const down = await post({ url: 'https://maple.com' }, async () => { throw new TypeError('fetch failed'); });
  assert.match((await down.json()).error, /Couldn’t reach/);
});

test('other sites can’t use it, and only POST works', async () => {
  const foreign = await post({ url: 'https://maple.com' }, async () => page(), { origin: 'https://evil.example' });
  assert.equal(foreign.status, 403);
  const get = await handleSeoScanApi(new Request('http://localhost:3000/api/seo/scan'), {}, { fetch: async () => page() });
  assert.equal(get.status, 405);
});
