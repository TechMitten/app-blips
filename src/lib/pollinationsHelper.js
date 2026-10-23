// The Pollinations helper for AI features in the pages AppBlips builds
// (window.Pollinations: chat, image, a ready-made Connect button). Like loop
// protection, it is added at preview/export time and never stored in `files`:
// the AI only writes calls to it, so the helper is always this exact code and
// a key never sits in the project's source.
//
// Who pays is the user's choice (Settings → Connectors → Pollinations):
//  - visitors (default, safer): each visitor connects their own Pollinations
//    account with the device flow and spends their own Pollen. The flow sends
//    AppBlips' publishable App Key, so the approval page names AppBlips; it
//    can't spend anything, so it is safe in the page.
//  - site key: the user's site key pays, so visitors need no account. That
//    key is in the page, which is unavoidable without a server: it is
//    scrambled so it isn't in plain sight or found by scanners looking for
//    "sk_", but anyone who opens the browser's network tools can still read
//    it. Settings says so and only accepts keys with a Pollen budget.
// With neither (site key chosen but not added), every call fails with a
// friendly message. The same API works in every mode, so a page built under
// one choice keeps working under the other: visitor mode shows its own
// Connect panel when the page has none.
import {
  POLLINATIONS_API, POLLINATIONS_APP_KEY, POLLINATIONS_AUTH, POLLINATIONS_EARNINGS, POLLINATIONS_IMAGE_MODEL,
  POLLINATIONS_TEXT_MODEL, POLLINATIONS_VISITOR_FEE_NOTE,
} from './pollinationsApp.js';

// Calls the AI writes (see the Pollinations directive in prompts.js).
const USES_HELPER_RE = /\bPollinations\s*\.\s*(?:chat|image|isAvailable|isConnected|onChange|mountConnect)\b/;
export const usesPollinationsHelper = (html) => typeof html === 'string' && USES_HELPER_RE.test(html);

// A secret key as two byte lists that XOR back to it, with a fresh mask each
// time, so the page never contains the key or a fixed encoding of it.
export const scrambleKey = (key, random = (n) => crypto.getRandomValues(new Uint8Array(n))) => {
  const bytes = new TextEncoder().encode(key);
  const mask = random(bytes.length);
  return { data: Array.from(bytes, (b, i) => b ^ mask[i]), mask: Array.from(mask) };
};

