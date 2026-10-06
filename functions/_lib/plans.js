// Billing plans: what each one includes and how many tokens it may use.
// Shared by the server (the LLM proxy enforces these) and the client (the
// usage meter and upgrade screen show them), so the numbers live only here.
// Plain data and pure functions: no env, no I/O.
//
// Prices here are display copy; the amount actually charged is the Stripe
// price found by `lookupKey`, so change both together.
//
// Free is limited to `dailyPrompts` prompts a day: a Build or Ask message
// counts once however many model requests it takes (claimed atomically in the
// usage table; see chatProxy.js and promptPass.js). Every plan also has a
// token allowance, counting total tokens (input + output) as reported by the
// provider across the builder and the account's deployed apps. For Free it's
// a hidden backstop behind the prompt limit (daily cap plus monthly ceiling);
// paid plans have one pool per Stripe billing period, usable on any day.
export const PLANS = {
  free: {
    id: 'free',
    label: 'Free',
    price: 0,
    dailyPrompts: 5,
    dailyTokens: 600_000,
    periodTokens: 6_000_000,
    images: false,
    premiumChat: false,
  },
  plus: {
    id: 'plus',
    label: 'Plus',
    price: 12,
    lookupKey: 'appblips_plus_monthly',
    dailyPrompts: null,
    dailyTokens: null,
    periodTokens: 35_000_000,
    images: true,
    premiumChat: true,
  },
  pro: {
    id: 'pro',
    label: 'Pro',
    price: 29,
    lookupKey: 'appblips_pro_monthly',
    dailyPrompts: null,
    dailyTokens: null,
    periodTokens: 85_000_000,
    images: true,
    premiumChat: true,
  },
};

export const PAID_PLAN_IDS = ['plus', 'pro'];

// How many times Free's monthly usage a plan includes ("5x"), for plan copy.
// Rounded down so it never overpromises. Marketing describes paid plans this
// way instead of token counts, and never states Free's daily prompt number.
export const usageMultiple = (id) => Math.floor(PLANS[id].periodTokens / PLANS.free.periodTokens);

export const planById = (id) => PLANS[id] || PLANS.free;
export const planByLookupKey = (key) => Object.values(PLANS).find((plan) => plan.lookupKey && plan.lookupKey === key) || null;

// A build is many requests (writing, surgical edits, repairs). Only its first
// request is held to the allowance; the rest may run this far past it so a
// build never stops halfway because the limit was reached mid-way. The client
// marks the follow-up requests, so this is also the most a dishonest client
// can take beyond its allowance.
export const BUILD_OVERDRAFT_TOKENS = 500_000;

const DAY_MS = 24 * 60 * 60 * 1000;

const nextUtcMidnight = (now) => {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + DAY_MS);
};

const nextUtcMonth = (now) => {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
};

// Compares a billing_status row (see the billing migration) with its plan.
// Returns { allowed: true } or { allowed: false, scope: 'day' | 'period', resetsAt }.
// `continuing` = a follow-up request inside a build that already started.
export const checkAllowance = (status, { continuing = false, now = Date.now() } = {}) => {
  const plan = planById(status?.plan);
  const extra = continuing ? BUILD_OVERDRAFT_TOKENS : 0;
  const today = Number(status?.today_tokens) || 0;
  const period = Number(status?.period_tokens) || 0;

  if (plan.dailyTokens && today >= plan.dailyTokens + extra) {
    return { allowed: false, scope: 'day', resetsAt: nextUtcMidnight(now) };
  }
  if (plan.periodTokens && period >= plan.periodTokens + extra) {
    const end = status?.period_end ? new Date(status.period_end) : null;
    return {
      allowed: false,
      scope: 'period',
      resetsAt: plan.id === 'free' || !end || Number.isNaN(end.getTime()) ? nextUtcMonth(now) : end,
    };
  }
  return { allowed: true };
};

// Whether today's prompts are used up (for the status endpoint and meter).
// Not part of checkAllowance: once the last prompt is claimed, the rest of
// that prompt's requests must still go through.
export const checkPrompts = (status, { now = Date.now() } = {}) => {
  const plan = planById(status?.plan);
  if (!plan.dailyPrompts) return { allowed: true };
  return (Number(status?.today_prompts) || 0) >= plan.dailyPrompts
    ? { allowed: false, scope: 'prompts', resetsAt: nextUtcMidnight(now) }
    : { allowed: true };
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

// The message shown when a build is refused for being over the allowance.
export const limitMessage = (planId, check, now = Date.now()) => {
  const plan = planById(planId);
  const wait = formatWait(check.resetsAt, now);
  if (check.scope === 'prompts') {
    return `You've used today's free prompts. They reset in ${wait}. Upgrade to Plus for ${usageMultiple('plus')}x the usage.`;
  }
  const when = check.scope === 'day' ? `today's ${plan.label} allowance` : `this ${plan.id === 'free' ? 'month' : 'billing period'}'s ${plan.label} allowance`;
  const upgrade = plan.id === 'free' ? ' Upgrade to Plus for more.' : plan.id === 'plus' ? ' Upgrade to Pro for more.' : '';
  return `You've used ${when}. It resets in ${wait}.${upgrade}`;
};
