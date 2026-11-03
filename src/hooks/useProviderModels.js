import { useEffect, useState } from 'react';
import { ipcErrorMessage, providerApi } from '../lib/desktop';
import { logError } from '../lib/errorLog';
import { rememberModelReasoning } from '../lib/modelReasoning';

const EMPTY_MODELS = [];

// Debounce key edits and discard results from superseded requests. Saved
// desktop keys are resolved in the main process and never reach this hook.
export default function useProviderModels({ id, apiKey = '', hasSavedKey = false }) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState(null);
  const ready = id === 'openrouter' || Boolean(apiKey.trim() || hasSavedKey);
  const requestKey = JSON.stringify([id, apiKey, hasSavedKey, revision]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setResult({ requestKey, loading: true, models: EMPTY_MODELS, error: '' });
      try {
        const models = await providerApi.listModels({ id, apiKey: apiKey.trim() });
        // The levels each model accepts, for Settings → AI → Reasoning.
        rememberModelReasoning(id, models);
        if (!cancelled) setResult({ requestKey, loading: false, models, error: models.length ? '' : 'No models were returned. You can enter a model ID manually.' });
      } catch (err) {
        logError(`Could not load the model list for ${id}`, err);
        if (!cancelled) setResult({ requestKey, loading: false, models: EMPTY_MODELS, error: ipcErrorMessage(err) || 'Could not load models.' });
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [id, apiKey, ready, requestKey]);

  const current = result?.requestKey === requestKey ? result : null;
  return {
    models: current?.models || EMPTY_MODELS,
    loading: ready && (current?.loading ?? true),
    error: current?.error || '',
    needsKey: !ready,
    refresh: () => setRevision((value) => value + 1),
  };
}
