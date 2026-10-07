// Relays an upstream provider response back to the client.
//
// fetch() has already decoded the upstream body, so its content-encoding and
// content-length no longer describe what is relayed. Passing them on makes the
// browser try to gunzip plain text ("Failed to fetch"). Hop-by-hop headers
// don't belong on a relayed response either. Streaming responses pass straight
// through, so the SSE stream reaches the renderer unmodified.

const DROPPED_HEADERS = ['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive'];

const relayHeaders = (headers) => {
  const out = new Headers(headers);
  for (const name of DROPPED_HEADERS) out.delete(name);
  return out;
};

export const relayUpstream = (upstreamResponse) => new Response(upstreamResponse.body, {
  status: upstreamResponse.status,
  headers: relayHeaders(upstreamResponse.headers),
});
