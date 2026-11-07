// Hosted billing API helpers. The desktop app's main process forwards these
// to the AppBlips Worker (electron/hostedApi.js). On local installs (source,
// Docker, Pinokio) they return nothing useful (billing is not enabled), and
// callers treat that as "no hosted plan UI".

import { getAuthToken } from './authToken';
import { isDesktop } from './desktop';

const withAuth = async (init = {}) => {
  const token = await getAuthToken();
  return {
    ...init,
    headers: {
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  };
};

export async function fetchBillingConfig() {
  try {
    const res = await fetch('/api/billing/config');
    if (!res.ok) return { hosted: false, plans: [] };
    const data = await res.json();
    return { hosted: Boolean(data?.hosted), plans: Array.isArray(data?.plans) ? data.plans : [] };
  } catch {
    return { hosted: false, plans: [] };
  }
}

export async function fetchBillingMe() {
  try {
    const res = await fetch('/api/billing/me', await withAuth());
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Opens Creem's hosted checkout. Returns the URL rather than navigating so
// callers can decide (the desktop app may want to open it in the browser).
export async function createCheckoutSession(planId) {
  const res = await fetch('/api/billing/checkout', await withAuth({
    method: 'POST',
    body: JSON.stringify({ plan: planId }),
  }));
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.url) throw new Error(data?.error || 'Could not start checkout.');
  return data.url;
}

// Cancels the plan at the end of the paid period. Returns the ISO date it
// ends (or null if Creem didn't say); throws with the server's message.
export async function cancelPlan() {
  const res = await fetch('/api/billing/cancel', await withAuth({ method: 'POST', body: '{}' }));
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || 'Could not cancel your subscription.');
  return data?.cancelAt || null;
}

// Returns true when checkout opened in the person's web browser (the desktop
// app), where the app stays open and has to notice the payment itself
// (waitForPlan). Elsewhere the page goes to Creem, which brings it back.
export async function openCheckout(planId) {
  const url = await createCheckoutSession(planId);
  if (isDesktop) {
    // main.js opens https links from the app in the default browser.
    window.open(url, '_blank', 'noopener');
    return true;
  }
  window.location.assign(url);
  return false;
}

// After a desktop checkout: re-reads the plan when the person comes back to
// the window and every few seconds, until Creem's notice has made it active
// (onActive gets the account) or 30 minutes pass. Returns a stop function.
export function waitForPlan(onActive, { intervalMs = 5000, timeoutMs = 30 * 60 * 1000 } = {}) {
  let stopped = false;
  let checking = false;
  const check = async () => {
    if (stopped || checking) return;
    checking = true;
    const account = await fetchBillingMe();
    checking = false;
    if (!stopped && account?.active) {
      stop();
      onActive(account);
    }
  };
  const timer = setInterval(check, intervalMs);
  const timeout = setTimeout(() => stop(), timeoutMs);
  window.addEventListener('focus', check);
  function stop() {
    stopped = true;
    clearInterval(timer);
    clearTimeout(timeout);
    window.removeEventListener('focus', check);
  }
  return stop;
}
