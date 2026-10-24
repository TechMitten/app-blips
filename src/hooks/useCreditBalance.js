import { useEffect, useState } from 'react';
import { creditsStatus } from '../lib/credits';
import { providerApi } from '../lib/desktop';
import { logWarn } from '../lib/errorLog';

// Remaining AppBlips AI Credits for the Build header, or null when credits
// aren't what builds are paid with (not connected, or a provider saved under
// Settings → API takes over; chatProxy.js only uses credits without one).
// Re-reads whenever `busy` goes false (a generation finished, Settings closed),
// since those are the moments the balance or the connection can change; the
// last value stays on screen meanwhile.
export default function useCreditBalance(busy) {
  const [remaining, setRemaining] = useState(null);

  useEffect(() => {
    if (busy) return undefined;
    let cancelled = false;
    Promise.all([creditsStatus(), providerApi.get().catch(() => null)]).then(([status, saved]) => {
      if (cancelled) return;
      const byokActive = Boolean(saved?.enabled && saved.id && saved.model && (saved.local || saved.hasKey));
      setRemaining(status?.signedIn && !byokActive && typeof status.remaining === 'number' ? status.remaining : null);
    }).catch((err) => logWarn('Could not read the AI Credits balance', err));
    return () => { cancelled = true; };
  }, [busy]);

  return remaining;
}
