// Which reasoning levels each provider and model accepts. Shared by the
// renderer (Settings → AI shows only these levels, and builds clamp to them)
// and the chat proxy (a safety net for requests that arrive with a level the
// model rejects). Fetch-free and Node-free, like the rest of electron/server.
//
// The levels come from each provider's own documentation (Nov 2026):
// - Anthropic: output_config.effort low/medium/high/xhigh/max; the Models API
//   reports per-model support in `capabilities` (parsed by anthropic.js).
// - OpenAI: reasoning_effort none/minimal/low/medium/high/xhigh/max, model
//   dependent and not in /v1/models, hence the table below.
// - Gemini (OpenAI compatibility): reasoning_effort maps to thinking_level;
//   only 2.5 Flash / Flash-Lite can turn thinking off.
// - DeepSeek: low/high/max ("none" turns thinking off); /models lists
//   `effort.supported_levels` per model.
// - OpenRouter: /models lists `reasoning.supported_efforts` and `mandatory`.
// - Ollama: reasoning_effort, resolved against the model's own metadata.
// - LM Studio: effort is only documented on /v1/responses, which AppBlips
//   doesn't use, so there is no control.

// Lowest to highest. 'none' is Off.
export const EFFORT_SCALE = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
export const EFFORT_LABELS = { none: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };

// Claude families with adaptive thinking and output_config.effort (Opus/Sonnet
// 4.6 and later, Haiku 5 and later, Fable, Mythos). Older models get neither.
export const ADAPTIVE_CLAUDE = /^claude-(?:(?:opus|sonnet|fable|mythos)-(?:[5-9]|4-[6-9])|haiku-[5-9])/;

const levels = (list, defaultLevel = null, extra = {}) => ({ levels: list, defaultLevel, known: true, ...extra });
const guess = (list, defaultLevel = null) => ({ levels: list, defaultLevel, known: false });
const none = (note) => ({ levels: [], defaultLevel: null, known: true, note });

const ALL = EFFORT_SCALE;
const NOT_A_REASONING_MODEL = 'This model doesn\'t reason before answering, so there is nothing to set.';

const anthropicLevels = (model) => {
  if (!ADAPTIVE_CLAUDE.test(model)) return none('This Claude model doesn\'t support reasoning levels. Choose Claude Opus 4.6, Sonnet 4.6, Haiku 5 or later to use them.');
  // Opus 5.5 always thinks: Off would behave exactly like Low.
  const off = /^claude-opus-5-5/.test(model) ? [] : ['none'];
  // Extra high arrived with Opus 4.7; 4.6 models and Mythos Preview lack it.
  const xhigh = /^claude-(?:opus|sonnet)-4-6|^claude-mythos-preview/.test(model) ? [] : ['xhigh'];
  const defaultLevel = /^claude-(?:opus-5-5|haiku-5-5)/.test(model) ? 'medium' : 'high';
  return levels([...off, 'low', 'medium', 'high', ...xhigh, 'max'], defaultLevel);
};

const openaiLevels = (model) => {
  if (/^o\d(?:-|$)/.test(model)) return levels(['low', 'medium', 'high'], 'medium');
  // GPT-6 Astra and GPT-6.1 Sol reject 'none'; Terra, Luna and GPT-6 Sol accept it.
  if (/^gpt-6-astra|^gpt-6\.1-sol/.test(model)) return levels(['low', 'medium', 'high', 'xhigh', 'max'], 'medium');
  if (/^gpt-6/.test(model)) return levels(['none', 'low', 'medium', 'high', 'xhigh', 'max'], 'medium');
  if (/^gpt-(?:[7-9]|\d{2})/.test(model)) return guess(['low', 'medium', 'high']);
  if (/^gpt-5\.([6-9])/.test(model)) return levels(['none', 'low', 'medium', 'high', 'xhigh', 'max'], 'medium');
  if (/^gpt-5\.[2-5]/.test(model)) return levels(['none', 'low', 'medium', 'high', 'xhigh'], 'none');
  if (/^gpt-5\.1/.test(model)) return levels(['none', 'low', 'medium', 'high'], 'none');
  if (/^gpt-5(?:-|$)/.test(model)) return levels(['minimal', 'low', 'medium', 'high'], 'medium');
  return none(NOT_A_REASONING_MODEL);
};

// Gemini's thinking table. Ids may arrive as "models/gemini-…".
const GEMINI_TABLE = [
  [/^gemini-2\.5-flash(?:-lite)?(?:-|$)/, ['none', 'low', 'medium', 'high']],
  [/^gemini-2\.5-pro/, ['low', 'medium', 'high']],
  [/^gemini-3-pro/, ['low', 'high'], 'high'],
  [/^gemini-3\.1-flash-lite-image/, ['minimal', 'high'], 'minimal'],
  [/^gemini-3\.5-flash-lite/, ['minimal', 'low', 'medium', 'high'], 'minimal'],
  [/^gemini-3-flash|^gemini-3\.6-flash|^gemini-robotics-er/, ['minimal', 'low', 'medium', 'high']],
  [/^gemini-3\.1-pro/, ['low', 'medium', 'high'], 'high'],
  [/^gemini-3\.8-flash|^gemini-4-argon/, ['low', 'medium', 'high'], 'medium'],
];

