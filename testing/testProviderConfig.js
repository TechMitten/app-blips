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
  assert.deepEqual(USER_PROVIDER_IDS, ['openrouter', 'lmstudio', 'ollama']);
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
