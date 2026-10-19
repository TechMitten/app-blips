// Source positions for click-to-edit (Website Studio).
//
// Locating a clicked element by its text or markup is a guess, and it fails
// on repeated identical blocks or markup a script changed after load. So the
// PREVIEW copy of the page gets every opening tag in <body> numbered
// (`<div data-ab-src=12 ...>`), and a click reports that number back. The
// parent re-derives the same numbering from the stored source and goes
// straight to that tag (`locateElement` in directEdits.js).
//
// Like the bridge and the loop guards, the numbers exist only in the preview
// document: they are never written into `files` and never exported. The
// value is deliberately unquoted: if a scan ever mistakes text inside an
// attribute value for a tag, an unquoted `data-ab-src=12` only adds harmless
// text there, where a quoted one would end the attribute early. Nothing is
// inserted that contains a newline, so preview line numbers stay aligned
// with the source.
//
// The numbering is only valid for the exact source it was computed from, so
// the bridge also reports `sourceFingerprint` of that source; the parent
// ignores the number when the page has changed since.

export const SOURCE_ATTR = 'data-ab-src';

// One opening tag, tolerant of `>` inside quoted attribute values.
export const OPEN_TAG_RE = /^<[a-zA-Z][a-zA-Z0-9-]*(?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*\s*\/?>/;
const ANY_OPEN_TAG_RE = new RegExp(OPEN_TAG_RE.source.slice(1), 'g');

// Same-length copy of the source with comments and <script>/<style>/
// <textarea> bodies blanked out, so tag scans never match markup that only
// appears inside a string or a comment. Offsets stay valid for `code`.
export const maskNonMarkup = (code) => code
  .replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length))
  .replace(
    /(<(script|style|textarea)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi,
    (_m, open, _tag, body, close) => open + body.replace(/[^\n]/g, ' ') + close,
  );

// Page scaffolding and non-rendered elements are never click targets.
const UNNUMBERED = new Set(['html', 'head', 'body', 'script', 'style', 'meta', 'link', 'title', 'base', 'noscript']);

/**
 * Start offset of every numbered opening tag, indexed by its number.
 * Numbers count every tag after `<body>` (or the whole document when there
 * is none), skipped ones included, so they depend only on the source.
 *
 * @param {string} code
 * @param {string} [masked] maskNonMarkup(code), when the caller has it
 * @returns {Array<number | null>} null for tags that carry no number
 */
export const sourceElementStarts = (code, masked = maskNonMarkup(code)) => {
  const bodyOpen = /<body\b[^>]*>/i.exec(masked);
  ANY_OPEN_TAG_RE.lastIndex = bodyOpen ? bodyOpen.index + bodyOpen[0].length : 0;
  const starts = [];
  let m;
  while ((m = ANY_OPEN_TAG_RE.exec(masked))) {
    const tag = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(m[0])[1].toLowerCase();
    starts.push(UNNUMBERED.has(tag) ? null : m.index);
  }
  return starts;
};

const TAG_NAME_AT = /<[a-zA-Z][a-zA-Z0-9-]*/y;

/** The preview copy of `code` with every numbered tag carrying its number. */
export const stampSourcePositions = (code) => {
  const starts = sourceElementStarts(code);
  let out = '';
  let last = 0;
  starts.forEach((start, id) => {
    if (start === null) return;
    // Right after the tag name, so no attribute parsing is needed.
    TAG_NAME_AT.lastIndex = start;
    const at = start + TAG_NAME_AT.exec(code)[0].length;
    out += code.slice(last, at) + ` ${SOURCE_ATTR}=${id}`;
    last = at;
  });
  return out + code.slice(last);
};

/** Short, stable fingerprint of a source document (FNV-1a + length). */
export const sourceFingerprint = (code) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < code.length; i += 1) {
    hash ^= code.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(36)}-${code.length.toString(36)}`;
};
