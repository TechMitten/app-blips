// Deployed-app AI shim. The deployment token is intentionally public: it is
// only a binding/rate-limit key, while the provider credential stays server-side.
const BRIDGE_SOURCE = `(function () {
  'use strict';
  var TOKEN = __APPBLIPS_AI_TOKEN__;
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
  function chat(messages, options) {
    options = options || {};
    var streaming = typeof options.onChunk === 'function';
    return fetch('/ai/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: TOKEN, messages: messages, temperature: options.temperature, max_tokens: options.maxTokens, stream: streaming })
    }).then(function (response) {
      if (!response.ok) return readError(response);
      if (!streaming) return response.json().then(function (data) {
        return { text: String(data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '') };
      });
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
            var raw = line.slice(5).trim();
            if (!raw || raw === '[DONE]') continue;
            try {
              var delta = JSON.parse(raw).choices[0].delta.content;
              if (delta) { text += delta; options.onChunk(delta); }
            } catch (err) { /* ignore malformed event */ }
          }
          return result.done ? { text: text } : pump();
        });
      }
      return pump();
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

export const AI_BRIDGE_SOURCE = BRIDGE_SOURCE;
const SCRIPT_OPEN = '<script data-appblips-ai="true">';
const SCRIPT_CLOSE = '</' + 'script>';

export const injectAiBridge = (html, token) => {
  if (typeof html !== 'string' || !html) return html;
  const source = BRIDGE_SOURCE.replace('__APPBLIPS_AI_TOKEN__', JSON.stringify(String(token)).replace(/</g, '\\u003c'));
  if (source.indexOf('</') !== -1) throw new Error('aiBridge: injected source contains a closing-tag sequence.');
  const tag = SCRIPT_OPEN + source + SCRIPT_CLOSE;
  const head = /<head\b[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length);
  const htmlTag = /<html\b[^>]*>/i.exec(html);
  if (htmlTag) return html.slice(0, htmlTag.index + htmlTag[0].length) + '<head>' + tag + '</' + 'head>' + html.slice(htmlTag.index + htmlTag[0].length);
  return tag + html;
};
