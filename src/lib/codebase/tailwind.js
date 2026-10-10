// Tailwind for the preview. The real build runs Tailwind through PostCSS or
// @tailwindcss/vite, which can't run in the browser, so the preview uses
// Tailwind's own browser builds instead: the v3 Play CDN (with the project's
// tailwind.config bundled and assigned inside the sandboxed frame) or
// @tailwindcss/browser for v4. Close to the real output but not identical, so
// the UI notes it; export always keeps the real config untouched.

export const TAILWIND_CONFIGS = ['tailwind.config.ts', 'tailwind.config.js', 'tailwind.config.mjs', 'tailwind.config.cjs', 'tailwind.config.mts'];

export function findTailwindConfig(files) {
  return TAILWIND_CONFIGS.find((p) => typeof files[p] === 'string') || null;
}

// The Play CDN serves exact 3.x versions but stops at 3.4.17 (later 3.4.x
// releases are build-tool fixes only), so newer or unparseable versions use it.
const PLAY_CDN_LATEST = [3, 4, 17];

export function tailwindScriptUrl(major, version) {
  const exact = String(version || '').match(/\d+\.\d+\.\d+/)?.[0];
  if (major === 4) {
    const v = exact && Number(exact.split('.')[0]) === 4 ? exact : '4';
    return `https://cdn.jsdelivr.net/npm/@tailwindcss/browser@${v}`;
  }
  const parts = exact ? exact.split('.').map(Number) : null;
  const newer = parts && (parts[1] > PLAY_CDN_LATEST[1] || (parts[1] === PLAY_CDN_LATEST[1] && parts[2] > PLAY_CDN_LATEST[2]));
  const v = parts && parts[0] === 3 && !newer ? exact : PLAY_CDN_LATEST.join('.');
  return `https://cdn.tailwindcss.com/${v}`;
}

