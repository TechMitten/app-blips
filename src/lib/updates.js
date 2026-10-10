// Update check for installs that don't update themselves. Asks GitHub for the
// latest published release of this repo and compares it with the version baked
// into the build (__APPBLIPS_VERSION__, from package.json via vite.config.js).
//
// The desktop app's Windows and AppImage builds update themselves instead
// (electron/updater.js); this check covers every other install.
// Results are cached in localStorage so reloads don't re-ask GitHub, whose
// unauthenticated API allows 60 requests an hour per IP. No React, so
// testing/testUpdates.js can load it in node.

export const UPDATE_REPO = 'TechMitten/app-blips';
export const RELEASES_URL = `https://github.com/${UPDATE_REPO}/releases/latest`;
// Only the browser version (from source or Docker) links here; the desktop
// app updates itself or links to the installer.
export const UPDATE_GUIDE_URL = 'https://docs.appblips.com/quickstart-source#updating';
export const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
export const CHECK_CACHE_KEY = 'orion-update-check';

// Substituted at build time; absent when node tests load this file.
export const CURRENT_VERSION = typeof __APPBLIPS_VERSION__ === 'string' ? __APPBLIPS_VERSION__ : '0.0.0';

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

// Semver-ish compare: > 0 when a is newer. A pre-release sorts before its
// release (0.2.0-beta.1 < 0.2.0). Unparseable versions compare as equal.
export function compareVersions(a, b) {
  const pa = VERSION_RE.exec(String(a || '').trim());
  const pb = VERSION_RE.exec(String(b || '').trim());
  if (!pa || !pb) return 0;
  for (let i = 1; i <= 3; i++) {
    const diff = Number(pa[i]) - Number(pb[i]);
    if (diff) return diff;
  }
  if (pa[4] === pb[4]) return 0;
  if (!pa[4]) return 1;
  if (!pb[4]) return -1;
  return pa[4] < pb[4] ? -1 : 1;
}

// GitHub's "latest release" payload -> { version, url } or null. Drafts and
// pre-releases are never offered, and links point only into this repo.
export function parseLatestRelease(json) {
  if (!json || typeof json !== 'object' || json.draft || json.prerelease) return null;
  const version = String(json.tag_name || '').trim().replace(/^v/i, '');
  if (!VERSION_RE.test(version)) return null;
  const html = String(json.html_url || '');
  const url = html.startsWith(`https://github.com/${UPDATE_REPO}/releases/`) ? html : RELEASES_URL;
  return { version, url };
}

// The latest release, or null when there is none yet (GitHub answers 404).
export async function fetchLatestRelease(fetchImpl = fetch) {
  const response = await fetchImpl(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
    headers: { accept: 'application/vnd.github+json' },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  return parseLatestRelease(await response.json());
}

const readCache = (storage) => {
  try {
    const cached = JSON.parse(storage?.getItem(CHECK_CACHE_KEY) || 'null');
    return cached && typeof cached.checkedAt === 'number' ? cached : null;
  } catch {
    return null;
  }
};

// A newer release than `current`, or null. Uses the cached answer while it
// is younger than CHECK_INTERVAL_MS; network errors are treated as "no update".
export async function checkForUpdate({
  current = CURRENT_VERSION,
  storage = null,
  fetchImpl = fetch,
  now = Date.now(),
} = {}) {
  let release;
  const cached = readCache(storage);
  if (cached && now - cached.checkedAt < CHECK_INTERVAL_MS) {
    release = cached.release;
  } else {
    try {
      release = await fetchLatestRelease(fetchImpl);
    } catch {
      return null;
    }
    try { storage?.setItem(CHECK_CACHE_KEY, JSON.stringify({ checkedAt: now, release })); } catch { /* storage unavailable */ }
  }
  return release && compareVersions(release.version, current) > 0 ? release : null;
}
