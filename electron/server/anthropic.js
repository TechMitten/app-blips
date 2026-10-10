// Anthropic (Claude) adapter for the chat proxy. The renderer and the rest of
// the proxy speak the OpenAI Chat Completions shape; Anthropic's Messages API
// does not, so this module translates the request, calls Claude through the
// official SDK, and translates the reply back -- an OpenAI-style SSE stream or
// chat.completion body. It returns a Fetch Response that looks like an
// OpenAI-compatible upstream (errors as { error: { message } } with the
// provider's status), so chatProxy.js's 401/429 handling and relay apply to it
// unchanged.

import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_BUILD_MAX_TOKENS } from './providers.js';

// Claude's thinking blocks carry signatures and must be sent back exactly as
// they arrived (same order, same bytes) on the next tool-calling turn. The
// renderer already echoes `reasoning_details` unchanged (llm.js
// REASONING_ECHO_FIELDS), so the reply's full ordered content travels there
// under this type and is reused verbatim when the turn comes back.
const CONTENT_DETAIL = 'anthropic.content';

// Model families with adaptive thinking and output_config.effort (Opus/Sonnet
// 4.6 and later, Fable, Mythos). Older models (Haiku 4.5, ...) get neither.
const ADAPTIVE_MODEL = /^claude-(?:opus|sonnet|fable|mythos)-(?:[5-9]|4-[6-9])/;
// Opus/Sonnet 4.7 and later reject temperature/top_p/top_k with a 400.
const NO_SAMPLING_MODEL = /^claude-(?:opus|sonnet|fable|mythos)-(?:[5-9]|4-[7-9])/;
// Models whose safety classifiers can decline a request mid-flight. The
// server-side fallback re-runs a declined request on a suitable model inside
// the same call, so a refusal doesn't end a build.
const FALLBACK_MODEL = /^claude-(?:opus-5|fable-5-1|sonnet-5-5)(?:$|-)/;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

const FINISH_REASONS = { end_turn: 'stop', stop_sequence: 'stop', tool_use: 'tool_calls', max_tokens: 'length', refusal: 'content_filter' };
const REFUSAL_TEXT = 'Claude declined this request. Try rewording it, or choose another model in Settings → AI.';

const nonBlank = (text) => typeof text === 'string' && text.trim() !== '';

const imageBlock = (url) => {
  const data = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (data) return { type: 'image', source: { type: 'base64', media_type: data[1], data: data[2] } };
  return { type: 'image', source: { type: 'url', url } };
};

// OpenAI message content (a string or [{type:'text'}, {type:'image_url'}])
// to Anthropic content blocks. Anthropic rejects blank text blocks.
const contentBlocks = (content) => {
  if (typeof content === 'string') return nonBlank(content) ? [{ type: 'text', text: content }] : [];
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => {
    if (part?.type === 'text' && nonBlank(part.text)) return [{ type: 'text', text: part.text }];
    if (part?.type === 'image_url' && typeof part.image_url?.url === 'string') return [imageBlock(part.image_url.url)];
    return [];
  });
};

