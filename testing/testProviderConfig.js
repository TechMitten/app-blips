import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveAppProvider, resolveUserProvider, USER_PROVIDER_IDS, USER_PROVIDER_OPTIONS } from '../functions/_lib/providers.js';
import { describeConfig, formatConfigSummary } from '../functions/_lib/configSummary.js';
import { handleChatProxy } from '../functions/_lib/chatProxy.js';

const builderEnv = { OPENAI_API_KEY: 'or-key', OPENAI_LLM_MODEL: 'anthropic/claude-sonnet-5' };
const multiUserEnv = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'pk' };
const quiet = { quiet: true };

// --- Generated-app AI reuses the builder's provider -------------------------

test('app AI uses the builder provider, key, endpoint and model', () => {
  const app = resolveAppProvider(builderEnv, quiet);
  assert.equal(app.id, 'openrouter');
  assert.equal(app.apiKey, 'or-key');
  assert.equal(app.baseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(app.model, 'anthropic/claude-sonnet-5');
  assert.equal(app.reasoningParam, 'reasoning');
  assert.deepEqual(app.missing, []);
});

test('retired APPBLIPS_APP_* provider settings are ignored: app AI always shares the builder', () => {
  const env = {
    ...builderEnv,
    APPBLIPS_APP_LLM_PROVIDER: 'deepseek',
    APPBLIPS_APP_LLM_API_KEY: 'app-key',
    APPBLIPS_APP_LLM_MODEL: 'deepseek-chat',
    APPBLIPS_APP_LLM_BASE_URL: 'https://elsewhere.invalid/v1',
    APPBLIPS_APP_LLM_REASONING_PARAM: 'omit',
    APPBLIPS_APP_ZAI_API_KEY: 'z',
  };
  const app = resolveAppProvider(env, quiet);
  assert.deepEqual(
    { id: app.id, apiKey: app.apiKey, model: app.model, baseUrl: app.baseUrl, reasoningParam: app.reasoningParam },
    { id: 'openrouter', apiKey: 'or-key', model: 'anthropic/claude-sonnet-5', baseUrl: 'https://openrouter.ai/api/v1', reasoningParam: 'reasoning' },
  );
});

test('a builder configuration error propagates to app AI', () => {
  assert.match(resolveAppProvider({}, quiet).error, /No AI provider is configured/);
});

test('app AI reports the shared model variable when no model is set anywhere', () => {
  const app = resolveAppProvider({ APPBLIPS_OPENAI_API_KEY: 'k' }, quiet);
  assert.deepEqual(app.missing, ['OPENAI_LLM_MODEL']);
});

// --- Pre-rename APPBLIPS_LLM_* names ----------------------------------------

test('the old APPBLIPS_LLM_* names still configure the builder', () => {
  const app = resolveAppProvider({
    APPBLIPS_LLM_PROVIDER: 'zai', APPBLIPS_LLM_API_KEY: 'old-key',
    APPBLIPS_LLM_BASE_URL: 'https://api.z.ai/api/paas/v4', APPBLIPS_LLM_MODEL: 'glm-5.3-flash',
  }, quiet);
  assert.equal(app.id, 'zai');
  assert.equal(app.apiKey, 'old-key');
  assert.equal(app.model, 'glm-5.3-flash');
  assert.deepEqual(app.missing, []);
});

test('a new OPENAI_* name wins over its old APPBLIPS_LLM_* name', () => {
  const app = resolveAppProvider({
    OPENAI_LLM_PROVIDER: 'zai', APPBLIPS_LLM_PROVIDER: 'deepseek',
    OPENAI_API_KEY: 'new', APPBLIPS_LLM_API_KEY: 'old',
    OPENAI_LLM_MODEL: 'new-model', APPBLIPS_LLM_MODEL: 'old-model',
  }, quiet);
  assert.equal(app.id, 'zai');
  assert.equal(app.apiKey, 'new');
  assert.equal(app.model, 'new-model');
});

test('OPENAI_API_KEY is the fallback key for a named provider', () => {
  const app = resolveAppProvider({ OPENAI_LLM_PROVIDER: 'zai', OPENAI_API_KEY: 'k', OPENAI_LLM_MODEL: 'm' }, quiet);
  assert.equal(app.apiKey, 'k');
  assert.equal(app.baseUrl, 'https://api.z.ai/api/paas/v4');
});

test('summary lists old APPBLIPS_LLM_* names to rename', () => {
  const lines = describeConfig({ ...builderEnv, APPBLIPS_LLM_TEMPERATURE: '0.2' });
  assert.ok(lines.some((l) => l.level === 'warn' && /APPBLIPS_LLM_TEMPERATURE -> OPENAI_LLM_TEMPERATURE/.test(l.text)));
});

// --- Startup summary --------------------------------------------------------

const summary = (env) => formatConfigSummary(describeConfig(env));

test('summary never contains secret values', () => {
  const text = summary({
    ...builderEnv,
    ...multiUserEnv,
    FIREBASE_API_KEY: 'firebase-secret',
    APPBLIPS_APP_LLM_API_KEY: 'app-secret',
    APPBLIPS_APP_LLM_PROVIDER: 'openai',
    APPBLIPS_APP_LLM_MODEL: 'gpt-x',
  });
  for (const secret of ['or-key', 'firebase-secret', 'app-secret']) assert.ok(!text.includes(secret), secret);
});

test('summary shows app AI using the builder provider by default', () => {
  const text = summary(builderEnv);
  assert.match(text, /single-user/);
  assert.match(text, /OpenRouter · anthropic\/claude-sonnet-5/);
  assert.match(text, /relay, sharing the builder's provider · anthropic\/claude-sonnet-5/);
  assert.doesNotMatch(text, /BYOK/);
});

test('summary shows BYOK only when it is chosen explicitly', () => {
  assert.match(summary({ ...builderEnv, APPBLIPS_GENERATED_AI_MODE: 'byok' }), /BYOK/);
});

test('multi-user summary explains an empty configuration', () => {
  const lines = describeConfig(multiUserEnv);
  assert.ok(lines.some((l) => l.level === 'error' && /OPENAI_API_KEY/.test(l.text)));
});

test('summary warns when several provider keys are set', () => {
  const lines = describeConfig({ ...builderEnv, APPBLIPS_OPENAI_API_KEY: 'x' });
  const warning = lines.find((l) => l.level === 'warn');
  assert.match(warning.text, /using openai/);
  assert.match(warning.text, /OPENAI_LLM_PROVIDER/);
});

test('summary reports relay mode sharing the builder provider and model', () => {
  const text = summary({ ...builderEnv, APPBLIPS_GENERATED_AI_MODE: 'relay' });
  assert.match(text, /relay, sharing the builder's provider · anthropic\/claude-sonnet-5/);
});

test('multi-user summary shows deployed apps sharing the builder', () => {
  const lines = describeConfig({ ...builderEnv, ...multiUserEnv });
  assert.ok(lines.some((l) => /deployed apps, sharing the builder's provider/.test(l.text)));
});

test('summary warns about leftover APPBLIPS_APP_* provider settings', () => {
  const lines = describeConfig({ ...builderEnv, APPBLIPS_APP_LLM_API_KEY: 'app-key', APPBLIPS_APP_LLM_MODEL: 'cheap' });
  const warning = lines.find((l) => l.level === 'warn' && /no longer used/.test(l.text));
  assert.ok(warning);
  assert.match(warning.text, /APPBLIPS_APP_LLM_API_KEY, APPBLIPS_APP_LLM_MODEL/);
  assert.ok(!warning.text.includes('app-key'));
});

test('limits alone do not trigger the leftover warning', () => {
  const lines = describeConfig({ ...builderEnv, APPBLIPS_APP_AI_MAX_TOKENS: '512', APPBLIPS_APP_AI_REASONING_EFFORT: 'none' });
  assert.ok(!lines.some((l) => l.level === 'warn'));
});

test('pre-rename APPBLIPS_APP_LLM_* limits still apply and are flagged as renamed', async (t) => {
  const lines = describeConfig({ ...builderEnv, APPBLIPS_APP_LLM_MAX_TOKENS: '300' });
  assert.ok(lines.some((l) => l.level === 'warn' && /APPBLIPS_APP_LLM_MAX_TOKENS -> APPBLIPS_APP_AI_MAX_TOKENS/.test(l.text)));
  assert.ok(!lines.some((l) => /no longer used/.test(l.text)));

  let upstream;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    upstream = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { headers: { 'content-type': 'application/json' } });
  });
  const send = (env) => handleSelfHostedAiChat(new Request('https://app.example/api/app-ai/chat', {
    method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
  }), { ...builderEnv, APPBLIPS_APP_AI_RATE_LIMIT_MAX: '1000', ...env });
  await send({ APPBLIPS_APP_LLM_MAX_TOKENS: '300' });
  assert.equal(upstream.max_tokens, 300);
  // The new name wins when both are set.
  await send({ APPBLIPS_APP_LLM_MAX_TOKENS: '300', APPBLIPS_APP_AI_MAX_TOKENS: '200' });
  assert.equal(upstream.max_tokens, 200);
});

// --- Config errors: detail for the operator, nothing for hosted visitors ----

const chat = (env, headers = {}) => handleChatProxy(new Request('https://app.example/api/chat', {
  method: 'POST',
  headers,
  body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
}), { APPBLIPS_CHAT_RATE_LIMIT_MAX: '1000', ...env });

test('single-user config error tells the operator what to fix', async () => {
  const response = await chat({});
  assert.equal(response.status, 500);
  const { error } = await response.json();
  assert.match(error, /isn't set up yet/);
  assert.match(error, /OPENAI_API_KEY/);
  assert.match(error, /Settings → AI/);
});

test('single-user summary only warns when no provider is in .env', () => {
  const line = describeConfig({}).find((l) => l.label === 'Builder AI');
  assert.equal(line.level, 'warn');
  assert.match(line.text, /Settings → AI/);
  assert.equal(describeConfig(multiUserEnv).find((l) => l.label === 'Builder AI').level, 'error');
  // A real mistake (unknown provider) is still an error.
  assert.equal(describeConfig({ OPENAI_LLM_PROVIDER: 'nope' }).find((l) => l.label === 'Builder AI').level, 'error');
});

// --- User-supplied provider (Settings → AI) --------------------------------

test('resolveUserProvider accepts each preset and uses the preset endpoint', () => {
  for (const { id } of USER_PROVIDER_OPTIONS) {
    const p = resolveUserProvider({ id, apiKey: 'k', model: 'm', baseUrl: 'https://evil.invalid' });
    assert.equal(p.error, undefined);
    assert.equal(p.userSupplied, true);
    assert.notEqual(p.baseUrl, 'https://evil.invalid');
    assert.ok(p.baseUrl.startsWith('https://'));
  }
  assert.ok(!USER_PROVIDER_IDS.includes('openai-compatible'));
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


test('multi-user config error is generic to the client and logged server-side', async (t) => {
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args.join(' ')));
  // Sign-in is checked first: a user with their own provider needs no env key.
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ id: 'user-1' })));
  const response = await chat(multiUserEnv, { authorization: 'Bearer t' });
  assert.equal(response.status, 500);
  const { error } = await response.json();
  assert.doesNotMatch(error, /APPBLIPS_|\.env/);
  assert.ok(logged.some((line) => /No AI provider is configured/.test(line)));
});

