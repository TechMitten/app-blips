// Resolves an import specifier inside an imported project the way Vite would
// (relative, root-absolute, tsconfig/vite aliases, extension and index
// probing, .js -> .ts), against the in-memory file map. Pure, so it is
// unit-tested in Node and used by the esbuild plugin.
import { joinPath } from './config.js';

const EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.mts', '.json', '.css'];
const QUERY_RE = /\?(raw|url|inline|worker|sharedworker)(&.*)?$/;

export function splitQuery(spec) {
  const match = spec.match(QUERY_RE);
  if (!match) return { spec: spec.replace(/\?.*$/, ''), query: null };
  return { spec: spec.slice(0, match.index), query: match[1] };
}

export function isBareSpecifier(spec, aliases = []) {
  if (/^(\.{1,2}\/|\/|\.{1,2}$)/.test(spec)) return false;
  if (/^[a-z]+:/i.test(spec)) return false;
  return !aliases.some((a) => matchesAlias(spec, a));
}

function matchesAlias(spec, alias) {
  return alias.exact ? spec === alias.find : spec.startsWith(alias.find);
}

// 'react-dom/client' -> 'react-dom', '@radix-ui/react-slot/x' -> '@radix-ui/react-slot'
export function packageName(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

export function dirOf(path) {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function exists(ctx, path) {
  return typeof ctx.files[path] === 'string' || Boolean(ctx.assets?.[path]);
}

function probe(ctx, path) {
  if (path === null || path === undefined) return null;
  if (exists(ctx, path)) return path;
  // TS projects often import './util.js' that is really util.ts
  const jsMatch = path.match(/\.(m?)jsx?$/);
  if (jsMatch) {
    const stem = path.slice(0, jsMatch.index);
    for (const ext of jsMatch[1] ? ['.mts'] : ['.tsx', '.ts']) if (exists(ctx, stem + ext)) return stem + ext;
  }
  for (const ext of EXTENSIONS) if (exists(ctx, path + ext)) return path + ext;
  for (const ext of EXTENSIONS) if (exists(ctx, `${path ? `${path}/` : ''}index${ext}`)) return `${path ? `${path}/` : ''}index${ext}`;
  return null;
}

// Returns { path, query } for a project file, { bare: name } for an npm
// package, { public: path } for a file under public/, or null if not found.
export function resolveImport(rawSpec, importer, ctx) {
  const { spec, query } = splitQuery(rawSpec);
  const aliases = ctx.aliases || [];
  for (const alias of aliases) {
    if (!matchesAlias(spec, alias)) continue;
    const target = alias.exact ? alias.replace : alias.replace + spec.slice(alias.find.length);
    const path = probe(ctx, joinPath('', target));
    return path ? { path, query } : null;
  }
  if (spec.startsWith('/')) {
    // Vite serves both the project root and public/ at '/'.
    const rel = spec.slice(1);
    const path = probe(ctx, joinPath('', rel));
    if (path) return { path, query };
    const pub = joinPath('public', rel);
    if (pub && exists(ctx, pub)) return { public: pub, query };
    return null;
  }
  if (spec.startsWith('.')) {
    const path = probe(ctx, joinPath(dirOf(importer), spec));
    return path ? { path, query } : null;
  }
  if (/^[a-z]+:/i.test(spec)) return null;
  return { bare: packageName(spec), spec };
}
