// LLM proxy handler. Written with only Fetch API primitives (Request /
// Response / fetch) so the same code runs unmodified in the desktop app
// (electron/main.js answers /api/* in-process via protocol.handle) and as Vite
// dev-server middleware for local UI work -- one implementation, no drift.
// Anthropic is the exception to the plain fetch: anthropic.js calls it through
// the official SDK and hands back an OpenAI-shaped Response.
//
// The point of this proxy: the real base URL / API key / model / tuning knobs
// live only in server-side env vars (OPENAI_*, no VITE_ prefix), so they never
// reach the client bundle. The renderer only ever talks to this app's own
// origin at POST /api/chat.
//
// AppBlips is a single-user application: one local user, no sign-in. The
// desktop app attaches the provider saved in Settings → AI itself
// (electron/main.js withSavedProvider); in the dev server the renderer may send
// its own `user_provider`. Anything else uses the env provider.

import { resolveProvider, resolveUserProvider, applyProviderSettings, providerLabel, llmEnv } from './providers.js';
import { relayUpstream } from './relay.js';
import { callAnthropic } from './anthropic.js';

const toChatCompletionsUrl = (baseUrl) => {
  const trimmed = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /\/chat\/completions$/.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
};

const badRequest = (error, status = 400) => new Response(JSON.stringify({ error }), {
  status,
  headers: { 'content-type': 'application/json' },
});

// Misconfiguration is the operator's problem, and the operator is also the
// user of a single-user install, so they get the exact fix.
const configError = (env, detail) => new Response(
  JSON.stringify({ error: `AppBlips isn't set up yet. ${detail} Or set your own provider in Settings → AI.` }),
  { status: 500, headers: { 'content-type': 'application/json' } },
);

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

// A single-user install has no sign-in, so a browser may call /api/chat only
// from AppBlips' own page. Browsers label every cross-site POST with Origin --
// including "simple" text/plain requests that skip the CORS preflight, which
// any web page, or a sandboxed generated app (Origin "null"), could otherwise
// send to spend the configured key without reading the reply. A request with
// no Origin is not a browser on another site (curl, a local script) and still
// passes. Own origin is built from protocol + host rather than URL.origin,
// which is "null" for the desktop app's appblips:// scheme.
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

// The configured model, or a role-specific one: OPENAI_LLM_VISION_MODEL for
// requests carrying an image. Never applied to the user's own provider, whose
// model is theirs to choose.
const routeModel = (env, provider, payload) => {
  if (provider.userSupplied) return provider.model;
  if (hasImageContent(payload.messages)) return llmEnv(env, 'VISION_MODEL') || provider.model;
  return provider.model;
};

export async function handleChatProxy(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  if (isForeignOrigin(request, env)) {
    return new Response(JSON.stringify({ error: 'Requests from other sites are not allowed.' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return badRequest('Invalid JSON body.');
  }

  // Only Settings → AI supplies an optional output limit. Omission/null uses
  // the provider's limit for every mode; environment caps are no longer read.
  const maxTokens = payload?.max_tokens;
  if (maxTokens != null && (!Number.isSafeInteger(maxTokens) || maxTokens <= 0)) {
    return badRequest('The output token limit must be a positive whole number. Change it in Settings → AI.');
  }

  const picked = pickProvider(env, payload);
  if (picked.response) return picked.response;
  const { provider } = picked;
  const url = toChatCompletionsUrl(provider.baseUrl);
  const apiKey = provider.apiKey;
  const model = routeModel(env, provider, payload);

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

  if (maxTokens != null) bodyObj.max_tokens = maxTokens;

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
    upstream = provider.id === 'anthropic' ? await callAnthropic(bodyObj, provider) : await fetch(url, {
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

  // A provider's own 429 (low balance, a per-account concurrency cap, an
  // overloaded model) passes through with the provider's reason, marked as
  // such, rather than looking like this proxy's own limit.
  if (upstream.status === 429) {
    const detail = await upstreamErrorMessage(upstream);
    const retryAfter = upstream.headers.get('retry-after');
    return new Response(JSON.stringify({
      error: `${providerLabel(provider.id)} turned the request down${detail ? `: ${detail}` : '.'}`,
      source: 'provider',
    }), {
      status: 429,
      headers: { 'content-type': 'application/json', ...(retryAfter ? { 'Retry-After': retryAfter } : {}) },
    });
  }

  return relayUpstream(upstream);
}
