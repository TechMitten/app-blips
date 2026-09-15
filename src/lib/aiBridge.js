// Deployed-app AI shim.
//
// The deployed page no longer carries a durable credential by default. It mints
// a short-lived, server-signed session token from /ai/session (optionally gated
// by an invisible Cloudflare Turnstile check) and sends that to /ai/chat. A
// copied page therefore loses AI access once its token expires, or immediately
// when the deployment's token generation is bumped (redeploy / AI toggle).
//
// When VITE_AI_SESSION_ENABLED is not 'true' the bridge falls back to the legacy
// public deployment token, so existing behavior is unchanged until an operator
// opts in (which also requires APPBLIPS_SESSION_SECRET server-side).
const BRIDGE_SOURCE = `(function () {
  'use strict';
  var LEGACY_TOKEN = __APPBLIPS_AI_TOKEN__;
  var SESSION_ENABLED = __APPBLIPS_AI_SESSION_ENABLED__;
  var TURNSTILE_SITE_KEY = __APPBLIPS_AI_TURNSTILE_SITE_KEY__;
  var TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

  function makeError(code, message) {
    var error = new Error(message || 'AI request failed.');
    error.code = code;
    return error;
  }
  function codeFor(status, body) {
    if (body && body.error && body.error.code) return body.error.code;
    if (status === 401 || status === 403) return 'unauthorized';
    if (status === 413) return 'payload_too_large';
    if (status === 429) return 'rate_limited';
    return status >= 500 ? 'upstream_error' : 'network';
  }
  function readError(response) {
    return response.json().catch(function () { return {}; }).then(function (body) {
      throw makeError(codeFor(response.status, body), body && body.error && (body.error.message || body.error));
    });
  }

  function deploymentSlug() {
    var path = location.pathname.replace(/^[/]+/, '').replace(/[/]+$/, '');
    try { return decodeURIComponent(path); } catch (err) { return path; }
  }

  var session = null;
  var turnstileWidget = null;
  var turnstileLoading = null;
  var turnstileResolve = null;
  var turnstileReject = null;

  function loadTurnstile() {
    if (!TURNSTILE_SITE_KEY) return Promise.resolve(null);
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (turnstileLoading) return turnstileLoading;
    turnstileLoading = new Promise(function (resolve, reject) {
      var node = document.createElement('script');
      node.src = TURNSTILE_SRC;
      node.async = true;
      node.defer = true;
      node.onload = function () {
        if (window.turnstile && typeof window.turnstile.ready === 'function') {
          window.turnstile.ready(function () { resolve(window.turnstile); });
        } else {
          resolve(window.turnstile || null);
        }
      };
      node.onerror = function () { reject(makeError('configuration_required', 'Browser verification failed to load.')); };
      document.head.appendChild(node);
    });
    return turnstileLoading;
  }

  function settleTurnstile(error, value) {
    var resolve = turnstileResolve;
    var reject = turnstileReject;
    turnstileResolve = null;
    turnstileReject = null;
    if (error) { if (reject) reject(error); return; }
    if (resolve) resolve(value);
  }

  function turnstileToken() {
    return loadTurnstile().then(function (turnstile) {
      if (!turnstile) return null;
      return new Promise(function (resolve, reject) {
        turnstileResolve = resolve;
        turnstileReject = reject;
        if (turnstileWidget === null) {
          var holder = document.createElement('div');
          holder.style.display = 'none';
          document.body.appendChild(holder);
          turnstileWidget = turnstile.render(holder, {
            sitekey: TURNSTILE_SITE_KEY,
            appearance: 'interaction-only',
            execution: 'execute',
            callback: function (value) { settleTurnstile(null, value); },
            'error-callback': function () { settleTurnstile(makeError('unauthorized', 'Browser verification failed.')); },
            'timeout-callback': function () { settleTurnstile(makeError('unauthorized', 'Browser verification timed out.')); }
          });
        }
        try { turnstile.reset(turnstileWidget); } catch (resetError) {}
        try { turnstile.execute(turnstileWidget); } catch (execError) {
          settleTurnstile(makeError('unauthorized', 'Browser verification failed.'));
        }
      });
    });
  }

  function storeSession(data) {
    var token = String(data && data.token || '');
    if (!token) throw makeError('upstream_error', 'AI session token missing.');
    session = { token: token, expiresAt: Number(data && data.expiresAt) || 0 };
    return session.token;
  }

  function mintSession() {
    return turnstileToken().then(function (verification) {
      var body = { slug: deploymentSlug() };
      if (verification) body.turnstileToken = verification;
      return fetch('/ai/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
    }).then(function (response) {
      if (!response.ok) return readError(response);
      return response.json().then(storeSession);
    });
  }

  function currentToken() {
    if (session && session.token && session.expiresAt - 60000 > Date.now()) return Promise.resolve(session.token);
    if (!SESSION_ENABLED) {
      if (LEGACY_TOKEN) return Promise.resolve(LEGACY_TOKEN);
      return Promise.reject(makeError('configuration_required', 'AI is not configured for this app.'));
    }
    return mintSession().catch(function (error) {
      if (LEGACY_TOKEN) return LEGACY_TOKEN;
      throw error;
    });
  }

  function send(token, messages, options, streaming) {
    return fetch('/ai/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: token, messages: messages, temperature: options.temperature, max_tokens: options.maxTokens, stream: streaming })
    });
  }

  function readStream(response, options) {
    if (!response.body) throw makeError('network', 'Streaming is unavailable.');
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var text = '';
    function pump() {
      return reader.read().then(function (result) {
        buffer += decoder.decode(result.value || new Uint8Array(), { stream: !result.done });
        var lines = buffer.split('\\n');
        buffer = result.done ? '' : lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (line.indexOf('data:') !== 0) continue;
          var eventRaw = line.slice(5).trim();
          if (!eventRaw || eventRaw === '[DONE]') continue;
          try {
            var delta = JSON.parse(eventRaw).choices[0].delta.content;
            if (delta) { text += delta; options.onChunk(delta); }
          } catch (err) { /* ignore malformed event */ }
        }
        return result.done ? { text: text } : pump();
      });
    }
    return pump();
  }

  function chat(messages, options) {
    options = options || {};
    var streaming = typeof options.onChunk === 'function';
    return currentToken().then(function (token) {
      return send(token, messages, options, streaming).then(function (response) {
        var usedSession = Boolean(session && session.token === token);
        if ((response.status === 401 || response.status === 403) && usedSession) {
          session = null;
          return currentToken().then(function (fresh) {
            return send(fresh, messages, options, streaming);
          });
        }
        return response;
      });
    }).then(function (response) {
      if (!response.ok) return readError(response);
      if (!streaming) return response.json().then(function (data) {
        return { text: String(data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '') };
      });
      return readStream(response, options);
    }).catch(function (error) {
      if (error && error.code) throw error;
      throw makeError('network', error && error.message);
    });
  }

  var textApi = chat;
  window.blip = Object.freeze({ ai: Object.freeze({ text: textApi }) });
  window.BLIP = Object.freeze({ AI: Object.freeze({ TEXT: textApi }) });
  // Compatibility for apps generated before the branded API was introduced.
  window.ai = Object.freeze({ chat: textApi });
})();`;

