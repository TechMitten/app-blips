// The Pollinations connector: the sign-in and image endpoints
// (electron/server/pollinationsApi.js) against a stubbed Pollinations, the
// image URLs the AI writes (pollinations.js), the helper added to pages
// (pollinationsHelper.js), the copied images for publish/export
// (siteImages.js), and the connector state and AI directive.
// No network. Run: node testing/testPollinations.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { handlePollinationsApi } from '../electron/server/pollinationsApi.js';
import { POLLINATIONS_APP_KEY, POLLINATIONS_EARNINGS, POLLINATIONS_VISITOR_FEE_NOTE } from '../src/lib/pollinationsApp.js';
import { findImageRequests, resolveImages } from '../src/lib/pollinations.js';
import { injectPollinationsHelper, scrambleKey, usesPollinationsHelper } from '../src/lib/pollinationsHelper.js';
import { collectSiteImages, inlineImages, pointAtCopies, SITE_IMAGE_PATH_RE } from '../src/lib/siteImages.js';
import {
  connectorStatus, getActiveConnectors, getPollinationsHelperOptions, getPollinationsSiteKey, loadConnectors,
} from '../src/lib/connectors.js';
import { buildConnectorDirective } from '../src/lib/prompts.js';

const ORIGIN = 'http://localhost:5175';
const MEDIA_ID = '64568afac87210aa5a315a02d9ab57c136f7ec486e58610d76dfcd67d6d12c94';

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
  const response = await handlePollinationsApi(request(path, options), {}, tokens, { fetch });
  return { status: response.status, body: await response.json() };
};

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('sign-in: device code with AppBlips’ App Key, polls, then saves the key and account name', async () => {
  const tokens = memoryTokens();
  const seen = [];
  let polls = 0;
  const fetch = async (url, init = {}) => {
    seen.push({ url, init });
    if (url.endsWith('/api/device/code')) {
      return jsonResponse({ device_code: 'dev-1', user_code: 'ABCD1234', verification_uri_complete: 'https://enter.pollinations.ai/device?user_code=ABCD1234', expires_in: 1800, interval: 0.001 });
    }
    if (url.endsWith('/api/device/token')) {
      polls += 1;
      return polls === 1 ? jsonResponse({ error: 'authorization_pending' }, 400) : jsonResponse({ access_token: 'sk_user', token_type: 'bearer' });
    }
    if (url.endsWith('/api/device/userinfo')) return jsonResponse({ preferred_username: 'octo' });
    return assert.fail(`unexpected ${url}`);
  };

  const start = await call('/api/pollinations/login', { method: 'POST', body: {} }, tokens, fetch);
  assert.deepEqual(start.body, { userCode: 'ABCD1234', verificationUrl: 'https://enter.pollinations.ai/device?user_code=ABCD1234', expiresIn: 1800 });
  assert.equal(JSON.parse(seen[0].init.body).client_id, POLLINATIONS_APP_KEY);

  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual((await call('/api/pollinations/login/check', { method: 'POST', body: {} }, tokens, fetch)).body, { pending: true });
  await new Promise((r) => setTimeout(r, 5));
  const done = await call('/api/pollinations/login/check', { method: 'POST', body: {} }, tokens, fetch);
  assert.deepEqual(done.body, { signedIn: true, username: 'octo' });
  assert.equal(tokens.keyFor('octo'), 'sk_user');
  // The page never sees the device code or the key.
  assert.ok(!JSON.stringify(start.body).includes('dev-1'));
  assert.ok(!JSON.stringify(done.body).includes('sk_user'));
});

