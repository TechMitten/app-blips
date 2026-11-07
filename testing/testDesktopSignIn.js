// Desktop sign-in and plan forwarding: the app side (electron/hostedApi.js)
// and the Worker side (worker/desktopAuth.js) of the Google/GitHub round
// trip through the browser, plus how main forwards /api/* to the Worker.
// Self-contained: fetch is stubbed, nothing touches the network.
//   node testing/testDesktopSignIn.js

import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as acorn from 'acorn';
import {
  HOSTED_API_URL,
  allowClerkFromApp,
  browserSignInUrl,
  crossSiteCookie,
  forwardToHosted,
  isHostedRequest,
  readSignInLink,
} from '../electron/hostedApi.js';
import { handleDesktopAuth } from '../worker/desktopAuth.js';

const realFetch = globalThis.fetch;
const STATE = 'a'.repeat(43); // randomBytes(32).toString('base64url') length
const TICKET = 'sit_' + 'x'.repeat(40);
const CLERK_KEY = 'pk_live_Y2xlcmsuYXBwYmxpcHMuY29tJA'; // clerk.appblips.com

// ---- browserSignInUrl ---------------------------------------------------------
{
  const url = new URL(browserSignInUrl(STATE, 'google'));
  assert.equal(url.origin, 'https://auth.appblips.com');
  assert.equal(url.pathname, '/desktop-sign-in');
  assert.equal(url.searchParams.get('state'), STATE);
  assert.equal(url.searchParams.get('provider'), 'google');
  assert.equal(new URL(browserSignInUrl(STATE, 'github')).searchParams.get('provider'), 'github');
  // Anything else is left off, so the page shows Clerk's full form.
  for (const other of ['facebook', '', undefined, 'google&x=1']) {
    assert.equal(new URL(browserSignInUrl(STATE, other)).searchParams.has('provider'), false, `provider ${other}`);
  }
  assert.equal(HOSTED_API_URL.endsWith('/'), false);
}

// ---- readSignInLink: only well-formed appblips://auth links ----------------------
{
  const link = (ticket = TICKET, state = STATE, host = 'auth') => `appblips://${host}?ticket=${ticket}&state=${state}`;
  assert.deepEqual(readSignInLink(['/opt/AppBlips/appblips', '--flag', link()]), { ticket: TICKET, state: STATE });
  // The first valid one wins; junk before it is skipped.
  assert.deepEqual(readSignInLink([null, 42, 'appblips://auth?bad', link()]), { ticket: TICKET, state: STATE });

  const rejected = {
    'no links': [],
    'not an array': 'appblips://auth?ticket=x',
    'other host': [link(TICKET, STATE, 'auth.evil.example')],
    'userinfo trick': [link(TICKET, STATE, 'auth@evil.example')],
    'app host': [link(TICKET, STATE, 'app')],
    'other scheme': [`https://auth?ticket=${TICKET}&state=${STATE}`],
    'short ticket': [link('short')],
    'ticket with symbols': [link(`${'x'.repeat(30)}%3Cscript%3E`)],
    'short state': [link(TICKET, 'abc')],
    'state with symbols': [link(TICKET, `${'a'.repeat(40)}.`)],
    'missing state': [`appblips://auth?ticket=${TICKET}`],
    'missing ticket': [`appblips://auth?state=${STATE}`],
    'huge ticket': [link('x'.repeat(5000))],
  };
  for (const [name, argv] of Object.entries(rejected)) {
    assert.equal(readSignInLink(argv), null, name);
  }
}

// ---- isHostedRequest: own-key chat stays local ------------------------------------
{
  const req = (headers = {}) => new Request('appblips://app/api/chat', { method: 'POST', headers });
  assert.equal(isHostedRequest(req(), '/api/chat'), false, 'own-key chat is answered locally');
  assert.equal(isHostedRequest(req({ authorization: 'Bearer t' }), '/api/chat'), true, 'signed-in chat goes to the Worker');
  for (const path of ['/api/billing', '/api/billing/status', '/api/sandbox', '/api/sandbox/start']) {
    assert.equal(isHostedRequest(req(), path), true, path);
  }
  for (const path of ['/api/billingx', '/api/provider', '/api/sandboxes', '/api/chat/x', '/api/surge']) {
    assert.equal(isHostedRequest(req({ authorization: 'Bearer t' }), path), false, path);
  }
}

