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
// the project row keeps only [{ hash, name, type, width, height, note, enabled? }].
import { SITE_IMAGE_PATH_RE, MAX_SITE_IMAGES_BYTES, bytesToBase64 } from './siteImages.js';
import { sha256Hex } from './codebase/hash.js';
import { loadConnectors } from './connectors.js';

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
// What the AI hears about is only the images the user hasn't switched off
// (`enabled: false`), and nothing at all while the My images connector is off.
// The preview, export and the gallery itself still use every image, so pages
// that already show a switched-off image keep working.
let activeGallery = [];
export const setActiveGallery = (images) => { activeGallery = Array.isArray(images) ? images : []; };
export const isGalleryImageEnabled = (image) => image.enabled !== false;
export const getActiveGallery = () => (loadConnectors().images?.enabled
  ? activeGallery.filter(isGalleryImageEnabled)
  : []);
// Every image of the open project, hidden ones too (for telling a page's
// existing use of a hidden image apart from a made-up name).
export const getProjectGallery = () => activeGallery;

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
      // Stored only when switched off, so older projects stay on.
      ...(item.enabled === false ? { enabled: false } : {}),
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

// Words that say nothing about which picture is meant ("my photo", ".jpg").
const FILLER_WORDS = new Set(['image', 'images', 'img', 'photo', 'photos', 'pic', 'picture', 'my', 'the', 'a', 'an', 'of', 'and', 'by', 'pixabay', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'svg']);
const wordsOf = (text) => String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter((word) => word && !FILLER_WORDS.has(word));
// "mountains" matches "mountain", "sunsets" "sunset"; short words must match exactly.
const sameWord = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));

// The gallery image a loosely written name means ("mountain-lake" or
// "lake-photo" for mountain-lake-sunset.jpg), or null. Words count fully
// when they are in an image's name and half when only in its note (Pixabay
// photos' notes list their tags). At least half of the words must match, and
// a tie between two images is no match: guessing wrong is worse than saying so.
export function closestGalleryImage(text, images) {
  const wanted = [...new Set(wordsOf(String(text || '').replace(IMAGE_EXT_RE, '')))];
  if (!wanted.length || !images?.length) return null;
  const scored = images.map((image) => {
    const nameWords = wordsOf(image.name.replace(/\.[^.]+$/, ''));
    const noteWords = wordsOf(image.note);
    let score = 0;
    for (const word of wanted) {
      if (nameWords.some((other) => sameWord(word, other))) score += 1;
      else if (noteWords.some((other) => sameWord(word, other))) score += 0.5;
    }
    return { image, score: score / wanted.length };
  }).sort((a, b) => b.score - a.score);
  const [best, next] = scored;
  if (best.score < 0.5 || (next && next.score === best.score)) return null;
  return best.image;
}

// --- Confirming which image a request means ---
// Before a build that uses My images, the AI's match is shown to the user,
// who approves it before anything is built (llm.js matchGalleryImages,
// App.jsx). These decide when to ask and word the question.

const IMAGE_WORDS_RE = /\b(?:images?|photos?|pictures?|pics?|logos?|icons?|banners?|backgrounds?|hero|gallery|galleries|graphics?|illustrations?|avatars?|headshots?|portraits?|screenshots?|thumbnails?)\b/i;

// Cheap check before asking the AI: does the request mention images at all,
// or a word of one of the image names? Most edits don't, and skip the call.
export function mightMentionGalleryImage(prompt, images) {
  const text = String(prompt || '');
  if (!images?.length || !text.trim()) return false;
  if (IMAGE_WORDS_RE.test(text) || /\.(?:jpe?g|png|webp|gif|svg)\b/i.test(text)) return true;
  const said = new Set(wordsOf(text));
  return images.some((image) => wordsOf(image.name.replace(/\.[^.]+$/, '')).some((word) => word.length >= 3 && [...said].some((other) => sameWord(word, other))));
}

