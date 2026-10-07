import assert from 'node:assert/strict';
import { test } from 'node:test';
import { webProviderStore } from '../src/lib/desktop.js';
import { handleChatProxy } from '../electron/server/chatProxy.js';

test('testing after Save reuses the browser key while respecting draft edits', async () => {
  const originalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  try {
    const info = await webProviderStore.set({ enabled: true, id: 'openrouter', model: 'saved-model', apiKey: 'saved-test-key' });
    assert.equal(info.hasKey, true);
    assert.equal(info.apiKey, undefined);
    const draft = { id: 'openrouter', model: 'draft-model', apiKey: '' };
    const outgoing = webProviderStore.forRequest(draft);
    assert.equal(draft.apiKey, '');
    assert.equal(outgoing.apiKey, 'saved-test-key');
    assert.equal(outgoing.model, 'draft-model');
    assert.equal(webProviderStore.forRequest({ ...draft, apiKey: 'replacement-key' }).apiKey, 'replacement-key');
    assert.equal(webProviderStore.forRequest({ id: 'ollama', model: 'local-model', apiKey: '' }).apiKey, '');
    assert.equal(webProviderStore.forRequest().apiKey, 'saved-test-key');

    let calls = 0;
    globalThis.fetch = async (_url, options) => {
      calls++;
      assert.equal(options.headers.Authorization, 'Bearer saved-test-key');
      assert.equal(JSON.parse(options.body).model, 'draft-model');
      return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
    };
    const response = await handleChatProxy(new Request('http://localhost:5175/api/chat', {
      method: 'POST',
      body: JSON.stringify({ user_provider: outgoing, messages: [{ role: 'user', content: 'Reply OK' }], ask: true }),
    }), {});
    assert.equal(response.status, 200);
    assert.equal(calls, 1);

    await webProviderStore.clear();
    assert.equal(webProviderStore.forRequest(draft).apiKey, '');
    assert.equal(webProviderStore.forRequest(), null);
  } finally {
    globalThis.localStorage = originalStorage;
    globalThis.fetch = originalFetch;
  }
});
