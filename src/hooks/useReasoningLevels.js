import { useEffect, useMemo, useState } from 'react';
import { onProviderChange, providerApi } from '../lib/desktop';
import { cachedModelReasoning, onModelReasoningChange } from '../lib/modelReasoning';
import { logWarn } from '../lib/errorLog';
import { reasoningLevels } from '../../electron/server/reasoning.js';

// The reasoning levels the saved provider and model accept:
// { levels, defaultLevel, note, providerId, model }. Levels learned from
// model discovery win over the static table (reasoning.js). With no provider
// saved (or one from environment variables) the generic levels apply.
export default function useReasoningLevels() {
  const [provider, setProvider] = useState(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const bump = () => setRevision((value) => value + 1);
    const offProvider = onProviderChange(bump);
    const offModels = onModelReasoningChange(bump);
    return () => { offProvider(); offModels(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    providerApi.get().then((info) => { if (!cancelled) setProvider(info); }).catch((err) => {
      logWarn('Could not read the AI settings for the reasoning levels', err);
    });
    return () => { cancelled = true; };
  }, [revision]);

  const providerId = provider?.enabled && provider.id && provider.model ? provider.id : null;
  const model = providerId ? provider.model : null;
  return useMemo(() => ({
    ...reasoningLevels({ providerId, model, info: providerId ? cachedModelReasoning(providerId, model) : undefined }),
    providerId,
    model,
  // revision: the cached levels can change without the provider changing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [providerId, model, revision]);
}