test('sign-in: polling faster than the interval doesn’t reach Pollinations; a refusal ends it', async () => {
  const tokens = memoryTokens();
  let tokenCalls = 0;
  const fetch = async (url) => {
    if (url.endsWith('/api/device/code')) return jsonResponse({ device_code: 'd', user_code: 'U', verification_uri: 'https://enter.pollinations.ai/device', interval: 60 });
    tokenCalls += 1;
    return jsonResponse({ error: 'access_denied' }, 400);
  };
  await call('/api/pollinations/login', { method: 'POST', body: {} }, tokens, fetch);
  assert.deepEqual((await call('/api/pollinations/login/check', { method: 'POST', body: {} }, tokens, fetch)).body, { pending: true });
  assert.equal(tokenCalls, 0);
  assert.equal((await call('/api/pollinations/login/check', { method: 'POST', body: {} }, tokens, fetch)).body.pending, true);
});

test('sign-in: a verification address off Pollinations is refused', async () => {
  const fetch = async () => jsonResponse({ device_code: 'd', user_code: 'U', verification_uri_complete: 'https://evil.example/device' });
  const result = await call('/api/pollinations/login', { method: 'POST', body: {} }, memoryTokens(), fetch);
  assert.equal(result.status, 502);
});

test('status reports the budget left, and forgets a key Pollinations no longer accepts', async () => {
  const ok = await call('/api/pollinations', {}, memoryTokens('octo', 'sk_user'), async (url, init) => {
    assert.equal(url, 'https://gen.pollinations.ai/account/balance');
    assert.equal(init.headers.authorization, 'Bearer sk_user');
    return jsonResponse({ balance: 4.5 });
  });
  assert.deepEqual(ok.body, { signedIn: true, username: 'octo', balance: 4.5 });

  const tokens = memoryTokens('octo', 'sk_old');
  const expired = await call('/api/pollinations', {}, tokens, async () => jsonResponse({}, 401));
  assert.deepEqual(expired.body, { signedIn: false, username: '', expired: true });
  assert.equal(tokens.describe().hasKey, false);
});

test('image: generated with the saved key, answered with the keyless stored copy', async () => {
  let seen;
  const fetch = async (url, init) => {
    seen = { url, init };
    return new Response('jpeg', { headers: { 'content-type': 'image/jpeg', link: `<https://media.pollinations.ai/${MEDIA_ID}>; rel="enclosure"` } });
  };
  const result = await call('/api/pollinations/image', {
    method: 'POST', body: { url: 'https://gen.pollinations.ai/image/a%20red%20apple?model=flux&key=sk_someone_else' },
  }, memoryTokens('octo', 'sk_user'), fetch);
  assert.deepEqual(result.body, { url: `https://media.pollinations.ai/${MEDIA_ID}` });
  assert.equal(seen.url, 'https://gen.pollinations.ai/image/a%20red%20apple?model=flux');
  assert.equal(seen.init.headers.authorization, 'Bearer sk_user');
});

test('image: only Pollinations’ image endpoint, only when signed in; 401 signs out, 402 explains', async () => {
  const never = () => assert.fail('no request');
  assert.equal((await call('/api/pollinations/image', { method: 'POST', body: { url: 'https://gen.pollinations.ai/image/x' } }, memoryTokens(), never)).body.signedOut, true);
  for (const url of ['https://evil.example/image/x', 'https://gen.pollinations.ai/v1/chat/completions', 'https://gen.pollinations.ai/image/', 42]) {
    assert.equal((await call('/api/pollinations/image', { method: 'POST', body: { url } }, memoryTokens('o', 'sk'), never)).status, 400, String(url));
  }
  const tokens = memoryTokens('o', 'sk');
  const expired = await call('/api/pollinations/image', { method: 'POST', body: { url: 'https://gen.pollinations.ai/image/x' } }, tokens, async () => jsonResponse({}, 401));
  assert.equal(expired.body.signedOut, true);
  assert.equal(tokens.describe().hasKey, false);
  const broke = await call('/api/pollinations/image', { method: 'POST', body: { url: 'https://gen.pollinations.ai/image/x' } }, memoryTokens('o', 'sk'), async () => jsonResponse({}, 402));
  assert.match(broke.body.error, /Pollen/);
});

