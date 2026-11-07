import { useCallback, useEffect, useState } from 'react';
import { fetchBillingConfig, fetchBillingMe, openCheckout } from '../lib/billing';
import { fetchSandboxStatus } from '../lib/sandboxComputer';

const price = (cents) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

// Hard paywall for hosted AppBlips: a signed-in user with no active
// subscription sees the plans instead of the app. The server enforces the
// same rule on /api/chat, so this is the friendly surface, not the only one.
// Local/desktop installs (no hosted billing) pass straight through.
export default function SubscriptionGate({ children }) {
  const [status, setStatus] = useState('loading'); // loading | open | gated
  const [plans, setPlans] = useState([]);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    let cancelled = false;
    fetchBillingConfig().then((config) => {
      if (cancelled) return;
      if (!config.hosted) {
        setStatus('open');
        fetchSandboxStatus();
        return;
      }
      setPlans(config.plans || []);
      fetchBillingMe().then((me) => {
        if (cancelled) return;
        if (!me) {
          // Transient failure: don't lock the UI out; the server still
          // refuses AI calls without an active subscription.
          setStatus('open');
          return;
        }
        setStatus(me.active ? 'open' : 'gated');
        if (me.active) fetchSandboxStatus();
      });
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => load(), [load]);

  // Coming back from Creem checkout (same tab or a new one) re-checks.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const gated = status === 'gated';

  const subscribe = async (planId) => {
    setBusy(planId);
    setError('');
    try {
      await openCheckout(planId);
    } catch (err) {
      setError(err.message || 'Could not start checkout.');
      setBusy(null);
    }
  };

  // The tree shape never changes -- children stay mounted in the same
  // position from first render through gated/open. Remounting App here would
  // restart the launch splash (and lose the user's workspace state).
  return (
    <>
      <div inert={gated} aria-hidden={gated}>{children}</div>
      {gated && (
        <div
          // Above every app layer, including the first-run setup screen
          // (z 1000, its pop-ups 1200): the app behind is inert, so a plan
          // card drawn underneath it leaves a screen that ignores all input.
          // Black, not slate-950: the dark theme flips the slate ramp, which
          // made slate-950 a light grey wash.
          className="fixed inset-0 z-1300 flex items-center justify-center overflow-y-auto bg-black/85 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Choose a plan"
        >
          <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-slate-900 p-6 text-slate-100 shadow-2xl">
            <h2 className="text-xl font-bold">Choose a plan to start building</h2>
            <p className="mt-1 text-sm text-slate-400">
              A subscription is required to use AppBlips AI. Cancel anytime.
            </p>
            <div className="mt-5 space-y-3">
              {plans.map((plan) => (
                <div
                  key={plan.id}
                  className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-slate-800/60 px-4 py-3"
                >
                  <div>
                    <p className="font-semibold">{plan.name}</p>
                    <p className="text-xs text-slate-400">
                      {price(plan.priceCents)}/month · {plan.monthlyCredits == null
                        ? 'unlimited builds during beta'
                        : `${plan.monthlyCredits} build credits`}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => subscribe(plan.id)}
                    className="shrink-0 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 disabled:opacity-50"
                  >
                    {busy === plan.id ? 'Opening…' : 'Subscribe'}
                  </button>
                </div>
              ))}
            </div>
            {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
          </div>
        </div>
      )}
    </>
  );
}
