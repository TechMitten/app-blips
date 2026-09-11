/* eslint-disable no-useless-escape */
// Self-hosted generated-app AI bridge. In BYOK mode credentials are entered by
// the person using the finished app and never baked into exported HTML. Relay
// mode embeds only the operator's public relay URL; its provider key stays in
// APPBLIPS_APP_LLM_* server-side environment variables.
const BRIDGE_SOURCE = `(function () {
  'use strict';
  var MODE = __APPBLIPS_APP_AI_MODE__;
  var RELAY_URL = __APPBLIPS_APP_AI_RELAY_URL__;
  var STORE_KEY = 'appblips-ai-provider';
  var configurePromise = null;

  function makeError(code, message) {
    var error = new Error(message || 'AI request failed.');
    error.code = code;
    return error;
  }

  function readStoredConfig() {
    var raw = null;
    try { raw = sessionStorage.getItem(STORE_KEY); } catch (err) { /* unavailable */ }
    if (!raw) try { raw = localStorage.getItem(STORE_KEY); } catch (err) { /* unavailable */ }
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      return parsed && parsed.endpoint && parsed.apiKey && parsed.model ? parsed : null;
    } catch (err) { return null; }
  }

  function saveConfig(config, remember) {
    var raw = JSON.stringify(config);
    try { sessionStorage.setItem(STORE_KEY, raw); } catch (err) { /* unavailable */ }
    try {
      if (remember) localStorage.setItem(STORE_KEY, raw);
      else localStorage.removeItem(STORE_KEY);
    } catch (err) { /* unavailable */ }
  }

  function clearConfiguration() {
    try { sessionStorage.removeItem(STORE_KEY); } catch (err) { /* unavailable */ }
    try { localStorage.removeItem(STORE_KEY); } catch (err) { /* unavailable */ }
  }

  function field(labelText, type, value, placeholder) {
    var label = document.createElement('label');
    label.style.cssText = 'display:grid;gap:6px;font:600 13px system-ui;color:#1e293b';
    label.appendChild(document.createTextNode(labelText));
    var input = document.createElement('input');
    input.type = type;
    input.value = value || '';
    input.placeholder = placeholder || '';
    input.required = true;
    input.style.cssText = 'box-sizing:border-box;width:100%;border:1px solid #cbd5e1;border-radius:10px;padding:10px 12px;font:14px system-ui;color:#0f172a;background:#fff;outline:none';
    label.appendChild(input);
    return { label: label, input: input };
  }

  function configure() {
    if (MODE === 'relay') return Promise.resolve({ mode: 'relay' });
    if (configurePromise) return configurePromise;
    configurePromise = new Promise(function (resolve, reject) {
      var existing = readStoredConfig() || {};
      var overlay = document.createElement('div');
      overlay.setAttribute('data-appblips-ai-config', 'true');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:20px;background:rgba(15,23,42,.62);backdrop-filter:blur(5px)';
      var form = document.createElement('form');
      form.style.cssText = 'box-sizing:border-box;width:min(440px,100%);display:grid;gap:16px;border:1px solid #e2e8f0;border-radius:18px;padding:22px;background:#f8fafc;box-shadow:0 24px 70px rgba(15,23,42,.35);font-family:system-ui;color:#0f172a';
      var title = document.createElement('strong');
      title.textContent = 'Connect your AI provider';
      title.style.cssText = 'font-size:20px;line-height:1.2';
      var note = document.createElement('p');
      note.textContent = 'Use your own OpenAI-compatible endpoint, model, and API key. The key stays in this browser and is not sent to AppBlips.';
      note.style.cssText = 'margin:0;font-size:13px;line-height:1.5;color:#64748b';
      var endpoint = field('API endpoint', 'url', existing.endpoint || 'https://api.openai.com/v1', 'https://api.openai.com/v1');
      var model = field('Model', 'text', existing.model || '', 'gpt-4o-mini');
      var key = field('API key', 'password', existing.apiKey || '', 'sk-...');
      key.input.autocomplete = 'off';
      var rememberLabel = document.createElement('label');
      rememberLabel.style.cssText = 'display:flex;gap:9px;align-items:flex-start;font:13px system-ui;color:#475569';
      var remember = document.createElement('input');
      remember.type = 'checkbox';
      remember.style.marginTop = '2px';
      rememberLabel.appendChild(remember);
      rememberLabel.appendChild(document.createTextNode('Remember on this device. Without this, the key is cleared when the tab closes.'));
      var warning = document.createElement('p');
      warning.textContent = 'Only use a key you are permitted to use in this browser. Do not embed a shared key in a public static app.';
      warning.style.cssText = 'margin:0;border-radius:10px;padding:9px 11px;background:#fff7ed;color:#9a3412;font:12px/1.45 system-ui';
      var actions = document.createElement('div');
      actions.style.cssText = 'display:flex;justify-content:flex-end;gap:9px';
      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      cancel.style.cssText = 'border:0;background:transparent;padding:9px 12px;font:600 14px system-ui;color:#64748b;cursor:pointer';
      var save = document.createElement('button');
      save.type = 'submit';
      save.textContent = 'Connect AI';
      save.style.cssText = 'border:0;border-radius:10px;background:#4f46e5;padding:10px 15px;font:700 14px system-ui;color:#fff;cursor:pointer';
      actions.appendChild(cancel);
      actions.appendChild(save);
      form.appendChild(title);
      form.appendChild(note);
      form.appendChild(endpoint.label);
      form.appendChild(model.label);
      form.appendChild(key.label);
      form.appendChild(rememberLabel);
      form.appendChild(warning);
      form.appendChild(actions);
      overlay.appendChild(form);
      (document.body || document.documentElement).appendChild(overlay);

      function finish() { overlay.remove(); configurePromise = null; }
      cancel.addEventListener('click', function () {
        finish();
        reject(makeError('configuration_required', 'AI provider configuration is required.'));
      });
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var base;
        try {
          base = new URL(endpoint.input.value.trim());
          if (base.protocol !== 'https:' && base.protocol !== 'http:') throw new Error('protocol');
        } catch (err) {
          endpoint.input.setCustomValidity('Enter a valid HTTP or HTTPS endpoint.');
          endpoint.input.reportValidity();
          return;
        }
        endpoint.input.setCustomValidity('');
        var config = { endpoint: base.toString().replace(/\\\/$/, ''), model: model.input.value.trim(), apiKey: key.input.value.trim() };
        if (!config.model || !config.apiKey) return;
        saveConfig(config, remember.checked);
        finish();
        resolve(config);
      });
    });
    return configurePromise;
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
      var message = body && body.error && (body.error.message || body.error);
      throw makeError(codeFor(response.status, body), typeof message === 'string' ? message : 'AI request failed.');
    });
  }

  function completionUrl(base) {
    var clean = String(base || '').replace(/\\\/+$/, '');
    return /\\/chat\\/completions$/i.test(clean) ? clean : clean + '/chat/completions';
  }

  function perform(messages, options, config) {
    var streaming = typeof options.onChunk === 'function';
    var relay = MODE === 'relay';
    var url = relay ? RELAY_URL : completionUrl(config.endpoint);
    if (!url) return Promise.reject(makeError('upstream_error', 'The self-hosted AI relay URL is not configured.'));
    var body = { messages: messages, temperature: options.temperature, max_tokens: options.maxTokens, stream: streaming };
    if (!relay) body.model = config.model;
    var headers = { 'content-type': 'application/json' };
    if (!relay) headers.authorization = 'Bearer ' + config.apiKey;
    return fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body) }).then(function (response) {
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
            } catch (err) { /* malformed event */ }
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

  function text(messages, options) {
    options = options || {};
    if (MODE === 'relay') return perform(messages, options, {});
    var config = readStoredConfig();
    return (config ? Promise.resolve(config) : configure()).then(function (readyConfig) {
      return perform(messages, options, readyConfig);
    });
  }

  var api = Object.freeze({
    text: text,
    configure: configure,
    isConfigured: function () { return MODE === 'relay' || !!readStoredConfig(); },
    clearConfiguration: clearConfiguration
  });
  window.blip = Object.freeze({ ai: api });
  window.BLIP = Object.freeze({ AI: Object.freeze({ TEXT: text }) });
  window.ai = Object.freeze({ chat: text });
})();`;

