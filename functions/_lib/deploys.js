// Publishing deployed apps: POST /api/deploys uploads a site's HTML to R2 and
// points its public slug at it; DELETE /api/deploys?slug= takes it down.
// functions/[[path]].js serves the result on the apps hostname.
//
// This runs server-side (rather than the client writing storage directly)
// because R2 has no per-user access rules. So everything a storage rule used
// to enforce is checked here:
// - objects only ever land under the caller's own `<uid>/` prefix;
// - a slug belongs to whoever registered it first, and a `username/slug`
//   form must use the caller's own claimed username;
// - pages, sizes and counts are bounded.
//
// The HTML itself is built in the browser (PWA/analytics/SEO snippets, and
// encryption for password-protected apps -- the server must never see that
// password), so the server treats it as opaque.
import { authorize } from './chatProxy.js';
import { serviceAccountConfigured, getDoc, runQuery, runTransaction, setWrite, deleteWrite, commitAll } from './firebaseServer.js';
import { r2Configured, putObject, deleteObjects, listKeys } from './r2.js';
import { analyticsSiteDocPath } from './umamiProxy.js';

// `slug` or `username/slug`. Doc ids can't contain '/', so the separator is
// stored as '~' (never valid in a slug).
export const SLUG_PATTERN = /^[a-zA-Z0-9-]{1,39}\/[a-zA-Z0-9-]{1,63}$|^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/;
// Landing object `<uid>/<token>.html`; other pages `<uid>/<token>/<page>.html`.
export const STORAGE_PATH_PATTERN = /^[a-zA-Z0-9_-]{1,128}\/[a-zA-Z0-9]{1,32}\.html$/;
export const PAGE_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const STORAGE_PAGE_PATH_PATTERN =
  /^[a-zA-Z0-9_-]{1,128}\/[a-zA-Z0-9]{1,32}\/[a-z0-9][a-z0-9-]{0,39}\.html$/;
const PAGE_FILE_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}\.html$/;
const USERNAME_PATTERN = /^[a-z0-9-]{3,39}$/;

// Mirrors MAX_PAGES in src/lib/pages.js (landing + 11). Objects are capped
// above the editor's 400 KB site limit to leave room for the injected
// snippets and a password bundle's encryption overhead.
const MAX_EXTRA_PAGES = 11;
const MAX_OBJECT_BYTES = 3 * 1024 * 1024;
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const MAX_DEPLOYMENTS_PER_USER = 50;

export const deploymentDocPath = (slug) => {
  if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) throw new Error('Invalid slug.');
  return `deployments/${slug.replace('/', '~')}`;
};

export const landingKeyBase = (storagePath) => storagePath.replace(/\.html$/, '');
const pageKey = (storagePath, pageFile) => `${landingKeyBase(storagePath)}/${pageFile}`;

const randomToken = (length) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % 62]).join('');
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

const byteLength = (text) => new TextEncoder().encode(text).length;

class DeployError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const requireSetup = async (request, env) => {
  if (!serviceAccountConfigured(env) || !r2Configured(env)) {
    throw new DeployError('Deploys are not configured on this server.', 404);
  }
  const user = await authorize(request, env);
  if (!user || user.id === 'local-user') throw new DeployError('Sign in required.', 401);
  return user;
};

// Validates the upload body. Returns the cleaned fields or throws a 400.
const parseUpload = (body) => {
  const bad = (message) => { throw new DeployError(message, 400); };
  if (!body || typeof body !== 'object') bad('Invalid request.');
  const { slug, landing, pages = {}, bundled = false } = body;
  if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) bad('That link is not valid. Use letters, numbers and dashes.');
  if (typeof landing !== 'string' || !landing) bad('The app has no landing page.');
  if (byteLength(landing) > MAX_OBJECT_BYTES) bad('This app is too large to publish.');
  if (!pages || typeof pages !== 'object' || Array.isArray(pages)) bad('Invalid pages.');
  const entries = Object.entries(pages);
  if (bundled && entries.length) bad('A password-protected site keeps every page inside its landing page.');
  if (entries.length > MAX_EXTRA_PAGES) bad('This site has too many pages to publish.');
  for (const [name, html] of entries) {
    if (!PAGE_FILE_PATTERN.test(name) || name === 'index.html') bad(`"${String(name).slice(0, 60)}" is not a valid page name.`);
    if (typeof html !== 'string' || byteLength(html) > MAX_OBJECT_BYTES) bad(`The page "${name}" is too large to publish.`);
  }
  const websiteId = body.analyticsWebsiteId == null || body.analyticsWebsiteId === '' ? null : String(body.analyticsWebsiteId);
  if (websiteId && !/^[a-zA-Z0-9-]{1,64}$/.test(websiteId)) bad('Invalid analytics website.');
  return {
    slug,
    landing,
    pages: entries,
    bundled: Boolean(bundled),
    passwordProtected: Boolean(body.passwordProtected),
    projectId: String(body.projectId ?? '').slice(0, 64),
    name: typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 200) : null,
    analyticsEnabled: Boolean(body.analyticsEnabled) && Boolean(websiteId),
    analyticsWebsiteId: body.analyticsEnabled ? websiteId : null,
  };
};

