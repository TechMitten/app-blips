// Per-account API usage counters (multi-user only) -- observability, not a
// billing boundary. One doc per account per UTC day in Supabase's `usage`
// collection: { user_id, date, builderRequests, deployedRequests, updatedAt }.
//
// The write is not authenticated as the caller: chatProxy.js has a verified
// end-user ID token but that's irrelevant to authorizing *this* write, and
// aiRelay.js has no user identity at all (the caller is an anonymous visitor
// of a deployed app). Supabase RLS constrains what can be written
// (known fields only, each counter increments by at most 1 per call).
import { supabaseUrl, supabaseHeaders, supabaseServiceKey, supabaseConfigured } from './supabaseServer.js';

const todayUtc = () => new Date().toISOString().slice(0, 10);

// Best-effort: a Supabase hiccup here must never break app generation or a
// deployed app's AI feature, so every failure is caught and logged, never
// thrown. A single-user instance has no Supabase project to write to.
export async function recordApiUsage(env, { uid, kind, tokens, costMicros, cachedTokens }) {
  if (!uid || !['builder', 'deployed'].includes(kind)) return;
  if (!supabaseConfigured(env)) return;

  const date = todayUtc();
  try {
    if (!supabaseServiceKey(env)) return;
    const response = await fetch(`${supabaseUrl(env)}/rest/v1/rpc/record_usage`, {
      method: 'POST',
      headers: supabaseHeaders(env, { service: true }),
      body: JSON.stringify({
        target_user_id: uid, usage_date: date, usage_kind: kind, token_count: tokens || 0,
        cost: costMicros || 0, cached: cachedTokens || 0,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error('[usage-tracking] update failed:', response.status, detail.slice(0, 200));
    }
  } catch (err) {
    console.error('[usage-tracking]', err?.message || err);
  }
}

// Runs recordApiUsage off the response's critical path. Under Cloudflare
// Pages/Workers, `waitUntil` keeps the isolate alive until the write lands;
// elsewhere (Vite dev middleware, Docker's server.js) there's no such hook,
// so the promise just runs un-awaited -- recordApiUsage handles its own
// errors, so nothing needs to observe how it settles.
export function trackApiUsage(env, args, waitUntil) {
  const promise = recordApiUsage(env, args);
  if (typeof waitUntil === 'function') waitUntil(promise);
}