// Turns a CommonJS tailwind.config.js (module.exports + require) into ESM so
// esbuild can bundle it with packages left external for the import map.
// Pattern-based and only ever applied to the tailwind config.
export function esmifyConfig(source) {
  if (!/\bmodule\.exports\b|\brequire\(/.test(source)) return source;
  const imports = [];
  let body = source.replace(/\brequire\(\s*(['"])([^'"]+)\1\s*\)/g, (_m, _q, spec) => {
    let index = imports.findIndex((i) => i.spec === spec);
    if (index < 0) { index = imports.length; imports.push({ spec }); }
    return `__appblips_req${index}`;
  });
  body = body.replace(/\bmodule\.exports\s*=/, 'export default');
  const header = imports.map((imp, i) => `import * as __appblips_ns${i} from ${JSON.stringify(imp.spec)}; const __appblips_req${i} = __appblips_ns${i}.default ?? __appblips_ns${i};`).join(' ');
  // Kept on the first line so the config's own line numbers don't move.
  return header + body;
}

// v4's browser build can't fetch packages: drop @plugin and package @imports
// other than tailwindcss itself, returning what was removed for a notice.
export function browserSafeV4Css(css) {
  const removed = [];
  const out = css
    .replace(/@plugin\s+["'][^"']+["'][^;]*;/g, (m) => { removed.push(m.trim()); return ''; })
    .replace(/@config\s+["'][^"']+["']\s*;/g, (m) => { removed.push(m.trim()); return ''; })
    .replace(/@import\s+(?:url\()?["']([^"'./][^"']*)["']\)?[^;]*;/g, (m, spec) => {
      if (/^tailwindcss(\/|$)/.test(spec)) return m;
      removed.push(m.trim());
      return '';
    });
  return { css: out, removed };
}

// Tailwind v4 CSS that the ready-made browser build can't handle: a JS
// config (@config, common after a v3 -> v4 upgrade), plugins (@plugin) or
// CSS packages (@import "tw-animate-css"). Those projects get our own small
// runtime instead (tailwindRuntimeSource), still running inside the frame.
export function v4Directives(css) {
  const plugins = [...css.matchAll(/@plugin\s+["']([^"']+)["']/g)].map((m) => m[1]);
  const hasConfig = /@config\s+["'][^"']+["']/.test(css);
  const packageImports = [...css.matchAll(/@import\s+(?:url\()?["']([^"'./][^"']*)["']/g)].map((m) => m[1]).filter((s) => !/^tailwindcss(\/|$)/.test(s));
  return { plugins, hasConfig, packageImports, needsRuntime: Boolean(plugins.length || hasConfig || packageImports.length) };
}

// JSON.stringify, plus escaping the characters that could end a <script> or
// a line, so a value can't break out of the generated source.
const jsLiteral = (value) => JSON.stringify(value)
  .replace(/[<>/\u2028\u2029]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));

// Source of the in-frame Tailwind v4 runtime: compiles the project's CSS
// with Tailwind's own compiler (`tailwindcss` from esm.sh, pinned like every
// package) and rebuilds the stylesheet from the class names on the page as
// the app renders. configImport is a project path or null; plugins maps each
// @plugin id to what to import for it (a package name or a project path).
export function tailwindRuntimeSource({ css, configImport, plugins, versions }) {
  const pluginEntries = Object.entries(plugins)
    .map(([id, spec]) => `${jsLiteral(id)}: () => import(${jsLiteral(spec)})`).join(',\n  ');
  return `import { compile } from 'tailwindcss';
${configImport ? `import projectConfig from ${jsLiteral(configImport)};` : 'const projectConfig = {};'}
const CSS = ${jsLiteral(css)};
const VERSIONS = ${jsLiteral(versions)};
const PLUGINS = {
  ${pluginEntries}
};
const packageUrl = (id) => {
  const name = id.startsWith('@') ? id.split('/').slice(0, 2).join('/') : id.split('/')[0];
  return 'https://esm.sh/' + name + '@' + (VERSIONS[name] || 'latest') + id.slice(name.length);
};
async function loadStylesheet(id, base) {
  const url = /^(\\.|\\/|https?:)/.test(id) ? new URL(id, base).href
    : id === 'tailwindcss' ? packageUrl('tailwindcss/index.css') : packageUrl(id);
  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not load the stylesheet ' + id + ' (' + response.status + ')');
  return { path: response.url, base: response.url.replace(/[^/]*$/, ''), content: await response.text() };
}
async function loadModule(id, base, hint) {
  if (hint === 'config') return { path: id, base, module: projectConfig };
  const load = PLUGINS[id];
  if (!load) throw new Error('The preview cannot load the Tailwind plugin ' + id);
  const mod = await load();
  return { path: id, base, module: mod.default ?? mod };
}
let compiler;
try {
  compiler = await compile(CSS, { base: '/', loadStylesheet, loadModule });
} catch (err) {
  // A plugin or config the preview can't load: style the page without it
  // rather than not at all.
  console.warn('[AppBlips preview] Tailwind config/plugins could not be loaded, so styling may differ:', err);
  compiler = await compile(CSS.replace(/@(plugin|config)\\s+["'][^"']+["'][^;]*;/g, ''), { base: '/', loadStylesheet });
}
const style = document.createElement('style');
style.setAttribute('data-appblips-tailwind', '');
document.head.appendChild(style);
const classes = new Set();
let fresh = false;
let queued = false;
const collect = (el) => {
  const value = el.getAttribute && el.getAttribute('class');
  if (!value) return;
  for (const name of value.split(/\\s+/)) if (name && !classes.has(name)) { classes.add(name); fresh = true; }
};
const scan = (root) => {
  if (root.nodeType !== 1) return;
  collect(root);
  root.querySelectorAll('[class]').forEach(collect);
};
const flush = () => {
  queued = false;
  if (!fresh) return;
  fresh = false;
  style.textContent = compiler.build([...classes]);
};
scan(document.documentElement);
style.textContent = compiler.build([...classes]);
fresh = false;
new MutationObserver((records) => {
  for (const record of records) {
    if (record.type === 'attributes') collect(record.target);
    else record.addedNodes.forEach(scan);
  }
  if (fresh && !queued) { queued = true; setTimeout(flush, 16); }
}).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
`;
}
