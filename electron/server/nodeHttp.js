// Glue between Node's http (req, res) and the Fetch-style handlers in this
// folder. Used by the Vite dev middleware (vite.config.js) and the browser
// server (server.js); the desktop app doesn't need it, since protocol.handle
// already speaks Request/Response.
import { Readable, pipeline } from 'node:stream';

// A Fetch Request for /api/chat from a Node request. Only the body,
// content type and Origin go through. The real Host and Origin are kept so the
// handler refuses browser requests from other sites (isForeignOrigin in
// chatProxy.js).
export async function toChatRequest(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const protocol = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  return new Request(protocol + '://' + (req.headers.host || 'localhost') + '/api/chat', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(req.headers.origin ? { origin: req.headers.origin } : {}),
    },
    body: Buffer.concat(chunks),
  });
}

// Vite's connect server and a bare http server both treat an 'error' event on
// an unhandled stream as an uncaught exception, which on modern Node kills the
// whole process. This costs one request instead: pipeline() forwards errors
// from either side and, when the client goes away (the user cancelling a
// generation mid-stream), destroys the upstream body so the LLM request is
// cancelled too.
export function sendWebResponse(res, response, extraHeaders = {}, logPrefix = '[proxy]') {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  for (const [key, value] of Object.entries(extraHeaders)) res.setHeader(key, value);
  if (!response.body) {
    res.end();
    return;
  }
  pipeline(Readable.fromWeb(response.body), res, (err) => {
    if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
      console.error(`${logPrefix} stream error:`, err.message);
    }
  });
}