if (BRIDGE_SOURCE.indexOf('</') !== -1) {
  throw new Error('selfHostedAiBridge: source contains a closing-tag sequence.');
}

export const SELF_HOSTED_AI_BRIDGE_SOURCE = BRIDGE_SOURCE;
const SCRIPT_OPEN = '<script data-appblips-self-hosted-ai="true">';
const SCRIPT_CLOSE = '</' + 'script>';

export const injectSelfHostedAiBridge = (html, { mode = 'byok', relayUrl = '' } = {}) => {
  if (typeof html !== 'string' || !html) return html;
  const source = BRIDGE_SOURCE
    .replace('__APPBLIPS_APP_AI_MODE__', JSON.stringify(mode === 'relay' ? 'relay' : 'byok'))
    .replace('__APPBLIPS_APP_AI_RELAY_URL__', JSON.stringify(String(relayUrl)).replace(/</g, '\\u003c'));
  if (source.indexOf('</') !== -1) throw new Error('selfHostedAiBridge: injected source contains a closing-tag sequence.');
  const tag = SCRIPT_OPEN + source + SCRIPT_CLOSE;
  const head = /<head\b[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length);
  const htmlTag = /<html\b[^>]*>/i.exec(html);
  if (htmlTag) return html.slice(0, htmlTag.index + htmlTag[0].length) + '<head>' + tag + '</' + 'head>' + html.slice(htmlTag.index + htmlTag[0].length);
  return tag + html;
};
