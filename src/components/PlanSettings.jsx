import { useEffect, useState } from 'react';
import { fetchBillingConfig, fetchBillingMe, openCheckout } from '../lib/billing';
import { SettingRow, PRIMARY_BUTTON } from './SettingControls';

const price = (cents) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

// Plan and credit status for hosted AppBlips. Local/desktop installs answer
// "not hosted" and show a short note instead of plan controls.
export default function PlanSettings() {
  const [config, setConfig] = useState(null);
  const [me, setMe] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const nextConfig = await fetchBillingConfig();
      if (cancelled) return;
      setConfig(nextConfig);
      if (nextConfig.hosted) {
        const nextMe = await fetchBillingMe();
        if (!cancelled) setMe(nextMe);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <p className="p-4 text-sm text-slate-500">Loading plan…</p>;
  if (!config?.hosted) {
    return (
      <p className="p-4 text-sm leading-relaxed text-slate-500">
        Plans and credits are available on AppBlips Cloud. This install uses your own AI provider,
        so there is nothing to bill.
      </p>
    );
  }

  const active = Boolean(me?.active);
  const currentId = active ? me?.plan : null;
  const currentPrice = active
    ? (config.plans || []).find((plan) => plan.id === currentId)?.priceCents ?? 0
    : -1;
  const currentName = active ? me.planName : 'No active plan';
  const credits = !active
    ? 'Subscribe to start building'
    : me.unlimited
      ? 'Unlimited during beta'
      : me.credits == null
        ? '—'
        : `${me.credits} of ${me.monthlyCredits} left this month`;

  const upgrade = async (planId) => {
    setBusy(planId);
    setError('');
    try {
      await openCheckout(planId);
    } catch (err) {
      setError(err.message || 'Could not start checkout.');
      setBusy(null);
    }
  };

  return (
    <>
      <SettingRow
        id="set-plan"
        title="Current plan"
        description={me ? `${currentName} — ${credits}` : 'Could not load your plan.'}
      >
        <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
          {currentName}
        </span>
      </SettingRow>

      {(config.plans || []).filter((plan) => plan.id !== currentId).map((plan) => {
        const details = plan.monthlyCredits == null
          ? 'unlimited builds during the beta'
          : `${plan.monthlyCredits} build credits monthly`;
        const action = !active ? 'Subscribe' : plan.priceCents > currentPrice ? 'Upgrade' : 'Switch';
        return (
          <SettingRow
            key={plan.id}
            id={`set-plan-${plan.id}`}
            title={plan.name}
            description={`${price(plan.priceCents)} per month — ${details}.`}
          >
            <button
              type="button"
              className={PRIMARY_BUTTON}
              disabled={busy !== null}
              onClick={() => upgrade(plan.id)}
            >
              {busy === plan.id ? 'Opening checkout…' : `${action} to ${plan.name}`}
            </button>
          </SettingRow>
        );
      })}

      {error && <p role="alert" className="px-4 pb-4 text-sm text-red-600">{error}</p>}
    </>
  );
}
