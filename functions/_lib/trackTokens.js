import { trackApiUsage } from './usageTracking.js';
import { priceUsage } from './modelPrices.js';

// fetch() has already decoded the upstream body, so its content-encoding and
// content-length no longer describe what is relayed. Passing them on makes the
// browser try to gunzip plain text ("Failed to fetch"). Hop-by-hop headers
// don't belong on a relayed response either.
const DROPPED_HEADERS = ['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive'];
const relayHeaders = (headers) => {
  const out = new Headers(headers);
  for (const name of DROPPED_HEADERS) out.delete(name);
  return out;
};

// What a usage block says the request cost us: OpenRouter reports `cost` in
// dollars; DeepSeek's own API doesn't, so it's priced from the model's listed
// rates (modelPrices.js; 0 for an unlisted model). Cached input is
// `prompt_tokens_details.cached_tokens` (OpenAI and OpenRouter) or
// `prompt_cache_hit_tokens` (DeepSeek). Input and output are kept apart
// because they're priced very differently. Recorded for the operator's
// margin numbers only, never charged to the user.
const costOf = (usage, model) => ({
  costMicros: usage.cost != null
    ? Math.round((Number(usage.cost) || 0) * 1e6)
    : priceUsage(model, usage) || 0,
  cachedTokens: Number(usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens) || 0,
  inputTokens: Number(usage.prompt_tokens) || 0,
  outputTokens: Number(usage.completion_tokens) || 0,
});

// Rough input size of a request in tokens, for the reservation made before it
// goes out (billing.js holdAllowance; settled to the provider's count
// afterwards). Errs high: ~3 characters a token, and an image counted flat
// instead of by its base64 size.
const IMAGE_TOKENS_ESTIMATE = 1500;
export const estimateInputTokens = (messages, tools) => {
  let chars = 0;
  let images = 0;
  for (const message of messages) {
    if (typeof message?.content === 'string') chars += message.content.length;
    else if (Array.isArray(message?.content)) {
      for (const part of message.content) {
        if (part?.type === 'image_url') images += 1;
        else chars += JSON.stringify(part ?? '').length;
      }
    }
    if (message?.tool_calls) chars += JSON.stringify(message.tool_calls).length;
  }
  if (tools) chars += JSON.stringify(tools).length;
  return Math.ceil(chars / 3) + images * IMAGE_TOKENS_ESTIMATE;
};

// Characters of model output in a streamed delta or a whole message: text,
// reasoning and tool-call arguments. Only used to estimate a request's tokens
// when the provider never reported its usage.
const outputLength = (part) => {
  if (!part) return 0;
  const text = (value) => (typeof value === 'string' ? value.length : 0);
  let length = text(part.content) + text(part.reasoning) + text(part.reasoning_content);
  for (const call of Array.isArray(part.tool_calls) ? part.tool_calls : []) {
    length += text(call?.function?.name) + text(call?.function?.arguments);
  }
  return length;
};

// `reservation` ({ date, tokens, input }, see chatProxy.js) is the estimate
// this request already reserved against the plan's allowance; recording the
// usage settles it. With one, a response whose usage never arrived (the
// client stopped reading, the provider doesn't report it) is charged an
// estimate -- `input` plus its output at ~3 characters a token -- rather than
// nothing, so ending a stream early can't be a way around the allowance.
export function wrapWithTokenTracking(env, upstreamResponse, bodyObj, { uid, kind, reservation }, waitUntil) {
  if (!upstreamResponse.ok) {
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: relayHeaders(upstreamResponse.headers),
    });
  }

  const charged = ({ tokens, failed, outputChars }) => {
    if (failed) return 0;
    if (tokens) return tokens;
    return reservation ? reservation.input + Math.ceil(outputChars / 3) : undefined;
  };

  // A response the provider ended with an error isn't charged to the user's
  // allowance: OpenRouter reports a failure after streaming began as a 200
  // with an error chunk and finish_reason "error". It still counts as a
  // request, and the provider may still bill us -- that's the price of not
  // leaving the user out of pocket for our side's failure.
  if (bodyObj.stream) {
    let tokens = 0;
    let failed = false;
    let outputChars = 0;
    let spend = { costMicros: 0, cachedTokens: 0 };
    // Once, from whichever comes first: the stream ending (flush) or the pipe
    // failing because the client cancelled or the provider dropped.
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      trackApiUsage(env, { uid, kind, tokens: charged({ tokens, failed, outputChars }), ...spend, reservation }, waitUntil);
    };
    const { readable, writable } = new TransformStream({
      start() { this.buffer = ''; },
      transform(chunk, controller) {
        controller.enqueue(chunk);
        const text = new TextDecoder().decode(chunk, { stream: true });
        this.buffer += text;
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const data = JSON.parse(line.slice(6).trim());
              outputChars += outputLength(data.choices?.[0]?.delta);
              if (data.usage && data.usage.total_tokens) {
                tokens = data.usage.total_tokens;
                spend = costOf(data.usage, bodyObj.model);
              }
              if (data.error || data.choices?.[0]?.finish_reason === 'error') failed = true;
            } catch {
              // ignore parse errors for partial chunks
            }
          }
        }
      },
      flush: settle,
    });
    
    // Pipe in background
    const pipePromise = upstreamResponse.body.pipeTo(writable).catch(settle);
    if (typeof waitUntil === 'function') waitUntil(pipePromise);
    
    return new Response(readable, {
      status: upstreamResponse.status,
      headers: relayHeaders(upstreamResponse.headers),
    });
  } else {
    // Non-streamed
    const processNonStreamed = async () => {
      const text = await upstreamResponse.text();
      let tokens = 0;
      let failed = false;
      let outputChars = 0;
      let spend = { costMicros: 0, cachedTokens: 0 };
      try {
        const data = JSON.parse(text);
        outputChars = outputLength(data.choices?.[0]?.message);
        if (data.usage && data.usage.total_tokens) {
          tokens = data.usage.total_tokens;
          spend = costOf(data.usage, bodyObj.model);
        }
        if (data.error || data.choices?.[0]?.finish_reason === 'error') failed = true;
      } catch {
        // ignore
      }
      
      trackApiUsage(env, { uid, kind, tokens: charged({ tokens, failed, outputChars }), ...spend, reservation }, waitUntil);
      
      return new Response(text, {
        status: upstreamResponse.status,
        headers: relayHeaders(upstreamResponse.headers),
      });
    };
    
    // For non-streamed we have to wait for the body to be read, so we return a promise of a Response.
    return processNonStreamed();
  }
}
