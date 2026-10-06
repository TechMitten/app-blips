// LLM providers the proxies can talk to.
//
// Each provider has its own block of variables (APPBLIPS_<PROVIDER>_API_KEY,
// _MODEL and optionally _BASE_URL). A provider is active when its API key is
// filled in -- nothing is inferred from a model name or URL. If several keys
// are set the first in PROVIDER_IDS order wins (with a warning), or
// OPENAI_LLM_PROVIDER picks one explicitly.
// The `openai-compatible` block is the generic variables (LLM_ENV below), and
// those also act as a fallback for a named provider's own values
// (OPENAI_LLM_MODEL / OPENAI_BASE_URL / OPENAI_API_KEY apply to whichever
// provider is active), so a single shared block is enough.
//
// AI inside generated apps (the APPBLIPS_APP_* relays) always uses the
// builder's provider -- see resolveAppProvider.
//
// Every provider here speaks the OpenAI chat-completions API. A preset only
// records what differs between them: the default endpoint, how a reasoning
// setting is expressed, and which optional request features the provider
// accepts. Request code reads these properties and never checks a provider's
// name, so supporting a new provider means adding one row below.
//
// Claude and Gemini are reached through OpenRouter: Anthropic's own
// OpenAI-compatible endpoint is documented as not intended for production,
// and Google's cannot switch reasoning off on Gemini 3 / 2.5 Pro models.

// How the app's reasoning setting ('none' = off, or an effort such as 'low')
// is written into the request:
//   reasoning_effort  top-level reasoning_effort: 'none' | '<effort>'
//   reasoning         reasoning: { effort: 'none' | '<effort>' }
//   thinking          thinking: { type: 'disabled' | 'enabled' }, plus
//                     reasoning_effort: '<effort>' when enabled
//   omit              nothing is sent (models without reasoning controls)
const REASONING_PARAMS = new Set(['reasoning_effort', 'reasoning', 'thinking', 'omit']);

const PROVIDERS = {
  'openai-compatible': {
    label: 'Any OpenAI-compatible API (set the base URL)',
    baseUrl: '',
    reasoningParam: 'reasoning_effort',
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    reasoningParam: 'reasoning_effort',
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    reasoningParam: 'reasoning',
  },
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    reasoningParam: 'reasoning_effort',
  },
  zai: {
    label: 'Z.ai',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    reasoningParam: 'thinking',
    // Only tool_choice 'auto' is accepted, and stream_options is not part of
    // the request schema.
    forcedToolChoice: false,
    streamUsage: false,
  },
  // Z.ai's GLM Coding Plan: the same API on the plan's own endpoint. Plan
  // quota doesn't cover the standard endpoint above, so a plan-only key is
  // refused there.
  'zai-coding': {
    label: 'Z.ai Coding Plan',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    reasoningParam: 'thinking',
    forcedToolChoice: false,
    streamUsage: false,
  },
};

const PRESET_DEFAULTS = { forcedToolChoice: true, streamUsage: true };

// The plain APPBLIPS_LLM_* variables: any OpenAI-compatible endpoint.
export const DEFAULT_PROVIDER = 'openai-compatible';
// Named providers first, in auto-selection order; the generic block last.
export const PROVIDER_IDS = [...Object.keys(PROVIDERS).filter((id) => id !== DEFAULT_PROVIDER), DEFAULT_PROVIDER];

const OFF_EFFORTS = new Set([false, 'none', 'off', 'disabled', '']);

const read = (env, name) => String(env?.[name] ?? '').trim();
const warned = new Set();

