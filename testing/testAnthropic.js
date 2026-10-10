import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callAnthropic, toAnthropicMessages, toAnthropicParams } from '../electron/server/anthropic.js';
import { applyProviderSettings, resolveUserProvider } from '../electron/server/providers.js';
import { listProviderModels } from '../electron/server/providerModels.js';

const provider = resolveUserProvider({ id: 'anthropic', apiKey: 'sk-ant-test', model: 'claude-opus-5-5' });

const sse = (events) => new Response(
  events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
  { headers: { 'content-type': 'text/event-stream' } },
);

const usage = { input_tokens: 10, output_tokens: 5 };
const replyEvents = [
  { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, usage } },
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Plan.' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Editing.' } },
  { type: 'content_block_stop', index: 1 },
  { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'edit', input: {} } },
  { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"a":' } },
  { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '1}' } },
  { type: 'content_block_stop', index: 2 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } },
  { type: 'message_stop' },
];

test('Anthropic is a user provider whose forced tool choices become auto', () => {
  assert.equal(provider.error, undefined);
  assert.equal(provider.baseUrl, 'https://api.anthropic.com');
  const body = { model: 'claude-opus-5-5', tool_choice: 'required', temperature: 0 };
  applyProviderSettings(body, provider, { effort: 'high' });
  assert.equal(body.reasoning_effort, 'high');
  assert.equal(body.tool_choice, 'auto');
  assert.equal(body.temperature, undefined);
});

test('requests translate to Messages API params', () => {
  const params = toAnthropicParams({
    model: 'claude-opus-5-5',
    reasoning_effort: 'high',
    tool_choice: 'auto',
    tools: [{ type: 'function', function: { name: 'edit', description: 'Edit', parameters: { type: 'object', properties: {} } } }],
    messages: [
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: [{ type: 'text', text: 'Look' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] },
    ],
  });
  assert.equal(params.system, 'Be brief.');
  assert.equal(params.max_tokens, undefined);
  assert.equal(toAnthropicParams({ model: 'claude-opus-5-5', max_tokens: 12000 }).max_tokens, 12000);
  assert.deepEqual(params.thinking, { type: 'adaptive', display: 'summarized' });
  assert.deepEqual(params.output_config, { effort: 'high' });
  assert.deepEqual(params.tool_choice, { type: 'auto' });
  assert.equal(params.tools[0].input_schema.type, 'object');
  assert.deepEqual(params.messages[0].content[1], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } });
  assert.equal(params.fallbacks, 'default');
  // Reasoning off: lowest effort, no thinking config, no sampling on new models.
  const off = toAnthropicParams({ model: 'claude-opus-5-5', temperature: 0, messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(off.thinking, undefined);
  assert.deepEqual(off.output_config, { effort: 'low' });
  assert.equal(off.temperature, undefined);
  // Older models get neither effort nor fallbacks, but keep temperature.
  const haiku = toAnthropicParams({ model: 'claude-haiku-4-5', temperature: 0, messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(haiku.output_config, undefined);
  assert.equal(haiku.fallbacks, undefined);
  assert.equal(haiku.temperature, 0);
});

test('tool turns echo Claude content verbatim and group tool results', () => {
  const original = [
    { type: 'thinking', thinking: 'Plan.', signature: 'sig' },
    { type: 'tool_use', id: 'toolu_1', name: 'edit', input: { a: 1 } },
    { type: 'tool_use', id: 'toolu_2', name: 'edit', input: { a: 2 } },
  ];
  const calls = ['toolu_1', 'toolu_2'].map((id) => ({ id, type: 'function', function: { name: 'edit', arguments: '{}' } }));
  const { messages } = toAnthropicMessages([
    { role: 'user', content: 'go' },
    { role: 'assistant', content: null, reasoning_details: [{ index: 0, type: 'anthropic.content', content: original }], tool_calls: calls },
    { role: 'tool', tool_call_id: 'toolu_1', content: '{"ok":true}' },
    { role: 'tool', tool_call_id: 'toolu_2', content: '{"ok":true}' },
  ]);
  assert.equal(messages.length, 3);
  assert.deepEqual(messages[1].content, original);
  assert.deepEqual(messages[2].content.map((block) => block.tool_use_id), ['toolu_1', 'toolu_2']);
  // When the calls no longer match, the turn is rebuilt without thinking.
  const rebuilt = toAnthropicMessages([
    { role: 'user', content: 'go' },
    { role: 'assistant', content: 'Hi', reasoning_details: [{ type: 'anthropic.content', content: original }], tool_calls: calls.slice(0, 1) },
  ]).messages[1].content;
  assert.deepEqual(rebuilt.map((block) => block.type), ['text', 'tool_use']);
});

test('a streamed reply becomes OpenAI chunks through the SDK', async () => {
  let sent;
  const response = await callAnthropic({ model: 'claude-opus-5-5', stream: true, messages: [{ role: 'user', content: 'hi' }] }, provider, {
    fetchImpl: async (url, init) => {
      sent = { url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) };
      return sse(replyEvents);
    },
  });
  assert.equal(response.status, 200);
  assert.equal(sent.url, 'https://api.anthropic.com/v1/messages?beta=true');
  assert.equal(sent.headers.get('x-api-key'), 'sk-ant-test');
  assert.match(sent.headers.get('anthropic-beta'), /server-side-fallback-2026-07-01/);
  assert.equal(sent.body.stream, true);
  assert.equal(sent.body.max_tokens, 64000);
  const chunks = (await response.text()).split('\n\n').filter(Boolean).map((line) => line.slice(6));
  assert.equal(chunks.at(-1), '[DONE]');
  const deltas = chunks.slice(0, -1).map((data) => JSON.parse(data).choices[0]);
  assert.equal(deltas.map((c) => c.delta.content).filter(Boolean).join(''), 'Editing.');
  assert.equal(deltas.map((c) => c.delta.reasoning_content).filter(Boolean).join(''), 'Plan.');
  const toolDeltas = deltas.flatMap((c) => c.delta.tool_calls || []);
  assert.equal(toolDeltas[0].id, 'toolu_1');
  assert.equal(toolDeltas.map((t) => t.function.arguments).join(''), '{"a":1}');
  const echoed = deltas.find((c) => c.delta.reasoning_details).delta.reasoning_details[0];
  assert.deepEqual(echoed.content.map((block) => block.type), ['thinking', 'text', 'tool_use']);
  assert.equal(echoed.content[0].signature, 'sig');
  assert.equal(deltas.at(-1).finish_reason, 'tool_calls');
});

test('non-streamed replies and errors keep the OpenAI-compatible shape', async () => {
  const reply = await callAnthropic({ model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }] }, provider, { fetchImpl: async () => sse(replyEvents) });
  const message = (await reply.json()).choices[0].message;
  assert.equal(message.content, 'Editing.');
  assert.deepEqual(message.tool_calls, [{ id: 'toolu_1', type: 'function', function: { name: 'edit', arguments: '{"a":1}' } }]);

  const rejected = await callAnthropic({ model: 'claude-opus-5-5', stream: true, messages: [] }, provider, {
    fetchImpl: async () => Response.json({ type: 'error', error: { type: 'rate_limit_error', message: 'Slow down' } }, { status: 429, headers: { 'retry-after': '7' } }),
  });
  assert.equal(rejected.status, 429);
  assert.equal(rejected.headers.get('retry-after'), '7');
  assert.equal((await rejected.json()).error.message, 'Slow down');
});

