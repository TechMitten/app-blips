// Cloudflare Pages Function: serves deployed AppBlips apps.
//
// This project's Pages deployment answers on two hostnames:
//
//   appblips.com     -> the AppBlips SPA (static assets, untouched)
//   my.appblips.com  -> deployed user apps, one per slug
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

const APPS_HOSTNAME = 'my.appblips.com';

import { firebaseProjectId, getAppCheckToken } from './_lib/firebaseServer.js';
export { getAppCheckToken } from './_lib/firebaseServer.js';

const FIRESTORE_API_URL = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId()}/databases/(default)/documents`;
const STORAGE_BUCKET = 'appbips-f46e2.firebasestorage.app';
const FIREBASE_STORAGE_URL = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o`;
const BUCKET = 'orion-deploys';

const SLUG_PATTERN = /^[a-zA-Z0-9-]{1,39}\/[a-zA-Z0-9-]{1,63}$|^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/;
const STORAGE_PATH_PATTERN =
  /^[a-zA-Z0-9_-]{1,128}\/[a-zA-Z0-9]{1,32}\.html$/i;

// Reserved path prefix for every deployed app's PWA assets. It can never
// collide with a real slug -- SLUG_PATTERN requires a slug to start with an
// alphanumeric, and "_pwa" starts with an underscore. The manifest/service-
// worker URLs live under here, keyed by slug, so a single deployed app
// occupies exactly one top-level path (`/{slug}`) plus this shared namespace.
const PWA_ROUTE_PATTERN = /^_pwa\/(.+)\/(manifest\.webmanifest|sw\.js)$/;