// The generic LLM variables. Every provider here speaks the OpenAI-compatible
// API, so they follow the OpenAI SDK's own names (OPENAI_API_KEY,
// OPENAI_BASE_URL). The pre-rename APPBLIPS_LLM_<NAME> is still read when the
// new one is unset, so existing deployments keep working until their env is
// updated (renamedLlmVars flags them at startup).
export const LLM_ENV = {
  PROVIDER: 'OPENAI_LLM_PROVIDER',
  API_KEY: 'OPENAI_API_KEY',
  BASE_URL: 'OPENAI_BASE_URL',
  MODEL: 'OPENAI_LLM_MODEL',
  MAX_TOKENS: 'OPENAI_LLM_MAX_TOKENS',
  ASK_MAX_TOKENS: 'OPENAI_LLM_ASK_MAX_TOKENS',
  // Optional per-role models on the same provider (chatProxy.js routeModel).
  VISION_MODEL: 'OPENAI_LLM_VISION_MODEL',
  ASK_MODEL: 'OPENAI_LLM_ASK_MODEL',
  TEMPERATURE: 'OPENAI_LLM_TEMPERATURE',
  REASONING_PARAM: 'OPENAI_LLM_REASONING_PARAM',
};
export const llmEnv = (env, name) => read(env, LLM_ENV[name]) || read(env, `APPBLIPS_LLM_${name}`);
export const renamedLlmVars = (env) => Object.keys(LLM_ENV)
  .filter((name) => read(env, `APPBLIPS_LLM_${name}`))
  .map((name) => ({ from: `APPBLIPS_LLM_${name}`, to: LLM_ENV[name] }));

// Variable-name scope for a provider id: APPBLIPS_ZAI, APPBLIPS_ZAI_CODING.
// Hyphens in ids become underscores, since they aren't valid in env names.
export const providerVarScope = (id, prefix = 'APPBLIPS_LLM') =>
  `${prefix.replace(/_LLM$/, '')}_${id.toUpperCase().replace(/-/g, '_')}`;

// Variable names for one provider's block. prefix: 'APPBLIPS_LLM' (also used
// to list the retired APPBLIPS_APP_LLM names).
const varNames = (id, prefix) => {
  const generic = prefix === 'APPBLIPS_LLM'
    ? { apiKey: LLM_ENV.API_KEY, model: LLM_ENV.MODEL, baseUrl: LLM_ENV.BASE_URL }
    : { apiKey: `${prefix}_API_KEY`, model: `${prefix}_MODEL`, baseUrl: `${prefix}_BASE_URL` };
  if (id === DEFAULT_PROVIDER) return { own: generic, fallback: generic };
  const scope = providerVarScope(id, prefix);
  return {
    own: { apiKey: `${scope}_API_KEY`, model: `${scope}_MODEL`, baseUrl: `${scope}_BASE_URL` },
    fallback: generic,
  };
};

