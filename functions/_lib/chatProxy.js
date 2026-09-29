// Shared LLM proxy handler. Written with only Fetch API primitives (Request /
// Response / fetch) so the same code runs unmodified as a Cloudflare Pages
// Function in production and as Vite dev-server middleware locally (both
// environments expose these as globals) -- one implementation, no drift
// between dev and prod behavior.
//
// The point of this proxy: the real base URL / API key / model / tuning
// knobs live only in server-side env vars (APPBLIPS_LLM_*, no VITE_ prefix), so
// they never reach the client bundle. The browser only ever talks to this
// app's own origin at POST /api/chat.
//
// Optionally, a user can pick their own provider in Settings → AI; the client
// then sends `user_provider: { id, apiKey, model }` with each request and it
// replaces the env provider for that request only. Presets only (see
// resolveUserProvider): the endpoint always comes from the preset. The key is
// used for the upstream call and never stored or logged here.
//
// This endpoint is a public URL though -- without a check of its own, anyone
// who finds it could call it directly (bypassing the app's sign-in gate,
// which is UI-only) and spend the LLM budget behind the configured provider key. So,
// in hosted mode (SELF_HOSTED_MODE=false), every request must carry a valid
// Supabase access token, verified against Supabase itself (not just "a token was
// present"). Self-hosted mode is the default (SELF_HOSTED_MODE unset or
// anything other than "false"): there's no Supabase project to verify
// against, so every request is treated as coming from the single local user,
// on the assumption that self-hosters put their own access control (network
// restrictions, a reverse-proxy auth layer, etc.) in front of this endpoint
// if they expose it beyond localhost.

import { wrapWithTokenTracking } from './trackTokens.js';
import { resolveProvider, resolveUserProvider, applyProviderSettings, providerLabel } from './providers.js';
import { supabaseUrl, supabaseHeaders, supabasePublishableKey } from './supabaseServer.js';

const toChatCompletionsUrl = (baseUrl) => {
  const trimmed = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /\/chat\/completions$/.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
};

