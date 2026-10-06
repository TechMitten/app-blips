// Version history pages in R2: older versions of a signed-in project keep only
// their prompt/reply in Firestore plus a content hash per page, and the page
// HTML lives here. Firestore bills every save by the whole project and caps it
// at a few MB; R2 is cheap per byte and has no size ceiling, so history can
// grow without growing every save.
//
//   POST   /api/history/pages  { projectId, pages: [{ hash, html }] } -> { stored }
//   POST   /api/history/fetch  { projectId, hashes: [...] }           -> { pages: { hash: html } }
//   DELETE /api/history?projectId=                                    -> { removed: true }
//
// Objects are `<uid>/<projectId>/<sha256>.html` in their own private bucket
// (R2_HISTORY_BUCKET), never the deploys bucket that functions/[[path]].js
// serves publicly. Keys are content-addressed, so a page that didn't change
// between versions is stored once, and the server re-hashes every upload so a
// key always matches its content. R2 has no per-user rules, so the caller's
// `<uid>/` prefix is enforced here.
//
// Off (501) until R2_HISTORY_BUCKET is set; the client then keeps every
// version's pages in Firestore as before.
import { authorize } from './chatProxy.js';
import { firebaseConfigured } from './firebaseServer.js';
import { r2Configured, putObject, getObjectText, deleteObjects, listKeys } from './r2.js';

const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
// A whole site is capped at 400 KB in the editor (MAX_FILES_BYTES in
// src/lib/pages.js); pages and bodies get headroom over that, not more.
const MAX_PAGE_BYTES = 1024 * 1024;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_ITEMS = 200;

const encoder = new TextEncoder();

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

class HistoryError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export const historyConfigured = (env = {}) =>
  Boolean(firebaseConfigured(env) && r2Configured(env) && String(env.R2_HISTORY_BUCKET || '').trim());

// The r2.js helpers read their bucket from env.R2_BUCKET.
const historyEnv = (env) => ({ ...env, R2_BUCKET: String(env.R2_HISTORY_BUCKET).trim() });

const sha256Hex = async (text) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)))]
  .map((b) => b.toString(16).padStart(2, '0')).join('');

const requireUser = async (request, env) => {
  if (!historyConfigured(env)) throw new HistoryError('Version history storage is not configured on this server.', 501);
  const user = await authorize(request, env);
  if (!user || user.id === 'local-user') throw new HistoryError('Sign in required.', 401);
  return user;
};

const readBody = async (request) => {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) throw new HistoryError('Too much to save at once.', 413);
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) throw new HistoryError('Too much to save at once.', 413);
  try {
    const body = JSON.parse(raw);
    if (body && typeof body === 'object') return body;
  } catch { /* falls through */ }
  throw new HistoryError('Invalid JSON body.', 400);
};

const projectPrefix = (uid, projectId) => {
  if (typeof projectId !== 'string' || !PROJECT_ID_PATTERN.test(projectId)) throw new HistoryError('Invalid project.', 400);
  return `${uid}/${projectId}/`;
};

// Runs `fn` over `items` a few at a time, so one request doesn't open
// hundreds of R2 connections at once.
const eachLimited = async (items, fn, limit = 10) => {
  for (let i = 0; i < items.length; i += limit) await Promise.all(items.slice(i, i + limit).map(fn));
};

const handle = (work, what) => async (request, env) => {
  try {
    return await work(request, env);
  } catch (err) {
    if (err instanceof HistoryError) return json({ error: err.message }, err.status);
    console.error(`[history] ${what} failed:`, err?.message || err);
    // 500, not 502: Cloudflare swaps a 502 for its own HTML error page.
    return json({ error: `Could not ${what}. Please try again.` }, 500);
  }
};

export const handleHistoryPages = handle(async (request, env) => {
  const user = await requireUser(request, env);
  const body = await readBody(request);
  const prefix = projectPrefix(user.id, body.projectId);
  const pages = body.pages;
  if (!Array.isArray(pages) || pages.length > MAX_ITEMS) throw new HistoryError('Invalid pages.', 400);
  for (const page of pages) {
    if (!page || typeof page.hash !== 'string' || !HASH_PATTERN.test(page.hash)) throw new HistoryError('Invalid page.', 400);
    if (typeof page.html !== 'string' || encoder.encode(page.html).length > MAX_PAGE_BYTES) throw new HistoryError('A page is too large to save.', 413);
    if (await sha256Hex(page.html) !== page.hash) throw new HistoryError('A page does not match its hash.', 400);
  }
  const storage = historyEnv(env);
  await eachLimited(pages, (page) => putObject(storage, `${prefix}${page.hash}.html`, page.html));
  return json({ stored: pages.length });
}, 'save version history');

export const handleHistoryFetch = handle(async (request, env) => {
  const user = await requireUser(request, env);
  const body = await readBody(request);
  const prefix = projectPrefix(user.id, body.projectId);
  const hashes = body.hashes;
  if (!Array.isArray(hashes) || hashes.length > MAX_ITEMS || hashes.some((hash) => typeof hash !== 'string' || !HASH_PATTERN.test(hash))) {
    throw new HistoryError('Invalid pages.', 400);
  }
  const storage = historyEnv(env);
  const pages = {};
  await eachLimited([...new Set(hashes)], async (hash) => {
    const html = await getObjectText(storage, `${prefix}${hash}.html`);
    if (html !== null) pages[hash] = html;
  });
  return json({ pages });
}, 'load that version');

export const handleHistoryDelete = handle(async (request, env) => {
  const user = await requireUser(request, env);
  const prefix = projectPrefix(user.id, new URL(request.url).searchParams.get('projectId') || '');
  const storage = historyEnv(env);
  await deleteObjects(storage, await listKeys(storage, prefix));
  return json({ removed: true });
}, 'delete version history');

// Every history page of an account, for account deletion.
export const removeAllHistoryFor = async (env, uid) => {
  if (!historyConfigured(env)) return;
  const storage = historyEnv(env);
  await deleteObjects(storage, await listKeys(storage, `${uid}/`));
};
