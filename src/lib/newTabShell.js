// "Open in new tab": the page the new tab shows.
//
// The tab is a blob: document, and a blob: document has the origin of the page
// that created it -- AppBlips itself. Generated code placed directly in it
// could read AppBlips' storage (the hosted sign-in session, a saved provider
// key, other projects) and call /api/chat as the user. So the tab holds only
// this trusted shell, and the generated page runs inside it in an iframe
// sandboxed WITHOUT allow-same-origin, exactly like the preview pane: an
// opaque origin that reaches the shell only through postMessage.
//
// The generated page carries the normal preview bridge (previewBridge.js),
// which shims storage and reports link clicks. The shell
// answers the part of that protocol a standalone tab needs:
//   - storage_set / storage_remove / storage_clear: kept in memory for the
//     tab's lifetime, seeded from the project's preview storage. Changes are
//     not written back to the project.
//   - navigate-page: swaps in another page of a multi-page site (the frame
//     never navigates itself), then scrolls to the link's #hash.
// Everything else the bridge posts (editing, nav-state, screenshots) is
// ignored here.
//
// Nothing secret is embedded: the data block holds only the pages and the
// project's preview storage.
import { injectPreviewBridge, BRIDGE_CHANNEL, BRIDGE_PROTOCOL_VERSION } from '../previewBridge.js';
import { LANDING_PAGE, pageTitle } from './pages.js';

const SCRIPT_CLOSE = '</' + 'script>';

// Same delegation the preview iframe gets, plus what a full tab reasonably
// needs (dialogs, downloads, pointer lock for games, links opening normal
// tabs). Never allow-same-origin or allow-top-navigation.
export const NEW_TAB_SANDBOX = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-pointer-lock';
const NEW_TAB_ALLOW = 'fullscreen; clipboard-write; autoplay';

const randomMarker = () => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

// Plain-string source, run as an inline script in the shell document. It
// must never contain a closing script tag sequence or a template placeholder.
const SHELL_SOURCE = `(function () {
  'use strict';
  var DATA = JSON.parse(document.getElementById('appblips-shell-data').textContent);
  var CHANNEL = DATA.channel;
  var VERSION = DATA.version;
  var frame = document.getElementById('appblips-app');
  var tokens = Object.create(null);
  var store = Object.create(null);
  var FORBIDDEN = Object.create(null);
  FORBIDDEN['__proto__'] = FORBIDDEN.constructor = FORBIDDEN.prototype = true;
  var pendingHash = '';

  // Cut the link back to the AppBlips tab that opened this one.
  try { window.opener = null; } catch (e) {}

  Object.keys(DATA.storage || {}).forEach(function (k) {
    if (!FORBIDDEN[k]) store[k] = String(DATA.storage[k]);
  });
  Object.keys(DATA.pages).forEach(function (name) { tokens[DATA.pages[name].token] = true; });

  function storageJson() {
    var plain = {};
    Object.keys(store).forEach(function (k) { plain[k] = store[k]; });
    return JSON.stringify(plain).replace(/[<]/g, '\\\\u003c');
  }

  function load(name, hash) {
    var page = DATA.pages[name];
    if (!page) return false;
    pendingHash = hash || '';
    frame.srcdoc = page.template.split(DATA.marker).join(storageJson());
    document.title = page.title || DATA.title;
    return true;
  }

  function send(token, type, payload) {
    try {
      frame.contentWindow.postMessage({ __orion: CHANNEL, v: VERSION, token: token, type: type, payload: payload }, '*');
    } catch (e) {}
  }

  function resolvePage(href) {
    if (typeof href !== 'string') return null;
    var raw = href.trim();
    if (!raw || raw.charAt(0) === '#' || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.indexOf('//') === 0) return null;
    var path = raw.split('#')[0].split('?')[0];
    if (path === '') return null;
    path = path.replace(/^([.][/])+/, '').replace(/^[/]+/, '');
    if (path === '') return DATA.landing;
    if (path.indexOf('/') !== -1) return null;
    if (!/[.]html$/.test(path)) path += '.html';
    return Object.prototype.hasOwnProperty.call(DATA.pages, path) ? path : null;
  }

  window.addEventListener('message', function (event) {
    // The frame's origin is opaque ("null"), so its WindowProxy is the check.
    if (event.source !== frame.contentWindow) return;
    var d = event.data;
    if (!d || d.__orion !== CHANNEL || !tokens[d.token]) return;
    var p = d.payload || {};
    if (d.type === 'ready') {
      if (pendingHash) send(d.token, 'scroll-to-hash', { hash: pendingHash });
      pendingHash = '';
    } else if (d.type === 'storage_set') {
      if (typeof p.key === 'string' && p.key && p.key.length <= 256 && !FORBIDDEN[p.key]) store[p.key] = String(p.value == null ? '' : p.value);
    } else if (d.type === 'storage_remove') {
      if (typeof p.key === 'string' && !FORBIDDEN[p.key]) delete store[p.key];
    } else if (d.type === 'storage_clear') {
      Object.keys(store).forEach(function (k) { delete store[k]; });
    } else if (d.type === 'navigate-page') {
      var href = typeof p.href === 'string' && p.href.length < 500 ? p.href : '';
      var target = resolvePage(href);
      if (target) load(target, href.indexOf('#') >= 0 ? href.slice(href.indexOf('#') + 1) : '');
    }
  });

  load(DATA.landing, '');
})();`;