test('other sites can’t use the saved sign-in', async () => {
  const response = await handlePollinationsApi(
    request('/api/pollinations/image', { method: 'POST', body: { url: 'https://gen.pollinations.ai/image/x' }, origin: 'https://evil.example' }),
    {}, memoryTokens('o', 'sk'), { fetch: () => assert.fail('no request') },
  );
  assert.equal(response.status, 403);
});

test('only complete literal image URLs without a key are generated', () => {
  const files = {
    'index.html': `<img src="https://gen.pollinations.ai/image/a%20cat?model=x&amp;width=800">
<div style="background:url(https://gen.pollinations.ai/image/sky?seed=2)"></div>
<script>
const a = 'https://gen.pollinations.ai/image/dog';
const b = \`https://gen.pollinations.ai/image/\${prompt}\`;
const c = 'https://gen.pollinations.ai/image/' + encodeURIComponent(p);
const d = 'https://gen.pollinations.ai/image/a photo of ' + p;
const e = "https://gen.pollinations.ai/image/keyed?key=sk_x";
</script>`,
    'about.html': '<img src="https://gen.pollinations.ai/image/a%20cat?model=x&amp;width=800">',
  };
  assert.deepEqual(findImageRequests(files), [
    'https://gen.pollinations.ai/image/a%20cat?model=x&amp;width=800',
    'https://gen.pollinations.ai/image/sky?seed=2',
    'https://gen.pollinations.ai/image/dog',
  ]);
});

test('resolveImages swaps each address for its stored copy, on every page, and reports failures', async () => {
  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (path, init) => {
    const { url } = JSON.parse(init.body);
    asked.push(url);
    if (url.includes('broken')) return jsonResponse({ error: 'Pollinations couldn’t make the image (error 500).' }, 502);
    return jsonResponse({ url: `https://media.pollinations.ai/${url.includes('cat') ? 'cat1' : 'sky2'}` });
  };
  try {
    const files = {
      'index.html': '<img src="https://gen.pollinations.ai/image/cat?a=1&amp;b=2"><img src="https://gen.pollinations.ai/image/broken">',
      'about.html': '<p style="background:url(https://gen.pollinations.ai/image/sky)"></p><img src="https://gen.pollinations.ai/image/cat?a=1&amp;b=2">',
    };
    const result = await resolveImages(files);
    assert.equal(result.generated, 2);
    assert.equal(result.failed, 1);
    assert.match(result.error, /error 500/);
    assert.equal(result.files['index.html'], '<img src="https://media.pollinations.ai/cat1"><img src="https://gen.pollinations.ai/image/broken">');
    assert.equal(result.files['about.html'], '<p style="background:url(https://media.pollinations.ai/sky2)"></p><img src="https://media.pollinations.ai/cat1">');
    // Each image once, with &amp; decoded.
    assert.equal(asked.filter((u) => u.includes('cat')).length, 1);
    assert.ok(asked.includes('https://gen.pollinations.ai/image/cat?a=1&b=2'));
  } finally {
    globalThis.fetch = realFetch;
  }
});

// Runs the injected helper in a bare context with a stubbed fetch.
const runHelper = (html, fetch) => {
  const source = html.match(/<script data-appblips-pollinations>([\s\S]*?)<\/script>/)[1];
  const store = new Map();
  const context = {
    fetch, URLSearchParams, URL: { createObjectURL: () => 'blob:x' }, setTimeout, Promise, JSON, String, Object, Error, Date, Boolean,
    sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
  };
  context.window = context;
  vm.runInNewContext(source, context);
  return context.Pollinations;
};

test('the helper is only added to pages that call it, at the top of <head>', () => {
  const plain = '<html><head><title>x</title></head><body></body></html>';
  assert.equal(injectPollinationsHelper(plain), plain);
  const page = '<html><head><title>x</title></head><body><script>Pollinations.chat([])</script></body></html>';
  assert.ok(usesPollinationsHelper(page));
  assert.ok(injectPollinationsHelper(page).startsWith('<html><head><script data-appblips-pollinations>'));
});