// Picks the active provider for `prefix` and returns its settings:
//   { id, apiKey, model, baseUrl, reasoningParam, forcedToolChoice, streamUsage,
//     missing }   -- `missing` lists the variables still to be filled in
// or { error } when nothing usable is configured, so callers can report it
// ({ error, unconfigured: true } when no provider key is set at all).
// `alsoConfigured` lists other providers whose keys are set but were passed
// over. The ambiguity is logged once per prefix; `quiet` means the caller
// reports it itself (the startup summary), so the log is skipped.
export const resolveProvider = (env, prefix, { quiet = false } = {}) => {
  // The builder's generic variables go through llmEnv (new name, then the
  // pre-rename one); any other prefix is read as-is.
  const builder = prefix === 'APPBLIPS_LLM';
  const generic = (field) => builder ? llmEnv(env, field) : read(env, `${prefix}_${field}`);
  const fieldKey = { apiKey: 'API_KEY', model: 'MODEL', baseUrl: 'BASE_URL' };
  const providerVar = builder ? LLM_ENV.PROVIDER : `${prefix}_PROVIDER`;
  const requested = generic('PROVIDER').toLowerCase();
  let id = requested;
  let alsoConfigured = [];
  if (requested && !PROVIDERS[requested]) {
    return { error: `Unknown ${providerVar} "${requested}". Use one of: ${PROVIDER_IDS.join(', ')}.` };
  }
  if (!id) {
    const configured = PROVIDER_IDS.filter((candidate) => (candidate === DEFAULT_PROVIDER
      ? generic('API_KEY')
      : read(env, varNames(candidate, prefix).own.apiKey)));
    if (!configured.length) {
      const example = varNames('openrouter', prefix).own.apiKey;
      return { unconfigured: true, error: `No AI provider is configured. In your .env, fill in the API key for ONE provider (for example ${example}) and set ${varNames(DEFAULT_PROVIDER, prefix).own.model}, then restart.` };
    }
    id = configured[0];
    alsoConfigured = configured.slice(1);
    if (alsoConfigured.length && !warned.has(prefix)) {
      warned.add(prefix);
      if (!quiet) console.warn(`[llm] Several providers have an API key set (${configured.join(', ')}); using ${id}. Set ${providerVar} to choose.`);
    }
  }

  const names = varNames(id, prefix);
  // The openai-compatible block's "own" names are the generic ones, so its
  // own read is skipped and the generic (with the legacy fallback) answers.
  const pick = (field) => (id === DEFAULT_PROVIDER ? '' : read(env, names.own[field])) || generic(fieldKey[field]);
  const preset = PROVIDERS[id];
  const override = generic('REASONING_PARAM').toLowerCase();
  const provider = {
    id,
    ...PRESET_DEFAULTS,
    ...preset,
    apiKey: pick('apiKey'),
    model: pick('model'),
    baseUrl: pick('baseUrl') || preset.baseUrl,
    reasoningParam: REASONING_PARAMS.has(override) ? override : preset.reasoningParam,
    alsoConfigured,
    // Where to point the user: the provider's own key variable, but the shared
    // model / base URL lines.
    vars: { apiKey: names.own.apiKey, model: names.fallback.model, baseUrl: names.fallback.baseUrl },
  };
  provider.missing = missingVars(provider);
  return provider;
};

// Providers a user can pick in Settings → AI instead of the env provider.
// Presets only: the endpoint and request format come from the preset, never
// from the user, because OpenAI-compatible APIs still differ in what they
// accept (see the capability flags above).
export const USER_PROVIDER_IDS = PROVIDER_IDS.filter((id) => id !== DEFAULT_PROVIDER);
export const USER_PROVIDER_OPTIONS = USER_PROVIDER_IDS.map((id) => ({ id, label: PROVIDERS[id].label }));
export const providerLabel = (id) => PROVIDERS[id]?.label || id;

const MAX_USER_KEY_LENGTH = 512;
const MAX_USER_MODEL_LENGTH = 200;

// Builds a provider from a user-supplied { id, apiKey, model } (the request's
// `user_provider` field). Same shape as resolveProvider, or { error }. The
// operator's APPBLIPS_LLM_BASE_URL / _REASONING_PARAM belong to the env
// provider and are deliberately not applied here.
export const resolveUserProvider = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Invalid provider settings.' };
  const id = typeof input.id === 'string' ? input.id.trim().toLowerCase() : '';
  const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  const model = typeof input.model === 'string' ? input.model.trim() : '';
  if (!USER_PROVIDER_IDS.includes(id)) return { error: `Choose one of: ${USER_PROVIDER_OPTIONS.map((p) => p.label).join(', ')}.` };
  if (!apiKey) return { error: 'The API key is empty.' };
  // eslint-disable-next-line no-control-regex
  if (apiKey.length > MAX_USER_KEY_LENGTH || /[\s\x00-\x1f\x7f]/.test(apiKey)) return { error: 'The API key is not valid.' };
  if (!model) return { error: 'The model is empty.' };
  // eslint-disable-next-line no-control-regex
  if (model.length > MAX_USER_MODEL_LENGTH || /[\x00-\x1f\x7f]/.test(model)) return { error: 'The model name is not valid.' };
  const preset = PROVIDERS[id];
  return {
    id,
    ...PRESET_DEFAULTS,
    ...preset,
    apiKey,
    model,
    baseUrl: preset.baseUrl,
    reasoningParam: preset.reasoningParam,
    alsoConfigured: [],
    missing: [],
    userSupplied: true,
  };
};

// The variables still to be filled in for `provider`.
const missingVars = (provider) => [
  !provider.apiKey && provider.vars.apiKey,
  !provider.model && provider.vars.model,
  !provider.baseUrl && provider.vars.baseUrl,
].filter(Boolean);

