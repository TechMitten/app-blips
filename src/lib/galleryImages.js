// The project's image gallery ("My images"): photos the user uploads so the
// AI can use them ("put team-photo in the hero"). The AI only gets each
// image's name, size and the user's note (prompts.js buildImageGalleryNote),
// never the pixels.
//
// Pages refer to a gallery image by the relative path it has once published,
// images/<name> -- the same folder Pollinations copies go to (siteImages.js),
// so a published site or a ZIP just carries the bytes at that path. The
// sandboxed preview can't resolve relative paths, so the path is swapped for a
// loadable URL at render time (previewBridge.js), never in stored `files`.
// Bytes live in the project's content-addressed blob store (blobStore.js);
// the project row keeps only [{ hash, name, type, width, height, note }].
import { SITE_IMAGE_PATH_RE, MAX_SITE_IMAGES_BYTES, bytesToBase64 } from './siteImages.js';
import { sha256Hex } from './codebase/hash.js';

export const MAX_GALLERY_IMAGES = 25;
export const MAX_GALLERY_UPLOAD_BYTES = 15 * 1024 * 1024;
// Shared with Pollinations copies: surgeApi.js caps a site's images at this.
export const MAX_GALLERY_BYTES = MAX_SITE_IMAGES_BYTES;
export const MAX_GALLERY_NOTE = 200;
const MAX_DIMENSION = 2000;
const MAX_NAME_STEM = 40;

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' };
const HASH_RE = /^[a-f0-9]{64}$/;

export const galleryPath = (image) => `images/${image.name}`;

// The open project's gallery, read by the system prompts (prompts.js
// buildHtmlSystemPrompt) like the connected services are, so every build,
// edit, fix and review sees it without threading it through each call.
let activeGallery = [];
export const setActiveGallery = (images) => { activeGallery = Array.isArray(images) ? images : []; };
export const getActiveGallery = () => activeGallery;

const stemOf = (fileName) => String(fileName || '')
  .replace(/\.[a-z0-9]{1,5}$/i, '')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, MAX_NAME_STEM)
  .replace(/-+$/, '') || 'image';

