import { versionFiles } from './pages.js';

// Signed-in version history, split between Firestore and R2. The newest
// KEEP_FULL_VERSIONS versions keep their pages inline in the Firestore project.
// Older ones are "archived": their pages go to R2 (functions/_lib/history.js)
// and the version keeps `pageRefs` ({ 'index.html': sha256, … }) in place of
// `files`. Prompt, reply and the rest stay inline, so the history list and the
// LLM's chat context never need R2. Every save rewrites the whole Firestore
// project, so this keeps saves small and stops history hitting its size cap.
//
// A version only loses its `files` after R2 has confirmed every page, so a
// failed upload leaves it inline and nothing is lost. Pages are keyed by
// content, so a page unchanged across versions is stored once.
export const KEEP_FULL_VERSIONS = 10;
// Stays under the server's 8 MB request cap (JSON escaping adds a little).
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_ITEMS = 200;

export const isArchivedVersion = (version) => Boolean(version && !version.files && version.pageRefs);

export const hashPage = async (html) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html))),
    (b) => b.toString(16).padStart(2, '0')).join('');

// Batches of pages within the upload limits.
const uploadBatches = (pages) => {
  const batches = [];
  let batch = [];
  let bytes = 0;
  for (const page of pages) {
    if (batch.length && (bytes + page.html.length > MAX_UPLOAD_BYTES || batch.length >= MAX_ITEMS)) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(page);
    bytes += page.html.length;
  }
  if (batch.length) batches.push(batch);
  return batches;
};

// The archive/restore functions, bound to `getIdToken` (the signed-in user's
// Firebase ID token) and their own session caches. lib/historyStore.js makes
// the app's one instance; tests make their own.
export const createHistoryStore = ({ getIdToken }) => {
  // Off for the rest of the session once the server says history storage isn't
  // set up (501), so saves don't keep asking.
  let historyAvailable = true;
  // `<projectId>/<sha256>` -> html, for pages uploaded or fetched this session:
  // undo/redo across archived versions doesn't refetch, and a known page isn't
  // re-uploaded. Keyed by project too, as R2 stores each project's pages apart.
  const pageCache = new Map();
  const cacheKey = (projectId, hash) => `${projectId}/${hash}`;
  // version object -> its pageRefs once uploaded. The workspace keeps full
  // versions in memory, so without this every save would re-hash them all.
  const uploadedRefs = new WeakMap();

  const historyRequest = async (method, path, body) => {
    const res = await fetch(path, {
      method,
      headers: {
        authorization: `Bearer ${await getIdToken()}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 501) historyAvailable = false;
    if (!res.ok) throw new Error(data.error || 'Version history request failed.');
    return data;
  };

  // `versions` with every version older than the newest KEEP_FULL_VERSIONS
  // archived (`keepIndex`, the open version, stays inline so reopening the
  // project needs no fetch). Returns the input unchanged when there's nothing
  // to archive or the upload fails.
  const archiveVersions = async (projectId, versions, keepIndex = -1) => {
    const cutoff = versions.length - KEEP_FULL_VERSIONS;
    if (!historyAvailable || cutoff <= 0) return versions;
    const targets = [];
    for (let i = 0; i < cutoff; i += 1) {
      if (i !== keepIndex && !isArchivedVersion(versions[i])) targets.push(i);
    }
    if (!targets.length) return versions;

    // Pages already in R2: from this session, or referenced by versions
    // archived in an earlier save.
    const stored = new Set();
    for (const version of versions) {
      if (isArchivedVersion(version)) Object.values(version.pageRefs).forEach((hash) => stored.add(hash));
    }

    try {
      const refsByIndex = new Map();
      const toUpload = new Map();
      for (const i of targets) {
        if (uploadedRefs.has(versions[i])) {
          refsByIndex.set(i, uploadedRefs.get(versions[i]));
          continue;
        }
        const refs = {};
        for (const [name, html] of Object.entries(versionFiles(versions[i]))) {
          if (typeof html !== 'string') continue;
          const hash = await hashPage(html);
          refs[name] = hash;
          if (!stored.has(hash) && !pageCache.has(cacheKey(projectId, hash))) toUpload.set(hash, html);
        }
        refsByIndex.set(i, refs);
      }
      const uploads = [...toUpload].map(([hash, html]) => ({ hash, html }));
      for (const batch of uploadBatches(uploads)) {
        await historyRequest('POST', '/api/history/pages', { projectId, pages: batch });
      }
      for (const { hash, html } of uploads) pageCache.set(cacheKey(projectId, hash), html);
      for (const [i, refs] of refsByIndex) uploadedRefs.set(versions[i], refs);

      return versions.map((version, i) => {
        if (!refsByIndex.has(i)) return version;
        const archived = { ...version, pageRefs: refsByIndex.get(i) };
        delete archived.files;
        delete archived.code;
        return archived;
      });
    } catch (err) {
      console.error('Could not archive old versions:', err);
      return versions;
    }
  };

  // The version's pages, fetching an archived version's from R2. Throws when
  // they can't be loaded, so the caller can keep showing what it had.
  const ensureVersionFiles = async (projectId, version) => {
    if (!isArchivedVersion(version)) return versionFiles(version);
    const missing = [...new Set(Object.values(version.pageRefs))].filter((hash) => !pageCache.has(cacheKey(projectId, hash)));
    for (let i = 0; i < missing.length; i += MAX_ITEMS) {
      const { pages = {} } = await historyRequest('POST', '/api/history/fetch', { projectId, hashes: missing.slice(i, i + MAX_ITEMS) });
      for (const [hash, html] of Object.entries(pages)) {
        if (typeof html === 'string') pageCache.set(cacheKey(projectId, hash), html);
      }
    }
    const files = {};
    for (const [name, hash] of Object.entries(version.pageRefs)) {
      const html = pageCache.get(cacheKey(projectId, hash));
      if (html === undefined) throw new Error('Part of this version could not be loaded.');
      files[name] = html;
    }
    return files;
  };

  // Removes a project's archived pages. Best effort: they're private and
  // unreachable once the project is gone.
  const deleteProjectHistory = async (projectId) => {
    if (!historyAvailable) return;
    try {
      await historyRequest('DELETE', `/api/history?projectId=${encodeURIComponent(projectId)}`);
    } catch (err) {
      console.error('Could not delete version history:', err);
    }
  };

  return { archiveVersions, ensureVersionFiles, deleteProjectHistory };
};
