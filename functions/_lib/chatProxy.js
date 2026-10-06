// Shared LLM proxy handler. Written with only Fetch API primitives (Request /
// Response / fetch) so the same code runs unmodified as a Cloudflare Pages
// Function in production and as Vite dev-server middleware locally (both
// environments expose these as globals) -- one implementation, no drift
// between dev and prod behavior.
//
// The point of this proxy: the real base URL / API key / model / tuning
// knobs live only in server-side env vars (OPENAI_*, no VITE_ prefix), so
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
// in a multi-user instance (Supabase configured), every request must carry a
// valid Supabase access token, verified against Supabase itself (not just "a
// token was present"). Without Supabase, AppBlips is a single local user, so
// every request is treated as coming from that user, on the assumption that
// operators put their own access control (network restrictions, a reverse-proxy
// auth layer, etc.) in front of this endpoint if they expose it beyond localhost.

import { wrapWithTokenTracking, estimateInputTokens } from './trackTokens.js';
import { trackApiUsage } from './usageTracking.js';
import { resolveProvider, resolveUserProvider, applyProviderSettings, providerLabel, llmEnv } from './providers.js';
import { supabaseUrl, supabaseHeaders, supabasePublishableKey, supabaseConfigured } from './supabaseServer.js';
import { billingAppliesTo, fetchBillingStatus, claimPrompt, releasePrompt, holdAllowance } from './billing.js';
import { promptPassesEnabled, signPromptPass, verifyPromptPass } from './promptPass.js';
import { planById, checkAllowance, checkPrompts, limitMessage } from './plans.js';

const toChatCompletionsUrl = (baseUrl) => {
  const trimmed = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /\/chat\/completions$/.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
};