// Identical for every deployed app -- no per-app caching, just enough to
// satisfy installability checks that require a registered service worker.
// No fetch handler: Chrome flags no-op fetch handlers as pure overhead, and
// current installability criteria no longer require one.
const SERVICE_WORKER_JS = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
`;

// Fallback display name when a deployment has no stored `name`: strips a
// leading "user/" segment and a trailing random slug tail, then title-cases
// what's left. "daybook-mood-habit-journal-a7f3" -> "Daybook Mood Habit Journal".
const humanizeSlug = (slug) => {
  const base = slug.includes('/') ? slug.slice(slug.indexOf('/') + 1) : slug;
  const withoutTail = base.replace(/-[a-z0-9]{4,8}$/i, '') || base;
  const words = withoutTail.split('-').filter(Boolean);
  if (!words.length) return 'App';
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
};

// Generated apps are single files with inline scripts/styles whose library
// imports come from whichever CDN the model picked (the system prompt
// prescribes esm.sh, but it may emit others), so script/style/font sources
// are open to any https origin. That's not a hole: these pages already run
// arbitrary inline script, and the real boundary is the dedicated hostname
// (see the header comment) -- not a CDN allowlist, which only ever chased
// the model's output and blanked pages it missed.
const CSP = [
  "default-src 'self' data: blob:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https:",
  "style-src 'unsafe-inline' https:",
  "font-src data: https:",
  "img-src * data: blob:",
  "media-src * data: blob:",
  "connect-src https:",
  // Turnstile renders a challenge iframe for the /ai/session browser check.
  "frame-src https://challenges.cloudflare.com",
  "base-uri 'none'",
].join('; ');

// Umami analytics, injected at serve time so deployments uploaded before it
// existed are tracked too. New uploads already carry the tag (spliced in by
// src/lib/analytics.js via uploadDeploy) -- the includes() check keeps the
// script single-load so events are never double-counted.
const UMAMI_SCRIPT_TAG =
  '<script defer src="https://umami.techmitten.com/script.js" data-website-id="ca809bf2-efae-4cf0-9b0a-e4ba06ea52a3"></script>';

const injectAnalytics = (html, env) => {
  if (env?.SELF_HOSTED_MODE && env.SELF_HOSTED_MODE !== 'false') return html;

  let modifiedHtml = html;

  // Remove the old recorder.js tag if it exists in the deployed HTML
  const oldRecorderRegex = /<script[^>]*src=["']https:\/\/umami\.techmitten\.com\/recorder\.js["'][^>]*><\/script>\s*/gi;
  modifiedHtml = modifiedHtml.replace(oldRecorderRegex, '');

  // Also strip it from previously encrypted apps by intercepting document.write
  modifiedHtml = modifiedHtml.replace(
    'document.write(html);',
    'document.write(html.replace(/<script[^>]*src=["\']https:\\/\\/umami\\.techmitten\\.com\\/recorder\\.js["\'][^>]*><\\/script>\\s*/gi, ""));'
  );

  if (modifiedHtml.includes('umami.techmitten.com/script.js')) {
    return modifiedHtml;
  }

  const headMatch = /<head\b[^>]*>/i.exec(modifiedHtml);
  if (headMatch) {
    const at = headMatch.index + headMatch[0].length;
    return modifiedHtml.slice(0, at) + UMAMI_SCRIPT_TAG + modifiedHtml.slice(at);
  }

  const htmlMatch = /<html\b[^>]*>/i.exec(modifiedHtml);
  if (htmlMatch) {
    const at = htmlMatch.index + htmlMatch[0].length;
    return modifiedHtml.slice(0, at) + UMAMI_SCRIPT_TAG + modifiedHtml.slice(at);
  }

  return modifiedHtml;
};

const injectFavicon = (html) => {
  if (/<link\b[^>]*\brel=["'](?:shortcut )?icon["']/i.test(html)) return html;

  const faviconTag = '<link rel="icon" href="/favicon.ico">';
  const headMatch = /<head\b[^>]*>/i.exec(html);
  if (headMatch) {
    const at = headMatch.index + headMatch[0].length;
    return html.slice(0, at) + faviconTag + html.slice(at);
  }

  const htmlMatch = /<html\b[^>]*>/i.exec(html);
  if (htmlMatch) {
    const at = htmlMatch.index + htmlMatch[0].length;
    return html.slice(0, at) + faviconTag + html.slice(at);
  }

  return faviconTag + html;
};

// "Remix Blip!" CTA badge -- see src/lib/remixBadge.js for the source of
// truth on the markup/rationale; duplicated here (like the favicon/analytics
// tags above) so deployments uploaded before this existed get it too.
const REMIX_BADGE_ID = 'appblips-remix-badge';
const REMIX_BADGE_SNIPPET = `<style>
#${REMIX_BADGE_ID}{position:fixed;bottom:16px;right:16px;z-index:2147483000;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
#${REMIX_BADGE_ID} .ablips-remix-link{all:unset;display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:9999px;background:linear-gradient(135deg,#7c3aed,#4f46e5);box-shadow:0 4px 14px rgba(0,0,0,.28);cursor:pointer;transition:transform .15s ease}
#${REMIX_BADGE_ID} .ablips-remix-link:hover,#${REMIX_BADGE_ID} .ablips-remix-link:focus-visible{transform:scale(1.08)}
#${REMIX_BADGE_ID} .ablips-remix-tip{position:absolute;right:52px;bottom:11px;white-space:nowrap;background:#111827;color:#fff;font-size:12px;line-height:1;padding:6px 10px;border-radius:6px;opacity:0;transform:translateX(4px);transition:opacity .15s ease,transform .15s ease;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.2)}
#${REMIX_BADGE_ID} .ablips-remix-link:hover + .ablips-remix-tip,#${REMIX_BADGE_ID} .ablips-remix-link:focus-visible + .ablips-remix-tip{opacity:1;transform:translateX(0)}
</style>
<div id="${REMIX_BADGE_ID}">
  <a class="ablips-remix-link" href="https://appblips.com" target="_blank" rel="noopener noreferrer" aria-label="Remix Blip!" title="Remix Blip!">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      <polyline points="16 3 21 3 21 8"></polyline>
      <line x1="4" y1="20" x2="21" y2="3"></line>
      <polyline points="21 16 21 21 16 21"></polyline>
      <line x1="15" y1="15" x2="21" y2="21"></line>
      <line x1="4" y1="4" x2="9" y2="9"></line>
    </svg>
  </a>
  <span class="ablips-remix-tip" aria-hidden="true">Remix Blip!</span>
