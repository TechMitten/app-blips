// Packs codebase versions for saving and unpacks them on load. In memory a
// version holds `files: {path: text}` like every other project (new versions
// spread the previous map, so unchanged strings are shared). Saved, it holds
// `tree: {path: sha256}` instead and the text lives once in the blob store,
// so 40 versions of an 800 KB codebase cost one copy plus the edits, not 32 MB
// of JSON parsed, compared and sent over IPC on every save.
import { sha256Hex } from './hash.js';

// Strings are hashed once per session; the cache is bounded so a long session
// doesn't pin every superseded string.
const hashCache = new Map();
const MAX_CACHED = 20000;

async function hashText(text) {
  const cached = hashCache.get(text);
  if (cached) return cached;
  const hash = await sha256Hex(text);
  if (hashCache.size >= MAX_CACHED) hashCache.clear();
  hashCache.set(text, hash);
  return hash;
}

// Returns { versions, texts: Map<hash, text> } where versions carry `tree`
// in place of `files` and texts are every blob those trees reference.
export async function packVersions(versions) {
  const texts = new Map();
  const packed = [];
  for (const version of versions) {
    if (!version?.files) { packed.push(version); continue; }
    const { files, ...rest } = version;
    const tree = {};
    for (const [path, text] of Object.entries(files)) {
      if (typeof text !== 'string') continue;
      const hash = await hashText(text);
      tree[path] = hash;
      texts.set(hash, text);
    }
    packed.push({ ...rest, tree });
  }
  return { versions: packed, texts };
}

// Text blobs a set of saved versions needs to unpack.
export function referencedTextHashes(versions) {
  const hashes = new Set();
  for (const version of versions || []) {
    for (const hash of Object.values(version?.tree || {})) hashes.add(hash);
  }
  return hashes;
}

export function referencedAssetHashes(versions) {
  const hashes = new Set();
  for (const version of versions || []) {
    for (const hash of Object.values(version?.assets || {})) hashes.add(hash);
  }
  return hashes;
}

// textOf(hash) -> string | undefined (blobs must already be loaded). A
// missing blob leaves that file out rather than failing the whole project.
export function unpackVersions(versions, textOf) {
  const strings = new Map();
  const missing = new Set();
  const unpacked = (versions || []).map((version) => {
    if (!version?.tree) return version;
    const { tree, ...rest } = version;
    const files = {};
    for (const [path, hash] of Object.entries(tree)) {
      // One shared string per blob, like the in-memory model.
      let text = strings.get(hash);
      if (text === undefined) {
        text = textOf(hash);
        if (typeof text !== 'string') { missing.add(hash); continue; }
        strings.set(hash, text);
      }
      files[path] = text;
    }
    for (const [path, text] of Object.entries(files)) hashCache.set(text, tree[path]);
    return { ...rest, files };
  });
  return { versions: unpacked, missing: [...missing] };
}
