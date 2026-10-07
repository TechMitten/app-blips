// Run: node testing/testPages.js
import assert from 'node:assert/strict';
import {
  resolvePageLink, validatePageName, findBrokenLinks, versionFiles, pageNames, checkFilesLimits,
} from '../src/lib/pages.js';
import { injectPreviewBridge } from '../src/previewBridge.js';

const links = {
  'about.html': 'about.html', './about.html': 'about.html', '/about.html': 'about.html',
  '/about': 'about.html', 'about': 'about.html', 'about.html#team': 'about.html',
  '/': 'index.html', 'index.html': 'index.html', '': null, '?x=1': null,
  '#top': null, 'https://x.com/a.html': null, '//x.com/a': null, 'mailto:a@b.c': null,
  'a/b.html': null, '../x.html': null, 'Bad Name.html': null,
};
for (const [href, want] of Object.entries(links)) {
  assert.equal(resolvePageLink(href), want, `resolvePageLink(${JSON.stringify(href)})`);
}
assert.equal(validatePageName('pricing.html'), true);
assert.equal(validatePageName('../x.html'), false);

const files = {
  'index.html': '<a href="about.html">a</a><a href="/pricing">p</a><a href=\'#x\'>x</a>',
  'about.html': '<a href="/">home</a>',
};
assert.deepEqual(findBrokenLinks(files), [{ page: 'index.html', target: 'pricing.html' }]);
assert.deepEqual(versionFiles({ code: '<p/>' }), { 'index.html': '<p/>' });
assert.deepEqual(pageNames({ 'z.html': '', 'index.html': '', 'a.html': '' }), ['index.html', 'a.html', 'z.html']);
assert.equal(checkFilesLimits(files), null);
assert.match(checkFilesLimits({ 'index.html': 'x'.repeat(500 * 1024) }), /too large/);

const { srcDoc } = injectPreviewBridge('<html><head></head><body></body></html>', {});
assert.ok(srcDoc.includes("post('navigate-page'"), 'bridge posts navigate-page');
console.log('testPages: ok');

// --- page tools ---
const { executeFilesTool, checkSyntaxFiles } = await import('../src/lib/pageTools.js');
const call = (name, args) => ({ function: { name, arguments: JSON.stringify(args) } });
const doc = (b) => `<!DOCTYPE html><html><head><title>T</title></head><body>${b}</body></html>`;
let f = { 'index.html': doc('<a href="about.html">About</a><p>hello</p>') };
let r = executeFilesTool(f, call('create_page', { name: 'about.html', html: doc('<h1>About</h1>') }));
assert.ok(r.applied && 'about.html' in r.files && !('about.html' in f), 'create_page adds without mutating');
f = r.files;
assert.equal(executeFilesTool(f, call('create_page', { name: 'about.html', html: doc('') })).result.success, false);
assert.equal(executeFilesTool(f, call('create_page', { name: 'index.html', html: doc('') })).result.success, false);
assert.equal(executeFilesTool(f, call('create_page', { name: '../x.html', html: doc('') })).result.success, false);
assert.equal(executeFilesTool(f, call('create_page', { name: 'x.html', html: 'nope' })).result.success, false);
r = executeFilesTool(f, call('apply_surgical_edits', { file: 'about.html', edits: [{ search: '<h1>About</h1>', replace: '<h1>About us</h1>', occurrence: null, replace_all: null }] }));
assert.ok(r.applied && r.files['about.html'].includes('About us') && r.files['index.html'] === f['index.html']);
r = executeFilesTool(f, call('apply_surgical_edits', { file: null, edits: [{ search: '<p>hello</p>', replace: '<p>hi</p>', occurrence: null, replace_all: null }] }));
assert.ok(r.applied && r.files['index.html'].includes('<p>hi</p>'));
assert.equal(executeFilesTool(f, call('view_code', { file: 'nope.html', section: null, start_line: 1, end_line: 2 })).result.success, false);
assert.equal(executeFilesTool(f, call('list_pages', {})).result.pages.length, 2);
assert.equal(executeFilesTool(f, call('delete_page', { name: 'index.html' })).result.success, false);
r = executeFilesTool(f, call('delete_page', { name: 'about.html' }));
assert.ok(r.applied && !('about.html' in r.files) && /index\.html/.test(r.result.warning));
assert.deepEqual(checkSyntaxFiles({ 'index.html': doc('<script>var a = ;</script>'), 'b.html': doc('<script>var = 1</script>') }).errors.map((e) => /^\[b\.html\]/.test(e.message)), [false, true]);
console.log('testPages (tools): ok');

