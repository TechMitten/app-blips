import { injectLoopProtection } from './lib/loopProtection.js';
import { compileJsxScripts } from './lib/jsxCompile.js';
import { BROWSER_RUNTIME_SOURCE } from './lib/browserRuntime.js';

/**
 * Preview bridge.
 *
 * The generated app runs in an origin-isolated iframe (`sandbox` without
 * `allow-same-origin`), so the parent can no longer reach into
 * `iframe.contentDocument`. Everything the parent used to do by touching the
 * frame's DOM now lives inside the frame, injected as a single inline script,
 * and is driven over `postMessage`.
 *
 * The script does several jobs:
 *
 *  1. Shims `localStorage` / `sessionStorage` / `document.cookie`. On an opaque
 *     origin these THROW `SecurityError` on mere access, which would kill the
 *     generated app's inline script at that line and leave a white screen.
 *     Generated apps hit this constantly -- the suggested prompts in the UI are
 *     "habit tracker", "to-do list", "budget tracker".
 *  2. Runs the mobile touch-scroll simulation (drag, momentum, click
 *     suppression) that used to live in an effect in App.jsx.
 *  3. On request, serializes the document (cloned markup + collected
 *     stylesheet text) for the screenshot-attachment feature. It deliberately
 *     does NOT rasterize to a canvas itself: nested `<iframe>`s created by
 *     script running inside this already-sandboxed-without-allow-same-origin
 *     frame are FORCIBLY sandboxed too (HTML's sandboxing propagates to any
 *     browsing context a sandboxed document creates, precisely so sandboxing
 *     can't be escaped by nesting another frame) and each gets a fresh,
 *     distinct opaque origin -- so any library that clones into a helper
 *     iframe to compute styles (html2canvas, dom-to-image, ...) throws
 *     "Blocked a frame with origin 'null' from accessing a cross-origin
 *     frame" the moment it reads that helper iframe's `.document`, no matter
 *     how it's created. This frame only has to reach that far; rasterizing
 *     the snapshot into a canvas happens in the PARENT window instead (see
 *     rasterizeDomSnapshot in src/lib/attachments.js), which is never
 *     sandboxed and hits none of this.
 *  4. Website-studio visual editing: hover/click element picking that
 *     reports a serialized description of the selected element to the
 *     parent over the same token-authenticated channel (message plumbing below).
 *     Text-bearing elements go straight into IN-PLACE editing instead:
 *     the element becomes contentEditable, the user types on the page,
 *     and the committed text is sent back for a deterministic source
 *     edit. The parent owns the actual editing UI and applies changes to
 *     the source; this side outlines, reports and hosts the typing.
 *
 * IMPORTANT: the bridge is spliced in at RENDER time only (see the `useMemo`
 * feeding the iframe's `srcDoc` in App.jsx) and is never written into
 * `generatedCode`. That keeps it out of downloads, the clipboard, the code
 * pane, and `orion-projects` -- and, most importantly, out of the reach of
 * `applySurgicalEdits`, whose fuzzy line-scan would otherwise happily match
 * inside bridge code and corrupt it on refinement.
 */

export const BRIDGE_CHANNEL = 'orion-preview-bridge';
export const BRIDGE_PROTOCOL_VERSION = 1;

const makeToken = () => {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  return 'tok-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
};

/**
 * The in-frame script, as source text.
 *
 * Written in ES5-ish style with string concatenation so it never needs a
 * backtick or a `${`, and so it parses even if a generated document does
 * something odd. `__ORION_TOKEN__` is substituted per render.
 */
