import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleChatProxy } from '../functions/_lib/chatProxy.js';

const env = {
  SELF_HOSTED_MODE: 'true',
  APPBLIPS_LLM_BASE_URL: 'https://llm.example/v1',
  APPBLIPS_LLM_API_KEY: 'test-key',
  APPBLIPS_LLM_MODEL: 'test-model',
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
  const expectedUrl = `${mergedEnv.APPBLIPS_LLM_BASE_URL.replace(/\/+$/, '')}/chat/completions`;
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

for (const effort of ['low', 'medium', 'high']) {
  for (const choice of ['required', namedChoice]) {
    test(`reasoning ${effort} uses auto for ${JSON.stringify(choice)}`, async (t) => {
      const body = await captureRequest(t, { tools: [editTool], tool_choice: choice, stream: true, reasoning_effort: effort });
      assert.equal(body.tool_choice, 'auto');
      assert.equal(body.reasoning_effort, effort);
      assert.deepEqual(body.tools, [editTool]);
      assert.equal(body.stream, true);
    });
  }
}

for (const effort of [undefined, false, 'none', 'off', 'disabled']) {
  test(`disabled reasoning ${effort} preserves forced tool choices`, async (t) => {
    const body = await captureRequest(t, { tools: [editTool], tool_choice: namedChoice, reasoning_effort: effort });
    assert.deepEqual(body.tool_choice, namedChoice);
    assert.equal(body.reasoning_effort, 'none');
  });
}

for (const choice of ['auto', 'none', undefined]) {
  test(`reasoning preserves unforced tool choice ${choice}`, async (t) => {
    const body = await captureRequest(t, { tools: [editTool], tool_choice: choice, reasoning_effort: 'high' });
    assert.equal(body.tool_choice, choice);
  });
}

test('client can disable reasoning and retain required tool use', async (t) => {
  const body = await captureRequest(t, { tools: [editTool], tool_choice: 'required', reasoning_effort: 'none' });
  assert.equal(body.tool_choice, 'required');
  assert.equal(body.reasoning_effort, 'none');
});

test('client can enable reasoning', async (t) => {
  const body = await captureRequest(t, { tools: [editTool], tool_choice: 'required', reasoning_effort: 'high' });
  assert.equal(body.tool_choice, 'auto');
  assert.equal(body.reasoning_effort, 'high');
});

test('initial generation keeps reasoning without adding tool choice', async (t) => {
  const body = await captureRequest(t, { stream: true, reasoning_effort: 'high' });
  assert.equal(body.reasoning_effort, 'high');
  assert.equal(Object.hasOwn(body, 'tool_choice'), false);
  assert.equal(Object.hasOwn(body, 'tools'), false);
});

// --- Provider presets (functions/_lib/providers.js) ----------------------

test('unset provider keeps stream_options when streaming', async (t) => {
  const body = await captureRequest(t, { stream: true, reasoning_effort: 'low' });
  assert.deepEqual(body.stream_options, { include_usage: true });
});

test('provider is chosen by name, never inferred from model or host', async (t) => {
  const body = await captureRequest(t, { reasoning_effort: 'none' }, {
    APPBLIPS_LLM_MODEL: 'glm-5.3',
    APPBLIPS_LLM_BASE_URL: 'https://api.z.ai/api/paas/v4',
  });
  assert.equal(body.reasoning_effort, 'none');
  assert.equal(Object.hasOwn(body, 'thinking'), false);
});

test('named provider supplies its default base URL', async (t) => {
  let calledUrl;
  t.mock.method(globalThis, 'fetch', async (url) => {
    calledUrl = url;
    return new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  });
  const response = await handleChatProxy(new Request('https://app.example/api/chat', {
    method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], stream: true }),
  }), { ...env, APPBLIPS_LLM_BASE_URL: '', APPBLIPS_LLM_PROVIDER: 'openrouter' });
  assert.equal(response.status, 200);
  assert.equal(calledUrl, 'https://openrouter.ai/api/v1/chat/completions');
});

test('generic provider without a base URL reports it missing', async () => {
  const response = await handleChatProxy(new Request('https://app.example/api/chat', {
    method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
  }), { ...env, APPBLIPS_LLM_BASE_URL: '' });
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /APPBLIPS_LLM_BASE_URL/);
});

test('unknown provider name is a configuration error', async () => {
  const response = await handleChatProxy(new Request('https://app.example/api/chat', {
    method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
  }), { ...env, APPBLIPS_LLM_PROVIDER: 'nope' });
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /Unknown APPBLIPS_LLM_PROVIDER "nope"/);
});

