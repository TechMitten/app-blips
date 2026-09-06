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
// This endpoint is a public URL though -- without a check of its own, anyone
// who finds it could call it directly (bypassing the app's sign-in gate,
// which is UI-only) and spend the LLM budget behind APPBLIPS_LLM_API_KEY. So,
// in hosted mode (SELF_HOSTED_MODE=false), every request must carry a valid
// Firebase ID token, verified against Firebase itself (not just "a token was
// present"). Self-hosted mode is the default (SELF_HOSTED_MODE unset or
// anything other than "false"): there's no Firebase project to verify
// against, so every request is treated as coming from the single local user,
// on the assumption that self-hosters put their own access control (network
// restrictions, a reverse-proxy auth layer, etc.) in front of this endpoint
// if they expose it beyond localhost.

const toChatCompletionsUrl = (baseUrl) => {
  const trimmed = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /\/chat\/completions$/.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
};

const authorize = async (request, env) => {
  if (env.SELF_HOSTED_MODE !== 'false') return { id: 'local-user' };

  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const appCheckToken = request.headers.get('x-firebase-appcheck') || request.headers.get('X-Firebase-AppCheck') || '';
  if (!token) return null;
  try {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(appCheckToken ? { 'X-Firebase-AppCheck': appCheckToken } : {})
      },
      body: JSON.stringify({ idToken: token })
    });
    if (!res.ok) {
        return null;
    }
    const data = await res.json();
    if (data.users && data.users.length > 0) {
      return { id: data.users[0].localId };
    }
    return null;
  } catch {
    return null;
  }
};

// Rate limiting stub - fails open until natively implemented on Firebase
const checkRateLimit = async (userId, env) => {
  const windowSeconds = parseInt(env.APPBLIPS_CHAT_RATE_LIMIT_WINDOW_SECONDS, 10) || 300;
  return { allowed: true, windowSeconds };
};

// Core keys are required in every hosting mode; FIREBASE_API_KEY is only
// needed to verify tokens in hosted mode (SELF_HOSTED_MODE=false).
const validateEnv = (env) => {
  const missing = [];
  if (!env.APPBLIPS_LLM_BASE_URL) missing.push('APPBLIPS_LLM_BASE_URL');
  if (!env.APPBLIPS_LLM_API_KEY) missing.push('APPBLIPS_LLM_API_KEY');
  if (!env.APPBLIPS_LLM_MODEL) missing.push('APPBLIPS_LLM_MODEL');
  if (env.SELF_HOSTED_MODE === 'false' && !env.FIREBASE_API_KEY) missing.push('FIREBASE_API_KEY');
  return missing;
};

export async function handleChatProxy(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const missingEnv = validateEnv(env);
  if (missingEnv.length) {
    return new Response(
      JSON.stringify({ error: `Server is missing required configuration: ${missingEnv.join(', ')}.` }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
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

  const url = toChatCompletionsUrl(env.APPBLIPS_LLM_BASE_URL);
  const apiKey = env.APPBLIPS_LLM_API_KEY;
  const model = env.APPBLIPS_LLM_MODEL;

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

  const effort = reasoning_effort ?? env.APPBLIPS_LLM_REASONING_EFFORT ?? 'none';
  if (effort === false || effort === 'none') {
    bodyObj.reasoning_effort = 'none';
  } else if (effort) {
    bodyObj.reasoning_effort = effort;
  }

  if (env.APPBLIPS_LLM_MAX_TOKENS) {
    const parsedMax = parseInt(env.APPBLIPS_LLM_MAX_TOKENS, 10);
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
