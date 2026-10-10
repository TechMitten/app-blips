// Builds the preview's import map: every npm package the project imports is
// loaded from esm.sh, pinned to the version in package-lock.json (or the
// package.json range). Every package the project imports directly is marked
// external in every other URL, so all of them share one copy of React,
// react-router, etc. (a second copy breaks hooks and context).
import { packageName } from './resolve.js';

const ESM_HOST = 'https://esm.sh';
// Always mapped: the JSX runtime and react-dom/client are imported by code
// esbuild generates or by libraries, even when the project never names them.
const ALWAYS = ['react', 'react-dom'];

export function esmUrl(name, version, subpath, externals) {
  const others = externals.filter((e) => e !== name);
  const base = `${ESM_HOST}/${name}@${encodeURIComponent(version).replace(/%5E/g, '^').replace(/%7E/g, '~')}`;
  if (subpath === '/') {
    // Prefix entries put the external list in the path, where esm.sh reads
    // the '/' of a scoped name (@scope/pkg) as the start of the subpath and
    // 404s, encoded or not; those keep their own copy in this form only.
    const unscoped = others.filter((e) => !e.includes('/'));
    return unscoped.length ? `${base}&external=${unscoped.join(',')}/` : `${base}/`;
  }
  return `${base}${subpath}${others.length ? `?external=${others.join(',')}` : ''}`;
}

// specifiers: bare import specifiers found in the bundle (e.g. 'react-dom/client').
// Returns { importMap, undeclared, externals }.
export function buildImportMap(specifiers, { versions, declared }) {
  const used = new Set(ALWAYS);
  const undeclared = [];
  for (const spec of specifiers) {
    const name = packageName(spec);
    if (!(name in declared) && !ALWAYS.includes(name)) {
      if (!undeclared.includes(name)) undeclared.push(name);
      continue;
    }
    used.add(name);
  }
  const externals = [...used].sort();
  const imports = {};
  for (const name of externals) {
    const version = versions[name] || 'latest';
    imports[name] = esmUrl(name, version, '', externals);
    imports[`${name}/`] = esmUrl(name, version, '/', externals);
  }
  // Exact entries for subpaths the project uses, so each gets the plain
  // ?external= form rather than the prefix form.
  for (const spec of specifiers) {
    const name = packageName(spec);
    if (spec === name || !used.has(name)) continue;
    imports[spec] = esmUrl(name, versions[name] || 'latest', spec.slice(name.length), externals);
  }
  return { importMap: { imports }, undeclared, externals };
}
