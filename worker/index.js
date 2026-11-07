// The online, multi-user side of AppBlips as a Cloudflare Worker. It holds
// the secret keys (Creem, Render, the server's AI provider) so they never
// ship in the desktop app, and answers only the hosted routes:
//   /api/chat             signed-in, subscribed users; the plan picks the model
//   /api/billing/*        plan status and Creem checkout
//   /api/webhooks/creem   Creem payment notices (signature-checked)
//   /api/sandbox/*        the user's Render Sandbox computer
// Bring-your-own-key users never reach it: their app talks to their provider.
// Same handlers as server.js; only the store (D1) and CORS are Worker-specific.

import { handleChatProxy, isForeignOrigin } from '../electron/server/chatProxy.js';
import { handleBilling } from '../electron/server/hosted/billing.js';
import { gateChat, refundBuildCredit } from '../electron/server/hosted/chat.js';
import { handleSandbox } from '../electron/server/hosted/sandbox.js';
import { isHosted } from '../electron/server/hosted/mode.js';
import { d1Store } from './d1Store.js';

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

const isRoute = (pathname, base) => pathname === base || pathname.startsWith(`${base}/`);

async function route(request, env, ctx) {
  const { pathname } = new URL(request.url);
  const store = d1Store(env.DB);

  if (pathname === '/api/webhooks/creem' || isRoute(pathname, '/api/billing')) {
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
    if (gated.charge && !response.ok) ctx.waitUntil(refundBuildCredit(env, gated.charge));
    return response;
  }

  return json(404, { error: 'Not found.' });
}

export default {
  async fetch(request, env, ctx) {
    if (!isHosted(env)) {
      return json(503, { error: 'This server is missing its Clerk or Creem key.' });
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
