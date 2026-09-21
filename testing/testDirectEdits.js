// Standalone test for the Website Studio's click-to-edit engine
// (src/lib/directEdits.js). Run directly with node -- no LLM, no DOM:
//
//   node testing/testDirectEdits.js
//
// The element payloads mirror what the preview bridge posts for an
// `element-selected` event (see the editing section of src/previewBridge.js).

import assert from 'node:assert';
import { applyDirectEdit, buildElementEditPrompt } from '../src/lib/directEdits.js';

const FIXTURE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Sunrise Bakery</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-stone-50 text-stone-900">
  <!-- @section: nav -->
  <nav class="fixed top-0 inset-x-0 bg-stone-900 text-white">
    <a href="/home" class="font-bold">Sunrise Bakery</a>
    <a href="/menu" class="hover:text-amber-300">Menu</a>
    <a href="#contact" class="rounded-full bg-amber-500 px-4 py-2 font-bold">Order Now</a>
  </nav>

  <!-- @section: hero -->
  <header class="min-h-screen flex items-center justify-center bg-[#1c1917]">
    <h1 class="text-5xl font-black text-white">Fresh bread, every morning</h1>
    <img src="https://images.unsplash.com/photo-bread" alt="Fresh sourdough loaves" class="rounded-2xl">
    <img src="https://images.unsplash.com/photo-shared" srcset="https://images.unsplash.com/photo-shared-2x 2x" alt="Shared kitchen">
  </header>

  <!-- @section: about -->
  <section class="py-24 bg-slate-900 text-white" style="background-image: url('https://images.unsplash.com/photo-flour')">
    <p>Baked in Bend since 2012 &amp; loved daily.</p>
  </section>

  <footer class="bg-stone-900 text-stone-300">
    <p>Duplicate text in footer</p>
    <p>Duplicate text in footer</p>
  </footer>
