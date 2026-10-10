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
import { dirOf, isBareSpecifier, resolveImport } from './resolve.js';
import { ROUTER_PACKAGES, routerShimSource } from './routerShim.js';
import { mimeTypeFor } from './paths.js';
import { TAILWIND_CONFIGS, esmifyConfig, findTailwindConfig } from './tailwind.js';

const TAILWIND_ENTRY = '<appblips-tailwind-config>';

const LOADERS = {
  ts: 'ts', tsx: 'tsx', mts: 'ts', cts: 'ts', js: 'jsx', jsx: 'jsx', mjs: 'js', cjs: 'js', json: 'json',
};
const TAILWIND_CSS_RE = /@tailwind\b|@import\s+(url\()?["']tailwindcss|@apply\b|@theme\b|@plugin\b|@config\b|@custom-variant\b|@utility\b|@source\b/;

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
function flattenTailwindCss(path, ctx, seen = new Set()) {
  if (seen.has(path)) return '';
  seen.add(path);
  const text = ctx.files[path] || '';
  return text
    .replace(/@import\s+(?:url\()?["'](\.{1,2}\/[^"']+|\/[^"']+)["']\)?[^;]*;/g, (match, spec) => {
      const resolved = resolveImport(spec, path, ctx);
      return resolved?.path && resolved.path.endsWith('.css') ? flattenTailwindCss(resolved.path, ctx, seen) : match;
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
  return String(file || '').replace(/^(vfs|router-shim|css-link|empty):/, '');
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
// Returns { ok, js, css, tailwindCss, tailwindConfigJs, cssLinks, importMap, undeclared, map, env,
// publicMap, errors, warnings }.
export async function bundleCodebase(esbuild, { files, assets = {}, meta, assetUrl }) {
  const ctx = { files, assets, aliases: readAliases(files), assetUrl };
  const publicMap = publicUrls(files, assets, assetUrl);
  const versions = packageVersions(files);
  const bareSpecs = new Set();
  const tailwindParts = [];
  const cssLinks = [];
  const env = { BASE_URL: '/', MODE: 'development', DEV: true, PROD: false, SSR: false, ...envValues(files) };

  const plugin = {
    name: 'appblips-vfs',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        const importer = args.namespace === 'vfs' ? args.importer : '';
        if (args.kind === 'entry-point') return { path: args.path, namespace: args.path === TAILWIND_ENTRY ? 'tw-entry' : 'vfs' };
        // The shim's own import of the real router goes to the import map.
        if (args.namespace === 'router-shim') return { path: args.path, external: true };
        if (/^(data|https?):/i.test(args.path)) return { path: args.path, external: true };

        const isCss = args.kind === 'url-token' || args.kind === 'import-rule';
        if (isBareSpecifier(args.path, ctx.aliases)) {
          const name = args.path.startsWith('@') ? args.path.split('/').slice(0, 2).join('/') : args.path.split('/')[0];
          // CSS shipped in npm packages (fonts, component styles): a <link>
          // to the raw file on jsDelivr, pinned like the JS.
          if (isCss || /\.css$/.test(args.path)) {
            const version = versions.versions[name] || 'latest';
            const href = `https://cdn.jsdelivr.net/npm/${name}@${version}${args.path.slice(name.length)}`;
            if (!cssLinks.includes(href)) cssLinks.push(href);
            return { path: args.path, namespace: 'empty' };
          }
          if (ROUTER_PACKAGES.has(args.path)) {
            bareSpecs.add(args.path);
            return { path: args.path, namespace: 'router-shim' };
          }
          bareSpecs.add(args.path);
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
      build.onLoad({ filter: /.*/, namespace: 'tw-entry' }, () => ({
        contents: `import config from ${JSON.stringify(`./${findTailwindConfig(files)}`)};\nif (window.tailwind) window.tailwind.config = config;\n`,
        loader: 'js',
      }));
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
            tailwindParts.push(rewritePublicPaths(flattenTailwindCss(path, ctx), publicMap));
            return { contents: '', loader: 'css' };
          }
          return { contents: rewritePublicPaths(text, publicMap), loader: /\.module\.css$/.test(path) ? 'local-css' : 'css' };
        }
        const source = TAILWIND_CONFIGS.includes(path) ? esmifyConfig(text) : text;
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
  try {
    result = await esbuild.build({ ...options, entryPoints: [meta.entry] });
  } catch (err) {
    const errors = Array.isArray(err?.errors) && err.errors.length
      ? err.errors.map(formatMessage)
      : [{ file: null, line: null, column: null, text: String(err?.message || err), lineText: '', message: String(err?.message || err) }];
    return { ok: false, errors, warnings: (err?.warnings || []).map(formatMessage) };
  }

  // The v3 Play CDN takes the project's tailwind.config as a JS object, so the
  // config is bundled too (its packages, e.g. tailwindcss-animate, go through
  // the import map) and assigned to `tailwind.config` inside the frame.
  let tailwindConfigJs = '';
  const warnings = result.warnings.map(formatMessage);
  if (meta.tailwind === 3 && tailwindParts.length && findTailwindConfig(files)) {
    try {
      const config = await esbuild.build({ ...options, entryPoints: [TAILWIND_ENTRY], sourcemap: false });
      tailwindConfigJs = config.outputFiles.find((f) => f.path.endsWith('.js'))?.text || '';
    } catch (err) {
      warnings.push({ file: findTailwindConfig(files), line: null, column: null, text: 'The preview could not load tailwind.config, so custom theme colours may be missing.', lineText: '', message: `tailwind.config: ${err?.errors?.[0]?.text || err?.message || err}` });
    }
  }

  const out = (suffix) => result.outputFiles.find((f) => f.path.endsWith(suffix))?.text || '';
  const { importMap, undeclared } = buildImportMap([...bareSpecs].sort(), versions);
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
    tailwindCss: tailwindParts.join('\n'),
    tailwindConfigJs,
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
