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
