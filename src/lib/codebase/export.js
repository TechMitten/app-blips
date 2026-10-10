// Zips the current version of an imported codebase back up, every file at
// its original path under one top folder, the way the designer handed it
// over. Untouched files leave byte-for-byte as they came in.
import { zipSync } from 'fflate';
import { toBytes } from './hash.js';
import { readPackageJson } from './config.js';

const STORED = /\.(png|jpe?g|gif|webp|avif|ico|woff2?|mp4|webm|mp3|ogg|zip|gz|pdf)$/i;

// bytesOf(hash) -> Uint8Array for assets (must already be loaded).
export function exportCodebaseZip({ files, assets = {}, bytesOf, folder = 'site' }) {
  const entries = {};
  const root = `${folder.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'site'}/`;
  for (const [path, text] of Object.entries(files)) {
    entries[root + path] = [toBytes(text), { level: STORED.test(path) ? 0 : 6 }];
  }
  const missing = [];
  for (const [path, hash] of Object.entries(assets)) {
    const bytes = bytesOf(hash);
    if (!bytes) { missing.push(path); continue; }
    entries[root + path] = [bytes, { level: STORED.test(path) ? 0 : 6 }];
  }
  return { zip: zipSync(entries), missing };
}

// Packages added to or removed from package.json since the import: the
// lockfile no longer matches, so `npm ci` would refuse to install.
export function dependencyChanges(originalPackageJson, files) {
  const before = readPackageJson({ 'package.json': originalPackageJson || '{}' });
  const after = readPackageJson(files);
  const names = (pkg) => new Set(Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }));
  const a = names(before);
  const b = names(after);
  return {
    added: [...b].filter((n) => !a.has(n)),
    removed: [...a].filter((n) => !b.has(n)),
  };
}
