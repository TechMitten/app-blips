// The Pixabay connector, page side of /api/pixabay
// (electron/server/pixabayApi.js). The same fetch works in every host: the
// desktop app answers it in-process, server.js and the Vite dev server over
// HTTP, android.js inside the page. The user's key never reaches the page;
// only its last four characters do.
import { MAX_GALLERY_NOTE } from './galleryImages.js';

async function call(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { error: 'Couldn’t reach AppBlips’ Pixabay service. Try again.' };
  }
  try {
    return await response.json();
  } catch {
    return { error: `Pixabay request failed (error ${response.status}).` };
  }
}

export const pixabayStatus = () => call('/api/pixabay');
export const savePixabayKey = (key) => call('/api/pixabay/key', { method: 'POST', body: { key } });
export const forgetPixabayKey = () => call('/api/pixabay', { method: 'DELETE' });
// -> { totalHits, hits: [{ id, tags, user, pageURL, previewURL, webformatURL, width, height, ... }] } | { error }
export const searchPixabay = (q, page = 1) => call('/api/pixabay/search', { method: 'POST', body: { q, page } });

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const decodeHeader = (value) => {
  try {
    return decodeURIComponent(value || '');
  } catch {
    return '';
  }
};

// "mountain, lake, sunset, nature" -> "mountain-lake-sunset.jpg" (galleryName
// in galleryImages.js tidies and de-duplicates it).
export const pixabayFileName = (tags, id, type) => {
  const words = String(tags || '').split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 3);
  return `${words.join(' ') || `pixabay ${id}`}.${EXTENSIONS[type] || 'jpg'}`;
};

// What the AI is told the photo shows (the gallery note), written from its tags.
export const pixabayNote = (tags, user) => {
  const what = String(tags || '').trim();
  const by = user ? ` by ${user}` : '';
  return (what ? `Pixabay photo${by}: ${what}` : `Pixabay photo${by}`).slice(0, MAX_GALLERY_NOTE);
};

// Downloads one search hit through the server, ready for the gallery's
// addFiles. -> { file: File, note } | { error }
export async function downloadPixabayImage(hit) {
  let response;
  try {
    response = await fetch('/api/pixabay/download', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: hit.id }),
    });
  } catch {
    return { error: 'Couldn’t reach AppBlips’ Pixabay service. Try again.' };
  }
  const type = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
  if (!response.ok || !EXTENSIONS[type]) {
    const body = await response.json().catch(() => null);
    return { error: body?.error || `Pixabay couldn’t send that photo (error ${response.status}).` };
  }
  const tags = decodeHeader(response.headers.get('x-pixabay-tags')) || hit.tags;
  const user = decodeHeader(response.headers.get('x-pixabay-user')) || hit.user;
  const blob = await response.blob();
  return {
    file: new File([blob], pixabayFileName(tags, hit.id, type), { type }),
    note: pixabayNote(tags, user),
  };
}