export const authorize = async (request, env) => {
  if (env.SELF_HOSTED_MODE !== 'false') return { id: 'local-user' };

  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const res = await fetch(`${supabaseUrl(env)}/auth/v1/user`, {
      headers: supabaseHeaders(env, { token }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.id ? { id: data.id } : null;
  } catch {
    return null;
  }
};

const rateLimitMap = new Map();

const checkRateLimit = async (userId, env) => {
  const max = parseInt(env.APPBLIPS_CHAT_RATE_LIMIT_MAX, 10) || 60;
  const windowSeconds = parseInt(env.APPBLIPS_CHAT_RATE_LIMIT_WINDOW_SECONDS, 10) || 300;
  const now = Date.now();
  const windowMs = windowSeconds * 1000;

  let record = rateLimitMap.get(userId);
  if (!record || now - record.startTime > windowMs) {
    record = { startTime: now, count: 1 };
    rateLimitMap.set(userId, record);

    // Evict stale records when cache grows
    if (rateLimitMap.size > 1000) {
      for (const [key, val] of rateLimitMap.entries()) {
        if (now - val.startTime > windowMs) rateLimitMap.delete(key);
      }
    }
    return { allowed: true, windowSeconds };
  }

  record.count += 1;
  if (record.count > max) {
    const remainingSeconds = Math.max(1, Math.ceil((record.startTime + windowMs - now) / 1000));
    return { allowed: false, windowSeconds: remainingSeconds };
  }

  return { allowed: true, windowSeconds };
};

// --- Hosted-mode request hardening -------------------------------------
// Only applied when SELF_HOSTED_MODE=false. Self-hosters keep the transparent
// relay behaviour. The client is authenticated but not trusted: it must not be
// able to send arbitrary tools, oversized bodies, or an unbounded output cap.
const ALLOWED_TOOL_NAMES = new Set([
  'apply_surgical_edits',
  'ask_clarifying_questions',
  'view_code',
  'list_sections',
  'create_page',
  'delete_page',
  'list_pages',
]);
const ALLOWED_ROLES = new Set(['system', 'user', 'assistant', 'tool']);
const ALLOWED_EFFORTS = new Set(['none', 'off', 'disabled', 'minimal', 'low', 'medium', 'high']);
const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_MESSAGES = 100;
const DEFAULT_HOSTED_MAX_TOKENS = 32768;
// Ask-mode answers are prose, not app code, so they get their own output cap
// (APPBLIPS_LLM_ASK_MAX_TOKENS) that never falls back to the builder's
// APPBLIPS_LLM_MAX_TOKENS. Sized to leave headroom for reasoning tokens, which
// count toward the limit on thinking models.
const DEFAULT_ASK_MAX_TOKENS = 8192;

const isHostedMode = (env) => env.SELF_HOSTED_MODE === 'false';

const positiveInt = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const badRequest = (error, status = 400) => new Response(JSON.stringify({ error }), {
  status,
  headers: { 'content-type': 'application/json' },
});

// Returns an error string, or null when the payload shape is acceptable.
const validateHostedPayload = (payload, env) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'Invalid request body.';
  const { messages, tools, tool_choice, reasoning_effort } = payload;

  const maxMessages = positiveInt(env.APPBLIPS_CHAT_MAX_MESSAGES, DEFAULT_MAX_MESSAGES);
  if (!Array.isArray(messages) || messages.length === 0) return 'messages must be a non-empty array.';
  if (messages.length > maxMessages) return 'Too many messages in request.';
  for (const m of messages) {
    if (!m || typeof m !== 'object' || !ALLOWED_ROLES.has(m.role)) return 'Invalid message role.';
    if (m.content != null && typeof m.content !== 'string') {
      if (!Array.isArray(m.content)) return 'Invalid message content.';
      for (const part of m.content) {
        if (!part || (part.type !== 'text' && part.type !== 'image_url')) return 'Invalid message content part.';
      }
    }
  }

  if (tools != null) {
    if (!Array.isArray(tools) || tools.length > ALLOWED_TOOL_NAMES.size) return 'Invalid tools.';
    for (const t of tools) {
      if (t?.type !== 'function' || !ALLOWED_TOOL_NAMES.has(t?.function?.name)) return 'Unsupported tool.';
    }
  }
  if (tool_choice != null && typeof tool_choice === 'object') {
    if (tool_choice.type !== 'function' || !ALLOWED_TOOL_NAMES.has(tool_choice.function?.name)) {
      return 'Unsupported tool_choice.';
    }
  } else if (tool_choice != null && !['auto', 'required', 'none'].includes(tool_choice)) {
    return 'Unsupported tool_choice.';
  }

  if (reasoning_effort != null && reasoning_effort !== false && !ALLOWED_EFFORTS.has(reasoning_effort)) {
    return 'Unsupported reasoning_effort.';
  }
  const up = payload.user_provider;
  if (up != null) {
    if (typeof up !== 'object' || Array.isArray(up)) return 'Invalid user_provider.';
    for (const field of ['id', 'apiKey', 'model']) {
      if (typeof up[field] !== 'string') return 'Invalid user_provider.';
    }
  }
  return null;
};

// Reads the body with a hard byte cap (Content-Length can be absent or lie).
const readJsonWithLimit = async (request, maxBytes) => {
  const declared = parseInt(request.headers.get('content-length') || '', 10);
  if (Number.isFinite(declared) && declared > maxBytes) return { tooLarge: true };
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) return { tooLarge: true };
  try {
    return { payload: JSON.parse(text) };
  } catch {
    return { invalid: true };
  }
};

// Misconfiguration is the operator's problem. Self-hosters (who are the
// operator) get the exact fix; in hosted mode the signed-in visitor gets a
// generic message and the details go to the server log instead of the client.
const configError = (env, detail) => {
  const hosted = isHostedMode(env);
  if (hosted) console.error(`[chat] ${detail}`);
  return new Response(
    JSON.stringify({
      error: hosted
        ? 'The AI service is temporarily unavailable. Please try again later.'
        : `AppBlips isn't set up yet. ${detail} Or set your own provider in Settings → AI.`,
    }),
    { status: 500, headers: { 'content-type': 'application/json' } },
  );
};

// The provider for this request: the user's own (Settings → AI) when the
// client sent one, otherwise the env provider. Returns { provider } or
// { response } (an error to send back).
const pickProvider = (env, payload) => {
  if (payload?.user_provider != null) {
    const provider = resolveUserProvider(payload.user_provider);
    if (provider.error) return { response: badRequest(`Your AI provider settings are incomplete: ${provider.error}`) };
    return { provider };
  }
  const provider = resolveProvider(env, 'APPBLIPS_LLM');
  if (provider.error) return { response: configError(env, provider.error) };
  if (provider.missing.length) {
    return {
      response: configError(
        env,
        `Missing configuration: ${provider.missing.join(', ')}. Add ${provider.missing.length > 1 ? 'them' : 'it'} to your .env (or your host's environment variables) and restart.`,
      ),
    };
  }
  return { provider };
};

