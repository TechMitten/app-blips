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

// Every `<tag ...>...</tag>` element in the source whose visible text equals
// `wantedText`, in document order. Unlike outerHTML matching this does not
// depend on the opening tag's attributes, which the live DOM may have
// diverged from (JS-added inline styles/classes from scroll animations,
// etc.) or on how entities were written in the source.
const findElementsByText = (code, tag, wantedText) => {
  if (!/^[a-z][a-z0-9-]*$/i.test(tag)) return [];
  const wanted = comparableText(wantedText);
  if (!wanted) return [];
  const openRe = new RegExp(`<${tag}(?=[\\s>/])[^>]*>`, 'gi');
  const results = [];
  let open;
  while ((open = openRe.exec(code))) {
    if (open[0].endsWith('/>')) continue;
    const innerStart = open.index + open[0].length;
    const tagRe = new RegExp(`<(/?)${tag}(?=[\\s>/])[^>]*>`, 'gi');
    tagRe.lastIndex = innerStart;
    let depth = 1;
    let innerEnd = -1;
    let t;
    while ((t = tagRe.exec(code))) {
      if (t[1]) {
        depth -= 1;
        if (depth === 0) { innerEnd = t.index; break; }
      } else if (!t[0].endsWith('/>')) {
        depth += 1;
      }
    }
    if (innerEnd === -1) continue;
    const inner = code.slice(innerStart, innerEnd);
    if (comparableText(inner) === wanted) {
      results.push({ open: open[0], innerStart, innerEnd, inner });
    }
  }
  return results;
};