// "Team Photo (1).JPG" + image/jpeg -> "team-photo-1.jpg", made unique among
// `taken` (names already in the gallery) with -2, -3, ...
export function galleryName(fileName, type, taken = []) {
  const ext = EXTENSIONS[type] || 'jpg';
  const used = new Set(taken);
  const stem = stemOf(fileName);
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${stem}.${ext}` : `${stem}-${n}.${ext}`;
    if (!used.has(name) && SITE_IMAGE_PATH_RE.test(`images/${name}`)) return name;
  }
}

// Keeps the extension (it follows the stored type); only the stem is renamed.
export function renamedGalleryName(image, newStem, taken = []) {
  return galleryName(`${newStem}.x`, image.type, taken.filter((name) => name !== image.name));
}

// Saved rows come from disk or a backup; anything malformed is dropped.
export function normalizeGallery(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!item || !HASH_RE.test(item.hash) || !EXTENSIONS[item.type]) continue;
    if (typeof item.name !== 'string' || !SITE_IMAGE_PATH_RE.test(`images/${item.name}`) || seen.has(item.name)) continue;
    seen.add(item.name);
    out.push({
      hash: item.hash,
      name: item.name,
      type: item.type,
      width: Number.isFinite(item.width) ? item.width : 0,
      height: Number.isFinite(item.height) ? item.height : 0,
      size: Number.isFinite(item.size) ? item.size : 0,
      note: typeof item.note === 'string' ? item.note.slice(0, MAX_GALLERY_NOTE) : '',
    });
    if (out.length >= MAX_GALLERY_IMAGES) break;
  }
  return out;
}

// images/<name>, optionally written ./images/ or /images/, standing on its own
// (not the tail of a longer path like assets/images/x.png or a full URL).
const REF_RE = /(?<![A-Za-z0-9_.~%/:-])(?:\.\/|\/)?images\/([A-Za-z0-9_-][A-Za-z0-9._-]{0,79})(?![A-Za-z0-9._/-])/g;

// Replaces each reference to a gallery image with toUrl(image); references
// to names not in the gallery (and those toUrl returns nothing for) are kept.
export function rewriteGalleryRefs(text, images, toUrl) {
  if (typeof text !== 'string' || !images?.length) return text;
  const byName = new Map(images.map((image) => [image.name, image]));
  return text.replace(REF_RE, (match, name) => {
    const image = byName.get(name);
    return (image && toUrl(image)) || match;
  });
}

// The gallery images any page refers to.
export function referencedGalleryImages(files, images) {
  if (!images?.length) return [];
  const names = new Set();
  for (const text of Object.values(files || {})) {
    if (typeof text === 'string') for (const [, name] of text.matchAll(REF_RE)) names.add(name);
  }
  return images.filter((image) => names.has(image.name));
}

// Rename: point every page at the new name.
export function renameGalleryRefs(files, oldName, newName) {
  return Object.fromEntries(Object.entries(files || {}).map(([page, text]) => [
    page,
    typeof text === 'string'
      ? text.replace(REF_RE, (match, name) => (name === oldName ? match.slice(0, -name.length) + newName : match))
      : text,
  ]));
}

// The referenced images with their bytes, for a published site or an export.
// bytesOf(hash) returns the cached bytes (blobStore.blobBytes); images whose
// bytes aren't available are skipped (the page then shows a broken image).
export function galleryExportFiles(files, images, bytesOf) {
  const out = [];
  for (const image of referencedGalleryImages(files, images)) {
    const bytes = bytesOf(image.hash);
    if (bytes) out.push({ name: image.name, path: galleryPath(image), type: image.type, bytes });
  }
  return out;
}

export const galleryDataUrl = (image, bytes) => `data:${image.type};base64,${bytesToBase64(bytes)}`;

// Pages with each referenced gallery image built in as a data: URL, for a
// single-file export.
export function inlineGalleryImages(files, exportFiles) {
  const urls = new Map(exportFiles.map((file) => [file.name, galleryDataUrl(file, file.bytes)]));
  const images = exportFiles.map(({ name }) => ({ name }));
  return Object.fromEntries(Object.entries(files || {}).map(([page, text]) => [
    page,
    rewriteGalleryRefs(text, images, (image) => urls.get(image.name)),
  ]));
}

// --- Upload (browser only) ---

const loadImage = (url) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error("This file couldn't be opened as an image."));
  img.src = url;
});

const canvasBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

// Big photos are scaled down to MAX_DIMENSION and re-encoded (JPEG stays
// JPEG; PNG/WebP become WebP, which keeps transparency). GIFs and SVGs are
// stored as uploaded so animation and vectors survive. The smaller of the
// original and the re-encoded copy wins.
// -> { hash, type, width, height, bytes }
export async function processGalleryUpload(file) {
  if (!file || !/^image\//.test(file.type || '')) throw new Error(`${file?.name || 'This file'} isn't an image.`);
  if (file.size > MAX_GALLERY_UPLOAD_BYTES) throw new Error(`${file.name} is larger than ${MAX_GALLERY_UPLOAD_BYTES / 1024 / 1024} MB.`);
  const original = new Uint8Array(await file.arrayBuffer());
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const width = img.naturalWidth || img.width || 0;
    const height = img.naturalHeight || img.height || 0;
    if (file.type === 'image/gif' || file.type === 'image/svg+xml') {
      return { hash: await sha256Hex(original), type: file.type, width, height, bytes: original };
    }
    const scale = width && height ? Math.min(1, MAX_DIMENSION / Math.max(width, height)) : 1;
    const outWidth = Math.max(1, Math.round(width * scale));
    const outHeight = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = outWidth;
    canvas.height = outHeight;
    const ctx = canvas.getContext('2d');
    let type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
    let blob = null;
    if (ctx) {
      ctx.drawImage(img, 0, 0, outWidth, outHeight);
      blob = await canvasBlob(canvas, type, 0.85);
    }
    // Keep the original when re-encoding didn't help (or isn't possible) and
    // it is already small enough, or in a format we can't keep otherwise.
    let bytes = blob ? new Uint8Array(await blob.arrayBuffer()) : null;
    if (!bytes || (scale === 1 && EXTENSIONS[file.type] && original.length <= bytes.length)) {
      if (!EXTENSIONS[file.type]) throw new Error(`${file.name} is in a format websites can't show. Use JPEG, PNG, WebP, GIF or SVG.`);
      bytes = original;
      type = file.type;
      return { hash: await sha256Hex(bytes), type, width, height, bytes };
    }
    return { hash: await sha256Hex(bytes), type, width: outWidth, height: outHeight, bytes };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const galleryBytesTotal = (images) => images.reduce((sum, image) => sum + (image.size || 0), 0);
