// AppBlips plans in the desktop app. The plan side (Clerk sign-in, Creem
// checkout, the server's AI key) lives in the Cloudflare Worker (worker/),
// because its secret keys can't ship in the app. The renderer keeps calling
// the same relative /api/* paths as everywhere else; main forwards the plan
// ones to the Worker here, so no renderer code needs a second address and
// nothing on the Worker needs to trust the renderer beyond the Clerk token.
//
// Own-key users never reach the Worker: /api/chat goes to the Worker only
// with a Clerk token (signed in = plan user), like server.js decides.

// APPBLIPS_API_URL points a terminal-launched app at another Worker, such as
// `wrangler dev` (http://127.0.0.1:8787), for testing.
export const HOSTED_API_URL = String(process.env.APPBLIPS_API_URL || 'https://appblips-api.islandapps.workers.dev').replace(/\/+$/, '');

// Clerk's production Frontend API, named by the publishable key that the
// renderer is built with (src/lib/accounts.js).
const CLERK_FAPI_HOST = 'clerk.appblips.com';
// The site Clerk's production instance belongs to. Clerk refuses any other
// Origin on its API ("must be equal to or a subdomain of the requesting URL"),
// and appblips://app is neither.
const CLERK_SITE_ORIGIN = 'https://www.appblips.com';

const isRoute = (pathname, base) => pathname === base || pathname.startsWith(`${base}/`);

export function isHostedRequest(request, pathname) {
  if (isRoute(pathname, '/api/billing') || isRoute(pathname, '/api/sandbox')) return true;
  return pathname === '/api/chat' && request.headers.has('authorization');
}

// Only the headers the Worker's handlers read. The Origin is the app's own,
// which the Worker lists in APPBLIPS_CHAT_ALLOWED_ORIGINS.
const FORWARDED_HEADERS = ['authorization', 'content-type', 'accept'];

export async function forwardToHosted(request, url, appOrigin) {
  const headers = new Headers({ origin: appOrigin });
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  let upstream;
  try {
    upstream = await fetch(`${HOSTED_API_URL}${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      signal: request.signal,
    });
  } catch (err) {
    if (request.signal?.aborted) throw err;
    console.warn('[desktop] could not reach the AppBlips server:', err?.message || err);
    return new Response(JSON.stringify({ error: 'Could not reach AppBlips. Check your internet connection and try again.' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
  // Streamed through (chat replies are server-sent events). Only the
  // headers the renderer uses; CORS ones are meaningless on the app origin.
  const out = new Headers();
  for (const name of ['content-type', 'cache-control', 'retry-after']) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
}

// Lets Clerk's sign-in run on appblips://app: requests to Clerk's API carry
// the site's Origin instead, and the answer's CORS header names the app
// again so the renderer may read it. Limited to Clerk's own host, and only
// for requests the app page itself makes.
export function allowClerkFromApp(session, appOrigin) {
  const filter = { urls: [`https://${CLERK_FAPI_HOST}/*`] };
  session.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    const headers = { ...details.requestHeaders };
    const key = Object.keys(headers).find((name) => name.toLowerCase() === 'origin');
    if (key && headers[key] === appOrigin) headers[key] = CLERK_SITE_ORIGIN;
    callback({ requestHeaders: headers });
  });
  session.webRequest.onHeadersReceived(filter, (details, callback) => {
    const headers = { ...details.responseHeaders };
    const key = Object.keys(headers).find((name) => name.toLowerCase() === 'access-control-allow-origin');
    if (key && headers[key]?.[0] === CLERK_SITE_ORIGIN) headers[key] = [appOrigin];
    callback({ responseHeaders: headers });
  });
}
