// Tool-call arguments that don't parse are almost always a call cut off by the
// provider's output limit, so the error says how to get under it.
export const invalidArgumentsError = (err) => `Arguments were not valid JSON (${err.message}). The call was probably cut off by the output limit: split the change into several smaller tool calls.`;

export const sanitizeHtmlResponse = (text) => {
  // Fallback: if the model mistakenly wrapped the HTML in a JSON object (with or without markdown)
  try {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const parsed = JSON.parse(text.substring(firstBrace, lastBrace + 1));
      if (typeof parsed.html === 'string' && (parsed.html.includes('<!DOCTYPE') || parsed.html.includes('<html'))) return parsed.html.trim();
      if (typeof parsed.text === 'string' && (parsed.text.includes('<!DOCTYPE') || parsed.text.includes('<html'))) return parsed.text.trim();
    }
  } catch { /* ignore JSON parse error */ }

  // Streaming JSON fallback: if the model is streaming a JSON object containing the HTML
  const firstBraceIndex = text.indexOf('{');
  if (firstBraceIndex !== -1 && firstBraceIndex < 100) {
    const jsonStr = text.slice(firstBraceIndex);
    const streamingJsonMatch = jsonStr.match(/^\{\s*"(?:html|text)"\s*:\s*"((?:[^"\\]|\\.)*)("|$)/i);
    if (streamingJsonMatch && (streamingJsonMatch[1].includes('<!DOCTYPE') || streamingJsonMatch[1].includes('<html'))) {
      const unescapeJsonFragment = (fragment) =>
        fragment
          .replace(/\\u[0-9a-fA-F]{0,3}$/, '')
          .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
          .replace(/\\(["\\/nrt])/g, (_, c) => ({ n: '\n', r: '', t: '  ' }[c] ?? c))
          .replace(/\\$/, '');
      return unescapeJsonFragment(streamingJsonMatch[1]).trim();
    }
  }

  const htmlBlockMatch = text.match(/```html\s*([\s\S]*?)\s*```/i);
  if (htmlBlockMatch) return htmlBlockMatch[1].trim();

  const codeBlockMatch = text.match(/```(?:[a-z0-9-]+)?\s*\n([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    let content = codeBlockMatch[1].trim();
    if (content.startsWith('!json\n')) content = content.replace(/^!json\n/, '').trim();
    if (content.startsWith('json\n')) content = content.replace(/^json\n/, '').trim();
    return content;
  }

  const htmlStartMatch = text.match(/(<!DOCTYPE html[\s\S]*)/i) || text.match(/(<html[\s\S]*)/i);
  if (htmlStartMatch) {
    const content = htmlStartMatch[0];
    const endTagMatch = content.match(/<\/html>/i);
    if (endTagMatch) {
      const lastIndex = content.toLowerCase().lastIndexOf('</html>');
      return content.substring(0, lastIndex + 7).trim();
    }
    return content.replace(/\n?```$/, '').trim();
  }

  // No code fence, DOCTYPE, or <html> tag anywhere -- the model didn't return
  // any code at all (e.g. a truncated turn that only produced a reply
  // sentence). Callers must treat this as a failed generation, not code.
  return null;
};

// Complementary to sanitizeHtmlResponse: returns the text BEFORE the HTML boundary
// (an optional short conversational reply) instead of the HTML itself.
export const extractLeadingReply = (text) => {
  // Fallback: if the model mistakenly wrapped the HTML in a JSON object, the
  // JSON object itself is the code container, so everything before it is the reply.
  try {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const parsed = JSON.parse(text.substring(firstBrace, lastBrace + 1));
      if (
        (typeof parsed.html === 'string' && (parsed.html.includes('<!DOCTYPE') || parsed.html.includes('<html'))) ||
        (typeof parsed.text === 'string' && (parsed.text.includes('<!DOCTYPE') || parsed.text.includes('<html')))
      ) {
        return text.slice(0, firstBrace).trim();
      }
    }
  } catch { /* ignore JSON parse error */ }

  const firstBraceIndex = text.indexOf('{');
  if (firstBraceIndex !== -1 && firstBraceIndex < 100) {
    const jsonStr = text.slice(firstBraceIndex);
    const streamingJsonMatch = jsonStr.match(/^\{\s*"(?:html|text)"\s*:\s*"(?:[^"\\]|\\.)*(?:"|$)/i);
    if (streamingJsonMatch && (streamingJsonMatch[0].includes('<!DOCTYPE') || streamingJsonMatch[0].includes('<html'))) {
      return text.slice(0, firstBraceIndex).trim();
    }
  }

  const htmlBlockMatch = text.match(/```html\s*[\s\S]*?\s*```/i);
  if (htmlBlockMatch) return text.slice(0, htmlBlockMatch.index).trim();

  const codeBlockMatch = text.match(/```(?:[a-z0-9-]+)?\s*\n[\s\S]*?\s*```/i);
  if (codeBlockMatch) return text.slice(0, codeBlockMatch.index).trim();

  const htmlStartMatch = text.match(/<!DOCTYPE html[\s\S]*/i) || text.match(/<html[\s\S]*/i);
  if (htmlStartMatch) return text.slice(0, htmlStartMatch.index).trim();

  return '';
};

export const normalizeLine = (line) => line.trim().replace(/\s+/g, ' ');

// Every line-window in codeLines that matches searchLines under whitespace-normalized comparison.
export const findFuzzyMatches = (codeLines, searchLines) => {
  const normalizedSearchLines = searchLines.map(normalizeLine);
  const matches = [];
  for (let i = 0; i <= codeLines.length - searchLines.length; i++) {
    let isMatch = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (normalizeLine(codeLines[i + j]) !== normalizedSearchLines[j]) {
        isMatch = false;
        break;
      }
    }
    if (isMatch) matches.push(i);
  }
  return matches;
};