</div>`;

const injectRemixBadge = (html) => {
  if (html.includes(`id="${REMIX_BADGE_ID}"`)) return html;

  const bodyCloseAt = html.lastIndexOf('</body>');
  if (bodyCloseAt !== -1) {
    return html.slice(0, bodyCloseAt) + REMIX_BADGE_SNIPPET + html.slice(bodyCloseAt);
  }

  const htmlCloseAt = html.lastIndexOf('</html>');
  if (htmlCloseAt !== -1) {
    return html.slice(0, htmlCloseAt) + REMIX_BADGE_SNIPPET + html.slice(htmlCloseAt);
  }

  return html + REMIX_BADGE_SNIPPET;
};

const LOCK_PROTECTION_SCRIPT = `<script>
  document.addEventListener('contextmenu', function(e) { e.preventDefault(); return false; }, true);
  window.addEventListener('contextmenu', function(e) { e.preventDefault(); return false; }, true);
  document.addEventListener('keydown', function(e) {
    if (e.key === 'F12' || e.keyCode === 123) { e.preventDefault(); e.stopPropagation(); return false; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'u' || e.key === 'U' || e.keyCode === 85)) { e.preventDefault(); e.stopPropagation(); return false; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S' || e.keyCode === 83)) { e.preventDefault(); e.stopPropagation(); return false; }
    if ((e.ctrlKey || e.metaKey) && (e.shiftKey || e.altKey) && (
      e.key === 'I' || e.key === 'i' || e.keyCode === 73 ||
      e.key === 'J' || e.key === 'j' || e.keyCode === 74 ||
      e.key === 'C' || e.key === 'c' || e.keyCode === 67
    )) { e.preventDefault(); e.stopPropagation(); return false; }
  }, true);
  document.addEventListener('dragstart', function(e) { e.preventDefault(); return false; }, true);
</script>`;

const injectLockProtection = (html) => {
  if (!html.includes('id="unlock-form"') || html.includes('contextmenu')) return html;

  let modified = html;
  if (/<body\b[^>]*>/i.test(modified) && !modified.includes('oncontextmenu')) {
    modified = modified.replace(/<body\b/i, '<body oncontextmenu="return false;"');
  }

  const at = modified.lastIndexOf('</body>');
  if (at !== -1) {
    return modified.slice(0, at) + LOCK_PROTECTION_SCRIPT + '\n' + modified.slice(at);
  }

  return modified + LOCK_PROTECTION_SCRIPT;
};

const notice = (status, title, body) =>
  new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<link rel="icon" href="/favicon.ico">` +
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

const fetchDeploymentRow = async (slug, env) => {
  const headers = {};
  const appCheckToken = await getAppCheckToken(env);
  if (appCheckToken) {
    headers['X-Firebase-AppCheck'] = appCheckToken;
  }
  const res = await fetch(`${FIRESTORE_API_URL}/deployments/${encodeURIComponent(slug)}`, {
    headers,
  });
  if (res.status === 404) return { ok: true, row: null };
  if (!res.ok) return { ok: false, row: null };
  const doc = await res.json();
  return {
    ok: true,
    row: {
      name: doc.fields?.name?.stringValue || null,
      storage_path: doc.fields?.storage_path?.stringValue || null
    }
  };
};

