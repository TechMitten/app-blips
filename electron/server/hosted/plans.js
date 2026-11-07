// Plan catalog for hosted (multi-user) AppBlips.
//
// The tiers differ by the model alias the operator configures for them
// (`APPBLIPS_MODEL_BASIC` / `_SILVER` / `_MAX`) and by a monthly build-credit
// allowance. Basic is free and unlimited during the beta; Silver and Max are
// capped so credits stay meaningful. No provider or model names live here:
// the operator sets the aliases in the environment, and the client only ever
// sees tier names.

export const PLAN_IDS = ['basic', 'silver', 'max'];

export const PLANS = Object.freeze({
  basic: {
    id: 'basic',
    name: 'Basic',
    priceCents: 100,
    monthlyCredits: null, // unlimited during the beta
    modelEnv: 'APPBLIPS_MODEL_BASIC',
    // Price and unlimited builds are beta terms: the app labels them as such
    // wherever the plan is offered. Remove when the beta ends.
    betaPricing: true,
  },
  silver: {
    id: 'silver',
    name: 'Silver',
    priceCents: 2000,
    monthlyCredits: 100,
    modelEnv: 'APPBLIPS_MODEL_SILVER',
    comingSoon: true,
  },
  max: {
    id: 'max',
    name: 'Max',
    priceCents: 10000,
    monthlyCredits: 200,
    modelEnv: 'APPBLIPS_MODEL_MAX',
    comingSoon: true,
  },
});

// Shown with a "Coming soon" tag but not sold yet: checkout refuses them, so
// the tag is not the only thing stopping a purchase. Remove `comingSoon` from
// a plan to open it.
export const isPlanOnSale = (id) => isPlanId(id) && !PLANS[id].comingSoon;

export const isPlanId = (id) => Object.prototype.hasOwnProperty.call(PLANS, id);

// The model id to run for a plan, from the operator's environment. Empty
// means "use the provider's default model".
export const planModel = (env, planId) => {
  const plan = PLANS[planId] || PLANS.basic;
  return String(env?.[plan.modelEnv] || '').trim();
};

// The Creem product id configured for a plan, in the active environment
// (test and production have separate product catalogs).
export const planProductId = (env, planId) => {
  const prefix = String(env?.CREEM_SERVER || 'test').toLowerCase() === 'test'
    ? 'CREEM_TEST_PRODUCT'
    : 'CREEM_PRODUCT';
  return String(env?.[`${prefix}_${planId.toUpperCase()}`] || '').trim();
};

// The plan a Creem product id maps to, from the environment's product ids.
export const planForProductId = (env, productId) => {
  if (!productId) return null;
  for (const id of PLAN_IDS) {
    if (planProductId(env, id) === productId) return id;
  }
  return null;
};

// What the browser may know: tier names, prices and allowances. Never model
// ids, and never Creem product ids (checkout is created server-side).
export const publicCatalog = () => PLAN_IDS.map((id) => ({
  id,
  name: PLANS[id].name,
  priceCents: PLANS[id].priceCents,
  monthlyCredits: PLANS[id].monthlyCredits,
  comingSoon: Boolean(PLANS[id].comingSoon),
  betaPricing: Boolean(PLANS[id].betaPricing),
}));