// "Yes", "ok, go ahead", or the approve button's text: the user accepted the
// images shown, so the build starts without asking again.
export const isImageApproval = (text) => /^\s*(?:yes|yep|yeah|yup|y|ok|okay|sure|correct|right|approve[ds]?|confirm(?:ed)?|go ahead|do it|sounds good|perfect|that'?s right|looks good)\b/i.test(String(text || ''));

// What the approve button sends.
export const imageApprovalText = (matches) => {
  const names = [...new Set(matches.map((match) => match.image))];
  return `Yes, use ${names.join(', ')}.`;
};

// The confirmation shown before building. `matches` is
// [{ mentioned, image }] with image '' when nothing matched.
// -> { reply, allMatched }
export function buildImageConfirmReply(matches, images) {
  const lines = matches.map(({ mentioned, image }) => (image
    ? `- “${mentioned}” → **${image}**`
    : `- “${mentioned}” → no image in My images matches this`));
  const allMatched = matches.every((match) => match.image);
  const names = images.map((image) => image.name).join(', ');
  const several = new Set(matches.map((match) => match.image).filter(Boolean)).size > 1;
  const reply = allMatched
    ? `Before I start, please check the ${several ? 'images' : 'image'} I matched from My images:\n\n${lines.join('\n')}\n\nClick **${several ? 'Yes, use them' : 'Yes, use it'}** to go ahead, or tell me which image to use instead. Your images: ${names}.`
    : `Before I start, I need to know which image you mean:\n\n${lines.join('\n')}\n\nTell me which one to use (the name is enough). Your images: ${names}.`;
  return { reply, allMatched };
}

// Ways a user can name `image` in a request, for example prompts:
// { name: 'mountain-lake-sunset.jpg', stem: 'mountain-lake-sunset',
//   partial: 'mountain lake' }. `partial` is the fewest leading words of the
// name that still find this image among `images` (closestGalleryImage), so
// an example built from it really works.
export function galleryNameForms(name, images = []) {
  const stem = name.replace(/\.[^.]+$/, '');
  const words = stem.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const image = images.find((item) => item.name === name);
  let partial = words.join(' ');
  for (let count = 1; count < words.length; count++) {
    const candidate = words.slice(0, Math.max(count, Math.ceil(words.length / 2))).join(' ');
    if (!image || closestGalleryImage(candidate, images) === image) {
      partial = candidate;
      break;
    }
  }
  return { name, stem, partial };
}

// References the AI writes for a gallery image that neither the preview nor
// export would recognise. They become images/<name>, so preview, export and
// publish all find the image:
// - near misses: the bare file name the user pasted (src="team-photo.jpg"),
//   another folder (assets/images/…), other capitals, a wrong or missing
//   extension;
// - loose names, when the user didn't give the exact one and the AI made one
//   up (images/team.jpg for team-photo.jpg): the closest gallery image
//   (closestGalleryImage), and with only one image in the gallery, any
//   made-up name under images/, which is the gallery's own folder.
// Only paths that clearly point at the gallery change: a bare name only right
// after src=, poster=, href= or inside url() (a bare string elsewhere may be
// joined onto "images/" by the code), a name without extension only inside a
// folder, and a short name two images share (logo.png, logo.svg) only when
// written with an extension. `images` are those the AI may use (the visible
// ones); `allImages` adds hidden ones, whose exact names are left alone.
const IMAGE_EXT_RE = /\.(?:jpe?g|png|webp|gif|svg)$/i;
const NEAR_MISS_FOLDERS = new Set(['images', 'image', 'img', 'imgs', 'assets', 'static', 'public', 'photos', 'media', 'my-images', 'myimages', 'gallery', 'uploads', 'src']);
const QUOTED_PATH_RE = /(\b(?:src|poster|href|srcSet|srcset)\s*=\s*\{?\s*)?(["'`])((?:\.{0,2}\/)?(?:[\w-]+\/)*)([\w-][\w.-]{0,79})\2/g;
const URL_PATH_RE = /(url\(\s*)((?:\.{0,2}\/)?(?:[\w-]+\/)*)([\w-][\w.-]{0,79})(\s*\))/g;

export function normalizeGalleryRefs(files, images, allImages = images) {
  if (!images?.length) return files;
  const byName = new Map(images.map((image) => [image.name.toLowerCase(), image]));
  const otherNames = new Set(allImages.map((image) => image.name));
  const byStem = new Map();
  const sharedStems = new Set();
  for (const image of images) {
    const stem = image.name.replace(/\.[^.]+$/, '').toLowerCase();
    if (byStem.has(stem)) sharedStems.add(stem);
    byStem.set(stem, image);
  }
  // -> the corrected path, or null to leave the text alone.
  const resolve = (dir, file, attribute) => {
    const folders = dir.replace(/^(?:\.{0,2}\/)+/, '').split('/').filter(Boolean).map((part) => part.toLowerCase());
    if (!folders.every((part) => NEAR_MISS_FOLDERS.has(part))) return null;
    if (!folders.length && !attribute) return null;
    if (otherNames.has(file) && !byName.has(file.toLowerCase())) return null;
    const lower = file.toLowerCase();
    let image = byName.get(lower);
    if (!image) {
      const hasExt = IMAGE_EXT_RE.test(lower);
      if (!hasExt && (/\./.test(lower) || !folders.length)) return null;
      const stem = lower.replace(IMAGE_EXT_RE, '');
      if (sharedStems.has(stem)) return null;
      image = byStem.get(stem)
        || closestGalleryImage(stem, images)
        || (images.length === 1 && folders.length === 1 && folders[0] === 'images' ? images[0] : null);
    }
    if (!image) return null;
    // Already right: images/<name>, ./images/<name> or /images/<name>.
    if (folders.length === 1 && folders[0] === 'images' && file === image.name && /^(?:\.\/|\/)?images\/$/.test(dir)) return null;
    return galleryPath(image);
  };
  return Object.fromEntries(Object.entries(files || {}).map(([page, text]) => [
    page,
    typeof text === 'string'
      ? text
        .replace(QUOTED_PATH_RE, (match, attr = '', quote, dir, file) => {
          const path = resolve(dir, file, Boolean(attr));
          return path ? `${attr}${quote}${path}${quote}` : match;
        })
        .replace(URL_PATH_RE, (match, open, dir, file, close) => {
          const path = resolve(dir, file, true);
          return path ? `${open}${path}${close}` : match;
        })
      : text,
  ]));
}

// The images/<name> paths pages use that aren't in the gallery, after
// normalizeGalleryRefs: pictures the AI pointed at that don't exist, which
// show as broken images.
export function unmatchedGalleryRefs(files, images) {
  const names = new Set((images || []).map((image) => image.name));
  const missing = new Set();
  for (const text of Object.values(files || {})) {
    if (typeof text !== 'string') continue;
    for (const [, name] of text.matchAll(REF_RE)) if (!names.has(name)) missing.add(`images/${name}`);
  }
  return [...missing];
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