export async function onRequest(context) {
  const { request, env, next } = context;

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

    const path = url.pathname.replace(/^\/+|\/+$/g, '');

    const pwaMatch = PWA_ROUTE_PATTERN.exec(path);
    if (pwaMatch) {
      const pwaSlug = decodeURIComponent(pwaMatch[1]);
      const resource = pwaMatch[2];

      if (!SLUG_PATTERN.test(pwaSlug)) {
        return notice(404, 'Not found', 'This deployment link is not valid.');
      }

      if (resource === 'sw.js') {
        // Served from under /_pwa/, but must control the app's real path --
        // widen its default scope with this header.
        return new Response(SERVICE_WORKER_JS, {
          status: 200,
          headers: {
            'content-type': 'text/javascript; charset=utf-8',
            'service-worker-allowed': `/${pwaSlug}`,
            'cache-control': 'public, max-age=300',
            'x-content-type-options': 'nosniff',
          },
        });
      }

      const { ok, row } = await fetchDeploymentRow(pwaSlug, env);
      if (!ok) {
        return notice(502, 'Temporarily unavailable', 'Could not look up this app. Try again shortly.');
      }
      if (!row) {
        return notice(404, 'Not found', 'This app is no longer deployed.');
      }

      const name = (row.name && String(row.name).trim()) || humanizeSlug(pwaSlug);
      const manifest = {
        name,
        short_name: name.length > 30 ? `${name.slice(0, 29)}…` : name,
        start_url: `/${pwaSlug}`,
        scope: `/${pwaSlug}`,
        display: 'standalone',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        // Root-relative icon URLs resolve against the apps origin (relative to
        // this manifest's URL) and are served by the static-asset passthrough
        // above, so installability never depends on the SPA hostname being up
        // or holding the same assets.
        icons: [
          { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
      };

      return new Response(JSON.stringify(manifest), {
        status: 200,
        headers: {
          'content-type': 'application/manifest+json; charset=utf-8',
          'cache-control': 'public, max-age=60',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
          'x-robots-tag': 'noindex',
        },
      });
    }

    // Shared static assets: the Pages build output backs both hostnames, so
    // root-level dotted paths here fall through to the static handler. Slugs
    // can never contain a dot (SLUG_PATTERN is [a-zA-Z0-9-]), so there is no
    // app-link collision. This serves the manifest's PNG icons (same-origin),
    // the favicon browsers request automatically, and apple-touch-icon for iOS
    // installs -- keeping installability off the SPA hostname. The extension
    // allowlist stops a typo'd dotted URL from coming back as the SPA shell.
    // Must run after the _pwa check above: manifest.webmanifest/sw.js contain
    // dots and are Function-served.
    if (/^[a-z0-9-]+\.(png|ico|svg|webmanifest|txt|xml)$/i.test(path)) {
      return next();
    }

    const slug = decodeURIComponent(path);

    if (!slug) {
      return notice(404, 'Nothing here', 'This address needs an app link.');
    }
    if (!SLUG_PATTERN.test(slug)) {
      return notice(404, 'Not found', 'This deployment link is not valid.');
    }

    // Resolve slug -> storage object.
    const { ok, row } = await fetchDeploymentRow(slug, env);
    if (!ok) {
      return notice(502, 'Temporarily unavailable', 'Could not look up this app. Try again shortly.');
    }

    const storagePath = row?.storage_path;

    // Re-validate what came back from the database before using it to build a
    // URL, so a bad row can never redirect this fetch somewhere unintended.
    if (!storagePath || !STORAGE_PATH_PATTERN.test(storagePath)) {
      return notice(404, 'Not found', 'This app is no longer deployed.');
    }

    const storageHeaders = {};
    const appCheckToken = await getAppCheckToken(env);
    if (appCheckToken) {
      storageHeaders['X-Firebase-AppCheck'] = appCheckToken;
    }

    const object = await fetch(
      `${FIREBASE_STORAGE_URL}/${encodeURIComponent(BUCKET + '/' + storagePath)}?alt=media`,
      { headers: storageHeaders },
    );

    if (!object.ok) {
      return notice(404, 'Not found', 'This app is no longer deployed.');
    }

    const html = injectLockProtection(injectRemixBadge(injectAnalytics(injectFavicon(await object.text()), env)));

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
      },
    });
  } catch {
    // Never let a failure here take down the main site.
    return notice(500, 'Something went wrong', 'This app could not be loaded.');
  }
}
