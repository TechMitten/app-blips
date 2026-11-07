// Google and GitHub sign-in for the desktop app. Neither can finish inside
// the app: the provider's page would have to come back to appblips://app,
// which a browser can't open, and Google refuses sign-in in embedded app
// windows. So the app opens this page in the person's own browser:
//
//   1. desktop app → https://auth.appblips.com/desktop-sign-in?state=…&provider=google
//      (state: a one-time random value the app keeps in its main process)
//   2. this page signs in with Clerk (straight to Google/GitHub when a
//      provider is given, Clerk's full form otherwise)
//   3. POST /api/desktop-auth/ticket with the browser session's token →
//      a Clerk sign-in token (one use, 5 minutes), made with the secret key
//   4. the browser opens appblips://auth?ticket=…&state=…; the OS hands it to
//      the running app, which checks the state and signs in with the ticket
//
// The page must be on an appblips.com address: Clerk's production instance
// refuses any other origin. The browser session is signed out after the
// hand-off, so nothing stays signed in in the browser.

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

const CLERK_API = 'https://api.clerk.com/v1';
const TICKET_SECONDS = 300;

// https://<frontend-api-host> from the publishable key (see clerk.js).
function clerkFrontendHost(env) {
  const match = /^pk_(?:test|live)_(.+)$/.exec(String(env?.VITE_CLERK_PUBLISHABLE_KEY || '').trim());
  if (!match) return null;
  try {
    return atob(match[1]).replace(/\$+$/, '') || null;
  } catch {
    return null;
  }
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function signInPage(env) {
  const host = clerkFrontendHost(env);
  if (!host) return new Response('Sign-in is not configured.', { status: 503 });
  const key = escapeHtml(String(env.VITE_CLERK_PUBLISHABLE_KEY).trim());
  // Clerk's browser builds: the core (major 6) and its UI (major 1), from
  // the instance's own host, as @clerk/react loads them.
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Sign in to AppBlips</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 32px 16px;
    background: #0a0a0a; color: #f5f5f5; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { width: 100%; max-width: 440px; display: flex; flex-direction: column; align-items: center; gap: 18px; text-align: center; }
  h1 { margin: 0; font-size: 1.4rem; }
  p { margin: 0; color: #c7c7c7; }
  .card { width: 100%; padding: 22px; border: 1px solid rgb(255 255 255 / 0.12); border-radius: 16px; background: #141414; display: flex; flex-direction: column; gap: 14px; align-items: center; }
  button, a.button { display: inline-flex; justify-content: center; align-items: center; min-height: 42px; padding: 0 18px; border: 0; border-radius: 10px;
    font: 600 0.95rem system-ui, sans-serif; text-decoration: none; cursor: pointer; }
  .primary { background: #f5f5f5; color: #0a0a0a; }
  .secondary { background: transparent; color: #f5f5f5; border: 1px solid rgb(255 255 255 / 0.25); }
  button:focus-visible, a.button:focus-visible { outline: 2px solid #ffffff; outline-offset: 2px; }
  [hidden] { display: none !important; }
  .error { color: #fca5a5; }
</style>
</head>
<body>
<main>
  <h1 id="title">Sign in to AppBlips</h1>
  <p id="message">Loading…</p>
  <div id="clerk"></div>
  <div id="choice" class="card" hidden>
    <button type="button" class="primary" id="continue">Continue</button>
    <button type="button" class="secondary" id="switch">Use a different account</button>
  </div>
  <div id="opened" class="card" hidden>
    <a class="button primary" id="open-app">Open AppBlips</a>
    <p>If nothing happened, click Open AppBlips. You can close this tab once the app is signed in.</p>
  </div>
</main>
<script async crossorigin="anonymous" data-clerk-publishable-key="${key}" src="https://${host}/npm/@clerk/clerk-js@6/dist/clerk.browser.js"></script>
<script async crossorigin="anonymous" src="https://${host}/npm/@clerk/ui@1/dist/ui.browser.js"></script>
<script defer src="/desktop-sign-in.js"></script>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      // Clerk's documented CSP needs: its host for scripts and API calls,
      // Cloudflare Turnstile (bot protection) in a frame, its avatar images,
      // inline styles for its UI, and blob: workers.
      'content-security-policy': [
        "default-src 'self'",
        `script-src 'self' https://${host} https://*.clerk.com https://challenges.cloudflare.com`,
        // Clerk's bot protection probes *.clerk.com on several ports.
        `connect-src 'self' https://${host} https://*.clerk.com https://*.clerk.com:* https://clerk-telemetry.com`,
        "img-src 'self' https://img.clerk.com data:",
        "style-src 'self' 'unsafe-inline'",
        'frame-src https://challenges.cloudflare.com',
        "worker-src 'self' blob:",
        "form-action 'self'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
      ].join('; '),
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}

// The page's script. Plain browser JS, served from this Worker so the CSP
// needs no inline scripts.
const PAGE_SCRIPT = `(() => {
  const $ = (id) => document.getElementById(id);
  const say = (text, isError) => { $('message').textContent = text; $('message').classList.toggle('error', Boolean(isError)); };
  const params = new URLSearchParams(location.search);
  const state = params.get('state') || '';
  const provider = params.get('provider') || '';
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(state)) {
    say('This sign-in link is incomplete. Go back to AppBlips and click Continue with Google or GitHub again.', true);
    return;
  }
  // Every return to this page drops the provider, so it can't loop.
  const pageUrl = location.origin + location.pathname + '?' + new URLSearchParams({ state });
  const doneUrl = pageUrl + '&done=1';

  const waitFor = (test) => new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => (test() ? resolve() : Date.now() - started > 20000 ? reject(new Error('timeout')) : setTimeout(tick, 50));
    tick();
  });

  async function handOff() {
    $('choice').hidden = true;
    $('clerk').hidden = true;
    say('Signing you in to the app…');
    try {
      const token = await window.Clerk.session.getToken();
      const res = await fetch('/api/desktop-auth/ticket', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: '{}',
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || !body.ticket) throw new Error((body && body.error) || 'Could not finish signing in.');
      // The app gets its own session from the ticket; the browser keeps none.
      await window.Clerk.signOut().catch(() => {});
      const link = 'appblips://auth?' + new URLSearchParams({ ticket: body.ticket, state });
      $('open-app').href = link;
      $('title').textContent = 'Back to AppBlips';
      say('Your browser may ask to open AppBlips. Allow it, and the app finishes signing you in.');
      $('opened').hidden = false;
      location.href = link;
    } catch (err) {
      say((err && err.message) || 'Could not finish signing in. Go back to AppBlips and try again.', true);
    }
  }

  function showForm() {
    say('Sign in or create an account. You’ll go back to the app afterwards.');
    $('clerk').hidden = false;
    window.Clerk.mountSignIn($('clerk'), {
      routing: 'hash',
      withSignUp: true,
      forceRedirectUrl: doneUrl,
      signUpForceRedirectUrl: doneUrl,
    });
  }

  (async () => {
    try {
      await waitFor(() => window.Clerk && window.__internal_ClerkUICtor);
      await window.Clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });
    } catch {
      say('Could not load sign-in. Check your connection and reload this page.', true);
      return;
    }
    const clerk = window.Clerk;
    // Coming back from Google or GitHub: Clerk's form finishes the sign-in
    // (or the new account), then sends the page to doneUrl.
    if (location.hash.startsWith('#/sso-callback')) { showForm(); return; }
    if (clerk.user) {
      if (params.get('done') === '1') { handOff(); return; }
      const email = clerk.user.primaryEmailAddress && clerk.user.primaryEmailAddress.emailAddress;
      say('This browser is signed in' + (email ? ' as ' + email : '') + '. Sign in to the app with this account?');
      $('choice').hidden = false;
      $('continue').onclick = handOff;
      $('switch').onclick = async () => { $('choice').hidden = true; await clerk.signOut(); showForm(); };
      return;
    }
    if (provider === 'google' || provider === 'github') {
      say('Opening ' + (provider === 'google' ? 'Google' : 'GitHub') + '…');
      try {
        await clerk.client.signIn.authenticateWithRedirect({
          strategy: 'oauth_' + provider,
          redirectUrl: pageUrl + '#/sso-callback',
          redirectUrlComplete: doneUrl,
        });
        return;
      } catch {
        // Fall through to the full form.
      }
    }
    showForm();
  })();
})();
`;

async function createTicket(request, env, verifyClerkToken) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return json(401, { error: 'Sign in to continue.' });
  let userId;
  try {
    userId = (await verifyClerkToken(token, env)).sub;
  } catch {
    return json(401, { error: 'Your session has expired. Sign in again.' });
  }
  const secret = String(env.CLERK_SECRET_KEY || '').trim();
  if (!secret) return json(503, { error: 'Desktop sign-in is not set up on the server yet.' });
  let res;
  try {
    res = await fetch(`${CLERK_API}/sign_in_tokens`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: userId, expires_in_seconds: TICKET_SECONDS }),
    });
  } catch {
    return json(502, { error: 'Could not reach the sign-in service. Try again.' });
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.token) {
    console.error('[desktop-auth] sign-in token failed:', res.status, JSON.stringify(body?.errors || body).slice(0, 300));
    return json(502, { error: 'Could not finish signing in. Try again.' });
  }
  return json(200, { ticket: body.token });
}

// Returns a Response for the desktop sign-in routes, or null for others.
export function handleDesktopAuth(request, env, verifyClerkToken) {
  const { pathname } = new URL(request.url);
  if (pathname === '/desktop-sign-in' && request.method === 'GET') return signInPage(env);
  if (pathname === '/desktop-sign-in.js' && request.method === 'GET') {
    return new Response(PAGE_SCRIPT, {
      status: 200,
      headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' },
    });
  }
  if (pathname === '/api/desktop-auth/ticket') return createTicket(request, env, verifyClerkToken);
  return null;
}
