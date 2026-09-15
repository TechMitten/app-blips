import { consumeToken } from './rateLimit.js';
import { firebaseProjectId, getAppCheckToken } from './firebaseServer.js';
import { signSessionToken, verifySessionToken } from './aiSession.js';
import { verifyTurnstile } from './turnstile.js';

const MAX_BODY_BYTES = 256 * 1024;
const MAX_MESSAGES = 64;
const tokenCache = new Map();
const slugCache = new Map();

const json = (body, status, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', ...headers },
});

const errorResponse = (code, status, message, headers) => json({ error: { code, message } }, status, headers);

const runQueryUrl = (env) =>
  `https://firestore.googleapis.com/v1/projects/${firebaseProjectId(env)}/databases/(default)/documents:runQuery`;

const runDeploymentQuery = async (fieldPath, value, env) => {
  const headers = { 'content-type': 'application/json' };
  const appCheckToken = await getAppCheckToken(env);
  if (appCheckToken) headers['X-Firebase-AppCheck'] = appCheckToken;
  const response = await fetch(runQueryUrl(env), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'deployments' }],
        where: { fieldFilter: { field: { fieldPath }, op: 'EQUAL', value: { stringValue: value } } },
        limit: 1,
      },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`deployment lookup failed: ${response.status} ${detail.slice(0, 200)}`);
  }
  const rows = await response.json();
  return rows?.[0]?.document?.fields || null;
};

// Legacy path: the public static deployment token embedded in older deploys.
export const validateDeploymentToken = async (token, env) => {
  if (!token || typeof token !== 'string' || token.length > 128) return false;
  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.valid;

  const fields = await runDeploymentQuery('aiToken', token, env);
  const valid = Boolean(fields?.aiEnabled?.booleanValue && fields?.aiToken?.stringValue === token);
  tokenCache.set(token, { valid, expiresAt: Date.now() + 60_000 });
  return valid;
};

// Session path: resolve the deployment by its public slug. Cached (so
// revocation via `aiTokenGeneration` takes effect within ~60s without a
// Firestore read per request); pass { fresh: true } to bypass the cache.
export const fetchDeploymentBySlug = async (slug, env, { fresh = false } = {}) => {
  if (!slug || typeof slug !== 'string' || slug.length > 128) return null;
  if (!fresh) {
    const cached = slugCache.get(slug);
    if (cached && cached.expiresAt > Date.now()) return cached.fields;
  }
  const fields = await runDeploymentQuery('slug', slug, env);
  slugCache.set(slug, { fields, expiresAt: Date.now() + 60_000 });
  return fields;
};

const fieldInt = (field, fallback = 0) => {
  if (!field) return fallback;
  if (field.integerValue !== undefined) return Number(field.integerValue) || fallback;
  if (field.doubleValue !== undefined) return Math.trunc(Number(field.doubleValue)) || fallback;
  return fallback;
};

export const clearAiCachesForTesting = () => {
  tokenCache.clear();
  slugCache.clear();
};

const ownOrigin = (request) => {
  try { return new URL(request.url).origin; } catch { return ''; }
};

// Non-browser clients can omit or forge Origin, so this is a speed bump, not a
// boundary. It stops the laziest scripts; Turnstile is the real gate.
const originAllowed = (request, env) => {
  const origin = request.headers.get('origin');
  if (!origin) return String(env?.APPBLIPS_AI_REQUIRE_ORIGIN ?? 'true') === 'false';
  const own = ownOrigin(request);
  return Boolean(own) && origin === own;
};

const clientIp = (request) =>
  request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

const chatUrl = (base) => `${String(base).replace(/\/$/, '').replace(/\/chat\/completions$/, '')}/chat/completions`;

