// Run: node testing/testStreamedEditCode.js
// extractStreamedEditCode (src/lib/helpers.js) feeds the build overlay's live
// code peek from partially streamed edit-tool arguments. A chunk that ends
// right after an escape's backslash used to drop the code being written, which
// rewound the peek and showed it blank mid-edit.
import assert from 'node:assert/strict';
import { extractStreamedEditCode } from '../src/lib/helpers.js';

const code = Array.from({ length: 40 }, (_, i) => `    <div class="row-${i}">Item ${i} "quoted" C:\\path</div>`).join('\n');
const args = JSON.stringify({
  edits: [
    { search: code.slice(0, 900), replace: code, occurrence: null, replace_all: null },
    { search: 'x', replace: 'second\n"two"', occurrence: null, replace_all: null },
  ],
});

// Every chunk size, so the stream gets cut after every possible character.
for (const step of [1, 2, 3, 5, 7, 13]) {
  let streamed = '';
  let previous = '';
  for (let i = 0; i < args.length; i += step) {
    streamed += args.slice(i, i + step);
    const text = extractStreamedEditCode(streamed);
    assert.ok(text.startsWith(previous), `chunk size ${step}: text shrank after ${streamed.length} chars`);
    previous = text;
  }
  assert.equal(previous, `${code}\nsecond\n"two"`);
}

// Search strings are the old code and never shown.
assert.equal(extractStreamedEditCode('{"edits":[{"search":"old'), '');
// create_page streams its html the same way.
assert.equal(extractStreamedEditCode('{"page":"a.html","html":"<p>\\'), '<p>');

console.log('ok testStreamedEditCode');
