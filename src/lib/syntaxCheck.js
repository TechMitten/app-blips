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
      startIdx: contentStart,
      endIdx: closeIdx,
      type,
      unclosed: false
    });
    openTagRe.lastIndex = html.indexOf('>', closeIdx) + 1;
  }
  return blocks;
};

const HTML_TAGS = new Set([
  'A', 'ABBR', 'ADDRESS', 'AREA', 'ARTICLE', 'ASIDE', 'AUDIO', 'B', 'BASE', 'BDI', 'BDO',
  'BLOCKQUOTE', 'BODY', 'BR', 'BUTTON', 'CANVAS', 'CAPTION', 'CITE', 'CODE', 'COL', 'COLGROUP',
  'DATA', 'DATALIST', 'DD', 'DEL', 'DETAILS', 'DFN', 'DIALOG', 'DIV', 'DL', 'DT', 'EM', 'EMBED',
  'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HEAD', 'HEADER', 'HGROUP', 'HR', 'HTML', 'I', 'IFRAME', 'IMG', 'INPUT', 'INS', 'KBD',
  'LABEL', 'LEGEND', 'LI', 'LINK', 'MAIN', 'MAP', 'MARK', 'MENU', 'META', 'METER', 'NAV',
  'NOSCRIPT', 'OBJECT', 'OL', 'OPTGROUP', 'OPTION', 'OUTPUT', 'P', 'PICTURE', 'PRE', 'PROGRESS',
  'Q', 'RP', 'RT', 'RUBY', 'S', 'SAMP', 'SCRIPT', 'SEARCH', 'SECTION', 'SELECT', 'SLOT',
  'SMALL', 'SOURCE', 'SPAN', 'STRONG', 'STYLE', 'SUB', 'SUMMARY', 'SUP', 'SVG', 'TABLE',
  'TBODY', 'TD', 'TEMPLATE', 'TEXTAREA', 'TFOOT', 'TH', 'THEAD', 'TIME', 'TITLE', 'TR',
  'TRACK', 'U', 'UL', 'VAR', 'VIDEO', 'WBR', 'PATH', 'RECT', 'CIRCLE', 'G'
]);

const walk = (node, visitor) => {
  if (!node || typeof node !== 'object') return;
  visitor(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) walk(c, visitor);
    } else if (child && typeof child === 'object') {
      walk(child, visitor);
    }
  }
};

const findBareHtmComponents = (ast, baseStartLine, errors) => {
  walk(ast, (node) => {
    if (
      node.type === 'TaggedTemplateExpression' &&
      node.tag &&
      node.tag.type === 'Identifier' &&
      node.tag.name === 'html'
    ) {
      for (const quasi of node.quasi.quasis) {
        const text = quasi.value.raw;
        const compRe = /<\s*([A-Z][a-zA-Z0-9]*)\b/g;
        let match;
        while ((match = compRe.exec(text)) !== null) {
          const name = match[1];
          if (name === name.toUpperCase() && HTML_TAGS.has(name)) continue;
          const linesBefore = text.slice(0, match.index).split('\n').length - 1;
          const line = (quasi.loc ? quasi.loc.start.line : 1) + linesBefore + baseStartLine - 1;
          errors.push({
            line,
            message: `Uninterpolated Preact component <${name} /> in htm template: in htm/preact, components must be written as <\${${name}} />, not <${name} /> (bare tags are parsed as inert HTML custom elements and will not render).`
          });
        }
      }
    }
  });
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
      const ast = acorn.parse(block.code, {
        ecmaVersion: 'latest',
        sourceType: block.type === 'module' ? 'module' : 'script',
        locations: true
      });
      findBareHtmComponents(ast, block.startLine, errors);
    } catch (err) {
      let message = err.message.replace(/ \(\d+:\d+\)$/, '');
      if (err.loc) {
        const lines = block.code.split(/\r?\n/);
        const errLine = lines[err.loc.line - 1] || '';
        const snippet = errLine.slice(err.loc.column);
        if (/^<\s*\/?[a-zA-Z]/.test(snippet) || /^<>/ .test(snippet)) {
          message += ' — JSX syntax is not supported in browser ES modules. Use Preact with htm tagged templates instead (e.g. html`<div class="...">...</div>` and `<${Component} />`).';
        }
      }
      errors.push({
        line: err.loc ? block.startLine + err.loc.line - 1 : block.startLine,
        message
      });
    }
  }

  errors.sort((a, b) => a.line - b.line);
  return { errors };
};

export const formatSyntaxErrors = (errors) =>
  (errors || []).map((e) => `- Line ${e.line}: ${e.message}`).join('\n');
