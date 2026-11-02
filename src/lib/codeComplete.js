// Local, offline code completion for the code view's hand editor (opt-in via
// Settings → Workspace → Code autocomplete). It never calls the AI: the
// suggestions are words already in the file plus a fixed vocabulary for the
// file's language (JS keywords and common DOM APIs, CSS properties, HTML tags
// and attributes). Framework-free so it can be tested with plain node.

const JS_WORDS = [
  'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default', 'delete', 'else',
  'export', 'extends', 'false', 'finally', 'for', 'from', 'function', 'import', 'instanceof', 'let', 'new',
  'null', 'return', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'undefined',
  'while', 'yield',
  'addEventListener', 'removeEventListener', 'querySelector', 'querySelectorAll', 'getElementById',
  'createElement', 'appendChild', 'classList', 'textContent', 'innerHTML', 'setAttribute', 'getAttribute',
  'preventDefault', 'stopPropagation', 'requestAnimationFrame', 'setTimeout', 'setInterval', 'clearTimeout',
  'clearInterval', 'localStorage', 'console', 'document', 'window', 'JSON', 'stringify', 'parse', 'Math',
  'Promise', 'fetch', 'length', 'push', 'filter', 'forEach', 'reduce', 'includes', 'indexOf', 'slice',
  'splice', 'toFixed', 'toString', 'Object', 'Array', 'keys', 'values', 'entries',
  'useState', 'useEffect', 'useRef', 'useMemo', 'useCallback', 'useReducer', 'useContext', 'className',
  'onClick', 'onChange', 'onSubmit',
];

const CSS_WORDS = [
  'align-items', 'align-self', 'animation', 'background', 'background-color', 'background-image',
  'border', 'border-radius', 'bottom', 'box-shadow', 'box-sizing', 'color', 'cursor', 'display',
  'flex', 'flex-direction', 'flex-wrap', 'font-family', 'font-size', 'font-weight', 'gap', 'grid',
  'grid-template-columns', 'grid-template-rows', 'height', 'justify-content', 'left', 'letter-spacing',
  'line-height', 'margin', 'margin-bottom', 'margin-left', 'margin-right', 'margin-top', 'max-height',
  'max-width', 'min-height', 'min-width', 'object-fit', 'opacity', 'outline', 'overflow', 'padding',
  'padding-bottom', 'padding-left', 'padding-right', 'padding-top', 'pointer-events', 'position', 'right',
  'text-align', 'text-decoration', 'text-transform', 'top', 'transform', 'transition', 'user-select',
  'vertical-align', 'visibility', 'white-space', 'width', 'z-index',
  'absolute', 'relative', 'fixed', 'sticky', 'block', 'inline-block', 'none', 'center', 'space-between',
  'important', 'inherit', 'transparent', 'hidden', 'pointer',
];

const HTML_TAGS = [
  'a', 'article', 'aside', 'audio', 'body', 'button', 'canvas', 'dialog', 'div', 'footer', 'form', 'h1',
  'h2', 'h3', 'h4', 'head', 'header', 'html', 'iframe', 'img', 'input', 'label', 'li', 'link', 'main',
  'meta', 'nav', 'option', 'p', 'path', 'script', 'section', 'select', 'span', 'strong', 'style', 'svg',
  'table', 'tbody', 'td', 'template', 'textarea', 'th', 'thead', 'title', 'tr', 'ul', 'ol', 'video',
];

const HTML_ATTRS = [
  'alt', 'aria-label', 'charset', 'class', 'content', 'data-', 'disabled', 'href', 'height', 'id',
  'loading', 'name', 'placeholder', 'rel', 'role', 'src', 'style', 'tabindex', 'target', 'title', 'type',
  'value', 'viewBox', 'width',
];

const MAX_ITEMS = 8;
// Large files: only scan this many characters around the caret for words, so
// typing stays fast in a 1 MB file.
const SCAN_WINDOW = 200_000;

export function languageOf(path) {
  const ext = String(path || '').split('.').pop().toLowerCase();
  if (['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts'].includes(ext)) return 'js';
  if (['css', 'scss', 'less', 'pcss'].includes(ext)) return 'css';
  if (['html', 'htm', 'svg', 'xml'].includes(ext)) return 'html';
  return 'text';
}

// Inside an HTML page, which language is the caret in? Looks back for the
// last <script>/<style> opening that hasn't been closed yet.
function htmlRegion(text, caret) {
  const before = text.slice(Math.max(0, caret - SCAN_WINDOW), caret).toLowerCase();
  const lastScript = before.lastIndexOf('<script');
  const lastStyle = before.lastIndexOf('<style');
  if (lastScript > before.lastIndexOf('</script') && lastScript > lastStyle) return 'js';
  if (lastStyle > before.lastIndexOf('</style') && lastStyle > lastScript) return 'css';
  return 'html';
}

