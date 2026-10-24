// The site icon (favicon) chosen in the Publish window. The picked image is
// redrawn as a small square PNG here, so any format the browser can show
// (PNG, JPEG, WebP, GIF, SVG, ICO) goes out the same way, and the copy kept
// per project stays small enough for localStorage. Publishing adds it as
// favicon.png next to the pages and points every page's <head> at it.
// No DOM at import time: surgeApi.js imports FAVICON_PATH on the server.

export const FAVICON_PATH = 'favicon.png';
// Big enough for a phone home-screen icon, small enough to keep per project.
const SIZE = 128;
const FALLBACK_SIZE = 64;
const MAX_DATA_URL = 64 * 1024;
export const MAX_FAVICON_BYTES = 256 * 1024;
export const MAX_FAVICON_SOURCE_BYTES = 10 * 1024 * 1024;

const loadImage = (file) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => resolve({ image, release: () => URL.revokeObjectURL(url) });
  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('unreadable'));
  };
  image.src = url;
});

const draw = (image, size) => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  // SVGs without width/height report 0; let them fill the square.
  const width = image.naturalWidth || size;
  const height = image.naturalHeight || size;
  const scale = Math.min(size / width, size / height);
  const w = width * scale;
  const h = height * scale;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
  return canvas.toDataURL('image/png');
};

// File -> 'data:image/png;base64,...', centred in a transparent square.
export async function makeFavicon(file) {
  if (!file || file.size > MAX_FAVICON_SOURCE_BYTES) throw new Error('That image is too big. Pick one under 10 MB.');
  let loaded;
  try {
    loaded = await loadImage(file);
  } catch {
    throw new Error('That file isn’t an image AppBlips can read. Try a PNG or JPEG.');
  }
  try {
    const url = draw(loaded.image, SIZE);
    return url.length <= MAX_DATA_URL ? url : draw(loaded.image, FALLBACK_SIZE);
  } finally {
    loaded.release();
  }
}

export const faviconBase64 = (dataUrl) => (
  typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png;base64,') ? dataUrl.slice(22) : ''
);

// Any icon link the page already has (rel="icon", "shortcut icon",
// "apple-touch-icon", ...) would compete with the chosen one.
const ICON_LINK_RE = /<link\b[^>]*\brel\s*=\s*(?:"[^"]*icon[^"]*"|'[^']*icon[^']*'|[^\s"'>]*icon[^\s"'>]*)[^>]*>[ \t]*\n?/gi;

// Points a page at /favicon.png. Only the <head> is touched, so scripts that
// happen to contain "<link rel=icon" text are left alone.
export function addFaviconLinks(html) {
  if (typeof html !== 'string') return html;
  const links = `<link rel="icon" type="image/png" href="/${FAVICON_PATH}">\n<link rel="apple-touch-icon" href="/${FAVICON_PATH}">\n`;
  const headEnd = html.search(/<\/head\s*>/i);
  const head = headEnd === -1 ? '' : html.slice(0, headEnd).replace(ICON_LINK_RE, '');
  const rest = headEnd === -1 ? html : html.slice(headEnd);
  const open = /<head\b[^>]*>\s*/i.exec(head);
  if (open) return head.slice(0, open.index + open[0].length) + links + head.slice(open.index + open[0].length) + rest;
  const htmlOpen = /<html\b[^>]*>\s*/i.exec(head + rest);
  if (htmlOpen && headEnd === -1) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return rest.slice(0, at) + `<head>\n${links}</head>\n` + rest.slice(at);
  }
  if (headEnd !== -1) return head + links + rest;
  // No <html> or <head> at all: after the doctype, so the page keeps
  // standards mode.
  const doctype = /^\s*<!doctype[^>]*>\s*/i.exec(html);
  const at = doctype ? doctype[0].length : 0;
  return html.slice(0, at) + links + html.slice(at);
}

export const withFavicon = (files) => Object.fromEntries(
  Object.entries(files).map(([name, html]) => [name, name.endsWith('.html') ? addFaviconLinks(html) : html]),
);
