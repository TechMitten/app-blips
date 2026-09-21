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

// --- Provider translation (functions/_lib/reasoning.js) -------------------

test('unknown model keeps stream_options when streaming', async (t) => {
  const body = await captureRequest(t, { stream: true, reasoning_effort: 'high' });
  assert.deepEqual(body.stream_options, { include_usage: true });
});

// Z.ai: GLM-5.3 only accepts low/high/max, so medium maps to high.
for (const [effort, expected] of [['low', 'low'], ['medium', 'high'], ['high', 'high']]) {
  test(`z.ai glm-5.3 effort ${effort} -> thinking enabled + reasoning_effort ${expected}`, async (t) => {
    const body = await captureRequest(t, { reasoning_effort: effort }, { APPBLIPS_LLM_MODEL: 'glm-5.3' });
    assert.deepEqual(body.thinking, { type: 'enabled' });
    assert.equal(body.reasoning_effort, expected);
  });
}

test('z.ai glm-5.3 off -> thinking disabled, no reasoning_effort, no stream_options', async (t) => {
  const body = await captureRequest(t, { stream: true, reasoning_effort: 'none' }, { APPBLIPS_LLM_MODEL: 'glm-5.3' });
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.equal(Object.hasOwn(body, 'reasoning_effort'), false);
  assert.equal(Object.hasOwn(body, 'stream_options'), false);
});

test('z.ai glm-5.2 effort maps through', async (t) => {
  const body = await captureRequest(t, { reasoning_effort: 'high' }, { APPBLIPS_LLM_MODEL: 'glm-5.2' });
  assert.deepEqual(body.thinking, { type: 'enabled' });
  assert.equal(body.reasoning_effort, 'high');
});

test('z.ai pre-5.2 model gets thinking toggle only, no reasoning_effort', async (t) => {
  const body = await captureRequest(t, { reasoning_effort: 'high' }, { APPBLIPS_LLM_MODEL: 'glm-4.6' });
  assert.deepEqual(body.thinking, { type: 'enabled' });
  assert.equal(Object.hasOwn(body, 'reasoning_effort'), false);
});

test('z.ai off on pre-5.2 model -> thinking disabled', async (t) => {
  const body = await captureRequest(t, { reasoning_effort: 'none' }, { APPBLIPS_LLM_MODEL: 'glm-4.5-air' });
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.equal(Object.hasOwn(body, 'reasoning_effort'), false);
});

test('z.ai detected from base-url host', async (t) => {
  const body = await captureRequest(t, { reasoning_effort: 'none' }, { APPBLIPS_LLM_BASE_URL: 'https://api.z.ai/api/paas/v4' });
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.equal(Object.hasOwn(body, 'reasoning_effort'), false);
});

test('z.ai reasoning downgrades forced tool choice to auto', async (t) => {
  const body = await captureRequest(t, { tools: [editTool], tool_choice: 'required', reasoning_effort: 'high' }, { APPBLIPS_LLM_MODEL: 'glm-5.3' });
  assert.equal(body.tool_choice, 'auto');
  assert.deepEqual(body.thinking, { type: 'enabled' });
});

test('z.ai always downgrades forced tool choice to auto, even with reasoning off', async (t) => {
  const body = await captureRequest(t, { tools: [editTool], tool_choice: namedChoice, reasoning_effort: 'none' }, { APPBLIPS_LLM_MODEL: 'glm-5.3' });
  assert.equal(body.tool_choice, 'auto');
  assert.deepEqual(body.thinking, { type: 'disabled' });
});

test('deepseek non-thinking keeps forced tool choice', async (t) => {
  const body = await captureRequest(t, { tools: [editTool], tool_choice: 'required', reasoning_effort: 'none' }, { APPBLIPS_LLM_MODEL: 'deepseek-v4-pro' });
  assert.equal(body.tool_choice, 'required');
  assert.equal(body.reasoning_effort, 'none');
});

test('deepseek thinking downgrades forced tool choice to auto', async (t) => {
  const body = await captureRequest(t, { tools: [editTool], tool_choice: 'required', reasoning_effort: 'low' }, { APPBLIPS_LLM_MODEL: 'deepseek-v4-pro' });
  assert.equal(body.tool_choice, 'auto');
  assert.equal(body.reasoning_effort, 'low');
});

test('deepseek model passes reasoning_effort through untouched', async (t) => {
  const body = await captureRequest(t, { reasoning_effort: 'medium' }, { APPBLIPS_LLM_MODEL: 'deepseek-v4-pro' });
  assert.equal(body.reasoning_effort, 'medium');
  assert.equal(Object.hasOwn(body, 'thinking'), false);
});

test('deepseek off keeps reasoning_effort none', async (t) => {
  const body = await captureRequest(t, { reasoning_effort: 'none' }, { APPBLIPS_LLM_MODEL: 'deepseek-v4-pro' });
  assert.equal(body.reasoning_effort, 'none');
});

test('provider override forces translation regardless of model name', async (t) => {
  const body = await captureRequest(t, { reasoning_effort: 'high' }, { APPBLIPS_LLM_PROVIDER: 'zai' });
  assert.deepEqual(body.thinking, { type: 'enabled' });
  assert.equal(Object.hasOwn(body, 'reasoning_effort'), false);
});
