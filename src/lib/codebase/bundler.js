// Bundles an imported React + Vite + TS project for the preview with
// esbuild-wasm, entirely in memory: project files come from the version's
// `files` map through a virtual-file-system plugin, npm packages stay external
// and load from esm.sh through the import map, images/fonts become asset URLs.
// The esbuild instance is injected (browser build in the app, Node build in
// tests). The output is preview-only and never stored in `files`.
//
// Only our own plugin code runs here; nothing from the project is executed in
// the renderer (the bundle runs later, inside the sandboxed preview frame).
import { esbuildTsconfigRaw, envValues, joinPath, packageVersions, readAliases } from './config.js';
import { buildImportMap } from './importMap.js';
import { dirOf, isBareSpecifier, packageName, resolveImport } from './resolve.js';
import { ROUTER_PACKAGES, routerShimSource } from './routerShim.js';
import { mimeTypeFor } from './paths.js';
import { TAILWIND_CONFIGS, esmifyConfig, findTailwindConfig, tailwindRuntimeSource, v4Directives } from './tailwind.js';

const TAILWIND_ENTRY = '<appblips-tailwind-config>';

const LOADERS = {
  ts: 'ts', tsx: 'tsx', mts: 'ts', cts: 'ts', js: 'jsx', jsx: 'jsx', mjs: 'js', cjs: 'js', json: 'json',
};
const TAILWIND_CSS_RE = /@tailwind\b|@import\s+(url\()?["']tailwindcss|@apply\b|@theme\b|@plugin\b|@config\b|@custom-variant\b|@utility\b|@source\b/;

// npm specifiers that are stylesheets, not JavaScript: an explicit .css file,
// Fontsource font packages (`import '@fontsource-variable/inter'`, whose
// entry point is index.css) and subpaths like `swiper/css`. Importing one as
// a module fails in the browser and takes the whole bundle down with it.
const CSS_PACKAGE_RE = /^@fontsource(-variable)?\//;
export function isCssSpecifier(spec) {
  if (/\.css$/i.test(spec)) return true;
  const name = packageName(spec);
  const subpath = spec.slice(name.length);
  if (CSS_PACKAGE_RE.test(name)) return !/\.(m?js|json)$/i.test(subpath);
  return subpath.split('/').includes('css');
}

// esm.sh follows the package's exports and redirects to the real file, so the
// stylesheet's relative url()s (font files) resolve next to it.
export function cssPackageUrl(spec, version) {
  const name = packageName(spec);
  return `https://esm.sh/${name}@${version || 'latest'}${spec.slice(name.length)}`;
}

// Bare `import 'pkg'` lines (no bindings) in a source file.
const SIDE_EFFECT_IMPORT_RE = /^[ \t]*import\s*(['"])([^'"\n]+)\1/gm;

// What a side-effect-only import of an unknown npm package becomes: tried as
// JavaScript first, and if the browser refuses it (it was a stylesheet after
// all), linked as CSS. Top-level await keeps it in order with the code after it.
function sideEffectModule(spec, cssHref) {
  return `try { await import(${JSON.stringify(spec)}); } catch {
  await new Promise((done) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = ${JSON.stringify(cssHref)};
    link.onload = link.onerror = done;
    document.head.appendChild(link);
  });
}
`;
}

export function textDataUrl(text, mime) {
  return `data:${mime};charset=utf-8,${encodeURIComponent(text)}`;
}

function extOf(path) {
  const m = path.match(/\.([^./]+)$/);
  return m ? m[1].toLowerCase() : '';
}

// Map of '/logo.svg' -> URL for every file under public/ (Vite serves public/
// at the site root, and code refers to those files by absolute path).
export function publicUrls(files, assets, assetUrl) {
  const map = new Map();
  for (const path of Object.keys(files)) {
    if (path.startsWith('public/')) map.set(path.slice(6), textDataUrl(files[path], mimeTypeFor(path)));
  }
  for (const [path, hash] of Object.entries(assets)) {
    if (path.startsWith('public/')) map.set(path.slice(6), assetUrl(path, hash));
  }
  return map;
}

// Swaps exact quoted literals and url() references to public files for their
// URLs. String-for-string, so line numbers (and syntax) are unchanged.
export function rewritePublicPaths(text, publicMap) {
  if (!publicMap.size || !text.includes('/')) return text;
  const swap = (path) => publicMap.get(path.split(/[?#]/)[0]);
  return text
    .replace(/(["'`])(\/[^"'`\s<>]+)\1/g, (match, quote, path) => {
      const url = swap(path);
      return url ? `${quote}${url}${quote}` : match;
    })
    .replace(/url\(\s*(\/[^"')\s]+)\s*\)/g, (match, path) => {
      const url = swap(path);
      return url ? `url("${url}")` : match;
    });
}

// Inlines relative @imports of a Tailwind entry stylesheet (the browser
// Tailwind build can't fetch them) and rewrites its url()s to asset URLs.
// `found` collects what the v4 runtime needs: the project path of the
// @config file and of relative @plugin files, resolved against the
// stylesheet that names them (flattening loses that context).
function flattenTailwindCss(path, ctx, found = { config: null, plugins: {} }, seen = new Set()) {
  if (seen.has(path)) return '';
  seen.add(path);
  const text = ctx.files[path] || '';
  return text
    .replace(/@import\s+(?:url\()?["'](\.{1,2}\/[^"']+|\/[^"']+)["']\)?[^;]*;/g, (match, spec) => {
      const resolved = resolveImport(spec, path, ctx);
      return resolved?.path && resolved.path.endsWith('.css') ? flattenTailwindCss(resolved.path, ctx, found, seen) : match;
    })
    .replace(/@config\s+(["'])([^"']+)\1/g, (match, quote, spec) => {
      const resolved = resolveImport(spec.startsWith('.') || spec.startsWith('/') ? spec : `./${spec}`, path, ctx);
      if (resolved?.path) found.config = resolved.path;
      return match;
    })
    .replace(/@plugin\s+(["'])(\.{1,2}\/[^"']+)\1/g, (match, quote, spec) => {
      const resolved = resolveImport(spec, path, ctx);
      if (resolved?.path) found.plugins[spec] = resolved.path;
      return match;
    })
    .replace(/url\(\s*(["']?)(\.{1,2}\/[^"')]+)\1\s*\)/g, (match, _q, spec) => {
      const url = urlForProjectFile(joinPath(dirOf(path), spec), ctx);
      return url ? `url("${url}")` : match;
    });
}

function urlForProjectFile(path, ctx) {
  if (!path) return null;
  if (ctx.assets[path]) return ctx.assetUrl(path, ctx.assets[path]);
  if (typeof ctx.files[path] === 'string') return textDataUrl(ctx.files[path], mimeTypeFor(path));
  return null;
}

function stripNamespace(file) {
  return String(file || '').replace(/^(vfs|router-shim|side-effect|empty):/, '');
}

function formatMessage(m) {
  const loc = m.location;
  const where = loc ? `${stripNamespace(loc.file)}:${loc.line}:${loc.column + 1}` : '';
  return {
    file: loc ? stripNamespace(loc.file) : null,
    line: loc?.line ?? null,
    column: loc ? loc.column + 1 : null,
    text: m.text,
    lineText: loc?.lineText ?? '',
    message: where ? `${where}: ${m.text}` : m.text,
  };
}

// opts: { files, assets, meta: { entry }, assetUrl(path, hash) -> string }
// Returns { ok, js, css, tailwindCss, tailwindConfigJs, tailwindRuntimeJs, cssLinks, importMap, undeclared, map, env,
// publicMap, errors, warnings }.
export async function bundleCodebase(esbuild, { files, assets = {}, meta, assetUrl, diagnostics }) {
  const ctx = { files, assets, aliases: readAliases(files), assetUrl };
  const publicMap = publicUrls(files, assets, assetUrl);
  const versions = packageVersions(files);
  const bareSpecs = new Set();
  // Packages only the Tailwind config/runtime import: mapped like the rest,
  // but not the app's own imports, so never reported as missing from package.json.
  const tailwindSpecs = new Set();
  let specs = bareSpecs;
  let twEntrySource = '';
  const tailwindFound = { config: null, plugins: {} };
  const tailwindParts = [];
  const cssLinks = [];
  const sideEffectImports = new Set(); // `${importer}\0${spec}` for bare `import 'pkg'` lines
  const env = { BASE_URL: '/', MODE: 'development', DEV: true, PROD: false, SSR: false, ...envValues(files) };

  const plugin = {
    name: 'appblips-vfs',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        const importer = args.namespace === 'vfs' ? args.importer : '';
        // Under Node, esbuild prefixes './' to an entry that also exists on the
        // real disk (e.g. src/main.jsx in the current directory); the entry
        // always means the project file.
        if (args.kind === 'entry-point') {
          return args.path === TAILWIND_ENTRY ? { path: args.path, namespace: 'tw-entry' } : { path: args.path.replace(/^\.\//, ''), namespace: 'vfs' };
        }
        // The shim's own import of the real router, and the side-effect
        // fallback's dynamic import, go to the import map.
        if (args.namespace === 'router-shim') return { path: args.path, external: true };
        if (args.namespace === 'side-effect') {
          specs.add(args.path);
          return { path: args.path, external: true };
        }
        if (/^(data|https?):/i.test(args.path)) return { path: args.path, external: true };

        const isCss = args.kind === 'url-token' || args.kind === 'import-rule';
        if (isBareSpecifier(args.path, ctx.aliases)) {
          const name = args.path.startsWith('@') ? args.path.split('/').slice(0, 2).join('/') : args.path.split('/')[0];
          // CSS shipped in npm packages (fonts, component styles): a <link>
          // pinned like the JS.
          if (isCss || isCssSpecifier(args.path)) {
            const href = cssPackageUrl(args.path, versions.versions[name]);
            if (!cssLinks.includes(href)) cssLinks.push(href);
            return { path: args.path, namespace: 'empty' };
          }
          if (args.kind === 'import-statement' && sideEffectImports.has(`${importer}\0${args.path}`)) {
            return { path: args.path, namespace: 'side-effect', pluginData: { href: cssPackageUrl(args.path, versions.versions[name]) } };
          }
          if (ROUTER_PACKAGES.has(args.path)) {
            specs.add(args.path);
            return { path: args.path, namespace: 'router-shim' };
          }
          specs.add(args.path);
          return { path: args.path, external: true };
        }

        const resolved = resolveImport(args.path, importer, ctx);
        if (resolved?.public) {
          const url = publicMap.get(resolved.public.slice(6));
          return url ? { path: url, external: true } : null;
        }
        if (!resolved?.path) {
          // Leave unresolvable CSS url()s alone, like Vite does.
          if (args.kind === 'url-token') return { path: args.path, external: true };
          return { errors: [{ text: `Could not find "${args.path}"${importer ? ` (imported from ${importer})` : ''}.` }] };
        }
        if (args.kind === 'url-token') {
          const url = urlForProjectFile(resolved.path, ctx);
          return url ? { path: url, external: true } : null;
        }
        return { path: resolved.path, namespace: 'vfs', pluginData: { query: resolved.query } };
      });

      build.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: '', loader: 'js' }));
      build.onLoad({ filter: /.*/, namespace: 'side-effect' }, (args) => ({ contents: sideEffectModule(args.path, args.pluginData.href), loader: 'js' }));
      build.onLoad({ filter: /.*/, namespace: 'tw-entry' }, () => ({ contents: twEntrySource, loader: 'js' }));
      build.onLoad({ filter: /.*/, namespace: 'router-shim' }, (args) => ({ contents: routerShimSource(args.path), loader: 'js' }));

      build.onLoad({ filter: /.*/, namespace: 'vfs' }, (args) => {
        const path = args.path;
        const query = args.pluginData?.query;
        const ext = extOf(path);
        const text = files[path];
        if (query === 'raw') {
          return { contents: `export default ${JSON.stringify(text ?? '')};`, loader: 'js' };
        }
        const isAsset = typeof text !== 'string' || query === 'url' || query === 'inline'
          || (!LOADERS[ext] && ext !== 'css');
        if (isAsset) {
          const url = urlForProjectFile(path, ctx) || '';
          return { contents: `export default ${JSON.stringify(url)};`, loader: 'js' };
        }
        if (ext === 'css') {
          if (TAILWIND_CSS_RE.test(text)) {
            tailwindParts.push(rewritePublicPaths(flattenTailwindCss(path, ctx, tailwindFound), publicMap));
            return { contents: '', loader: 'css' };
          }
          return { contents: rewritePublicPaths(text, publicMap), loader: /\.module\.css$/.test(path) ? 'local-css' : 'css' };
        }
        const source = TAILWIND_CONFIGS.includes(path) ? esmifyConfig(text) : text;
        for (const match of source.matchAll(SIDE_EFFECT_IMPORT_RE)) {
          if (isBareSpecifier(match[2], ctx.aliases)) sideEffectImports.add(`${path}\0${match[2]}`);
        }
        return { contents: rewritePublicPaths(source, publicMap), loader: LOADERS[ext] };
      });
    },
  };

  const options = {
    bundle: true,
    write: false,
    format: 'esm',
    splitting: false,
    outdir: 'out',
    jsx: 'automatic',
    sourcemap: 'external',
    sourcesContent: false,
    target: 'es2022',
    charset: 'utf8',
    logLevel: 'silent',
    tsconfigRaw: esbuildTsconfigRaw(files),
    define: {
      'import.meta.env': JSON.stringify(env),
      'process.env.NODE_ENV': '"development"',
    },
    plugins: [plugin],
  };
  let result;
  const started = performance.now();
  diagnostics?.info('esbuild started', { entry: meta.entry, fileCount: Object.keys(files).length, assetCount: Object.keys(assets).length });
  try {
    result = await esbuild.build({ ...options, entryPoints: [meta.entry] });
  } catch (err) {
    const errors = Array.isArray(err?.errors) && err.errors.length
      ? err.errors.map(formatMessage)
      : [{ file: null, line: null, column: null, text: String(err?.message || err), lineText: '', message: String(err?.message || err) }];
    diagnostics?.error('esbuild failed', { durationMs: Math.round(performance.now() - started), errors, error: err });
    return { ok: false, errors, warnings: (err?.warnings || []).map(formatMessage) };
  }
  diagnostics?.info('esbuild passed', { durationMs: Math.round(performance.now() - started) });

  // The v3 Play CDN takes the project's tailwind.config as a JS object, so the
  // config is bundled too (its packages, e.g. tailwindcss-animate, go through
  // the import map) and assigned to `tailwind.config` inside the frame.
  let tailwindConfigJs = '';
  let tailwindRuntimeJs = '';
  const warnings = result.warnings.map(formatMessage);
  const tailwindCss = tailwindParts.join('\n');
  const buildTailwindEntry = async (source, label) => {
    specs = tailwindSpecs;
    twEntrySource = source;
    diagnostics?.info('Bundling Tailwind setup', { config: label });
    try {
      const built = await esbuild.build({ ...options, entryPoints: [TAILWIND_ENTRY], sourcemap: false });
      return built.outputFiles.find((f) => f.path.endsWith('.js'))?.text || '';
    } catch (err) {
      diagnostics?.warn('Tailwind setup failed; preview styling may differ', { config: label, error: err });
      warnings.push({ file: label, line: null, column: null, text: `The preview could not load ${label}, so styling may differ from the real build.`, lineText: '', message: `${label}: ${err?.errors?.[0]?.text || err?.message || err}` });
      return '';
    } finally {
      specs = bareSpecs;
    }
  };
  if (meta.tailwind === 3 && tailwindParts.length && findTailwindConfig(files)) {
    const configFile = findTailwindConfig(files);
    tailwindConfigJs = await buildTailwindEntry(
      `import config from ${JSON.stringify(`./${configFile}`)};\nif (window.tailwind) window.tailwind.config = config;\n`,
      configFile,
    );
  } else if (meta.tailwind === 4 && tailwindParts.length && v4Directives(tailwindCss).needsRuntime) {
    const plugins = {};
    for (const id of v4Directives(tailwindCss).plugins) plugins[id] = tailwindFound.plugins[id] ? `./${tailwindFound.plugins[id]}` : id;
    tailwindRuntimeJs = await buildTailwindEntry(tailwindRuntimeSource({
      css: tailwindCss,
      configImport: tailwindFound.config ? `./${tailwindFound.config}` : null,
      plugins,
      versions: versions.versions,
    }), tailwindFound.config || 'the Tailwind setup');
  }

  const out = (suffix) => result.outputFiles.find((f) => f.path.endsWith(suffix))?.text || '';
  const { importMap, undeclared: allUndeclared } = buildImportMap([...new Set([...bareSpecs, ...tailwindSpecs])].sort(), versions);
  const undeclared = allUndeclared.filter((name) => [...bareSpecs].some((spec) => packageName(spec) === name));
  // Undeclared packages still preview (esm.sh resolves 'latest'), but the
  // real `npm install` wouldn't have them, so the build check reports them.
  for (const name of undeclared) {
    importMap.imports[name] = `https://esm.sh/${name}?external=react,react-dom`;
    importMap.imports[`${name}/`] = `https://esm.sh/${name}&external=react,react-dom/`;
  }
  let map = null;
  try { map = JSON.parse(out('.js.map')); } catch { /* no map */ }
  return {
    ok: true,
    js: out('.js'),
    css: out('.css'),
    tailwindCss,
    tailwindConfigJs,
    tailwindRuntimeJs,
    cssLinks,
    importMap,
    undeclared,
    map,
    env,
    publicMap,
    errors: [],
    warnings,
  };
}
