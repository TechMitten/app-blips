// Attaches a saved key to /api/chat requests, so the page never has to hold
// one. Shared by the desktop app (keys from the OS keychain, providerStore.js)
// and the browser version (keys from keyFile.js).
//
// The page sends no key: the saved one is attached here, as the same
// `user_provider` it would otherwise carry, so chatProxy applies identical
// handling (preset endpoint, "rejected the API key" errors). A test request
// for the saved provider may leave apiKey empty to mean "the saved key". The
// key goes only to that provider's preset endpoint (or a localhost server):
// resolveUserProvider ignores any other base URL, and chatProxy still refuses
// requests from other origins.
export async function withSavedProvider(request, { keyFor, active = () => null }) {
  if (request.method !== 'POST') return request;
  const text = await request.text();
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const sent = body.user_provider;
    if (sent && typeof sent === 'object' && !sent.apiKey) {
      body.user_provider = { ...sent, apiKey: keyFor(sent.id) };
    } else if (sent == null) {
      const saved = active();
      if (saved) body.user_provider = saved;
    }
  }
  const origin = request.headers.get('origin');
  const authorization = request.headers.get('authorization');
  return new Request(request.url, {
    method: 'POST',
    // Origin is kept for chatProxy's other-site check: a sandboxed app's
    // request arrives as Origin "null" and must still be refused.
    headers: {
      'content-type': 'application/json',
      ...(origin ? { origin } : {}),
      ...(authorization ? { authorization } : {}),
    },
    body: body ? JSON.stringify(body) : text,
  });
}
