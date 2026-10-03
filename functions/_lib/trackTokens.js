import { trackApiUsage } from './usageTracking.js';

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

export function wrapWithTokenTracking(env, upstreamResponse, bodyObj, { uid, kind }, waitUntil) {
  if (!upstreamResponse.ok) {
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: relayHeaders(upstreamResponse.headers),
    });
  }

  // A response the provider ended with an error isn't charged to the user's
  // allowance: OpenRouter reports a failure after streaming began as a 200
  // with an error chunk and finish_reason "error". It still counts as a
  // request, and the provider may still bill us -- that's the price of not
  // leaving the user out of pocket for our side's failure.
  if (bodyObj.stream) {
    let tokens = 0;
    let failed = false;
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
              if (data.usage && data.usage.total_tokens) {
                tokens = data.usage.total_tokens;
              }
              if (data.error || data.choices?.[0]?.finish_reason === 'error') failed = true;
            } catch {
              // ignore parse errors for partial chunks
            }
          }
        }
      },
      flush() {
        trackApiUsage(env, { uid, kind, tokens: failed ? 0 : tokens || undefined }, waitUntil);
      }
    });
    
    // Pipe in background
    const pipePromise = upstreamResponse.body.pipeTo(writable).catch(() => {});
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
      try {
        const data = JSON.parse(text);
        if (data.usage && data.usage.total_tokens) {
          tokens = data.usage.total_tokens;
        }
        if (data.error || data.choices?.[0]?.finish_reason === 'error') tokens = 0;
      } catch {
        // ignore
      }
      
      trackApiUsage(env, { uid, kind, tokens: tokens || undefined }, waitUntil);
      
      return new Response(text, {
        status: upstreamResponse.status,
        headers: relayHeaders(upstreamResponse.headers),
      });
    };
    
    // For non-streamed we have to wait for the body to be read, so we return a promise of a Response.
    return processNonStreamed();
  }
}
