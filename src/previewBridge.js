/**
 * Preview bridge.
 *
 * The generated app runs in an origin-isolated iframe (`sandbox` without
 * `allow-same-origin`), so the parent can no longer reach into
 * `iframe.contentDocument`. Everything the parent used to do by touching the
 * frame's DOM now lives inside the frame, injected as a single inline script,
 * and is driven over `postMessage`.
 *
 * The script does two jobs:
 *
 *  1. Shims `localStorage` / `sessionStorage` / `document.cookie`. On an opaque
 *     origin these THROW `SecurityError` on mere access, which would kill the
 *     generated app's inline script at that line and leave a white screen.
 *     Generated apps hit this constantly -- the suggested prompts in the UI are
 *     "habit tracker", "to-do list", "budget tracker".
 *  2. Runs the mobile touch-scroll simulation (drag, momentum, click
 *     suppression) that used to live in an effect in App.jsx.
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
  var CHANNEL = '${BRIDGE_CHANNEL}';
  var VERSION = ${BRIDGE_PROTOCOL_VERSION};

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
  // 2. Touch-scroll simulation
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

    function onPointerDown(e) {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (isFormControl(e.target)) return;

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
        mainScrollEl.scrollTop -= moveY;
        mainScrollEl.scrollLeft -= moveX;
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

          scrollTarget.scrollTop -= velocityY;
          scrollTarget.scrollLeft -= velocityX;

          momentumId = requestAnimationFrame(applyMomentum);
        };

        momentumId = requestAnimationFrame(applyMomentum);
      }
    }

    function onClick(e) {
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
  // 3. Message plumbing
  // ------------------------------------------------------------------

  var domReady = false;
  var desiredEnabled = false;
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
    if (d.type === 'configure') {
      desiredEnabled = !!(d.payload && d.payload.enabled);
      sync();
    }
  });

  function onReady() {
    domReady = true;
    sync();
    post('ready');
  }

      if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
  } else {
    onReady();
  }

  // ------------------------------------------------------------------
  // 4. Runtime error capture
  // ------------------------------------------------------------------
  window.addEventListener('error', function(e) {
    var msg = e.message;
    if ((!msg || msg === 'Script error.') && e.error && e.error.message) {
      msg = e.error.message;
    }
    if (msg && msg !== 'Script error.') {
      post('runtime_error', { message: msg, line: e.lineno, col: e.colno });
    }
  });

  window.addEventListener('unhandledrejection', function(e) {
    var reason = e.reason;
    var msg = reason ? (reason.message || String(reason)) : 'Unhandled Promise Rejection';
    post('runtime_error', { message: msg });
  });

})();`;

// A stray "</" inside the source would silently truncate the injected <script>
// tag and leave the rest of the bridge as visible page text. Fail loudly at
// module load instead of debugging it in a generated app.
if (BRIDGE_SOURCE.indexOf('</') !== -1) {
  throw new Error('previewBridge: BRIDGE_SOURCE contains "</", which would truncate the injected script tag.');
}

export const PREVIEW_BRIDGE_SCRIPT = BRIDGE_SOURCE;

const SCRIPT_OPEN = '<script>';
// Assembled so this module's own source never contains the literal sequence.
const SCRIPT_CLOSE = '</' + 'script>';

const buildTag = (token, initialStorage) => {
  const safeData = JSON.stringify(
    initialStorage && typeof initialStorage === 'object' ? initialStorage : {}
  ).replace(/</g, '\\u003c');

  const source = BRIDGE_SOURCE
    .replace('__ORION_TOKEN__', token)
    .replace('__ORION_INITIAL_STORAGE__', safeData);

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
 * @param {{ initialStorage?: Record<string, string> }} [options]
 * @returns {{ srcDoc: string, token: string }}
 */
export const injectPreviewBridge = (code, options = {}) => {
  const token = makeToken();

  if (typeof code !== 'string' || !code) {
    return { srcDoc: '', token };
  }

  const initialStorage = options?.initialStorage;
  const tag = buildTag(token, initialStorage);
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
