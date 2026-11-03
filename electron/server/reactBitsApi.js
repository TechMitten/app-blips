// /api/react-bits/component: downloads one React Bits component's source from
// React Bits' public shadcn registry, for the React Bits connector
// (src/lib/reactBits.js). Used by every host (electron/main.js, server.js, the
// Vite dev server, android.js), so Fetch primitives only, like tavilyApi.js.
// The page can't fetch it itself: reactbits.dev sends no CORS headers.
//
//   GET /api/react-bits/component?name=FlyingButton-JS-CSS
//     -> { name, files: [{ path, content }], dependencies: [...] } | { error }
//
// The name is checked against a fixed shape, so this only ever fetches
// https://reactbits.dev/r/<Name>-<JS|TS>-<CSS|TW>.json: no other address can
// be reached through it. What comes back is third-party code that the AI puts
// into the user's project, so only plain file paths, text contents and npm
// package names pass through, with size caps.
import { isForeignOrigin } from './chatProxy.js';

const REGISTRY = 'https://reactbits.dev/r';
const NAME_RE = /^[A-Z][A-Za-z0-9]{1,60}-(?:JS|TS)-(?:CSS|TW)$/;
// The largest free component (Lanyard) is about 50 KB.
const MAX_BYTES = 400 * 1024;
const MAX_FILES = 8;
const TIMEOUT_MS = 15000;
// A component file name like "Lanyard/Lanyard.jsx" or "Lanyard.css".
const PATH_RE = /^(?:[A-Za-z0-9_-]+\/)?[A-Za-z0-9_.-]+\.(?:jsx?|tsx?|css)$/;
// An npm package, optionally scoped, with an optional version range.
const DEP_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[\w.^~<>=| -]{1,40})?$/;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

const UNREACHABLE = 'Couldn’t reach reactbits.dev. Check your internet connection and try again.';

// Downloads are the same for every caller, so a desktop session fetches each
// variant once.
const cache = new Map();

// The registry item, reduced to what the AI needs. Exported for tests.
export const cleanItem = (name, item) => {
  if (!item || typeof item !== 'object' || !Array.isArray(item.files)) return null;
  const files = item.files.slice(0, MAX_FILES)
    .filter((file) => typeof file?.path === 'string' && PATH_RE.test(file.path) && !file.path.includes('..') && typeof file.content === 'string')
    .map((file) => ({ path: file.path, content: file.content }));
  if (!files.length) return null;
  const dependencies = (Array.isArray(item.dependencies) ? item.dependencies : [])
    .filter((dep) => typeof dep === 'string' && DEP_RE.test(dep)).slice(0, 12);
  return { name, files, dependencies };
};

async function readCapped(response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function handleReactBitsApi(request, env = {}, { fetch: fetchFn = fetch } = {}) {
  if (isForeignOrigin(request, env)) return json({ error: 'Forbidden.' }, 403);
  const url = new URL(request.url);
  if (url.pathname !== '/api/react-bits/component') return json({ error: 'Not found.' }, 404);
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  const name = url.searchParams.get('name') || '';
  if (!NAME_RE.test(name)) return json({ error: 'Unknown React Bits component.' }, 400);
  if (cache.has(name)) return json(cache.get(name));

  let response;
  try {
    response = await fetchFn(`${REGISTRY}/${name}.json`, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return json({ error: UNREACHABLE }, 502);
  }
  // The site answers unknown names with its HTML app page, not a 404.
  const type = response.headers.get('content-type') || '';
  if (response.status === 404 || (response.ok && !type.includes('json'))) {
    return json({ error: 'React Bits has no component by that name.' }, 404);
  }
  if (!response.ok) return json({ error: `reactbits.dev answered with error ${response.status}. Try again later.` }, 502);
  let item;
  try {
    const text = await readCapped(response);
    if (text === null) return json({ error: 'That React Bits component is too large to add.' }, 502);
    item = cleanItem(name, JSON.parse(text));
  } catch {
    item = null;
  }
  if (!item) return json({ error: 'reactbits.dev sent something that isn’t a component. Try again later.' }, 502);
  cache.set(name, item);
  return json(item);
}