for (const provider of ['openai', 'deepseek']) {
  test(`${provider} sends reasoning_effort and keeps forced tools when off`, async (t) => {
    const off = await captureRequest(t, { tools: [editTool], tool_choice: 'required', reasoning_effort: 'none' }, { APPBLIPS_LLM_PROVIDER: provider });
    assert.equal(off.reasoning_effort, 'none');
    assert.equal(off.tool_choice, 'required');
    t.mock.restoreAll();
    const on = await captureRequest(t, { tools: [editTool], tool_choice: 'required', reasoning_effort: 'low' }, { APPBLIPS_LLM_PROVIDER: provider });
    assert.equal(on.reasoning_effort, 'low');
    assert.equal(on.tool_choice, 'auto');
  });
}

test('openrouter sends the reasoning object', async (t) => {
  const off = await captureRequest(t, { stream: true, reasoning_effort: 'none' }, { APPBLIPS_LLM_PROVIDER: 'openrouter' });
  assert.deepEqual(off.reasoning, { effort: 'none' });
  assert.equal(Object.hasOwn(off, 'reasoning_effort'), false);
  assert.deepEqual(off.stream_options, { include_usage: true });
  t.mock.restoreAll();
  const on = await captureRequest(t, { tools: [editTool], tool_choice: namedChoice, reasoning_effort: 'low' }, { APPBLIPS_LLM_PROVIDER: 'openrouter' });
  assert.deepEqual(on.reasoning, { effort: 'low' });
  assert.equal(on.tool_choice, 'auto');
});

test('zai off -> thinking disabled, no reasoning_effort, no stream_options', async (t) => {
  const body = await captureRequest(t, { stream: true, reasoning_effort: 'none' }, { APPBLIPS_LLM_PROVIDER: 'zai' });
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.equal(Object.hasOwn(body, 'reasoning_effort'), false);
  assert.equal(Object.hasOwn(body, 'stream_options'), false);
});

test('zai on -> thinking enabled with the effort', async (t) => {
  const body = await captureRequest(t, { reasoning_effort: 'low' }, { APPBLIPS_LLM_PROVIDER: 'zai' });
  assert.deepEqual(body.thinking, { type: 'enabled' });
  assert.equal(body.reasoning_effort, 'low');
});

test('zai always relaxes forced tool choice, even with reasoning off', async (t) => {
  const body = await captureRequest(t, { tools: [editTool], tool_choice: namedChoice, reasoning_effort: 'none' }, { APPBLIPS_LLM_PROVIDER: 'zai' });
  assert.equal(body.tool_choice, 'auto');
});

test('REASONING_PARAM=omit sends no reasoning field and keeps forced tools', async (t) => {
  const body = await captureRequest(t, { tools: [editTool], tool_choice: 'required', reasoning_effort: 'low' }, { APPBLIPS_LLM_REASONING_PARAM: 'omit' });
  for (const key of ['reasoning_effort', 'reasoning', 'thinking']) assert.equal(Object.hasOwn(body, key), false);
  assert.equal(body.tool_choice, 'required');
});

test('REASONING_PARAM overrides a preset', async (t) => {
  const body = await captureRequest(t, { reasoning_effort: 'low' }, { APPBLIPS_LLM_PROVIDER: 'openrouter', APPBLIPS_LLM_REASONING_PARAM: 'reasoning_effort' });
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(Object.hasOwn(body, 'reasoning'), false);
});

// --- Key-driven provider selection ----------------------------------------

const noLlmEnv = { SELF_HOSTED_MODE: 'true', APPBLIPS_CHAT_RATE_LIMIT_MAX: '1000' };

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
    APPBLIPS_OPENROUTER_API_KEY: 'or-key',
    APPBLIPS_OPENROUTER_MODEL: 'anthropic/claude-sonnet-5',
    APPBLIPS_OPENAI_API_KEY: '',
    APPBLIPS_OPENAI_MODEL: 'gpt-x',
  }, { reasoning_effort: 'low' });
  assert.equal(response.status, 200);
  assert.equal(upstream.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(upstream.headers.Authorization, 'Bearer or-key');
  assert.equal(upstream.body.model, 'anthropic/claude-sonnet-5');
  assert.deepEqual(upstream.body.reasoning, { effort: 'low' });
});

test('a per-provider base URL overrides the preset endpoint', async (t) => {
  const { upstream } = await runWith(t, {
    APPBLIPS_ZAI_API_KEY: 'z-key',
    APPBLIPS_ZAI_MODEL: 'glm-x',
    APPBLIPS_ZAI_BASE_URL: 'https://api.z.ai/api/coding/paas/v4/',
  });
  assert.equal(upstream.url, 'https://api.z.ai/api/coding/paas/v4/chat/completions');
  assert.deepEqual(upstream.body.thinking, { type: 'disabled' });
});

