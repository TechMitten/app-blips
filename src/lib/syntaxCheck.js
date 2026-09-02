import * as acorn from 'acorn';

// Inline script types whose content is parseable JavaScript. An absent type
// attribute means classic JS; anything else (importmap, application/json,
// text/template, ...) is skipped.
const JS_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'ecmascript/javascript', 'module']);

const countNewlines = (str) => {
  let count = 0;
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) === 10) count++;
  }
  return count;
};

const getAttribute = (attrs, name) => {
  const match = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  if (!match) return null;
  return (match[1] ?? match[2] ?? match[3] ?? '').trim().toLowerCase();
};

// Extract parseable inline script blocks with their document-relative start
// line. An inline <script> ends at the FIRST </script> after its open tag --
// even if that text sits inside a JS string literal -- because that is exactly
// how a real browser delimits it.
export const extractInlineScripts = (html) => {
  const blocks = [];
  const openTagRe = /<script\b([^>]*)>/gi;
  let open;
  while ((open = openTagRe.exec(html)) !== null) {
    const attrs = open[1];
    if (getAttribute(attrs, 'src') !== null) continue;
    const type = getAttribute(attrs, 'type');
    if (type !== null && !JS_TYPES.has(type)) continue;

    const contentStart = openTagRe.lastIndex;
    const startLine = countNewlines(html.slice(0, contentStart)) + 1;
    const closeIdx = html.toLowerCase().indexOf('</script', contentStart);
    if (closeIdx === -1) {
      blocks.push({ code: null, startLine, type: null, unclosed: true });
      break;
    }
    blocks.push({
      code: html.slice(contentStart, closeIdx),
      startLine,
      type,
      unclosed: false
    });
    openTagRe.lastIndex = html.indexOf('>', closeIdx) + 1;
  }
  return blocks;
};

// Static, parse-only syntax check of a generated HTML document. Never executes
// any code. Browsers never hard-fail on malformed HTML (error recovery), so
// only JavaScript parse errors -- where generated apps actually break -- are
// reported. Returns { errors: [{ line, message }] } sorted by line.
export const checkSyntax = (html) => {
  const errors = [];
  if (!html || typeof html !== 'string') return { errors };

  for (const block of extractInlineScripts(html)) {
    if (block.unclosed) {
      errors.push({
        line: block.startLine,
        message: 'Unclosed <script> tag: the browser treats everything after this point as script source.'
      });
      continue;
    }
    try {
      acorn.parse(block.code, {
        ecmaVersion: 'latest',
        sourceType: block.type === 'module' ? 'module' : 'script'
      });
    } catch (err) {
      errors.push({
        line: err.loc ? block.startLine + err.loc.line - 1 : block.startLine,
        message: err.message.replace(/ \(\d+:\d+\)$/, '')
      });
    }
  }

  errors.sort((a, b) => a.line - b.line);
  return { errors };
};

export const formatSyntaxErrors = (errors) =>
  (errors || []).map((e) => `- Line ${e.line}: ${e.message}`).join('\n');