// A provider rejecting the user's own key must not reach the client as a 401,
// which it reads as an expired AppBlips session.
const rejectedUserKey = (provider) => badRequest(`${providerLabel(provider.id)} rejected the API key in Settings → AI.`);

export async function handleChatProxy(request, env, waitUntil) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // A Supabase publishable key is needed to verify tokens in hosted mode.
  if (isHostedMode(env) && !supabasePublishableKey(env)) {
    return configError(env, 'Missing configuration: SUPABASE_PUBLISHABLE_KEY.');
  }

  const user = await authorize(request, env);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Sign in required.' }), {
      status: 401, statusText: "ProxyAuthFailed",
      headers: { 'content-type': 'application/json' },
    });
  }

  const { allowed, windowSeconds } = await checkRateLimit(user.id, env);
  if (!allowed) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please slow down and try again shortly.' }), {
      status: 429,
      headers: { 'content-type': 'application/json', 'Retry-After': String(windowSeconds) },
    });
  }

  const hosted = isHostedMode(env);

  let payload;
  if (hosted) {
    const maxBytes = positiveInt(env.APPBLIPS_CHAT_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES);
    const parsed = await readJsonWithLimit(request, maxBytes);
    if (parsed.tooLarge) return badRequest('Request body too large.', 413);
    if (parsed.invalid) return badRequest('Invalid JSON body.');
    payload = parsed.payload;
    const invalid = validateHostedPayload(payload, env);
    if (invalid) return badRequest(invalid);
  } else {
    try {
      payload = await request.json();
    } catch {
      return badRequest('Invalid JSON body.');
    }
  }

  const picked = pickProvider(env, payload);
  if (picked.response) return picked.response;
  const { provider } = picked;
  const url = toChatCompletionsUrl(provider.baseUrl);
  const apiKey = provider.apiKey;
  const model = provider.model;

  const { messages, tools, tool_choice, stream, reasoning_effort, auto_fix, ask } = payload;

  let temperature = 0.2;
  if (auto_fix === true) {
    // Error auto-fix requests (runtime or syntax) must be deterministic, so
    // pin temperature to 0.0 regardless of APPBLIPS_LLM_TEMPERATURE.
    temperature = 0;
  } else if (env.APPBLIPS_LLM_TEMPERATURE !== undefined && env.APPBLIPS_LLM_TEMPERATURE !== '') {
    const parsedTemperature = parseFloat(env.APPBLIPS_LLM_TEMPERATURE);
    if (!isNaN(parsedTemperature)) temperature = parsedTemperature;
  }

  const bodyObj = {
    model,
    stream: !!stream,
    messages,
    temperature,
  };

  if (bodyObj.stream) {
    bodyObj.stream_options = { include_usage: true };
  }

  if (ask === true) {
    const parsedAskMax = parseInt(env.APPBLIPS_LLM_ASK_MAX_TOKENS, 10);
    bodyObj.max_tokens = parsedAskMax > 0 ? parsedAskMax : DEFAULT_ASK_MAX_TOKENS;
  } else {
    if (env.APPBLIPS_LLM_MAX_TOKENS) {
      const parsedMax = parseInt(env.APPBLIPS_LLM_MAX_TOKENS, 10);
      if (!isNaN(parsedMax)) bodyObj.max_tokens = parsedMax;
    }
    // Hosted mode always bounds output so an unset env var can't mean "unlimited".
    if (hosted && !bodyObj.max_tokens) bodyObj.max_tokens = DEFAULT_HOSTED_MAX_TOKENS;
  }

  if (tools) bodyObj.tools = tools;
  if (tool_choice) bodyObj.tool_choice = tool_choice;

  // Reasoning is a per-user setting sent by the client ('none' when omitted).
  // applyProviderSettings writes it in the configured provider's format (see
  // providers.js), drops stream_options where unsupported, and relaxes forced
  // tool choices the provider would reject -- the refinement loop already
  // nudges the model if 'auto' returns no tool call.
  applyProviderSettings(bodyObj, provider, { effort: reasoning_effort ?? 'none' });

  let upstream;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bodyObj),
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Failed to reach LLM endpoint: ${err.message}` }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (provider.userSupplied && (upstream.status === 401 || upstream.status === 403)) {
    upstream.body?.cancel().catch(() => {});
    return rejectedUserKey(provider);
  }

  return wrapWithTokenTracking(env, upstream, bodyObj, { uid: user.id, kind: 'builder' }, waitUntil);
}
