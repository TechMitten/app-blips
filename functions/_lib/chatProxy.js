// Shared LLM proxy handler. Written with only Fetch API primitives (Request /
// Response / fetch) so the same code runs unmodified as a Cloudflare Pages
// Function in production and as Vite dev-server middleware locally (both
// environments expose these as globals) -- one implementation, no drift
// between dev and prod behavior.
//
// The point of this proxy: the real base URL / API key / model / tuning
// knobs live only in server-side env vars (ORION_LLM_*, no VITE_ prefix), so
// they never reach the client bundle. The browser only ever talks to this
// app's own origin at POST /api/chat.
//
// This endpoint is a public URL though -- without a check of its own, anyone
// who finds it could call it directly (bypassing the app's sign-in gate,
// which is UI-only) and spend the LLM budget behind ORION_LLM_API_KEY. So
// every request must carry a valid Supabase session access token, verified
// against Supabase itself (not just "a token was present").

// Same project as src/supabase.js and functions/[[path]].js -- a publishable
// key, safe to hardcode; it only grants what RLS/auth already allow.
const SUPABASE_URL = 'https://nmmrhagtkfjqljktcwkf.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_bX8jWhkPlVD0bHx7cQ8RJg_mGjOdWc3';

const toChatCompletionsUrl = (baseUrl) => {
  const trimmed = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /\/chat\/completions$/.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
};

const authorize = async (request) => {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_PUBLISHABLE_KEY },
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
};

// Per-user request cap, enforced via a SECURITY DEFINER Postgres function
// (check_chat_rate_limit) that atomically checks-and-increments a counter row
// keyed on auth.uid() -- see the chat_rate_limits migration. Fails open (allows
// the request) if the Supabase call itself errors, so a Supabase hiccup
// doesn't take down generation; the upstream LLM call still requires its own
// valid config regardless.
const checkRateLimit = async (token, env) => {
  const maxRequests = parseInt(env.ORION_CHAT_RATE_LIMIT_MAX, 10) || 60;
  const windowSeconds = parseInt(env.ORION_CHAT_RATE_LIMIT_WINDOW_SECONDS, 10) || 300;

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_chat_rate_limit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        p_max_requests: maxRequests,
        p_window_seconds: windowSeconds,
      }),
    });
    const allowed = res.ok ? await res.json() : true;
    return { allowed, windowSeconds };
  } catch {
    return { allowed: true, windowSeconds };
  }
};

export async function handleChatProxy(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const user = await authorize(request);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Sign in required.' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const { allowed, windowSeconds } = await checkRateLimit(token, env);
  if (!allowed) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please slow down and try again shortly.' }), {
      status: 429,
      headers: { 'content-type': 'application/json', 'Retry-After': String(windowSeconds) },
    });
  }

  const url = toChatCompletionsUrl(env.ORION_LLM_BASE_URL);
  const apiKey = env.ORION_LLM_API_KEY;
  const model = env.ORION_LLM_MODEL;

  if (!url || !apiKey || !model) {
    return new Response(
      JSON.stringify({ error: 'Server is missing ORION_LLM_BASE_URL / ORION_LLM_API_KEY / ORION_LLM_MODEL configuration.' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { messages, tools, tool_choice, stream, reasoning_effort } = payload;

  const bodyObj = {
    model,
    stream: !!stream,
    messages,
    temperature: 0.2,
  };

  const effort = reasoning_effort ?? env.ORION_LLM_REASONING_EFFORT ?? 'none';
  if (effort === false || effort === 'none') {
    bodyObj.reasoning_effort = 'none';
  } else if (effort) {
    bodyObj.reasoning_effort = effort;
  }

  if (env.ORION_LLM_MAX_TOKENS) {
    const parsedMax = parseInt(env.ORION_LLM_MAX_TOKENS, 10);
    if (!isNaN(parsedMax)) bodyObj.max_tokens = parsedMax;
  }

  if (tools) bodyObj.tools = tools;
  if (tool_choice) bodyObj.tool_choice = tool_choice;

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

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') || 'application/json' },
  });
}