// Mints a short-lived, signed session token for an AI-enabled deployment.
// Optionally gated by Cloudflare Turnstile; when TURNSTILE_SECRET is set a
// valid browser token is required.
export async function handleAiSession(request, env) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!originAllowed(request, env)) return errorResponse('unauthorized', 403, 'Request origin is not allowed.');
  if (!env.APPBLIPS_SESSION_SECRET) {
    return errorResponse('configuration_required', 503, 'AI session tokens are not configured.');
  }

  let raw;
  try { raw = await request.text(); } catch { return errorResponse('payload_too_large', 413, 'Request payload is too large.'); }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return errorResponse('payload_too_large', 413, 'Request payload is too large.');
  }
  let payload;
  try { payload = JSON.parse(raw); } catch { return json({ error: { code: 'invalid_request', message: 'Invalid JSON body.' } }, 400); }
  const slug = typeof payload?.slug === 'string' ? payload.slug.trim() : '';
  if (!slug || slug.length > 128) {
    return json({ error: { code: 'invalid_request', message: 'A deployment slug is required.' } }, 400);
  }

  const ip = clientIp(request);
  const max = parseInt(env.APPBLIPS_AI_RATE_LIMIT_MAX, 10) || 20;
  const windowSeconds = parseInt(env.APPBLIPS_AI_RATE_LIMIT_WINDOW_SECONDS, 10) || 60;
  const rate = consumeToken(`session:${ip}`, { max, windowSeconds });
  if (!rate.allowed) {
    return errorResponse('rate_limited', 429, 'Rate limit exceeded.', { 'Retry-After': String(rate.retryAfter) });
  }

  const gate = await verifyTurnstile(payload?.turnstileToken, env, ip);
  if (gate.configured && !gate.success) {
    console.error('[ai-session] turnstile rejected:', (gate.errorCodes || []).join(','));
    return errorResponse('unauthorized', 403, 'Browser verification failed.');
  }

  let fields;
  try {
    // Fresh read: signing a token with a stale generation (cache up to 60s old,
    // e.g. right after a redeploy bumped it) would get it rejected at /ai/chat.
    fields = await fetchDeploymentBySlug(slug, env, { fresh: true });
  } catch (err) {
    console.error('[ai-session]', err?.message || err);
    return errorResponse('upstream_error', 502, 'Deployment validation failed.');
  }
  if (!fields || !fields.aiEnabled?.booleanValue) {
    console.error('[ai-session] mint rejected: deployment missing or AI disabled for slug');
    return errorResponse('unauthorized', 403, 'AI is not enabled for this app.');
  }

  const signed = await signSessionToken({ slug, gen: fieldInt(fields.aiTokenGeneration, 1) }, env);
  if (!signed) return errorResponse('configuration_required', 503, 'AI session tokens are not configured.');
  return json({ token: signed.token, expiresIn: signed.ttl, expiresAt: Date.now() + signed.ttl * 1000 }, 200);
}

