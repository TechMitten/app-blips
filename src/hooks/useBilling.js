import { useCallback, useEffect, useState } from 'react';
import { getBillingStatus } from '../lib/billing';

// Back from Stripe Checkout the plan may not have changed yet: the webhook
// that records it can land a few seconds after the redirect. Poll briefly.
const CHECKOUT_POLL_MS = 2000;
const CHECKOUT_POLL_TRIES = 15;

// ?billing=success|cancelled is where Checkout sends the user back to. Read
// once when the page loads (the return is always a fresh page load).
const readCheckoutResult = () => {
  if (typeof window === 'undefined') return null;
  const result = new URLSearchParams(window.location.search).get('billing');
  return result === 'success' || result === 'cancelled' ? result : null;
};

// The signed-in user's plan and usage (null until loaded, or when signed
// out). `billingOn` is false on instances that don't bill, where nothing
// billing-related should show.
export default function useBilling({ isSignedIn }) {
  const [loaded, setLoaded] = useState(null);
  const [checkoutResult, setCheckoutResult] = useState(readCheckoutResult);
  const status = isSignedIn ? loaded : null;

  const refresh = useCallback(async () => {
    const next = await getBillingStatus();
    setLoaded(next);
    return next;
  }, []);

  // Drop the query parameter so a reload doesn't show the result again.
  useEffect(() => {
    if (!checkoutResult) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('billing')) return;
    params.delete('billing');
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  }, [checkoutResult]);

  useEffect(() => {
    if (!isSignedIn) return undefined;
    let timer = null;
    let cancelled = false;
    let tries = 0;
    const load = async () => {
      const next = await refresh();
      tries += 1;
      // Back from Checkout but no plan yet: the webhook hasn't landed.
      if (!cancelled && checkoutResult === 'success' && next?.enabled && next.plan === 'none' && !next.trialRefused && tries < CHECKOUT_POLL_TRIES) {
        timer = setTimeout(load, CHECKOUT_POLL_MS);
      }
    };
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isSignedIn, refresh, checkoutResult]);

  return {
    status,
    billingOn: Boolean(status?.enabled),
    plan: status?.enabled ? status.plan : null,
    trialing: Boolean(status?.enabled && status.trialing),
    // Free prompts left on an account with no plan (FREE_BUILDS in plans.js).
    freeBuildsLeft: status?.enabled ? Number(status.freeBuildsLeft) || 0 : 0,
    freeBuildsUsed: Boolean(status?.enabled && status.freeBuildsUsed),
    hasBillingAccount: Boolean(status?.enabled && status.hasBillingAccount),
    refresh,
    checkoutResult: isSignedIn ? checkoutResult : null,
    clearCheckoutResult: () => setCheckoutResult(null),
  };
}