const helperSource = ({ siteKey, visitors }) => {
  const scrambled = siteKey ? scrambleKey(siteKey) : null;
  return `<script data-appblips-pollinations>
window.Pollinations = (function () {
  var AUTH = ${JSON.stringify(POLLINATIONS_AUTH)}, API = ${JSON.stringify(POLLINATIONS_API)}, APP_KEY = ${JSON.stringify(POLLINATIONS_APP_KEY)};
  var TEXT_MODEL = ${JSON.stringify(POLLINATIONS_TEXT_MODEL)}, IMAGE_MODEL = ${JSON.stringify(POLLINATIONS_IMAGE_MODEL)};
  var site = ${scrambled ? JSON.stringify(scrambled) : 'null'};
  var visitors = ${!scrambled && visitors ? 'true' : 'false'};
  var STORE = 'pollinations-visitor-key';
  var UNAVAILABLE = 'AI features are unavailable right now.';
  var key = null;
  if (site) key = site.data.map(function (b, i) { return String.fromCharCode(b ^ site.mask[i]); }).join('');
  else if (visitors) { try { key = sessionStorage.getItem(STORE); } catch (e) { key = null; } }
  var listeners = [];
  var mounted = 0;
  function setKey(next) {
    key = next;
    try { if (next) sessionStorage.setItem(STORE, next); else sessionStorage.removeItem(STORE); } catch (e) { /* storage blocked */ }
    listeners.forEach(function (fn) { try { fn(Boolean(key)); } catch (e) { /* app callback */ } });
  }
  function fail(code, message) { var err = new Error(message); err.code = code; return err; }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function post(url, body) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (res) { return res.json().catch(function () { return {}; }); });
  }
  // Device flow: onCode({ url, code }) shows the visitor where to approve.
  async function connect(onCode) {
    if (!visitors || key) return;
    var start = await post(AUTH + '/api/device/code', { client_id: APP_KEY });
    if (!start.device_code) throw fail('failed', 'Couldn\\u2019t start the Pollinations sign-in. Try again.');
    if (onCode) onCode({ url: start.verification_uri_complete || start.verification_uri, code: start.user_code });
    var interval = (start.interval || 5) * 1000;
    var deadline = Date.now() + (start.expires_in || 1800) * 1000;
    while (Date.now() < deadline) {
      await wait(interval);
      var poll = await post(AUTH + '/api/device/token', { device_code: start.device_code, client_id: APP_KEY }).catch(function () { return { error: 'authorization_pending' }; });
      if (poll.access_token) { setKey(poll.access_token); return; }
      if (poll.error === 'slow_down') interval += 5000;
      else if (poll.error !== 'authorization_pending') throw fail('failed', 'The Pollinations sign-in was cancelled.');
    }
    throw fail('failed', 'The Pollinations sign-in timed out. Try again.');
  }
  function el(tag, text, style) { var n = document.createElement(tag); if (text) n.textContent = text; if (style) n.style.cssText = style; return n; }
  // A Connect button that also shows the approval link and code on the page,
  // since a pop-up can be blocked. Only in visitor mode.
  function mountConnect(container) {
    if (!container || !visitors) return;
    mounted++;
    function render() {
      container.textContent = '';
      var box = el('div', '', 'display:flex;flex-wrap:wrap;align-items:center;gap:8px;font:inherit;');
      if (key) {
        box.appendChild(el('span', 'Connected to Pollinations'));
        var out = el('button', 'Disconnect', 'font:inherit;cursor:pointer;');
        out.type = 'button';
        out.onclick = function () { setKey(null); };
        box.appendChild(out);
      } else {
        var btn = el('button', 'Connect Pollinations', 'font:inherit;cursor:pointer;');
        btn.type = 'button';
        var status = el('span', ${JSON.stringify(`AI features use your own free Pollinations account.${POLLINATIONS_EARNINGS ? ` ${POLLINATIONS_VISITOR_FEE_NOTE}` : ''}`)});
        status.setAttribute('role', 'status');
        btn.onclick = function () {
          btn.disabled = true;
          var popup = null;
          try { popup = window.open('', '_blank'); } catch (e) { popup = null; }
          connect(function (info) {
            status.textContent = '';
            status.appendChild(document.createTextNode('Approve on '));
            var link = el('a', 'enter.pollinations.ai');
            link.href = info.url; link.target = '_blank'; link.rel = 'noopener';
            status.appendChild(link);
            status.appendChild(document.createTextNode(' with code ' + info.code + ', then come back here.'));
            if (popup) { try { popup.location.href = info.url; } catch (e) { /* closed */ } }
          }).then(render, function (err) {
            if (popup) { try { popup.close(); } catch (e) { /* gone */ } }
            btn.disabled = false;
            status.textContent = err.message;
          });
        };
        box.appendChild(btn);
        box.appendChild(status);
      }
      container.appendChild(box);
    }
    listeners.push(render);
    render();
  }
  // A page built while the site key paid has no Connect button of its own.
  var panel = null;
  function showPanel() {
    if (panel || mounted || !document.body) return;
    panel = el('div', '', 'position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483000;max-width:520px;margin:0 auto;padding:12px 14px;border-radius:12px;background:#fff;color:#111;box-shadow:0 8px 24px rgba(0,0,0,.2);font:14px/1.4 system-ui,sans-serif;');
    document.body.appendChild(panel);
    mountConnect(panel);
    mounted--;
    listeners.push(function (connected) { if (connected && panel) { panel.remove(); panel = null; } });
  }
  async function call(path, init) {
    if (!key) {
      if (!visitors) throw fail('unavailable', UNAVAILABLE);
      showPanel();
      throw fail('not-connected', 'Connect your Pollinations account to use this.');
    }
    init.headers = Object.assign({ Authorization: 'Bearer ' + key }, init.headers || {});
    var res;
    try { res = await fetch(API + path, init); } catch (e) { throw fail('failed', 'Couldn\\u2019t reach Pollinations. Check your connection and try again.'); }
    if (res.status === 401) {
      if (!visitors) throw fail('unavailable', UNAVAILABLE);
      setKey(null);
      throw fail('not-connected', 'Your Pollinations connection has ended. Connect again.');
    }
    if (res.status === 402 || res.status === 403) throw fail(visitors ? 'out-of-pollen' : 'unavailable', visitors ? 'Your Pollinations account is out of Pollen, or this connection has used its limit.' : UNAVAILABLE);
    if (res.status === 429) throw fail('busy', 'Pollinations is busy. Try again in a moment.');
    if (!res.ok) throw fail('failed', 'Pollinations couldn\\u2019t answer (error ' + res.status + '). Try again.');
    return res;
  }
  return {
    isAvailable: function () { return Boolean(key); },
    isConnected: function () { return Boolean(key); },
    onChange: function (fn) { listeners.push(fn); },
    connect: connect,
    mountConnect: mountConnect,
    // messages: [{ role: 'system' | 'user' | 'assistant', content: '...' }] -> the reply text
    chat: async function (messages, options) {
      var res = await call('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: (options && options.model) || TEXT_MODEL, messages: messages })
      });
      var data = await res.json();
      return data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content || '' : '';
    },
    // -> an object URL for <img src>; options: { width, height, seed, model }
    image: async function (prompt, options) {
      var params = new URLSearchParams(Object.assign({ model: IMAGE_MODEL, width: 1024, height: 1024 }, options || {}));
      var res = await call('/image/' + encodeURIComponent(prompt) + '?' + params, { method: 'GET' });
      return URL.createObjectURL(await res.blob());
    }
  };
})();
</script>`;
};

// Adds the helper at the top of <head> (before the app's own scripts) when
// the page calls it. `options` is getPollinationsHelperOptions() from
// connectors.js: { siteKey, visitors }.
export const injectPollinationsHelper = (html, { siteKey = '', visitors = false } = {}) => {
  if (!usesPollinationsHelper(html)) return html;
  const script = helperSource({ siteKey, visitors });
  const head = /<head\b[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + script + html.slice(head.index + head[0].length);
  const doc = /<html\b[^>]*>/i.exec(html);
  if (doc) return html.slice(0, doc.index + doc[0].length) + script + html.slice(doc.index + doc[0].length);
  return script + html;
};
