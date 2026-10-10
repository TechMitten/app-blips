// Assembles the preview document for an imported codebase: the project's own
// index.html with its entry <script src> replaced by the esbuild bundle
// inline, plus the import map, Tailwind and bundled CSS. The result then goes
// through injectPreviewBridge like any generated page. Preview-only: nothing
// here is ever stored in `files` or exported.
import { rewritePublicPaths } from './bundler.js';
import { browserSafeV4Css, tailwindScriptUrl } from './tailwind.js';

const CLOSE_SCRIPT = '</' + 'script>';

// Inline <script>/<style> contents must not contain their closing tag.
export function escapeInlineScript(js) {
  return js.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

function escapeInlineStyle(css) {
  return css.replace(/<\/(style)/gi, '<\\/$1');
}

function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

// Vite replaces %VITE_X% (and %MODE% etc.) in index.html with env values.
export function replaceHtmlEnv(html, env) {
  return html.replace(/%([A-Z][A-Z0-9_]*)%/g, (match, name) => (name in env ? String(env[name]) : match));
}

function removeEntryScript(html, entry) {
  const escaped = entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<script\\b[^>]*\\bsrc=["']/?${escaped}(\\?[^"']*)?["'][^>]*>\\s*</script>`, 'i');
  return html.replace(re, '');
}

function countLines(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

// bundle: result of bundleCodebase (ok). Returns { html, bundleLine, notices }
// where bundleLine is the 1-based line of the first bundle line in `html`.
export function buildPreviewHtml({ files, meta, bundle, env = {}, publicMap = new Map(), route = '/', tailwindVersion = '' }) {
  const notices = [];
  let html = files['index.html'] || '<!doctype html><html><head></head><body><div id="root"></div></body></html>';
  html = removeEntryScript(replaceHtmlEnv(html, env), meta.entry);
  html = rewritePublicPaths(html, publicMap);

  const head = [];
  head.push(`<script>window.__APPBLIPS_INITIAL_ROUTE__=${jsonForScript(route || '/')};${CLOSE_SCRIPT}`);
  head.push(`<script type="importmap">${jsonForScript(bundle.importMap)}${CLOSE_SCRIPT}`);
  for (const href of bundle.cssLinks || []) head.push(`<link rel="stylesheet" href="${href.replace(/"/g, '&quot;')}">`);

  let tailwindCss = bundle.tailwindCss || '';
  if (tailwindCss && meta.tailwind === 4) {
    const safe = browserSafeV4Css(tailwindCss);
    tailwindCss = safe.css;
    if (safe.removed.length) notices.push(`The preview skips these Tailwind plugins/imports: ${safe.removed.join(' ')}`);
    head.push(`<script src="${tailwindScriptUrl(4, tailwindVersion)}">${CLOSE_SCRIPT}`);
    head.push(`<style type="text/tailwindcss">${escapeInlineStyle(tailwindCss)}</style>`);
  } else if (tailwindCss && meta.tailwind === 3) {
    head.push(`<script src="${tailwindScriptUrl(3, tailwindVersion)}">${CLOSE_SCRIPT}`);
    if (bundle.tailwindConfigJs) {
      // The Play CDN compiles <style type="text/tailwindcss"> as soon as it is
      // parsed; with the default config, @apply of theme classes
      // (bg-background) throws. So the config module assigns the config
      // first and only then adds the stylesheet.
      const addStyle = `;{const s=document.createElement('style');s.setAttribute('type','text/tailwindcss');s.textContent=${jsonForScript(tailwindCss)};document.head.appendChild(s);}`;
      head.push(`<script type="module">${escapeInlineScript(bundle.tailwindConfigJs)}${addStyle}${CLOSE_SCRIPT}`);
    } else {
      head.push(`<style type="text/tailwindcss">${escapeInlineStyle(tailwindCss)}</style>`);
    }
  } else if (tailwindCss) {
    head.push(`<style>${escapeInlineStyle(tailwindCss)}</style>`);
  }
  if (bundle.css) head.push(`<style data-appblips-css>${escapeInlineStyle(bundle.css)}</style>`);

  const headHtml = head.join('');
  const headMatch = /<head\b[^>]*>/i.exec(html);
  if (headMatch) {
    const at = headMatch.index + headMatch[0].length;
    html = html.slice(0, at) + headHtml + html.slice(at);
  } else {
    html = headHtml + html;
  }

  const scriptOpen = '<script type="module">\n';
  const script = scriptOpen + escapeInlineScript(bundle.js) + CLOSE_SCRIPT;
  const bodyClose = html.search(/<\/body\s*>/i);
  const at = bodyClose >= 0 ? bodyClose : html.length;
  const bundleLine = countLines(html.slice(0, at)) + 2;
  html = html.slice(0, at) + script + html.slice(at);
  return { html, bundleLine, notices };
}
