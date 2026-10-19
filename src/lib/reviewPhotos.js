// The screenshots a review cites as evidence for its problems. They are
// saved as JPEGs in the project's content-addressed file store (IndexedDB in
// the browser, the project folder's blobs/ on desktop) and each problem keeps
// only the hash, so saved projects and JSON backups don't carry images inline.
// A backup restored elsewhere has the hashes but not the photos; the chat
// then shows the report without them.
import { compressImageDataUrl } from './attachments.js';
import { putBlobs, ensureBlobs, blobBytes } from './blobStore.js';
import { sha256Hex } from './codebase/hash.js';

const dataUrlBytes = (dataUrl) => {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

// photos: { [screenshot number]: dataUrl }. Returns the problems with `photo`
// set to the stored image's hash where one was cited.
export async function storeReviewPhotos(projectId, problems, photos, { compress = compressImageDataUrl } = {}) {
  const cited = [...new Set(problems.map((item) => item.screenshot).filter((n) => photos[n]))];
  if (!projectId || !cited.length) return problems;
  const hashes = {};
  const entries = new Map();
  for (const n of cited) {
    const bytes = dataUrlBytes(await compress(photos[n], { maxDimension: 1400, quality: 0.8 }));
    const hash = await sha256Hex(bytes);
    hashes[n] = hash;
    entries.set(hash, bytes);
  }
  await putBlobs(projectId, entries);
  return problems.map((item) => (hashes[item.screenshot] ? { ...item, photo: hashes[item.screenshot] } : item));
}

// Object URLs for the stored photos that could be found, by hash. The caller
// revokes them.
export async function loadReviewPhotoUrls(projectId, hashes) {
  if (!projectId || !hashes.length) return {};
  await ensureBlobs(projectId, hashes);
  const urls = {};
  for (const hash of hashes) {
    const bytes = blobBytes(hash);
    if (bytes) urls[hash] = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
  }
  return urls;
}
