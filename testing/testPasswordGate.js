// Password-protected publishing (src/lib/passwordGate.js + surgeApi.js): the
// published files hold no plaintext and no password, the right password
// decrypts through the real lock-screen script, a wrong one doesn't.
// No network, no browser. Run: node testing/testPasswordGate.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { gunzipSync } from 'node:zlib';
import { handleSurgeApi } from '../electron/server/surgeApi.js';
import { checkGatePassword, inlineGateImages, protectPages } from '../src/lib/passwordGate.js';

const PASSWORD = 'correct horse battery';
const SECRET = 'const SECRET_API_KEY = "sk-live-12345";';
const PAGE = `<!DOCTYPE html><html><head><title>My Secret Project</title></head><body><script>${SECRET}</script></body></html>`;

// Runs the page's own <script> against a stub DOM; resolves with what it wrote
// into the document, or null if the password was refused.
function unlock(gate, password, session = {}) {
  const script = /<script>([\s\S]*?)<\/script>/.exec(gate)[1];
  const data = /<script type="application\/json" id="appblips-gate-data">([\s\S]*?)<\/script>/.exec(gate)[1];
  const elements = {
    'appblips-gate-data': { textContent: data },
    'gate-form': { addEventListener: (type, fn) => { elements['gate-form'].submit = fn; } },
    'gate-password': { value: password, focus() {} },
    'gate-submit': {},
    'gate-note': {},
  };
  return new Promise((done) => {
    let written = '';
    let check;
    const resolve = (value) => { clearInterval(check); done(value); };
    const sandbox = {
      document: { getElementById: (id) => elements[id], open() {}, close: () => resolve(written), write: (html) => { written += html; } },
      sessionStorage: { getItem: (k) => session[k] ?? null, setItem: (k, v) => { session[k] = v; }, removeItem: (k) => { delete session[k]; } },
      crypto, TextEncoder, TextDecoder, atob, btoa, JSON, Uint8Array, String, Promise,
    };
    sandbox.window = sandbox;
    vm.runInNewContext(script, sandbox);
    if (!elements['gate-form'].submit) return;
    elements['gate-form'].submit({ preventDefault() {} });
    check = setInterval(() => {
      if (elements['gate-note'].textContent?.includes('isn’t right')) resolve(null);
    }, 20);
  });
}

test('published pages contain neither the code nor the password', async () => {
  const pages = await protectPages({ 'index.html': PAGE, 'about.html': '<p>About</p>' }, PASSWORD);
  assert.deepEqual(Object.keys(pages).sort(), ['about.html', 'index.html']);
  for (const html of Object.values(pages)) {
    assert.ok(!html.includes('SECRET_API_KEY') && !html.includes('My Secret Project'));
    assert.ok(!html.includes(PASSWORD));
    assert.match(html, /noindex/);
  }
});

test('the right password unlocks, a wrong one does not, and each page can be opened', async () => {
  const pages = await protectPages({ 'index.html': PAGE, 'about.html': '<p>About</p>' }, PASSWORD);
  assert.equal(await unlock(pages['index.html'], PASSWORD), PAGE);
  assert.equal(await unlock(pages['index.html'], 'correct horse batterz'), null);
});

test('one unlock opens the other pages through the saved key', async () => {
  const pages = await protectPages({ 'index.html': PAGE, 'about.html': '<p>About</p>' }, PASSWORD);
  const session = {};
  await unlock(pages['index.html'], PASSWORD, session);
  const saved = session['appblips-gate-key'];
  assert.ok(saved && !saved.includes(PASSWORD), 'the key is kept, never the password');
  // The second page unlocks on load, without the form being submitted.
  const script = /<script>([\s\S]*?)<\/script>/.exec(pages['about.html'])[1];
  const data = /id="appblips-gate-data">([\s\S]*?)<\/script>/.exec(pages['about.html'])[1];
  const written = await new Promise((resolve) => {
    let out = '';
    const el = { 'appblips-gate-data': { textContent: data }, 'gate-form': { addEventListener() {} }, 'gate-password': {}, 'gate-submit': {}, 'gate-note': {} };
    vm.runInNewContext(script, {
      document: { getElementById: (id) => el[id], open() {}, write: (h) => { out += h; }, close: () => resolve(out) },
      sessionStorage: { getItem: () => saved, removeItem() {} },
      window: { crypto },
      crypto, TextEncoder, TextDecoder, atob, btoa, JSON, Uint8Array, String, Promise,
    });
  });
  assert.equal(written, '<p>About</p>');
});

test('every page uses a fresh IV and the site shares one salt', async () => {
  const pages = await protectPages({ 'index.html': 'a', 'about.html': 'a' }, PASSWORD);
  const read = (html) => JSON.parse(/id="appblips-gate-data">([\s\S]*?)<\/script>/.exec(html)[1]);
  const [a, b] = Object.values(pages).map(read);
  assert.equal(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
  assert.ok(a.iterations >= 600_000);
  const again = read((await protectPages({ 'index.html': 'a' }, PASSWORD))['index.html']);
  assert.notEqual(again.salt, a.salt, 'a new publish uses a new salt');
});

test('short or oversized passwords are refused', () => {
  assert.ok(checkGatePassword('short'));
  assert.ok(checkGatePassword('x'.repeat(300)));
  assert.ok(checkGatePassword(undefined));
  assert.equal(checkGatePassword(PASSWORD), null);
});

test('images are inlined into the pages, and external addresses are left alone', () => {
  const images = [{ path: 'images/a.png', type: 'image/png', bytes: new Uint8Array([1, 2, 3]) }];
  const out = inlineGateImages({
    'index.html': '<img src="images/a.png"><img src="/images/a.png"><img src="https://x.com/images/a.png"><img src="images/a.png2">',
  }, images)['index.html'];
  const url = 'data:image/png;base64,AQID';
  assert.equal(out, `<img src="${url}"><img src="${url}"><img src="https://x.com/images/a.png"><img src="images/a.png2">`);
});

const memoryTokens = () => ({ describe: () => ({ id: 'a@b.co', hasKey: true }), keyFor: () => 'tok', save: async () => {}, clear: async () => {} });
const publish = (body, fetch) => handleSurgeApi(new Request('http://localhost:5175/api/surge/publish', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:5175' }, body: JSON.stringify({ domain: 'my-site', ...body }),
}), {}, memoryTokens(), { fetch });

test('publish with a password uploads only locked pages, the icon, and no sitemap', async () => {
  let upload;
  const fetch = async (url, init) => { upload = gunzipSync(init.body).toString('latin1'); return new Response('{"type":"info"}\n'); };
  const response = await publish({
    files: { 'index.html': PAGE },
    images: { 'images/a.png': btoa('PNGDATA'), 'favicon.png': btoa('ICON') },
    extras: { 'sitemap.xml': '<urlset/>' },
    password: PASSWORD,
  }, fetch);
  assert.equal(response.status, 200);
  assert.ok(upload.includes('site/index.html') && upload.includes('site/favicon.png'));
  assert.ok(!upload.includes('site/images/') && !upload.includes('sitemap') && !upload.includes('PNGDATA'));
  assert.ok(!upload.includes('SECRET_API_KEY') && !upload.includes(PASSWORD));
  assert.ok(upload.includes('href="/favicon.png"'), 'the lock screen shows the site icon');
});

test('publish refuses a weak password before anything is uploaded', async () => {
  const response = await publish({ files: { 'index.html': PAGE }, password: 'short' }, () => assert.fail('no upload'));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /at least 10/);
});
