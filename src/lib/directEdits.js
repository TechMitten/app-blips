// Deterministic click-to-edit support for the Website Studio.
//
// The preview bridge reports a clicked element as a plain description (tag,
// role, visible text, attributes, serialized markup -- see the editing
// section of src/previewBridge.js). This module turns a desired change
// ("new text", "new image src", "new background color", ...) into a new
// source document by string-matching the reported element back into the
// generated HTML, reusing edits.js' exact-then-fuzzy matching semantics.
//
// Every operation is deliberately conservative: if the anchor cannot be
// located UNAMBIGUOUSLY in the source, the operation fails with a reason and
// the caller falls back to an AI-assisted edit through the chat. Direct DOM
// mutation is never an option here -- the frame is reloaded from pristine
// `generatedCode` on every version switch, so only source-level edits
// persist.
//
// This works only when the rendered DOM mirrors the markup, which is exactly
// what the website system prompt mandates (static HTML content). JS-rendered
// content will not match and correctly falls back to the AI path.

// Note: the import below carries an explicit .js extension (as in
// previewStorage.js) so this pure-logic module can also run under plain
// node in the standalone testing/ scripts.

import { countExactOccurrences, findFuzzyMatches } from './edits.js';
import { findFontByStack, insertFontLinks } from './fonts.js';

const escapeHtmlText = (str) => String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

// Full attribute-value escaping (adds quotes), for src/href/alt injection.
const escapeAttrValue = (str) => escapeHtmlText(str).replace(/"/g, '&quot;');

const truncate = (str, n) => {
  const s = String(str ?? '');
  return s.length > n ? s.slice(0, n) + '…' : s;
};

// Replace `search` with `replace` ONLY when it matches exactly one location
// (exact substring first, whitespace-normalized line window second). Mirrors
// applySurgicalEdits' semantics but always refuses ambiguity -- a click-to-
// edit has no way to ask the user "which of the 3 matches did you mean?".
// An empty `replace` is a removal and is allowed.
const replaceUnique = (code, search, replace) => {
  if (!search || search === replace) return { ok: false, reason: 'no-op' };

  const exactCount = countExactOccurrences(code, search);
  if (exactCount === 1) {
    return { ok: true, code: code.replace(search, replace) };
  }
  if (exactCount > 1) {
    return { ok: false, reason: 'ambiguous' };
  }

  const codeLines = code.split(/\r?\n/);
  const searchLines = search.split(/\r?\n/);
  const matches = findFuzzyMatches(codeLines, searchLines);
  if (matches.length === 1) {
    const at = matches[0];
    return {
      ok: true,
      code: [...codeLines.slice(0, at), replace, ...codeLines.slice(at + searchLines.length)].join('\n'),
    };
  }
  return { ok: false, reason: matches.length > 1 ? 'ambiguous' : 'not-found' };
};

// Serialized markup reported by the bridge re-encodes entities (& -> &amp;),
// while innerText decodes them, so text anchors must try the escaped form
// first and fall back to the raw form.
const textCandidates = (text) => {
  const escaped = escapeHtmlText(text);
  return escaped === text ? [text] : [escaped, text];
};

// Swap `prevText` -> `nextText` inside a serialized fragment, only when the
// fragment contains exactly one occurrence of the text.
const swapTextInFragment = (fragment, prevText, nextText) => {
  for (const candidate of textCandidates(prevText)) {
    const at = fragment.indexOf(candidate);
    if (at !== -1 && fragment.indexOf(candidate, at + candidate.length) === -1) {
      return fragment.slice(0, at) + nextText + fragment.slice(at + candidate.length);
    }
  }
  return null;
};


const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  ndash: '–', mdash: '—', hellip: '…', copy: '©',
  middot: '·', bull: '•', reg: '®', trade: '™',
};

const decodeEntities = (str) => str.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
  if (body[0] === '#') {
    const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  }
  const named = NAMED_ENTITIES[body.toLowerCase()];
  return named === undefined ? match : named;
});

// Comparable form of an element's visible text: what the bridge's innerText
// reports (entities decoded, whitespace collapsed). Case-insensitive because
// innerText applies CSS text-transform (uppercase eyebrows etc.).
const comparableText = (html) => decodeEntities(html.replace(/<[^>]*>/g, ' '))
  .replace(/[\s\u00a0]+/g, ' ')
  .trim()
  .toLowerCase();

const TAG_NAME_RE = /^[a-z][a-z0-9-]*$/i;

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

// Opening tags of `tag`, tolerant of `>` inside quoted attribute values.
const openTagRe = (tag) => new RegExp(
  `<${tag}(?=[\\s>/])(?:\\s+[^\\s"'>/=]+(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s"'>]+))?)*\\s*\\/?>`,
  'gi',
);