const classTokens = (openTag) => {
  const m = /\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(openTag);
  return m ? (m[1] ?? m[2]).split(/\s+/).filter(Boolean) : null;
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
    const clean = cleanStyleValue(value);
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

// Attribute swaps (src / href / alt). Searches the exact serialized
// `attr="value"` pair so the match is anchored to the attribute, not the
// bare URL (which could appear in link text or elsewhere).
const applyAttributeChange = (code, element, attrName, nextValueRaw) => {
  const prevValue = element.attributes?.[attrName];
  const nextValue = String(nextValueRaw ?? '').trim();
  if (!prevValue) return { ok: false, reason: `element-has-no-${attrName}` };
  if (prevValue === nextValue) return { ok: false, reason: 'no-op' };

  for (const quote of ['"', "'"]) {
    const search = `${attrName}=${quote}${prevValue}${quote}`;
    const replace = `${attrName}=${quote}${escapeAttrValue(nextValue)}${quote}`;
    const result = replaceUnique(code, search, replace);
    if (result.ok) {
      const summary = attrName === 'href'
        ? `updated link to "${truncate(nextValue, 60)}"`
        : attrName === 'alt'
          ? 'updated alt text'
          : `updated ${attrName}`;
      return { ...result, summary };
    }
  }
  return { ok: false, reason: `${attrName}-not-found` };
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

// Tailwind bg-* utilities that style a background IMAGE/position/repeat
// rather than a color -- these must not be treated as the element's
// background color token.
const NON_COLOR_BG_TOKEN = /^bg-(?:cover|contain|center|top|bottom|left|right|top-left|top-right|bottom-left|bottom-right|no-repeat|repeat|repeat-x|repeat-y|round|space|fixed|local|scroll|clip-(?:text|border|padding|content)|origin-(?:border|padding|content)|none|gradient(?:-[a-z]+)?)(?:\/[a-z0-9.]+)?$/;

const applyBackgroundColorChange = (code, element, nextColorRaw) => {
  const nextColor = String(nextColorRaw ?? '').trim();
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(nextColor)) {
    return { ok: false, reason: 'invalid-color' };
  }

  // Tailwind class token: `bg-slate-900`, `bg-[#0f172a]`, ... Swap the token
  // inside the exact serialized class attribute.
  const cls = element.attributes?.class;
  if (cls) {
    const tokens = cls.split(/\s+/).filter(Boolean);
    const colorTokens = tokens.filter((t) => t.startsWith('bg-') && !t.startsWith('bg-gradient') && !NON_COLOR_BG_TOKEN.test(t));
    if (colorTokens.length === 1) {
      const nextCls = tokens.map((t) => (t === colorTokens[0] ? `bg-[${nextColor}]` : t)).join(' ');
      for (const quote of ['"', "'"]) {
        const result = replaceUnique(code, `class=${quote}${cls}${quote}`, `class=${quote}${nextCls}${quote}`);
        if (result.ok) return { ...result, summary: `set background to ${nextColor}` };
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
        if (result.ok) return { ...result, summary: `set background to ${nextColor}` };
      }
    }
  }

  return { ok: false, reason: 'background-not-found' };
};

// Background image swaps only support inline `style="...url(...)..."` in v1;
// Tailwind arbitrary url() tokens and <style> rules are left to the AI path.
const applyBackgroundImageChange = (code, element, nextImageRaw) => {
  const nextImage = String(nextImageRaw ?? '').trim();
  if (!nextImage) return { ok: false, reason: 'no-op' };
  const style = element.attributes?.style;
  if (!style || !/url\(/i.test(style)) return { ok: false, reason: 'background-image-not-inline' };

  const nextStyle = style.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/i, () => `url("${escapeAttrValue(nextImage)}")`);
  if (nextStyle === style) return { ok: false, reason: 'background-image-not-found' };

  for (const quote of ['"', "'"]) {
    const result = replaceUnique(code, `style=${quote}${style}${quote}`, `style=${quote}${nextStyle}${quote}`);
    if (result.ok) return { ...result, summary: 'replaced background image' };
  }
  return { ok: false, reason: 'background-image-not-found' };
};

/**
 * Apply click-to-edit changes to the source document.
 *
 * @param {string} code current generated HTML (never carries the preview bridge)
 * @param {object} element the bridge's element-selected payload
 * @param {{ text?: string, style?: Record<string, string>, src?: string, alt?: string, href?: string, backgroundColor?: string, backgroundImage?: string }} changes
 * @returns {{ ok: true, code: string, summary: string } | { ok: false, reason: string }}
 */
export const applyDirectEdit = (code, element, changes) => {
  if (!code || !element || !changes || typeof changes !== 'object') {
    return { ok: false, reason: 'invalid' };
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
  if (changes.src !== undefined) {
    const failure = run(applyImageSrcChange(working, element, changes.src));
    if (failure) return failure;
  }
  if (changes.alt !== undefined) {
    const failure = run(applyAttributeChange(working, element, 'alt', changes.alt));
    if (failure) return failure;
  }
  if (changes.href !== undefined) {
    const failure = run(applyAttributeChange(working, element, 'href', changes.href));
    if (failure) return failure;
  }
  if (changes.backgroundColor !== undefined) {
    const failure = run(applyBackgroundColorChange(working, element, changes.backgroundColor));
    if (failure) return failure;
  }
  if (changes.backgroundImage !== undefined) {
    const failure = run(applyBackgroundImageChange(working, element, changes.backgroundImage));
    if (failure) return failure;
  }

  if (!summaries.length) return { ok: false, reason: 'no-changes' };
  return { ok: true, code: working, summary: `Inline edit: ${summaries.join(', ')}.` };
};

const ROLE_LABELS = {
  text: 'text',
  heading: 'heading',
  button: 'button',
  link: 'link',
  image: 'image',
  container: 'section',
};

/**
 * Build the chat prompt used when a direct edit cannot be applied: carries
 * the clicked element's context into the normal (AI) refinement flow.
 */
export const buildElementEditPrompt = (element, instruction = '') => {
  if (!element) return instruction;
  const roleLabel = ROLE_LABELS[element.role] || 'element';
  const tag = element.tag || 'element';
  const parts = [`the ${roleLabel} (<${tag}>`];
  if (element.attributes?.class) parts.push(` class="${truncate(element.attributes.class.split(/\s+/).slice(0, 4).join(' '), 80)}"`);
  parts.push(')');
  if (element.text) parts.push(`that currently reads "${truncate(element.text, 120)}"`);
  if (element.attributes?.src) parts.push(`with the image "${truncate(element.attributes.src, 100)}"`);
  const where = element.parentTag && element.parentTag !== 'body' ? ` (inside the <${element.parentTag}> section)` : '';

  const trimmed = String(instruction ?? '').trim();
  return trimmed
    ? `Directly edit ${parts.join(' ')}${where}: ${trimmed}`
    : `Directly edit ${parts.join(' ')}${where}:`;
};
