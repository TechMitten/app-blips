// The Pollinations connector, page side of /api/pollinations
// (electron/server/pollinationsApi.js). The same fetch works in every host:
// the desktop app answers it in-process, server.js and the Vite dev server
// over HTTP. The user's Pollinations key never reaches the page; only the
// account name does.
import { MAX_IMAGES_PER_BUILD, POLLINATIONS_API, POLLINATIONS_IMAGE_URL_RE } from './pollinationsApp.js';

async function call(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { error: 'Couldn’t reach AppBlips’ Pollinations service. Try again.' };
  }
  try {
    return await response.json();
  } catch {
    return { error: `Pollinations request failed (error ${response.status}).` };
  }
}

export const pollinationsStatus = () => call('/api/pollinations');
export const pollinationsStartLogin = () => call('/api/pollinations/login', { method: 'POST', body: {} });
export const pollinationsCheckLogin = () => call('/api/pollinations/login/check', { method: 'POST', body: {} });
export const pollinationsSignOut = () => call('/api/pollinations', { method: 'DELETE' });
const pollinationsImage = (url) => call('/api/pollinations/image', { method: 'POST', body: { url } });

const CONCURRENCY = 3;

// The image URLs the AI wrote in `files` that AppBlips should generate, in
// order of appearance. In HTML attributes "&" is often written "&amp;".
export const findImageRequests = (files) => {
  const found = new Set();
  for (const text of Object.values(files || {})) {
    if (typeof text !== 'string') continue;
    for (const [match] of text.matchAll(POLLINATIONS_IMAGE_URL_RE)) {
      if (!/[?&](?:amp;)?key=/.test(match)) found.add(match);
    }
  }
  return [...found];
};

// Generates every image the AI asked for and swaps each address for the
// stored copy on media.pollinations.ai, which needs no key. Images that fail
// keep their address (they show as broken until the next build) and the
// first error is returned so the build's reply can say why.
// -> { files, generated, failed, error, signedOut }
export async function resolveImages(files, { signal, onProgress } = {}) {
  const requests = findImageRequests(files);
  if (!requests.length) return { files, generated: 0, failed: 0, error: '', signedOut: false };
  const wanted = requests.slice(0, MAX_IMAGES_PER_BUILD);
  const replacements = new Map();
  let failed = requests.length - wanted.length;
  let error = failed ? `Only the first ${MAX_IMAGES_PER_BUILD} images were made in one go.` : '';
  let signedOut = false;
  let done = 0;
  let next = 0;

  const worker = async () => {
    while (next < wanted.length && !signedOut && !signal?.aborted) {
      const original = wanted[next++];
      const result = await pollinationsImage(original.replace(/&amp;/g, '&'));
      done++;
      onProgress?.(done, wanted.length);
      if (result.url) {
        replacements.set(original, result.url);
      } else {
        failed++;
        error ||= result.error || 'Pollinations couldn’t make an image.';
        if (result.signedOut) signedOut = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, wanted.length) }, worker));
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (signedOut) failed = requests.length - replacements.size;

  const resolved = {};
  for (const [name, text] of Object.entries(files)) {
    resolved[name] = typeof text === 'string' && replacements.size
      ? text.replace(POLLINATIONS_IMAGE_URL_RE, (match) => replacements.get(match) || match)
      : text;
  }
  return { files: resolved, generated: replacements.size, failed, error, signedOut };
}

// What Pollinations says about a site key (GET /account/key), checked from the
// page: the key ends up in public sites anyway, so it needs no server. Keys
// without a Pollen budget, or with account access, are refused, since anyone
// who finds them could empty the wallet or manage the account.
// -> { ok, error?, warnings: [], budget, expiresAt }
export async function checkSiteKey(key) {
  let response;
  try {
    response = await fetch(`${POLLINATIONS_API}/account/key`, {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, error: 'Couldn’t reach Pollinations to check the key. Check your internet connection and try again.', warnings: [] };
  }
  let info = null;
  try {
    info = await response.json();
  } catch { /* handled below */ }
  if (response.status === 401 || info?.valid === false) {
    return { ok: false, error: 'Pollinations doesn’t recognise this key. It may have expired or been cancelled.', warnings: [] };
  }
  if (!response.ok || !info) return { ok: false, error: `Pollinations couldn’t check the key (error ${response.status}). Try again.`, warnings: [] };
  if (info.type !== 'secret') return { ok: false, error: 'This is a publishable key (pk_…). Create a secret key (sk_…) instead.', warnings: [] };
  if (info.permissions?.account?.length) {
    return { ok: false, error: 'This key can manage your Pollinations account. Create a new key with no account permissions for your sites.', warnings: [] };
  }
  if (typeof info.pollenBudget !== 'number') {
    return { ok: false, error: 'This key has no Pollen budget, so anyone who finds it could spend all your Pollen. Create a key with a small budget.', warnings: [] };
  }
  const warnings = [];
  if (!info.expiresAt) warnings.push('This key never expires. Consider giving it an end date.');
  if (!Array.isArray(info.permissions?.models)) warnings.push('This key can use every model, including expensive ones. Consider allowing only the models your sites need.');
  return { ok: true, warnings, budget: info.pollenBudget, expiresAt: info.expiresAt || null };
}
