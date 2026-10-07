import { useEffect, useState } from 'react';
import { ipcErrorMessage, providerApi } from '../lib/desktop';

const EMPTY_MODELS = [];

// Debounce key/URL edits and discard results from superseded requests. Saved
// desktop keys are resolved in the main process and never reach this hook.
export default function useProviderModels({ id, apiKey = '', baseUrl = '', hasSavedKey = false }) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState(null);
  const ready = ['openrouter', 'lmstudio', 'ollama'].includes(id) || Boolean(apiKey.trim() || hasSavedKey);
  const requestKey = JSON.stringify([id, apiKey, baseUrl, hasSavedKey, revision]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setResult({ requestKey, loading: true, models: EMPTY_MODELS, error: '' });
      try {
        const models = await providerApi.listModels({ id, apiKey: apiKey.trim(), baseUrl: baseUrl.trim() });
        if (!cancelled) setResult({ requestKey, loading: false, models, error: models.length ? '' : 'No models were returned. You can enter a model ID manually.' });
      } catch (err) {
        if (!cancelled) setResult({ requestKey, loading: false, models: EMPTY_MODELS, error: ipcErrorMessage(err) || 'Could not load models.' });
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [id, apiKey, baseUrl, ready, requestKey]);

  const current = result?.requestKey === requestKey ? result : null;
  return {
    models: current?.models || EMPTY_MODELS,
    loading: ready && (current?.loading ?? true),
    error: current?.error || '',
    needsKey: !ready,
    refresh: () => setRevision((value) => value + 1),
  };
}
