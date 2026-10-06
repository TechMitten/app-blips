import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Sparkles } from 'lucide-react';
import Modal, { ModalCloseButton } from './Modal';
import { PLANS, usageMultiple } from '../../functions/_lib/plans.js';
import { startCheckout, openBillingPortal, usagePercent } from '../lib/billing';
import { maintenanceMode } from '../lib/maintenance';

// What each plan card lists. No token counts, model names or Free's daily
// prompt number: Free is sold as daily prompts, paid plans as a multiple of
// Free's monthly usage (usageMultiple, rounded down). The landing page
// (AppBlips-Landing PricingPage.tsx) repeats these words; keep them in step.
const PLAN_FEATURES = {
  free: [
    'Daily prompts to Build or Ask',
    'Apps, websites and games',
    'Resets every day',
  ],
  plus: [
    `${usageMultiple('plus')}x Free's monthly usage`,
    'Image attachments',
    'Smarter chat in Ask mode',
  ],
  pro: [
    `${usageMultiple('pro')}x Free's monthly usage`,
    'Everything in Plus',
    'For heavy building',
  ],
};

// Brand blues, cyan and white: the celebration stays on-palette.
const CONFETTI_COLORS = ['#1e598f', '#3987d0', '#81afda', '#22d3ee', '#ffffff'];

// A short two-sided burst once a payment lands. Loaded on demand so the
// library never weighs on a normal page load; skipped for reduced motion.
const celebrate = async () => {
  const { default: confetti } = await import('canvas-confetti');
  const shared = { colors: CONFETTI_COLORS, zIndex: 100, disableForReducedMotion: true, ticks: 220 };
  confetti({ ...shared, particleCount: 90, spread: 70, origin: { x: 0.5, y: 0.35 } });
  setTimeout(() => {
    confetti({ ...shared, particleCount: 60, angle: 60, spread: 60, origin: { x: 0, y: 0.6 } });
    confetti({ ...shared, particleCount: 60, angle: 120, spread: 60, origin: { x: 1, y: 0.6 } });
  }, 250);
};

// `detail` replaces the "N% used" readout.
function Meter({ label, used, limit, detail = null }) {
  const percent = usagePercent(used, limit);
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs font-medium text-slate-600">
        <span>{label}</span>
        <span className="tabular-nums">{detail || `${percent}% used`}</span>
      </div>
      <div className="mt-1.5 h-2 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-label={label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded-full ${percent >= 90 ? 'bg-rose-500' : 'bg-brand'}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

// Plans + usage. `reason` explains why it opened (a limit was reached, an
// image was attached on Free); `checkoutResult` is set when Stripe Checkout
// just sent the user back.
export default function PlansModal({ status, reason = null, checkoutResult = null, onClose }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const current = PLANS[status?.plan] || PLANS.free;
  const isPaid = current.id !== 'free';

  // Fire once, when the return from Checkout shows the new paid plan (the
  // webhook can land a moment after the redirect, so this waits for it).
  const celebratedRef = useRef(false);
  useEffect(() => {
    if (checkoutResult !== 'success' || !isPaid || celebratedRef.current) return;
    celebratedRef.current = true;
    celebrate().catch(() => {});
  }, [checkoutResult, isPaid]);

  const run = async (key, action) => {
    setBusy(key);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
      setBusy(null);
    }
  };

  const renewal = status?.periodEnd ? new Date(status.periodEnd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null;

  return (
    <Modal zIndex={80} cardClass="plans-modal w-full max-w-3xl bg-surface rounded-2xl border border-slate-200 overflow-hidden animate-scale-in max-h-[90vh] flex flex-col">
      <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="w-9 h-9 bg-brand/10 rounded-xl flex items-center justify-center text-brand">
            <Sparkles size={18} />
          </div>
          <h2 className="text-lg font-semibold text-slate-900">Plans</h2>
        </div>
        <ModalCloseButton onClick={onClose} />
      </div>

      <div className="p-6 overflow-y-auto custom-scrollbar space-y-5">
        {checkoutResult === 'success' && (
          <div className="rounded-xl border border-green-100 bg-green-50 px-4 py-3 text-sm text-green-800">
            {isPaid ? `You're on ${current.label}. Thanks for subscribing!` : 'Payment received. Your plan will update in a moment.'}
          </div>
        )}
        {checkoutResult === 'cancelled' && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            Checkout was cancelled. Nothing was charged.
          </div>
        )}
        {maintenanceMode && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Upgrades are paused while AppBlips is down for maintenance. Nothing will be charged.
          </div>
        )}
        {reason && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{reason}</div>
        )}

        {status?.enabled && (
          <div className="plans-panel rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900">You're on {current.label}</p>
              {isPaid && renewal && (
                <p className="text-xs text-slate-500">{status.cancelAtPeriodEnd ? `Ends ${renewal}` : `Renews ${renewal}`}</p>
              )}
            </div>
            {/* Only paid plans get a meter, for their monthly allowance. Free
                shows none: its daily prompt number isn't advertised, and the
                limit message says when it runs out. */}
            {isPaid && <Meter label="This billing period" used={status.periodTokens} limit={current.periodTokens} />}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          {Object.values(PLANS).map((plan) => {
            const isCurrent = plan.id === current.id;
            return (
              <div key={plan.id} className={`plans-panel plans-panel--plan rounded-xl p-4 flex flex-col ${isCurrent ? 'plans-panel--current' : ''}`}>
                <p className="text-sm font-semibold text-slate-900">{plan.label}</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">
                  ${plan.price}<span className="text-sm font-medium text-slate-500">{plan.price ? '/month' : ''}</span>
                </p>
                <ul className="mt-3 space-y-1.5 text-sm text-slate-600 flex-1">
                  {PLAN_FEATURES[plan.id].map((feature) => (
                    <li key={feature} className="flex gap-2">
                      <Check size={16} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4">
                  {isCurrent ? (
                    <button type="button" disabled className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-500">
                      Current plan
                    </button>
                  ) : plan.id === 'free' ? (
                    // Moving down to Free is cancelling, which Stripe's portal handles.
                    <button
                      type="button"
                      onClick={() => run('portal', openBillingPortal)}
                      disabled={Boolean(busy)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      {busy === 'portal' ? <Loader2 size={16} className="mx-auto animate-spin" /> : 'Cancel plan'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => run(plan.id, () => startCheckout(plan.id))}
                      disabled={Boolean(busy) || !status?.enabled || maintenanceMode}
                      className="brand-fill-text w-full rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
                    >
                      {busy === plan.id ? <Loader2 size={16} className="mx-auto animate-spin" /> : isPaid ? `Switch to ${plan.label}` : `Upgrade to ${plan.label}`}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {error && <p className="text-sm font-medium text-rose-600">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Matches the Stripe portal setting: cancelling takes effect at the
              end of the period already paid for. */}
          <p className="text-xs text-slate-500">
            Every plan has a monthly usage allowance, and Free also has a daily prompt limit. When you run out, new prompts wait until it resets; a build that has started always finishes.
            {' '}Cancel anytime. You keep your plan until the end of the month you've paid for.
          </p>
          {isPaid && (
            <button
              type="button"
              onClick={() => run('portal', openBillingPortal)}
              disabled={Boolean(busy)}
              className="text-sm font-semibold text-brand hover:underline disabled:opacity-60"
            >
              Manage billing and invoices
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
