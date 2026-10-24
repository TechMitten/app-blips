// /api/surge/*: publishes a project to Surge (surge.sh), free static hosting
// with HTTPS on every <name>.surge.sh address. Used by all three hosts
// (electron/main.js, server.js, the Vite dev server), so Fetch primitives
// only, like chatProxy.js. The calls to Surge happen here rather than in the
// page because Surge's API doesn't allow cross-origin requests, and so the
// Surge token stays server-side like the AI key: the page sees only the
// account email.
//
//   GET    /api/surge          -> { email, signedIn }
//   POST   /api/surge/login    -> { email, password } signs in (a new email
//                                 creates a free account); only the token is kept
//   DELETE /api/surge          -> sign out
//   POST   /api/surge/publish  -> { domain, files: { 'index.html': html },
//                                   images?: { 'images/<name>.jpg': base64,
//                                              'favicon.png': base64 } }
//                                 -> { url } or { error, signedOut? }
//                                 (images: Pollinations images copied into the
//                                 site, see src/lib/siteImages.js, and the site
//                                 icon, see src/lib/favicon.js)
//   POST   /api/surge/unpublish -> { domain } takes that site offline
//                                 -> { removed: true } or { error, signedOut? }
//
// `tokens` is { describe, keyFor, save, clear }: keyFile.js in the browser
// version, electron/surgeStore.js (OS keychain) on desktop.
import { isForeignOrigin } from './chatProxy.js';
import { createTar, gzip } from './tar.js';
import { MAX_FILES_BYTES, MAX_PAGES, validatePageName } from '../../src/lib/pages.js';
import { MAX_SITE_IMAGES_BYTES, SITE_IMAGE_PATH_RE } from '../../src/lib/siteImages.js';
import { FAVICON_PATH, MAX_FAVICON_BYTES } from '../../src/lib/favicon.js';

export const SURGE_API = 'https://surge.surge.sh';
export const SURGE_SUFFIX = '.surge.sh';
// Surge's API expects a CLI version with every publish.
const SURGE_CLIENT_VERSION = '0.46.0';
const MAX_EMAIL = 254;
const MAX_PASSWORD = 256;
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

const basicAuth = (user, pass) => 'Basic ' + btoa(String.fromCharCode(...new TextEncoder().encode(`${user}:${pass}`)));

