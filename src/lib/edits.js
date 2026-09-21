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

export const applySurgicalEdits = (currentCode, edits) => {
  if (!currentCode || !edits || !Array.isArray(edits)) return { success: false, error: 'Invalid edit format' };

  let newCode = currentCode;

  for (const block of edits) {
    const { search: searchStr, replace: replaceStr, occurrence, replace_all: replaceAll } = block;
    if (!searchStr) continue;

    const exactCount = countExactOccurrences(newCode, searchStr);

    if (exactCount > 0) {
      if (replaceAll) {
        newCode = newCode.split(searchStr).join(replaceStr);
      } else if (exactCount === 1) {
        newCode = newCode.replace(searchStr, replaceStr);
      } else if (occurrence && occurrence >= 1 && occurrence <= exactCount) {
        newCode = replaceExactOccurrence(newCode, searchStr, replaceStr, occurrence);
      } else {
        return {
          success: false,
          error: `Ambiguous: search block matches ${exactCount} locations. Set "occurrence" (1-${exactCount}) or "replace_all": true.`,
          ambiguous: true,
          matchCount: exactCount
        };
      }
      continue;
    }

    // Fuzzy fallback: whitespace-normalized line-window match, same occurrence/replace_all logic.
    const codeLines = newCode.split(/\r?\n/);
    const searchLines = searchStr.split(/\r?\n/);
    const matches = findFuzzyMatches(codeLines, searchLines);

    if (matches.length === 0) {
      return {
        success: false,
        error: `Search block not found: "${searchStr.substring(0, 100)}..."`,
        failedBlock: searchStr
      };
    } else if (matches.length === 1 || replaceAll) {
      const targets = replaceAll ? matches : [matches[0]];
      // Apply from the last match backwards so earlier indices stay valid.
      let lines = codeLines;
      for (let t = targets.length - 1; t >= 0; t--) {
        const matchIndex = targets[t];
        lines = [...lines.slice(0, matchIndex), replaceStr, ...lines.slice(matchIndex + searchLines.length)];
      }
      newCode = lines.join('\n');
    } else if (occurrence && occurrence >= 1 && occurrence <= matches.length) {
      const matchIndex = matches[occurrence - 1];
      newCode = [...codeLines.slice(0, matchIndex), replaceStr, ...codeLines.slice(matchIndex + searchLines.length)].join('\n');
    } else {
      return {
        success: false,
        error: `Ambiguous: search block matches ${matches.length} locations. Set "occurrence" (1-${matches.length}) or "replace_all": true.`,
        ambiguous: true,
        matchCount: matches.length
      };
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
