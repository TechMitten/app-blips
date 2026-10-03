// Client side of Stripe billing (server: functions/_lib/billing.js). The
// browser never talks to Stripe directly: it asks our API for a Checkout or
// Customer Portal URL and navigates there.
import authProvider from './auth';

const call = async (path, { method = 'GET', body } = {}) => {
  const token = await authProvider.getIdToken();
  const response = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `Billing request failed (${response.status}).`);
  return data;
};

// { enabled: false } when this instance doesn't bill (no Stripe key, or a
// host without the billing routes, like the desktop app).
export const getBillingStatus = async () => {
  try {
    return await call('/api/billing/status');
  } catch {
    return { enabled: false };
  }
};

// Sends the browser to Stripe Checkout for `plan` ('plus' | 'pro'). An
// existing subscriber is sent to the Customer Portal instead, where Stripe
// handles switching plans.
export const startCheckout = async (plan) => {
  const { url } = await call('/api/billing/checkout', { method: 'POST', body: { plan } });
  window.location.assign(url);
};

export const openBillingPortal = async () => {
  const { url } = await call('/api/billing/portal', { method: 'POST' });
  window.location.assign(url);
};

// Share of an allowance used, 0-100, for meters.
export const usagePercent = (used, limit) => (limit ? Math.min(100, Math.round((Number(used) / limit) * 100)) : 0);
