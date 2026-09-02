// Minimal, dependency-free markdown parsing for chat replies. LLM answers in
// the build/ask pane routinely contain **bold**, `inline code`, ``` fences,
// # headings and - / 1. lists; the transcript used to print those verbatim.
//
// Deliberately small and forgiving: it must tolerate *streaming* input (an
// unterminated fence still renders as a code block) and must never interpret
// raw HTML — tokens stay plain strings and React escapes them on render.
//
// Block model (see parseMarkdownBlocks):
//   { type: 'code', lang, code, closed }
//   { type: 'heading', level, inline }
//   { type: 'list', ordered, items: [inline[]] }
//   { type: 'paragraph', inline }
// Inline model (see parseInlineMarkdown):
//   { type: 'text' | 'code' | 'strong' | 'em' | 'link', text, href? }

// One alternation pass keeps precedence right (`code` wins over *em*, ** over *).
// Word-char guards around _..._/_..._ avoid mangling snake_case identifiers.
const INLINE_TOKEN_RE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|((?<![\w*`])\*[^*\n]+\*(?![\w*`]))|((?<![\w_`])_[^_\n]+_(?![\w_`]))|(\[[^\]\n]+\]\([^)\s]+\))/g;

export const parseInlineMarkdown = (text) => {
  const tokens = [];
  if (!text) return tokens;
  let lastIndex = 0;
  let match;
  INLINE_TOKEN_RE.lastIndex = 0;
  while ((match = INLINE_TOKEN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }
    const raw = match[0];
    if (raw.startsWith('`')) {
      tokens.push({ type: 'code', text: raw.slice(1, -1) });
    } else if (raw.startsWith('**') || raw.startsWith('__')) {
      tokens.push({ type: 'strong', text: raw.slice(2, -2) });
    } else if (raw.startsWith('*') || raw.startsWith('_')) {
      tokens.push({ type: 'em', text: raw.slice(1, -1) });
    } else {
      const link = raw.match(/^\[([^\]\n]+)\]\(([^)\s]+)\)$/);
      if (link) {
        tokens.push({ type: 'link', text: link[1], href: link[2] });
      } else {
        tokens.push({ type: 'text', text: raw });
      }
    }
    lastIndex = match.index + raw.length;
  }
  if (lastIndex < text.length) {
    tokens.push({ type: 'text', text: text.slice(lastIndex) });
  }
  return tokens;
};

const FENCE_RE = /^\s*(```+|~~~+)\s*([\w+#.-]*)\s*$/;
const BLOCK_START_RE = /^\s*(```|~~~|[-*+]\s|\d+[.)]\s|#{1,4}\s)/;

export const parseMarkdownBlocks = (source) => {
  if (!source) return [];
  const lines = String(source).split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(FENCE_RE);
    if (fence) {
      const codeLines = [];
      i += 1;
      let closed = false;
      while (i < lines.length) {
        if (FENCE_RE.test(lines[i])) {
          closed = true;
          i += 1;
          break;
        }
        codeLines.push(lines[i]);
        i += 1;
      }
      blocks.push({ type: 'code', lang: fence[2] || '', code: codeLines.join('\n'), closed });
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, inline: parseInlineMarkdown(heading[2].trim()) });
      i += 1;
      continue;
    }

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || ordered) {
      const isOrdered = Boolean(ordered);
      const itemRe = isOrdered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(itemRe);
        if (!m) break;
        items.push(parseInlineMarkdown(m[1]));
        i += 1;
      }
      blocks.push({ type: 'list', ordered: isOrdered, items });
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const paraLines = [];
    while (i < lines.length && lines[i].trim() && !BLOCK_START_RE.test(lines[i])) {
      paraLines.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: 'paragraph', inline: parseInlineMarkdown(paraLines.join('\n')) });
  }

  return blocks;
};