export const countExactOccurrences = (haystack, needle) => {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
};

export const replaceExactOccurrence = (haystack, needle, replacement, occurrence) => {
  let idx = -1;
  let from = 0;
  for (let n = 0; n < occurrence; n++) {
    idx = haystack.indexOf(needle, from);
    from = idx + needle.length;
  }
  return haystack.slice(0, idx) + replacement + haystack.slice(idx + needle.length);
};

// Match offsets let us replace literal text and preserve bytes outside the
// selected range, including CRLF line endings. Imported source uses the
// conservative mode: only line endings and indentation may differ, never
// whitespace inside JSX copy, strings, or expressions.
const exactRanges = (code, search, normalizeNewlines) => {
  const ranges = [];
  if (normalizeNewlines) {
    const pattern = search.replace(/\r\n/g, '\n').split('\n')
      .map((line) => line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\r?\n');
    for (const match of code.matchAll(new RegExp(pattern, 'g'))) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  } else {
    let start = 0;
    while ((start = code.indexOf(search, start)) !== -1) {
      ranges.push({ start, end: start + search.length });
      start += search.length;
    }
  }
  return ranges;
};

export const applySurgicalEdits = (currentCode, edits, { conservative = false } = {}) => {
  if (typeof currentCode !== 'string' || !Array.isArray(edits) || !edits.length) {
    return { success: false, error: 'Provide a non-empty array of search/replace edits.' };
  }

  let newCode = currentCode;
  for (const [index, block] of edits.entries()) {
    const failure = (error, details = {}) => ({ success: false, error, failedEdit: index + 1, ...details });
    if (!block || typeof block.search !== 'string' || !block.search.length || typeof block.replace !== 'string') {
      return failure('Each edit needs a non-empty search string and a replacement string (use "" to delete text).');
    }
    const { search, replace, occurrence, replace_all: replaceAll } = block;
    if (occurrence != null && (!Number.isInteger(occurrence) || occurrence < 1)) {
      return failure('occurrence must be a positive, 1-based integer or null.');
    }
    if (replaceAll != null && typeof replaceAll !== 'boolean') {
      return failure('replace_all must be a boolean or null.');
    }
    if (replaceAll && occurrence != null) return failure('Use either occurrence or replace_all, not both.');

    let matches = exactRanges(newCode, search, conservative);
    if (!matches.length) {
      const codeLines = newCode.split(/\r?\n/);
      const searchLines = search.split(/\r?\n/);
      const offsets = [];
      let offset = 0;
      for (const line of newCode.split(/(?<=\n)/)) {
        offsets.push(offset);
        offset += line.length;
      }
      if (offsets.length < codeLines.length) offsets.push(newCode.length);
      const starts = conservative
        ? codeLines.flatMap((_, i) => i + searchLines.length <= codeLines.length
          && searchLines.every((line, j) => line.trim() === codeLines[i + j].trim()) ? [i] : [])
        : findFuzzyMatches(codeLines, searchLines);
      matches = starts.map((i) => ({ start: offsets[i], end: offsets[i + searchLines.length - 1] + codeLines[i + searchLines.length - 1].length }));
    }

    if (!matches.length) return failure(`Search block not found: "${search.substring(0, 100)}..."`, { failedBlock: search });
    const matchLines = matches.slice(0, 20).map((m) => newCode.slice(0, m.start).split('\n').length);
    if (occurrence != null && occurrence > matches.length) {
      return failure(`occurrence ${occurrence} is out of range; search matches ${matches.length} locations.`, { matchCount: matches.length, matchLines });
    }
    if (matches.length > 1 && occurrence == null && !replaceAll) {
      return failure(`Ambiguous: search block matches ${matches.length} locations. Set "occurrence" (1-${matches.length}) or "replace_all": true.`, {
        ambiguous: true, matchCount: matches.length, matchLines,
      });
    }
    const targets = replaceAll ? matches : [matches[(occurrence || 1) - 1]];
    if (targets.some((m, i) => i && m.start < targets[i - 1].end)) {
      return failure('Search blocks overlap. Use a smaller, unique search block.');
    }
    const replacement = conservative
      ? replace.replace(/\r?\n/g, newCode.includes('\r\n') ? '\r\n' : '\n')
      : replace;
    // String.replace treats $&, $`, $' and $$ specially. Slicing keeps model
    // output literal, which matters for regexes, templates and currency copy.
    for (const match of targets.slice().reverse()) {
      newCode = newCode.slice(0, match.start) + replacement + newCode.slice(match.end);
    }
  }
  return { success: true, code: newCode };
};

// Landmark comments come in two forms because they have to survive in two
// different syntaxes. `<!-- @section: x -->` is the HTML form; `// @section: x`
// is the JavaScript form, required inside <script type="module"> blocks where
// HTML-like comments are a hard syntax error (they are only tolerated in
// classic scripts as a legacy quirk). The JS form is anchored to the start of
// the line so a `@section:` appearing mid-expression or inside a URL cannot be
// mistaken for a landmark.
export const SECTION_LANDMARK_RE =
  /<!--\s*@section:\s*([^\s][^\n]*?)\s*-->|^\s*\/\/\s*@section:\s*([^\s][^\n]*?)\s*$/;

export const listSections = (code) => {
  const lines = code.split(/\r?\n/);
  const marks = [];
  lines.forEach((line, i) => {
    const m = line.match(SECTION_LANDMARK_RE);
    if (m) marks.push({ name: (m[1] ?? m[2]).trim(), line: i + 1 });
  });
  return marks.map((m, i) => ({
    name: m.name,
    startLine: m.line,
    endLine: i + 1 < marks.length ? marks[i + 1].line - 1 : lines.length
  }));
};

export const VIEW_CODE_MAX_LINES = 400;

export const viewCode = (code, { section, start_line: startLine, end_line: endLine } = {}) => {
  const lines = code.split(/\r?\n/);
  let from, to;

  if (section) {
    const found = listSections(code).find((s) => s.name === section);
    if (!found) return { success: false, error: `No @section named "${section}" found. Call list_sections to see actual names.` };
    from = found.startLine;
    to = found.endLine;
  } else {
    from = Math.max(1, startLine || 1);
    to = Math.min(lines.length, endLine || from + 199);
  }

  if (to - from > VIEW_CODE_MAX_LINES) to = from + VIEW_CODE_MAX_LINES;

  const slice = lines.slice(from - 1, to).map((l, i) => `${from + i}: ${l}`).join('\n');
  return { success: true, code: slice, startLine: from, endLine: to };
};
