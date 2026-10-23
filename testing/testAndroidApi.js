// src/lib/android.js: the Android app answers /api/* inside the page. Runs in
// node with a stand-in window; outside Android, capacitor-secure-storage-plugin
// falls back to localStorage, which is replaced here by an in-memory one.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const stored = new Map();
globalThis.localStorage = {
  getItem: (key) => (stored.has(key) ? stored.get(key) : null),
  setItem: (key, value) => stored.set(key, String(value)),
  removeItem: (key) => stored.delete(key),
};
globalThis.window = globalThis;
globalThis.location = new URL('https://localhost/');

// What the page's own fetch would do: every request that android.js doesn't
// answer itself ends up here.
let upstream = async () => new Response('not stubbed', { status: 599 });
const seen = [];
globalThis.fetch = async (input, init) => {
  seen.push(String(input instanceof Request ? input.url : input));
  return upstream(input, init);
};
const pageFetch = globalThis.fetch;

const { installAndroidApi } = await import('../src/lib/android.js');

const install = async () => {
  globalThis.fetch = pageFetch;
  await installAndroidApi();
};

const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

test('requests other than AppBlips\' own /api/* go to the real fetch', async () => {
  await install();
  seen.length = 0;
  upstream = async () => new Response('ok');
  assert.equal(await (await fetch('https://esm.sh/react')).text(), 'ok');
  // Same path on another origin (e.g. a generated app's own server) is not ours.
  assert.equal(await (await fetch('https://other.example/api/chat', { method: 'POST' })).text(), 'ok');
  assert.deepEqual(seen, ['https://esm.sh/react', 'https://other.example/api/chat']);
});

test('the provider key is kept in secure storage and attached to /api/chat', async () => {
  stored.clear();
  await install();
  assert.deepEqual(await (await fetch('/api/provider')).json(), { id: '', hasKey: false });

  const saved = await fetch('/api/provider', json('PUT', { id: 'openai', model: 'gpt-test', apiKey: 'sk-secret', enabled: true }));
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).hasKey, true);
  // The plugin's web fallback stores base64; on Android it is the Keystore.
  assert.deepEqual(JSON.parse(atob(stored.get('cap_sec_provider-key'))), { id: 'openai', key: 'sk-secret' });

  // A fresh start reads it back.
  await install();
  assert.deepEqual(await (await fetch('/api/provider')).json(), { id: 'openai', hasKey: true });

  let sent;
  upstream = async (url, init) => {
    sent = { url, auth: init.headers.Authorization, body: JSON.parse(init.body) };
    return new Response('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  const response = await fetch('/api/chat', json('POST', {
    messages: [{ role: 'user', content: 'Make a timer' }],
    stream: true,
    user_provider: { id: 'openai', model: 'gpt-test', baseUrl: '' },
  }));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /"Hi"/);
  assert.equal(sent.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(sent.auth, 'Bearer sk-secret');
  assert.equal(sent.body.model, 'gpt-test');

  await fetch('/api/provider', { method: 'DELETE' });
  assert.equal(stored.has('cap_sec_provider-key'), false);
});

test('aborting a streaming /api/chat rejects the pending read and stops the provider', async () => {
  stored.clear();
  await install();
  await fetch('/api/provider', json('PUT', { id: 'openai', model: 'gpt-test', apiKey: 'sk-secret', enabled: true }));
  let cancelled = false;
  upstream = async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('data: {}\n\n')); },
    cancel() { cancelled = true; },
  }), { headers: { 'content-type': 'text/event-stream' } });

  const controller = new AbortController();
  const response = await fetch('/api/chat', {
    ...json('POST', { messages: [{ role: 'user', content: 'x' }], stream: true, user_provider: { id: 'openai', model: 'gpt-test' } }),
    signal: controller.signal,
  });
  const reader = response.body.getReader();
  assert.equal((await reader.read()).done, false);
  const pending = reader.read();
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cancelled, true);

  await assert.rejects(fetch('/api/provider', { signal: AbortSignal.abort() }), { name: 'AbortError' });
});