const geminiLevels = (model) => {
  const id = model.replace(/^models\//, '');
  for (const [pattern, list, defaultLevel = null] of GEMINI_TABLE) {
    if (pattern.test(id)) return levels(list, defaultLevel);
  }
  return guess(['low', 'medium', 'high']);
};

// The static rules for `providerId` and `model`. `known` is false for a
// best guess (an unrecognised model), which the proxy doesn't enforce.
export const staticReasoningLevels = (providerId, model = '') => {
  const id = String(model || '').toLowerCase();
  switch (providerId) {
    case 'anthropic': return anthropicLevels(id);
    case 'openai': return openaiLevels(id);
    case 'gemini': return geminiLevels(id);
    case 'deepseek': return guess(['none', 'low', 'high', 'max'], 'high');
    case 'openrouter': return guess(['none', 'low', 'medium', 'high']);
    case 'ollama': return guess(['none', 'low', 'medium', 'high']);
    case 'lmstudio': return none('LM Studio sets reasoning in its own model settings. Change it there.');
    default: return guess(['none', 'low', 'medium', 'high']);
  }
};

// Levels for the active provider and model. `info` is the `reasoning` field
// model discovery attached to the model (see parse* below), when there is one.
export const reasoningLevels = ({ providerId, model, info } = {}) => {
  if (info && Array.isArray(info.levels)) {
    const list = EFFORT_SCALE.filter((level) => info.levels.includes(level));
    if (!list.length) return none(NOT_A_REASONING_MODEL);
    return levels(list, list.includes(info.defaultLevel) ? info.defaultLevel : null);
  }
  return staticReasoningLevels(providerId, model);
};

// `wanted` if offered, else the closest offered level (a tie goes up, so a
// request never thinks less than asked by accident). Off is only ever
// chosen when it is offered; with no levels at all this returns null.
export const nearestLevel = (wanted, list) => {
  if (!list?.length) return null;
  if (list.includes(wanted)) return wanted;
  const target = Math.max(0, EFFORT_SCALE.indexOf(wanted));
  let best = null;
  let bestDistance = Infinity;
  for (const level of list) {
    const distance = Math.abs(EFFORT_SCALE.indexOf(level) - target);
    if (distance < bestDistance || (distance === bestDistance && EFFORT_SCALE.indexOf(level) > EFFORT_SCALE.indexOf(best))) {
      best = level;
      bestDistance = distance;
    }
  }
  return best;
};

// --- Model discovery metadata -> { levels, defaultLevel } -------------------

// Anthropic Models API: capabilities.effort.<level>.supported and
// capabilities.thinking.types.<type>.supported. Off needs a way to stop
// thinking: 'disabled' or 'between_tools'.
export const parseAnthropicCapabilities = (capabilities) => {
  const effort = capabilities?.effort;
  if (!effort || typeof effort !== 'object') return undefined;
  if (effort.supported === false) return { levels: [], defaultLevel: null };
  const list = ['low', 'medium', 'high', 'xhigh', 'max'].filter((level) => effort[level]?.supported === true);
  const types = capabilities.thinking?.types;
  const canStop = types?.disabled?.supported === true || types?.between_tools?.supported === true;
  return { levels: list.length && canStop ? ['none', ...list] : list, defaultLevel: null };
};

// DeepSeek /models: effort.supported_levels (excludes 'none', which always
// turns thinking off) and effort.default_level.
export const parseDeepSeekEffort = (effort) => {
  if (!effort || !Array.isArray(effort.supported_levels)) return undefined;
  const list = effort.supported_levels.filter((level) => EFFORT_SCALE.includes(level));
  return { levels: ['none', ...list], defaultLevel: typeof effort.default_level === 'string' ? effort.default_level : null };
};

// OpenRouter /models: reasoning.supported_efforts (null = every level),
// reasoning.mandatory (can't be turned off), reasoning.default_effort.
export const parseOpenRouterReasoning = (reasoning) => {
  // No supported_efforts at all: the model has no effort choice, so the
  // static guess (which OpenRouter maps to the nearest level) stays.
  if (!reasoning || typeof reasoning !== 'object' || !('supported_efforts' in reasoning)) return undefined;
  const supported = Array.isArray(reasoning.supported_efforts) ? reasoning.supported_efforts : ALL;
  let list = EFFORT_SCALE.filter((level) => supported.includes(level));
  if (reasoning.mandatory === true) list = list.filter((level) => level !== 'none');
  else if (!list.includes('none')) list = ['none', ...list];
  return { levels: list, defaultLevel: typeof reasoning.default_effort === 'string' ? reasoning.default_effort : null };
};