// --- tool schemas / prompt formatting ---
const { getRefinementTools, buildHtmlSystemPrompt } = await import('../src/lib/prompts.js');
const { formatFilesForPrompt } = await import('../src/lib/pages.js');
const siteTools = getRefinementTools('website');
// strict mode: every property must be required
for (const t of siteTools) {
  const { properties, required } = t.function.parameters;
  assert.deepEqual([...Object.keys(properties)].sort(), [...required].sort(), `${t.function.name}: strict schema`);
}
assert.equal(getRefinementTools('app').some((t) => t.function.name === 'create_page'), false);
assert.ok(buildHtmlSystemPrompt('website').includes('MULTIPLE PAGES'));
assert.ok(!buildHtmlSystemPrompt('app').includes('MULTIPLE PAGES'));

assert.equal(formatFilesForPrompt({ 'index.html': '<p/>' }, 'app'), 'Current app Code:\n```html\n<p/>\n```');
const big = { 'index.html': 'a'.repeat(50), 'x.html': 'b'.repeat(50), 'y.html': 'c'.repeat(50) };
const out = formatFilesForPrompt(big, 'website', 120);
assert.ok(out.includes('=== index.html ===') && out.includes('=== x.html ===') && /Not shown[^\n]*y\.html/.test(out));
console.log('testPages (prompts): ok');

// --- zip export ---
const { createZip, crc32 } = await import('../src/lib/zip.js');
assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
if (process.env.ZIP_OUT) {
  const { writeFileSync } = await import('node:fs');
  const blob = createZip([{ name: 'index.html', data: '<h1>Hé</h1>' }, { name: 'about.html', data: '<h1>About</h1>' }]);
  writeFileSync(process.env.ZIP_OUT, Buffer.from(await blob.arrayBuffer()));
}
console.log('testPages (zip): ok');

// --- live code peek: page sniffing + html extraction ---
const { sniffStreamedPage } = await import('../src/lib/pages.js');
assert.equal(sniffStreamedPage('apply_surgical_edits', '{"file":"about.html","edits":[{"sea'), 'about.html');
assert.equal(sniffStreamedPage('apply_surgical_edits', '{"file":null,"edits":[]'), 'index.html');
assert.equal(sniffStreamedPage('apply_surgical_edits', '{"fi'), null);
assert.equal(sniffStreamedPage('create_page', '{"name":"our-menu.html","html":"<!DOC'), 'our-menu.html');
assert.equal(sniffStreamedPage('create_page', '{"name":"../x.html"'), null);
console.log('testPages (live peek): ok');

// Link suggestions for the click-to-edit bar.
{
  const { collectLinkTargets } = await import('../src/lib/pages.js');
  const files = {
    'index.html': '<title>Home</title><section id="hero"></section><!-- <div id="ghost"> --><script>el.id = "x"; var s = \'<p id="fake">\';</script><div id="contact"></div>',
    'about.html': '<title>About us</title><section id="team"></section>',
  };
  assert.deepEqual(collectLinkTargets(files, 'index.html').map((t) => t.value), ['#hero', '#contact', 'about.html', 'about.html#team']);
  assert.deepEqual(collectLinkTargets(files, 'about.html').map((t) => t.value), ['#team', 'index.html', 'index.html#hero', 'index.html#contact']);
  assert.equal(collectLinkTargets(files, 'index.html')[2].label, 'About page · About us');
}
console.log('testPages (link targets): ok');