test('with several keys set the first listed provider wins, and PROVIDER overrides', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const both = {
    APPBLIPS_OPENAI_API_KEY: 'oa', APPBLIPS_OPENAI_MODEL: 'gpt-x',
    APPBLIPS_DEEPSEEK_API_KEY: 'ds', APPBLIPS_DEEPSEEK_MODEL: 'ds-x',
  };
  const auto = await runWith(t, both);
  assert.equal(auto.upstream.headers.Authorization, 'Bearer oa');
  t.mock.restoreAll();
  t.mock.method(console, 'warn', () => {});
  const chosen = await runWith(t, { ...both, APPBLIPS_LLM_PROVIDER: 'deepseek' });
  assert.equal(chosen.upstream.headers.Authorization, 'Bearer ds');
  assert.equal(chosen.upstream.body.model, 'ds-x');
});

test('the plain APPBLIPS_LLM_* variables still work as the generic provider', async (t) => {
  const { upstream } = await runWith(t, {
    APPBLIPS_LLM_BASE_URL: 'https://llm.example/v1',
    APPBLIPS_LLM_API_KEY: 'k',
    APPBLIPS_LLM_MODEL: 'm',
  });
  assert.equal(upstream.url, 'https://llm.example/v1/chat/completions');
  assert.equal(upstream.body.model, 'm');
});

test('the plain variables are a fallback for a named provider', async (t) => {
  const { upstream } = await runWith(t, {
    APPBLIPS_LLM_PROVIDER: 'openrouter',
    APPBLIPS_LLM_API_KEY: 'k',
    APPBLIPS_LLM_MODEL: 'm',
  });
  assert.equal(upstream.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(upstream.headers.Authorization, 'Bearer k');
});

test('no filled-in provider is a clear configuration error', async (t) => {
  const { response } = await runWith(t, { APPBLIPS_OPENAI_API_KEY: '', APPBLIPS_OPENAI_MODEL: 'gpt-x' });
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /No AI provider is configured/);
});

test('a provider with a key but no model names the missing variable', async (t) => {
  const { response } = await runWith(t, { APPBLIPS_OPENROUTER_API_KEY: 'k' });
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /APPBLIPS_LLM_MODEL/);
});

// --- User-supplied provider (Settings → AI) --------------------------------

const userProvider = { id: 'openrouter', apiKey: 'user-key', model: 'user/model' };

test('a user provider works with no provider in the env', async (t) => {
  const { response, upstream } = await runWith(t, {}, { user_provider: userProvider, reasoning_effort: 'low' });
  assert.equal(response.status, 200);
  assert.equal(upstream.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(upstream.headers.Authorization, 'Bearer user-key');
  assert.equal(upstream.body.model, 'user/model');
  assert.deepEqual(upstream.body.reasoning, { effort: 'low' });
  assert.equal(Object.hasOwn(upstream.body, 'user_provider'), false);
});

test('a user provider wins over the env provider; without one the env is used', async (t) => {
  const envProvider = { APPBLIPS_OPENAI_API_KEY: 'env-key', APPBLIPS_LLM_MODEL: 'env-model', APPBLIPS_LLM_BASE_URL: 'https://llm.example/v1' };
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

test('hosted mode still requires sign-in and validates user_provider', async (t) => {
  const hostedEnv = { SELF_HOSTED_MODE: 'false', APPBLIPS_CHAT_RATE_LIMIT_MAX: '1000' };
  const send = (payload, headers = {}) => handleChatProxy(new Request('https://app.example/api/chat', {
    method: 'POST',
    headers,
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], ...payload }),
  }), hostedEnv);
  assert.equal((await send({ user_provider: userProvider })).status, 401);

  t.mock.method(globalThis, 'fetch', async (url) => (String(url).includes('/auth/v1/user')
    ? new Response(JSON.stringify({ id: 'user-1' }))
    : new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })));
  const auth = { authorization: 'Bearer t' };
  assert.equal((await send({ user_provider: 'openrouter' }, auth)).status, 400);
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

test('hosted mode leaves other-origin requests to the sign-in check', async () => {
  const response = await handleChatProxy(new Request('https://appblips.com/api/chat', {
    method: 'POST',
    headers: { origin: 'https://evil.example' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
  }), { SELF_HOSTED_MODE: 'false', SUPABASE_PUBLISHABLE_KEY: 'pk' });
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

test('self-hosted app AI relay is not rate limited', async (t) => {
  const { handleSelfHostedAiChat } = await import('../functions/_lib/selfHostedAiRelay.js');
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { headers: { 'content-type': 'application/json' } }));
  const relayEnv = { ...env, APPBLIPS_APP_AI_RATE_LIMIT_MAX: '1' };
  for (let i = 0; i < 5; i++) {
    const response = await handleSelfHostedAiChat(new Request('http://localhost:5175/api/app-ai/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: `call ${i}` }] }),
    }), relayEnv);
    assert.equal(response.status, 200, `relay request ${i + 1}`);
  }
});