const parseArguments = (raw) => {
  try {
    const value = JSON.parse(raw || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
};

// After a mid-output fallback, blocks the declined model produced before the
// last `fallback` marker must not be replayed (thinking, tool calls); its text
// and everything after the marker echo normally.
const echoableContent = (content) => {
  const boundary = content.findLastIndex((block) => block?.type === 'fallback');
  if (boundary < 0) return content;
  return content.filter((block, i) => i >= boundary || !['thinking', 'redacted_thinking', 'tool_use'].includes(block?.type));
};

// An assistant turn: Claude's original content when the renderer echoed it and
// it still matches the turn's tool calls, otherwise rebuilt from the OpenAI
// fields (a turn from another provider, or one the renderer changed).
const assistantContent = (message) => {
  const callIds = (message.tool_calls || []).map((call) => call.id);
  const original = (message.reasoning_details || []).find((detail) => detail?.type === CONTENT_DETAIL)?.content;
  if (Array.isArray(original)) {
    const content = echoableContent(original);
    const originalIds = content.filter((block) => block?.type === 'tool_use').map((block) => block.id);
    if (originalIds.length === callIds.length && originalIds.every((id, i) => id === callIds[i])) return content;
  }
  return [
    ...contentBlocks(message.content),
    ...(message.tool_calls || []).map((call) => ({
      type: 'tool_use',
      id: call.id,
      name: call.function?.name,
      input: parseArguments(call.function?.arguments),
    })),
  ];
};

// OpenAI messages to { system, messages }. System messages become the
// top-level system prompt; consecutive tool results share one user turn, as
// Anthropic expects all results for a turn's parallel calls together.
export const toAnthropicMessages = (openaiMessages = []) => {
  const system = [];
  const messages = [];
  const push = (role, content) => {
    if (!content.length) return;
    const last = messages.at(-1);
    if (last?.role === role) last.content.push(...content);
    else messages.push({ role, content: [...content] });
  };
  for (const message of openaiMessages) {
    if (!message || typeof message !== 'object') continue;
    if (message.role === 'system' || message.role === 'developer') {
      const text = contentBlocks(message.content).filter((block) => block.type === 'text').map((block) => block.text).join('\n\n');
      if (text) system.push(text);
    } else if (message.role === 'assistant') {
      push('assistant', assistantContent(message));
    } else if (message.role === 'tool') {
      const text = typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? '');
      push('user', [{ type: 'tool_result', tool_use_id: message.tool_call_id, content: text || '(empty)' }]);
    } else {
      push('user', contentBlocks(message.content));
    }
  }
  return { system: system.join('\n\n'), messages };
};

const toAnthropicTools = (tools) => (Array.isArray(tools) ? tools : [])
  .filter((tool) => tool?.type === 'function' && tool.function?.name)
  .map((tool) => ({
    name: tool.function.name,
    description: tool.function.description || '',
    input_schema: tool.function.parameters || { type: 'object', properties: {} },
    // Stream large tool inputs (whole pages, surgical edits) as they are
    // written, so the live code peek moves. The renderer already treats
    // arguments as untrusted JSON and validates them before running a tool.
    eager_input_streaming: true,
  }));

// The provider preset sets forcedToolChoice: false, so 'required' and named
// choices arrive here as 'auto' (current Claude models reject forced tool use,
// and the refinement loop nudges the model when no tool is called).
const toAnthropicToolChoice = (choice) => (choice === 'none' ? { type: 'none' } : { type: 'auto' });

// The OpenAI-style request body (after applyProviderSettings) to Messages API
// params. reasoning_effort is the user's setting: absent means "reasoning
// off", which on current models means the lowest effort (Opus 5.5 can't turn
// thinking off at all).
export const toAnthropicParams = (body) => {
  const { system, messages } = toAnthropicMessages(body.messages);
  const model = String(body.model || '');
  const effort = body.reasoning_effort;
  const params = {
    model,
    messages,
  };
  if (body.max_tokens != null) params.max_tokens = body.max_tokens;
  if (system) params.system = system;
  const tools = toAnthropicTools(body.tools);
  if (tools.length) {
    params.tools = tools;
    if (body.tool_choice) params.tool_choice = toAnthropicToolChoice(body.tool_choice);
  }
  if (ADAPTIVE_MODEL.test(model)) {
    params.output_config = { effort: effort === 'high' ? 'high' : effort === 'medium' ? 'medium' : 'low' };
    // A readable summary keeps the "Thinking" indicator fed while it works.
    if (effort) params.thinking = { type: 'adaptive', display: 'summarized' };
  }
  if (typeof body.temperature === 'number' && !NO_SAMPLING_MODEL.test(model) && !params.thinking) {
    params.temperature = body.temperature;
  }
  if (FALLBACK_MODEL.test(model)) {
    params.betas = [FALLBACK_BETA];
    params.fallbacks = 'default';
  }
  return params;
};

const errorResponse = (status, message, headers = {}) => new Response(
  JSON.stringify({ error: { message } }),
  { status, headers: { 'content-type': 'application/json', ...headers } },
);

// An SDK error as the upstream response an OpenAI-compatible provider would
// have sent: same status, the provider's message, and its Retry-After.
const sdkErrorResponse = (err) => {
  if (err instanceof Anthropic.APIConnectionError) return errorResponse(502, `Could not reach Anthropic: ${err.message}`);
  if (err instanceof Anthropic.APIError && err.status) {
    const retryAfter = err.headers?.get?.('retry-after');
    const message = err.error?.error?.message || err.message;
    return errorResponse(err.status, message, retryAfter ? { 'retry-after': retryAfter } : {});
  }
  return errorResponse(502, err?.message || 'The Anthropic request failed.');
};

const toolCallsOf = (content) => content
  .filter((block) => block.type === 'tool_use')
  .map((block) => ({ id: block.id, type: 'function', function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) } }));

const usageOf = (usage) => {
  const prompt = (usage?.input_tokens || 0) + (usage?.cache_read_input_tokens || 0) + (usage?.cache_creation_input_tokens || 0);
  const completion = usage?.output_tokens || 0;
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion };
};

// A finished Claude message as a non-streaming chat.completion.
const toChatCompletion = (message) => {
  const refused = message.stop_reason === 'refusal';
  const text = message.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
  const toolCalls = refused ? [] : toolCallsOf(message.content);
  return {
    id: message.id,
    object: 'chat.completion',
    model: message.model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: refused && !text ? REFUSAL_TEXT : text,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        reasoning_details: [{ index: 0, type: CONTENT_DETAIL, content: message.content }],
      },
      finish_reason: FINISH_REASONS[message.stop_reason] || 'stop',
    }],
    usage: usageOf(message.usage),
  };
};