test('site mode: the key is scrambled in the page but sent as a Bearer token', async () => {
  const key = 'sk_test_site_key_123';
  const html = injectPollinationsHelper('<head></head><script>Pollinations.chat()</script>', { siteKey: key, visitors: false });
  assert.ok(!html.includes(key));
  assert.ok(!html.includes('sk_'));
  let seen;
  const helper = runHelper(html, async (url, init) => {
    seen = { url, init };
    return jsonResponse({ choices: [{ message: { content: 'hello' } }] });
  });
  assert.equal(helper.isAvailable(), true);
  assert.equal(await helper.chat([{ role: 'user', content: 'hi' }]), 'hello');
  assert.equal(seen.url, 'https://gen.pollinations.ai/v1/chat/completions');
  assert.equal(seen.init.headers.Authorization, `Bearer ${key}`);
  // Two scrambles of the same key differ.
  assert.notDeepEqual(scrambleKey(key).data, scrambleKey(key).data);
});

test('site key chosen but not added: AI calls fail with the friendly message and nothing is sent', async () => {
  const html = injectPollinationsHelper('<head></head><script>Pollinations.chat()</script>');
  const helper = runHelper(html, () => assert.fail('no request'));
  assert.equal(helper.isAvailable(), false);
  await assert.rejects(helper.chat([]), (err) => err.code === 'unavailable' && err.message === 'AI features are unavailable right now.');
  // A spent or deleted site key reads the same to visitors.
  const spent = runHelper(injectPollinationsHelper('<head></head><script>Pollinations.chat()</script>', { siteKey: 'sk_test_site_key_123' }), async () => jsonResponse({}, 402));
  await assert.rejects(spent.chat([]), (err) => err.code === 'unavailable');
});

test('visitor mode: connect runs the device flow with AppBlips’ App Key and stores the visitor’s key', async () => {
  const html = injectPollinationsHelper('<head></head><script>Pollinations.chat()</script>', { visitors: true });
  const bodies = [];
  let chatAuth;
  const helper = runHelper(html, async (url, init) => {
    if (url.endsWith('/api/device/code') || url.endsWith('/api/device/token')) bodies.push(JSON.parse(init.body));
    if (url.endsWith('/api/device/code')) return jsonResponse({ device_code: 'd', user_code: 'CODE', verification_uri_complete: 'https://enter.pollinations.ai/device?user_code=CODE', interval: 0.001 });
    if (url.endsWith('/api/device/token')) return jsonResponse({ access_token: 'sk_visitor' });
    chatAuth = init.headers.Authorization;
    return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
  });
  assert.equal(helper.isConnected(), false);
  // Visitors are told about AppBlips' fee where they connect.
  assert.ok(html.includes(POLLINATIONS_VISITOR_FEE_NOTE) === POLLINATIONS_EARNINGS);
  let shown;
  await helper.connect((info) => { shown = info; });
  // Objects from the vm context have its prototypes, so compare their contents.
  assert.deepEqual({ ...shown }, { url: 'https://enter.pollinations.ai/device?user_code=CODE', code: 'CODE' });
  assert.deepEqual(bodies.map((b) => ({ ...b })), [
    { client_id: POLLINATIONS_APP_KEY },
    { device_code: 'd', client_id: POLLINATIONS_APP_KEY },
  ]);
  assert.equal(helper.isConnected(), true);
  assert.equal(await helper.chat([]), 'ok');
  assert.equal(chatAuth, 'Bearer sk_visitor');
});

