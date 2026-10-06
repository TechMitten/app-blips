import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleChatProxy } from '../functions/_lib/chatProxy.js';
import { installFirebaseFake, signIdToken, PROJECT_ID } from './firebaseFake.js';

const env = {
  OPENAI_BASE_URL: 'https://llm.example/v1',
  OPENAI_API_KEY: 'test-key',
  OPENAI_LLM_MODEL: 'test-model',
  APPBLIPS_CHAT_RATE_LIMIT_MAX: '1000',
};
const editTool = {
  type: 'function',
  function: {
    name: 'apply_surgical_edits',
    parameters: { type: 'object', properties: {} },
  },
};
const namedChoice = { type: 'function', function: { name: 'apply_surgical_edits' } };

async function captureRequest(t, payload, settings = {}) {
  const mergedEnv = { ...env, ...settings };
  const expectedUrl = `${mergedEnv.OPENAI_BASE_URL.replace(/\/+$/, '')}/chat/completions`;
  let upstreamBody;
  const responseBody = 'data: {"choices":[{"delta":{"content":"Done"}}]}\n\ndata: [DONE]\n\n';
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, expectedUrl);
    upstreamBody = JSON.parse(options.body);
    return new Response(responseBody, { headers: { 'content-type': 'text/event-stream' } });
  });
  const response = await handleChatProxy(new Request('https://app.example/api/chat', {
    method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Change the background' }], ...payload }),
  }), mergedEnv);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.equal(await response.text(), responseBody);
  return upstreamBody;
}

// DeepSeek is the only provider: reasoning always goes in its `reasoning`
// object, and forced tool choices are passed through unchanged.
for (const effort of ['low', 'medium', 'high']) {
  for (const choice of ['required', namedChoice]) {
    test(`reasoning ${effort} keeps ${JSON.stringify(choice)} and drops temperature`, async (t) => {
      const body = await captureRequest(t, { tools: [editTool], tool_choice: choice, stream: true, reasoning_effort: effort, temperature: 0 });
      assert.deepEqual(body.tool_choice, choice);
      assert.deepEqual(body.thinking, { type: 'enabled' });
      assert.equal(body.reasoning_effort, effort);
      assert.equal(Object.hasOwn(body, 'temperature'), false);
      assert.deepEqual(body.tools, [editTool]);
      assert.equal(body.stream, true);
    });
  }
}

for (const effort of [undefined, false, 'none', 'off', 'disabled']) {
  test(`disabled reasoning ${effort} sends effort none and keeps forced tools`, async (t) => {
    const body = await captureRequest(t, { tools: [editTool], tool_choice: namedChoice, reasoning_effort: effort });
    assert.deepEqual(body.tool_choice, namedChoice);
    assert.deepEqual(body.thinking, { type: 'disabled' });
    assert.equal(body.reasoning_effort, undefined);
  });
}

for (const choice of ['auto', 'none', undefined]) {
  test(`reasoning preserves unforced tool choice ${choice}`, async (t) => {
    const body = await captureRequest(t, { tools: [editTool], tool_choice: choice, reasoning_effort: 'high' });
    assert.equal(body.tool_choice, choice);
  });
}

test('initial generation keeps reasoning without adding tool choice', async (t) => {
  const body = await captureRequest(t, { stream: true, reasoning_effort: 'high' });
  assert.deepEqual(body.thinking, { type: 'enabled' });
  assert.equal(body.reasoning_effort, 'high');
  assert.equal(Object.hasOwn(body, 'tool_choice'), false);
  assert.equal(Object.hasOwn(body, 'tools'), false);
});

// --- Provider selection (functions/_lib/providers.js) ----------------------

test('streaming requests ask for usage', async (t) => {
  const body = await captureRequest(t, { stream: true, reasoning_effort: 'low' });
  assert.deepEqual(body.stream_options, { include_usage: true });
});

test('DeepSeek is the default endpoint when no base URL is set', async (t) => {
  let calledUrl;
  t.mock.method(globalThis, 'fetch', async (url) => {
    calledUrl = url;
    return new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  });
  const response = await handleChatProxy(new Request('https://app.example/api/chat', {
    method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], stream: true }),
  }), { ...env, OPENAI_BASE_URL: '', OPENAI_LLM_PROVIDER: 'deepseek' });
  assert.equal(response.status, 200);
  assert.equal(calledUrl, 'https://api.deepseek.com/chat/completions');
});

for (const removed of ['nope', 'zai', 'openai']) {
  test(`provider "${removed}" is a configuration error`, async () => {
    const response = await handleChatProxy(new Request('https://app.example/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    }), { ...env, OPENAI_LLM_PROVIDER: removed });
    assert.equal(response.status, 500);
    assert.match((await response.json()).error, new RegExp(`Unknown OPENAI_LLM_PROVIDER "${removed}"`));
  });
}

// --- Key-driven provider selection ----------------------------------------

const noLlmEnv = { APPBLIPS_CHAT_RATE_LIMIT_MAX: '1000' };

async function runWith(t, settings, payload = {}) {
  let upstream;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    upstream = { url, headers: options.headers, body: JSON.parse(options.body) };
    return new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  });
  const response = await handleChatProxy(new Request('https://app.example/api/chat', {
    method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], ...payload }),
  }), { ...noLlmEnv, ...settings });
  return { response, upstream };
}

