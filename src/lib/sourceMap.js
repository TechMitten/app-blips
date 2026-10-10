// Minimal source map reader: maps a line/column of a generated file back to
// its source, so a runtime error in the imported-codebase preview bundle can
// be reported as "src/pages/Home.tsx:12" (what the model and user can act on).
const VLQ_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const VLQ_INDEX = new Map([...VLQ_CHARS].map((c, i) => [c, i]));

function decodeSegment(segment) {
  const values = [];
  let value = 0;
  let shift = 0;
  for (const char of segment) {
    const digit = VLQ_INDEX.get(char);
    if (digit === undefined) return null;
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
    } else {
      values.push(value & 1 ? -(value >>> 1) : value >>> 1);
      value = 0;
      shift = 0;
    }
  }
  return values;
}

// Decoded once per map: lines[i] = [[genCol, sourceIndex, srcLine, srcCol], ...]
const decodedCache = new WeakMap();

function decode(map) {
  if (decodedCache.has(map)) return decodedCache.get(map);
  const lines = [];
  let sourceIndex = 0;
  let srcLine = 0;
  let srcCol = 0;
  for (const line of String(map.mappings || '').split(';')) {
    let genCol = 0;
    const segments = [];
    for (const raw of line.split(',')) {
      if (!raw) continue;
      const values = decodeSegment(raw);
      if (!values) continue;
      genCol += values[0];
      if (values.length >= 4) {
        sourceIndex += values[1];
        srcLine += values[2];
        srcCol += values[3];
        segments.push([genCol, sourceIndex, srcLine, srcCol]);
      }
    }
    lines.push(segments);
  }
  decodedCache.set(map, lines);
  return lines;
}

// line is 1-based, column 1-based (or 0/undefined for "start of line").
// Returns { source, line, column } (1-based) or null.
export function originalPosition(map, line, column = 0) {
  if (!map || !line) return null;
  const segments = decode(map)[line - 1];
  if (!segments?.length) return null;
  const col = Math.max(0, (column || 1) - 1);
  let best = segments[0];
  for (const segment of segments) {
    if (segment[0] <= col) best = segment;
    else break;
  }
  const source = map.sources?.[best[1]];
  return source ? { source, line: best[2] + 1, column: best[3] + 1 } : null;
}
