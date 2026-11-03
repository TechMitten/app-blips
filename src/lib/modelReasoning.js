// Per-model reasoning levels learned from model discovery (Anthropic's
// capabilities, DeepSeek's effort, OpenRouter's reasoning metadata; see
// electron/server/reasoning.js). Settings → AI and onboarding load the model
// list anyway, so the levels are remembered here instead of fetching the list
// again just to draw the Reasoning setting. Missing entries fall back to the
// static table in reasoning.js.
import { safeStorage } from './config';

const CACHE_KEY = 'orion-model-reasoning';
const listeners = new Set();

const readCache = () => {
  try {
    const parsed = JSON.parse(safeStorage('local')?.getItem(CACHE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

// Replaces what's known for `providerId` with the levels in `models` (the
// listModels result). Only models that carry levels are kept, so the cache
// stays small even for OpenRouter's catalog.
export const rememberModelReasoning = (providerId, models) => {
  if (!providerId || !Array.isArray(models)) return;
  const entries = {};
  for (const model of models) {
    if (model?.reasoning && Array.isArray(model.reasoning.levels)) {
      entries[model.id] = { levels: model.reasoning.levels, defaultLevel: model.reasoning.defaultLevel ?? null };
    }
  }
  const cache = readCache();
  if (JSON.stringify(cache[providerId] || {}) === JSON.stringify(entries)) return;
  if (Object.keys(entries).length) cache[providerId] = entries;
  else delete cache[providerId];
  try { safeStorage('local')?.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* storage unavailable */ }
  for (const listener of listeners) listener();
};

export const cachedModelReasoning = (providerId, model) => readCache()[providerId]?.[model];

export const onModelReasoningChange = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
