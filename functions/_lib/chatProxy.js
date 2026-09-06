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

let jwksCache = { keys: [], expiry: 0 };
const cryptoKeysCache = new Map();

const base64UrlToUint8Array = (base64Url) => {
  let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const getAppCheckCryptoKey = async (kid) => {
  const now = Date.now();
  if (!jwksCache.keys.length || now > jwksCache.expiry) {
    const res = await fetch('https://firebaseappcheck.googleapis.com/v1/jwks');
    if (!res.ok) {
      throw new Error(`Failed to fetch App Check JWKS: ${res.status}`);
    }
    const data = await res.json();
    jwksCache = {
      keys: data.keys || [],
      expiry: now + 6 * 60 * 60 * 1000,
    };
    cryptoKeysCache.clear();
  }

  if (cryptoKeysCache.has(kid)) {
    return cryptoKeysCache.get(kid);
  }

  let jwk = jwksCache.keys.find((k) => k.kid === kid && k.alg === 'RS256');
  if (!jwk) {
    const res = await fetch('https://firebaseappcheck.googleapis.com/v1/jwks');
    if (res.ok) {
      const data = await res.json();
      jwksCache = {
        keys: data.keys || [],
        expiry: now + 6 * 60 * 60 * 1000,
      };
      cryptoKeysCache.clear();
      jwk = jwksCache.keys.find((k) => k.kid === kid && k.alg === 'RS256');
    }
  }

  if (!jwk) return null;

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  cryptoKeysCache.set(kid, cryptoKey);
  return cryptoKey;
};

export const verifyAppCheckToken = async (token, env) => {
  if (!token || typeof token !== 'string') {
    return { ok: false, error: 'App Check token missing or invalid.' };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { ok: false, error: 'Malformed App Check token.' };
  }

  const [rawHeader, rawPayload, rawSig] = parts;

  let header;
  let payload;
  try {
    const headerStr = new TextDecoder().decode(base64UrlToUint8Array(rawHeader));
    const payloadStr = new TextDecoder().decode(base64UrlToUint8Array(rawPayload));
    header = JSON.parse(headerStr);
    payload = JSON.parse(payloadStr);
  } catch {
    return { ok: false, error: 'Malformed App Check token JSON.' };
  }

  if (header.alg !== 'RS256' || header.typ !== 'JWT' || !header.kid) {
    return { ok: false, error: 'Invalid App Check token header.' };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < nowSeconds - 10) {
    return { ok: false, error: 'App Check token has expired.' };
  }

  const projectNumber = env.FIREBASE_PROJECT_NUMBER || env.VITE_FIREBASE_PROJECT_NUMBER;
  const projectId = env.VITE_FIREBASE_PROJECT_ID || env.FIREBASE_PROJECT_ID;

  if (projectNumber) {
    if (payload.iss !== `https://firebaseappcheck.googleapis.com/${projectNumber}`) {
      return { ok: false, error: 'App Check token issuer mismatch.' };
    }
  } else if (!payload.iss?.startsWith('https://firebaseappcheck.googleapis.com/')) {
    return { ok: false, error: 'Invalid App Check token issuer.' };
  }

  const audArray = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const expectedAuds = [
    ...(projectNumber ? [`projects/${projectNumber}`] : []),
    ...(projectId ? [`projects/${projectId}`] : []),
  ];

  if (expectedAuds.length > 0) {
    const matches = expectedAuds.some((expected) => audArray.includes(expected));
    if (!matches) {
      return { ok: false, error: 'App Check token audience mismatch.' };
    }
  }

  try {
    const cryptoKey = await getAppCheckCryptoKey(header.kid);
    if (!cryptoKey) {
      return { ok: false, error: 'App Check signing key not found.' };
    }

    const sigBytes = base64UrlToUint8Array(rawSig);
    const signedData = new TextEncoder().encode(`${rawHeader}.${rawPayload}`);

    const isValid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      sigBytes,
      signedData
    );

    if (!isValid) {
      return { ok: false, error: 'Invalid App Check token signature.' };
    }

    return { ok: true, payload };
  } catch (err) {
    return { ok: false, error: `App Check verification failed: ${err.message}` };
  }
};

const verifyAppCheck = async (request, env) => {
  if (env.SELF_HOSTED_MODE !== 'false') return { ok: true };
  if (env.FIREBASE_APPCHECK_ENFORCE === 'false') return { ok: true };

  const appCheckToken =
    request.headers.get('x-firebase-appcheck') ||
    request.headers.get('X-Firebase-AppCheck') ||
    '';

  if (!appCheckToken) {
    return { ok: false, error: 'App Check token required.' };
  }

  return verifyAppCheckToken(appCheckToken, env);
};

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

  const appCheck = await verifyAppCheck(request, env);
  if (!appCheck.ok) {
    return new Response(JSON.stringify({ error: appCheck.error || 'App Check failed.' }), {
      status: 401, statusText: "AppCheckFailed",
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

  let temperature = 0.2;
  if (env.APPBLIPS_LLM_TEMPERATURE !== undefined && env.APPBLIPS_LLM_TEMPERATURE !== '') {
    const parsedTemperature = parseFloat(env.APPBLIPS_LLM_TEMPERATURE);
    if (!isNaN(parsedTemperature)) temperature = parsedTemperature;
  }

  const bodyObj = {
    model,
    stream: !!stream,
    messages,
    temperature,
  };

  const effort = reasoning_effort ?? env.APPBLIPS_LLM_REASONING_EFFORT ?? 'none';
  if (effort === false || effort === 'none' || effort === 'off' || effort === 'disabled') {
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
