// Hosted billing API helpers. On local/desktop installs these calls return
// nothing useful (billing is not enabled), and callers treat that as "no
// hosted plan UI".

import { getAuthToken } from './authToken';

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

export async function openCheckout(planId) {
  const url = await createCheckoutSession(planId);
  window.location.assign(url);
}