test('Anthropic sends the given limit, or the app default without one', async () => {
  for (const [max_tokens, expected] of [[undefined, 64000], [4000, 4000]]) {
    let requests = 0;
    const response = await callAnthropic({ model: 'claude-test', max_tokens, messages: [{ role: 'user', content: 'hi' }] }, provider, {
      fetchImpl: async (url, init) => {
        requests++;
        assert.equal(init.method, 'POST');
        assert.equal(JSON.parse(init.body).max_tokens, expected);
        return sse(replyEvents);
      },
    });
    assert.equal(response.status, 200);
    assert.equal(requests, 1);
  }
});

test('Anthropic models load through the SDK', async () => {
  const models = await listProviderModels({ id: 'anthropic', apiKey: 'sk-ant-test' }, {
    fetchImpl: async (url, init) => {
      assert.match(String(url), /^https:\/\/api\.anthropic\.com\/v1\/models/);
      assert.equal(new Headers(init.headers).get('x-api-key'), 'sk-ant-test');
      return Response.json({ data: [{ id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' }, { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' }], has_more: false });
    },
  });
  assert.deepEqual(models.map((m) => m.id), ['claude-opus-5-5', 'claude-sonnet-5-5']);
  await assert.rejects(
    listProviderModels({ id: 'anthropic', apiKey: 'bad' }, { fetchImpl: async () => Response.json({ type: 'error', error: { type: 'authentication_error', message: 'x' } }, { status: 401 }) }),
    /rejected the API key/,
  );
});

test('the chat proxy routes Anthropic through the SDK and reports a bad key', async () => {
  const { handleChatProxy } = await import('../electron/server/chatProxy.js');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, { status: 401 });
  try {
    const response = await handleChatProxy(new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({ user_provider: { id: 'anthropic', apiKey: 'bad', model: 'claude-opus-5-5' }, messages: [{ role: 'user', content: 'hi' }], stream: true }),
    }), {});
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Anthropic rejected the API key/);
  } finally { globalThis.fetch = originalFetch; }
});
