// /api/computer/*: the agent computer, page side of computer.appblips.com
// (AppBlips-Landing/workers/computer). The build agents use it to run npm only:
// install or remove packages (updating package-lock.json for real), run
// `npm run build` on an imported codebase, and look up package details. Used by
// every host (electron/main.js, server.js, the Vite dev server, android.js), so
// Fetch primitives only, like creditsApi.js.
//
//   GET  /api/computer              -> { available }
//   POST /api/computer/npm/install  { projectId, packageJson, packageLock, add, remove, dev }
//   POST /api/computer/npm/build    { projectId, files }
//   POST /api/computer/npm/inspect  { name, version }
//
// The only credential is a random per-install ID, made here on first use and
// kept in `tokens` ({ describe, keyFor, save, clear }, like the other
// connectors) so the page never sees it. It only keeps one install's limits
// apart from another's: IDs are free to make, so the Worker's per-network and
// daily caps are what bound abuse. This relay adds no limits of its own.
//
// `APPBLIPS_COMPUTER_ORIGIN` points it at a self-hosted or local Worker;
// `APPBLIPS_COMPUTER=off` switches the feature off for the whole host.
import { isForeignOrigin } from './chatProxy.js';

const DEFAULT_ORIGIN = 'https://computer.appblips.com';
const ID_NAME = 'install';
// Matches the Worker: the biggest body is a build upload, 8 MB of text.
const MAX_BODY_BYTES = 9 * 1024 * 1024;
const TIMEOUTS = { install: 90_000, build: 160_000, inspect: 20_000 };

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

const UNAVAILABLE = 'The agent computer isn’t reachable right now. Continue without it.';

export const isComputerOff = (env) => String(env?.APPBLIPS_COMPUTER || '').toLowerCase() === 'off';

const originOf = (env) => String(env?.APPBLIPS_COMPUTER_ORIGIN || DEFAULT_ORIGIN).replace(/\/+$/, '');

const randomId = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

async function installId(tokens) {
  const { hasKey } = tokens.describe();
  const saved = hasKey ? tokens.keyFor(ID_NAME) : '';
  if (/^[a-f0-9]{64}$/.test(saved)) return saved;
  const id = randomId();
  await tokens.save(ID_NAME, id);
  return id;
}

async function relay(action, body, env, tokens, fetchImpl) {
  const id = await installId(tokens);
  let response;
  try {
    response = await fetchImpl(`${originOf(env)}/v1/npm/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-appblips-install': id },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUTS[action]),
    });
  } catch {
    return json({ error: UNAVAILABLE, unavailable: true }, 502);
  }
  let answer = null;
  try {
    answer = await response.json();
  } catch { /* not JSON: handled below */ }
  if (!answer || typeof answer !== 'object') return json({ error: UNAVAILABLE, unavailable: true }, 502);

  if (response.status === 429) {
    const retryAfter = Number(answer.retryAfter) > 0 ? Math.ceil(Number(answer.retryAfter)) : 3600;
    return json({ error: 'The agent computer limit was reached.', limited: true, retryAfter }, 429);
  }
  // 503: switched off by the operator or the daily cap for everyone was hit.
  if (response.status === 503) return json({ error: 'The agent computer is switched off for now.', unavailable: true }, 503);
  if (response.status >= 500) return json({ error: UNAVAILABLE, unavailable: true }, 502);
  if (!response.ok) return json({ error: typeof answer.error === 'string' ? answer.error.slice(0, 300) : 'The request was refused.' }, response.status);
  return json(answer);
}

export async function handleComputerApi(request, env, tokens, { fetch: fetchImpl = globalThis.fetch } = {}) {
  // Only AppBlips' own page may use the computer. A JSON body also forces a
  // CORS preflight, which other sites can't pass.
  if (isForeignOrigin(request, env)) return json({ error: 'Not allowed.' }, 403);
  const path = new URL(request.url).pathname.replace(/\/+$/, '');

  if (path === '/api/computer') {
    if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
    return json({ available: !isComputerOff(env) });
  }
  const action = { '/api/computer/npm/install': 'install', '/api/computer/npm/build': 'build', '/api/computer/npm/inspect': 'inspect' }[path];
  if (!action) return json({ error: 'Not found.' }, 404);
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (isComputerOff(env)) return json({ error: 'The agent computer is switched off on this host.', unavailable: true }, 503);
  if (!/^application\/json\b/i.test(request.headers.get('content-type') || '')) return json({ error: 'Invalid request.' }, 400);

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: 'The request is too large.' }, 413);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid request.' }, 400);
  return relay(action, body, env, tokens, fetchImpl);
}
