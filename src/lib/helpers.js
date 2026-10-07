import { PREVIEW_MODES } from './constants';
export const syntaxHighlightHtml = (code) => {
  if (!code) return "";

  const escape = (str) => {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  let escaped = escape(code);

  // 1. Comments
  escaped = escaped.replace(/&lt;!--([\s\S]*?)--&gt;/g, '<span class="token-comment">&lt;!--$1--&gt;</span>');
  // 2. Doctype
  escaped = escaped.replace(/(&lt;!DOCTYPE[\s\S]*?&gt;)/gi, '<span class="token-doctype">$1</span>');
  // 3. Tags and Attributes
  escaped = escaped.replace(/(&lt;\/?)([\w-:]+)([\s\S]*?)(&gt;)/g, (match, prefix, tagName, attrs, suffix) => {
    const highlightedTag = `${prefix}<span class="token-tag-name">${tagName}</span>`;
    const highlightedAttrs = attrs.replace(/\s+([\w-:]+)(?:=(&quot;[\s\S]*?&quot;|&#039;[\s\S]*?&#039;|[\w:-]+))?/g, (m, attrName, attrValue) => {
      let res = ` <span class="token-attr-name">${attrName}</span>`;
      if (attrValue) res += `=<span class="token-string">${attrValue}</span>`;
      return res;
    });
    return highlightedTag + highlightedAttrs + suffix;
  });

  // Split into lines for numbering
  const lines = escaped.split('\n');
  const numberedLines = lines.map((line, i) => {
    return `<div class="code-line"><span class="line-number">${i + 1}</span><span class="line-content">${line || ' '}</span></div>`;
  }).join('');

  return numberedLines;
};

export const getEffectivePreviewBox = (mode, orientation) => {
  const preset = PREVIEW_MODES[mode];
  if (preset.isTouchChrome && orientation === 'landscape') {
    return {
      width: preset.height,
      height: preset.width,
      zoomPadding: { h: preset.zoomPadding.v, v: preset.zoomPadding.h }
    };
  }
  return { width: preset.width, height: preset.height, zoomPadding: preset.zoomPadding };
};

// Handles both Date objects and the plain ISO strings stored as `updated_at`.
export const formatModifiedTime = (value) => {
  if (!value) return 'Just now';
  if (typeof value === 'string') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? 'Just now' : d.toLocaleString();
  }
  if (typeof value?.toDate === 'function') {
    const d = value.toDate();
    return isNaN(d.getTime()) ? 'Just now' : d.toLocaleString();
  }
  return 'Just now';
};

// `Daybook - Mood & Habit Journal` -> `daybook-mood-habit-journal`. Used for
// export file names.
export const slugifyName = (name) =>
  (name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/([a-z0-9])\1{2,}/g, '$1')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');

// Last `count` lines of a code stream, for the build overlay's live peek. Lines
// are never clipped here (CSS clips them) so a growing line extends in place
// instead of sliding left with every character.
export const tailLines = (code, count = 9) => {
  if (!code) return '';
  return code.split('\n').slice(-count).map((line) => line.replace(/\s+$/, '').slice(0, 240)).join('\n');
};

// Decodes a JSON string body, tolerating a cut-off escape at the end.
const unescapeJsonFragment = (fragment) =>
  fragment
    .replace(/\\u[0-9a-fA-F]{0,3}$/, '')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\(["\\/nrt])/g, (_, c) => ({ n: '\n', r: '', t: '  ' }[c] ?? c))
    .replace(/\\$/, '');

// Pulls the code being written out of partially streamed tool arguments: the
// (possibly still unterminated) "replace" string of every apply_surgical_edits
// edit, or the "html" string of create_page, joined in order. Search strings
// are skipped -- they're the old code.
export const extractStreamedEditCode = (argsJson) => {
  const parts = [];
  const re = /"(?:replace|html)"\s*:\s*"((?:[^"\\]|\\.)*)("|$)/g;
  let m;
  while ((m = re.exec(argsJson)) !== null) {
    parts.push(unescapeJsonFragment(m[1]));
    if (!m[2]) break;
  }
  return parts.join('\n');
};
