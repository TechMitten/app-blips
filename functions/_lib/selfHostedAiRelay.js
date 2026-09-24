import { consumeToken } from './rateLimit.js';
import { resolveAppProvider, applyProviderSettings, appAiLimit } from './providers.js';

const MAX_BODY_BYTES = 256 * 1024;
const MAX_MESSAGES = 64;

const json = (body, status, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', ...headers },
});
const failure = (code, status, message, headers) => json({ error: { code, message } }, status, headers);

const chatUrl = (base) => {
  const clean = String(base || '').trim().replace(/\/+$/, '');
  return /\/chat\/completions$/i.test(clean) ? clean : `${clean}/chat/completions`;
};

const originHeaders = (request, env) => {
  const origin = request.headers.get('origin');
  if (!origin) return { allowed: true, headers: {} };
  let ownOrigin = '';
  try { ownOrigin = new URL(request.url).origin; } catch { /* invalid request URL */ }
  const allowlist = String(env.APPBLIPS_APP_AI_ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (origin !== ownOrigin && !allowlist.includes(origin)) return { allowed: false, headers: {} };
  return {
    allowed: true,
    headers: origin === ownOrigin ? {} : {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      Vary: 'Origin',
    },
  };
};

export async function handleSelfHostedAiChat(request, env) {
  if (env.SELF_HOSTED_MODE === 'false' || String(env.APPBLIPS_GENERATED_AI_MODE || 'relay').toLowerCase() === 'byok') {
    return failure('unauthorized', 403, 'Self-hosted app AI relay is disabled.');
  }
  const cors = originHeaders(request, env);
  if (!cors.allowed) return failure('unauthorized', 403, 'Request origin is not allowed.');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors.headers });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors.headers });

  let raw;
  try { raw = await request.text(); } catch { return failure('payload_too_large', 413, 'Request payload is too large.', cors.headers); }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return failure('payload_too_large', 413, 'Request payload is too large.', cors.headers);
  }
  let payload;
  try { payload = JSON.parse(raw); } catch { return failure('invalid_request', 400, 'Invalid JSON body.', cors.headers); }
  const { messages, temperature, max_tokens, stream } = payload || {};
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > MAX_MESSAGES) {
    return failure('invalid_request', 400, 'A valid messages array is required.', cors.headers);
  }
  const provider = resolveAppProvider(env);
  if (provider.error) console.error('[app-ai] misconfigured:', provider.error);
  if (provider.error || provider.missing.length) {
    return failure('upstream_error', 502, 'App AI service is unavailable.', cors.headers);
  }

  const clientId = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const max = parseInt(env.APPBLIPS_APP_AI_RATE_LIMIT_MAX, 10) || 20;
  const windowSeconds = parseInt(env.APPBLIPS_APP_AI_RATE_LIMIT_WINDOW_SECONDS, 10) || 60;
  const rate = consumeToken(`self-hosted-app:${clientId}`, { max, windowSeconds });
  if (!rate.allowed) {
    return failure('rate_limited', 429, 'Rate limit exceeded.', { ...cors.headers, 'Retry-After': String(rate.retryAfter) });
  }

  const cap = Math.max(1, parseInt(appAiLimit(env, 'MAX_TOKENS'), 10) || 4096);
  const requestedMax = Number.isFinite(Number(max_tokens)) ? Math.max(1, Math.floor(Number(max_tokens))) : cap;
  const requestedTemperature = Number.parseFloat(temperature);
  const configuredTemperature = Number.parseFloat(appAiLimit(env, 'TEMPERATURE'));
  const safeMessages = messages.map((message) => ({
    role: ['system', 'user', 'assistant'].includes(message?.role) ? message.role : 'user',
    content: typeof message?.content === 'string' ? message.content : String(message?.content ?? ''),
  }));

  const bodyObj = {
    model: provider.model,
    messages: safeMessages,
    temperature: Number.isFinite(requestedTemperature)
      ? Math.min(2, Math.max(0, requestedTemperature))
      : (Number.isFinite(configuredTemperature) ? configuredTemperature : 0.2),
    max_tokens: Math.min(cap, requestedMax),
    stream: Boolean(stream),
  };
  // Operator-set effort and provider request format (see providers.js).
  applyProviderSettings(bodyObj, provider, { effort: appAiLimit(env, 'REASONING_EFFORT') || 'none' });

  let upstream;
  try {
    upstream = await fetch(chatUrl(provider.baseUrl), {
      method: 'POST',
      headers: { authorization: `Bearer ${provider.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(bodyObj),
    });
  } catch { return failure('upstream_error', 502, 'App AI request failed.', cors.headers); }
  if (!upstream.ok) return failure('upstream_error', 502, 'App AI request failed.', cors.headers);
  return new Response(upstream.body, {
    status: 200,
    headers: {
      ...cors.headers,
      'content-type': upstream.headers.get('content-type') || (stream ? 'text/event-stream' : 'application/json'),
    },
  });
}
