// Run: node --test testing/testSurgicalEdits.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applySurgicalEdits } from '../src/lib/edits.js';

const edit = (search, replace, extra = {}) => ({ search, replace, ...extra });
const conservative = { conservative: true };

test('replacement text remains literal in every matching mode', () => {
  const replacement = '$& $$ $` $\' ${price}';
  for (const options of [{}, conservative]) {
    assert.equal(applySurgicalEdits('before old after', [edit('old', replacement)], options).code, `before ${replacement} after`);
    assert.equal(applySurgicalEdits('old old', [edit('old', replacement, { occurrence: 2 })], options).code, `old ${replacement}`);
    assert.equal(applySurgicalEdits('old old', [edit('old', replacement, { replace_all: true })], options).code, `${replacement} ${replacement}`);
    assert.equal(applySurgicalEdits('  old\nend', [edit('old\n end', replacement)], options).code, replacement);
  }
});

test('imported CRLF source accepts LF anchors and preserves unrelated bytes', () => {
  const source = '// header\r\nexport function App() {\r\n  return <h1>Hello</h1>\r\n}\r\n// footer\r\n';
  const result = applySurgicalEdits(source, [edit('function App() {\n  return <h1>Hello</h1>', 'function App() {\n  return <h1>Welcome</h1>')], conservative);
  assert.equal(result.code, source.replace('Hello', 'Welcome'));
  const indented = applySurgicalEdits(source, [edit(' return <h1>Hello</h1>\n }', '  return <h1>Welcome</h1>\n}')], conservative);
  assert.equal(indented.code, source.replace('Hello', 'Welcome'));
  assert.equal(applySurgicalEdits('one\r\ntwo\r\n', [edit('one\r\ntwo', 'first\nsecond')], conservative).code, 'first\r\nsecond\r\n');
});

test('indentation fallback refuses altered whitespace inside strings and JSX copy', () => {
  for (const source of ['  const text = "Hello  world";', '  return <h1>Hello  world</h1>;']) {
    const result = applySurgicalEdits(source, [edit(source.replace('  world', ' world'), 'changed')], conservative);
    assert.equal(result.success, false);
  }
  assert.equal(applySurgicalEdits('  const text = "Hello  world";', [edit('const text = "Hello  world";', 'const text = "Hi";')], conservative).success, true);
});

test('ambiguous searches report locations and honor explicit match selection', () => {
  const source = '<h1>Hello</h1>\n<p>Other</p>\n<h1>Hello</h1>';
  const result = applySurgicalEdits(source, [edit('Hello', 'Hi')], conservative);
  assert.equal(result.success, false);
  assert.equal(result.ambiguous, true);
  assert.deepEqual(result.matchLines, [1, 3]);
  assert.equal(applySurgicalEdits(source, [edit('Hello', 'Hi', { occurrence: 2 })], conservative).code, '<h1>Hello</h1>\n<p>Other</p>\n<h1>Hi</h1>');
  assert.match(applySurgicalEdits(source, [edit('Hello', 'Hi', { occurrence: 3 })], conservative).error, /out of range/);
  assert.equal(applySurgicalEdits('Hello', [edit('Hello', 'Hi', { occurrence: 2 })], conservative).success, false);
});

test('malformed blocks fail rather than skipping edits or inserting undefined', () => {
  for (const edits of [[], [null], [{}], [edit('', 'x')], [{ search: 'old' }], [edit('old', null)], [edit('old', 'new', { occurrence: 1.5 })], [edit('old', 'new', { replace_all: 'true' })]]) {
    assert.equal(applySurgicalEdits('old', edits).success, false, JSON.stringify(edits));
  }
  assert.equal(applySurgicalEdits('', [edit('old', 'new')]).success, false);
  assert.equal(applySurgicalEdits('old', [edit('old', '')]).code, '');
});

test('blocks are ordered and failure returns no partially changed source', () => {
  assert.equal(applySurgicalEdits('old', [edit('old', 'middle'), edit('middle', 'new')]).code, 'new');
  const result = applySurgicalEdits('old', [edit('old', 'middle'), edit('missing', 'new')]);
  assert.equal(result.success, false);
  assert.equal(result.failedEdit, 2);
  assert.equal(result.code, undefined);
});

test('legacy whitespace fallback stays available and refuses overlapping replacements', () => {
  assert.equal(applySurgicalEdits('  return   x;\r\nkeep\r\n', [edit('return x;', 'return y;')]).code, 'return y;\r\nkeep\r\n');
  const result = applySurgicalEdits(' x\n x\n x', [edit('x\nx', 'y', { replace_all: true })]);
  assert.equal(result.success, false);
  assert.match(result.error, /overlap/);
});
