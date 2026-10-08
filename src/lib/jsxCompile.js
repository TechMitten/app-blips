import { transform } from 'sucrase';
import { JSX_TYPE, extractInlineScripts } from './syntaxCheck.js';

// One pinned React for every generated app. react-dom and React libraries load
// with ?external=react so they import the bare 'react' specifier through the
// page's import map: two React copies on one page break every hook.
export const REACT_VERSION = '19.2.0';
export const REACT_IMPORTS = {
  react: `https://esm.sh/react@${REACT_VERSION}`,
  'react/jsx-runtime': `https://esm.sh/react@${REACT_VERSION}/jsx-runtime`,
  'react-dom/client': `https://esm.sh/react-dom@${REACT_VERSION}/client?external=react`,
};

const IMPORTMAP_RE = /<script\b[^>]*\btype\s*=\s*["']?importmap["']?[^>]*>([\s\S]*?)<\/script/i;
const IMPORTS_OPEN_RE = /"imports"\s*:\s*\{/;
const TYPE_ATTR_RE = /(\stype\s*=\s*)(["']?)text\/jsx\2/i;

const countNewlines = (str) => (str.match(/\n/g) || []).length;

export const hasJsxScripts = (html) =>
  typeof html === 'string' && extractInlineScripts(html, { jsx: true }).some((b) => b.type === JSX_TYPE);

// Sucrase's automatic runtime imports 'react/jsx-runtime', which models often
// leave out of the import map. Add it (or a whole React map) without adding a
// newline, so line numbers in runtime errors still match the stored source.
const ensureJsxRuntimeImport = (html) => {
  const map = IMPORTMAP_RE.exec(html);
  if (!map) {
    const entries = JSON.stringify({ imports: REACT_IMPORTS });
    const tag = `<script type="importmap">${entries}</script>`;
    const head = /<head\b[^>]*>/i.exec(html);
    const at = head ? head.index + head[0].length : 0;
    return html.slice(0, at) + tag + html.slice(at);
  }
  if (map[1].includes('"react/jsx-runtime"')) return html;
  const reactUrl = /"react"\s*:\s*"([^"]+)"/.exec(map[1])?.[1];
  const [base, query] = (reactUrl || REACT_IMPORTS.react).split('?');
  const runtimeUrl = `${base.replace(/\/$/, '')}/jsx-runtime${query ? `?${query}` : ''}`;
  const open = IMPORTS_OPEN_RE.exec(map[1]);
  if (!open) return html;
  const at = map.index + map[0].indexOf(map[1]) + open.index + open[0].length;
  return html.slice(0, at) + `"react/jsx-runtime":${JSON.stringify(runtimeUrl)},` + html.slice(at);
};

// Turns every <script type="text/jsx"> into a <script type="module"> holding
// the compiled JavaScript. Runs at preview/export time only: `files` keeps the
// JSX source, like it never holds loop protection or the preview bridge.
// Sucrase keeps every line where it was, so the loop guards and runtime error
// line numbers downstream stay aligned with the source. Documents with no JSX
// (website/game pages, older Preact apps) come back unchanged.
export const compileJsxScripts = (html) => {
  if (typeof html !== 'string' || !html) return html;
  const blocks = extractInlineScripts(html, { jsx: true }).filter((b) => b.type === JSX_TYPE && !b.unclosed);
  if (!blocks.length) return html;

  let out = html;
  for (const block of blocks.reverse()) {
    let code;
    try {
      code = transform(block.code, { transforms: ['jsx'], jsxRuntime: 'automatic', production: true }).code;
    } catch (err) {
      // A broken block still has to fail visibly in the preview (and reach the
      // review loop's runtime-error check) instead of silently rendering
      // nothing. Pad to the original height so later lines keep their numbers.
      const line = err.loc ? block.startLine + err.loc.line - 1 : block.startLine;
      const message = `${String(err.message).replace(/ \(\d+:\d+\)$/, '')} (line ${line})`;
      code = `throw new SyntaxError(${JSON.stringify(message)});` + '\n'.repeat(countNewlines(block.code));
    }
    const openTag = out.slice(block.tagStart, block.startIdx).replace(TYPE_ATTR_RE, '$1"module"');
    out = out.slice(0, block.tagStart) + openTag + code + out.slice(block.endIdx);
  }
  return ensureJsxRuntimeImport(out);
};
