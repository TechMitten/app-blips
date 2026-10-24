// /api/seo/scan: reads the user's own website once, so the SEO connector's AI
// knows what it already says. Used by all hosts (electron/main.js, server.js,
// the Vite dev server, Android), so Fetch primitives only, like surgeApi.js.
// The page can't do this itself: most sites don't allow cross-origin reads.
//
//   POST /api/seo/scan  { url } -> { scan: { origin, title, description,
//                                  siteName, lang, headings } } or { error }
//
// Only a few short fields leave this file (never the page's HTML), and the
// renderer asks only after the user says yes (SeoQuestionsModal.jsx).
//
// This fetches an address the user typed, so it stays on the public internet:
// no localhost, private or link-local addresses, with every redirect hop
// checked the same way. A public name that resolves to a private address can't
// be seen from Fetch primitives; the only thing that comes back is the handful
// of extracted text fields, on a single-user app.
import { isForeignOrigin } from './chatProxy.js';
import { seoOrigin } from '../../src/lib/seo.js';

const TIMEOUT_MS = 8000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const MAX_HEADINGS = 8;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

const PRIVATE_V4 = [
  /^0\./, /^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^192\.0\.0\./, /^198\.1[89]\./, /^2(2[4-9]|[3-5]\d)\./,
];
const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home', '.corp', '.intranet', '.test', '.invalid'];

// True for a name that is plainly on the public internet. URL has already
// turned odd IPv4 spellings (0x7f.1, 2130706433) into dotted form.
export const isPublicHost = (hostname) => {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || host.startsWith('[')) return false;
  if (host === 'localhost' || LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return !PRIVATE_V4.some((re) => re.test(host));
  return true;
};

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ' };
const clean = (html, max) => String(html ?? '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return point > 0 && point < 0x110000 ? String.fromCodePoint(point) : ' ';
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  })
  .replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const metaTags = (html) => {
  const found = {};
  for (const [, attrs] of html.matchAll(/<meta\s+([^>]*?)\/?>/gi)) {
    const get = (name) => attrs.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
    const key = get('name') || get('property');
    const content = get('content');
    if (key && content) found[(key[1] ?? key[2] ?? key[3]).toLowerCase()] ??= content[1] ?? content[2] ?? content[3];
  }
  return found;
};

// What the page says about itself, as short plain text. Exported for tests.
export const extractScan = (html, origin) => {
  const meta = metaTags(html);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const headings = [];
  for (const [, , inner] of html.matchAll(/<h([12])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const text = clean(inner, 120);
    if (text && !headings.includes(text)) headings.push(text);
    if (headings.length >= MAX_HEADINGS) break;
  }
  return {
    origin,
    title: clean(title || meta['og:title'], 160),
    description: clean(meta.description || meta['og:description'], 300),
    siteName: clean(meta['og:site_name'], 80),
    lang: clean(html.match(/<html\b[^>]*\blang\s*=\s*["']?([\w-]+)/i)?.[1], 20),
    headings,
  };
};

// At most MAX_BYTES of the body, as text.
async function readCapped(response) {
  if (!response.body) return (await response.text()).slice(0, MAX_BYTES);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  const bytes = new Uint8Array(Math.min(size, MAX_BYTES));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, bytes.length - offset);
    bytes.set(part, offset);
    offset += part.length;
  }
  return new TextDecoder().decode(bytes);
}

export async function handleSeoScanApi(request, env = {}, { fetch: fetchImpl = fetch } = {}) {
  if (isForeignOrigin(request, env)) return json({ error: 'Requests from other sites are not allowed.' }, 403);
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body.' }, 400); }
  const origin = seoOrigin(body?.url);
  if (!origin) return json({ error: 'That doesn’t look like a web address.' }, 400);

  const signals = [AbortSignal.timeout(TIMEOUT_MS), request.signal];
  const signal = AbortSignal.any ? AbortSignal.any(signals) : signals[0];
  let target = new URL(`${origin}/`);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!['http:', 'https:'].includes(target.protocol) || !isPublicHost(target.hostname)) {
        return json({ error: 'AppBlips only scans sites on the public internet.' }, 400);
      }
      const response = await fetchImpl(target.href, {
        redirect: 'manual',
        signal,
        headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'AppBlips-SEO-Scan/1 (+https://appblips.com)' },
      });
      const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
      if (location) {
        target = new URL(location, target);
        continue;
      }
      if (!response.ok) return json({ error: `The site answered with an error (${response.status}).` }, 502);
      if (!/html/i.test(response.headers.get('content-type') || 'text/html')) {
        return json({ error: 'That address isn’t a web page.' }, 502);
      }
      const scan = extractScan(await readCapped(response), origin);
      if (!scan.title && !scan.description && !scan.headings.length) {
        return json({ error: 'The page has no title or text to read. It may be built to load in the browser only.' }, 502);
      }
      return json({ scan });
    }
    return json({ error: 'The site redirected too many times.' }, 502);
  } catch {
    return json({ error: 'Couldn’t reach that site. Check the address and your internet connection.' }, 502);
  }
}
