// One-shot loopback listener for the desktop app's OAuth sign-in (RFC 8252).
// The provider page opens in the system browser, and Supabase redirects back
// to http://127.0.0.1:<port>/auth/callback?code=... on this machine. The code
// is only useful together with the PKCE verifier kept in the app's renderer,
// so a stray request to this port cannot sign anyone in.
import { createServer } from 'node:http';

const CALLBACK_PATH = '/auth/callback';
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

const PAGE = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#0b0b0b;color:#eee}
main{max-width:26rem;padding:2rem;text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:0;color:#aaa}</style></head>
<body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function createOAuthLoopback({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let pending = null; // { server, settle, timer }

  function close() {
    if (!pending) return;
    const { server, timer, settle } = pending;
    pending = null;
    clearTimeout(timer);
    server.close();
    server.closeAllConnections?.();
    settle(new Error('Sign-in was cancelled.'));
  }

  // Starts listening and returns { redirectUri, result } where result resolves
  // to { code } once the browser lands on the callback. Starting again cancels
  // any sign-in still waiting.
  async function begin() {
    close();
    let settle;
    const result = new Promise((resolve, reject) => {
      settle = (value) => (value instanceof Error ? reject(value) : resolve(value));
    });
    // The caller may never await it (the app can exit first).
    result.catch(() => {});

    const server = createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (req.method !== 'GET' || url.pathname !== CALLBACK_PATH) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
        return;
      }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error_description') || url.searchParams.get('error');
      const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
      if (code) {
        res.writeHead(200, headers).end(PAGE('You are signed in', 'You can close this tab and return to AppBlips.'));
        finish({ code });
      } else {
        res.writeHead(400, headers).end(PAGE('Sign-in failed', escapeHtml(error || 'No sign-in code was returned.') + ' You can close this tab and try again in AppBlips.'));
        finish(new Error(error || 'Sign-in failed.'));
      }
    });

    function finish(value) {
      if (!pending || pending.server !== server) return;
      const { timer } = pending;
      pending = null;
      clearTimeout(timer);
      // Let the response flush, then drop keep-alive sockets.
      server.close();
      setTimeout(() => server.closeAllConnections?.(), 500).unref?.();
      settle(value);
    }

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const timer = setTimeout(() => finish(new Error('Sign-in timed out. Please try again.')), timeoutMs);
    timer.unref?.();
    pending = { server, settle, timer };

    const { port } = server.address();
    return { redirectUri: `http://127.0.0.1:${port}${CALLBACK_PATH}`, result };
  }

  return { begin, cancel: close };
}

// Whether `url` is the OAuth authorize endpoint of the given Supabase project;
// the only page the desktop app will open in the browser for sign-in.
// Matching the project's own protocol and host keeps the renderer from
// pointing the system browser at an arbitrary site.
export function isSupabaseAuthorizeUrl(url, supabaseUrl) {
  try {
    const target = new URL(url);
    const base = new URL(supabaseUrl);
    return target.protocol === base.protocol && target.host === base.host && target.pathname === '/auth/v1/authorize';
  } catch {
    return false;
  }
}