const BRIDGE_SOURCE = `(function () {
  'use strict';

  var TOKEN = '__ORION_TOKEN__';
  // Imported codebases (studioMode 'codebase') are single-page React apps
  // whose router owns in-app links; see onLinkClick.
  var PROJECT_MODE = __ORION_PROJECT_MODE__;
  var CHANNEL = '${BRIDGE_CHANNEL}';
  var VERSION = ${BRIDGE_PROTOCOL_VERSION};
  ${BROWSER_RUNTIME_SOURCE}

  // Chromium refuses declarative autofocus in this deliberately opaque,
  // cross-origin preview frame and logs a warning for every generated input.
  // Strip only the preview DOM attribute before the browser's autofocus task
  // runs. The user's source is untouched, so exports retain
  // the requested autofocus behavior on their normal same-origin page.
  function removeBlockedAutofocus(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.hasAttribute && root.hasAttribute('autofocus')) root.removeAttribute('autofocus');
    if (root.querySelectorAll) {
      var autofocusNodes = root.querySelectorAll('[autofocus]');
      for (var autofocusIndex = 0; autofocusIndex < autofocusNodes.length; autofocusIndex += 1) {
        autofocusNodes[autofocusIndex].removeAttribute('autofocus');
      }
    }
  }

  var autofocusObserver = new MutationObserver(function (records) {
    for (var recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
      var record = records[recordIndex];
      if (record.type === 'attributes') removeBlockedAutofocus(record.target);
      for (var nodeIndex = 0; nodeIndex < record.addedNodes.length; nodeIndex += 1) {
        removeBlockedAutofocus(record.addedNodes[nodeIndex]);
      }
    }
  });
  autofocusObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['autofocus'],
    childList: true,
    subtree: true
  });

  function post(type, payload) {
    try {
      // targetOrigin '*' is required: this frame has an opaque origin and
      // cannot know the parent's. It is only acceptable because no message
      // in this protocol carries a secret. Do not add one.
      parent.postMessage(
        { __orion: CHANNEL, v: VERSION, token: TOKEN, type: type, payload: payload },
        '*'
      );
    } catch (err) { /* parent gone */ }
  }

  // ------------------------------------------------------------------
  // 1. Storage shim
  //
  // The probe is what makes this a no-op if origin isolation is ever
  // relaxed: if the real API works, we leave it completely alone.
  // In preview, localStorage is hydrated from the parent's persisted
  // snapshot and mutations are synchronized back over postMessage.
  // ------------------------------------------------------------------

  var INITIAL_STORAGE = __ORION_INITIAL_STORAGE__;

  function memStorage(initialData, isPersistent) {
    var m = Object.create(null);
    if (initialData && typeof initialData === 'object') {
      for (var k in initialData) {
        if (Object.prototype.hasOwnProperty.call(initialData, k)) {
          m[String(k)] = String(initialData[k]);
        }
      }
    }
    var api = {
      getItem: function (k) {
        k = String(k);
        return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null;
      },
      setItem: function (k, v) {
        var sk = String(k);
        var sv = String(v);
        m[sk] = sv;
        if (isPersistent) {
          post('storage_set', { key: sk, value: sv });
        }
      },
      removeItem: function (k) {
        var sk = String(k);
        delete m[sk];
        if (isPersistent) {
          post('storage_remove', { key: sk });
        }
      },
      clear: function () {
        m = Object.create(null);
        if (isPersistent) {
          post('storage_clear', {});
        }
      },
      key: function (i) {
        var ks = Object.keys(m);
        i = Number(i);
        return i >= 0 && i < ks.length ? ks[i] : null;
      }
    };
    Object.defineProperty(api, 'length', {
      get: function () { return Object.keys(m).length; }
    });
    return api;
  }

  function shimStorage(name, initialData, isPersistent) {
    try {
      // Touching .length is enough to trip the SecurityError.
      void window[name].length;
      return;
    } catch (probeErr) { /* opaque origin -- fall through and shim */ }
    var store = memStorage(initialData, isPersistent);
    try {
      Object.defineProperty(window, name, { value: store, configurable: true, writable: false });
      return;
    } catch (ownErr) { /* try the prototype instead */ }
    try {
      Object.defineProperty(Window.prototype, name, { value: store, configurable: true });
    } catch (protoErr) { /* nothing more we can do */ }
  }

  function shimCookie() {
    try {
      void document.cookie;
      return;
    } catch (probeErr) { /* opaque origin -- fall through and shim */ }
    var jar = '';
    var desc = {
      configurable: true,
      get: function () { return jar; },
      set: function (v) {
        var pair = String(v).split(';')[0];
        if (!pair) return jar;
        jar = jar ? jar + '; ' + pair : pair;
        return v;
      }
    };
    try {
      Object.defineProperty(document, 'cookie', desc);
      return;
    } catch (ownErr) { /* try the prototype instead */ }
    try {
      Object.defineProperty(Document.prototype, 'cookie', desc);
    } catch (protoErr) { /* nothing more we can do */ }
  }

  shimStorage('localStorage', INITIAL_STORAGE, true);
  shimStorage('sessionStorage', null, false);
  shimCookie();

  // ------------------------------------------------------------------
  // 2. Visual editing (website studio)
  //
  // When the parent enables editing, this frame becomes an element picker:
  // hover outlines the element under the cursor and click acts on it.
  // Text-bearing elements (headings, paragraphs -- links/buttons on
  // double-click) go straight into IN-PLACE editing: the element becomes
  // contentEditable, the user types on the page itself, and on commit a
  // serialized description captured BEFORE the typing (the original text
  // is the anchor the parent string-matches against) plus the new text
  // is posted as element-text-committed. The parent applies the change
  // to the source HTML and answers inline-edit-result; only a failure
  // (or a timeout) restores the original text here, so the frame and the
  // source never disagree for longer than one round trip. Non-text
  // elements select as before and the parent shows its editor panel;
  // this side never mutates the source -- outlines are inline styles,
  // typing is live-DOM only and always reverts unless the parent
  // confirms. Escape during in-place editing cancels the typing and
  // reports the element as selected (the panel's escape hatch, e.g. for
  // select-parent); select-parent walks the selection up one ancestor at
  // a time so containers (section backgrounds, wallpaper) can be reached
  // from their children. Dragging an element moves it (see "Drag to move"
  // below), in drag mode only.
  // ------------------------------------------------------------------

  var editingActive = false;
  var editHoveredEl = null;
  var editSelectedEl = null;
  var editStyleEl = null;
  var inlineEdit = null;
  var inlineHold = false;
  var inlineEditSequence = 0;
  var pendingCommits = [];

  var EDIT_HOVER_OUTLINE = '2px dashed rgba(57, 135, 208, 0.85)';
  var EDIT_SELECT_OUTLINE = '3px solid rgba(57, 135, 208, 1)';
  var EDIT_CURSOR_CSS = '* { cursor: crosshair !important; }';
  var DRAG_MODE_CURSOR_CSS = '* { cursor: grab !important; }';
  // Drag mode (the parent's secondary toggle): pressing and dragging moves
  // an element, and a click only selects -- no in-place text editing.
  var dragModeActive = false;

  function editCursorCss() { return dragModeActive ? DRAG_MODE_CURSOR_CSS : EDIT_CURSOR_CSS; }

  function isBridgeNode(el) {
    var node = el;
    while (node && node !== document.documentElement) {
      if (node.getAttribute && node.getAttribute('data-orion-bridge') === 'true') return true;
      node = node.parentElement;
    }
    return false;
  }

  function isSelectable(el) {
    if (!el || el.nodeType !== 1 || !el.tagName) return false;
    if (el === document.documentElement) return false;
    if (isBridgeNode(el)) return false;
    return true;
  }

  function saveOutline(el) {
    if (!el || el.__orionOutlineSaved) return;
    el.__orionOutlineSaved = { outline: el.style.outline, offset: el.style.outlineOffset, styleAttr: el.getAttribute('style') };
  }

  function restoreOutline(el) {
    if (!el || !el.__orionOutlineSaved) return;
    el.style.outline = el.__orionOutlineSaved.outline;
    el.style.outlineOffset = el.__orionOutlineSaved.offset;
    // Writing style properties re-serializes the whole style attribute
    // ("background:#fff" becomes "background: rgb(255, 255, 255);") and can
    // leave an empty style="". Put the author's exact string back -- the
    // parent matches reports against the source text -- unless the page has
    // changed the element's styles in the meantime.
    try {
      var savedAttr = el.__orionOutlineSaved.styleAttr;
      if (savedAttr == null) {
        if (el.style.length === 0) el.removeAttribute('style');
      } else {
        var probe = document.createElement('span');
        probe.setAttribute('style', savedAttr);
        if (probe.style.cssText === el.style.cssText) el.setAttribute('style', savedAttr);
      }
    } catch (attrErr) { /* keep the serialized form */ }
    el.__orionOutlineSaved = null;
  }

  function paintHover(el) {
    if (!el || el === editSelectedEl) return;
    saveOutline(el);
    el.style.outline = EDIT_HOVER_OUTLINE;
    el.style.outlineOffset = '1px';
  }

  function clearHover() {
    if (editHoveredEl && editHoveredEl !== editSelectedEl) restoreOutline(editHoveredEl);
    editHoveredEl = null;
  }

  function paintSelection(el) {
    if (!el) return;
    saveOutline(el);
    el.style.outline = EDIT_SELECT_OUTLINE;
    el.style.outlineOffset = '1px';
  }

  function clearSelection(notify) {
    if (editSelectedEl) restoreOutline(editSelectedEl);
    editSelectedEl = null;
    if (notify) post('element-deselected', {});
  }

  function detectRole(el) {
    var tag = el.tagName.toLowerCase();
    if (tag === 'img' || tag === 'picture' || tag === 'svg' || tag === 'video' || tag === 'canvas') return 'image';
    if (tag === 'a') return 'link';
    if (tag === 'button' || el.getAttribute('role') === 'button') return 'button';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'p' || tag === 'span' || tag === 'li' || tag === 'strong' || tag === 'em' ||
        tag === 'small' || tag === 'label' || tag === 'blockquote' || tag === 'figcaption' ||
        tag === 'td' || tag === 'th' || tag === 'dt' || tag === 'dd' || tag === 'time' ||
        tag === 'figcaption' || tag === 'code' || tag === 'pre') {
      return 'text';
    }
    return 'container';
  }

  function capString(str, n) {
    str = String(str == null ? '' : str);
    return str.length > n ? str.slice(0, n) : str;
  }

  function collapseText(el) {
    try {
      // Note: this lives inside a template literal -- backslashes must be
      // doubled or the frame receives a backslash-less regex.
      return capString(String(el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim(), 600);
    } catch (err) {
      return '';
    }
  }

  // The bridge paints hover/selection outlines through the element's inline
  // style, so the live style attribute (and every outerHTML that contains
  // it) differs from the source the parent has to match against. Reports are
  // built with the pre-paint style attributes temporarily put back.
  function withOriginalStyleAttrs(el, fn) {
    var painted = [];
    var nodes = [el];
    try {
      var all = el.querySelectorAll('*');
      for (var n = 0; n < all.length; n++) nodes.push(all[n]);
    } catch (qErr) { /* just the element itself */ }
    for (var i = 0; i < nodes.length; i++) {
      var saved = nodes[i].__orionOutlineSaved;
      if (!saved) continue;
      painted.push({ node: nodes[i], current: nodes[i].getAttribute('style') });
      if (saved.styleAttr == null) nodes[i].removeAttribute('style');
      else nodes[i].setAttribute('style', saved.styleAttr);
    }
    try {
      return fn();
    } finally {
      for (var j = 0; j < painted.length; j++) {
        if (painted[j].current == null) painted[j].node.removeAttribute('style');
        else painted[j].node.setAttribute('style', painted[j].current);
      }
    }
  }

  function buildElementDescription(el) {
    return withOriginalStyleAttrs(el, function () { return buildElementDescriptionRaw(el); });
  }

  // Current text formatting, for the parent's text toolbar. Computed values:
  // what the user actually sees, whatever mix of classes and inline style got
  // it there.
  function readTypography(el) {
    var cs = null;
    try { cs = window.getComputedStyle(el); } catch (csErr) { return null; }
    var weight = parseInt(cs.fontWeight, 10);
    if (isNaN(weight)) weight = cs.fontWeight === 'bold' ? 700 : 400;
    var align = cs.textAlign;
    if (align === 'start') align = 'left';
    else if (align === 'end') align = 'right';
    return {
      fontFamily: capString(cs.fontFamily, 300),
      fontSize: parseFloat(cs.fontSize) || 16,
      fontWeight: weight,
      fontStyle: cs.fontStyle === 'italic' || cs.fontStyle === 'oblique' ? 'italic' : 'normal',
      underline: String(cs.textDecorationLine || '').indexOf('underline') !== -1,
      textAlign: align,
      textTransform: cs.textTransform,
      color: capString(cs.color, 100),
      display: cs.display
    };
  }

  var REPORTED_ATTRS = ['src', 'srcset', 'href', 'target', 'rel', 'alt', 'title', 'aria-label', 'placeholder', 'type', 'class', 'style', 'id'];

  function readReportedAttributes(el) {
    var attributes = {};
    for (var i = 0; i < REPORTED_ATTRS.length; i++) {
      var name = REPORTED_ATTRS[i];
      var value;
      try { value = el.getAttribute(name); } catch (attrErr) { value = null; }
      if (value != null) attributes[name] = capString(value, name === 'class' || name === 'style' ? 3000 : 1500);
    }
    return attributes;
  }

  function fullTextOf(el) {
    try { return String(el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim(); } catch (textErr) { return ''; }
  }

  // Rank of this element among same-tag elements with identical visible
  // text (document order). Lets the parent pick the right source
  // occurrence when the text repeats (e.g. brand name in header + footer).
  function textRank(el, fullText) {
    var rank = { ordinal: -1, count: 0 };
    if (!fullText || fullText.length > 600) return rank;
    try {
      var sameTag = document.getElementsByTagName(el.tagName);
      if (sameTag.length > 3000) return rank;
      var wantedText = fullText.toLowerCase();
      for (var s = 0; s < sameTag.length; s++) {
        if (collapseText(sameTag[s]).toLowerCase() === wantedText) {
          if (sameTag[s] === el) rank.ordinal = rank.count;
          rank.count++;
        }
      }
    } catch (ordErr) { return { ordinal: -1, count: 0 }; }
    return rank;
  }

  // Rank among ALL same-tag elements (bridge nodes excluded). The parent
  // uses it as a last resort to find text-less elements (spacers, images
  // without a unique src, huge sections) and only when its own source count
  // agrees.
  function tagRank(el) {
    var rank = { ordinal: -1, count: 0 };
    try {
      var same = document.getElementsByTagName(el.tagName);
      if (same.length > 5000) return rank;
      for (var i = 0; i < same.length; i++) {
        if (isBridgeNode(same[i])) continue;
        if (same[i] === el) rank.ordinal = rank.count;
        rank.count++;
      }
    } catch (rankErr) { return { ordinal: -1, count: 0 }; }
    return rank;
  }

  // Leading textContent (hidden descendants included), which the parent
  // checks a rank-only match against.
  function rawTextOf(el) {
    try { return capString(String(el.textContent || '').replace(/\\s+/g, ' ').trim(), 200); } catch (rawErr) { return ''; }
  }

  // Just enough of an element for the parent to locate it in the source:
  // what a sibling needs for move-up / move-down.
  function describeLite(el) {
    return withOriginalStyleAttrs(el, function () {
      var fullText = fullTextOf(el);
      var outerFull = '';
      try { outerFull = el.outerHTML || ''; } catch (outerErr) { outerFull = ''; }
      var tr = textRank(el, fullText);
      var gr = tagRank(el);
      return {
        tag: el.tagName.toLowerCase(),
        role: detectRole(el),
        text: capString(fullText, 600),
        textTruncated: fullText.length > 600,
        rawText: rawTextOf(el),
        textOrdinal: tr.ordinal,
        textCount: tr.count,
        tagOrdinal: gr.ordinal,
        tagCount: gr.count,
        attributes: readReportedAttributes(el),
        outerHTML: capString(outerFull, 4000),
        outerHTMLTruncated: outerFull.length > 4000
      };
    });
  }

  var NON_SIBLING_TAGS = { SCRIPT: 1, STYLE: 1, TEMPLATE: 1, LINK: 1, META: 1, NOSCRIPT: 1 };

  // Nearest element sibling in direction dir that is real page content.
  function contentSibling(el, dir) {
    var node = dir < 0 ? el.previousElementSibling : el.nextElementSibling;
    while (node && (NON_SIBLING_TAGS[node.tagName] || isBridgeNode(node))) {
      node = dir < 0 ? node.previousElementSibling : node.nextElementSibling;
    }
    return node || null;
  }

  function buildElementDescriptionRaw(el) {
    var tag = el.tagName.toLowerCase();
    var attributes = readReportedAttributes(el);

    var computed = null;
    try { computed = window.getComputedStyle(el); } catch (styleErr) { computed = null; }

    var rect = null;
    try {
      var box = el.getBoundingClientRect();
      rect = { x: box.left, y: box.top, width: box.width, height: box.height };
    } catch (rectErr) { rect = null; }

    var fullText = fullTextOf(el);

    var outerFull = '';
    try { outerFull = el.outerHTML || ''; } catch (outerErr) { outerFull = ''; }

    var parent = el.parentElement || null;
    var parentSelectable = false;
    var parentTag = null;
    var parentText = null;
    if (parent && parent !== document.documentElement) {
      parentTag = parent.tagName ? parent.tagName.toLowerCase() : null;
      parentSelectable = true;
      parentText = collapseText(parent);
    }

    var childIndex = -1;
    if (parent && parent.children) {
      for (var c = 0; c < parent.children.length; c++) {
        if (parent.children[c] === el) { childIndex = c; break; }
      }
    }

    var tr = textRank(el, fullText);
    var gr = tagRank(el);
    var isRoot = tag === 'html' || tag === 'head' || tag === 'body';
    var prevSib = isRoot ? null : contentSibling(el, -1);
    var nextSib = isRoot ? null : contentSibling(el, 1);

    var payload = {
      tag: tag,
      role: detectRole(el),
      textOrdinal: tr.ordinal,
      textCount: tr.count,
      tagOrdinal: gr.ordinal,
      tagCount: gr.count,
      text: capString(fullText, 600),
      rawText: rawTextOf(el),
      textTruncated: fullText.length > 600,
      attributes: attributes,
      backgroundColor: computed ? capString(computed.backgroundColor, 100) : null,
      backgroundImage: computed && computed.backgroundImage && computed.backgroundImage !== 'none'
        ? capString(computed.backgroundImage, 500)
        : null,
      color: computed ? capString(computed.color, 100) : null,
      outerHTML: capString(outerFull, 4000),
      outerHTMLTruncated: outerFull.length > 4000,
      parentTag: parentTag,
      parentSelectable: parentSelectable,
      parentText: parentText,
      childIndex: childIndex,
      typography: readTypography(el),
      boundingBox: rect,
      prevSibling: prevSib ? describeLite(prevSib) : null,
      nextSibling: nextSib ? describeLite(nextSib) : null,
      scroll: { x: window.pageXOffset || 0, y: window.pageYOffset || 0 }
    };
    return payload;
  }

  function describeElement(el) {
    post('element-selected', buildElementDescription(el));
  }

  // --- In-place text editing -------------------------------------------
  //
  // The snapshot is taken BEFORE the user types: the parent's deterministic
  // engine anchors on the ORIGINAL text/outerHTML, so the committed payload
  // carries that snapshot untouched plus the new text. Reverting restores
  // the saved innerHTML string (live childNodes would have been mutated in
  // place by the typing itself).

  function restoreInlineEntry(entry) {
    try { entry.el.innerHTML = entry.origHtml; } catch (rErr) { /* element gone */ }
    // Live-previewed formatting goes back to the author's inline values.
    try {
      for (var prop in entry.origInline) {
        if (Object.prototype.hasOwnProperty.call(entry.origInline, prop)) entry.el.style[prop] = entry.origInline[prop];
      }
    } catch (fErr) { /* element gone */ }
  }

  // Text formatting from the parent's toolbar, previewed live on the editing
  // element and reported with the commit (the parent writes it to source).
  var FORMAT_PROPS = {
    fontFamily: 1, fontSize: 1, fontWeight: 1, fontStyle: 1,
    textDecorationLine: 1, textAlign: 1, textTransform: 1, color: 1
  };

  function refocusInline(entry) {
    try {
      entry.el.focus({ preventScroll: true });
      var sel = window.getSelection();
      if (sel && entry.savedRange) {
        sel.removeAllRanges();
        sel.addRange(entry.savedRange);
      }
    } catch (fErr) { /* no caret this round */ }
  }

  function applyInlineFormat(styles) {
    var entry = inlineEdit;
    if (!entry || !styles || typeof styles !== 'object') return;
    for (var prop in styles) {
      if (!Object.prototype.hasOwnProperty.call(styles, prop) || !FORMAT_PROPS[prop]) continue;
      var value = String(styles[prop] == null ? '' : styles[prop]).slice(0, 200);
      if (!value || /[;{}<>]/.test(value)) continue;
      if (!Object.prototype.hasOwnProperty.call(entry.origInline, prop)) entry.origInline[prop] = entry.el.style[prop];
      entry.el.style[prop] = value;
      entry.formatStyles[prop] = value;
    }
    recordInlineSnapshot(entry);
    refocusInline(entry);
    post('inline-typography', readTypography(entry.el));
  }

  // Session undo/redo. The browser's own undo stack knows nothing about the
  // formatting previewed through element styles, so the session keeps its
  // own snapshots (markup + applied formatting): one after every format
  // change and one a moment after typing pauses.
  function snapshotOf(entry) {
    return { html: entry.el.innerHTML, fmt: JSON.stringify(entry.formatStyles) };
  }

  function postInlineHistory(entry) {
    post('inline-history', { canUndo: entry.histIndex > 0, canRedo: entry.histIndex < entry.history.length - 1 });
  }

  function recordInlineSnapshot(entry) {
    if (entry.histTimer) { clearTimeout(entry.histTimer); entry.histTimer = null; }
    var snap = snapshotOf(entry);
    var top = entry.history[entry.histIndex];
    if (top && top.html === snap.html && top.fmt === snap.fmt) return;
    entry.history = entry.history.slice(0, entry.histIndex + 1);
    entry.history.push(snap);
    if (entry.history.length > 100) entry.history.shift();
    entry.histIndex = entry.history.length - 1;
    postInlineHistory(entry);
  }

  function stepInlineHistory(dir) {
    var entry = inlineEdit;
    if (!entry) return;
    recordInlineSnapshot(entry); // fold in typing that has not settled yet
    var next = entry.histIndex + dir;
    if (next < 0 || next >= entry.history.length) return;
    entry.histIndex = next;
    var snap = entry.history[next];
    entry.el.innerHTML = snap.html;
    var want = {};
    try { want = JSON.parse(snap.fmt); } catch (jErr) { want = {}; }
    var props = {};
    var k;
    for (k in entry.formatStyles) if (Object.prototype.hasOwnProperty.call(entry.formatStyles, k)) props[k] = 1;
    for (k in want) if (Object.prototype.hasOwnProperty.call(want, k)) props[k] = 1;
    for (k in props) {
      if (Object.prototype.hasOwnProperty.call(want, k)) {
        entry.el.style[k] = want[k];
        entry.formatStyles[k] = want[k];
      } else {
        entry.el.style[k] = Object.prototype.hasOwnProperty.call(entry.origInline, k) ? entry.origInline[k] : '';
        delete entry.formatStyles[k];
      }
    }
    try {
      entry.el.focus({ preventScroll: true });
      var range = document.createRange();
      range.selectNodeContents(entry.el);
      range.collapse(false);
      var sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      entry.savedRange = range.cloneRange();
    } catch (cErr) { /* no caret this round */ }
    postInlineHistory(entry);
    post('inline-typography', readTypography(entry.el));
  }

  function teardownInline(entry) {
    if (entry.blurTimer) { clearTimeout(entry.blurTimer); entry.blurTimer = null; }
    inlineHold = false;
    entry.el.removeEventListener('blur', entry.onBlur);
    entry.el.removeEventListener('focus', entry.onFocus);
    entry.el.removeEventListener('input', entry.onInput);
    if (entry.histTimer) { clearTimeout(entry.histTimer); entry.histTimer = null; }
    entry.el.removeEventListener('paste', entry.onPaste, true);
    document.removeEventListener('selectionchange', entry.onSelectionChange);
    document.removeEventListener('pointerdown', entry.onDocPointerDown, true);
    try {
      if (entry.origContentEditable != null) entry.el.setAttribute('contenteditable', entry.origContentEditable);
      else entry.el.removeAttribute('contenteditable');
    } catch (ceErr) { /* keep going */ }
    try {
      if (entry.origSpellcheck != null) entry.el.setAttribute('spellcheck', entry.origSpellcheck);
      else entry.el.removeAttribute('spellcheck');
    } catch (scErr) { /* keep going */ }
    try {
      // Undoes stabilizeInlineHost's pinned white-space ('' clears it).
      entry.el.style.whiteSpace = entry.origWhiteSpace || '';
    } catch (wsErr) { /* keep going */ }
    try { entry.el.style.caretColor = entry.origCaretColor || ''; } catch (caretErr) { /* keep going */ }
    if (inlineEdit === entry) inlineEdit = null;
    paintSelection(entry.el);
    post('inline-edit-ended', {});
  }

  // Walks the edit back out: original markup restored, nothing reported.
  function abortInlineEdit() {
    var entry = inlineEdit;
    if (!entry) return;
    teardownInline(entry);
    restoreInlineEntry(entry);
  }

  // commit=true sends the change to the parent; false cancels (restore) and,
  // with openPanel, reports the element as selected so the parent's panel
  // (select-parent, Edit-with-AI) is reachable from a text element.
  function finishInlineEdit(commit, openPanel) {
    var entry = inlineEdit;
    if (!entry) return;
    if (!commit) {
      teardownInline(entry);
      restoreInlineEntry(entry);
      if (openPanel) describeElement(entry.el);
      else restoreOutline(entry.el);
      return;
    }
    var newText = '';
    try {
      newText = String(entry.el.innerText || entry.el.textContent || '').replace(/\\s+/g, ' ').trim();
    } catch (tErr) { newText = ''; }
    teardownInline(entry);
    var hasFormat = Object.keys(entry.formatStyles).length > 0;
    if (!newText) { restoreInlineEntry(entry); restoreOutline(entry.el); return; }
    if (newText === entry.snapshot.text && !hasFormat) { restoreOutline(entry.el); return; }

    var editId = ++inlineEditSequence;
    var pending = { id: editId, el: entry.el, origHtml: entry.origHtml, origInline: entry.origInline, timer: null };
    // If the parent never answers (bug, tab hidden forever, teardown race),
    // revert on our own so the frame cannot keep showing text the source
    // does not have.
    pending.timer = setTimeout(function () { resolveInlineEdit(false, editId); }, 3000);
    pendingCommits.push(pending);

    var payload = {};
    for (var k in entry.snapshot) {
      if (Object.prototype.hasOwnProperty.call(entry.snapshot, k)) payload[k] = entry.snapshot[k];
    }
    payload.newText = newText;
    payload.styles = entry.formatStyles;
    payload.editId = editId;
    payload.scroll = { x: window.pageXOffset || 0, y: window.pageYOffset || 0 };
    post('element-text-committed', payload);
  }

  // Parent's verdict on a committed inline edit. The parent echoes editId,
  // so a failure restores exactly the right element even if the user has
  // already started another edit. Unknown ids are ignored: the entry was
  // already reverted by the timeout.
  function resolveInlineEdit(ok, editId) {
    var idx = -1;
    for (var i = 0; i < pendingCommits.length; i++) {
      if (pendingCommits[i].id === editId) { idx = i; break; }
    }
    if (idx === -1) return;
    var entry = pendingCommits.splice(idx, 1)[0];
    if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
    if (!ok) restoreInlineEntry(entry);
  }

  // Editing hosts render whitespace differently from static text: Blink
  // paints a typing host with pre-wrap semantics, so pretty-printed source
  // indentation (newline + spaces around the text) -- which normal
  // white-space collapsing renders as nothing -- suddenly occupies real
  // space, and the text visibly shifts (right/off-center, a line down) the
  // moment the element becomes editable. The internal pre-wrap cannot be
  // overridden by an author white-space value, so the whitespace itself is
  // what has to go: every text node in the subtree is collapsed to normal
  // white-space semantics (runs -> one space, document-order leading and
  // trailing runs removed), which renders identically to the static view
  // under BOTH normal and pre-wrap. Preformatted subtrees keep their
  // significant whitespace. The original markup is safe in entry.origHtml
  // (restored on cancel/failure), and the parent's match snapshot was taken
  // before any of this runs.
  var WS_SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, PRE: 1 };

  function collectEditingTextNodes(root) {
    var out = [];
    var walk = function (node) {
      for (var child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 3) {
          out.push(child);
        } else if (child.nodeType === 1 && !WS_SKIP_TAGS[child.nodeName]) {
          var ws = '';
          try { ws = window.getComputedStyle(child).whiteSpace || ''; } catch (wsErr) { ws = ''; }
          if (ws !== 'pre' && ws !== 'pre-wrap' && ws !== 'break-spaces') walk(child);
        }
      }
    };
    walk(root);
    return out;
  }

  // The text nodes must be collected BEFORE the element becomes a contenteditable
  // host: afterwards every descendant inherits the host's pre-wrap, so
  // collectEditingTextNodes would skip nested inline elements as
  // "preformatted" and the first/last trims would eat real spaces (the space
  // in a "Ray's " text node followed by an inline element).
  function stabilizeInlineHost(el, hostWhiteSpace, nodes) {
    // The caller reads this BEFORE entering edit mode: once the element is a
    // contenteditable host, Blink's UA style already reports pre-wrap, so
    // reading it here would always look preformatted and skip the fix.
    if (hostWhiteSpace !== 'normal' && hostWhiteSpace !== 'nowrap') return;
    // Best effort only: Blink keeps rendering the host as pre-wrap even with
    // an author value, which is exactly why the DOM is normalized below.
    el.style.whiteSpace = hostWhiteSpace;
    try {
      for (var i = 0; i < nodes.length; i++) {
        var value = nodes[i].nodeValue;
        var collapsed = value.replace(/\\s+/g, ' ');
        if (i === 0) collapsed = collapsed.replace(/^ /, '');
        if (i === nodes.length - 1) collapsed = collapsed.replace(/ $/, '');
        if (collapsed === value) continue;
        if (collapsed === '' && nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
        else nodes[i].nodeValue = collapsed;
      }
    } catch (trimErr) { /* worst case is the pre-fix shift, never a crash */ }
  }

  // The caret defaults to the text color, which makes it invisible whenever
  // the text is transparent (gradient/clipped text), matches its background,
  // or the page sets caret-color itself. Picks a caret color that is visible
  // for the edit session; the caller restores the inline value afterwards.
  var caretCtx = null;
  function parseCssColor(value) {
    try {
      if (!caretCtx) {
        var canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        caretCtx = canvas.getContext('2d', { willReadFrequently: true });
      }
      caretCtx.clearRect(0, 0, 1, 1);
      caretCtx.fillStyle = '#000';
      caretCtx.fillStyle = value;
      caretCtx.fillRect(0, 0, 1, 1);
      var d = caretCtx.getImageData(0, 0, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
    } catch (colorErr) { return null; }
  }

  function relLuminance(c) {
    var lin = function (v) { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  }

  // First mostly-opaque background color behind the element. Returns null
  // when an image/gradient is hit first (unknowable), white when nothing
  // paints (the canvas default).
  function effectiveBackground(el) {
    var node = el;
    while (node && node.nodeType === 1) {
      var cs = window.getComputedStyle(node);
      var bg = parseCssColor(cs.backgroundColor);
      if (bg && bg.a >= 0.5) return bg;
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      node = node.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }

  // An opaque text color is the most reliable caret: it was chosen to be
  // readable against whatever actually paints behind it, which the
  // ancestor walk cannot see (absolutely positioned images/overlays,
  // pseudo-elements). Only transparent text falls back to guessing from
  // the background.
  function chooseCaretColor(el) {
    try {
      var cs = window.getComputedStyle(el);
      var text = parseCssColor(cs.color);
      var textVisible = !!text && text.a >= 0.5;
      if (cs.caretColor && cs.caretColor !== 'auto') {
        var own = parseCssColor(cs.caretColor);
        var ownVisible = !!own && own.a >= 0.5;
        if (ownVisible && textVisible && own.r === text.r && own.g === text.g && own.b === text.b) return null;
        if (textVisible) return cs.color;
        if (ownVisible) return null;
      } else if (textVisible) {
        return null;
      }
      var bg = effectiveBackground(el);
      if (!bg) return '#3987d0';
      return relLuminance(bg) > 0.4 ? '#000000' : '#ffffff';
    } catch (caretErr) { return null; }
  }

  // Text-bearing roles only (defense in depth for the dblclick path):
  // containers/images report descendant text that would pass the text
  // checks, but flattening a whole section is never what a click
  // means. Returns false (caller falls back to select + panel) when the
  // element cannot be anchored deterministically: no text, text over the
  // report cap, or a form control.
  // Collapsed range at the clicked point, so entering edit mode puts the
  // caret where the user clicked instead of selecting all the text. Null
  // when there is no point or it resolves outside the element.
  function caretRangeAtPoint(el, point) {
    if (!point) return null;
    try {
      var range = null;
      if (document.caretPositionFromPoint) {
        var pos = document.caretPositionFromPoint(point.x, point.y);
        if (pos && pos.offsetNode) {
          range = document.createRange();
          range.setStart(pos.offsetNode, pos.offset);
        }
      } else if (document.caretRangeFromPoint) {
        range = document.caretRangeFromPoint(point.x, point.y);
      }
      if (!range || !el.contains(range.startContainer)) return null;
      range.collapse(true);
      return range;
    } catch (pointErr) { return null; }
  }

  function tryStartInlineEdit(el, point) {
    if (inlineEdit || !editingActive) return false;
    if (!isSelectable(el)) return false;
    var role = detectRole(el);
    if (role !== 'heading' && role !== 'text' && role !== 'link' && role !== 'button') return false;
    var tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'option') return false;
    var snapshot = buildElementDescription(el);
    if (!snapshot.text || snapshot.textTruncated) return false;
    if (el.isContentEditable) return false;

    // Must be read before contentEditable turns the element into a host
    // (see stabilizeInlineHost).
    var hostWhiteSpace = '';
    try { hostWhiteSpace = window.getComputedStyle(el).whiteSpace || ''; } catch (wsErr) { hostWhiteSpace = ''; }
    var editTextNodes = [];
    if (hostWhiteSpace === 'normal' || hostWhiteSpace === 'nowrap') editTextNodes = collectEditingTextNodes(el);

    var entry = {
      el: el,
      snapshot: snapshot,
      origHtml: el.innerHTML,
      origContentEditable: el.getAttribute('contenteditable'),
      origSpellcheck: el.getAttribute('spellcheck'),
      origWhiteSpace: el.style.whiteSpace,
      origCaretColor: el.style.caretColor,
      formatStyles: {},
      origInline: {},
      history: [],
      histIndex: 0,
      histTimer: null,
      onInput: null,
      savedRange: null,
      blurTimer: null,
      onBlur: null,
      onFocus: null,
      onSelectionChange: null,
      onDocPointerDown: null,
      onPaste: null
    };
    try { el.contentEditable = 'plaintext-only'; } catch (ceErr) { /* unsupported value */ }
    try {
      if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
    } catch (ceErr2) { return false; }
    el.setAttribute('spellcheck', 'false');
    // Before focusing: the caret and hint chip should be placed against the
    // stabilized layout, not the pre-edit one.
    stabilizeInlineHost(el, hostWhiteSpace, editTextNodes);
    var caretColor = chooseCaretColor(el);
    if (caretColor) el.style.caretColor = caretColor;
    try {
      el.focus();
      var range = caretRangeAtPoint(el, point);
      if (!range) {
        range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
      }
      var sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch (focusErr) { /* no caret this round */ }
    paintSelection(el);
    // Blur commits after a short grace period: a click on the parent's text
    // toolbar moves focus out of this frame, and the toolbar's hold message
    // (or focus coming straight back) must be able to cancel the commit.
    entry.onBlur = function () {
      if (entry.blurTimer) clearTimeout(entry.blurTimer);
      entry.blurTimer = setTimeout(function () {
        entry.blurTimer = null;
        if (inlineEdit !== entry || inlineHold) return;
        finishInlineEdit(true, false);
      }, 180);
    };
    entry.onFocus = function () {
      if (entry.blurTimer) { clearTimeout(entry.blurTimer); entry.blurTimer = null; }
    };
    entry.onInput = function () {
      if (entry.histTimer) clearTimeout(entry.histTimer);
      entry.histTimer = setTimeout(function () { entry.histTimer = null; recordInlineSnapshot(entry); }, 400);
    };
    entry.onSelectionChange = function () {
      try {
        var sel = window.getSelection();
        if (sel && sel.rangeCount && entry.el.contains(sel.anchorNode)) entry.savedRange = sel.getRangeAt(0).cloneRange();
      } catch (rangeErr) { /* keep the previous range */ }
    };
    // With the toolbar holding the session, a click back on the page ends the
    // hold: outside the element it commits (the blur already happened).
    entry.onDocPointerDown = function (e) {
      if (!inlineHold) return;
      inlineHold = false;
      if (!entry.el.contains(e.target)) finishInlineEdit(true, false);
    };
    entry.onPaste = function (e) {
      // Plain text only: the parent's engine swaps flat text, so rich
      // pasted markup would be discarded on apply anyway.
      e.preventDefault();
      e.stopPropagation();
      var text = '';
      try { text = (e.clipboardData && e.clipboardData.getData('text/plain')) || ''; } catch (cdErr) { text = ''; }
      if (text) {
        try { document.execCommand('insertText', false, text); } catch (execErr) { /* best effort */ }
      }
    };
    el.addEventListener('blur', entry.onBlur);
    el.addEventListener('focus', entry.onFocus);
    el.addEventListener('input', entry.onInput);
    el.addEventListener('paste', entry.onPaste, true);
    entry.history = [snapshotOf(entry)];
    document.addEventListener('selectionchange', entry.onSelectionChange);
    document.addEventListener('pointerdown', entry.onDocPointerDown, true);
    inlineEdit = entry;
    post('inline-edit-started', snapshot);
    return true;
  }

  function editOnMouseOver(e) {
    // No hover outlines while a text session is live: the caret's own
    // focus outline is the only visual state that matters there.
    if (!editingActive || inlineEdit || (drag && drag.active)) return;
    var el = e.target;
    if (!isSelectable(el)) return;
    // Drag mode outlines what a drag from here would move.
    if (dragModeActive) {
      el = editSelectedEl && editSelectedEl.contains(el) ? editSelectedEl : promoteToBlock(el);
      if (!isSelectable(el)) return;
    }
    if (el === editHoveredEl) return;
    clearHover();
    editHoveredEl = el;
    paintHover(el);
  }

  function editOnMouseOut(e) {
    if (!editingActive) return;
    // In drag mode the outlined element can be an ancestor of the one the
    // pointer leaves, so clear only when the pointer leaves the outline.
    if (dragModeActive) {
      if (editHoveredEl && !(e.relatedTarget && editHoveredEl.contains(e.relatedTarget))) clearHover();
      return;
    }
    if (e.target === editHoveredEl) clearHover();
  }

  function editOnClick(e) {
    if (dragSuppressClick) {
      dragSuppressClick = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (!editingActive) return;
    var el = e.target;
    if (inlineEdit) {
      // Clicks inside the live editor keep their default caret behavior;
      // stopPropagation only keeps page scripts out of the typing session.
      if (inlineEdit.el === el || inlineEdit.el.contains(el)) {
        e.stopPropagation();
        return;
      }
      // Clicks outside: focus already moved, so the editor's blur handler
      // has committed (or will as the focus settles); fall through and let
      // this click select as usual.
    }
    if (!isSelectable(el)) return;
    // Capture phase + both stops: the page must not react to selection
    // clicks (no link navigation, no toggles) while picking.
    e.preventDefault();
    e.stopPropagation();
    clearHover();
    // Headings and plain text edit in place; everything else (images,
    // link/button URLs, section backgrounds) opens the parent's editor
    // panel. Links and buttons also edit in place -- via double-click.
    var role = detectRole(el);
    if (dragModeActive) {
      // Select what a drag would move (a paragraph, not a word in it).
      var block = promoteToBlock(el);
      if (isSelectable(block)) el = block;
    } else if ((role === 'heading' || role === 'text') && tryStartInlineEdit(el, { x: e.clientX, y: e.clientY })) {
      return;
    }
    if (editSelectedEl && editSelectedEl !== el) restoreOutline(editSelectedEl);
    editSelectedEl = el;
    paintSelection(el);
    describeElement(el);
  }

  // Links and buttons select on the first click (the panel owns their URL)
  // and edit their text in place on the second.
  function editOnDblClick(e) {
    if (!editingActive || dragModeActive || inlineEdit) return;
    var el = e.target;
    if (!isSelectable(el)) return;
    var role = detectRole(el);
    if (role !== 'link' && role !== 'button') return;
    e.preventDefault();
    e.stopPropagation();
    clearHover();
    tryStartInlineEdit(el, { x: e.clientX, y: e.clientY });
  }

  function editOnKeyDown(e) {
    if (!editingActive) return;
    if (drag && drag.active && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      endDrag(false);
      return;
    }
    if (inlineEdit) {
      // While an IME composition is live, Enter/Escape belong to it.
      if (e.isComposing) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        var lower = String(e.key || '').toLowerCase();
        if (lower === 'z' || lower === 'y') {
          e.preventDefault();
          e.stopPropagation();
          stepInlineHistory(lower === 'y' || e.shiftKey ? 1 : -1);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finishInlineEdit(false, true);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        finishInlineEdit(true, false);
      }
      // Everything else belongs to the caret/IME.
      return;
    }
    if (e.key === 'Escape' && editSelectedEl) {
      clearSelection(true);
      return;
    }
    // Structure shortcuts for the selected element, and undo/redo (the
    // parent's own shortcut cannot see keys while focus is in this frame).
    // The parent applies them to the source; this side only reports.
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return;
    var mod = (e.ctrlKey || e.metaKey) && !e.altKey;
    var key = String(e.key || '');
    var lowerKey = key.toLowerCase();
    var action = null;
    if (mod && (lowerKey === 'z' || lowerKey === 'y')) {
      action = lowerKey === 'y' || e.shiftKey ? 'redo' : 'undo';
    } else if (editSelectedEl) {
      if ((key === 'Delete' || key === 'Backspace') && !e.ctrlKey && !e.metaKey && !e.altKey) action = 'delete';
      else if (mod && lowerKey === 'd') action = 'duplicate';
      else if (e.altKey && !e.ctrlKey && !e.metaKey && key === 'ArrowUp') action = 'move-up';
      else if (e.altKey && !e.ctrlKey && !e.metaKey && key === 'ArrowDown') action = 'move-down';
    }
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    post('element-shortcut', { action: action });
  }

  // --- Drag to move ------------------------------------------------------
  // Drag mode only (see dragModeActive). Press on an element and drag it
  // past a small threshold to move it. An insertion line shows where it
  // will land: before or after the element under the pointer, in normal
  // page flow (nothing is absolutely positioned). A press that never
  // crosses the threshold stays a click, which in drag mode only selects
  // (no in-place typing), so select-parent still works. Like every other
  // edit this side only reports: element-drop carries the dragged element's
  // snapshot plus a lite snapshot of the drop target, and the parent moves
  // the source. Pressing inside the selected element drags the selection,
  // which is how a container reached with select-parent gets moved.

  var DRAG_THRESHOLD = 6;
  var DRAG_EDGE = 48;
  var DRAG_CSS = '* { cursor: grabbing !important; -webkit-user-select: none !important; user-select: none !important; }';
  var PHRASING_PARENT_ROLES = { heading: 1, text: 1, link: 1, button: 1 };
  var REPLACED_TAGS = { IMG: 1, SVG: 1, PICTURE: 1, VIDEO: 1, CANVAS: 1, IFRAME: 1 };
  var STRUCTURED_TAGS = { LI: 1, DT: 1, DD: 1, TR: 1, TD: 1, TH: 1, THEAD: 1, TBODY: 1, TFOOT: 1, OPTION: 1 };
  var STRUCTURED_PARENTS = { UL: 1, OL: 1, MENU: 1, DL: 1, TABLE: 1, THEAD: 1, TBODY: 1, TFOOT: 1, TR: 1, SELECT: 1, DATALIST: 1 };
  var drag = null;
  var dragSuppressClick = false;

  function upperTag(el) { return String((el && el.tagName) || '').toUpperCase(); }

  function isInlineBox(el) {
    try { return window.getComputedStyle(el).display === 'inline'; } catch (dErr) { return false; }
  }

  // Words inside running text (a strong, an inline link, an icon in a
  // heading) move with their paragraph rather than out of it, and a click
  // on an SVG's inner shape moves the whole graphic.
  function promoteToBlock(el) {
    var node = el;
    try {
      var svg = node.closest ? node.closest('svg') : null;
      if (svg) node = svg;
    } catch (svgErr) { /* keep the hit */ }
    while (node && node.parentElement && node.parentElement !== document.body &&
           !REPLACED_TAGS[upperTag(node)] && isInlineBox(node) &&
           PHRASING_PARENT_ROLES[detectRole(node.parentElement)]) {
      node = node.parentElement;
    }
    return node;
  }

  function isMovable(el) {
    if (!isSelectable(el) || !document.body || el === document.body) return false;
    var tag = upperTag(el);
    if (tag === 'HTML' || tag === 'HEAD' || tag === 'BODY' || NON_SIBLING_TAGS[tag]) return false;
    return document.body.contains(el);
  }

  function dragSubjectFor(target) {
    if (!target || target.nodeType !== 1) return null;
    if (editSelectedEl && editSelectedEl.contains(target) && isMovable(editSelectedEl)) return editSelectedEl;
    var el = promoteToBlock(target);
    return isMovable(el) ? el : null;
  }

  // Keeps lists and tables valid: list items only among list items, cells
  // only among cells, and nothing else dropped between them.
  function structureAllows(dragged, target) {
    var dt = upperTag(dragged);
    var tt = upperTag(target);
    if (STRUCTURED_TAGS[dt] || STRUCTURED_TAGS[tt] || STRUCTURED_PARENTS[upperTag(target.parentElement)]) return dt === tt;
    return true;
  }

  function validDropTarget(el, dragged) {
    return !!el && isMovable(el) && el !== dragged && !dragged.contains(el) && !el.contains(dragged) &&
      structureAllows(dragged, el);
  }

  function contentChildren(el) {
    var out = [];
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
      if (!NON_SIBLING_TAGS[upperTag(c)] && !isBridgeNode(c)) out.push(c);
    }
    return out;
  }

  function nearestChild(kids, x, y) {
    var best = null;
    var bestDist = Infinity;
    for (var i = 0; i < kids.length; i++) {
      var r = kids[i].getBoundingClientRect();
      if (!r.width && !r.height) continue;
      var dx = x < r.left ? r.left - x : (x > r.right ? x - r.right : 0);
      var dy = y < r.top ? r.top - y : (y > r.bottom ? y - r.bottom : 0);
      var dist = dx * dx + dy * dy;
      if (dist < bestDist) { bestDist = dist; best = kids[i]; }
    }
    return best;
  }

  // Row layouts (flex rows, grids, inline blocks) take a vertical line and
  // split left/right; everything else splits top/bottom.
  function sideBySide(el) {
    var box = el.getBoundingClientRect();
    var sibs = [contentSibling(el, -1), contentSibling(el, 1)];
    for (var i = 0; i < sibs.length; i++) {
      if (!sibs[i]) continue;
      var other = sibs[i].getBoundingClientRect();
      var overlap = Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top);
      if (overlap > Math.min(box.height, other.height) / 2) return true;
    }
    return false;
  }

  // Where a drop at (x, y) would put the dragged element, or null when it
  // would stay where it is (or there is nowhere valid under the pointer).
  function resolveDrop(x, y, dragged) {
    var hit = null;
    try { hit = document.elementFromPoint(x, y); } catch (hitErr) { hit = null; }
    if (!hit || isBridgeNode(hit) || hit === dragged || dragged.contains(hit)) return null;
    // A container (or a like-for-like element) dragged over a sibling's
    // content -- a card over another card's heading, a section over the
    // next section's text -- targets the sibling itself: reordering is what
    // that drag means, not nesting one inside the other. Anything else
    // (an image, a paragraph) targets what is under the pointer, so it can
    // be dropped into a nested card or column.
    var sibling = null;
    var reorders = detectRole(dragged) === 'container';
    for (var a = hit; a && a !== document.body; a = a.parentElement) {
      if (a.parentElement === dragged.parentElement) {
        if (reorders || upperTag(a) === upperTag(dragged)) sibling = a;
        break;
      }
    }
    var el = sibling && validDropTarget(sibling, dragged) ? sibling : promoteToBlock(hit);
    // Pointer on a container's own padding or in the gap between its
    // children: aim at the nearest child, except on the container's top or
    // bottom edge, which drops beside the container itself.
    var kids = el === hit && el !== sibling ? contentChildren(el) : [];
    if (kids.length) {
      var box = el.getBoundingClientRect();
      var edge = Math.min(16, box.height / 4);
      var onEdge = y - box.top < edge || box.bottom - y < edge;
      if (!onEdge || !validDropTarget(el, dragged)) {
        var near = nearestChild(kids, x, y);
        if (near === dragged) return null;
        if (near) el = near;
      }
    }
    while (el && !validDropTarget(el, dragged)) {
      if (el.contains(dragged)) return null;
      el = el.parentElement;
    }
    if (!el) return null;
    var r = el.getBoundingClientRect();
    var horizontal = sideBySide(el);
    var position = horizontal
      ? (x < r.left + r.width / 2 ? 'before' : 'after')
      : (y < r.top + r.height / 2 ? 'before' : 'after');
    if (contentSibling(el, position === 'before' ? -1 : 1) === dragged) return null;
    return { el: el, position: position, horizontal: horizontal };
  }

  function dragChrome(css) {
    var node = document.createElement('div');
    node.setAttribute('data-orion-bridge', 'true');
    node.style.cssText = 'position:fixed;pointer-events:none;box-sizing:border-box;margin:0;' + css;
    document.documentElement.appendChild(node);
    return node;
  }

  function placeBox(node, left, top, width, height) {
    node.style.left = left + 'px';
    node.style.top = top + 'px';
    node.style.width = Math.max(0, width) + 'px';
    node.style.height = Math.max(0, height) + 'px';
  }

  function paintDrag() {
    var b = drag.el.getBoundingClientRect();
    placeBox(drag.ghost, b.left, b.top, b.width, b.height);
    var t = drag.target;
    if (!t) { drag.line.style.display = 'none'; return; }
    var r = t.el.getBoundingClientRect();
    var vw = window.innerWidth || document.documentElement.clientWidth;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var clamp = function (v, max) { return Math.max(0, Math.min(v, max - 4)); };
    drag.line.style.display = 'block';
    if (t.horizontal) placeBox(drag.line, clamp(t.position === 'before' ? r.left - 4 : r.right, vw), r.top, 4, r.height);
    else placeBox(drag.line, r.left, clamp(t.position === 'before' ? r.top - 4 : r.bottom, vh), r.width, 4);
  }

  function updateDrag() {
    drag.target = resolveDrop(drag.x, drag.y, drag.el);
    paintDrag();
  }

  // Assignments must be instant even on scroll-behavior: smooth pages (see
  // setScrollPosition in the touch simulation); the author's exact style
  // attribute is put back afterwards.
  function scrollInstant(el, dy) {
    var attr = el.getAttribute('style');
    el.style.scrollBehavior = 'auto';
    el.scrollTop += dy;
    if (attr == null) el.removeAttribute('style');
    else el.setAttribute('style', attr);
  }

  function scrollerAt(x, y) {
    var node = null;
    try { node = document.elementFromPoint(x, y); } catch (sErr) { node = null; }
    for (; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      var oy = '';
      try { oy = window.getComputedStyle(node).overflowY; } catch (oErr) { oy = ''; }
      if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight + 1) return node;
    }
    return document.scrollingElement || document.documentElement;
  }

  // Holding the pointer near the top or bottom edge scrolls, faster the
  // closer it gets, so an element can be carried to any part of the page.
  function dragAutoScroll() {
    if (!drag || !drag.active) return;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var step = 0;
    if (drag.y < DRAG_EDGE) step = -Math.ceil((DRAG_EDGE - drag.y) / 3);
    else if (drag.y > vh - DRAG_EDGE) step = Math.ceil((drag.y - (vh - DRAG_EDGE)) / 3);
    if (step) {
      try { scrollInstant(scrollerAt(drag.x, drag.y), step); } catch (scrollErr) { /* nothing to scroll */ }
      updateDrag();
    }
    drag.raf = requestAnimationFrame(dragAutoScroll);
  }

  function startDrag() {
    drag.active = true;
    clearHover();
    try {
      var sel = window.getSelection();
      if (sel) sel.removeAllRanges();
    } catch (selErr) { /* nothing selected */ }
    try { document.documentElement.setPointerCapture(drag.pointerId); } catch (capErr) { /* events still arrive while pressed */ }
    if (editStyleEl) editStyleEl.textContent = editCursorCss() + DRAG_CSS;
    drag.ghost = dragChrome('z-index:2147483646;background:rgba(57,135,208,0.12);border:2px dashed rgba(57,135,208,0.9);border-radius:4px;');
    drag.line = dragChrome('z-index:2147483647;display:none;background:rgb(57,135,208);border-radius:2px;box-shadow:0 0 0 2px rgba(255,255,255,0.9);');
    drag.raf = requestAnimationFrame(dragAutoScroll);
  }

  function endDrag(commit) {
    var d = drag;
    drag = null;
    if (!d || !d.active) return;
    if (d.raf) cancelAnimationFrame(d.raf);
    try { document.documentElement.releasePointerCapture(d.pointerId); } catch (relErr) { /* already released */ }
    if (d.ghost && d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
    if (d.line && d.line.parentNode) d.line.parentNode.removeChild(d.line);
    if (editStyleEl) editStyleEl.textContent = editCursorCss();
    // The click that follows the release must not select what is under it.
    // It is dispatched in the same task as pointerup, so clear the flag in
    // the next one in case no click comes.
    dragSuppressClick = true;
    setTimeout(function () { dragSuppressClick = false; }, 0);
    if (!commit || !d.target || !editingActive) return;
    post('element-drop', {
      element: buildElementDescription(d.el),
      target: describeLite(d.target.el),
      position: d.target.position
    });
  }

  function dragOnPointerDown(e) {
    if (!editingActive || !dragModeActive || drag) return;
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    // A finger drag scrolls the page (and the browser cancels the pointer).
    if (e.pointerType === 'touch') return;
    if (inlineEdit && inlineEdit.el.contains(e.target)) return;
    var el = dragSubjectFor(e.target);
    if (!el) return;
    drag = {
      el: el, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY,
      active: false, target: null, raf: 0, ghost: null, line: null
    };
  }

  function dragOnPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (!drag.active) {
      var dx = e.clientX - drag.startX;
      var dy = e.clientY - drag.startY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
      // A text session (or a commit still waiting on the parent, which is
      // about to reload the page) owns the gesture.
      if (inlineEdit || pendingCommits.length || !editingActive || !dragModeActive) { drag = null; return; }
      startDrag();
    }
    e.preventDefault();
    updateDrag();
  }

  function dragOnPointerUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (drag.active) {
      e.preventDefault();
      e.stopPropagation();
    }
    endDrag(true);
  }

  function dragOnPointerCancel(e) {
    if (drag && e.pointerId === drag.pointerId) endDrag(false);
  }

  // Images and links are natively draggable; that drag would take the
  // pointer away from the move gesture.
  function dragOnNativeDragStart(e) {
    if (!editingActive) return;
    if (inlineEdit && inlineEdit.el.contains(e.target)) return;
    e.preventDefault();
  }

  function editSelectParent() {
    if (!editingActive || !editSelectedEl) return;
    abortInlineEdit();
    var parent = editSelectedEl.parentElement;
    if (!parent || parent === document.documentElement) return;
    clearHover();
    restoreOutline(editSelectedEl);
    editSelectedEl = parent;
    paintSelection(parent);
    describeElement(parent);
  }

  function clearSelection(notify) {
    abortInlineEdit();
    if (editSelectedEl) restoreOutline(editSelectedEl);
    editSelectedEl = null;
    if (notify) post('element-deselected', {});
  }

  // Entering or leaving drag mode keeps the selection (a container picked
  // with select-parent can be dragged next). A live text session is
  // committed rather than dropped: the click on the parent's toggle has
  // already blurred it, which is a commit anyway.
  function setDragMode(on) {
    if (on === dragModeActive) return;
    endDrag(false);
    if (inlineEdit) finishInlineEdit(true, false);
    clearHover();
    dragModeActive = on;
    if (editStyleEl) editStyleEl.textContent = editCursorCss();
  }

  function setEditingEnabled(enabled, dragOn) {
    if (!!enabled === editingActive) {
      setDragMode(!!enabled && !!dragOn);
      return;
    }
    endDrag(false);
    editingActive = !!enabled;
    dragModeActive = editingActive && !!dragOn;
    abortInlineEdit();
    clearHover();
    clearSelection(false);
    if (editingActive) {
      if (!editStyleEl) {
        editStyleEl = document.createElement('style');
        editStyleEl.setAttribute('data-orion-bridge', 'true');
        (document.head || document.documentElement).appendChild(editStyleEl);
      }
      editStyleEl.textContent = editCursorCss();
    } else if (editStyleEl) {
      if (editStyleEl.parentNode) editStyleEl.parentNode.removeChild(editStyleEl);
      editStyleEl = null;
    }
  }

  document.addEventListener('mouseover', editOnMouseOver, true);
  document.addEventListener('mouseout', editOnMouseOut, true);
  document.addEventListener('click', editOnClick, true);
  document.addEventListener('dblclick', editOnDblClick, true);
  document.addEventListener('keydown', editOnKeyDown, true);
  document.addEventListener('pointerdown', dragOnPointerDown, true);
  document.addEventListener('pointermove', dragOnPointerMove, true);
  document.addEventListener('pointerup', dragOnPointerUp, true);
  document.addEventListener('pointercancel', dragOnPointerCancel, true);
  document.addEventListener('dragstart', dragOnNativeDragStart, true);

  // Dead-link guard. The frame's document is about:srcdoc, so a relative
  // href ("about.html", "/pricing", "") would navigate the frame to a blank
  // page with nothing to go back to. Only links that lead somewhere real are
  // followed: in-page hashes, mailto/tel, and absolute web URLs (forced into
  // a new tab so they can never replace the preview). Everything else is
  // swallowed.
  // Root cause of the blank frame: relative URLs (including "#section") in a
  // srcdoc document resolve against the parent page's URL, so following one is
  // a cross-document navigation to the app's own origin, which refuses to be
  // framed. Pin the base to about:srcdoc so "#x" stays a same-document jump
  // and "page.html" fails to resolve (a no-op) instead of navigating.
  try {
    if (!document.querySelector('base[href]')) {
      var pinBase = document.createElement('base');
      pinBase.setAttribute('href', 'about:srcdoc');
      pinBase.setAttribute('data-orion-bridge', 'true');
      (document.head || document.documentElement).insertBefore(pinBase, (document.head || document.documentElement).firstChild);
    }
  } catch (err) { /* keep going without the pin */ }

  function onLinkClick(e) {
    if (e.defaultPrevented || editingActive) return;
    var t = e.target;
    var a = t && t.closest ? t.closest('a[href], area[href]') : null;
    if (!a) return;
    var raw = (a.getAttribute('href') || '').trim();
    if (raw.charAt(0) === '#' || /^javascript:/i.test(raw)) return;
    if (/^(mailto|tel|sms):/i.test(raw)) return;
    if (/^https?:[/][/]/i.test(raw) || /^[/][/][^/]/.test(raw)) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
      return;
    }
    // In an imported codebase a relative link is a client-side route: let it
    // reach the app's router (react-router's <Link> handles it and calls
    // preventDefault); onUnhandledRouteClick catches plain <a href="/x">.
    if (PROJECT_MODE) return;
    e.preventDefault();
    // A relative link may be an internal page ("about.html", "/pricing").
    // The parent owns the page set and swaps the document itself; it ignores
    // anything that is not one of the project's pages.
    if (!a.hasAttribute('download') && !/^[a-z][a-z0-9+.-]*:/i.test(raw) && raw !== '') {
      post('navigate-page', { href: raw });
    }
  }
  document.addEventListener('click', onLinkClick, true);
  // Bubble phase, after the app's own handlers: a relative link nobody
  // handled would navigate the frame away, so cancel it and hand it to the
  // router shim (codebase/routerShim.js) when there is one.
  function onUnhandledRouteClick(e) {
    if (e.defaultPrevented || editingActive) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href], area[href]') : null;
    if (!a) return;
    var raw = (a.getAttribute('href') || '').trim();
    if (!raw || raw.charAt(0) === '#' || /^[a-z][a-z0-9+.-]*:/i.test(raw) || /^[/][/]/.test(raw)) return;
    e.preventDefault();
    if (typeof window.__appblipsRouterNavigate === 'function') {
      try { window.__appblipsRouterNavigate(raw); } catch (err) { /* router rejected it */ }
    }
  }
  if (PROJECT_MODE) {
    window.addEventListener('click', onUnhandledRouteClick);
    window.__appblipsReportRoute = function (path) {
      post('route-changed', { path: String(path || '/').slice(0, 2000) });
    };
  }
  // A form with no real destination would navigate the frame to a blank page.
  // Cancel the native submit; the app's own submit handlers still run.
  document.addEventListener('submit', function (e) {
    if (editingActive || e.defaultPrevented) return;
    var f = e.target;
    var action = f && f.getAttribute ? (f.getAttribute('action') || '').trim() : '';
    if (!/^https?:[/][/]/i.test(action)) e.preventDefault();
  }, true);

  // Catch-all for navigations the click handler can't see: middle/ctrl-click
  // (auxclick), form submits, and script-driven location changes. A srcdoc
  // frame resolves relative URLs against the parent page, so a dead link
  // lands on the app's own origin, which refuses to be framed ("localhost
  // refused to connect"). Cancel those; hand real external URLs to a new tab.
  function baseOrigin() {
    try { return new URL(document.baseURI).origin; } catch (err) { return null; }
  }
  function isDeadTarget(url) {
    try {
      var u = new URL(url, document.baseURI);
      if (u.protocol === 'mailto:' || u.protocol === 'tel:' || u.protocol === 'sms:') return false;
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
      return u.origin === baseOrigin();
    } catch (err) { return true; }
  }
  document.addEventListener('auxclick', function (e) {
    if (editingActive) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href], area[href]') : null;
    if (a && isDeadTarget(a.getAttribute('href') || '') && (a.getAttribute('href') || '').trim().charAt(0) !== '#') {
      e.preventDefault();
    }
  }, true);
  try {
    if (window.navigation && typeof window.navigation.addEventListener === 'function') {
      window.navigation.addEventListener('navigate', function (e) {
        if (!e.cancelable || e.hashChange || e.navigationType === 'reload' || e.navigationType === 'traverse') return;
        if (e.destination && e.destination.sameDocument) return;
        var dest = e.destination && e.destination.url;
        if (!dest || /^(mailto|tel|sms):/i.test(dest)) return;
        e.preventDefault();
        if (!isDeadTarget(dest)) {
          try { window.open(dest, '_blank', 'noopener,noreferrer'); } catch (err) { /* popup blocked */ }
        }
      });
    }
  } catch (err) { /* Navigation API unavailable */ }
  var nativeOpen = window.open;
  if (typeof nativeOpen === 'function') {
    window.open = function (url) {
      if (url !== undefined && url !== null && String(url) !== '' && isDeadTarget(String(url))) return null;
      return nativeOpen.apply(window, arguments);
    };
  }

  // ------------------------------------------------------------------
  // 3. Touch-scroll simulation
  // ------------------------------------------------------------------

  var SCROLLBAR_CSS =
    '* { scrollbar-width: none !important; -ms-overflow-style: none !important; } ' +
    '*::-webkit-scrollbar { display: none !important; }';

  var TOUCH_CSS =
    'html, body { touch-action: none !important; overscroll-behavior: none !important; }';

  function install() {
    var isDragging = false;
    var hasMoved = false;
    var startX = 0, startY = 0, lastX = 0, lastY = 0;
    var velocityX = 0, velocityY = 0;
    var momentumId = null;
    var suppressClick = false;
    var pointerCaptureTarget = null;
    var mainScrollEl = null;
    var startTarget = null;

    var scrollbarStyle = document.createElement('style');
    scrollbarStyle.textContent = SCROLLBAR_CSS;
    document.head.appendChild(scrollbarStyle);

    var touchStyle = document.createElement('style');
    touchStyle.textContent = TOUCH_CSS;
    document.head.appendChild(touchStyle);

    function findScrollableElement(target, isHorizontal) {
      var el = target;
      while (el && el !== document.documentElement && el !== document.body) {
        if (el.nodeType === 1) {
          var style = window.getComputedStyle(el);
          var overflow = isHorizontal
            ? (style.overflowX || '') + (style.overflow || '')
            : (style.overflowY || '') + (style.overflow || '');
          if (/(auto|scroll)/.test(overflow)) {
            var canScroll = isHorizontal
              ? el.scrollWidth > el.clientWidth + 1
              : el.scrollHeight > el.clientHeight + 1;
            if (canScroll) return el;
          }
        }
        el = el.parentElement;
      }
      return findGlobalScrollElement(isHorizontal);
    }

    function findGlobalScrollElement(isHorizontal) {
      var candidates = [document.scrollingElement, document.documentElement, document.body];
      for (var i = 0; i < candidates.length; i++) {
        var el = candidates[i];
        if (el) {
          var canScroll = isHorizontal
            ? el.scrollWidth > el.clientWidth + 1
            : el.scrollHeight > el.clientHeight + 1;
          if (canScroll) return el;
        }
      }
      if (document.body) {
        var allScrollables = document.body.querySelectorAll('*');
        for (var j = 0; j < allScrollables.length; j++) {
          var child = allScrollables[j];
          var childStyle = window.getComputedStyle(child);
          var childOverflow = isHorizontal
            ? (childStyle.overflowX || '') + (childStyle.overflow || '')
            : (childStyle.overflowY || '') + (childStyle.overflow || '');
          if (/(auto|scroll)/.test(childOverflow)) {
            var canScrollChild = isHorizontal
              ? child.scrollWidth > child.clientWidth + 1
              : child.scrollHeight > child.clientHeight + 1;
            if (canScrollChild) return child;
          }
        }
      }
      return document.scrollingElement || document.documentElement || document.body;
    }

    function isFormControl(el) {
      // e.target can be the Document, which has no tagName.
      if (!el || !el.tagName) return false;
      var tag = el.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'option') return true;
      if (el.isContentEditable) return true;
      return false;
    }

    function setUserSelect(value) {
      if (!document.body) return;
      document.body.style.userSelect = value;
      document.body.style.webkitUserSelect = value;
      document.body.style.MozUserSelect = value;
    }

    // Programmatic scrolling must be INSTANT. If the page (or scroller) sets
    // scroll-behavior: smooth -- common in generated websites, e.g. Tailwind's
    // scroll-smooth on <html> for anchor nav -- assigning scrollTop/scrollLeft
    // starts a smooth animation instead of moving immediately. The next move
    // reads the still-unmoved value back, subtracts from it, clamps at 0 and the
    // page never advances. Forcing auto around the assignment (inline style
    // overrides both the CSS rule and an inline smooth) makes the drag track the
    // pointer, then restores the page's own setting so anchor links stay smooth.
    function setScrollPosition(el, left, top) {
      if (!el) return;
      var prev = el.style.scrollBehavior;
      el.style.scrollBehavior = 'auto';
      el.scrollLeft = left;
      el.scrollTop = top;
      el.style.scrollBehavior = prev;
    }

    function onPointerDown(e) {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (isFormControl(e.target)) return;
      // While the element picker is active, every gesture belongs to the
      // picker -- no drag-scrolling, so taps reliably reach editOnClick.
      if (editingActive) return;

      if (momentumId) {
        cancelAnimationFrame(momentumId);
        momentumId = null;
      }

      isDragging = true;
      hasMoved = false;
      suppressClick = false;
      startX = e.clientX;
      startY = e.clientY;
      lastX = e.clientX;
      lastY = e.clientY;
      velocityX = 0;
      velocityY = 0;
      startTarget = e.target;
      mainScrollEl = null;
      pointerCaptureTarget = null;
    }

    function onPointerMove(e) {
      if (!isDragging) return;

      var dx = e.clientX - startX;
      var dy = e.clientY - startY;

      // 6px drag threshold to prevent natural tap jitter from swallowing clicks
      if (!hasMoved && (dx * dx + dy * dy > 36)) {
        hasMoved = true;
        suppressClick = true;
        setUserSelect('none');

        var isHorizontal = Math.abs(dx) > Math.abs(dy);
        mainScrollEl = findScrollableElement(startTarget, isHorizontal);

        try {
          if (startTarget && startTarget.setPointerCapture) {
            startTarget.setPointerCapture(e.pointerId);
            pointerCaptureTarget = startTarget;
          }
        } catch (err) { /* not capturable */ }

        if (e.pointerType === 'mouse') {
          document.documentElement.style.cursor = 'grabbing';
        }
      }

      if (!hasMoved) return;

      var moveX = e.clientX - lastX;
      var moveY = e.clientY - lastY;

      velocityX = velocityX * 0.6 + moveX * 0.4;
      velocityY = velocityY * 0.6 + moveY * 0.4;

      if (mainScrollEl) {
        setScrollPosition(mainScrollEl, mainScrollEl.scrollLeft - moveX, mainScrollEl.scrollTop - moveY);
      }

      lastX = e.clientX;
      lastY = e.clientY;

      e.preventDefault();
    }

    function onPointerUp(e) {
      if (!isDragging) return;
      isDragging = false;

      try {
        if (pointerCaptureTarget && pointerCaptureTarget.releasePointerCapture) {
          pointerCaptureTarget.releasePointerCapture(e.pointerId);
        }
      } catch (err) { /* already released */ }
      pointerCaptureTarget = null;

      document.documentElement.style.cursor = 'grab';
      setUserSelect('');

      if (!hasMoved) {
        suppressClick = false;
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      var scrollTarget = mainScrollEl;
      if (scrollTarget && (Math.abs(velocityX) > 0.5 || Math.abs(velocityY) > 0.5)) {
        var applyMomentum = function () {
          if (Math.abs(velocityX) < 0.3 && Math.abs(velocityY) < 0.3) {
            momentumId = null;
            return;
          }

          velocityX *= 0.96;
          velocityY *= 0.96;

          setScrollPosition(scrollTarget, scrollTarget.scrollLeft - velocityX, scrollTarget.scrollTop - velocityY);

          momentumId = requestAnimationFrame(applyMomentum);
        };

        momentumId = requestAnimationFrame(applyMomentum);
      }
    }

    function onClick(e) {
      if (editingActive) return;
      if (suppressClick) {
        e.preventDefault();
        e.stopPropagation();
        suppressClick = false;
      }
    }

    var opts = { capture: true, passive: false };

    document.addEventListener('pointerdown', onPointerDown, opts);
    document.addEventListener('pointermove', onPointerMove, opts);
    document.addEventListener('pointerup', onPointerUp, opts);
    document.addEventListener('pointercancel', onPointerUp, opts);
    document.addEventListener('click', onClick, true);

    document.documentElement.style.cursor = 'grab';

    return function teardown() {
      document.removeEventListener('pointerdown', onPointerDown, opts);
      document.removeEventListener('pointermove', onPointerMove, opts);
      document.removeEventListener('pointerup', onPointerUp, opts);
      document.removeEventListener('pointercancel', onPointerUp, opts);
      document.removeEventListener('click', onClick, true);
      if (momentumId) cancelAnimationFrame(momentumId);
      if (scrollbarStyle.parentNode) scrollbarStyle.parentNode.removeChild(scrollbarStyle);
      if (touchStyle.parentNode) touchStyle.parentNode.removeChild(touchStyle);
      try {
        document.documentElement.style.cursor = '';
        setUserSelect('');
      } catch (err) { /* document going away */ }
    };
  }

  // ------------------------------------------------------------------
  // 4. Message plumbing
  // ------------------------------------------------------------------

  var domReady = false;
  // Seeded at injection time from the parent's current device mode (see the
  // touchEnabled option of injectPreviewBridge) so the simulation -- and the
  // scrollbar-hiding CSS that ships with it -- is active from first paint. A
  // configure message from the parent cannot be relied on for this: a srcdoc
  // document can finish loading BEFORE the parent's post-load effect
  // listeners re-attach (the heavy commit when a generation completes is
  // exactly that race), which would otherwise leave the frame unconfigured
  // until a manual reload. Later pushes still toggle this at runtime.
  var desiredEnabled = __ORION_INITIAL_TOUCH_ENABLED__;
  var teardownFn = null;

  function sync() {
    if (!domReady) return;
    try {
      if (desiredEnabled && !teardownFn) {
        teardownFn = install();
      } else if (!desiredEnabled && teardownFn) {
        teardownFn();
        teardownFn = null;
      }
    } catch (err) {
      post('error', { message: String((err && err.message) || err) });
    }
  }

  // Registered synchronously, before the DOM exists, so no parent message can
  // be missed while the document is still parsing.
  window.addEventListener('message', function (e) {
    if (e.source !== parent) return;
    var d = e.data;
    if (!d || d.__orion !== CHANNEL || d.token !== TOKEN) return;
    if (d.type === 'browser-action') {
      try {
        var browserResult = browserRuntime.act(d.payload || {});
        post('browser-result', { requestId: d.payload.requestId, result: browserResult });
      } catch (browserError) {
        post('browser-result', { requestId: d.payload.requestId, error: String(browserError.message || browserError) });
      }
    } else if (d.type === 'configure') {
      desiredEnabled = !!(d.payload && d.payload.enabled);
      sync();
    } else if (d.type === 'set-editing') {
      setEditingEnabled(!!(d.payload && d.payload.enabled), !!(d.payload && d.payload.drag));
    } else if (d.type === 'nav-back' || d.type === 'nav-forward') {
      var goBack = d.type === 'nav-back';
      try {
        var nv = window.navigation;
        var p = nv ? (goBack ? nv.back() : nv.forward()) : (goBack ? history.back() : history.forward());
        if (p && p.committed && p.finished) { p.committed.catch(function () {}); p.finished.catch(function () {}); }
      } catch (err) { /* nothing to traverse */ }
    } else if (d.type === 'scroll-to-hash') {
      try {
        var hid = String((d.payload && d.payload.hash) || '');
        var hel = hid ? document.getElementById(hid) : null;
        if (hel && hel.scrollIntoView) hel.scrollIntoView();
      } catch (err) { /* no such anchor */ }
    } else if (d.type === 'select-parent') {
      editSelectParent();
    } else if (d.type === 'deselect') {
      clearSelection(false);
    } else if (d.type === 'inline-format') {
      applyInlineFormat(d.payload && d.payload.styles);
    } else if (d.type === 'inline-undo' || d.type === 'inline-redo') {
      stepInlineHistory(d.type === 'inline-redo' ? 1 : -1);
    } else if (d.type === 'inline-hold') {
      inlineHold = !!(d.payload && d.payload.hold);
      if (inlineHold && inlineEdit && inlineEdit.blurTimer) { clearTimeout(inlineEdit.blurTimer); inlineEdit.blurTimer = null; }
    } else if (d.type === 'inline-finish') {
      finishInlineEdit(!!(d.payload && d.payload.commit), false);
    } else if (d.type === 'inline-edit-result') {
      resolveInlineEdit(!!(d.payload && d.payload.ok), d.payload ? d.payload.editId : null);
    } else if (d.type === 'restore-scroll') {
      try {
        window.scrollTo((d.payload && d.payload.x) || 0, (d.payload && d.payload.y) || 0);
      } catch (scrollErr) { /* nothing to restore */ }
    } else if (d.type === "capture-screenshot") {
      captureDomSnapshot(d.payload && d.payload.requestId);
    }
  });

  // Back/forward availability for the desktop browser chrome. Only the
  // Navigation API can answer this (history.length is not directional), so
  // without it both buttons simply stay disabled.
  function postNavState() {
    var nv = window.navigation;
    post('nav-state', { canGoBack: !!(nv && nv.canGoBack), canGoForward: !!(nv && nv.canGoForward) });
  }
  try {
    if (window.navigation && typeof window.navigation.addEventListener === 'function') {
      window.navigation.addEventListener('currententrychange', postNavState);
    }
  } catch (err) { /* Navigation API unavailable */ }

  function onReady() {
    domReady = true;
    sync();
    post('ready');
    postNavState();
  }

      if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
  } else {
    onReady();
  }

  // ------------------------------------------------------------------
  // 5. Screenshot capture (DOM + CSS extraction only)
  //
  // No rasterization happens here -- see the module header comment for why:
  // any library that needs a helper iframe to compute styles gets blocked
  // reading that iframe's .document, because sandboxing forces a fresh
  // opaque origin onto anything this frame creates. This just clones the
  // live document and collects reachable stylesheet text; the parent turns
  // that into a canvas (rasterizeDomSnapshot in src/lib/attachments.js).
  // ------------------------------------------------------------------

  function isBlankColor(c) {
    return !c || c === 'transparent' || c.indexOf('rgba(0, 0, 0, 0)') === 0;
  }

  // Flattens a stylesheet to plain rule text, resolving conditional groups
  // HERE, against the live frame.
  //
  // This is load-bearing: an SVG rendered through an <img> evaluates media
  // queries against its own bare context, where prefers-color-scheme is
  // always light. A dark-themed app captured without this comes back in its
  // light theme -- and since the markup still carries dark-theme colors
  // inline, that reads as a mostly-blank screenshot (white text on a light
  // background). Resolving the query here bakes in the theme the user is
  // actually looking at.
  function flattenRules(rules) {
    var out = '';
    for (var k = 0; k < rules.length; k++) {
      var rule = rules[k];
      var nested = rule.cssRules;
      var text = rule.cssText || '';
      if (rule.type === 4) { // CSSMediaRule -- the one thing that must be resolved here
        var matches = true;
        try {
          matches = window.matchMedia(rule.media.mediaText).matches;
        } catch (mqErr) { matches = true; } // unreadable condition: keep the rules
        if (matches && nested) out += flattenRules(nested);
      } else if (nested && nested.length && rule.type !== 7 && text.charAt(0) === '@') {
        // @supports / @layer / @container: the SVG renders in this same
        // engine, so these evaluate identically there -- keep the at-rule
        // intact (dropping it on a failed re-evaluation loses real styles)
        // and just recurse so any media query nested inside still resolves.
        // @keyframes (type 7) and nested style rules are emitted verbatim.
        var brace = text.indexOf('{');
        if (brace > -1) out += text.slice(0, brace) + '{' + flattenRules(nested) + '}\\n';
        else out += text + '\\n';
      } else {
        out += text + '\\n';
      }
    }
    return out;
  }

  function captureDomSnapshot(requestId) {
    try {
      // Live pixel/field state has to be read BEFORE cloning and re-applied
      // afterwards: cloneNode copies attributes, not canvas bitmaps or the
      // .value/.checked properties the user actually typed into.
      var i;
      var liveCanvases = document.querySelectorAll('canvas');
      var canvasDataUrls = [];
      for (i = 0; i < liveCanvases.length; i++) {
        try {
          canvasDataUrls.push(liveCanvases[i].toDataURL());
        } catch (canvasErr) {
          canvasDataUrls.push(null); // tainted canvas inside the generated app itself
        }
      }
      var liveFields = document.querySelectorAll('input, textarea, select');
      var fieldValues = [];
      var fieldChecked = [];
      for (i = 0; i < liveFields.length; i++) {
        fieldValues.push(liveFields[i].value);
        fieldChecked.push(!!liveFields[i].checked);
      }

      // The whole <html> element is serialized, not just <body>: theme state
      // is routinely carried as a class or data- attribute up there
      // (class="dark", data-theme="..."), and dropping it silently renders
      // the app in its light theme.
      var clone = document.documentElement.cloneNode(true);

      // Freeze each element's live visual state, BEFORE anything is removed
      // from the clone, so the live and cloned element lists still line up
      // index for index.
      //
      // CSS animations do not run inside an SVG rendered through an <img>:
      // it renders in a static context where they sit frozen at their FIRST
      // keyframe. An app that fades or slides its content in -- the default
      // entrance pattern, opacity 0 animating to 1 with a forwards fill --
      // then captures as an empty shell, with only its non-animated chrome
      // (headers, nav bars, floating buttons) visible. Animations also
      // outrank inline styles in the cascade, so it is not enough to write
      // the settled values here: each element also has to be told
      // animation: none, or the frozen first keyframe wins anyway.
      var liveEls = document.documentElement.querySelectorAll('*');
      var cloneEls = clone.querySelectorAll('*');
      for (i = 0; i < liveEls.length && i < cloneEls.length; i++) {
        var live = window.getComputedStyle(liveEls[i]);
        // opacity/transform are written unconditionally: a finished
        // entrance animation computes to the settled value (opacity 1),
        // while the rule underneath it still says opacity: 0 -- so
        // skipping "default-looking" values would reinstate the bug.
        var frozen =
          'animation:none !important;transition:none !important;' +
          'opacity:' + live.opacity + ';' +
          'visibility:' + live.visibility + ';' +
          'transform:' + (live.transform || 'none') + ';' +
          'filter:' + (live.filter || 'none') + ';';
        var prior = cloneEls[i].getAttribute('style');
        cloneEls[i].setAttribute('style', (prior ? prior + ';' : '') + frozen);
      }

      // <head> holds nothing renderable -- its stylesheet text is collected
      // below instead -- and skipping it keeps the payload small.
      var clonedHead = clone.querySelector('head');
      if (clonedHead && clonedHead.parentNode) clonedHead.parentNode.removeChild(clonedHead);

      // Scripts never execute inside an SVG image, and their raw text is the
      // single most likely thing to break the XML parse the parent depends
      // on. <noscript> holds unparsed markup that does the same, and <link>
      // is dead weight since an SVG rendered through an <img> loads no
      // external resources at all. This also drops the bridge's own injected
      // script, so it can never reach the parent.
      var junk = clone.querySelectorAll('script, noscript, link');
      for (i = 0; i < junk.length; i++) {
        if (junk[i].parentNode) junk[i].parentNode.removeChild(junk[i]);
      }

      var cloneCanvases = clone.querySelectorAll('canvas');
      for (i = 0; i < cloneCanvases.length; i++) {
        if (!canvasDataUrls[i] || !cloneCanvases[i].parentNode) continue;
        var img = document.createElement('img');
        img.setAttribute('src', canvasDataUrls[i]);
        var canvasStyle = cloneCanvases[i].getAttribute('style');
        if (canvasStyle) img.setAttribute('style', canvasStyle);
        img.setAttribute('width', String(cloneCanvases[i].width));
        img.setAttribute('height', String(cloneCanvases[i].height));
        cloneCanvases[i].parentNode.replaceChild(img, cloneCanvases[i]);
      }

      var cloneFields = clone.querySelectorAll('input, textarea, select');
      for (i = 0; i < cloneFields.length; i++) {
        var cf = cloneFields[i];
        var value = fieldValues[i];
        if (value === undefined) continue;
        if (cf.tagName === 'TEXTAREA') {
          cf.textContent = value;
        } else if (cf.tagName === 'SELECT') {
          var opts = cf.querySelectorAll('option');
          for (var oi = 0; oi < opts.length; oi++) {
            if (opts[oi].value === value) opts[oi].setAttribute('selected', 'selected');
            else opts[oi].removeAttribute('selected');
          }
        } else if (cf.type === 'checkbox' || cf.type === 'radio') {
          if (fieldChecked[i]) cf.setAttribute('checked', 'checked');
          else cf.removeAttribute('checked');
        } else {
          cf.setAttribute('value', value);
        }
      }

      // A surviving srcset would let the renderer prefer an external
      // candidate over the data: URI the parent substitutes into src.
      var srcsetEls = clone.querySelectorAll('[srcset]');
      for (i = 0; i < srcsetEls.length; i++) srcsetEls[i].removeAttribute('srcset');

      // HTML allows attribute names XML does not (@click, :class, x-on:click,
      // [prop], a stray quote...). XMLSerializer emits them verbatim, and one
      // such name fails the whole SVG parse. They carry no visual meaning in a
      // static snapshot, so drop any that are not valid XML names (a single
      // prefix colon is only kept for the namespaces the serializer declares).
      var xmlNameRe = /^[A-Za-z_][A-Za-z0-9_.-]*(:[A-Za-z_][A-Za-z0-9_.-]*)?$/;
      var allEls = clone.querySelectorAll('*');
      var elIdx, attrIdx;
      var badAttrs = [];
      for (elIdx = -1; elIdx < allEls.length; elIdx++) {
        var el = elIdx < 0 ? clone : allEls[elIdx];
        for (attrIdx = 0; attrIdx < el.attributes.length; attrIdx++) {
          var attrName = el.attributes[attrIdx].name;
          if (!xmlNameRe.test(attrName) || (attrName.indexOf(':') !== -1 && !/^(xml|xlink|xmlns):/.test(attrName))) {
            badAttrs.push([el, attrName]);
          }
        }
      }
      for (i = 0; i < badAttrs.length; i++) badAttrs[i][0].removeAttribute(badAttrs[i][1]);

      var css = '';
      var externalStyleUrls = [];
      var si;
      for (si = 0; si < document.styleSheets.length; si++) {
        var sheet = document.styleSheets[si];
        try {
          if (sheet.disabled) continue;
          css += flattenRules(sheet.cssRules);
        } catch (sheetErr) {
          // Cross-origin sheet: this document isn't allowed to read its
          // rules. Hand the URL to the parent, which can still fetch the
          // text over the network (that's how Google Fonts survives).
          if (sheet.href) externalStyleUrls.push(sheet.href);
        }
      }

      var docEl = document.documentElement;
      var rootStyle = window.getComputedStyle(docEl);

      // Custom properties are usually declared on :root -- which, inside the
      // SVG the parent builds, is the <svg> element, not this <html>. Pin the
      // live resolved value of every custom property the CSS mentions onto
      // the cloned root so every var() reference still resolves.
      var varNames = {};
      var varRe = /--[A-Za-z0-9_-]+/g;
      var varMatch;
      while ((varMatch = varRe.exec(css))) varNames[varMatch[0]] = true;
      var rootInlineStyle = '';
      for (var varName in varNames) {
        if (!Object.prototype.hasOwnProperty.call(varNames, varName)) continue;
        var varValue = rootStyle.getPropertyValue(varName);
        if (varValue) rootInlineStyle += varName + ':' + varValue + ';';
      }
      // Percentage heights need an unbroken chain from the root, which the
      // parent's wrapper can't supply on this element's behalf.
      clone.setAttribute(
        'style',
        (clone.getAttribute('style') || '') + ';' + rootInlineStyle + 'width:100%;height:100%;'
      );

      var bodyBg = window.getComputedStyle(document.body).backgroundColor;
      var htmlBg = rootStyle.backgroundColor;

      post('dom-snapshot', {
        requestId: requestId,
        // XMLSerializer, NOT outerHTML: foreignObject content has to parse as
        // XML, and the HTML serialization of a single void element
        // (<meta charset="UTF-8">, <br>, <img ...>) is enough to fail the
        // whole SVG parse and produce an empty screenshot.
        html: new XMLSerializer().serializeToString(clone),
        css: css,
        externalStyleUrls: externalStyleUrls,
        backgroundColor: isBlankColor(bodyBg) ? (isBlankColor(htmlBg) ? '#ffffff' : htmlBg) : bodyBg,
        // rem resolves against the SVG root, not this document's <html>, so
        // the parent has to put this back on the <svg> element itself.
        rootFontSize: rootStyle.fontSize,
        scrollX: window.pageXOffset || 0,
        scrollY: window.pageYOffset || 0,
        width: docEl.clientWidth || window.innerWidth,
        height: docEl.clientHeight || window.innerHeight
      });
    } catch (err) {
      post('screenshot-error', { requestId: requestId, message: String((err && err.message) || err) });
    }
  }

  // ------------------------------------------------------------------
  // 6. Runtime error capture
  // ------------------------------------------------------------------
  var lastReportedError = '';
  var lastReportedTime = 0;

  function reportRuntimeError(msg, line, col) {
    if (!msg) return;
    if (msg === 'Script error.' || msg === 'Script error') {
      msg = 'Script execution error' + (line ? ' at line ' + line : '');
    }
    var now = Date.now();
    var key = msg + ':' + (line || 0);
    if (key === lastReportedError && (now - lastReportedTime) < 1000) {
      return;
    }
    lastReportedError = key;
    lastReportedTime = now;
    browserRuntime.reportError(msg);
    post('runtime_error', { message: msg, line: line, col: col });
  }

  window.addEventListener('error', function(e) {
    var msg = (e && e.message) ? e.message : '';
    if ((!msg || msg === 'Script error.' || msg === 'Script error') && e && e.error && e.error.message) {
      msg = e.error.message;
    }
    reportRuntimeError(msg || (e && e.error ? String(e.error) : 'Script error'), e && e.lineno, e && e.colno);
  });

  window.onerror = function(message, source, lineno, colno, error) {
    var msg = message;
    if ((!msg || msg === 'Script error.' || msg === 'Script error') && error && error.message) {
      msg = error.message;
    }
    reportRuntimeError(msg || 'Script error', lineno, colno);
  };

  window.addEventListener('unhandledrejection', function(e) {
    var reason = e ? e.reason : null;
    var msg = reason ? (reason.message || String(reason)) : 'Unhandled Promise Rejection';
    reportRuntimeError(msg);
  });

  var origConsoleError = console.error;
  console.error = function() {
    try {
      var args = Array.prototype.slice.call(arguments);
      origConsoleError.apply(console, args);
      var errStr = args.map(function(a) {
        return (a && a.stack) ? a.stack : (a && a.message) ? a.message : String(a);
      }).join(' ');
      if (/(?:Error|Exception|Uncaught|TypeError|ReferenceError|SyntaxError)/i.test(errStr)) {
        reportRuntimeError(errStr.slice(0, 300));
      }
    } catch (err) {}
  };

})();`;

