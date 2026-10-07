import { resolveUserProvider, providerLabel } from './providers.js';

// Shared by the main-process IPC handler and browser settings. Model discovery
// needs credentials and an endpoint, but does not require a selected model.
export async function listProviderModels(input, { fetchImpl = globalThis.fetch } = {}) {
  const provider = resolveUserProvider({
    ...input,
    model: 'model-discovery',
    // OpenRouter exposes a public catalog, unlike the direct cloud APIs.
    apiKey: input?.id === 'openrouter' && !input?.apiKey ? 'public-catalog' : input?.apiKey,
  });
  if (provider.error) throw new Error(provider.error);
  const headers = {};
  if (typeof input?.apiKey === 'string' && input.apiKey.trim()) headers.Authorization = `Bearer ${provider.apiKey}`;
  let response;
  try {
    response = await fetchImpl(`${provider.baseUrl.replace(/\/+$/, '')}/models`, {
      headers,
      signal: AbortSignal.timeout(15000),
      // Keep credentials on the validated endpoint, including local servers.
      redirect: 'error',
    });
  } catch {
    throw new Error(`Could not reach ${providerLabel(provider.id)} to load models.`);
  }
  if (!response.ok) {
    if ([401, 403].includes(response.status)) throw new Error(`${providerLabel(provider.id)} rejected the API key. Check your key and its permissions.`);
    throw new Error(`${providerLabel(provider.id)} could not load models (HTTP ${response.status}).`);
  }
  let data;
  try { data = await response.json(); }
  catch { throw new Error('The provider returned an invalid model list.'); }
  if (!Array.isArray(data?.data)) throw new Error('The provider returned an invalid model list.');
  const models = new Map();
  for (const model of data.data) {
    if (typeof model?.id !== 'string' || !model.id.trim()) continue;
    models.set(model.id, { id: model.id, label: typeof model.name === 'string' && model.name.trim() ? model.name : model.id });
  }
  return [...models.values()].sort((a, b) => a.label.localeCompare(b.label));
}