// The `username/` part of a slug must be the caller's own claimed username,
// and a bare slug must not shadow anyone's username (it would sit where their
// `username/...` links live).
const checkSlugNamespace = async (env, uid, slug) => {
  if (slug.includes('/')) {
    const prefix = slug.slice(0, slug.indexOf('/'));
    const profile = await getDoc(env, `users/${uid}`);
    if (!USERNAME_PATTERN.test(prefix) || profile?.data?.username !== prefix) {
      throw new DeployError('Links can only use your own username.', 403);
    }
  } else if (USERNAME_PATTERN.test(slug) && await getDoc(env, `usernames/${slug}`)) {
    throw new DeployError('That link is taken.', 409, 'taken');
  }
};

const checkAnalyticsSite = async (env, uid, websiteId, existing) => {
  if (!websiteId || existing?.analytics_website_id === websiteId) return;
  const site = await getDoc(env, analyticsSiteDocPath(websiteId));
  if (site?.data?.user_id !== uid) throw new DeployError('Invalid analytics website.', 400);
};

const ownedStoragePath = (uid, path) =>
  typeof path === 'string' && STORAGE_PATH_PATTERN.test(path) && path.startsWith(`${uid}/`) ? path : null;

// Objects a deployment doc says exist (landing plus separate pages).
const objectKeysFor = (doc) => {
  const path = ownedStoragePath(doc.user_id, doc.storage_path);
  if (!path) return [];
  const pages = doc.bundle ? [] : (doc.page_names || []).filter((name) => PAGE_FILE_PATTERN.test(name));
  return [path, ...pages.map((name) => pageKey(path, name))];
};

