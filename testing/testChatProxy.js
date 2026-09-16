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
  let upstreamBody;
  const responseBody = 'data: {"choices":[{"delta":{"content":"Done"}}]}\n\ndata: [DONE]\n\n';
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://llm.example/v1/chat/completions');
    upstreamBody = JSON.parse(options.body);
    return new Response(responseBody, { headers: { 'content-type': 'text/event-stream' } });
  });
  const response = await handleChatProxy(new Request('https://app.example/api/chat', {
    method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Change the background' }], ...payload }),
  }), { ...env, ...settings });
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
