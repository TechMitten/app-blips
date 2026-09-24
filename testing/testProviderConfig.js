import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveAppProvider } from '../functions/_lib/providers.js';
import { describeConfig, formatConfigSummary } from '../functions/_lib/configSummary.js';
import { handleChatProxy } from '../functions/_lib/chatProxy.js';

const builderEnv = { APPBLIPS_OPENROUTER_API_KEY: 'or-key', APPBLIPS_LLM_MODEL: 'anthropic/claude-sonnet-5' };
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
  assert.deepEqual(app.missing, ['APPBLIPS_LLM_MODEL']);
});

// --- Startup summary --------------------------------------------------------

const summary = (env) => formatConfigSummary(describeConfig(env));

test('summary never contains secret values', () => {
  const text = summary({
    ...builderEnv,
    SELF_HOSTED_MODE: 'false',
    FIREBASE_API_KEY: 'firebase-secret',
    APPBLIPS_APP_LLM_API_KEY: 'app-secret',
    APPBLIPS_APP_LLM_PROVIDER: 'openai',
    APPBLIPS_APP_LLM_MODEL: 'gpt-x',
  });
  for (const secret of ['or-key', 'firebase-secret', 'app-secret']) assert.ok(!text.includes(secret), secret);
});

test('summary shows app AI using the builder provider by default', () => {
  const text = summary(builderEnv);
  assert.match(text, /self-hosted/);
  assert.match(text, /OpenRouter · anthropic\/claude-sonnet-5/);
  assert.match(text, /relay, sharing the builder's provider · anthropic\/claude-sonnet-5/);
  assert.doesNotMatch(text, /BYOK/);
});

test('summary shows BYOK only when it is chosen explicitly', () => {
  assert.match(summary({ ...builderEnv, APPBLIPS_GENERATED_AI_MODE: 'byok' }), /BYOK/);
});

test('summary explains an empty configuration', () => {
  const lines = describeConfig({});
  assert.ok(lines.some((l) => l.level === 'error' && /APPBLIPS_OPENROUTER_API_KEY/.test(l.text)));
});

test('summary warns when several provider keys are set', () => {
  const lines = describeConfig({ ...builderEnv, APPBLIPS_OPENAI_API_KEY: 'x' });
  const warning = lines.find((l) => l.level === 'warn');
  assert.match(warning.text, /using openai/);
  assert.match(warning.text, /APPBLIPS_LLM_PROVIDER/);
});

test('summary reports relay mode sharing the builder provider and model', () => {
  const text = summary({ ...builderEnv, APPBLIPS_GENERATED_AI_MODE: 'relay' });
  assert.match(text, /relay, sharing the builder's provider · anthropic\/claude-sonnet-5/);
});

test('hosted summary shows deployed apps sharing the builder and lists missing Firebase settings', () => {
  const lines = describeConfig({ ...builderEnv, SELF_HOSTED_MODE: 'false' });
  assert.ok(lines.some((l) => /deployed apps, sharing the builder's provider/.test(l.text)));
  assert.ok(lines.some((l) => l.level === 'error' && /VITE_FIREBASE_API_KEY/.test(l.text) && /\.env\.hosted\.example/.test(l.text)));
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

const chat = (env) => handleChatProxy(new Request('https://app.example/api/chat', {
  method: 'POST',
  body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
}), { APPBLIPS_CHAT_RATE_LIMIT_MAX: '1000', ...env });

test('self-hosted config error tells the operator what to fix', async () => {
  const response = await chat({ SELF_HOSTED_MODE: 'true' });
  assert.equal(response.status, 500);
  const { error } = await response.json();
  assert.match(error, /isn't set up yet/);
  assert.match(error, /APPBLIPS_OPENROUTER_API_KEY/);
});

test('hosted config error is generic to the client and logged server-side', async (t) => {
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args.join(' ')));
  const response = await chat({ SELF_HOSTED_MODE: 'false', FIREBASE_API_KEY: 'k' });
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