// POST /api/deploys
// { slug, landing, pages: { 'about.html': html }, bundled, passwordProtected,
//   projectId, name, analyticsEnabled, analyticsWebsiteId }
// -> { slug, path, pageObjects, updatedAt }. 409 { code: 'taken' } when the
// slug belongs to someone else (the client retries with a longer tail).
export async function handleDeployUpload(request, env) {
  let step = 'authorize';
  try {
    const user = await requireSetup(request, env);
    if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) throw new DeployError('This app is too large to publish.', 413);
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) throw new DeployError('This app is too large to publish.', 413);
    let body;
    try { body = JSON.parse(raw); } catch { throw new DeployError('Invalid JSON body.', 400); }
    const upload = parseUpload(body);
    const docPath = deploymentDocPath(upload.slug);

    step = 'check link';
    const existing = (await getDoc(env, docPath))?.data || null;
    if (existing && existing.user_id !== user.id) throw new DeployError('That link is taken.', 409, 'taken');
    if (!existing) {
      await checkSlugNamespace(env, user.id, upload.slug);
      const owned = await runQuery(env, 'deployments', {
        where: [['user_id', '==', user.id]], select: ['user_id'], limit: MAX_DEPLOYMENTS_PER_USER,
      });
      if (owned.length >= MAX_DEPLOYMENTS_PER_USER) {
        throw new DeployError(`You can have up to ${MAX_DEPLOYMENTS_PER_USER} published apps. Unpublish one first.`, 403, 'limit');
      }
    }
    await checkAnalyticsSite(env, user.id, upload.analyticsWebsiteId, existing);

    // A redeploy keeps its objects' paths, so cached copies are replaced in place.
    const reused = existing ? ownedStoragePath(user.id, existing.storage_path) : null;
    const storagePath = reused || `${user.id}/${randomToken(10)}.html`;
    const pageFiles = upload.pages.map(([name]) => name);

    step = 'upload to storage';
    await putObject(env, storagePath, upload.landing);
    for (const [name, html] of upload.pages) await putObject(env, pageKey(storagePath, name), html);

    step = 'save deployment';
    const updatedAt = new Date().toISOString();
    try {
      await runTransaction(env, async (tx) => {
        const current = await getDoc(env, docPath, { transaction: tx });
        if (current && current.data.user_id !== user.id) throw new DeployError('That link is taken.', 409, 'taken');
        return {
          writes: [setWrite(env, docPath, {
            slug: upload.slug,
            user_id: user.id,
            project_id: upload.projectId,
            storage_path: storagePath,
            page_names: pageFiles,
            bundle: upload.bundled,
            password_protected: upload.passwordProtected,
            name: upload.name,
            analytics_enabled: upload.analyticsEnabled,
            analytics_website_id: upload.analyticsWebsiteId,
            created_at: current?.data?.created_at || updatedAt,
            updated_at: updatedAt,
          })],
        };
      });
    } catch (err) {
      // Lost a race for a new slug: the objects were never linked, drop them.
      if (!reused) await deleteObjects(env, [storagePath, ...pageFiles.map((name) => pageKey(storagePath, name))]).catch(() => {});
      throw err;
    }

    // Pages dropped since the last deploy (or folded into a password bundle)
    // must stop being served. Best effort: they're unreachable once the doc
    // no longer lists them.
    if (existing && !existing.bundle) {
      const stale = (existing.page_names || []).filter((name) => PAGE_FILE_PATTERN.test(name) && !pageFiles.includes(name));
      if (stale.length) {
        await deleteObjects(env, stale.map((name) => pageKey(storagePath, name)))
          .catch((err) => console.error('[deploys] stale page cleanup failed:', err?.message || err));
      }
    }

    return json({ slug: upload.slug, path: storagePath, pageObjects: pageFiles, updatedAt });
  } catch (err) {
    if (err instanceof DeployError) return json({ error: err.message, ...(err.code ? { code: err.code } : {}) }, err.status);
    console.error(`[deploys] upload failed at "${step}":`, err?.message || err);
    // 500, not 502: Cloudflare swaps a 502 for its own HTML error page, which
    // would hide this message.
    return json({ error: `Could not publish the app (failed at: ${step}). Please try again.` }, 500);
  }
}

// DELETE /api/deploys?slug=<slug>. Removing something already gone succeeds.
export async function handleDeployDelete(request, env) {
  try {
    const user = await requireSetup(request, env);
    const slug = new URL(request.url).searchParams.get('slug') || '';
    if (!SLUG_PATTERN.test(slug)) throw new DeployError('Invalid slug.', 400);
    const docPath = deploymentDocPath(slug);
    const doc = await getDoc(env, docPath);
    if (!doc) return json({ removed: true });
    if (doc.data.user_id !== user.id) throw new DeployError('Deployment not found.', 404);
    // The doc first, so the link stops resolving even if object cleanup fails.
    await commitAll(env, [deleteWrite(env, docPath)]);
    await deleteObjects(env, objectKeysFor(doc.data));
    return json({ removed: true });
  } catch (err) {
    if (err instanceof DeployError) return json({ error: err.message }, err.status);
    console.error('[deploys] delete failed:', err?.message || err);
    return json({ error: 'Could not take the app offline. Please try again.' }, 500);
  }
}

// Every deployment and stored object of an account, for account deletion.
export const removeAllDeploymentsFor = async (env, uid) => {
  const docs = await runQuery(env, 'deployments', { where: [['user_id', '==', uid]] });
  // The docs first, so every link stops resolving even if object cleanup fails.
  await commitAll(env, docs.map((doc) => deleteWrite(env, `deployments/${doc.id}`)));
  if (!r2Configured(env)) return;
  await deleteObjects(env, docs.flatMap((doc) => objectKeysFor(doc.data)));
  // Sweep leftovers (pages dropped by redeploys) best-effort: listing can be
  // denied by the R2 token's scope, and the objects are private and no longer
  // reachable without their docs, so it must not block deleting the account.
  try {
    await deleteObjects(env, await listKeys(env, `${uid}/`));
  } catch (err) {
    console.error(`[deploys] leftover sweep for ${uid} failed:`, err?.message || err);
  }
};

// For handlers that only read: the deployment of a slug, or null when the
// slug is malformed or unknown.
export const readDeployment = async (env, slug) => {
  if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) return null;
  return (await getDoc(env, deploymentDocPath(slug)))?.data || null;
};

