// What a request costs us at DeepSeek's official API prices, for the
// operator's margin numbers (usage.cost_micros) only -- never charged to the
// user. DeepSeek's API reports tokens but not a cost (OpenRouter's does, and
// trackTokens.js prefers that), so it's worked out here. Pure: no env, no I/O.
//
// USD per 1M tokens at peak, from https://api-docs.deepseek.com/quick_start/pricing
// (checked 2026-10-06). Prices change: re-check that page when they do.
// `hit` = cached input, `miss` = uncached input.
export const MODEL_PRICES = {
  'deepseek-flash': { hit: 0.006, miss: 0.3, output: 1.2 },
  'deepseek-v4-pro': { hit: 0.044, miss: 1.32, output: 3.96 },
};

// Off-peak is half price. Peak is 01:00-04:00 and 06:00-10:00 UTC, Monday to
// Friday. DeepSeek also makes Chinese public holidays off-peak; those aren't
// listed here, so a holiday is costed at peak (errs high).
export const isPeak = (date) => {
  const day = date.getUTCDay();
  const hour = date.getUTCHours();
  return day >= 1 && day <= 5 && ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10));
};

// "deepseek/deepseek-flash" (OpenRouter style) and "DeepSeek-Flash" find the
// same entry.
const pricesFor = (model) => MODEL_PRICES[String(model || '').trim().toLowerCase().replace(/^deepseek\//, '')] || null;

// The cost in micro-dollars of a request's `usage` block, or null for a model
// with no listed price. DeepSeek splits input into prompt_cache_hit_tokens /
// prompt_cache_miss_tokens; other OpenAI-style APIs report cached input as
// prompt_tokens_details.cached_tokens.
export const priceUsage = (model, usage, date = new Date()) => {
  const prices = pricesFor(model);
  if (!prices || !usage) return null;
  const input = Number(usage.prompt_tokens) || 0;
  const hit = Number(usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens) || 0;
  const miss = Number(usage.prompt_cache_miss_tokens) || Math.max(input - hit, 0);
  const output = Number(usage.completion_tokens) || 0;
  const scale = isPeak(date) ? 1 : 0.5;
  return Math.round((hit * prices.hit + miss * prices.miss + output * prices.output) * scale);
};
