import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchBillingMe } from '../lib/billing';

// Reads the signed-in account's plan (/api/billing/me) once per mount.
// Shared by Settings → Account and the studio picker's account menu.
// `refresh` re-reads it: the workspace header's menu stays mounted while the
// user sends follow-up prompts, so its usage count would otherwise stay at
// whatever it was when the project opened. The old value stays on screen
// until the new one arrives, so the menu doesn't flash "Loading…".
export function useBillingMe(isSignedIn) {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);

  const load = useCallback(() => {
    const call = ++latest.current;
    fetchBillingMe().then((account) => {
      // A later read (or unmount) supersedes this one.
      if (call !== latest.current) return;
      // A failed re-read keeps what was already shown.
      setMe((previous) => account || previous);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!isSignedIn) return undefined;
    load();
    return () => { latest.current += 1; };
  }, [isSignedIn, load]);

  return { me, setMe, loading, refresh: load };
}
