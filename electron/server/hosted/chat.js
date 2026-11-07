// Gate for hosted /api/chat: authenticate the Clerk session, require an
// active plan, apply that plan's model alias, and count usage against the
// plan's cooldown window (given back if the provider rejects the request).
//
// What counts: one use per user action (a prompt, a review), not per AI
// request. The client tags every request of an action with the same random
// `usage_id`, and only the first one counts (buildWindow.js). Ask-mode
// requests (`ask: true`) and the app's automatic repairs of a build's errors
// (`automatic_repair: true`) don't count as uses. `auto_fix` only pins
// temperature (chatProxy.js) and says nothing about usage: tool turns of a
// normal build send it too.
//
// All of those are set by the client, so every request, free or not, also
// counts toward the window's request ceiling (buildWindow.js), and a usage id
// stops riding after a while. A script that marks everything as Ask mode or
// reuses one id gets the ceiling, not unlimited AI on the server's key.

import { PLANS, isPlanId, planModel } from './plans.js';
import { REQUESTS_PER_USE, usageIdOf } from './buildWindow.js';
import { verifyClerkToken } from './clerk.js';

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', ...headers },
});

const planOf = (account) => (account?.plan && isPlanId(account.plan) ? account.plan : 'basic');

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
  // A subscription is required for any AI access, Basic included.
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

  // Plans with a monthly credit allowance (Silver, Max) aren't sold yet,
  // and there's no credit ledger behind them: refuse every request (Ask mode
  // too) rather than run them for free. Metering them is work for when they
  // go on sale.
  if (plan.monthlyCredits != null) {
    return {
      response: json(402, {
        error: `${plan.name} isn't available yet. Contact support@appblips.com about your plan.`,
        code: 'plan_unavailable',
      }),
    };
  }

  const usageId = usageIdOf(payload.usage_id);
  const counts = payload.ask !== true && payload.automatic_repair !== true;
  delete payload.usage_id;
  delete payload.automatic_repair;
  let windowed = false;
  let windowStart = null;

  // The plan's cooldown (plans.js windowBuilds / windowHours), counted in the
  // store so it holds across restarts and across Worker instances. Every
  // request goes through it: free ones only count toward the request ceiling.
  if (plan.windowBuilds && plan.windowHours) {
    const windowMs = plan.windowHours * 60 * 60 * 1000;
    const window = await store.takeBuild(userId, {
      limit: plan.windowBuilds,
      requestLimit: plan.windowBuilds * REQUESTS_PER_USE,
      windowMs,
      usageId,
      counts,
    });
    if (!window.allowed) {
      const minutes = Math.max(1, Math.ceil((window.resetAt - Date.now()) / 60000));
      const wait = minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
      const ceiling = window.reason === 'requests';
      return {
        response: json(429, {
          error: ceiling
            ? `You've sent a lot of AI requests in this ${plan.windowHours}-hour window. You can continue in ${wait}.`
            : `You've reached your usage limit for this ${plan.windowHours}-hour window. You can build again in ${wait}.`,
          code: ceiling ? 'request_limit' : 'build_cooldown',
          resetAt: new Date(window.resetAt).toISOString(),
        }, { 'retry-after': String(minutes * 60) }),
      };
    }
    // Only the request that counted the action gives it back on failure.
    windowed = window.counted;
    windowStart = window.start ?? null;
  }

  const gated = new Request(request.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { request: gated, userId, planId, windowed, usageId, windowStart };
}

// A rejected request built nothing: give back its action's use in the
// cooldown window, if this was the request that counted it.
export async function releaseBuild(env, store, gated) {
  if (gated?.windowed) await Promise.resolve(store.releaseBuild(gated.userId, gated.usageId, gated.windowStart)).catch(() => {});
}