// --- The relays use the shared provider end to end --------------------------

import { handleSelfHostedAiChat } from '../functions/_lib/selfHostedAiRelay.js';

test('self-hosted relay sends app AI through the builder provider and model', async (t) => {
  let upstream;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    upstream = { url, headers: options.headers, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { headers: { 'content-type': 'application/json' } });
  });
  const response = await handleSelfHostedAiChat(new Request('https://app.example/api/app-ai/chat', {
    method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
  }), { ...builderEnv, APPBLIPS_APP_AI_MAX_TOKENS: '512' });
  assert.equal(response.status, 200);
  assert.equal(upstream.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(upstream.headers.authorization, 'Bearer or-key');
  assert.equal(upstream.body.model, 'anthropic/claude-sonnet-5');
  // Cap comes from the app's own setting, not the builder's.
  assert.equal(upstream.body.max_tokens, 512);
  assert.deepEqual(upstream.body.reasoning, { effort: 'none' });
});

test('the self-hosted relay is on by default and off only when BYOK is chosen', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ choices: [] }), { headers: { 'content-type': 'application/json' } }));
  const call = (env) => handleSelfHostedAiChat(new Request('https://app.example/api/app-ai/chat', {
    method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
  }), env);
  assert.equal((await call(builderEnv)).status, 200);
  assert.equal((await call({ ...builderEnv, APPBLIPS_GENERATED_AI_MODE: 'relay' })).status, 200);
  assert.equal((await call({ ...builderEnv, APPBLIPS_GENERATED_AI_MODE: 'byok' })).status, 403);
});
