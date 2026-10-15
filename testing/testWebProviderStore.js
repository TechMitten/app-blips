import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { webProviderStore } from '../src/lib/desktop.js';
import { handleChatProxy } from '../electron/server/chatProxy.js';
import { handleProviderApi } from '../electron/server/providerApi.js';
import { createKeyFile } from '../electron/server/keyFile.js';
import { withSavedProvider } from '../electron/server/savedProvider.js';

const ORIGIN = 'http://localhost:5175';

// The browser version end to end: the page's store, its /api/provider calls
// answered by the real handler over a temporary key file, and /api/chat with
// the server attaching the saved key. `upstream` stands in for the provider.
async function setup(t, { legacy = null } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'appblips-keys-'));
  const file = join(dir, 'provider-key.json');
  const values = new Map(legacy ? [['appblips-web-provider', JSON.stringify(legacy)]] : []);
  const originalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;
  const keys = createKeyFile({ file });
  const env = {};
  const ctx = { file, keys, values, upstream: null };
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  globalThis.fetch = async (url, options = {}) => {
    if (typeof url === 'string' && url.startsWith('/api/')) {
      const request = new Request(ORIGIN + url, { ...options, headers: { ...options.headers, origin: ORIGIN } });
      if (url === '/api/chat') return handleChatProxy(await withSavedProvider(request, keys), env);
      return handleProviderApi(request, env, keys);
    }
    return ctx.upstream(url, options);
  };
  t.after(async () => {
    globalThis.localStorage = originalStorage;
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  });
  return ctx;
}

const chat = (provider) => fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ...(provider ? { user_provider: provider } : {}), messages: [{ role: 'user', content: 'Reply OK' }], ask: true }),
});

test('a saved key stays on the server and is attached to chat requests', async (t) => {
  const ctx = await setup(t);
  const info = await webProviderStore.set({ enabled: true, id: 'openrouter', model: 'saved-model', apiKey: 'saved-test-key' });
  assert.equal(info.hasKey, true);
  assert.equal(info.apiKey, undefined);
  assert.doesNotMatch(ctx.values.get('appblips-web-provider'), /saved-test-key/);
  assert.equal(JSON.parse(await readFile(ctx.file, 'utf8')).key, 'saved-test-key');
  if (process.platform !== 'win32') assert.equal((await stat(ctx.file)).mode & 0o777, 0o600);

  // The page sends no key, for the saved provider or a draft.
  const draft = { id: 'openrouter', model: 'draft-model', apiKey: '' };
  assert.deepEqual(webProviderStore.forRequest(), { id: 'openrouter', model: 'saved-model', baseUrl: 'https://openrouter.ai/api/v1' });
  assert.equal(webProviderStore.forRequest(draft).apiKey, '');

  const seen = [];
  ctx.upstream = async (_url, options) => {
    seen.push({ auth: options.headers.Authorization, model: JSON.parse(options.body).model });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
  };
  assert.equal((await chat(webProviderStore.forRequest())).status, 200);
  assert.equal((await chat(webProviderStore.forRequest(draft))).status, 200);
  assert.equal((await chat({ ...draft, apiKey: 'replacement-key' })).status, 200);
  assert.deepEqual(seen, [
    { auth: 'Bearer saved-test-key', model: 'saved-model' },
    { auth: 'Bearer saved-test-key', model: 'draft-model' },
    { auth: 'Bearer replacement-key', model: 'draft-model' },
  ]);

  // Saving again without typing a key keeps it; another provider never gets it.
  assert.equal((await webProviderStore.set({ enabled: true, id: 'openrouter', model: 'other-model', apiKey: '' })).hasKey, true);
  assert.equal(ctx.keys.keyFor('gemini'), '');
  await assert.rejects(webProviderStore.set({ enabled: true, id: 'gemini', model: 'g', apiKey: '' }), /key is empty/);

  await webProviderStore.clear();
  assert.equal(existsSync(ctx.file), false);
  assert.equal(webProviderStore.forRequest(), null);
  assert.equal((await webProviderStore.get()).hasKey, false);
});

test('a key saved in the browser by an older version moves to the server', async (t) => {
  const ctx = await setup(t, { legacy: { enabled: true, id: 'gemini', model: 'm', apiKey: 'legacy-key', baseUrl: '', onboardingComplete: true } });
  const info = await webProviderStore.get();
  assert.equal(info.hasKey, true);
  assert.equal(info.model, 'm');
  assert.equal(ctx.keys.keyFor('gemini'), 'legacy-key');
  assert.doesNotMatch(ctx.values.get('appblips-web-provider'), /legacy-key/);
  assert.equal(JSON.parse(ctx.values.get('appblips-web-provider')).onboardingComplete, true);
});

test('other sites cannot use or change the saved key', async (t) => {
  const ctx = await setup(t);
  await ctx.keys.save('openai', 'secret');
  for (const origin of ['https://evil.example', 'null']) {
    for (const [method, path, body] of [['GET', '/api/provider'], ['DELETE', '/api/provider'], ['PUT', '/api/provider', { id: 'openai', apiKey: 'x' }], ['POST', '/api/provider/models', { id: 'openai' }]]) {
      const response = await handleProviderApi(new Request(ORIGIN + path, {
        method,
        headers: { origin, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }), {}, ctx.keys);
      assert.equal(response.status, 403, `${origin} ${method} ${path}`);
    }
  }
  assert.equal(ctx.keys.keyFor('openai'), 'secret');
  // No endpoint ever returns the key itself.
  const described = await (await handleProviderApi(new Request(ORIGIN + '/api/provider', { headers: { origin: ORIGIN } }), {}, ctx.keys)).text();
  assert.doesNotMatch(described, /secret/);
});
