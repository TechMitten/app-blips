// Per-account API usage counters (multi-user only) -- observability, not a
// billing boundary. One doc per account per UTC day in Supabase's `usage`
// collection: { user_id, date, builderRequests, deployedRequests, updatedAt }.
//
// `deployedRequests` holds usage from the retired AI-inside-apps feature; only
// 'builder' usage is recorded now.
//
// The write is not authenticated as the caller: chatProxy.js has a verified
// end-user ID token but that's irrelevant to authorizing *this* write.
// Supabase RLS constrains what can be written
// (known fields only, each counter increments by at most 1 per call).
import { supabaseUrl, supabaseHeaders, supabaseServiceKey, supabaseConfigured } from './supabaseServer.js';

const todayUtc = () => new Date().toISOString().slice(0, 10);

// Best-effort: a Supabase hiccup here must never break app generation, so
// every failure is caught and logged, never
// thrown. A single-user instance has no Supabase project to write to.
//
// `reservation` ({ date, tokens }, from billing.js reserveTokens) means the
// request already reserved an estimate against the allowance; it's settled
// to `tokens` on the day it was reserved instead of being counted again.
export async function recordApiUsage(env, { uid, kind, tokens, costMicros, cachedTokens, reservation }) {
  if (!uid || kind !== 'builder') return;
  if (!supabaseConfigured(env)) return;

  const date = todayUtc();
  try {
    if (!supabaseServiceKey(env)) return;
    const spend = { token_count: tokens || 0, cost: costMicros || 0, cached: cachedTokens || 0 };
    const [rpc, args] = reservation
      ? ['settle_usage', { target_user_id: uid, usage_date: reservation.date, reserved: reservation.tokens, usage_kind: kind, ...spend }]
      : ['record_usage', { target_user_id: uid, usage_date: date, usage_kind: kind, ...spend }];
    const response = await fetch(`${supabaseUrl(env)}/rest/v1/rpc/${rpc}`, {
      method: 'POST',
      headers: supabaseHeaders(env, { service: true }),
      body: JSON.stringify(args),
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
