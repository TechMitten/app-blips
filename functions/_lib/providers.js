// LLM providers the proxies can talk to.
// We only use OpenRouter. The variables follow OPENAI_LLM_* standard names.

const PROVIDERS = {
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    reasoningParam: 'reasoning',
  },
};

const PRESET_DEFAULTS = { forcedToolChoice: true, streamUsage: true };

// The plain APPBLIPS_LLM_* variables: any OpenAI-compatible endpoint.
export const DEFAULT_PROVIDER = 'openrouter';
export const PROVIDER_IDS = ['openrouter'];

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
};
export const llmEnv = (env, name) => {
  let val = read(env, LLM_ENV[name]) || read(env, `APPBLIPS_LLM_${name}`);
  if (!val && name === 'API_KEY') {
    val = read(env, 'APPBLIPS_OPENROUTER_API_KEY') ||
          read(env, 'APPBLIPS_OPENAI_API_KEY') ||
          read(env, 'APPBLIPS_DEEPSEEK_API_KEY') ||
          read(env, 'APPBLIPS_ZAI_API_KEY');
  }
  return val;
};
export const renamedLlmVars = (env) => Object.keys(LLM_ENV)
  .filter((name) => read(env, `APPBLIPS_LLM_${name}`))
  .map((name) => ({ from: `APPBLIPS_LLM_${name}`, to: LLM_ENV[name] }));

// Variable-name scope for a provider id: APPBLIPS_ZAI, APPBLIPS_ZAI_CODING.
// Hyphens in ids become underscores, since they aren't valid in env names.
export const providerVarScope = (id, prefix = 'APPBLIPS_LLM') =>
  `${prefix.replace(/_LLM$/, '')}_${id.toUpperCase().replace(/-/g, '_')}`;

// Variable names for one provider's block. prefix: 'APPBLIPS_LLM'.
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
  const provider = {
    id,
    ...PRESET_DEFAULTS,
    ...preset,
    apiKey: pick('apiKey'),
    model: pick('model'),
    baseUrl: pick('baseUrl') || preset.baseUrl,
    reasoningParam: preset.reasoningParam,
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
export const USER_PROVIDER_IDS = ['openrouter'];
export const USER_PROVIDER_OPTIONS = USER_PROVIDER_IDS.map((id) => ({ id, label: PROVIDERS[id].label }));
export const providerLabel = (id) => PROVIDERS[id]?.label || id;

const MAX_USER_KEY_LENGTH = 512;
const MAX_USER_MODEL_LENGTH = 200;

// Builds a provider from a user-supplied { id, apiKey, model } (the request's
// `user_provider` field). Same shape as resolveProvider, or { error }. The
// operator's APPBLIPS_LLM_BASE_URL belong to the env
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

// Adapts an OpenAI-style request body in place to what `provider` accepts:
// writes the reasoning setting, drops stream_options where unsupported, and
// relaxes forced tool choices where they would be rejected (providers that
// only accept 'auto', and any request with reasoning on -- thinking models
// reject required/named tool choices). Returns { reasoningEnabled }.
export const applyProviderSettings = (bodyObj, provider, { effort } = {}) => {
  const raw = effort ?? 'none';
  const off = OFF_EFFORTS.has(raw);
  
  // OpenRouter's reasoning object. 'none' is sent explicitly when off: models
  // that reason by default (DeepSeek, GPT-5) keep thinking if it is left out.
  bodyObj.reasoning = { effort: off ? 'none' : raw };

  const reasoningEnabled = !off;

  // Thinking models (like DeepSeek R1) often get stuck in endless reasoning loops
  // if temperature is forced to 0 (which the proxy does for syntax repairs).
  if (reasoningEnabled) delete bodyObj.temperature;

  return { reasoningEnabled };
};
