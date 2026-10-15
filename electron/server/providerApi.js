// /api/provider/* for the browser version (server.js and the Vite dev
// server): saves the Settings → AI key server-side (keyFile.js) and lists
// models with it, so the page never stores or reads a saved key. Fetch
// primitives only, like chatProxy.js. The desktop app answers the same
// questions over IPC instead (electron/main.js).
//
//   GET    /api/provider          -> { id, hasKey }
//   PUT    /api/provider          -> save { id, model, baseUrl, apiKey, enabled }
//   DELETE /api/provider          -> forget the key
//   POST   /api/provider/models   -> [{ id, label }] for { id, baseUrl, apiKey? }
import { isForeignOrigin, localServerUrl } from './chatProxy.js';
import { resolveUserProvider, USER_PROVIDER_OPTIONS } from './providers.js';
import { listProviderModels } from './providerModels.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

// resolveUserProvider's limit; checked here too because a disabled provider
// is saved without resolving it.
const MAX_KEY_LENGTH = 512;

const isLocal = (id) => Boolean(USER_PROVIDER_OPTIONS.find((p) => p.id === id)?.local);

export async function handleProviderApi(request, env, keys) {
  // Only AppBlips' own page may change or use the key. A JSON body also
  // forces a CORS preflight, which other sites can't pass.
  if (isForeignOrigin(request, env)) return json({ error: 'Not allowed.' }, 403);
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  const readBody = async () => {
    if (!/^application\/json\b/i.test(request.headers.get('content-type') || '')) return null;
    try {
      const body = await request.json();
      return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
    } catch {
      return null;
    }
  };

  if (path === '/api/provider') {
    if (request.method === 'GET') return json(keys.describe());
    if (request.method === 'DELETE') {
      await keys.clear();
      return json(keys.describe());
    }
    if (request.method === 'PUT') {
      const info = await readBody();
      if (!info) return json({ error: 'Invalid provider settings.' }, 400);
      const id = typeof info.id === 'string' ? info.id : '';
      const typed = typeof info.apiKey === 'string' ? info.apiKey.trim() : '';
      if (typed.length > MAX_KEY_LENGTH) return json({ error: 'The API key is not valid.' }, 400);
      // An empty key keeps the saved one, unless the provider changes.
      const apiKey = typed || keys.keyFor(id);
      let baseUrl = typeof info.baseUrl === 'string' ? info.baseUrl : '';
      if (info.enabled === true) {
        const resolved = resolveUserProvider({ ...info, apiKey });
        if (resolved.error) return json({ error: resolved.error }, 400);
        baseUrl = resolved.baseUrl;
      }
      // Local servers need no key; keeping none means none is sent.
      if (apiKey && !isLocal(id)) await keys.save(id, apiKey);
      else await keys.clear();
      return json({ ...keys.describe(), baseUrl, local: isLocal(id) });
    }
    return json({ error: 'Method not allowed.' }, 405);
  }

  if (path === '/api/provider/models') {
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    const input = await readBody();
    if (!input) return json({ error: 'Invalid provider settings.' }, 400);
    const typed = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
    try {
      const models = await listProviderModels(
        { ...input, apiKey: typed || keys.keyFor(input.id) },
        // In Docker, LM Studio and Ollama run on the host, not in the container.
        { baseUrlFor: (provider) => localServerUrl(env, provider) },
      );
      return json(models);
    } catch (err) {
      return json({ error: err?.message || 'Could not load models.' }, 400);
    }
  }

  return json({ error: 'Not found.' }, 404);
}
