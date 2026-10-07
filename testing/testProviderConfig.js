import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyProviderSettings, OPENROUTER_CODING_MODELS, resolveProvider, resolveUserProvider,
  USER_PROVIDER_IDS, USER_PROVIDER_OPTIONS,
} from '../functions/_lib/providers.js';
import { describeConfig, formatConfigSummary } from '../functions/_lib/configSummary.js';
import { handleChatProxy } from '../functions/_lib/chatProxy.js';
import { installFirebaseFake, signIdToken, PROJECT_ID } from './firebaseFake.js';

const builderEnv = { OPENAI_API_KEY: 'ds-key', OPENAI_LLM_MODEL: 'deepseek-v4-pro' };
const multiUserEnv = { FIREBASE_PROJECT_ID: PROJECT_ID };
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
  const text = summary({
    ...builderEnv,
    ...multiUserEnv,
    FIREBASE_SERVICE_ACCOUNT: '{"client_email":"x@y","private_key":"service-secret"}',
    R2_SECRET_ACCESS_KEY: 'r2-secret',
  });
  for (const secret of ['ds-key', 'service-secret', 'r2-secret']) assert.ok(!text.includes(secret), secret);
});

test('multi-user summary explains an empty configuration', () => {
  const lines = describeConfig(multiUserEnv);
  assert.ok(lines.some((l) => l.level === 'error' && /OPENAI_API_KEY/.test(l.text)));
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
  for (const { id, models } of USER_PROVIDER_OPTIONS) {
    const p = resolveUserProvider({ id, apiKey: 'k', model: models[0].id, baseUrl: 'https://evil.invalid' });
    assert.equal(p.error, undefined);
    assert.equal(p.userSupplied, true);
    assert.notEqual(p.baseUrl, 'https://evil.invalid');
    assert.ok(p.baseUrl.startsWith('https://'));
  }
  assert.ok(!USER_PROVIDER_IDS.includes('openai-compatible'));
});

test('self-hosted OpenRouter choices are curated for the coding workflow', () => {
  assert.deepEqual(USER_PROVIDER_IDS, ['openrouter']);
  assert.equal(OPENROUTER_CODING_MODELS.length, 5);
  assert.ok(OPENROUTER_CODING_MODELS.every(({ id, label }) => id.startsWith('~') && label));
  assert.equal(resolveUserProvider({
    id: 'openrouter', apiKey: 'sk-or-test', model: OPENROUTER_CODING_MODELS[0].id,
  }).baseUrl, 'https://openrouter.ai/api/v1');
  assert.match(resolveUserProvider({ id: 'openrouter', apiKey: 'k', model: 'arbitrary/model' }).error, /supported OpenRouter models/);
});

test('OpenRouter gets its compatible reasoning shape without DeepSeek fields', () => {
  const provider = resolveUserProvider({
    id: 'openrouter', apiKey: 'sk-or-test', model: OPENROUTER_CODING_MODELS[0].id,
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
    { id: 'openrouter', apiKey: 'k', model: 'unsupported/model' },
  ];
  for (const input of bad) assert.ok(resolveUserProvider(input).error, JSON.stringify(input));
});

test('multi-user config error is generic to the client and logged server-side', async (t) => {
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args.join(' ')));
  // Sign-in is checked first: a user with their own provider needs no env key.
  installFirebaseFake(t);
  const response = await chat(multiUserEnv, { authorization: `Bearer ${await signIdToken('user-1')}` });
  assert.equal(response.status, 500);
  const { error } = await response.json();
  assert.doesNotMatch(error, /APPBLIPS_|\.env/);
  assert.ok(logged.some((line) => /No AI provider is configured/.test(line)));
});