/**
 * What to complete at `caret`: the partial word before it, where that word
 * starts, and the vocabulary to use. Returns null when there's nothing to
 * complete (no word being typed, or the caret is in the middle of a word).
 */
export function completionContext(text, caret, path) {
  if (caret == null || caret < 0 || caret > text.length) return null;
  // Typing in the middle of a word (fixing a typo) shouldn't pop up a list.
  if (/[\w$-]/.test(text[caret] || '')) return null;
  let lang = languageOf(path);
  if (lang === 'html') lang = htmlRegion(text, caret);
  // CSS words contain hyphens; JS and HTML words mostly don't (but HTML
  // attributes like aria-label do).
  const wordRe = lang === 'js' ? /[\w$]+$/ : /[\w-]+$/;
  const match = wordRe.exec(text.slice(Math.max(0, caret - 100), caret));
  const prefix = match ? match[0] : '';
  const start = caret - prefix.length;
  const charBefore = text[start - 1] || '';
  const twoBefore = text.slice(Math.max(0, start - 2), start);
  let kind = lang;
  if (lang === 'html' && (charBefore === '<' || twoBefore === '</')) kind = 'html-tag';
  else if (lang === 'html' && isInsideTag(text, start)) kind = 'html-attr';
  // A tag name suggests after one letter; anything else after two, so the
  // list doesn't flash up on every keystroke.
  const minLength = kind === 'html-tag' ? 1 : 2;
  if (prefix.length < minLength || /^\d/.test(prefix)) return null;
  return { prefix, start, kind };
}

function isInsideTag(text, pos) {
  const before = text.slice(Math.max(0, pos - 2000), pos);
  const lt = before.lastIndexOf('<');
  return lt > before.lastIndexOf('>') && /^<[A-Za-z]/.test(before.slice(lt));
}

function vocabularyFor(kind) {
  if (kind === 'js') return JS_WORDS;
  if (kind === 'css') return CSS_WORDS;
  if (kind === 'html-tag') return HTML_TAGS;
  if (kind === 'html-attr') return HTML_ATTRS;
  return [];
}

/**
 * Up to MAX_ITEMS suggestions for the word being typed at `caret`, best first:
 * exact-case prefix matches before case-insensitive ones, then words used more
 * often in the file, then shorter words. Returns { prefix, start, items } or
 * null when there's nothing to suggest.
 */
export function getCompletions(text, caret, path) {
  const ctx = completionContext(text, caret, path);
  if (!ctx) return null;
  const { prefix, start, kind } = ctx;
  const lowerPrefix = prefix.toLowerCase();
  const counts = new Map();
  if (kind !== 'html-tag') {
    const from = Math.max(0, caret - SCAN_WINDOW / 2);
    const slice = text.slice(from, Math.min(text.length, caret + SCAN_WINDOW / 2));
    const wordRe = kind === 'css' || kind === 'html-attr' ? /[A-Za-z_][\w-]{2,}/g : /[A-Za-z_$][\w$]{2,}/g;
    for (const m of slice.matchAll(wordRe)) {
      // Skip the word being typed itself.
      if (from + m.index === start) continue;
      counts.set(m[0], (counts.get(m[0]) || 0) + 1);
    }
  }
  for (const word of vocabularyFor(kind)) if (!counts.has(word)) counts.set(word, 0);
  const items = [];
  for (const [word, count] of counts) {
    if (word.length <= prefix.length || !word.toLowerCase().startsWith(lowerPrefix)) continue;
    items.push({ word, count, exact: word.startsWith(prefix) });
  }
  if (!items.length) return null;
  items.sort((a, b) => (b.exact - a.exact) || (b.count - a.count) || (a.word.length - b.word.length) || a.word.localeCompare(b.word));
  return { prefix, start, items: items.slice(0, MAX_ITEMS).map((item) => item.word) };
}

/** Visual line and column of `caret`, expanding tabs to `tabSize` columns. */
export function caretPosition(text, caret, tabSize = 2) {
  const before = text.slice(0, caret);
  const line = before.split('\n').length - 1;
  const lineText = before.slice(before.lastIndexOf('\n') + 1);
  let column = 0;
  for (const ch of lineText) column = ch === '\t' ? column + tabSize - (column % tabSize) : column + 1;
  return { line, column };
}
