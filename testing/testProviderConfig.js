import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyProviderSettings, resolveProvider, resolveUserProvider,
  USER_PROVIDER_IDS, USER_PROVIDER_OPTIONS,
} from '../electron/server/providers.js';
import { describeConfig, formatConfigSummary } from '../electron/server/configSummary.js';
import { handleChatProxy } from '../electron/server/chatProxy.js';

const builderEnv = { OPENAI_API_KEY: 'ds-key', OPENAI_LLM_MODEL: 'deepseek-v4-pro' };
const quiet = { quiet: true };

// --- Builder provider ---------------------------------------------------------

test('the builder uses the DeepSeek key, endpoint and model', () => {
  const app = resolveProvider(builderEnv, 'APPBLIPS_LLM', quiet);
  assert.equal(app.id, 'deepseek');
  assert.equal(app.apiKey, 'ds-key');
  assert.equal(app.baseUrl, 'https://api.deepseek.com');
  assert.equal(app.model, 'deepseek-v4-pro');
  assert.equal(app.reasoningParam, 'reasoning_effort');
  assert.deepEqual(app.missing, []);
});

test('no provider key is a configuration error', () => {
  assert.match(resolveProvider({}, 'APPBLIPS_LLM', quiet).error, /No AI provider is configured/);
});

test('a missing model names the model variable', () => {
  const app = resolveProvider({ OPENAI_API_KEY: 'k' }, 'APPBLIPS_LLM', quiet);
  assert.deepEqual(app.missing, ['OPENAI_LLM_MODEL']);
});

// --- Startup summary --------------------------------------------------------

const summary = (env) => formatConfigSummary(describeConfig(env));

test('summary never contains secret values', () => {
  const text = summary(builderEnv);
  assert.ok(!text.includes('ds-key'));
});

test('an empty configuration warns about the missing provider', () => {
  const line = describeConfig({}).find((l) => l.label === 'Builder AI');
  assert.equal(line.level, 'warn');
  assert.match(line.text, /Settings → AI/);
});

// --- Config errors: detail for the operator ---------------------------------

const chat = (env) => handleChatProxy(new Request('https://app.example/api/chat', {
  method: 'POST',
  body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
}), env);

