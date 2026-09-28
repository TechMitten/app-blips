// Standalone test for the Website Studio's click-to-edit engine
// (src/lib/directEdits.js). Run directly with node -- no LLM, no DOM:
//
//   node testing/testDirectEdits.js
//
// The element payloads mirror what the preview bridge posts for an
// `element-selected` event (see the editing section of src/previewBridge.js).

import assert from 'node:assert';
import {
  applyDirectEdit, buildElementEditPrompt, describeDirectEditFailure, locateElement,
} from '../src/lib/directEdits.js';

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

const BRAND_FIXTURE = `<header>
  <a href="/"><span class="brand" style="opacity:1">Ray&rsquo;s Dental Clinic</span></a>
</header>
<footer>
  <a href="/"><span class="brand">
    Ray&rsquo;s Dental Clinic
  </span></a>
</footer>`;

check('text change survives attribute drift + entity spelling (live DOM != source)', () => {
  // Live DOM has JS-added inline style and a curly apostrophe from &rsquo;,
  // so outerHTML never matches; text repeats in header and footer.
  const element = el({
    tag: 'span',
    role: 'text',
    text: 'Ray\u2019s Dental Clinic',
    attributes: { class: 'brand' },
    outerHTML: '<span class="brand" style="opacity: 1; transform: none;">Ray\u2019s Dental Clinic</span>',
    textOrdinal: 1,
    textCount: 2,
  });
  const result = applyDirectEdit(BRAND_FIXTURE, element, { text: 'Ray\'s Dental' });
  assert.ok(result.ok, `expected ok, got: ${result.reason}`);
  assert.match(result.code, /<span class="brand" style="opacity:1">Ray&rsquo;s Dental Clinic<\/span>/);
  assert.match(result.code, /<span class="brand">\n {4}Ray's Dental\n {2}<\/span>/);
});

check('text scan refuses repeated text without an ordinal or distinguishing class', () => {
  const element = el({
    tag: 'span',
    role: 'text',
    text: 'Ray\u2019s Dental Clinic',
    attributes: { class: 'brand' },
    outerHTML: '',
  });
  const result = applyDirectEdit(BRAND_FIXTURE, element, { text: 'X' });
  assert.strictEqual(result.ok, false);
});

check('style change adds an inline style to an element without one', () => {
  const element = el({
    tag: 'h1',
    role: 'heading',
    text: 'Fresh bread, every morning',
    attributes: { class: 'text-5xl font-black text-white' },
    outerHTML: '<h1 class="text-5xl font-black text-white">Fresh bread, every morning</h1>',
  });
  const result = applyDirectEdit(FIXTURE, element, { style: { fontSize: '64px', fontWeight: '700' } });
  assert.ok(result.ok, `expected ok, got: ${result.reason}`);
  assert.match(result.code, /<h1 class="text-5xl font-black text-white" style="font-size: 64px; font-weight: 700;">Fresh bread/);
  assert.match(result.summary, /styled text \(size, weight\)/);
});

check('style change merges into an existing style attribute and keeps url(;) values', () => {
  const html = '<p style="background:url(data:image/png;base64,AAA); color: red">Hi there</p>';
  const element = el({ tag: 'p', role: 'text', text: 'Hi there', attributes: { style: 'background:url(data:image/png;base64,AAA); color: red' }, outerHTML: html });
  const result = applyDirectEdit(`<body>${html}</body>`, element, { style: { color: '#112233', textAlign: 'center' } });
  assert.ok(result.ok, result.reason);
  assert.match(result.code, /style="background:url\(data:image\/png;base64,AAA\); color: #112233; text-align: center;"/);
  assert.doesNotMatch(result.code, /color: red/);
});

check('text + style apply together in one edit', () => {
  const element = el({
    tag: 'h1',
    role: 'heading',
    text: 'Fresh bread, every morning',
    outerHTML: '<h1 class="text-5xl font-black text-white">Fresh bread, every morning</h1>',
  });
  const result = applyDirectEdit(FIXTURE, element, { text: 'Warm rolls', style: { fontStyle: 'italic' } });
  assert.ok(result.ok, result.reason);
  assert.match(result.code, /style="font-style: italic;">Warm rolls<\/h1>/);
});

check('choosing a catalog font also links its stylesheet once', () => {
  const element = el({
    tag: 'h1',
    role: 'heading',
    text: 'Fresh bread, every morning',
    outerHTML: '<h1 class="text-5xl font-black text-white">Fresh bread, every morning</h1>',
  });
  const style = { fontFamily: "'Playfair Display', Georgia, serif" };
  const result = applyDirectEdit(FIXTURE, element, { style });
  assert.ok(result.ok, result.reason);
  assert.match(result.code, /<link href="https:\/\/fonts\.googleapis\.com\/css2\?family=Playfair\+Display[^"]*" rel="stylesheet">\s*<\/head>/);
  assert.strictEqual((result.code.match(/family=Playfair\+Display/g) || []).length, 1);
  // Already linked -> no second link.
  const again = applyDirectEdit(result.code, { ...element, outerHTML: '<h1 class="text-5xl font-black text-white" style="font-family: \'Playfair Display\', Georgia, serif;">Fresh bread, every morning</h1>' }, { style: { fontFamily: "'Playfair Display', Georgia, serif", fontSize: '40px' } });
  assert.ok(again.ok, again.reason);
  assert.strictEqual((again.code.match(/family=Playfair\+Display/g) || []).length, 1);
});

check('style change on repeated markup uses the ordinal (attribute drift)', () => {
  const element = el({
    tag: 'span',
    role: 'text',
    text: 'Ray\u2019s Dental Clinic',
    attributes: { class: 'brand' },
    outerHTML: '<span class="brand" style="opacity: 1; transform: none;">Ray\u2019s Dental Clinic</span>',
    textOrdinal: 0,
    textCount: 2,
  });
  const result = applyDirectEdit(BRAND_FIXTURE, element, { style: { fontSize: '30px' } });
  assert.ok(result.ok, result.reason);
  assert.match(result.code, /<span class="brand" style="opacity:1; font-size: 30px;">Ray&rsquo;s/);
  assert.match(result.code, /<span class="brand">\n {4}Ray&rsquo;s/);
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
  // The url is quoted so it cannot end the double-quoted style attribute.
  assert.match(result.code, /style="background-image: url\('https:\/\/images\.unsplash\.com\/photo-wheat'\)"/);
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


console.log('locator-backed edits:');

// Value of `attr` on the first opening tag matching `tagPrefix`, parsed the
// way a browser would (so a prematurely closed attribute shows up).
const attrOf = (code, tagPrefix, attr) => {
  const at = code.indexOf(tagPrefix);
  assert.ok(at !== -1, `missing ${tagPrefix}`);
  const open = /^<[^>]*>/.exec(code.slice(at))[0];
  const m = new RegExp(`\\s${attr}="([^"]*)"`).exec(open);
  return m ? m[1] : null;
};

const FOOTER_EL = {
  tag: 'footer',
  role: 'container',
  text: 'Duplicate text in footer Duplicate text in footer',
  attributes: { class: 'bg-stone-900 text-stone-300' },
};

check('wallpaper is added to a section with no inline background', () => {
  const result = applyDirectEdit(FIXTURE, el(FOOTER_EL), { backgroundImage: 'https://images.unsplash.com/photo-floor' });
  assert.ok(result.ok, `expected ok, got: ${result.reason}`);
  assert.strictEqual(
    attrOf(result.code, '<footer', 'style'),
    "background-image: url('https://images.unsplash.com/photo-floor'); background-size: cover; background-position: center;",
  );
});

check('uploaded data: URI wallpapers keep their ";base64," intact', () => {
  const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
  const result = applyDirectEdit(FIXTURE, el(FOOTER_EL), { backgroundImage: dataUrl });
  assert.ok(result.ok, `expected ok, got: ${result.reason}`);
  assert.ok(attrOf(result.code, '<footer', 'style').includes(`url('${dataUrl}')`));
});

check('wallpaper URLs that could break out of the style are refused', () => {
  const result = applyDirectEdit(FIXTURE, el(FOOTER_EL), { backgroundImage: "https://x.test/a.jpg') ; color: red" });
  assert.strictEqual(result.reason, 'invalid-image-url');
});

check('fill color falls back to inline style when several bg tokens exist', () => {
  const code = '<body>\n  <div class="bg-white bg-opacity-50 p-4">Card</div>\n</body>';
  const element = el({ tag: 'div', text: 'Card', attributes: { class: 'bg-white bg-opacity-50 p-4' } });
  const result = applyDirectEdit(code, element, { backgroundColor: '#ff0000' });
  assert.ok(result.ok, `expected ok, got: ${result.reason}`);
  assert.match(result.code, /<div class="bg-white bg-opacity-50 p-4" style="background-color: #ff0000;">Card<\/div>/);
});

check('fill color over a gradient also clears the gradient', () => {
  const code = '<body>\n  <a href="#go" class="bg-gradient-to-r from-amber-500 to-rose-500 bg-slate-900">Go</a>\n</body>';
  const element = el({
    tag: 'a',
    role: 'link',
    text: 'Go',
    attributes: { href: '#go', class: 'bg-gradient-to-r from-amber-500 to-rose-500 bg-slate-900' },
    backgroundImage: 'linear-gradient(to right, rgb(245, 158, 11), rgb(244, 63, 94))',
  });
  const result = applyDirectEdit(code, element, { backgroundColor: '#123456' });
  assert.ok(result.ok, `expected ok, got: ${result.reason}`);
  assert.strictEqual(attrOf(result.code, '<a', 'style'), 'background-color: #123456; background-image: none;');
  assert.match(result.code, /bg-slate-900/); // token left alone; inline style wins
});

check('alt text is added to an image that has none', () => {
  const code = '<body>\n  <img src="https://x.test/a.jpg" class="w-full">\n</body>';
  const element = el({ tag: 'img', role: 'image', attributes: { src: 'https://x.test/a.jpg', class: 'w-full' }, outerHTML: '<img src="https://x.test/a.jpg" class="w-full">' });
  const result = applyDirectEdit(code, element, { alt: 'A "quoted" view' });
  assert.ok(result.ok, `expected ok, got: ${result.reason}`);
  assert.match(result.code, /<img src="https:\/\/x\.test\/a\.jpg" class="w-full" alt="A &quot;quoted&quot; view">/);
});

check('href is added to a link that has none', () => {
  const code = '<body>\n  <a class="cta">Book now</a>\n</body>';
  const element = el({ tag: 'a', role: 'link', text: 'Book now', attributes: { class: 'cta' }, outerHTML: '<a class="cta">Book now</a>' });
  const result = applyDirectEdit(code, element, { href: 'contact.html' });
  assert.ok(result.ok, `expected ok, got: ${result.reason}`);
  assert.match(result.code, /<a class="cta" href="contact\.html">Book now<\/a>/);
});

check('open-in-new-tab adds target/rel and merges an existing rel', () => {
  const code = '<body>\n  <a href="https://x.test" rel="nofollow">Partner</a>\n</body>';
  const element = el({ tag: 'a', role: 'link', text: 'Partner', attributes: { href: 'https://x.test', rel: 'nofollow' } });
  const on = applyDirectEdit(code, element, { target: '_blank' });
  assert.ok(on.ok, `expected ok, got: ${on.reason}`);
  assert.match(on.code, /<a href="https:\/\/x\.test" rel="nofollow noopener noreferrer" target="_blank">Partner<\/a>/);

  const blankEl = el({ ...element, attributes: { href: 'https://x.test', rel: 'nofollow noopener noreferrer', target: '_blank' } });
  const off = applyDirectEdit(on.code, blankEl, { target: null });
  assert.ok(off.ok, `expected ok, got: ${off.reason}`);
  assert.match(off.code, /<a href="https:\/\/x\.test" rel="nofollow">Partner<\/a>/);
});

check('attribute lookups ignore look-alikes inside other attribute values', () => {
  const code = '<body>\n  <a data-note="set alt=here" class="x">Hi</a>\n</body>';
  const element = el({ tag: 'a', role: 'link', text: 'Hi', attributes: { class: 'x', 'data-note': 'set alt=here' } });
  const result = applyDirectEdit(code, element, { href: '#hi' });
  assert.ok(result.ok, `expected ok, got: ${result.reason}`);
  assert.match(result.code, /<a data-note="set alt=here" class="x" href="#hi">Hi<\/a>/);
});

check('markup inside scripts and comments is never matched', () => {
  const code = "<body>\n  <!-- <p>Hello</p> -->\n  <script>const t = '<p>Hello</p>';</script>\n  <p>Hello</p>\n</body>";
  const found = locateElement(code, el({ tag: 'p', role: 'text', text: 'Hello' }));
  assert.ok(found.ok, `expected ok, got: ${found.reason}`);
  assert.strictEqual(code.slice(found.start, found.end), '<p>Hello</p>');
  assert.ok(found.start > code.indexOf('</script>'));
});

check('tag rank locates a text-less element when counts agree', () => {
  const code = '<body>\n  <div class="spacer h-8"></div>\n  <p>x</p>\n  <div class="spacer h-8"></div>\n</body>';
  const found = locateElement(code, el({ tag: 'div', attributes: { class: 'spacer h-8' }, tagOrdinal: 1, tagCount: 2 }));
  assert.ok(found.ok, `expected ok, got: ${found.reason}`);
  assert.strictEqual(found.strategy, 'ordinal');
  assert.ok(found.start > code.indexOf('<p>'));
  // A count mismatch (JS-inserted elements) refuses rather than guessing.
  const refused = locateElement(code, el({ tag: 'div', attributes: { class: 'spacer h-8' }, tagOrdinal: 1, tagCount: 3 }));
  assert.strictEqual(refused.ok, false);
});

console.log('structure edits:');

const ABOUT_EL = {
  tag: 'section',
  role: 'container',
  text: 'Baked in Bend since 2012 & loved daily.',
  attributes: { class: 'py-24 bg-slate-900 text-white' },
};
const HEADER_EL = {
  tag: 'header',
  role: 'container',
  text: 'Fresh bread, every morning',
  attributes: { class: 'min-h-screen flex items-center justify-center bg-[#1c1917]' },
};

check('remove takes the section, its landmark and its line', () => {
  const result = applyDirectEdit(FIXTURE, el(ABOUT_EL), { remove: true });
  assert.ok(result.ok, `expected ok, got: ${result.reason}`);
  assert.ok(!result.code.includes('@section: about'));
  assert.ok(!result.code.includes('Baked in Bend'));
  assert.match(result.code, /<\/header>\n\n\n {2}<footer/);
  assert.match(result.summary, /removed the section "Baked in Bend/);
});

check('remove drops an inline element with its indentation', () => {
  const element = el({ tag: 'a', role: 'link', text: 'Menu', attributes: { href: '/menu', class: 'hover:text-amber-300' } });
  const result = applyDirectEdit(FIXTURE, element, { remove: true });
  assert.ok(result.ok, `expected ok, got: ${result.reason}`);
  assert.match(result.code, /Sunrise Bakery<\/a>\n {4}<a href="#contact"/);
});

check('duplicate inserts a copy on its own line without ids', () => {
  const code = '<body>\n  <div id="card-1" class="card">\n    <h3 id="t1">Plan</h3>\n  </div>\n</body>';
  const element = el({ tag: 'div', text: 'Plan', attributes: { id: 'card-1', class: 'card' } });
  const result = applyDirectEdit(code, element, { duplicate: true });
  assert.ok(result.ok, `expected ok, got: ${result.reason}`);
  assert.strictEqual(
    result.code,
    '<body>\n  <div id="card-1" class="card">\n    <h3 id="t1">Plan</h3>\n  </div>\n  <div class="card">\n    <h3>Plan</h3>\n  </div>\n</body>',
  );
});

check('move up swaps with the previous sibling', () => {
  const element = el({
    tag: 'a',
    role: 'link',
    text: 'Order Now',
    attributes: { href: '#contact', class: 'rounded-full bg-amber-500 px-4 py-2 font-bold' },
    prevSibling: { tag: 'a', text: 'Menu', attributes: { href: '/menu', class: 'hover:text-amber-300' } },
  });
  const result = applyDirectEdit(FIXTURE, element, { move: -1 });
  assert.ok(result.ok, `expected ok, got: ${result.reason}`);
  assert.match(result.code, /font-bold">Order Now<\/a>\n {4}<a href="\/menu" class="hover:text-amber-300">Menu<\/a>\n {2}<\/nav>/);
  assert.match(result.summary, /moved the link "Order Now" up/);
});

check('move down carries @section landmarks with their sections', () => {
  const result = applyDirectEdit(FIXTURE, el({ ...HEADER_EL, nextSibling: ABOUT_EL }), { move: 1 });
  assert.ok(result.ok, `expected ok, got: ${result.reason}`);
  const about = result.code.indexOf('<!-- @section: about -->');
  const hero = result.code.indexOf('<!-- @section: hero -->');
  assert.ok(about !== -1 && hero !== -1 && about < hero);
  assert.ok(result.code.indexOf('<section') < result.code.indexOf('<header'));
  assert.match(result.code, /<!-- @section: about -->\n {2}<section/);
  assert.match(result.code, /<!-- @section: hero -->\n {2}<header/);
});

check('move refuses when the neighbour is not adjacent in the source', () => {
  const code = '<body>\n  <p>One</p>\n  stray words\n  <p>Two</p>\n</body>';
  const element = el({ tag: 'p', role: 'text', text: 'Two', prevSibling: { tag: 'p', text: 'One', attributes: {} } });
  const result = applyDirectEdit(code, element, { move: -1 });
  assert.strictEqual(result.reason, 'not-adjacent');
});

check('move without a sibling reports no-sibling', () => {
  const element = el({ tag: 'a', role: 'link', text: 'Menu', attributes: { href: '/menu' } });
  assert.strictEqual(applyDirectEdit(FIXTURE, element, { move: 1 }).reason, 'no-sibling');
});

check('structure edits refuse ambiguous elements and the page itself', () => {
  const dup = el({ tag: 'p', role: 'text', text: 'Duplicate text in footer' });
  assert.strictEqual(applyDirectEdit(FIXTURE, dup, { remove: true }).reason, 'ambiguous');
  const ranked = el({ tag: 'p', role: 'text', text: 'Duplicate text in footer', textOrdinal: 1, textCount: 2 });
  const removed = applyDirectEdit(FIXTURE, ranked, { remove: true });
  assert.ok(removed.ok, `expected ok, got: ${removed.reason}`);
  assert.strictEqual(removed.code.split('Duplicate text in footer').length - 1, 1);
  assert.strictEqual(applyDirectEdit(FIXTURE, el({ tag: 'body' }), { remove: true }).reason, 'protected-element');
  assert.strictEqual(applyDirectEdit(FIXTURE, el(ABOUT_EL), { remove: true, href: '/x' }).reason, 'invalid');
});

check('failure reasons have specific messages', () => {
  assert.match(describeDirectEditFailure('ambiguous'), /more than once/);
  assert.match(describeDirectEditFailure('not-adjacent'), /could not be moved/);
  assert.match(describeDirectEditFailure('whatever'), /could not be found/);
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

check('prompt with source context quotes the element, its section and page', () => {
  const prompt = buildElementEditPrompt(el(ABOUT_EL), 'make it warmer', { code: FIXTURE, page: 'about.html', multiPage: true });
  assert.match(prompt, /^Target element \(in the "about" section of about\.html\), as it appears in the source:/);
  assert.match(prompt, /```html\n<section class="py-24 bg-slate-900 text-white" style=/);
  assert.match(prompt, /\n {2}<p>Baked in Bend since 2012 &amp; loved daily\.<\/p>\n<\/section>\n```/);
  assert.match(prompt, /: make it warmer$/);
  // Unlocatable elements fall back to the plain description.
  const plain = buildElementEditPrompt(el({ tag: 'div', text: 'Not in source' }), 'x', { code: FIXTURE, page: 'index.html', multiPage: false });
  assert.match(plain, /^Directly edit the section \(<div>/);
});

console.log(`\n${passed} checks passed${process.exitCode ? ' (with failures above)' : ''}`);
