// Content-addressed file store for imported codebases (file text and binary
// assets, keyed by sha256). The desktop app keeps blobs on disk in each
// project's blobs/ folder (electron/projectStore.js, over IPC); the browser
// dev build (`npm run dev`) uses IndexedDB. Reads are served from an
// in-memory cache that load paths fill first (ensure), so unpacking a saved
// version stays synchronous.
import { desktopBridge, isDesktop } from './desktop.js';
import { HASH_RE } from './codebase/paths.js';
import { toBytes } from './codebase/hash.js';

const bytesCache = new Map(); // hash -> Uint8Array
const textCache = new Map(); // hash -> string
const stored = new Map(); // projectId -> Set of hashes known to be persisted
const decoder = new TextDecoder();

// Electron's IPC moves structured clones; keep each call well under main's
// per-call cap.
const MAX_BATCH_BYTES = 12 * 1024 * 1024;

function storedFor(projectId) {
  let set = stored.get(projectId);
  if (!set) { set = new Set(); stored.set(projectId, set); }
  return set;
}

// --- IndexedDB backend (web/dev only) ---
let dbPromise = null;
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('appblips-blobs', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('blobs');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

async function idbPut(entries) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('blobs', 'readwrite');
    for (const { hash, bytes } of entries) tx.objectStore('blobs').put(bytes, hash);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(hashes) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('blobs', 'readonly');
    const out = [];
    for (const hash of hashes) {
      const request = tx.objectStore('blobs').get(hash);
      request.onsuccess = () => { if (request.result) out.push({ hash, bytes: new Uint8Array(request.result) }); };
    }
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
  });
}

function remember(hash, bytes) {
  bytesCache.set(hash, bytes);
}

// entries: Map<hash, string | Uint8Array>. Writes only what this project
// hasn't stored yet; resolves once everything is persisted.
export async function putBlobs(projectId, entries) {
  const known = storedFor(projectId);
  const pending = [];
  for (const [hash, content] of entries) {
    if (!HASH_RE.test(hash)) continue;
    if (typeof content === 'string') textCache.set(hash, content);
    else remember(hash, content);
    if (!known.has(hash)) pending.push({ hash, bytes: toBytes(content) });
  }
  if (!pending.length) return;
  if (isDesktop) {
    let batch = [];
    let size = 0;
    const flush = async () => {
      if (!batch.length) return;
      await desktopBridge.blobs.put(projectId, batch);
      batch = [];
      size = 0;
    };
    for (const entry of pending) {
      if (size + entry.bytes.length > MAX_BATCH_BYTES) await flush();
      batch.push(entry);
      size += entry.bytes.length;
    }
    await flush();
  } else {
    await idbPut(pending);
  }
  for (const { hash } of pending) known.add(hash);
}

// Loads any of `hashes` not yet in memory. Hashes that come back are known
// to be stored for this project.
export async function ensureBlobs(projectId, hashes) {
  const known = storedFor(projectId);
  const missing = [...hashes].filter((h) => HASH_RE.test(h) && !bytesCache.has(h) && !textCache.has(h));
  for (const h of hashes) if (bytesCache.has(h) || textCache.has(h)) known.add(h);
  if (!missing.length) return;
  const found = isDesktop ? await desktopBridge.blobs.get(projectId, missing) : await idbGet(missing);
  for (const { hash, bytes } of found || []) {
    remember(hash, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    known.add(hash);
  }
}

export function blobText(hash) {
  if (textCache.has(hash)) return textCache.get(hash);
  const bytes = bytesCache.get(hash);
  if (!bytes) return undefined;
  const text = decoder.decode(bytes);
  textCache.set(hash, text);
  return text;
}

export function blobBytes(hash) {
  if (bytesCache.has(hash)) return bytesCache.get(hash);
  const text = textCache.get(hash);
  return text === undefined ? undefined : toBytes(text);
}

// Saving under a new id (first save of an import) re-uses what is cached.
export function forgetProjectBlobs(projectId) {
  stored.delete(projectId);
}
