// Provider-aware translation of the app's reasoning-effort setting into the
// wire format each LLM backend expects.
//
// The app's internal vocabulary is OpenAI's: a single `reasoning_effort` value
// ('none' | 'low' | 'medium' | 'high', plus legacy off spellings). DeepSeek's
// chat API accepts that shape natively (it maps medium -> high itself). Z.ai's
// GLM models do not: thinking is controlled with a `thinking: { type }`
// object, `reasoning_effort` is only accepted on GLM-5.2+, GLM-5.3 restricts
// it to low/high/max, and `stream_options` isn't part of their documented
// request schema. This module mutates the outgoing request body so each
// provider receives the parameter shape it actually supports, and returns
// whether reasoning ended up enabled -- the caller uses that to downgrade
// forced tool_choice values, which thinking backends reject with a 400.
//
// Provider detection is automatic from the configured model name and base-URL
// host, with an optional explicit override env var. Unknown configurations
// keep the original OpenAI pass-through behavior, so existing setups are
// byte-for-byte unchanged.

const OFF_EFFORTS = new Set([false, 'none', 'off', 'disabled']);
// GLM-5.3 only accepts low/high/max; GLM-5.2 maps low->high and medium->high
// itself. 'max'/'xhigh' are only reachable via operator-set relay env vars.
const ZAI_EFFORT_MAP = {
  minimal: 'low',
  low: 'low',
  medium: 'high',
  high: 'high',
  max: 'max',
  xhigh: 'max',
};

// `reasoning_effort` is documented as supported by GLM-5.2 and above; older
// GLM models rely on the thinking toggle alone.
const supportsZaiEffort = (model) => {
  const match = /glm[-_ ]?(\d+)(?:[.-](\d+))?/i.exec(String(model || ''));
  if (!match) return false;
  const major = parseInt(match[1], 10);
  const minor = match[2] !== undefined ? parseInt(match[2], 10) : 0;
  return major > 5 || (major === 5 && minor >= 2);
};

export const detectProvider = ({ model, baseUrl, override } = {}) => {
  const normalized = String(override || '').trim().toLowerCase();
  if (normalized === 'deepseek') return 'deepseek';
  if (normalized === 'zai' || normalized === 'z.ai' || normalized === 'glm') return 'zai';
  if (normalized === 'openai') return 'openai';

  const modelName = String(model || '');
  if (/deepseek/i.test(modelName)) return 'deepseek';
  if (/(^|\/)(chat)?glm[-_ ]?\d/i.test(modelName)) return 'zai';

  let host = '';
  try { host = new URL(String(baseUrl || '')).hostname.toLowerCase(); } catch { /* no or invalid URL */ }
  if (host === 'api.deepseek.com') return 'deepseek';
  if (host === 'api.z.ai' || host === 'open.bigmodel.cn') return 'zai';

  return 'openai';
};

// Mutates bodyObj in place; returns { provider, reasoningEnabled }.
export const applyReasoningSetting = (bodyObj, { effort, model, baseUrl, providerOverride } = {}) => {
  const provider = detectProvider({ model, baseUrl, override: providerOverride });
  const raw = effort ?? 'none';
  const isOff = OFF_EFFORTS.has(raw) || raw === '';

  if (provider === 'zai') {
    // Not in Z.ai's documented request schema; drop it rather than risk the
    // whole request being rejected (usage tracking just goes without stats).
    delete bodyObj.stream_options;
    if (isOff) {
      bodyObj.thinking = { type: 'disabled' };
    } else {
      bodyObj.thinking = { type: 'enabled' };
      const mapped = ZAI_EFFORT_MAP[String(raw).trim().toLowerCase()];
      if (mapped && supportsZaiEffort(model)) bodyObj.reasoning_effort = mapped;
    }
    return { provider, reasoningEnabled: !isOff };
  }

  // OpenAI-compatible pass-through, which is also exactly what DeepSeek's API
  // expects: it accepts reasoning_effort natively and maps medium -> high.
  if (isOff) {
    bodyObj.reasoning_effort = 'none';
    return { provider, reasoningEnabled: false };
  }
  if (raw) bodyObj.reasoning_effort = raw;
  return { provider, reasoningEnabled: Boolean(raw) };
};
