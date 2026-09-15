// Cloudflare Turnstile verification for the /ai/session mint endpoint.
//
// Turnstile is what makes short-lived session tokens meaningful: without a gate,
// anyone can call /ai/session and get a fresh token, so rotation buys nothing.
// When TURNSTILE_SECRET is unset this reports `configured: false` and the caller
// decides whether to allow an ungated mint (weaker, but still no durable secret).
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export const verifyTurnstile = async (token, env, remoteIp) => {
  const secret = env?.TURNSTILE_SECRET;
  if (!secret) return { configured: false, success: false };
  if (!token || typeof token !== 'string' || token.length > 4096) return { configured: true, success: false };

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp && remoteIp !== 'unknown') body.set('remoteip', remoteIp);

  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await response.json().catch(() => ({}));
    return { configured: true, success: Boolean(data?.success) };
  } catch {
    return { configured: true, success: false };
  }
};