if (BRIDGE_SOURCE.indexOf('</') !== -1) throw new Error('aiBridge: source contains a closing-tag sequence.');

const AI_ENV = import.meta.env || {};
export const AI_SESSION_ENABLED = AI_ENV.VITE_AI_SESSION_ENABLED === 'true';
export const AI_TURNSTILE_SITE_KEY = String(AI_ENV.VITE_AI_TURNSTILE_SITE_KEY || '');

export const AI_BRIDGE_SOURCE = BRIDGE_SOURCE;
const SCRIPT_OPEN = '<script data-appblips-ai="true">';
const SCRIPT_CLOSE = '</' + 'script>';

export const injectAiBridge = (html, { token = null, sessionEnabled = AI_SESSION_ENABLED } = {}) => {
  if (typeof html !== 'string' || !html) return html;
  const source = BRIDGE_SOURCE
    .replace('__APPBLIPS_AI_TOKEN__', token ? JSON.stringify(String(token)) : 'null')
    .replace('__APPBLIPS_AI_SESSION_ENABLED__', sessionEnabled ? 'true' : 'false')
    .replace('__APPBLIPS_AI_TURNSTILE_SITE_KEY__', JSON.stringify(AI_TURNSTILE_SITE_KEY));
  if (source.indexOf('</') !== -1) throw new Error('aiBridge: injected source contains a closing-tag sequence.');
  const tag = SCRIPT_OPEN + source + SCRIPT_CLOSE;
  const head = /<head\b[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length);
  const htmlTag = /<html\b[^>]*>/i.exec(html);
  if (htmlTag) return html.slice(0, htmlTag.index + htmlTag[0].length) + '<head>' + tag + '</' + 'head>' + html.slice(htmlTag.index + htmlTag[0].length);
  return tag + html;
};
