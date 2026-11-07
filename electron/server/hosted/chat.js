// Gate for hosted /api/chat: authenticate the Clerk session, require an
// active plan, apply that plan's model alias, and count usage against the
// plan's cooldown window (given back if the provider rejects the request).
//
// What counts: one use per user action (a prompt, a review), not per AI
// request. The client tags every request of an action with the same random
// `usage_id`, and only the first one counts (buildWindow.js). Ask-mode
// requests (`ask: true`) and the app's automatic repairs of a build's errors
// (`automatic_repair: true`) don't count. `auto_fix` only pins temperature
// (chatProxy.js) and says nothing about usage: tool turns of a normal build
// send it too.

import { PLANS, isPlanId, planModel } from './plans.js';
import { usageIdOf } from './buildWindow.js';
import { verifyClerkToken } from './clerk.js';

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', ...headers },
});

const planOf = (account) => (account?.plan && isPlanId(account.plan) ? account.plan : 'basic');

// A light per-user ceiling so "unlimited" during the beta still has a floor.
// Counted per action like the cooldown: a repeat of the user's latest usage
// id passes without counting.
const WINDOW_MS = 60 * 60 * 1000;
const MAX_BUILDS_PER_WINDOW = 60;
const buildWindows = new Map();
const lastUsageIds = new Map();

function allowBuild(userId, usageId) {
  if (usageId && lastUsageIds.get(userId) === usageId) return true;
  lastUsageIds.set(userId, usageId);
  const now = Date.now();
  const recent = (buildWindows.get(userId) || []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= MAX_BUILDS_PER_WINDOW) return false;
  recent.push(now);
  buildWindows.set(userId, recent);
  return true;
}

export async function gateChat(request, env, store) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return { response: json(401, { error: 'Sign in to continue.' }) };

  let userId;
  try {
    userId = (await verifyClerkToken(token, env)).sub;
  } catch {
    return { response: json(401, { error: 'Your session has expired. Sign in again.' }) };
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return { response: json(400, { error: 'Invalid JSON body.' }) };
  }

  // Client-supplied overrides never win: the plan decides the model, and
  // hosted chat always spends the server's provider, not the user's key.
  delete payload.hosted_model_override;
  delete payload.user_provider;

  const account = await store.getAccount(userId);
  // A subscription is required for any AI access -- including the free
  // beta's Basic plan, which is $1/month.
  if (!account?.active) {
    return {
      response: json(402, {
        error: 'A subscription is required to use AppBlips AI. Choose a plan to start building.',
        code: 'subscription_required',
      }),
    };
  }
  const planId = planOf(account);
  const plan = PLANS[planId];
  const model = planModel(env, planId);
  if (model) payload.hosted_model_override = model;

  const usageId = usageIdOf(payload.usage_id);
  const isBuild = payload.ask !== true && payload.automatic_repair !== true;
  delete payload.usage_id;
  delete payload.automatic_repair;
  let windowed = false;

  if (isBuild) {
    if (!allowBuild(userId, usageId)) {
      return { response: json(429, { error: 'You are building very quickly. Please wait a moment and try again.' }) };
    }
    // The plan's cooldown (plans.js windowBuilds / windowHours), counted in
    // the store so it holds across restarts and across Worker instances.
    if (plan.windowBuilds && plan.windowHours) {
      const windowMs = plan.windowHours * 60 * 60 * 1000;
      const window = await store.takeBuild(userId, { limit: plan.windowBuilds, windowMs, usageId });
      if (!window.allowed) {
        const minutes = Math.max(1, Math.ceil((window.resetAt - Date.now()) / 60000));
        const wait = minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
        return {
          response: json(429, {
            error: `You've reached your usage limit for this ${plan.windowHours}-hour window. You can build again in ${wait}.`,
            code: 'build_cooldown',
            resetAt: new Date(window.resetAt).toISOString(),
          }, { 'retry-after': String(minutes * 60) }),
        };
      }
      // Only the request that counted the action gives it back on failure.
      windowed = window.counted;
    }
    // Plans with a monthly credit allowance (Silver, Max) aren't sold yet,
    // and there's no credit ledger behind them: refuse rather than build
    // for free. Metering them is work for when they go on sale.
    if (plan.monthlyCredits != null) {
      if (windowed) await Promise.resolve(store.releaseBuild(userId, usageId)).catch(() => {});
      return {
        response: json(402, {
          error: `${plan.name} isn't available yet. Contact support@appblips.com about your plan.`,
          code: 'plan_unavailable',
        }),
      };
    }
  }

  const gated = new Request(request.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { request: gated, userId, planId, windowed, usageId };
}

// A rejected request built nothing: give back its action's use in the
// cooldown window, if this was the request that counted it.
export async function releaseBuild(env, store, gated) {
  if (gated?.windowed) await Promise.resolve(store.releaseBuild(gated.userId, gated.usageId)).catch(() => {});
}
