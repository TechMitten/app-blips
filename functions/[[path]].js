// Cloudflare Pages Function: serves deployed Orion apps.
//
// This project's Pages deployment answers on two hostnames:
//
//   app.orion.islandapps.dev   -> the Orion SPA (static assets, untouched)
//   apps.orion.islandapps.dev  -> deployed user apps, one per slug
//
// Why a separate hostname: a deployed app is LLM-generated code running with
// full script privileges. On the SPA's own origin it could read localStorage --
// which holds the user's LLM API key (`orion-llm-config`) and their Supabase
// session. A sibling subdomain is a real origin boundary, so it can read
// neither. Do not merge these onto one host.
//
// Why this function exists at all: Supabase rewrites every HTML GET on
// *.supabase.co to `text/plain` with `CSP: default-src 'none'; sandbox`, for
// Edge Functions exactly as for Storage, so a page served from there always
// shows source. Cloudflare does not, so the serving origin has to live here.
// Storage remains the source of truth; this only ever reads.

const APPS_HOSTNAME = 'apps.orion.islandapps.dev';

const SUPABASE_URL = 'https://nmmrhagtkfjqljktcwkf.supabase.co';
// Publishable key, already public in the client bundle. Reads are RLS-scoped.
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_bX8jWhkPlVD0bHx7cQ8RJg_mGjOdWc3';
const BUCKET = 'orion-deploys';

const SLUG_PATTERN = /^[a-zA-Z0-9-]{1,39}\/[a-zA-Z0-9-]{1,63}$|^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/;
const STORAGE_PATH_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-zA-Z0-9]{1,32}\.html$/i;

// Generated apps are single files with inline scripts/styles, usually pulling
// Tailwind from a CDN, so those need to be allowed for anything to render.
const CSP = [
  "default-src 'self' data: blob:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com",
  "style-src 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
  "font-src data: https://fonts.gstatic.com https://cdnjs.cloudflare.com",
  "img-src * data: blob:",
  "media-src * data: blob:",
  "connect-src https:",
  "base-uri 'none'",
].join('; ');

const notice = (status, title, body) =>
  new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${title}</title><style>` +
      `body{font:16px/1.6 ui-sans-serif,system-ui,sans-serif;display:flex;align-items:center;` +
      `justify-content:center;min-height:100vh;margin:0;background:#f8fafc;color:#334155}` +
      `div{text-align:center;padding:2rem}h1{font-size:1.125rem;margin:0 0 .25rem}` +
      `p{margin:0;color:#94a3b8;font-size:.875rem}</style></head>` +
      `<body><div><h1>${title}</h1><p>${body}</p></div></body></html>`,
    {
      status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'x-robots-tag': 'noindex',
        'cache-control': 'no-store',
      },
    },
  );

export async function onRequest(context) {
  const { request, next } = context;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return next();
  }

  // Anything that isn't the apps hostname is the SPA. Fall straight through to
  // the static asset handler so this function stays invisible to the main site.
  if (url.hostname !== APPS_HOSTNAME) return next();

  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }

    const slug = decodeURIComponent(url.pathname.replace(/^\/+|\/+$/g, ''));

    if (!slug) {
      return notice(404, 'Nothing here', 'This address needs an app link.');
    }
    if (!SLUG_PATTERN.test(slug)) {
      return notice(404, 'Not found', 'This deployment link is not valid.');
    }

    // Resolve slug -> storage object. Public read, no privileged key involved.
    const lookup = await fetch(
      `${SUPABASE_URL}/rest/v1/deployments?slug=eq.${encodeURIComponent(slug)}&select=storage_path`,
      {
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
          accept: 'application/json',
        },
      },
    );

    if (!lookup.ok) {
      return notice(502, 'Temporarily unavailable', 'Could not look up this app. Try again shortly.');
    }

    const rows = await lookup.json();
    const storagePath = rows?.[0]?.storage_path;

    // Re-validate what came back from the database before using it to build a
    // URL, so a bad row can never redirect this fetch somewhere unintended.
    if (!storagePath || !STORAGE_PATH_PATTERN.test(storagePath)) {
      return notice(404, 'Not found', 'This app is no longer deployed.');
    }

    const object = await fetch(
      `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`,
    );

    if (!object.ok) {
      return notice(404, 'Not found', 'This app is no longer deployed.');
    }

    const html = await object.text();

    return new Response(request.method === 'HEAD' ? null : html, {
      status: 200,
      headers: {
        // The point of the whole function: Supabase hands this back as
        // text/plain, and we serve it as an actual page.
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': CSP,
        'cache-control': 'public, max-age=60',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'x-robots-tag': 'noindex',
      },
    });
  } catch {
    // Never let a failure here take down the main site.
    return notice(500, 'Something went wrong', 'This app could not be loaded.');
  }
}
