// Client-side page router for multi-page sites that ship all their pages in a
// single document: the password unlock wrapper (crypto.js, after decrypting the
// bundle) and the "open in new tab" preview shell. Both embed `siteStart`, which
// document.write()s the current page and swaps pages on internal link clicks.
//
// The source is a plain string, injected inside an inline <script>, so it must
// stay free of backslashes, template placeholders, and the literal closing-tag
// sequence (which would end the script early). `document.write(html);` keeps
// that exact spelling on purpose -- see injectAnalytics in functions/[[path]].js.
//
// pushState mode (deployed): pages live at /<slug>/<page-without-.html> and the
// slug comes from window.__APPBLIPS_SLUG__ (injected by the serving Function).
// Without pushState (blob: previews) routing is in-memory only.
export const SITE_ROUTER_SOURCE = `
function siteStart(pages, pushState) {
  var slug = window.__APPBLIPS_SLUG__ || '';
  var current = 'index.html';
  if (!slug) pushState = false;

  function pathFor(page) {
    var base = '/' + slug;
    return page === 'index.html' ? base : base + '/' + page.replace(/[.]html$/, '');
  }
  function pageFromLocation() {
    var p = location.pathname.replace(/^[/]+|[/]+$/g, '');
    try { p = decodeURIComponent(p); } catch (e) {}
    if (slug && p.indexOf(slug) === 0) p = p.slice(slug.length).replace(/^[/]+/, ''); else p = '';
    p = p.replace(/[.]html$/, '');
    return p ? p + '.html' : 'index.html';
  }
  function resolve(href) {
    if (typeof href !== 'string') return null;
    var raw = href.trim();
    if (!raw || raw.charAt(0) === '#' || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.indexOf('//') === 0) return null;
    var path = raw.split('#')[0].split('?')[0];
    if (path === '') return null;
    path = path.replace(/^([.][/])+/, '').replace(/^[/]+/, '');
    if (path === '') return 'index.html';
    if (path.indexOf('/') !== -1) return null;
    if (!/[.]html$/.test(path)) path += '.html';
    return /^[a-z0-9][a-z0-9-]{0,39}[.]html$/.test(path) ? path : null;
  }
  function hashOf(href) {
    var i = href.indexOf('#');
    return i >= 0 ? href.slice(i + 1) : '';
  }
  function scrollToHash(hash) {
    if (!hash) { window.scrollTo(0, 0); return; }
    var el = document.getElementById(hash);
    if (el && el.scrollIntoView) el.scrollIntoView();
  }
  function onClick(e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.hasAttribute('download') || (a.getAttribute('target') && a.getAttribute('target') !== '_self')) return;
    var href = a.getAttribute('href') || '';
    var page = resolve(href);
    if (!page || !Object.prototype.hasOwnProperty.call(pages, page)) return;
    var hash = hashOf(href);
    e.preventDefault();
    if (page === current) { scrollToHash(hash); return; }
    if (pushState) history.pushState(null, '', pathFor(page) + (hash ? '#' + hash : ''));
    render(page, hash);
  }
  function onPop() {
    var page = pageFromLocation();
    if (page !== current) render(page, location.hash.slice(1));
  }
  function render(page, hash) {
    if (!Object.prototype.hasOwnProperty.call(pages, page)) page = 'index.html';
    current = page;
    var html = pages[page];
    document.open();
    document.write(html);
    document.close();
    // document.open() discards this document's listeners, so re-attach.
    document.addEventListener('click', onClick, true);
    if (pushState) window.addEventListener('popstate', onPop);
    if (hash) scrollToHash(hash);
  }

  render(pushState ? pageFromLocation() : 'index.html', pushState ? location.hash.slice(1) : '');
}
`;

// A single self-contained HTML document that carries every page and routes
// between them in memory. Used for "open in new tab", where relative links to
// sibling pages would otherwise have nothing to resolve to.
export const buildSiteShell = (files, title = 'Preview') => {
  // "<" is escaped so no page can contain a sequence that ends the script early.
  const json = JSON.stringify(files).replace(/</g, '\\u003c');
  const safeTitle = String(title).replace(/[<>&"]/g, '');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${safeTitle}</title></head><body><script>
var SITE_PAGES = ${json};
${SITE_ROUTER_SOURCE}
siteStart(SITE_PAGES, false);
<${'/'}script></body></html>`;
};