// A stray "</" inside the source would silently truncate the injected <script>
// tag and leave the rest of the bridge as visible page text. Fail loudly at
// module load instead of debugging it in a generated app.
if (BRIDGE_SOURCE.indexOf('</') !== -1) {
  throw new Error('previewBridge: BRIDGE_SOURCE contains "</", which would truncate the injected script tag.');
}

export const PREVIEW_BRIDGE_SCRIPT = BRIDGE_SOURCE;

// The data-orion-bridge marker lets captureDomSnapshot strip this tag out of
// the cloned document before sending its HTML back to the parent.
const SCRIPT_OPEN = '<script data-orion-bridge="true">';
// Assembled so this module's own source never contains the literal sequence.
const SCRIPT_CLOSE = '</' + 'script>';

const buildTag = (token, initialStorage, touchEnabled, projectMode) => {
  const safeData = JSON.stringify(
    initialStorage && typeof initialStorage === 'object' ? initialStorage : {}
  ).replace(/</g, '\\u003c');

  const source = BRIDGE_SOURCE
    .replace('__ORION_TOKEN__', token)
    .replace('__ORION_INITIAL_STORAGE__', safeData)
    .replace('__ORION_INITIAL_TOUCH_ENABLED__', touchEnabled ? 'true' : 'false')
    .replace('__ORION_PROJECT_MODE__', projectMode ? 'true' : 'false');

  if (source.indexOf('</') !== -1) {
    throw new Error('previewBridge: Injected script contains "</", which would truncate the injected script tag.');
  }

  return SCRIPT_OPEN + source + SCRIPT_CLOSE;
};