if (SHELL_SOURCE.indexOf('</') !== -1 || SHELL_SOURCE.indexOf('${') !== -1) {
  throw new Error('newTabShell: shell source must not contain a closing tag or a template placeholder.');
}

/**
 * Builds the HTML for the new tab.
 *
 * @param {{
 *   files: Record<string, string>,   // page filename -> HTML, as stored in versions
 *   title?: string,
 *   initialStorage?: Record<string, string>,
 * }} options
 * @returns {string}
 */
export function buildNewTabShell({ files, title = 'Preview', initialStorage = {} }) {
  // The storage seed is substituted when each page loads, so a page opened
  // later sees what earlier pages saved. A random marker stands in for it;
  // generated code cannot know it in advance, so it cannot collide.
  const marker = `"appblips-storage-${randomMarker()}"`;
  const pages = {};
  for (const [name, html] of Object.entries(files || {})) {
    if (typeof html !== 'string' || !html) continue;
    const { srcDoc, token } = injectPreviewBridge(html, {
      initialStorage: { [marker]: '' },
    });
    // injectPreviewBridge serialized the seed as {"<marker>":""}; turn that
    // whole object into the marker the shell replaces.
    const seed = JSON.stringify({ [marker]: '' }).replace(/</g, '\\u003c');
    pages[name] = { template: srcDoc.split(seed).join(marker), token, title: pageTitle(html) };
  }
  const landing = pages[LANDING_PAGE] ? LANDING_PAGE : Object.keys(pages)[0] || LANDING_PAGE;

  const data = {
    channel: BRIDGE_CHANNEL,
    version: BRIDGE_PROTOCOL_VERSION,
    marker,
    pages,
    landing,
    title: String(title),
    storage: initialStorage && typeof initialStorage === 'object' ? initialStorage : {},
  };
  // "<" is escaped so no page can end the data block (or any script) early.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const safeTitle = String(title).replace(/[<>&"]/g, '');

  return '<!DOCTYPE html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + `<title>${safeTitle}</title>`
    + '<style>html,body{margin:0;height:100%;background:#fff}'
    + 'iframe{display:block;width:100%;height:100%;border:0}</style>'
    + '</head><body>'
    + `<iframe id="appblips-app" title="${safeTitle}" sandbox="${NEW_TAB_SANDBOX}" allow="${NEW_TAB_ALLOW}"></iframe>`
    + `<script type="application/json" id="appblips-shell-data">${json}${SCRIPT_CLOSE}`
    + `<script>${SHELL_SOURCE}${SCRIPT_CLOSE}`
    + '</body></html>';
}
