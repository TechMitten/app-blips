// The online, multi-user side of AppBlips as a Cloudflare Worker. It holds
// the secret keys (Polar, Render, the server's AI provider) so they never
// ship in the desktop app, and answers only the hosted routes:
//   /api/chat             signed-in, subscribed users; the plan picks the model
//   /api/billing/*        plan status and Polar checkout
//   /api/webhooks/polar   Polar payment notices (signature-checked)
//   /api/sandbox/*        the user's Render Sandbox computer
//   /desktop-sign-in      Google/GitHub sign-in for the desktop app (desktopAuth.js)
// Bring-your-own-key users never reach it: their app talks to their provider.
// Same handlers as server.js; only the store (D1) and CORS are Worker-specific.

import { handleChatProxy, isForeignOrigin } from '../electron/server/chatProxy.js';
import { handleBilling } from '../electron/server/hosted/billing.js';
import { gateChat, releaseBuild } from '../electron/server/hosted/chat.js';
import { handleSandbox } from '../electron/server/hosted/sandbox.js';
import { isHosted } from '../electron/server/hosted/mode.js';
import { d1Store } from './d1Store.js';
import { handleDesktopAuth } from './desktopAuth.js';
import { verifyClerkToken } from '../electron/server/hosted/clerk.js';

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

// The desktop app (appblips://app) and any listed site call this from
// another origin, so allowed origins get CORS headers. Others get none, and
// isForeignOrigin turns them away before any work is done.
const withCors = (response, origin) => {
  if (!origin) return response;
  const out = new Response(response.body, response);
  out.headers.set('Access-Control-Allow-Origin', origin);
  out.headers.set('Vary', 'Origin');
  return out;
};

const preflight = (origin) => new Response(null, {
  status: 204,
  headers: {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, accept',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  },
});

// Where Polar sends the browser after a desktop checkout (billing.js makes
// the success URL from this Worker's own address). The app itself notices
// the payment (waitForPlan in src/lib/billing.js), so this only says to go
// back to it.
const CHECKOUT_DONE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Payment received · AppBlips</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; box-sizing: border-box;
    background: #0a0a0a; color: #f5f5f5; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 420px; text-align: center; }
  h1 { font-size: 1.5rem; margin: 0 0 8px; }
  p { margin: 0; color: #c7c7c7; }
</style>
</head>
<body>
<main>
  <h1>Payment received</h1>
  <p>Thanks for subscribing. You can close this tab and go back to AppBlips: your plan appears there within a few seconds.</p>
</main>
</body>
</html>`;

const checkoutDone = () => new Response(CHECKOUT_DONE_PAGE, {
  status: 200,
  headers: {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  },
});

const isRoute = (pathname, base) => pathname === base || pathname.startsWith(`${base}/`);

async function route(request, env, ctx) {
  const { pathname } = new URL(request.url);
  if (pathname === '/' && request.method === 'GET') return checkoutDone();
  // Google/GitHub sign-in for the desktop app, through the browser.
  const desktopAuth = handleDesktopAuth(request, env, verifyClerkToken);
  if (desktopAuth) return desktopAuth;
  const store = d1Store(env.DB);

  if (pathname === '/api/webhooks/polar' || isRoute(pathname, '/api/billing')) {
    return handleBilling(request, env, store);
  }

  if (isRoute(pathname, '/api/sandbox')) {
    return handleSandbox(request, env, store);
  }

  if (pathname === '/api/chat') {
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    const gated = await gateChat(request, env, store);
    if (gated.response) return gated.response;
    const response = await handleChatProxy(gated.request, env);
    // A rejected request didn't produce a build; don't charge for it.
    if (!response.ok) ctx.waitUntil(releaseBuild(env, store, gated));
    return response;
  }

  return json(404, { error: 'Not found.' });
}

export default {
  async fetch(request, env, ctx) {
    if (!isHosted(env)) {
      return json(503, { error: 'This server is missing its Clerk key or Polar token.' });
    }
    const origin = request.headers.get('origin');
    if (origin && isForeignOrigin(request, env)) {
      return json(403, { error: 'Requests from other sites are not allowed.' });
    }
    if (request.method === 'OPTIONS') {
      return origin ? preflight(origin) : new Response(null, { status: 204 });
    }
    try {
      return withCors(await route(request, env, ctx), origin);
    } catch (err) {
      console.error('[worker] request failed:', request.url, err);
      return withCors(json(500, { error: 'Internal error.' }), origin);
    }
  },
};