</body>
</html>`;

const el = (overrides = {}) => ({
  tag: 'div',
  role: 'container',
  text: '',
  textTruncated: false,
  attributes: {},
  backgroundColor: 'rgb(255, 255, 255)',
  backgroundImage: null,
  outerHTML: '',
  outerHTMLTruncated: false,
  parentTag: 'body',
  parentSelectable: true,
  childIndex: 0,
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

console.log('applyDirectEdit:');

check('text change anchors on the element markup', () => {
  const element = el({
    tag: 'h1',
    role: 'heading',
    text: 'Fresh bread, every morning',
    outerHTML: '<h1 class="text-5xl font-black text-white">Fresh bread, every morning</h1>',
  });
  const result = applyDirectEdit(FIXTURE, element, { text: 'Warm rolls, every evening' });
  assert.ok(result.ok, `expected ok, got: ${result.reason}`);
  assert.match(result.code, /<h1 class="text-5xl font-black text-white">Warm rolls, every evening<\/h1>/);
  assert.match(result.summary, /changed text/);
});

check('text change escapes HTML in the new value', () => {
  const unique = el({
    tag: 'a',
    role: 'link',
    text: 'Menu',
    attributes: { href: '/menu', class: 'hover:text-amber-300' },
    outerHTML: '<a href="/menu" class="hover:text-amber-300">Menu</a>',
  });
  const result = applyDirectEdit(FIXTURE, unique, { text: 'Cakes & <b>pastries</b>' });
  assert.ok(result.ok);
  assert.match(result.code, /Cakes &amp; &lt;b&gt;pastries&lt;\/b&gt;/);
});

check('text change falls back to a unique string when markup is unavailable', () => {
  const element = el({
    tag: 'h1',
    role: 'heading',
    text: 'Fresh bread, every morning',
    outerHTML: '', // bridge could not serialize (or caller stripped it)
  });
  const result = applyDirectEdit(FIXTURE, element, { text: 'Fresh bread, every afternoon' });
  assert.ok(result.ok, `expected ok, got: ${result.reason}`);
  assert.match(result.code, /Fresh bread, every afternoon/);
  assert.doesNotMatch(result.code, /every morning/);
});

check('text change refuses ambiguous strings', () => {
  const element = el({
    tag: 'p',
    role: 'text',
    text: 'Duplicate text in footer',
    outerHTML: '',
  });
  const result = applyDirectEdit(FIXTURE, element, { text: 'Unique now' });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'text-not-found'); // two matches -> not unique
});

// In-place editing commits the element snapshot captured BEFORE the typing
// (original text = anchor) plus the new text as `changes.text` -- exactly
// the shape App.jsx's handleElementTextCommitted forwards.
check('in-place commit: multiline text (Shift+Enter) applies to the anchor', () => {
  const element = el({
    tag: 'h1',
    role: 'heading',
    text: 'Fresh bread, every morning',
    outerHTML: '<h1 class="text-5xl font-black text-white">Fresh bread, every morning</h1>',
  });
  const result = applyDirectEdit(FIXTURE, element, { text: 'Fresh bread,\nbaked every night' });
  assert.ok(result.ok, `expected ok, got: ${result.reason}`);
  assert.match(result.code, /Fresh bread,\nbaked every night/);
});

check('text change handles entity-encoded source text', () => {
  const element = el({
    tag: 'p',
    role: 'text',
    text: 'Baked in Bend since 2012 & loved daily.',
    outerHTML: '<p>Baked in Bend since 2012 &amp; loved daily.</p>',
  });
  const result = applyDirectEdit(FIXTURE, element, { text: 'Baked in Bend since 1999.' });
  assert.ok(result.ok, `expected ok, got: ${result.reason}`);
  assert.match(result.code, /<p>Baked in Bend since 1999\.<\/p>/);
  assert.doesNotMatch(result.code, /since 2012/);
});

check('text change refuses ambiguous serialized markup', () => {
  const element = el({
    tag: 'p',
    role: 'text',
    text: 'Duplicate text in footer',
    outerHTML: '<p>Duplicate text in footer</p>',
  });
  const result = applyDirectEdit(FIXTURE, element, { text: 'Unique now' });
  assert.strictEqual(result.ok, false);
  // Both the markup anchor and the raw string match twice -> refuse.
  assert.strictEqual(result.reason, 'text-not-found');
});

check('image src swap rewrites the attribute pair', () => {
  const element = el({
    tag: 'img',
    role: 'image',
    attributes: {
      src: 'https://images.unsplash.com/photo-bread',
      alt: 'Fresh sourdough loaves',
      class: 'rounded-2xl',
    },
  });
  const result = applyDirectEdit(FIXTURE, element, { src: 'https://images.unsplash.com/photo-rolls' });
  assert.ok(result.ok, `expected ok, got: ${result.reason}`);
  assert.match(result.code, /src="https:\/\/images\.unsplash\.com\/photo-rolls"/);
  assert.doesNotMatch(result.code, /photo-bread"/);
});

check('image src swap removes a surviving srcset first', () => {
  const element = el({
    tag: 'img',
    role: 'image',
    attributes: {
      src: 'https://images.unsplash.com/photo-shared',
      srcset: 'https://images.unsplash.com/photo-shared-2x 2x',
    },
  });
  const result = applyDirectEdit(FIXTURE, element, { src: 'https://images.unsplash.com/photo-new' });
  assert.ok(result.ok, `expected ok, got: ${result.reason}`);
  assert.doesNotMatch(result.code, /srcset=/);
  assert.match(result.code, /src="https:\/\/images\.unsplash\.com\/photo-new"/);
});

check('href swap rewrites the link target', () => {
  const element = el({
    tag: 'a',
    role: 'link',
    text: 'Order Now',
    attributes: {
      href: '#contact',
      class: 'rounded-full bg-amber-500 px-4 py-2 font-bold',
    },
    outerHTML: '<a href="#contact" class="rounded-full bg-amber-500 px-4 py-2 font-bold">Order Now</a>',
  });
  const result = applyDirectEdit(FIXTURE, element, { href: '#order' });
  assert.ok(result.ok, `expected ok, got: ${result.reason}`);
  assert.match(result.code, /<a href="#order" class="rounded-full/);
});

check('background color swaps the single bg-* color token', () => {
  const element = el({
    tag: 'section',
    role: 'container',
    attributes: { class: 'py-24 bg-slate-900 text-white' },
  });
  const result = applyDirectEdit(FIXTURE, element, { backgroundColor: '#0f172a' });
  assert.ok(result.ok, `expected ok, got: ${result.reason}`);
  assert.match(result.code, /class="py-24 bg-\[#0f172a\] text-white"/);
});

check('background color ignores bg-position/repeat utilities', () => {
  const element = el({
    tag: 'div',
    role: 'container',
    attributes: { class: 'bg-cover bg-center bg-no-repeat' },
  });
  const result = applyDirectEdit(FIXTURE, element, { backgroundColor: '#112233' });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'background-not-found');
});

check('background image swaps an inline style url()', () => {
  const element = el({
    tag: 'section',
    role: 'container',
    attributes: {
      class: 'py-24 bg-slate-900 text-white',
      style: "background-image: url('https://images.unsplash.com/photo-flour')",
    },
  });
  const result = applyDirectEdit(FIXTURE, element, { backgroundImage: 'https://images.unsplash.com/photo-wheat' });
  assert.ok(result.ok, `expected ok, got: ${result.reason}`);
  assert.match(result.code, /url\("https:\/\/images\.unsplash\.com\/photo-wheat"\)/);
});

check('combined text + href edit applies atomically', () => {
  const element = el({
    tag: 'a',
    role: 'link',
    text: 'Menu',
    attributes: { href: '/menu', class: 'hover:text-amber-300' },
    outerHTML: '<a href="/menu" class="hover:text-amber-300">Menu</a>',
  });
  const result = applyDirectEdit(FIXTURE, element, { text: 'Cakes', href: '/cakes' });
  assert.ok(result.ok, `expected ok, got: ${result.reason}`);
  assert.match(result.code, /<a href="\/cakes" class="hover:text-amber-300">Cakes<\/a>/);
});

check('no-op change reports no-changes', () => {
  const element = el({
    tag: 'a',
    role: 'link',
    text: 'Menu',
    attributes: { href: '/menu' },
    outerHTML: '<a href="/menu">Menu</a>',
  });
  const result = applyDirectEdit(FIXTURE, element, { text: 'Menu' });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'no-op');
});

console.log('buildElementEditPrompt:');

check('prompt carries element context and instruction', () => {
  const prompt = buildElementEditPrompt(
    el({
      tag: 'h1',
      role: 'heading',
      text: 'Fresh bread, every morning',
      parentTag: 'header',
      attributes: { class: 'text-5xl font-black text-white' },
    }),
    'make it shorter'
  );
  assert.match(prompt, /heading \(<h1>/);
  assert.match(prompt, /Fresh bread, every morning/);
  assert.match(prompt, /make it shorter/);
});

check('prompt works without an instruction (user appends)', () => {
  const prompt = buildElementEditPrompt(el({ tag: 'section', role: 'container', parentTag: 'main' }));
  assert.match(prompt, /section \(<section>/);
  assert.match(prompt, /:\s*$/);
});

console.log(`\n${passed} checks passed${process.exitCode ? ' (with failures above)' : ''}`);