export async function handleAiChat(request, env) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!originAllowed(request, env)) return errorResponse('unauthorized', 403, 'Request origin is not allowed.');

  let raw;
  try { raw = await request.text(); } catch { return errorResponse('payload_too_large', 413, 'Request payload is too large.'); }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return errorResponse('payload_too_large', 413, 'Request payload is too large.');
  }

  let payload;
  try { payload = JSON.parse(raw); } catch { return json({ error: { code: 'invalid_request', message: 'Invalid JSON body.' } }, 400); }
  const { token, messages, temperature, max_tokens, stream } = payload || {};
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > MAX_MESSAGES) {
    return json({ error: { code: 'invalid_request', message: 'A valid messages array is required.' } }, 400);
  }

  // Accept a short-lived session token first; fall back to the legacy public
  // deployment token unless APPBLIPS_AI_REQUIRE_SESSION=true.
  let rateKey;
  const session = await verifySessionToken(token, env);
  if (session) {
    let fields;
    try {
      fields = await fetchDeploymentBySlug(session.slug, env);
    } catch (err) {
      console.error('[ai-relay]', err?.message || err);
      return errorResponse('upstream_error', 502, 'Deployment validation failed.');
    }
    let enabled = Boolean(fields?.aiEnabled?.booleanValue);
    let generation = fieldInt(fields?.aiTokenGeneration, 1);
    if (!enabled || generation !== session.gen) {
      // A stale cache (e.g. right after a redeploy bumped the generation on
      // another isolate) must not strand freshly minted tokens -- re-check
      // against live Firestore once before rejecting.
      try {
        fields = await fetchDeploymentBySlug(session.slug, env, { fresh: true });
      } catch (err) {
        console.error('[ai-relay]', err?.message || err);
        return errorResponse('upstream_error', 502, 'Deployment validation failed.');
      }
      enabled = Boolean(fields?.aiEnabled?.booleanValue);
      generation = fieldInt(fields?.aiTokenGeneration, 1);
      if (!enabled || generation !== session.gen) {
        console.error('[ai-relay] session rejected: revoked generation or AI disabled');
        return errorResponse('unauthorized', 403, 'AI session is no longer valid.');
      }
    }
    rateKey = `chat:${session.slug}`;
  } else if (env.APPBLIPS_AI_REQUIRE_SESSION === 'true') {
    return errorResponse('unauthorized', 403, 'Invalid deployment token.');
  } else {
    let valid;
    try {
      valid = await validateDeploymentToken(token, env);
    } catch (err) {
      console.error('[ai-relay]', err?.message || err);
      return errorResponse('upstream_error', 502, 'Deployment validation failed.');
    }
    if (!valid) return errorResponse('unauthorized', 403, 'Invalid deployment token.');
    rateKey = `chat:${token}`;
  }

  const max = parseInt(env.APPBLIPS_AI_RATE_LIMIT_MAX, 10) || 20;
  const windowSeconds = parseInt(env.APPBLIPS_AI_RATE_LIMIT_WINDOW_SECONDS, 10) || 60;
  const rate = consumeToken(rateKey, { max, windowSeconds });
  if (!rate.allowed) return errorResponse('rate_limited', 429, 'Rate limit exceeded.', { 'Retry-After': String(rate.retryAfter) });

  // Second bucket per client IP, so one caller cannot drain a deployment's whole budget.
  const ipRate = consumeToken(`chat-ip:${clientIp(request)}`, { max, windowSeconds });
  if (!ipRate.allowed) return errorResponse('rate_limited', 429, 'Rate limit exceeded.', { 'Retry-After': String(ipRate.retryAfter) });

  const missingEnv = ['APPBLIPS_APP_LLM_BASE_URL', 'APPBLIPS_APP_LLM_API_KEY', 'APPBLIPS_APP_LLM_MODEL'].filter((key) => !env[key]);
  if (missingEnv.length) {
    console.error('[ai-relay] missing env:', missingEnv.join(', '));
    return errorResponse('upstream_error', 502, 'AI service is unavailable.');
  }

  const cap = Math.max(1, parseInt(env.APPBLIPS_APP_LLM_MAX_TOKENS, 10) || 4096);
  const requestedMax = Number.isFinite(Number(max_tokens)) ? Math.max(1, Math.floor(Number(max_tokens))) : cap;
  const configuredTemperature = Number.parseFloat(env.APPBLIPS_APP_LLM_TEMPERATURE);
  const requestedTemperature = Number.parseFloat(temperature);
  const finalTemperature = Number.isFinite(requestedTemperature)
    ? Math.min(2, Math.max(0, requestedTemperature))
    : (Number.isFinite(configuredTemperature) ? configuredTemperature : 0.2);
  const safeMessages = messages.map((message) => ({
    role: ['system', 'user', 'assistant'].includes(message?.role) ? message.role : 'user',
    content: typeof message?.content === 'string' ? message.content : String(message?.content ?? ''),
  }));

  const bodyObj = {
    model: env.APPBLIPS_APP_LLM_MODEL,
    messages: safeMessages,
    temperature: finalTemperature,
    max_tokens: Math.min(cap, requestedMax),
    stream: Boolean(stream),
  };
  const effort = env.APPBLIPS_APP_LLM_REASONING_EFFORT ?? 'none';
  if (effort === false || effort === 'none' || effort === 'off' || effort === 'disabled') {
    bodyObj.reasoning_effort = 'none';
  } else if (effort) {
    bodyObj.reasoning_effort = effort;
  }

  let upstream;
  try {
    upstream = await fetch(chatUrl(env.APPBLIPS_APP_LLM_BASE_URL), {
      method: 'POST',
      headers: { authorization: `Bearer ${env.APPBLIPS_APP_LLM_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(bodyObj),
    });
  } catch (err) {
    console.error('[ai-relay] upstream fetch failed:', err?.message || err);
    return errorResponse('upstream_error', 502, 'AI service request failed.');
  }
  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    console.error('[ai-relay] upstream', upstream.status, detail.slice(0, 300));
    return errorResponse('upstream_error', 502, 'AI service request failed.');
  }
  return new Response(upstream.body, {
    status: 200,
    headers: { 'content-type': upstream.headers.get('content-type') || (stream ? 'text/event-stream' : 'application/json') },
  });
}