// Same-length copy of the source with comments and <script>/<style>/
// <textarea> bodies blanked out, so tag scans never match markup that only
// appears inside a string or a comment. Offsets stay valid for `code`.
const maskNonMarkup = (code) => code
  .replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length))
  .replace(
    /(<(script|style|textarea)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi,
    (_m, open, _tag, body, close) => open + body.replace(/[^\n]/g, ' ') + close,
  );

// End of the element whose opening tag ends at `innerStart` (depth-tracked
// over same-name tags). Scans the masked source.
const findCloseTag = (masked, tag, innerStart) => {
  const tagRe = new RegExp(`<(/?)${tag}(?=[\\s>/])[^>]*>`, 'gi');
  tagRe.lastIndex = innerStart;
  let depth = 1;
  let t;
  while ((t = tagRe.exec(masked))) {
    if (t[1]) {
      depth -= 1;
      if (depth === 0) return { closeStart: t.index, closeEnd: t.index + t[0].length };
    } else if (!t[0].endsWith('/>')) {
      depth += 1;
    }
  }
  return null;
};

// Every `<tag ...>...</tag>` element in the source whose visible text equals
// `wantedText`, in document order. Unlike outerHTML matching this does not
// depend on the opening tag's attributes, which the live DOM may have
// diverged from (JS-added inline styles/classes from scroll animations,
// etc.) or on how entities were written in the source.
const findElementsByText = (code, tag, wantedText, masked = maskNonMarkup(code)) => {
  if (!TAG_NAME_RE.test(tag)) return [];
  const wanted = comparableText(wantedText);
  if (!wanted) return [];
  const openRe = openTagRe(tag);
  const results = [];
  let open;
  while ((open = openRe.exec(masked))) {
    if (open[0].endsWith('/>')) continue;
    const innerStart = open.index + open[0].length;
    const close = findCloseTag(masked, tag, innerStart);
    if (!close) continue;
    if (comparableText(masked.slice(innerStart, close.closeStart)) === wanted) {
      results.push({
        open: code.slice(open.index, innerStart),
        openStart: open.index,
        innerStart,
        innerEnd: close.closeStart,
        closeEnd: close.closeEnd,
        inner: code.slice(innerStart, close.closeStart),
      });
    }
  }
  return results;
};

// Tokenize an opening tag's attributes (name, raw value, offsets within the
// tag) so reads and writes never match text inside another attribute's
// quoted value. `tailStart` is where the closing `>` / `/>` begins.
const ATTR_TOKEN_RE = /\s+([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/y;
const parseOpenTag = (open) => {
  const nameMatch = /^<[a-zA-Z][a-zA-Z0-9-]*/.exec(open);
  if (!nameMatch) return null;
  const attrs = [];
  let pos = nameMatch[0].length;
  for (;;) {
    ATTR_TOKEN_RE.lastIndex = pos;
    const m = ATTR_TOKEN_RE.exec(open);
    if (!m) break;
    attrs.push({ name: m[1].toLowerCase(), start: pos, end: pos + m[0].length, value: m[2] ?? m[3] ?? m[4] ?? '' });
    pos += m[0].length;
  }
  return { attrs, tailStart: pos };
};

// Attribute value (entities decoded) on an opening tag, or null.
const readAttr = (openTag, name) => {
  const attr = parseOpenTag(openTag)?.attrs.find((a) => a.name === name);
  return attr ? decodeEntities(attr.value) : null;
};

const classTokens = (openTag) => {
  const value = readAttr(openTag, 'class');
  return value === null ? null : value.split(/\s+/).filter(Boolean);
};

// Pick the one source element the clicked element corresponds to. The
// bridge reports the element's rank among same-tag/same-text elements in the
// rendered DOM (`textOrdinal` of `textCount`); for static markup that equals
// the source order, so it disambiguates repeated text such as a brand name in
// both the header and the footer. Falls back to class matching.
const pickTextCandidate = (candidates, element) => {
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) return null;
  const { textOrdinal, textCount } = element;
  if (Number.isInteger(textOrdinal) && textCount === candidates.length) {
    return candidates[textOrdinal] || null;
  }
  const liveClasses = new Set((element.attributes?.class || '').split(/\s+/).filter(Boolean));
  const byClass = candidates.filter((c) => {
    const tokens = classTokens(c.open);
    return tokens && tokens.every((tok) => liveClasses.has(tok));
  });
  return byClass.length === 1 ? byClass[0] : null;
};

const applyTextByScan = (code, element, prevText, nextText, styles) => {
  const candidate = pickTextCandidate(findElementsByText(code, element.tag, prevText), element);
  if (!candidate) return null;
  let nextOpen = candidate.open;
  if (styles) {
    nextOpen = mergeStylesIntoOpenTag(candidate.open, styles);
    if (!nextOpen) return null;
  }
  let nextInner = candidate.inner;
  if (nextText !== prevText) {
    const escapedNext = escapeHtmlText(nextText);
    if (!candidate.inner.includes('<')) {
      // Plain-text element: replace the text, keep the source's padding.
      const lead = /^\s*/.exec(candidate.inner)[0];
      const trail = /\s*$/.exec(candidate.inner)[0];
      nextInner = lead + escapedNext + trail;
    } else {
      // Nested markup: only swap when the old text is verbatim inside.
      nextInner = swapTextInFragment(candidate.inner, prevText, escapedNext);
    }
    if (nextInner === null) return null;
  }
  const openStart = candidate.innerStart - candidate.open.length;
  return {
    ok: true,
    code: code.slice(0, openStart) + nextOpen + nextInner + code.slice(candidate.innerEnd),
  };
};


// --- Inline style merging -------------------------------------------------
//
// Text formatting (font, size, weight, ...) is written as inline style on the
// element's opening tag: it needs no knowledge of the page's Tailwind setup
// and beats class-based rules. Existing declarations are kept.

const STYLE_PROPS = {
  fontFamily: 'font-family',
  fontSize: 'font-size',
  fontWeight: 'font-weight',
  fontStyle: 'font-style',
  textDecorationLine: 'text-decoration-line',
  textAlign: 'text-align',
  textTransform: 'text-transform',
  color: 'color',
  backgroundColor: 'background-color',
  backgroundImage: 'background-image',
  backgroundSize: 'background-size',
  backgroundPosition: 'background-position',
};

const STYLE_LABELS = {
  fontFamily: 'font',
  fontSize: 'size',
  fontWeight: 'weight',
  fontStyle: 'italic',
  textDecorationLine: 'underline',
  textAlign: 'alignment',
  textTransform: 'letter case',
  color: 'color',
};

// Split a style attribute into declarations without cutting inside url(...)
// or quotes (data: URIs contain ';').
const splitDeclarations = (css) => {
  const out = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '(') {
      depth += 1;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
    } else if (ch === ';' && depth === 0) {
      out.push(css.slice(start, i));
      start = i + 1;
    }
  }
  out.push(css.slice(start));
  return out.map((d) => d.trim()).filter(Boolean);
};

const cleanStyleValue = (value) => String(value ?? '').replace(/[;{}<>\\]/g, '').trim().slice(0, 200);