/**
 * Splice the bridge into a generated document.
 *
 * Index-based insertion at a single point, never a global replace, so every
 * byte of model output outside the insertion point is preserved verbatim.
 * The bridge must land as early as possible -- before the Tailwind CDN tag and
 * before the app's own script -- so the storage shim is in place by the time
 * anything touches `localStorage`.
 *
 * @param {string} code
 * @param {{ initialStorage?: Record<string, string>, touchEnabled?: boolean, projectMode?: boolean }} [options]
 *   `touchEnabled` bakes the parent's current device mode (mobile/tablet vs
 *   desktop -- PREVIEW_MODES[previewMode].isTouchChrome) in as the bridge's
 *   initial state, so the touch-scroll simulation and scrollbar hiding are
 *   active from the frame's first paint without waiting for a configure
 *   message that can lose the load race on srcdoc documents.
 *   `projectMode` is for imported codebases: relative links are left to the
 *   app's router and route changes are posted as 'route-changed'.
 * @returns {{ srcDoc: string, token: string }}
 */
export const injectPreviewBridge = (code, options = {}) => {
  const token = makeToken();

  if (typeof code !== 'string' || !code) {
    return { srcDoc: '', token };
  }

  code = injectLoopProtection(compileJsxScripts(code));

  const initialStorage = options?.initialStorage;
  const tag = buildTag(token, initialStorage, options?.touchEnabled === true, options?.projectMode === true);
  const insertAt = (index, payload) => code.slice(0, index) + payload + code.slice(index);

  // A leading <!DOCTYPE html> needs no special case -- it falls out of this
  // naturally, since we insert after <head>/<html>/<body> rather than at 0.
  const headMatch = /<head\b[^>]*>/i.exec(code);
  if (headMatch) {
    return { srcDoc: insertAt(headMatch.index + headMatch[0].length, tag), token };
  }

  const htmlMatch = /<html\b[^>]*>/i.exec(code);
  if (htmlMatch) {
    const head = '<head>' + tag + '</' + 'head>';
    return { srcDoc: insertAt(htmlMatch.index + htmlMatch[0].length, head), token };
  }

  const bodyMatch = /<body\b[^>]*>/i.exec(code);
  if (bodyMatch) {
    return { srcDoc: insertAt(bodyMatch.index + bodyMatch[0].length, tag), token };
  }

  return { srcDoc: tag + code, token };
};
