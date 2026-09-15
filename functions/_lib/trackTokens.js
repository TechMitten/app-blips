import { trackApiUsage } from './usageTracking.js';

export function wrapWithTokenTracking(env, upstreamResponse, bodyObj, { uid, kind }, waitUntil) {
  if (!upstreamResponse.ok) return upstreamResponse;

  if (bodyObj.stream) {
    let tokens = 0;
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
            } catch {
              // ignore parse errors for partial chunks
            }
          }
        }
      },
      flush() {
        trackApiUsage(env, { uid, kind, tokens: tokens || undefined }, waitUntil);
      }
    });
    
    // Pipe in background
    const pipePromise = upstreamResponse.body.pipeTo(writable).catch(() => {});
    if (typeof waitUntil === 'function') waitUntil(pipePromise);
    
    return new Response(readable, {
      status: upstreamResponse.status,
      headers: upstreamResponse.headers,
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
      } catch {
        // ignore
      }
      
      trackApiUsage(env, { uid, kind, tokens: tokens || undefined }, waitUntil);
      
      return new Response(text, {
        status: upstreamResponse.status,
        headers: upstreamResponse.headers,
      });
    };
    
    // For non-streamed we have to wait for the body to be read, so we return a promise of a Response.
    return processNonStreamed();
  }
}