test('site images: downloaded, renamed into images/, and pointed at or built in', async () => {
  const files = { 'index.html': `<img src="https://media.pollinations.ai/${MEDIA_ID}"><img src="https://media.pollinations.ai/gone">` };
  const { images, failed } = await collectSiteImages(files, {
    fetch: async (url) => (url.endsWith('/gone')
      ? new Response('', { status: 404 })
      : new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } })),
  });
  assert.equal(failed, 1);
  assert.deepEqual(images.map(({ path, type }) => ({ path, type })), [{ path: `images/${MEDIA_ID}.jpg`, type: 'image/jpeg' }]);
  assert.ok(SITE_IMAGE_PATH_RE.test(images[0].path));
  assert.equal(pointAtCopies(files, images)['index.html'], `<img src="images/${MEDIA_ID}.jpg"><img src="https://media.pollinations.ai/gone">`);
  assert.equal(inlineImages(files, images)['index.html'], '<img src="data:image/jpeg;base64,AQID"><img src="https://media.pollinations.ai/gone">');
});

test('connector state: sign-in status, the site key only once accepted, and what the AI is told', () => {
  const base = loadConnectors();
  assert.equal(connectorStatus('pollinations', { ...base, pollinations: { enabled: true, account: '' } }), 'needs-sign-in');
  const signedIn = { ...base, pollinations: { enabled: true, account: 'octo', siteKey: '', siteKeyAccepted: false } };
  assert.equal(connectorStatus('pollinations', signedIn), 'connected');
  assert.deepEqual(getActiveConnectors(signedIn), [{ id: 'pollinations', key: 'visitors' }]);

  const unaccepted = { ...base, pollinations: { ...signedIn.pollinations, siteKey: 'sk_abcdefghij' } };
  assert.equal(getPollinationsSiteKey(unaccepted), '');
  const accepted = { ...base, pollinations: { ...unaccepted.pollinations, siteKeyAccepted: true } };
  assert.equal(getPollinationsSiteKey(accepted), '', 'only used once the user picks "My key pays"');
  assert.equal(getPollinationsSiteKey({ ...base, pollinations: { ...accepted.pollinations, aiPayer: 'site' } }), 'sk_abcdefghij');
  assert.equal(getPollinationsSiteKey({ ...base, pollinations: { ...accepted.pollinations, aiPayer: 'site', enabled: false } }), '');

  // Who pays: visitors by default; the site key once chosen and accepted.
  assert.deepEqual(getPollinationsHelperOptions(accepted), { siteKey: '', visitors: true }, 'aiPayer defaults to visitors');
  const sitePays = { ...base, pollinations: { ...accepted.pollinations, aiPayer: 'site' } };
  assert.deepEqual(getActiveConnectors(sitePays), [{ id: 'pollinations', key: 'site' }]);
  assert.deepEqual(getPollinationsHelperOptions(sitePays), { siteKey: 'sk_abcdefghij', visitors: false });
  const siteNoKey = { ...base, pollinations: { ...signedIn.pollinations, aiPayer: 'site' } };
  assert.deepEqual(getActiveConnectors(siteNoKey), [{ id: 'pollinations', key: 'none' }]);
  assert.deepEqual(getPollinationsHelperOptions(siteNoKey), { siteKey: '', visitors: false });

  const visitors = buildConnectorDirective([{ id: 'pollinations', key: 'visitors' }], 'website');
  assert.match(visitors, /mountConnect\(thatDiv\)/);

  // Without a site key the AI is told not to build AI features and how to add the key.
  const noKey = buildConnectorDirective([{ id: 'pollinations', key: 'none' }], 'website');
  assert.match(noKey, /do NOT build it/);
  assert.match(noKey, /AI features in your sites/);
  assert.doesNotMatch(noKey, /Pollinations\.chat/);
  const withKey = buildConnectorDirective([{ id: 'pollinations', key: 'site' }], 'app');
  assert.match(withKey, /Pollinations\.chat/);
  assert.match(withKey, /don't add a sign-in or connect button/);
  for (const directive of [noKey, withKey, visitors]) assert.ok(!directive.includes('sk_') && !directive.includes(POLLINATIONS_APP_KEY));
  assert.equal(buildConnectorDirective([{ id: 'pollinations', key: 'none' }], 'game'), '');
});
