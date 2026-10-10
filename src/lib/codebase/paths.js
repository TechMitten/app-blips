// Path rules and limits for imported codebases (studioMode 'codebase').
// Shared by the renderer and electron/projectStore.js, so it must stay plain
// framework-free JS. Paths are repo-relative and '/'-separated; main re-checks
// every path before it touches the disk, so these rules are a security
// boundary (no traversal, nothing a Windows filesystem would refuse).

export const MAX_CODEBASE_FILES = 1000;
export const MAX_TEXT_BYTES = 8 * 1024 * 1024;
export const MAX_TEXT_FILE_BYTES = 1024 * 1024;
export const MAX_LOCKFILE_BYTES = 5 * 1024 * 1024;
export const MAX_ASSET_BYTES = 150 * 1024 * 1024;
export const MAX_ASSET_FILE_BYTES = 50 * 1024 * 1024;
const MAX_PATH_LENGTH = 240;

export const HASH_RE = /^[a-f0-9]{64}$/;

const RESERVED_NAME_RE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
// eslint-disable-next-line no-control-regex
const BAD_CHAR_RE = /[<>:"|?*\\\u0000-\u001f]/;

// Returns an error string, or null when the path is safe to store and write.
export function validateProjectPath(path) {
  if (typeof path !== 'string' || !path) return 'Empty path.';
  if (path.length > MAX_PATH_LENGTH) return `Path is longer than ${MAX_PATH_LENGTH} characters.`;
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return 'Path must be relative.';
  for (const segment of path.split('/')) {
    if (!segment || segment === '.' || segment === '..') return 'Path has an empty, "." or ".." segment.';
    if (BAD_CHAR_RE.test(segment)) return 'Path has a character Windows does not allow.';
    if (/[. ]$/.test(segment)) return 'Path segment ends with a dot or space.';
    if (RESERVED_NAME_RE.test(segment)) return 'Path uses a name Windows reserves.';
  }
  return null;
}

// Zip entries may use backslashes or a leading './'.
export function normalizeProjectPath(path) {
  return String(path || '').replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/{2,}/g, '/');
}

const LOCKFILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock']);

// Lockfiles are kept byte-for-byte for export; the AI never edits them.
export function isProtectedPath(path) {
  return LOCKFILES.has(path);
}

export function isLockfile(path) {
  return LOCKFILES.has(path.split('/').pop());
}

const TEXT_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'json', 'jsonc', 'css', 'scss', 'sass', 'less',
  'html', 'htm', 'md', 'mdx', 'txt', 'svg', 'xml', 'yml', 'yaml', 'toml', 'csv', 'env', 'example',
  'gitignore', 'npmrc', 'nvmrc', 'editorconfig', 'prettierrc', 'eslintrc', 'browserslistrc', 'lock',
  'webmanifest', 'map', 'graphql', 'gql', 'vue', 'svelte', 'astro', 'sh', 'ps1', 'bat', 'cfg', 'ini',
]);

export const MIME_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', ico: 'image/x-icon', bmp: 'image/bmp', svg: 'image/svg+xml',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
  mp4: 'video/mp4', webm: 'video/webm', ogg: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4',
  pdf: 'application/pdf', json: 'application/json', txt: 'text/plain', css: 'text/css',
};

export function extensionOf(path) {
  const name = path.split('/').pop();
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : (name.startsWith('.') ? name.slice(1).toLowerCase() : '');
}

export function mimeTypeFor(path) {
  return MIME_TYPES[extensionOf(path)] || 'application/octet-stream';
}

// Text by extension, falling back to a content sniff (valid UTF-8, no NUL
// bytes) for files like LICENSE or Dockerfile.
export function isTextFile(path, bytes) {
  const ext = extensionOf(path);
  if (TEXT_EXTENSIONS.has(ext)) return true;
  if (MIME_TYPES[ext]) return false;
  if (!bytes) return !ext;
  if (bytes.length > MAX_TEXT_FILE_BYTES) return false;
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

// Folders and files that never belong in an imported project: installed
// packages, VCS data, OS junk and secrets anywhere; build output only at the
// project root (a src/build/ folder is real code). `.env.example` style
// templates are kept (they hold the VITE_* names the preview needs).
export const SKIP_DIRS = new Set(['node_modules', '.git', '__MACOSX', '.svn', '.hg', '.idea', '.vscode']);
const ROOT_SKIP_DIRS = new Set(['dist', 'build', '.vite', 'coverage', '.turbo', '.next', '.cache', 'dist-ssr']);
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

export function skipReason(path) {
  const segments = path.split('/');
  const name = segments[segments.length - 1];
  if (segments.slice(0, -1).some((s) => SKIP_DIRS.has(s))) return 'installed packages or tool data';
  if (segments.length > 1 && ROOT_SKIP_DIRS.has(segments[0])) return 'build output';
  if (SKIP_FILES.has(name) || name.startsWith('._')) return 'system file';
  if (/^\.env(\..+)?$/.test(name) && !/\.(example|sample|template)$/.test(name)) return 'may contain secrets';
  if (/\.log$/.test(name)) return 'log file';
  return null;
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Error string when a version's files break the codebase limits, else null.
export function checkCodebaseLimits(files, assets = {}, assetSizes = {}) {
  const textPaths = Object.keys(files);
  const assetPaths = Object.keys(assets);
  if (textPaths.length + assetPaths.length > MAX_CODEBASE_FILES) return `A project can have at most ${MAX_CODEBASE_FILES} files.`;
  let text = 0;
  for (const path of textPaths) {
    const size = utf8Length(files[path]);
    const cap = isLockfile(path) ? MAX_LOCKFILE_BYTES : MAX_TEXT_FILE_BYTES;
    if (size > cap) return `${path} is larger than ${formatBytes(cap)}.`;
    if (!isLockfile(path)) text += size;
  }
  if (text > MAX_TEXT_BYTES) return `The project's code is larger than ${formatBytes(MAX_TEXT_BYTES)}.`;
  let total = 0;
  for (const path of assetPaths) total += assetSizes[assets[path]] || 0;
  if (total > MAX_ASSET_BYTES) return `The project's images and files are larger than ${formatBytes(MAX_ASSET_BYTES)}.`;
  return null;
}

export function utf8Length(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
    else n += 3;
  }
  return n;
}
