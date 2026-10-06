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
  let status = { enabled: false };
  try {
    status = await call('/api/billing/status') || { enabled: false };
  } catch {
    // Ignore errors, we'll return disabled or the dev mock.
  }

  if (import.meta.env.DEV && !status.enabled) {
    const plan = import.meta.env.VITE_MOCK_PLAN || localStorage.getItem('mockPlan') || 'plus';
    const trialing = import.meta.env.VITE_MOCK_TRIALING 
      ? import.meta.env.VITE_MOCK_TRIALING === 'true' 
      : (plan === 'plus' && localStorage.getItem('mockTrialing') !== 'false');
    
    return {
      enabled: true,
      plan,
      status: 'active',
      trialing,
      trialEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      trialEligible: true,
      periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      cancelAtPeriodEnd: false,
      periodTokens: 500000,
      limits: { periodTokens: 6000000 },
      blocked: null,
    };
  }

  return status;
};

// Sends the browser to Stripe Checkout for `plan` ('plus' | 'pro'). An
// existing subscriber is sent to the Customer Portal instead, where Stripe
// handles switching plans.
export const startCheckout = async (plan) => {
  const { url } = await call('/api/billing/checkout', { method: 'POST', body: { plan } });
  window.location.assign(url);
};

// Ends the free trial now: Plus starts (and is charged) straight away.
export const endTrial = () => call('/api/billing/end-trial', { method: 'POST' });

export const openBillingPortal = async () => {
  const { url } = await call('/api/billing/portal', { method: 'POST' });
  window.location.assign(url);
};

// Share of an allowance used, 0-100, for meters.
export const usagePercent = (used, limit) => (limit ? Math.min(100, Math.round((Number(used) / limit) * 100)) : 0);