// "my-site" or "my-site.surge.sh" -> "my-site.surge.sh", else null. Custom
// domains need DNS set up first, so only Surge's own addresses for now.
export function normalizeSurgeDomain(input) {
  let name = String(input ?? '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (name.endsWith(SURGE_SUFFIX)) name = name.slice(0, -SURGE_SUFFIX.length);
  return LABEL_RE.test(name) ? name + SURGE_SUFFIX : null;
}

// Surge explains refusals in a `reason` header, or a JSON body with
// `messages`/`errors`.
async function surgeReason(response) {
  const header = response.headers.get('reason');
  if (header) return header;
  try {
    const body = JSON.parse(await response.text());
    const list = [...(body?.messages || []), ...(body?.errors || [])].filter((m) => typeof m === 'string');
    return list.join(' ');
  } catch {
    return '';
  }
}

const checkFiles = (files) => {
  if (!files || typeof files !== 'object' || Array.isArray(files)) return 'Nothing to publish.';
  const names = Object.keys(files);
  if (!names.includes('index.html')) return 'Nothing to publish.';
  if (names.length > MAX_PAGES) return 'This project has too many pages to publish.';
  let size = 0;
  for (const name of names) {
    if (!validatePageName(name) || typeof files[name] !== 'string') return 'This project has a page that can’t be published.';
    size += files[name].length;
  }
  // Compiled JSX and loop guards make exports a little bigger than `files`.
  if (size > MAX_FILES_BYTES * 2) return 'This project is too big to publish.';
  return null;
};

async function login({ email, password }, tokens, fetchImpl) {
  const cleanEmail = typeof email === 'string' ? email.trim() : '';
  if (!cleanEmail || cleanEmail.length > MAX_EMAIL || !/^[^\s@:]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return json({ error: 'Enter a valid email address.' }, 400);
  }
  if (typeof password !== 'string' || !password || password.length > MAX_PASSWORD) {
    return json({ error: 'Enter a password.' }, 400);
  }
  let response;
  try {
    response = await fetchImpl(`${SURGE_API}/token`, {
      method: 'POST',
      headers: { authorization: basicAuth(cleanEmail, password), accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return json({ error: 'Couldn’t reach Surge. Check your internet connection and try again.' }, 502);
  }
  if (response.status === 401) {
    return json({ error: 'That password doesn’t match this Surge account. If you forgot it, reset it at surge.sh.' }, 400);
  }
  if (!response.ok) {
    const reason = await surgeReason(response);
    return json({ error: reason || `Surge couldn’t sign you in (error ${response.status}).` }, 400);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (typeof body?.token !== 'string' || !body.token) return json({ error: 'Surge sent an unexpected reply. Try again.' }, 502);
  const savedEmail = typeof body.email === 'string' && body.email ? body.email : cleanEmail;
  await tokens.save(savedEmail, body.token);
  return json({ email: savedEmail, signedIn: true });
}

// { path: base64 } -> [{ name, data: Uint8Array }], or an error message.
const decodeImages = (images) => {
  if (images === undefined) return [];
  if (!images || typeof images !== 'object' || Array.isArray(images)) return 'This project has images that can’t be published.';
  const entries = [];
  let size = 0;
  for (const [path, base64] of Object.entries(images)) {
    const favicon = path === FAVICON_PATH;
    if ((!favicon && !SITE_IMAGE_PATH_RE.test(path)) || typeof base64 !== 'string') return 'This project has an image that can’t be published.';
    let binary;
    try {
      binary = atob(base64);
    } catch {
      return 'This project has an image that can’t be published.';
    }
    if (favicon && binary.length > MAX_FAVICON_BYTES) return 'The site icon is too big to publish. Pick a smaller image.';
    size += binary.length;
    if (size > MAX_SITE_IMAGES_BYTES) return 'This project’s images are too big to publish.';
    entries.push({ name: `site/${path}`, data: Uint8Array.from(binary, (char) => char.charCodeAt(0)) });
  }
  return entries;
};

async function publish({ domain, files, images }, tokens, fetchImpl) {
  const { id: email, hasKey } = tokens.describe();
  const token = hasKey ? tokens.keyFor(email) : '';
  if (!token) return json({ error: 'Sign in to Surge first.', signedOut: true }, 401);
  const host = normalizeSurgeDomain(domain);
  if (!host) {
    return json({ error: 'Use only lowercase letters, numbers and dashes for the address, and start and end with a letter or number.' }, 400);
  }
  const problem = checkFiles(files);
  if (problem) return json({ error: problem }, 400);

  const imageEntries = decodeImages(images);
  if (typeof imageEntries === 'string') return json({ error: imageEntries }, 400);

  // Surge drops the first folder of every path, so pages go in as site/<name>.
  const entries = [...Object.entries(files).map(([name, html]) => ({ name: `site/${name}`, data: html })), ...imageEntries];
  const projectSize = entries.reduce((sum, { data }) => sum + (typeof data === 'string' ? new TextEncoder().encode(data).length : data.length), 0);
  const body = await gzip(createTar(entries));

  let response;
  try {
    response = await fetchImpl(`${SURGE_API}/${host}`, {
      method: 'PUT',
      headers: {
        authorization: basicAuth('token', token),
        'content-type': 'application/gzip',
        accept: 'application/x-ndjson',
        version: SURGE_CLIENT_VERSION,
        'file-count': String(entries.length),
        'project-size': String(projectSize),
        timestamp: new Date().toISOString(),
      },
      body,
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    return json({ error: 'Couldn’t reach Surge. Check your internet connection and try again.' }, 502);
  }

  if (response.status === 401) {
    // A revoked or expired token: forget it so the page asks to sign in again.
    await tokens.clear();
    return json({ error: 'Your Surge sign-in has expired. Sign in again to publish.', signedOut: true }, 401);
  }
  if (response.status === 403) {
    const reason = await surgeReason(response);
    return json({ error: reason || `${host} belongs to another Surge account. Pick a different address.` }, 400);
  }
  if (response.status === 422) {
    const reason = await surgeReason(response);
    return json({ error: reason || 'Surge doesn’t accept that address. Try a different one.' }, 400);
  }
  if (!response.ok) {
    const reason = await surgeReason(response);
    return json({ error: reason || `Surge couldn’t publish the site (error ${response.status}). Try again in a minute.` }, 502);
  }

  // The reply is a stream of JSON lines; an `info` line means the site is
  // live, and a stream without one failed partway.
  let text = '';
  try {
    text = await response.text();
  } catch {
    return json({ error: 'The connection to Surge dropped while publishing. Try again.' }, 502);
  }
  const events = text.split('\n').map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
  if (events.some((event) => event.type === 'info')) return json({ url: `https://${host}`, domain: host });
  if (events.some((event) => event.type === 'collect')) {
    return json({ error: 'Surge asked for payment to publish this. Free addresses ending in .surge.sh shouldn’t need it; try a different address.' }, 400);
  }
  const failure = events.find((event) => event.type === 'error' || event.messages || event.errors);
  const message = failure && [failure.message, ...(failure.messages || []), ...(failure.errors || [])].filter((m) => typeof m === 'string').join(' ');
  return json({ error: message || 'Surge didn’t finish publishing. Try again.' }, 502);
}

async function unpublish({ domain }, tokens, fetchImpl) {
  const { id: email, hasKey } = tokens.describe();
  const token = hasKey ? tokens.keyFor(email) : '';
  if (!token) return json({ error: 'Sign in to Surge first.', signedOut: true }, 401);
  const host = normalizeSurgeDomain(domain);
  if (!host) return json({ error: 'That isn’t a surge.sh address.' }, 400);
  let response;
  try {
    response = await fetchImpl(`${SURGE_API}/${host}`, {
      method: 'DELETE',
      headers: { authorization: basicAuth('token', token), accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return json({ error: 'Couldn’t reach Surge. Check your internet connection and try again.' }, 502);
  }
  if (response.status === 401) {
    await tokens.clear();
    return json({ error: 'Your Surge sign-in has expired. Sign in again to unpublish.', signedOut: true }, 401);
  }
  // Already gone (removed elsewhere, e.g. with the Surge CLI): nothing to do.
  if (response.ok || response.status === 404) return json({ removed: true });
  const reason = await surgeReason(response);
  if (response.status === 403) {
    return json({ error: reason || `${host} belongs to another Surge account, so it can’t be removed from this one.` }, 400);
  }
  return json({ error: reason || `Surge couldn’t remove the site (error ${response.status}). Try again in a minute.` }, 502);
}

export async function handleSurgeApi(request, env, tokens, { fetch: fetchImpl = globalThis.fetch } = {}) {
  // Only AppBlips' own page may publish with the saved token. A JSON body
  // also forces a CORS preflight, which other sites can't pass.
  if (isForeignOrigin(request, env)) return json({ error: 'Not allowed.' }, 403);
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  const readBody = async () => {
    if (!/^application\/json\b/i.test(request.headers.get('content-type') || '')) return null;
    try {
      const body = await request.json();
      return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
    } catch {
      return null;
    }
  };
  const status = () => {
    const { id, hasKey } = tokens.describe();
    return { email: hasKey ? id : '', signedIn: hasKey };
  };

  if (path === '/api/surge') {
    if (request.method === 'GET') return json(status());
    if (request.method === 'DELETE') {
      await tokens.clear();
      return json(status());
    }
    return json({ error: 'Method not allowed.' }, 405);
  }
  const actions = { '/api/surge/login': login, '/api/surge/publish': publish, '/api/surge/unpublish': unpublish };
  if (actions[path]) {
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    const body = await readBody();
    if (!body) return json({ error: 'Invalid request.' }, 400);
    return actions[path](body, tokens, fetchImpl);
  }
  return json({ error: 'Not found.' }, 404);
}
