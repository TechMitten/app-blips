// Standalone test for click-to-edit source positions
// (src/lib/sourcePositions.js and its use in src/lib/directEdits.js):
//
//   node testing/testSourcePositions.js
//
// The element payloads are what the preview bridge posts for a clicked
// element in a numbered (Website Studio) preview: `srcId` is the clicked
// tag's number, `srcFingerprint` the fingerprint of the source the preview
// was built from.

import assert from 'node:assert';
import { applyDirectEdit, locateElement } from '../src/lib/directEdits.js';
import {
  sourceElementStarts, sourceFingerprint, stampSourcePositions,
} from '../src/lib/sourcePositions.js';
import { injectPreviewBridge } from '../src/previewBridge.js';

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Plans</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-white">
  <!-- <div>commented out</div> -->
  <section class="grid">
    <div class="card"><h3>Starter</h3><p>Everything you need.</p></div>
    <div class="card"><h3>Starter</h3><p>Everything you need.</p></div>
    <div class="card" title="a <b>bold</b> title"><h3>Pro</h3></div>
  </section>
  <script>
    document.body.insertAdjacentHTML('beforeend', '<div class="toast">Hi</div>');
  </script>
</body>
</html>`;

// Number of the `nth` (0-based) source occurrence of `needle`, as the
// preview would report it.
const idOf = (code, needle, nth = 0) => {
  let at = -1;
  for (let i = 0; i <= nth; i += 1) at = code.indexOf(needle, at + 1);
  const id = sourceElementStarts(code).indexOf(at);
  assert.ok(id >= 0, `no number for ${needle} #${nth}`);
  return id;
};

const clicked = (code, needle, nth, overrides = {}) => ({
  tag: /^<([a-z0-9-]+)/i.exec(needle)[1].toLowerCase(),
  srcId: idOf(code, needle, nth),
  srcFingerprint: sourceFingerprint(code),
  attributes: {},
  outerHTML: '',
  outerHTMLTruncated: false,
  ...overrides,
});

let passed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
};

console.log('stampSourcePositions:');

check('numbers body tags only, keeps every line', () => {
  const stamped = stampSourcePositions(PAGE);
  assert.strictEqual(stamped.split('\n').length, PAGE.split('\n').length);
  assert.match(stamped, /<section data-ab-src=\d+ class="grid">/);
  assert.match(stamped, /<h3 data-ab-src=\d+>Starter<\/h3>/);
  assert.match(stamped, /<body class="bg-white">/);
  assert.match(stamped, /<meta charset="UTF-8">/);
  assert.match(stamped, /<script>\n/);
});

check('never numbers markup inside comments, scripts or attribute values', () => {
  const stamped = stampSourcePositions(PAGE);
  assert.ok(stamped.includes('<!-- <div>commented out</div> -->'));
  assert.ok(stamped.includes(`'<div class="toast">Hi</div>'`));
  assert.ok(stamped.includes('title="a <b>bold</b> title"'));
});

check('removing the numbers gives back the source exactly', () => {
  const stamped = stampSourcePositions(PAGE);
  assert.strictEqual(stamped.replace(/ data-ab-src=\d+/g, ''), PAGE);
});

check('the preview carries numbers only when asked; the bridge gets the fingerprint', () => {
  const plain = injectPreviewBridge(PAGE).srcDoc;
  assert.ok(!/<[a-z0-9]+ data-ab-src=\d/.test(plain));
  const numbered = injectPreviewBridge(PAGE, { sourcePositions: true }).srcDoc;
  assert.match(numbered, /<h3 data-ab-src=\d+>Starter<\/h3>/);
  assert.ok(numbered.includes(`var SOURCE_FP = ${JSON.stringify(sourceFingerprint(PAGE))};`));
  assert.ok(plain.includes('var SOURCE_FP = null;'));
  assert.strictEqual(numbered.split('\n').length, plain.split('\n').length);
});

console.log('locating by source number:');

check('picks the right one of two identical cards', () => {
  const second = clicked(PAGE, '<h3>Starter', 1, { text: 'Starter', rawText: 'Starter' });
  const found = locateElement(PAGE, second);
  assert.ok(found.ok, found.reason);
  assert.strictEqual(found.strategy, 'source');
  assert.strictEqual(found.start, PAGE.indexOf('<h3>Starter', PAGE.indexOf('<h3>Starter') + 1));
});

check('text edit lands on the clicked duplicate only', () => {
  const second = clicked(PAGE, '<h3>Starter', 1, { text: 'Starter', rawText: 'Starter' });
  const result = applyDirectEdit(PAGE, second, { text: 'Team' });
  assert.ok(result.ok, result.reason);
  assert.match(result.code, /<h3>Starter<\/h3><p>Everything you need.<\/p><\/div>\n {4}<div class="card"><h3>Team<\/h3>/);
});

check('removes the clicked duplicate card', () => {
  const card = clicked(PAGE, '<div class="card">', 0, { text: 'Starter Everything you need.', rawText: 'StarterEverything you need.' });
  const result = applyDirectEdit(PAGE, card, { remove: true });
  assert.ok(result.ok, result.reason);
  assert.strictEqual(result.code.split('<div class="card"><h3>Starter').length - 1, 1);
  assert.ok(result.code.includes('<h3>Pro</h3>'));
});

check('works when a script changed the live classes', () => {
  const card = clicked(PAGE, '<div class="card" title', 0, {
    text: 'Pro',
    rawText: 'Pro',
    attributes: { class: 'card fade-in visible', title: 'a <b>bold</b> title' },
    outerHTML: '<div class="card fade-in visible" title="a <b>bold</b> title"><h3>Pro</h3></div>',
  });
  const result = applyDirectEdit(PAGE, card, { backgroundColor: '#112233' });
  assert.ok(result.ok, result.reason);
  assert.ok(result.code.includes('<div class="card" title="a <b>bold</b> title" style="background-color: #112233;"><h3>Pro</h3></div>'));
});

check('ignores numbers from an older version of the page', () => {
  const second = clicked(PAGE, '<h3>Starter', 1, { text: 'Starter', rawText: 'Starter', srcFingerprint: 'stale' });
  const result = locateElement(PAGE, second);
  assert.ok(!result.ok);
  assert.strictEqual(result.reason, 'ambiguous');
});

check('ignores a number whose source tag no longer matches the clicked element', () => {
  const wrong = clicked(PAGE, '<h3>Pro', 0, { text: 'Starter', rawText: 'Starter' });
  const result = applyDirectEdit(PAGE, wrong, { text: 'Team' });
  assert.ok(!result.ok);
});

console.log(`\n${passed} checks passed${process.exitCode ? ' (with failures above)' : ''}`);
