// Billing plans: what each one includes and how many tokens it may use.
// Shared by the server (the LLM proxy enforces these) and the client (the
// usage meter and upgrade screen show them), so the numbers live only here.
// Plain data and pure functions: no env, no I/O.
//
// Prices here are display copy; the amount actually charged is the Stripe
// price found by `lookupKey`, so change both together.
//
// There is no free plan. A new account can start the Free Trial (TRIAL), a
// plan of its own with a smaller allowance, by subscribing through Stripe
// Checkout with a card. In Stripe it is a Plus subscription in its trial
// period, so it turns into Plus, and is charged for, when the trial ends
// unless it was cancelled first. Present it as its own plan, never as a
// trial of Plus, since it doesn't include what Plus does. An account with no live
// subscription is on `none`, which can't use the hosted AI at all (see
// chatProxy.js). Every plan has a token allowance, counting total tokens
// (input + output) as reported by the provider across the builder and the
// account's deployed apps: one pool per Stripe billing period, usable on any
// day. During the trial the pool is TRIAL.periodTokens instead.
export const PLANS = {
  none: {
    id: 'none',
    label: 'No plan',
    price: 0,
    periodTokens: 0,
    images: false,
    premiumChat: false,
  },
  plus: {
    id: 'plus',
    label: 'Plus',
    price: 12,
    lookupKey: 'appblips_plus_monthly',
    periodTokens: 25_000_000,
    images: true,
    premiumChat: true,
  },
  pro: {
    id: 'pro',
    label: 'Pro',
    price: 29,
    lookupKey: 'appblips_pro_monthly',
    periodTokens: 60_000_000,
    images: true,
    premiumChat: true,
  },
};

// The Free Trial: `plan` is the Stripe plan it runs on and turns into. Its
// allowance is smaller than a paid month so a trial that's cancelled can't
// cost a month of AI; the full allowance starts with the first payment. One trial per account and per card (billing.js).
export const TRIAL = {
  plan: 'plus',
  days: 3,
  periodTokens: 6_000_000,
};

// Free prompts for an account with no plan, so a new account can try
// building (or Ask) before choosing the trial or a plan. Each new prompt,
// Build or Ask, uses one; its follow-up requests (edits, repairs) ride on
// the prompt pass and don't. The token cap bounds what all of them can cost,
// including a client that keeps chaining passes. Counted per account in
// free_builds/{uid} (billing.js); an account that has had a trial gets none.
export const FREE_BUILDS = {
  prompts: 5,
  periodTokens: 3_000_000,
};

export const PAID_PLAN_IDS = ['plus', 'pro'];

// How many times Plus's monthly usage a plan includes ("2x"), for plan copy.
// Rounded down so it never overpromises. Plan copy describes usage this way,
// never in token counts.
export const usageMultiple = (id) => Math.floor(PLANS[id].periodTokens / PLANS.plus.periodTokens);

export const planById = (id) => PLANS[id] || PLANS.none;
export const planByLookupKey = (key) => Object.values(PLANS).find((plan) => plan.lookupKey && plan.lookupKey === key) || null;

// A build is many requests (writing, surgical edits, repairs). Only its first
// request is held to the allowance; the rest may run this far past it so a
// build never stops halfway because the limit was reached mid-way. It's a
// ceiling on the total, not a budget per build, and a follow-up only gets it
// with the signed pass from its build's earlier requests (promptPass.js).
export const BUILD_OVERDRAFT_TOKENS = 500_000;

// The token total a request is refused at: { period }, using the trial's
// allowance while `trialing`. Shared by checkAllowance and the atomic
// reservation in billing.js (reserveTokens), so both draw the line in one place.
// `freeBuild` = a free prompt on an account with no plan (FREE_BUILDS).
export const allowanceLimits = (planOrId, { continuing = false, trialing = false, freeBuild = false } = {}) => {
  const plan = typeof planOrId === 'string' ? planById(planOrId) : planOrId;
  const extra = continuing ? BUILD_OVERDRAFT_TOKENS : 0;
  const base = freeBuild ? FREE_BUILDS.periodTokens : trialing ? TRIAL.periodTokens : plan.periodTokens;
  return { period: base + extra };
};

const validDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

// Compares a billing status (fetchBillingStatus in billing.js) with its plan.
// Returns { allowed: true } or { allowed: false, scope, resetsAt }, where
// scope is 'none' (no plan: nothing is allowed), 'trial' (the trial's
// allowance is used; resetsAt = when the trial ends and Plus starts) or
// 'period'. `continuing` = a follow-up request inside a build that already
// started. `freeBuild` = a free prompt with no plan (FREE_BUILDS): held to
// the free token cap instead of being refused outright.
export const checkAllowance = (status, { continuing = false, freeBuild = false, now = Date.now() } = {}) => {
  const plan = planById(status?.plan);
  const period = Number(status?.period_tokens) || 0;
  if (plan.id === 'none') {
    const allowed = freeBuild && period < allowanceLimits(plan, { continuing, freeBuild }).period;
    return allowed ? { allowed: true } : { allowed: false, scope: 'none', resetsAt: null };
  }
  const trialing = Boolean(status?.trialing);
  const limits = allowanceLimits(plan, { continuing, trialing });
  if (period >= limits.period) {
    const end = validDate(trialing ? status?.trial_end : status?.period_end)
      // No end stored (shouldn't happen for a live subscription): a month on.
      || new Date(now + 30 * 24 * 60 * 60 * 1000);
    return { allowed: false, scope: trialing ? 'trial' : 'period', resetsAt: end };
  }
  return { allowed: true };
};

// "6h", "45m", "3 days" -- how long until `date`, for limit messages.
export const formatWait = (date, now = Date.now()) => {
  const ms = Math.max(0, new Date(date).getTime() - now);
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)} days`;
};

// The message shown when a request is refused by checkAllowance.
// `trialEligible` = the account has never had a trial; `freeBuildsUsed` =
// it has used its free prompts (FREE_BUILDS).
export const limitMessage = (planId, check, now = Date.now(), { trialEligible = true, freeBuildsUsed = false } = {}) => {
  const plan = planById(planId);
  if (check.scope === 'none') {
    if (freeBuildsUsed) {
      return trialEligible
        ? `You've used your free prompts. Start your free ${TRIAL.days}-day trial to keep building. You won't be charged until it ends, and you can cancel anytime before then.`
        : "You've used your free prompts. Subscribe to Plus or Pro to keep building.";
    }
    return trialEligible
      ? `Start your free ${TRIAL.days}-day trial to build. You won't be charged until it ends, and you can cancel anytime before then.`
      : 'Subscribe to Plus or Pro to build.';
  }
  const wait = formatWait(check.resetsAt, now);
  if (check.scope === 'trial') {
    return `You've used your trial's allowance. Plus starts in ${wait} with its full monthly allowance, or start it now to keep building.`;
  }
  const upgrade = plan.id === 'plus' ? ` Upgrade to Pro for ${usageMultiple('pro')}x the usage.` : '';
  return `You've used this billing period's ${plan.label} allowance. It resets in ${wait}.${upgrade}`;
};
