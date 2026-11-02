// Checks the code view's local autocomplete (src/lib/codeComplete.js).
// Run: node testing/testCodeComplete.js
import assert from 'node:assert/strict';
import { caretPosition, completionContext, getCompletions } from '../src/lib/codeComplete.js';

const at = (text) => {
  const caret = text.indexOf('|');
  return [text.replace('|', ''), caret];
};

// Words already in the file come first, most used first.
{
  const [text, caret] = at('const playerScore = 1;\nplayerScore += 2;\nplayerName = "x";\npla|');
  const result = getCompletions(text, caret, 'app.js');
  assert.equal(result.prefix, 'pla');
  assert.equal(result.start, caret - 3);
  assert.deepEqual(result.items.slice(0, 2), ['playerScore', 'playerName']);
}

// The word being typed is never suggested back to itself.
{
  const [text, caret] = at('const unique = 1;\nuniq|');
  assert.deepEqual(getCompletions(text, caret, 'a.js').items, ['unique']);
}

// One letter isn't enough, except right after < in HTML.
assert.equal(getCompletions(...at('d|'), 'a.js'), null);
assert.ok(getCompletions(...at('<body><d|'), 'index.html').items.includes('div'));

// Typing in the middle of a word shows nothing.
assert.equal(completionContext(...at('docu|ment'), 'a.js'), null);

// Inside an HTML page, <style> is CSS and <script> is JS.
{
  const css = getCompletions(...at('<style>\n.box { backg|'), 'index.html');
  assert.ok(css.items.includes('background-color'));
  const js = getCompletions(...at('<style></style><script>\ndocument.querySel|'), 'index.html');
  assert.ok(js.items.includes('querySelector'));
  const attr = getCompletions(...at('<div pla|'), 'index.html');
  assert.ok(attr.items.includes('placeholder'));
}

// Exact-case matches beat case-insensitive ones.
{
  const [text, caret] = at('Counter counter counter\ncou|');
  assert.equal(getCompletions(text, caret, 'a.js').items[0], 'counter');
}

// Unknown file types still complete from the file's own words.
assert.deepEqual(getCompletions(...at('hello world\nhel|'), 'notes.txt').items, ['hello']);

// Caret position expands tabs to the editor's tab size.
assert.deepEqual(caretPosition('a\n\tbc', 5, 2), { line: 1, column: 4 });
assert.deepEqual(caretPosition('abc', 2), { line: 0, column: 2 });

console.log('codeComplete: all checks passed');