// Claude's stream events as OpenAI chat.completion.chunk SSE lines. Text and
// tool-call input stream through as they arrive; the turn's full content is
// sent once at the end as reasoning_details so it can be echoed back.
const streamAsChatChunks = (stream, firstEvent) => {
  const encoder = new TextEncoder();
  const toolIndexes = new Map(); // content block index -> tool_calls index
  let model = '';
  let sentText = false;
  const chunk = (delta, extra = {}) => `data: ${JSON.stringify({ object: 'chat.completion.chunk', model, choices: [{ index: 0, delta, finish_reason: null }], ...extra })}\n\n`;

  const translate = (event) => {
    switch (event.type) {
      case 'message_start':
        model = event.message.model;
        return '';
      case 'content_block_start':
        if (event.content_block.type === 'tool_use') {
          const index = toolIndexes.size;
          toolIndexes.set(event.index, index);
          return chunk({ tool_calls: [{ index, id: event.content_block.id, type: 'function', function: { name: event.content_block.name, arguments: '' } }] });
        }
        return '';
      case 'content_block_delta':
        if (event.delta.type === 'text_delta' && event.delta.text) {
          sentText = true;
          return chunk({ content: event.delta.text });
        }
        if (event.delta.type === 'input_json_delta' && event.delta.partial_json && toolIndexes.has(event.index)) {
          return chunk({ tool_calls: [{ index: toolIndexes.get(event.index), function: { arguments: event.delta.partial_json } }] });
        }
        if (event.delta.type === 'thinking_delta' && event.delta.thinking) {
          return chunk({ reasoning_content: event.delta.thinking });
        }
        return '';
      default:
        return '';
    }
  };

  let pending = firstEvent;
  return new ReadableStream({
    async pull(controller) {
      try {
        // A pull that enqueues nothing is not called again, so read on until
        // an event produces output or the stream ends.
        for (;;) {
          let event = pending;
          pending = null;
          if (!event) {
            const next = await stream.next();
            if (next.done) break;
            event = next.value;
          }
          const out = translate(event);
          if (out) {
            controller.enqueue(encoder.encode(out));
            return;
          }
        }
        const message = await stream.source.finalMessage();
        const refused = message.stop_reason === 'refusal';
        let tail = '';
        if (refused && !sentText) tail += chunk({ content: REFUSAL_TEXT });
        tail += chunk({ reasoning_details: [{ index: 0, type: CONTENT_DETAIL, content: message.content }] });
        tail += `data: ${JSON.stringify({ object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: {}, finish_reason: FINISH_REASONS[message.stop_reason] || 'stop' }], usage: usageOf(message.usage) })}\n\n`;
        tail += 'data: [DONE]\n\n';
        controller.enqueue(encoder.encode(tail));
        controller.close();
      } catch (err) {
        // A broken stream must look broken, so the renderer retries instead
        // of treating a partial reply as complete.
        controller.error(err);
      }
    },
    cancel() {
      stream.source.abort();
    },
  });
};

// Sends the OpenAI-style `body` to Claude and returns an OpenAI-compatible
// upstream Response. `fetchImpl` is a seam for tests.
export async function callAnthropic(body, provider, { fetchImpl = globalThis.fetch } = {}) {
  const client = new Anthropic({
    apiKey: provider.apiKey,
    // Only the key from Settings / .env is used; never ambient Anthropic
    // credentials (ANTHROPIC_AUTH_TOKEN, CLI profiles) from the environment.
    authToken: null,
    baseURL: provider.baseUrl,
    // The renderer owns retries (llm.js backoff), as with every provider.
    maxRetries: 0,
    fetch: fetchImpl,
  });
  let source;
  try {
    const params = toAnthropicParams(body);
    // Messages requires max_tokens. chatProxy.js always sends one; this is
    // only a backstop for other callers.
    params.max_tokens ??= DEFAULT_BUILD_MAX_TOKENS;
    source = client.beta.messages.stream(params);
    if (!body.stream) return Response.json(toChatCompletion(await source.finalMessage()));
    // Wait for the first event so an HTTP error (bad key, rate limit) becomes
    // a status code rather than a broken stream.
    const iterator = source[Symbol.asyncIterator]();
    const first = await iterator.next();
    const stream = { next: () => iterator.next(), source };
    return new Response(streamAsChatChunks(stream, first.done ? null : first.value), {
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
    });
  } catch (err) {
    source?.abort();
    return sdkErrorResponse(err);
  }
}

// Model discovery for Settings → AI.
export async function listAnthropicModels(apiKey, baseUrl, { fetchImpl = globalThis.fetch } = {}) {
  const client = new Anthropic({ apiKey, authToken: null, baseURL: baseUrl, maxRetries: 0, timeout: 15000, fetch: fetchImpl });
  const models = [];
  for await (const model of client.models.list({ limit: 100 })) {
    models.push({ id: model.id, label: model.display_name || model.id });
  }
  return models;
}
