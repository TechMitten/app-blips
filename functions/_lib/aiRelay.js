import { consumeToken } from './rateLimit.js';
import { firebaseProjectId, getAppCheckToken } from './firebaseServer.js';

const MAX_BODY_BYTES = 256 * 1024;
const MAX_MESSAGES = 64;
const deploymentCache = new Map();

const json = (body, status, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', ...headers },
});

const errorResponse = (code, status, message, headers) => json({ error: { code, message } }, status, headers);

export const validateDeploymentToken = async (token, env) => {
  if (!token || typeof token !== 'string' || token.length > 128) return false;
  const cached = deploymentCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.valid;

  const headers = { 'content-type': 'application/json' };
  const appCheckToken = await getAppCheckToken(env);
  if (appCheckToken) headers['X-Firebase-AppCheck'] = appCheckToken;
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${firebaseProjectId(env)}/databases/(default)/documents:runQuery`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'deployments' }],
          where: { fieldFilter: { field: { fieldPath: 'aiToken' }, op: 'EQUAL', value: { stringValue: token } } },
          limit: 1,
        },
      }),
    },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`deployment lookup failed: ${response.status} ${detail.slice(0, 200)}`);
  }
  const rows = await response.json();
  const fields = rows?.[0]?.document?.fields;
  const valid = Boolean(fields?.aiEnabled?.booleanValue && fields?.aiToken?.stringValue === token);
  deploymentCache.set(token, { valid, expiresAt: Date.now() + 60_000 });
  return valid;
};

const sameOrigin = (request) => {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try { return origin === new URL(request.url).origin; } catch { return false; }
};

const chatUrl = (base) => `${String(base).replace(/\/$/, '').replace(/\/chat\/completions$/, '')}/chat/completions`;

export async function handleAiChat(request, env) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!sameOrigin(request)) return errorResponse('unauthorized', 403, 'Request origin is not allowed.');

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

  let valid;
  try {
    valid = await validateDeploymentToken(token, env);
  } catch (err) {
    console.error('[ai-relay]', err?.message || err);
    return errorResponse('upstream_error', 502, 'Deployment validation failed.');
  }
  if (!valid) return errorResponse('unauthorized', 403, 'Invalid deployment token.');

  const max = parseInt(env.APPBLIPS_AI_RATE_LIMIT_MAX, 10) || 20;
  const windowSeconds = parseInt(env.APPBLIPS_AI_RATE_LIMIT_WINDOW_SECONDS, 10) || 60;
  const rate = consumeToken(`chat:${token}`, { max, windowSeconds });
  if (!rate.allowed) return errorResponse('rate_limited', 429, 'Rate limit exceeded.', { 'Retry-After': String(rate.retryAfter) });

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
