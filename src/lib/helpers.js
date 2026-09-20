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

// Some backends emit chain-of-thought/preamble text through the regular content
// delta instead of (or in addition to) reasoning_content. Until this pattern shows
// up in the accumulated stream, sanitizeHtmlResponse has no real boundary to anchor
// on and falls back to returning the raw text -- which would flash that preamble
// into the live code panel. Gate the panel update on this instead.
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

// Handles both the legacy Firebase-style Date object and plain ISO strings that
// come back from Supabase's `updated_at`.
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

export const isValidUuid = (value) =>
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value || '');

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

// Pulls the code being written out of partially streamed apply_surgical_edits
// arguments: the (possibly still unterminated) "replace" string of every edit,
// joined in order. Search strings are skipped -- they're the old code.
export const extractStreamedEditCode = (argsJson) => {
  const parts = [];
  const re = /"replace"\s*:\s*"((?:[^"\\]|\\.)*)("|$)/g;
  let m;
  while ((m = re.exec(argsJson)) !== null) {
    parts.push(unescapeJsonFragment(m[1]));
    if (!m[2]) break;
  }
  return parts.join('\n');
};
