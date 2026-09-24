// LLM providers the proxies can talk to.
//
// Each provider has its own block of variables (APPBLIPS_<PROVIDER>_API_KEY,
// _MODEL and optionally _BASE_URL). A provider is active when its API key is
// filled in -- nothing is inferred from a model name or URL. If several keys
// are set the first in PROVIDER_IDS order wins (with a warning), or
// APPBLIPS_LLM_PROVIDER picks one explicitly.
// The `openai-compatible` block is the plain APPBLIPS_LLM_* variables, and those also act as a fallback for a named provider's own
// values (APPBLIPS_LLM_MODEL / _BASE_URL apply to whichever provider is
// active), so a single shared model line is enough.
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
};

const PRESET_DEFAULTS = { forcedToolChoice: true, streamUsage: true };

// The plain APPBLIPS_LLM_* variables: any OpenAI-compatible endpoint.
export const DEFAULT_PROVIDER = 'openai-compatible';
// Named providers first, in auto-selection order; the generic block last.
export const PROVIDER_IDS = [...Object.keys(PROVIDERS).filter((id) => id !== DEFAULT_PROVIDER), DEFAULT_PROVIDER];

const OFF_EFFORTS = new Set([false, 'none', 'off', 'disabled', '']);

const read = (env, name) => String(env?.[name] ?? '').trim();
const warned = new Set();

// Variable names for one provider's block. prefix: 'APPBLIPS_LLM' (also used
// to list the retired APPBLIPS_APP_LLM names).
const varNames = (id, prefix) => {
  const generic = {
    apiKey: `${prefix}_API_KEY`,
    model: `${prefix}_MODEL`,
    baseUrl: `${prefix}_BASE_URL`,
  };
  if (id === DEFAULT_PROVIDER) return { own: generic, fallback: generic };
  const scope = `${prefix.replace(/_LLM$/, '')}_${id.toUpperCase()}`;
  return {
    own: { apiKey: `${scope}_API_KEY`, model: `${scope}_MODEL`, baseUrl: `${scope}_BASE_URL` },
    fallback: generic,
  };
};

// Picks the active provider for `prefix` and returns its settings:
//   { id, apiKey, model, baseUrl, reasoningParam, forcedToolChoice, streamUsage,
//     missing }   -- `missing` lists the variables still to be filled in
// or { error } when nothing usable is configured, so callers can report it.
// `alsoConfigured` lists other providers whose keys are set but were passed
// over. The ambiguity is logged once per prefix; `quiet` means the caller
// reports it itself (the startup summary), so the log is skipped.
export const resolveProvider = (env, prefix, { quiet = false } = {}) => {
  const requested = read(env, `${prefix}_PROVIDER`).toLowerCase();
  let id = requested;
  let alsoConfigured = [];
  if (requested && !PROVIDERS[requested]) {
    return { error: `Unknown ${prefix}_PROVIDER "${requested}". Use one of: ${PROVIDER_IDS.join(', ')}.` };
  }
  if (!id) {
    const configured = PROVIDER_IDS.filter((candidate) => read(env, varNames(candidate, prefix).own.apiKey));
    if (!configured.length) {
      const example = varNames('openrouter', prefix).own.apiKey;
      return { error: `No AI provider is configured. In your .env, fill in the API key for ONE provider (for example ${example}) and set ${prefix}_MODEL, then restart.` };
    }
    id = configured[0];
    alsoConfigured = configured.slice(1);
    if (alsoConfigured.length && !warned.has(prefix)) {
      warned.add(prefix);
      if (!quiet) console.warn(`[llm] Several providers have an API key set (${configured.join(', ')}); using ${id}. Set ${prefix}_PROVIDER to choose.`);
    }
  }

  const names = varNames(id, prefix);
  const pick = (field) => read(env, names.own[field]) || read(env, names.fallback[field]);
  const preset = PROVIDERS[id];
  const override = read(env, `${prefix}_REASONING_PARAM`).toLowerCase();
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
