// Per-account API usage counters (multi-user only), in the Firestore `usage`
// collection: one doc per account per UTC day, id `${uid}_${date}`, holding
// { user_id, date, builder_requests, builder_tokens, builder_prompts,
//   cost_micros, cached_tokens, deployed_requests, deployed_tokens, updated_at }.
// billing.js reads the same docs to enforce plan limits.
//
// `deployed_*` hold usage from the retired AI-inside-apps feature; only
// 'builder' usage is recorded now. Kept so the totals stay one formula.
//
// Written as the service account; firestore.rules give clients no access at
// all, so a signed-in user can neither read nor inflate or erase them.
import { firebaseConfigured, serviceAccountConfigured, getDoc, runTransaction, setWrite, sumQuery } from './firebaseServer.js';

export const todayUtc = () => new Date().toISOString().slice(0, 10);

export const usageDocPath = (uid, date) => `usage/${uid}_${date}`;

export const emptyUsage = () => ({
  builder_requests: 0,
  builder_tokens: 0,
  builder_prompts: 0,
  deployed_requests: 0,
  deployed_tokens: 0,
  cost_micros: 0,
  cached_tokens: 0,
});

// Tokens used from `fromDate` up to (not including) `beforeDate`, both
// YYYY-MM-DD. Needs the (user_id, date) index in firestore.indexes.json.
export const sumPeriodTokens = async (env, uid, fromDate, beforeDate) => {
  if (fromDate >= beforeDate) return 0;
  try {
    const sums = await sumQuery(env, 'usage', ['builder_tokens', 'deployed_tokens'], {
      where: [['user_id', '==', uid], ['date', '>=', fromDate], ['date', '<', beforeDate]],
    });
    return sums.builder_tokens + sums.deployed_tokens;
  } catch (err) {
    console.error('[usage] sumPeriodTokens failed:', err?.message || err);
    return 0;
  }
};

const nonNegative = (value) => Math.max(Number(value) || 0, 0);

// Best-effort: a Firestore hiccup here must never break app generation, so
// every failure is caught and logged, never thrown. A single-user instance
// has no Firebase project to write to.
//
// `reservation` ({ date, tokens }, from billing.js reserveTokens) means the
// request already reserved an estimate against the allowance; it's settled
// to `tokens` on the day it was reserved instead of being counted again.
export async function recordApiUsage(env, { uid, kind, tokens, costMicros, cachedTokens, reservation }) {
  if (!uid || kind !== 'builder') return;
  if (!firebaseConfigured(env) || !serviceAccountConfigured(env)) return;

  const date = reservation?.date || todayUtc();
  try {
    await runTransaction(env, async (tx) => {
      const path = usageDocPath(uid, date);
      const doc = await getDoc(env, path, { transaction: tx });
      const usage = { ...emptyUsage(), ...(doc?.data || {}) };
      const held = reservation ? nonNegative(reservation.tokens) : 0;
      return {
        writes: [setWrite(env, path, {
          ...usage,
          user_id: uid,
          date,
          builder_requests: usage.builder_requests + 1,
          builder_tokens: Math.max(usage.builder_tokens - held + nonNegative(tokens), 0),
          cost_micros: usage.cost_micros + nonNegative(costMicros),
          cached_tokens: usage.cached_tokens + nonNegative(cachedTokens),
          updated_at: new Date(),
        })],
      };
    });
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