test('a provider becomes active once its API key is filled in', async (t) => {
  const { response, upstream } = await runWith(t, {
    OPENAI_API_KEY: 'or-key',
    OPENAI_LLM_MODEL: 'anthropic/claude-sonnet-5',
  }, { reasoning_effort: 'low' });
  assert.equal(response.status, 200);
  assert.equal(upstream.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(upstream.headers.Authorization, 'Bearer or-key');
  assert.equal(upstream.body.model, 'anthropic/claude-sonnet-5');
  assert.deepEqual(upstream.body.thinking, { type: 'enabled' });
  assert.equal(upstream.body.reasoning_effort, 'low');
});

// The production setup: the key lives in OPENAI_API_KEY.
test('OPENAI_API_KEY configures DeepSeek', async (t) => {
  const { response, upstream } = await runWith(t, {
    OPENAI_LLM_PROVIDER: 'deepseek',
    OPENAI_API_KEY: 'or-env-key',
    OPENAI_LLM_MODEL: 'deepseek-v4-flash',
  });
  assert.equal(response.status, 200);
  assert.equal(upstream.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(upstream.headers.Authorization, 'Bearer or-env-key');
  assert.equal(upstream.body.model, 'deepseek-v4-flash');
  assert.deepEqual(upstream.body.thinking, { type: 'disabled' });
  assert.equal(upstream.body.reasoning_effort, undefined);
});

test('the plain OPENAI_* variables work as the generic provider', async (t) => {
  const { upstream } = await runWith(t, {
    OPENAI_BASE_URL: 'https://llm.example/v1',
    OPENAI_API_KEY: 'k',
    OPENAI_LLM_MODEL: 'm',
  });
  assert.equal(upstream.url, 'https://llm.example/v1/chat/completions');
  assert.equal(upstream.body.model, 'm');
});

test('max tokens and temperature come from OPENAI_LLM_*', async (t) => {
  const base = { OPENAI_BASE_URL: 'https://llm.example/v1', OPENAI_API_KEY: 'k', OPENAI_LLM_MODEL: 'm' };
  const fresh = await runWith(t, { ...base, OPENAI_LLM_MAX_TOKENS: '64000', OPENAI_LLM_TEMPERATURE: '0.5' });
  assert.equal(fresh.upstream.body.max_tokens, 64000);
  assert.equal(fresh.upstream.body.temperature, 0.5);
  const ask = await runWith(t, { ...base, OPENAI_LLM_ASK_MAX_TOKENS: '2000' }, { ask: true });
  assert.equal(ask.upstream.body.max_tokens, 2000);
});

test('the plain variables are a fallback for a named provider', async (t) => {
  const { upstream } = await runWith(t, {
    OPENAI_LLM_PROVIDER: 'deepseek',
    OPENAI_API_KEY: 'k',
    OPENAI_LLM_MODEL: 'm',
  });
  assert.equal(upstream.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(upstream.headers.Authorization, 'Bearer k');
});

test('no filled-in provider is a clear configuration error', async (t) => {
  const { response } = await runWith(t, { OPENAI_API_KEY: '', OPENAI_LLM_MODEL: 'gpt-x' });
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /No AI provider is configured/);
});

test('a provider with a key but no model names the missing variable', async (t) => {
  const { response } = await runWith(t, { OPENAI_API_KEY: 'k' });
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /OPENAI_LLM_MODEL/);
});

// --- User-supplied provider (Settings → AI) --------------------------------

const userProvider = { id: 'deepseek', apiKey: 'user-key', model: 'user/model' };

test('a user provider works with no provider in the env', async (t) => {
  const { response, upstream } = await runWith(t, {}, { user_provider: userProvider, reasoning_effort: 'low' });
  assert.equal(response.status, 200);
  assert.equal(upstream.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(upstream.headers.Authorization, 'Bearer user-key');
  assert.equal(upstream.body.model, 'user/model');
  assert.deepEqual(upstream.body.thinking, { type: 'enabled' });
  assert.equal(upstream.body.reasoning_effort, 'low');
  assert.equal(Object.hasOwn(upstream.body, 'user_provider'), false);
});

test('a user provider wins over the env provider; without one the env is used', async (t) => {
  const envProvider = { OPENAI_API_KEY: 'env-key', OPENAI_LLM_MODEL: 'env-model', OPENAI_BASE_URL: 'https://llm.example/v1' };
  const withUser = await runWith(t, envProvider, { user_provider: userProvider });
  assert.equal(withUser.upstream.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(withUser.upstream.headers.Authorization, 'Bearer user-key');
  t.mock.restoreAll();
  const withoutUser = await runWith(t, envProvider);
  assert.equal(withoutUser.upstream.url, 'https://llm.example/v1/chat/completions');
  assert.equal(withoutUser.upstream.headers.Authorization, 'Bearer env-key');
});

test('incomplete user provider settings are a 400, not a config error', async (t) => {
  const { response, upstream } = await runWith(t, {}, { user_provider: { ...userProvider, apiKey: '' } });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /API key is empty/);
  assert.equal(upstream, undefined);
});

test('a provider rejecting the user key is not reported as a 401', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{"error":"bad key"}', { status: 401 }));
  const response = await handleChatProxy(new Request('https://app.example/api/chat', {
    method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], user_provider: userProvider }),
  }), noLlmEnv);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /DeepSeek rejected the API key/);
});