test('a config error tells the operator what to fix', async () => {
  const response = await chat({});
  assert.equal(response.status, 500);
  const { error } = await response.json();
  assert.match(error, /isn't set up yet/);
  assert.match(error, /OPENAI_API_KEY/);
  assert.match(error, /Settings → AI/);
});

test('a real mistake (unknown provider) is still an error', () => {
  assert.equal(describeConfig({ OPENAI_LLM_PROVIDER: 'nope' }).find((l) => l.label === 'Builder AI').level, 'error');
});

// --- User-supplied provider (Settings → AI) --------------------------------

test('resolveUserProvider accepts each preset and uses the preset endpoint', () => {
  for (const { id, baseUrl } of USER_PROVIDER_OPTIONS) {
    const p = resolveUserProvider({ id, apiKey: 'k', model: 'any/model' });
    assert.equal(p.error, undefined);
    assert.equal(p.userSupplied, true);
    assert.notEqual(p.baseUrl, 'https://evil.invalid');
    assert.equal(p.baseUrl, baseUrl);
  }
  assert.ok(!USER_PROVIDER_IDS.includes('openai-compatible'));
});

test('self-hosted OpenRouter choices allow dynamic models', () => {
  assert.deepEqual(USER_PROVIDER_IDS, ['openrouter', 'anthropic', 'openai', 'gemini', 'deepseek', 'lmstudio', 'ollama']);
  assert.equal(resolveUserProvider({
    id: 'openrouter', apiKey: 'sk-or-test', model: 'arbitrary/model',
  }).baseUrl, 'https://openrouter.ai/api/v1');
});

test('OpenRouter gets its compatible reasoning shape without DeepSeek fields', () => {
  const provider = resolveUserProvider({
    id: 'openrouter', apiKey: 'sk-or-test', model: 'anthropic/claude-3-haiku',
  });
  const enabled = { temperature: 0 };
  applyProviderSettings(enabled, provider, { effort: 'high' });
  assert.equal(enabled.reasoning_effort, 'high');
  assert.equal(Object.hasOwn(enabled, 'thinking'), false);
  assert.equal(Object.hasOwn(enabled, 'temperature'), false);

  const disabled = { temperature: 0.2 };
  applyProviderSettings(disabled, provider, { effort: 'none' });
  assert.deepEqual(disabled, { temperature: 0.2 });
});

test('resolveUserProvider rejects bad input', () => {
  const bad = [
    null, 'x', [],
    { id: 'openai-compatible', apiKey: 'k', model: 'm' },
    { id: 'nope', apiKey: 'k', model: 'm' },
    { id: 'openai', apiKey: '', model: 'm' },
    { id: 'openai', apiKey: 'a b', model: 'm' },
    { id: 'openai', apiKey: 'k'.repeat(513), model: 'm' },
    { id: 'openai', apiKey: 'k', model: '' },
    { id: 'openai', apiKey: 'k', model: 'm'.repeat(201) },
  ];
  for (const input of bad) assert.ok(resolveUserProvider(input).error, JSON.stringify(input));
});

for (const id of ['lmstudio', 'ollama']) {
  test(`${id} works without a key and accepts a custom loopback port`, () => {
    const provider = resolveUserProvider({ id, model: 'local-coder', baseUrl: 'http://127.0.0.1:12345/v1/' });
    assert.equal(provider.error, undefined);
    assert.equal(provider.baseUrl, 'http://127.0.0.1:12345/v1');
    const body = { temperature: 0, reasoning_effort: 'high', stream_options: { include_usage: true }, tool_choice: { type: 'function', function: { name: 'edit' } } };
    applyProviderSettings(body, provider, { effort: 'high' });
    assert.deepEqual(body, { temperature: 0, tool_choice: 'auto' });
    for (const baseUrl of ['https://evil.invalid/v1', 'file:///tmp/model', 'http://localhost:1234/v1?key=secret', 'http://user:password@localhost:1234/v1']) {
      assert.ok(resolveUserProvider({ id, model: 'local-coder', baseUrl }).error);
    }
  });

  test(`${id} chat requests reach the selected local endpoint`, async () => {
    const originalFetch = globalThis.fetch;
    let target;
    let upstreamBody;
    globalThis.fetch = async (url, options) => {
      target = url;
      upstreamBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { headers: { 'content-type': 'application/json' } });
    };
    try {
      const response = await handleChatProxy(new Request('http://localhost/api/chat', {
        method: 'POST',
        body: JSON.stringify({ user_provider: { id, model: 'local-coder' }, messages: [{ role: 'user', content: 'hi' }], stream: false }),
      }), {});
      assert.equal(response.status, 200);
      assert.equal(target, `${USER_PROVIDER_OPTIONS.find((p) => p.id === id).baseUrl}/chat/completions`);
      assert.equal(upstreamBody.model, 'local-coder');
    } finally { globalThis.fetch = originalFetch; }
  });
}

test('Gemini uses the official endpoint and compatible reasoning settings', async (t) => {
  const provider = resolveUserProvider({ id: 'gemini', apiKey: 'google-key', model: 'gemini-test', baseUrl: 'https://evil.invalid' });
  assert.equal(provider.baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.ok(resolveUserProvider({ id: 'gemini', model: 'gemini-test' }).error);
  const body = { temperature: 0, tool_choice: 'required', stream_options: { include_usage: true } };
  applyProviderSettings(body, provider, { effort: 'high' });
  assert.equal(body.reasoning_effort, 'high');
  assert.equal(body.temperature, undefined);
  assert.equal(body.thinking, undefined);
  assert.equal(body.tool_choice, 'required');
  const off = {};
  applyProviderSettings(off, provider, { effort: 'none' });
  assert.equal(off.reasoning_effort, undefined);
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, `${provider.baseUrl}/chat/completions`);
    assert.equal(options.headers.Authorization, 'Bearer google-key');
    const payload = JSON.parse(options.body);
    assert.equal(payload.model, 'gemini-test');
    assert.equal(payload.reasoning_effort, 'high');
    return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
  });
  const response = await handleChatProxy(new Request('http://localhost/api/chat', {
    method: 'POST', body: JSON.stringify({ user_provider: { id: 'gemini', apiKey: 'google-key', model: 'gemini-test' }, messages: [{ role: 'user', content: 'hi' }], reasoning_effort: 'high' }),
  }), {});
  assert.equal(response.status, 200);
});

