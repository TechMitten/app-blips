import {
  collection, doc, getDoc, getDocs, query, where, orderBy, writeBatch, serverTimestamp, Bytes,
} from 'firebase/firestore';
import { db } from '../firebase';

// Signed-in projects in Firestore. A project's data holds every version with
// all its pages, which easily outgrows Firestore's 1 MiB document limit, so
// it's stored as:
//
//   projects/{id}               { user_id, name, updated_at, rev, chunk_count, size, encoding,
//                                 version_count, studio_mode, deployment }
//   projects/{id}/chunks/{n}    { user_id, rev, data: Bytes }   n = 0..chunk_count-1
//
// The meta doc carries what the Apps list shows (and what deleting needs), so
// listing reads only meta docs; the chunks are downloaded when a project is
// opened. Old versions' pages live in R2, not here (lib/historyStore.js).
// The JSON is gzipped (HTML compresses ~5-10x) and split into byte chunks.
// Every save rewrites the meta doc and all chunks in one atomic batch under a
// fresh `rev`, so a reader that sees chunks from two different saves (another
// tab saved in between) can tell and re-read. firestore.rules keep every doc
// owner-only.
const CHUNK_BYTES = 900 * 1024;
// A batch commit is capped at 10 MiB on the wire, where bytes travel base64
// (4/3 larger), so a save stays at 8 chunks (~7 MB compressed).
const MAX_CHUNKS = 8;

const supportsGzip = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

const pipeBytes = async (bytes, transform) =>
  new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(transform)).arrayBuffer());

const encodeData = async (data) => {
  const json = new TextEncoder().encode(JSON.stringify(data));
  if (!supportsGzip) return { bytes: json, encoding: 'json' };
  return { bytes: await pipeBytes(json, new CompressionStream('gzip')), encoding: 'gzip' };
};

const decodeData = async (bytes, encoding) => {
  const json = encoding === 'gzip' ? await pipeBytes(bytes, new DecompressionStream('gzip')) : bytes;
  return JSON.parse(new TextDecoder().decode(json));
};

const randomRev = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

const projectRef = (id) => doc(db, 'projects', id);
const chunkRef = (id, n) => doc(db, 'projects', id, 'chunks', String(n));

const isoTime = (value) => (value?.toDate ? value.toDate().toISOString() : null);

class StaleRead extends Error {}

// The project's data from its chunks, checked against the meta doc's rev.
const readChunks = async (uid, id, meta) => {
  const snapshot = await getDocs(query(collection(db, 'projects', id, 'chunks'), where('user_id', '==', uid)));
  const chunks = snapshot.docs
    .map((chunk) => ({ n: Number(chunk.id), ...chunk.data() }))
    .filter((chunk) => chunk.n < meta.chunk_count)
    .sort((a, b) => a.n - b.n);
  if (chunks.length !== meta.chunk_count || chunks.some((chunk, i) => chunk.n !== i || chunk.rev !== meta.rev)) {
    throw new StaleRead();
  }
  const parts = chunks.map((chunk) => chunk.data.toUint8Array());
  const joined = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return decodeData(joined, meta.encoding);
};

// { id, name, data, updated_at } for one meta doc, re-reading once if a save
// landed between reading the meta doc and its chunks.
const assemble = async (uid, id, meta) => {
  try {
    return { id, name: meta.name, data: await readChunks(uid, id, meta), updated_at: isoTime(meta.updated_at) };
  } catch (err) {
    if (!(err instanceof StaleRead)) throw err;
    const fresh = await getDoc(projectRef(id));
    if (!fresh.exists()) return null;
    const freshMeta = fresh.data();
    return { id, name: freshMeta.name, data: await readChunks(uid, id, freshMeta), updated_at: isoTime(freshMeta.updated_at) };
  }
};

const studioModeOf = (mode) => (mode === 'website' || mode === 'game' ? mode : 'app');

// A list row from the meta doc alone: { id, name, summary, updated_at }.
const summaryRow = (id, meta) => ({
  id,
  name: meta.name,
  summary: { versionCount: meta.version_count, studioMode: studioModeOf(meta.studio_mode), deployment: meta.deployment || null },
  updated_at: isoTime(meta.updated_at),
});

// Every project of `uid`, newest first, as rows for cloudRowsToProjects. Only
// meta docs are read; a project saved before they carried a summary is read
// in full once (its next save adds the summary). One unreadable project is
// logged and skipped rather than hiding all the others.
export const listCloudProjects = async (uid) => {
  const snapshot = await getDocs(query(
    collection(db, 'projects'),
    where('user_id', '==', uid),
    orderBy('updated_at', 'desc'),
  ));
  const rows = await Promise.all(snapshot.docs.map((meta) => {
    const data = meta.data();
    if (Number.isInteger(data.version_count)) return summaryRow(meta.id, data);
    return assemble(uid, meta.id, data).catch((err) => {
      console.error('Could not read project', meta.id, err);
      return null;
    });
  }));
  return rows.filter(Boolean);
};

export const loadCloudProject = async (uid, id) => {
  const meta = await getDoc(projectRef(id));
  if (!meta.exists() || meta.data().user_id !== uid) return null;
  return assemble(uid, id, meta.data());
};

export const saveCloudProject = async (uid, id, name, data) => {
  const { bytes, encoding } = await encodeData(data);
  const count = Math.max(1, Math.ceil(bytes.length / CHUNK_BYTES));
  if (count > MAX_CHUNKS) {
    throw new Error('This app has grown too large to save. Delete some old versions or start a new app.');
  }
  const previous = await getDoc(projectRef(id));
  const previousCount = previous.exists() ? previous.data().chunk_count || 0 : 0;

  const rev = randomRev();
  const batch = writeBatch(db);
  batch.set(projectRef(id), {
    user_id: uid,
    name: String(name || 'Untitled App').slice(0, 200),
    updated_at: serverTimestamp(),
    rev,
    chunk_count: count,
    size: bytes.length,
    encoding,
    version_count: Array.isArray(data.versions) ? data.versions.length : 0,
    studio_mode: studioModeOf(data.studioMode),
    deployment: data.deployment || null,
  });
  for (let n = 0; n < count; n += 1) {
    batch.set(chunkRef(id, n), {
      user_id: uid,
      rev,
      data: Bytes.fromUint8Array(bytes.subarray(n * CHUNK_BYTES, (n + 1) * CHUNK_BYTES)),
    });
  }
  for (let n = count; n < previousCount; n += 1) batch.delete(chunkRef(id, n));
  await batch.commit();
};

export const renameCloudProject = async (id, name) => {
  const batch = writeBatch(db);
  batch.update(projectRef(id), { name: String(name).slice(0, 200), updated_at: serverTimestamp() });
  await batch.commit();
};

export const deleteCloudProject = async (id) => {
  const meta = await getDoc(projectRef(id));
  if (!meta.exists()) return;
  const batch = writeBatch(db);
  for (let n = 0; n < (meta.data().chunk_count || 0); n += 1) batch.delete(chunkRef(id, n));
  batch.delete(projectRef(id));
  await batch.commit();
};
