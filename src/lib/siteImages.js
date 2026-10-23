// Pollinations deletes a stored image after 30 days without a view, so images
// the AI made (https://media.pollinations.ai/<id>, see pollinations.js) leave
// with the site when it is published or exported: each one is downloaded and
// the pages point at the copy (images/<id>.<ext>) instead. Retrieval is
// public and allows cross-origin reads, so no key or server is involved.
import { POLLINATIONS_MEDIA } from './pollinationsApp.js';

const MEDIA_URL_RE = /https:\/\/media\.pollinations\.ai\/([A-Za-z0-9._-]{1,200})(?![A-Za-z0-9._/-])/g;
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' };
// The published name of a copied image; surgeApi.js accepts only these. The
// length cap keeps site/images/<name> inside a tar header's 100-byte name.
export const SITE_IMAGE_PATH_RE = /^images\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,79}\.(?:jpg|png|webp|gif|svg)$/;
export const MAX_SITE_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_SITE_IMAGES_BYTES = 60 * 1024 * 1024;
const CONCURRENCY = 4;

export const findStoredImages = (files) => {
  const ids = new Set();
  for (const text of Object.values(files || {})) {
    if (typeof text === 'string') for (const [, id] of text.matchAll(MEDIA_URL_RE)) ids.add(id);
  }
  return [...ids];
};

async function download(id, fetchImpl) {
  const response = await fetchImpl(`${POLLINATIONS_MEDIA}/${id}`, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`error ${response.status}`);
  const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!TYPES[type]) throw new Error(`unexpected type ${type || 'none'}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_SITE_IMAGE_BYTES) throw new Error('too large');
  return { type, bytes };
}

// Downloads every stored image the pages use. An image that can't be
// downloaded (already deleted, offline) keeps its Pollinations address.
// -> { images: [{ id, path, type, bytes }], failed: number }
export async function collectSiteImages(files, { fetch: fetchImpl = globalThis.fetch } = {}) {
  const ids = findStoredImages(files);
  const images = [];
  let failed = 0;
  let total = 0;
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      try {
        const { type, bytes } = await download(id, fetchImpl);
        // An id may already end in an extension; the type decides the name.
        const path = `images/${id.replace(/\.[a-z0-9]{2,4}$/i, '')}.${TYPES[type]}`;
        if (!SITE_IMAGE_PATH_RE.test(path)) throw new Error('name too long');
        if (total + bytes.length > MAX_SITE_IMAGES_BYTES) throw new Error('site images too large');
        total += bytes.length;
        images.push({ id, path, type, bytes });
      } catch (err) {
        failed++;
        console.warn(`[siteImages] keeping the Pollinations address of ${id}:`, err?.message || err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
  return { images, failed };
}

const rewrite = (files, address) => Object.fromEntries(Object.entries(files).map(([name, text]) => [
  name,
  typeof text === 'string' ? text.replace(MEDIA_URL_RE, (match, id) => address(id) || match) : text,
]));

// Pages pointing at images/<id>.<ext>, for a published site or a ZIP.
export const pointAtCopies = (files, images) => {
  const paths = new Map(images.map(({ id, path }) => [id, path]));
  return rewrite(files, (id) => paths.get(id));
};

export const bytesToBase64 = (bytes) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

// Pages with each image built in as a data: URL, for a single-file export.
export const inlineImages = (files, images) => {
  const urls = new Map(images.map(({ id, type, bytes }) => [id, `data:${type};base64,${bytesToBase64(bytes)}`]));
  return rewrite(files, (id) => urls.get(id));
};
