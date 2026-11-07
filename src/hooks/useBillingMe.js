import { useEffect, useState } from 'react';
import { fetchBillingMe } from '../lib/billing';

// Reads the signed-in account's plan (/api/billing/me) once per mount.
// Shared by Settings → Account and the studio picker's account menu.
export function useBillingMe(isSignedIn) {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!isSignedIn) return undefined;
    let cancelled = false;
    fetchBillingMe().then((account) => {
      if (cancelled) return;
      setMe(account);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [isSignedIn]);
  return { me, setMe, loading };
}
