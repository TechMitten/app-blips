// Reads a customer's React + Vite project from a .zip into the codebase model:
// text files as strings keyed by repo path, binary assets as content hashes
// (bytes returned separately for the blob store). Nothing from the zip is
// executed here; package.json/index.html are only parsed.
import { unzip } from 'fflate';
import {
  MAX_ASSET_BYTES, MAX_ASSET_FILE_BYTES, MAX_CODEBASE_FILES, MAX_LOCKFILE_BYTES, MAX_TEXT_BYTES,
  MAX_TEXT_FILE_BYTES, SKIP_DIRS, formatBytes, isLockfile, isTextFile, normalizeProjectPath, skipReason,
  validateProjectPath,
} from './paths.js';
import { sha256Hex } from './hash.js';
import { lockfileVersions } from './config.js';

// Hard ceiling on what a zip may decompress to, checked against the declared
// sizes before inflating and the real sizes after (a zip bomb can lie).
const MAX_UNZIPPED_BYTES = MAX_TEXT_BYTES + MAX_LOCKFILE_BYTES + MAX_ASSET_BYTES;

export class CodebaseImportError extends Error {}

const fail = (message) => { throw new CodebaseImportError(message); };

function unzipAsync(bytes, filter) {
  return new Promise((resolve, reject) => {
    unzip(bytes, { filter }, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

// A zip made by right-clicking the project folder has every path under one
// top folder ("acme-site/src/..."); strip it so paths are repo-relative.
export function commonTopFolder(paths) {
  if (!paths.length) return '';
  const first = paths[0].split('/')[0];
  if (!paths.every((p) => p.startsWith(`${first}/`))) return '';
  if (paths.includes('package.json')) return '';
  return `${first}/`;
}

const UNSUPPORTED_FRAMEWORKS = [
  ['next', 'Next.js'], ['react-scripts', 'Create React App'], ['@remix-run/react', 'Remix'],
  ['astro', 'Astro'], ['gatsby', 'Gatsby'], ['vue', 'Vue'], ['nuxt', 'Nuxt'], ['svelte', 'Svelte'],
  ['@angular/core', 'Angular'], ['solid-js', 'Solid'], ['preact', 'Preact'],
];

const KNOWN_VITE_PLUGINS = /^(@vitejs\/plugin-react(-swc)?|@tailwindcss\/vite|vite-tsconfig-paths)$/;

export function majorVersion(range) {
  const match = String(range || '').match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

// Pure project inspection, separate from unzipping so tests can feed a plain
// file map. Throws CodebaseImportError for projects AppBlips can't run.
export function inspectProject(files, assets = {}) {
  if (typeof files['package.json'] !== 'string') {
    fail('This zip has no package.json at its top level. Zip the project folder itself (the one that contains package.json, index.html and src).');
  }
  let pkg;
  try { pkg = JSON.parse(files['package.json']); } catch { fail('package.json is not valid JSON.'); }
  const deps = { ...(pkg.devDependencies || {}), ...(pkg.dependencies || {}) };
  if (pkg.workspaces || ['pnpm-workspace.yaml', 'turbo.json', 'lerna.json'].some((p) => p in files)) {
    fail('This looks like a monorepo with several packages. Import just the one website folder instead.');
  }
  for (const [name, label] of UNSUPPORTED_FRAMEWORKS) {
    if (deps[name]) fail(`This is a ${label} project. AppBlips can import React + Vite projects only.`);
  }
  if (!deps.vite) fail('This project does not use Vite (no "vite" in package.json). AppBlips can import React + Vite projects only.');
  if (!deps.react || !deps['react-dom']) fail('This project does not use React (no "react" and "react-dom" in package.json).');

  const html = files['index.html'];
  if (typeof html !== 'string') fail('This project has no index.html at its top level, which Vite needs.');
  const entryMatch = html.match(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/i)
    || html.match(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*\btype=["']module["']/i);
  if (!entryMatch) fail('index.html has no <script type="module" src="..."> entry script.');
  const entry = normalizeProjectPath(entryMatch[1].replace(/^\//, '').split('?')[0]);
  if (typeof files[entry] !== 'string') fail(`index.html loads ${entry}, but that file is not in the zip.`);

  const locked = lockfileVersions(files['package-lock.json']);
  const tailwindVersion = locked.tailwindcss || deps.tailwindcss;
  let tailwind = null;
  if (deps['@tailwindcss/vite'] || deps['@tailwindcss/postcss']) tailwind = 4;
  else if (tailwindVersion) tailwind = majorVersion(tailwindVersion) >= 4 ? 4 : 3;

  const has = (path) => path in files || path in assets;
  const packageManager = has('pnpm-lock.yaml') ? 'pnpm'
    : has('yarn.lock') ? 'yarn'
      : (has('bun.lockb') || has('bun.lock')) ? 'bun'
        : has('package-lock.json') ? 'npm' : null;

  const warnings = [];
  const paths = Object.keys(files);
  if (paths.some((p) => /\.(scss|sass|less|styl)$/.test(p))) {
    warnings.push('Sass/Less stylesheets were found. The preview can\'t show them, but they are kept and still work when you build the project.');
  }
  if (paths.some((p) => /\.(tsx?|jsx?)$/.test(p) && files[p].includes('import.meta.glob'))) {
    warnings.push('The code uses import.meta.glob, which the preview doesn\'t support yet. Pages that rely on it may not show.');
  }
  if (paths.some((p) => /\.(tsx?|jsx?)$/.test(p) && /\.svg\?react['"]/.test(files[p]))) {
    warnings.push('The code imports SVGs as React components (svg?react), which the preview doesn\'t support yet.');
  }
  const unknownPlugins = Object.keys(deps).filter((d) => (/^(@[^/]+\/)?vite-plugin-|^@vitejs\/plugin-/).test(d) && !KNOWN_VITE_PLUGINS.test(d));
  if (unknownPlugins.length) {
    warnings.push(`The project uses Vite plugins the preview can't run (${unknownPlugins.join(', ')}). The preview may differ from the real build.`);
  }
  if (packageManager && packageManager !== 'npm') {
    warnings.push(`The project uses ${packageManager}. The preview uses the version ranges in package.json instead of its lockfile.`);
  }

  return {
    meta: {
      format: 1,
      framework: 'vite-react',
      name: typeof pkg.name === 'string' ? pkg.name : '',
      entry,
      tailwind,
      packageManager,
      route: '/',
    },
    warnings,
  };
}

// bytes: Uint8Array of the .zip. Returns
// { files, assets: {path: sha}, blobs: Map<sha, Uint8Array>, meta, skipped, warnings }.
export async function importCodebaseZip(bytes, { sourceName = '' } = {}) {
  let declared = 0;
  let entries = 0;
  const skipped = [];
  const skippedSeen = new Set();
  let raw;
  try {
    raw = await unzipAsync(bytes, (info) => {
      const name = normalizeProjectPath(info.name);
      if (!name || name.endsWith('/')) return false;
      const reason = skipReason(name);
      if (reason) {
        // node_modules alone can hold tens of thousands of entries: report each
        // skipped folder once instead of every file in it.
        const dir = name.split('/').findIndex((s) => SKIP_DIRS.has(s));
        const shown = dir >= 0 ? `${name.split('/').slice(0, dir + 1).join('/')}/` : name;
        if (!skippedSeen.has(shown)) { skippedSeen.add(shown); skipped.push({ path: shown, reason }); }
        return false;
      }
      entries += 1;
      declared += info.originalSize;
      if (entries > MAX_CODEBASE_FILES * 2) fail(`This zip has more than ${MAX_CODEBASE_FILES} files (not counting node_modules and build output).`);
      if (declared > MAX_UNZIPPED_BYTES) fail(`This zip unpacks to more than ${formatBytes(MAX_UNZIPPED_BYTES)}.`);
      return true;
    });
  } catch (err) {
    if (err instanceof CodebaseImportError) throw err;
    fail('This file could not be opened as a .zip archive.');
  }

  const names = Object.keys(raw).map(normalizeProjectPath);
  const top = commonTopFolder(names.filter((n) => !skipReason(n)));
  for (const item of skipped) if (top && item.path.startsWith(top)) item.path = item.path.slice(top.length);
  const files = {};
  const assets = {};
  const blobs = new Map();
  const seen = new Map();
  let textBytes = 0;
  let assetBytes = 0;
  let realBytes = 0;

  for (const [originalName, content] of Object.entries(raw)) {
    const name = normalizeProjectPath(originalName);
    const path = top && name.startsWith(top) ? name.slice(top.length) : name;
    realBytes += content.length;
    if (realBytes > MAX_UNZIPPED_BYTES) fail(`This zip unpacks to more than ${formatBytes(MAX_UNZIPPED_BYTES)}.`);
    const reason = skipReason(path);
    if (reason) { skipped.push({ path, reason }); continue; }
    const invalid = validateProjectPath(path);
    if (invalid) { skipped.push({ path, reason: invalid }); continue; }
    const key = path.toLowerCase();
    if (seen.has(key)) { skipped.push({ path, reason: `same name as ${seen.get(key)} (differs only in upper/lower case)` }); continue; }
    seen.set(key, path);

    if (isTextFile(path, content)) {
      const cap = isLockfile(path) ? MAX_LOCKFILE_BYTES : MAX_TEXT_FILE_BYTES;
      if (content.length > cap) { skipped.push({ path, reason: `larger than ${formatBytes(cap)}` }); continue; }
      let text;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(content);
      } catch {
        skipped.push({ path, reason: 'not valid UTF-8 text' });
        continue;
      }
      if (path.split('/').pop() === '.npmrc' && /_auth|_password/i.test(text)) {
        skipped.push({ path, reason: 'may contain secrets' });
        continue;
      }
      if (!isLockfile(path)) textBytes += content.length;
      files[path] = text;
    } else {
      if (content.length > MAX_ASSET_FILE_BYTES) { skipped.push({ path, reason: `larger than ${formatBytes(MAX_ASSET_FILE_BYTES)}` }); continue; }
      assetBytes += content.length;
      const hash = await sha256Hex(content);
      assets[path] = hash;
      blobs.set(hash, content);
    }
  }

  if (Object.keys(files).length + Object.keys(assets).length > MAX_CODEBASE_FILES) {
    fail(`This project has more than ${MAX_CODEBASE_FILES} files (not counting node_modules and build output).`);
  }
  if (textBytes > MAX_TEXT_BYTES) fail(`This project's code is larger than ${formatBytes(MAX_TEXT_BYTES)}.`);
  if (assetBytes > MAX_ASSET_BYTES) fail(`This project's images and files are larger than ${formatBytes(MAX_ASSET_BYTES)}.`);

  const { meta, warnings } = inspectProject(files, assets);
  return {
    files,
    assets,
    blobs,
    meta: { ...meta, sourceName: String(sourceName).slice(0, 200), importedAt: new Date().toISOString(), skipped: skipped.slice(0, 200) },
    skipped,
    warnings,
  };
}