test('user-selected DeepSeek uses its official API and thinking settings', async (t) => {
  assert.ok(resolveUserProvider({ id: 'deepseek', model: 'deepseek-test' }).error);
  const provider = resolveUserProvider({ id: 'deepseek', apiKey: 'ds-user-key', model: 'deepseek-test', baseUrl: 'https://evil.invalid' });
  assert.equal(provider.baseUrl, 'https://api.deepseek.com');
  const body = { temperature: 0 };
  applyProviderSettings(body, provider, { effort: 'high' });
  assert.deepEqual(body, { thinking: { type: 'enabled' }, reasoning_effort: 'high' });
  const off = {};
  applyProviderSettings(off, provider, { effort: 'none' });
  assert.deepEqual(off, { thinking: { type: 'disabled' } });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer ds-user-key');
    const payload = JSON.parse(options.body);
    assert.equal(payload.model, 'deepseek-test');
    assert.deepEqual(payload.thinking, { type: 'enabled' });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
  });
  const response = await handleChatProxy(new Request('http://localhost/api/chat', {
    method: 'POST', body: JSON.stringify({ user_provider: { id: 'deepseek', apiKey: 'ds-user-key', model: 'deepseek-test' }, messages: [{ role: 'user', content: 'hi' }], reasoning_effort: 'high' }),
  }), builderEnv);
  assert.equal(response.status, 200);
});

test('OpenAI adapts token limits and model-specific reasoning parameters', () => {
  for (const model of ['gpt-5-mini', 'o3-mini', 'gpt-4.1']) {
    const provider = resolveUserProvider({ id: 'openai', apiKey: 'openai-key', model, baseUrl: 'https://evil.invalid' });
    assert.equal(provider.baseUrl, 'https://api.openai.com/v1');
    for (const effort of ['high', 'none']) {
      const body = { model, temperature: 0.2, max_tokens: 4096, tool_choice: 'required', stream_options: { include_usage: true } };
      applyProviderSettings(body, provider, { effort });
      assert.equal(body.max_tokens, undefined);
      assert.equal(body.max_completion_tokens, 4096);
      assert.equal(body.thinking, undefined);
      assert.equal(body.reasoning_effort, model === 'gpt-4.1' || effort === 'none' ? undefined : 'high');
      if (model !== 'gpt-4.1') assert.equal(body.temperature, undefined);
      assert.equal(body.tool_choice, 'required');
      assert.deepEqual(body.stream_options, { include_usage: true });
    }
  }
});

test('user-selected OpenAI sends its key and model to the official endpoint', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer openai-user-key');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'gpt-5-mini');
    assert.equal(body.max_tokens, undefined);
    assert.equal(body.max_completion_tokens, 4096);
    assert.equal(body.reasoning_effort, 'high');
    assert.equal(body.temperature, undefined);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
  });
  const response = await handleChatProxy(new Request('http://localhost/api/chat', {
    method: 'POST', body: JSON.stringify({ user_provider: { id: 'openai', apiKey: 'openai-user-key', model: 'gpt-5-mini' }, messages: [{ role: 'user', content: 'hi' }], reasoning_effort: 'high' }),
  }), { ...builderEnv, OPENAI_LLM_MAX_TOKENS: '4096' });
  assert.equal(response.status, 200);
});
