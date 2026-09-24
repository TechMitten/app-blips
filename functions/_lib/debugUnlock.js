// POST /api/debug-unlock -- gate for the hidden raw-LLM-log panel.
//
// The PIN lives only in the server-side APPBLIPS_DEBUG_PIN env var (never
// VITE_-prefixed, so it cannot reach the client bundle). Unset means the
// feature does not exist: the route 404s. The raw model output is already in
// the browser by the time the panel could show it, so this gates the UI and
// log retention, not data secrecy -- which is why it stays this small.
import { consumeToken } from './rateLimit.js';

const MAX_BODY_BYTES = 1024;
const encoder = new TextEncoder();

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });

const clientIp = (request) =>
  request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

// Compare fixed-length digests rather than the raw strings, so neither the
// PIN's length nor a matching prefix leaks through timing.
const digest = async (value) => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));

const digestsEqual = (a, b) => {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ (b[i] ?? 0);
  return diff === 0;
};

export const handleDebugUnlock = async (request, env) => {
  const pin = env.APPBLIPS_DEBUG_PIN;
  if (!pin) return json({ ok: false }, 404);
  if (request.method !== 'POST') return json({ ok: false }, 405, { allow: 'POST' });

  // Consumed before the body is read, so junk requests cost an attempt too.
  const rate = consumeToken(`debug-unlock:${clientIp(request)}`, {
    max: parseInt(env.APPBLIPS_DEBUG_PIN_RATE_LIMIT_MAX, 10) || 5,
    windowSeconds: parseInt(env.APPBLIPS_DEBUG_PIN_RATE_LIMIT_WINDOW_SECONDS, 10) || 300,
  });
  if (!rate.allowed) return json({ ok: false, error: 'rate_limited' }, 429, { 'retry-after': String(rate.retryAfter) });

  const raw = await request.text();
  if (encoder.encode(raw).length > MAX_BODY_BYTES) return json({ ok: false }, 413);

  let submitted = '';
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.pin === 'string') submitted = parsed.pin;
  } catch {
    return json({ ok: false }, 400);
  }

  const ok = digestsEqual(await digest(submitted), await digest(String(pin)));
  return json({ ok });
};