// A single-quoted CSS url() for a background image. data: URIs contain ';'
// and run far past cleanStyleValue's cap, so image URLs get their own
// validation instead of being cleaned: anything that could close the url(),
// the quote, or the style attribute is refused outright.
const cssUrl = (url) => {
  const value = String(url ?? '').trim();
  if (!value || value.length > 2_000_000 || /['"()\\<>\r\n]/.test(value)) return null;
  return `url('${value}')`;
};
const isCssUrl = (value) => /^url\('[^'"()\\<>\r\n]*'\)$/.test(String(value ?? ''));
const cleanStyleFor = (prop, value) => (prop === 'backgroundImage' && isCssUrl(value) ? value : cleanStyleValue(value));

const OPEN_TAG_RE = /^<[a-zA-Z][a-zA-Z0-9-]*(?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*\s*\/?>/;

// Merge `styles` ({ fontSize: '32px', ... }) into the first tag of `html`.
// Returns the new html, or null when `html` does not start with a tag.
const mergeStylesIntoOpenTag = (html, styles) => {
  const match = OPEN_TAG_RE.exec(html);
  if (!match) return null;
  const open = match[0];
  const wanted = {};
  Object.entries(styles).forEach(([prop, value]) => {
    const css = STYLE_PROPS[prop];
    const clean = cleanStyleFor(prop, value);
    if (css && clean) wanted[css] = clean;
  });
  if (!Object.keys(wanted).length) return null;

  const styleAttr = /(\sstyle\s*=\s*)(?:"([^"]*)"|'([^']*)')/i.exec(open);
  let nextOpen;
  if (styleAttr) {
    const quote = styleAttr[2] !== undefined ? '"' : "'";
    const existing = splitDeclarations(styleAttr[2] !== undefined ? styleAttr[2] : styleAttr[3])
      .filter((decl) => {
        const name = decl.slice(0, decl.indexOf(':')).trim().toLowerCase();
        return !(name in wanted);
      });
    const escapeForQuote = (v) => (quote === '"' ? v.replace(/"/g, '&quot;') : v.replace(/'/g, '&#39;'));
    const merged = [...existing, ...Object.entries(wanted).map(([k, v]) => `${k}: ${escapeForQuote(v)}`)].join('; ');
    nextOpen = open.replace(styleAttr[0], `${styleAttr[1]}${quote}${merged};${quote}`);
  } else {
    const decls = Object.entries(wanted).map(([k, v]) => `${k}: ${v.replace(/"/g, '&quot;')}`).join('; ');
    nextOpen = open.replace(/\s*(\/?>)$/, ` style="${decls};"$1`);
  }
  return nextOpen + html.slice(open.length);
};

const summarizeStyles = (styles) => {
  const labels = Object.keys(styles || {})
    .filter((k) => STYLE_LABELS[k] && cleanStyleValue(styles[k]))
    .map((k) => STYLE_LABELS[k]);
  return labels.length ? `styled text (${Array.from(new Set(labels)).join(', ')})` : null;
};

const applyTextChange = (code, element, nextTextRaw, styleChanges = null) => {
  const prevText = (element.text || '').trim();
  const nextText = nextTextRaw === undefined ? prevText : String(nextTextRaw ?? '').trim();
  const styles = styleChanges && summarizeStyles(styleChanges) ? styleChanges : null;
  const textChanged = prevText !== nextText;
  if (!textChanged && !styles) return { ok: false, reason: 'no-op' };
  if (!prevText) return { ok: false, reason: 'element-has-no-text' };
  if (element.textTruncated) return { ok: false, reason: 'text-too-long' };
  const escapedNext = escapeHtmlText(nextText);
  const summary = [
    textChanged ? `changed text to "${truncate(nextText, 60)}"` : null,
    styles ? summarizeStyles(styles) : null,
  ].filter(Boolean).join(' and ');

  // Preferred path: locate the element's own serialized markup and rewrite
  // it (style on the opening tag, text inside). Matching the whole element
  // (not just the string) proves we're editing the right occurrence.
  const outer = element.outerHTML;
  if (outer && !element.outerHTMLTruncated) {
    let nextOuter = styles ? mergeStylesIntoOpenTag(outer, styles) : outer;
    if (nextOuter && textChanged) nextOuter = swapTextInFragment(nextOuter, prevText, escapedNext);
    if (nextOuter && nextOuter !== outer) {
      const result = replaceUnique(code, outer, nextOuter);
      if (result.ok) return { ...result, summary };
      // An ambiguous/not-found outer fragment still allows the paths below,
      // which can be more precise for short strings.
    }
  }

  // Fallback: the text string itself is unique in the document. (Text only:
  // there is no tag here to carry a style.)
  if (!styles) {
    for (const candidate of textCandidates(prevText)) {
      if (countExactOccurrences(code, candidate) === 1) {
        return { ok: true, code: code.replace(candidate, escapedNext), summary };
      }
    }
  }

  // Last resort: structural scan by tag + visible text, tolerant of
  // attribute drift and entity spelling (see findElementsByText).
  const scanned = applyTextByScan(code, element, prevText, nextText, styles);
  if (scanned) return { ...scanned, summary };
  return { ok: false, reason: 'text-not-found' };
};

// --- Locating an element in the source -------------------------------------
//
// The value swaps below anchor on a string that already exists in the
// source. Adding something that is not there yet (a wallpaper on a plain
// section, alt text on an image without one) and the structural edits
// (remove / duplicate / move) need the element's full source RANGE instead.
// Strategies run from most to least specific, and each is accepted only
// when it yields exactly one candidate, so a miss falls back to the AI path
// rather than editing the wrong element.

const OPEN_TAG_AT = new RegExp(OPEN_TAG_RE.source.slice(1), 'y');
const ANY_OPEN_TAG_RE = new RegExp(OPEN_TAG_RE.source.slice(1), 'g');

const lineStarts = (code) => {
  const starts = [0];
  for (let i = 0; i < code.length; i += 1) if (code.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
};

// Range of the `tag` element whose opening tag starts at `start`, or null.
const rangeAt = (code, masked, tag, start) => {
  if (masked[start] !== '<') return null;
  OPEN_TAG_AT.lastIndex = start;
  const m = OPEN_TAG_AT.exec(code);
  if (!m) return null;
  if (/^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(m[0])[1].toLowerCase() !== tag) return null;
  const openEnd = start + m[0].length;
  if (VOID_TAGS.has(tag) || m[0].endsWith('/>')) return { start, openEnd, end: openEnd, open: m[0], tag };
  const close = findCloseTag(masked, tag, openEnd);
  return close ? { start, openEnd, end: close.closeEnd, open: m[0], tag } : null;
};

const squashText = (str) => String(str ?? '').replace(/\s+/g, '').toLowerCase();

// The rank-only strategy has no content anchor of its own, so its pick must
// at least look like the clicked element: same leading text (textContent,
// which unlike innerText includes hidden descendants such as a collapsed
// mobile menu) or, for text-less elements, the same source classes.
const ordinalPlausible = (masked, range, element) => {
  const sample = squashText(element.rawText ?? element.text).slice(0, 120);
  if (sample) return squashText(comparableText(masked.slice(range.openEnd, range.end))).startsWith(sample);
  const tokens = classTokens(range.open);
  if (!tokens || !tokens.length) return true;
  const live = new Set((element.attributes?.class || '').split(/\s+/).filter(Boolean));
  return tokens.every((tok) => live.has(tok));
};

/**
 * Find the clicked element's full range in the source.
 *
 * @returns {{ ok: true, start: number, openEnd: number, end: number, open: string, tag: string, strategy: string }
 *   | { ok: false, reason: 'invalid' | 'ambiguous' | 'element-not-found' }}
 */
export const locateElement = (code, element) => {
  const tag = String(element?.tag || '').toLowerCase();
  if (!code || !TAG_NAME_RE.test(tag)) return { ok: false, reason: 'invalid' };
  const masked = maskNonMarkup(code);
  const found = (range, strategy) => ({ ok: true, ...range, strategy });
  let ambiguous = false;

  // 1. The element's serialized markup: exact, then whitespace-tolerant.
  const outer = element.outerHTML;
  if (outer && !element.outerHTMLTruncated) {
    const count = countExactOccurrences(code, outer);
    if (count === 1) {
      const range = rangeAt(code, masked, tag, code.indexOf(outer));
      if (range) return found(range, 'markup');
    } else if (count > 1) {
      ambiguous = true;
    } else {
      const codeLines = code.split(/\r?\n/);
      const matches = findFuzzyMatches(codeLines, outer.split(/\r?\n/));
      if (matches.length === 1) {
        const at = matches[0];
        const start = lineStarts(code)[at] + /^\s*/.exec(codeLines[at])[0].length;
        const range = rangeAt(code, masked, tag, start);
        if (range) return found(range, 'markup');
      } else if (matches.length > 1) {
        ambiguous = true;
      }
    }
  }

  // 2. Tag + visible text (tolerates attribute drift and entity spelling).
  const text = String(element.text || '').trim();
  if (text && !element.textTruncated && !VOID_TAGS.has(tag)) {
    const candidates = findElementsByText(code, tag, text, masked);
    const pick = pickTextCandidate(candidates, element);
    const range = pick && rangeAt(code, masked, tag, pick.openStart);
    if (range) return found(range, 'text');
    if (candidates.length > 1) ambiguous = true;
  }

  // 3. A distinguishing attribute on an opening tag of the same name.
  const opens = [];
  const re = openTagRe(tag);
  let m;
  while ((m = re.exec(masked))) opens.push({ start: m.index, open: code.slice(m.index, m.index + m[0].length) });
  for (const attr of ['id', 'src']) {
    const live = element.attributes?.[attr];
    if (!live) continue;
    const hits = opens.filter((o) => readAttr(o.open, attr) === live);
    const range = hits.length === 1 && rangeAt(code, masked, tag, hits[0].start);
    if (range) return found(range, 'attribute');
    if (hits.length > 1) ambiguous = true;
  }

  // 4. Rank among same-name elements: for static markup the rendered order
  // is the source order, so accept it only when the counts agree.
  const { tagOrdinal, tagCount } = element;
  if (Number.isInteger(tagOrdinal) && tagOrdinal >= 0 && tagCount === opens.length && opens[tagOrdinal]) {
    const range = rangeAt(code, masked, tag, opens[tagOrdinal].start);
    if (range && ordinalPlausible(masked, range, element)) return found(range, 'ordinal');
  }

  return { ok: false, reason: ambiguous ? 'ambiguous' : 'element-not-found' };
};

// Set (string) or remove (null) attributes on an opening tag. New
// attributes go at the end; existing ones are rewritten in place.
const setOpenTagAttributes = (open, changes) => {
  const parsed = parseOpenTag(open);
  if (!parsed) return null;
  const edits = [];
  const appended = [];
  Object.entries(changes).forEach(([name, value]) => {
    const pair = value === null || value === undefined ? '' : ` ${name}="${escapeAttrValue(value)}"`;
    const existing = parsed.attrs.find((a) => a.name === name.toLowerCase());
    if (existing) edits.push({ start: existing.start, end: existing.end, text: pair });
    else if (pair) appended.push(pair);
  });
  let next = open.slice(0, parsed.tailStart) + appended.join('') + open.slice(parsed.tailStart);
  edits.sort((a, b) => b.start - a.start).forEach((e) => {
    next = next.slice(0, e.start) + e.text + next.slice(e.end);
  });
  return next;
};

const spliceOpenTag = (code, range, nextOpen) => code.slice(0, range.start) + nextOpen + code.slice(range.openEnd);

// Rewrite the located element's opening tag with `rewrite(open)`.
const rewriteLocatedOpenTag = (code, element, rewrite, notFoundReason) => {
  const range = locateElement(code, element);
  if (!range.ok) return { ok: false, reason: range.reason === 'element-not-found' ? notFoundReason : range.reason };
  const nextOpen = rewrite(range.open);
  if (!nextOpen || nextOpen === range.open) return { ok: false, reason: 'no-op' };
  return { ok: true, code: spliceOpenTag(code, range, nextOpen) };
};

// Attribute edits (src / href / alt / title). An existing value is swapped
// by searching the exact serialized `attr="value"` pair, so the match is
// anchored to the attribute, not the bare URL (which could appear in link
// text or elsewhere). A missing attribute -- or one spelled differently in
// the source (entities) -- is written onto the located opening tag.
const ATTR_SUMMARIES = {
  href: (v) => `updated link to "${truncate(v, 60)}"`,
  alt: () => 'updated alt text',
  title: () => 'updated tooltip',
};

const applyAttributeChange = (code, element, attrName, nextValueRaw) => {
  const prevValue = element.attributes?.[attrName] ?? '';
  const nextValue = String(nextValueRaw ?? '').trim();
  if (prevValue === nextValue) return { ok: false, reason: 'no-op' };
  const summary = (ATTR_SUMMARIES[attrName] || (() => `updated ${attrName}`))(nextValue);

  if (prevValue) {
    for (const quote of ['"', "'"]) {
      const search = `${attrName}=${quote}${prevValue}${quote}`;
      const replace = `${attrName}=${quote}${escapeAttrValue(nextValue)}${quote}`;
      const result = replaceUnique(code, search, replace);
      if (result.ok) return { ...result, summary };
    }
  }
  const result = rewriteLocatedOpenTag(
    code, element, (open) => setOpenTagAttributes(open, { [attrName]: nextValue }), `${attrName}-not-found`,
  );
  return result.ok ? { ...result, summary } : result;
};

// Swapping an <img> src is defeated by a surviving srcset (browsers prefer
// it), so when one is present it must be removed in the same operation.
const applyImageSrcChange = (code, element, nextSrc) => {
  let working = code;
  const srcset = element.attributes?.srcset;
  if (srcset) {
    for (const quote of ['"', "'"]) {
      const result = replaceUnique(working, ` srcset=${quote}${srcset}${quote}`, '');
      if (result.ok) {
        working = result.code;
        break;
      }
    }
    if (working === code) return { ok: false, reason: 'srcset-not-found' };
  }
  const result = applyAttributeChange(working, element, 'src', nextSrc);
  if (!result.ok) return result;
  return { ...result, summary: 'replaced image' };
};

// Open-in-new-tab toggle for links. `rel` is merged rather than replaced
// (a page may carry rel="nofollow"), and on the way back only the tokens
// this toggle adds are removed.
const NEW_TAB_REL = ['noopener', 'noreferrer'];
const applyTargetChange = (code, element, nextTarget) => {
  const wantBlank = nextTarget === '_blank';
  if (wantBlank === ((element.attributes?.target || '') === '_blank')) return { ok: false, reason: 'no-op' };
  const result = rewriteLocatedOpenTag(code, element, (open) => {
    const rel = (readAttr(open, 'rel') || '').split(/\s+/).filter(Boolean);
    if (wantBlank) {
      return setOpenTagAttributes(open, { target: '_blank', rel: Array.from(new Set([...rel, ...NEW_TAB_REL])).join(' ') });
    }
    const keptRel = rel.filter((tok) => !NEW_TAB_REL.includes(tok.toLowerCase()));
    return setOpenTagAttributes(open, { target: null, rel: keptRel.length ? keptRel.join(' ') : null });
  }, 'link-not-found');
  return result.ok ? { ...result, summary: wantBlank ? 'link opens in a new tab' : 'link opens in the same tab' } : result;
};

// Tailwind bg-* utilities that style a background IMAGE/position/repeat
// rather than a color -- these must not be treated as the element's
// background color token.
const NON_COLOR_BG_TOKEN = /^bg-(?:cover|contain|center|top|bottom|left|right|top-left|top-right|bottom-left|bottom-right|no-repeat|repeat|repeat-x|repeat-y|round|space|fixed|local|scroll|clip-(?:text|border|padding|content)|origin-(?:border|padding|content)|none|gradient(?:-[a-z]+)?)(?:\/[a-z0-9.]+)?$/;

const hasGradientOnly = (element) => {
  const bg = element.backgroundImage || '';
  return /gradient\(/i.test(bg) && !/url\(/i.test(bg);
};

const applyBackgroundColorChange = (code, element, nextColorRaw) => {
  const nextColor = String(nextColorRaw ?? '').trim();
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(nextColor)) {
    return { ok: false, reason: 'invalid-color' };
  }
  const summary = `set background to ${nextColor}`;
  // A gradient paints over any color, so a solid fill must also clear it --
  // swapping the color token alone would visibly change nothing.
  const gradient = hasGradientOnly(element);

  if (!gradient) {
    // Tailwind class token: `bg-slate-900`, `bg-[#0f172a]`, ... Swap the
    // token inside the exact serialized class attribute.
    const cls = element.attributes?.class;
    if (cls) {
      const tokens = cls.split(/\s+/).filter(Boolean);
      const colorTokens = tokens.filter((t) => t.startsWith('bg-') && !t.startsWith('bg-gradient') && !NON_COLOR_BG_TOKEN.test(t));
      if (colorTokens.length === 1) {
        const nextCls = tokens.map((t) => (t === colorTokens[0] ? `bg-[${nextColor}]` : t)).join(' ');
        for (const quote of ['"', "'"]) {
          const result = replaceUnique(code, `class=${quote}${cls}${quote}`, `class=${quote}${nextCls}${quote}`);
          if (result.ok) return { ...result, summary };
        }
      }
    }

    // Inline style: `style="background-color: X"` or `style="background: X"`.
    const style = element.attributes?.style;
    if (style && /background(?:-color)?\s*:/i.test(style)) {
      const nextStyle = style.replace(/(background(?:-color)?)\s*:\s*[^;]+;?/i, (_m, prop) => `${prop}: ${nextColor}; `);
      if (nextStyle !== style) {
        for (const quote of ['"', "'"]) {
          const result = replaceUnique(code, `style=${quote}${style}${quote}`, `style=${quote}${nextStyle}${quote}`);
          if (result.ok) return { ...result, summary };
        }
      }
    }
  }

  // No single token to swap (none, several, or a gradient): write the color
  // as inline style on the located element, which beats class-based rules.
  const styles = gradient ? { backgroundColor: nextColor, backgroundImage: 'none' } : { backgroundColor: nextColor };
  const result = rewriteLocatedOpenTag(code, element, (open) => mergeStylesIntoOpenTag(open, styles), 'background-not-found');
  return result.ok ? { ...result, summary } : result;
};

// Background image: an inline url() is swapped in place (keeping any
// gradient overlay and sizing around it); otherwise the image is written as
// inline style on the located element, sized to cover when the element had
// no image before.
const applyBackgroundImageChange = (code, element, nextImageRaw) => {
  if (!String(nextImageRaw ?? '').trim()) return { ok: false, reason: 'no-op' };
  const url = cssUrl(nextImageRaw);
  if (!url) return { ok: false, reason: 'invalid-image-url' };
  const hadImage = /url\(/i.test(element.backgroundImage || '');
  const summary = hadImage ? 'replaced background image' : 'added background image';

  const style = element.attributes?.style;
  if (style && /url\(/i.test(style)) {
    const nextStyle = style.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/i, () => url);
    if (nextStyle !== style) {
      for (const quote of ['"', "'"]) {
        const inAttr = quote === '"' ? nextStyle : nextStyle.replace(/'/g, '&#39;');
        const result = replaceUnique(code, `style=${quote}${style}${quote}`, `style=${quote}${inAttr}${quote}`);
        if (result.ok) return { ...result, summary };
      }
    }
  }

  const styles = { backgroundImage: url };
  if (!hadImage) {
    styles.backgroundSize = 'cover';
    styles.backgroundPosition = 'center';
  }
  const result = rewriteLocatedOpenTag(code, element, (open) => mergeStylesIntoOpenTag(open, styles), 'background-image-not-found');
  return result.ok ? { ...result, summary } : result;
};


// --- Structure: remove / duplicate / move ----------------------------------

const PROTECTED_TAGS = new Set(['html', 'head', 'body']);
const LANDMARK_BEFORE_RE = /^<!--\s*@section:(?:(?!-->)[\s\S])*-->\s*$/;
const ONLY_GAP_RE = /^(?:\s|<!--(?:(?!-->)[\s\S])*-->)*$/;

// Start of an element's "block": its range, extended back over a directly
// preceding `<!-- @section: ... -->` landmark, so a landmark always travels
// (or disappears) with the element it labels.
const blockStart = (code, start) => {
  const at = code.lastIndexOf('<!--', start - 1);
  return at !== -1 && LANDMARK_BEFORE_RE.test(code.slice(at, start)) ? at : start;
};

// Widen [start, end) to whole lines when nothing else shares them, so a
// removal takes its indentation and line break with it.
const lineSpan = (code, start, end) => {
  const lineStart = code.lastIndexOf('\n', start - 1) + 1;
  const newline = code.indexOf('\n', end);
  const lineEnd = newline === -1 ? code.length : newline;
  const before = code.slice(lineStart, start);
  if (/^[ \t]*$/.test(before) && /^[ \t\r]*$/.test(code.slice(end, lineEnd))) {
    return { start: lineStart, end: newline === -1 ? code.length : newline + 1, indent: before, ownLine: true };
  }
  return { start, end, indent: '', ownLine: false };
};

// A duplicate must not repeat ids (anchors and scripts would silently bind
// to whichever comes first); the original keeps them.
const stripIds = (html) => {
  const masked = maskNonMarkup(html);
  let out = '';
  let last = 0;
  let m;
  ANY_OPEN_TAG_RE.lastIndex = 0;
  while ((m = ANY_OPEN_TAG_RE.exec(masked))) {
    const open = html.slice(m.index, m.index + m[0].length);
    if (readAttr(open, 'id') === null) continue;
    out += html.slice(last, m.index) + setOpenTagAttributes(open, { id: null });
    last = m.index + m[0].length;
  }
  return out + html.slice(last);
};

const describeTarget = (element) => {
  const label = ROLE_LABELS[element.role] || 'element';
  const text = String(element.text || '').trim();
  // A section's text is all of its content; its first words name it enough.
  return text ? `${label} "${truncate(text, element.role === 'container' ? 24 : 40)}"` : label;
};

const applyStructureChange = (code, element, op, dir) => {
  const tag = String(element.tag || '').toLowerCase();
  if (PROTECTED_TAGS.has(tag)) return { ok: false, reason: 'protected-element' };
  const range = locateElement(code, element);
  if (!range.ok) return range;
  const what = describeTarget(element);

  if (op === 'remove') {
    const span = lineSpan(code, blockStart(code, range.start), range.end);
    return { ok: true, code: code.slice(0, span.start) + code.slice(span.end), summary: `removed the ${what}` };
  }

  if (op === 'duplicate') {
    const copy = stripIds(code.slice(range.start, range.end));
    const span = lineSpan(code, range.start, range.end);
    const gap = span.ownLine ? `\n${span.indent}` : (/\s/.test(code[range.start - 1] || '') ? ' ' : '');
    return {
      ok: true,
      code: code.slice(0, range.end) + gap + copy + code.slice(range.end),
      summary: `duplicated the ${what}`,
    };
  }

  // move: swap blocks with the adjacent element sibling. Only whitespace and
  // comments may sit between them -- anything else means the rendered
  // sibling is not the source neighbour (JS-inserted, text node, ...).
  const sibling = dir < 0 ? element.prevSibling : element.nextSibling;
  if (!sibling) return { ok: false, reason: 'no-sibling' };
  const other = locateElement(code, sibling);
  if (!other.ok) return { ok: false, reason: other.reason === 'ambiguous' ? 'ambiguous' : 'sibling-not-found' };
  const [first, second] = dir < 0 ? [other, range] : [range, other];
  const firstStart = blockStart(code, first.start);
  const secondStart = blockStart(code, second.start);
  if (first.end > secondStart) return { ok: false, reason: 'not-adjacent' };
  const between = code.slice(first.end, secondStart);
  if (!ONLY_GAP_RE.test(between)) return { ok: false, reason: 'not-adjacent' };
  return {
    ok: true,
    code: code.slice(0, firstStart)
      + code.slice(secondStart, second.end)
      + between
      + code.slice(firstStart, first.end)
      + code.slice(second.end),
    summary: `moved the ${what} ${dir < 0 ? 'up' : 'down'}`,
  };
};

// Re-indent the continuation lines of a moved block from its old nesting
// depth to its new one. Lines that do not carry the old indent are left as
// they are rather than guessed at.
const reindent = (text, from, to) => {
  if (from === to) return text;
  return text.split('\n').map((line, i) => (i > 0 && line.startsWith(from) ? to + line.slice(from.length) : line)).join('\n');
};

// Drag-and-drop: cut the element's block (landmark included) and insert it
// directly before or after another element's block, anywhere in the page.
// Both ends must be located uniquely, or the drop fails over to the AI path.
const applyMoveTo = (code, element, target, position) => {
  const what = describeTarget(element);
  const range = locateElement(code, element);
  if (!range.ok) return range;
  if (PROTECTED_TAGS.has(String(target.tag || '').toLowerCase())) return { ok: false, reason: 'protected-element' };
  const other = locateElement(code, target);
  if (!other.ok) return { ok: false, reason: other.reason === 'ambiguous' ? 'ambiguous' : 'drop-target-not-found' };

  const dragStart = blockStart(code, range.start);
  const targetStart = blockStart(code, other.start);
  // Overlapping blocks mean one contains the other: nothing to move past.
  if (!(range.end <= targetStart || other.end <= dragStart)) return { ok: false, reason: 'invalid-drop' };
  // Already there: only whitespace/comments between the two on that side.
  const gap = position === 'after' ? [other.end, dragStart] : [range.end, targetStart];
  if (gap[0] <= gap[1] && ONLY_GAP_RE.test(code.slice(gap[0], gap[1]))) return { ok: false, reason: 'no-op' };

  const removal = lineSpan(code, dragStart, range.end);
  const block = code.slice(dragStart, range.end);
  const slot = lineSpan(code, targetStart, other.end);
  let at;
  let insert;
  if (slot.ownLine) {
    const text = removal.ownLine ? reindent(block, removal.indent, slot.indent) : block;
    if (position === 'before') {
      at = slot.start;
      insert = `${slot.indent}${text}\n`;
    } else {
      at = slot.end;
      insert = code[at - 1] === '\n' ? `${slot.indent}${text}\n` : `\n${slot.indent}${text}`;
    }
  } else if (position === 'before') {
    at = targetStart;
    insert = `${block} `;
  } else {
    at = other.end;
    insert = ` ${block}`;
  }

  // The slot never falls inside the removed span (the blocks do not
  // overlap and whole-line spans hold nothing else), so splice around it.
  const next = at <= removal.start
    ? code.slice(0, at) + insert + code.slice(at, removal.start) + code.slice(removal.end)
    : code.slice(0, removal.start) + code.slice(removal.end, at) + insert + code.slice(at);
  if (next === code) return { ok: false, reason: 'no-op' };
  return { ok: true, code: next, summary: `moved the ${what} ${position} the ${describeTarget(target)}` };
};

const STRUCTURE_KEYS = ['remove', 'duplicate', 'move', 'moveTo'];

/**
 * Apply click-to-edit changes to the source document.
 *
 * Structural changes (`remove`, `duplicate`, `move`, `moveTo`) stand alone; every
 * other key may be combined and is applied in one version.
 *
 * @param {string} code current generated HTML (never carries the preview bridge)
 * @param {object} element the bridge's element-selected payload
 * @param {{ text?: string, style?: Record<string, string>, src?: string, alt?: string, href?: string,
 *   target?: '_blank' | null, backgroundColor?: string, backgroundImage?: string,
 *   remove?: true, duplicate?: true, move?: -1 | 1,
 *   moveTo?: { target: object, position: 'before' | 'after' } }} changes
 *   (`moveTo.target` is a lite snapshot of the element dropped against)
 * @returns {{ ok: true, code: string, summary: string } | { ok: false, reason: string }}
 */
export const applyDirectEdit = (code, element, changes) => {
  if (!code || !element || !changes || typeof changes !== 'object') {
    return { ok: false, reason: 'invalid' };
  }

  const structural = STRUCTURE_KEYS.filter((k) => changes[k]);
  if (structural.length) {
    if (structural.length > 1 || Object.keys(changes).some((k) => !STRUCTURE_KEYS.includes(k) && changes[k] !== undefined)) {
      return { ok: false, reason: 'invalid' };
    }
    const op = structural[0];
    if (op === 'move' && changes.move !== -1 && changes.move !== 1) return { ok: false, reason: 'invalid' };
    let result;
    if (op === 'moveTo') {
      const { target, position } = changes.moveTo;
      if (!target || typeof target !== 'object' || (position !== 'before' && position !== 'after')) {
        return { ok: false, reason: 'invalid' };
      }
      if (PROTECTED_TAGS.has(String(element.tag || '').toLowerCase())) return { ok: false, reason: 'protected-element' };
      result = applyMoveTo(code, element, target, position);
    } else {
      result = applyStructureChange(code, element, op, changes.move);
    }
    return result.ok ? { ok: true, code: result.code, summary: `Inline edit: ${result.summary}.` } : result;
  }

  let working = code;
  const summaries = [];
  const run = (result) => {
    if (!result.ok) return result;
    working = result.code;
    if (result.summary) summaries.push(result.summary);
    return null;
  };

  // Text first: it anchors on the element's original serialized markup, which
  // attribute swaps would otherwise invalidate.
  const styleChanges = changes.style && typeof changes.style === 'object' ? changes.style : null;
  if (changes.text !== undefined || styleChanges) {
    const failure = run(applyTextChange(working, element, changes.text, styleChanges));
    if (failure) return failure;
    // A newly chosen catalog font needs its stylesheet in the page.
    if (styleChanges?.fontFamily) {
      const font = findFontByStack(styleChanges.fontFamily);
      if (font) working = insertFontLinks(working, font);
    }
  }
  const steps = [
    ['src', () => applyImageSrcChange(working, element, changes.src)],
    ['alt', () => applyAttributeChange(working, element, 'alt', changes.alt)],
    ['title', () => applyAttributeChange(working, element, 'title', changes.title)],
    ['href', () => applyAttributeChange(working, element, 'href', changes.href)],
    ['target', () => applyTargetChange(working, element, changes.target)],
    ['backgroundColor', () => applyBackgroundColorChange(working, element, changes.backgroundColor)],
    ['backgroundImage', () => applyBackgroundImageChange(working, element, changes.backgroundImage)],
  ];
  for (const [key, apply] of steps) {
    if (changes[key] === undefined) continue;
    const failure = run(apply());
    if (failure) return failure;
  }

  if (!summaries.length) return { ok: false, reason: 'no-changes' };
  return { ok: true, code: working, summary: `Inline edit: ${summaries.join(', ')}.` };
};

const FAILURE_MESSAGES = {
  ambiguous: 'This element appears more than once in the page source, so it could not be edited directly.',
  'text-too-long': 'This text is too long to edit directly.',
  'protected-element': 'The page itself (html, head, body) cannot be removed or moved.',
  'no-sibling': 'There is nothing on that side to move it past.',
  'not-adjacent': 'Its neighbour is not next to it in the page source (it may be added by a script), so it could not be moved directly.',
  'sibling-not-found': 'Its neighbour could not be found in the page source, so it could not be moved directly.',
  'drop-target-not-found': 'The spot where it was dropped could not be found in the page source (it may be added by a script), so it could not be moved directly.',
  'invalid-drop': 'An element cannot be moved inside itself.',
  'invalid-color': 'That is not a valid color. Use a hex value like #1e293b.',
  'invalid-image-url': 'That image URL cannot be used as a background (it contains quotes, brackets or line breaks).',
  'no-op': 'Nothing changed.',
  'no-changes': 'Nothing changed.',
};

/** User-facing explanation for an `applyDirectEdit` failure reason. */
export const describeDirectEditFailure = (reason) => FAILURE_MESSAGES[reason]
  || 'This element could not be found in the page source (it may be generated by a script), so it could not be edited directly.';

const ROLE_LABELS = {
  text: 'text',
  heading: 'heading',
  button: 'button',
  link: 'link',
  image: 'image',
  container: 'section',
};

const SNIPPET_MAX = 800;

// The located element's source, for the AI prompt: exact text the surgical
// edit can search for, dedented, with inline data: URIs elided. An element
// too large to quote is represented by its opening tag.
const sourceSnippet = (code, range) => {
  const lineStart = code.lastIndexOf('\n', range.start - 1) + 1;
  const lead = code.slice(lineStart, range.start);
  const indent = /^[ \t]*$/.test(lead) ? lead : '';
  const elide = (s) => s.replace(/data:[^"'()\s]{40,}/g, 'data:…');
  let text = elide(code.slice(range.start, range.end));
  if (text.length > SNIPPET_MAX) {
    text = elide(range.open) + (range.end > range.openEnd ? '\n  …' : '');
  }
  if (indent) text = text.split('\n').map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l)).join('\n');
  return truncate(text, SNIPPET_MAX);
};

const sectionNameBefore = (code, start) => {
  const re = /<!--\s*@section:\s*((?:(?!-->)[^\n])*?)\s*-->/g;
  const head = code.slice(0, start);
  let name = null;
  let m;
  while ((m = re.exec(head))) name = m[1];
  return name ? truncate(name, 60) : null;
};

/**
 * Build the chat prompt for an AI-assisted element edit: carries the
 * clicked element's context into the normal refinement flow. With
 * `context.code` (the active page's source) the element is located and its
 * exact source, `@section` landmark and page are included, which is what the
 * surgical-edit tool anchors on.
 *
 * @param {object} element the bridge's element-selected payload
 * @param {string} instruction what the user wants changed (may be empty)
 * @param {{ code?: string, page?: string, multiPage?: boolean }} context
 */
export const buildElementEditPrompt = (element, instruction = '', context = {}) => {
  if (!element) return instruction;
  const roleLabel = ROLE_LABELS[element.role] || 'element';
  const tag = element.tag || 'element';
  const parts = [`the ${roleLabel} (<${tag}>`];
  if (element.attributes?.class) parts.push(` class="${truncate(element.attributes.class.split(/\s+/).slice(0, 4).join(' '), 80)}"`);
  parts.push(')');
  if (element.text) parts.push(`that currently reads "${truncate(element.text, 120)}"`);
  if (element.attributes?.src && !element.attributes.src.startsWith('data:')) {
    parts.push(`with the image "${truncate(element.attributes.src, 100)}"`);
  }
  const where = element.parentTag && element.parentTag !== 'body' ? ` (inside the <${element.parentTag}> section)` : '';

  const page = context.multiPage && context.page ? context.page : null;
  const lead = [];
  const range = context.code ? locateElement(context.code, element) : null;
  if (range?.ok) {
    const section = sectionNameBefore(context.code, range.start);
    const place = [section ? `the "${section}" section` : null, page].filter(Boolean).join(' of ');
    lead.push(`Target element${place ? ` (in ${place})` : ''}, as it appears in the source:`, '```html', sourceSnippet(context.code, range), '```', '');
  } else if (page) {
    lead.push(`Target page: ${page}`, '');
  }

  const trimmed = String(instruction ?? '').trim();
  const ask = trimmed
    ? `Directly edit ${parts.join(' ')}${where}: ${trimmed}`
    : `Directly edit ${parts.join(' ')}${where}:`;
  return [...lead, ask].join('\n');
};
