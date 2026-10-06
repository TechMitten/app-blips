import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Sparkles } from 'lucide-react';
import Modal, { ModalCloseButton } from './Modal';
import { PLANS, PAID_PLAN_IDS, TRIAL, usageMultiple } from '../../functions/_lib/plans.js';
import { startCheckout, openBillingPortal, endTrial, usagePercent } from '../lib/billing';
import { maintenanceMode } from '../lib/maintenance';

// What each plan card lists. No token counts or model names: Pro is sold as
// a multiple of Plus's monthly usage (usageMultiple, rounded down). The
// landing page (AppBlips-Landing PricingPage.tsx) repeats these words; keep
// them in step.
const PLAN_FEATURES = {
  plus: [
    'Monthly usage allowance',
    'Image attachments',
    'Smarter chat in Ask mode',
  ],
  pro: [
    `${usageMultiple('pro')}x Plus's monthly usage`,
    'Everything in Plus',
    'For heavy building',
  ],
};

const shortDate = (value) => (value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null);

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

// Plans + usage. `reason` explains why it opened (no plan yet, a limit was
// reached); `checkoutResult` is set when Stripe Checkout just sent the user
// back; `onRefresh` reloads the status after a change made from here.
export default function PlansModal({ status, reason = null, checkoutResult = null, onRefresh, onClose }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const current = PLANS[status?.plan] || PLANS.none;
  const isPaid = current.id !== 'none';
  const trialing = Boolean(status?.trialing);
  const trialOffered = status?.trialEligible !== false;

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

  const renewal = shortDate(status?.periodEnd);
  const trialEnd = shortDate(status?.trialEnd);

  // Ends the trial so Plus (and its full allowance) starts now, charged today.
  const startPlusNow = () => run('end-trial', async () => {
    await endTrial();
    await onRefresh?.();
    setBusy(null);
  });

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
            {trialing
              ? `Your ${TRIAL.days}-day Plus trial has started. Cancel before ${trialEnd || 'it ends'} and you won't be charged.`
              : isPaid ? `You're on ${current.label}. Thanks for subscribing!` : 'All set. Your plan will update in a moment.'}
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
            {!isPaid ? (
              <p className="text-sm font-semibold text-slate-900">
                {trialOffered ? `Start with a free ${TRIAL.days}-day Plus trial` : "You don't have a plan"}
              </p>
            ) : trialing ? (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">You're on the Plus trial</p>
                  {trialEnd && (
                    <p className="text-xs text-slate-500">
                      {status.cancelAtPeriodEnd ? `Ends ${trialEnd}, no charge` : `Ends ${trialEnd}, then $${current.price}/month`}
                    </p>
                  )}
                </div>
                <Meter label="Trial allowance" used={status.periodTokens} limit={status.limits?.periodTokens} />
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {!status.cancelAtPeriodEnd && (
                    <button
                      type="button"
                      onClick={startPlusNow}
                      disabled={Boolean(busy) || maintenanceMode}
                      className="text-sm font-semibold text-brand hover:underline disabled:opacity-60"
                    >
                      {busy === 'end-trial' ? <Loader2 size={16} className="animate-spin" /> : 'Start Plus now'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => run('portal', openBillingPortal)}
                    disabled={Boolean(busy)}
                    className="text-sm font-semibold text-slate-600 hover:underline disabled:opacity-60"
                  >
                    {busy === 'portal' ? <Loader2 size={16} className="animate-spin" /> : status.cancelAtPeriodEnd ? 'Keep Plus' : 'Cancel trial'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">You're on {current.label}</p>
                  {renewal && (
                    <p className="text-xs text-slate-500">{status.cancelAtPeriodEnd ? `Ends ${renewal}` : `Renews ${renewal}`}</p>
                  )}
                </div>
                <Meter label="This billing period" used={status.periodTokens} limit={current.periodTokens} />
              </>
            )}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {PAID_PLAN_IDS.map((id) => PLANS[id]).map((plan) => {
            const isCurrent = plan.id === current.id;
            const withTrial = !isPaid && trialOffered && plan.id === TRIAL.plan;
            return (
              <div key={plan.id} className={`plans-panel plans-panel--plan rounded-xl p-4 flex flex-col ${isCurrent ? 'plans-panel--current' : ''}`}>
                <p className="text-sm font-semibold text-slate-900">{plan.label}</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">
                  ${plan.price}<span className="text-sm font-medium text-slate-500">/month</span>
                </p>
                {withTrial && <p className="mt-1 text-xs font-semibold text-brand">{TRIAL.days}-day free trial</p>}
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
                  ) : (
                    <button
                      type="button"
                      onClick={() => run(plan.id, () => startCheckout(plan.id))}
                      disabled={Boolean(busy) || !status?.enabled || maintenanceMode}
                      className="brand-fill-text w-full rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
                    >
                      {busy === plan.id ? <Loader2 size={16} className="mx-auto animate-spin" /> : isPaid ? `Switch to ${plan.label}` : withTrial ? 'Start free trial' : `Subscribe to ${plan.label}`}
                    </button>
                  )}
                  {withTrial && (
                    <p className="mt-2 text-xs text-slate-500">
                      Card required. ${plan.price}/month after {TRIAL.days} days unless you cancel before the trial ends.
                    </p>
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
            Every plan has a monthly usage allowance, and the trial has a smaller one. When you run out, new prompts wait until it resets; a build that has started always finishes.
            {' '}Cancel anytime. Cancel during the trial and you won't be charged; after that, you keep your plan until the end of the month you've paid for.
          </p>
          {isPaid && !trialing && (
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
