import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveProvider, resolveUserProvider, USER_PROVIDER_IDS, USER_PROVIDER_OPTIONS } from '../functions/_lib/providers.js';
import { describeConfig, formatConfigSummary } from '../functions/_lib/configSummary.js';
import { handleChatProxy } from '../functions/_lib/chatProxy.js';
import { installFirebaseFake, signIdToken, PROJECT_ID } from './firebaseFake.js';

const builderEnv = { OPENAI_API_KEY: 'or-key', OPENAI_LLM_MODEL: 'anthropic/claude-sonnet-5' };
const multiUserEnv = { FIREBASE_PROJECT_ID: PROJECT_ID };
const quiet = { quiet: true };

// --- Builder provider ---------------------------------------------------------

test('the builder uses the OpenRouter key, endpoint and model', () => {
  const app = resolveProvider(builderEnv, 'APPBLIPS_LLM', quiet);
  assert.equal(app.id, 'openrouter');
  assert.equal(app.apiKey, 'or-key');
  assert.equal(app.baseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(app.model, 'anthropic/claude-sonnet-5');
  assert.equal(app.reasoningParam, 'reasoning');
  assert.deepEqual(app.missing, []);
});

test('no provider key is a configuration error', () => {
  assert.match(resolveProvider({}, 'APPBLIPS_LLM', quiet).error, /No AI provider is configured/);
});

test('a missing model names the model variable', () => {
  const app = resolveProvider({ APPBLIPS_OPENAI_API_KEY: 'k' }, 'APPBLIPS_LLM', quiet);
  assert.deepEqual(app.missing, ['OPENAI_LLM_MODEL']);
});

// --- Pre-rename APPBLIPS_LLM_* names ----------------------------------------

test('the old APPBLIPS_LLM_* names still configure the builder', () => {
  const app = resolveProvider({
    APPBLIPS_LLM_PROVIDER: 'openrouter', APPBLIPS_LLM_API_KEY: 'old-key', APPBLIPS_LLM_MODEL: 'old/model',
  }, 'APPBLIPS_LLM', quiet);
  assert.equal(app.id, 'openrouter');
  assert.equal(app.apiKey, 'old-key');
  assert.equal(app.model, 'old/model');
  assert.deepEqual(app.missing, []);
});

test('a new OPENAI_* name wins over its old APPBLIPS_LLM_* name', () => {
  const app = resolveProvider({
    OPENAI_LLM_PROVIDER: 'openrouter', APPBLIPS_LLM_PROVIDER: 'zai',
    OPENAI_API_KEY: 'new', APPBLIPS_LLM_API_KEY: 'old',
    OPENAI_LLM_MODEL: 'new-model', APPBLIPS_LLM_MODEL: 'old-model',
  }, 'APPBLIPS_LLM', quiet);
  assert.equal(app.id, 'openrouter');
  assert.equal(app.apiKey, 'new');
  assert.equal(app.model, 'new-model');
});

test('OPENAI_API_KEY wins over APPBLIPS_OPENROUTER_API_KEY', () => {
  const app = resolveProvider({ OPENAI_API_KEY: 'k', APPBLIPS_OPENROUTER_API_KEY: 'or', OPENAI_LLM_MODEL: 'm' }, 'APPBLIPS_LLM', quiet);
  assert.equal(app.apiKey, 'k');
  assert.equal(app.baseUrl, 'https://openrouter.ai/api/v1');
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
    FIREBASE_SERVICE_ACCOUNT: '{"client_email":"x@y","private_key":"service-secret"}',
    R2_SECRET_ACCESS_KEY: 'r2-secret',
  });
  for (const secret of ['or-key', 'service-secret', 'r2-secret']) assert.ok(!text.includes(secret), secret);
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
  installFirebaseFake(t);
  const response = await chat(multiUserEnv, { authorization: `Bearer ${await signIdToken('user-1')}` });
  assert.equal(response.status, 500);
  const { error } = await response.json();
  assert.doesNotMatch(error, /APPBLIPS_|\.env/);
  assert.ok(logged.some((line) => /No AI provider is configured/.test(line)));
});