// Provider-selection variables that generated-app AI used to accept for a
// separate key. They are no longer read: generated apps always share the
// builder's provider. Listed so the startup summary can flag leftovers.
export const IGNORED_APP_PROVIDER_VARS = [
  'APPBLIPS_APP_LLM_PROVIDER',
  'APPBLIPS_APP_LLM_API_KEY',
  'APPBLIPS_APP_LLM_MODEL',
  'APPBLIPS_APP_LLM_BASE_URL',
  'APPBLIPS_APP_LLM_REASONING_PARAM',
  ...PROVIDER_IDS.filter((id) => id !== DEFAULT_PROVIDER).flatMap((id) => {
    const own = varNames(id, 'APPBLIPS_APP_LLM').own;
    return [own.apiKey, own.model, own.baseUrl];
  }),
];

export const ignoredAppProviderVars = (env) => IGNORED_APP_PROVIDER_VARS.filter((name) => read(env, name));

// Limits for AI calls made by generated apps (the only generated-app AI
// settings; the provider is always the builder's). Read as
// APPBLIPS_APP_AI_<NAME>, falling back to the pre-rename APPBLIPS_APP_LLM_<NAME>
// so existing deployments keep working until their env is updated.
export const APP_AI_LIMITS = ['MAX_TOKENS', 'TEMPERATURE', 'REASONING_EFFORT'];

// APPBLIPS_GENERATED_AI_MODE=off switches AI inside generated apps off. The
// client hides it (src/lib/generatedAiMode.js), and the relays refuse so apps
// deployed while it was on stop spending the operator's key too.
export const appAiDisabled = (env) => String(env?.APPBLIPS_GENERATED_AI_MODE || '').trim().toLowerCase() === 'off';
export const appAiLimit = (env, name) => read(env, `APPBLIPS_APP_AI_${name}`) || read(env, `APPBLIPS_APP_LLM_${name}`);
export const renamedAppAiLimits = (env) => APP_AI_LIMITS
  .filter((name) => read(env, `APPBLIPS_APP_LLM_${name}`))
  .map((name) => ({ from: `APPBLIPS_APP_LLM_${name}`, to: `APPBLIPS_APP_AI_${name}` }));

// Provider for AI inside generated apps (the hosted /ai/chat relay and the
// self-hosted /api/app-ai/chat relay): always exactly the builder's provider,
// key, endpoint, model and request format. Token cap, temperature and
// reasoning effort are separate (appAiLimit) and never inherited.
export const resolveAppProvider = (env, options) => resolveProvider(env, 'APPBLIPS_LLM', options);

// Adapts an OpenAI-style request body in place to what `provider` accepts:
// writes the reasoning setting, drops stream_options where unsupported, and
// relaxes forced tool choices where they would be rejected (providers that
// only accept 'auto', and any request with reasoning on -- thinking models
// reject required/named tool choices). Returns { reasoningEnabled }.
export const applyProviderSettings = (bodyObj, provider, { effort } = {}) => {
  const raw = effort ?? 'none';
  const off = OFF_EFFORTS.has(raw);

  switch (provider.reasoningParam) {
    case 'omit':
      break;
    case 'reasoning':
      bodyObj.reasoning = { effort: off ? 'none' : raw };
      break;
    case 'thinking':
      bodyObj.thinking = { type: off ? 'disabled' : 'enabled' };
      if (!off) bodyObj.reasoning_effort = raw;
      break;
    default:
      bodyObj.reasoning_effort = off ? 'none' : raw;
  }
  const reasoningEnabled = !off && provider.reasoningParam !== 'omit';

  if (!provider.streamUsage) delete bodyObj.stream_options;

  const choice = bodyObj.tool_choice;
  const forced = choice === 'required' || choice?.type === 'function';
  if (forced && (!provider.forcedToolChoice || reasoningEnabled)) bodyObj.tool_choice = 'auto';

  return { reasoningEnabled };
};