export const authorize = async (request, env) => {
  if (!supabaseConfigured(env)) return { id: 'local-user' };

  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const res = await fetch(`${supabaseUrl(env)}/auth/v1/user`, {
      headers: supabaseHeaders(env, { token }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.id ? { id: data.id, email: data.email || null } : null;
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

// --- Multi-user request hardening ---------------------------------------
// Only applied when Supabase is configured. Single-user instances keep the
// transparent relay behaviour. The client is authenticated but not trusted: it
// must not be able to send arbitrary tools, oversized bodies, or an unbounded
// output cap.
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
const DEFAULT_MULTIUSER_MAX_TOKENS = 32768;

// Ask-mode answers are prose, not app code, so they get their own output cap
// (OPENAI_LLM_ASK_MAX_TOKENS) that never falls back to the builder's
// OPENAI_LLM_MAX_TOKENS. Sized to leave headroom for reasoning tokens, which
// count toward the limit on thinking models.
const DEFAULT_ASK_MAX_TOKENS = 8192;

// The output cap a request is sent with (see handleChatProxy). null = none,
// which only a single-user instance allows.
const outputCap = (env, payload, multiUser) => {
  if (payload.ask === true) {
    const parsedAskMax = parseInt(llmEnv(env, 'ASK_MAX_TOKENS'), 10);
    return parsedAskMax > 0 ? parsedAskMax : DEFAULT_ASK_MAX_TOKENS;
  }
  const parsedMax = parseInt(llmEnv(env, 'MAX_TOKENS'), 10);
  if (parsedMax > 0) return parsedMax;
  // Multi-user mode always bounds output so an unset env var can't mean "unlimited".
  return multiUser ? DEFAULT_MULTIUSER_MAX_TOKENS : null;
};

// Multi-user mode: the operator configured a Supabase project, so every request
// must carry a valid Supabase access token and the hardening/rate-limit below
// applies. Without Supabase, AppBlips is a single local user and stays a
// transparent relay.
const isMultiUser = (env) => supabaseConfigured(env);

const positiveInt = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const badRequest = (error, status = 400) => new Response(JSON.stringify({ error }), {
  status,
  headers: { 'content-type': 'application/json' },
});

// Returns an error string, or null when the payload shape is acceptable.
const validateMultiUserPayload = (payload, env) => {
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

// Misconfiguration is the operator's problem. Single-user operators (who are
// the operator) get the exact fix; in a multi-user instance the signed-in
// visitor gets a generic message and the details go to the server log instead
// of the client.
const configError = (env, detail) => {
  const multiUser = isMultiUser(env);
  if (multiUser) console.error(`[chat] ${detail}`);
  return new Response(
    JSON.stringify({
      error: multiUser
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

// A single-user instance has no sign-in, so a browser may call /api/chat only
// from AppBlips' own page. Browsers label every cross-site POST with Origin --
// including "simple" text/plain requests that skip the CORS preflight, which
// any web page, or a sandboxed generated app (Origin "null"), could otherwise
// send to spend the configured key without reading the reply. A request with
// no Origin is not a browser on another site (curl, a local script) and still
// passes. Own origin is built from protocol + host rather than URL.origin,
// which is "null" for the desktop app's appblips:// scheme. A multi-user
// instance needs none of this: its bearer token can't ride along on a
// cross-site request.
export const isForeignOrigin = (request, env) => {
  const origin = request.headers.get('origin');
  if (origin === null) return false;
  let own = '';
  try {
    const url = new URL(request.url);
    own = `${url.protocol}//${url.host}`;
  } catch { /* invalid request URL: nothing matches */ }
  if (own && origin === own) return false;
  const allowed = String(env.APPBLIPS_CHAT_ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
  return !allowed.includes(origin);
};

// The human-readable part of an upstream error body (OpenAI-style
// { error: { message } }, or a plain string), capped for display.
const upstreamErrorMessage = async (upstream) => {
  let text = '';
  try { text = await upstream.text(); } catch { return ''; }
  let message = text;
  try {
    const body = JSON.parse(text);
    const err = body?.error ?? body;
    message = typeof err === 'string' ? err : err?.message || body?.message || text;
  } catch { /* not JSON: use the text */ }
  return String(message).replace(/\s+/g, ' ').trim().slice(0, 300);
};

// A provider rejecting the user's own key must not reach the client as a 401,
// which it reads as an expired AppBlips session.
const rejectedUserKey = (provider) => badRequest(`${providerLabel(provider.id)} rejected the API key in Settings → AI.`);

const hasImageContent = (messages) => Array.isArray(messages) && messages.some(
  (m) => Array.isArray(m?.content) && m.content.some((part) => part?.type === 'image_url'),
);

// Plan enforcement when this instance bills (billing.js). Requests on the
// user's own key (Settings → AI) spend nothing of ours, so they skip it.
// Returns { response } to refuse, or { plan } (null when billing is off),
// plus `pass` (send back as the x-appblips-prompt-pass header), `claimed` (a
// daily prompt was taken) and `reservation` (tokens held against the
// allowance, settled when the response ends; see trackTokens.js).
// If a usage read itself fails the request goes through: auth already
// reached Supabase, and a hiccup there shouldn't stop people building.
const checkPlan = async (env, user, payload) => {
  if (!billingAppliesTo(env, user) || payload?.user_provider != null) return { plan: null };
  const status = await fetchBillingStatus(env, user.id);
  if (!status) return { plan: null };
  const plan = planById(status.plan);
  const refuse = (check) => ({
    response: new Response(JSON.stringify({
      error: limitMessage(plan.id, check),
      code: 'limit_reached',
      plan: plan.id,
      scope: check.scope,
      resetsAt: check.resetsAt.toISOString(),
    }), { status: 402, headers: { 'content-type': 'application/json' } }),
  });

  if (!plan.images && hasImageContent(payload.messages)) {
    return {
      response: new Response(JSON.stringify({
        error: 'Image attachments are part of Plus and Pro. Upgrade to attach images.',
        code: 'upgrade_required',
        plan: plan.id,
      }), { status: 403, headers: { 'content-type': 'application/json' } }),
    };
  }

  // A build is many requests: the first is held to the allowance and gets a
  // signed pass, and the rest send it back to be treated as follow-ups -- one
  // prompt, and allowed into the build overdraft (plans.js). Without a valid
  // pass, a request marked `continuing` is a new one. With no signing secret
  // configured, the client's `continuing` mark is trusted as before.
  const followUp = payload.continuing === true
    && (!promptPassesEnabled(env) || await verifyPromptPass(payload.prompt_pass, user.id, env));
  const check = checkAllowance(status, { continuing: followUp });
  if (!check.allowed) return refuse(check);

  // Daily prompt limit: a Build or Ask message is claimed on its first
  // request. Automatic repairs (auto_fix) never cost one.
  let claimed = false;
  if (plan.dailyPrompts && !followUp && payload.auto_fix !== true) {
    const result = await claimPrompt(env, user.id, plan.dailyPrompts);
    if (result === false) return refuse(checkPrompts({ plan: plan.id, today_prompts: plan.dailyPrompts }));
    claimed = result === true;
  }

  // Hold an estimate against the allowance before spending anything; the
  // check above alone lets a burst of simultaneous requests all through.
  const input = estimateInputTokens(payload.messages, payload.tools);
  const held = await holdAllowance(env, user.id, status, {
    continuing: followUp, input, amount: input + (outputCap(env, payload, true) || 0), kind: 'builder',
  });
  if (held.refused) {
    if (claimed) await releasePrompt(env, user.id);
    return refuse(held.refused);
  }

  return { plan, pass: await signPromptPass(user.id, env), claimed, reservation: held.reservation };
};

// The configured model, or a role-specific one: OPENAI_LLM_VISION_MODEL for
// requests carrying an image, OPENAI_LLM_ASK_MODEL for Ask-mode chat (paid
// plans only when billing is on). Never applied to the user's own provider,
// whose model is theirs to choose.
const routeModel = (env, provider, payload, plan) => {
  if (provider.userSupplied) return provider.model;
  if (hasImageContent(payload.messages)) return llmEnv(env, 'VISION_MODEL') || provider.model;
  if (payload.ask === true && (!plan || plan.premiumChat)) return llmEnv(env, 'ASK_MODEL') || provider.model;
  return provider.model;
};

export async function handleChatProxy(request, env, waitUntil) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  if (!isMultiUser(env) && isForeignOrigin(request, env)) {
    return new Response(JSON.stringify({ error: 'Requests from other sites are not allowed.' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  // A Supabase publishable key is needed to verify tokens in a multi-user instance.
  if (isMultiUser(env) && !supabasePublishableKey(env)) {
    return configError(env, 'Missing configuration: SUPABASE_PUBLISHABLE_KEY.');
  }

  const user = await authorize(request, env);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Sign in required.' }), {
      status: 401, statusText: "ProxyAuthFailed",
      headers: { 'content-type': 'application/json' },
    });
  }

  const multiUser = isMultiUser(env);

  // Multi-user only: there every request spends the operator's key. A single-user
  // operator spends their own key, so their own copy doesn't throttle them; only
  // their provider's limits apply.
  if (multiUser) {
    const { allowed, windowSeconds } = await checkRateLimit(user.id, env);
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please slow down and try again shortly.' }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'Retry-After': String(windowSeconds) },
      });
    }
  }

  let payload;
  if (multiUser) {
    const maxBytes = positiveInt(env.APPBLIPS_CHAT_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES);
    const parsed = await readJsonWithLimit(request, maxBytes);
    if (parsed.tooLarge) return badRequest('Request body too large.', 413);
    if (parsed.invalid) return badRequest('Invalid JSON body.');
    payload = parsed.payload;
    const invalid = validateMultiUserPayload(payload, env);
    if (invalid) return badRequest(invalid);
  } else {
    try {
      payload = await request.json();
    } catch {
      return badRequest('Invalid JSON body.');
    }
  }

  const gate = await checkPlan(env, user, payload);
  if (gate.response) return gate.response;

  // A request that never got going (no provider, or it refused or failed on
  // the first response) hands back its prompt and its token reservation, so
  // a failure on our side costs nothing.
  const giveBack = () => {
    if (gate.claimed) {
      const pending = releasePrompt(env, user.id);
      if (typeof waitUntil === 'function') waitUntil(pending);
    }
    if (gate.reservation) trackApiUsage(env, { uid: user.id, kind: 'builder', tokens: 0, reservation: gate.reservation }, waitUntil);
  };

  const picked = pickProvider(env, payload);
  if (picked.response) {
    giveBack();
    return picked.response;
  }
  const { provider } = picked;
  const url = toChatCompletionsUrl(provider.baseUrl);
  const apiKey = provider.apiKey;
  const model = routeModel(env, provider, payload, gate.plan);

  const { messages, tools, tool_choice, stream, reasoning_effort, auto_fix } = payload;

  let temperature = 0.2;
  if (auto_fix === true) {
    // Error auto-fix requests (runtime or syntax) must be deterministic, so
    // pin temperature to 0.0 regardless of OPENAI_LLM_TEMPERATURE.
    temperature = 0;
  } else if (llmEnv(env, 'TEMPERATURE') !== '') {
    const parsedTemperature = parseFloat(llmEnv(env, 'TEMPERATURE'));
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

  const maxTokens = outputCap(env, payload, multiUser);
  if (maxTokens) bodyObj.max_tokens = maxTokens;

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
    giveBack();
    return new Response(JSON.stringify({ error: `Failed to reach LLM endpoint: ${err.message}` }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (provider.userSupplied && (upstream.status === 401 || upstream.status === 403)) {
    upstream.body?.cancel().catch(() => {});
    return rejectedUserKey(provider);
  }

  // A provider's own 429 (low balance, a per-account concurrency cap, an
  // overloaded model) would otherwise look like this proxy's rate limiter to
  // the client. Single-user gets the provider's reason, marked as such;
  // multi-user keeps it out of public view (logged instead).
  if (upstream.status === 429) {
    giveBack();
    const detail = await upstreamErrorMessage(upstream);
    const retryAfter = upstream.headers.get('retry-after');
    if (isMultiUser(env)) console.error(`[chat] provider 429: ${detail}`);
    return new Response(JSON.stringify({
      error: isMultiUser(env)
        ? 'The AI service is busy. Please try again shortly.'
        : `${providerLabel(provider.id)} turned the request down${detail ? `: ${detail}` : '.'}`,
      source: 'provider',
    }), {
      status: 429,
      headers: { 'content-type': 'application/json', ...(retryAfter ? { 'Retry-After': retryAfter } : {}) },
    });
  }

  if (!upstream.ok) giveBack();
  const response = await wrapWithTokenTracking(env, upstream, bodyObj, { uid: user.id, kind: 'builder', reservation: gate.reservation }, waitUntil);
  if (gate.pass && upstream.ok) response.headers.set('x-appblips-prompt-pass', gate.pass);
  return response;
}
