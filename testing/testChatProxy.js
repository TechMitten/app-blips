import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleChatProxy } from '../electron/server/chatProxy.js';

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

// --- Provider selection (electron/server/providers.js) ---------------------

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

for (const removed of ['nope', 'zai']) {
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

test('output limits come from Settings requests and ignore environment caps', async (t) => {
  const base = { OPENAI_BASE_URL: 'https://llm.example/v1', OPENAI_API_KEY: 'k', OPENAI_LLM_MODEL: 'm' };
  const settings = { ...base, OPENAI_LLM_MAX_TOKENS: '1', OPENAI_LLM_ASK_MAX_TOKENS: '2000', OPENAI_LLM_TEMPERATURE: '0.5' };
  for (const ask of [false, true]) {
    // Builds default to 64K; Ask keeps the provider's own default.
    const expected = ask ? undefined : 64000;
    const defaultLimit = await runWith(t, settings, { ask });
    assert.equal(defaultLimit.upstream.body.max_tokens, expected);
    assert.equal(defaultLimit.upstream.body.temperature, 0.5);
    const custom = await runWith(t, settings, { ask, max_tokens: 12000 });
    assert.equal(custom.upstream.body.max_tokens, 12000);
    const reset = await runWith(t, settings, { ask, max_tokens: null });
    assert.equal(reset.upstream.body.max_tokens, expected);
  }
});

test('hosted providers get the 64K build default; local servers and Ask do not', async (t) => {
  for (const id of ['openai', 'openrouter', 'gemini', 'deepseek', 'lmstudio', 'ollama']) {
    const field = id === 'openai' ? 'max_completion_tokens' : 'max_tokens';
    const local = id === 'lmstudio' || id === 'ollama';
    for (const ask of [false, true]) {
      const payload = { ask, user_provider: { id, apiKey: 'test-key', model: 'test-model' } };
      const defaultLimit = await runWith(t, { OPENAI_LLM_MAX_TOKENS: '1', OPENAI_LLM_ASK_MAX_TOKENS: '1' }, payload);
      assert.equal(defaultLimit.response.status, 200);
      assert.equal(defaultLimit.upstream.body[field], ask || local ? undefined : 64000);
      const custom = await runWith(t, {}, { ...payload, max_tokens: 12345 });
      assert.equal(custom.upstream.body[field], 12345);
    }
  }
});

test('a provider that rejects the default limit gets the request again without one', async (t) => {
  const bodies = [];
  const reject = (status, error) => Response.json({ error: { message: error } }, { status });
  const run = async (payload, firstReply) => {
    bodies.length = 0;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      bodies.push(JSON.parse(options.body));
      return bodies.length === 1 ? firstReply() : new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    });
    return handleChatProxy(new Request('https://app.example/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], user_provider: { id: 'openai', apiKey: 'k', model: 'gpt-4o' }, ...payload }),
    }), noLlmEnv);
  };
  const retried = await run({}, () => reject(400, 'max_tokens is too large: 64000. This model supports at most 16384 completion tokens.'));
  assert.equal(retried.status, 200);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].max_completion_tokens, 64000);
  assert.equal(bodies[1].max_completion_tokens, undefined);
  assert.equal(bodies[1].max_tokens, undefined);
  // A limit the user chose is never silently dropped, and other 400s pass through.
  const custom = await run({ max_tokens: 99999 }, () => reject(400, 'max_tokens is too large'));
  assert.equal(custom.status, 400);
  assert.equal(bodies.length, 1);
  const unrelated = await run({}, () => reject(400, 'Invalid model'));
  assert.equal(unrelated.status, 400);
  assert.equal(bodies.length, 1);
});

test('invalid output limits are rejected before contacting a provider', async (t) => {
  for (const max_tokens of [0, -1, 1.5, '2000', true, {}, Number.MAX_SAFE_INTEGER + 1]) {
    const { response, upstream } = await runWith(t, {}, { max_tokens });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /positive whole number/);
    assert.equal(upstream, undefined);
  }
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

const userProvider = { id: 'openrouter', apiKey: 'user-key', model: '~anthropic/claude-sonnet-latest' };

test('a user provider works with no provider in the env', async (t) => {
  const { response, upstream } = await runWith(t, {}, { user_provider: userProvider, reasoning_effort: 'low' });
  assert.equal(response.status, 200);
  assert.equal(upstream.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(upstream.headers.Authorization, 'Bearer user-key');
  assert.equal(upstream.body.model, '~anthropic/claude-sonnet-latest');
  assert.equal(Object.hasOwn(upstream.body, 'thinking'), false);
  assert.equal(upstream.body.reasoning_effort, 'low');
  assert.equal(Object.hasOwn(upstream.body, 'user_provider'), false);
});

test('a user provider wins over the env provider; without one the env is used', async (t) => {
  const envProvider = { OPENAI_API_KEY: 'env-key', OPENAI_LLM_MODEL: 'env-model', OPENAI_BASE_URL: 'https://llm.example/v1' };
  const withUser = await runWith(t, envProvider, { user_provider: userProvider });
  assert.equal(withUser.upstream.url, 'https://openrouter.ai/api/v1/chat/completions');
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
  assert.match((await response.json()).error, /OpenRouter rejected the API key/);
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

// A provider's own 429 (e.g. a low balance or concurrency limit) is passed
// to the user with its reason, marked as coming from the provider.
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

// Self-hosted users spend their own key, so the builder proxy does not
// throttle them; only the provider's own limits apply.
test('builder requests are not rate limited', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }));
  const send = (settings) => handleChatProxy(new Request('http://localhost:5175/api/chat', {
    method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
  }), { ...env, APPBLIPS_CHAT_RATE_LIMIT_MAX: '2', ...settings });
  for (let i = 0; i < 5; i++) assert.equal((await send({})).status, 200, `request ${i + 1}`);
});
