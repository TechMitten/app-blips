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

const applyTextChange = (code, element, nextTextRaw) => {
  const prevText = (element.text || '').trim();
  const nextText = String(nextTextRaw ?? '').trim();
  if (!prevText) return { ok: false, reason: 'element-has-no-text' };
  if (element.textTruncated) return { ok: false, reason: 'text-too-long' };
  if (prevText === nextText) return { ok: false, reason: 'no-op' };
  const escapedNext = escapeHtmlText(nextText);

  // Preferred path: locate the element's own serialized markup and swap the
  // text inside it. Matching the whole element (not just the string) proves
  // we're editing the right occurrence.
  const outer = element.outerHTML;
  if (outer && !element.outerHTMLTruncated) {
    const nextOuter = swapTextInFragment(outer, prevText, escapedNext);
    if (nextOuter) {
      const result = replaceUnique(code, outer, nextOuter);
      if (result.ok) {
        return { ...result, summary: `changed text to "${truncate(nextText, 60)}"` };
      }
      // An ambiguous/not-found outer fragment still allows the text-only
      // path below, which can be more precise for short strings.
    }
  }

  // Fallback: the text string itself is unique in the document.
  for (const candidate of textCandidates(prevText)) {
    if (countExactOccurrences(code, candidate) === 1) {
      return {
        ok: true,
        code: code.replace(candidate, escapedNext),
        summary: `changed text to "${truncate(nextText, 60)}"`,
      };
    }
  }
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
 * @param {{ text?: string, src?: string, alt?: string, href?: string, backgroundColor?: string, backgroundImage?: string }} changes
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
  if (changes.text !== undefined) {
    const failure = run(applyTextChange(working, element, changes.text));
    if (failure) return failure;
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
