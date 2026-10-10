// Read-only highlighting for imported codebase files (TS/JS/JSX, CSS, JSON).
// syntaxHighlightHtml only knows HTML tags, which turns TSX into noise. This
// is a single-pass tokenizer, not a parser: good enough to tell comments,
// strings and keywords apart at a glance. Output uses the same
// `.code-line` / `.line-number` markup as syntaxHighlightHtml so the code
// view styles both alike.
import { syntaxHighlightHtml } from './helpers.js';

const JS_KEYWORDS = new Set([
  'import', 'export', 'from', 'default', 'as', 'const', 'let', 'var', 'function', 'return', 'if', 'else',
  'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'class', 'extends', 'super', 'this',
  'typeof', 'instanceof', 'in', 'of', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'yield',
  'interface', 'type', 'enum', 'implements', 'public', 'private', 'protected', 'readonly', 'static',
  'declare', 'namespace', 'keyof', 'satisfies', 'void', 'delete', 'null', 'undefined', 'true', 'false',
]);

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Order matters: comments and strings first so keywords inside them stay plain.
const JS_RE = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|(`(?:\\[\s\S]|[^`\\])*`?|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(<\/?[A-Za-z][\w.:-]*)|\b(\d[\d_.]*(?:e[+-]?\d+)?n?|0x[\da-f]+)\b|([A-Za-z_$][\w$]*)/gi;
const CSS_RE = /(\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(@[\w-]+)|(#[\da-f]{3,8}\b|-?\d*\.?\d+(?:px|rem|em|%|vh|vw|s|ms|deg|fr)?\b)|([\w-]+)(?=\s*:)/gi;
const JSON_RE = /("(?:\\.|[^"\\\n])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/gi;

function tokenize(code, kind) {
  const tokens = []; // [className | null, text]
  let last = 0;
  const push = (cls, text) => { if (text) tokens.push([cls, text]); };
  const re = new RegExp(kind === 'css' ? CSS_RE : kind === 'json' ? JSON_RE : JS_RE);
  for (let m = re.exec(code); m; m = re.exec(code)) {
    if (m[0] === '') { re.lastIndex++; continue; }
    push(null, code.slice(last, m.index));
    last = m.index + m[0].length;
    if (kind === 'json') {
      if (m[1]) { push(m[2] ? 'token-attr-name' : 'token-string', m[1]); push(null, m[2] || ''); }
      else push(m[3] ? 'token-keyword' : 'token-attr-name', m[0]);
    } else if (kind === 'css') {
      push(m[1] ? 'token-comment' : m[2] ? 'token-string' : m[3] ? 'token-keyword' : m[4] ? 'token-attr-name' : 'token-tag-name', m[0]);
    } else if (m[1]) push('token-comment', m[0]);
    else if (m[2]) push('token-string', m[0]);
    else if (m[3]) push('token-tag-name', m[0]);
    else if (m[4]) push('token-attr-name', m[0]);
    else push(JS_KEYWORDS.has(m[5]) ? 'token-keyword' : null, m[0]);
  }
  push(null, code.slice(last));
  return tokens;
}

function languageOf(path) {
  const ext = (path.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'].includes(ext)) return 'js';
  if (['css', 'scss', 'less', 'pcss'].includes(ext)) return 'css';
  if (['json', 'jsonc', 'webmanifest'].includes(ext)) return 'json';
  if (['html', 'htm', 'svg', 'xml'].includes(ext)) return 'html';
  return 'text';
}

export function highlightSource(code, path) {
  if (!code) return '';
  const lang = languageOf(path || '');
  if (lang === 'html') return syntaxHighlightHtml(code);
  const tokens = lang === 'text' ? [[null, code]] : tokenize(code, lang);
  // A token can span lines (block comments, template strings), so each line
  // closes and reopens its span to keep every .code-line self-contained.
  const lines = [''];
  for (const [cls, text] of tokens) {
    const parts = text.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) lines.push('');
      if (part) lines[lines.length - 1] += cls ? `<span class="${cls}">${escapeHtml(part)}</span>` : escapeHtml(part);
    });
  }
  return lines
    .map((line, i) => `<div class="code-line"><span class="line-number">${i + 1}</span><span class="line-content">${line || ' '}</span></div>`)
    .join('');
}