test('multi-user mode still requires sign-in and validates user_provider', async (t) => {
  const hostedEnv = { FIREBASE_PROJECT_ID: PROJECT_ID, APPBLIPS_CHAT_RATE_LIMIT_MAX: '1000' };
  const send = (payload, headers = {}) => handleChatProxy(new Request('https://app.example/api/chat', {
    method: 'POST',
    headers,
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], ...payload }),
  }), hostedEnv);
  assert.equal((await send({ user_provider: userProvider })).status, 401);

  installFirebaseFake(t, {
    fallback: async () => new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }),
  });
  // A token that isn't a valid Firebase ID token is the same as none.
  assert.equal((await send({ user_provider: userProvider }, { authorization: 'Bearer not-a-token' })).status, 401);
  assert.equal((await send({ user_provider: userProvider }, { authorization: `Bearer ${await signIdToken('user-1', { key: 'other' })}` })).status, 401);
  const auth = { authorization: `Bearer ${await signIdToken('user-1')}` };
  assert.equal((await send({ user_provider: 'deepseek' }, auth)).status, 400);
  assert.equal((await send({ user_provider: { ...userProvider, apiKey: 5 } }, auth)).status, 400);
  assert.equal((await send({ user_provider: userProvider }, auth)).status, 200);
});

// Self-hosted mode has no sign-in, so browser requests from other sites
// (including text/plain "simple" POSTs that skip CORS preflight, and
// sandboxed apps with Origin "null") must not reach the provider.
test('self-hosted refuses browser requests from other origins before calling the provider', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('provider must not be called');
  });
  const send = (origin, settings = {}, url = 'http://localhost:5175/api/chat') => handleChatProxy(new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'text/plain', ...(origin ? { origin } : {}) },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
  }), { ...env, ...settings });

  for (const origin of ['https://evil.example', 'null', 'http://localhost:5176', 'https://localhost:5175']) {
    const response = await send(origin);
    assert.equal(response.status, 403, origin);
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('self-hosted accepts its own origin, listed origins, the desktop scheme and no-origin clients', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }));
  const send = (origin, settings = {}, url = 'http://localhost:5175/api/chat') => handleChatProxy(new Request(url, {
    method: 'POST',
    headers: origin ? { origin } : {},
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
  }), { ...env, ...settings });

  assert.equal((await send('http://localhost:5175')).status, 200);
  assert.equal((await send(null)).status, 200);
  assert.equal((await send('https://proxy.example', { APPBLIPS_CHAT_ALLOWED_ORIGINS: 'https://other.example, https://proxy.example' })).status, 200);
  assert.equal((await send('appblips://app', {}, 'appblips://app/api/chat')).status, 200);
});

test('multi-user mode leaves other-origin requests to the sign-in check', async () => {
  const response = await handleChatProxy(new Request('https://appblips.com/api/chat', {
    method: 'POST',
    headers: { origin: 'https://evil.example' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
  }), { FIREBASE_PROJECT_ID: PROJECT_ID });
  assert.equal(response.status, 401);
});

// A provider's own 429 (e.g. Z.ai balance or concurrency limits) is passed
// to self-hosted users with its reason, marked as coming from the provider.
test('provider 429 reaches self-hosted users with the provider reason', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(
    JSON.stringify({ error: { code: '1113', message: 'Insufficient balance or no resource package.' } }),
    { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '30' } },
  ));
  const response = await handleChatProxy(new Request('http://localhost:5175/api/chat', {
    method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
  }), env);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '30');
  const body = await response.json();
  assert.equal(body.source, 'provider');
  assert.match(body.error, /turned the request down: Insufficient balance or no resource package\./);
});

// Self-hosted users spend their own key, so neither the builder proxy nor the
// app AI relay throttles them; hosted keeps its per-user limit.
test('self-hosted builder requests are not rate limited', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }));
  const send = (settings) => handleChatProxy(new Request('http://localhost:5175/api/chat', {
    method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
  }), { ...env, APPBLIPS_CHAT_RATE_LIMIT_MAX: '2', ...settings });
  for (let i = 0; i < 5; i++) assert.equal((await send({})).status, 200, `self-hosted request ${i + 1}`);
});

test('maintenance mode refuses every request before calling the provider', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('provider must not be called');
  });
  for (const payload of [{}, { ask: true }, { user_provider: { id: 'deepseek', apiKey: 'k', model: 'm' } }]) {
    const response = await handleChatProxy(new Request('https://app.example/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], ...payload }),
    }), { ...env, APPBLIPS_MAINTENANCE: 'true' });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'maintenance');
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});
