import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listProviderModels } from '../electron/server/providerModels.js';
import { USER_PROVIDER_OPTIONS } from '../electron/server/providers.js';
import { createProviderStore } from '../electron/providerStore.js';
import { webProviderStore } from '../src/lib/desktop.js';

const catalog = () => new Response(JSON.stringify({ data: [
  { id: 'z', name: 'Zulu' }, { id: 'a', name: 'Alpha' }, { id: 'z', name: 'Zulu' }, { id: 'bare' }, { name: 'invalid' },
] }));

for (const { id, baseUrl, local } of USER_PROVIDER_OPTIONS) {
  test(`${id} discovers models without a selected model`, async () => {
    const models = await listProviderModels({ id, apiKey: local ? '' : 'test-key', baseUrl: local ? 'http://127.0.0.1:9999/v1/' : 'https://evil.invalid' }, {
      fetchImpl: async (url, options) => {
        assert.equal(url, `${local ? 'http://127.0.0.1:9999/v1' : baseUrl}/models`);
        assert.equal(options.headers.Authorization, local ? undefined : 'Bearer test-key');
        assert.equal(options.redirect, 'error');
        return catalog();
      },
    });
    assert.deepEqual(models, [{ id: 'a', label: 'Alpha' }, { id: 'bare', label: 'bare' }, { id: 'z', label: 'Zulu' }]);
  });
}

test('OpenRouter can fetch its public catalog before key entry', async () => {
  await listProviderModels({ id: 'openrouter' }, { fetchImpl: async (_url, options) => {
    assert.equal(options.headers.Authorization, undefined);
    return catalog();
  } });
});

test('OpenRouter image and audio generators are left out of the model list', async () => {
  const arch = (output_modalities) => ({ architecture: { output_modalities } });
  const models = await listProviderModels({ id: 'openrouter' }, { fetchImpl: async () => Response.json({ data: [
    { id: 'chat', name: 'Chat', ...arch(['text']) },
    { id: 'painter', name: 'Painter', ...arch(['image', 'text']) },
    { id: 'singer', name: 'Singer', ...arch(['text', 'audio']) },
    { id: 'plain', name: 'Plain' },
  ] }) });
  assert.deepEqual(models.map((m) => m.id), ['chat', 'plain']);
});

test('discovery validates credentials and local URLs before fetching', async () => {
  const fetchImpl = () => { assert.fail('Invalid settings must not reach fetch'); };
  for (const input of [
    { id: 'unknown' }, { id: 'openai' }, { id: 'gemini', apiKey: 'bad key' },
    { id: 'ollama', baseUrl: 'https://evil.invalid/v1' }, { id: 'lmstudio', baseUrl: 'http://localhost:1234/v1?key=secret' },
  ]) await assert.rejects(listProviderModels(input, { fetchImpl }));
});

test('discovery reports auth, network, HTTP and malformed-response errors without provider bodies', async () => {
  for (const [fetchImpl, message] of [
    [async () => new Response('private upstream detail', { status: 401 }), /rejected the API key/],
    [async () => new Response('private upstream detail', { status: 429 }), /HTTP 429/],
    [async () => { throw new Error('private upstream detail'); }, /Could not reach/],
    [async () => new Response('not json'), /invalid model list/],
    [async () => new Response('{}'), /invalid model list/],
  ]) await assert.rejects(listProviderModels({ id: 'deepseek', apiKey: 'secret' }, { fetchImpl }), message);
  assert.deepEqual(await listProviderModels({ id: 'ollama' }, { fetchImpl: async () => new Response('{"data":[]}') }), []);
});

test('desktop discovery reuses only the matching saved key and accepts draft replacement keys', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'appblips-models-'));
  try {
    const store = createProviderStore({ file: join(dir, 'provider.json'), crypto: {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => value.toString(),
    } });
    await store.set({ enabled: true, id: 'openai', model: 'gpt-4.1', apiKey: 'saved-key' });
    let expected = 'saved-key';
    t.mock.method(globalThis, 'fetch', async (_url, options) => {
      assert.equal(options.headers.Authorization, `Bearer ${expected}`);
      return catalog();
    });
    assert.ok((await store.listModels({ id: 'openai', apiKey: '' })).length);
    expected = 'replacement';
    await store.listModels({ id: 'openai', apiKey: 'replacement' });
    await assert.rejects(store.listModels({ id: 'gemini' }), /key is empty/);
    assert.equal(store.describe().apiKey, undefined);
    assert.equal(store.keyFor('openai'), 'saved-key');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('browser discovery reuses the matching saved key without changing saved settings', async (t) => {
  const values = new Map();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  } });
  await webProviderStore.set({ enabled: true, id: 'gemini', model: 'saved-model', apiKey: 'saved-key' });
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer saved-key');
    return catalog();
  });
  assert.ok((await webProviderStore.listModels({ id: 'gemini' })).length);
  await assert.rejects(webProviderStore.listModels({ id: 'openai' }), /key is empty/);
  assert.equal((await webProviderStore.get()).model, 'saved-model');
});
