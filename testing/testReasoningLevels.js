// Reasoning levels per provider and model (electron/server/reasoning.js), the
// metadata model discovery attaches, and how the proxy clamps a level the
// model rejects. Run: node testing/testReasoningLevels.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  reasoningLevels, staticReasoningLevels, nearestLevel,
  parseAnthropicCapabilities, parseDeepSeekEffort, parseOpenRouterReasoning,
} from '../electron/server/reasoning.js';
import { applyProviderSettings, resolveUserProvider } from '../electron/server/providers.js';
import { listProviderModels } from '../electron/server/providerModels.js';
import { listAnthropicModels } from '../electron/server/anthropic.js';

const levelsOf = (providerId, model) => staticReasoningLevels(providerId, model).levels;

test('static levels follow each provider\'s documented table', () => {
  // Anthropic: Opus 5.5 can't turn thinking off; 4.6 models lack Extra high.
  assert.deepEqual(levelsOf('anthropic', 'claude-opus-5-5'), ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(levelsOf('anthropic', 'claude-sonnet-5-5'), ['none', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(levelsOf('anthropic', 'claude-sonnet-4-6'), ['none', 'low', 'medium', 'high', 'max']);
  assert.deepEqual(levelsOf('anthropic', 'claude-haiku-4-5'), []);
  // OpenAI
  assert.deepEqual(levelsOf('openai', 'gpt-6-astra'), ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(levelsOf('openai', 'gpt-6.1-sol'), ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(levelsOf('openai', 'gpt-6.1-terra'), ['none', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(levelsOf('openai', 'gpt-5'), ['minimal', 'low', 'medium', 'high']);
  assert.deepEqual(levelsOf('openai', 'gpt-5.1'), ['none', 'low', 'medium', 'high']);
  assert.deepEqual(levelsOf('openai', 'gpt-5.2'), ['none', 'low', 'medium', 'high', 'xhigh']);
  assert.deepEqual(levelsOf('openai', 'o4-mini'), ['low', 'medium', 'high']);
  assert.deepEqual(levelsOf('openai', 'gpt-4.1'), []);
  // Gemini, including the "models/" prefix of the OpenAI-compatible list.
  assert.deepEqual(levelsOf('gemini', 'models/gemini-2.5-flash'), ['none', 'low', 'medium', 'high']);
  assert.deepEqual(levelsOf('gemini', 'gemini-2.5-pro'), ['low', 'medium', 'high']);
  assert.deepEqual(levelsOf('gemini', 'gemini-3-pro-preview'), ['low', 'high']);
  assert.deepEqual(levelsOf('gemini', 'gemini-3-flash-preview'), ['minimal', 'low', 'medium', 'high']);
  assert.deepEqual(levelsOf('gemini', 'gemini-3.5-flash-lite'), ['minimal', 'low', 'medium', 'high']);
  assert.deepEqual(levelsOf('gemini', 'gemini-4-argon'), ['low', 'medium', 'high']);
  // DeepSeek, local servers
  assert.deepEqual(levelsOf('deepseek', 'deepseek-flash'), ['none', 'low', 'high', 'max']);
  assert.deepEqual(levelsOf('ollama', 'qwen3'), ['none', 'low', 'medium', 'high']);
  assert.deepEqual(levelsOf('lmstudio', 'openai/gpt-oss-20b'), []);
  assert.ok(staticReasoningLevels('lmstudio', 'x').note);
});

test('discovered levels win over the static table', () => {
  const info = { levels: ['high', 'none', 'low'], defaultLevel: 'high' };
  assert.deepEqual(reasoningLevels({ providerId: 'openrouter', model: 'x', info }), { levels: ['none', 'low', 'high'], defaultLevel: 'high', known: true });
  assert.deepEqual(reasoningLevels({ providerId: 'openrouter', model: 'x', info: { levels: [] } }).levels, []);
});

test('nearestLevel keeps offered levels and rounds the rest up', () => {
  assert.equal(nearestLevel('medium', ['none', 'low', 'medium', 'high']), 'medium');
  assert.equal(nearestLevel('medium', ['none', 'low', 'high', 'max']), 'high');
  assert.equal(nearestLevel('none', ['low', 'medium', 'high']), 'low');
  assert.equal(nearestLevel('max', ['low', 'high']), 'high');
  assert.equal(nearestLevel('minimal', ['none', 'low', 'high']), 'low');
  assert.equal(nearestLevel('high', []), null);
});

test('discovery metadata parsers', () => {
  const supported = { supported: true };
  const opus = {
    effort: { supported: true, low: supported, medium: supported, high: supported, xhigh: supported, max: supported },
    thinking: { supported: true, types: { adaptive: supported, disabled: { supported: false }, between_tools: { supported: false } } },
  };
  assert.deepEqual(parseAnthropicCapabilities(opus).levels, ['low', 'medium', 'high', 'xhigh', 'max']);
  const sonnet46 = { ...opus, effort: { ...opus.effort, xhigh: null }, thinking: { types: { disabled: supported } } };
  assert.deepEqual(parseAnthropicCapabilities(sonnet46).levels, ['none', 'low', 'medium', 'high', 'max']);
  assert.equal(parseAnthropicCapabilities(null), undefined);

  assert.deepEqual(parseDeepSeekEffort({ supported_levels: ['low', 'high', 'max'], default_level: 'high' }), { levels: ['none', 'low', 'high', 'max'], defaultLevel: 'high' });
  assert.equal(parseDeepSeekEffort(undefined), undefined);

  assert.deepEqual(parseOpenRouterReasoning({ supported_efforts: ['high', 'medium', 'low', 'minimal'], default_effort: 'medium', mandatory: true }), { levels: ['minimal', 'low', 'medium', 'high'], defaultLevel: 'medium' });
  assert.deepEqual(parseOpenRouterReasoning({ supported_efforts: null }).levels, ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(parseOpenRouterReasoning({ supported_efforts: ['high', 'low'] }).levels, ['none', 'low', 'high']);
  assert.equal(parseOpenRouterReasoning({ default_enabled: true }), undefined);
  assert.equal(parseOpenRouterReasoning(undefined), undefined);
});

test('model discovery attaches the levels', async () => {
  const deepseek = await listProviderModels({ id: 'deepseek', apiKey: 'k' }, {
    fetchImpl: async () => Response.json({ data: [{ id: 'deepseek-flash', effort: { supported_levels: ['low', 'high', 'max'], default_level: 'high' } }, { id: 'plain' }] }),
  });
  assert.deepEqual(deepseek.find((m) => m.id === 'deepseek-flash').reasoning, { levels: ['none', 'low', 'high', 'max'], defaultLevel: 'high' });
  assert.equal(deepseek.find((m) => m.id === 'plain').reasoning, undefined);

  const openrouter = await listProviderModels({ id: 'openrouter' }, {
    fetchImpl: async () => Response.json({ data: [{ id: 'google/gemini-3.5-flash', name: 'Gemini', reasoning: { supported_efforts: ['high', 'low'], mandatory: true } }] }),
  });
  assert.deepEqual(openrouter[0].reasoning.levels, ['low', 'high']);

  const anthropic = await listAnthropicModels('sk-ant-test', 'https://api.anthropic.com', {
    fetchImpl: async () => Response.json({ data: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', capabilities: { effort: { supported: true, low: { supported: true }, high: { supported: true } }, thinking: { types: {} } } }], has_more: false }),
  });
  assert.deepEqual(anthropic[0].reasoning.levels, ['low', 'high']);
});

const apply = (id, model, effort, extra = {}) => {
  const provider = resolveUserProvider({ id, model, apiKey: 'k', ...(id === 'lmstudio' || id === 'ollama' ? { apiKey: '' } : {}) });
  assert.equal(provider.error, undefined);
  const body = { model, temperature: 0, ...extra };
  applyProviderSettings(body, provider, { effort });
  return body;
};

test('the proxy clamps levels the model is known to reject', () => {
  // Gemini 3 Pro: no Off, no Medium.
  assert.equal(apply('gemini', 'gemini-3-pro-preview', 'none').reasoning_effort, 'low');
  assert.equal(apply('gemini', 'gemini-3-pro-preview', 'medium').reasoning_effort, 'high');
  assert.equal(apply('gemini', 'gemini-2.5-flash', 'none').reasoning_effort, 'none');
  // Unrecognised Gemini: Off is omitted (model default).
  assert.equal(apply('gemini', 'gemini-9-future', 'none').reasoning_effort, undefined);
  // OpenAI
  assert.equal(apply('openai', 'gpt-6-astra', 'none').reasoning_effort, 'low');
  assert.equal(apply('openai', 'gpt-6.1-terra', 'none').reasoning_effort, 'none');
  assert.equal(apply('openai', 'gpt-5', 'none').reasoning_effort, 'minimal');
  assert.equal(apply('openai', 'gpt-5.1', 'max').reasoning_effort, 'high');
  assert.equal(apply('openai', 'gpt-4.1', 'high').reasoning_effort, undefined);
  // Anthropic: Off stays off (anthropic.js), unsupported levels clamp.
  assert.equal(apply('anthropic', 'claude-opus-5-5', 'none').reasoning_effort, undefined);
  assert.equal(apply('anthropic', 'claude-sonnet-4-6', 'xhigh').reasoning_effort, 'max');
  assert.equal(apply('anthropic', 'claude-opus-5-5', 'xhigh').reasoning_effort, 'xhigh');
  // DeepSeek maps in-between levels itself.
  assert.equal(apply('deepseek', 'deepseek-flash', 'medium').reasoning_effort, 'medium');
  // Ollama gets the level (Off included); LM Studio gets none.
  assert.equal(apply('ollama', 'qwen3', 'none').reasoning_effort, 'none');
  assert.equal(apply('ollama', 'qwen3', 'high').reasoning_effort, 'high');
  assert.equal(apply('lmstudio', 'gpt-oss', 'high').reasoning_effort, undefined);
});