// ---- forwardToHosted ---------------------------------------------------------------
async function testForwarding() {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response('data: hi\n\n', {
      status: 201,
      statusText: 'Created',
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'retry-after': '5',
        'set-cookie': 'session=1',
        'access-control-allow-origin': '*',
      },
    });
  };
  try {
    const request = new Request('appblips://app/api/billing/checkout?plan=pro', {
      method: 'POST',
      headers: {
        authorization: 'Bearer tok',
        'content-type': 'application/json',
        cookie: 'secret=1',
        'x-custom': 'nope',
        origin: 'https://evil.example',
      },
      body: '{"plan":"pro"}',
    });
    const url = new URL(request.url);
    const res = await forwardToHosted(request, url, 'appblips://app', 'https://worker.test');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://worker.test/api/billing/checkout?plan=pro');
    const sent = calls[0].init.headers;
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(sent.get('authorization'), 'Bearer tok');
    assert.equal(sent.get('content-type'), 'application/json');
    assert.equal(sent.get('origin'), 'appblips://app', 'the Origin is always the app\'s own');
    assert.equal(sent.get('cookie'), null, 'cookies are not forwarded');
    assert.equal(sent.get('x-custom'), null, 'only listed headers are forwarded');
    assert.equal(new TextDecoder().decode(calls[0].init.body), '{"plan":"pro"}');

    assert.equal(res.status, 201);
    assert.equal(res.headers.get('content-type'), 'text/event-stream');
    assert.equal(res.headers.get('retry-after'), '5');
    assert.equal(res.headers.get('set-cookie'), null, 'Worker cookies are dropped');
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    assert.equal(await res.text(), 'data: hi\n\n', 'the body streams through');

    // GET carries no body; no app origin (npm run dev) sends no Origin.
    calls.length = 0;
    const get = new Request('appblips://app/api/billing', { headers: { authorization: 'Bearer tok' } });
    await forwardToHosted(get, new URL(get.url), '', 'https://worker.test');
    assert.equal(calls[0].init.body, undefined);
    assert.equal(calls[0].init.headers.get('origin'), null);

    // Offline: a readable 502, not an exception.
    globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
    const warn = console.warn;
    console.warn = () => {};
    try {
      const offline = await forwardToHosted(get, new URL(get.url), 'appblips://app', 'https://worker.test');
      assert.equal(offline.status, 502);
      assert.match((await offline.json()).error, /internet connection/);

      // Cancelled by the renderer: rethrown, so the abort isn't reported as an outage.
      const controller = new AbortController();
      controller.abort();
      const aborted = new Request('appblips://app/api/billing', { signal: controller.signal });
      await assert.rejects(forwardToHosted(aborted, new URL(aborted.url), 'appblips://app', 'https://worker.test'));
    } finally {
      console.warn = warn;
    }
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ---- allowClerkFromApp -------------------------------------------------------------
function testClerkOrigin() {
  const hooks = {};
  const session = {
    webRequest: {
      onBeforeSendHeaders: (filter, fn) => { hooks.send = { filter, fn }; },
      onHeadersReceived: (filter, fn) => { hooks.receive = { filter, fn }; },
    },
  };
  allowClerkFromApp(session, 'appblips://app');
  assert.deepEqual(hooks.send.filter.urls, ['https://clerk.appblips.com/*'], 'only Clerk\'s own host');
  assert.deepEqual(hooks.receive.filter.urls, ['https://clerk.appblips.com/*']);

  const send = (requestHeaders) => {
    let out;
    hooks.send.fn({ requestHeaders }, (result) => { out = result.requestHeaders; });
    return out;
  };
  assert.equal(send({ Origin: 'appblips://app' }).Origin, 'https://www.appblips.com');
  assert.equal(send({ origin: 'appblips://app' }).origin, 'https://www.appblips.com', 'any header case');
  // Requests from anywhere else (a preview frame's opaque origin, another site) keep theirs.
  assert.equal(send({ Origin: 'null' }).Origin, 'null');
  assert.equal(send({ Origin: 'https://evil.example' }).Origin, 'https://evil.example');
  assert.deepEqual(send({ Accept: '*/*' }), { Accept: '*/*' });
  // Clerk's cookies go only with the app's own requests.
  assert.equal(send({ Origin: 'appblips://app', Cookie: '__client=abc' }).Cookie, '__client=abc');
  assert.equal('Cookie' in send({ Origin: 'null', Cookie: '__client=abc' }), false, 'a preview frame gets no sign-in cookie');
  assert.equal('cookie' in send({ cookie: '__client=abc' }), false, 'nor does a request without an Origin');

  const receive = (responseHeaders) => {
    let out;
    hooks.receive.fn({ responseHeaders }, (result) => { out = result.responseHeaders; });
    return out;
  };
  assert.deepEqual(receive({ 'Access-Control-Allow-Origin': ['https://www.appblips.com'] })['Access-Control-Allow-Origin'], ['appblips://app']);
  assert.deepEqual(receive({ 'access-control-allow-origin': ['https://other.example'] })['access-control-allow-origin'], ['https://other.example']);
  // As Clerk's production instance sends them (Lax, so never sent from appblips://app).
  const clerkCookies = [
    '__client=eyJ.x.y; Path=/; Domain=clerk.appblips.com; Max-Age=315360000; HttpOnly; Secure; SameSite=Lax',
    '__client_uat=0; Path=/; Domain=appblips.com; Max-Age=315360000; Secure; SameSite=Lax',
    '_cfuvid=abc; HttpOnly; SameSite=None; Secure; Path=/; Domain=clerk.appblips.com',
  ];
  assert.deepEqual(receive({ 'set-cookie': clerkCookies })['set-cookie'], [
    '__client=eyJ.x.y; Path=/; Domain=clerk.appblips.com; Max-Age=315360000; HttpOnly; Secure; SameSite=None',
    '__client_uat=0; Path=/; Domain=appblips.com; Max-Age=315360000; Secure; SameSite=None',
    '_cfuvid=abc; HttpOnly; SameSite=None; Secure; Path=/; Domain=clerk.appblips.com',
  ]);
  assert.equal(crossSiteCookie('a=1; Secure; SameSite=Strict'), 'a=1; Secure; SameSite=None');
  assert.equal(crossSiteCookie('a=1; Path=/; Secure'), 'a=1; Path=/; Secure; SameSite=None', 'no SameSite means Lax');
  assert.equal(crossSiteCookie('a=1; SameSite=Lax'), 'a=1; SameSite=Lax', 'never SameSite=None without Secure');
  assert.equal(crossSiteCookie('a=1; SecureX=1; SameSite=Lax'), 'a=1; SecureX=1; SameSite=Lax');
}

// ---- Worker: /desktop-sign-in page and script ----------------------------------------
async function testSignInPage() {
  const env = { VITE_CLERK_PUBLISHABLE_KEY: CLERK_KEY, CLERK_SECRET_KEY: 'sk_test_secret' };
  const page = handleDesktopAuth(new Request('https://auth.appblips.com/desktop-sign-in?state=x'), env, null);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const csp = page.headers.get('content-security-policy');
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.doesNotMatch(csp.split(';').find((d) => d.trim().startsWith('script-src')), /unsafe-inline/, 'no inline scripts allowed');
  const html = await page.text();
  assert.match(html, /src="https:\/\/clerk\.appblips\.com\/npm\/@clerk\/clerk-js@6\//);
  assert.match(html, /data-clerk-publishable-key="pk_live_Y2xlcmsuYXBwYmxpcHMuY29tJA"/);
  assert.match(html, /<script defer src="\/desktop-sign-in.js"><\/script>/);
  assert.doesNotMatch(html, /<script>/, 'every script is external (CSP)');
  assert.doesNotMatch(html, /sk_test_secret/, 'the secret key never reaches the page');

  // Without a usable publishable key the page says so instead of half-loading.
  for (const key of ['', 'nope', 'pk_live_', 'pk_live_***']) {
    const res = handleDesktopAuth(new Request('https://auth.appblips.com/desktop-sign-in'), { VITE_CLERK_PUBLISHABLE_KEY: key }, null);
    assert.equal(res.status, 503, `key ${JSON.stringify(key)}`);
  }

  // Other routes and methods are left to the rest of the Worker.
  assert.equal(handleDesktopAuth(new Request('https://auth.appblips.com/'), env, null), null);
  assert.equal(handleDesktopAuth(new Request('https://auth.appblips.com/desktop-sign-in', { method: 'POST' }), env, null), null);
  assert.equal(handleDesktopAuth(new Request('https://auth.appblips.com/api/billing'), env, null), null);

  const scriptRes = handleDesktopAuth(new Request('https://auth.appblips.com/desktop-sign-in.js'), env, null);
  assert.equal(scriptRes.status, 200);
  assert.match(scriptRes.headers.get('content-type'), /javascript/);
  assert.equal(scriptRes.headers.get('x-content-type-options'), 'nosniff');
  const script = await scriptRes.text();
  acorn.parse(script, { ecmaVersion: 2022, sourceType: 'script' }); // throws on a syntax error
  return script;
}

// Runs the page script against a fake page and Clerk, and returns what it did.
async function runPageScript(script, { search, hash = '', clerk, ticketResponse }) {
  const elements = {};
  const el = (id) => (elements[id] ||= {
    id, hidden: false, textContent: '', href: '', onclick: null,
    classList: { toggle(name, on) { this[name] = on; } },
  });
  const fetches = [];
  const page = { href: null };
  const ctx = {
    document: { getElementById: el },
    location: {
      search, hash, origin: 'https://auth.appblips.com', pathname: '/desktop-sign-in',
      set href(value) { page.href = value; },
    },
    URLSearchParams, setTimeout, Date, Promise, Error,
    fetch: async (url, init) => {
      fetches.push({ url, init });
      return ticketResponse;
    },
    __internal_ClerkUICtor: function ClerkUI() {},
    Clerk: clerk,
  };
  ctx.window = ctx;
  vm.runInNewContext(script, ctx);
  for (let i = 0; i < 50; i += 1) await new Promise((resolve) => setImmediate(resolve));
  return { elements, fetches, page };
}

function fakeClerk({ user = null } = {}) {
  const calls = [];
  return {
    calls,
    user,
    session: { getToken: async () => 'browser-session-token' },
    load: async () => { calls.push('load'); },
    signOut: async () => { calls.push('signOut'); },
    mountSignIn: (_el, options) => { calls.push(['mountSignIn', options]); },
    client: { signIn: { authenticateWithRedirect: async (options) => { calls.push(['redirect', options]); } } },
  };
}

async function testPageScript(script) {
  // A bad state is refused before anything loads.
  {
    const clerk = fakeClerk();
    const { elements } = await runPageScript(script, { search: '?state=short', clerk });
    assert.match(elements.message.textContent, /incomplete/);
    assert.equal(elements.message.classList.error, true);
    assert.deepEqual(clerk.calls, []);
  }

  // provider=google goes straight to Google, coming back to the page without the provider.
  {
    const clerk = fakeClerk();
    await runPageScript(script, { search: `?state=${STATE}&provider=google`, clerk });
    const redirect = clerk.calls.find((c) => c[0] === 'redirect');
    assert.ok(redirect, 'redirected to the provider');
    assert.equal(redirect[1].strategy, 'oauth_google');
    assert.equal(redirect[1].redirectUrl, `https://auth.appblips.com/desktop-sign-in?state=${STATE}#/sso-callback`);
    assert.equal(redirect[1].redirectUrlComplete, `https://auth.appblips.com/desktop-sign-in?state=${STATE}&done=1`);
  }

  // An unknown provider gets Clerk's full form.
  {
    const clerk = fakeClerk();
    await runPageScript(script, { search: `?state=${STATE}&provider=evil`, clerk });
    assert.equal(clerk.calls.some((c) => c[0] === 'redirect'), false);
    assert.ok(clerk.calls.some((c) => c[0] === 'mountSignIn'));
  }

  // Signed in already (not coming back from done): asks before handing off.
  {
    const clerk = fakeClerk({ user: { primaryEmailAddress: { emailAddress: 'a@b.test' } } });
    const { elements, fetches } = await runPageScript(script, { search: `?state=${STATE}`, clerk });
    assert.match(elements.message.textContent, /signed in as a@b\.test/);
    assert.equal(elements.choice.hidden, false);
    assert.equal(fetches.length, 0, 'no ticket without the person choosing Continue');
  }

  // Back from sign-in: gets a ticket, signs the browser out, opens the app link.
  {
    const clerk = fakeClerk({ user: {} });
    const ticketResponse = new Response(JSON.stringify({ ticket: TICKET }), { status: 200 });
    const { fetches, page, elements } = await runPageScript(script, { search: `?state=${STATE}&done=1`, clerk, ticketResponse });
    assert.equal(fetches.length, 1);
    assert.equal(fetches[0].url, '/api/desktop-auth/ticket');
    assert.equal(fetches[0].init.method, 'POST');
    assert.equal(fetches[0].init.headers.authorization, 'Bearer browser-session-token');
    assert.ok(clerk.calls.includes('signOut'), 'the browser keeps no session');
    const link = new URL(page.href);
    assert.equal(link.protocol, 'appblips:');
    assert.equal(link.host, 'auth');
    assert.equal(link.searchParams.get('ticket'), TICKET);
    assert.equal(link.searchParams.get('state'), STATE);
    assert.equal(elements['open-app'].href, page.href);
    // ...and the app accepts exactly that link.
    assert.deepEqual(readSignInLink([page.href]), { ticket: TICKET, state: STATE });
  }

  // The ticket request fails: an error, no link.
  {
    const clerk = fakeClerk({ user: {} });
    const ticketResponse = new Response(JSON.stringify({ error: 'Your session has expired. Sign in again.' }), { status: 401 });
    const { page, elements } = await runPageScript(script, { search: `?state=${STATE}&done=1`, clerk, ticketResponse });
    assert.equal(page.href, null);
    assert.match(elements.message.textContent, /expired/);
    assert.equal(elements.message.classList.error, true);
  }
}

// ---- Worker: POST /api/desktop-auth/ticket ---------------------------------------------
async function testTicketEndpoint() {
  const env = { VITE_CLERK_PUBLISHABLE_KEY: CLERK_KEY, CLERK_SECRET_KEY: 'sk_live_secret' };
  const verify = async (token) => {
    if (token !== 'good-token') throw new Error('bad token');
    return { sub: 'user_123' };
  };
  const post = (headers = {}, method = 'POST') => new Request('https://auth.appblips.com/api/desktop-auth/ticket', { method, headers, body: method === 'POST' ? '{}' : undefined });
  const clerkCalls = [];
  let clerkReply = () => new Response(JSON.stringify({ token: TICKET }), { status: 200 });
  globalThis.fetch = async (url, init) => {
    clerkCalls.push({ url, init });
    return clerkReply();
  };
  const error = console.error;
  console.error = () => {};
  try {
    assert.equal((await handleDesktopAuth(post({}, 'GET'), env, verify)).status, 405);
    assert.equal((await handleDesktopAuth(post(), env, verify)).status, 401, 'no token');
    assert.equal((await handleDesktopAuth(post({ authorization: 'Basic abc' }), env, verify)).status, 401, 'not a bearer token');
    const expired = await handleDesktopAuth(post({ authorization: 'Bearer old-token' }), env, verify);
    assert.equal(expired.status, 401);
    assert.match((await expired.json()).error, /expired/);
    assert.equal(clerkCalls.length, 0, 'Clerk is never asked for a ticket without a valid session');

    const noSecret = await handleDesktopAuth(post({ authorization: 'Bearer good-token' }), { ...env, CLERK_SECRET_KEY: ' ' }, verify);
    assert.equal(noSecret.status, 503);

    const ok = await handleDesktopAuth(post({ authorization: 'Bearer good-token' }), env, verify);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await ok.json(), { ticket: TICKET });
    assert.equal(clerkCalls.length, 1);
    assert.equal(clerkCalls[0].url, 'https://api.clerk.com/v1/sign_in_tokens');
    assert.equal(clerkCalls[0].init.headers.authorization, 'Bearer sk_live_secret');
    assert.deepEqual(JSON.parse(clerkCalls[0].init.body), { user_id: 'user_123', expires_in_seconds: 300 },
      'the ticket is for the verified user only, and short-lived');

    clerkReply = () => new Response(JSON.stringify({ errors: [{ message: 'nope' }] }), { status: 422 });
    const failed = await handleDesktopAuth(post({ authorization: 'Bearer good-token' }), env, verify);
    assert.equal(failed.status, 502);
    assert.equal(JSON.stringify(await failed.json()).includes('nope'), false, 'Clerk\'s error details stay in the log');

    clerkReply = () => { throw new TypeError('fetch failed'); };
    assert.equal((await handleDesktopAuth(post({ authorization: 'Bearer good-token' }), env, verify)).status, 502);
  } finally {
    globalThis.fetch = realFetch;
    console.error = error;
  }
}

await testForwarding();
testClerkOrigin();
const script = await testSignInPage();
await testPageScript(script);
await testTicketEndpoint();
console.log('Desktop sign-in checks passed: sign-in links, plan forwarding, Clerk origin rewrite, the browser sign-in page and the ticket endpoint.');
