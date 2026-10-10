// Reads what the preview needs from an imported project's config files:
// path aliases, TypeScript strictness, VITE_* values and package versions.
// Config files are only parsed (JSONC) or pattern-matched, never executed:
// this runs in the privileged renderer, and vite.config.ts is arbitrary code.

// JSON with comments and trailing commas, as tsconfig allows.
export function parseJsonc(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inString) {
      out += c;
      if (c === '\\') { out += next ?? ''; i++; } else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === '/' && next === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

function dirOf(path) {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

// Joins and normalizes repo paths ('src/a' + '../b' -> 'b'); null if it escapes the root.
export function joinPath(base, rel) {
  const parts = base ? base.split('/') : [];
  for (const seg of rel.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

function readJsonc(files, path) {
  if (typeof files[path] !== 'string') return null;
  try { return parseJsonc(files[path]); } catch { return null; }
}

// Merged compilerOptions of a tsconfig, following relative `extends`.
function compilerOptionsOf(files, path, depth = 0) {
  const config = readJsonc(files, path);
  if (!config || depth > 5) return {};
  let base = {};
  const extendsList = Array.isArray(config.extends) ? config.extends : config.extends ? [config.extends] : [];
  for (const ext of extendsList) {
    if (typeof ext !== 'string' || !ext.startsWith('.')) continue;
    let target = joinPath(dirOf(path), ext);
    if (target && !target.endsWith('.json')) target += '.json';
    if (target) base = { ...base, ...compilerOptionsOf(files, target, depth + 1) };
  }
  const own = { ...(config.compilerOptions || {}) };
  // paths/baseUrl are relative to the file that declares them.
  if (own.paths || own.baseUrl) own.__pathsDir = joinPath(dirOf(path), own.baseUrl || '.') ?? '';
  return { ...base, ...own };
}

// The tsconfig that type-checks src: tsconfig.json itself, or the referenced
// tsconfig.app.json in the Vite template's project-references layout.
export function appTsconfig(files) {
  const root = readJsonc(files, 'tsconfig.json');
  const candidates = [];
  for (const ref of root?.references || []) {
    if (typeof ref?.path !== 'string') continue;
    let target = joinPath('', ref.path);
    if (target && !target.endsWith('.json')) target += '/tsconfig.json';
    if (target) candidates.push(target);
  }
  const app = candidates.find((p) => /app/.test(p)) || candidates.find((p) => !/node/.test(p));
  const rootOptions = root ? compilerOptionsOf(files, 'tsconfig.json') : {};
  const appOptions = app ? compilerOptionsOf(files, app) : {};
  return { path: app || (root ? 'tsconfig.json' : null), options: { ...rootOptions, ...appOptions } };
}

// [{ find: '@/', replace: 'src/' }] style prefix aliases, longest first.
export function readAliases(files) {
  const aliases = [];
  const { options } = appTsconfig(files);
  if (options.paths && typeof options.paths === 'object') {
    for (const [key, targets] of Object.entries(options.paths)) {
      const target = Array.isArray(targets) ? targets[0] : null;
      if (typeof target !== 'string') continue;
      const dir = options.__pathsDir ?? '';
      if (key.endsWith('/*') && target.endsWith('/*')) {
        const replace = joinPath(dir, target.slice(0, -2));
        if (replace !== null) aliases.push({ find: key.slice(0, -1), replace: replace ? `${replace}/` : '' });
      } else if (!key.includes('*')) {
        const replace = joinPath(dir, target);
        if (replace) aliases.push({ find: key, replace, exact: true });
      }
    }
  }
  for (const alias of viteAliases(files)) {
    if (!aliases.some((a) => a.find === alias.find)) aliases.push(alias);
  }
  return aliases.sort((a, b) => b.find.length - a.find.length);
}

const VITE_CONFIGS = ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs'];

// Best-effort: matches the usual alias spellings in vite.config without
// running it, e.g. '@': path.resolve(__dirname, './src'),
// { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) }.
export function viteAliases(files) {
  const source = VITE_CONFIGS.map((p) => files[p]).find((s) => typeof s === 'string');
  if (!source) return [];
  const out = [];
  const add = (key, target) => {
    const dir = joinPath('', target.replace(/^\//, ''));
    if (dir === null || !key) return;
    out.push({ find: `${key}/`, replace: dir ? `${dir}/` : '' });
    out.push({ find: key, replace: dir, exact: true });
  };
  const call = String.raw`(?:path\.)?(?:resolve|join)\(\s*__dirname\s*,\s*['"]([^'"]+)['"]\s*\)|fileURLToPath\(\s*new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)\s*\)|['"](\.\/[^'"]*|\/src[^'"]*)['"]`;
  const objectForm = new RegExp(String.raw`['"]?([@~#$\w-]+)['"]?\s*:\s*(?:${call})`, 'g');
  const findForm = new RegExp(String.raw`find\s*:\s*['"]([^'"]+)['"]\s*,\s*replacement\s*:\s*(?:${call})`, 'g');
  const aliasBlock = source.match(/alias\s*:\s*([[{][\s\S]*?[\]}])\s*,?\s*(?:dedupe|extensions|conditions|mainFields|preserveSymlinks|\}|$)/);
  const scope = aliasBlock ? aliasBlock[1] : '';
  for (const m of scope.matchAll(findForm)) add(m[1], m[2] || m[3] || m[4]);
  if (!out.length) for (const m of scope.matchAll(objectForm)) add(m[1], m[2] || m[3] || m[4]);
  return out;
}

// TypeScript options worth telling the model about: `tsc -b` in the
// customer's build fails on these even though the preview (esbuild) doesn't.
export function strictnessFlags(files) {
  const { options } = appTsconfig(files);
  const keys = ['strict', 'noUnusedLocals', 'noUnusedParameters', 'noFallthroughCasesInSwitch', 'noUncheckedIndexedAccess', 'exactOptionalPropertyTypes', 'verbatimModuleSyntax', 'erasableSyntaxOnly', 'noUncheckedSideEffectImports'];
  const flags = {};
  for (const key of keys) if (options[key] === true) flags[key] = true;
  return flags;
}

// The compiler options esbuild honours (it ignores the rest). `jsx` is left
// out: Vite's React plugin always uses the automatic runtime, and so do we.
export function esbuildTsconfigRaw(files) {
  const { options } = appTsconfig(files);
  const pick = ['jsxImportSource', 'experimentalDecorators', 'useDefineForClassFields', 'verbatimModuleSyntax', 'preserveValueImports', 'importsNotUsedAsValues', 'target'];
  const compilerOptions = {};
  for (const key of pick) if (options[key] !== undefined) compilerOptions[key] = options[key];
  return { compilerOptions };
}

// VITE_* values for import.meta.env in the preview. Real .env files are
// skipped at import (secrets), so only the committed templates are read.
export function envValues(files) {
  const env = {};
  for (const name of ['.env.example', '.env.sample', '.env.template', '.env.local.example']) {
    const text = files[name];
    if (typeof text !== 'string') continue;
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?(VITE_[A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match || match[1] in env) continue;
      const raw = match[2].trim();
      const quoted = raw.match(/^(['"])(.*?)\1/);
      env[match[1]] = quoted ? quoted[2] : raw.replace(/\s+#.*$/, '');
    }
  }
  return env;
}

// Exact installed versions of top-level packages from package-lock.json v2/v3.
export function lockfileVersions(lockText) {
  const versions = {};
  if (!lockText) return versions;
  try {
    const lock = JSON.parse(lockText);
    for (const [key, entry] of Object.entries(lock.packages || {})) {
      // Only top-level installs: nested node_modules copies are a package's own deps.
      const match = key.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)$/);
      if (match && entry?.version) versions[match[1]] = entry.version;
    }
  } catch { /* unreadable lockfile: fall back to package.json ranges */ }
  return versions;
}

export function readPackageJson(files) {
  try { return JSON.parse(files['package.json'] || '{}'); } catch { return {}; }
}

// name -> exact version from package-lock.json, else the package.json range.
export function packageVersions(files) {
  const pkg = readPackageJson(files);
  const declared = { ...(pkg.devDependencies || {}), ...(pkg.peerDependencies || {}), ...(pkg.dependencies || {}) };
  const locked = lockfileVersions(files['package-lock.json']);
  const versions = {};
  for (const [name, range] of Object.entries(declared)) {
    versions[name] = locked[name] || cleanRange(range);
  }
  return { versions, declared, locked };
}

// esm.sh accepts semver ranges, but not npm: aliases, file: or git URLs.
function cleanRange(range) {
  const value = String(range || '').trim();
  if (!value || /^(file|link|git|github|https?|workspace|npm):/.test(value) || value.includes('/')) return 'latest';
  return value === '*' ? 'latest' : value.replace(/\s+/g, '');
}
