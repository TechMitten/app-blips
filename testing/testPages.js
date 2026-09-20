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

// --- tool schemas / hosted allow-list / prompt formatting ---
import { readFileSync } from 'node:fs';
const { getRefinementTools, buildHtmlSystemPrompt } = await import('../src/lib/prompts.js');
const { formatFilesForPrompt } = await import('../src/lib/pages.js');
const proxySrc = readFileSync(new URL('../functions/_lib/chatProxy.js', import.meta.url), 'utf8');
const allowBlock = /ALLOWED_TOOL_NAMES = new Set\(\[([\s\S]*?)\]\)/.exec(proxySrc)[1];
const siteTools = getRefinementTools('website');
for (const t of siteTools) assert.ok(allowBlock.includes(`'${t.function.name}'`), `${t.function.name} missing from ALLOWED_TOOL_NAMES`);
assert.ok(siteTools.length + 1 <= (allowBlock.match(/'/g).length / 2), 'tool count fits hosted cap');
// strict mode: every property must be required
for (const t of siteTools) {
  const { properties, required } = t.function.parameters;
  assert.deepEqual([...Object.keys(properties)].sort(), [...required].sort(), `${t.function.name}: strict schema`);
}
assert.equal(getRefinementTools('app').some((t) => t.function.name === 'create_page'), false);
assert.ok(buildHtmlSystemPrompt(false, 'hosted', 'website').includes('MULTIPLE PAGES'));
assert.ok(!buildHtmlSystemPrompt(false, 'hosted', 'app').includes('MULTIPLE PAGES'));

assert.equal(formatFilesForPrompt({ 'index.html': '<p/>' }, 'app'), 'Current app Code:\n```html\n<p/>\n```');
const big = { 'index.html': 'a'.repeat(50), 'x.html': 'b'.repeat(50), 'y.html': 'c'.repeat(50) };
const out = formatFilesForPrompt(big, 'website', 120);
assert.ok(out.includes('=== index.html ===') && out.includes('=== x.html ===') && /Not shown[^\n]*y\.html/.test(out));
console.log('testPages (prompts): ok');

// --- serving Function routing + link rewriting ---
const { candidatesForPath, rewritePageLinks } = await import('../functions/[[path]].js');
assert.deepEqual(candidatesForPath('my-site'), [{ slug: 'my-site', page: null }]);
assert.deepEqual(candidatesForPath('my-site/about'), [
  { slug: 'my-site/about', page: null }, { slug: 'my-site', page: 'about' },
]);
assert.deepEqual(candidatesForPath('ray/cafe-a7f3/our-menu.html'), [{ slug: 'ray/cafe-a7f3', page: 'our-menu' }]);
assert.deepEqual(candidatesForPath('a/b/c/d'), []);
assert.deepEqual(candidatesForPath('my-site/Bad_Page'), []);
const rewritten = rewritePageLinks(
  '<a href="about.html">a</a><a class="x" href=\'/pricing#plans\'>p</a><a href="index.html">h</a><a href="#top">t</a><a href="https://x.com/about.html">e</a><a href="missing.html">m</a>',
  'ray/cafe', ['about', 'pricing'],
);
assert.equal(
  rewritten,
  '<a href="/ray/cafe/about">a</a><a class="x" href=\'/ray/cafe/pricing#plans\'>p</a><a href="/ray/cafe">h</a><a href="#top">t</a><a href="https://x.com/about.html">e</a><a href="missing.html">m</a>',
);
console.log('testPages (serving): ok');

// --- client-side site router (password bundle / new-tab shell) ---
import vm from 'node:vm';
const { SITE_ROUTER_SOURCE, buildSiteShell } = await import('../src/lib/siteRouter.js');
assert.ok(!SITE_ROUTER_SOURCE.includes('</'), 'router source must not contain a closing tag');
assert.ok(!SITE_ROUTER_SOURCE.includes('\\') && !SITE_ROUTER_SOURCE.includes('${'), 'router source must stay template-safe');

function runRouter({ pathname, slug, pushState, pages }) {
  const written = [];
  const pushed = [];
  const listeners = {};
  const document = {
    open() { written.length = 0; },
    write(h) { written.push(h); },
    close() {},
    addEventListener(type, fn) { listeners[type] = fn; },
    getElementById: () => null,
  };
  const location = { pathname, hash: '' };
  const window = {
    __APPBLIPS_SLUG__: slug, scrollTo() {},
    addEventListener(type, fn) { listeners['win:' + type] = fn; },
  };
  const ctx = vm.createContext({
    document, window, location, Object, decodeURIComponent,
    history: { pushState: (_s, _t, url) => { pushed.push(url); location.pathname = url.split('#')[0]; } },
  });
  vm.runInContext(`${SITE_ROUTER_SOURCE}\nsiteStart(${JSON.stringify(pages)}, ${pushState});`, ctx);
  const click = (href) => {
    const prevented = { v: false };
    listeners.click({
      defaultPrevented: false, button: 0,
      target: { closest: () => ({ hasAttribute: () => false, getAttribute: (n) => (n === 'href' ? href : null) }) },
      preventDefault() { prevented.v = true; },
    });
    return prevented.v;
  };
  return { written, pushed, click, listeners, location };
}
const sitePages = { 'index.html': '<h1>Home</h1>', 'about.html': '<h1>About</h1>' };
let rt = runRouter({ pathname: '/ray/cafe/about', slug: 'ray/cafe', pushState: true, pages: sitePages });
assert.deepEqual(rt.written, ['<h1>About</h1>'], 'deep link renders that page');
assert.equal(rt.click('index.html#top'), true);
assert.deepEqual(rt.pushed, ['/ray/cafe#top']);
assert.deepEqual(rt.written, ['<h1>Home</h1>']);
assert.equal(rt.click('https://x.com/'), false, 'external links are left alone');
assert.equal(rt.click('missing.html'), false, 'unknown pages are left alone');
rt = runRouter({ pathname: '/ray/cafe', slug: 'ray/cafe', pushState: true, pages: sitePages });
assert.deepEqual(rt.written, ['<h1>Home</h1>']);
rt = runRouter({ pathname: '/blob', slug: '', pushState: false, pages: sitePages });
assert.equal(rt.click('/about'), true);
assert.deepEqual(rt.written, ['<h1>About</h1>']);
assert.deepEqual(rt.pushed, [], 'no history changes without a slug');

const shell = buildSiteShell({ 'index.html': '<p>x</p></script><script>evil()</script>' }, 'T<b>');
assert.equal((shell.match(/<\/script>/g) || []).length, 1, 'page HTML cannot end the shell script early');
console.log('testPages (router): ok');

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
